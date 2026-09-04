"use client";

import { useEffect, useState } from "react";

type Administrator = { email: string; dashboard: boolean; students: boolean; courses: boolean };
type ApiError = { error?: string };
const permissionFields = [["dashboard", "Dashboard"], ["students", "Students"], ["courses", "Courses"]] as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

export default function AdministratorsPage() {
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/administrators").then(async (response) => {
      const data = await readJson<Administrator[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load administrators.");
      setAdministrators(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load administrators.")).finally(() => setLoading(false));
  }, []);

  async function setPermission(administrator: Administrator, field: "dashboard" | "students" | "courses", value: boolean) {
    const updated = { ...administrator, [field]: value };
    setSavingEmail(administrator.email); setError("");
    const response = await fetch(`/api/administrators/${encodeURIComponent(administrator.email)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const data = await readJson<Administrator & ApiError>(response);
    if (!response.ok) setError(data.error ?? "Could not update permissions.");
    else setAdministrators((current) => current.map((item) => item.email === data.email ? data : item));
    setSavingEmail("");
  }

  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700" role="alert">{error}</p>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4"><h2 className="m-0 text-lg font-normal">Administrator access</h2><p className="mt-1 font-sans text-xs text-slate-400">Administrators added in Cloudflare appear here after their first visit. Grant or revoke access independently for each area.</p></div>{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading administrators...</p> : administrators.length === 0 ? <p className="p-8 text-center font-sans text-sm text-slate-400">No additional Cloudflare administrators have visited the app yet.</p> : <div className="overflow-x-auto"><table className="w-full border-collapse font-sans"><thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Email</th>{permissionFields.map(([, label]) => <th className="px-5 py-3 text-center" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-stone-200">{administrators.map((administrator) => <tr key={administrator.email}><td className="whitespace-nowrap px-5 py-4 text-sm font-semibold">{administrator.email}</td>{permissionFields.map(([field, label]) => <td className="px-5 py-4 text-center" key={field}><input aria-label={`${label} access for ${administrator.email}`} checked={administrator[field]} className="h-4 w-4 accent-lime-600" disabled={savingEmail === administrator.email} type="checkbox" onChange={(event) => void setPermission(administrator, field, event.target.checked)} /></td>)}</tr>)}</tbody></table></div>}</section>
  </div></main>;
}
