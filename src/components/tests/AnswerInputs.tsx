"use client";

import { cn } from "@/components/ui/cn";
import { PRONOUNS } from "@/lib/exercises/types";
import type { ChoosePayload, ClassifyPayload, ConjugatePayload, FillBlankPayload, MatchPayload } from "@/lib/exercises/types";
import type { GradableType, TestAnswer } from "@/lib/tests/grade";

/**
 * Answer controls of a test question. They only COLLECT answers: no checking, no feedback, no keys
 * (the client never has them). The value has the exact shape the server validates (testAnswerSchemas).
 */
export interface AnswerInputsProps {
  type: GradableType;
  payload: unknown;
  value: TestAnswer | undefined;
  onChange: (next: TestAnswer) => void;
}

const optionClass = (selected: boolean) =>
  cn(
    "min-h-11 min-w-11 rounded-[var(--radius-md)] border-2 px-4 py-2 text-left font-bold text-ink",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
    selected ? "border-ink bg-brand" : "border-border-strong bg-card",
  );

const inputClass =
  "min-h-11 w-full rounded-[var(--radius-md)] border-2 border-border-strong bg-card px-3 py-2 text-base text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong";

const answersOf = (v: TestAnswer | undefined): Record<string, string | number> => (v && "answers" in v ? v.answers : {});

export function isAnswered(v: TestAnswer | undefined): boolean {
  if (!v) return false;
  if ("answers" in v) return Object.values(v.answers).some((x) => x !== "");
  if ("forms" in v) return v.forms.some((f) => f.trim() !== "");
  return v.pairs.length > 0;
}

export function AnswerInputs({ type, payload, value, onChange }: AnswerInputsProps) {
  switch (type) {
    case "classify": {
      const p = payload as ClassifyPayload;
      const given = answersOf(value);
      return (
        <div className="flex flex-col gap-5">
          {p.items.map((it) => (
            <fieldset key={it.id} className="flex flex-col gap-2">
              <legend lang="ru" className="mb-1 text-xl font-extrabold">
                {it.text}
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {p.buckets.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={given[it.id] === b.id}
                    className={optionClass(given[it.id] === b.id)}
                    onClick={() => onChange({ answers: { ...given, [it.id]: b.id } })}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      );
    }
    case "fill_blank": {
      const p = payload as FillBlankPayload;
      const given = answersOf(value);
      return (
        <div className="flex flex-col gap-4">
          {p.items.map((it) => (
            <label key={it.id} className="flex flex-col gap-1">
              <span lang="ru" className="text-lg font-bold">
                {it.before} <span aria-hidden="true">___</span> {it.after}
              </span>
              {it.hint && <span className="text-sm text-ink-2">{it.hint}</span>}
              <input
                type="text"
                lang="ru"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                className={inputClass}
                aria-label={`Bo'sh joy: ${it.before} ... ${it.after}`}
                value={typeof given[it.id] === "string" ? (given[it.id] as string) : ""}
                onChange={(e) => onChange({ answers: { ...given, [it.id]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      );
    }
    case "choose": {
      const p = payload as ChoosePayload;
      const given = answersOf(value);
      return (
        <div className="flex flex-col gap-5">
          {p.items.map((it) => (
            <fieldset key={it.id} className="flex flex-col gap-2">
              <legend lang="ru" className="mb-1 text-xl font-extrabold">
                {it.text}
              </legend>
              <div className="grid grid-cols-1 gap-2">
                {it.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    lang="ru"
                    aria-pressed={given[it.id] === i}
                    className={optionClass(given[it.id] === i)}
                    onClick={() => onChange({ answers: { ...given, [it.id]: i } })}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      );
    }
    case "conjugate": {
      const p = payload as ConjugatePayload;
      const forms = value && "forms" in value ? value.forms : [];
      return (
        <div className="flex flex-col gap-3">
          <p lang="ru" className="text-2xl font-extrabold">
            {p.verb}
          </p>
          {PRONOUNS.map((pronoun, i) => (
            <label key={pronoun} className="flex items-center gap-3">
              <span lang="ru" className="w-20 shrink-0 text-lg font-bold">
                {pronoun}
              </span>
              <input
                type="text"
                lang="ru"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                className={inputClass}
                aria-label={`${pronoun} ${p.verb}`}
                value={forms[i] ?? ""}
                onChange={(e) => {
                  const next = PRONOUNS.map((_, j) => forms[j] ?? "");
                  next[i] = e.target.value;
                  onChange({ forms: next });
                }}
              />
            </label>
          ))}
        </div>
      );
    }
    default: {
      const p = payload as MatchPayload;
      const pairs = value && "pairs" in value ? value.pairs : [];
      const pick = (left: string) => pairs.find(([l]) => l === left)?.[1] ?? "";
      return (
        <div className="flex flex-col gap-4">
          {p.left.map((l) => (
            <label key={l.id} className="flex flex-col gap-1">
              <span lang="ru" className="text-lg font-bold">
                {l.text}
              </span>
              <select
                className={inputClass}
                value={pick(l.id)}
                onChange={(e) => {
                  const rest = pairs.filter(([x]) => x !== l.id);
                  onChange({ pairs: e.target.value ? [...rest, [l.id, e.target.value]] : rest });
                }}
              >
                <option value="">Tanlang</option>
                {p.right.map((r) => (
                  <option key={r.id} value={r.id} lang="ru">
                    {r.text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }
  }
}
