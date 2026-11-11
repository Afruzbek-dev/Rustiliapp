"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, Chip, IconButton } from "@/components/ui";
import { ExerciseEditor } from "@/components/staff/editor/ExerciseEditor";
import { Field, IssueList, TextField, inputClass } from "@/components/staff/editor/fields";
import { draftFromModel, emptyModel } from "@/lib/editor/exercise-model";
import { TYPE_LABEL, buildExerciseWrite, isAuthorableType } from "@/lib/exercises/authoring";
import type { EditorTest, EditorTestItem } from "@/lib/tests/editor-types";
import { SECTION_LABEL, TEST_SECTIONS, type TestSection } from "@/lib/tests/grade";
import { checkTestForPublish } from "@/lib/tests/publish-check";
import type { Failure } from "@/server/content-admin";
import type { ExerciseDraftInput, TestEditorActions } from "./editor-actions-type";
import { TestResultsTable } from "./TestResultsTable";

type Draft = ExerciseDraftInput & { xp: number };

const newDraft = (): Draft => {
  const { payload, key } = draftFromModel("classify", emptyModel("classify"));
  return { type: "classify", prompt: "", payload, key, xp: 0 };
};

function problems(res: Failure): string[] {
  return res.issues && res.issues.length > 0 ? [res.message, ...res.issues] : [res.message];
}

