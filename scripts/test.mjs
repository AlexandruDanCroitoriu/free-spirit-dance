import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scripts = readdirSync(new URL("./", import.meta.url)).sort();
const browserScripts = new Set(['test-task-image-resize.mjs', 'test-task-settings-mobile.mjs', 'test-task-touch.mjs', 'test-task-ui-browser.mjs']);
const browserOnly = process.argv.includes('--browser');
if (browserOnly && !process.env.TASK_UI_CHROME) {
  console.error('Browser tests require TASK_UI_CHROME pointing to an installed Chromium executable.');
  process.exit(1);
}
const checks = browserOnly ? [...browserScripts].map(name => [process.execPath, `scripts/${name}`]) : [
  [process.execPath, "--test", ...readdirSync(new URL("../tests/", import.meta.url)).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `tests/${name}`)],
  ...scripts.filter((name) => /^test-.*\.mjs$/.test(name) && !browserScripts.has(name)).map((name) => [process.execPath, `scripts/${name}`]),
  ...scripts.filter((name) => /^(test-|validate-).*\.py$/.test(name)).map((name) => ["python3", `scripts/${name}`]),
];
let failed = 0;
for (const [command, ...args] of checks) {
  console.log(`Running ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", timeout: 120_000 });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed++;
}
console.log(`${checks.length - failed}/${checks.length} test suites passed.`);
if (!browserOnly) console.log('Browser acceptance tests run separately with npm run test:browser.');
process.exitCode = failed ? 1 : 0;
