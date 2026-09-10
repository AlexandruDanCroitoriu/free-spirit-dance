"use client";

import { compressImage } from "../lib/profile-image";
import { readJson } from "../lib/http";
import { useEffect, useRef, useState } from "react";
import StudentPanel from "../components/student-panel";
import StudentCourses from "../components/student-courses";
import StudentCard from "../components/student-card";

type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; picture: string | null; active: boolean; courseIds?: number[] };
type FormState = Omit<Student, "id"> & { courseIds: number[] };
type ApiError = { error?: string };
const emptyForm: FormState = { firstName: "", lastName: "", email: "", phone: "", picture: null, active: true, courseIds: [] };

export default function StudentsPage() {
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageVersion = useRef(0);
  const [preparingImage, setPreparingImage] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [courseFilter, setCourseFilter] = useState("all");
  const [coursesError, setCoursesError] = useState("");
  const [courseRetry, setCourseRetry] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("student"));
    if (Number.isSafeInteger(id) && id > 0) setSelectedStudentId(id);
  }, []);
  function closeStudentPanel() {
    setSelectedStudentId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("student")) { url.searchParams.delete("student"); window.history.replaceState(null, "", url.pathname + url.search + url.hash); }
  }

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
    setStudents([...data].sort((a, b) => b.id - a.id));
    setLoading(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    setCoursesError("");
    fetch("/api/courses", { signal: controller.signal }).then(async (response) => {
      const data = await readJson<{ id: number; name: string }[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error("Could not load course filters.");
      if (!controller.signal.aborted) setCourses(data);
    }).catch(() => { if (!controller.signal.aborted) setCoursesError("Could not load course filters."); });
    return () => controller.abort();
  }, [courseRetry]);
  useEffect(() => {
    const refresh = () => { void loadStudents().catch(() => { setError("Could not refresh students."); setLoading(false); }); };
    window.addEventListener("student-courses-updated", refresh);
    return () => window.removeEventListener("student-courses-updated", refresh);
  }, []);
  useEffect(() => { loadStudents().catch(() => { setError("Could not load students."); setLoading(false); }); }, []);
  useEffect(() => {
    const openAddStudent = () => startAdd();
    window.addEventListener("open-add-student", openAddStudent);
    return () => window.removeEventListener("open-add-student", openAddStudent);
  }, []);

  function startAdd() { imageVersion.current++; setPreparingImage(false); setForm(emptyForm); setPendingImage(null); setError(""); setFormOpen(true); }
  function closeForm() { if (saving) return; imageVersion.current++; setPreparingImage(false); setFormOpen(false); setForm(emptyForm); setPendingImage(null); setError(""); }
  function updateField(field: keyof FormState, value: string | boolean) { setForm((current) => ({ ...current, [field]: value })); }

  async function selectImage(file: File | undefined) {
    if (!file || saving) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    const version = ++imageVersion.current;
    setPreparingImage(true);
    try {
      const compressed = await compressImage(file);
      if (version !== imageVersion.current) return;
      setPendingImage(compressed);
      setForm((current) => ({ ...current, picture: URL.createObjectURL(compressed) }));
      setError("");
    } catch (reason) { if (version === imageVersion.current) setError(reason instanceof Error ? reason.message : "Could not prepare image."); }
    finally { if (version === imageVersion.current) setPreparingImage(false); }
  }

  useEffect(() => {
    const preview = form.picture;
    return () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); };
  }, [form.picture]);

  async function saveStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || preparingImage) return;
    const email = form.email.trim().toLocaleLowerCase();
    const phone = form.phone.trim();
    const emailExists = Boolean(email) && students.some((student) => student.email.trim().toLocaleLowerCase() === email);
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
    setStudents((current) => [...current, { ...data, courseIds: form.courseIds }].sort((a, b) => b.id - a.id));
    imageVersion.current++; setPreparingImage(false); setFormOpen(false); setForm(emptyForm); setPendingImage(null); setSaving(false);
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredStudents = students.filter((student) => {
    const matchesStatus = statusFilter === "all" || student.active === (statusFilter === "active");
    const matchesSearch = !normalizedSearch || [student.firstName, student.lastName, student.phone, student.email]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesSearch && (courseFilter === "all" || student.courseIds?.includes(Number(courseFilter)));
  });

  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {formOpen && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/70 p-4 md:left-64" role="presentation"><div aria-labelledby="student-dialog-title" aria-modal="true" className="mx-auto w-full max-w-3xl rounded-xl border border-stone-200 bg-white p-6 shadow-2xl" role="dialog"><form onSubmit={saveStudent} className="grid min-w-0 gap-4 md:grid-cols-2"><div className="flex items-center justify-between md:col-span-2"><h2 className="m-0 text-xl font-normal" id="student-dialog-title">Add student</h2><button aria-label="Close dialog" type="button" onClick={closeForm} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">×</button></div>
      {([['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email (optional)'], ['phone', 'Phone']] as const).map(([field, label]) => <label key={field} className="font-sans text-xs font-semibold text-slate-600">{label}<input required={field === 'firstName' || field === 'lastName'} type={field === 'email' ? 'email' : 'text'} {...(field === 'phone' ? { inputMode: "numeric" as const, minLength: 10, pattern: "[0-9]{10,}", title: "Enter at least 10 numbers." } : {})} value={form[field] ?? ""} onChange={(event) => updateField(field, event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal text-slate-800 outline-none focus:border-lime-600" /></label>)}
      <div><span className="font-sans text-xs font-semibold text-slate-600">Student status</span><label className="mt-4 flex cursor-pointer items-center gap-3 font-sans text-xs font-semibold text-slate-600"><input type="checkbox" checked={form.active} onChange={(event) => updateField("active", event.target.checked)} className="peer sr-only" /><span className="relative h-6 w-11 rounded-full bg-stone-300 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-lime-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-lime-600 peer-focus-visible:ring-offset-2" /><span>Active student</span></label></div>
      <div>
        <span className="font-sans text-xs font-semibold text-slate-600">Student picture (optional)</span>
        <input ref={imageInput} aria-label="Upload student image" accept="image/*" type="file" className="hidden" disabled={saving} onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <button type="button" disabled={saving} onClick={() => imageInput.current?.click()}
          onDragOver={(event) => { event.preventDefault(); if (!saving) { event.dataTransfer.dropEffect = "copy"; setDraggingImage(true); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImage(false); }}
          onDrop={(event) => { event.preventDefault(); setDraggingImage(false); if (!saving) { if (event.dataTransfer.files.length > 1) setError("Drop one image at a time."); else void selectImage(event.dataTransfer.files[0]); } }}
          className={`mt-2 flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-4 text-center font-sans focus:outline-none focus:ring-2 focus:ring-lime-600 disabled:opacity-50 ${draggingImage ? "border-lime-600 bg-lime-100" : "border-stone-300 bg-stone-50 hover:border-lime-500 hover:bg-lime-50"}`}>
          {form.picture ? <img src={form.picture} alt="Student photo preview" className="h-20 w-20 rounded-full object-cover" /> : <span aria-hidden="true" className="text-3xl text-slate-400">＋</span>}
          <span className="text-sm font-semibold text-slate-700">{preparingImage ? "Preparing image…" : draggingImage ? "Drop image here" : form.picture ? "Drop or click to replace photo" : "Drop an image here or click to upload"}</span>
        </button>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => imageInput.current?.click()} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50">Upload image</button>
          <label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold focus-within:ring-2 focus-within:ring-lime-600 md:hidden">Take photo<input aria-label="Take student photo" accept="image/*" capture="environment" type="file" disabled={saving} className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
        </div>
      </div>
      <div className="md:col-span-2"><StudentCourses selected={form.courseIds} onChange={(courseIds) => setForm((current) => ({ ...current, courseIds }))} disabled={saving} /></div>
      <div className="flex items-center justify-between gap-4 md:col-span-2">{error ? <p role="alert" className="m-0 min-w-0 flex-1 font-sans text-sm text-red-700">{error}</p> : <span className="flex-1" />}<div className="flex shrink-0 justify-end gap-3"><button type="button" onClick={closeForm} className="rounded-md border border-stone-300 bg-white px-4 py-3 font-sans text-xs font-semibold">Cancel</button><button disabled={saving || preparingImage} className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100">{saving ? "Saving..." : "Add student"}</button></div></div>
    </form></div></div>}
    <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-row">
      <label className="relative col-span-2 min-w-0 flex-1 font-sans"><span className="sr-only">Search students</span><svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-current text-slate-400" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, phone, or email" className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-lime-600" /></label>
      <label className="min-w-0 font-sans"><span className="sr-only">Filter students by course</span><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-lime-600 sm:max-w-60"><option value="all">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
      <label className="min-w-0 font-sans"><span className="sr-only">Filter students by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-lime-600 sm:w-40"><option value="all">All students</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </div>
    {coursesError && <p role="alert" className="font-sans text-sm text-red-700">{coursesError} <button type="button" onClick={() => setCourseRetry((value) => value + 1)} className="underline">Retry</button></p>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading students...</p> : students.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No students yet</h2><p className="mt-2 font-sans text-sm text-slate-400">Add your first student to begin building the directory.</p></div> : filteredStudents.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No matching students</h2><p className="mt-2 font-sans text-sm text-slate-400">Adjust your search, status, or course filter.</p></div> : <div className="divide-y divide-stone-200">{filteredStudents.map((student) => <StudentCard key={student.id} student={student} courses={(student.courseIds ?? []).map((id) => ({ id, name: courses.find((course) => course.id === id)?.name ?? `Course #${id}` }))} onOpen={() => setSelectedStudentId(student.id)} />)}</div>}</section>
    {selectedStudentId !== null && <StudentPanel key={selectedStudentId} id={selectedStudentId} onClose={closeStudentPanel} onUpdate={(updated) => setStudents((current) => current.map((student) => student.id === updated.id ? { ...student, ...updated } : student))} onDelete={(id) => { setStudents((current) => current.filter((student) => student.id !== id)); closeStudentPanel(); }} />}
  </div></main>;
}
