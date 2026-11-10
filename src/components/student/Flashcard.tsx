"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Flag, Layers, Volume2 } from "lucide-react";
import { Button, Chip, EmptyState, IconButton, type ChipTone } from "@/components/ui";
import type { StudyCard } from "@/server/srs";

type Grade = "again" | "hard" | "good";

const GENDERS: Record<string, { label: string; tone: ChipTone }> = {
  m: { label: "м.р.", tone: "info" },
  f: { label: "ж.р.", tone: "fire" },
  n: { label: "ср.р.", tone: "ok" },
};

function canSpeak(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function genderOf(g: string | null) {
  return g ? (GENDERS[g.trim().toLowerCase().charAt(0)] ?? null) : null;
}

export interface FlashcardProps {
  cards: StudyCard[];
}

export function Flashcard({ cards: initialCards }: FlashcardProps) {
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState<Grade | null>(null);
  const [failed, setFailed] = useState<Grade | null>(null);
  const [difficult, setDifficult] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cards.map((c) => [c.wordId, c.isDifficult])),
  );
  const [togglePending, setTogglePending] = useState(false);
  const [toggleFailed, setToggleFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // One id per card-turn: an exact retry of the same grade request is applied only once by the server.
  const turn = useRef<{ wordId: string; id: string | undefined } | null>(null);
  const [speech, setSpeech] = useState(false);
  const busy = useRef(false);
  useEffect(() => setSpeech(canSpeak()), []);

  if (cards.length === 0) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <Header done={0} total={0} label={null} />
        <EmptyState
          icon={<Layers className="size-10" />}
          title="Bugun takrorlash yo'q — yangi darsni boshlang"
          action={<Button href="/path">Yo&apos;lga o&apos;tish</Button>}
        />
      </main>
    );
  }

  if (index >= cards.length) {
    return (
      <main className="flex flex-col gap-4 p-4">
        <Header done={cards.length} total={cards.length} label={null} />
        <EmptyState
          icon={<Layers className="size-10" />}
          title="Takrorlash tugadi"
          text={`${cards.length} ta so'z ko'rib chiqildi.`}
          action={<Button href="/home">Asosiyga qaytish</Button>}
        />
      </main>
    );
  }

  const card = cards[index];
  const gender = genderOf(card.gender);
  const isDifficult = difficult[card.wordId] ?? false;

  function play() {
    if (card.audioUrl) {
      void new Audio(card.audioUrl).play().catch(() => undefined);
      return;
    }
    if (!canSpeak()) return;
    const u = new SpeechSynthesisUtterance(card.ru);
    u.lang = "ru-RU";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /** HTTP status, or 0 on a network failure. */
  async function post(path: string, body: unknown): Promise<number> {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.status;
    } catch {
      return 0;
    }
  }

  function requestIdFor(wordId: string): string | undefined {
    if (turn.current?.wordId !== wordId) {
      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined;
      turn.current = { wordId, id };
    }
    return turn.current.id;
  }

  /** The card changed elsewhere (409): show the queue as it is now instead of advancing twice. */
  async function reloadQueue(): Promise<boolean> {
    try {
      const res = await fetch("/api/srs/queue");
      if (!res.ok) return false;
      const data = (await res.json()) as { cards?: StudyCard[] };
      if (!Array.isArray(data.cards)) return false;
      setCards(data.cards);
      setDifficult(Object.fromEntries(data.cards.map((c) => [c.wordId, c.isDifficult])));
      setIndex(0);
      setFlipped(false);
      return true;
    } catch {
      return false;
    }
  }

  // Never optimistic: the UI advances only after the server confirmed the grade.
  async function submit(g: Grade) {
    if (busy.current) return;
    busy.current = true;
    setSaving(g);
    setFailed(null);
    const status = await post("/api/srs/grade", { wordId: card.wordId, grade: g, requestId: requestIdFor(card.wordId) });
    turn.current = status === 200 || status === 409 ? null : turn.current;
    if (status === 409) {
      const reloaded = await reloadQueue();
      busy.current = false;
      setSaving(null);
      if (reloaded) setNotice("Karta boshqa joyda yangilangan. Joriy holat ko'rsatilmoqda.");
      else setFailed(g);
      return;
    }
    busy.current = false;
    setSaving(null);
    if (status !== 200) {
      setFailed(g);
      return;
    }
    setNotice(null);
    setFlipped(false);
    setIndex((i) => i + 1);
  }

  async function toggleDifficult() {
    if (togglePending) return;
    setTogglePending(true);
    setToggleFailed(false);
    const value = !isDifficult;
    if ((await post("/api/srs/difficult", { wordId: card.wordId, value })) === 200) {
      setDifficult((d) => ({ ...d, [card.wordId]: value }));
    } else {
      setToggleFailed(true);
    }
    setTogglePending(false);
  }

  return (
    <main className="flex flex-col gap-4 p-4">
      <Header done={index} total={cards.length} label={card.lessonTitle} />

      <div className="flex flex-col gap-4 rounded-[var(--radius-xl)] border-[1.5px] border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          {gender ? <Chip tone={gender.tone}>{gender.label}</Chip> : <span />}
          <button
            type="button"
            aria-pressed={isDifficult}
            disabled={togglePending}
            onClick={toggleDifficult}
            className={
              "inline-flex min-h-11 items-center gap-1 rounded-full border-2 px-3 text-sm font-bold " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong " +
              (isDifficult
                ? "border-fire bg-fire-bg text-fire-text"
                : "border-border-strong bg-card text-ink-2")
            }
          >
            <Flag aria-hidden="true" className="size-4" />
            Qiyin so&apos;z
          </button>
        </div>

        <button
          type="button"
          aria-expanded={flipped}
          onClick={() => setFlipped((f) => !f)}
          className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] p-2 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
        >
          <span lang="ru" className="text-[2.25rem] leading-tight font-extrabold break-words text-ink">
            {card.stress ?? card.ru}
          </span>
          {flipped ? (
            <span className="flex flex-col gap-2">
              <span className="text-xl font-bold text-ink">{card.uz}</span>
              {card.exampleRu && (
                <span lang="ru" className="text-ink-2">
                  {card.exampleRu}
                </span>
              )}
              {card.exampleUz && <span className="text-sm text-ink-3">{card.exampleUz}</span>}
            </span>
          ) : (
            <span className="text-sm text-ink-3">Tarjimani ko&apos;rish uchun bosing</span>
          )}
        </button>

        {(speech || card.audioUrl) && (
          <div className="flex justify-center">
            <IconButton aria-label="Talaffuzni eshitish" icon={<Volume2 className="size-5" />} onClick={play} />
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className="text-center text-sm text-ink-2">
          {notice}
        </p>
      )}

      {toggleFailed && (
        <p role="alert" className="text-center text-sm font-bold text-fire-text">
          Belgini saqlab bo&apos;lmadi. Qayta urinib ko&apos;ring.
        </p>
      )}

      {failed && (
        <div role="alert" className="flex flex-col items-center gap-2 text-center">
          <p className="font-bold text-fire-text">Saqlab bo&apos;lmadi. Qayta urinib ko&apos;ring.</p>
          <Button variant="secondary" onClick={() => submit(failed)}>
            Qayta urinish
          </Button>
        </div>
      )}

      {flipped && (
        <div className="grid grid-cols-3 gap-2">
          <GradeButton variant="danger" label="Qayta" hint={card.labels.again} g="again" saving={saving} onGrade={submit} />
          <GradeButton variant="secondary" label="Qiyin" hint={card.labels.hard} g="hard" saving={saving} onGrade={submit} />
          <GradeButton variant="success" label="Bildim" hint={card.labels.good} g="good" saving={saving} onGrade={submit} />
        </div>
      )}
    </main>
  );
}

