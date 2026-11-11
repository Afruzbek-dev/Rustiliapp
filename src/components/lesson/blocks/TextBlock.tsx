"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { normalizeWord, splitToken } from "@/lib/blocks/normalize";
import type { TextPayload } from "@/lib/blocks/types";

export interface GlossaryWord {
  id: string;
  ru: string;
  stress: string | null;
  uz: string;
}

export interface TextBlockProps {
  payload: TextPayload;
  words: GlossaryWord[];
  onDone: () => void;
  done?: boolean;
}

/**
 * Words that have a translation (a glossary entry whose wordId is among the lesson's words, or a
 * lesson word whose `ru` equals the token) render as buttons; others stay plain text, so keyboard
 * users never tab through dead words. Only single-token entries match.
 */
export function buildLookup(payload: TextPayload, words: GlossaryWord[]): Map<string, GlossaryWord> {
  const byId = new Map(words.map((w) => [w.id, w]));
  const map = new Map<string, GlossaryWord>();
  for (const w of words) {
    const key = normalizeWord(w.ru);
    if (key && !/\s/.test(w.ru.trim())) map.set(key, w);
  }
  // Glossary entries win: they map an inflected surface form ("книги") to its lesson word.
  for (const g of payload.glossary ?? []) {
    const w = byId.get(g.wordId);
    const key = normalizeWord(g.surface);
    if (w && key && !/\s/.test(g.surface.trim())) map.set(key, w);
  }
  return map;
}

export function TextBlock({ payload, words, onDone, done = false }: TextBlockProps) {
  const lookup = useMemo(() => buildLookup(payload, words), [payload, words]);
  const paragraphs = useMemo(() => payload.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), [payload.body]);
  const [open, setOpen] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const endRef = useRef<HTMLDivElement>(null);

  // "Scrolled to the end" counts as read. Without IntersectionObserver the button is the way.
  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        onDone();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [onDone]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const key = open;
        setOpen(null);
        buttons.current.get(key)?.focus();
      }
    };
    const onPointer = (e: Event) => {
      const root = (e.target as Element | null)?.closest?.("[data-word-root]");
      if (root?.getAttribute("data-word-root") !== open) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <article className="flex flex-col gap-4">
      {payload.title && <h2 className="text-2xl font-extrabold">{payload.title}</h2>}
      <div lang="ru" className="flex flex-col gap-4 text-lg leading-relaxed text-ink">
        {paragraphs.map((para, pi) => (
          <p key={pi} className="whitespace-pre-line">
            {para.split(/(\s+)/).map((tok, ti) => {
              if (/^\s*$/.test(tok)) return tok;
              const { lead, core, trail } = splitToken(tok);
              const word = core ? lookup.get(normalizeWord(core)) : undefined;
              if (!word) return tok;
              const key = `${pi}:${ti}`;
              const isOpen = open === key;
              return (
                <span key={key}>
                  {lead}
                  <span data-word-root={key} className="relative inline-block">
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttons.current.set(key, el);
                        else buttons.current.delete(key);
                      }}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                      className="relative min-h-6 rounded-sm after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] border-b-2 border-dashed border-info-strong px-0.5 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
                    >
                      {core}
                    </button>
                    {isOpen && <WordPopover word={word} />}
                  </span>
                  {trail}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      <div ref={endRef} aria-hidden="true" className="h-px" />
      {!done && (
        <Button variant="secondary" onClick={onDone}>
          O&apos;qidim
        </Button>
      )}
    </article>
  );
}

/** Translation bubble under the word; shifted left when it would overflow the viewport's right edge. */
function WordPopover({ word }: { word: GlossaryWord }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const over = el.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) el.style.transform = `translateX(-${Math.ceil(over)}px)`;
  }, []);
  return (
    <span
      ref={ref}
      role="dialog"
      aria-label="Tarjima"
      className="absolute top-full left-0 z-10 mt-1 block w-max max-w-[min(16rem,75vw)] rounded-[var(--radius-sm)] border-2 border-border-strong bg-card p-3 text-left text-base shadow-[0_4px_0_var(--border-strong)]"
    >
      <span lang="ru" className="block font-extrabold text-ink">
        {word.stress ?? word.ru}
      </span>
      <span lang="uz" className="block text-ink-2">
        {word.uz}
      </span>
    </span>
  );
}
