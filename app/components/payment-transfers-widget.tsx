"use client";

import { useEffect, useState } from "react";
import { readJson } from "../lib/http";
import { formatLogDate, formatMoney, validPaymentDate } from "../lib/student-activity";
import PaymentTransferCheckbox from "./payment-transfer-checkbox";

type Payments = { payments: { id: number; studentId: number; firstName: string; lastName: string; studentEmail: string | null; studentPicture: string | null; administratorName: string | null; administratorPicture: string | null; paidOn: string; amountMinor: number; recordedBy: string; givenToSchool: number }[]; count: number; totals: { pendingMinor: number; givenMinor: number } };
const filterStorageKey = "free-spirit-dance.payment-transfers.filters.v1";
const button = "rounded-md border border-stone-300 bg-white px-3 py-2 text-xs disabled:opacity-50";

export default function PaymentTransfersWidget() {
  const [data, setData] = useState<Payments | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
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
      window.localStorage.setItem(filterStorageKey, JSON.stringify({ status, from, to }));
    } catch {
      // Filters still work when browser storage is blocked or full.
    }
  }, [filtersLoaded, status, from, to]);
  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("student-activity-updated", refresh);
    window.addEventListener("payment-transfer-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("student-activity-updated", refresh);
      window.removeEventListener("payment-transfer-updated", refresh);
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
    const query = new URLSearchParams({ page: String(page), status, from, to });
    fetch(`/api/students/payments?${query}`, { signal: controller.signal }).then(async (response) => {
      const body = await readJson<Payments & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not load payments.");
      if (!controller.signal.aborted) {
        const lastPage = Math.max(1, Math.ceil(body.count / 10));
        if (page > lastPage) setPage(lastPage);
        else setData(body);
      }
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load payments."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filtersLoaded, page, status, from, to, reload]);
  return <section aria-busy={loading} aria-labelledby="payment-transfers-title" className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm lg:col-span-full">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="payment-transfers-title" className="m-0 text-lg font-normal">Payments & school transfers</h2><select aria-label="Transfer status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={button}><option value="all">All payments</option><option value="pending">Not confirmed as given</option><option value="given">Give to school</option></select></div>
    <div className="my-4 flex flex-wrap items-end gap-3 font-sans text-xs">
      <label className="flex flex-col gap-1">From (payment date)<input type="date" min="1900-01-01" max={to || "9999-12-31"} value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className={button} /></label>
      <label className="flex flex-col gap-1">To (payment date)<input type="date" min={from || "1900-01-01"} max="9999-12-31" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} className={button} /></label>
      <button type="button" className={button} disabled={!from && !to && status === "all"} onClick={() => { setFrom(""); setTo(""); setStatus("all"); setPage(1); }}>Clear filters</button>
    </div>
    {error && <p role="alert" className="font-sans text-sm text-red-700">{error} <button className={button} onClick={() => setReload((value) => value + 1)}>Retry</button></p>}
    {loading && <p role="status" className={data ? "sr-only" : "font-sans text-xs text-slate-500"}>Loading payments…</p>}
    {data && <><div className="mb-4 flex flex-wrap gap-4 font-sans text-sm"><p className="m-0 rounded-lg bg-amber-50 p-3 text-amber-900">Unconfirmed handovers: <strong>{formatMoney(data.totals.pendingMinor)}</strong></p><p className="m-0 rounded-lg bg-lime-50 p-3 text-lime-900">Given to school: <strong>{formatMoney(data.totals.givenMinor)}</strong></p></div>
      <div className="overflow-x-auto"><table className="w-full text-left font-sans text-sm"><caption className="sr-only">Payments from all students, newest first</caption><thead className="bg-stone-50 text-xs text-slate-500"><tr>{["Date", "Student", "Amount", "Collected by", "School transfer"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-stone-200">{data.payments.map((payment) => <tr key={payment.id}><td className="whitespace-nowrap p-3">{formatLogDate(payment.paidOn)}</td><td className="p-3"><a className="flex items-center gap-2 underline" href={`/students/${payment.studentId}`}><PaymentAvatar picture={payment.studentPicture} name={payment.firstName.trim() || payment.studentEmail || "Student"} /><span>{payment.firstName.trim() ? `${payment.firstName} ${payment.lastName}`.trim() : payment.studentEmail || "Student"}</span></a></td><td className="whitespace-nowrap p-3">{formatMoney(payment.amountMinor)}</td><td className="p-3 text-xs"><span className="flex items-center gap-2" title={payment.recordedBy}><PaymentAvatar picture={payment.administratorPicture} name={payment.administratorName?.trim() || payment.recordedBy} /><span className="break-words">{payment.administratorName?.trim() || payment.recordedBy}</span></span></td><td className="p-3"><PaymentTransferCheckbox paymentId={payment.id} studentId={payment.studentId} checked={payment.givenToSchool === 1} disabled={loading || !!error} /></td></tr>)}{!data.payments.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No payments match this filter.</td></tr>}</tbody></table></div>
      <nav aria-label="Payment pages" className="mt-3 flex items-center justify-between gap-3 font-sans"><button className={button} disabled={loading || !!error || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span className="text-xs text-slate-500">Page {page} of {Math.max(1, Math.ceil(data.count / 10))} · {data.count} payments</span><button className={button} disabled={loading || !!error || page * 10 >= data.count} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
    </>}
  </section>;
}

function PaymentAvatar({ picture, name }: { picture: string | null; name: string }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  return <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 font-sans text-xs font-semibold text-lime-800">
    {picture && picture !== failedPicture ? <img src={picture} alt="" width={32} height={32} loading="lazy" className="h-full w-full object-cover" onError={() => setFailedPicture(picture)} /> : name.charAt(0).toUpperCase()}
  </span>;
}
