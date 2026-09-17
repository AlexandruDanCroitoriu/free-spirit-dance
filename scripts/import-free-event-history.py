#!/usr/bin/env python3
"""Import Catalog practice and IZFM history into the two local free events.

The importer is deliberately limited to the existing ``Practice`` and ``IZFM``
events in the active local Catalog.  It retains source-row audit data, validates
on a private SQLite candidate first, and verifies that a second application is a
no-op before ``--apply`` changes the local database.
"""
import argparse
import collections
import datetime as dt
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ACTOR = 'historical-import@free-spirit-dance.invalid'
EVENTS = {'PRACTICE': 'Practice', 'IZFM': 'IZFM'}
V1_ALIASES = {
    'cosmin': 'Cosmin Popescu', 'vanguard': 'Andrei Cristian',
    'victor tipul nou': 'Victor Rusu', 'armin': 'Armin SHIR MOHAMMADI',
    'dan': 'Dan Costache', 'malina': 'Mălina CROITORIU',
    'sandra popovici': 'Alexandra (Sandra) Popovici', 'veve': 'Raluca Mihaela Ion (Veve)',
    'andreea ioan': 'Andreea Maria Ioan',
}

spec = importlib.util.spec_from_file_location('catalog_v2', ROOT / 'scripts/import-catalog-v2.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def money(value):
    result = Decimal(value) * 100
    assert result == result.to_integral_value() and result > 0
    return int(result)


def fingerprint(db):
    return hashlib.sha256('\n'.join(db.iterdump()).encode()).hexdigest()


def valid(db):
    assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    assert not db.execute('PRAGMA foreign_key_check').fetchall()


def event_rows():
    helper.WORKBOOK = ROOT / 'docs/Catalog FSD.xlsx'
    first = helper.read_workbook()['Practica 2026']
    helper.WORKBOOK = ROOT / 'docs/Catalog FSD v2.xlsx'
    second = helper.read_workbook()
    digest = hashlib.sha256(
        (ROOT / 'docs/Catalog FSD.xlsx').read_bytes() + (ROOT / 'docs/Catalog FSD v2.xlsx').read_bytes()
    ).hexdigest()
    rows = []
    for row in first:
        if not row.get('A'):
            continue
        assert row.get('B') and row.get('C'), 'Incomplete Practica 2026 attendance row'
        rows.append({'event': 'PRACTICE', 'day': helper.date(row['B']), 'name': row['A'],
                     'location': row['C'], 'amount': money(row['D']) if row.get('D') else None,
                     'method': '', 'source': 'Catalog FSD.xlsx', 'sheet': 'Practica 2026',
                     'row': int(row['row']), 'raw': {key: row.get(key, '') for key in ('A', 'B', 'C', 'D')}})
    for row in second['(I) Prezente']:
        if row.get('A') and row.get('B') and row.get('C') in EVENTS:
            rows.append({'event': row['C'], 'day': helper.date(row['A']), 'name': row['B'],
                         'location': '', 'amount': None, 'method': '', 'source': 'Catalog FSD v2.xlsx',
                         'sheet': '(I) Prezente', 'row': int(row['row']), 'raw': row})
    payments = []
    for row in second['(I) Incasari']:
        if row.get('A') and row.get('C') and row.get('D') and row.get('E') in EVENTS:
            payments.append({'event': row['E'], 'day': helper.date(row['A']), 'name': row['C'],
                             'amount': money(row['D']), 'method': row.get('F', ''), 'source': 'Catalog FSD v2.xlsx',
                             'sheet': '(I) Incasari', 'row': int(row['row']), 'raw': row})
    return rows, payments, digest


def import_data(db, attendance, payments, digest, now):
    db.execute('CREATE TABLE IF NOT EXISTS free_event_history_runs (digest TEXT PRIMARY KEY, imported_at TEXT NOT NULL, summary TEXT NOT NULL)')
    prior = db.execute('SELECT digest, summary FROM free_event_history_runs').fetchall()
    if prior:
        assert len(prior) == 1 and prior[0][0] == digest, 'Workbook changed after import; review required'
        return json.loads(prior[0][1])
    db.execute('CREATE TABLE free_event_history_audit (source TEXT NOT NULL, sheet TEXT NOT NULL, source_row INTEGER NOT NULL, target_table TEXT NOT NULL, target_id INTEGER NOT NULL, source_json TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY(source, sheet, source_row))')
    students = collections.defaultdict(list)
    for sid, first, last in db.execute('SELECT id, first_name, last_name FROM students'):
        students[helper.norm(first + ' ' + last)].append(sid)
    def student(name, aliases=False):
        source = V1_ALIASES.get(helper.norm(name), name) if aliases else name
        # Prefer an exact normalized profile name.  Catalog v2's older alias
        # list contains historical spelling normalizations that are no longer
        # needed when the full current name exists in Catalog.
        matched = students[helper.norm(source)]
        if not matched:
            matched = students[helper.identity(source)]
        if not matched and helper.norm(source) == 'alex mihalache':
            matched = students[helper.norm('Alexandru Mihalache')]
        assert len(matched) == 1, f'Ambiguous or missing student: {name}'
        return matched[0]
    event_ids = dict(db.execute("SELECT name, id FROM free_events WHERE name IN ('Practice', 'IZFM')"))
    assert set(event_ids) == set(EVENTS.values()), 'Expected exactly the existing Practice and IZFM events'
    assert db.execute('SELECT count(*) FROM free_event_meetings').fetchone()[0] == 0, 'Meetings already exist; review required'
    rows = []
    seen = set()
    for item in attendance:
        sid = student(item['name'], item['source'] == 'Catalog FSD.xlsx')
        key = item['event'], item['day'], sid
        assert key not in seen, f'Duplicate source attendance: {key}'
        seen.add(key)
        rows.append({**item, 'student_id': sid})
    meetings = {}
    for event, day in sorted({(event, day) for event, day, _ in seen}):
        event_id = event_ids[EVENTS[event]]
        source_rows = [r for r in rows if r['event'] == event and r['day'] == day]
        locations = {r['location'] for r in source_rows if r['location']}
        assert len(locations) <= 1, f'Conflicting locations for {event} {day}'
        local = dt.datetime.fromisoformat(day + 'T16:00').replace(tzinfo=ZoneInfo('Europe/Bucharest'))
        meeting_id = helper.insert(db, 'free_event_meetings', dict(
            event_id=event_id, name=EVENTS[event], starts_at=day + 'T16:00',
            starts_utc=local.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
            duration_minutes=120, space_rent_minor=0, accepts_donations=0,
            created_by=ACTOR, created_at=now, updated_at=now))
        meetings[event, day] = meeting_id
    audit_count = collections.Counter()
    for item in rows:
        meeting_id = meetings[item['event'], item['day']]
        values = dict(meeting_id=meeting_id, student_id=item['student_id'], recorded_by=ACTOR, recorded_at=now)
        if item['amount'] is not None:
            values.update(donation_amount_minor=item['amount'], donation_received_method=item['method'])
            db.execute('UPDATE free_event_meetings SET accepts_donations=1 WHERE id=?', (meeting_id,))
        aid = helper.insert(db, 'free_event_attendance', values)
        db.execute('INSERT INTO free_event_history_audit VALUES (?,?,?,?,?,?,?)',
                   (item['source'], item['sheet'], item['row'], 'free_event_attendance', aid,
                    json.dumps(item['raw'], ensure_ascii=False), 'attendance' + (' and donation' if item['amount'] else '')))
        audit_count['attendance'] += 1
        if item['amount'] is not None:
            audit_count['donations'] += 1; audit_count['donation_minor'] += item['amount']
    for item in payments:
        sid = student(item['name'])
        choices = []
        for row in rows:
            if row['event'] == item['event'] and row['student_id'] == sid:
                distance = abs((dt.date.fromisoformat(row['day']) - dt.date.fromisoformat(item['day'])).days)
                # One recorded IZFM donation precedes its only attendance by
                # three days; it is still uniquely attributable to that
                # meeting.  Wider gaps remain a review stop.
                if distance <= 3:
                    choices.append((distance, row))
        choices.sort(key=lambda choice: (choice[0], choice[1]['day']))
        assert choices and (len(choices) == 1 or choices[0][0] < choices[1][0]), f'Unmatched or ambiguous donation: {item["sheet"]} row {item["row"]}'
        meeting_id = meetings[item['event'], choices[0][1]['day']]
        attendance_id, existing = db.execute('SELECT id, donation_amount_minor FROM free_event_attendance WHERE meeting_id=? AND student_id=?', (meeting_id, sid)).fetchone()
        assert existing is None, f'Duplicate donation for {item["sheet"]} row {item["row"]}'
        db.execute('UPDATE free_event_attendance SET donation_amount_minor=?, donation_received_method=? WHERE id=?', (item['amount'], item['method'], attendance_id))
        db.execute('UPDATE free_event_meetings SET accepts_donations=1 WHERE id=?', (meeting_id,))
        db.execute('INSERT INTO free_event_history_audit VALUES (?,?,?,?,?,?,?)',
                   (item['source'], item['sheet'], item['row'], 'free_event_attendance', attendance_id,
                    json.dumps(item['raw'], ensure_ascii=False), f'donation matched to {choices[0][1]["day"]}'))
        audit_count['donations'] += 1; audit_count['donation_minor'] += item['amount']
    for code, name in EVENTS.items():
        dates = sorted({row['day'] for row in rows if row['event'] == code})
        db.execute('UPDATE free_events SET starts_on=?, ends_on=?, updated_at=? WHERE id=?', (dates[0], dates[-1], now, event_ids[name]))
    audit_count['meetings'] = len(meetings)
    audit_count['practice_attendance'] = sum(r['event'] == 'PRACTICE' for r in rows)
    audit_count['izfm_attendance'] = sum(r['event'] == 'IZFM' for r in rows)
    assert audit_count['attendance'] == 183 and audit_count['donations'] == 37 and audit_count['donation_minor'] == 159000
    db.execute('INSERT INTO free_event_history_runs VALUES (?,?,?)', (digest, now, json.dumps(dict(audit_count))))
    return dict(audit_count)


def target_path():
    candidates = []
    for path in (ROOT / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'):
        try:
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
                rows = db.execute("SELECT name FROM free_events WHERE name IN ('Practice', 'IZFM') ORDER BY name").fetchall()
                if rows == [('IZFM',), ('Practice',)]: candidates.append(path)
        except sqlite3.OperationalError:
            pass
    assert candidates, 'The local Catalog event database was not found'
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    os.umask(0o077)
    attendance, payments, digest = event_rows(); now = dt.datetime.now(dt.timezone.utc).isoformat()
    live_path = target_path(); review = ROOT / '.wrangler/import-reviews' / ('free-events-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')); review.mkdir(parents=True)
    with sqlite3.connect(live_path) as live:
        with sqlite3.connect(review / 'before.sqlite') as before: live.backup(before)
        with sqlite3.connect(review / 'candidate.sqlite') as candidate: live.backup(candidate)
    with sqlite3.connect(live_path) as live, sqlite3.connect(review / 'candidate.sqlite') as candidate:
        baseline = fingerprint(live); assert fingerprint(candidate) == baseline
        candidate.execute('PRAGMA foreign_keys=ON'); candidate.execute('BEGIN IMMEDIATE')
        summary = import_data(candidate, attendance, payments, digest, now); valid(candidate); candidate.commit(); result = fingerprint(candidate)
        candidate.execute('BEGIN IMMEDIATE'); assert import_data(candidate, attendance, payments, digest, now) == summary; assert fingerprint(candidate) == result; candidate.commit()
        if args.apply:
            live.execute('PRAGMA foreign_keys=ON'); live.execute('BEGIN IMMEDIATE'); assert fingerprint(live) == baseline
            assert import_data(live, attendance, payments, digest, now) == summary; valid(live); assert fingerprint(live) == result; live.commit()
        summary.update(applied=args.apply, integrity='ok', foreign_keys='ok', idempotence='ok', target=str(live_path))
        (review / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(json.dumps(summary, indent=2)); print('Review and backup:', review)


if __name__ == '__main__': main()
