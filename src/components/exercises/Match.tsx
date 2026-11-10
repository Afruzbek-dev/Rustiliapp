"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import type { MatchPayload } from "@/lib/exercises/types";
import { FeedbackSheet } from "./FeedbackSheet";
import type { ExerciseProps } from "./styles";
import { useAttempt } from "./useAttempt";

type Side = "left" | "right";

function expectedMap(v: unknown): Record<string, string> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, string>) : null;
}

export function Match({ exerciseId, payload, onDone, onExit }: ExerciseProps<MatchPayload>) {
  const [selected, setSelected] = useState<string | null>(null);
  // leftId -> rightId, in the order the pairs were made
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const attempt = useAttempt(exerciseId);

  const loading = attempt.status === "loading";
  const answered = attempt.status === "done" && attempt.result !== null;
  const locked = loading || answered;
  const expected = expectedMap(attempt.result?.expected);

  const pairNo = (side: Side, id: string): number => {
    const i = pairs.findIndex((p) => p[side === "left" ? 0 : 1] === id);
    return i + 1;
  };

  function verdict(leftId: string, rightId: string): boolean | undefined {
    if (!answered) return undefined;
    if (expected) return expected[leftId] === rightId;
    return attempt.result?.correct === true ? true : undefined;
  }

  function tapLeft(id: string) {
    if (locked) return;
    if (pairNo("left", id) > 0) {
      setPairs((p) => p.filter(([l]) => l !== id));
      setSelected(id);
      return;
    }
    setSelected((s) => (s === id ? null : id));
  }

  function tapRight(id: string) {
    if (locked || selected === null) return;
    const next: [string, string][] = [...pairs.filter(([, r]) => r !== id), [selected, id]];
    setPairs(next);
    setSelected(null);
    if (next.length === payload.left.length) void attempt.submit({ pairs: next });
  }

  function cont() {
    attempt.reset();
    if (attempt.result?.correct) onDone?.();
    else {
      setPairs([]);
      setSelected(null);
    }
  }

  function cellClass(side: Side, id: string): string {
    const n = pairNo(side, id);
    let tone = "bg-card border-border-strong";
    if (n > 0) {
      const [l, r] = pairs[n - 1];
      const v = verdict(l, r);
      tone =
        v === undefined
          ? "bg-surface-2 border-ink"
          : v
            ? "bg-ok-bg border-ok text-ok-text"
            : "bg-fire-bg border-fire text-fire-text";
    } else if (side === "left" && selected === id) {
      tone = "bg-info-bg border-info-strong text-info-strong";
    }
    return `flex min-h-14 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border-2 px-3 py-2 text-left text-lg font-bold text-ink transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:pointer-events-none ${tone}`;
  }

  function badge(side: Side, id: string) {
    const n = pairNo(side, id);
    if (n === 0) return null;
    const [l, r] = pairs[n - 1];
    const v = verdict(l, r);
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-extrabold">
        <span aria-hidden="true">{n}</span>
        {v === true && <Check className="size-4" aria-hidden="true" />}
        {v === false && <X className="size-4" aria-hidden="true" />}
        <span className="sr-only">
          {`juftlik ${n}`}
          {v === true ? ", to'g'ri" : v === false ? ", noto'g'ri" : ""}
        </span>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-56">
      <p className="text-sm font-bold text-ink-2">
        Avval chapdan, keyin o&apos;ngdan tanlang: {pairs.length} / {payload.left.length}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <ul aria-label="Chap ustun" className="flex flex-col gap-3">
          {payload.left.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                lang="ru"
                className={cellClass("left", it.id)}
                disabled={locked}
                aria-pressed={selected === it.id || pairNo("left", it.id) > 0}
                onClick={() => tapLeft(it.id)}
              >
                <span>{it.text}</span>
                {badge("left", it.id)}
              </button>
            </li>
          ))}
        </ul>
        <ul aria-label="O'ng ustun" className="flex flex-col gap-3">
          {payload.right.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                lang="ru"
                className={cellClass("right", it.id)}
                disabled={locked || (selected === null && pairNo("right", it.id) === 0)}
                aria-pressed={pairNo("right", it.id) > 0}
                onClick={() => tapRight(it.id)}
              >
                <span>{it.text}</span>
                {badge("right", it.id)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <FeedbackSheet
        onExit={onExit}
        status={attempt.status}
        result={attempt.result}
        error={attempt.error}
        expectedText={
          expected
            ? payload.left
                .map((l) => {
                  const r = payload.right.find((x) => x.id === expected[l.id]);
                  return r ? `${l.text} - ${r.text}` : null;
                })
                .filter(Boolean)
                .join(", ")
            : undefined
        }
        onContinue={cont}
        onRetry={() => void attempt.retry()}
      />
    </div>
  );
}
