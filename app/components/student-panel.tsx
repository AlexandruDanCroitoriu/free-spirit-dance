"use client";

import { compressImage } from "../lib/profile-image";
import { readJson } from "../lib/http";
import { useEffect, useRef, useState } from "react";
import StudentActivity from "./student-activity";
import StudentCourses from "./student-courses";
import StudentCard from "./student-card";

export type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; birthDate: string | null; picture: string | null; active: boolean };
const studentTabs = [["logs", "Logs"], ["info", "Student info"]] as const;
type Field = keyof Student;
type EditableTextField = "firstName" | "lastName" | "email" | "phone" | "birthDate";
type Drafts = Record<EditableTextField, string>;
const editableFields: Array<{ key: EditableTextField; label: string; type?: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email (optional)", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "birthDate", label: "Birth date (optional)", type: "date" },
];
const emptyDrafts: Drafts = { firstName: "", lastName: "", email: "", phone: "", birthDate: "" };

export default function StudentPanel({ id, onClose, onUpdate, onDelete, editPaymentId, attendanceDate }: { id: number; onClose: () => void; onUpdate: (student: Student) => void; onDelete: (id: number) => void; editPaymentId?: number; attendanceDate?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingSaves = useRef(0);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const [activeTab, setActiveTab] = useState<(typeof studentTabs)[number][0]>("logs");
  const [student, setStudent] = useState<Student | null>(null);
  const studentRef = useRef<Student | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [activeDraft, setActiveDraft] = useState("true");
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<Field | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/students/${id}`, { signal: controller.signal }).then(async (response) => {
      const data = await readJson<Student & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Could not load student.");
      if (controller.signal.aborted) return;
      studentRef.current = data; setStudent(data); setDrafts({ firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone, birthDate: data.birthDate ?? "" }); setActiveDraft(String(data.active));
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load student."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  function closePanel() {
    if (saving) return;
    if (deleteConfirmOpen) { setDeleteConfirmOpen(false); return; }
    onClose();
  }

  async function selectImage(file: File | undefined) {
    const current = studentRef.current;
    if (!file || !current || saving || pendingSaves.current) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file."); return; }
    pendingSaves.current += 1;
    setSavingPhoto(true); setError("");
    let preview: string | undefined;
    try {
      const compressed = await compressImage(file);
      preview = URL.createObjectURL(compressed);
      setStudent({ ...current, picture: preview });
      const imageData = new FormData(); imageData.append("file", compressed);
      const uploadResponse = await fetch("/api/student-images", { method: "POST", body: imageData });
      const upload = await readJson<{ picture?: string; error?: string }>(uploadResponse);
      if (!uploadResponse.ok || !upload.picture) throw new Error(upload.error ?? "Could not upload image.");
      const response = await fetch(`/api/students/${current.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...current, picture: upload.picture }) });
      const data = await readJson<Student & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Could not save photo.");
      studentRef.current = data; setStudent(data); onUpdate(data);
    } catch (reason) {
      setStudent(current);
      setError(reason instanceof Error ? reason.message : "Could not save photo. Please try again.");
    } finally {
      if (preview) URL.revokeObjectURL(preview);
      pendingSaves.current -= 1; setSavingPhoto(false);
    }
  }

  async function saveField(field: Exclude<Field, "id" | "picture">, value: string) {
    const current = studentRef.current;
    if (!current || savingPhoto || String(current[field]) === value) return;
    if ((field === "firstName" || field === "lastName") && !value.trim()) { setError(`${field === "firstName" ? "First" : "Last"} name is required.`); return; }
    if (field === "email" && value.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) { setError("Enter a valid email or leave it empty."); return; }
    if (field === "phone" && value.trim() && !/^\d{10,}$/.test(value.trim())) { setError("Phone must contain only numbers and be at least 10 digits."); return; }
    if (field === "birthDate" && value && (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || value > new Date().toISOString().slice(0, 10))) { setError("Enter a valid birth date that is not in the future, or leave it empty."); return; }
    pendingSaves.current += 1;
    setSavingField(field); setError("");
    try {
    const picture = current.picture;
    const next = { ...current, [field]: field === "active" ? value === "true" : value, picture };
    studentRef.current = next;
    setStudent(next);
    const response = await fetch(`/api/students/${current.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const data = await readJson<Student & { error?: string }>(response);
    if (!response.ok) {
      setError(data.error ?? "Could not save field.");
      if (studentRef.current?.[field] === next[field]) { studentRef.current = { ...studentRef.current, [field]: current[field], picture: current.picture }; setStudent(studentRef.current); }
    } else {
      studentRef.current = { ...(studentRef.current ?? data), [field]: data[field], picture: data.picture };
      setStudent(studentRef.current); onUpdate(studentRef.current);
      if (field === "active") setActiveDraft(String(data.active));
      else setDrafts((currentDrafts) => ({ ...currentDrafts, [field]: field === "birthDate" ? data.birthDate ?? "" : String(data[field]) }));
    }
    } catch (reason) {
      studentRef.current = current; setStudent(current);
      setError(reason instanceof Error ? reason.message : "Could not save field. Please try again.");
    } finally { pendingSaves.current -= 1; setSavingField(null); }
  }

  async function deleteStudent() {
    if (!student) return;
    setSaving(true); setError("");
    try {
    const response = await fetch(`/api/students/${student.id}`, { method: "DELETE" });
    const data = await readJson<{ error?: string }>(response);
    if (!response.ok) { setError(data.error ?? "Could not delete student."); setSaving(false); return; }
    onDelete(student.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete student."); }
    finally { setSaving(false); }
  }

  return <dialog ref={dialog} aria-label={student ? `${student.firstName} ${student.lastName}` : "Student details"} aria-modal="true" className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-3xl overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={(event) => { event.preventDefault(); closePanel(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePanel();
  }}>
    <button autoFocus type="button" aria-label="Close student panel" disabled={saving || savingPhoto || savingField !== null} onClick={closePanel} className="fixed right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white font-sans text-xl text-slate-600 shadow-sm hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-lime-600 disabled:opacity-50">×</button>
    <div className="px-5 pb-6">
    {loading ? <p role="status" className="font-sans text-sm text-slate-500">Loading student…</p> : !student ? <p role="alert" className="font-sans text-sm text-red-700">{error || "Student not found."}</p> : <>
    <section className="pt-8"><StudentCard presentationOnly student={student} /></section>

    <nav aria-label="Student sections" className="mt-6 flex gap-6 border-b border-stone-300" role="tablist">
      {studentTabs.map(([tab, label], index) => <button key={tab} id={`student-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls={`student-panel-${tab}`} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? studentTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + studentTabs.length) % studentTabs.length; const next = studentTabs[nextIndex][0]; setActiveTab(next); document.getElementById(`student-tab-${next}`)?.focus(); } }} className={`-mb-px border-0 border-b-2 bg-transparent px-1 pb-3 font-sans text-xs font-bold ${activeTab === tab ? "border-slate-800 text-slate-800" : "border-transparent text-slate-500"}`}>{label}</button>)}
    </nav>
    <div id="student-panel-info" role="tabpanel" aria-labelledby="student-tab-info" hidden={activeTab !== "info"}>
      <StudentCourses key={student.id} studentId={student.id} />
    <section aria-label="Student info" className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white px-5 shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-stone-200 py-4">
        <div className="min-w-0"><p className="m-0 font-sans text-xs font-bold uppercase tracking-wider text-slate-400">Profile photo</p><p className="mt-1 truncate font-sans text-sm text-slate-800">{savingPhoto ? "Saving photo…" : "Photo changes save automatically"}</p></div>
        <div className="flex flex-wrap justify-end gap-2"><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Camera<input accept="image/*" capture="environment" type="file" disabled={saving || savingPhoto || savingField !== null} className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label><label className="cursor-pointer rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Upload<input accept="image/*" type="file" disabled={saving || savingPhoto || savingField !== null} className="sr-only" onChange={(event) => { void selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div>
      </div>
      {editableFields.map(({ key, label, type }) => <div key={key} className="border-b border-stone-200 py-4"><label className="block font-sans"><span className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-slate-400"><span>{label}</span>{savingField === key && <span className="normal-case tracking-normal text-lime-700">Saving...</span>}</span><input disabled={savingPhoto} type={type ?? "text"} {...(key === "birthDate" ? { max: new Date().toISOString().slice(0, 10) } : {})} {...(key === "phone" ? { inputMode: "numeric" as const, minLength: 10, pattern: "[0-9]{10,}", title: "Enter at least 10 numbers." } : {})} value={drafts[key]} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => void saveField(key, drafts[key])} className="mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-lime-600 focus:ring-1 focus:ring-lime-600" /></label></div>)}
      <div className="border-b border-stone-200 py-4"><label className="block font-sans"><span className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-slate-400"><span>Status</span>{savingField === "active" && <span className="normal-case tracking-normal text-lime-700">Saving...</span>}</span><select disabled={savingPhoto} value={activeDraft} onChange={(event) => setActiveDraft(event.target.value)} onBlur={(event) => void saveField("active", event.currentTarget.value)} className={`mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600 ${activeDraft === "true" ? "text-lime-700" : "text-slate-500"}`}><option value="true">Active</option><option value="false">Inactive</option></select></label></div>
      {error && <p role="alert" className="py-4 font-sans text-sm text-red-700">{error}</p>}
      <div className="flex justify-end py-4"><button disabled={saving || savingPhoto} onClick={() => setDeleteConfirmOpen(true)} className="rounded-md border border-red-300 bg-white px-3 py-2 font-sans text-xs font-semibold text-red-700 transition-colors hover:bg-red-50">Delete student</button></div>
    </section>
    </div>
    <div id="student-panel-logs" role="tabpanel" aria-labelledby="student-tab-logs" hidden={activeTab !== "logs"}>
      {activeTab === "logs" && <StudentActivity key={`activity-${student.id}`} studentId={student.id} initialPaymentId={editPaymentId} targetAttendanceDate={attendanceDate} />}
    </div>
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
    </>}
  </div></dialog>;
}
