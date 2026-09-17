import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { runInNewContext } from "node:vm";

const directory = resolve(".wrangler/calendar-render-test");
await mkdir(directory, { recursive: true });
const courses = [
  { id: 1, name: "Zouk basics", schedules: [
    { day: "Monday", startTime: "19:00", endTime: "20:00" },
    { day: "Wednesday", startTime: "18:00", endTime: "19:00" },
    { day: "Friday", startTime: "17:00", endTime: "18:00" },
  ] },
  { id: 2, name: "Advanced Zouk", schedules: [{ day: "Monday", startTime: "19:00", endTime: "20:00" }] },
  { id: 3, name: "Early class", schedules: [{ day: "Monday", startTime: "16:00", endTime: "17:00" }] },
  { id: 4, name: "Unscheduled course", schedules: [] },
];
try {
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const practices = [{ id: 1, startsAt: `${todayKey}T21:00`, startsUtc: `${todayKey}T18:00:00Z`, durationMinutes: 120, cancelled: 0, revision: 1, attendanceCount: 0 }];
  const source = (await readFile("app/components/course-calendar-widget.tsx", "utf8"))
    .replace('useState<(FreeMeeting & { eventName: string })[]>([])', `useState<(FreeMeeting & { eventName: string })[]>(${JSON.stringify([{...practices[0], id:5, eventId:2, eventName:'Community Zouk', name:'Open meetup', spaceRentMinor:0, acceptsDonations:1}])})`)
    .replace("useState<PracticeSession[]>([])", `useState<PracticeSession[]>(${JSON.stringify(practices)})`)
    .replace("useState<Course[]>([])", `useState<Course[]>(${JSON.stringify(courses)})`)
    .replace("[loading, setLoading] = useState(true)", "[loading, setLoading] = useState(false)");
  assert.match(source, /const prezentaGrupaMicaStudentIds = \[47, 55, 54, 92, 81, 137, 101, 53, 124, 37, 87, 91, 138, 150, 78, 114, 99, 63, 122, 89, 96, 43, 86, 140, 82, 65, 40, 60, 44, 35, 85, 70, 52, 56, 134, 71, 29, 145, 18\];/);
  assert.match(source, /name: "Prezenta Grupa Mica", course: "Beginners", year: 2024, studentIds: prezentaGrupaMicaStudentIds, years: \[2024, 2025\]/);
  const outfile = resolve(directory, "page.mjs");
  await build({ stdin: { contents: source, resolveDir: resolve("app/components"), loader: "tsx" }, outfile,
    bundle: true, format: "esm", platform: "node", jsx: "automatic", external: ["react", "react/jsx-runtime"] });
  const { default: Page } = await import(pathToFileURL(outfile).href);
  const html = renderToString(createElement(Page));
  assert.match(html, /Zouk basics/);
  assert.doesNotMatch(html, /Unscheduled course/);
  assert.match(html, /Practice party/);
  assert.match(html, /Community Zouk/);
  assert.match(html, /Open meetup/);
  const days = [...html.matchAll(/<section\b[^>]*calendar-widget-day[\s\S]*?<\/section>/g)].map(([day]) => day);
  const scheduledDays = days.filter((day) => day.includes("Zouk basics"));
  const today = new Date(todayKey + "T12:00:00");
  const gridStart = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  gridStart.setDate(gridStart.getDate() - (gridStart.getDay() + 6) % 7);
  const expected = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart); date.setDate(date.getDate() + index); return date;
  }).filter(date => date >= today && [1, 3, 5].includes(date.getDay())).length;
  assert.equal(scheduledDays.length, expected, "Recurring schedules appear from today onward");
  for (const day of days) {
    if (day.includes("Practice party")) assert.match(day, /<button[^>]*class="relative z-20[^"]*"[^>]*title="Practice party/, "Practice buttons remain above the day add action");
    assert.match(day, /<button[^>]*aria-label="Add event on \d{4}-\d{2}-\d{2}"/, "Every day has an accessible add action, including occupied days");
    if (day.includes("Zouk basics")) assert.match(day, /<button class="relative z-20[^"]*"[^>]*title="Zouk basics/, "Class buttons remain above the day add action");
  }
  for (const day of days.filter((day) => day.includes("Early class"))) {
    assert.ok(day.indexOf("Early class") < day.indexOf("Advanced Zouk"), "Sort by start time");
    assert.ok(day.indexOf("Advanced Zouk") < day.indexOf("Zouk basics"), "Break time ties by course name");
  }
  console.log("PASS: Calendar renders current API schedules, including multiple days, empty schedules, and sorted classes.");

  const widget = await readFile("app/components/course-calendar-widget.tsx", "utf8");
  const coverageEffect = widget.slice(widget.indexOf("    if (!calendarBodyRef.current)"), widget.indexOf("  }, [hoveredPayment, showPaymentCoverage"));
  const { code: coverageCode } = await transform(`(() => {${coverageEffect}})()`, { loader: "ts" });
  const listeners = new Map();
  const frames = new Map();
  let frameId = 0;
  let lines;
  let updates = 0;
  let scrollTop = 0;
  let scrollLeft = 0;
  let disconnected = false;
  const rect = (left, top) => ({ left: left - scrollLeft, top: top - scrollTop, width: 24, height: 30 });
  const payment = { getBoundingClientRect: () => rect(120, 300) };
  const target = { getBoundingClientRect: () => rect(120, 600) };
  const cleanup = runInNewContext(coverageCode, {
    calendarBodyRef: { current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    hoveredPayment: null, showPaymentCoverage: true, calendarRange: "years",
    selectedMatrixStudents: [{ id: 1 }],
    multipleStudentEvents: { 1: [{ kind: "payment", paymentId: 10, coveredClasses: [{ startsAt: "2025-01-09T19:00", courseName: "Beginners" }] }] },
    matrixPaymentCardRefs: { current: new Map([["1|10", payment]]) },
    matrixActivityCardRefs: { current: new Map([["1|2025-01-09|Beginners", target]]) },
    setCoverageLines: value => { lines = value; updates++; },
    window: {
      addEventListener: (type, callback, options) => { listeners.set(type, callback); if (type === "scroll") assert.equal(options.capture, true); },
      removeEventListener: (type, callback) => { assert.equal(listeners.get(type), callback); listeners.delete(type); },
      requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame: id => frames.delete(id),
    },
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
  });
  assert.equal(lines[0].y1, 315);
  assert.equal(lines[0].y2, 615);
  scrollTop = 200;
  scrollLeft = 40;
  listeners.get("scroll")();
  listeners.get("scroll")();
  assert.equal(frames.size, 1, "Scroll events share one animation frame");
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  flush();
  assert.equal(updates, 2);
  assert.equal(lines[0].y1, 115, "Payment endpoint follows vertical scrolling");
  assert.equal(lines[0].y2, 415, "Covered class endpoint follows vertical scrolling");
  assert.equal(lines[0].x1, 92, "Payment endpoint follows horizontal scrolling");
  assert.equal(lines[0].x2, 92, "Covered class endpoint follows horizontal scrolling");
  listeners.get("scroll")();
  cleanup();
  assert.equal(frames.size, 0, "Cleanup cancels pending updates");
  assert.equal(listeners.size, 0, "Cleanup removes listeners");
  assert.equal(disconnected, true);
  console.log("PASS: Payment coverage follows vertical and horizontal scrolling and cleans up pending updates.");
  const presetIds = [47, 55, 54, 92, 81, 137, 101, 53, 124, 37, 87, 91, 138, 150, 78, 114, 99, 63, 122, 89, 96, 43, 86, 140, 82, 65, 40, 60, 44, 35, 85, 70, 52, 56, 134, 71, 29, 145, 18];
  const activeIds = new Set([44, 53, 56, 96, 137, 145]);
  const directoryStudents = presetIds.map((id) => ({ id, firstName: `Student${id}`, lastName: "Fixture", active: activeIds.has(id), picture: null })).reverse();
  let loadedStudents;
  // Exercise the actual directory-response transformation: the original bug
  // discarded inactive profiles before the matrix could resolve selected IDs.
  const loadDirectory = widget.match(/if \(!controller.signal.aborted\) setStudents\([^\n]+/)[0];
  runInNewContext(loadDirectory, { controller: { signal: { aborted: false } }, data: directoryStudents, setStudents: (value) => { loadedStudents = value; } });
  assert.equal(loadedStudents.length, 39, "Historical directory retains all 33 inactive and six active students");
  const matrixSource = widget
    .replace("useState<Student[]>([])", `useState<Student[]>(${JSON.stringify(loadedStudents)})`)
    .replace("[selectedStudentIds, setSelectedStudentIds] = useState<number[]>([])", "[selectedStudentIds, setSelectedStudentIds] = useState<number[]>([...prezentaGrupaMicaStudentIds])")
    .replace('useState<CalendarRange>("month")', 'useState<CalendarRange>("years")')
    .replace('[calendarMode, setCalendarMode] = useState<"school" | "student">("school")', '[calendarMode, setCalendarMode] = useState<"school" | "student">("student")')
    .replace('[selectedCourseIds, setSelectedCourseIds] = useState<number[]>([])', '[selectedCourseIds, setSelectedCourseIds] = useState<number[]>([1])')
    .replace('[selectedYears, setSelectedYears] = useState<number[]>([])', '[selectedYears, setSelectedYears] = useState<number[]>([2024, 2025])')
    .replace('useState<Course[]>([])', `useState<Course[]>(${JSON.stringify([{ id: 1, name: "Beginners", startDate: "2024-01-01", endDate: "2025-12-31", schedules: [], occurrences: [2024, 2025].map(year => ({ classDate: `${year}-01-09`, startTime: "19:00", endTime: "20:00", cancelled: false })) }])})`)
    .replace('[loading, setLoading] = useState(true)', '[loading, setLoading] = useState(false)');
  const matrixFile = resolve(directory, "matrix.mjs");
  await build({ stdin: { contents: matrixSource, resolveDir: resolve("app/components"), loader: "tsx" }, outfile: matrixFile,
    bundle: true, format: "esm", platform: "node", jsx: "automatic", external: ["react", "react/jsx-runtime"] });
  const { default: Matrix } = await import(pathToFileURL(matrixFile).href);
  const matrixHtml = renderToString(createElement(Matrix));
  const renderedIds = [...matrixHtml.matchAll(/title="Student(\d+) Fixture"/g)].map(match => Number(match[1]));
  assert.deepEqual(renderedIds, [...presetIds, ...presetIds], "Both years render all 39 headers in workbook order, even with no student activity");
  assert.equal((matrixHtml.match(/title="Available class"/g) ?? []).length, 78, "Each year's class row includes all 39 student cells");
  console.log("PASS: Multi-year preset renders active and inactive students in workbook order.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
