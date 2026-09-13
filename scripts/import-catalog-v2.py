#!/usr/bin/env python3
"""Import the confirmed v2 rules into the dedicated local Catalog only.

Default: validate a fresh SQLite backup. --apply: replay the validated transaction
under a write lock, checking that the live database still matches the backup.
Private workbook rows and decisions are retained in the local audit table.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / 'docs/Catalog FSD v2.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
ALIASES = dict(zip(
    ['alexandrina nicolescu', 'alexandru croitoriu', 'andrea bota', 'andreea maria ioan', 'ciprian andrei alexa', 'valentin ioan vintila', 'victor gabriel cherescu'],
    ['alexandrina niculescu', 'alex croitoriu', 'andreea bota', 'andreea ioan', 'ciprian alexa andrei', 'valentin vintila', 'victor cherescu']))
COURSES = {'INCEPATORI': 'Beginners', 'INTERMEDIARI': 'Intermediates', 'INTERMEDIATE': 'Intermediates', 'IMPROVERS': 'Improvers'}
AUDITOR = 'historical-import@free-spirit-dance.invalid'


def norm(value):
    value = re.sub(r'\([^)]*\)', '', value)
    return re.sub('[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()).strip()


def identity(value):
    return ALIASES.get(norm(value), norm(value))


def date(value):
    return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(value))).date().isoformat()


def read_workbook():
    result = {}
    with zipfile.ZipFile(WORKBOOK) as archive:
        strings = [''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        rels = {x.attrib['Id']: x.attrib['Target'] for x in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(archive.read('xl/workbook.xml')).find('m:sheets', NS):
            target = rels[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(archive.read(target)).findall('.//m:sheetData/m:row', NS):
                if int(row.attrib['r']) == 1:
                    continue
                values = {'row': row.attrib['r']}
                for cell in row.findall('m:c', NS):
                    raw = cell.findtext('m:v', '', NS)
                    if cell.attrib.get('t') == 's' and raw:
                        raw = strings[int(raw)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        raw = ''.join(cell.find('m:is', NS).itertext())
                    values[re.match('[A-Z]+', cell.attrib['r'])[0]] = raw.strip()
                rows.append(values)
            result[sheet.attrib['name']] = rows
    return result


def fingerprint(db):
    return hashlib.sha256('\n'.join(db.iterdump()).encode()).hexdigest()


def validate(db):
    assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    assert not db.execute('PRAGMA foreign_key_check').fetchall()


def insert(db, table, values):
    keys = ','.join(values)
    return db.execute(f'INSERT INTO {table} ({keys}) VALUES ({",".join("?" for _ in values)})', tuple(values.values())).lastrowid


def import_data(db, sheets, digest, now):
    db.execute('CREATE TABLE IF NOT EXISTS catalog_v2_runs (digest TEXT PRIMARY KEY, imported_at TEXT NOT NULL, summary TEXT NOT NULL)')
    previous = db.execute('SELECT digest,summary FROM catalog_v2_runs').fetchall()
    if previous:
        assert len(previous) == 1 and previous[0][0] == digest, 'Workbook changed after import; review required'
        return json.loads(previous[0][1])
    db.execute('CREATE TABLE catalog_v2_audit (sheet TEXT, source_row INTEGER, source_json TEXT, decision TEXT, PRIMARY KEY(sheet,source_row))')
    def audit(sheet, row, decision):
        insert(db, 'catalog_v2_audit', dict(sheet=sheet, source_row=int(row['row']), source_json=json.dumps(row, ensure_ascii=False), decision=decision))
    for table, column, declaration in [('classes', 'location', "TEXT NOT NULL DEFAULT ''"), ('practice_parties', 'location', "TEXT NOT NULL DEFAULT ''"), ('practice_parties', 'rent_cost_minor', 'INTEGER NOT NULL DEFAULT 0 CHECK(rent_cost_minor>=0)'), ('practice_parties', 'rent_paid', 'INTEGER NOT NULL DEFAULT 0 CHECK(rent_paid IN (0,1))')]:
        if column not in {r[1] for r in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
    students = collections.defaultdict(list)
    for sid, first, last in db.execute('SELECT id,first_name,last_name FROM students'):
        students[norm(first + ' ' + last)].append(sid)
    def student(name):
        matches = students[identity(name)]
        assert len(matches) == 1, f'Ambiguous or missing student: {name}'
        return matches[0]
    members = [r for r in sheets['(G) Membri'] if r.get('A') and r.get('B')]
    groups = {}
    for r in members:
        sid = student(r['A'] + ' ' + r['B'])
        groups[sid] = r.get('E', '')
        audit('(G) Membri', r, f'existing student {sid}')
    courses = dict(db.execute('SELECT name,id FROM courses'))
    if 'Improvers' not in courses:
        courses['Improvers'] = insert(db, 'courses', dict(name='Improvers', start_date='2026-05-06'))
    attendance = [r for r in sheets['(I) Prezente'] if r.get('A') and r.get('B') and r.get('C')]
    payments = [r for r in sheets['(I) Incasari'] if r.get('A') and r.get('C') and r.get('D')]
    subscriptions = collections.defaultdict(set)
    for r in sheets['(IO) Abonamente']:
        if r.get('A') and r.get('E'):
            subscriptions[student(r['A']), date(r['E'])].add(r.get('B', ''))
            audit('(IO) Abonamente', r, 'course matching evidence; financial rows supply credits')
    counts = collections.Counter()
    slots, parties, seen = {}, {}, {}
    for r in attendance:
        raw, day = r['C'], date(r['A'])
        if raw == 'IZFM':
            audit('(I) Prezente', r, 'skipped IZFM')
            counts['skipped_izfm_attendance'] += 1
            continue
        sid = student(r['B'])
        if raw in COURSES:
            cid = courses[COURSES[raw]]
            if (cid, day) not in slots:
                matches = db.execute('SELECT id,start_time,cancelled FROM classes WHERE course_id=? AND class_date=?', (cid, day)).fetchall()
                assert len(matches) <= 1, f'Multiple class slots: {day} {raw}'
                if matches:
                    cl, start, cancelled = matches[0]
                    if cancelled:
                        db.execute('UPDATE classes SET cancelled=0,cancelled_by=NULL,cancelled_at=NULL WHERE id=?', (cl,))
                        counts['reactivated_classes'] += 1
                else:
                    start = '20:00'
                    cl = insert(db, 'classes', dict(course_id=cid, class_date=day, start_time=start, end_time='21:20'))
                    counts['created_classes'] += 1
                slots[cid, day] = cl, start
            cl, start = slots[cid, day]
            key = sid, cid, day
            if key in seen:
                assert seen[key] == r.get('D', ''), 'Conflicting duplicate attendance notes'
                counts['duplicate_attendance'] += 1
                audit('(I) Prezente', r, 'exact duplicate attendance')
                continue
            seen[key] = r.get('D', '')
            assert not db.execute('SELECT 1 FROM attendance WHERE student_id=? AND course_id=? AND substr(attended_at,1,10)=?', key).fetchone(), 'Existing attendance overlap'
            insert(db, 'attendance', dict(student_id=sid, course_id=cid, course_name=COURSES[raw], attended_at=day+'T'+start+':00', recorded_by=AUDITOR, recorded_at=now, notes=r.get('D', '') + f"; Catalog v2 (I) Prezente row {r['row']}", request_key='catalog-v2-attendance-'+r['row'], request_payload=json.dumps(r), class_id=cl))
            counts['course_attendance'] += 1
        elif raw == 'PRACTICE':
            if day not in parties:
                assert not db.execute('SELECT 1 FROM practice_parties WHERE substr(starts_at,1,10)=?', (day,)).fetchone(), 'Existing practice overlap'
                parties[day] = insert(db, 'practice_parties', dict(starts_at=day+'T16:00', starts_utc=day+'T13:00:00.000Z', duration_minutes=120, recorded_by=AUDITOR, recorded_at=now, request_key='catalog-v2-practice-'+day))
            insert(db, 'practice_attendance', dict(student_id=sid, practice_id=parties[day], recorded_by=AUDITOR, recorded_at=now, notes=r.get('D', '') + f"; Catalog v2 (I) Prezente row {r['row']}"))
            counts['practice_attendance'] += 1
        else:
            raise ValueError(f'Unknown course {raw}')
        audit('(I) Prezente', r, 'imported attendance')
    for r in payments:
        typ = r.get('E', '')
        if typ in ('IZFM', 'EVENIMENT'):
            audit('(I) Incasari', r, 'skipped '+typ)
            counts['skipped_payments'] += 1
            continue
        sid, paid, amount = student(r['C']), date(r['A']), round(float(r['D'])*100)
        assert amount > 0
        notes = f"Catalog v2 (I) Incasari row {r['row']}; collector: {r.get('G', '')}; subscription starts: {date(r['B']) if r.get('B') else 'unspecified'}; {r.get('H', '')}"
        if typ in ('ABONAMENT', 'SEDINTA'):
            choices = subscriptions.get((sid, date(r['B'])), set()) if r.get('B') else set()
            assert len(choices) <= 1, 'Ambiguous payment course'
            group = next(iter(choices)) if choices else groups[sid]
            cid = courses[COURSES[group]]
            pid = insert(db, 'student_payments', dict(student_id=sid, paid_on=paid, amount_minor=amount, notes=notes, recorded_by=AUDITOR, recorded_at=now, request_key='catalog-v2-payment-'+r['row'], request_payload=json.dumps(r), received_method=r.get('F', '')))
            insert(db, 'payment_course_allowances', dict(payment_id=pid, course_id=cid, course_name=COURSES[group], allowance=4 if typ=='ABONAMENT' else 1))
            counts['course_payments'] += 1
            counts['course_payment_minor'] += amount
            decision = 'payment; course from '+('subscription' if choices else 'member group')
        elif typ == 'PRACTICE':
            candidates = [(abs((dt.date.fromisoformat(day)-dt.date.fromisoformat(paid)).days), party) for day, party in parties.items() if db.execute('SELECT 1 FROM practice_attendance WHERE student_id=? AND practice_id=?', (sid, party)).fetchone()]
            candidates.sort()
            assert candidates and candidates[0][0] <= 2, f'Unmatched donation row {r["row"]}'
            party = candidates[0][1]
            assert db.execute('SELECT donation_amount_minor FROM practice_attendance WHERE student_id=? AND practice_id=?', (sid, party)).fetchone()[0] is None, 'Duplicate donation'
            db.execute('UPDATE practice_attendance SET donation_amount_minor=?,donation_paid_on=?,donation_notes=?,donation_recorded_by=?,donation_recorded_at=?,donation_received_method=? WHERE student_id=? AND practice_id=?', (amount, paid, notes, AUDITOR, now, r.get('F', ''), sid, party))
            counts['practice_donations'] += 1
            counts['donation_minor'] += amount
            decision = f'donation for practice {party}; nearest attended party within two days'
        else:
            raise ValueError(f'Unknown payment type {typ}')
        audit('(I) Incasari', r, decision)
    for r in sheets['(I) Cheltuieli']:
        if not r.get('A') or not r.get('B'):
            continue
        day, venue = date(r['A']), r['B']
        targets = []
        if day in parties:
            targets = [('practice_parties', parties[day], round(float(r['F'])*100))]
        elif r.get('E') == 'h / luna':
            targets = [('classes', cl, round(float(r['C'])*100)) for (cid, class_day), (cl, _) in slots.items() if class_day[:7] == day[:7]]
        else:
            targets = [('classes', cl, round(float(r['F'])*100)) for (cid, class_day), (cl, _) in slots.items() if class_day == day]
        for table, target, cost in targets:
            db.execute(f'UPDATE {table} SET location=?,rent_cost_minor=? WHERE id=?', (venue, cost, target))
        audit('(I) Cheltuieli', r, json.dumps(targets) if targets else 'skipped: no imported session')
        counts['rent_assignments'] += len(targets)
    counts['practice_parties'] = len(parties)
    insert(db, 'catalog_v2_runs', dict(digest=digest, imported_at=now, summary=json.dumps(dict(counts))))
    return dict(counts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads((ROOT/'wrangler.local.json').read_text())
    binding = next(x for x in config['d1_databases'] if x['binding']=='CATALOG_DB')
    assert binding['remote'] is False and binding['database_id']=='00000000-0000-0000-0000-000000000002'
    paths = []
    for path in (ROOT/'.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'):
        with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='_fsd_catalog_import'").fetchone():
                paths.append(path)
    assert len(paths)==1, 'Expected exactly one local Catalog'
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    review = ROOT/'.wrangler/import-reviews'/('catalog-v2-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    review.mkdir(parents=True)
    sheets, digest = read_workbook(), hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
    with sqlite3.connect(paths[0]) as live:
        with sqlite3.connect(review/'before.sqlite') as before:
            live.backup(before)
            baseline = fingerprint(before)
        with sqlite3.connect(review/'candidate.sqlite') as candidate:
            live.backup(candidate)
            assert fingerprint(candidate)==baseline
            candidate.execute('PRAGMA foreign_keys=ON')
            candidate.execute('BEGIN IMMEDIATE')
            summary = import_data(candidate, sheets, digest, now)
            validate(candidate)
            candidate.commit()
            result = fingerprint(candidate)
            candidate.execute('BEGIN IMMEDIATE')
            assert import_data(candidate, sheets, digest, now)==summary
            assert fingerprint(candidate)==result, 'Repeat import changed data'
            candidate.commit()
        if args.apply:
            live.execute('PRAGMA foreign_keys=ON')
            live.execute('BEGIN IMMEDIATE')
            assert fingerprint(live)==baseline, 'Live Catalog changed during validation; rerun'
            assert import_data(live, sheets, digest, now)==summary
            validate(live)
            assert fingerprint(live)==result, 'Applied result differs from validated candidate'
            live.commit()
        summary.update(applied=args.apply, integrity='ok', foreign_keys='ok', idempotence='ok')
        (review/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
        print(json.dumps(summary, indent=2))
        print('Review and backup:', review)


if __name__ == '__main__':
    main()
