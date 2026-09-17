import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const { courseCreditBalance, resolveSharedPaymentStarts } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync('app/lib/student-activity.ts', 'utf8'))).toString('base64'));

const course = { courseId: 1, courseName: 'Beginners', startDate: '2026-01-01', endDate: null };
const thursdayAtSeven = [{ day: 'Thursday', startTime: '19:00' }];

// A confirmed class occurrence without attendance is missed and consumes a
// package credit; an unrelated recurring timetable must not create a slot.
{
  const misses = [];
  const balance = courseCreditBalance(
    course,
    thursdayAtSeven,
    [
      { classDate: '2026-09-03', startTime: '19:00', cancelled: 0 },
      { classDate: '2026-09-10', startTime: '19:00', cancelled: 0 },
      { classDate: '2026-09-17', startTime: '19:00', cancelled: 0 },
    ],
    [{ paymentId: 1, paidOn: '2026-09-03', allowance: 4 }],
    [{ attendedAt: '2026-09-03T19:00:00' }, { attendedAt: '2026-09-17T19:00:00' }],
    new Date('2026-09-18T12:00:00Z'),
    undefined,
    slot => misses.push(slot),
  );
  assert.deepEqual(misses, ['2026-09-10T19:00']);
  assert.equal(balance.missedClasses, 1);
  assert.equal(balance.remainingAllowance, 1);
  assert.equal(balance.excessAttendance, 0);
}

// Explicit historical occurrences override a later recurring schedule on that
// date. This is the 19 March pattern: Beginners was held but not attended.
{
  const misses = [];
  const balance = courseCreditBalance(
    course,
    [{ day: 'Thursday', startTime: '20:00' }],
    [
      { classDate: '2026-03-10', startTime: '19:00', cancelled: 0 },
      { classDate: '2026-03-12', startTime: '19:00', cancelled: 0 },
      { classDate: '2026-03-17', startTime: '19:00', cancelled: 0 },
      { classDate: '2026-03-19', startTime: '19:00', cancelled: 0 },
    ],
    [{ paidOn: '2026-03-10', allowance: 8 }],
    [{ attendedAt: '2026-03-10T19:00:00' }, { attendedAt: '2026-03-12T19:00:00' }, { attendedAt: '2026-03-17T19:00:00' }],
    new Date('2026-03-20T12:00:00Z'),
    undefined,
    slot => misses.push(slot),
  );
  assert.deepEqual(misses, ['2026-03-19T19:00']);
  assert.equal(balance.remainingAllowance, 4);
}

// Cancellations remain explicit calendar activity and never use a credit.
{
  const balance = courseCreditBalance(
    course,
    thursdayAtSeven,
    [{ classDate: '2026-09-10', startTime: '19:00', cancelled: 1 }],
    [{ paidOn: '2026-09-03', allowance: 2 }],
    [{ attendedAt: '2026-09-03T19:00:00' }, { attendedAt: '2026-09-17T19:00:00' }],
    new Date('2026-09-18T12:00:00Z'),
  );
  assert.equal(balance.remainingAllowance, 0);
  assert.equal(balance.missedClasses, 0);
}

// A free missed attendance waives exactly that confirmed class: it is not
// marked attended and it does not consume a package credit.
{
  const misses = [];
  const balance = courseCreditBalance(
    course,
    thursdayAtSeven,
    [{ classDate: '2026-09-10', startTime: '19:00', cancelled: 0 }],
    [{ paidOn: '2026-09-03', allowance: 1 }],
    [],
    new Date('2026-09-18T12:00:00Z'),
    undefined,
    slot => misses.push(slot),
    undefined,
    undefined,
    undefined,
    ['2026-09-10T19:00'],
  );
  assert.deepEqual(misses, []);
  assert.equal(balance.missedClasses, 0);
  assert.equal(balance.remainingAllowance, 1);
}

console.log('PASS: confirmed absent classes are missed, phantom schedule slots are excluded, and cancellations remain explicit.');

// A single payment for several courses has one subscription start. An
// attendance in either course starts it, and an absence in the other course on
// that same date consumes that course's credit.
{
  const beginners = { courseId: 1, courseName: 'Beginners', startDate: '2026-01-01', endDate: null };
  const intermediates = { courseId: 2, courseName: 'Intermediates', startDate: '2026-01-01', endDate: null };
  const payment = { paymentId: 7, paidOn: '2026-04-07', allowance: 2 };
  const aprilClasses = [
    { classDate: '2026-04-07', startTime: '19:00', cancelled: 0 },
    { classDate: '2026-04-09', startTime: '19:00', cancelled: 0 },
  ];
  const intermediateClasses = aprilClasses.map((slot) => ({ ...slot, startTime: '20:00' }));
  const inputs = [
    { course: beginners, schedules: [], occurrences: aprilClasses, payments: [payment], attendance: [{ attendedAt: '2026-04-09T19:00:00' }] },
    { course: intermediates, schedules: [], occurrences: intermediateClasses, payments: [payment], attendance: [{ attendedAt: '2026-04-07T20:00:00' }] },
  ];
  const starts = resolveSharedPaymentStarts(inputs, new Date('2026-04-10T12:00:00Z'));
  assert.equal(starts.get(7), '2026-04-07');
  const covered = inputs.map((input) => {
    let classes = [];
    courseCreditBalance(input.course, input.schedules, input.occurrences, input.payments.map((item) => ({ ...item, coverageStart: starts.get(item.paymentId) })), input.attendance, new Date('2026-04-10T12:00:00Z'), (_, detail) => { classes = detail.classes; });
    return classes;
  });
  assert.deepEqual(covered[0], [{ startsAt: '2026-04-07T19:00', attended: false }, { startsAt: '2026-04-09T19:00', attended: true }]);
  assert.deepEqual(covered[1], [{ startsAt: '2026-04-07T20:00', attended: true }, { startsAt: '2026-04-09T20:00', attended: false }]);
}

console.log('PASS: multi-course payments share the latest uncovered attendance as their subscription start.');

// A payment recorded between classes begins at the next recorded attendance
// when there is no attendance available to settle on or before the payment date.
{
  let coverage;
  courseCreditBalance(
    course,
    thursdayAtSeven,
    [{ classDate: '2026-03-12', startTime: '19:00', cancelled: 0 }],
    [{ paymentId: 8, paidOn: '2026-03-10', allowance: 8 }],
    [{ attendedAt: '2026-03-12T19:00:00' }],
    new Date('2026-03-13T12:00:00Z'),
    (_, detail) => { coverage = detail; },
  );
  assert.deepEqual(coverage, { classes: [{ startsAt: '2026-03-12T19:00', attended: true }], remaining: 7 });
}

console.log('PASS: payments made between classes begin with the next recorded attendance.');
