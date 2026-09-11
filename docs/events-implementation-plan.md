# Events, practice parties, and festival passes

Status: proposed implementation plan. This document does not change application behavior.

## Recommended approach

Add an **Events** area with five simple concepts:

1. **Event:** the container, such as “Practice parties — September” or “Autumn Zouk Weekender”.
2. **Session:** an individually scheduled activity with a date, start time, and duration. An event has one or many sessions.
3. **Offer:** what a pass includes, such as workshops, parties, masterclasses, or everything.
4. **Price period:** when the student pays, such as Early Bird, Regular, or Late Bird. Each period prices the same offers.
5. **Participation:** attendance at a session, with donations or pass payments recorded separately.

Keep events separate from recurring courses and course-credit calculations. Reuse the existing student directory, money ledger, activity timeline, calendar presentation, and administrator attribution.

## Administrator workflows

### Practice parties

Create an event with an administrator-entered type label (“Practice party”) and admission mode **Free / optional donation**. Add this week's sessions manually using repeatable rows:

| Session | Date | Start | Duration |
| --- | --- | --- | --- |
| Wednesday practice | 2026-10-07 | 20:00 | 120 minutes |
| Sunday practice | 2026-10-11 | 18:00 | 90 minutes |

Administrators can add more sessions later. A “Duplicate session” action copies the title and duration but requires choosing the new date/time. No automatic weekly recurrence is needed initially. Separate weekly events are also possible; monthly grouping is just a suggested naming convention.

Open a session, search existing students, and mark attendance. Each student receives an activity entry such as “Attended Wednesday practice — Free”. A donation is optional and records a positive amount, actual payment date, collector, notes, and school-handover status.

If attendance and donation are entered together, save them atomically but display **two independent entries**. Without a donation, create only attendance, with no zero-value payment. A donation can also be recorded later against that particular session, and never creates attendance implicitly. Multiple genuine donations are allowed; retrying a save must not duplicate one.

### Weekender festival

Create an event with admission mode **Paid passes**. Add every workshop, party, and masterclass as its own session, including multiple sessions per day and sessions crossing midnight.

Define event-specific admission groups, initially suggested as Workshops, Parties, and Masterclasses. Each session belongs to one group. Administrators define offers by selecting groups:

| Offer | Included groups |
| --- | --- |
| Workshops | Workshops |
| Parties | Parties |
| Masterclasses | Masterclasses |
| Full pass | Workshops, Parties, Masterclasses |

Groups describe access, not the event type. A combined workshop-and-party offer is simply another selection of groups. Admission covers every session in the selected groups; counted entries and individual-session exclusions are outside the first version.

Define dated price periods, then edit one matrix. The amounts below are illustrative RON prices:

| Offer | Early Bird | Regular | Late Bird |
| --- | ---: | ---: | ---: |
| Workshops | 200 | 250 | 300 |
| Parties | 80 | 100 | 120 |
| Masterclasses | 100 | 130 | 160 |
| Full pass | 330 | 400 | 470 |

Offers and their coverage are defined once. Each period has an explicit price for each offer, avoiding duplicated offer definitions. A convenience action can copy the preceding column and add a fixed amount to every offer; stored prices remain explicit and editable.

To sell a pass, select student, offer, and **actual payment date**. The system selects the matching period and displays the price before saving. Recording an earlier payment today uses the earlier payment date, not today's entry date. Require full payment equal to the preset price in the first version. Save the pass and payment together. Payment alone does not mark any sessions attended.

The session roster shows whether the student owns a valid pass covering its group. Marking attendance records “Attended Workshop 1 — Covered by Workshops / Early Bird”. A student can hold multiple different offers, for example Parties plus Workshops. Prevent a second active purchase of the same offer for the same student/event; warn when different offers overlap. Without coverage, block check-in and direct the administrator to record the pass payment first.

## Rules that keep the first version predictable

