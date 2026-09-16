"use client";

import { useEffect, useState } from 'react';
import { readJson } from '../lib/http';
import type { MediaFile, MediaPage } from '../lib/media';

function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function Preview({ file }: { file: MediaFile }) {
  const [failed, setFailed] = useState(false);
  return file.preview && !failed ? <a href={file.preview} target="_blank" rel="noreferrer" aria-label={`Open ${file.key}`} className="group flex aspect-square w-full items-center justify-center overflow-hidden border-b border-stone-200 bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-600">
    <img src={file.preview} alt="" loading="lazy" className="h-full w-full object-contain p-3 transition-transform duration-200 motion-safe:group-hover:scale-105" onError={() => setFailed(true)} />
  </a> : <span className="flex aspect-square w-full flex-col items-center justify-center gap-3 border-b border-stone-200 bg-stone-100 p-4 text-center text-xs text-slate-500">
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-9 w-9 text-stone-400"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>
    No preview
  </span>;
}

export default function MediaLibrary() {
  const [page, setPage] = useState<MediaPage | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setPage(null);
    void fetch(`/api/administrators/media${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await readJson<MediaPage & { error?: string }>(response);
      if (!response.ok || !Array.isArray(data.files)) throw new Error(data.error ?? 'Could not load media files.');
      if (!controller.signal.aborted) setPage(data);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load media files.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, revision]);
  const buttonClass = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50';
  return <section aria-labelledby="media-library-title" className="font-sans">
    <div className="mb-5 flex items-start justify-between gap-4">
      <div><h2 id="media-library-title" className="m-0 text-lg font-semibold">Media files</h2>
        <p className="mt-2 text-sm text-slate-500">Uploaded files in the current database’s media storage and where they are used.</p>
        <p className="mt-1 text-xs text-slate-500">External profile photos are not stored here. Private task details are visible only to their owner.</p>
      </div>
      <button type="button" className={buttonClass} disabled={loading} onClick={() => { setCursor(undefined); setPrevious([]); setRevision(value => value + 1); }}>Refresh</button>
    </div>
    {loading && <p role="status" className="text-sm text-slate-500">Loading media files…</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" className="ml-2 underline" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {page && <>
      {!page.files.length ? <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-slate-500">{previous.length ? 'No more media files.' : 'No media files have been uploaded to this storage.'}</p> : <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {page.files.map(file => <li key={file.key} className="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <Preview file={file} />
          <div className="p-4">
            <p title={file.key} className="m-0 truncate text-sm font-semibold text-slate-800">{file.key}</p>
            <p className="mb-0 mt-1 break-words text-xs text-slate-500">{fileSize(file.size)}{file.contentType ? ` · ${file.contentType}` : ''}</p>
            <p className="mb-0 mt-1 text-xs text-slate-500">Uploaded <time dateTime={file.uploaded}>{new Date(file.uploaded).toLocaleDateString()}</time></p>
            <div className="mt-3 border-t border-stone-100 pt-3">
              <p className="m-0 text-xs font-semibold text-slate-500">Used in</p>
              {file.usages.length ? <ul aria-label="Used in" className="mb-0 mt-2 list-none space-y-1 break-words p-0 text-sm">{file.usages.map((usage, index) => <li key={index}>{usage.href ? <a className="text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950" href={usage.href}>{usage.label}</a> : <span className="text-slate-500">{usage.label}</span>}</li>)}</ul> : <p className="mb-0 mt-2 text-sm text-amber-800">No current reference</p>}
            </div>
          </div>
        </li>)}
      </ul>}
    </>}
    {!loading && (page || previous.length > 0) && <div className="mt-4 flex items-center justify-between gap-3">
      <button type="button" className={buttonClass} disabled={!previous.length} onClick={() => { setCursor(previous[previous.length - 1]); setPrevious(values => values.slice(0, -1)); }}>Previous</button>
      <span className="text-xs text-slate-500" role="status">Page {previous.length + 1}{page ? ` · ${page.files.length} files` : ''}</span>
      <button type="button" className={buttonClass} disabled={!page?.cursor} onClick={() => { if (page?.cursor) { setPrevious(values => [...values, cursor]); setCursor(page.cursor); } }}>Next</button>
    </div>}
  </section>;
}
