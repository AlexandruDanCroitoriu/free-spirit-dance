'use client';

import { useRef, useState } from 'react';
import { compressImage } from '../lib/profile-image';
import { requestJson } from '../lib/http';

export default function FreeEventImageInput({ value, disabled, onChange, onBusyChange }: {
  value: string | null;
  disabled: boolean;
  onChange: (imagePath: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  async function select(file?: File) {
    if (!file || disabled || uploading.current) return;
    setError('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    uploading.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const compressed = await compressImage(file, 'event.jpg');
      const form = new FormData();
      form.append('file', compressed);
      const result = await requestJson<{ imagePath: string }>('/api/free-event-images', { method: 'POST', body: form });
      if (!result.imagePath) throw new Error('Could not upload event image.');
      onChange(result.imagePath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload event image.');
    } finally {
      uploading.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return <div className="space-y-2">
    <p className="m-0">Event image (optional)</p>
    <input ref={input} type="file" accept="image/*" disabled={disabled || busy} style={{ display: 'none' }}
      onChange={event => { void select(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    <button type="button" disabled={disabled || busy} aria-label={value ? 'Replace event image' : 'Upload event image'}
      className={`flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 disabled:cursor-wait disabled:opacity-60 ${dragging ? 'border-lime-600 bg-lime-50' : 'border-stone-300 bg-white hover:border-lime-600 hover:bg-lime-50'}`}
      onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!disabled && !busy) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files[0]); }}>
      {value ? <img src={value} alt="Event preview" className="max-h-40 max-w-full rounded-lg object-contain" />
        : <svg aria-hidden="true" className="h-8 w-8 text-lime-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>}
      <span className="font-semibold text-slate-800">{busy ? 'Uploading image…' : value ? 'Click or drop an image to replace' : 'Click to choose an image or drag it here'}</span>
      <span className="text-xs text-slate-500">Images are compressed automatically.</span>
    </button>
    {value && <button type="button" disabled={disabled || busy} className="text-xs text-red-700 underline disabled:opacity-50" onClick={() => { setError(''); onChange(null); }}>Remove image</button>}
    {busy && <p role="status" className="m-0 text-xs text-slate-500">Preparing and uploading image…</p>}
    {error && <p role="alert" className="m-0 text-sm text-red-700">{error}</p>}
  </div>;
}
