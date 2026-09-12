import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const directory = resolve(".wrangler/courses-render-test");
await mkdir(directory, { recursive: true });
const source = await readFile("app/courses/page.tsx", "utf8");
try {
  for (const index of [0,1]) {
    const fixture = source
      .replace("[formOpen, setFormOpen] = useState(false)", "[formOpen, setFormOpen] = useState(true)")
      .replace("useState<number | null>(null)", `useState<number | null>(${index === 0 ? "null" : "1"})`);
    const outfile = resolve(directory, `page-${index}.mjs`);
    await build({
      stdin: { contents: fixture, resolveDir: resolve("app/courses"), loader: "tsx" },
      outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
    });
    const { default: Page } = await import(pathToFileURL(outfile).href);
    const html = renderToString(createElement(Page));
    assert.match(html, /<dialog/);
    assert.match(html, index === 0 ? /Add course/ : /Edit course/);
    assert.match(html, /Days of the week/);
    assert.match(html, /Start time/);
    assert.match(html, /End time/);
    assert.doesNotMatch(html, /Add class/);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 7);
    assert.match(html, /Course payment preset/);
    assert.match(html, /Luni/);
    assert.match(html, /Duminică/);
    assert.doesNotMatch(html, /type="time"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, />18:00<\/span>/);
    assert.match(html, />19:00<\/span>/);
    assert.doesNotMatch(html, /<option[^>]*>\s*<\/option>/);
    if (index === 1) assert.match(html, /Delete course/);
    else assert.doesNotMatch(html, /Delete course/);
    assert.doesNotMatch(html, /role="alert"/);
  }
  console.log("PASS: Add and Edit course panels render schedule controls without errors.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
