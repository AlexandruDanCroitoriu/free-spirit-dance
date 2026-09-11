"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const storageKey = "free-spirit-dance.dashboard.widgets.v1";
const widgetLabels = { calendar: "Course calendar", balances: "Student balances", transfers: "Payment transfers" };
type WidgetId = keyof typeof widgetLabels;
type Widgets = Record<WidgetId, boolean>;
const defaults: Widgets = { calendar: true, balances: true, transfers: true };
const DashboardContext = createContext<{ widgets: Widgets; ready: boolean; toggle: (id: WidgetId) => void } | null>(null);

export function DashboardWidgetsProvider({ children }: { children: ReactNode }) {
  const [widgets, setWidgets] = useState(defaults);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        const values = saved as Record<string, unknown>;
        const restored = { ...defaults };
        for (const id of Object.keys(defaults) as WidgetId[]) {
          if (typeof values[id] === "boolean") restored[id] = values[id];
        }
        setWidgets(restored);
      }
    } catch {
      // Unavailable or invalid storage must not prevent using the dashboard.
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(widgets)); } catch {
      // Toggles still work for this session when storage is unavailable.
    }
  }, [widgets, ready]);
  return <DashboardContext.Provider value={{ widgets, ready, toggle: (id) => setWidgets((current) => ({ ...current, [id]: !current[id] })) }}>{children}</DashboardContext.Provider>;
}

export function useDashboardWidgets() {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("Dashboard widgets require DashboardWidgetsProvider.");
  return context;
}

export function DashboardSettings() {
  const { widgets, ready, toggle } = useDashboardWidgets();
  const [open, setOpen] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  return <div ref={dropdown} className="relative shrink-0 font-sans" onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" disabled={!ready} aria-expanded={open} aria-controls="dashboard-settings" onClick={() => setOpen((current) => !current)} className="flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-stone-50 focus-visible:outline-lime-600 disabled:opacity-50">
      <svg aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" className="fill-white" /><circle cx="15" cy="17" r="3" className="fill-white" /></svg>
      Settings
    </button>
    {open && <div id="dashboard-settings" className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
      <fieldset><legend className="mb-2 text-xs font-bold text-slate-700">Show widgets</legend>
        {(Object.keys(widgetLabels) as WidgetId[]).map((id) => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-3 text-sm text-slate-700 hover:bg-stone-50">
          <input type="checkbox" checked={widgets[id]} onChange={() => toggle(id)} className="h-4 w-4 accent-lime-700" />{widgetLabels[id]}
        </label>)}
      </fieldset>
    </div>}
  </div>;
}
