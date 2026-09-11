"use client";

import { readJson } from "../lib/http";
import { useEffect, useState } from "react";

type Administrator = { email: string; dashboard: boolean; students: boolean; courses: boolean; practiceParties: boolean; qrCodes: boolean };
type ApiError = { error?: string };
const permissionFields = [["dashboard", "Dashboard"], ["students", "Students"], ["courses", "Courses"], ["practiceParties", "Practice Parties"], ["qrCodes", "QR Codes"]] as const;

export default function AdministratorsPage() {
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/administrators").then(async (response) => {
      const data = await readJson<Administrator[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load administrators.");
      setAdministrators(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load administrators.")).finally(() => setLoading(false));
  }, []);

  async function setPermission(administrator: Administrator, field: "dashboard" | "students" | "courses" | "practiceParties" | "qrCodes", value: boolean) {
    const updated = { ...administrator, [field]: value };
    setSavingEmail(administrator.email); setError("");
    const response = await fetch(`/api/administrators/${encodeURIComponent(administrator.email)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const data = await readJson<Administrator & ApiError>(response);
    if (!response.ok) setError(data.error ?? "Could not update permissions.");
    else setAdministrators((current) => current.map((item) => item.email === data.email ? data : item));
    setSavingEmail("");
  }

  async function deleteAdministrator(administrator: Administrator) {
    if (!window.confirm(`Remove ${administrator.email} from the administrator list? Their app permissions will be removed. They can appear again if they still have Cloudflare Access and return to the app.`)) return;
    setSavingEmail(administrator.email); setError("");
    try {
      const response = await fetch(`/api/administrators/${encodeURIComponent(administrator.email)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await readJson<ApiError>(response);
        throw new Error(data.error ?? "Could not delete administrator.");
      }
      setAdministrators((current) => current.filter((item) => item.email !== administrator.email));
      window.dispatchEvent(new Event("administrator-updated"));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not delete administrator.");
    } finally {
      setSavingEmail("");
    }
  }

  async function clearData() {
    if (!window.confirm("Permanently remove all student, course, payment, and practice party data from the current database? QR codes, administrators, and administrator profile information will be kept. This cannot be undone.")) return;
    setClearing(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/administrators/clear-data", { method: "POST" });
      const data = await readJson<{ cleared?: boolean } & ApiError>(response);
      if (!response.ok || !data.cleared) throw new Error(data.error ?? "Could not clear the application data.");
      setNotice("All student, course, payment, and practice party data has been removed. QR codes and administrator information were kept.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not clear the application data.");
    } finally {
      setClearing(false);
    }
  }

  return <main className="flex-1 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700" role="alert">{error}</p>}
    {notice && <p className="mb-4 rounded-lg border border-lime-200 bg-lime-50 p-3 font-sans text-sm text-lime-800" role="status">{notice}</p>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4"><h2 className="m-0 text-lg font-normal">Administrator access</h2><p className="mt-1 font-sans text-xs text-slate-400">Administrators added in Cloudflare appear here after their first visit. Grant or revoke access independently for each area.</p></div>{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading administrators...</p> : administrators.length === 0 ? <p className="p-8 text-center font-sans text-sm text-slate-400">No additional Cloudflare administrators have visited the app yet.</p> : <div className="overflow-x-auto"><table className="w-full border-collapse font-sans"><thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Email</th>{permissionFields.map(([, label]) => <th className="px-5 py-3 text-center" key={label}>{label}</th>)}<th className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-stone-200">{administrators.map((administrator) => <tr key={administrator.email}><td className="whitespace-nowrap px-5 py-4 text-sm font-semibold">{administrator.email}</td>{permissionFields.map(([field, label]) => <td className="px-5 py-4 text-center" key={field}><input aria-label={`${label} access for ${administrator.email}`} checked={administrator[field]} className="h-4 w-4 accent-lime-600" disabled={savingEmail === administrator.email} type="checkbox" onChange={(event) => void setPermission(administrator, field, event.target.checked)} /></td>)}<td className="px-5 py-4 text-right"><button aria-label={`Delete ${administrator.email}`} className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={savingEmail === administrator.email} type="button" onClick={() => void deleteAdministrator(administrator)}>Delete</button></td></tr>)}</tbody></table></div>}</section>
    <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5"><h2 className="m-0 text-lg font-normal text-red-900">Danger zone</h2><p className="mb-4 mt-1 max-w-2xl font-sans text-sm leading-6 text-red-800">Remove all student, course, payment, and practice party data from the database currently in use. QR codes, administrators, and administrator profile information are kept.</p><button className="rounded-md bg-red-700 px-4 py-2.5 font-sans text-xs font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={clearing} type="button" onClick={() => void clearData()}>{clearing ? "Removing data..." : "Remove all non-QR-code data"}</button></section>
  </div></main>;
}