- Use the school's existing `Europe/Bucharest` timezone for dates and times. Require a real calendar date, valid time, and positive whole-minute duration with a practical upper limit (proposed: 1,440 minutes). Show the calculated end date/time, including next-day endings. Resolve daylight-saving gaps/ambiguities explicitly rather than silently shifting the entered time.
- One attendance record per student/session, keyed by stable session ID. Rescheduling must not detach attendance or donations. Warn about overlapping sessions but allow parallel workshops.
- Price-period start and end dates are inclusive school-local dates and cannot overlap. A date outside all periods cannot be sold until the schedule is corrected. No automatic fallback to today's price or manual tier override in version one.
- Every offer needs a price in every enabled period before sales open. Use positive integer minor units and the existing RON conventions.
- First sale locks offer coverage and the price matrix for that event. This deliberately simple first-version rule prevents accidental changes to sold products. Names and purchased details are snapshotted for history.
- Covered groups include sessions added later to those groups. After sales begin, lock group reassignment of existing sessions and display the access impact when adding or cancelling sessions. Offer configuration determines this policy explicitly; a snapshot of group membership does not freeze the timetable.
- No automatic missed-session logs or course-credit deductions. Events count only explicitly recorded attendance.
- Archive events and cancel sessions instead of deleting referenced records. Cancelled sessions reject new attendance. Cancellation does not erase attendance, refund money, or revoke passes automatically.
- For erroneous event records, provide an attributed void action with a required reason, retaining the original record. Voiding attendance preserves donations. Voiding a pass payment also voids its pass atomically; if that pass has attendance, retain and flag that attendance for review. A void corrects an entry and is not a cash refund. Real refunds need a separate later workflow.
- Keep student registrations and finances private under the existing Access protection. No public booking or student-facing portal is required.

## Proposed data model

Names are provisional; implement additive migrations after the latest migration present at implementation time.

| Table | Purpose / principal fields |
| --- | --- |
| `events` | Name, type label, description, admission mode, timezone, archived state, creator and timestamps |
| `event_groups` | Event ID, group name, display order |
| `event_sessions` | Event ID, group ID (required for paid events), title, local date/time, resolved start instant, duration minutes, cancellation state and attribution |
| `event_offers` | Event ID, offer name, display order |
| `event_offer_groups` | Offer-to-group coverage; unique offer/group pair |
| `event_price_periods` | Event ID, name, inclusive start/end dates, display order |
| `event_offer_prices` | Offer ID, period ID, amount minor; unique offer/period pair |
| `student_event_passes` | Student/event/offer/period IDs, unique payment ID, purchased name/coverage/price snapshots, active/void state and attribution |
| `event_attendance` | Student/session IDs, optional covering pass ID, free/covered admission, session title/time snapshot, recorder and timestamp, void metadata |

Extend **`student_payments`**, rather than create a second money ledger:

- Add a purpose discriminator: `course` (default for all existing rows), `event_pass`, or `event_donation`.
- Add event ID and optional session ID. A donation requires its practice session; a pass payment belongs to the event. Keep amount, paid date, collector, request key, notes, and `given_to_school` in the existing ledger.
- Add event-payment void metadata and historical description snapshots. Void rows remain visible as corrections but are excluded from active money totals and handover totals. Do not change existing course-payment correction behavior in this feature.
- Course payments continue to require `payment_course_allowances`. Event payments must have none. Validate these rules by payment purpose.
- Enforce matching student and event across payment, pass, session, and attendance references. Use foreign keys/composite constraints where practical, plus server validation. Prevent cross-event offer/period/group combinations and duplicate active attendance/pass purchases with database constraints.

This is more reliable than storing prices and access rights in notes. It also preserves one place for administrators to see collected money and money given to the school.

The student activity timeline remains a **derived view** of attendance and payments, as it is today; no extra generic activity-log table is needed. Use distinct event-attendance, donation, and pass-payment kinds and stable source-prefixed IDs. Include void status and retained history.

## Integration with the current application

The current implementation was reviewed in `app/lib/student-activity.ts`, `app/api/students/[id]/activity/route.ts`, `app/api/students/payments/route.ts`, `app/lib/payment-presets.ts`, `app/api/calendar/route.ts`, `worker.ts`, and migrations through `0036`.

