"use client";

import { useRef, useState } from "react";
import { readJson } from "../lib/http";

export default function PaymentTransferCheckbox({ paymentId, studentId, checked, disabled = false, purpose, practiceId }: { paymentId: number; studentId: number; checked: boolean; disabled?: boolean; purpose?: "practice_donation"; practiceId?: number }) {
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(givenToSchool: boolean) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/students/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId, studentId, givenToSchool, purpose, practiceId }) });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error ?? "Could not save transfer status.");
      window.dispatchEvent(new Event("payment-transfer-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save transfer status."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div><button type="button" aria-pressed={checked} disabled={disabled || busy} onClick={() => void update(!checked)} aria-label={`${checked ? "Given to school" : "Give to school"}: payment #${paymentId}`} className={`inline-flex min-w-32 min-h-9 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold whitespace-nowrap shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-green-700 bg-green-600 text-white hover:bg-green-700 focus:ring-green-600" : "border-yellow-500 bg-white text-yellow-700 shadow-none hover:bg-yellow-50 focus:ring-yellow-500"}`}>{busy ? "Saving…" : checked ? "Given" : "Give"}</button>{error && <p role="alert" className="text-xs text-red-700">{error}</p>}</div>;
}
