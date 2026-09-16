import { Node } from '@tiptap/react';
import { imageWidth, taskImageView } from './task-image-view';

// Atomic inline nodes keep a student's name and avatar together while editing.
export const TaskStudentMention = Node.create({
  name: 'studentMention', group: 'inline', inline: true, atom: true,
  addAttributes() { return { id: { default: null }, name: { default: '' }, picture: { default: null } }; },
  parseHTML() { return [{ tag: 'span[data-student-mention]', getAttrs: element => ({ id: Number(element.getAttribute('data-student-mention')), name: element.getAttribute('data-student-name') ?? element.textContent, picture: element.querySelector('img')?.getAttribute('src') ?? null }) }]; },
  renderText({ node }) { return String(node.attrs.name); },
  renderHTML({ node }) {
    const name = String(node.attrs.name || 'Student');
    const picture = typeof node.attrs.picture === 'string' && /^\/(?!\/)/.test(node.attrs.picture) ? node.attrs.picture : null;
    return ['span', { 'data-student-mention': String(node.attrs.id), 'data-student-name': name, class: 'task-student-mention', contenteditable: 'false' },
      picture ? ['img', { src: picture, alt: '', loading: 'lazy' }] : ['span', { class: 'task-student-mention-avatar' }, name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')],
      ['span', {}, name]];
  },
});

export const TaskCourseMention = Node.create({
  name: 'courseMention', group: 'inline', inline: true, atom: true,
  addAttributes() { return { id: { default: null }, name: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-course-mention]', getAttrs: element => ({ id: Number(element.getAttribute('data-course-mention')), name: element.getAttribute('data-course-name') ?? element.textContent }) }]; },
  renderText({ node }) { return String(node.attrs.name); },
  renderHTML({ node }) { return ['span', { 'data-course-mention': String(node.attrs.id), 'data-course-name': String(node.attrs.name), class: 'task-student-mention task-course-mention', contenteditable: 'false' }, ['span', { 'aria-hidden': 'true' }, '▤'], ['span', {}, String(node.attrs.name || 'Course')]]; },
});

export const TaskAdministratorMention = Node.create({
  name: 'administratorMention', group: 'inline', inline: true, atom: true,
  addAttributes() { return { id: { default: '' }, name: { default: '' }, picture: { default: null } }; },
  parseHTML() { return [{ tag: 'span[data-administrator-mention]', getAttrs: element => ({ id: element.getAttribute('data-administrator-mention'), name: element.getAttribute('data-administrator-name') ?? element.textContent, picture: element.querySelector('img')?.getAttribute('src') ?? null }) }]; },
  renderText({ node }) { return String(node.attrs.name); },
  renderHTML({ node }) {
    const name = String(node.attrs.name || node.attrs.id || 'Administrator');
    const picture = typeof node.attrs.picture === 'string' && /^\/(?!\/)/.test(node.attrs.picture) ? node.attrs.picture : null;
    return ['span', { 'data-administrator-mention': String(node.attrs.id), 'data-administrator-name': name, class: 'task-student-mention task-administrator-mention', contenteditable: 'false' },
      picture ? ['img', { src: picture, alt: '', loading: 'lazy' }] : ['span', { class: 'task-student-mention-avatar' }, name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')],
      ['span', {}, name]];
  },
});

export const TaskImage = Node.create({
  name: 'taskImage', group: 'block', atom: true, draggable: true,
  addAttributes() { return { id: { default: '' }, width: { default: 100 } }; },
  addNodeView() { return taskImageView; },
  parseHTML() { return [{ tag: 'img[data-task-image]', getAttrs: element => ({ id: element.getAttribute('data-task-image') ?? '', width: Number(element.getAttribute('data-task-image-width')) || 100 }) }]; },
  renderHTML({ node }) {
    const id = String(node.attrs.id);
    const width = imageWidth(node.attrs.width);
    return ['img', { 'data-task-image': id, 'data-task-image-width': String(width), src: `/api/tasks/images/${encodeURIComponent(id)}`, alt: 'Task attachment', loading: 'lazy', class: 'task-description-image', style: `width:${width}%;` }];
  },
});
