"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { readJson } from "../lib/http";
import { formatLogDate, formatMoney } from "../lib/student-activity";
import StudentPanel from "./student-panel";

type Collector = { email: string; name: string | null; picture: string | null };
type Filter = { id: number; collectorEmail: string; collectorName: string | null; fromDate: string | null; toDate: string | null; paymentTypes: string; isDraft: boolean; totalMinor: number; paymentCount: number; allGiven: number };
type Payment = { id: number; purpose: "course" | "practice_donation"; practiceId: number | null; studentId: number; firstName: string; lastName: string; studentEmail: string | null; studentPicture: string | null; paidOn: string; amountMinor: number; receivedMethod: string; givenToSchool: number; allocations: { paymentId: number; courseName: string; allowance: number }[] };
type Data = { filters: Filter[]; collectors: Collector[] };
type Draft = { collectorEmail: string; fromDate: string; toDate: string; paymentTypes: string[] };

const input = "h-8 w-full rounded border border-stone-300 bg-white px-2 text-xs leading-none disabled:opacity-50";
const types = ["course", "practice_party"] as const;

export default function PaymentTransfersWidget() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [moving, setMoving] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<string | null>(null);
  const [givingAll, setGivingAll] = useState<number | null>(null);
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

  async function add() {
    if (adding) return;
    setAdding(true);
    try {
      const response = await fetch("/api/payment-transfer-filters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empty: true }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not add report row.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add report row."); }
    finally { setAdding(false); }
  }

  async function setGiven(payment: Payment, givenToSchool: boolean) {
    const key = `${payment.purpose}-${payment.id}`;
    if (giving) return;
    setGiving(key);
    try {
      const response = await fetch("/api/students/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: payment.id, studentId: payment.studentId, purpose: payment.purpose, practiceId: payment.practiceId, givenToSchool }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not save the school transfer.");
      setPayments((current) => current.map((item) => item.purpose === payment.purpose && item.id === payment.id ? { ...item, givenToSchool: givenToSchool ? 1 : 0 } : item));
      window.dispatchEvent(new Event("payment-transfer-updated"));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the school transfer."); }
    finally { setGiving(null); }
  }

  async function giveAll(filter: Filter) {
    if (givingAll !== null || !filter.paymentCount || filter.allGiven) return;
    setGivingAll(filter.id);
    try {
      const response = await fetch("/api/payment-transfer-filters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ giveAllForFilterId: filter.id }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not give all payments to school.");
      setPayments((current) => current.map((payment) => ({ ...payment, givenToSchool: 1 })));
      window.dispatchEvent(new Event("payment-transfer-updated"));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not give all payments to school."); }
    finally { setGivingAll(null); }
  }

  return <section className="w-fit max-w-full overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    {error && <p className="p-4 text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto">
      <table className="w-max text-left font-sans text-xs">
        <thead className="text-xs text-white" style={{ backgroundColor: "#286653", color: "#ffffff" }}><tr>
          <th className="w-16 px-2 py-1.5"><span className="sr-only">Reorder</span></th><th className="px-2 py-1.5">Collected by</th><th className="px-2 py-1.5">From</th><th className="px-2 py-1.5">To</th><th className="px-2 py-1.5">Types</th><th className="px-2 py-1.5 text-right">Total collected</th><th className="px-2 py-1.5">Given to school</th><th className="px-2 py-1.5 text-right"><button type="button" className="rounded border border-white/50 px-2 py-1 text-xs font-semibold hover:bg-white/15 disabled:opacity-50" disabled={adding} onClick={() => void add()}>{adding ? "Adding…" : "+ Add report row"}</button></th>
        </tr></thead>
        <tbody>{data?.filters.map((filter, index) => <Fragment key={filter.id}>
          <tr className="cursor-pointer border-b border-stone-200 hover:bg-lime-50" onClick={() => void toggle(filter)}>
            <td className="px-2 py-1"><div className="flex gap-0.5"><button type="button" aria-label={`Move report for ${filter.collectorName || filter.collectorEmail} up`} title="Move up" disabled={index === 0 || moving !== null} className="rounded border border-stone-300 px-1 py-0.5 text-xs leading-none text-slate-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); void reorder(filter.id, data.filters[index - 1].id); }}>▲</button><button type="button" aria-label={`Move report for ${filter.collectorName || filter.collectorEmail} down`} title="Move down" disabled={index === data.filters.length - 1 || moving !== null} className="rounded border border-stone-300 px-1 py-0.5 text-xs leading-none text-slate-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={(event) => { event.stopPropagation(); void reorder(filter.id, data.filters[index + 1].id); }}>▼</button></div></td>
            <EditableFields filter={filter} collectors={data.collectors} onSaved={load} />
            <td className="px-2 py-1 text-right"><button type="button" aria-expanded={expanded === filter.id} className="whitespace-nowrap" onClick={(event) => { event.stopPropagation(); void toggle(filter); }}>{expanded === filter.id ? "▾ " : "▸ "}{formatMoney(filter.totalMinor)} ({filter.paymentCount})</button></td>
            <td className="px-2 py-1"><button type="button" disabled={!filter.paymentCount || filter.allGiven || givingAll !== null} className={`whitespace-nowrap rounded px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${filter.allGiven ? "text-lime-800" : "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"}`} onClick={(event) => { event.stopPropagation(); void giveAll(filter); }}>{givingAll === filter.id ? "Saving…" : filter.allGiven ? "✓ All given" : "Give all to school"}</button></td>
            <td className="px-2 py-1"><button type="button" className="rounded bg-red-700 px-2 py-1 text-xs font-bold text-white hover:bg-red-800" onClick={(event) => { event.stopPropagation(); setRemoving(filter.id); }}>Remove</button></td>
          </tr>
          {expanded === filter.id && <tr><td colSpan={8} className="bg-stone-50 px-3 py-2"><div className="ml-3 border-l-2 border-lime-300 pl-3">{payments.map((payment) => <PaymentTreeRow key={`${payment.purpose}-${payment.id}`} payment={payment} giving={giving === `${payment.purpose}-${payment.id}`} onOpen={() => setStudent({ studentId: payment.studentId, paymentId: payment.id, purpose: payment.purpose })} onGive={(givenToSchool) => void setGiven(payment, givenToSchool)} />)}{!payments.length && <p className="m-0 py-2 text-xs text-slate-500">No payments match this report.</p>}</div></td></tr>}
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
  const initial = (): Draft => ({ collectorEmail: filter.collectorEmail, fromDate: filter.fromDate ?? "", toDate: filter.toDate ?? "", paymentTypes: filter.paymentTypes.split(",").filter(Boolean) });
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
    if (busy || (next.fromDate && next.toDate && next.fromDate > next.toDate)) return;
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
    <td className="px-2 py-1" onClick={stop}><details ref={collectorMenu} className="relative min-w-36"><summary className={`${input} flex cursor-pointer list-none items-center gap-1.5`}>{draft.collectorEmail ? <Avatar collector={selected} /> : <Avatar label="?" />}<span>{selected.name || selected.email || "Select administrator"}</span><span className="ml-auto">⌄</span></summary><div className="absolute left-0 top-full z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-stone-200 bg-white p-1 shadow-xl">{collectors.map((collector) => <button type="button" key={collector.email} className="flex w-full items-center gap-2 rounded p-1.5 text-left text-xs hover:bg-lime-50" onClick={() => { collectorMenu.current?.removeAttribute("open"); void save({ ...draft, collectorEmail: collector.email }); }}><Avatar collector={collector} />{collector.name || collector.email}</button>)}</div></details></td>
    <td className="px-2 py-1" onClick={stop}><DateNameInput ariaLabel="From date" value={draft.fromDate} disabled={busy} onCommit={(fromDate) => void save({ ...draft, fromDate })} /></td>
    <td className="px-2 py-1" onClick={stop}><DateNameInput ariaLabel="To date" value={draft.toDate} disabled={busy} onCommit={(toDate) => void save({ ...draft, toDate })} /></td>
    <td className="px-2 py-1" onClick={stop}><details ref={typeMenu} className="relative min-w-32"><summary className={`${input} cursor-pointer list-none`}>{draft.paymentTypes.length ? draft.paymentTypes.map((type) => type === "course" ? "Courses" : "Practice party").join(" + ") : "Select payment types"} ▾</summary><div className="absolute left-0 top-full z-40 mt-1 w-full rounded-md border border-stone-200 bg-white p-1.5 shadow-xl">{types.map((type) => <label key={type} className="flex items-center gap-2 p-1 text-xs"><input type="checkbox" checked={draft.paymentTypes.includes(type)} disabled={busy} onChange={() => { const paymentTypes = draft.paymentTypes.includes(type) ? draft.paymentTypes.filter((item) => item !== type) : [...draft.paymentTypes, type]; void save({ ...draft, paymentTypes }); }} />{type === "course" ? "Courses" : "Practice party"}</label>)}</div></details></td>
  </>;
}

function Avatar({ collector, label }: { collector?: Collector; label?: string }) {
  const text = collector?.name || collector?.email || label || "?";
  return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 text-[10px]">{collector?.picture ? <img src={collector.picture} alt="" className="h-full w-full rounded-full object-cover" /> : text.charAt(0).toUpperCase()}</span>;
}

function PaymentTreeRow({ payment, giving, onOpen, onGive }: { payment: Payment; giving: boolean; onOpen: () => void; onGive: (givenToSchool: boolean) => void }) {
  const studentName = `${payment.firstName} ${payment.lastName}`.trim() || payment.studentEmail || "Student";
  const kind = payment.purpose === "practice_donation" ? "Practice party donation" : payment.allocations.length ? payment.allocations.map((allocation) => allocation.courseName).join(" + ") : "Custom payment";
  return <div role="button" tabIndex={0} className="relative flex cursor-pointer items-center gap-2 py-1.5 text-left before:absolute before:-left-[13px] before:top-1/2 before:h-px before:w-3 before:bg-lime-300 hover:bg-lime-50 focus:outline-none focus:ring-2 focus:ring-lime-600" onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
    {payment.studentPicture ? <img src={payment.studentPicture} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" /> : <Avatar label={studentName} />}
    <span className="min-w-0 flex-1"><span className="font-medium text-slate-900">{studentName}</span><span className="text-slate-500"> · {formatLogDate(payment.paidOn)}</span><span className="block truncate text-[11px] text-slate-600">{kind} · {payment.receivedMethod || "CASH"}</span></span>
    <button type="button" disabled={giving} className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${payment.givenToSchool ? "text-lime-800 hover:bg-lime-100" : "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"}`} onClick={(event) => { event.stopPropagation(); onGive(!payment.givenToSchool); }}>{giving ? "Saving…" : payment.givenToSchool ? "✓ Given to school" : "Give to school"}</button>
    <strong className="shrink-0 whitespace-nowrap text-slate-900">{formatMoney(payment.amountMinor)}</strong>
  </div>;
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
