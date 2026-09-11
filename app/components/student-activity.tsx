"use client";

import PaymentTransferCheckbox from "./payment-transfer-checkbox";
import { useEffect, useRef, useState } from "react";
import { activityLogPageSize, activityLogPageSizes, formatLogDate, formatMoney, schoolToday, type StudentActivity as Activity } from "../lib/student-activity";
import { presetDraft, type PaymentPreset } from "../lib/payment-presets";

const button = "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
const primary = "rounded-md border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-white disabled:opacity-50";
const inputClass = "mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600";
async function readResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Could not complete the request. Please try again.");
  return body;
}

export default function StudentActivity({ studentId, initialPaymentId }: { studentId: number; initialPaymentId?: number }) {
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [logsPageSize, setLogsPageSize] = useState(activityLogPageSize);
  const [logsPage, setLogsPage] = useState(1);
  const [mode, setMode] = useState<"payment" | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [formError, setFormError] = useState("");
  const [date, setDate] = useState("");
  const [presets, setPresets] = useState<PaymentPreset[]>([]);
  const [presetId, setPresetId] = useState("");
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [receivedMethod, setReceivedMethod] = useState("");
  const [presetRetry, setPresetRetry] = useState(0);
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const presetToMatch = useRef<Pick<Activity["logs"][number], "amountMinor" | "allocations"> | null>(null);
  const requestKey = useRef("");
  const submitted = useRef<string | null>(null);
  const initialPaymentOpened = useRef<number | null>(null);
  const url = `/api/students/${studentId}/activity`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`${url}?logsPage=${logsPage}&logsPageSize=${logsPageSize}${initialPaymentId ? `&paymentId=${initialPaymentId}` : ""}`, { signal: controller.signal })
      .then(readResponse).then((body) => { if (!controller.signal.aborted) setData(body as Activity); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load student activity."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, reload, logsPage, logsPageSize, initialPaymentId]);
  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent<number>).detail === studentId) setReload((value) => value + 1); };
    const refreshActivity = () => setReload((value) => value + 1);
    window.addEventListener("student-courses-updated", refresh);
    window.addEventListener("calendar-updated", refreshActivity);
    window.addEventListener("student-activity-updated", refreshActivity);
    window.addEventListener("payment-transfer-updated", refreshActivity);
    window.addEventListener("focus", refreshActivity);
    return () => {
      window.removeEventListener("student-courses-updated", refresh);
      window.removeEventListener("calendar-updated", refreshActivity);
      window.removeEventListener("student-activity-updated", refreshActivity);
      window.removeEventListener("payment-transfer-updated", refreshActivity);
      window.removeEventListener("focus", refreshActivity);
    };
  }, [studentId]);
  useEffect(() => {
    if (!mode) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [mode]);

  useEffect(() => {
    if (mode !== "payment") return;
    const controller = new AbortController();
    setPresetsLoading(true); setPresetsError("");
    fetch("/api/payment-presets", { signal: controller.signal }).then(readResponse).then((result) => {
      if (!controller.signal.aborted) {
        const loaded = (result as { presets: PaymentPreset[] }).presets;
        setPresets(loaded);
        const payment = presetToMatch.current;
        if (payment) {
          const match = loaded.find((preset) => preset.amountMinor === payment.amountMinor && preset.allocations.length === payment.allocations.length && preset.allocations.every((allocation) => payment.allocations.some((saved) => saved.courseId === allocation.courseId && saved.allowance === allocation.allowance)));
          setPresetId(match ? String(match.id) : "");
          presetToMatch.current = null;
        }
      }
    }).catch(() => { if (!controller.signal.aborted) setPresetsError("Could not load presets. You can still enter a payment manually."); })
      .finally(() => { if (!controller.signal.aborted) setPresetsLoading(false); });
    return () => controller.abort();
  }, [mode, presetRetry]);
  useEffect(() => { if (mode === "payment") setPaymentMethods(data?.paymentMethods ?? []); }, [mode, data?.paymentMethods]);

  function open(next: "payment") {
    // Payments are returned newest first independently of the current activity-log page.
    const previous = data?.payments[0];
    presetToMatch.current = previous ?? null;
    setEditingPaymentId(null); setConfirmDelete(false); setReceivedMethod("");
    setPresetId(""); setPresets([]);
    setDate(schoolToday());
    setAmount(previous ? (previous.amountMinor / 100).toFixed(2) : "");
    setAllocations(Object.fromEntries((previous?.allocations ?? []).map((allocation) => [String(allocation.courseId), String(allocation.allowance)])));
    setNotes(previous?.notes ?? ""); setFormError("");
    submitted.current = null; requestKey.current = crypto.randomUUID(); setMode(next);
  }
  function editPayment(row: Pick<Activity["logs"][number], "id" | "eventDate" | "amountMinor" | "notes" | "allocations" | "receivedMethod">) {
    open("payment");
    presetToMatch.current = row;
    setEditingPaymentId(row.id);
    setDate(row.eventDate.slice(0, 10)); setAmount((row.amountMinor! / 100).toFixed(2));
    setNotes(row.notes); setReceivedMethod(row.receivedMethod ?? "");
    setAllocations(Object.fromEntries(row.allocations.map((a) => [String(a.courseId), String(a.allowance)])));
  }
  useEffect(() => {
    if (!data || !initialPaymentId || initialPaymentOpened.current === initialPaymentId) return;
    const payment = data.payments.find((item) => item.id === initialPaymentId);
    if (!payment) return;
    initialPaymentOpened.current = initialPaymentId;
    editPayment({ ...payment, eventDate: payment.paidOn });
  }, [data, initialPaymentId]);
  async function deletePayment() {
    if (saving.current || !editingPaymentId) return;
    saving.current = true; setBusy(true); setFormError("");
    try {
      await readResponse(await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: editingPaymentId }) }));
      window.dispatchEvent(new Event("student-activity-updated"));
      setMode(null); setNotice("Payment deleted."); setLogsPage(1); setReload((value) => value + 1);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not delete payment."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function save() {
    if (saving.current || !mode) return;
    if (mode === "payment" && Object.keys(allocations).length === 0) { setFormError("Select at least one course and enter its class allowance."); return; }
    if (!receivedMethod) { setFormError("Choose how you received this payment."); return; }
    const payload = { paymentId: editingPaymentId, kind: "payment", requestKey: requestKey.current, notes, paidOn: date, amount, receivedMethod, allocations: Object.entries(allocations).map(([id, allowance]) => ({ courseId: Number(id), allowance: Number(allowance) })) };
    saving.current = true; setBusy(true); setFormError("");
    submitted.current ??= JSON.stringify(payload);
    try {
      const response = await fetch(url, { method: editingPaymentId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: submitted.current });
      // Validation failures have not written a record; let the administrator fix the form.
      if (response.status === 400 || response.status === 401 || response.status === 404 || (editingPaymentId && response.status === 409)) submitted.current = null;
      await readResponse(response);
      window.dispatchEvent(new Event("student-activity-updated"));
      setNotice(editingPaymentId ? "Payment updated." : "Payment recorded."); setMode(null);
      setLogsPage(1); setReload((value) => value + 1);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not confirm the save. Retry with the same details."); }
    finally { saving.current = false; setBusy(false); }
  }
  function closePayment() {
    if (saving.current) return;
    setMode(null);
    if (submitted.current) setReload((value) => value + 1);
  }
  const locked = busy || submitted.current !== null;
  async function toggleFreeAttendance(row: Activity["logs"][number]) {
    if (saving.current || loading || row.kind !== "attendance" || !row.courseId) return;
    saving.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await readResponse(await fetch("/api/class-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: row.courseId,
          classDate: row.eventDate.slice(0, 10),
          startTime: row.eventDate.slice(11, 16),
          studentIds: [],
          complimentaryChanges: [{ studentId, complimentary: row.complimentary !== 1 }],
        }),
      }));
      setReload((value) => value + 1);
      window.dispatchEvent(new Event("student-activity-updated"));
      window.dispatchEvent(new Event("calendar-updated"));
      setNotice(row.complimentary === 1 ? "Free attendance disabled." : "Free attendance enabled.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update free attendance.");
    } finally {
      saving.current = false; setBusy(false);
    }
  }

  const connections = (data?.logs ?? []).flatMap((payment, paymentIndex) => {
    if (payment.kind !== "payment") return [];
    const attendanceRows = (data?.logs ?? []).flatMap((entry, index) =>
      (entry.kind === "attendance" || entry.kind === "missed") && payment.allocations.some((allocation) =>
        allocation.courseId === entry.courseId && allocation.coverage?.classes.some((slot) =>
          (slot.attended === (entry.kind === "attendance")) && slot.startsAt === entry.eventDate.slice(0, 16))) ? [index] : []);
    if (!attendanceRows.length) return [];
    const rows = [paymentIndex, ...attendanceRows];
    return [{ paymentId: payment.id, rows, first: Math.min(...rows), last: Math.max(...rows) }];
  });
  const laneEnds: number[] = [];
  const positionedConnections = [...connections].sort((a, b) => a.first - b.first || a.last - b.last).map((connection) => {
    const available = laneEnds.findIndex((last) => last < connection.first);
    const lane = available === -1 ? laneEnds.length : available;
    laneEnds[lane] = connection.last;
    return { ...connection, lane };
  });
  const connectorWidth = laneEnds.length ? 12 + laneEnds.length * 10 : 0;

  return <section aria-labelledby="student-activity-title" className="mt-6 space-y-5 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="student-activity-title" className="m-0 text-xl font-normal">Attendance & payments</h2><div className="flex flex-wrap gap-2"><button type="button" className={primary} disabled={loading || !data || !data.courses.length} onClick={() => open("payment")}>Record payment</button></div></div>
    {notice && <p role="status" className="font-sans text-sm text-lime-700">{notice}</p>}
    {error && <div role="alert" className="font-sans text-sm text-red-700">{error} <button type="button" className={button} onClick={() => setReload((value) => value + 1)}>Retry loading</button></div>}
    {loading && <p className="font-sans text-sm text-slate-500">Loading attendance and payments…</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-3 font-sans lg:grid-cols-4">
        {[{ label: "Classes attended", value: data.summary.attendanceCount }, { label: "Class allowance", value: data.summary.paidAllowance }, { label: "Missed classes", value: data.summary.missedClasses ?? 0 }, { label: "Attendances without credit", value: data.summary.excessAttendance }].map(({ label, value }) => <div key={label} className={`rounded-lg border p-4 ${label === "Attendances without credit" && value > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-stone-200 bg-stone-50"}`}><p className="m-0 text-xs text-slate-600">{label}</p><p className="mb-0 mt-2 text-2xl font-semibold">{value}</p></div>)}
      </div>
      <p className="font-sans text-sm text-slate-600">Practice sessions attended: {data.summary.eventAttendanceCount ?? 0} · Donations: {formatMoney(data.summary.donationsMinor ?? 0)}</p>
      {!data.courses.length && <p className="font-sans text-sm text-slate-500">Create a course from the Courses page before recording course payments or course attendance.</p>}
      <div className="border-t border-stone-200 pt-5">
        <h3 className="m-0 text-lg font-normal">Activity log</h3>
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full text-left font-sans text-sm">
            <caption className="sr-only">Student activity log, newest events first. Green lines connect payments to covered attendance on this page.</caption>
            <thead className="bg-stone-50 text-xs text-slate-500">
              <tr>{["Type", "Date", "Class / event", "Attendance / amount", "Recorded by", "School transfer", "Actions"].map((label) => <th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {data.logs.map((row, rowIndex) => <tr key={`${row.kind}-${row.id}-${row.eventDate}`} className="align-top">
                <td className="relative px-3 py-4" style={{ paddingLeft: 12 + connectorWidth }}>
                  {positionedConnections.map((connection) => rowIndex >= connection.first && rowIndex <= connection.last && <span key={connection.paymentId} aria-hidden="true">
                    <span className="pointer-events-none absolute border-l-2 border-lime-600" style={{ left: 10 + connection.lane * 10, top: rowIndex === connection.first ? 28 : -1, bottom: rowIndex === connection.last ? "calc(100% - 28px)" : -1 }} />
                    {connection.rows.includes(rowIndex) && <span className="pointer-events-none absolute top-7 border-t-2 border-lime-600" style={{ left: 10 + connection.lane * 10, width: connectorWidth - connection.lane * 10 }} />}
                  </span>)}
                  {row.kind !== "payment" && connections.filter((connection) => connection.rows.includes(rowIndex)).map((connection) => <span key={connection.paymentId} className="sr-only">Covered by payment #{connection.paymentId}. </span>)}
                  <span className={`relative inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${row.kind === "payment" ? "bg-lime-50 text-lime-800" : row.kind === "missed" ? "bg-amber-50 text-amber-800" : row.kind === "cancelled" ? "bg-stone-100 text-stone-600" : "bg-blue-50 text-blue-800"}`}>{row.kind === "practice_attendance" ? "Practice attendance" : row.kind === "payment" ? "Payment" : row.kind === "missed" ? "Missed" : row.kind === "cancelled" ? "Cancelled" : "Attendance"}</span></td>
                <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-500"><time dateTime={row.eventDate.slice(0, 10)}>{formatLogDate(row.eventDate.slice(0, 10))}</time></td>
                <td className="px-3 py-4">{row.kind === "payment" ? row.allocations.map((allocation) => <p key={allocation.courseId} className="m-0 mb-1">{allocation.courseName}</p>) : row.practiceId ? <><a className="underline" href={`/practice-parties/${row.practiceId}`}>{row.courseName}</a>{row.voidedAt && <p className="text-red-700">Voided</p>}{row.notes && <p className="text-xs text-slate-500">{row.notes}</p>}</> : row.courseName}</td>
                <td className="px-3 py-4">{row.kind === "practice_attendance" ? <span className="whitespace-nowrap text-lime-700">Attended{row.amountMinor !== null && <span className="mt-1 block">Donation {formatMoney(row.amountMinor)}</span>}</span> : row.kind === "payment" ? row.allocations.map((allocation) => <p key={allocation.courseId} className="m-0 mb-1 whitespace-nowrap">Next {allocation.allowance} classes</p>) : row.kind === "missed" ? <span className="whitespace-nowrap text-amber-800">1 missed</span> : row.kind === "cancelled" ? <span className="whitespace-nowrap text-slate-500">Cancelled · no credit used</span> : row.complimentary ? <span className="whitespace-nowrap text-lime-700">Free attendance{row.complimentaryBy && <span className="mt-1 block max-w-40 truncate text-xs text-slate-500" title={`Granted by ${row.complimentaryBy}`}>Granted by {row.complimentaryBy}</span>}{row.complimentaryAt && <time className="mt-1 block whitespace-nowrap text-xs text-slate-500" dateTime={row.complimentaryAt}>{formatLogDate(row.complimentaryAt)}</time>}</span> : "1 attended"}</td>
                <td className="px-3 py-4 text-xs text-slate-500"><span className="block max-w-40 truncate" title={row.recordedBy}>{row.recordedBy}</span>{row.recordedAt && <time className="mt-1 block whitespace-nowrap" dateTime={row.recordedAt}>{formatLogDate(row.recordedAt)}</time>}</td>
                <td className="px-3 py-4">{row.kind === "payment" ? <PaymentTransferCheckbox paymentId={row.id} studentId={studentId} checked={row.givenToSchool === 1} disabled={loading || busy} /> : "—"}</td>
                <td className="px-3 py-4">{row.practiceId ? <a className={button} href={`/practice-parties/${row.practiceId}`}>View practice</a> : row.kind === "payment" ? <button type="button" className={button + " whitespace-nowrap"} disabled={loading || busy} onClick={() => editPayment(row)}>Edit payment</button> : row.kind === "missed" || row.kind === "cancelled" ? <span className="text-slate-400">—</span> : <button type="button" aria-label={`Free attendance for ${row.courseName} on ${formatLogDate(row.eventDate.slice(0, 10))}`} aria-pressed={row.complimentary === 1} disabled={loading || busy || !row.courseId} onClick={() => void toggleFreeAttendance(row)} className={`${button.replace("bg-white", "").replace("border-stone-300", "")} whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-green-600 ${row.complimentary === 1 ? "border-green-600 bg-green-600 text-white hover:bg-green-700" : "border-stone-300 bg-white text-slate-600 hover:border-green-500"}`}>{row.complimentary === 1 ? "✓ Free attendance" : "Free attendance"}</button>}</td>
              </tr>)}
              {!data.logs.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No attendance or payment logs yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination label="Logs" pageSize={logsPageSize} onPageSize={(size) => { setLogsPageSize(size); setLogsPage(1); }} page={data.logsPage} count={data.logsCount ?? data.summary.attendanceCount + data.summary.paymentCount + (data.summary.missedClasses ?? 0)} disabled={loading} onPage={setLogsPage} />
      </div>
    </>}
    {mode && data && <dialog ref={dialog} aria-labelledby="activity-dialog-title" aria-describedby="activity-dialog-help" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={(event) => { event.preventDefault(); closePayment(); }} onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePayment();
    }}>
      <h2 id="activity-dialog-title" className="m-0 text-xl font-normal">{editingPaymentId ? "Edit payment" : "Record payment"}</h2>
      <p id="activity-dialog-help" className="font-sans text-sm leading-5 text-slate-500">{"Record the money received and how many classes it covers in each course."}</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={locked} className="m-0 space-y-4 border-0 p-0 font-sans text-xs font-semibold text-slate-600">
          <label className="block">{"Payment date"}<input autoFocus required type="date" min="1900-01-01" max={data.canRecordFuturePayments ? undefined : schoolToday()} value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} /></label>
          <fieldset className="border-0 p-0"><legend>Received via</legend>{paymentMethods.length ? <div className="mt-2 flex flex-wrap gap-2">{paymentMethods.map((method) => <label key={method} className="cursor-pointer"><input required className="peer sr-only" type="radio" name="received-method" value={method} checked={receivedMethod === method} onChange={() => setReceivedMethod(method)} /><span className="inline-flex rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors peer-checked:border-lime-700 peer-checked:bg-lime-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-lime-600">{method}</span></label>)}</div> : <p className="mt-2 font-normal text-slate-500">Add a method in <a className="underline" href="/settings" target="_blank" rel="noopener noreferrer">Settings</a> before recording a payment.</p>}</fieldset>
          <>
            <label className="block">Payment preset<select className={inputClass} value={presetId} disabled={presetsLoading} onChange={(event) => {
              const selected = event.target.value;
              if (!selected) { setPresetId(""); return; }
              const preset = presets.find((item) => item.id === Number(selected));
              if (!preset) return;
              if (preset.allocations.some((a) => !data.courses.some((c) => c.id === a.courseId))) { setFormError("A course in this preset is unavailable. Close the popup and reload the logs."); return; }
              const draft = presetDraft(preset); setPresetId(selected); setAmount(draft.amount); setAllocations(draft.allocations); setFormError("");
            }}><option value="">{presetsLoading ? "Loading presets…" : "Custom payment"}</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} — {formatMoney(preset.amountMinor)}</option>)}</select></label>
            <p className="m-0 text-xs font-normal text-slate-500">Choose a preset to fill the amount and classes below, then adjust if needed. <a href="/courses#payment-presets" target="_blank" rel="noopener noreferrer" className="underline">Manage presets</a></p>
            {presetsError && <p role="alert" className="text-xs font-normal text-red-700">{presetsError} <button type="button" className={button} onClick={() => setPresetRetry((n) => n + 1)}>Retry</button></p>}
            {!presetsLoading && !presetsError && !presets.length && <p className="text-xs font-normal text-slate-500">No presets yet. Add one on the Courses page, or enter this payment manually.</p>}
            <label className="block">Amount received (RON)<input required type="text" inputMode="decimal" pattern="[0-9]{1,6}([.,][0-9]{1,2})?" maxLength={9} placeholder="e.g. 200.00" value={amount} onChange={(event) => { presetToMatch.current = null; setAmount(event.target.value); setPresetId(""); }} className={inputClass} /></label>
            <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3"><legend className="px-1">Classes covered by course</legend>{data.courses.map((course) => <div key={course.id} className="flex items-center justify-between gap-3"><label className="flex items-center gap-2"><input type="checkbox" checked={course.id in allocations} onChange={(event) => { presetToMatch.current = null; setPresetId(""); setAllocations((current) => { const next = { ...current }; if (event.target.checked) next[course.id] = "1"; else delete next[course.id]; return next; }); }} className="h-4 w-4 accent-lime-700" />{course.name}</label>{course.id in allocations && <input aria-label={`Classes covered for ${course.name}`} type="number" min="1" max="10000" step="1" required value={allocations[course.id]} onChange={(event) => { presetToMatch.current = null; setPresetId(""); setAllocations((current) => ({ ...current, [course.id]: event.target.value })); }} className="w-20 shrink-0 rounded-md border border-stone-300 p-2 text-sm" />}</div>)}</fieldset>
          </>
          <label className="block">Notes (optional)<textarea maxLength={1000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} /></label>
        </fieldset>
        {formError && <p role="alert" className="font-sans text-sm text-red-700">{formError}</p>}
        {!busy && submitted.current && <p className="font-sans text-xs text-slate-500">Retry sends the same record to prevent duplicates. Before starting a new entry, close this popup and check the log.</p>}
        {editingPaymentId && confirmDelete && <div className="mt-4 rounded-lg border border-red-200 p-3">
          <p className="font-sans text-sm text-red-700">Delete this payment and all its course allowances? Attendance records will be kept.</p>
          <button type="button" className={button + " text-red-700"} disabled={busy} onClick={() => void deletePayment()}>Confirm delete payment</button> <button type="button" className={button} disabled={busy} onClick={() => setConfirmDelete(false)}>Keep payment</button>
        </div>}
        <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
          {editingPaymentId && <button type="button" className={button + " mr-auto text-red-700"} disabled={locked} onClick={() => setConfirmDelete(true)}>Delete payment</button>}
          <button type="button" disabled={busy} className={button} onClick={closePayment}>Cancel</button>
          <button disabled={busy || confirmDelete} className={primary}>{busy ? "Saving…" : submitted.current ? "Retry save" : "Save payment"}</button>
        </div>
      </form>
    </dialog>}
  </section>;
}

function Pagination({ label, page, pageSize, onPageSize, count, disabled, onPage }: { label: string; page: number; pageSize: number; onPageSize: (size: number) => void; count: number; disabled: boolean; onPage: (page: number) => void }) {
  return <nav aria-label={`${label} pages`} className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 font-sans text-xs text-slate-500">Rows per page<select value={pageSize} disabled={disabled} onChange={(event) => onPageSize(Number(event.target.value))} className="rounded-md border border-stone-300 bg-white p-2 text-slate-800 focus:ring-2 focus:ring-lime-600">{activityLogPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><button className={button} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span className="font-sans text-xs text-slate-500">Page {page} of {Math.max(1, Math.ceil(count / pageSize))}</span><button className={button} disabled={disabled || page * pageSize >= count} onClick={() => onPage(page + 1)}>Next</button></nav>;
}
