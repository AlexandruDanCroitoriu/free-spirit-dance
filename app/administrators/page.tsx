"use client";

import { readJson } from "../lib/http";
import { downloadWorkbook, readWorkbook } from "../lib/xlsx-export";
import { useEffect, useRef, useState } from "react";

type Administrator = { email: string; dashboard: boolean; students: boolean; courses: boolean; practiceParties: boolean; qrCodes: boolean };
type ApiError = { error?: string };
type ExportTable = { name: string; columns: string[]; rows: Record<string, unknown>[] };
const permissionFields = [["dashboard", "Dashboard"], ["students", "Students"], ["courses", "Courses"], ["practiceParties", "Practice Parties"], ["qrCodes", "QR Codes"]] as const;

export default function AdministratorsPage() {
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState("");
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
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
    if (!window.confirm("Permanently remove all student, course, payment, practice party, and QR-code data from the current database? Administrators and their profile information will be kept. This cannot be undone.")) return;
    setClearing(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/administrators/clear-data", { method: "POST" });
      const data = await readJson<{ cleared?: boolean } & ApiError>(response);
      if (!response.ok || !data.cleared) throw new Error(data.error ?? "Could not clear the application data.");
      setNotice("All student, course, payment, practice party, and QR-code data has been removed. Administrator information was kept.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not clear the application data.");
    } finally {
      setClearing(false);
    }
  }

  async function exportData() {
    setExporting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/administrators/export");
      const data = await readJson<{ tables?: ExportTable[] } & ApiError>(response);
      if (!response.ok || !data.tables) throw new Error(data.error ?? "Could not export the database.");
      downloadWorkbook(data.tables, `free-spirit-dance-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
      setNotice("The database export has been downloaded.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not export the database.");
    } finally {
      setExporting(false);
    }
  }

  async function importData(file: File) {
    if (!window.confirm("Add new school data from this export to the current database? Existing records and administrator profiles, permissions, and payment methods will be kept. New records can use a temporary ID such as new:student-1 in their ID cell and matching foreign-key cells. When importing a production export into Local, student and QR-code images are copied too.")) return;
    setImporting(true); setError(""); setNotice("");
    try {
      const tables = await readWorkbook(file);
      const response = await fetch("/api/administrators/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tables }) });
      const data = await readJson<{ imported?: boolean; imagesCopied?: number } & ApiError>(response);
      if (!response.ok || !data.imported) throw new Error(data.error ?? "Could not import the database.");
      setNotice(`New school data has been imported. Existing records and administrator settings were kept.${data.imagesCopied ? ` ${data.imagesCopied} student or QR-code image${data.imagesCopied === 1 ? " was" : "s were"} copied to local storage.` : ""}`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not import the database.");
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  return <main className="flex-1 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700" role="alert">{error}</p>}
    {notice && <p className="mb-4 rounded-lg border border-lime-200 bg-lime-50 p-3 font-sans text-sm text-lime-800" role="status">{notice}</p>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4"><h2 className="m-0 text-lg font-normal">Administrator access</h2><p className="mt-1 font-sans text-xs text-slate-400">Administrators added in Cloudflare appear here after their first visit. Grant or revoke access independently for each area.</p></div>{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading administrators...</p> : administrators.length === 0 ? <p className="p-8 text-center font-sans text-sm text-slate-400">No additional Cloudflare administrators have visited the app yet.</p> : <div className="overflow-x-auto"><table className="w-full border-collapse font-sans"><thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Email</th>{permissionFields.map(([, label]) => <th className="px-5 py-3 text-center" key={label}>{label}</th>)}<th className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-stone-200">{administrators.map((administrator) => <tr key={administrator.email}><td className="whitespace-nowrap px-5 py-4 text-sm font-semibold">{administrator.email}</td>{permissionFields.map(([field, label]) => <td className="px-5 py-4 text-center" key={field}><input aria-label={`${label} access for ${administrator.email}`} checked={administrator[field]} className="h-4 w-4 accent-lime-600" disabled={savingEmail === administrator.email} type="checkbox" onChange={(event) => void setPermission(administrator, field, event.target.checked)} /></td>)}<td className="px-5 py-4 text-right"><button aria-label={`Delete ${administrator.email}`} className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={savingEmail === administrator.email} type="button" onClick={() => void deleteAdministrator(administrator)}>Delete</button></td></tr>)}</tbody></table></div>}</section>
    <section className="mt-6 rounded-xl border border-lime-200 bg-lime-50 p-5"><h2 className="m-0 text-lg font-normal text-lime-950">Database transfer</h2><p className="mb-4 mt-1 max-w-2xl font-sans text-sm leading-6 text-lime-900">Download all application data as an Excel workbook, with one sheet for each database table. Importing only adds new school records and never deletes or updates existing data. For a new record with related rows, use a temporary ID such as new:student-1 in its ID cell and the matching foreign-key cells. Administrator profiles, permissions, and payment methods are always kept. When importing a production export into Local, student and QR-code images are copied into local storage.</p><div className="flex flex-wrap gap-3"><button className="rounded-md bg-lime-700 px-4 py-2.5 font-sans text-xs font-bold text-white hover:bg-lime-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={exporting || importing} type="button" onClick={() => void exportData()}>{exporting ? "Preparing export..." : "Export database (.xlsx)"}</button><input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); }} ref={importInput} type="file" /><button className="rounded-md border border-lime-700 bg-white px-4 py-2.5 font-sans text-xs font-bold text-lime-900 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={exporting || importing} type="button" onClick={() => importInput.current?.click()}>{importing ? "Importing..." : "Import database (.xlsx)"}</button></div></section>
    <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5"><h2 className="m-0 text-lg font-normal text-red-900">Danger zone</h2><p className="mb-4 mt-1 max-w-2xl font-sans text-sm leading-6 text-red-800">Remove all student, course, payment, practice party, and QR-code data from the database currently in use. Administrators and their profile information are kept.</p><button className="rounded-md bg-red-700 px-4 py-2.5 font-sans text-xs font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={clearing} type="button" onClick={() => void clearData()}>{clearing ? "Removing data..." : "Remove all data except administrators"}</button></section>
  </div></main>;
}
