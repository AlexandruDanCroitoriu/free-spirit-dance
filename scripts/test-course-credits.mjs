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

const septemberCourse = { ...course, startDate: '2026-09-01' };
const thursdays = [{ day: 'Thursday', startTime: '19:00' }];
const septemberAttendance = ['2026-09-03', '2026-09-17'].map(date => ({ attendedAt: date + 'T19:00:00' }));
const septemberPayment = [{ paidOn: '2026-09-18', allowance: 4 }];
const september = (date, cancelled = [], credits = septemberPayment) => courseCreditBalance(septemberCourse, thursdays, cancelled, credits, septemberAttendance, new Date(date));
assert.equal(september('2026-09-18T12:00:00Z').remainingAllowance, 1, 'September 3, 10 (missed), and 17 consume three credits');
assert.equal(september('2026-09-18T12:00:00Z').excessAttendance, 0);
assert.equal(september('2026-09-24T18:00:00Z').remainingAllowance, 0, 'September 24 is the fourth covered class');
assert.equal(september('2026-09-18T12:00:00Z', [{ classDate: '2026-09-10', startTime: '19:00', cancelled: 1 }]).remainingAllowance, 2, 'cancelled classes do not consume the retroactive package');
assert.equal(september('2026-09-24T18:00:00Z', [], [...septemberPayment, { paidOn: '2026-09-20', allowance: 4 }]).remainingAllowance, 4, 'renewal does not cover the same classes twice');
console.log('PASS: packages start at earliest unpaid attendance, include missed classes, skip cancellations, and queue renewals.');

const coverageByPayment = new Map();
const coverageBalance = courseCreditBalance(septemberCourse, thursdays, [], [{ paymentId: 11, paidOn: '2026-09-18', allowance: 4 }], septemberAttendance, new Date('2026-09-18T12:00:00Z'), (id, detail) => coverageByPayment.set(id, detail));
assert.deepEqual(coverageByPayment.get(11), { classes: [
  { startsAt: '2026-09-03T19:00', attended: true },
  { startsAt: '2026-09-10T19:00', attended: false },
  { startsAt: '2026-09-17T19:00', attended: true },
], remaining: 1 });
assert.equal(coverageByPayment.get(11).remaining, coverageBalance.remainingAllowance);
console.log('PASS: payment coverage identifies attended and missed classes consistently with remaining credits.');

const advanceAttendance = ['2026-09-03', '2026-09-10', '2026-10-01', '2026-10-22'].map(date => ({ attendedAt: date + 'T19:00:00' }));
const advanceCoverage = new Map();
const advanceCredits = [{ paymentId: 12, paidOn: '2026-09-10', allowance: 4 }];
const advanceBalance = courseCreditBalance(septemberCourse, thursdays, [], advanceCredits, advanceAttendance, new Date('2026-09-10T12:00:00Z'), (id, detail) => advanceCoverage.set(id, detail));
assert.deepEqual(advanceCoverage.get(12).classes.map(slot => slot.startsAt.slice(0, 10)), ['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24']);
assert.equal(advanceBalance.excessAttendance, 2, 'October attendance cannot skip the September classes reserved by this payment');
assert.equal(advanceBalance.remainingAllowance, 0, 'later recorded attendance consumes the earlier covered block');
const afterPackage = courseCreditBalance(septemberCourse, thursdays, [], advanceCredits, advanceAttendance, new Date('2026-10-23T12:00:00Z'));
assert.equal(afterPackage.remainingAllowance, 0, 'missed September classes still use both credits');
assert.equal(afterPackage.excessAttendance, 2);
console.log('PASS: four consecutive available classes are covered even with later attendance entered in advance.');

assert.equal(afterPackage.missedClasses, 2, 'missed covered September classes are counted');
assert.equal(advanceBalance.missedClasses, 2, 'gaps before later recorded attendance count as missed');
assert.equal(september('2026-09-18T12:00:00Z').missedClasses, 1);
assert.equal(september('2026-09-18T12:00:00Z', [{ classDate: '2026-09-10', startTime: '19:00', cancelled: 1 }]).missedClasses, 0, 'cancelled classes never count as missed');
console.log('PASS: missed classes count only elapsed, covered classes without attendance.');

const screenshotAttendance = ['2026-09-03', '2026-09-10', '2026-09-17', '2026-10-01', '2026-10-08'].map(date => ({ attendedAt: date + 'T19:00:00' }));
const screenshotBalance = courseCreditBalance(septemberCourse, thursdays, [], advanceCredits, screenshotAttendance, new Date('2026-09-10T12:00:00Z'));
assert.equal(screenshotBalance.attendanceCount, 5);
assert.equal(screenshotBalance.paidAllowance, 4);
assert.equal(screenshotBalance.missedClasses, 1, 'September 24 is the one missed covered class');
assert.equal(screenshotBalance.excessAttendance, 2);
assert.equal(screenshotBalance.remainingAllowance, 0);
console.log('PASS: screenshot scenario counts one missed class before later recorded attendance.');

const freeAttendance = [{ attendedAt: '2026-01-05T19:00:00', complimentary: 1 }];
const freeOnly = run('2026-01-05T20:00:00Z', [], freeAttendance, []);
assert.equal(freeOnly.attendanceCount, 1);
assert.equal(freeOnly.excessAttendance, 0);
assert.equal(freeOnly.missedClasses, 0);
assert.equal(run('2026-01-05T20:00:00Z', [], freeAttendance).remainingAllowance, 4, 'complimentary attendance preserves every paid credit');
assert.equal(run('2026-01-12T20:00:00Z', [], freeAttendance).remainingAllowance, 3, 'next scheduled class consumes the first paid credit');
console.log('PASS: complimentary attendance counts as attendance without debt, missed classes or paid-credit use.');
