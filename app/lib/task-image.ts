import type { JSONContent } from '@tiptap/react';
import { env } from './storage';

export const taskImageExpiryHours = 24;

export function descriptionImageIds(document: JSONContent): string[] {
  const ids = new Set<string>();
  const visit = (node: JSONContent) => {
    if (node.type === 'taskImage' && typeof node.attrs?.id === 'string' && /^[0-9a-f-]{36}$/i.test(node.attrs.id)) ids.add(node.attrs.id);
    node.content?.forEach(visit);
  };
  visit(document);
  return [...ids];
}

export async function deleteQueuedTaskImages(limit = 100) {
  const queued = await env.DB.prepare('SELECT object_key AS objectKey FROM task_image_deletions ORDER BY created_at LIMIT ?').bind(limit).all<{ objectKey: string }>();
  for (const item of queued.results) {
    try {
      await env.STUDENT_IMAGES.delete(item.objectKey);
      await env.DB.prepare('DELETE FROM task_image_deletions WHERE object_key = ?').bind(item.objectKey).run();
    } catch (error) { console.error('Could not delete queued task image', error); }
  }
}

export async function removeExpiredTaskImages() {
  await env.DB.prepare("DELETE FROM task_images WHERE task_id IS NULL AND expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  await deleteQueuedTaskImages();
}
