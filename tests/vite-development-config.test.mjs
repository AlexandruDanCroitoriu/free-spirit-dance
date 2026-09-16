import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const source = stripTypeScriptTypes(readFileSync('vite.config.ts', 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', 'exports.config = '));
const exports = {};
vm.runInNewContext(source, {
  exports, defineConfig: callback => callback, vinext: () => ({}), cloudflare: options => options,
  cdnAdapter: () => ({}), imagesOptimizer: () => ({}),
  localStorage: JSON.parse(readFileSync('wrangler.local.json', 'utf8')),
});
test('development replaces cloud-only secret requirements and lets the plugin merge bindings once', () => {
  const original = { secrets: { required: ['BACKUP_API_TOKEN', 'LOCAL_BACKUP_BRIDGE_SECRET'] }, d1_databases: [{ binding: 'DB' }], r2_buckets: [{ binding: 'STUDENT_IMAGES' }] };
  const override = exports.config({ command: 'serve' }).plugins[1].config(original);
  assert.deepEqual(Array.from(original.secrets.required), ['CLOUDFLARE_ACCESS_CLIENT_ID', 'CLOUDFLARE_ACCESS_CLIENT_SECRET', 'LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET']);
  assert.equal(override.secrets, undefined, 'Returning the list would concatenate it again');
  assert.equal(override.d1_databases.some(binding => binding.binding === 'DB'), false);
  assert.equal(override.r2_buckets.some(binding => binding.binding === 'STUDENT_IMAGES'), false);
});
test('production builds retain their cloud secret requirements', () => {
  const original = { secrets: { required: ['BACKUP_API_TOKEN', 'LOCAL_BACKUP_BRIDGE_SECRET'] } };
  exports.config({ command: 'build' }).plugins[1].config(original);
  assert.deepEqual(original.secrets.required, ['BACKUP_API_TOKEN', 'LOCAL_BACKUP_BRIDGE_SECRET']);
});
