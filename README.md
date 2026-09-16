# Free Spirit Dance

An admin-only student management app for a Brazilian Zouk school, built with Vinext, React, TypeScript, and Cloudflare Workers. Student records live in D1; profile images live in private R2 storage and are compressed in the browser before upload.

## Development

Use Node.js 24 (`nvm use`), npm, Python 3 for schema tests, and an authenticated `cloudflared` installation.

```sh
npm ci
npm run dev
```

`npm run dev` starts Vinext on port 3000 and the named tunnel `free-spirit-dance-local`. Open https://dev-free-spirit-dance.alexandru-croitoriu.dev and authenticate through Cloudflare Access with Google.

For the main administrator, local development uses the persistent imported **Catalog SQLite and image storage** under `.wrangler/state`. The dedicated Catalog database is versioned at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/3dd27f64a8e6b7092b4dc42ea2a5f93d01d65d27a0f4927b2e4bc344a6a2f6f6.sqlite`, so a clone contains the Catalog without a separate restore step. Its filename is deterministic for the fixed local `CATALOG_DB` binding; all other Wrangler state remains ignored. `npm run dev` prepares the Catalog copy only when it is missing.

When signed in through the development tunnel as `croitoriu.alexandru.code@gmail.com`, the sidebar shows **Catalog / Production**. Catalog changes stay on this computer; Production uses the live D1 database and R2 images, including for writes. The selection is saved in a session cookie for that browser; switching reloads the dashboard and other open tabs. Finish or discard edits before switching. Plain localhost (including 127.0.0.1 and ::1) acts as the main administrator during local development, including the storage switch and administrator attribution. Other administrators using the tunnel use production permissions, records, and images, including for writes; they cannot switch storage. The deployed app always uses production and has no switch.

The Catalog store is prepared from the private historical import source and preserves local Catalog edits. The versioned Catalog file contains private student data: keep the GitHub repository private and grant access only to trusted administrators. Keep private import workbooks outside Git. The built preview (`npm run start`) uses production bindings; the switch is available in `npm run dev` only.

On a new machine, run `cloudflared tunnel login`, securely transfer the tunnel credentials, and create `~/.cloudflared/config.yml` outside this repository:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: dev-free-spirit-dance.alexandru-croitoriu.dev
    service: http://localhost:3000
  - service: http_status:404
```

Use `.env.example` for local Access service-token variable names. Keep actual secrets in the ignored `.env` file. Never commit OAuth secrets, tunnel credentials/configuration, or database backups.

## Verification

```sh
npm run verify
```

This runs TypeScript (including unused-code checks), API/permission/rendering tests, SQLite migration and diagram checks, and the production build. Individual commands are `npm run typecheck`, `npm test`, and `npm run build`. The test runner reports failures with a nonzero exit code.

`npm run start` serves the built Worker with Wrangler. `npm run cf-typegen` regenerates binding types after configuration changes.

## Production deployment

Cloudflare Workers Builds handles deployment from the connected GitHub repository. Configure the production branch in the Cloudflare dashboard with:

- Build command: `npm run verify` (Node.js 24 and Python 3 required).
- Deploy command: `npm run deploy`.
- Dependency installation: `npm ci` using the committed `package-lock.json`.

The GitHub connection, production branch, Access applications, and secrets are configured remotely; local build success does not verify those settings. Pushing to the connected production branch triggers deployment.

Release preparation has a dedicated Codex skill, `fsd-release`, and a versioned
helper. Start with `python3 scripts/release-preflight.py inspect` after fetching
remote refs. This reports local branch divergence and migration changes without
accessing production; it is not a readiness approval.

With authorization to copy private student data, create a production snapshot
outside the repository, then rehearse the upgrade locally:

```sh
python3 scripts/release-preflight.py snapshot --directory /private/backups
python3 scripts/release-preflight.py rehearse --snapshot /private/backups/fsd-release-.../production.sql
```

Replace the example paths with a private location and the returned snapshot path.
Export is read-only but can briefly pause database queries. The helper keeps
exports and signed download URLs in restricted local files. Rehearsal compares
all existing records in memory and stops on data changes or unknown migration
history. It does not migrate production, check R2 objects, prove old-app
compatibility, or deploy. Verify the exact release with
`TASK_UI_CHROME=/path/to/chromium npm run verify:release`; keep production
migration and push/deployment authorization separate from preparation.

Update the local Catalog and only your saved local production copies (no remote access):

```sh
npm run db:migrate
```

Or update individual groups with `npm run db:migrate:catalog` and
`npm run db:migrate:copies`. Local migrations also run before `npm run dev`.
These commands do not import Excel history, refresh copies, or replace student records.
For an imported Catalog with incomplete migration history, the command verifies a
complete known schema before recording its baseline. It restores the cash-default
migration if its trigger is missing. Unrecognized schemas stop for inspection;
this Catalog-specific repair never targets production. Copy selection reads the
app's registry (`ready=1`), not the eight available storage slots.

Review pending migrations before updating production:

