"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { readJson } from "../lib/http";
import { formatLogDate, formatMoney } from "../lib/student-activity";
import StudentPanel from "./student-panel";

type Collector = { email: string; name: string | null; picture: string | null };
type Filter = { id: number; collectorEmail: string; collectorName: string | null; fromDate: string | null; toDate: string | null; paymentTypes: string; totalMinor: number; paymentCount: number; allGiven: number };
type Payment = { id: number; purpose: "course" | "practice_donation"; studentId: number; firstName: string; lastName: string; studentEmail: string | null; studentPicture: string | null; paidOn: string; amountMinor: number; receivedMethod: string; givenToSchool: number };
type Data = { filters: Filter[]; collectors: Collector[] };
type Draft = { collectorEmail: string; fromDate: string; toDate: string; paymentTypes: string[] };

const input = "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-xs disabled:opacity-50";
const types = ["course", "practice_party"] as const;

export default function PaymentTransfersWidget() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [moving, setMoving] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [student, setStudent] = useState<{ studentId: number; paymentId: number; purpose: Payment["purpose"] } | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/payment-transfer-filters");
      const body = await readJson<Data & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not load saved transfer filters.");
      setData(body); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load saved transfer filters."); }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(filter: Filter) {
    if (expanded === filter.id) { setExpanded(null); return; }
    setExpanded(filter.id); setPayments([]);
    try {
      const response = await fetch(`/api/payment-transfer-filters?id=${filter.id}`);
      const body = await readJson<{ payments?: Payment[]; error?: string }>(response);
      if (!response.ok || !body.payments) throw new Error(body.error ?? "Could not load payments.");
      setPayments(body.payments);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load payments."); }
  }

  async function reorder(source: number, target: number) {
    if (!data || source === target || moving !== null) return;
    const rows = [...data.filters], from = rows.findIndex((row) => row.id === source), to = rows.findIndex((row) => row.id === target);
    if (from < 0 || to < 0) return;
    const previous = data, [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved); setData({ ...data, filters: rows }); setMoving(source);
    try {
      const response = await fetch("/api/payment-transfer-filters", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: rows.map((row) => row.id) }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not save report order.");
    } catch (reason) { setData(previous); setError(reason instanceof Error ? reason.message : "Could not save report order."); }
    finally { setMoving(null); }
  }

  async function remove() {
    if (removing === null) return;
    const id = removing; setRemoving(null);
    try {
      const response = await fetch(`/api/payment-transfer-filters?id=${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove report.");
      if (expanded === id) setExpanded(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove report."); }
  }

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    {error && <p className="p-4 text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left font-sans text-sm">
        <thead className="text-xs text-white" style={{ backgroundColor: "#286653", color: "#ffffff" }}><tr>
          <th className="w-12 p-3"><span className="sr-only">Reorder</span></th><th className="p-3">Collected by</th><th className="p-3">From</th><th className="p-3">To</th><th className="p-3">Types</th><th className="p-3 text-right">Total collected</th><th className="p-3">Given to school</th><th className="p-3"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>{data?.filters.map((filter, index) => <Fragment key={filter.id}>
          <tr className="cursor-pointer border-b border-stone-200 hover:bg-lime-50" onClick={() => void toggle(filter)}>
            <td className="p-2"><div className="flex flex-col gap-1"><button type="button" aria-label={`Move report for ${filter.collectorName || filter.collectorEmail} up`} title="Move up" disabled={index === 0 || moving !== null} className="rounded border border-stone-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); void reorder(filter.id, data.filters[index - 1].id); }}>▲</button><button type="button" aria-label={`Move report for ${filter.collectorName || filter.collectorEmail} down`} title="Move down" disabled={index === data.filters.length - 1 || moving !== null} className="rounded border border-stone-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); void reorder(filter.id, data.filters[index + 1].id); }}>▼</button></div></td>
            <EditableFields filter={filter} collectors={data.collectors} onSaved={load} />
            <td className="p-3 text-right"><button type="button" aria-expanded={expanded === filter.id} className="whitespace-nowrap" onClick={(event) => { event.stopPropagation(); void toggle(filter); }}>{expanded === filter.id ? "▾ " : "▸ "}{formatMoney(filter.totalMinor)} ({filter.paymentCount})</button></td>
            <td className="p-3">{filter.allGiven ? "✓" : "□"}</td>
            <td className="p-3"><button type="button" className="rounded bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800" onClick={(event) => { event.stopPropagation(); setRemoving(filter.id); }}>Remove</button></td>
          </tr>
          {expanded === filter.id && <tr><td colSpan={8} className="bg-stone-50 p-3">{payments.map((payment) => <button key={`${payment.purpose}-${payment.id}`} type="button" className="mb-2 flex w-full items-center gap-3 rounded border border-stone-200 bg-white p-3 text-left hover:bg-lime-50" onClick={() => setStudent({ studentId: payment.studentId, paymentId: payment.id, purpose: payment.purpose })}>{payment.studentPicture ? <img src={payment.studentPicture} alt="" className="h-8 w-8 rounded-full object-cover" /> : <Avatar label={payment.firstName || payment.studentEmail || "?"} />}<span>{`${payment.firstName} ${payment.lastName}`.trim() || payment.studentEmail} · {formatLogDate(payment.paidOn)}<span className="block text-xs text-slate-500">{payment.purpose === "course" ? "Course payment" : "Practice party donation"} · {payment.receivedMethod || "CASH"} · {payment.givenToSchool ? "Given to school" : "Pending school transfer"}</span></span><strong className="ml-auto">{formatMoney(payment.amountMinor)}</strong></button>)}</td></tr>}
        </Fragment>)}
        {!data?.filters.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No saved reports.</td></tr>}
        </tbody>
      </table>
    </div>
    {removing !== null && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><div className="rounded-xl border border-red-300 bg-red-50 p-5"><h3 className="m-0 text-red-950">Remove saved report?</h3><p className="text-sm text-red-900">Payments will not be deleted.</p><div className="flex justify-end gap-2"><button type="button" className="rounded border px-3 py-2 text-xs" onClick={() => setRemoving(null)}>Cancel</button><button type="button" className="rounded bg-red-700 px-3 py-2 text-xs font-bold text-white" onClick={() => void remove()}>Remove report</button></div></div></div>}
    {student && <StudentPanel key={`${student.studentId}-${student.purpose}-${student.paymentId}`} id={student.studentId} targetPaymentId={student.paymentId} targetPaymentKind={student.purpose === "course" ? "payment" : "practice_attendance"} onClose={() => setStudent(null)} onUpdate={() => void load()} onDelete={() => setStudent(null)} />}
  </section>;
}

function EditableFields({ filter, collectors, onSaved }: { filter: Filter; collectors: Collector[]; onSaved: () => Promise<void> }) {
  const initial = (): Draft => ({ collectorEmail: filter.collectorEmail, fromDate: filter.fromDate ?? "", toDate: filter.toDate ?? "", paymentTypes: filter.paymentTypes.split(",") });
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const collectorMenu = useRef<HTMLDetailsElement>(null);
  const typeMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { setDraft(initial()); }, [filter.collectorEmail, filter.fromDate, filter.toDate, filter.paymentTypes]);
  useEffect(() => { const close = (event: PointerEvent) => { if (collectorMenu.current && !collectorMenu.current.contains(event.target as Node)) collectorMenu.current.removeAttribute("open"); if (typeMenu.current && !typeMenu.current.contains(event.target as Node)) typeMenu.current.removeAttribute("open"); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, []);
  const stop = (event: { stopPropagation: () => void; target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (event.target !== event.currentTarget) event.stopPropagation();
  };
  async function save(next: Draft) {
    if (busy || !next.paymentTypes.length || (next.fromDate && next.toDate && next.fromDate > next.toDate)) return;
    setDraft(next); setBusy(true);
    try {
      const response = await fetch("/api/payment-transfer-filters", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: filter.id, ...next }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not save report.");
      await onSaved();
    } finally { setBusy(false); }
  }
  const selected = collectors.find((collector) => collector.email === draft.collectorEmail) ?? { email: draft.collectorEmail, name: filter.collectorName, picture: null };
  return <>
    <td className="p-3" onClick={stop}><details ref={collectorMenu} className="relative min-w-40"><summary className={`${input} flex cursor-pointer list-none items-center gap-2`}><Avatar collector={selected} /><span>{selected.name || selected.email}</span><span className="ml-auto">⌄</span></summary><div className="absolute left-0 top-full z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-stone-200 bg-white p-1 shadow-xl">{collectors.map((collector) => <button type="button" key={collector.email} className="flex w-full items-center gap-2 rounded p-2 text-left text-xs hover:bg-lime-50" onClick={() => { collectorMenu.current?.removeAttribute("open"); void save({ ...draft, collectorEmail: collector.email }); }}><Avatar collector={collector} />{collector.name || collector.email}</button>)}</div></details></td>
    <td className="p-3" onClick={stop}><DateNameInput ariaLabel="From date" value={draft.fromDate} disabled={busy} onCommit={(fromDate) => void save({ ...draft, fromDate })} /></td>
    <td className="p-3" onClick={stop}><DateNameInput ariaLabel="To date" value={draft.toDate} disabled={busy} onCommit={(toDate) => void save({ ...draft, toDate })} /></td>
    <td className="p-3" onClick={stop}><details ref={typeMenu} className="relative min-w-36"><summary className={`${input} cursor-pointer list-none`}>{draft.paymentTypes.map((type) => type === "course" ? "Courses" : "Practice party").join(" + ")} ▾</summary><div className="absolute left-0 top-full z-40 mt-1 w-full rounded-md border border-stone-200 bg-white p-2 shadow-xl">{types.map((type) => <label key={type} className="flex items-center gap-2 p-1 text-xs"><input type="checkbox" checked={draft.paymentTypes.includes(type)} disabled={busy} onChange={() => { const paymentTypes = draft.paymentTypes.includes(type) ? draft.paymentTypes.filter((item) => item !== type) : [...draft.paymentTypes, type]; if (paymentTypes.length) void save({ ...draft, paymentTypes }); }} />{type === "course" ? "Courses" : "Practice party"}</label>)}</div></details></td>
  </>;
}

function Avatar({ collector, label }: { collector?: Collector; label?: string }) {
  const text = collector?.name || collector?.email || label || "?";
  return <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 text-xs">{collector?.picture ? <img src={collector.picture} alt="" className="h-full w-full object-cover" /> : text.charAt(0).toUpperCase()}</span>;
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function namedDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return Number.isInteger(year) && month >= 1 && month <= 12 && day >= 1 ? `${day} ${monthNames[month - 1]} ${year}` : value;
}

function isoDate(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (!match) return value.trim() === "" ? "" : null;
  const day = Number(match[1]), month = monthNames.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) + 1, year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!month || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function DateNameInput({ value, disabled, ariaLabel, onCommit }: { value: string; disabled: boolean; ariaLabel: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(namedDate(value));
  useEffect(() => setText(namedDate(value)), [value]);
  function commit() {
    const parsed = isoDate(text);
    if (parsed === null) { setText(namedDate(value)); return; }
    if (parsed !== value) onCommit(parsed);
  }
  return <input aria-label={ariaLabel} title="Use a date such as 16 July 2026" className={input} value={text} disabled={disabled} placeholder="16 July 2026" onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
