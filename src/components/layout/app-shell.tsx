"use client";

import {
  CalendarDotsIcon, ClockCounterClockwiseIcon, FilmStripIcon, GearSixIcon,
  LayoutIcon, ListBulletsIcon, ListIcon, NotePencilIcon, SidebarSimpleIcon,
  SquaresFourIcon, StackIcon, UsersIcon, ChartLineIcon, PlugsIcon,
} from "@phosphor-icons/react";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "./brand";
import { ThemeSwitcher } from "./theme-switcher";

const navigation = [
  { title: "Workspace", items: [
    { label: "Overview", href: "/", Icon: SquaresFourIcon },
    { label: "Clip Library", href: "/clips", Icon: FilmStripIcon },
    { label: "Create Post", href: "/compose", Icon: NotePencilIcon },
    { label: "Calendar", href: "/calendar", Icon: CalendarDotsIcon },
    { label: "Publishing Queue", href: "/queue", Icon: ListBulletsIcon },
  ] },
  { title: "Management", items: [
    { label: "Accounts", href: "/accounts", Icon: UsersIcon },
    { label: "Analytics", href: "/analytics", Icon: ChartLineIcon },
    { label: "Integrations", href: "/integrations", Icon: PlugsIcon },
    { label: "History", href: "/history", Icon: ClockCounterClockwiseIcon },
    { label: "Templates", href: "/templates", Icon: StackIcon },
    { label: "Settings", href: "/settings", Icon: GearSixIcon },
  ] },
];

const sidebarKey = "clipflow-sidebar";
let sidebarFallback: boolean | undefined;

function readSidebar() {
  if (sidebarFallback !== undefined) return sidebarFallback;
  try { return localStorage.getItem(sidebarKey) === "collapsed"; } catch { return false; }
}

function subscribeToSidebar(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener(sidebarKey, update);
  return () => {
    window.removeEventListener("storage", update);
    window.removeEventListener(sidebarKey, update);
  };
}

function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="navigation" aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
      {navigation.map(({ title, items }) => (
        <div key={title} className="nav-group">
          <p className="nav-label caption-3">{title}</p>
          <ul>
            {items.map(({ label, href, Icon }) => {
              const content = <><Icon size={18} aria-hidden="true" /><span className="nav-text">{label}</span></>;
              const link = <Link className="nav-item title-4" href={href} aria-current={pathname === href ? "page" : undefined} title={label}>{content}</Link>;
              return <li key={href}>{mobile ? <SheetClose asChild>{link}</SheetClose> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function LocalStatus({ online }: { online: boolean | null }) {
  return (
    <div className="local-status">
      <span className="local-icon" aria-hidden="true"><LayoutIcon size={18} /></span>
      <div className="local-copy"><p className="title-5">Local workspace</p><p className={`caption-5 ${online === null ? "muted" : online ? "tone-success" : "tone-error"}`}>{online === null ? "Checking worker" : online ? "Worker online" : "Worker offline"}</p></div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/worker-health", { signal: controller.signal, cache: "no-store" });
        if (response.ok) setOnline(Boolean((await response.json()).online));
        else setOnline(false);
      } catch { if (!controller.signal.aborted) setOnline(false); }
    }
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);
  const collapsed = useSyncExternalStore(subscribeToSidebar, readSidebar, () => false);
  const pathname = usePathname();
  const group = navigation.find(section => section.items.some(item => item.href === pathname));
  const label = group?.items.find(item => item.href === pathname)?.label ?? "ClipFlow";

  function toggleSidebar() {
    try {
      localStorage.setItem(sidebarKey, collapsed ? "expanded" : "collapsed");
    } catch {
      sidebarFallback = !collapsed;
    }
    window.dispatchEvent(new Event(sidebarKey));
  }

  return (
    <ThemeProvider attribute="data-theme" storageKey="clipflow-theme" defaultTheme="system" enableSystem>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app-shell" data-sidebar={collapsed ? "collapsed" : "expanded"}>
        <aside className="sidebar" aria-label="ClipFlow sidebar" id="desktop-sidebar">
          <div className="sidebar-brand"><Brand /></div>
          <Navigation />
          <div className="sidebar-footer">
            <LocalStatus online={online} />
            <Button className="collapse-control" variant="ghost" aria-controls="desktop-sidebar" aria-expanded={!collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleSidebar}>
              <SidebarSimpleIcon size={18} aria-hidden="true" />
              <span className="collapse-copy">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
            </Button>
          </div>
        </aside>
        <div className="app-body">
          <header className="topbar">
            <div className="header-location">
              <div className="mobile-navigation">
                <Sheet>
                  <SheetTrigger asChild><Button size="icon" variant="ghost" aria-label="Open navigation"><ListIcon size={20} /></Button></SheetTrigger>
                  <SheetContent><Navigation mobile /><LocalStatus online={online} /></SheetContent>
                </Sheet>
              </div>
              <p className="breadcrumb caption-1"><span>{group?.title ?? "Workspace"}</span><span aria-hidden="true">/</span><strong>{label}</strong></p>
              <Link className="mobile-brand title-3" href="/">ClipFlow</Link>
            </div>
            <ThemeSwitcher />
          </header>
          <main id="main-content" tabIndex={-1} className="main-content">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  );
}
