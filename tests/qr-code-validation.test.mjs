import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = stripTypeScriptTypes(readFileSync(new URL("../app/lib/qr-codes.ts", import.meta.url), "utf8"));
const { validate } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const input = {
  name: "Class signup", destinationUrl: "https://example.test/signup", imageMode: "none",
  moduleShape: "square", foregroundColor: "#000000", eyeShape: "rounded",
  logoSize: 20, logoShape: "circle", advancedStyle: { eyeColor: "#000000" },
};

test("QR creation defaults active state; updates must explicitly provide it", () => {
  assert.equal(validate(input), null);
  assert.equal(validate(input, true), "Active state is required.");
  assert.equal(validate({ ...input, active: false }, true), null);
});

test("both QR operations reject unsafe destinations and malformed styles", () => {
  for (const requireActive of [false, true]) {
    for (const change of [
      { destinationUrl: "javascript:alert(1)" },
      { destinationUrl: "https://user:password@example.test" },
      { foregroundColor: "red" }, { advancedStyle: null }, { logoSize: 31 },
    ]) assert.equal(typeof validate({ ...input, active: true, ...change }, requireActive), "string");
  }
});
