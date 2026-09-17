"use client";

export default function TaskQuickAdd({ label, disabled, onAdd }: {
  label: string; disabled: boolean; onAdd: () => void;
}) {
  return <button type="button" aria-label={`Add a card to ${label}`} title={`Add a card to ${label}`} aria-haspopup="dialog" disabled={disabled} onClick={onAdd} className="flex h-10 w-10 items-center justify-center rounded-md text-lg hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-lime-700 disabled:opacity-50">+</button>;
}
