"use client";

import { Flame } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MILESTONES = [7, 14, 30];

export interface StreakCelebrationProps {
  /** Current streak; nothing renders unless it is exactly 7, 14 or 30. */
  streak: number;
  /** Tashkent day (YYYY-MM-DD), part of the once-only key. */
  day: string;
}

/** Deliberately dark celebration screen (artboard 'Streak'), shown once per milestone and day. */
export function StreakCelebration({ streak, day }: StreakCelebrationProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const milestone = MILESTONES.includes(streak);

  useEffect(() => {
    if (!milestone) return;
    const key = `streak-celebrated-${streak}-${day}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: still celebrate (once per mount).
    }
    setOpen(true);
  }, [milestone, streak, day]);

  useEffect(() => {
    if (open) btn.current?.focus();
  }, [open]);

  if (!milestone || !open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="streak-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink p-6 text-center text-white"
    >
      <span className="motion-safe:animate-bounce inline-flex size-32 items-center justify-center rounded-full bg-brand text-ink">
        <Flame aria-hidden="true" className="size-16" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-6xl font-extrabold text-brand">{streak}</p>
        <h2 id="streak-title" className="text-2xl font-extrabold">
          {streak} kunlik streak!
        </h2>
        <p className="text-base text-white/80">Ketma-ket {streak} kun shug&apos;ullandingiz. Davom eting!</p>
      </div>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen(false)}
        className="h-14 min-w-48 rounded-[var(--radius-md)] bg-brand px-6 text-lg font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Davom etish
      </button>
    </div>
  );
}