export function TestEditor({ test, actions }: { test: EditorTest; actions: TestEditorActions }) {
  const router = useRouter();
  const [title, setTitle] = useState(test.title);
  const [pass, setPass] = useState(test.passScore === null ? "" : String(test.passScore));
  const [limit, setLimit] = useState(test.timeLimitMin === null ? "" : String(test.timeLimitMin));
  const [attempts, setAttempts] = useState(String(test.maxAttempts));
  const [busy, setBusy] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: EditorTestItem | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDropTest, setConfirmDropTest] = useState(false);

  const check = useMemo(
    () =>
      checkTestForPublish({
        moduleId: test.moduleId,
        passScore: test.passScore,
        timeLimitMin: test.timeLimitMin,
        items: test.items.map((i) => ({ type: i.type, prompt: i.prompt, payload: i.payload, key: i.key, blockId: null })),
      }),
    [test],
  );

  async function run(name: string, fn: () => Promise<{ ok: true } | Failure>, done?: () => void) {
    setBusy(name);
    setIssues([]);
    setNotice(null);
    try {
      const res = await fn();
      if (res.ok) {
        done?.();
        router.refresh();
      } else setIssues(problems(res));
    } catch {
      setIssues(["Xatolik yuz berdi, qayta urinib ko'ring"]);
    }
    setBusy(null);
  }

  const parsed = {
    passScore: pass.trim() === "" ? null : Number(pass),
    timeLimitMin: limit.trim() === "" ? null : Number(limit),
    maxAttempts: Number(attempts),
  };

  const move = (i: number, d: -1 | 1) => {
    const ids = test.items.map((x) => x.exerciseId);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void run("reorder", () => actions.reorderItems({ testId: test.id, ids }));
  };

  const frozen = test.hasAttempts;

  return (
    <main className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-2">
        <p className="text-ink-2">
          {test.courseTitle}
          {test.moduleTitle ? ` · ${test.moduleTitle}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold">{test.title}</h1>
          <Chip tone={test.published ? "ok" : "neutral"}>{test.published ? "Nashr qilingan" : "Qoralama"}</Chip>
        </div>
      </header>

      {frozen && (
        <p role="status" className="flex items-start gap-2 rounded-[var(--radius-md)] border-2 border-border-strong bg-surface-2 p-3 text-ink">
          <Lock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          O&apos;quvchilar bu testni topshirgan: mashqlarni o&apos;zgartirib bo&apos;lmaydi. Sozlamalar va nashr holatini o&apos;zgartirish mumkin.
        </p>
      )}

      <IssueList issues={issues} title="Bajarilmadi" />
      {notice && (
        <p role="status" className="rounded-[var(--radius-md)] bg-ok-bg p-3 font-bold text-ok-text">
          {notice}
        </p>
      )}

      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("settings", () => actions.updateTest({ testId: test.id, title, ...parsed }), () => setNotice("Sozlamalar saqlandi"));
          }}
        >
          <h2 className="text-lg font-extrabold">Sozlamalar</h2>
          <TextField label="Test nomi" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField label="O'tish bali (%)" type="number" inputMode="numeric" min={1} max={100} value={pass} onChange={(e) => setPass(e.target.value)} />
            <TextField
              label="Vaqt limiti (daqiqa)"
              hint="Bo'sh = cheklanmagan"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
            <TextField label="Urinishlar soni" type="number" inputMode="numeric" min={1} max={10} value={attempts} onChange={(e) => setAttempts(e.target.value)} />
          </div>
          <div>
            <Button type="submit" loading={busy === "settings"} disabled={busy !== null || !title.trim()}>
              Saqlash
            </Button>
          </div>
        </form>
      </Card>

      <section aria-labelledby="items-h" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="items-h" className="text-lg font-extrabold">
            Mashqlar ({test.items.length})
          </h2>
          {!frozen && !editing && (
            <Button variant="secondary" onClick={() => setEditing({ item: null })}>
              <Plus className="size-5" aria-hidden="true" />
              Mashq qo&apos;shish
            </Button>
          )}
        </div>

        {test.items.length === 0 && !editing && <p className="text-ink-2">Testda hali mashq yo&apos;q.</p>}

        <ol className="flex flex-col gap-3">
          {test.items.map((it, i) => (
            <li key={it.exerciseId} className="rounded-[var(--radius-lg)] border-2 border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 w-6 shrink-0 font-extrabold text-ink-2">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{it.prompt || "Matnsiz mashq"}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Chip tone="info">{SECTION_LABEL[it.section]}</Chip>
                    <Chip>{isAuthorableType(it.type) ? TYPE_LABEL[it.type] : it.type}</Chip>
                    {it.lessonId && <Chip>{test.lessons.find((l) => l.id === it.lessonId)?.title ?? "Dars"}</Chip>}
                  </div>
                </div>
                {!frozen && (
                  <div className="flex shrink-0 items-center">
                    <IconButton aria-label={`${i + 1}-mashqni yuqoriga`} disabled={i === 0 || busy !== null} onClick={() => move(i, -1)} icon={<ArrowUp className="size-5" />} />
                    <IconButton aria-label={`${i + 1}-mashqni pastga`} disabled={i === test.items.length - 1 || busy !== null} onClick={() => move(i, 1)} icon={<ArrowDown className="size-5" />} />
                    <IconButton aria-label={`${i + 1}-mashqni tahrirlash`} disabled={busy !== null} onClick={() => setEditing({ item: it })} icon={<Pencil className="size-5" />} />
                    <IconButton
                      aria-label={confirmDelete === it.exerciseId ? `${i + 1}-mashqni o'chirishni tasdiqlash` : `${i + 1}-mashqni o'chirish`}
                      disabled={busy !== null}
                      onClick={() => {
                        if (confirmDelete !== it.exerciseId) return setConfirmDelete(it.exerciseId);
                        setConfirmDelete(null);
                        void run("remove", () => actions.removeItem({ testId: test.id, exerciseId: it.exerciseId }));
                      }}
                     icon={<Trash2 className={`size-5 ${confirmDelete === it.exerciseId ? "text-fire-text" : ""}`} />} />
                  </div>
                )}
              </div>
              {confirmDelete === it.exerciseId && (
                <p role="alert" className="mt-2 font-bold text-fire-text">
                  O&apos;chirish uchun yana bir marta bosing.
                </p>
              )}
            </li>
          ))}
        </ol>

        {editing && !frozen && (
          <ItemForm
            key={editing.item?.exerciseId ?? "new"}
            testId={test.id}
            item={editing.item}
            lessons={test.lessons}
            actions={actions}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </section>

      <section aria-labelledby="publish-h" className="flex flex-col gap-3">
        <h2 id="publish-h" className="text-lg font-extrabold">
          Nashr qilish
        </h2>
        {!test.published && <IssueList issues={check.errors} title="Nashrdan oldin tuzating" />}
        {check.warnings.length > 0 && (
          <ul className="list-disc pl-5 text-ink-2">
            {check.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div>
          <Button
            variant={test.published ? "secondary" : "success"}
            loading={busy === "publish"}
            disabled={busy !== null || (!test.published && check.errors.length > 0)}
            onClick={() =>
              void run(
                "publish",
                () => actions.setPublished({ testId: test.id, published: !test.published }),
                () => setNotice(test.published ? "Test nashrdan olindi" : "Test nashr qilindi"),
              )
            }
          >
            {test.published ? "Nashrdan olish" : "Nashr qilish"}
          </Button>
        </div>
      </section>

      {!frozen && !test.published && (
        <section aria-label="Testni o'chirish" className="flex flex-col gap-2">
          <div>
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => {
                if (!confirmDropTest) return setConfirmDropTest(true);
                void run("drop", () => actions.deleteTest({ testId: test.id }), () => router.push("/teacher/tests"));
              }}
            >
              <Trash2 className="size-5" aria-hidden="true" />
              {confirmDropTest ? "Ha, testni o'chirish" : "Testni o'chirish"}
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="results-h" className="flex flex-col gap-3">
        <h2 id="results-h" className="text-lg font-extrabold">
          Natijalar
        </h2>
        <TestResultsTable rows={test.results} />
      </section>
    </main>
  );
}

function ItemForm({
  testId,
  item,
  lessons,
  actions,
  onClose,
  onSaved,
}: {
  testId: string;
  item: EditorTestItem | null;
  lessons: EditorTest["lessons"];
  actions: TestEditorActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    item ? { type: item.type, prompt: item.prompt, payload: item.payload, key: item.key, xp: 0 } : newDraft(),
  );
  const [section, setSection] = useState<TestSection>(item?.section ?? "grammar");
  const [lessonId, setLessonId] = useState<string>(item?.lessonId ?? "");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const valid = buildExerciseWrite(draft).ok;

  async function save() {
    setBusy(true);
    setIssues([]);
    const exercise: ExerciseDraftInput = { type: draft.type, prompt: draft.prompt, payload: draft.payload, key: draft.key };
    const base = { testId, section, lessonId: lessonId || null, exercise };
    try {
      const res = item ? await actions.updateItem({ ...base, exerciseId: item.exerciseId }) : await actions.addItem(base);
      if (res.ok) return onSaved();
      setIssues(problems(res));
    } catch {
      setIssues(["Xatolik yuz berdi, qayta urinib ko'ring"]);
    }
    setBusy(false);
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3 className="text-lg font-extrabold">{item ? "Mashqni tahrirlash" : "Yangi mashq"}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Bo'lim">
            {(id) => (
              <select id={id} className={inputClass} value={section} onChange={(e) => setSection(e.target.value as TestSection)}>
                {TEST_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Qayta ko'rish darsi" hint="Bo'lim past chiqsa, o'quvchiga shu dars tavsiya etiladi">
            {(id) => (
              <select id={id} className={inputClass} value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
                <option value="">Tanlanmagan</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.position}-dars: {l.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <ExerciseEditor draft={draft} onChange={(d) => setDraft({ ...d, xp: 0 })} isTestItem={false} hideXp />
        <IssueList issues={issues} title="Saqlanmadi" />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} disabled={busy || !valid}>
            {item ? "Saqlash" : "Qo'shish"}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
        </div>
      </form>
    </Card>
  );
}
