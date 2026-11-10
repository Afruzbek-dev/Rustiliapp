"use client";

import { useId, useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { PRONOUNS, type ConjugatePayload } from "@/lib/exercises/types";
import { FeedbackSheet } from "./FeedbackSheet";
import type { ExerciseProps } from "./styles";
import { useAttempt } from "./useAttempt";
import { WordCard } from "./WordCard";

export function Conjugate({ exerciseId, payload, onDone }: ExerciseProps<ConjugatePayload>) {
  const pronouns = payload.pronouns.length > 0 ? payload.pronouns : [...PRONOUNS];
  const [forms, setForms] = useState<string[]>(() => pronouns.map(() => ""));
  const attempt = useAttempt(exerciseId);
  const baseId = useId();

  const loading = attempt.status === "loading";
  const answered = attempt.status === "done" && attempt.result !== null;
  const perItem = attempt.result?.perItem;
  const expected = attempt.result?.expected;
  const expectedText = Array.isArray(expected) ? expected.join(", ") : undefined;
  const complete = forms.every((f) => f.trim() !== "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || answered || !complete) return;
    void attempt.submit({ forms });
  }

  function setForm(i: number, v: string) {
    setForms((prev) => prev.map((p, j) => (j === i ? v : p)));
  }

  return (
    <div className="flex flex-col gap-4 pb-56">
      <WordCard text={payload.verb} />
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {pronouns.map((p, i) => {
          const id = `${baseId}-${i}`;
          const mark = answered && perItem ? perItem[i] : undefined;
          const border =
            mark === undefined
              ? "border-border-strong bg-card"
              : mark
                ? "border-ok bg-ok-bg"
                : "border-fire bg-fire-bg";
          return (
            <div key={p} className="flex items-center gap-3">
              <label htmlFor={id} lang="ru" className="w-20 shrink-0 text-lg font-extrabold text-ink">
                {p}
              </label>
              <input
                id={id}
                type="text"
                lang="ru"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={forms[i] ?? ""}
                readOnly={answered}
                aria-invalid={mark === false ? true : undefined}
                onChange={(e) => setForm(i, e.target.value)}
                className={`h-12 min-w-0 flex-1 rounded-[var(--radius-sm)] border-2 px-3 text-lg font-bold text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong ${border}`}
              />
              {mark !== undefined && (
                <span
                  className={`inline-flex size-6 shrink-0 ${mark ? "text-ok-text" : "text-fire-text"}`}
                >
                  {mark ? (
                    <Check className="size-6" aria-hidden="true" />
                  ) : (
                    <X className="size-6" aria-hidden="true" />
                  )}
                  <span className="sr-only">{mark ? "To'g'ri" : "Noto'g'ri"}</span>
                </span>
              )}
            </div>
          );
        })}
        {!answered && (
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={!complete}>
            Tekshirish
          </Button>
        )}
      </form>
      <FeedbackSheet
        status={attempt.status}
        result={attempt.result}
        error={attempt.error}
        expectedText={expectedText}
        onContinue={() => {
          attempt.reset();
          onDone?.();
        }}
        onRetry={() => void attempt.retry()}
      />
    </div>
  );
}
