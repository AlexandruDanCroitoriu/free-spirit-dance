"use client";

import { type ReactNode } from "react";

type ConfirmationDialogProps = { open: boolean; title: string; description: ReactNode; confirmLabel: string; destructive?: boolean; onConfirm: () => void; onCancel: () => void };

export default function ConfirmationDialog({ open, title, description, confirmLabel, destructive = false, onConfirm, onCancel }: ConfirmationDialogProps) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
    <section role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description" className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
      <h2 id="confirmation-title" className="m-0 text-lg">{title}</h2>
      <div id="confirmation-description" className="font-sans text-sm text-slate-600">{description}</div>
      <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus className="rounded-md bg-slate-800 px-4 py-2.5 font-sans text-xs font-semibold text-white" onClick={onCancel}>Cancel</button><button type="button" className={`rounded-md px-4 py-2.5 font-sans text-xs font-semibold text-white ${destructive ? "bg-red-700 hover:bg-red-800" : "bg-amber-700 hover:bg-amber-800"}`} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>;
}
