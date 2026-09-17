import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const { courseCreditBalance } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(readFileSync("app/lib/student-activity.ts", "utf8"))).toString("base64"));

const course = { courseId: 1, courseName: "Weekly class", startDate: null, endDate: null };
const schedules = [{ day: "Thursday", startTime: "20:00" }];
const cancelledDates = ["2026-07-02", "2026-08-13", "2026-08-20", "2026-08-27", "2026-10-01"];
const occurrences = cancelledDates.map(classDate => ({ classDate, startTime: "20:00", cancelled: 1 }));
const attendance = ["2026-07-09", "2026-07-16", "2026-07-23", "2026-07-30", "2026-08-06", "2026-09-03"].map(date => ({ attendedAt: date + "T20:00:00" }));
const payments = [{ paidOn: "2026-07-09", allowance: 4 }, { paidOn: "2026-08-06", allowance: 4 }];
function run(credits, now = "2026-09-16T12:00:00Z") {
  const cancelled = [];
  const balance = courseCreditBalance(course, schedules, occurrences, credits, attendance, new Date(now), undefined, undefined, slot => cancelled.push(slot.slice(0, 10)));
  return { balance, cancelled };
}
{
  assert.deepEqual(run([]).cancelled, [], "No payment means no cancelled log entries");
  assert.deepEqual(run(payments).cancelled, ["2026-08-13", "2026-08-20", "2026-08-27"], "Vacation cancellations stay inside the extended package");
  assert.deepEqual(run([{ paidOn: "2026-08-06", allowance: 1 }]).cancelled, [], "Cancellations after the final credit are excluded");
  assert.deepEqual(run(payments, "2026-10-15T12:00:00Z").cancelled, ["2026-08-13", "2026-08-20", "2026-08-27"], "Expired packages do not acquire later cancellations");
}
assert.equal(run(payments).balance.remainingAllowance, 1);
assert.equal(run(payments).balance.missedClasses, 1);
console.log("PASS: cancelled activity is limited to payment validity and allowance.");
