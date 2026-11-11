"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Smartphone } from "lucide-react";
import { Button, Chip, Tabs } from "@/components/ui";
import { DEFAULT_SPEAKING, SPEAKING_XP } from "@/lib/exercises/authoring";
import { lessonStatus, type EditorBlock, type EditorData, type EditorPart, type EditorWord } from "@/lib/editor/types";
import type { BlockType } from "@/lib/blocks/types";
import type { EditorActions, Uploader } from "./actions-type";
import { BlockEditor } from "./BlockEditor";
import { BlockList } from "./BlockList";
import { Bare, IssueList } from "./fields";
import { LessonTree, STATUS_LABEL, STATUS_TONE } from "./LessonTree";
import { useAutosave, type SaveState } from "./useAutosave";

export interface LessonEditorProps {
  data: EditorData;
  actions: EditorActions;
  uploader: Uploader;
  /** Reloads the page (conflict: "load the server's version"). Tests inject a spy. */
  reload?: () => void;
  /** Clock for the "N daqiqa oldin saqlandi" text. */
  now?: () => number;
}

export function formatAgo(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "hozirgina saqlandi";
  if (min < 60) return `${min} daqiqa oldin saqlandi`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} soat oldin saqlandi` : `${Math.floor(h / 24)} kun oldin saqlandi`;
}

function defaultBlock(id: string, type: BlockType, updatedAt: string): EditorBlock {
  const exercise =
    type === "speaking"
      ? { id: "", type: "speaking", prompt: "", payload: { ...DEFAULT_SPEAKING }, key: null, xp: SPEAKING_XP, isTestItem: false }
      : type === "exercise"
        ? { id: "", type: "classify", prompt: "", payload: {}, key: {}, xp: 10, isTestItem: false }
        : null;
  return { id, type, published: false, updatedAt, payload: {}, exercise };
}

export function LessonEditor({ data, actions, uploader, reload, now = Date.now }: LessonEditorProps) {
  const { lesson } = data;
  const [parts, setParts] = useState<EditorPart[]>(lesson.parts);
  const [words, setWords] = useState<EditorWord[]>(lesson.words);
  const [meta, setMeta] = useState({ title: lesson.title, objective: lesson.objective });
  const [activePart, setActivePart] = useState(lesson.parts[0]?.id ?? "");
  const [selected, setSelected] = useState<Record<string, string | null>>(() => Object.fromEntries(lesson.parts.map((p) => [p.id, p.blocks[0]?.id ?? null])));
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [savedAt, setSavedAt] = useState(() => {
    const times = [lesson.updatedAt, ...lesson.parts.flatMap((p) => p.blocks.map((b) => b.updatedAt))].map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n));
    return times.length ? Math.max(...times) : now();
  });
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [publishIssues, setPublishIssues] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const flushers = useRef(new Map<string, () => Promise<boolean>>());

  // keep the relative time fresh
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const metaSave = useAutosave({
    value: meta,
    token: lesson.updatedAt,
    save: (v, token) => actions.saveLesson({ lessonId: lesson.id, title: v.title, objective: v.objective, expected: token }),
    onSaved: () => setSavedAt(now()),
  });
  useEffect(() => {
    setStates((s) => ({ ...s, lesson: metaSave.state }));
  }, [metaSave.state]);

  const onState = useCallback((id: string, st: SaveState) => setStates((s) => (s[id] === st ? s : { ...s, [id]: st })), []);
  const registerFlush = useCallback((id: string, fn: (() => Promise<boolean>) | null) => {
    if (fn) flushers.current.set(id, fn);
    else flushers.current.delete(id);
  }, []);

  const allStates = Object.values(states);
  const busy = allStates.some((s) => s === "dirty" || s === "saving");
  const failed = allStates.includes("conflict") ? "conflict" : allStates.includes("error") ? "error" : null;

  useEffect(() => {
    if (!busy && !failed) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, failed]);

  const allBlocks = parts.flatMap((p) => p.blocks);
  const status = lessonStatus(allBlocks);
  const current = parts.find((p) => p.id === activePart) ?? parts[0];

  const patchBlock = useCallback((id: string, patch: (b: EditorBlock) => EditorBlock) => {
    setParts((ps) => ps.map((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? patch(b) : b)) })));
  }, []);

  const onValue = useCallback(
    (id: string, value: unknown) =>
      patchBlock(id, (b) =>
        b.type === "exercise" || b.type === "speaking"
          ? { ...b, exercise: { ...(b.exercise ?? { id: "", isTestItem: false }), ...(value as object) } as EditorBlock["exercise"] }
          : { ...b, payload: value as Record<string, unknown> },
      ),
    [patchBlock],
  );
  const onSaved = useCallback(
    (id: string, updatedAt: string) => {
      patchBlock(id, (b) => ({ ...b, updatedAt }));
      setSavedAt(now());
    },
    [patchBlock, now],
  );

  async function addBlock(type: string) {
    if (!current) return;
    setAdding(true);
    setNotice(null);
    const r = await actions.createBlock({ partId: current.id, type });
    setAdding(false);
    if (!r.ok) {
      setNotice({ tone: "error", text: r.message });
      return;
    }
    const block = defaultBlock(r.blockId, type as BlockType, r.updatedAt);
    setParts((ps) => ps.map((p) => (p.id === current.id ? { ...p, blocks: [...p.blocks, block] } : p)));
    setSelected((s) => ({ ...s, [current.id]: block.id }));
  }

  async function reorder(ids: string[]) {
    if (!current) return;
    const before = current.blocks;
    setNotice(null);
    setParts((ps) => ps.map((p) => (p.id === current.id ? { ...p, blocks: ids.map((id) => p.blocks.find((b) => b.id === id) as EditorBlock) } : p)));
    const r = await actions.reorderBlocks({ partId: current.id, ids });
    if (!r.ok) {
      setParts((ps) => ps.map((p) => (p.id === current.id ? { ...p, blocks: before } : p)));
      setNotice({ tone: "error", text: `Tartibni saqlab bo'lmadi: ${r.message}` });
    } else setSavedAt(now());
  }

  const deleteBlock = useCallback(
    async (id: string): Promise<string | null> => {
      const r = await actions.deleteBlock({ blockId: id });
      if (!r.ok) return r.message;
      setParts((ps) => ps.map((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) })));
      setSelected((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === id ? null : v])));
      setStates((s) => {
        const { [id]: _gone, ...rest } = s;
        void _gone;
        return rest;
      });
      return null;
    },
    [actions],
  );

  async function setPublished(published: boolean) {
    setPublishing(true);
    setPublishIssues([]);
    setNotice(null);
    // the lesson must be saved before it goes live
    const flushed = await Promise.all([metaSave.flush(), ...[...flushers.current.values()].map((f) => f())]);
    if (flushed.includes(false)) {
      setPublishing(false);
      setNotice({ tone: "error", text: "Avval saqlanmagan o'zgarishlarni tuzating, keyin nashr qiling." });
      return;
    }
    const r = await actions.setPublished({ lessonId: lesson.id, published });
    setPublishing(false);
    if (!r.ok) {
      setPublishIssues(r.issues ?? [r.message]);
      return;
    }
    setParts((ps) => ps.map((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, published })) })));
    setNotice({ tone: "ok", text: published ? ["Dars nashr qilindi.", ...r.warnings].join(" ") : "Dars qoralamaga qaytarildi." });
  }

  const ago = useMemo(() => formatAgo(Math.max(0, now() - savedAt)), [savedAt, tick, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const statusText = failed === "conflict" ? "Ziddiyat: boshqa joyda o'zgartirilgan" : failed === "error" ? "Saqlanmadi" : busy ? (allStates.includes("saving") ? "Saqlanmoqda..." : "O'zgarishlar saqlanmagan") : `${STATUS_LABEL[status]} · ${ago}`;
  const moduleTree = data.tree;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <Link href="/teacher/lessons" className="inline-flex min-h-11 items-center gap-1 font-bold text-ink">
          <ChevronLeft className="size-[18px]" aria-hidden="true" />
          Barcha darslar
        </Link>
        <p className="text-sm text-ink-2">Kurs: «{data.courseTitle}»</p>
        <details open>
          <summary className="min-h-11 cursor-pointer py-2 font-bold">Modul va darslar</summary>
          <LessonTree tree={moduleTree} currentLessonId={lesson.id} moduleId={lesson.moduleId} actions={actions} />
        </details>
      </aside>

      <main className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-3">
          <span className="text-sm font-bold text-ink-2">{lesson.modulePosition}-modul · {lesson.lessonPosition}-dars</span>
          <Bare aria-label="Dars sarlavhasi" lang="ru" value={meta.title} maxLength={200} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <Bare aria-label="Dars maqsadi" placeholder="Maqsad: dars oxirida o'quvchi nimani eplaydi" value={meta.objective} maxLength={1000} onChange={(e) => setMeta({ ...meta, objective: e.target.value })} />
          {metaSave.state === "error" && <IssueList title={metaSave.message || "Saqlanmadi"} issues={metaSave.issues} />}
          {metaSave.state === "conflict" && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border-2 border-fire bg-fire-bg p-3 text-fire-text">
              <span className="font-bold">Dars boshqa joyda o&apos;zgartirilgan.</span>
              <Button variant="danger" onClick={() => void metaSave.overwrite()}>Mening versiyamni saqlash</Button>
              <Button variant="secondary" onClick={() => (reload ?? (() => window.location.reload()))()}>Serverdagi versiyani yuklash</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={failed ? "fire" : STATUS_TONE[status]}>
              <span role="status">{statusText}</span>
            </Chip>
            {current && current.blocks.length > 0 ? (
              <a
                href={`/lesson/${current.id}?preview=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] border-2 border-border-strong bg-surface-2 px-4 font-bold text-ink"
              >
                <Smartphone className="size-[18px]" aria-hidden="true" />
                O&apos;quvchi ko&apos;rinishi
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-2 px-2 text-ink-3">O&apos;quvchi ko&apos;rinishi: avval blok qo&apos;shing</span>
            )}
            <span className="ml-auto" />
            {status === "published" ? (
              <Button variant="secondary" loading={publishing} onClick={() => void setPublished(false)}>Qoralamaga qaytarish</Button>
            ) : (
              <Button loading={publishing} onClick={() => void setPublished(true)}>{status === "partial" ? "Hammasini nashr qilish" : "Nashr qilish"}</Button>
            )}
          </div>
          {notice && (
            <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "font-bold text-fire-text" : "font-bold text-ok-text"}>
              {notice.text}
            </p>
          )}
          <IssueList title="Dars nashr qilishga tayyor emas" issues={publishIssues} />
        </header>

        {parts.length > 0 && (
          <Tabs
            label="Dars kunlari"
            tabs={parts.map((p) => ({ id: p.id, label: `${p.position}-kun · ${p.kind === "grammar" ? "Grammatika" : "Razgovor"}` }))}
            value={current?.id ?? ""}
            onChange={setActivePart}
          />
        )}

        {parts.map((part) => (
          <section key={part.id} hidden={part.id !== current?.id} aria-label={`${part.position}-kun`} className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <BlockList
              blocks={part.blocks}
              selectedId={selected[part.id] ?? null}
              onSelect={(id) => setSelected((s) => ({ ...s, [part.id]: id }))}
              onReorder={(ids) => void reorder(ids)}
              onAdd={(t) => void addBlock(t)}
              adding={adding}
            />
            <div className="min-w-0 rounded-[var(--radius-lg)] border-2 border-border bg-card p-4">
              {part.blocks.length === 0 && <p className="text-ink-2">Chapdan blok qo&apos;shing, shu yerda tahrirlanadi.</p>}
              {part.blocks.length > 0 && !selected[part.id] && <p className="text-ink-2">Tahrirlash uchun blokni tanlang.</p>}
              {part.blocks.map((b) => (
                <BlockEditor
                  key={b.id}
                  block={b}
                  lessonId={lesson.id}
                  words={words}
                  onWords={setWords}
                  actions={actions}
                  uploader={uploader}
                  hidden={selected[part.id] !== b.id}
                  onValue={onValue}
                  onSaved={onSaved}
                  onState={onState}
                  registerFlush={registerFlush}
                  onDelete={deleteBlock}
                  onReload={() => (reload ?? (() => window.location.reload()))()}
                />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
