"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  BookOpen,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  Menu,
  Settings,
  Trophy,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Avatar } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export type SidebarRole = "teacher" | "admin" | "curator";

export interface NavItem {
  label: string;
  href: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Only the exact path is active (the dashboard root would otherwise match every sub-page). */
  exact?: boolean;
  badge?: boolean;
}

const QUEUE: NavItem = { label: "Tekshirish navbati", href: "/curator", Icon: ClipboardCheck, badge: true };

export function navItemsFor(role: SidebarRole): NavItem[] {
  if (role === "curator") return [QUEUE];
  return [
    { label: "Bosh panel", href: "/teacher", Icon: LayoutDashboard, exact: true },
    { label: "Kurslar va darslar", href: "/teacher/lessons", Icon: BookOpen },
    { label: "O'quvchilar", href: "/teacher/students", Icon: Users },
    { label: "Guruhlar", href: "/teacher/cohorts", Icon: GraduationCap },
    QUEUE,
    { label: "Kuratorlar", href: "/teacher/curators", Icon: UserCheck },
    { label: "Testlar", href: "/teacher/tests", Icon: FileCheck2 },
    { label: "Reyting", href: "/teacher/rating", Icon: Trophy },
    { label: "Sozlamalar", href: "/teacher/settings", Icon: Settings },
  ];
}

export interface SidebarProps {
  role: SidebarRole;
  name: string;
  /** Finished submissions waiting for review; null hides the badge. */
  pending?: number | null;
}

const ROLE_LABEL: Record<SidebarRole, string> = {
  teacher: "Ustoz",
  admin: "Administrator",
  curator: "Kurator",
};

export function Sidebar({ role, name, pending = null }: SidebarProps) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const items = navItemsFor(role);
  const isActive = (i: NavItem) =>
    i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`);

  return (
    <aside className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 bg-ink p-3 text-card sm:gap-4 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="px-2 text-lg font-extrabold text-brand">По-русски</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="staff-menu"
          aria-label={open ? "Menyuni yopish" : "Menyuni ochish"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:hidden"
        >
          {open ? <X aria-hidden="true" className="size-6" /> : <Menu aria-hidden="true" className="size-6" />}
        </button>
      </div>

      <div id="staff-menu" className={cn("flex-col gap-4", open ? "flex" : "hidden sm:flex")}>
        <nav aria-label="Ustoz paneli">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const active = isActive(item);
              const showBadge = item.badge && pending !== null && pending > 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-base font-bold",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      active ? "bg-brand text-ink" : "text-card hover:bg-ink-2",
                    )}
                  >
                    <item.Icon aria-hidden="true" className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {showBadge && (
                      <span className="rounded-full bg-fire-bg px-2 py-0.5 text-sm font-extrabold text-fire-text">
                        {pending}
                        <span className="sr-only"> ta kutmoqda</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto flex flex-col gap-3 rounded-[var(--radius-md)] border-2 border-ink-2 p-3">
          <div className="flex items-center gap-3">
            <Avatar name={name} />
            <div className="min-w-0">
              <p className="truncate font-extrabold text-card">{name}</p>
              <p className="text-sm text-border">{ROLE_LABEL[role]}</p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
