"use client";

import ProductionBackups from "../components/production-backups";
import MediaLibrary from "../components/media-library";
import LocalDatabaseManager from "../components/local-database-manager";
import { readJson } from "../lib/http";
import { downloadWorkbook, readWorkbook } from "../lib/xlsx-export";
import { compressImage } from "../lib/profile-image";
import { useEffect, useRef, useState } from "react";
import ConfirmationDialog from "../components/confirmation-dialog";

type Administrator = { email: string; name: string; picture: string | null; dashboard: boolean; students: boolean; courses: boolean; practiceParties: boolean; qrCodes: boolean; tasks: boolean };
type ApiError = { error?: string };
type ExportTable = { name: string; columns: string[]; rows: Record<string, unknown>[] };
const administratorTabs = [["administrators", "Administrators"], ["media", "Media files"], ["backups", "Database backups"], ["transfer", "Data transfer & danger zone"]] as const;
const administratorTabStorageKey = "fsd-administrators-tab";
const permissionFields = [["dashboard", "Dashboard"], ["students", "Students"], ["courses", "Courses"], ["practiceParties", "Practice Parties"], ["qrCodes", "QR Codes"], ["tasks", "Tasks"]] as const;

export default function AdministratorsPage() {
  return <AdministratorsContent />;
}
function AdministratorsContent() {
  const [activeTab, setActiveTab] = useState<(typeof administratorTabs)[number][0]>("administrators");
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState("");
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Administrator | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{ kind: "administrator"; administrator: Administrator } | { kind: "clear" } | { kind: "import"; file: File } | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(administratorTabStorageKey);
      const tab = administratorTabs.find(([value]) => value === saved);
      if (tab) setActiveTab(tab[0]);
    } catch { /* Use the default tab when browser storage is unavailable. */ }
  }, []);

  function selectTab(tab: (typeof administratorTabs)[number][0]) {
    setActiveTab(tab);
    try { window.localStorage.setItem(administratorTabStorageKey, tab); }
    catch { /* Keep the selection for this visit when storage is unavailable. */ }
  }

  useEffect(() => {
    fetch("/api/administrators").then(async (response) => {
      const data = await readJson<Administrator[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load administrators.");
      setAdministrators(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load administrators.")).finally(() => setLoading(false));
  }, []);

  useEffect(() => () => { if (profilePreview) URL.revokeObjectURL(profilePreview); }, [profilePreview]);


  async function setPermission(administrator: Administrator, field: "dashboard" | "students" | "courses" | "practiceParties" | "qrCodes" | "tasks", value: boolean) {
    const updated = { ...administrator, [field]: value };
    setSavingEmail(administrator.email); setError("");
    const response = await fetch(`/api/administrators/${encodeURIComponent(administrator.email)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const data = await readJson<Administrator & ApiError>(response);
    if (!response.ok) setError(data.error ?? "Could not update permissions.");
    else setAdministrators((current) => current.map((item) => item.email === data.email ? data : item));
    setSavingEmail("");
  }

  function deleteAdministrator(administrator: Administrator) { setConfirmation({ kind: "administrator", administrator }); }
  async function removeAdministrator(administrator: Administrator) {
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

  function openProfile(administrator: Administrator) {
    setEditingProfile(administrator); setProfileName(administrator.name); setProfileImage(null); setProfilePreview(null); setPaymentMethods([]); setPaymentMethod(""); setPaymentMethodsLoaded(false); setError(""); setLoadingPaymentMethods(true);
    void fetch(`/api/administrators/${encodeURIComponent(administrator.email)}/payment-methods`).then(async (response) => {
      const data = await readJson<{ paymentMethods?: string[] } & ApiError>(response);
      if (!response.ok || !data.paymentMethods) throw new Error(data.error ?? "Could not load payment methods.");
      setPaymentMethods(data.paymentMethods); setPaymentMethodsLoaded(true);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load payment methods.")).finally(() => setLoadingPaymentMethods(false));
  }

  function addPaymentMethod() {
    const method = paymentMethod.trim();
    if (!method || paymentMethods.some((item) => item.toLocaleLowerCase() === method.toLocaleLowerCase())) return;
    setPaymentMethods((current) => [...current, method]); setPaymentMethod("");
  }

  async function selectProfileImage(file: File | undefined) {
    if (!file || !editingProfile) return;
    try {
      const compressed = await compressImage(file, "administrator.jpg");
      if (profilePreview) URL.revokeObjectURL(profilePreview);
      setProfileImage(compressed); setProfilePreview(URL.createObjectURL(compressed)); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare profile image."); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProfile || !profileName.trim()) return;
    setSavingProfile(true); setError("");
    try {
      let picture = editingProfile.picture;
      if (profileImage) {
        const formData = new FormData(); formData.append("file", profileImage);
        const uploadResponse = await fetch("/api/admin-profile/image", { method: "POST", body: formData });
        const upload = await readJson<{ picture?: string } & ApiError>(uploadResponse);
        if (!uploadResponse.ok || !upload.picture) throw new Error(upload.error ?? "Could not upload profile image.");
        picture = upload.picture;
      }
      const response = await fetch(`/api/administrators/${encodeURIComponent(editingProfile.email)}/profile`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: profileName, picture }) });
      const profile = await readJson<Pick<Administrator, "email" | "name" | "picture"> & ApiError>(response);
      if (!response.ok) throw new Error(profile.error ?? "Could not save administrator profile.");
      const methodsResponse = await fetch(`/api/administrators/${encodeURIComponent(editingProfile.email)}/payment-methods`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentMethods }) });
      const methods = await readJson<{ paymentMethods?: string[] } & ApiError>(methodsResponse);
      if (!methodsResponse.ok || !methods.paymentMethods) throw new Error(methods.error ?? "Could not save payment methods.");
      setAdministrators((current) => current.map((administrator) => administrator.email === profile.email ? { ...administrator, name: profile.name, picture: profile.picture } : administrator));
      setPaymentMethods(methods.paymentMethods); setEditingProfile(null); setProfileImage(null); setProfilePreview(null); setNotice(`Profile and payment methods saved for ${profile.name}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save administrator profile."); }
    finally { setSavingProfile(false); }
  }

  function clearData() { setConfirmation({ kind: "clear" }); }
  async function performClearData() {
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

  function importData(file: File) { setConfirmation({ kind: "import", file }); }
  async function performImportData(file: File) {
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
    <nav aria-label="Administrator sections" className="mb-6 flex flex-wrap gap-x-6 gap-y-1 border-b border-stone-300" role="tablist">
      {administratorTabs.map(([tab, label], index) => <button
        key={tab}
        id={`administrator-tab-${tab}`}
        role="tab"
        type="button"
        aria-selected={activeTab === tab}
        aria-controls={`administrator-panel-${tab}`}
        tabIndex={activeTab === tab ? 0 : -1}
        onClick={() => selectTab(tab)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? administratorTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + administratorTabs.length) % administratorTabs.length;
          const next = administratorTabs[nextIndex][0];
          selectTab(next);
          document.getElementById(`administrator-tab-${next}`)?.focus();
        }}
        className={`-mb-px shrink-0 border-0 border-b-2 bg-transparent px-1 py-3 font-sans text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-600 ${activeTab === tab ? "border-slate-800 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
      >{label}</button>)}
    </nav>
    <ConfirmationDialog open={confirmation !== null} title={confirmation?.kind === "administrator" ? "Remove administrator?" : confirmation?.kind === "clear" ? "Clear application data?" : "Import school data?"} description={confirmation?.kind === "administrator" ? <>Remove <strong>{confirmation.administrator.email}</strong> from the administrator list? Their app permissions will be removed. They can appear again if they still have Cloudflare Access and return to the app.</> : confirmation?.kind === "clear" ? "Permanently remove all student, course, payment, practice party, and QR-code data from the current database? Administrators and their profile information will be kept. This cannot be undone." : "Add new school data from this export to the current database? Existing records and administrator profiles, permissions, and payment methods will be kept. New records can use a temporary ID such as new:student-1 in its ID cell and matching foreign-key cells. When importing a production export into Local, student and QR-code images are copied too."} confirmLabel={confirmation?.kind === "administrator" ? "Remove administrator" : confirmation?.kind === "clear" ? "Clear data" : "Import data"} destructive={confirmation?.kind !== "import"} onCancel={() => setConfirmation(null)} onConfirm={() => { const current = confirmation; setConfirmation(null); if (current?.kind === "administrator") void removeAdministrator(current.administrator); else if (current?.kind === "clear") void performClearData(); else if (current?.kind === "import") void performImportData(current.file); }} />
    {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700" role="alert">{error}</p>}
    {notice && <p className="mb-4 rounded-lg border border-lime-200 bg-lime-50 p-3 font-sans text-sm text-lime-800" role="status">{notice}</p>}
    {editingProfile && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/70 p-4 md:left-64" role="presentation"><div aria-labelledby="administrator-profile-title" aria-modal="true" className="mx-auto w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-2xl" role="dialog"><form className="space-y-5" onSubmit={(event) => void saveProfile(event)}><div className="flex items-center justify-between gap-4"><h2 className="m-0 text-xl font-normal" id="administrator-profile-title">Administrator profile</h2><button aria-label="Close profile editor" className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold" disabled={savingProfile} type="button" onClick={() => setEditingProfile(null)}>×</button></div><div className="flex items-center gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans text-lg font-bold text-slate-800">{profilePreview ?? editingProfile.picture ? <img alt="Administrator profile preview" className="h-full w-full object-cover" src={profilePreview ?? editingProfile.picture ?? ""} /> : (profileName || editingProfile.email).charAt(0).toUpperCase()}</div><label className="cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold">Upload image<input accept="image/*" className="sr-only" type="file" onChange={(event) => { void selectProfileImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div><label className="block font-sans text-xs font-bold uppercase tracking-wider text-slate-500">Name<input className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 font-sans text-sm font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-lime-600" maxLength={100} required value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label className="block font-sans text-xs font-bold uppercase tracking-wider text-slate-500">Email<input className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-3 font-sans text-sm font-normal normal-case tracking-normal text-slate-600" readOnly value={editingProfile.email} /></label><fieldset className="border-0 p-0 font-sans"><legend className="text-xs font-bold uppercase tracking-wider text-slate-500">Payment methods</legend><p className="mt-2 text-xs text-slate-500">Set the ways this administrator receives money. Cash is always available.</p>{loadingPaymentMethods ? <p className="mt-3 text-sm text-slate-500">Loading payment methods...</p> : <><div className="mt-3 flex gap-2"><input aria-label="New payment method" disabled={savingProfile || !paymentMethodsLoaded} className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-50" maxLength={50} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPaymentMethod(); } }} /><button className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50" disabled={savingProfile || !paymentMethodsLoaded} type="button" onClick={addPaymentMethod}>Add</button></div><div className="mt-3 flex flex-wrap gap-2">{paymentMethods.map((method) => <button key={method} type="button" disabled={savingProfile || !paymentMethodsLoaded || method.toLocaleLowerCase() === "cash"} className="rounded-full bg-lime-100 px-3 py-1.5 text-xs text-lime-900 disabled:opacity-60" onClick={() => setPaymentMethods((current) => current.filter((item) => item !== method))}>{method}{method.toLocaleLowerCase() === "cash" ? " (required)" : <><span aria-hidden="true"> ×</span><span className="sr-only">Remove {method}</span></>}</button>)}</div></>}</fieldset><div className="flex justify-end gap-3"><button className="rounded-lg border border-stone-300 px-4 py-3 font-sans text-xs font-semibold" disabled={savingProfile} type="button" onClick={() => setEditingProfile(null)}>Cancel</button><button className="rounded-lg bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white disabled:opacity-50" disabled={savingProfile || loadingPaymentMethods || !paymentMethodsLoaded || !profileName.trim()}>{savingProfile ? "Saving..." : "Save profile"}</button></div></form></div></div>}
    <div id="administrator-panel-administrators" role="tabpanel" aria-labelledby="administrator-tab-administrators" hidden={activeTab !== "administrators"}>
    <section aria-labelledby="administrator-access-title" className="font-sans">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="administrator-access-title" className="m-0 font-sans text-xl font-semibold tracking-tight text-slate-900">Administrator access</h2>
          <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-slate-500">Manage profiles and choose which areas each administrator can use. Access changes are saved automatically.</p>
        </div>
        {!loading && <span className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">{administrators.length} administrator{administrators.length === 1 ? "" : "s"}</span>}
      </div>
      {loading ? <p className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-sm text-slate-500" role="status">Loading administrators...</p> : administrators.length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center"><h3 className="m-0 font-sans text-base font-semibold text-slate-800">No administrators yet</h3><p className="mb-0 mt-2 text-sm leading-6 text-slate-500">Administrators added in Cloudflare appear here after their first visit.</p></div> : <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
        {administrators.map((administrator) => <article key={administrator.email} className="flex min-w-0 flex-col rounded-xl border border-stone-200 bg-white p-4">
          <div className="mb-4">
            <div className="flex min-w-0 max-w-full items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 text-sm font-semibold text-lime-900 ring-1 ring-black/5">
                {administrator.picture ? <img alt="" className="h-full w-full object-cover" src={administrator.picture} /> : (administrator.name || administrator.email).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h3 className="m-0 break-words font-sans text-sm font-semibold text-slate-900">{administrator.name || "Profile not set up"}</h3>
                <p className="mb-0 mt-0.5 break-all text-xs text-slate-500">{administrator.email}</p>
              </div>
            </div>

          </div>
          <fieldset className="m-0 mb-4 min-w-0 border-0 p-0">
            <legend className="sr-only">Area access for {administrator.name || administrator.email}</legend>
            <div className="flex flex-wrap gap-2">
              {permissionFields.map(([field, label]) => <button key={field}
                aria-label={`${label} access for ${administrator.email}`}
                aria-pressed={administrator[field]}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${administrator[field] ? "border-lime-300 bg-lime-100 text-lime-950 hover:bg-lime-200" : "border-stone-200 bg-stone-50 text-slate-500 hover:bg-stone-100"}`}
                disabled={savingEmail === administrator.email} type="button"
                onClick={() => void setPermission(administrator, field, !administrator[field])}
              >
                {administrator[field] && <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 8 3 3 7-7" /></svg>}
                {label}
              </button>)}
            </div>
            <p className="mb-0 mt-2 text-xs text-slate-500" role="status">{savingEmail === administrator.email ? "Saving changes..." : `${permissionFields.filter(([field]) => administrator[field]).length}/${permissionFields.length} enabled`}</p>
          </fieldset>
            <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
              <button aria-label={`Edit profile for ${administrator.email}`} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600" type="button" onClick={() => openProfile(administrator)}>{administrator.name ? "Edit profile" : "Set up profile"}</button>
              <button aria-label={`Delete ${administrator.email}`} className="rounded-lg px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={savingEmail === administrator.email} type="button" onClick={() => deleteAdministrator(administrator)}>Delete</button>
            </div>
        </article>)}
      </div>}
      {!loading && administrators.length > 0 && <p className="mb-0 mt-5 text-xs leading-5 text-slate-500">New administrators appear here after being added in Cloudflare and visiting the app.</p>}
    </section>
    </div>
    <div id="administrator-panel-media" role="tabpanel" aria-labelledby="administrator-tab-media" hidden={activeTab !== "media"}>
      {activeTab === "media" && <MediaLibrary />}
    </div>
    <div id="administrator-panel-backups" role="tabpanel" aria-labelledby="administrator-tab-backups" hidden={activeTab !== "backups"}>
      <LocalDatabaseManager />
      <ProductionBackups />
    </div>
    <div id="administrator-panel-transfer" role="tabpanel" aria-labelledby="administrator-tab-transfer" hidden={activeTab !== "transfer"}>
    <section className="rounded-xl border border-lime-200 bg-lime-50 p-5"><h2 className="m-0 text-lg font-normal text-lime-950">Database transfer</h2><p className="mb-4 mt-1 max-w-2xl font-sans text-sm leading-6 text-lime-900">Download all application data as an Excel workbook, with one sheet for each database table. Importing only adds new school records and never deletes or updates existing data. For a new record with related rows, use a temporary ID such as new:student-1 in its ID cell and the matching foreign-key cells. Administrator profiles, permissions, and payment methods are always kept. When importing a production export into Local, student and QR-code images are copied into local storage.</p><div className="flex flex-wrap gap-3"><button className="rounded-md bg-lime-700 px-4 py-2.5 font-sans text-xs font-bold text-white hover:bg-lime-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={exporting || importing} type="button" onClick={() => void exportData()}>{exporting ? "Preparing export..." : "Export database (.xlsx)"}</button><input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); }} ref={importInput} type="file" /><button className="rounded-md border border-lime-700 bg-white px-4 py-2.5 font-sans text-xs font-bold text-lime-900 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={exporting || importing} type="button" onClick={() => importInput.current?.click()}>{importing ? "Importing..." : "Import database (.xlsx)"}</button></div></section>
    <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5"><h2 className="m-0 text-lg font-normal text-red-900">Danger zone</h2><p className="mb-4 mt-1 max-w-2xl font-sans text-sm leading-6 text-red-800">Remove all student, course, payment, practice party, and QR-code data from the database currently in use. Administrators and their profile information are kept.</p><button className="rounded-md bg-red-700 px-4 py-2.5 font-sans text-xs font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={clearing} type="button" onClick={() => void clearData()}>{clearing ? "Removing data..." : "Remove all data except administrators"}</button></section>
    </div>
  </div></main>;
}
