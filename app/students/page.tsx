"use client";

import { useEffect, useState } from "react";

type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; picture: string | null; active: boolean };
type FormState = Omit<Student, "id">;
type ApiError = { error?: string };
const emptyForm: FormState = { firstName: "", lastName: "", email: "", phone: "", picture: null, active: true };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  function startAdd() { setForm(emptyForm); setError(""); setFormOpen(true); }
  function closeForm() { setFormOpen(false); setForm(emptyForm); setError(""); }
  function updateField(field: keyof FormState, value: string | boolean) { setForm((current) => ({ ...current, [field]: value })); }

  async function saveStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await readJson<Student & ApiError>(response);
    if (!response.ok) { setError(data.error ?? "Could not save student."); setSaving(false); return; }
    setStudents((current) => [...current, data].sort((a, b) => a.lastName.localeCompare(b.lastName)));
    closeForm(); setSaving(false);
  }

  return <main className="min-h-screen bg-[#f7f8f6] px-6 py-12 text-[#273334] md:px-12"><div className="mx-auto max-w-5xl">
    <p className="mb-2 font-sans text-[10px] font-bold uppercase tracking-[1.2px] text-[#929b94]">Free Spirit Dance</p>
    <div className="flex items-end justify-between gap-6"><div><h1 className="m-0 text-4xl font-normal">Students</h1><p className="mt-3 font-sans text-sm text-[#7d8782]">Manage your student directory.</p></div><button onClick={startAdd} className="rounded-[7px] border-0 bg-[#253638] px-4 py-3 font-sans text-xs font-bold text-[#eff3e8]">+ Add student</button></div>
    {formOpen && <div className="fixed inset-0 z-40 overflow-y-auto bg-[#172325aa] p-4 md:left-[248px]" role="presentation"><div aria-labelledby="student-dialog-title" aria-modal="true" className="mx-auto mt-[5vh] w-full max-w-[720px] rounded-[9px] border border-[#e5e9e2] bg-white p-6 shadow-2xl" role="dialog"><form onSubmit={saveStudent} className="grid min-w-0 gap-4 md:grid-cols-2"><div className="flex items-center justify-between md:col-span-2"><h2 className="m-0 text-xl font-normal" id="student-dialog-title">Add student</h2><button aria-label="Close dialog" type="button" onClick={closeForm} className="rounded-md border border-[#dce3da] px-3 py-2 font-sans text-xs font-semibold">×</button></div>
      {([['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['picture', 'Picture URL']] as const).map(([field, label]) => <label key={field} className="font-sans text-xs font-semibold text-[#52615c]">{label}<input required={field !== 'phone' && field !== 'picture'} type={field === 'email' ? 'email' : 'text'} value={form[field] ?? ""} onChange={(event) => updateField(field, event.target.value)} className="mt-2 w-full rounded-md border border-[#dce3da] px-3 py-3 font-normal text-[#273334] outline-none focus:border-[#829b57]" /></label>)}
      <label className="flex items-center gap-3 font-sans text-xs font-semibold text-[#52615c]"><input type="checkbox" checked={form.active} onChange={(event) => updateField("active", event.target.checked)} /> Active student</label><div className="flex justify-end gap-3 md:col-span-2"><button type="button" onClick={closeForm} className="rounded-md border border-[#dce3da] bg-white px-4 py-3 font-sans text-xs font-semibold">Cancel</button><button disabled={saving} className="rounded-md bg-[#253638] px-4 py-3 font-sans text-xs font-bold text-[#eff3e8]">{saving ? "Saving..." : "Add student"}</button></div>{error && <p role="alert" className="m-0 font-sans text-sm text-[#a14c43] md:col-span-2">{error}</p>}
    </form></div></div>}
    <section className="mt-8 overflow-hidden rounded-[9px] border border-[#e5e9e2] bg-white">{loading ? <p className="p-8 text-center font-sans text-sm text-[#929b94]">Loading students...</p> : students.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No students yet</h2><p className="mt-2 font-sans text-sm text-[#929b94]">Add your first student to begin building the directory.</p></div> : <div className="divide-y divide-[#e5e9e2]">{students.map((student) => <a key={student.id} href={`/students/${student.id}`} className="flex items-center gap-4 p-5 transition-colors hover:bg-[#f7f8f6] focus:bg-[#f7f8f6] focus:outline-none"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e2f08b] font-sans font-bold text-[#273334]">{student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : `${student.firstName[0]}${student.lastName[0]}`}</div><div className="min-w-0 flex-1"><h2 className="m-0 text-lg font-normal">{student.firstName} {student.lastName}</h2><p className="mt-1 truncate font-sans text-xs text-[#7d8782]">{student.email}{student.phone && ` · ${student.phone}`}</p></div><span className={`font-sans text-[10px] font-bold uppercase tracking-[1px] ${student.active ? "text-[#65803b]" : "text-[#929b94]"}`}>{student.active ? "Active" : "Inactive"}</span><span className="font-sans text-xs font-semibold text-[#52615c]">View</span></a>)}</div>}</section>
  </div></main>;
}
