import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const result = await build({ entryPoints: ['app/components/task-card.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic' });
const { default: Card } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const assigneeCard = (assignedTo, administrator) => renderToStaticMarkup(createElement(Card, {
  task: { title: 'Assigned task', dueDate: null, students: [], assignedTo }, administrator,
  today: '2026-09-16', disabled: false, onEdit() {}, onStudent() {},
}));
const administrator = { email: 'alex@example.com', name: 'Alex Admin', picture: '/api/administrators/alex/picture' };
const assignedCard = assigneeCard(administrator.email, administrator);
assert.match(assignedCard, /Assigned administrator: Alex Admin/);
assert.match(assignedCard, /src="\/api\/administrators\/alex\/picture"/);
assert.match(assignedCard, /draggable="false"/);
assert.match(assigneeCard(administrator.email, { ...administrator, picture: null }), />AA<\/span>/);
assert.match(assigneeCard(administrator.email), /Assigned administrator: alex@example.com/);
assert.doesNotMatch(assigneeCard(null, administrator), /Assigned administrator:/);
console.log('Task card assignee tests passed.');
