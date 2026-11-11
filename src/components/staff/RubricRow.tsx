"use client";

import { useRef } from "react";

export interface RubricRowProps {
  label: string;
  value: number | null;
  disabled?: boolean;
  onChange: (score: number) => void;
  onFocusRow: () => void;
  /** data attribute so the card can find the row's buttons for keyboard handling */
  rowIndex: number;
}

const SCORES = [1, 2, 3, 4, 5] as const;

/**
 * One criterion with five real buttons (aria-label "Talaffuz: 4"). Roving tabindex: Tab moves to the
 * next criterion, Left/Right move between the five buttons without changing the score.
 */
export function RubricRow({ label, value, disabled, onChange, onFocusRow, rowIndex }: RubricRowProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabStop = value ?? 1;

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, score: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.min(5, Math.max(1, score + (e.key === "ArrowRight" ? 1 : -1)));
    refs.current[next - 1]?.focus();
  }

  return (
    <div role="group" aria-label={label} data-rubric-row={rowIndex} className="flex flex-col gap-2" onFocus={onFocusRow}>
      <p className="text-sm font-bold text-ink-2" aria-hidden="true">
        {label}
      </p>
      <div className="grid grid-cols-5 gap-2">
        {SCORES.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[n - 1] = el;
              }}
              type="button"
              data-score={n}
              aria-label={`${label}: ${n}`}
              aria-pressed={selected}
              disabled={disabled}
              tabIndex={n === tabStop ? 0 : -1}
              onClick={() => onChange(n)}
              onKeyDown={(e) => onKeyDown(e, n)}
              className={`min-h-10 min-w-10 rounded-[var(--radius-sm)] border-2 text-base font-extrabold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:opacity-60 ${
                selected ? "border-brand-shadow bg-brand text-ink" : "border-border-strong bg-card text-ink"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
