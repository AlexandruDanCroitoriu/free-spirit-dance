#!/usr/bin/env python3
"""Import Practica 2026 into the dedicated local Catalog; validate before --apply."""
import argparse
import collections
import datetime as dt
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('catalog_v2', ROOT/'scripts/import-catalog-v2.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
WORKBOOK = ROOT/'docs/Catalog FSD.xlsx'
SHEET = 'Practica 2026'
# User-confirmed nicknames; other aliases resolve existing full-name profiles.
ALIASES = {
    'cosmin': 'Cosmin Popescu', 'vanguard': 'Andrei Cristian',
    'victor tipul nou': 'Victor Rusu', 'armin': 'Armin SHIR MOHAMMADI',
    'dan': 'Dan Costache', 'malina': 'Mălina CROITORIU',
    'sandra popovici': 'Alexandra (Sandra) Popovici',
}


def money(raw):
    value = Decimal(raw)*100
    assert value == value.to_integral_value() and value > 0
    return int(value)


def apply(db, rows, digest, now):
    db.execute('CREATE TABLE IF NOT EXISTS practica_2026_runs (digest TEXT PRIMARY KEY, imported_at TEXT NOT NULL, summary TEXT NOT NULL)')
    previous = db.execute('SELECT digest,summary FROM practica_2026_runs').fetchall()
    if previous:
        assert len(previous)==1 and previous[0][0]==digest, 'Source changed; review required'
        return json.loads(previous[0][1])
    db.execute('CREATE TABLE practica_2026_audit (source_row INTEGER, section TEXT, source_json TEXT NOT NULL, target_id INTEGER NOT NULL, PRIMARY KEY(source_row,section))')
    names = collections.defaultdict(list)
    for sid,first,last in db.execute('SELECT id,first_name,last_name FROM students'):
        names[helper.norm(first+' '+last)].append(sid)
    parties, seen = {}, set()
    counts = collections.Counter()
    for r in rows:
        if not r.get('A'):
            continue
        assert r.get('B') and r.get('C'), 'Incomplete attendance row'
        name = ALIASES.get(helper.norm(r['A']), r['A'])
        matches = names[helper.identity(name)]
        assert len(matches)==1, f'Unresolved student {r["A"]}'
        sid = matches[0]
        day = helper.date(r['B'])
        if day not in parties:
            assert not db.execute('SELECT 1 FROM practice_parties WHERE substr(starts_at,1,10)=?',(day,)).fetchone(), 'Existing practice overlap'
            start = dt.datetime.fromisoformat(day+'T16:00').replace(tzinfo=ZoneInfo('Europe/Bucharest'))
            parties[day] = helper.insert(db,'practice_parties',dict(
                starts_at=day+'T16:00', starts_utc=start.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),
                duration_minutes=120, location=r['C'], recorded_by=helper.AUDITOR,
                recorded_at=now, request_key='practica-2026-'+day))
        party = parties[day]
        assert db.execute('SELECT location FROM practice_parties WHERE id=?',(party,)).fetchone()[0]==r['C']
        assert (sid,party) not in seen, 'Duplicate source attendance'
        seen.add((sid,party))
        values = dict(student_id=sid,practice_id=party,recorded_by=helper.AUDITOR,recorded_at=now,
                      notes=f'Catalog FSD.xlsx; {SHEET}!A{r["row"]}:D{r["row"]}')
        if r.get('D'):
            amount = money(r['D'])
            values.update(donation_amount_minor=amount,donation_paid_on=day,
                          donation_notes=f'{SHEET}!D{r["row"]}; date from practice attendance',
                          donation_recorded_by=helper.AUDITOR,donation_recorded_at=now)
            counts['donations'] += 1
            counts['donation_minor'] += amount
        aid = helper.insert(db,'practice_attendance',values)
        helper.insert(db,'practica_2026_audit',dict(source_row=int(r['row']),section='attendance',source_json=json.dumps({k:r.get(k,'') for k in ['A','B','C','D']},ensure_ascii=False),target_id=aid))
        counts['attendances'] += 1
    for r in rows:
        if not any(r.get(k) for k in ['H','I','J']):
            continue
        assert all(r.get(k) for k in ['H','I','J']), 'Incomplete venue payment'
        day = helper.date(r['H'])
        assert day in parties
        party = parties[day]
        assert db.execute('SELECT location,rent_cost_minor FROM practice_parties WHERE id=?',(party,)).fetchone()==(r['I'],0)
        amount = money(r['J'])
        db.execute('UPDATE practice_parties SET rent_cost_minor=?,rent_paid=1 WHERE id=?',(amount,party))
        helper.insert(db,'practica_2026_audit',dict(source_row=int(r['row']),section='venue_payment',source_json=json.dumps({k:r[k] for k in ['H','I','J']},ensure_ascii=False),target_id=party))
        counts['venue_payments'] += 1
        counts['venue_payment_minor'] += amount
    counts['practices'] = len(parties)
    assert counts['attendances']==73 and counts['donation_minor']==80500 and counts['venue_payment_minor']==18000
    assert db.execute('SELECT count(*) FROM practica_2026_audit WHERE section="attendance"').fetchone()[0]==counts['attendances']
    helper.insert(db,'practica_2026_runs',dict(digest=digest,imported_at=now,summary=json.dumps(dict(counts))))
    return dict(counts)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    os.umask(0o077)
    config=json.loads((ROOT/'wrangler.local.json').read_text())
    binding=next(b for b in config['d1_databases'] if b['binding']=='CATALOG_DB')
    assert binding['remote'] is False and binding['database_id']=='00000000-0000-0000-0000-000000000002'
    paths=[]
    for p in (ROOT/'.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'):
        with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='_fsd_catalog_import'").fetchone(): paths.append(p)
    assert len(paths)==1
    helper.WORKBOOK=WORKBOOK
    rows=helper.read_workbook()[SHEET]
    digest=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    review=ROOT/'.wrangler/import-reviews'/('practica-2026-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    review.mkdir(parents=True)
    with sqlite3.connect(paths[0]) as live:
        with sqlite3.connect(review/'before.sqlite') as before:
            live.backup(before)
            baseline=helper.fingerprint(before)
        with sqlite3.connect(review/'candidate.sqlite') as candidate:
            live.backup(candidate)
            assert helper.fingerprint(candidate)==baseline
            candidate.execute('PRAGMA foreign_keys=ON')
            candidate.execute('BEGIN IMMEDIATE')
            summary=apply(candidate,rows,digest,now)
            helper.validate(candidate)
            candidate.commit()
            result=helper.fingerprint(candidate)
            candidate.execute('BEGIN IMMEDIATE')
            assert apply(candidate,rows,digest,now)==summary
            assert helper.fingerprint(candidate)==result, 'Rerun changed data'
            candidate.commit()
        if args.apply:
            live.execute('PRAGMA foreign_keys=ON')
            live.execute('BEGIN IMMEDIATE')
            assert helper.fingerprint(live)==baseline, 'Catalog changed during validation'
            assert apply(live,rows,digest,now)==summary
            helper.validate(live)
            assert helper.fingerprint(live)==result
            live.commit()
        summary.update(applied=args.apply,integrity='ok',foreign_keys='ok',idempotence='ok')
        (review/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps(summary,indent=2))
        print('Backup and validation:',review)

if __name__=='__main__':
    main()
