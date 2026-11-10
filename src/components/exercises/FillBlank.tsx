"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, ProgressBar } from "@/components/ui";
import type { FillBlankPayload } from "@/lib/exercises/types";
import { FeedbackSheet } from "./FeedbackSheet";
import type { ExerciseProps } from "./styles";
import { useAttempt } from "./useAttempt";

export function FillBlank({ exerciseId, payload, onDone, onExit }: ExerciseProps<FillBlankPayload>) {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const attempt = useAttempt(exerciseId);
  const inputId = useId();
  const item = payload.items[index];
  if (!item) return null;

  const loading = attempt.status === "loading";
  const answered = attempt.status === "done" && attempt.result !== null;
  const ok = answered && attempt.result?.correct === true;
  const expected = attempt.result?.expected;
  const expectedText = Array.isArray(expected) ? expected.join(" / ") : undefined;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || answered || value.trim() === "") return;
    void attempt.submit({ itemId: item.id, value });
  }

  function next() {
    attempt.reset();
    setValue("");
    if (index + 1 >= payload.items.length) onDone?.();
    else setIndex(index + 1);
  }

  const border = answered ? (ok ? "border-ok bg-ok-bg" : "border-fire bg-fire-bg") : "border-border-strong bg-card";

  return (
    <div className="flex flex-col gap-4 pb-56">
      <ProgressBar value={index + (answered ? 1 : 0)} max={payload.items.length} label="Mashq jarayoni" />
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-[28px] border-2 border-border bg-card px-4 py-6"
      >
        <label htmlFor={inputId} className="text-sm font-bold text-ink-2">
          Bo&apos;sh joyni to&apos;ldiring
        </label>
        <p lang="ru" className="flex flex-wrap items-center gap-2 text-2xl font-extrabold text-ink">
          <span>{item.before}</span>
          <input
            id={inputId}
            key={item.id}
            type="text"
            lang="ru"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            readOnly={answered}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={answered && !ok ? true : undefined}
            className={`h-12 min-w-32 flex-1 rounded-[var(--radius-sm)] border-2 px-3 text-xl font-bold text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong ${border}`}
          />
          <span>{item.after}</span>
        </p>
        {item.hint && <p className="text-sm text-ink-2">{item.hint}</p>}
        {!answered && (
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={value.trim() === ""}>
            Tekshirish
          </Button>
        )}
      </form>
      <FeedbackSheet
        onExit={onExit}
        status={attempt.status}
        result={attempt.result}
        error={attempt.error}
        expectedText={expectedText}
        hint={item.hint}
        onContinue={next}
        onRetry={() => void attempt.retry()}
      />
    </div>
  );
}
