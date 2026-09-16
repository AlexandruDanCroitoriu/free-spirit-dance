# Production backups

The Administrators page has an owner-only **Production backups** card. Normal
production uses the bound `FS-Dance-Db` database. Manual and weekly jobs snapshot
live production and its active photos, including student, administrator, QR and
task images. The default weekly schedule is Saturday at 04:00 Europe/Bucharest.
Snapshots expire after six calendar months.

**View read-only** prepares a separate `fsd-backup-<id>` D1 database and an image
prefix in `fs-dance-backups`. Everyone views that copy with saves disabled.
Exiting preview returns to production without changing production records.

**Replace production** verifies and, when supported, upgrades the separate copy,
saves a safety snapshot of outgoing live data, then restores into `FS-Dance-Db`.
Its database ID stays unchanged. It stages photos in a unique `restores/<job>/`
prefix in `fs-dance-media` and commits that prefix together with all restored SQL
in one D1 transaction. The internal `_fsd_production_storage` table records the
photo prefix and restore job; it is excluded from application schema comparisons.
Old photo prefixes are retained for recovery; no bulk media cleanup is automatic.
Deleting a saved backup can delete its temporary D1 copy without deleting live
production data or photos.

## Moving an existing live backup into FS-Dance-Db

Deploy the updated Worker before using the updated localhost Production mode.
While no other backup job is running, open Administrators and choose **Move live
data to FS-Dance-Db**. This action appears only when a legacy backup database is
still serving live production. Exit a read-only preview first.

The action saves a safety backup and copies the **current live database and
photos**, including edits made after activation. It does not reload the old saved
snapshot, so a deleted snapshot does not prevent the move. It verifies the source
and drains requests before replacing the stable database. After completion the
card reads **FS-Dance-Db**; reload open application tabs. The old working copy
remains available for retention cleanup rather than being deleted during the move.
Do not manually change the active pointer to `production`: that would expose the
old contents of FS-Dance-Db without copying current records.

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

The sidebar's **Production** selection connects to `FS-Dance-Db` and resolves its
active photo prefix. It uses the same service-token credentials to register and
release requests with the deployed coordinator. Maintenance and stale-generation
checks therefore also cover ordinary local production reads and writes. A legacy
live database or active preview blocks this connection rather than silently
showing a different database. The Administrators shell remains accessible for
migration and recovery. Local Catalog and saved local copies remain independent.

## Operation and recovery

Jobs run in Workflows with bounded retries. The coordinator stores the list,
schedule, active selection, job status, and audit entries outside the databases
being backed up. Pending launches are retried by the minute trigger with the same
Workflow ID. Snapshot SQL and images are streamed into private R2; image checksums
are verified. Before activation, schema fingerprints and SQLite integrity/foreign
key checks must pass. Schema fingerprints tolerate export formatting changes.
Supported older snapshots are upgraded in the separate working database. Unknown
migration histories and unsafe legacy migrations are rejected before replacement.

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

The request gate covers deployed traffic and ordinary localhost Production
requests. Direct D1/R2 writes from Wrangler, migrations, other Workers, or legacy
local cross-database import/copy routes bypass it. Do not run those writers during a backup or switch. D1 and R2
do not provide a cross-service transaction; external writers must be quiescent.

A crashed request can leave a persistent admission ticket. It is deliberately not
expired on a timer, because an outstanding write could still complete. If a job
fails waiting for requests, inspect the coordinator's `requests` SQLite table and
Workflow logs; only remove an orphan after confirming its request has stopped.
An interrupted production replacement retains maintenance until its transaction
commit is confirmed. **Retry restore** restarts a terminal restore job using the
same reservation and preserved safety backup. A marker committed with the data
allows recovery from a lost success response without applying the restore twice.
Do not manually clear this maintenance lock.
Partial snapshots are never activatable. A retry of an incomplete restore discards
only its never-activated working database before importing again.

## Validation

`node scripts/test-production-backups.mjs` uses synthetic SQLite databases, fake
R2 buckets and a mocked Cloudflare API. It tests the complete migrated schema
(including RESTRICT foreign keys, triggers and ID sequences), stable production
replacement, rollback, lost commit responses, restore retry, previews, migrating
legacy live edits, image routing, local request admission, retention, permissions,
stale saves and scheduling. No production records are used by these tests.

`node scripts/test-production-backups.mjs --d1` additionally rehearses the complete
schema replacement and rollback in a fresh, local Miniflare D1 runtime. It needs
localhost sockets and never connects that database to Cloudflare.

`node scripts/test-local-copies.mjs` covers existing local copies and image transfer.
`npm run typecheck` and `npm run build` verify types and the production bundle.
Local simulations do not replace a controlled Cloudflare restore rehearsal before
performing the one-time live migration.
