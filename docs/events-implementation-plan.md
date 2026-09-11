# Practice Parties and Festivals

Status: Practice Parties implemented. Festival planning remains pending.

## Module boundary

Practice Parties and Festivals are separate modules. They share only student profiles, administrator identities, calendar presentation, the student activity timeline, and the combined Payments report. They do not share database tables.

Practice Parties uses its own tables for party schedules, attendance, donations, change history, and write idempotency. Festivals will receive its own event, session, pass, pricing, payment, and attendance tables when implemented. Course tables remain separate from both modules.

## Practice Parties — completed

The sidebar item and page are named **Practice Parties**. Each practice party is one standalone dated record, automatically named **Practice party**. Administrators enter only:

| Field | Rule |
| --- | --- |
| Date | Required local Bucharest date |
| Start time | Required local Bucharest time |
| Duration | Required whole minutes, 1–1,440 |

The add form opens in a right-side panel and creates one practice party at a time. Editing a practice party also happens in the right-side panel. Duplicating a party copies its start time and duration and requires a new date. There is no container event, custom name, automatic recurrence, or archive state.

Practice parties appear beside course classes in the calendar. Clicking one opens a right-hand attendance panel, consistent with course attendance. The panel lets administrators search the shared student directory, mark free attendance, record a donation, edit or delete a donation, correct attendance, edit or cancel the party, and mark a donation as given to the school.

Attendance and donations are separate records:

- Free attendance produces a Practice Party attendance entry in the student activity log and never changes course credit or debt.
- An optional donation entered with attendance saves both records atomically and displays two activity entries.
- A later donation never creates attendance.
- Deleting a donation never deletes attendance. Correcting attendance never deletes a donation.
- Practice Party donations have no refund workflow. Administrators can edit or delete a donation instead.

Practice Party donations have their own payment table. The Payments page combines course payments and practice donations for reporting, while maintaining a source label so identical numeric IDs from separate tables cannot be confused. Course payment APIs cannot modify practice donations, and Practice Party operations cannot modify course payments.

Practice Party access uses the independent `can_practice_parties` permission:

- Practice Parties: create, edit, cancel, and view party records.
- Practice Parties + Students: view the participant roster and record/correct attendance.
- Practice Parties + Students + Payments: record, edit, delete, and mark donations as given to the school.
- Dashboard: see practice parties in the calendar; roster access determines whether calendar clicks can open the attendance panel.

All writes validate JSON requests, authenticated administrator attribution, date/time/amount formats, optimistic record revisions, and idempotency keys. Schedule corrections retain the original schedule details and a required reason. The feature uses `Europe/Bucharest`, handles daylight-saving gaps explicitly, and asks for summer/winter time when a local time occurs twice.

## Festival — planned separately

Festivals will not reuse Practice Party tables. They will be a separate module with its own schedules, paid/free session admission, configurable pass coverage, pricing periods, pass purchases, payments, and attendance.

Confirmed festival requirements:

- A paid session requires a valid paid pass; there is no unpaid or complimentary override.
- Passes can cover any administrator-defined combination of groups, days, and individual sessions. Broad coverage includes subsequently added matching sessions. Counted-entry passes such as “any three workshops” are outside scope.
- Price changes apply only to later purchases; sold passes retain their original agreed price.
- One full payment purchases a pass; no deposits or installments.
- A custom positive amount with a required reason can be used for historical payments and negotiated new-sale discounts.
- A festival may mix free sessions with paid sessions.
- Festival refunds are required and every refund revokes the relevant pass. Their accounting and payment tables remain festival-specific.
- Visitors use ordinary student profiles.

## Verification completed for Practice Parties

- D1 migration and database-diagram parity checks.
- Permission checks for setup, roster, financial actions, dashboard calendar access, and unauthorized requests.
- Creation, duplicate save retries, concurrent edits, cancellation, and daylight-saving edge cases.
- Attendance/donation atomicity, later donations, donation editing/deletion, and preservation of administrator attribution.
- Student activity pagination and calendar inclusion.
- Isolation from course payments and course credits, including combined Payments reporting with overlapping record IDs.

The implementation is verified with `npm run typecheck`, `node scripts/test-practice-events.mjs`, schema validation, and the repository test suite. Festival implementation will begin from this separate-module boundary.
