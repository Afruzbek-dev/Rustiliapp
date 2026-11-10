"use client";

import { useState } from "react";
import { ProgressBar } from "@/components/ui";
import type { ClassifyPayload } from "@/lib/exercises/types";
import { FeedbackSheet } from "./FeedbackSheet";
import { optionClass, type ExerciseProps, type OptionState } from "./styles";
import { useAttempt } from "./useAttempt";
import { WordCard } from "./WordCard";

export function Classify({ exerciseId, payload, onDone, onExit }: ExerciseProps<ClassifyPayload>) {
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const attempt = useAttempt(exerciseId);
  const item = payload.items[index];
  if (!item) return null;

  const loading = attempt.status === "loading";
  const answered = attempt.status === "done" && attempt.result !== null;
  const expectedId = typeof attempt.result?.expected === "string" ? attempt.result.expected : null;
  const expectedLabel = payload.buckets.find((b) => b.id === expectedId)?.label;

  function choose(bucketId: string) {
    setPicked(bucketId);
    void attempt.submit({ itemId: item.id, bucketId });
  }

  function next() {
    attempt.reset();
    setPicked(null);
    if (index + 1 >= payload.items.length) onDone?.();
    else setIndex(index + 1);
  }

  function stateOf(bucketId: string): OptionState {
    if (!answered) return "idle";
    if (bucketId === picked) return attempt.result?.correct ? "ok" : "wrong";
    if (!attempt.result?.correct && bucketId === expectedId) return "reveal";
    return "idle";
  }

  return (
    <div className="flex flex-col gap-4 pb-56">
      <ProgressBar value={index + (answered ? 1 : 0)} max={payload.items.length} label="Mashq jarayoni" />
      <WordCard key={item.id} text={item.text} />
      <div role="group" aria-label="Toifalar" className="grid grid-cols-1 gap-3">
        {payload.buckets.map((b) => (
          <button
            key={b.id}
            type="button"
            className={optionClass(stateOf(b.id), true)}
            disabled={loading || answered}
            aria-busy={loading && picked === b.id ? true : undefined}
            aria-pressed={picked === b.id}
            onClick={() => choose(b.id)}
          >
            <span className="block text-xl font-extrabold">{b.label}</span>
            {b.hint && <span className="mt-1 block text-sm font-semibold text-ink-2">{b.hint}</span>}
          </button>
        ))}
      </div>
      <FeedbackSheet
        onExit={onExit}
        status={attempt.status}
        result={attempt.result}
        error={attempt.error}
        expectedText={expectedLabel}
        onContinue={next}
        onRetry={() => void attempt.retry()}
      />
    </div>
  );
}
