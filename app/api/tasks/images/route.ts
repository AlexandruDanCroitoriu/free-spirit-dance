import { env } from '../../../lib/storage';
import { taskAccess, taskHandler, taskJson } from '../../../lib/tasks-server';
import { TaskError } from '../../../lib/tasks';

const maxImageBytes = 250_000;

export async function POST(request: Request) {
  return taskHandler(async () => {
    const email = await taskAccess(request);
    if (request.headers.get('Origin') !== new URL(request.url).origin) throw new TaskError('Cross-origin uploads are not allowed.', 403);
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.type.startsWith('image/')) throw new TaskError('Choose an image file.');
    if (file.size > maxImageBytes) throw new TaskError('The compressed image is too large.');
    const id = crypto.randomUUID(), objectKey = `task-images/${id}.jpg`;
    await env.STUDENT_IMAGES.put(objectKey, file.stream(), { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' } });
    try {
      await env.DB.prepare("INSERT INTO task_images(id, owner_email, object_key, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), datetime('now', '+24 hours'))")
        .bind(id, email, objectKey).run();
    } catch (error) {
      await env.STUDENT_IMAGES.delete(objectKey).catch(() => undefined);
      throw error;
    }
    return taskJson({ id, src: `/api/tasks/images/${id}` }, 201);
  });
}
