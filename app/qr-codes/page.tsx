"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

type ImageMode = "none" | "logo" | "custom";
type QrCode = { id: number; slug: string; name: string; destinationUrl: string; redirectUrl: string; active: boolean; imageMode: ImageMode; imageUrl: string | null; createdAt: string; updatedAt: string };
type FormState = { name: string; destinationUrl: string; active: boolean; imageMode: ImageMode };
type ApiError = { error?: string };
const emptyForm: FormState = { name: "", destinationUrl: "https://", active: true, imageMode: "none" };

async function readJson<T>(response: Response): Promise<T> { const text = await response.text(); try { return text ? JSON.parse(text) as T : {} as T; } catch { return {} as T; } }

async function compressImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const image = new Image(); const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not read the image.")); image.src = url; });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("Could not prepare the image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size > 250_000) throw new Error("Choose a smaller image.");
    return new File([blob], "qr-image.webp", { type: "image/webp" });
  } finally { URL.revokeObjectURL(url); }
}

async function loadImage(source: string) { const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not load the QR image.")); image.src = source; }); return image; }

async function renderQr(url: string, imageUrl: string | null, width: number, margin: number) {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: "H", margin, width, color: { dark: "#1e293b", light: "#ffffff" } });
  if (!imageUrl) return canvas;
  const image = await loadImage(imageUrl); const context = canvas.getContext("2d"); if (!context) return canvas;
  const backing = width * 0.3; const size = width * 0.25; const position = (width - backing) / 2;
  context.fillStyle = "#fff"; context.beginPath(); context.roundRect(position, position, backing, backing, width * 0.018); context.fill();
  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight); const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (width - drawHeight) / 2, drawWidth, drawHeight);
  return canvas;
}

function QrPreview({ code }: { code: QrCode }) {
  const [source, setSource] = useState("");
  useEffect(() => { let current = true; renderQr(code.redirectUrl, code.imageUrl, 320, 2).then((canvas) => { if (current) setSource(canvas.toDataURL()); }).catch(() => { if (current) setSource(""); }); return () => { current = false; }; }, [code.redirectUrl, code.imageUrl]);
  return source ? <img alt={`QR code for ${code.name}`} className="h-32 w-32 rounded-lg" src={source} /> : <div className="flex h-32 w-32 items-center justify-center bg-stone-100 text-xs text-slate-400">Generating…</div>;
}

