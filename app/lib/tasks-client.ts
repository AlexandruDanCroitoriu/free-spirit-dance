export class TaskRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
// Keep the HTTP status so editors can preserve drafts on a stale-board response.
export async function taskRequest<T>(url: string, method = 'GET', body?: object): Promise<T> {
  const response = await fetch(url, { method, cache: 'no-store', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new TaskRequestError(data?.error ?? 'Could not complete the task request.', response.status);
  if (data === null || typeof data !== 'object') throw new Error('The server returned an unexpected response. Refresh or retry to confirm the result.');
  return data;
}