Production commands and release snapshots resolve the database currently serving
the deployed app through its authenticated backup bridge. A restored backup
promoted to production is a different D1 database from the original `DB` binding;
the local development “Production” selector still uses that original binding.
Do not infer the live migration target from that selector or the static config.
The commands require the existing local Access service-token and backup-bridge
credentials, reject read-only previews and maintenance/jobs, and stop if the
active database or generation changes. They never silently fall back to the
original database when status cannot be verified. Avoid switching databases or
starting backup operations while a migration command is running.

```sh
npm run db:migrate:production -- --list
npm run db:migrate:production
```

To update **local Catalog, all local copies, and live production** in sequence:

```sh
npm run db:migrate:all
```

Production commands require an interactive terminal and typing `MIGRATE PRODUCTION`
once before any writes; Wrangler's per-database prompts are suppressed. They require your Wrangler authentication. Append `-- --list`
to any command for a read-only pending-migrations listing (no Catalog history repair).
A failure stops subsequent targets; earlier successful migrations remain applied.
Inspect `.wrangler/migration-logs` privately when troubleshooting.

For the inspected pre-0052 production schema with an incomplete ledger, the command
verifies every expected schema object (allowing only the reviewed report default
and missing CASH trigger), exports a private backup under `.wrangler/migration-backups`,
then records an explicit application-schema baseline through 0051 before applying
new migrations. This does not replay old data migrations or reconcile Excel data.
Existing payment methods are unchanged; the restored trigger affects future profiles.
Unknown schema differences stop before migrations are applied.

**Review migrations against a private backup before applying them.** Existing migration `0025` deletes retired subscriptions, purchases, and their payments; `0028` deletes historical entry grants. These historical migrations are retained for upgrades and must not be rewritten or applied blindly. The current schema requires migrations through `0035_free_attendance_attribution.sql`. The local checks verify synthetic-data preservation and schema parity, not the contents or migration state of production.

The schema is documented in [docs/database.drawio](docs/database.drawio). `python3 scripts/validate-schema.py` checks migration/diagram parity. Its optional SQL-backup argument expects the pre-0020 schema; keep backups outside Git.

## Authentication

Cloudflare Access must protect the complete production and development hostnames using a self-hosted application with an empty path, Google identity provider, and an Allow policy listing administrators' exact email addresses. Worker permissions further restrict Dashboard, Students, Courses, Payments, QR Codes, and administrator management.

The sidebar and Settings use `/cdn-cgi/access/get-identity` for identity, with a fallback on plain localhost. Cloudflare provides that endpoint.

The public QR hostname, `go.alexandru-croitoriu.dev`, routes to this Worker. Protect the complete hostname with Access and use a more-specific bypass application only for `/s/*`. The Worker rejects other routes on this hostname.

## Application behavior

- Tasks: a private Inbox for each administrator appears beside a School / Personal board toggle with horizontal lists and compact cards. Create cards inline, click to edit details, and move them with drag/drop or explicit controls. Cards support due dates and multiple student links. The owner grants Tasks access. Migrations through `0061` are required. See [the UI guide](docs/task-ui.md) and [backend API documentation](docs/task-backend.md).

- Students: manage profiles, optional email, unique nonempty phone numbers, active status, images, and course assignments. Existing `/students/:id` links open the same student panel. Students with history cannot be deleted; mark them inactive instead.
- Courses: maintain one to five weekly classes, a required start date when saving, and an optional inclusive end date. Stored class occurrences preserve recorded classes when schedules change. Courses with linked records cannot be deleted.
- Attendance: open a calendar class to select attendance changes. Ordinary administrators can change attendance on the class date; the main administrator can edit other dates. Submission is atomic, supports additions/removals, and avoids duplicates. Cancelled classes reject attendance; remove attendance before cancellation.
- Payments: record amounts in integer bani (RON), allocate class credits per course, and retain administrator attribution. Payment presets fill a draft; later preset changes do not change recorded payments. Payments can be edited or deleted from student logs.
- Practice Parties: create standalone practice-party records with a Bucharest date, start time, and duration. They appear in the calendar and open an attendance sidebar. Attendance is free and does not affect course credit; optional donations have separate practice-party records that administrators can edit or delete.
- Balances: each payment covers consecutive non-cancelled classes starting at the earliest unpaid attendance, including missed classes. With no unpaid attendance, coverage starts from the payment date. Credits are tracked independently per course. The dashboard filters unpaid attendance or an exact remaining credit count and remembers the filter in browser storage.

Administrator permissions control which pages an administrator can open and which navigation items they see. Shared tables, records, and image storage remain available through the app to every administrator authenticated by Cloudflare Access. Practice Parties requires its own page permission. Apply migrations through `0038_remove_payments_permission.sql` before deploying this feature.

In calendar attendance, select a student and tick **Complimentary class**, optionally enter a reason, then submit attendance. All administrators can grant this on any class date. The log identifies the complimentary attendance and recording administrator. Complimentary classes create no debt and consume no paid credits. Apply migration `0034` before deploying.

Migration `0035` replaces generated free-attendance audit text with the current grant administrator and timestamp, retaining unrelated notes. Disabling free attendance clears the grant attribution.
