"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { Check, Lock, Play, Star, Trophy } from "lucide-react";
import type { PartStatus } from "@/lib/path-status";

export interface DayIndicator {
  label: string;
  status: PartStatus;
}

export interface PathNodeProps {
  kind?: "lesson" | "test";
  title: string;
  subtitle?: string;
  status: PartStatus;
  /** Where available/in_progress nodes lead. */
  href?: string;
  /** Horizontal zigzag offset, px. */
  offset?: number;
  days?: DayIndicator[];
  /** Day number shown in the "Davom etish" label of the current node. */
  currentDay?: number;
  /** Shown inline when a locked node is tapped. */
  lockedMessage?: string;
}

const stateLabel: Record<PartStatus, string> = {
  completed: "tugallangan",
  in_progress: "davom etmoqda",
  available: "ochiq",
  locked: "qulflangan",
};

const dayBar: Record<PartStatus, string> = {
  completed: "bg-ok",
  in_progress: "bg-brand",
  available: "bg-ink",
  locked: "bg-border-strong",
};

export function PathNode({
  kind = "lesson",
  title,
  subtitle,
  status,
  href,
  offset = 0,
  days,
  currentDay,
  lockedMessage = "Avval oldingi darsni tugating",
}: PathNodeProps) {
  const [hint, setHint] = useState(false);
  const locked = status === "locked" || !href;
  const current = !locked && (status === "in_progress" || (kind === "lesson" && status === "available"));
  const Icon =
    kind === "test" && status !== "completed"
      ? Trophy
      : status === "completed"
        ? Check
        : current
          ? Play
          : status === "available"
            ? Star
            : Lock;

  const tile = locked
    ? "bg-surface-2 text-ink-3 border-2 border-border"
    : status === "completed"
      ? "bg-ok text-ink shadow-[0_5px_0_var(--ok-shadow)]"
      : current
        ? "bg-brand text-ink shadow-[0_5px_0_var(--brand-shadow)]"
        : "bg-card text-ink border-2 border-ink shadow-[0_5px_0_var(--ink)]";
  const size = current ? "size-24" : "size-[4.5rem]";
  const day = currentDay ?? 1;
  const dayStates = days && days.length > 0 ? days.map((d) => `${d.label}: ${stateLabel[d.status]}`).join(", ") : null;
  const name = [
    [title, subtitle, stateLabel[status], current ? `${day}-kun` : null].filter(Boolean).join(", "),
    dayStates,
  ]
    .filter(Boolean)
    .join("; ");
  const tileClass = `relative flex ${size} shrink-0 items-center justify-center rounded-full transition-transform duration-150 motion-reduce:transition-none ${tile} ${
    locked ? "" : "active:translate-y-[3px] motion-reduce:active:translate-y-0"
  }`;
  const icon = <Icon aria-hidden="true" className={current ? "size-9" : "size-7"} />;
  const style: CSSProperties = { transform: `translateX(${offset}px)` };

  return (
    <div className="flex flex-col items-center gap-1" style={style}>
      {current && (
        <span className="rounded-full bg-ink px-3 py-1 text-sm font-extrabold text-white">
          Davom etish · {day}-kun
        </span>
      )}
      {locked || !href ? (
        <button
          type="button"
          aria-disabled="true"
          aria-label={name}
          onClick={() => setHint(true)}
          className={tileClass}
        >
          {icon}
        </button>
      ) : (
        <Link href={href} aria-label={name} className={tileClass}>
          {icon}
        </Link>
      )}
      {days && days.length > 0 && (
        <span aria-hidden="true" className="flex gap-1">
          {days.map((d) => (
            <span key={d.label} title={d.label} className={`h-1.5 w-8 rounded-full ${dayBar[d.status]}`} />
          ))}
        </span>
      )}
      <span className="max-w-40 text-center">
        <span className="block text-base font-extrabold">{title}</span>
        {subtitle && <span className="block text-sm text-ink-2">{subtitle}</span>}
      </span>
      {locked && hint && (
        <span
          role="status"
          className="rounded-[var(--radius-sm)] bg-ink px-3 py-1.5 text-sm font-bold text-white"
        >
          {lockedMessage}
        </span>
      )}
    </div>
  );
}
