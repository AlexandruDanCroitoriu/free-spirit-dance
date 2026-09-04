"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [userEmail, setUserEmail] = useState("Loading account...");

  useEffect(() => {
    fetch("/cdn-cgi/access/get-identity")
      .then((response) => response.ok ? response.json() as Promise<{ email?: string }> : Promise.reject())
      .then((identity) => setUserEmail(identity.email ?? "Administrator"))
      .catch(() => setUserEmail("Administrator"));
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f8f6] px-6 py-12 text-[#273334] md:px-12">
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 font-sans text-[10px] font-bold uppercase tracking-[1.2px] text-[#929b94]">Free Spirit Dance</p>
        <h1 className="m-0 text-4xl font-normal">Settings</h1>
        <p className="mt-3 font-sans text-sm text-[#7d8782]">Manage your account and school preferences.</p>
        <section className="mt-10 max-w-xl rounded-[9px] border border-[#e5e9e2] bg-white p-6">
          <label className="block font-sans text-xs font-bold uppercase tracking-[1px] text-[#7d8782]" htmlFor="account-email">Account email</label>
          <input className="mt-3 w-full rounded-[7px] border border-[#dce3da] bg-[#f7f8f6] px-3 py-3 font-sans text-sm text-[#52615c] outline-none" id="account-email" readOnly value={userEmail} />
        </section>
      </div>
    </main>
  );
}
