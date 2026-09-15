import assert from 'node:assert/strict';
import { splitStatements } from './build-backup-migrations.mjs';

const trigger = `-- A trigger containing nested SQL and CASE expressions
CREATE TEMP TRIGGER example AFTER INSERT ON items BEGIN
  SELECT CASE WHEN NEW.id = 1 THEN 'END; it''s quoted' ELSE 'BEGIN;' END;
  /* END; */ SELECT 2;
END;`;
assert.deepEqual(splitStatements(`${trigger}\nSELECT "a;b" FROM [c;d]; -- trailing comment`), [trigger, 'SELECT "a;b" FROM [c;d];']);
assert.deepEqual(splitStatements('-- comment only\n/* more; */'), []);
assert.deepEqual(splitStatements('SELECT 1; SELECT 2;'), ['SELECT 1;', 'SELECT 2;']);
for (const sql of ['SELECT 1', "SELECT 'unfinished;", '/* unfinished', 'CREATE TRIGGER t AFTER INSERT ON x BEGIN SELECT 1;']) {
  assert.throws(() => splitStatements(sql), /Incomplete/);
}
console.log('PASS: migration bundler handles triggers, CASE, quotes, comments and incomplete SQL.');