- **Events UI:** add `/events` and `/events/[id]`, with Schedule, Passes & Prices (paid events only), and Participants sections. Reuse the existing time selector, student search/roster patterns, notifications, and payment-handover controls.
- **API:** introduce event setup, session, offer/period/price, pass purchase, attendance, donation, and void operations under `/api/events`. Keep financial operations explicit rather than a generic unchecked object update.
- **Permissions:** add `can_events` across the schema, administrator editor, permission response, sidebar, and Worker route guards. Proposed policy: Events for setup; Events + Students for roster/check-in; Events + Students + Payments for purchases/donations/financial corrections. Guard nested API routes and methods explicitly. Calendar and student-profile read projections should follow their existing page permissions, exposing only the required fields.
- **Calendar:** preserve the existing course response contract initially and fetch event sessions separately for the visible date range. Merge them in the calendar using a course/event discriminator and open the appropriate roster. Do not pass event sessions through course recurrence logic.
- **Activity:** extend shared types and rendering with event context and links. Merge all sources before final pagination, with deterministic sorting and correct counts. Show separate course/event attendance counts and a money breakdown for course fees, event passes, and donations.
- **Payments:** show purpose and event/session details in the Payments page and student payment history. Existing handover controls continue to use the same payment IDs. Include active event money exactly once in totals. Existing course edit/delete endpoints must reject event payments; event-specific actions maintain pass linkage and correction rules.
- **Course credits:** only allowance-backed course payments participate in `courseCreditBalance`; event attendance never enters the course attendance table. Existing payment presets remain course presets.
- **Development/schema:** use the existing storage abstraction and local/production D1 setup. Update `docs/database.drawio` alongside actual migrations so the existing schema-parity checks remain meaningful. No R2 changes are required.

## Implementation sequence

1. **Event foundation:** event/session tables, permissions, Events navigation, manual multi-row schedules, archive/cancel, and calendar integration.
2. **Practice parties end to end:** payment-purpose migration, free check-in, optional donations, student timeline, payments/handover totals, corrections, and retry protection.
3. **Festival pricing:** groups, shared offers, dated pricing matrix, validations, and configuration locking after first sale.
4. **Passes and attendance:** atomic pass purchase, purchase snapshots, coverage display/checking, duplicate prevention, activity entries, and payment correction handling.
5. **Verification and release preparation:** migration/data preservation checks, permissions and workflow tests, schema diagram parity, type checking, and `npm run build`. Use the repository's normal GitHub deployment workflow when implementation is ready to release.

Each stage should leave existing student/course behavior working. Steps 1–2 deliver useful practice-party support before festival features are complete.

## Acceptance checks

- A practice event accepts multiple manually entered dates and durations, including a next-day ending.
- Free attendance produces one log and no payment, debt, missed-class entry, or credit consumption.
- Attendance with a donation produces two logs and one ledger payment; a retry produces no duplicates. Failure rolls back the combined action.
- A later donation links to the correct session without another attendance record.
- A festival can schedule multiple workshops per day over several days and use custom admission groups/offers.
- Every pricing period exposes exactly the same offers; test first/last day boundaries, gaps, overlaps, and recording an earlier payment later.
- A full pass admits all included groups; a parties-only pass cannot check into a workshop. Purchasing either pass creates no attendance.
- Price/coverage changes cannot rewrite sold passes. A newly added session in a covered group accepts existing passes.
- Double clicks and concurrent saves cannot create duplicate attendance or duplicate active same-offer passes. Enforce full payment and reject cross-event references server-side.
- Course edit/delete actions cannot alter event payments. Event voids preserve attribution/history and update pass validity and active totals together.
- Timeline pagination, attendance counts, total money, and school-handover totals remain correct with mixed course/event activity.
- Existing students, course records, payments, allowances, and handover flags survive migration unchanged; unauthorized API requests are rejected.

## Explicit first-version limits

Assume RON, full payment at purchase, group-based access, and administrator-entered schedules. Leave installments, deposits, pass upgrades/transfers, discounts, refunds, capacity limits, waiting lists, automatic recurrence, public checkout, and ticket QR scanning for later. These are proposed scope choices, not existing school policies. If needed, agree their rules before extending the model; none is required for the two examples above.
