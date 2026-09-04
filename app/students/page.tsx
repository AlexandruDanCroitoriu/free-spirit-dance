export default function StudentsPage() {
  return (
    <main className="min-h-screen bg-[#f7f8f6] px-6 py-12 text-[#273334] md:px-12">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 font-sans text-[10px] font-bold uppercase tracking-[1.2px] text-[#929b94]">Free Spirit Dance</p>
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="m-0 text-4xl font-normal">Students</h1>
            <p className="mt-3 font-sans text-sm text-[#7d8782]">Manage your student directory.</p>
          </div>
          <button className="rounded-[7px] border-0 bg-[#253638] px-4 py-3 font-sans text-xs font-bold text-[#eff3e8]">+ Add student</button>
        </div>
        <section className="mt-10 rounded-[9px] border border-[#e5e9e2] bg-white p-10 text-center">
          <h2 className="m-0 text-xl font-normal">No students yet</h2>
          <p className="mt-2 font-sans text-sm text-[#929b94]">Add your first student to begin building the directory.</p>
        </section>
      </div>
    </main>
  );
}
