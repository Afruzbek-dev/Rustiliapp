"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { Bare } from "@/components/staff/editor/fields";
import { LessonTree } from "@/components/staff/editor/LessonTree";
import type { TreeModule } from "@/lib/editor/types";
import { createLessonAction, createModuleAction } from "./actions";

function NewModule({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await createModuleAction({ courseId, title });
        setBusy(false);
        if (!r.ok) setError(r.message);
        else {
          setTitle("");
          router.refresh();
        }
      }}
    >
      <Bare aria-label="Yangi modul sarlavhasi" placeholder="Modul sarlavhasi" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <div>
        <Button type="submit" variant="secondary" loading={busy} disabled={!title.trim()}>
          <Plus className="size-4" aria-hidden="true" />
          Yangi modul
        </Button>
      </div>
      {error && <p role="alert" className="font-bold text-fire-text">{error}</p>}
    </form>
  );
}

export function CourseTrees({ courses }: { courses: { id: string; title: string; tree: TreeModule[] }[] }) {
  return (
    <div className="flex flex-col gap-4">
      {courses.map((c) => (
        <Card key={c.id}>
          <section className="flex flex-col gap-3" aria-label={c.title}>
            <h2 className="text-lg font-extrabold">{c.title}</h2>
            <LessonTree tree={c.tree} moduleId={c.tree[0]?.id ?? null} actions={{ createLesson: createLessonAction }} />
            {c.tree.length === 0 && <NewModule courseId={c.id} />}
          </section>
        </Card>
      ))}
    </div>
  );
}
