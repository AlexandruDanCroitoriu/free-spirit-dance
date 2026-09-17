import type { JSONContent } from '@tiptap/react';

const prefix = 'fsd-rich-text-v1:';
const nodeTypes = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'studentMention', 'courseMention', 'administratorMention', 'eventMention', 'meetingMention', 'taskImage']);
const markTypes = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);
function validNode(node: JSONContent, depth = 0): boolean {
  return !!node && depth < 40 && nodeTypes.has(node.type ?? '')
    && (node.text === undefined || typeof node.text === 'string')
    && (node.content === undefined || (Array.isArray(node.content) && node.content.every(child => validNode(child, depth + 1))))
    && (node.type !== 'taskImage' || (typeof node.attrs?.id === 'string' && /^[0-9a-f-]{36}$/i.test(node.attrs.id)
      && (node.attrs?.width === undefined || (typeof node.attrs.width === 'number' && Number.isFinite(node.attrs.width) && node.attrs.width >= 10 && node.attrs.width <= 100))))
    && (node.marks === undefined || (Array.isArray(node.marks) && node.marks.every(mark => markTypes.has(mark.type)
      && (mark.type !== 'link' || (typeof mark.attrs?.href === 'string' && /^(https?:\/\/|mailto:)/i.test(mark.attrs.href))))));
}
export function descriptionDocument(value: string): JSONContent {
  if (value.startsWith(prefix)) {
    try {
      const document = JSON.parse(value.slice(prefix.length));
      if (document?.type === 'doc' && Array.isArray(document.content) && validNode(document)) return document;
    } catch { /* Preserve older plain text, including malformed JSON. */ }
  }
  return { type: 'doc', content: value.split('\n').map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) };
}

export function serializeDescription(document: JSONContent, empty: boolean) {
  return empty ? '' : prefix + JSON.stringify(document);
}

export function descriptionLinks(value: string) {
  const studentIds = new Set<number>(), courseIds = new Set<number>(), eventIds = new Set<number>(), meetingIds = new Set<number>();
  const administratorEmails = new Set<string>();
  function visit(node: JSONContent) {
    const id = node.attrs?.id;
    if (node.type === 'administratorMention' && typeof id === 'string') administratorEmails.add(id.trim().toLowerCase());
    if (Number.isSafeInteger(id) && id > 0) {
      if (node.type === 'studentMention') studentIds.add(id);
      if (node.type === 'courseMention') courseIds.add(id);
      if (node.type === 'eventMention') eventIds.add(id);
      if (node.type === 'meetingMention') meetingIds.add(id);
    }
    node.content?.forEach(visit);
  }
  visit(descriptionDocument(value));
  return { studentIds: [...studentIds], courseIds: [...courseIds], eventIds: [...eventIds], meetingIds: [...meetingIds], administratorEmails: [...administratorEmails] };
}
