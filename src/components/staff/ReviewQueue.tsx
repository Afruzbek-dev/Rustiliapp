"use client";

import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Chip, EmptyState, Tabs } from "@/components/ui";
import { timeAgo, type QueueItem, type Scores } from "@/lib/curator-types";
import { ReviewCard } from "./ReviewCard";

export interface ReviewQueueProps {
  /** pending items, oldest first (a deep-linked one already first) */
  initialItems: QueueItem[];
  /** teacher/admin: recently reviewed items */
  reviewed: QueueItem[];
  /** teacher/admin: may re-score reviewed items (sends override: true) */
  canOverride: boolean;
  nowIso: string;
  initialTab?: "queue" | "reviewed";
  initialOpenId?: string | null;
  /** a reviewed deep link for a curator: shown read-only */
  pinned?: QueueItem | null;
}

type Message = { text: string; tone: "ok" | "error" } | null;
type Outcome =
  | { kind: "ok"; total: number }
  | { kind: "gone"; text: string } // 403 / 404 / 409: this item is not ours to review any more
  | { kind: "retry"; text: string }; // keep the form

async function postReview(
  item: QueueItem,
  scores: Scores,
  comment: string,
  override: boolean,
): Promise<Outcome> {
  const body: Record<string, unknown> = { submissionId: item.id, scores };
  if (comment) body.comment = comment;
  if (override) body.override = true;
  let res: Response;
  try {
    res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "retry", text: "Tarmoq xatosi. Qayta urinib ko'ring." };
  }
  const json = (await res.json().catch(() => ({}))) as { total?: unknown; error?: unknown };
  if (res.ok) return { kind: "ok", total: typeof json.total === "number" ? json.total : 0 };
  if (res.status === 409) {
    if (json.error === "submission_incomplete") return { kind: "gone", text: "Topshiriq hali to'liq yuklanmagan" };
    if (json.error === "unsupported_kind") return { kind: "gone", text: "Bu topshiriqni baholab bo'lmaydi" };
    return { kind: "gone", text: "Boshqa kurator baholadi" };
  }
  if (res.status === 403) return { kind: "gone", text: "Bu topshiriqni baholashga ruxsat yo'q" };
  if (res.status === 404) return { kind: "gone", text: "Topshiriq topilmadi" };
  if (res.status === 401) return { kind: "retry", text: "Sessiya tugagan. Qayta kiring." };
  return { kind: "retry", text: "Yuborib bo'lmadi. Qayta urinib ko'ring." };
}

export function ReviewQueue({
  initialItems,
  reviewed,
  canOverride,
  nowIso,
  initialTab = "queue",
  initialOpenId = null,
  pinned = null,
}: ReviewQueueProps) {
  const [queue, setQueue] = useState(initialItems);
  const [reviewedList, setReviewedList] = useState(reviewed);
  const [tab, setTab] = useState<"queue" | "reviewed">(canOverride ? initialTab : "queue");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const current = queue[0] ?? null;
  const opened = reviewedList.find((r) => r.id === openId) ?? null;

  function skip() {
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]!] : q));
    setMessage(null);
    setAdvanced(true);
  }

  async function submitPending(item: QueueItem, scores: Scores, comment: string) {
    if (busy) return;
    setBusy(true);
    const r = await postReview(item, scores, comment, false); // never an override for a pending item
    setBusy(false);
    if (r.kind === "retry") {
      setMessage({ text: r.text, tone: "error" });
      return;
    }
    // advance only after the server answered; a 409/403/404 means the item is gone from our queue
    setQueue((q) => q.filter((x) => x.id !== item.id));
    setAdvanced(true);
    setMessage(r.kind === "ok" ? { text: `Baho yuborildi: ${r.total.toFixed(2)}`, tone: "ok" } : { text: r.text, tone: "error" });
  }

  async function submitOverride(item: QueueItem, scores: Scores, comment: string) {
    if (busy) return;
    setBusy(true);
    const r = await postReview(item, scores, comment, true); // reviewed item + teacher/admin only
    setBusy(false);
    if (r.kind !== "ok") {
      setMessage({ text: r.text, tone: "error" });
      return;
    }
    setReviewedList((list) =>
      list.map((x) =>
        x.id === item.id
          ? {
              ...x,
              review: {
                scores,
                total: r.total,
                comment: comment || null,
                reviewerName: "Siz",
                isOverride: true,
                createdAt: new Date().toISOString(),
              },
            }
          : x,
      ),
    );
    setMessage({ text: `Baho yangilandi: ${r.total.toFixed(2)}`, tone: "ok" });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Tekshirish navbati</h1>
        <Chip tone="brand" aria-label={`Navbatda ${queue.length} ta topshiriq`}>
          {queue.length}
        </Chip>
      </header>

      {canOverride && (
        <Tabs
          label="Bo'limlar"
          value={tab}
          onChange={(id) => {
            setTab(id as "queue" | "reviewed");
            setMessage(null);
          }}
          tabs={[
            { id: "queue", label: "Navbat" },
            { id: "reviewed", label: "Qayta ko'rish" },
          ]}
        />
      )}

      <p
        role="status"
        aria-live="polite"
        className={
          message
            ? `rounded-[var(--radius-sm)] p-3 font-bold ${message.tone === "ok" ? "bg-ok-bg text-ok-text" : "bg-fire-bg text-fire-text"}`
            : "sr-only"
        }
      >
        {message?.text}
      </p>

      {pinned && (
        <ReviewCard item={pinned} nowIso={nowIso} mode="readonly" busy={false} focusOnMount={false} canSkip={false} onSubmit={() => {}} onSkip={() => {}} />
      )}

      {tab === "queue" ? (
        current ? (
          <ReviewCard
            key={current.id}
            item={current}
            nowIso={nowIso}
            mode="pending"
            busy={busy}
            focusOnMount={advanced}
            canSkip={queue.length > 1}
            onSubmit={(s, c) => void submitPending(current, s, c)}
            onSkip={skip}
          />
        ) : (
          <EmptyState
            icon={<CheckCircle2 className="size-10" />}
            title="Navbat bo'sh — hammasi baholangan"
            text="Yangi topshiriqlar kelganda shu yerda paydo bo'ladi."
          />
        )
      ) : opened ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              setMessage(null);
            }}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-[var(--radius-sm)] px-2 font-bold text-info-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
            Ro&apos;yxatga qaytish
          </button>
          <ReviewCard
            key={opened.id}
            item={opened}
            nowIso={nowIso}
            mode="override"
            busy={busy}
            focusOnMount
            canSkip={false}
            onSubmit={(s, c) => void submitOverride(opened, s, c)}
            onSkip={() => {}}
          />
        </div>
      ) : reviewedList.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-10" />}
          title="So'nggi 30 kunda baholangan topshiriq yo'q"
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Baholangan topshiriqlar">
          {reviewedList.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setOpenId(r.id);
                  setMessage(null);
                }}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 border-border bg-card p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-extrabold">{r.studentName}</span>
                  <span className="truncate text-sm text-ink-2">
                    {r.lessonTitle ? `${r.lessonTitle} · ` : ""}
                    {r.review ? timeAgo(r.review.createdAt, nowIso) : ""}
                  </span>
                </span>
                {r.review && <Chip tone="info">{r.review.total.toFixed(2)}</Chip>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