function safeName(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "qr-code"; }
function download(href: string, name: string) { const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click(); }
async function downloadPng(code: QrCode) { const canvas = await renderQr(code.redirectUrl, code.imageUrl, 1200, 4); download(canvas.toDataURL("image/png"), `${safeName(code.name)}.png`); }
async function toDataUrl(source: string) { const response = await fetch(source); if (!response.ok) throw new Error("Could not load the QR image."); const blob = await response.blob(); return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read the QR image.")); reader.readAsDataURL(blob); }); }
async function downloadSvg(code: QrCode) {
  let svg = await QRCode.toString(code.redirectUrl, { type: "svg", errorCorrectionLevel: "H", margin: 4, width: 1200, color: { dark: "#1e293b", light: "#fff" } });
  if (code.imageUrl) { const image = await toDataUrl(code.imageUrl); svg = svg.replace("</svg>", `<rect x="420" y="420" width="360" height="360" rx="22" fill="#fff"/><image href="${image}" x="450" y="450" width="300" height="300" preserveAspectRatio="xMidYMid meet"/></svg>`); }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); download(url, `${safeName(code.name)}.svg`); setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function QrCodesPage() {
  const [codes, setCodes] = useState<QrCode[]>([]); const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null); const [pendingImage, setPendingImage] = useState<File | null>(null); const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QrCode | null>(null);

  async function load() { setLoading(true); const response = await fetch("/api/qr-codes"); const data = await readJson<QrCode[] | ApiError>(response); if (!response.ok || !Array.isArray(data)) setError(!Array.isArray(data) && data.error ? data.error : "Could not load QR codes."); else setCodes(data); setLoading(false); }
  useEffect(() => { void load(); }, []);
  function clearPreview() { if (preview) URL.revokeObjectURL(preview); setPreview(null); }
  function create() { clearPreview(); setEditingId(null); setForm(emptyForm); setPendingImage(null); setError(""); setOpen(true); }
  useEffect(() => { window.addEventListener("open-add-qr-code", create); return () => window.removeEventListener("open-add-qr-code", create); });
  function close() { clearPreview(); setOpen(false); setEditingId(null); setForm(emptyForm); setPendingImage(null); setError(""); }
  function edit(code: QrCode) { clearPreview(); setEditingId(code.id); setForm({ name: code.name, destinationUrl: code.destinationUrl, active: code.active, imageMode: code.imageMode }); setPendingImage(null); setError(""); setOpen(true); }
  async function chooseImage(file?: File) { if (!file) return; try { const compressed = await compressImage(file); clearPreview(); setPendingImage(compressed); setPreview(URL.createObjectURL(compressed)); setForm((value) => ({ ...value, imageMode: "custom" })); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare image."); } }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch(editingId ? `/api/qr-codes/${editingId}` : "/api/qr-codes", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    let data = await readJson<QrCode & ApiError>(response); if (!response.ok) { setError(data.error ?? "Could not save QR code."); setSaving(false); return; }
    if (form.imageMode === "custom" && pendingImage) { const body = new FormData(); body.append("file", pendingImage); const upload = await fetch(`/api/qr-codes/${data.id}/image`, { method: "POST", body }); data = await readJson<QrCode & ApiError>(upload); if (!upload.ok) { setError(data.error ?? "The QR code was saved, but its image could not be uploaded."); setSaving(false); return; } }
    setCodes((current) => editingId ? current.map((code) => code.id === data.id ? data : code) : [data, ...current]); close(); setSaving(false);
  }
  async function toggle(code: QrCode) {
    const nextActive = !code.active;
    setUpdatingStatusId(code.id); setError("");
    try {
      const response = await fetch(`/api/qr-codes/${code.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: code.name, destinationUrl: code.destinationUrl, active: nextActive, imageMode: code.imageMode }) });
      const data = await readJson<QrCode & ApiError>(response);
      if (!response.ok) { setError(data.error ?? "Could not update QR code."); return; }
      setCodes((current) => current.map((item) => item.id === data.id ? data : item));
    } catch { setError("Could not update QR code."); }
    finally { setUpdatingStatusId(null); }
  }
  async function handleDownload(action: () => Promise<void>) { try { setError(""); await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download the QR code."); } }
  async function copyUrl(url: string) { try { await navigator.clipboard.writeText(url); setError(""); } catch { setError("Could not copy the URL."); } }
  async function deleteQrCode(code: QrCode) {
    setDeletingId(code.id); setError("");
    try {
      const response = await fetch(`/api/qr-codes/${code.id}`, { method: "DELETE" });
      if (!response.ok) { const data = await readJson<ApiError>(response); setError(data.error ?? "Could not delete QR code."); return; }
      setCodes((current) => current.filter((item) => item.id !== code.id)); setDeleteTarget(null);
    } catch { setError("Could not delete QR code."); }
    finally { setDeletingId(null); }
  }
  const current = codes.find((code) => code.id === editingId); const selectedImage = form.imageMode === "logo" ? "/logo.svg" : form.imageMode === "custom" ? preview ?? current?.imageUrl ?? null : null;

  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {open && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/70 p-4 md:left-64"><div className="mx-auto mt-8 max-w-xl rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true"><form className="space-y-5" onSubmit={save}>
      <div className="flex justify-between"><h2 className="m-0 text-xl font-normal">{editingId ? "Edit QR code" : "Create QR code"}</h2><button type="button" aria-label="Close" className="rounded border px-3 py-2" onClick={close}>×</button></div>
      <label className="block text-xs font-semibold text-slate-600">Name<input autoFocus required maxLength={100} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="block text-xs font-semibold text-slate-600">Destination URL<input required type="url" maxLength={2048} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal" value={form.destinationUrl} onChange={(event) => setForm({ ...form, destinationUrl: event.target.value })} /></label>
      <fieldset><legend className="text-xs font-semibold text-slate-600">Center image</legend><div className="mt-2 grid grid-cols-3 gap-2">{([['none','No image'],['logo','App logo'],['custom','Upload image']] as const).map(([mode,label]) => <label key={mode} className={`cursor-pointer rounded-lg border p-3 text-center text-xs font-semibold ${form.imageMode === mode ? "border-lime-600 bg-lime-50 text-lime-800" : "border-stone-300"}`}><input className="sr-only" type="radio" name="imageMode" checked={form.imageMode === mode} onChange={() => { setForm({ ...form, imageMode: mode }); if (mode !== "custom") { setPendingImage(null); clearPreview(); } }} />{label}</label>)}</div></fieldset>
      {form.imageMode === "custom" && <div className="flex items-center gap-4"><div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border bg-white">{selectedImage ? <img src={selectedImage} alt="Center image preview" className="h-full w-full object-contain p-1" /> : <span className="p-2 text-center text-[10px] text-slate-400">No image selected</span>}</div><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 text-xs font-semibold">Choose image<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void chooseImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>}
      {editingId && <label className="flex items-center gap-3 text-xs font-semibold"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Active</label>}
      <p className="text-xs text-slate-400">The image is embedded in downloads. The permanent redirect address never changes.</p>
      <div className="flex items-center gap-3">{error && <p className="mr-auto text-sm text-red-700">{error}</p>}<button type="button" className="ml-auto rounded-md border px-4 py-3 text-xs font-semibold" onClick={close}>Cancel</button><button disabled={saving || (form.imageMode === "custom" && !pendingImage && !current?.imageUrl)} className="rounded-md bg-slate-800 px-4 py-3 text-xs font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button></div>
    </form></div></div>}
    {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-5 md:left-64" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && deletingId === null) setDeleteTarget(null); }}>
      <div aria-labelledby="delete-qr-title" aria-describedby="delete-qr-description" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-xl border border-red-800 bg-red-50 shadow-2xl" role="alertdialog">
        <div className="bg-red-700 p-6 text-white"><div className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15"><svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="18"><path d="M12 9v4m0 4h.01M10.3 3.7 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /></svg></span><h2 className="m-0 text-xl font-normal" id="delete-qr-title">Delete QR code?</h2></div>
          <p className="mt-3 font-sans text-sm leading-6 text-red-100" id="delete-qr-description">This will permanently delete <strong className="font-bold text-white">{deleteTarget.name}</strong>. Any printed or downloaded copies of this QR code will stop working. This action cannot be undone.</p>
        </div>
        <div className="flex justify-end gap-3 bg-red-50 px-6 py-4"><button autoFocus disabled={deletingId !== null} className="rounded-md border border-stone-300 bg-white px-4 py-2.5 font-sans text-xs font-semibold text-slate-600" onClick={() => setDeleteTarget(null)}>Cancel</button><button disabled={deletingId !== null} className="rounded-md border-0 bg-red-700 px-4 py-2.5 font-sans text-xs font-bold text-white disabled:opacity-60" onClick={() => { void deleteQrCode(deleteTarget); }}>{deletingId !== null ? "Deleting..." : "Delete QR code"}</button></div>
      </div>
    </div>}
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
    {loading ? <section className="rounded-2xl border border-stone-200 bg-white p-10 text-center font-sans text-sm text-slate-400">Loading QR codes…</section> : codes.length === 0 ? <section className="rounded-2xl border border-stone-200 bg-white p-10 text-center shadow-sm"><h2 className="m-0 font-sans text-xl font-semibold">No QR codes yet</h2><p className="font-sans text-sm text-slate-400">Create a permanent QR code whose destination you can update later.</p><button className="mt-4 rounded-lg bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white" onClick={create}>Create your first QR code</button></section> : <section className="space-y-4">{codes.map((code) => <article key={code.id} className={`rounded-2xl border border-stone-200 p-4 font-sans shadow-sm transition-shadow hover:shadow-md sm:p-5 ${code.active ? "bg-white" : "bg-stone-50"}`}>
      <div className="flex items-start gap-4 sm:gap-5"><div className="shrink-0 rounded-xl bg-stone-50 p-2 ring-1 ring-stone-200"><QrPreview code={code} /></div><div className="min-w-0 flex-1 pt-1"><h2 className="m-0 break-words font-sans text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">{code.name}</h2><div className="mt-3 flex flex-col items-start gap-3">{code.imageMode === "custom" && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700 ring-1 ring-violet-100">Custom image</span>}<div className="flex items-center gap-3 text-xs font-medium text-slate-600"><button aria-label={`${code.active ? "Deactivate" : "Activate"} ${code.name}`} aria-checked={code.active} disabled={updatingStatusId === code.id} role="switch" type="button" className={`flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full border p-0.5 shadow-inner transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${code.active ? "justify-start border-lime-600 bg-lime-600" : "justify-end border-slate-300 bg-slate-300"}`} onClick={() => { void toggle(code); }}><span aria-hidden="true" className="block h-5 w-5 shrink-0 rounded-full bg-white shadow" /></button><span>{updatingStatusId === code.id ? "Updating…" : code.active ? "Active" : "Deactivated"}</span></div></div></div></div>
      <div className="mt-5 min-w-0 space-y-4 rounded-xl bg-stone-50/80 p-3.5 ring-1 ring-stone-200/70"><div><p className="mb-1.5 mt-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Permanent link</p><div className="flex min-w-0 items-center gap-2"><p className="m-0 min-w-0 flex-1 truncate text-sm text-slate-700" title={code.redirectUrl}>{code.redirectUrl}</p><button aria-label="Copy permanent redirect URL" className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 ring-1 ring-stone-200 transition hover:bg-stone-100" onClick={() => { void copyUrl(code.redirectUrl); }}>Copy</button></div></div><div><p className="mb-1.5 mt-0 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Destination</p><div className="flex min-w-0 items-center gap-2"><a className="min-w-0 flex-1 truncate text-sm text-lime-700 underline decoration-lime-300 underline-offset-2" href={code.destinationUrl} title={code.destinationUrl} target="_blank" rel="noreferrer">{code.destinationUrl}</a><button aria-label="Copy current destination URL" className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 ring-1 ring-stone-200 transition hover:bg-stone-100" onClick={() => { void copyUrl(code.destinationUrl); }}>Copy</button></div></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><button className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700" onClick={() => edit(code)}>Edit</button><button className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 ring-1 ring-stone-200 transition hover:bg-stone-50" onClick={() => { void handleDownload(() => downloadPng(code)); }}>PNG</button><button className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 ring-1 ring-stone-200 transition hover:bg-stone-50" onClick={() => { void handleDownload(() => downloadSvg(code)); }}>SVG</button><button className="ml-auto rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50" onClick={() => setDeleteTarget(code)}>Delete</button></div>
    </article>)}</section>}
  </div></main>;
}
