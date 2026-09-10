import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync("migrations/" + name, "utf8"));
function prepare(sql) {
  let values = [];
  const statement = {
    bind(...args) { values = args; return statement; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { return statement.execute(); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    execute() {
      const query = sqlite.prepare(sql);
      const results = query.columns().length ? query.all(...values) : (query.run(...values), []);
      return { results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
    },
  };
  return statement;
}
const db = {
  prepare,
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
globalThis.activityTestEnv = { DB: db };
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}


const api=await import(moduleUrl(readFileSync('app/api/students/route.ts','utf8').replace('import { env } from "cloudflare:workers";','const env = globalThis.activityTestEnv;')));
const req=(email)=>new Request('https://school.test/api/students',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:'Test',lastName:'Student',email,phone:'',picture:null,active:true})});
assert.equal((await api.POST(req(''))).status,201);
assert.equal((await api.POST(req('   '))).status,201);
assert.equal((await api.POST(req('invalid'))).status,400);
assert.equal((await api.POST(req('test@example.com'))).status,201);
assert.equal((await api.POST(req('test@example.com'))).status,409);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM students WHERE email=''").get().n,2);
console.log('PASS: multiple students without email, invalid email rejection and duplicate email protection.');
