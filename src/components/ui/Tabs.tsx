"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}

export function Tabs({ tabs, value, onChange, label }: TabsProps) {
  const uid = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 rounded-[var(--radius-md)] bg-surface-2 p-1"
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            id={`${uid}-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-11 flex-1 rounded-[var(--radius-sm)] px-3 text-sm font-bold",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
              selected ? "bg-card text-ink" : "text-ink-2",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
