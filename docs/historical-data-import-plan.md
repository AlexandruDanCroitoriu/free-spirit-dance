# Historical data import plan

Import an edited XLSX workbook into local D1 (SQLite), validate it in the app, then transfer the verified data to production D1.

1. **Prepare the workbook.** Confirm course start dates and schedule-change dates. Beginners currently meets Thursday 20:00–21:20; Intermediates Tuesday 20:00–21:20. Previously, both met Tuesday and Thursday: Beginners 19:00–20:00 and Intermediates 20:00–21:00.
2. **Build a local import script.** Support standard Excel files, validate fields and references before writing, map workbook IDs, and import transactionally. Avoid the browser importer's format restrictions and 1,000-row limit.
3. **Import in dependency order.** Courses and schedules → held/cancelled classes → students and course assignments → payments and course allowances → attendance. Include payment methods, receiving administrators, school handover status, complimentary attendance, and rent records where available. Include practice parties/donations and opening credits if needed.
4. **Validate locally.** Ensure current schedules do not generate incorrect historical calendar entries. Check duplicates, cancelled classes, row counts, payment totals, student balances, and sample profiles. Run `npm run build` for any application changes.
5. **Prepare production transfer.** Decide replacement versus merge based on existing production data. Generate SQL compatible with production migrations, preserving relationships and administrator settings; map conflicting IDs for a merge. Handle required historical administrator references and transfer images separately to R2.
6. **Load and verify production.** Back up production data and affected images, prepare a rollback procedure, and obtain approval for the concrete transfer before execution. Prevent concurrent edits during transfer, then compare counts, totals, balances, and representative profiles with local results.

Keep workbooks, database dumps, and student images outside Git. An XLSX export contains image references, not image backups.
