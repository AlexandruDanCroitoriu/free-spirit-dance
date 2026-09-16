import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

async function load(path) {
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' })).toString('base64'));
}
const { readMedia } = await load('app/lib/media.ts');
const { prefixedImages } = await load('app/lib/production-backups/cloud.ts');
const object = key => ({ key, size: 1200, uploaded: new Date('2026-09-16T00:00:00Z'), httpMetadata: { contentType: 'image/jpeg' }, writeHttpMetadata() {} });

test('inventory resolves shared photos, QR images, task privacy, drafts and deletion state using SQLite', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE students(id INTEGER, first_name TEXT, last_name TEXT, picture TEXT);
    CREATE TABLE admin_profiles(email TEXT, name TEXT, picture TEXT);
    CREATE TABLE qr_codes(id INTEGER, name TEXT, image_path TEXT);
    CREATE TABLE task_images(id TEXT, task_id INTEGER, owner_email TEXT, object_key TEXT);
    CREATE TABLE manual_tasks(id INTEGER, title TEXT, inbox_owner TEXT, list_id INTEGER);
    CREATE TABLE task_lists(id INTEGER, board_id INTEGER);
    CREATE TABLE task_boards(id INTEGER, owner_email TEXT);
    CREATE TABLE task_image_deletions(object_key TEXT);
    INSERT INTO students VALUES (1, 'Test', 'Student', '/api/student-images/student-shared.jpg'), (2, 'Other', 'Student', '/api/student-images/student-shared.jpg');
    INSERT INTO admin_profiles VALUES ('owner@example.com', 'Admin', '/api/student-images/student-shared.jpg');
    INSERT INTO qr_codes VALUES (1, 'School QR', '/api/qr-code-images/qr-logo.jpg');
    INSERT INTO task_boards VALUES (1, NULL), (2, 'other@example.com'), (3, 'owner@example.com');
    INSERT INTO task_lists VALUES (1, 1), (2, 2), (3, 3);
    INSERT INTO manual_tasks VALUES (1, 'School task', NULL, 1), (2, 'SECRET personal', NULL, 2), (3, 'SECRET inbox', 'other@example.com', NULL), (4, 'My personal task', NULL, 3);
    INSERT INTO task_images VALUES ('school', 1, 'other@example.com', 'task-images/school.jpg'), ('private', 2, 'other@example.com', 'task-images/private.jpg'), ('inbox', 3, 'other@example.com', 'task-images/inbox.jpg'), ('mine', 4, 'owner@example.com', 'task-images/mine.jpg'), ('draft', NULL, 'owner@example.com', 'task-images/draft.jpg'), ('other-draft', NULL, 'other@example.com', 'task-images/other-draft.jpg');
    INSERT INTO task_image_deletions VALUES ('task-images/deleted.jpg');
  `);
  const db = { prepare(sql) { return { bind(...args) { return { sql, args }; } }; }, async batch(statements) { return statements.map(({sql, args}) => ({ results: sqlite.prepare(sql).all(...args) })); } };
  const keys = ['student-shared.jpg', 'qr-logo.jpg', 'student-unused.jpg', ...['school', 'private', 'inbox', 'mine', 'draft', 'other-draft', 'deleted'].map(name => `task-images/${name}.jpg`)];
  const bucket = { async list(options) { assert.equal(options.cursor, 'previous'); assert.equal(options.limit, 50); return { objects: keys.map(object), truncated: true, cursor: 'next' }; } };
  const result = await readMedia(db, bucket, 'owner@example.com', 'previous');
  const files = Object.fromEntries(result.files.map(file => [file.key, file]));
  assert.equal(result.cursor, 'next');
  assert.equal(files['student-shared.jpg'].usages.length, 3);
  assert.equal(files['qr-logo.jpg'].usages[0].label, 'QR code · School QR');
  assert.equal(files['student-unused.jpg'].usages.length, 0);
  assert.equal(files['student-unused.jpg'].preview, '/api/student-images/student-unused.jpg');
  assert.equal(files['task-images/school.jpg'].usages[0].href, '/tasks?task=manual%3A1');
  assert.equal(files['task-images/mine.jpg'].preview, '/api/tasks/images/mine');
  for (const key of ['private', 'inbox']) {
    assert.equal(files[`task-images/${key}.jpg`].preview, null);
    assert.deepEqual(files[`task-images/${key}.jpg`].usages, [{ label: 'Private task', href: null }]);
  }
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(files['task-images/draft.jpg'].usages[0].label, 'Temporary task upload');
  assert.equal(files['task-images/other-draft.jpg'].preview, null);
  assert.equal(files['task-images/deleted.jpg'].usages[0].label, 'Pending deletion');
  sqlite.close();
});

test('empty short R2 pages retain continuation without querying D1', async () => {
  const result = await readMedia({}, { list: async () => ({ objects: [], truncated: true, cursor: 'more' }) }, 'owner');
  assert.deepEqual(result, { files: [], cursor: 'more' });
});

test('working image listing scopes keys, prefixes and continuation to the active copy', async () => {
  const bucket = { async list(options) {
    assert.deepEqual(options, { limit: 50, cursor: 'opaque', prefix: 'working/a/', startAfter: 'working/a/student-a.jpg' });
    return { objects: [object('working/a/student-b.jpg'), object('working/b/private.jpg')], truncated: true, cursor: 'next', delimitedPrefixes: ['working/a/task-images/', 'working/b/'] };
  } };
  const result = await prefixedImages(bucket, 'working/a/').list({ limit: 50, cursor: 'opaque', startAfter: 'student-a.jpg' });
  assert.deepEqual(result.objects.map(item => item.key), ['student-b.jpg']);
  assert.deepEqual(result.delimitedPrefixes, ['task-images/']);
  assert.equal(result.cursor, 'next');
  assert.equal(result.objects[0].size, 1200);
});
