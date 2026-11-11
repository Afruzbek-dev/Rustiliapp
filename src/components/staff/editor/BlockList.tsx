"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, FileText, GripVertical, Headphones, Image as ImageIcon, Languages, ListChecks, Mic, Plus, Video } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { ADDABLE_BLOCKS, BLOCK_LABEL, type EditorBlock } from "@/lib/editor/types";

const ICON = { video: Video, audio: Headphones, rule_image: ImageIcon, text: FileText, reading: FileText, exercise: ListChecks, words: Languages, speaking: Mic } as const;

export function blockTitle(b: EditorBlock): string {
  const p = b.payload;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const first = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}...` : t);
  switch (b.type) {
    case "video": return s(p.title) || "Video";
    case "audio": return s(p.title) || "Audio";
    case "rule_image": return s(p.alt) || "Qoida rasmi";
    case "text":
    case "reading": return s(p.title) || first(s(p.body)) || "Matn";
    case "exercise": return first(b.exercise?.prompt ?? "") || "Mashq";
    case "speaking": return first(b.exercise?.prompt ?? "") || "Gapirish topshirig'i";
    default: return "So'zlar";
  }
}

export interface BlockListProps {
  blocks: EditorBlock[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onAdd: (type: string) => void;
  adding: boolean;
}

/**
 * The ordered blocks of one part. Reordering works by dragging the handle AND with the "Yuqoriga" /
 * "Pastga" buttons, so keyboard and touch users are never forced to drag.
 */
export function BlockList({ blocks, selectedId, onSelect, onReorder, onAdd, adding }: BlockListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = blocks.map((b) => b.id);

  const moveTo = (id: string, to: number) => {
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onReorder(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-ink-2">Bloklar ketma-ketligi: o&apos;quvchi shu tartibda o&apos;tadi</span>
      {blocks.length === 0 && <p className="rounded-[var(--radius-md)] border-2 border-dashed border-border-strong p-4 text-ink-2">Hali blok yo&apos;q. Quyidan birinchi blokni qo&apos;shing.</p>}
      <ol className="flex flex-col gap-2" aria-label="Bloklar">
        {blocks.map((b, i) => {
          const Icon = ICON[b.type] ?? FileText;
          const selected = b.id === selectedId;
          return (
            <li
              key={b.id}
              onDragOver={(e) => {
                if (dragId) {
                  e.preventDefault();
                  setOverId(b.id);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveTo(dragId, i);
                setDragId(null);
                setOverId(null);
              }}
              className={cn(
                "flex items-center gap-1 rounded-[var(--radius-md)] border-2 bg-card p-1",
                selected ? "border-brand-shadow" : "border-border",
                overId === b.id && dragId !== b.id && "border-info",
                dragId === b.id && "opacity-60",
              )}
            >
              <span
                draggable
                aria-hidden="true"
                title="Sudrab tartiblash"
                onDragStart={(e) => {
                  setDragId(b.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", b.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className="hidden size-11 shrink-0 cursor-grab items-center justify-center text-ink-3 sm:inline-flex"
              >
                <GripVertical className="size-4" />
              </span>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(b.id)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-sm)] px-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
              >
                <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-2">
                  <Icon className="size-[18px]" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-bold">{blockTitle(b)}</span>
                  <span className="text-sm text-ink-2">{i + 1}. {BLOCK_LABEL[b.type] ?? b.type}</span>
                </span>
                <span className="ml-auto shrink-0">
                  <Chip tone={b.published ? "ok" : "neutral"}>{b.published ? "Nashr" : "Qoralama"}</Chip>
                </span>
              </button>
              <button
                type="button"
                aria-label={`${i + 1}-blokni yuqoriga ko'chirish`}
                disabled={i === 0}
                onClick={() => moveTo(b.id, i - 1)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-ink-2 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-info-strong"
              >
                <ArrowUp className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${i + 1}-blokni pastga ko'chirish`}
                disabled={i === blocks.length - 1}
                onClick={() => moveTo(b.id, i + 1)}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-ink-2 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-info-strong"
              >
                <ArrowDown className="size-5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2 pt-2">
        <span className="text-sm font-bold text-ink-2">Blok qo&apos;shish</span>
        <div className="flex flex-wrap gap-2">
          {ADDABLE_BLOCKS.map((t) => (
            <Button key={t} variant="secondary" disabled={adding} onClick={() => onAdd(t)}>
              <Plus className="size-4" aria-hidden="true" />
              {BLOCK_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
