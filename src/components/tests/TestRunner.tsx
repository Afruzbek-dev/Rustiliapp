"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button, Chip, ProgressBar, Sheet } from "@/components/ui";
import type { TestAnswer, TestSection } from "@/lib/tests/grade";
import { SECTION_LABEL } from "@/lib/tests/grade";
import type { ClientItem } from "@/server/tests";
import { AnswerInputs, isAnswered } from "./AnswerInputs";

export interface TestRunnerActions {
  /** Stores one answer. Resolves false when it could not be saved (offline, expired, ...). */
  save(exerciseId: string, answer: TestAnswer): Promise<boolean>;
  /** Sends the final state and finishes the attempt (idempotent on the server). Resolves false on failure. */
  finish(answers: Record<string, TestAnswer>): Promise<boolean>;
}

export interface TestRunnerProps {
  title: string;
  items: ClientItem[];
  initialAnswers: Record<string, unknown>;
  /** ms left on the server clock when the page was rendered; null = no time limit. */
  remainingMs: number | null;
  actions: TestRunnerActions;
  /** Called after the attempt is finished (the page then shows the result). */
  onFinished: () => void;
}

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const LOW_TIME_MS = 60_000;

export function TestRunner({ title, items, initialAnswers, remainingMs, actions, onFinished }: TestRunnerProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, TestAnswer>>(() => initialAnswers as Record<string, TestAnswer>);
  const [left, setLeft] = useState<number | null>(remainingMs);
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [saveWarning, setSaveWarning] = useState(false);
  const endsAt = useRef<number | null>(remainingMs === null ? null : Date.now() + remainingMs);
  const dirty = useRef<Set<string>>(new Set());
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submitting = useRef(false);

  const item = items[index];

  const flush = useCallback(
    async (exerciseId: string) => {
      if (!dirty.current.has(exerciseId)) return;
      const answer = answersRef.current[exerciseId];
      if (!answer) return;
      dirty.current.delete(exerciseId);
      const ok = await actions.save(exerciseId, answer);
      if (!ok) {
        dirty.current.add(exerciseId);
        setSaveWarning(true);
      } else if (dirty.current.size === 0) setSaveWarning(false);
    },
    [actions],
  );

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    setFinishing(true);
    setFinishError(false);
    const ok = await actions.finish(answersRef.current);
    if (ok) onFinished();
    else {
      submitting.current = false;
      setFinishing(false);
      setFinishError(true);
    }
  }, [actions, onFinished]);

  // Countdown; at zero the attempt is submitted automatically (the server decides what counts).
  useEffect(() => {
    if (endsAt.current === null) return;
    const tick = () => {
      const rest = Math.max(0, (endsAt.current ?? 0) - Date.now());
      setLeft(rest);
      if (rest === 0) void submit();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [submit]);

  if (!item) return null;

  const change = (next: TestAnswer) => {
    dirty.current.add(item.exerciseId);
    setAnswers((a) => ({ ...a, [item.exerciseId]: next }));
  };
  const go = (to: number) => {
    void flush(item.exerciseId);
    setIndex(Math.min(Math.max(to, 0), items.length - 1));
  };
  const unanswered = items.filter((it) => !isAnswered(answers[it.exerciseId])).length;
  const last = index === items.length - 1;
  const lowTime = left !== null && left > 0 && left <= LOW_TIME_MS;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4 pb-32">
      <header className="flex items-center justify-between gap-3">
        <h1 className="truncate text-lg font-extrabold">{title}</h1>
        {left !== null && (
          <span
            role="timer"
            aria-label="Qolgan vaqt"
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-base font-extrabold tabular-nums ${
              lowTime ? "bg-fire-bg text-fire-text" : "bg-surface-2 text-ink"
            }`}
          >
            <Clock className="size-4" aria-hidden="true" />
            {formatClock(left)}
          </span>
        )}
      </header>

      <ProgressBar value={index + 1} max={items.length} label="Test jarayoni" />
      <div className="flex items-center justify-between">
        <span className="font-bold text-ink-2">
          Savol {index + 1} / {items.length}
        </span>
        <Chip tone="info">{SECTION_LABEL[item.section as TestSection]}</Chip>
      </div>

      {lowTime && (
        <p role="alert" className="rounded-[var(--radius-md)] bg-fire-bg p-3 font-bold text-fire-text">
          Vaqt tugayapti. Vaqt tugagach javoblar avtomatik yuboriladi.
        </p>
      )}
      {saveWarning && (
        <p role="status" className="rounded-[var(--radius-md)] bg-surface-2 p-3 text-ink-2">
          Javob saqlanmadi. Internetni tekshiring: yakunlaganingizda barcha javoblar qayta yuboriladi.
        </p>
      )}

      <section aria-label={`Savol ${index + 1}`} className="flex flex-col gap-4">
        {item.prompt && <p className="text-base font-bold text-ink-2">{item.prompt}</p>}
        <AnswerInputs key={item.exerciseId} type={item.type} payload={item.payload} value={answers[item.exerciseId]} onChange={change} />
      </section>

      <nav
        aria-label="Savollar bo'yicha harakat"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-border bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto flex max-w-md gap-3">
          <Button variant="secondary" disabled={index === 0 || finishing} onClick={() => go(index - 1)}>
            <ChevronLeft className="size-5" aria-hidden="true" />
            Oldingi
          </Button>
          {last ? (
            <Button fullWidth disabled={finishing} loading={finishing} onClick={() => setConfirming(true)}>
              Yakunlash
            </Button>
          ) : (
            <Button fullWidth disabled={finishing} onClick={() => go(index + 1)}>
              Keyingi
              <ChevronRight className="size-5" aria-hidden="true" />
            </Button>
          )}
        </div>
        {!last && (
          <div className="mx-auto mt-2 max-w-md text-center">
            <button
              type="button"
              className="min-h-11 px-3 font-bold text-info-strong underline"
              disabled={finishing}
              onClick={() => {
                void flush(item.exerciseId);
                setConfirming(true);
              }}
            >
              Testni yakunlash
            </button>
          </div>
        )}
      </nav>

      <Sheet
        variant="ok"
        open={confirming && !finishing && !finishError}
        title="Testni yakunlaysizmi?"
        actions={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Davom etish
            </Button>
            <Button fullWidth onClick={() => void submit()}>
              Yakunlash
            </Button>
          </div>
        }
      >
        {unanswered > 0 ? `${unanswered} ta savolga javob berilmagan. ` : "Barcha savollarga javob berdingiz. "}
        Yuborgandan keyin javoblarni o&apos;zgartirib bo&apos;lmaydi.
      </Sheet>
      <Sheet
        variant="error"
        open={finishError}
        title="Javoblar yuborilmadi"
        actions={
          <Button fullWidth onClick={() => void submit()}>
            Qayta urinish
          </Button>
        }
      >
        Internetni tekshiring. Javoblaringiz saqlanib turibdi.
      </Sheet>
    </main>
  );
}
