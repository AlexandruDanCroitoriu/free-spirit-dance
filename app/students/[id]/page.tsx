"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Student = { id: number; firstName: string; lastName: string; email: string; phone: string; picture: string | null; active: boolean };
type Field = keyof Student;
const editableFields: Array<{ key: Exclude<Field, "id">; label: string; type?: string }> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "picture", label: "Picture URL" },
];

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  try { return body ? JSON.parse(body) as T : {} as T; } catch { return {} as T; }
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetch(`/api/students/${id}`).then(async (response) => { const data = await readJson<Student & { error?: string }>(response); if (!response.ok) throw new Error(data.error ?? "Could not load student."); setStudent(data); }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, [id]);

  function beginEdit(field: Exclude<Field, "id">) { if (!student) return; setEditing(field); setDraft(field === "picture" ? student.picture ?? "" : String(student[field])); setError(""); }

  async function saveField(field: Exclude<Field, "id">, value = draft) {
    if (!student) return;
    const next = { ...student, [field]: field === "active" ? value === "true" : value || (field === "picture" ? null : "") };
    setSaving(true); setError("");
    const response = await fetch(`/api/students/${student.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const data = await readJson<Student & { error?: string }>(response);
    if (!response.ok) setError(data.error ?? "Could not save field."); else { setStudent(data); setEditing(null); }
    setSaving(false);
  }

  async function deleteStudent() {
    if (!student || !window.confirm(`Delete ${student.firstName} ${student.lastName}?`)) return;
    setSaving(true); setError("");
    const response = await fetch(`/api/students/${student.id}`, { method: "DELETE" });
    const data = await readJson<{ error?: string }>(response);
    if (!response.ok) { setError(data.error ?? "Could not delete student."); setSaving(false); return; }
    window.location.href = "/students";
  }

  function beginActiveEdit() { if (!student) return; setEditing("active"); setDraft(String(student.active)); setError(""); }

  if (loading) return <main className="min-h-screen px-6 py-12 md:px-12"><p className="font-sans text-sm text-[#929b94]">Loading student...</p></main>;
  if (!student) return <main className="min-h-screen px-6 py-12 md:px-12"><p className="font-sans text-sm text-[#a14c43]">{error || "Student not found."}</p><a className="mt-4 inline-block font-sans text-sm font-semibold" href="/students">Back to students</a></main>;

  return <main className="min-h-screen bg-[#f7f8f6] px-6 py-12 text-[#273334] md:px-12"><div className="mx-auto max-w-3xl"><a href="/students" className="font-sans text-xs font-semibold text-[#52615c]">← Students</a><div className="mt-8 flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[#e2f08b] font-sans text-lg font-bold">{student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : `${student.firstName[0]}${student.lastName[0]}`}</div><div><h1 className="m-0 text-4xl font-normal">{student.firstName} {student.lastName}</h1><p className="mt-2 font-sans text-sm text-[#7d8782]">Student profile</p></div></div><section className="mt-8 divide-y divide-[#e5e9e2] rounded-[9px] border border-[#e5e9e2] bg-white px-6">{editableFields.map(({ key, label, type }) => <div key={key} className="flex items-end gap-4 py-5"><label className="min-w-0 flex-1 font-sans text-xs font-semibold text-[#52615c]">{label}{editing === key ? <input autoFocus type={type ?? "text"} value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 w-full rounded-md border border-[#dce3da] px-3 py-3 font-normal text-[#273334]" /> : <span className="mt-2 block truncate font-normal text-[#273334]">{key === "picture" ? student.picture || "No picture" : student[key] || "Not provided"}</span>}</label>{editing === key ? <button disabled={saving} onClick={() => saveField(key)} className="rounded-md bg-[#253638] px-3 py-2 font-sans text-xs font-bold text-[#eff3e8]">Save</button> : <button onClick={() => beginEdit(key)} className="rounded-md border border-[#dce3da] px-3 py-2 font-sans text-xs font-semibold">Edit</button>}</div>)}<div className="flex items-center justify-between py-5"><span className="font-sans text-xs font-semibold text-[#52615c]">Status {editing === "active" ? <select value={draft} onChange={(event) => setDraft(event.target.value)} className="ml-2 rounded-md border border-[#dce3da] px-2 py-2 font-normal"><option value="true">Active</option><option value="false">Inactive</option></select> : <strong className={student.active ? "text-[#65803b]" : "text-[#929b94]"}>{student.active ? "Active" : "Inactive"}</strong>}</span>{editing === "active" ? <button disabled={saving} onClick={() => saveField("active")} className="rounded-md bg-[#253638] px-3 py-2 font-sans text-xs font-bold text-[#eff3e8]">Save</button> : <button onClick={beginActiveEdit} className="rounded-md border border-[#dce3da] px-3 py-2 font-sans text-xs font-semibold">Edit</button>}</div>{error && <p role="alert" className="pb-5 font-sans text-sm text-[#a14c43]">{error}</p>}<div className="flex justify-end py-6"><button disabled={saving} onClick={deleteStudent} className="rounded-md border border-[#b85c51] px-4 py-3 font-sans text-xs font-bold text-[#a14c43]">Delete student</button></div></section></div></main>;
}