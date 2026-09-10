"use client";

import { requestJson } from "../lib/http";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/student-activity";
import { presetDraft, type PaymentPreset } from "../lib/payment-presets";

type PresetData = { presets: PaymentPreset[]; courses: { id: number; name: string }[] };
const button = "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
const primary = "rounded-md bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-white disabled:opacity-50";
const inputClass = "mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600";
export default function PaymentsPage() {
  const [data, setData] = useState<PresetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    requestJson<PresetData>("/api/payment-presets").then((result) => { if (!cancelled) setData(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load presets."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, [open]);
  function edit(preset?: PaymentPreset) {
    const draft = preset ? presetDraft(preset) : { amount: "", allocations: {} };
    setEditingId(preset?.id ?? null); setName(preset?.name ?? ""); setAmount(draft.amount); setAllocations(draft.allocations); setFormError(""); setOpen(true);
  }
  async function save() {
    if (saving.current) return;
    if (!Object.keys(allocations).length) { setFormError("Select at least one course and its class allowance."); return; }
    saving.current = true; setBusy(true); setFormError("");
    try {
      const result = await requestJson<PaymentPreset>(editingId === null ? "/api/payment-presets" : `/api/payment-presets/${editingId}`, { method: editingId === null ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, amount, allocations: Object.entries(allocations).map(([id, allowance]) => ({ courseId: Number(id), allowance: Number(allowance) })) }) });
      setData((current) => current ? { ...current, presets: [...current.presets.filter((p) => p.id !== result.id), result].sort((a, b) => a.name.localeCompare(b.name)) } : current);
      setOpen(false); setNotice("Payment preset saved.");
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not save preset."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function remove(preset: PaymentPreset) {
    if (saving.current || !window.confirm(`Delete “${preset.name}”? Recorded student payments will stay unchanged.`)) return;
    saving.current = true; setBusy(true); setFormError("");
    try {
      await requestJson<void>(`/api/payment-presets/${preset.id}`, { method: "DELETE" });
      setData((current) => current ? { ...current, presets: current.presets.filter((p) => p.id !== preset.id) } : current); setOpen(false); setNotice("Payment preset deleted.");
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not delete preset."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h2 className="m-0 text-xl font-normal">Payment presets</h2><p className="mb-0 mt-2 max-w-2xl font-sans text-sm leading-6 text-slate-500">Set up common payments with an amount and classes per course. Administrators can select a preset when recording a student’s payment.</p></div><button type="button" className={primary} disabled={loading || !data?.courses.length || busy} onClick={() => edit()}>+ Add preset</button></div>
    {error && <p role="alert" className="font-sans text-sm text-red-700">{error} <button type="button" className={button} disabled={busy} onClick={() => setRetry((n) => n + 1)}>Retry loading</button></p>}
    {notice && <p role="status" className="font-sans text-sm text-lime-700">{notice}</p>}
    {loading ? <p className="font-sans text-sm text-slate-500">Loading payment presets…</p> : data && <section aria-label="Payment presets" className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {!data.courses.length && <p className="px-5 font-sans text-sm text-slate-500">Create a course before adding a payment preset.</p>}
      {!data.presets.length ? <div className="p-8 text-center"><h3 className="m-0 text-lg font-normal">No payment presets yet</h3><p className="mb-0 mt-2 font-sans text-sm text-slate-500">Add a preset here, then use it from a student’s Record payment popup.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left font-sans text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500"><tr>{["Preset", "Amount", "Classes per course", "Actions"].map((label) => <th key={label} scope="col" className="px-5 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-stone-200">{data.presets.map((preset) => <tr key={preset.id}><th scope="row" className="px-5 py-4 font-semibold">{preset.name}</th><td className="whitespace-nowrap px-5 py-4">{formatMoney(preset.amountMinor)}</td><td className="px-5 py-4">{preset.allocations.map((a) => <div key={a.courseId}>{a.courseName}: {a.allowance} {a.allowance === 1 ? "class" : "classes"}</div>)}</td><td className="px-5 py-4"><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => edit(preset)} aria-label={`Edit ${preset.name}`}>Edit</button></div></td></tr>)}</tbody></table></div>}
    </section>}
    {open && data && <dialog ref={dialog} aria-labelledby="preset-title" aria-modal="true" className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto border-0 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={(event) => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <div className="flex items-center justify-between gap-4"><h2 id="preset-title" className="m-0 text-xl font-normal">{editingId === null ? "Add payment preset" : "Edit payment preset"}</h2><button type="button" aria-label="Close payment preset panel" className={button} disabled={busy} onClick={() => setOpen(false)}>×</button></div><p className="font-sans text-sm text-slate-500">Changes apply to future payments. Recorded payments keep their original amount and allowances.</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={busy} className="m-0 space-y-4 border-0 p-0 font-sans text-xs font-semibold text-slate-600">
        <label className="block">Preset name<input autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="e.g. Four Zouk classes" /></label>
        <label className="block">Amount (RON)<input required inputMode="decimal" pattern="[0-9]{1,6}([.,][0-9]{1,2})?" maxLength={9} value={amount} onChange={(event) => setAmount(event.target.value)} className={inputClass} placeholder="e.g. 200.00" /></label>
        <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3"><legend className="px-1">Classes per course</legend>{data.courses.map((course) => <div key={course.id} className="flex items-center justify-between gap-3"><label className="flex items-center gap-2"><input type="checkbox" checked={course.id in allocations} className="h-4 w-4 accent-lime-700" onChange={(event) => setAllocations((current) => { const next = { ...current }; if (event.target.checked) next[course.id] = "1"; else delete next[course.id]; return next; })} />{course.name}</label>{course.id in allocations && <input type="number" required min="1" max="10000" step="1" aria-label={`Classes for ${course.name}`} value={allocations[course.id]} className="w-20 rounded-md border border-stone-300 p-2 text-sm" onChange={(event) => setAllocations((current) => ({ ...current, [course.id]: event.target.value }))} />}</div>)}</fieldset>
      </fieldset>{formError && <p role="alert" className="font-sans text-sm text-red-700">{formError}</p>}<div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-stone-200 pt-4">{editingId !== null && <button type="button" className={button + " mr-auto border-red-300 text-red-700"} disabled={busy} onClick={() => { const preset = data.presets.find((item) => item.id === editingId); if (preset) void remove(preset); }}>Delete preset</button>}<button type="button" className={button} disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className={primary} disabled={busy}>{busy ? "Saving…" : "Save preset"}</button></div></form>
    </dialog>}
  </div></main>;
}
