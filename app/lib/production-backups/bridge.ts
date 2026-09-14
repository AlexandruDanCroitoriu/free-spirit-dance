export const PRODUCTION_ORIGIN = "https://free-spirit-dance.alexandru-croitoriu.dev";
export const BACKUP_ENDPOINT = "/api/administrators/production-backups";
export const BRIDGE_CHANNEL = "fsd-production-backups-v1";
export function allowedDevelopmentOrigin(origin: string) {
  return origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000" || origin === "http://[::1]:3000" || origin === "https://dev-free-spirit-dance.alexandru-croitoriu.dev";
}
export type BackupTransport = (input?: Record<string, unknown>) => Promise<Response>;
export function connectProductionBackups(): { request: BackupTransport; close: () => void } {
  if (!allowedDevelopmentOrigin(window.location.origin)) throw new Error("Connect from the local development site.");
  const nonce = crypto.randomUUID();
  const popup = window.open(`${PRODUCTION_ORIGIN}/administrators?backupBridge=${encodeURIComponent(nonce)}`, "_blank", "width=720,height=620");
  if (!popup) throw new Error("Allow pop-ups for this site, then connect again.");
  const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (event: MessageEvent) => {
    if (event.origin !== PRODUCTION_ORIGIN || event.source !== popup || event.data?.channel !== BRIDGE_CHANNEL || event.data?.nonce !== nonce) return;
    const entry = pending.get(event.data.id);
    if (!entry || typeof event.data.status !== "number" || typeof event.data.body !== "string") return;
    clearTimeout(entry.timer); pending.delete(event.data.id);
    entry.resolve(new Response(event.data.body, { status: event.data.status, headers: { "Content-Type": "application/json" } }));
  };
  window.addEventListener("message", receive);
  return {
    request: (input) => new Promise((resolve, reject) => {
      if (popup.closed) { reject(new Error("The production connection was closed. Connect again.")); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Complete sign-in and approve the connection in the production window, then refresh.")); }, 15000);
      pending.set(id, { resolve, reject, timer });
      popup.postMessage({ channel: BRIDGE_CHANNEL, nonce, id, input }, PRODUCTION_ORIGIN);
    }),
    close: () => {
      window.removeEventListener("message", receive);
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Production disconnected.")); }
      pending.clear(); popup.close();
    },
  };
}
