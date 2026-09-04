type StudentCardProps = {
  presentationOnly?: boolean;
  student: {
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    picture: string | null;
    active: boolean;
  };
};

export default function StudentCard({ presentationOnly = false, student }: StudentCardProps) {
  const fullName = `${student.firstName} ${student.lastName}`;
  const avatar = <span className="flex h-full w-full items-center justify-center overflow-hidden bg-lime-200 font-sans font-bold text-slate-800">{student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : `${student.firstName[0]}${student.lastName[0]}`}</span>;

  return <article className={`relative flex h-20 items-center gap-4 pr-5 transition-colors ${presentationOnly ? "" : "hover:bg-stone-50"}`}>
    {!presentationOnly && <a href={`/students/${student.id}`} aria-label={`View ${fullName}'s profile`} className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600" />}
    <div className="h-20 w-20 shrink-0">{avatar}</div>
    <div className="min-w-0 flex-1"><h2 className="m-0 truncate text-lg font-normal">{fullName}</h2></div>
    <span className={`font-sans text-xs font-bold uppercase tracking-wider ${student.active ? "text-lime-700" : "text-slate-400"}`}>{student.active ? "Active" : "Inactive"}</span>
    {student.phone && <a href={`tel:${student.phone}`} aria-label={`Call ${fullName} at ${student.phone}`} className="relative z-20 flex shrink-0 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold text-slate-600 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-lime-600">
      <svg aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92Z" /></svg>
      <span>Call</span>
    </a>}
  </article>;
}
