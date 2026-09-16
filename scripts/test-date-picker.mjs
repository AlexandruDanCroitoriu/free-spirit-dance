import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const result = await build({
  entryPoints: ['app/components/date-picker.tsx'], bundle: true, write: false,
  format: 'esm', platform: 'node', jsx: 'automatic',
});
const { default: DatePicker } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const render = props => renderToStaticMarkup(createElement(DatePicker, { onChange() {}, ...props }));
const html = render({ value: '2026-09-16', required: true, min: '1900-01-01', max: '2026-12-31', autoFocus: true });
for (const expected of ['16 septembrie 2026', 'type="date"', 'value="2026-09-16"', 'required=""', 'min="1900-01-01"', 'max="2026-12-31"', 'autofocus=""']) assert.ok(html.includes(expected), expected);
assert.match(render({ value: '2026-10-09T14:30', type: 'datetime-local' }), /9 octombrie 2026, 14:30/);
assert.match(render({ value: '' }), /Select date/);
assert.match(render({ value: '2024-02-29' }), /29 februarie 2024/);
assert.match(render({ value: '2026-09-16', disabled: true }), /disabled=""/);
assert.match(render({ value: '2026-09-16', readOnly: true, onClear() {} }), /readOnly=""/);
assert.doesNotMatch(render({ value: '2026-09-16', readOnly: true, onClear() {} }), /<button/);
let opened = 0;
const inputOf = props => DatePicker({ value: '', ...props }).props.children.find(child => child?.type === 'input');
const event = { currentTarget: { showPicker() { opened++; } } };
inputOf({}).props.onClick(event);
assert.equal(opened, 1);
inputOf({ readOnly: true }).props.onClick(event);
inputOf({ disabled: true }).props.onClick(event);
assert.equal(opened, 1);
assert.doesNotThrow(() => inputOf({}).props.onClick({ currentTarget: {} }));
assert.doesNotThrow(() => inputOf({}).props.onClick({ currentTarget: { showPicker() { throw new Error('Unsupported'); } } }));
console.log('Date picker tests passed.');
