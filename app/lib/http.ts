// Callers inspect response.ok and provide operation-specific errors.
export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  try { return body ? JSON.parse(body) as T : {} as T; } catch { return {} as T; }
}

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || body === null) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : "The request failed. Please try again.";
    throw new Error(message);
  }
  return body as T;
}
