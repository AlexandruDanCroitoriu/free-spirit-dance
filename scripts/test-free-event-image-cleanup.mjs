import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
const deleted = [];
globalThis.freeEventTestEnv = {
  DB: { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    };
  } },
  STUDENT_IMAGES: { async delete(key) {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM free_events WHERE image_path = ?').get(`/api/free-event-images/${key}`).n, 0);
    deleted.push(key);
  } },
};
try {
  const output = await build({
    entryPoints: ['app/lib/free-events-server.ts'], write: false, bundle: true, format: 'esm', platform: 'node',
    plugins: [{ name: 'test-environment', setup(context) {
      context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.freeEventTestEnv;', loader: 'ts' }));
      context.onLoad({ filter: /app\/lib\/practice-parties-server\.ts$/ }, () => ({ contents: `
        export class EventError extends Error {}
        export const eventAccess = async () => ({email:'admin@example.test'});
        export const eventJson = (body, status=200) => Response.json(body, {status});
        export const positiveId = value => value;
        export const eventHandler = handler => handler();
      `, loader: 'ts' }));
    } }],
  });
  const { createOrUpdateEvent } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  const key = n => `free-event-00000000-0000-4000-8000-${String(n).padStart(12, '0')}.jpg`;
  const path = n => `/api/free-event-images/${key(n)}`;
  const draft = imagePath => ({name:'Event',startsOn:'',endsOn:'',imagePath});
  async function mutate(id, action, event, revision) {
    const current = id ? db.prepare('SELECT revision FROM free_events WHERE id=?').get(id)?.revision : undefined;
    const response = await createOrUpdateEvent(new Request('https://school.test/api/free-events', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,event,revision:revision ?? current}),
    }), id);
    return response.json();
  }
  const {id} = await mutate(undefined, 'create', draft(path(1)));
  await mutate(id, 'update', {...draft(path(1)),name:'Renamed'});
  assert.deepEqual(deleted, [], 'A name change keeps the current image');
  await assert.rejects(mutate(id, 'update', draft(path(2)), -1));
  assert.deepEqual(deleted, [], 'A rejected save keeps the old image');
  await mutate(id, 'update', draft(path(2)));
  assert.deepEqual(deleted, [key(1)], 'Replacing deletes the previous image');
  await mutate(id, 'update', draft(null));
  assert.deepEqual(deleted, [key(1),key(2)], 'Removing deletes the previous image');
  await mutate(id, 'update', draft(path(3)));
  const shared = await mutate(undefined, 'create', draft(path(3)));
  await mutate(id, 'delete');
  assert.deepEqual(deleted, [key(1),key(2)], 'Shared images remain');
  await mutate(shared.id, 'delete');
  assert.deepEqual(deleted, [key(1),key(2),key(3)], 'Deleting the last event deletes its image');
  const unrelated = await mutate(undefined, 'create', draft('/api/free-event-images/student-private.jpg'));
  await mutate(unrelated.id, 'delete');
  assert.equal(deleted.length, 3, 'Never delete non-event image keys');
  console.log('PASS: event image replacement, removal, deletion, rejected saves, shared images, and student-image protection.');
} finally {
  db.close();
  delete globalThis.freeEventTestEnv;
}
