"use client";

import type { InputHTMLAttributes } from 'react';
import { formatCalendarDate, validCalendarDate } from '../lib/calendar-dates';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: string;
  type?: 'date' | 'datetime-local';
  onClear?: () => void;
  dark?: boolean;
};

// Keep native selection and validation, but format the display independently of the OS locale.
export default function DatePicker({ value, type = 'date', className = '', disabled, readOnly, onClear, dark = false, onClick, ...props }: Props) {
  const date = value.slice(0, 10);
  const display = validCalendarDate(date)
    ? `${formatCalendarDate(date)}${type === 'datetime-local' && value.includes('T') ? `, ${value.split('T')[1]}` : ''}`
    : (props.placeholder || 'Select date');
  return <span className={`relative flex min-w-0 items-center gap-2 focus-within:ring-2 focus-within:ring-blue-400 ${disabled ? 'opacity-50' : ''} ${className}`}>
    <span aria-hidden="true" className="min-w-0 flex-1">{display}</span>
    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></svg>
    <input {...props} type={type} lang="ro" value={value} disabled={disabled} readOnly={readOnly}
      className={`absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default read-only:cursor-default ${dark ? '[color-scheme:dark]' : '[color-scheme:light]'}`}
      onClick={event => {
        onClick?.(event);
        if (disabled || readOnly || event.defaultPrevented) return;
        try { event.currentTarget.showPicker?.(); } catch { /* Fall back to native input interaction. */ }
      }}
    />
    {onClear && value && !readOnly && <button type="button" disabled={disabled} className="relative z-10 rounded px-2 hover:bg-black/10 disabled:opacity-50" aria-label={`Clear ${props['aria-label'] || 'date'}`} onClick={event => { event.preventDefault(); onClear(); }}>×</button>}
  </span>;
}
