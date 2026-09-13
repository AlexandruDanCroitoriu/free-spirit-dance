import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
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
  const source = (await readFile("app/components/course-calendar-widget.tsx", "utf8"))
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
  const days = [...html.matchAll(/<section\b[^>]*calendar-widget-day[\s\S]*?<\/section>/g)].map(([day]) => day);
  const scheduledDays = days.filter((day) => day.includes("Zouk basics"));
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = new Date(todayKey + "T12:00:00");
  const gridStart = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  gridStart.setDate(gridStart.getDate() - (gridStart.getDay() + 6) % 7);
  const expected = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart); date.setDate(date.getDate() + index); return date;
  }).filter(date => date >= today && [1, 3, 5].includes(date.getDay())).length;
  assert.equal(scheduledDays.length, expected, "Recurring schedules appear from today onward");
  for (const day of days) {
    if (day.includes("Zouk basics")) assert.doesNotMatch(day, /Add event on/, "Occupied days keep their event actions");
    else assert.match(day, /<button[^>]*aria-label="Add event on \d{4}-\d{2}-\d{2}"/, "Empty days have an accessible add action");
  }
  for (const day of days.filter((day) => day.includes("Early class"))) {
    assert.ok(day.indexOf("Early class") < day.indexOf("Advanced Zouk"), "Sort by start time");
    assert.ok(day.indexOf("Advanced Zouk") < day.indexOf("Zouk basics"), "Break time ties by course name");
  }
  console.log("PASS: Calendar renders current API schedules, including multiple days, empty schedules, and sorted classes.");

  const widget = await readFile("app/components/course-calendar-widget.tsx", "utf8");
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
