"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { BLOCK_LABEL, type EditorBlock, type EditorWord } from "@/lib/editor/types";
import { DEFAULT_SPEAKING, SPEAKING_XP } from "@/lib/exercises/authoring";
import type { EditorActions, ExerciseInput, Uploader } from "./actions-type";
import { MediaForm, SpeakingForm, TextForm, VideoForm } from "./BlockForms";
import { ExerciseEditor } from "./ExerciseEditor";
import { IssueList } from "./fields";
import { useAutosave, type SaveState } from "./useAutosave";
import { WordsEditor } from "./WordsEditor";

export interface BlockEditorProps {
  block: EditorBlock;
  lessonId: string;
  words: EditorWord[];
  onWords: (w: EditorWord[]) => void;
  actions: EditorActions;
  uploader: Uploader;
  hidden: boolean;
  onValue: (id: string, value: unknown) => void;
  onSaved: (id: string, updatedAt: string) => void;
  onState: (id: string, state: SaveState) => void;
  registerFlush: (id: string, flush: (() => Promise<boolean>) | null) => void;
  onDelete: (id: string) => Promise<string | null>;
  onReload: () => void;
}

type Value = Record<string, unknown> | ExerciseInput;

function initialValue(block: EditorBlock): Value {
  if (block.type === "exercise" || block.type === "speaking") {
    const e = block.exercise;
    if (e) return { type: e.type, prompt: e.prompt, payload: e.payload, key: e.key, xp: e.xp };
    return block.type === "speaking"
      ? { type: "speaking", prompt: "", payload: { ...DEFAULT_SPEAKING }, key: null, xp: SPEAKING_XP }
      : { type: "classify", prompt: "", payload: {}, key: {}, xp: 10 };
  }
  return block.payload;
}

const STATE_TEXT: Record<SaveState, string> = {
  idle: "",
  dirty: "O'zgarishlar saqlanmagan",
  saving: "Saqlanmoqda...",
  saved: "Saqlandi",
  error: "Saqlanmadi",
  conflict: "Ziddiyat",
};

export function BlockEditor(p: BlockEditorProps) {
  const { block, onValue, onSaved, onState, registerFlush } = p;
  const isExercise = block.type === "exercise" || block.type === "speaking";
  const [value, setValue] = useState<Value>(() => initialValue(block));
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const auto = useAutosave<Value>({
    value,
    token: block.updatedAt,
    save: (v, token) =>
      isExercise
        ? p.actions.saveBlock({ blockId: block.id, exercise: v as ExerciseInput, expected: token })
        : p.actions.saveBlock({ blockId: block.id, payload: v as Record<string, unknown>, expected: token }),
    onSaved: (_v, updatedAt) => onSaved(block.id, updatedAt),
  });

  useEffect(() => onState(block.id, auto.state), [auto.state, block.id, onState]);
  useEffect(() => {
    registerFlush(block.id, auto.flush);
    return () => registerFlush(block.id, null);
  }, [block.id, auto.flush, registerFlush]);

  const change = (v: Value) => {
    setValue(v);
    onValue(block.id, v);
  };

  return (
    <section hidden={p.hidden} aria-label={`${BLOCK_LABEL[block.type]} bloki`} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-extrabold">{BLOCK_LABEL[block.type]}</h2>
        <Chip tone={block.published ? "ok" : "neutral"}>{block.published ? "Nashr qilingan" : "Qoralama"}</Chip>
        {auto.state !== "idle" && (
          <span role="status" className={auto.state === "error" || auto.state === "conflict" ? "font-bold text-fire-text" : "text-sm text-ink-2"}>
            {STATE_TEXT[auto.state]}
          </span>
        )}
      </header>

      {block.published && (
        <p className="rounded-[var(--radius-md)] bg-info-bg p-3 text-info-strong">Blok nashr qilingan: o&apos;zgarishlar o&apos;quvchilarga darhol ko&apos;rinadi.</p>
      )}

      {auto.state === "conflict" && (
        <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-md)] border-2 border-fire bg-fire-bg p-3 text-fire-text">
          <p className="font-bold">Bu blok boshqa joyda o&apos;zgartirilgan.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void auto.overwrite()}>Mening versiyamni saqlash</Button>
            <Button variant="secondary" onClick={p.onReload}>Serverdagi versiyani yuklash</Button>
          </div>
        </div>
      )}
      {auto.state === "error" && <IssueList title={auto.message || "Saqlanmadi"} issues={auto.issues} />}

      {block.type === "video" && <VideoForm value={value as Record<string, unknown>} onChange={change} />}
      {(block.type === "audio" || block.type === "rule_image") && (
        <MediaForm kind={block.type === "audio" ? "audio" : "image"} lessonId={p.lessonId} value={value as Record<string, unknown>} onChange={change} actions={p.actions} uploader={p.uploader} />
      )}
      {block.type === "reading" && (
        <div className="flex flex-col gap-2">
          <p className="text-ink-2">Bu blok turi tahrirlanmaydi (faqat ko&apos;rish).</p>
          <p lang="ru" className="whitespace-pre-wrap rounded-[var(--radius-md)] bg-surface-2 p-3">{typeof block.payload.body === "string" ? block.payload.body : ""}</p>
        </div>
      )}
      {block.type === "text" && <TextForm value={value as Record<string, unknown>} onChange={change} words={p.words} />}
      {block.type === "exercise" && <ExerciseEditor draft={value as ExerciseInput} onChange={change} isTestItem={block.exercise?.isTestItem ?? false} typeLocked={block.exercise?.typeLocked ?? false} />}
      {block.type === "speaking" && <SpeakingForm draft={value as ExerciseInput} onChange={change} />}
      {block.type === "words" && <WordsEditor lessonId={p.lessonId} words={p.words} onWords={p.onWords} actions={p.actions} />}

      <footer className="border-t-2 border-border pt-3">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="O'chirishni tasdiqlash">
            <span className="font-bold">Blokni o&apos;chirishga ishonchingiz komilmi?</span>
            <Button
              variant="danger"
              onClick={async () => {
                const err = await p.onDelete(block.id);
                if (err) {
                  setDeleteError(err);
                  setConfirming(false);
                }
              }}
            >
              Ha, o&apos;chirish
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Yo&apos;q</Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Blokni o&apos;chirish
          </Button>
        )}
        {deleteError && <p role="alert" className="mt-2 font-bold text-fire-text">{deleteError}</p>}
      </footer>
    </section>
  );
}
