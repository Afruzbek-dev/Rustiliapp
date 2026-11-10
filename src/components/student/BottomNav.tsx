"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Home, Map, Mic, Trophy } from "lucide-react";
import { cn } from "@/components/ui/cn";

export interface BottomNavProps {
  /** Target of the "Gapirish" tab: latest open speaking exercise, else /path. */
  speakHref?: string;
}

export function BottomNav({ speakHref = "/path" }: BottomNavProps) {
  const pathname = usePathname() ?? "";
  const items = [
    { label: "Asosiy", href: "/home", match: "/home", Icon: Home },
    { label: "Yo'l", href: "/path", match: "/path", Icon: Map },
    { label: "So'zlar", href: "/words", match: "/words", Icon: BookOpen },
    { label: "Reyting", href: "/rating", match: "/rating", Icon: Trophy },
    { label: "Gapirish", href: speakHref, match: "/speak", Icon: Mic },
  ];
  const isActive = (match: string) => pathname === match || pathname.startsWith(`${match}/`);

  return (
    <nav
      aria-label="Asosiy navigatsiya"
      className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between gap-1 px-2 py-1">
        {items.map(({ label, href, match, Icon }) => {
          const active = isActive(match);
          return (
            <li key={label} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-2 text-xs font-bold",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
                  active ? "bg-brand text-ink" : "text-ink-2",
                )}
              >
                <Icon aria-hidden="true" className="size-6" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
