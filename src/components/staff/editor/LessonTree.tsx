"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Chip } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { LessonStatus, TreeModule } from "@/lib/editor/types";
import type { EditorActions } from "./actions-type";
import { Bare } from "./fields";

export const STATUS_LABEL: Record<LessonStatus, string> = { draft: "Qoralama", published: "Nashr", partial: "Qisman" };
export const STATUS_TONE = { draft: "neutral", published: "ok", partial: "brand" } as const;

export interface LessonTreeProps {
  tree: TreeModule[];
  currentLessonId?: string;
  /** Module new lessons are created in (the current lesson's module, or the first one). */
  moduleId: string | null;
  actions: Pick<EditorActions, "createLesson">;
}

export function LessonTree({ tree, currentLessonId, moduleId, actions }: LessonTreeProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!moduleId) return;
    setBusy(true);
    setError("");
    const r = await actions.createLesson({ moduleId, title });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setOpen(false);
    setTitle("");
    router.push(`/teacher/lessons/${r.lessonId}`);
  }

  return (
    <nav aria-label="Modul va darslar" className="flex flex-col gap-3">
      {tree.length === 0 && <p className="text-ink-2">Hali modul yo&apos;q.</p>}
      {tree.map((m) => (
        <div key={m.id} className="flex flex-col gap-1">
          <span className="text-sm font-extrabold tracking-wide text-ink-2 uppercase">{m.position}-modul: {m.title}</span>
          <ul className="flex flex-col gap-1">
            {m.lessons.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/teacher/lessons/${l.id}`}
                  aria-current={l.id === currentLessonId ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 font-bold",
                    l.id === currentLessonId ? "bg-brand text-ink" : "bg-card text-ink hover:bg-surface-2",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{l.position}. {l.title}</span>
                  <Chip tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {moduleId &&
        (open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Bare aria-label="Yangi dars sarlavhasi" placeholder="Dars sarlavhasi" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
            <div className="flex gap-2">
              <Button type="submit" loading={busy} disabled={!title.trim()}>Yaratish</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>Bekor qilish</Button>
            </div>
            {error && <p role="alert" className="font-bold text-fire-text">{error}</p>}
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Yangi dars
          </Button>
        ))}
    </nav>
  );
}
