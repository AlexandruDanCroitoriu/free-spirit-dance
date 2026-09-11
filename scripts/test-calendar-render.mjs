import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

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
  const outfile = resolve(directory, "page.mjs");
  await build({ stdin: { contents: source, resolveDir: resolve("app/components"), loader: "tsx" }, outfile,
    bundle: true, format: "esm", platform: "node", jsx: "automatic", external: ["react", "react/jsx-runtime"] });
  const { default: Page } = await import(pathToFileURL(outfile).href);
  const html = renderToString(createElement(Page));
  assert.match(html, /Zouk basics/);
  assert.doesNotMatch(html, /Unscheduled course/);
  const days = [...html.matchAll(/<section\b[^>]*calendar-widget-day[\s\S]*?<\/section>/g)].map(([day]) => day);
  const scheduledDays = days.filter((day) => day.includes("Zouk basics"));
  assert.equal(scheduledDays.length, 18, "All three weekly schedules appear in the six-week calendar");
  for (const day of days.filter((day) => day.includes("Early class"))) {
    assert.ok(day.indexOf("Early class") < day.indexOf("Advanced Zouk"), "Sort by start time");
    assert.ok(day.indexOf("Advanced Zouk") < day.indexOf("Zouk basics"), "Break time ties by course name");
  }
  console.log("PASS: Calendar renders current API schedules, including multiple days, empty schedules, and sorted classes.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
