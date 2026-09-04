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
    <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12">
      <div className="mx-auto max-w-5xl">
        <p className="m-0 font-sans text-sm text-slate-500">Manage your account and school preferences.</p>
        <section className="mt-10 max-w-xl rounded-xl border border-stone-200 bg-white p-6">
          <label className="block font-sans text-xs font-bold uppercase tracking-wider text-slate-500" htmlFor="account-email">Account email</label>
          <input className="mt-3 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-3 font-sans text-sm text-slate-600 outline-none" id="account-email" readOnly value={userEmail} />
        </section>
      </div>
    </main>
  );
}
