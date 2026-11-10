"use client";

import { useEffect } from "react";
import { Layers } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { GlossaryWord } from "./TextBlock";

export interface WordsBlockProps {
  words: GlossaryWord[];
  lessonId: string;
  onDone: () => void;
}

/** The lesson's words (ru / uz) and a link to the flashcards. Informational: done on arrival. */
export function WordsBlock({ words, lessonId, onDone }: WordsBlockProps) {
  useEffect(() => {
    onDone();
  }, [onDone]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold">Dars so&apos;zlari</h2>
      {words.length === 0 ? (
        <Card tone="muted">
          <p className="text-ink-2">Bu darsda so&apos;zlar yo&apos;q.</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {words.map((w) => (
            <li key={w.id} className="flex items-baseline justify-between gap-3 rounded-[var(--radius-md)] border-2 border-border bg-card px-4 py-3">
              <span lang="ru" className="text-lg font-extrabold">
                {w.stress ?? w.ru}
              </span>
              <span className="text-right text-ink-2">{w.uz}</span>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" href={`/words?lesson=${encodeURIComponent(lessonId)}`}>
        <Layers className="size-5" aria-hidden="true" />
        So&apos;zlarni takrorlash
      </Button>
    </section>
  );
}
