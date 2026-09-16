import type { NodeViewRenderer } from '@tiptap/react';

export function imageWidth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(10, Math.min(100, value)) : 100;
}

export const taskImageView: NodeViewRenderer = ({ node: initialNode, editor, getPos }) => {
  let node = initialNode;
  const dom = document.createElement('div');
  dom.className = 'task-image-frame';
  dom.contentEditable = 'false';
  const image = document.createElement('img');
  image.alt = 'Task attachment';
  image.className = 'task-description-image';
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'task-image-resize';
  handle.setAttribute('aria-label', 'Resize image');
  handle.title = 'Drag to resize. Use arrow keys for smaller adjustments.';
  dom.appendChild(image);
  dom.appendChild(handle);
  let drag: { pointer: number; x: number; width: number; container: number; preview: number } | null = null;
  // The image node itself can be moved in the document. Resizing must not
  // start the browser's native drag operation, which cancels pointer events.
  dom.addEventListener('dragstart', event => { if (drag) event.preventDefault(); });
  const render = () => {
    dom.style.width = `${imageWidth(node.attrs.width)}%`;
    image.src = `/api/tasks/images/${encodeURIComponent(String(node.attrs.id))}`;
    handle.hidden = !editor.isEditable;
  };
  const commit = (width: number) => {
    const pos = getPos();
    if (!editor.isEditable || typeof pos !== 'number') return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width }));
  };
  handle.addEventListener('pointerdown', event => {
    if (!editor.isEditable || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const container = dom.parentElement?.getBoundingClientRect().width ?? 0;
    if (!container) return;
    drag = { pointer: event.pointerId, x: event.clientX, width: dom.getBoundingClientRect().width, container, preview: imageWidth(node.attrs.width) };
    handle.setPointerCapture(event.pointerId);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    dom.classList.add('resizing');
  });
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.preview = Math.round(imageWidth((drag.width + event.clientX - drag.x) / drag.container * 100));
    dom.style.width = `${drag.preview}%`;
  };
  const cleanup = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', finish);
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const width = drag.preview;
    drag = null;
    cleanup();
    dom.classList.remove('resizing');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (event.type === 'pointerup') commit(width);
    else render();
  };
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const delta = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1;
    commit(imageWidth(imageWidth(node.attrs.width) + delta * (event.shiftKey ? 10 : 1)));
  });
  render();
  return {
    dom,
    update(next) { if (next.type !== node.type) return false; node = next; if (!drag) render(); return true; },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    stopEvent(event) { return event.target === handle; },
    ignoreMutation() { return true; },
    destroy() { cleanup(); drag = null; },
  };
};
