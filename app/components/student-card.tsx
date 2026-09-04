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
  const phoneDigits = student.phone.replace(/\D/g, "").replace(/^00/, "");
  const whatsappNumber = phoneDigits.startsWith("0") ? `40${phoneDigits.slice(1)}` : phoneDigits;
  const avatar = <span className="flex h-full w-full items-center justify-center overflow-hidden bg-lime-200 font-sans font-bold text-slate-800">{student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : `${student.firstName[0]}${student.lastName[0]}`}</span>;

  return <article className={`relative flex h-20 items-center gap-4 pr-5 transition-colors ${presentationOnly ? "" : "hover:bg-stone-50"}`}>
    {!presentationOnly && <a href={`/students/${student.id}`} aria-label={`View ${fullName}'s profile`} className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600" />}
    <div className="h-20 w-20 shrink-0">{avatar}</div>
    <div className="min-w-0 flex-1"><h2 className="m-0 truncate text-lg font-normal">{fullName}</h2></div>
    <span className={`hidden font-sans text-xs font-bold uppercase tracking-wider sm:inline ${student.active ? "text-lime-700" : "text-slate-400"}`}>{student.active ? "Active" : "Inactive"}</span>
    {student.phone && <a href={`tel:${student.phone}`} aria-label={`Call ${fullName} at ${student.phone}`} className="relative z-20 flex shrink-0 items-center rounded-md border border-stone-300 bg-white p-2 font-sans text-xs font-semibold text-slate-600 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-lime-600 lg:gap-2 lg:px-3">
      <svg aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92Z" /></svg>
      <span className="hidden lg:inline">Call</span>
    </a>}
    {student.phone && <a href={`https://wa.me/${whatsappNumber}`} aria-label={`Start a WhatsApp conversation with ${fullName}`} className="relative z-20 flex shrink-0 items-center rounded-md border border-emerald-300 bg-white p-2 font-sans text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 lg:gap-2 lg:px-3" rel="noreferrer" target="_blank">
      <svg aria-hidden="true" className="h-4 w-4 fill-current" viewBox="0 0 24 24"><path d="M12.04 2a9.84 9.84 0 0 0-8.45 14.88L2 22l5.25-1.55A9.96 9.96 0 1 0 12.04 2Zm0 17.98a8.05 8.05 0 0 1-4.1-1.12l-.3-.18-3.11.92.93-3.03-.2-.31a7.86 7.86 0 0 1-1.22-4.22 8 8 0 1 1 8 7.94Zm4.39-5.98c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.93-1.19a7.23 7.23 0 0 1-1.34-1.66c-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46a.88.88 0 0 0-.64.3c-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.11 3.63.57.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" /></svg>
      <span className="hidden lg:inline">WhatsApp</span>
    </a>}
  </article>;
}
