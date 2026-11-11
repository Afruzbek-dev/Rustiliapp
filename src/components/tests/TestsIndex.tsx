"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, FileCheck2, Plus } from "lucide-react";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import type { TestsOverview } from "@/lib/tests/editor-types";
import { Field, IssueList, TextField, inputClass } from "@/components/staff/editor/fields";
import type { TestEditorActions } from "./editor-actions-type";

export function TestsIndex({ overview, actions }: { overview: TestsOverview; actions: Pick<TestEditorActions, "createTest"> }) {
  const router = useRouter();
  const free = overview.courses.flatMap((c) => c.modules.filter((m) => !m.hasTest).map((m) => ({ ...m, courseTitle: c.title })));
  const [moduleId, setModuleId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  async function create() {
    setBusy(true);
    setIssues([]);
    try {
      const res = await actions.createTest({ moduleId, title });
      if (res.ok) {
        router.push(`/teacher/tests/${res.testId}`);
        return;
      }
      setIssues([res.message]);
    } catch {
      setIssues(["Xatolik yuz berdi, qayta urinib ko'ring"]);
    }
    setBusy(false);
  }

  return (
    <main className="flex flex-col gap-5 p-4">
      <h1 className="text-2xl font-extrabold">Testlar</h1>

      {overview.tests.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="size-10" />}
          title="Hali test yo'q"
          text={overview.courses.length === 0 ? "Avval kurs yarating." : "Modul uchun birinchi testni yarating."}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {overview.tests.map((t) => (
            <li key={t.id}>
              <Link
                href={`/teacher/tests/${t.id}`}
                className="flex min-h-11 items-center gap-3 rounded-[var(--radius-lg)] border-2 border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-extrabold">{t.title}</p>
                  <p className="truncate text-ink-2">
                    {t.courseTitle}
                    {t.moduleTitle ? ` · ${t.moduleTitle}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip tone={t.published ? "ok" : "neutral"}>{t.published ? "Nashr qilingan" : "Qoralama"}</Chip>
                    <Chip>{t.itemCount} ta mashq</Chip>
                    {t.passScore !== null && <Chip>O&apos;tish: {t.passScore}%</Chip>}
                    {t.timeLimitMin !== null && <Chip>{t.timeLimitMin} daqiqa</Chip>}
                  </div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h2 className="text-lg font-extrabold">Yangi test</h2>
          {free.length === 0 ? (
            <p className="text-ink-2">Barcha modullarda test bor yoki modul yo&apos;q.</p>
          ) : (
            <>
              <Field label="Modul">
                {(id) => (
                  <select id={id} className={inputClass} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                    <option value="">Modulni tanlang</option>
                    {free.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.courseTitle} · {m.position}-modul: {m.title}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <TextField label="Test nomi" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              <IssueList issues={issues} />
              <Button type="submit" loading={busy} disabled={busy || !moduleId || !title.trim()}>
                <Plus className="size-5" aria-hidden="true" />
                Test yaratish
              </Button>
            </>
          )}
        </form>
      </Card>
    </main>
  );
}
