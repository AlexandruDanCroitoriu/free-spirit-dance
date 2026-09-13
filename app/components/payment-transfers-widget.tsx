"use client";

import { useEffect, useState } from "react";
import { readJson } from "../lib/http";
import { formatLogDate, formatMoney, validPaymentDate } from "../lib/student-activity";
import PaymentTransferCheckbox from "./payment-transfer-checkbox";
import StudentPanel from "./student-panel";

type Payments = { collectors: { email: string; name: string | null }[]; methods: { method: string }[]; payments: { id: number; purpose?: string; practiceId?: number; practiceDescription?: string; studentId: number; firstName: string; lastName: string; studentEmail: string | null; studentPicture: string | null; administratorName: string | null; administratorPicture: string | null; paidOn: string; amountMinor: number; recordedBy: string; receivedMethod: string; givenToSchool: number }[]; count: number; totals: { pendingMinor: number; givenMinor: number } };
const filterStorageKey = "free-spirit-dance.payment-transfers.filters.v1";
const button = "rounded-md border border-stone-300 bg-white px-3 py-2 text-xs disabled:opacity-50";

export default function PaymentTransfersWidget() {
  const [data, setData] = useState<Payments | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState("all");
  const [collectors, setCollectors] = useState<string[]>([]);
  const [collectorsOpen, setCollectorsOpen] = useState(false);
  const [methods, setMethods] = useState<string[]>([]);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [editingPayment, setEditingPayment] = useState<{ studentId: number; paymentId: number } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(filterStorageKey) ?? "null");
      if (saved && typeof saved === "object") {
        const values = saved as Record<string, unknown>;
        if (values.status === "all" || values.status === "pending" || values.status === "given") setStatus(values.status);
        if (Array.isArray(values.collectors) && values.collectors.length <= 90 && values.collectors.every((email) => typeof email === "string" && email.trim() && email.length <= 254)) setCollectors([...new Set(values.collectors as string[])]);
        if (Array.isArray(values.methods) && values.methods.length <= 30 && values.methods.every((method) => typeof method === "string" && method.trim() && method.length <= 50)) setMethods([...new Set(values.methods as string[])]);
        const savedFrom = validPaymentDate(values.from, true) ? values.from : "";
        const savedTo = validPaymentDate(values.to, true) ? values.to : "";
        if (!savedFrom || !savedTo || savedFrom <= savedTo) {
          setFrom(savedFrom); setTo(savedTo);
        }
      }
    } catch {
      // Invalid or unavailable storage must not prevent using the widget.
    }
    setFiltersLoaded(true);
  }, []);
  useEffect(() => {
    // Restore saved filters before persisting the current selection.
    if (!filtersLoaded) return;
    try {
      window.localStorage.setItem(filterStorageKey, JSON.stringify({ status, from, to, collectors, methods }));
    } catch {
      // Filters still work when browser storage is blocked or full.
    }
  }, [filtersLoaded, status, from, to, collectors, methods]);
  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("student-activity-updated", refresh);
    window.addEventListener("payment-transfer-updated", refresh);
    window.addEventListener("administrator-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("student-activity-updated", refresh);
      window.removeEventListener("payment-transfer-updated", refresh);
      window.removeEventListener("administrator-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    if (!filtersLoaded) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    if (from && to && from > to) {
      setError("From must be on or before To."); setLoading(false);
      return () => controller.abort();
    }
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status, from, to });
    collectors.forEach((email) => query.append("collector", email));
    methods.forEach((method) => query.append("method", method));
    fetch(`/api/students/payments?${query}`, { signal: controller.signal }).then(async (response) => {
      const body = await readJson<Payments & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not load payments.");
      if (!controller.signal.aborted) {
        const lastPage = Math.max(1, Math.ceil(body.count / pageSize));
        if (page > lastPage) setPage(lastPage);
        else setData(body);
      }
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load payments."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filtersLoaded, page, pageSize, status, from, to, collectors, methods, reload]);
  return <section aria-busy={loading} aria-labelledby="payment-transfers-title" className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm lg:col-span-full">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="payment-transfers-title" className="m-0 text-lg font-normal">Payments & school transfers</h2><select aria-label="Transfer status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={button}><option value="all">All payments</option><option value="pending">Not confirmed as given</option><option value="given">Give to school</option></select></div>
    <div className="my-4 flex flex-wrap items-end gap-3 font-sans text-xs">
      <label className="flex flex-col gap-1">From (payment date)<input type="date" min="1900-01-01" max={to || "9999-12-31"} value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className={button} /></label>
      <label className="flex flex-col gap-1">To (payment date)<input type="date" min={from || "1900-01-01"} max="9999-12-31" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className={button} /></label>
      <div className="relative flex flex-col gap-1">
        <span id="collector-filter-label">Collected by</span>
        <button type="button" aria-expanded={collectorsOpen} aria-haspopup="listbox" aria-labelledby="collector-filter-label" className={`${button} flex min-w-64 items-center justify-between gap-3 text-left`} onClick={() => setCollectorsOpen((open) => !open)}>
          <span>{collectors.length ? `${collectors.length} administrator${collectors.length === 1 ? "" : "s"} selected` : "All administrators"}</span><span aria-hidden="true">⌄</span>
        </button>
        {collectorsOpen && <div role="listbox" aria-label="Collected by administrators" aria-multiselectable="true" className="absolute left-0 top-full z-10 mt-1 max-h-64 w-72 max-w-[80vw] overflow-y-auto rounded-md border border-stone-200 bg-white p-2 shadow-lg">
          {(data?.collectors ?? []).map((collector) => {
            const selected = collectors.includes(collector.email);
            return <button key={collector.email} type="button" role="option" aria-selected={selected} className={`flex w-full items-start gap-2 rounded p-2 text-left hover:bg-stone-50 ${selected ? "bg-lime-50" : ""}`} onClick={() => { setCollectors((current) => selected ? current.filter((email) => email !== collector.email) : [...current, collector.email]); setMethods([]); setPage(1); }}>
              <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-lime-600 bg-lime-600 text-white" : "border-stone-400"}`}>{selected ? "✓" : ""}</span>
              <span className="min-w-0 break-words">{collector.name?.trim() || collector.email}{collector.name?.trim() && <span className="block text-slate-500">{collector.email}</span>}</span>
            </button>;
          })}
          {!data && <p className="p-2 text-slate-500">{error ? "Could not load administrators. Use Retry below." : "Loading administrators…"}</p>}
          {data && !data.collectors.length && <p className="p-2 text-slate-500">No collecting administrators yet.</p>}
        </div>}
      </div>
      {!!collectors.length && <div className="relative flex flex-col gap-1"><span id="method-filter-label">Received via</span><button type="button" aria-expanded={methodsOpen} aria-haspopup="listbox" aria-labelledby="method-filter-label" className={`${button} flex min-w-48 items-center justify-between gap-3 text-left`} onClick={() => setMethodsOpen((open) => !open)}><span>{methods.length ? `${methods.length} method${methods.length === 1 ? "" : "s"} selected` : "All methods"}</span><span aria-hidden="true">⌄</span></button>{methodsOpen && <div role="listbox" aria-label="Payment methods" aria-multiselectable="true" className="absolute left-0 top-full z-10 mt-1 max-h-64 w-64 max-w-[80vw] overflow-y-auto rounded-md border border-stone-200 bg-white p-2 shadow-lg">{(data?.methods ?? []).map(({ method }) => { const selected = methods.includes(method); return <button key={method} type="button" role="option" aria-selected={selected} className={`flex w-full items-center gap-2 rounded p-2 text-left hover:bg-stone-50 ${selected ? "bg-lime-50" : ""}`} onClick={() => { setMethods((current) => selected ? current.filter((item) => item !== method) : [...current, method]); setPage(1); }}><span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-lime-600 bg-lime-600 text-white" : "border-stone-400"}`}>{selected ? "✓" : ""}</span>{method}</button>; })}{data && !data.methods.length && <p className="p-2 text-slate-500">No payment methods have been used by the selected administrators.</p>}</div>}</div>}
      <button type="button" className={button} disabled={!from && !to && status === "all" && !collectors.length && !methods.length} onClick={() => { setFrom(""); setTo(""); setStatus("all"); setCollectors([]); setMethods([]); setPage(1); }}>Clear filters</button>
    </div>
    {error && <p role="alert" className="font-sans text-sm text-red-700">{error} <button className={button} onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
    {loading && <p role="status" className={data ? "sr-only" : "font-sans text-xs text-slate-500"}>Loading payments…</p>}
    {data && <><div className="mb-4 flex flex-wrap gap-4 font-sans text-sm"><p className="m-0 rounded-lg bg-amber-50 p-3 text-amber-900">Unconfirmed handovers: <strong>{formatMoney(data.totals.pendingMinor)}</strong></p><p className="m-0 rounded-lg bg-lime-50 p-3 text-lime-900">Given to school: <strong>{formatMoney(data.totals.givenMinor)}</strong></p></div>
      <div className="overflow-x-auto"><table className="w-full text-left font-sans text-sm"><caption className="sr-only">Payments from all students, newest first</caption><thead className="bg-stone-50 text-xs text-slate-500"><tr>{["Date", "Student", "Amount", "Collected by", "Received via", "School transfer", ""].map((label, index) => <th key={label || index} scope="col" className="p-3">{label || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody className="divide-y divide-stone-200">{data.payments.map((payment) => <tr key={`${payment.purpose}-${payment.id}`}><td className="whitespace-nowrap p-3">{formatLogDate(payment.paidOn)}</td><td className="p-3"><button type="button" aria-haspopup="dialog" className="flex items-center gap-2 text-left underline" onClick={() => setSelectedStudentId(payment.studentId)}><PaymentAvatar picture={payment.studentPicture} name={payment.firstName.trim() || payment.studentEmail || "Student"} /><span>{payment.firstName.trim() ? `${payment.firstName} ${payment.lastName}`.trim() : payment.studentEmail || "Student"}</span></button></td><td className="whitespace-nowrap p-3">{formatMoney(payment.amountMinor)}{payment.purpose === "practice_donation" && <p className="text-xs">Donation · Practice party</p>}</td><td className="p-3 text-xs"><span className="flex items-center gap-2" title={payment.recordedBy}><PaymentAvatar picture={payment.administratorPicture} name={payment.administratorName?.trim() || payment.recordedBy} /><span className="break-words">{payment.administratorName?.trim() || payment.recordedBy}</span></span></td><td className="p-3 text-xs"><span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-slate-700">{payment.receivedMethod || "CASH"}</span></td><td className="p-3"><PaymentTransferCheckbox paymentId={payment.id} studentId={payment.studentId} checked={payment.givenToSchool === 1} disabled={loading || !!error} purpose={payment.purpose === "practice_donation" ? "practice_donation" : undefined} practiceId={payment.practiceId} /></td><td className="p-3 text-right">{payment.purpose === "practice_donation" ? <span className="text-xs text-slate-400">—</span> : <button type="button" className={button} onClick={() => setEditingPayment({ studentId: payment.studentId, paymentId: payment.id })}>Edit</button>}</td></tr>)}{!data.payments.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No payments match this filter.</td></tr>}</tbody></table></div>
      <nav aria-label="Payment pages" className="mt-3 flex flex-wrap items-center justify-between gap-3 font-sans"><label className="flex items-center gap-2 text-xs text-slate-500">Rows per page<select value={pageSize} disabled={loading} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className={button}>{[10, 20, 30, 40, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label><button className={button} disabled={loading || !!error || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span className="text-xs text-slate-500">Page {page} of {Math.max(1, Math.ceil(data.count / pageSize))} · {data.count} payments</span><button className={button} disabled={loading || !!error || page * pageSize >= data.count} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
    </>}
    {selectedStudentId !== null && <StudentPanel key={selectedStudentId} id={selectedStudentId} onClose={() => { setSelectedStudentId(null); setReload((value) => value + 1); }} onUpdate={() => setReload((value) => value + 1)} onDelete={() => { setSelectedStudentId(null); setReload((value) => value + 1); }} />}
    {editingPayment && <StudentPanel key={`payment-${editingPayment.paymentId}`} id={editingPayment.studentId} editPaymentId={editingPayment.paymentId} onClose={() => { setEditingPayment(null); setReload((value) => value + 1); }} onUpdate={() => setReload((value) => value + 1)} onDelete={() => { setEditingPayment(null); setReload((value) => value + 1); }} />}
  </section>;
}

function PaymentAvatar({ picture, name }: { picture: string | null; name: string }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  return <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 font-sans text-xs font-semibold text-lime-800">
    {picture && picture !== failedPicture ? <img src={picture} alt="" width={32} height={32} loading="lazy" className="h-full w-full object-cover" onError={() => setFailedPicture(picture)} /> : name.charAt(0).toUpperCase()}
  </span>;
}
