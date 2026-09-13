# Historical local SQLite import

`free-spirit-dance-import.sqlite` is the historical database to edit directly from `Catalog FSD.xlsx`. The intermediate review and import workbooks were removed at the user’s request. The original export is retained. The sidebar Catalog database is a separate working copy; direct file changes require explicit synchronization.

- 138 existing students, 498 classes (73 earlier Intermediates classes added), 2,130 presences, 372 custom payments at zero, 606 resolved positive course allowances, and 147 student-course associations.
- Intermediates now starts January 9, 2024 in the prepared files.
- The user-confirmed September 2025 corrections map both courses to September 2 and 23.
- All 730 explicit absences are preserved in `history_absences`. The app has no explicit absence table; only presences belong in `attendance`.
- Final payments have no invented allowance or end date. Their coverage remains unresolved in `history_payment_periods`. Both courses are represented there; positive resolved counts are in `payment_course_allowances`.
- Source cells, deduplication details and outstanding interpretation notes are retained in `history_*` sheets/tables. A practice-party text annotation was not converted into attendance.
- Audit attribution uses a clearly synthetic historical-import actor, not an assumed real collector. Preparation timestamps do not represent the time the original payment was recorded. Unknown payment methods remain empty. Missing audit profiles referenced by the original export were supplied without adding permissions.

The standalone SQLite schema allows zero-value student payments. The application’s current migrations still reject them, and the browser importer still rejects more than 1,000 data rows. Use the prepared SQLite database for local inspection; importing into an existing app database needs that schema change and a transactional local importer. Do not replace a running Cloudflare D1 SQLite file directly. The browser importer also does not update existing course rows.

Catalog activity now uses actual attendance and explicit historical absences instead of generating scheduled absences during blank periods. Missed-class logs require paid credit coverage in all stores. Payment allocation can still backdate credits to earlier unpaid attendance; final unresolved payments do not receive invented allowances.

Validation: all migrations applied to a new SQLite database with only the zero-payment minimum relaxed; all rows inserted without ignoring failures; integrity check, foreign-key check, totals and attendance uniqueness passed. Original student profile sheet and unrelated export sheets are byte-for-byte preserved.