function GradeButton({
  variant,
  label,
  hint,
  g,
  saving,
  onGrade,
}: {
  variant: "danger" | "secondary" | "success";
  label: string;
  hint: string;
  g: Grade;
  saving: Grade | null;
  onGrade: (g: Grade) => void;
}) {
  return (
    <Button variant={variant} loading={saving === g} disabled={saving !== null} onClick={() => onGrade(g)}>
      <span className="flex flex-col items-center leading-tight">
        <span>{label}</span>{" "}
        <span className="text-xs font-semibold">{hint}</span>
      </span>
    </Button>
  );
}

function Header({ done, total, label }: { done: number; total: number; label: string | null }) {
  const current = Math.min(done + 1, total);
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          aria-label="Orqaga"
          className="inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] border-2 border-border-strong bg-surface-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold">Takrorlash</h1>
          {label && <p className="truncate text-sm text-ink-2">{label}</p>}
        </div>
        {total > 0 && <Chip tone="neutral">{`${current} / ${total}`}</Chip>}
      </div>
      {total > 0 && (
        <div
          role="progressbar"
          aria-label="Jarayon"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="flex gap-1"
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={"h-2 flex-1 rounded-full " + (i < done ? "bg-ok" : i === done ? "bg-brand" : "bg-surface-2")}
            />
          ))}
        </div>
      )}
    </header>
  );
}
