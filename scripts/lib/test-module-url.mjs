import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// API fixtures replace storage bindings before calling this helper. Resolve the
// pure library imports too, since relative imports cannot resolve from data URLs.
export function moduleUrl(source) {
  const resolved = source.replace(/(['"])(?:\.\.?\/)+(?:lib\/)?(calendar-dates|practice-parties|student-activity)\1/g,
    (_match, _quote, name) => JSON.stringify(moduleUrl(readFileSync(new URL(`../../app/lib/${name}.ts`, import.meta.url), 'utf8'))));
  return 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(resolved)).toString('base64');
}
