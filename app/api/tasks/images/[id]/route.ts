import { env } from '../../../../lib/storage';
import { taskAccess, taskHandler } from '../../../../lib/tasks-server';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return taskHandler(async () => {
    const email = await taskAccess(request), id = (await context.params).id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
    const image = await env.DB.prepare(`SELECT i.object_key AS objectKey FROM task_images i
      LEFT JOIN manual_tasks t ON t.id = i.task_id LEFT JOIN task_lists l ON l.id = t.list_id LEFT JOIN task_boards b ON b.id = l.board_id
      WHERE i.id = ? AND (i.task_id IS NULL AND i.owner_email = ? OR i.task_id IS NOT NULL AND
        (t.inbox_owner = ? OR (t.inbox_owner IS NULL AND (b.owner_email IS NULL OR b.owner_email = ?))))`)
      .bind(id, email, email, email).first<{ objectKey: string }>();
    if (!image) return new Response('Not found', { status: 404 });
    const object = await env.STUDENT_IMAGES.get(image.objectKey);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers({ 'Cache-Control': 'private, max-age=3600', etag: object.httpEtag });
    object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  });
}
