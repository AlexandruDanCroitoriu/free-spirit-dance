# Production backups

The Administrators page has an owner-only **Production backups** card. Manual
and weekly jobs always export the original `FS-Dance-Db` database and copy all
objects from `fs-dance-media`, including student, administrator, and QR images.
The initial schedule is Saturday at 04:00 Europe/Bucharest. Romania's daylight
saving changes are handled automatically. The card supports changing the weekly
schedule, pausing it, and adding a one-time date/time.

Snapshots expire after six calendar months. Activating one creates a separate D1
working database and separate R2 image prefix. Subsequent activation reuses that
working copy, preserving edits. Returning to original production never merges
changes. Deleting a backup also deletes its saved working database and images.
An expired active copy is protected; it becomes eligible for cleanup after the
owner switches away. Cleanup runs through the same background job mechanism.

## Cloudflare setup before deployment

The production config includes the account ID, original database ID, a SQLite
Durable Object (`ProductionBackupCoordinator`), Workflow
(`fsd-production-backups`), and a once-per-minute Cron trigger. The trigger checks
persisted due times; it does not create a backup every minute.

1. Create the private R2 bucket `fs-dance-backups` if it does not already exist:

   ```sh
   npx wrangler r2 bucket create fs-dance-backups
   ```

   Do not enable public bucket access or add an automatic R2 lifecycle rule:
   application retention must protect active working copies.

2. Create a dedicated Cloudflare API token scoped to this account with **D1 Edit**
   permission. It must be able to export the original database and create,
   import, query, and delete the working databases. Store it interactively:

   ```sh
   npx wrangler secret put BACKUP_API_TOKEN
   ```

   Never use the developer's expiring Wrangler OAuth token as the runtime secret.
   Never commit the token or expose it in browser code. R2 access uses the Worker
   binding and needs no R2 credentials in this token.

3. Run `npm run build` and deploy through the existing GitHub/Workers pipeline.
   Both named class exports and Cron configuration are retained by the build.
   The card explains missing configuration until the runtime token is present.

4. On the deployed Administrators page, create a named backup and wait for
   **ready**. Confirm its image count and size. Activation changes the live app
   for every user; use a quiet period for the initial recovery exercise.

## Local development

Restart `npm run dev` after updating the code/configuration. The Administrators
page shows the same **Production backups** card as the live site. On localhost,
the local Worker calls the deployed card through a Cloudflare Access service
token; no production Google sign-in window is needed. Its list, actions, and
schedule operate on Cloudflare. The local backup testing card has been removed
from the app.

Configure it once:

1. In **Cloudflare Zero Trust → Access controls → Service tokens**, create a
   token named `free-spirit-dance-local-backups`. In the Access application that
   protects `free-spirit-dance.alexandru-croitoriu.dev`, add a policy with action
   **Service Auth** that includes this token. Keep the client ID and client
   secret private.
2. Generate a separate long random value and store it as a deployed Worker
   secret. This application secret limits the service token to the backup route:

   ```sh
   npx wrangler secret put LOCAL_BACKUP_BRIDGE_SECRET --name free-spirit-dance
   ```

3. Put the service-token pair and the exact same bridge secret in the ignored
   local `.env` file, then restart the dev server:

   ```dotenv
   CLOUDFLARE_ACCESS_CLIENT_ID=...
   CLOUDFLARE_ACCESS_CLIENT_SECRET=...
   LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET=...
   ```

   The browser never receives these values. Do not put `BACKUP_API_TOKEN` in
   `.env`; it stays only in the deployed Worker and is used there to create and
   restore Cloudflare D1 backups.

Storage behavior:

- **Local test backups** snapshots the local Catalog and locally stored photos to
  `free-spirit-dance-local-backups`, an explicitly local R2 binding. Activation
  reserves an unused local database copy slot (out of the existing eight) and
  selects **Backup test workspace** in the development sidebar. Return to local
  Catalog preserves the editable copy for later use. These reserved slots cannot
  be overwritten by the ordinary local-copy manager. The original Catalog is
  always the local snapshot source, even when a test copy is active. Images that
  exist only in production are not fetched by local backup jobs.
- **Live production backups** uses the deployed Worker and Cloudflare storage
  directly. Local browser requests terminate at the local Worker, which adds the
  private service-token and bridge credentials before forwarding only the backup
  API. Every activation affects the live app for everyone.

Local scheduling uses a local Durable Object alarm and runs only while the
development server is running. After resuming development, due schedules are
checked; missed weekly runs are coalesced into one backup. Opening the local card
initializes the alarm. Local schedule settings and six-month retention are
independent from production. An interrupted local job becomes failed on the next
alarm so it can be retried; interrupted request tickets still require inspection
before removal, just as with production.

Local backup operations never read production storage or perform Catalog import
reconciliation. Existing local data is preserved; only a free slot reserved for
that backup is replaced. Use synthetic Catalog data when developing if you do
not need private student information.

## Operation and recovery

Jobs run in Workflows with bounded retries. The coordinator stores the list,
schedule, active selection, job status, and audit entries outside the databases
being backed up. Pending launches are retried by the minute trigger with the same
Workflow ID. Snapshot SQL and images are streamed into private R2; image checksums
are verified. Before activation, schema fingerprints and SQLite integrity/foreign
key checks must pass. Schema fingerprints tolerate export formatting changes.
Older snapshots with a different schema are blocked from activation; migrating an
older snapshot requires a separately reviewed migration of its working copy.

Database and image requests are admitted through the coordinator before storage
access. Backup and switching jobs close admission and drain existing requests.
During maintenance the Administrators shell and backup status remain accessible.
Each page carries its loaded database generation; API writes from stale pages
receive HTTP 409. A banner asks users to reload rather than silently discarding
unsaved edits. All switched responses use `Cache-Control: no-store`.

Original production uses its D1 binding. Working copies use the D1 REST query API
because their IDs are created at runtime; this adds latency and consumes API
limits. Working copies are intended for recovery/admin use. Unsupported binding
operations (sessions, exec, dump, unneeded R2 operations) fail explicitly.

The request gate covers the deployed application's traffic. Direct D1/R2 writes
from Wrangler, migrations, other Workers, or the local development production
bindings bypass it. Do not run those writers during a backup or switch. D1 and R2
do not provide a cross-service transaction; external writers must be quiescent.

A crashed request can leave a persistent admission ticket. It is deliberately not
expired on a timer, because an outstanding write could still complete. If a job
fails waiting for requests, inspect the coordinator's `requests` SQLite table and
Workflow logs; only remove an orphan after confirming its request has stopped.
Do not blindly restart a terminated Workflow: first verify its provider export or
import has stopped, then allow the scheduled status reconciliation to clear it.
Partial snapshots are never activatable. A retry of an incomplete restore discards
only its never-activated working database before importing again.

## Validation

`node scripts/test-production-backups.mjs` uses synthetic SQLite databases, fake
R2 buckets, and a mocked Cloudflare API. It covers snapshots, paginated photo
copying, original-only source selection, editable working copies, return/reactivate,
failed imports, retention, durable restart, stale writes, owner/origin checks,
calendar month clamping, DST, and duplicate schedule delivery. No production data
is read or changed by this test.

Cloudflare resources and a runtime API token are required for an end-to-end remote
export/import exercise; passing local tests alone does not verify that setup.

`node scripts/test-local-backups.mjs` additionally verifies local Catalog/photo
snapshots, history preservation, reserved copy slots, edits surviving reactivation,
local deletion, stale writes, and local alarms. Production binding getters and
network access throw in this local test.
