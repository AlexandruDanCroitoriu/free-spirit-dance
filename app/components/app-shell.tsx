"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useEffect } from "react";

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
  return <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0 stroke-current stroke-[1.7]" fill="none" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function Sidebar({ close, pathname }: { close?: () => void; pathname: string }) {
  const [userEmail, setUserEmail] = useState("Loading account...");
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/cdn-cgi/access/get-identity")
      .then((response) => response.ok ? response.json() as Promise<{ email?: string }> : Promise.reject())
      .then((identity) => setUserEmail(identity.email ?? "Administrator"))
      .catch(() => setUserEmail("Administrator"));
  }, []);

  return <aside className="flex h-full flex-col bg-[#202a2c] px-[18px] pt-4 pb-5 text-[#eaf0e8]">
    <div className="pb-4"><a className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[#2c3939] focus:bg-[#2c3939] focus:outline-none" href="/"><img alt="Free Spirit Dance" className="h-20 w-16 max-w-none shrink-0 object-contain" src="/logo.svg" /><div className="min-w-0"><strong className="block whitespace-nowrap font-sans text-base font-bold">Free Spirit Dance</strong><span className="mt-[3px] block whitespace-nowrap font-sans text-[11px] uppercase tracking-[.5px] text-[#9caeab]">Knowledgebase</span></div></a></div>
    <nav aria-label="Main navigation" className="font-sans text-[13px]"><p className="m-0 mb-[10px] px-[10px] text-[10px] font-bold uppercase tracking-[1.4px] text-[#7e9792]">Workspace</p>{navigation.map((item) => <a className={`flex items-center gap-3 rounded-lg px-3 py-[11px] text-[#aebdb8] transition-colors hover:bg-[#2c3939] hover:text-[#f4f8ed] focus:bg-[#2c3939] focus:text-[#f4f8ed] focus:outline-none ${(item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) ? "bg-[#354440] text-[#e2f08b]" : ""}`} href={item.href} key={item.href} onClick={close}><Icon name={item.icon} />{item.label}</a>)}</nav>
    <div className="relative mt-auto border-t border-[#3a4947] pt-4">
      {userMenuOpen && <div className="absolute bottom-[68px] left-0 right-0 rounded-lg border border-[#43524f] bg-[#2c3939] p-1 shadow-xl">
        <a className="block rounded-md px-3 py-2 font-sans text-xs text-[#dbe5df] hover:bg-[#354440] focus:bg-[#354440] focus:outline-none" href="/settings" onClick={close}>Settings</a>
        <a className="block rounded-md px-3 py-2 font-sans text-xs text-[#dbe5df] hover:bg-[#354440] focus:bg-[#354440] focus:outline-none" href="/cdn-cgi/access/logout">Log out</a>
      </div>}
      <button aria-expanded={userMenuOpen} aria-haspopup="menu" className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[#2c3939] focus:bg-[#2c3939] focus:outline-none" onClick={() => setUserMenuOpen((open) => !open)}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e2f08b] font-sans text-sm font-bold text-[#273334]">{userEmail.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-sans text-xs font-semibold text-[#eaf0e8]">{userEmail}</span><span className="mt-1 block font-sans text-[10px] uppercase tracking-[1px] text-[#8fa29d]">Administrator</span></span>
        <span aria-hidden="true" className="font-sans text-sm text-[#9caeab]">{userMenuOpen ? "⌃" : "⌄"}</span>
      </button>
    </div>
  </aside>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return <div className="min-h-screen bg-[#f7f8f6]"><div className="fixed inset-y-0 left-0 z-10 hidden w-[248px] md:block"><Sidebar pathname={pathname} /></div>{sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-20 border-0 bg-[#172325aa] md:hidden" onClick={() => setSidebarOpen(false)} />}<div className={`fixed inset-y-0 left-0 z-30 block w-[min(280px,88vw)] transition-transform duration-200 md:hidden ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}><Sidebar close={() => setSidebarOpen(false)} pathname={pathname} /></div>
    <div className="min-h-screen md:ml-[248px]"><header className="flex h-16 items-center px-5 md:hidden"><button aria-label="Open menu" className="flex w-[30px] flex-col gap-1 border-0 bg-transparent p-1" onClick={() => setSidebarOpen(true)}><span className="h-px w-[18px] bg-[#52615c]" /><span className="h-px w-[18px] bg-[#52615c]" /><span className="h-px w-[18px] bg-[#52615c]" /></button></header>{children}</div>
  </div>;
}
