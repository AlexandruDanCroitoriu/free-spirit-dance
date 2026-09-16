import { env } from '../../../lib/storage';
import { readMedia } from '../../../lib/media';

const ownerEmail = 'croitoriu.alexandru.code@gmail.com';
export async function GET(request: Request) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const email = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase() || (local ? ownerEmail : '');
  if (email !== ownerEmail) return Response.json({ error: 'Only the main administrator can view the media library.' }, { status: 403 });
  try {
    const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
    return Response.json(await readMedia(env.DB, env.STUDENT_IMAGES, email, cursor), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Could not load media library', error instanceof Error ? error.name : 'Unknown error');
    return Response.json({ error: 'Could not load media files. Please retry.' }, { status: 500 });
  }
}
