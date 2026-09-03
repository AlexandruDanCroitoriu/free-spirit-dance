"use client";

import { useState } from "react";

type IconName = "activity" | "cloud" | "database" | "folder" | "home" | "settings";

const navigation: Array<{ label: string; href: string; icon: IconName }> = [
  { label: "Overview", href: "#overview", icon: "home" },
  { label: "Cloudflare", href: "#cloudflare", icon: "cloud" },
  { label: "R2 Storage", href: "#storage", icon: "database" },
  { label: "Projects", href: "#projects", icon: "folder" },
];

function Icon({ name }: { name: IconName }) {
  const paths = {
    activity: <><path d="M3 12h4l2-7 4 14 2-7h6" /><path d="M3 19h18" /></>,
    cloud: <path d="M7.5 18h10a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.4 7.2 4 4 0 0 0 7.5 18Z" />,
    database: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.66 3.13 3 7 3s7-1.34 7-3V5" /><path d="M5 12v7c0 1.66 3.13 3 7 3s7-1.34 7-3v-7" /></>,
    folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v10h14V9M9 19v-5h6v5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2v-.48a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9.4 15a1.7 1.7 0 0 0-1.56-1.03H7v-2h.84A1.7 1.7 0 0 0 9.4 11a1.7 1.7 0 0 0-.34-1.88L9 9.06l1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 13.39 6.5V6h2v.5A1.7 1.7 0 0 0 16.42 8a1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.94 12H21v2h-.48A1.7 1.7 0 0 0 19.4 15Z" /></>,
  };
  return <svg aria-hidden="true" className="icon" fill="none" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function Sidebar({ close }: { close?: () => void }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">FS</div><div><strong>Free Spirit</strong><span>Infrastructure</span></div></div>
    <nav aria-label="Main navigation" className="sidebar-nav">
      <p className="nav-label">Workspace</p>
      {navigation.map((item) => <a href={item.href} key={item.href} onClick={close}><Icon name={item.icon} />{item.label}</a>)}
      <p className="nav-label nav-label-spaced">Manage</p>
      <a href="#settings" onClick={close}><Icon name="settings" />Settings</a>
    </nav>
    <div className="sidebar-footer"><div className="status-dot" /><div><strong>All systems operational</strong><span>Updated just now</span></div></div>
  </aside>;
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return <div className="app-shell">
    <div className="desktop-sidebar"><Sidebar /></div>
    {sidebarOpen && <button aria-label="Close menu" className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
    <div className={`mobile-sidebar ${sidebarOpen ? "is-open" : ""}`}><Sidebar close={() => setSidebarOpen(false)} /></div>
    <div className="main-column">
      <header className="topbar">
        <button aria-label="Open menu" className="menu-button" onClick={() => setSidebarOpen(true)}><span /><span /><span /></button>
        <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
        <div className="profile"><span className="profile-avatar">AD</span><span className="profile-name">Alexandru Dan</span></div>
      </header>
      <main className="content" id="overview">
        <section className="welcome-row"><div><p className="eyebrow">Friday, September 4, 2026</p><h1>Good morning, Alexandru.</h1><p className="lede">Here is the pulse of your infrastructure, all in one place.</p></div><button className="primary-button"><span>+</span> New project</button></section>
        <section className="metric-grid" aria-label="Infrastructure summary">
          <article className="metric-card accent-green"><div className="metric-icon"><Icon name="activity" /></div><span>System status</span><strong>Operational</strong><small><i /> No incidents detected</small></article>
          <article className="metric-card accent-blue"><div className="metric-icon"><Icon name="cloud" /></div><span>Cloudflare zones</span><strong>12</strong><small>Across 3 accounts</small></article>
          <article className="metric-card accent-orange"><div className="metric-icon"><Icon name="database" /></div><span>R2 storage</span><strong>84.6 GB</strong><small>Across 6 buckets</small></article>
        </section>
        <div className="section-heading" id="projects"><div><p className="eyebrow">Your workspace</p><h2>Recent projects</h2></div><a href="#projects">View all <span>→</span></a></div>
        <section className="project-grid">
          <article className="project-card"><div className="project-top"><span className="project-symbol purple">D</span><span className="live-pill"><i /> Live</span></div><h3>Dance platform</h3><p>free-spirit-dance</p><div className="project-meta"><span>Cloudflare Workers</span><span>Updated 2h ago</span></div></article>
          <article className="project-card"><div className="project-top"><span className="project-symbol coral">A</span><span className="live-pill"><i /> Live</span></div><h3>Analytics dashboard</h3><p>studio-analytics</p><div className="project-meta"><span>Cloudflare Pages</span><span>Updated yesterday</span></div></article>
          <article className="project-card dashed"><div className="add-project">+</div><h3>Create a project</h3><p>Start something new</p></article>
        </section>
        <section className="lower-grid">
          <article className="panel" id="cloudflare"><div className="panel-heading"><div><p className="eyebrow">Cloudflare</p><h2>Traffic overview</h2></div><span className="period">Last 7 days⌄</span></div><div className="chart"><div className="chart-line" /><div className="chart-fill" /><div className="chart-labels"><span>Aug 29</span><span>Sep 1</span><span>Sep 4</span></div></div><div className="chart-stat"><strong>248,391</strong><span>requests <em>+18.4%</em></span></div></article>
          <article className="panel" id="storage"><div className="panel-heading"><div><p className="eyebrow">R2 storage</p><h2>Bucket activity</h2></div><Icon name="database" /></div><div className="storage-row"><div className="storage-ring"><span>68%</span></div><div><strong>84.6 GB</strong><span>of 125 GB used</span><small>6 active buckets</small></div></div><div className="storage-bar"><span /></div><a className="panel-link" href="#storage">Manage storage <span>→</span></a></article>
        </section>
        <p className="footer-note" id="settings">Free Spirit Infrastructure <span>•</span> Powered by Cloudflare</p>
      </main>
    </div>
  </div>;
}
