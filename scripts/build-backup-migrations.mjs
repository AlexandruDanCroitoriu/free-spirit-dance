import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Split SQL without native SQLite dependencies. Trigger bodies, quoted values
// and comments may contain semicolons that do not end the outer statement.
export function splitStatements(source) {
  const statements = [];
  let start = 0, quote = '', comment = '', tokens = [], depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; index++; } continue; }
    if (quote) {
      if (char === quote) {
        if (next === quote && quote !== ']') index++;
        else quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') { comment = 'line'; index++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; index++; continue; }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
      tokens.push('quoted');
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_0-9]+/.exec(source.slice(index))[0];
      index += word.length - 1;
      const token = word.toUpperCase();
      tokens.push(token);
      const trigger = tokens[0] === 'CREATE' && (tokens[1] === 'TRIGGER' || (['TEMP', 'TEMPORARY'].includes(tokens[1]) && tokens[2] === 'TRIGGER'));
      if (trigger && (token === 'BEGIN' || token === 'CASE')) depth++;
      if (trigger && token === 'END') depth--;
      continue;
    }
    if (char === ';' && depth === 0) {
      if (tokens.length) statements.push(source.slice(start, index + 1).trim());
      start = index + 1;
      tokens = [];
    } else if (!/\s/.test(char) && char !== ';') tokens.push(char);
  }
  if (quote || comment === 'block' || tokens.length || depth) throw new Error('Incomplete SQL statement');
  return statements;
}

async function build() {
  const root = new URL('../', import.meta.url);
  const directory = new URL('migrations/', root);
  const entries = [];
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    try { entries.push({ name, statements: splitStatements(await readFile(new URL(name, directory), 'utf8')) }); }
    catch (error) { throw new Error(`Cannot bundle migration ${name}: ${error.message}`); }
  }
  await writeFile(new URL('app/lib/production-backups/migrations.generated.json', root), JSON.stringify(entries, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
