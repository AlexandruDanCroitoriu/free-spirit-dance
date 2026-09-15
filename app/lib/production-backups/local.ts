import { DurableObject } from "cloudflare:workers";

// Compatibility export for the deployed local-backups-v1 migration.
// No binding or workspace functionality remains. Preserve historical storage.
export class LocalBackupCoordinator extends DurableObject {
  async alarm() { /* Retired: do not run or reschedule old alarms. */ }
}
