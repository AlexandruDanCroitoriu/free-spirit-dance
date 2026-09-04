"use client";

import { useEffect, useState } from "react";
import StudentCard from "../components/student-card";

type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; picture: string | null; active: boolean };
type FormState = Omit<Student, "id">;
type ApiError = { error?: string };
const emptyForm: FormState = { firstName: "", lastName: "", email: "", phone: "", picture: null, active: true };
const maxImageBytes = 250_000;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

async function compressImage(file: File): Promise<File> {
  const image = new Image();
  const sourceUrl = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not read image.")); image.src = sourceUrl; });
    const maxDimension = 1200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob || blob.size > maxImageBytes) throw new Error("Choose a smaller image.");
    return new File([blob], "student.jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(sourceUrl); }
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  async function loadStudents() {
    setLoading(true);
    const response = await fetch("/api/students");
    const data = await readJson<Student[] | ApiError>(response);
    if (!response.ok || !Array.isArray(data)) {
      setStudents([]);
      setError(!Array.isArray(data) && data.error ? data.error : "Could not load students.");
      setLoading(false);
      return;
    }
    setStudents(data);
    setLoading(false);
  }

  useEffect(() => { loadStudents().catch(() => { setError("Could not load students."); setLoading(false); }); }, []);
  useEffect(() => {
    const openAddStudent = () => startAdd();
    window.addEventListener("open-add-student", openAddStudent);
    return () => window.removeEventListener("open-add-student", openAddStudent);
  }, []);

  function startAdd() { setForm(emptyForm); setPendingImage(null); setError(""); setFormOpen(true); }
  function closeForm() { setFormOpen(false); setForm(emptyForm); setPendingImage(null); setError(""); }
  function updateField(field: keyof FormState, value: string | boolean) { setForm((current) => ({ ...current, [field]: value })); }

  async function selectImage(file: File | undefined) {
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setPendingImage(compressed);
      setForm((current) => ({ ...current, picture: URL.createObjectURL(compressed) }));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not prepare image."); }
  }

  async function saveStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = form.email.trim().toLocaleLowerCase();
    const phone = form.phone.trim();
    const emailExists = students.some((student) => student.email.trim().toLocaleLowerCase() === email);
    const phoneExists = Boolean(phone) && students.some((student) => student.phone.trim() === phone);
    if (emailExists || phoneExists) {
      setError(emailExists && phoneExists ? "A student with this email and phone number already exists." : emailExists ? "A student with this email already exists." : "A student with this phone number already exists.");
      return;
    }
    setSaving(true); setError("");
    const response = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, picture: null }) });
    let data = await readJson<Student & ApiError>(response);
    if (!response.ok) { setError(data.error ?? "Could not save student."); setSaving(false); return; }
    if (pendingImage) {
      const imageData = new FormData();
      imageData.append("file", pendingImage);
      const uploadResponse = await fetch("/api/student-images", { method: "POST", body: imageData });
      const upload = await readJson<{ picture?: string; error?: string }>(uploadResponse);
      if (!uploadResponse.ok || !upload.picture) { setError(upload.error ?? "Student was saved, but the image could not be uploaded."); setSaving(false); return; }
      const updateResponse = await fetch(`/api/students/${data.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, picture: upload.picture }) });
      data = await readJson<Student & ApiError>(updateResponse);
      if (!updateResponse.ok) { setError(data.error ?? "Student was saved, but the image could not be linked."); setSaving(false); return; }
    }
    setStudents((current) => [...current, data].sort((a, b) => a.lastName.localeCompare(b.lastName)));
    closeForm(); setSaving(false);
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredStudents = students.filter((student) => {
    const matchesStatus = statusFilter === "all" || student.active === (statusFilter === "active");
    const matchesSearch = !normalizedSearch || [student.firstName, student.lastName, student.phone, student.email]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesSearch;
  });

  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {formOpen && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/70 p-4 md:left-64" role="presentation"><div aria-labelledby="student-dialog-title" aria-modal="true" className="mx-auto w-full max-w-3xl rounded-xl border border-stone-200 bg-white p-6 shadow-2xl" role="dialog"><form onSubmit={saveStudent} className="grid min-w-0 gap-4 md:grid-cols-2"><div className="flex items-center justify-between md:col-span-2"><h2 className="m-0 text-xl font-normal" id="student-dialog-title">Add student</h2><button aria-label="Close dialog" type="button" onClick={closeForm} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">×</button></div>
      {([['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone']] as const).map(([field, label]) => <label key={field} className="font-sans text-xs font-semibold text-slate-600">{label}<input required={field !== 'phone'} type={field === 'email' ? 'email' : 'text'} {...(field === 'phone' ? { inputMode: "numeric" as const, minLength: 10, pattern: "[0-9]{10,}", title: "Enter at least 10 numbers." } : {})} value={form[field] ?? ""} onChange={(event) => updateField(field, event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal text-slate-800 outline-none focus:border-lime-600" /></label>)}
      <div><span className="font-sans text-xs font-semibold text-slate-600">Student status</span><label className="mt-4 flex cursor-pointer items-center gap-3 font-sans text-xs font-semibold text-slate-600"><input type="checkbox" checked={form.active} onChange={(event) => updateField("active", event.target.checked)} className="peer sr-only" /><span className="relative h-6 w-11 rounded-full bg-stone-300 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-lime-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-lime-600 peer-focus-visible:ring-offset-2" /><span>Active student</span></label></div>
      <div><span className="font-sans text-xs font-semibold text-slate-600">Student picture</span><div className="mt-2 flex flex-wrap items-center gap-4"><div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans text-xs font-bold text-slate-800">{form.picture ? <img src={form.picture} alt="Compressed student preview" className="h-full w-full object-cover" /> : "No picture"}</div><div className="flex flex-wrap gap-2"><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold md:hidden">Take photo<input accept="image/*" capture="environment" type="file" className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Upload image<input accept="image/*" type="file" className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div></div></div>
      <div className="flex items-center justify-between gap-4 md:col-span-2">{error ? <p role="alert" className="m-0 min-w-0 flex-1 font-sans text-sm text-red-700">{error}</p> : <span className="flex-1" />}<div className="flex shrink-0 justify-end gap-3"><button type="button" onClick={closeForm} className="rounded-md border border-stone-300 bg-white px-4 py-3 font-sans text-xs font-semibold">Cancel</button><button disabled={saving} className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100">{saving ? "Saving..." : "Add student"}</button></div></div>
    </form></div></div>}
    <div className="mb-4 flex flex-col gap-3 sm:flex-row">
      <label className="relative flex-1 font-sans"><span className="sr-only">Search students</span><svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-current text-slate-400" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, phone, or email" className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-lime-600" /></label>
      <label className="font-sans"><span className="sr-only">Filter students by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-lime-600 sm:w-40"><option value="all">All students</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </div>
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading students...</p> : students.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No students yet</h2><p className="mt-2 font-sans text-sm text-slate-400">Add your first student to begin building the directory.</p></div> : filteredStudents.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No matching students</h2><p className="mt-2 font-sans text-sm text-slate-400">Adjust your search or status filter.</p></div> : <div className="divide-y divide-stone-200">{filteredStudents.map((student) => <StudentCard key={student.id} student={student} />)}</div>}</section>
  </div></main>;
}
