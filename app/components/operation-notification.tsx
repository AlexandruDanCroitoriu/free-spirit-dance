"use client";

import { useEffect, useRef } from "react";

export default function OperationNotification({ message, kind = "success", onDismiss }: {
  message: string; kind?: "success" | "error"; onDismiss: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!message) return;
    const popup = element.current;
    popup?.showPopover();
    const timer = kind === "success" ? window.setTimeout(() => dismiss.current(), 4000) : undefined;
    return () => { if (timer !== undefined) window.clearTimeout(timer); popup?.hidePopover(); };
  }, [message, kind]);
  if (!message) return null;
  return <div ref={element} popover="manual" role={kind === "error" ? "alert" : "status"}
    className={`fixed inset-auto right-4 bottom-4 m-0 w-[calc(100%-2rem)] max-w-sm rounded-xl border p-4 shadow-xl font-sans text-sm ${kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-lime-200 bg-lime-50 text-lime-900"}`}>
    <div className="flex items-start gap-3"><span className="flex-1">{message}</span><button type="button" aria-label="Dismiss notification" className="shrink-0 rounded px-1 font-bold" onClick={onDismiss}>×</button></div>
  </div>;
}
