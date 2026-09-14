#!/usr/bin/env python3
"""Deduplicate and import the two 2026 group sheets into local Catalog only.

Only explicit attendance/absence marks establish activity. User-confirmed green
markers grant four classes, except v2 subscriptions marked payment not collected.
Unknown payment amounts are zero; matching existing payments are preserved.
Default validates a backup; --apply replays under a checked write lock.
"""
import argparse
import collections
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('catalog_v2', ROOT/'scripts/import-catalog-v2.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
WORKBOOK = ROOT/'docs/Catalog FSD.xlsx'
NS = helper.NS
SHEETS = {'Gr Marti INT': ('Intermediates', 'Tuesday'), 'Gr Miercuri IMP': ('Improvers', 'Wednesday')}
MONTHS = dict(zip(['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'], range(1, 13)))
# User-confirmed identities; Sandra's existing consolidation is documented locally.
ALIASES = {'natti': 'Miruna Natti', 'danut nu plateste ab': 'Alex CROITORIU',
           'vanguard': 'Andrei Cristian', 'sandra popovici': 'Alexandra (Sandra) Popovici'}
MARKS = {'p': 'attendance', 'pc': 'attendance', 'a': 'absence', 'am': 'absence'}
NOTES = {'vacanta', 'va avea o luna cand revine. a platit un abonament si nu a venit deloc',
         'Anulat cursurile din cauza ploii torentiale.', 'Restaurant Paparazzi', 'Suntem in vacanta', '-'}


def extract():
    records, source = [], {}
    with zipfile.ZipFile(WORKBOOK) as archive:
        strings = [''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        rels = {x.attrib['Id']: x.attrib['Target'] for x in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        fills, formats = list(styles.find('m:fills', NS)), list(styles.find('m:cellXfs', NS))
        for sh in ET.fromstring(archive.read('xl/workbook.xml')).find('m:sheets', NS):
            sheet = sh.attrib['name']
            if sheet not in SHEETS:
                continue
            target = rels[sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            root = ET.fromstring(archive.read(target.lstrip('/') if target.startswith('/') else 'xl/'+target))
            cells = {}
            for cell in root.findall('.//m:sheetData/m:row/m:c', NS):
                value = cell.findtext('m:v', '', NS)
                if cell.attrib.get('t') == 's' and value:
                    value = strings[int(value)]
                elif cell.attrib.get('t') == 'inlineStr':
                    value = ''.join(cell.find('m:is', NS).itertext())
                fill = fills[int(formats[int(cell.attrib.get('s', 0))].attrib['fillId'])].find('m:patternFill/m:fgColor', NS)
                cells[cell.attrib['r']] = {'value': value.strip(), 'fill': dict(fill.attrib) if fill is not None else {}}
            source[sheet] = {'cells': cells, 'merges': [x.attrib['ref'] for x in root.findall('m:mergeCells/m:mergeCell', NS)]}
            def value(ref):
                return cells.get(ref, {}).get('value', '')
            dates, month = {}, None
            row2 = next(r for r in root.findall('m:sheetData/m:row', NS) if r.attrib['r'] == '2')
            for cell in row2:
                col = cell.attrib['r'][:-1]
                if value(col+'1') in MONTHS:
                    month = MONTHS[value(col+'1')]
                if month and value(col+'2').isdigit():
                    day = dt.date(2026, month, int(value(col+'2')))
                    assert day.strftime('%A') == SHEETS[sheet][1], 'Date does not match sheet weekday'
                    dates[col] = day.isoformat()
            for row in root.findall('m:sheetData/m:row', NS):
                rn = int(row.attrib['r'])
                if rn < 3 or not value('A'+str(rn)):
                    continue
                name = value('A'+str(rn))
                for col, day in dates.items():
                    ref = col+str(rn)
                    mark = value(ref)
                    if not mark:
                        continue
                    assert mark.lower() in MARKS or mark in NOTES, f'Unknown mark: {sheet}!{ref}'
                    records.append(dict(sheet=sheet, cell=ref, name=name, date=day, mark=mark, fill=cells[ref]['fill']))
    assert set(source) == set(SHEETS)
    return records, source


def financial_evidence(db, sid, cid, day):
    """Keep exact payment/start-date and subscription matches for manual review."""
    evidence = []
    for pid, paid, amount, payload in db.execute('SELECT p.id,p.paid_on,p.amount_minor,p.request_payload FROM student_payments p JOIN payment_course_allowances a ON a.payment_id=p.id WHERE p.student_id=? AND a.course_id=?', (sid, cid)):
        raw = json.loads(payload or '{}')
        start = helper.date(raw['B']) if isinstance(raw, dict) and raw.get('B') else None
        if paid == day or start == day:
            evidence.append(dict(payment_id=pid, paid_on=paid, amount_minor=amount, subscription_start=start))
    return evidence


def import_data(db, records, source, digest, now):
    db.execute('CREATE TABLE IF NOT EXISTS group_sheet_runs (digest TEXT PRIMARY KEY, imported_at TEXT NOT NULL, summary TEXT NOT NULL)')
    previous = db.execute('SELECT digest,summary FROM group_sheet_runs').fetchall()
    if previous:
        assert len(previous) == 1 and previous[0][0] == digest, 'Source changed after import; review required'
        return json.loads(previous[0][1])
    db.execute('CREATE TABLE group_sheet_audit (sheet TEXT, source_cell TEXT, source_json TEXT NOT NULL, student_id INTEGER REFERENCES students(id), class_id INTEGER REFERENCES classes(id), decision TEXT NOT NULL, attendance_id INTEGER REFERENCES attendance(id), absence_rowid INTEGER, payment_evidence TEXT NOT NULL, payment_decision TEXT NOT NULL, payment_id INTEGER REFERENCES student_payments(id), PRIMARY KEY(sheet,source_cell))')
    names = collections.defaultdict(list)
    for sid, first, last in db.execute('SELECT id,first_name,last_name FROM students'):
        names[helper.norm(first+' '+last)].append(sid)
    courses = dict(db.execute('SELECT name,id FROM courses'))
    counts = collections.Counter()
    seen, classes = {}, {}
    for record in records:
        r = dict(record)
        sid_matches = names[helper.identity(ALIASES.get(helper.norm(r['name']), r['name']))]
        assert len(sid_matches) == 1, f'Unresolved name: {r["name"]}'
        sid, cid = sid_matches[0], courses[SHEETS[r['sheet']][0]]
        audit = dict(sheet=r['sheet'], source_cell=r['cell'], source_json=json.dumps(r, ensure_ascii=False), student_id=sid, class_id=None,
                     decision='source note retained', attendance_id=None, absence_rowid=None, payment_evidence='[]', payment_decision='not a new-payment marker', payment_id=None)
        kind = MARKS.get(r['mark'].lower())
        if not kind:
            counts['notes_retained'] += 1
            helper.insert(db, 'group_sheet_audit', audit)
            continue
        day = r['date']
        if (cid, day) not in classes:
            matches = db.execute('SELECT id,start_time,end_time,cancelled FROM classes WHERE course_id=? AND class_date=?', (cid, day)).fetchall()
            assert len(matches) <= 1, 'Multiple class slots require review'
            if matches:
                cl, start, end, cancelled = matches[0]
                assert not cancelled, 'Source overlaps cancelled class'
            else:
                schedules = db.execute('SELECT start_time,end_time FROM course_schedule WHERE course_id=? AND day_of_week=?', (cid, SHEETS[r['sheet']][1])).fetchall()
                assert len(schedules) == 1, 'Missing unique schedule'
                start, end = schedules[0]
                cl = helper.insert(db, 'classes', dict(course_id=cid, class_date=day, start_time=start, end_time=end))
                counts['classes_created'] += 1
            classes[cid, day] = cl, start
        cl, start = classes[cid, day]
        audit['class_id'] = cl
        existing_payments = financial_evidence(db, sid, cid, day)
        matching_subscriptions = [sub for sub in source['v2_subscriptions']
            if sub.get('A') and sub.get('E')
            and helper.identity(sub['A']) == helper.identity(ALIASES.get(helper.norm(r['name']), r['name']))
            and helper.COURSES.get(sub.get('B')) == SHEETS[r['sheet']][0]
            and helper.date(sub['E']) == day]
        audit['payment_evidence'] = json.dumps(dict(payments=existing_payments, subscriptions=matching_subscriptions), ensure_ascii=False)
        if r['fill'].get('rgb', '')[-6:] in {'00FF00', '93C47D'}:
            assert len(existing_payments) <= 1 and len(matching_subscriptions) <= 1, 'Ambiguous payment match'
            if any(sub.get('I') == 'PLATA NEINCASATA' for sub in matching_subscriptions):
                assert not existing_payments, 'Uncollected subscription contradicts existing payment'
                audit['payment_decision'] = 'skipped: v2 payment not collected'
                counts['uncollected_payments_skipped'] += 1
            elif existing_payments:
                audit['payment_decision'] = 'existing payment matched by paid date or subscription start'
                audit['payment_id'] = existing_payments[0]['payment_id']
                counts['existing_payments'] += 1
            else:
                pid = helper.insert(db, 'student_payments', dict(student_id=sid, paid_on=day, amount_minor=0,
                    notes='Catalog FSD.xlsx; '+r['sheet']+'!'+r['cell']+'; new four-class subscription marker; amount unknown',
                    recorded_by=helper.AUDITOR, recorded_at=now, received_method='',
                    request_key='group-sheet-payment-'+str(sid)+'-'+str(cid)+'-'+day,
                    request_payload=json.dumps(dict(source=r, allowance=4, amount_unknown=True), ensure_ascii=False)))
                helper.insert(db, 'payment_course_allowances', dict(payment_id=pid, course_id=cid, course_name=SHEETS[r['sheet']][0], allowance=4))
                audit['payment_id'] = pid
                audit['payment_decision'] = 'imported four-class payment; amount unknown'
                counts['payments_imported'] += 1
        key = sid, cid, day
        attended = db.execute('SELECT id,class_id FROM attendance WHERE student_id=? AND course_id=? AND substr(attended_at,1,10)=?', key).fetchall()
        absent = db.execute('SELECT rowid,class_id,start_time FROM history_absences WHERE CAST(student_id AS INTEGER)=? AND CAST(course_id AS INTEGER)=? AND class_date=?', key).fetchall()
        assert len(attended) <= 1 and len(absent) <= 1, 'Existing duplicate activity requires review'
        assert not (attended and absent), 'Existing activity contradicts itself'
        assert not ((kind == 'attendance' and absent) or (kind == 'absence' and attended)), 'Attendance/absence conflict'
        if key in seen:
            assert seen[key] == kind, 'Conflicting workbook marks'
            audit['decision'] = 'duplicate workbook '+kind
            counts['duplicate_source_'+kind] += 1
        elif attended or absent:
            audit['decision'] = 'existing '+kind
            counts['existing_'+kind] += 1
        else:
            ref = r['sheet']+'!'+r['cell']
            if kind == 'attendance':
                # Explicit instructor exemption; all other colors remain source evidence.
                free = helper.norm(r['name']) == 'danut nu plateste ab'
                aid = helper.insert(db, 'attendance', dict(student_id=sid, course_id=cid, course_name=SHEETS[r['sheet']][0],
                    attended_at=day+'T'+start+':00', recorded_by=helper.AUDITOR, recorded_at=now,
                    notes='Catalog FSD.xlsx; '+ref, request_key='group-sheet-'+str(sid)+'-'+str(cid)+'-'+day,
                    request_payload=json.dumps(r, ensure_ascii=False), class_id=cl, complimentary=int(free),
                    complimentary_by=helper.AUDITOR if free else None, complimentary_at=now if free else None))
                attended = [(aid, cl)]
                counts['complimentary_attendance'] += int(free)
            else:
                student_name = db.execute("SELECT first_name||' '||last_name FROM students WHERE id=?", (sid,)).fetchone()[0]
                aid = helper.insert(db, 'history_absences', dict(student_id=str(sid), student_name=student_name, course_id=str(cid), course_name=SHEETS[r['sheet']][0],
                    class_id=str(cl), class_date=day, start_time=start, mark=r['mark'], source_cells=ref, review_status='Validated explicit group-sheet absence'))
                absent = [(aid, str(cl), start)]
            audit['decision'] = 'imported '+kind
            counts['imported_'+kind] += 1
        if attended:
            assert attended[0][1] in (None, cl), 'Existing attendance uses another class'
            audit['attendance_id'] = attended[0][0]
        if absent:
            assert absent[0][2] == start, 'Existing absence has another time'
            audit['absence_rowid'] = absent[0][0]
        seen[key] = kind
        helper.insert(db, 'group_sheet_audit', audit)
    counts['source_cells'] = len(records)
    counts['payment_rows_added'] = counts['payments_imported']
    assert counts['imported_attendance'] == 159 and counts['imported_absence'] == 68
    assert counts['existing_attendance'] == 27 and counts['duplicate_source_absence'] == 1
    assert counts['payments_imported'] == 41 and counts['existing_payments'] == 9 and counts['uncollected_payments_skipped'] == 3
    assert db.execute('SELECT count(*) FROM group_sheet_audit').fetchone()[0] == len(records)
    helper.insert(db, 'group_sheet_runs', dict(digest=digest, imported_at=now, summary=json.dumps(dict(counts))))
    return dict(counts)


def validate_import(db):
    helper.validate(db)
    assert db.execute("SELECT count(*) FROM group_sheet_audit WHERE decision IN ('imported attendance','existing attendance')").fetchone()[0] == 186
    assert db.execute("SELECT count(DISTINCT absence_rowid) FROM group_sheet_audit WHERE absence_rowid IS NOT NULL").fetchone()[0] == 68
    assert not db.execute("SELECT 1 FROM group_sheet_audit g LEFT JOIN attendance a ON a.id=g.attendance_id WHERE g.attendance_id IS NOT NULL AND (a.id IS NULL OR a.student_id!=g.student_id OR a.class_id!=g.class_id)").fetchall()
    assert not db.execute("SELECT 1 FROM group_sheet_audit g LEFT JOIN history_absences a ON a.rowid=g.absence_rowid WHERE g.absence_rowid IS NOT NULL AND (a.rowid IS NULL OR CAST(a.student_id AS INTEGER)!=g.student_id OR CAST(a.class_id AS INTEGER)!=g.class_id)").fetchall()
    assert db.execute("SELECT count(*),sum(p.amount_minor),sum(a.allowance) FROM student_payments p JOIN payment_course_allowances a ON a.payment_id=p.id WHERE p.request_key LIKE 'group-sheet-payment-%'").fetchone() == (41, 0, 164)
    assert db.execute("SELECT count(*) FROM group_sheet_audit WHERE payment_decision='skipped: v2 payment not collected' AND payment_id IS NULL").fetchone()[0] == 3


def preservation(before, after):
    """Every existing row must survive unchanged; only authorized additions allowed."""
    additions = {'attendance', 'history_absences', 'classes', 'student_payments', 'payment_course_allowances'}
    for (name,) in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        old = collections.Counter(before.execute('SELECT * FROM "'+name+'"').fetchall())
        new = collections.Counter(after.execute('SELECT * FROM "'+name+'"').fetchall())
        assert not old-new, 'Existing rows changed: '+name
        if name not in additions:
            assert old == new, 'Unrelated rows added: '+name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    binding = next(b for b in json.loads((ROOT/'wrangler.local.json').read_text())['d1_databases'] if b['binding']=='CATALOG_DB')
    assert binding['remote'] is False and binding['database_id']=='00000000-0000-0000-0000-000000000002'
    paths = []
    for path in (ROOT/'.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'):
        with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='_fsd_catalog_import'").fetchone():
                paths.append(path)
    assert len(paths)==1, 'Expected exactly one local Catalog'
    records, source = extract()
    source['v2_subscriptions'] = helper.read_workbook()['(IO) Abonamente']
    digest = hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    review = ROOT/'.wrangler/import-reviews'/('group-sheets-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    review.mkdir(parents=True)
    (review/'source.json').write_text(json.dumps(source, ensure_ascii=False, indent=2))
    with sqlite3.connect(paths[0]) as live, sqlite3.connect(review/'before.sqlite') as before, sqlite3.connect(review/'candidate.sqlite') as candidate:
        live.backup(before)
        baseline = helper.fingerprint(before)
        before.backup(candidate)
        candidate.execute('PRAGMA foreign_keys=ON')
        candidate.execute('BEGIN IMMEDIATE')
        summary = import_data(candidate, records, source, digest, now)
        validate_import(candidate)
        preservation(before, candidate)
        candidate.commit()
        result = helper.fingerprint(candidate)
        candidate.execute('BEGIN IMMEDIATE')
        assert import_data(candidate, records, source, digest, now)==summary
        assert helper.fingerprint(candidate)==result, 'Rerun changed data'
        candidate.commit()
        # Guard against silently accepting edited source on later runs.
        try:
            import_data(candidate, records, source, 'changed-source', now)
        except AssertionError as error:
            assert str(error)=='Source changed after import; review required'
        else:
            raise AssertionError('Changed source accepted')
        if args.apply:
            live.execute('PRAGMA foreign_keys=ON')
            live.execute('BEGIN IMMEDIATE')
            assert helper.fingerprint(live)==baseline, 'Catalog changed during validation'
            assert import_data(live, records, source, digest, now)==summary
            validate_import(live)
            preservation(before, live)
            assert helper.fingerprint(live)==result, 'Applied result differs from validated candidate'
            live.commit()
        summary.update(applied=args.apply, integrity='ok', foreign_keys='ok', idempotence='ok', preservation='ok')
        (review/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
        print(json.dumps(summary, indent=2))
        print('Backup and audit:', review)

if __name__=='__main__':
    main()
