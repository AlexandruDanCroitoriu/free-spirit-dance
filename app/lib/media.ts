export type MediaUsage = { label: string; href: string | null };
export type MediaFile = { key: string; size: number; uploaded: string; contentType: string | null; preview: string | null; usages: MediaUsage[] };
export type MediaPage = { files: MediaFile[]; cursor: string | null };

export async function readMedia(db: D1Database, bucket: R2Bucket, email: string, cursor?: string): Promise<MediaPage> {
  // Bound both the response and D1's bind count; R2 may return fewer than requested.
  const page = await bucket.list({ limit: 50, cursor, include: ['httpMetadata'] });
  const files: MediaFile[] = page.objects.map(object => ({ key: object.key, size: object.size,
    uploaded: object.uploaded.toISOString(), contentType: object.httpMetadata?.contentType ?? null,
    preview: null, usages: [] }));
  if (!files.length) return { files, cursor: page.truncated ? page.cursor : null };
  const byKey = new Map(files.map(file => [file.key, file]));
  const keys = files.map(file => file.key), placeholders = keys.map(() => '?').join(',');
  const pictures = keys.map(key => `/api/student-images/${encodeURIComponent(key)}`);
  const qrPictures = keys.map(key => `/api/qr-code-images/${encodeURIComponent(key)}`);
  type PictureRow = { picture: string; label: string; id: number };
  type TaskRow = { object_key: string; id: string; task_id: number | null; title: string; visible: number };
  const results = await db.batch([
    db.prepare(`SELECT picture, trim(first_name || ' ' || last_name) AS label, id FROM students WHERE picture IN (${placeholders})`).bind(...pictures),
    db.prepare(`SELECT picture, CASE WHEN name = '' THEN email ELSE name END AS label FROM admin_profiles WHERE picture IN (${placeholders})`).bind(...pictures),
    db.prepare(`SELECT image_path AS picture, name AS label, id FROM qr_codes WHERE image_path IN (${placeholders})`).bind(...qrPictures),
    db.prepare(`SELECT i.object_key, i.id, i.task_id, t.title,
      (i.task_id IS NULL AND i.owner_email = ? OR i.task_id IS NOT NULL AND
       (t.inbox_owner = ? OR (t.inbox_owner IS NULL AND (b.owner_email IS NULL OR b.owner_email = ?)))) AS visible
      FROM task_images i LEFT JOIN manual_tasks t ON t.id = i.task_id
      LEFT JOIN task_lists l ON l.id = t.list_id LEFT JOIN task_boards b ON b.id = l.board_id
      WHERE i.object_key IN (${placeholders})`).bind(email, email, email, ...keys),
    db.prepare(`SELECT object_key FROM task_image_deletions WHERE object_key IN (${placeholders})`).bind(...keys),
  ]);
  for (let index = 0; index < 3; index++) {
    for (const row of results[index].results as PictureRow[]) {
      const key = decodeURIComponent(row.picture.slice(row.picture.lastIndexOf('/') + 1));
      const file = byKey.get(key);
      if (!file) continue;
      file.preview = row.picture;
      file.usages.push({ label: `${['Student', 'Administrator', 'QR code'][index]} · ${row.label}`,
        href: index === 0 ? `/students/${row.id}` : index === 1 ? '/administrators' : '/qr-codes' });
    }
  }
  for (const row of results[3].results as TaskRow[]) {
    const file = byKey.get(row.object_key)!;
    // Inventory access must not disclose another administrator's personal tasks.
    file.preview = row.visible ? `/api/tasks/images/${row.id}` : null;
    file.usages.push({ label: row.task_id === null ? 'Temporary task upload' : row.visible ? `Task · ${row.title}` : 'Private task',
      href: row.task_id !== null && row.visible ? `/tasks?task=${encodeURIComponent(`manual:${row.task_id}`)}` : null });
  }
  for (const row of results[4].results as { object_key: string }[]) {
    byKey.get(row.object_key)!.usages.push({ label: 'Pending deletion', href: null });
  }
  for (const file of files) {
    if (!file.usages.length && /^(student-|admin-|qr-)[^/]+$/.test(file.key)) {
      file.preview = `/api/${file.key.startsWith('qr-') ? 'qr-code-images' : 'student-images'}/${encodeURIComponent(file.key)}`;
    }
  }
  return { files, cursor: page.truncated ? page.cursor : null };
}
