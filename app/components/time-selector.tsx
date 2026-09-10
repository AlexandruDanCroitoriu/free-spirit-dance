"use client";

import { useEffect, useId, useRef, useState } from "react";

const pad = (value: number) => String(value).padStart(2, "0");

export default function TimeSelector({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"hour" | "minute">("hour");
  const [hour, minute] = value.split(":").map(Number);
  const selected = step === "hour" ? hour : minute;
  const angle = selected * (step === "hour" ? 30 : 6);
  const innerHour = step === "hour" && (hour === 0 || hour > 12);
  const control = "rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600";

  function positionPopup() {
    const anchor = trigger.current?.getBoundingClientRect();
    const element = popup.current;
    if (!anchor || !element) return;
    const margin = 12;
    const below = anchor.bottom + 8;
    const top = below + element.offsetHeight <= window.innerHeight - margin
      ? below : anchor.top - element.offsetHeight - 8;
    element.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - element.offsetWidth - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - element.offsetHeight - margin))}px`;
  }

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    return () => {
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
    };
  }, [open]);

  function closePopup() {
    popup.current?.hidePopover();
    trigger.current?.focus();
  }

  function select(next: number) {
    onChange(step === "hour" ? `${pad(next)}:${pad(minute)}` : `${pad(hour)}:${pad(next)}`);
  }

  return <fieldset className="min-w-0 font-sans text-xs font-semibold text-slate-600">
    <legend>{label}</legend>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" popoverTarget={id} onClick={() => setStep("hour")} className="mt-2 flex w-full items-center justify-between rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm text-slate-800 hover:border-lime-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600">
      <span className="tabular-nums">{value}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>
    </button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-label={label}
      className="fixed m-0 w-72 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4 text-slate-600 shadow-xl"
      onToggle={(event) => {
        const isOpen = event.newState === "open";
        setOpen(isOpen);
        if (isOpen) { positionPopup(); popup.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
      }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePopup(); } }}>
      <p className="mb-3 mt-0 text-center text-xs font-semibold text-slate-500">{label}</p>
      <div className="flex items-center justify-center text-2xl tabular-nums">
        <button type="button" aria-label="Select hour" aria-pressed={step === "hour"} onClick={() => setStep("hour")} className={`${control} ${step === "hour" ? "bg-lime-100 text-lime-900" : "text-slate-500"}`}>{pad(hour)}</button>
        <span className="px-1 text-stone-400">:</span>
        <button type="button" aria-label="Select minutes" aria-pressed={step === "minute"} onClick={() => setStep("minute")} className={`${control} ${step === "minute" ? "bg-lime-100 text-lime-900" : "text-slate-500"}`}>{pad(minute)}</button>
      </div>
      <div role="slider" tabIndex={0} aria-label={`${label} — ${step === "hour" ? "hour" : "minutes"}`} aria-valuemin={0} aria-valuemax={step === "hour" ? 23 : 59} aria-valuenow={step === "hour" ? hour : minute}
        className="relative mx-auto mt-4 aspect-square w-full max-w-56 touch-none rounded-full bg-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-4"
        onKeyDown={(event) => {
          if (event.currentTarget.closest("fieldset:disabled")) return;
          const maximum = step === "hour" ? 24 : 60;
          const current = step === "hour" ? hour : minute;
          let next = current;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") next = (current + 1) % maximum;
          else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = (current + maximum - 1) % maximum;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = maximum - 1;
          else if (event.key === "Enter") { event.preventDefault(); setStep("minute"); return; }
          else return;
          event.preventDefault();
          onChange(step === "hour" ? `${pad(next)}:${pad(minute)}` : `${pad(hour)}:${pad(next)}`);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.currentTarget.closest("fieldset:disabled")) return;
          event.currentTarget.focus();
          const bounds = event.currentTarget.getBoundingClientRect();
          const radians = Math.atan2(event.clientX - bounds.left - bounds.width / 2, -(event.clientY - bounds.top - bounds.height / 2));
          const count = step === "hour" ? 12 : 60;
          const position = (Math.round(radians / (2 * Math.PI) * count) + count) % count;
          const distance = Math.hypot(event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
          const inner = distance < bounds.width * 0.325;
          select(step === "minute" ? position : inner ? (position === 0 ? 0 : position + 12) : position || 12);
          if (step === "hour") setStep("minute");
        }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute bottom-1/2 left-1/2 w-0.5 origin-bottom bg-lime-600" style={{ height: innerHour ? "25%" : "40%", transform: `translateX(-50%) rotate(${angle}deg)` }}><span className="absolute -top-4 left-1/2 h-8 w-8 -translate-x-1/2 rounded-full bg-lime-600" /></div>
          <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime-700" />
          {Array.from({ length: step === "hour" ? 24 : 12 }, (_, index) => {
            const inner = step === "hour" && index >= 12;
            const position = index % 12;
            const number = step === "minute" ? index * 5 : inner ? (position === 0 ? 0 : position + 12) : position || 12;
            const radius = inner ? 25 : 40;
            const active = selected === number;
            return <span key={index} className={`absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${inner ? "text-[11px]" : "text-sm"} ${active ? "text-white" : "text-slate-700"}`} style={{ left: `${50 + radius * Math.sin(position * Math.PI / 6)}%`, top: `${50 - radius * Math.cos(position * Math.PI / 6)}%` }}>{step === "minute" || inner ? pad(number) : number}</span>;
          })}
        </div>
      </div>
      <button type="button" onClick={closePopup} className={`${control} mt-4 w-full bg-lime-100 text-lime-900 hover:bg-lime-200`}>Done</button>
    </div>
  </fieldset>;
}
