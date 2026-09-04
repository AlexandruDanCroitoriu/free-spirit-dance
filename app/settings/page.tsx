"use client";

import { useEffect, useState } from "react";

type AdminProfile = { email: string; name: string; picture: string | null; error?: string };
const maxImageBytes = 250_000;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  try { return body ? JSON.parse(body) as T : {} as T; } catch { return {} as T; }
}

async function compressImage(file: File): Promise<File> {
  const image = new Image();
  const sourceUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not read image.")); image.src = sourceUrl; });
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob || blob.size > maxImageBytes) throw new Error("Choose a smaller image.");
    return new File([blob], "administrator.jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<AdminProfile>({ email: "Loading account...", name: "", picture: null });
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin-profile").then(async (response) => {
      const data = await readJson<AdminProfile>(response);
      if (!response.ok) throw new Error(data.error ?? "Could not load profile.");
      setProfile(data);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  async function selectImage(file: File | undefined) {
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      if (preview) URL.revokeObjectURL(preview);
      setPendingImage(compressed); setPreview(URL.createObjectURL(compressed)); setError(""); setMessage("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare image."); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    let picture = profile.picture;
    if (pendingImage) {
      const imageData = new FormData(); imageData.append("file", pendingImage);
      const uploadResponse = await fetch("/api/admin-profile/image", { method: "POST", body: imageData });
      const upload = await readJson<{ picture?: string; error?: string }>(uploadResponse);
      if (!uploadResponse.ok || !upload.picture) { setError(upload.error ?? "Could not upload profile image."); setSaving(false); return; }
      picture = upload.picture;
    }
    const response = await fetch("/api/admin-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: profile.name, picture }) });
    const data = await readJson<AdminProfile>(response);
    if (!response.ok) { setError(data.error ?? "Could not save profile."); setSaving(false); return; }
    setProfile(data); setPendingImage(null); setPreview(null); setMessage("Profile saved."); setSaving(false);
    window.dispatchEvent(new CustomEvent("admin-profile-updated", { detail: data }));
  }

  const displayPicture = preview ?? profile.picture;

  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    <section className="max-w-xl rounded-xl border border-stone-200 bg-white p-6"><form className="space-y-6" onSubmit={saveProfile}>
      <div className="flex flex-wrap items-center gap-4"><div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans text-xl font-bold text-slate-800">{displayPicture ? <img alt="Administrator profile" className="h-full w-full object-cover" src={displayPicture} /> : (profile.name || profile.email).charAt(0).toUpperCase()}</div><div><label className="cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold">Upload image<input accept="image/*" className="sr-only" type="file" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><p className="mt-3 font-sans text-xs text-slate-400">Images are compressed before upload.</p></div></div>
      <label className="block font-sans text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="account-name">Name<input className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 font-sans text-sm font-normal normal-case tracking-normal text-slate-800 outline-none focus:border-lime-600" id="account-name" maxLength={100} required value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="block font-sans text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="account-email">Account email<input className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-3 font-sans text-sm font-normal normal-case tracking-normal text-slate-600 outline-none" id="account-email" readOnly value={profile.email} /></label>
      <div className="flex items-center justify-between gap-4">{error ? <p className="m-0 font-sans text-sm text-red-700" role="alert">{error}</p> : <p className="m-0 font-sans text-sm text-lime-700" role="status">{message}</p>}<button className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100 disabled:opacity-60" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
    </form></section>
  </div></main>;
}
