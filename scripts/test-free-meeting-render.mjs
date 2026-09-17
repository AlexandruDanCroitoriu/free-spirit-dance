import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function component(file, replace = source => source) {
  const output = await build({ stdin: { contents: replace(readFileSync(file, 'utf8')), resolveDir: resolve('app/components'), loader: 'tsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
  return module.exports.default;
}
const event = { id: 1, name: 'Community event', revision: 0, meetingCount: 1 };
const meeting = { id: 2, eventId: 1, name: 'Open dance', startsAt: '2026-09-19T20:00', startsUtc: '2026-09-19T17:00:00Z', durationMinutes: 120, spaceRentMinor: 0, acceptsDonations: 1, cancelled: 0, revision: 0, attendanceCount: 1 };
const Panel = await component('app/components/free-meeting-panel.tsx');
const props = { event, meeting, close() {}, refresh() {} };
const details = renderToString(createElement(Panel, props));
assert.match(details, /aria-current="page"[^>]*>Meeting details/);
assert.match(details, />Attendance</); assert.match(details, />History</);
assert.match(details, /19 septembrie 2026/);
assert.match(details, /Changes save automatically/); assert.match(details, /Delete meeting/);
const attendance = renderToString(createElement(Panel, { ...props, initialTab: 'attendance' }));
assert.match(attendance, /aria-current="page"[^>]*>Attendance/);
assert.match(attendance, /<section hidden="" aria-label="Meeting details"/);
assert.match(attendance, /Search students/); assert.match(attendance, /Submit attendance/);
assert.match(readFileSync('app/components/free-meeting-calendar-panel.tsx', 'utf8'), /initialTab="attendance"/);
const history = renderToString(createElement(Panel, { ...props, initialTab: 'history' }));
assert.match(history, /aria-label="Meeting history"/);
const students = [{ id: 1, firstName: 'Ana', lastName: 'Student', active: 1, attendanceId: 3, donationAmountMinor: 2500, donationReceivedMethod: 'Cash', picture: '/api/student-images/test.jpg' }];
const Roster = await component('app/components/free-meeting-roster.tsx', source => source.replace(' | null>(null)', ` | null>(${JSON.stringify({ students, count: 1, paymentMethods: [{ method: 'Cash' }], revision: 0 })})`));
const roster = renderToString(createElement(Roster, { eventId: 1, session: meeting, refresh() {}, setDirty() {} }));
assert.match(roster, /Ana Student/); assert.match(roster, /Donation \(RON\)/); assert.match(roster, /value="25.00"/); assert.match(roster, /Received via/); assert.match(roster, /aria-pressed="true"/);
const noDonations = renderToString(createElement(Roster, { eventId: 1, session: { ...meeting, acceptsDonations: 0 }, refresh() {}, setDirty() {} }));
assert.match(noDonations, /Ana Student/); assert.doesNotMatch(noDonations, /Donation \(RON\)|Received via/);
console.log('PASS: meeting tabs, calendar attendance default, Romanian date, editable details, attendance cards and conditional donation fields.');
