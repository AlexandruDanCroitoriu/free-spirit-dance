"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type IconName = "book" | "home" | "qr-code" | "users";
type AdminProfile = { email: string; name: string; picture: string | null };

const navigation: Array<{ label: string; href: string; icon: IconName }> = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Students", href: "/students", icon: "users" },
  { label: "Courses", href: "/courses", icon: "book" },
  { label: "QR Codes", href: "/qr-codes", icon: "qr-code" },
];

function Icon({ name }: { name: IconName }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v10h14V9M9 19v-5h6v5" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    "qr-code": <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3" /></>,
  };
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0 stroke-current stroke-2" fill="none" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function Sidebar({ close, pathname, profile }: { close?: () => void; pathname: string; profile: AdminProfile }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return <aside className="flex h-full flex-col bg-slate-900 px-4 pt-4 pb-5 text-stone-100">
    <div className="pb-4"><a className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-800 focus:bg-slate-800 focus:outline-none" href="/"><img alt="Free Spirit Dance" className="h-20 w-16 max-w-none shrink-0 object-contain" src="/logo.svg" /><div className="min-w-0"><strong className="block whitespace-nowrap font-sans text-base font-bold">Free Spirit Dance</strong><span className="mt-1 block whitespace-nowrap font-sans text-xs uppercase tracking-wide text-slate-400">Knowledgebase</span></div></a></div>
    <nav aria-label="Main navigation" className="font-sans text-sm"><p className="m-0 mb-2.5 px-2.5 text-xs font-bold uppercase tracking-widest text-slate-500">Workspace</p>{navigation.map((item) => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <a className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-slate-800 focus:bg-slate-800 focus:outline-none ${active ? "bg-slate-700 text-orange-300" : "text-slate-300 hover:text-stone-100 focus:text-stone-100"}`} href={item.href} key={item.href} onClick={close}><Icon name={item.icon} />{item.label}</a>; })}</nav>
    <div className="relative mt-auto border-t border-slate-700 pt-4">
      {userMenuOpen && <div className="absolute bottom-24 left-0 right-0 rounded-xl border border-slate-600 bg-slate-800 p-2 shadow-2xl md:bottom-20 md:rounded-lg md:p-1">
        <a className="block rounded-lg px-4 py-3.5 font-sans text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 focus:bg-slate-700 focus:outline-none md:rounded-md md:px-3 md:py-2 md:text-xs" href="/settings" onClick={close}>Settings</a>
        <a className="block rounded-lg px-4 py-3.5 font-sans text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 focus:bg-slate-700 focus:outline-none md:rounded-md md:px-3 md:py-2 md:text-xs" href="/cdn-cgi/access/logout">Log out</a>
      </div>}
      <button aria-expanded={userMenuOpen} aria-haspopup="menu" className="group flex w-full items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-800/60 p-2.5 text-left shadow-sm transition-all hover:border-slate-600 hover:bg-slate-800 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-400" onClick={() => setUserMenuOpen((open) => !open)}>
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-lime-200 to-orange-300 font-sans text-lg font-bold text-slate-900 ring-1 ring-white/15 shadow-sm">{profile.picture ? <img alt="" className="h-full w-full object-cover" src={profile.picture} /> : (profile.name || "A").charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-sans text-[15px] font-semibold leading-5 text-white">{profile.name || "Profile"}</span><span className="mt-0.5 block truncate font-sans text-[11px] font-medium text-slate-400">Administrator</span></span>
        <svg aria-hidden="true" className={`h-4 w-4 shrink-0 fill-none stroke-current stroke-2 text-slate-400 transition-transform duration-200 group-hover:text-slate-200 ${userMenuOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
      </button>
    </div>
  </aside>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profile, setProfile] = useState<AdminProfile>({ email: "", name: "Loading account...", picture: null });
  const pathname = usePathname();
  const studentDetailPage = pathname.startsWith("/students/");
  const pageTitle = pathname === "/" ? "Dashboard" : pathname === "/students" ? "Students" : studentDetailPage ? "Student details" : pathname.startsWith("/courses") ? "Courses" : pathname.startsWith("/qr-codes") ? "QR Codes" : pathname.startsWith("/settings") ? "Settings" : "Free Spirit Dance";

  useEffect(() => {
    const loadProfile = () => fetch("/api/admin-profile")
      .then((response) => response.ok ? response.json() as Promise<AdminProfile> : Promise.reject())
      .then(setProfile)
      .catch(() => setProfile({ email: "", name: "Profile", picture: null }));
    const updateProfile = (event: Event) => setProfile((event as CustomEvent<AdminProfile>).detail);
    void loadProfile();
    window.addEventListener("admin-profile-updated", updateProfile);
    return () => window.removeEventListener("admin-profile-updated", updateProfile);
  }, []);

  return <div className="min-h-screen bg-stone-50"><div className="fixed inset-y-0 left-0 z-10 hidden w-64 md:block"><Sidebar pathname={pathname} profile={profile} /></div>{sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-40 border-0 bg-slate-950/70 md:hidden" onClick={() => setSidebarOpen(false)} />}<div className={`fixed inset-y-0 left-0 z-50 block w-72 max-w-full transition-transform duration-200 md:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}><Sidebar close={() => setSidebarOpen(false)} pathname={pathname} profile={profile} /></div>
    <div className="flex min-h-screen flex-col md:ml-64"><header className="shrink-0 border-b border-stone-200 bg-white px-5 md:px-12"><div className={`mx-auto flex h-16 items-center gap-3 ${studentDetailPage ? "max-w-3xl" : "max-w-5xl"}`}><button aria-label="Open menu" className="flex w-8 shrink-0 flex-col gap-1 border-0 bg-transparent p-1 md:hidden" onClick={() => setSidebarOpen(true)}><span className="h-px w-4 bg-slate-600" /><span className="h-px w-4 bg-slate-600" /><span className="h-px w-4 bg-slate-600" /></button>{studentDetailPage && <a aria-label="Back to students" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-stone-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-lime-600" href="/students"><svg aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></a>}<h1 className="m-0 min-w-0 flex-1 truncate text-2xl font-normal text-slate-800">{pageTitle}</h1>{pathname === "/students" && <button onClick={() => window.dispatchEvent(new Event("open-add-student"))} className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-stone-100">+ Add student</button>}{pathname === "/courses" && <button className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-stone-100">+ Add course</button>}{pathname === "/qr-codes" && <button onClick={() => window.dispatchEvent(new Event("open-add-qr-code"))} className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-stone-100">+ Create QR code</button>}</div></header>{children}</div>
  </div>;
}
