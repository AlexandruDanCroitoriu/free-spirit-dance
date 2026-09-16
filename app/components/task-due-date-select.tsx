"use client";

import DatePicker from './date-picker';

export default function TaskDueDateSelect({ value, onChange, disabled }: {
  value: string | null; onChange: (value: string | null) => void; disabled: boolean;
}) {
  return <label className="block min-w-0">Due date
    <DatePicker aria-label="Due date" dark min="0001-01-01" max="9999-12-31"
      value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value || null)} onClear={() => onChange(null)}
      className="mt-1 min-h-11 w-full rounded-lg border border-white/20 bg-[#292a2c] px-3 py-3 text-stone-100" />
  </label>;
}
