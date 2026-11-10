"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Check, Mic } from "lucide-react";
import { Button } from "@/components/ui";

export interface SpeakingBlockProps {
  exercise: { id: string; prompt: string | null } | undefined;
  /** The student already has a (completed) submission for this exercise. */
  submitted: boolean;
  onDone: () => void;
  done?: boolean;
}

/** A card linking to /speak/<exerciseId>. With a submission the block is done; without, it can be skipped. */
export function SpeakingBlock({ exercise, submitted, onDone, done = false }: SpeakingBlockProps) {
  useEffect(() => {
    if (!exercise || submitted) onDone();
  }, [exercise, submitted, onDone]);

  if (!exercise) {
    return (
      <p role="status" className="rounded-[var(--radius-lg)] border-2 border-border bg-surface-2 p-4 text-ink-2">
        Topshiriq topilmadi.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold">Gapirish topshirig&apos;i</h2>
      {exercise.prompt && (
        <p lang="ru" className="rounded-[var(--radius-lg)] border-2 border-border bg-card p-4 text-lg leading-relaxed">
          {exercise.prompt}
        </p>
      )}
      {submitted ? (
        <p role="status" className="flex items-center gap-2 font-bold text-ok-text">
          <Check className="size-5" aria-hidden="true" />
          Javobingiz yuborilgan
        </p>
      ) : (
        <p className="text-ink-2">Ovoz yozing va yuboring. Qaytganingizdan keyin davom etasiz.</p>
      )}
      <Link
        href={`/speak/${exercise.id}`}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand px-5 font-bold text-ink shadow-[0_5px_0_var(--brand-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
      >
        <Mic className="size-5" aria-hidden="true" />
        {submitted ? "Qayta yozish" : "Gapirishni boshlash"}
      </Link>
      {!submitted && !done && (
        <Button variant="secondary" onClick={onDone}>
          Keyinroq bajaraman (o&apos;tkazib yuborish)
        </Button>
      )}
    </section>
  );
}
