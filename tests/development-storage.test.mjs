import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

const code = stripTypeScriptTypes(readFileSync(new URL('../worker.ts', import.meta.url), 'utf8'))
  .replace('import vinextHandler from "vinext/server/fetch-handler";', '')
  .replace('import { withStorage } from "./app/lib/storage";', '')
  .replace('export default', 'exports.default =');
const exports = {};
vm.runInNewContext(code, { exports, Request, Response, URL, Headers, console,
  withStorage: (_env, callback) => callback(),
  vinextHandler: { fetch: async (request, env) => Response.json(new URL(request.url).pathname === '/api/local-identity-test' ? { email: request.headers.get('cf-access-authenticated-user-email') } : { db: env.DB, images: env.STUDENT_IMAGES }) },
});
const owner = 'croitoriu.alexandru.code@gmail.com';
async function request({ development = true, email = owner, cookie = '', method = 'GET', path = '/api/admin-profile', origin, body, host = 'dev-free-spirit-dance.alexandru-croitoriu.dev' } = {}) {
  return exports.default.fetch(new Request('https://' + host + path, {
    method, headers: { 'cf-access-authenticated-user-email': email, Cookie: cookie, ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { LOCAL_STORAGE_ENABLED: development ? 'true' : undefined, LOCAL_DB: 'local-db', LOCAL_IMAGES: 'local-images',
    DB: 'production-db', STUDENT_IMAGES: 'production-images', PUBLIC_QR_BASE_URL: 'https://go.example.com',
  }, {});
}
test('database and images switch together, defaulting to local only in development', async () => {
  assert.deepEqual(await (await request()).json(), { db: 'local-db', images: 'local-images' });
  assert.deepEqual(await (await request({ cookie: 'fsd-storage=production' })).json(), { db: 'production-db', images: 'production-images' });
  assert.deepEqual(await (await request({ development: false, cookie: 'fsd-storage=local' })).json(), { db: 'production-db', images: 'production-images' });
  assert.equal((await request()).headers.get('Cache-Control'), 'no-store');
});
test('unauthenticated requests and other hostnames cannot select production during development', async () => {
  for (const overrides of [{ email: '' }, { host: 'untrusted.example.com' }]) {
    assert.deepEqual(await (await request({ ...overrides, cookie: 'fsd-storage=production' })).json(), { db: 'local-db', images: 'local-images' });
    assert.deepEqual(await (await request({ ...overrides, path: '/api/development-storage' })).json(), { available: false });
  }
});
test('selection endpoint is unavailable in production and validates same-origin owner updates', async () => {
  const options = { path: '/api/development-storage', method: 'POST', body: { selected: 'production' } };
  assert.equal((await request(options)).status, 403);
  const origin = 'https://dev-free-spirit-dance.alexandru-croitoriu.dev';
  assert.equal((await request({ ...options, origin, body: { selected: 'invalid' } })).status, 400);
  const response = await request({ ...options, origin });
  assert.match(response.headers.get('Set-Cookie'), /fsd-storage=production; Path=\/; HttpOnly; SameSite=Strict; Secure/);
  assert.deepEqual(await (await request({ ...options, origin, development: false })).json(), { available: false });
});

test('request context isolates concurrent imported database and image access', async () => {
  const source = stripTypeScriptTypes(readFileSync(new URL('../app/lib/storage.ts', import.meta.url), 'utf8'))
    .replace('import { env as bindings } from "cloudflare:workers";', 'const bindings = { DB: "production", STUDENT_IMAGES: "production-images" };');
  const { env, withStorage } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const results = await Promise.all(['local', 'production'].map((name) => withStorage(
    { DB: name, STUDENT_IMAGES: name + '-images' },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, name === 'local' ? 10 : 1));
      return [env.DB, env.STUDENT_IMAGES];
    },
  )));
  assert.deepEqual(results, [['local', 'local-images'], ['production', 'production-images']]);
  assert.equal(env.DB, 'production');
});

test('localhost has main administrator identity and can switch without signing in', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const options = { host, email: '' };
    assert.deepEqual(await (await request({ ...options, path: '/api/development-storage' })).json(), { available: true, selected: 'local' });
    assert.deepEqual(await (await request({ ...options, path: '/api/local-identity-test' })).json(), { email: owner });
    assert.deepEqual(await (await request({ ...options, cookie: 'fsd-storage=production' })).json(), { db: 'production-db', images: 'production-images' });
    const response = await request({ ...options, path: '/api/development-storage', method: 'POST', origin: 'https://' + host, body: { selected: 'production' } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie'), /fsd-storage=production/);
    assert.deepEqual(await (await request({ ...options, development: false, path: '/api/local-identity-test' })).json(), { email: '' });
    assert.deepEqual(await (await request({ ...options, development: false, path: '/api/development-storage' })).json(), { available: false });
  }
});

test('other tunnel administrators retain production storage regardless of owner cookies', async () => {
  for (const cookie of ['', 'fsd-storage=local', 'fsd-storage=production']) {
    const options = { email: 'other@example.com', cookie };
    assert.deepEqual(await (await request(options)).json(), { db: 'production-db', images: 'production-images' });
    assert.deepEqual(await (await request({ ...options, path: '/api/development-storage' })).json(), { available: false });
    assert.deepEqual(await (await request({ ...options, path: '/api/development-storage', method: 'POST', origin: 'https://dev-free-spirit-dance.alexandru-croitoriu.dev', body: { selected: 'local' } })).json(), { available: false });
  }
});

test('tunnel page authorization reads granted production permissions instead of empty local permissions', async () => {
  const checkedStores = [];
  const database = (name, students) => ({ prepare: () => ({ bind: () => ({
    run: async () => {},
    first: async () => {
      checkedStores.push(name);
      return { can_students: students, can_courses: 0 };
    },
  }) }) });
  const env = {
    LOCAL_STORAGE_ENABLED: 'true', LOCAL_DB: database('local', 0), LOCAL_IMAGES: 'local-images',
    DB: database('production', 1), STUDENT_IMAGES: 'production-images', PUBLIC_QR_BASE_URL: 'https://go.example.com',
  };
  for (const [path, status] of [['/students', 200], ['/courses', 403], ['/administrators', 403]]) {
    const response = await exports.default.fetch(new Request('https://dev-free-spirit-dance.alexandru-croitoriu.dev' + path, {
      headers: { 'cf-access-authenticated-user-email': 'other@example.com', Cookie: 'fsd-storage=local' },
    }), env, {});
    assert.equal(response.status, status, path);
  }
  assert.deepEqual(checkedStores, ['production', 'production']);
});
