"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import StudentCard from "../../components/student-card";

type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; picture: string | null; active: boolean };
type Field = keyof Student;
const editableFields: Array<{ key: Exclude<Field, "id" | "picture">; label: string; type?: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
];
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
    return new File([blob], "student.jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetch(`/api/students/${id}`).then(async (response) => { const data = await readJson<Student & { error?: string }>(response); if (!response.ok) throw new Error(data.error ?? "Could not load student."); setStudent(data); }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, [id]);

  function beginEdit(field: Exclude<Field, "id">) { if (!student) return; setEditing(field); setDraft(String(student[field])); setError(""); }

  async function selectImage(file: File | undefined) {
    if (!file) return;
    try { const compressed = await compressImage(file); setPendingImage(compressed); setStudent((current) => current ? { ...current, picture: URL.createObjectURL(compressed) } : current); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare image."); }
  }

  async function saveField(field: Exclude<Field, "id">, value = draft) {
    if (!student) return;
    setSaving(true); setError("");
    let picture = student.picture;
    if (field === "picture" && pendingImage) {
      const imageData = new FormData(); imageData.append("file", pendingImage);
      const uploadResponse = await fetch("/api/student-images", { method: "POST", body: imageData });
      const upload = await readJson<{ picture?: string; error?: string }>(uploadResponse);
      if (!uploadResponse.ok || !upload.picture) { setError(upload.error ?? "Could not upload image."); setSaving(false); return; }
      picture = upload.picture;
    }
    const next = { ...student, [field]: field === "active" ? value === "true" : value || "", picture };
    const response = await fetch(`/api/students/${student.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const data = await readJson<Student & { error?: string }>(response);
    if (!response.ok) setError(data.error ?? "Could not save field."); else { setStudent(data); setEditing(null); setPendingImage(null); }
    setSaving(false);
  }

  async function deleteStudent() {
    if (!student) return;
    setSaving(true); setError("");
    const response = await fetch(`/api/students/${student.id}`, { method: "DELETE" });
    const data = await readJson<{ error?: string }>(response);
    if (!response.ok) { setError(data.error ?? "Could not delete student."); setSaving(false); return; }
    window.location.href = "/students";
  }

  function beginActiveEdit() { if (!student) return; setEditing("active"); setDraft(String(student.active)); setError(""); }

  if (loading) return <main className="min-h-screen px-6 py-6 md:px-12"><p className="font-sans text-sm text-slate-400">Loading student...</p></main>;
  if (!student) return <main className="min-h-screen px-6 py-6 md:px-12"><p className="font-sans text-sm text-red-700">{error || "Student not found."}</p><a className="mt-4 inline-block font-sans text-sm font-semibold" href="/students">Back to students</a></main>;

  return <main className="min-h-screen bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-3xl">
    <a href="/students" className="font-sans text-xs font-semibold text-slate-600">← Students</a>
    <section className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white"><StudentCard student={student} /></section>

    <nav aria-label="Student sections" className="mt-6 border-b border-stone-300">
      <button aria-current="page" className="-mb-px border-0 border-b-2 border-slate-800 bg-transparent px-1 pb-3 font-sans text-xs font-bold text-slate-800">Student info</button>
    </nav>

    <section aria-label="Student info" className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white px-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-stone-200 py-4">
        <div className="min-w-0"><p className="m-0 font-sans text-xs font-bold uppercase tracking-wider text-slate-400">Profile photo</p><p className="mt-1 truncate font-sans text-sm text-slate-800">Update the student image</p></div>
        <div className="flex flex-wrap justify-end gap-2">{editing === "picture" ? <><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Camera<input accept="image/*" capture="environment" type="file" className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Upload<input accept="image/*" type="file" className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><button disabled={saving || !pendingImage} onClick={() => saveField("picture")} className="rounded-md border-0 bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100 disabled:opacity-50">Save</button></> : <button onClick={() => { setEditing("picture"); setPendingImage(null); setError(""); }} className="rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold">Edit</button>}</div>
      </div>
      {editableFields.map(({ key, label, type }) => <div key={key} className="flex items-end gap-4 border-b border-stone-200 py-4"><label className="min-w-0 flex-1 font-sans"><span className="block text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>{editing === key ? <input autoFocus type={type ?? "text"} value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-lime-600" /> : <span className="mt-1 block truncate text-sm text-slate-800">{student[key] || "Not provided"}</span>}</label>{editing === key ? <button disabled={saving} onClick={() => saveField(key)} className="shrink-0 rounded-md border-0 bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100">Save</button> : <button onClick={() => beginEdit(key)} className="shrink-0 rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold">Edit</button>}</div>)}
      <div className="flex items-center gap-4 border-b border-stone-200 py-4"><div className="min-w-0 flex-1 font-sans"><span className="block text-xs font-bold uppercase tracking-wider text-slate-400">Status</span>{editing === "active" ? <select value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 rounded-md border border-stone-300 px-3 py-2 text-sm"><option value="true">Active</option><option value="false">Inactive</option></select> : <span className={`mt-1 block text-sm font-semibold ${student.active ? "text-lime-700" : "text-slate-400"}`}>{student.active ? "Active" : "Inactive"}</span>}</div>{editing === "active" ? <button disabled={saving} onClick={() => saveField("active")} className="shrink-0 rounded-md border-0 bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100">Save</button> : <button onClick={beginActiveEdit} className="shrink-0 rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold">Edit</button>}</div>
      {error && <p role="alert" className="py-4 font-sans text-sm text-red-700">{error}</p>}
      <div className="flex justify-end py-4"><button disabled={saving} onClick={() => setDeleteConfirmOpen(true)} className="rounded-md border border-red-300 bg-white px-3 py-2 font-sans text-xs font-semibold text-red-700 transition-colors hover:bg-red-50">Delete student</button></div>
    </section>
    {deleteConfirmOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDeleteConfirmOpen(false); }}>
      <div aria-labelledby="delete-student-title" aria-describedby="delete-student-description" aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-xl border border-red-800 bg-red-50 shadow-2xl" role="alertdialog">
        <div className="bg-red-700 p-6 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15">
              <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="18" style={{ height: 18, width: 18 }}><path d="M12 9v4m0 4h.01M10.3 3.7 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /></svg>
            </span>
            <h2 className="m-0 text-xl font-normal" id="delete-student-title">Delete student?</h2>
          </div>
          <p className="mt-3 font-sans text-sm leading-6 text-red-100" id="delete-student-description">This will permanently delete <strong className="font-bold text-white">{student.firstName} {student.lastName}</strong> and their profile information. This action cannot be undone.</p>
        </div>
        <div className="flex justify-end gap-3 bg-red-50 px-6 py-4">
          <button autoFocus disabled={saving} onClick={() => setDeleteConfirmOpen(false)} className="rounded-md border border-stone-300 bg-white px-4 py-2.5 font-sans text-xs font-semibold text-slate-600">Cancel</button>
          <button disabled={saving} onClick={() => void deleteStudent()} className="rounded-md border-0 bg-red-700 px-4 py-2.5 font-sans text-xs font-bold text-white disabled:opacity-60">{saving ? "Deleting..." : "Delete student"}</button>
        </div>
      </div>
    </div>}
  </div></main>;
}
