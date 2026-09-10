import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scripts = readdirSync(new URL("./", import.meta.url)).sort();
const checks = [
  [process.execPath, "--test", ...readdirSync(new URL("../tests/", import.meta.url)).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `tests/${name}`)],
  ...scripts.filter((name) => /^test-.*\.mjs$/.test(name)).map((name) => [process.execPath, `scripts/${name}`]),
  ...scripts.filter((name) => /^(test-|validate-).*\.py$/.test(name)).map((name) => ["python3", `scripts/${name}`]),
];
let failed = 0;
for (const [command, ...args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failed++;
}
console.log(`${checks.length - failed}/${checks.length} test suites passed.`);
process.exitCode = failed ? 1 : 0;
