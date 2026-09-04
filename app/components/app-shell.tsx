"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type IconName = "book" | "home" | "users";

const navigation: Array<{ label: string; href: string; icon: IconName }> = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Students", href: "/students", icon: "users" },
  { label: "Courses", href: "/courses", icon: "book" },
];

function Icon({ name }: { name: IconName }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v10h14V9M9 19v-5h6v5" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
  };
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0 stroke-current stroke-2" fill="none" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function Sidebar({ close, pathname, userEmail }: { close?: () => void; pathname: string; userEmail: string }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return <aside className="flex h-full flex-col bg-slate-900 px-4 pt-4 pb-5 text-stone-100">
    <div className="pb-4"><a className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-800 focus:bg-slate-800 focus:outline-none" href="/"><img alt="Free Spirit Dance" className="h-20 w-16 max-w-none shrink-0 object-contain" src="/logo.svg" /><div className="min-w-0"><strong className="block whitespace-nowrap font-sans text-base font-bold">Free Spirit Dance</strong><span className="mt-1 block whitespace-nowrap font-sans text-xs uppercase tracking-wide text-slate-400">Knowledgebase</span></div></a></div>
    <nav aria-label="Main navigation" className="font-sans text-sm"><p className="m-0 mb-2.5 px-2.5 text-xs font-bold uppercase tracking-widest text-slate-500">Workspace</p>{navigation.map((item) => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <a className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-slate-800 focus:bg-slate-800 focus:outline-none ${active ? "bg-slate-700 text-orange-300" : "text-slate-300 hover:text-stone-100 focus:text-stone-100"}`} href={item.href} key={item.href} onClick={close}><Icon name={item.icon} />{item.label}</a>; })}</nav>
    <div className="relative mt-auto border-t border-slate-700 pt-4">
      {userMenuOpen && <div className="absolute bottom-16 left-0 right-0 rounded-lg border border-slate-600 bg-slate-800 p-1 shadow-xl">
        <a className="block rounded-md px-3 py-2 font-sans text-xs text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:outline-none" href="/settings" onClick={close}>Settings</a>
        <a className="block rounded-md px-3 py-2 font-sans text-xs text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:outline-none" href="/cdn-cgi/access/logout">Log out</a>
      </div>}
      <button aria-expanded={userMenuOpen} aria-haspopup="menu" className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-800 focus:bg-slate-800 focus:outline-none" onClick={() => setUserMenuOpen((open) => !open)}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-200 font-sans text-sm font-bold text-slate-800">{userEmail.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-sans text-xs font-semibold text-stone-100">{userEmail}</span><span className="mt-1 block font-sans text-xs uppercase tracking-wider text-slate-400">Administrator</span></span>
        <span aria-hidden="true" className="font-sans text-sm text-slate-400">{userMenuOpen ? "⌃" : "⌄"}</span>
      </button>
    </div>
  </aside>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("Loading account...");
  const pathname = usePathname();
  const studentDetailPage = pathname.startsWith("/students/");
  const pageTitle = pathname === "/" ? "Dashboard" : pathname === "/students" ? "Students" : studentDetailPage ? "Student details" : pathname.startsWith("/courses") ? "Courses" : pathname.startsWith("/settings") ? "Settings" : "Free Spirit Dance";

  useEffect(() => {
    fetch("/cdn-cgi/access/get-identity")
      .then((response) => response.ok ? response.json() as Promise<{ email?: string }> : Promise.reject())
      .then((identity) => setUserEmail(identity.email ?? "Administrator"))
      .catch(() => setUserEmail("Administrator"));
  }, []);

  return <div className="min-h-screen bg-stone-50"><div className="fixed inset-y-0 left-0 z-10 hidden w-64 md:block"><Sidebar pathname={pathname} userEmail={userEmail} /></div>{sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-20 border-0 bg-slate-950/70 md:hidden" onClick={() => setSidebarOpen(false)} />}<div className={`fixed inset-y-0 left-0 z-30 block w-72 max-w-full transition-transform duration-200 md:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}><Sidebar close={() => setSidebarOpen(false)} pathname={pathname} userEmail={userEmail} /></div>
    <div className="flex min-h-screen flex-col md:ml-64"><header className="shrink-0 border-b border-stone-200 bg-white px-5 md:px-12"><div className={`mx-auto flex h-16 items-center gap-3 ${studentDetailPage ? "max-w-3xl" : "max-w-5xl"}`}><button aria-label="Open menu" className="flex w-8 shrink-0 flex-col gap-1 border-0 bg-transparent p-1 md:hidden" onClick={() => setSidebarOpen(true)}><span className="h-px w-4 bg-slate-600" /><span className="h-px w-4 bg-slate-600" /><span className="h-px w-4 bg-slate-600" /></button>{studentDetailPage && <a aria-label="Back to students" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-stone-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-lime-600" href="/students"><svg aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></a>}<h1 className="m-0 min-w-0 flex-1 truncate text-2xl font-normal text-slate-800">{pageTitle}</h1>{pathname === "/students" && <button onClick={() => window.dispatchEvent(new Event("open-add-student"))} className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-stone-100">+ Add student</button>}{pathname === "/courses" && <button className="shrink-0 rounded-lg border-0 bg-slate-800 px-4 py-2.5 font-sans text-xs font-bold text-stone-100">+ Add course</button>}</div></header>{children}</div>
  </div>;
}
