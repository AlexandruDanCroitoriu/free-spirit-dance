import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const { courseCreditBalance } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync('app/lib/student-activity.ts', 'utf8'))).toString('base64'));
const course = { courseId: 1, courseName: 'Zouk', startDate: '2026-01-01', endDate: null };
const schedules = [{ day: 'Monday', startTime: '19:00' }];
const payments = [{ paidOn: '2026-01-05', allowance: 4 }];
const run = (date, occurrences = [], attendance = [], credits = payments) => courseCreditBalance(course, schedules, occurrences, credits, attendance, new Date(date));
assert.equal(run('2026-01-26T20:00:00Z').remainingAllowance, 0, 'four held classes consume credits without attendance');
const cancelled = [{ classDate: '2026-01-12', startTime: '19:00', cancelled: 1 }];
assert.equal(run('2026-01-26T20:00:00Z', cancelled).remainingAllowance, 1);
assert.equal(run('2026-02-02T20:00:00Z', cancelled).remainingAllowance, 0);
assert.equal(run('2026-01-05T16:00:00Z').remainingAllowance, 4, 'future class today is not consumed');
assert.equal(run('2026-01-05T17:00:00Z').remainingAllowance, 3, 'class start uses school timezone');
assert.equal(run('2026-02-02T20:00:00Z', [], [], [...payments, { paidOn: '2026-01-12', allowance: 4 }]).remainingAllowance, 3, 'early renewal queues');
assert.equal(run('2026-02-02T20:00:00Z', [], [{ attendedAt: '2026-02-02T19:00:00' }]).excessAttendance, 1);
assert.equal(run('2026-01-26T20:00:00Z', [], [{ attendedAt: '2026-01-05T19:00:00' }]).excessAttendance, 0);
assert.equal(run('2026-01-26T20:00:00Z', [], [{ attendedAt: '2026-01-05T19:00:00' }], [{ paidOn: '2026-01-12', allowance: 4 }]).excessAttendance, 0, 'later payment covers prior attendance');
assert.equal(courseCreditBalance({ ...course, endDate: '2026-01-12' }, schedules, [], payments, [], new Date('2026-02-02T20:00:00Z')).remainingAllowance, 2);
console.log('PASS: absent students, cancellations, restoration, school time, early renewal, uncovered attendance and course end.');

const prior = [{ attendedAt: '2026-01-05T19:00:00' }];
const renewal = [{ paidOn: '2026-01-09', allowance: 4 }];
let balance = run('2026-01-09T10:00:00Z', [], prior, renewal);
assert.equal(balance.remainingAllowance, 3, 'prior attendance consumes future payment immediately');
assert.equal(balance.excessAttendance, 0);
assert.equal(balance.attendanceCount, 1);
assert.equal(run('2026-01-26T20:00:00Z', [], prior, renewal).remainingAllowance, 0, 'remaining three credits consumed by held classes');
assert.equal(run('2026-01-26T20:00:00Z', cancelled, prior, renewal).remainingAllowance, 1, 'cancellation preserves credit after debt settlement');
const debt = ['2026-01-05', '2026-01-12', '2026-01-19'].map(date => ({ attendedAt: date + 'T19:00:00' }));
balance = run('2026-01-23T10:00:00Z', [], debt, [{ paidOn: '2026-01-23', allowance: 2 }]);
assert.equal(balance.remainingAllowance, 0);
assert.equal(balance.excessAttendance, 1, 'partial payment leaves unpaid attendance');
balance = run('2026-01-24T10:00:00Z', [], debt, [{ paidOn: '2026-01-23', allowance: 2 }, { paidOn: '2026-01-24', allowance: 4 }]);
assert.equal(balance.remainingAllowance, 3);
assert.equal(balance.excessAttendance, 0);
assert.equal(run('2026-01-09T10:00:00Z', [], [], renewal).remainingAllowance, 4, 'absence before payment creates no debt');
assert.equal(run('2026-01-09T10:00:00Z', [], prior, []).excessAttendance, 1);
console.log('PASS: retroactive attendance credit, immediate and partial settlement, multiple payments, cancellations and prior absences.');

const recordedEarly = [
  { attendedAt: '2026-09-03T19:00:00' },
  { attendedAt: '2026-09-10T19:00:00' },
];
const beforeClass = new Date('2026-09-10T11:45:00Z');
const earlyBalance = (attendance, credits = [], now = beforeClass) => courseCreditBalance(
  course, [{ day: 'Thursday', startTime: '19:00' }], [], credits, attendance, now,
);
balance = earlyBalance(recordedEarly);
assert.equal(balance.attendanceCount, 2);
assert.equal(balance.paidAllowance, 0);
assert.equal(balance.excessAttendance, 2, 'both saved attendances count before today’s class starts');
const todayPayment = [{ paidOn: '2026-09-10', allowance: 2 }];
balance = earlyBalance(recordedEarly, todayPayment);
assert.equal(balance.excessAttendance, 0);
assert.equal(balance.remainingAllowance, 0, 'early attendance consumes credit immediately');
assert.deepEqual(earlyBalance(recordedEarly, todayPayment, new Date('2026-09-10T18:00:00Z')), balance, 'class start must not charge recorded attendance twice');
assert.equal(earlyBalance(recordedEarly.slice(0, 1), todayPayment).remainingAllowance, 1, 'unrecorded future class preserves credit');
assert.equal(earlyBalance([], todayPayment).remainingAllowance, 2);
console.log('PASS: early recorded attendance counts immediately without consuming unrecorded future classes or double charging.');
