# Free Spirit Dance

An admin-only student management app for a Brazilian Zouk school, built with Vinext, React, TypeScript, and Cloudflare Workers. Student records live in D1; profile images live in private R2 storage and are compressed in the browser before upload.

## Development

Use Node.js 24 (`nvm use`), npm, Python 3 for schema tests, and an authenticated `cloudflared` installation.

```sh
npm ci
npm run dev
```

`npm run dev` starts Vinext on port 3000 and the named tunnel `free-spirit-dance-local`. Open https://dev-free-spirit-dance.alexandru-croitoriu.dev and authenticate through Cloudflare Access with Google.

For the main administrator, local development defaults to persistent **local SQLite and local image storage** under the ignored `.wrangler/state` directory. `npm run dev` first applies pending migrations to the local database only. You can also run `npm run db:local:migrate` separately.

When signed in through the development tunnel as `croitoriu.alexandru.code@gmail.com`, the sidebar shows **Local / Production**. Production uses the live D1 database and R2 images, including for writes. The selection is saved in a session cookie for that browser; switching reloads the dashboard and other open tabs. Finish or discard edits before switching. Plain localhost (including 127.0.0.1 and ::1) acts as the main administrator during local development, including the storage switch and administrator attribution. Other administrators using the tunnel use production permissions, records, and images, including for writes; they cannot switch storage. The deployed app always uses production and has no switch.

Local storage starts empty; switching does not copy or import production records. To import a compatible SQL file locally, use `npx wrangler d1 execute LOCAL_DB --local --config wrangler.local.json --file /path/to/import.sql`. Keep private imports outside Git. The built preview (`npm run start`) uses production bindings; the switch is available in `npm run dev` only.

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

Before pushing schema-dependent changes, review pending D1 migrations and apply them in order:

```sh
npx wrangler d1 migrations list free-spirit-dance-db --remote
npx wrangler d1 migrations apply free-spirit-dance-db --remote
```

**Review migrations against a private backup before applying them.** Existing migration `0025` deletes retired subscriptions, purchases, and their payments; `0028` deletes historical entry grants. These historical migrations are retained for upgrades and must not be rewritten or applied blindly. The current schema requires migrations through `0035_free_attendance_attribution.sql`. The local checks verify synthetic-data preservation and schema parity, not the contents or migration state of production.

The schema is documented in [docs/database.drawio](docs/database.drawio). `python3 scripts/validate-schema.py` checks migration/diagram parity. Its optional SQL-backup argument expects the pre-0020 schema; keep backups outside Git.

## Authentication

Cloudflare Access must protect the complete production and development hostnames using a self-hosted application with an empty path, Google identity provider, and an Allow policy listing administrators' exact email addresses. Worker permissions further restrict Dashboard, Students, Courses, Payments, QR Codes, and administrator management.

The sidebar and Settings use `/cdn-cgi/access/get-identity` for identity, with a fallback on plain localhost. Cloudflare provides that endpoint.

The public QR hostname, `go.alexandru-croitoriu.dev`, routes to this Worker. Protect the complete hostname with Access and use a more-specific bypass application only for `/s/*`. The Worker rejects other routes on this hostname.

## Application behavior

- Students: manage profiles, optional email, unique nonempty phone numbers, active status, images, and course assignments. Existing `/students/:id` links open the same student panel. Students with history cannot be deleted; mark them inactive instead.
- Courses: maintain one to five weekly classes, a required start date when saving, and an optional inclusive end date. Stored class occurrences preserve recorded classes when schedules change. Courses with linked records cannot be deleted.
- Attendance: open a calendar class to select attendance changes. Ordinary administrators can change attendance on the class date; the main administrator can edit other dates. Submission is atomic, supports additions/removals, and avoids duplicates. Cancelled classes reject attendance; remove attendance before cancellation.
- Payments: record amounts in integer bani (RON), allocate class credits per course, and retain administrator attribution. Payment presets fill a draft; later preset changes do not change recorded payments. Payments can be edited or deleted from student logs.
- Practice Parties: create standalone practice-party records with a Bucharest date, start time, and duration. They appear in the calendar and open an attendance sidebar. Attendance is free and does not affect course credit; optional donations have separate practice-party records that administrators can edit or delete.
- Balances: each payment covers consecutive non-cancelled classes starting at the earliest unpaid attendance, including missed classes. With no unpaid attendance, coverage starts from the payment date. Credits are tracked independently per course. The dashboard filters unpaid attendance or an exact remaining credit count and remembers the filter in browser storage.

Administrator permissions control which pages an administrator can open and which navigation items they see. Shared tables, records, and image storage remain available through the app to every administrator authenticated by Cloudflare Access. Practice Parties requires its own page permission. Apply migrations through `0038_remove_payments_permission.sql` before deploying this feature.

In calendar attendance, select a student and tick **Complimentary class**, optionally enter a reason, then submit attendance. All administrators can grant this on any class date. The log identifies the complimentary attendance and recording administrator. Complimentary classes create no debt and consume no paid credits. Apply migration `0034` before deploying.

Migration `0035` replaces generated free-attendance audit text with the current grant administrator and timestamp, retaining unrelated notes. Disabling free attendance clears the grant attribution.
