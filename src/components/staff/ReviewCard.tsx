"use client";

import { Clock, Eye, EyeOff, SkipForward } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, Card } from "@/components/ui";
import {
  averageOf,
  CRITERIA,
  CRITERION_LABELS,
  timeAgo,
  type Criterion,
  type QueueItem,
  type Scores,
} from "@/lib/curator-types";
import { MediaPlayer } from "./MediaPlayer";
import { RubricRow } from "./RubricRow";

export const MAX_COMMENT = 1000;

/** pending: first review; override: staff re-scoring a reviewed item; readonly: shown only */
export type ReviewMode = "pending" | "override" | "readonly";

export interface ReviewCardProps {
  item: QueueItem;
  nowIso: string;
  mode: ReviewMode;
  busy: boolean;
  /** move focus to the heading on mount (after advancing to the next item) */
  focusOnMount: boolean;
  canSkip: boolean;
  onSubmit: (scores: Scores, comment: string) => void;
  onSkip: () => void;
}

type Draft = Partial<Record<Criterion, number>>;

const fmt = (n: number) => n.toFixed(1);

/** The current submission: player, optional prompt, rubric, comment and the two actions. Remount per item (key). */
export function ReviewCard({ item, nowIso, mode, busy, focusOnMount, canSkip, onSubmit, onSkip }: ReviewCardProps) {
  const initial: Draft = mode === "override" && item.review ? { ...item.review.scores } : {};
  const [draft, setDraft] = useState<Draft>(initial);
  const [comment, setComment] = useState(mode === "override" ? (item.review?.comment ?? "") : "");
  const [row, setRow] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const promptId = useId();

  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);

  // A control that had focus may be disabled while the request runs; once it ends, never leave focus on <body>.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const active = document.activeElement;
      if (!active || active === document.body) heading.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  const complete = CRITERIA.every((c) => draft[c] !== undefined);
  const avg = complete ? averageOf(draft as Scores) : null;
  const locked = busy || mode === "readonly";

  function submit() {
    if (!complete || locked) return;
    onSubmit(draft as Scores, comment.trim());
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || mode === "readonly") return;
    const target = e.target as HTMLElement;
    if (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName)) return;
    if (/^[1-5]$/.test(e.key)) {
      e.preventDefault();
      if (!busy) {
        setDraft((d) => ({ ...d, [CRITERIA[row]!]: Number(e.key) }));
        // the roving tab stop follows the score: keep focus on it so Tab moves to the NEXT criterion
        root.current?.querySelector<HTMLElement>(`[data-rubric-row="${row}"] [data-score="${e.key}"]`)?.focus();
      }
      return;
    }
    // Enter on a score button / the heading submits a finished form; otherwise it keeps its native meaning.
    if (e.key === "Enter" && complete && (target.closest("[data-rubric-row]") || target === heading.current)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold focus:outline-none focus-visible:outline-2 focus-visible:outline-info-strong">
              {item.studentName}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
              {item.lessonTitle && <span>{item.lessonTitle}</span>}
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="size-4" />
                {timeAgo(item.createdAt, nowIso)}
              </span>
              <span>{item.kind === "audio" ? "Audio" : "Video"}</span>
            </p>
          </div>

          <MediaPlayer submissionId={item.id} kind={item.kind} />

          <div>
            <button
              type="button"
              aria-expanded={promptOpen}
              aria-controls={promptId}
              onClick={() => setPromptOpen((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 font-bold text-info-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
            >
              {promptOpen ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
              {promptOpen ? "Matnni yashirish" : "Matnni ko'rsatish"}
            </button>
            {promptOpen && (
              <p id={promptId} lang="ru" className="mt-1 whitespace-pre-line rounded-[var(--radius-sm)] bg-surface-2 p-3 text-ink">
                {item.prompt?.trim() ? item.prompt : "Matn kiritilmagan"}
              </p>
            )}
          </div>
        </div>
      </Card>

      {mode === "readonly" && item.review && (
        <Card tone="muted">
          <p className="font-bold">
            Allaqachon baholangan: {item.review.total.toFixed(2)}
            {item.review.reviewerName ? ` (${item.review.reviewerName})` : ""}
          </p>
        </Card>
      )}
      {mode === "override" && item.review && (
        <Card tone="muted">
          <p className="font-bold">
            Joriy baho: {item.review.total.toFixed(2)}
            {item.review.reviewerName ? ` · ${item.review.reviewerName}` : ""}
            {item.review.isOverride ? " · yangilangan" : ""}
          </p>
          {item.review.comment && <p className="mt-1 text-ink-2">{item.review.comment}</p>}
        </Card>
      )}

      {mode !== "readonly" && (
        <Card>
          <p id={hintId} className="sr-only">
            Klaviatura: 1 dan 5 gacha raqamlar joriy mezonga baho qo&apos;yadi, Tab keyingi mezonga o&apos;tadi, Enter
            hammasi to&apos;ldirilgan bo&apos;lsa yuboradi.
          </p>
          <div aria-describedby={hintId} role="group" aria-label="Baholash mezonlari" className="flex flex-col gap-4">
            {CRITERIA.map((c, i) => (
              <RubricRow
                key={c}
                rowIndex={i}
                label={CRITERION_LABELS[c]}
                value={draft[c] ?? null}
                disabled={busy}
                onFocusRow={() => setRow(i)}
                onChange={(n) => {
                  setRow(i);
                  setDraft((d) => ({ ...d, [c]: n }));
                }}
              />
            ))}
            <div className="flex flex-col gap-1">
              <label htmlFor={`${hintId}-comment`} className="text-sm font-bold text-ink-2">
                Izoh (ixtiyoriy)
              </label>
              <textarea
                id={`${hintId}-comment`}
                value={comment}
                maxLength={MAX_COMMENT}
                rows={3}
                readOnly={busy}
                aria-busy={busy || undefined}
                onChange={(e) => setComment(e.target.value)}
                className="w-full resize-y rounded-[var(--radius-sm)] border-2 border-border-strong bg-card p-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
              />
              <p className="self-end text-sm text-ink-3" aria-hidden="true">
                {comment.length}/{MAX_COMMENT}
              </p>
            </div>
          </div>
        </Card>
      )}

      {mode !== "readonly" && (
        <div className="flex gap-3">
          {mode === "pending" && (
            <Button variant="secondary" onClick={onSkip} disabled={busy || !canSkip}>
              <SkipForward aria-hidden="true" className="size-5" />
              O&apos;tkazish
            </Button>
          )}
          <Button fullWidth disabled={!complete} loading={busy} onClick={submit}>
            {mode === "override"
              ? `Bahoni yangilash${avg !== null ? ` · ${fmt(avg)}` : ""}`
              : `Baholash${avg !== null ? ` · ${fmt(avg)}` : ""} · keyingisi`}
          </Button>
        </div>
      )}
      {mode === "pending" && !complete && !busy && (
        <p className="text-center text-sm text-ink-3">To&apos;rt mezonning hammasiga baho qo&apos;ying</p>
      )}
    </div>
  );
}
