# Catalog database in development

Run `npm run dev`, open the development site as the owner, and choose **Catalog** under **Development database** in the sidebar. Switching reloads the current page. Local, Catalog and Production use separate database and image bindings.

The historical editing workflow reads `docs/Catalog FSD.xlsx` and updates `docs/free-spirit-dance-import.sqlite` directly. Intermediate review and import workbooks have been removed. Back up the SQLite database before applying corrections, retain source-cell references, and validate changes transactionally.

The sidebar's Catalog option is a separate local working copy of that SQLite file. Startup prepares it once using `npm run db:catalog:prepare`. Later startups keep your changes; editing the SQLite file in `docs` does not automatically refresh that working copy. Likewise, app edits do not update the file in `docs`.

After a historical student has passed source validation, reconcile only that student's historical rows with `npm run historical:sync -- --student "Full Name" --apply`. The command first snapshots both databases, validates a candidate Catalog copy (including foreign keys, source row counts, and an idempotent rerun), then applies only rows with historical request keys to the dedicated local Catalog binding. Without `--apply`, it is a no-write validation. It never replaces profiles, images, or non-historical administrator activity; it stops on a conflict and leaves both databases unchanged.

For checklist-order batch work, run `npm run historical:batch -- --apply`. It processes only unchecked entries and stops at the first data, identity, or local-Catalog conflict. It can safely regenerate audit-only source-cell rows when no historical activity exists, or preserve already-imported history only when its in-window workbook facts exactly match. A student is checked only after the local Catalog sync succeeds. Same-surname profiles remain a deliberate review stop.

The preparation command uses only the `CATALOG_DB` binding with `--local`. It preserves the prepared schema, including zero-value historical payments and the supplementary history tables. It does not overwrite Production, and refuses to overwrite an incomplete or unrecognized Catalog database.

The Administrators page has a local database manager beside **Upload current database to production**. **Copy production locally** saves a new independent copy of application records and referenced images. Eight local copy slots are available in addition to Catalog. Rename saved copies in the table and select them in the sidebar dropdown; selecting a database reloads the page. Names and copies persist across development restarts. Startup applies regular migrations to these eight local databases with `npm run db:working:prepare`; it does not apply them to Catalog.

Uploading requires the existing `REPLACE PRODUCTION` confirmation and replaces production application tables and referenced images from the selected local database. It keeps the local selection. Changes made in production after copying are overwritten, not merged. Supplemental historical audit tables and internal migration/registry tables are not part of application-table transfers. Missing source images are reported. The local-only image bucket retains a JSON backup of records before each local replacement under `database-backups/`.

Only the owner can switch databases during development. Other administrators accessing the development tunnel continue to use Production, as before. The selector is unavailable in a production build.

The historical snapshot does not automatically receive the regular Local database migrations. Review future schema changes before applying them to this working copy, particularly the zero-value payment constraint. Final payment allowances and the app's historical coverage limitations remain as described in `free-spirit-dance-import-notes.md`.

Database files and workbooks remain outside Git. The prepared SQLite file contains image references, not image contents; Catalog has its own local image bucket.
