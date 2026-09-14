"use client";
import { useEffect, useState } from "react";
import { allowedDevelopmentOrigin, BACKUP_ENDPOINT, BRIDGE_CHANNEL, PRODUCTION_ORIGIN } from "../lib/production-backups/bridge";

export default function ProductionBackupBridge() {
  const [connected, setConnected] = useState(false);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const nonce = new URL(window.location.href).searchParams.get("backupBridge");
    if (window.location.origin !== PRODUCTION_ORIGIN || !nonce || !window.opener) return;
    const receive = async (event: MessageEvent) => {
      if (!allowedDevelopmentOrigin(event.origin) || event.source !== window.opener || event.data?.channel !== BRIDGE_CHANNEL || event.data?.nonce !== nonce || typeof event.data.id !== "string") return;
      setOrigin(event.origin);
      if (!connected) return;
      const { id, input } = event.data;
      if (input !== undefined && (input === null || typeof input !== "object" || JSON.stringify(input).length > 4096)) return;
      try {
        const response = await fetch(BACKUP_ENDPOINT, input === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        const body = await response.text();
        // The production API still checks the signed-in owner and same-origin POST.
        window.opener.postMessage({ channel: BRIDGE_CHANNEL, nonce, id, status: response.status, body }, event.origin);
      } catch { setError("Production request failed. Retry from the development card."); }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [connected]);
  return <main className="mx-auto max-w-xl p-8 font-sans text-slate-800"><h1 className="font-serif text-2xl">Connect live production backups</h1><p className="mt-4">This window lets your development app manage real production backups using your signed-in administrator account.</p><p className="mt-3 font-semibold text-amber-900">Creating, switching, scheduling, and deleting here affect live production. Switching changes the database for every administrator.</p><p className="mt-4">Development site: {origin || "Waiting for the development window…"}</p>{error && <p role="alert" className="text-red-800">{error}</p>}<button className="mt-5 rounded bg-slate-800 px-4 py-3 text-white disabled:opacity-50" disabled={!origin || connected} onClick={() => setConnected(true)}>{connected ? "Connected — keep this window open" : "Allow this connection"}</button>{connected && <button className="ml-3 rounded border px-4 py-3" onClick={() => { setConnected(false); window.close(); }}>Disconnect</button>}</main>;
}
