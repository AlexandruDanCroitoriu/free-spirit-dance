import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

// Exercise the Worker boundary while replacing only the downstream app handler.
const code = stripTypeScriptTypes(readFileSync(new URL('../worker.ts', import.meta.url), 'utf8'))
  .replace('import vinextHandler from "vinext/server/fetch-handler";', '')
  .replace('import { withStorage } from "./app/lib/storage";', '')
  .replace('export default', 'exports.default =');
const exports = {};
vm.runInNewContext(code, { exports, Request, Response, URL, console,
  vinextHandler: { fetch: async () => new Response('app') },
});
async function request(path, { qr = 0, email = 'admin@example.com', host = 'admin.example.com' } = {}) {
  const env = { PUBLIC_QR_BASE_URL: 'https://go.example.com', DB: {
    prepare: () => ({ bind: () => ({ run: async () => {}, first: async () => ({
      can_dashboard: 0, can_students: 0, can_courses: 0, can_qr_codes: qr,
    }) }) }),
  } };
  return exports.default.fetch(new Request(`https://${host}${path}`, {
    headers: email ? { 'cf-access-authenticated-user-email': email } : {},
  }), env, {});
}
test('QR page and management APIs require QR permission independently', async () => {
  for (const path of ['/qr-codes', '/qr-codes/', '/api/qr-codes', '/api/qr-codes/1', '/api/qr-codes/1/image']) {
    assert.equal((await request(path)).status, 403, path);
    assert.equal((await request(path, { qr: 1 })).status, 200, path);
    assert.equal((await request(path, { email: '' })).status, 403, path);
  }
  assert.equal((await request('/api/students', { qr: 1 })).status, 403);
  assert.equal((await request('/api/administrators', { qr: 1 })).status, 403);
});
test('authenticated administrators can access images with no page permissions', async () => {
  for (const path of ['/api/student-images/avatar.webp', '/api/qr-code-images/logo.webp', '/api/admin-profile/image']) {
    assert.equal((await request(path)).status, 200, path);
    assert.equal((await request(path, { host: 'go.example.com' })).status, 404, path);
  }
});
test('owner and local development keep access; public redirects still work', async () => {
  assert.equal((await request('/qr-codes', { email: 'croitoriu.alexandru.code@gmail.com' })).status, 200);
  assert.equal((await request('/qr-codes', { email: '', host: 'localhost' })).status, 200);
  assert.equal((await request('/s/example', { email: '', host: 'go.example.com' })).status, 200);
});

test('payment transfer records require student permission and stay off the public host', async () => {
  const path = '/api/students/payments';
  assert.equal((await request(path)).status, 403);
  assert.equal((await request(path, { email: '' })).status, 403);
  assert.equal((await request(path, { host: 'go.example.com' })).status, 404);
  assert.equal((await request(path, { email: 'croitoriu.alexandru.code@gmail.com' })).status, 200);
});
