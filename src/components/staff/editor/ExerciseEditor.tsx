"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import {
  ANSWER_SEPARATOR,
  newPair,
  draftFromModel,
  emptyModel,
  genId,
  modelFromDraft,
  type ChooseModel,
  type ClassifyModel,
  type ConjugateModel,
  type FillBlankModel,
  type MatchModel,
} from "@/lib/editor/exercise-model";
import { AUTHORABLE_TYPES, TYPE_LABEL, buildExerciseWrite, isAuthorableType, type AuthorableType } from "@/lib/exercises/authoring";
import { PRONOUNS } from "@/lib/exercises/types";
import type { ExerciseInput } from "./actions-type";
import { Bare, Field, IssueList, TextField, inputClass } from "./fields";

export interface ExerciseEditorProps {
  draft: ExerciseInput;
  onChange: (draft: ExerciseInput) => void;
  /** The exercise is also an item of a test (reusing a lesson exercise as a test item is warned about). */
  isTestItem: boolean;
  /** Students already answered it: the type cannot change. */
  typeLocked?: boolean;
  /** Test items carry no per-exercise XP (the test pays by score): hide the field. */
  hideXp?: boolean;
}

export function ExerciseEditor({ draft, onChange, isTestItem, typeLocked = false, hideXp = false }: ExerciseEditorProps) {
  const type = (isAuthorableType(draft.type) ? draft.type : "classify") as AuthorableType;
  const [model, setModel] = useState<unknown>(() =>
    draft.payload && Object.keys(draft.payload as object).length > 0 ? modelFromDraft(type, draft.payload, draft.key) : emptyModel(type),
  );

  const emit = (next: { type: string; model: unknown }, extra: Partial<ExerciseInput> = {}) => {
    const { payload, key } = draftFromModel(next.type, next.model);
    onChange({ ...draft, ...extra, type: next.type, payload, key });
  };
  const update = (m: unknown) => {
    setModel(m);
    emit({ type, model: m });
  };

  const check = useMemo(() => buildExerciseWrite(draft), [draft]);
  const unsupportedType = !isAuthorableType(draft.type);

  return (
    <div className="flex flex-col gap-4">
      {unsupportedType && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] border-2 border-fire bg-fire-bg p-3 text-fire-text">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          Bu mashq turi ({draft.type}) tahrirlanmaydi. Quyida yangi tur tanlang.
        </p>
      )}
      {isTestItem && (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] border-2 border-brand-text bg-surface-2 p-3 text-ink">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
          Bu mashq test elementi sifatida ham ishlatilgan. Test elementlari darsda ko&apos;rsatilmaydi, shuning uchun darsni nashr qilib bo&apos;lmaydi.
        </p>
      )}

      <Field label="Mashq turi" hint={typeLocked ? "O'quvchilar bu mashqni bajargan: turini o'zgartirib bo'lmaydi" : "Tur o'zgarsa, savollar tozalanadi"}>
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={unsupportedType ? "" : type}
            disabled={typeLocked}
            onChange={(e) => {
              const t = e.target.value as AuthorableType;
              const m = emptyModel(t);
              setModel(m);
              emit({ type: t, model: m });
            }}
          >
            {unsupportedType && <option value="">Tanlang</option>}
            {AUTHORABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <TextField label="Topshiriq matni (o'quvchiga ko'rinadi)" value={draft.prompt} maxLength={500} onChange={(e) => onChange({ ...draft, prompt: e.target.value })} />

      {type === "classify" && <ClassifyForm m={model as ClassifyModel} set={update} />}
      {type === "fill_blank" && <FillBlankForm m={model as FillBlankModel} set={update} />}
      {type === "conjugate" && <ConjugateForm m={model as ConjugateModel} set={update} />}
      {type === "choose" && <ChooseForm m={model as ChooseModel} set={update} />}
      {type === "match" && <MatchForm m={model as MatchModel} set={update} />}

      {!hideXp && <div className="max-w-40">
        <TextField
          label="XP (butun mashq uchun)"
          type="number"
          min={0}
          max={200}
          inputMode="numeric"
          value={String(draft.xp)}
          onChange={(e) => onChange({ ...draft, xp: Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))) })}
        />
      </div>}

      {!check.ok && <IssueList title="Nashrdan oldin tuzating" issues={check.errors} />}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <div>
      <Button variant="secondary" onClick={onClick}>
        <Plus className="size-4" aria-hidden="true" />
        {children}
      </Button>
    </div>
  );
}

function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return <IconButton aria-label={label} icon={<Trash2 className="size-5" />} onClick={onClick} />;
}

function ClassifyForm({ m, set }: { m: ClassifyModel; set: (m: ClassifyModel) => void }) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-ink-2">Guruhlar (kamida 2 ta)</legend>
        {m.buckets.map((b, i) => (
          <div key={b.id} className="flex items-center gap-2">
            <Bare aria-label={`${i + 1}-guruh nomi`} placeholder="Masalan: мужской род" value={b.label} onChange={(e) => set({ ...m, buckets: m.buckets.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)) })} />
            <Remove
              label={`${i + 1}-guruhni o'chirish`}
              onClick={() => set({ buckets: m.buckets.filter((x) => x.id !== b.id), items: m.items.map((it) => (it.bucketId === b.id ? { ...it, bucketId: "" } : it)) })}
            />
          </div>
        ))}
        <AddButton onClick={() => set({ ...m, buckets: [...m.buckets, { id: genId(), label: "" }] })}>Guruh qo&apos;shish</AddButton>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-ink-2">Elementlar va to&apos;g&apos;ri guruh</legend>
        {m.items.map((it, i) => (
          <div key={it.id} className="flex flex-wrap items-center gap-2">
            <div className="min-w-40 flex-1">
              <Bare aria-label={`${i + 1}-element matni`} value={it.text} onChange={(e) => set({ ...m, items: m.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })} />
            </div>
            <select
              aria-label={`${i + 1}-element to'g'ri guruhi`}
              className={`${inputClass} w-auto min-w-40 flex-1`}
              value={it.bucketId}
              onChange={(e) => set({ ...m, items: m.items.map((x) => (x.id === it.id ? { ...x, bucketId: e.target.value } : x)) })}
            >
              <option value="">Guruhni tanlang</option>
              {m.buckets.map((b, bi) => (
                <option key={b.id} value={b.id}>
                  {b.label || `${bi + 1}-guruh`}
                </option>
              ))}
            </select>
            <Remove label={`${i + 1}-elementni o'chirish`} onClick={() => set({ ...m, items: m.items.filter((x) => x.id !== it.id) })} />
          </div>
        ))}
        <AddButton onClick={() => set({ ...m, items: [...m.items, { id: genId(), text: "", bucketId: "" }] })}>Element qo&apos;shish</AddButton>
      </fieldset>
    </>
  );
}

function FillBlankForm({ m, set }: { m: FillBlankModel; set: (m: FillBlankModel) => void }) {
  const patch = (id: string, p: Partial<FillBlankModel["items"][number]>) => set({ items: m.items.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-bold text-ink-2">Gaplar: matn, bo&apos;sh joy va to&apos;g&apos;ri javob</legend>
      {m.items.map((it, i) => (
        <div key={it.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border-2 border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-32 flex-1"><Bare aria-label={`${i + 1}-gap: bo'sh joydan oldin`} placeholder="Я живу в" value={it.before} onChange={(e) => patch(it.id, { before: e.target.value })} /></div>
            <span aria-hidden="true" className="font-bold text-ink-3">____</span>
            <div className="min-w-32 flex-1"><Bare aria-label={`${i + 1}-gap: bo'sh joydan keyin`} placeholder="." value={it.after} onChange={(e) => patch(it.id, { after: e.target.value })} /></div>
            <Remove label={`${i + 1}-gapni o'chirish`} onClick={() => set({ items: m.items.filter((x) => x.id !== it.id) })} />
          </div>
          <Bare aria-label={`${i + 1}-gap: to'g'ri javoblar`} placeholder={`To'g'ri javob (bir nechta bo'lsa ${ANSWER_SEPARATOR} bilan ajrating)`} value={it.answers} onChange={(e) => patch(it.id, { answers: e.target.value })} />
          <Bare aria-label={`${i + 1}-gap: maslahat`} placeholder="Maslahat (ixtiyoriy)" value={it.hint} onChange={(e) => patch(it.id, { hint: e.target.value })} />
        </div>
      ))}
      <AddButton onClick={() => set({ items: [...m.items, { id: genId(), before: "", after: "", hint: "", answers: "" }] })}>Gap qo&apos;shish</AddButton>
    </fieldset>
  );
}

function ConjugateForm({ m, set }: { m: ConjugateModel; set: (m: ConjugateModel) => void }) {
  return (
    <>
      <TextField label="Fe'l (infinitiv)" lang="ru" value={m.verb} onChange={(e) => set({ ...m, verb: e.target.value })} />
      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-bold text-ink-2">To&apos;g&apos;ri shakllar</legend>
        {PRONOUNS.map((p, i) => (
          <label key={p} className="flex items-center gap-2">
            <span lang="ru" className="w-16 shrink-0 font-bold">{p}</span>
            <Bare aria-label={`${p}: to'g'ri shakl`} lang="ru" value={m.forms[i] ?? ""} onChange={(e) => set({ ...m, forms: m.forms.map((f, j) => (j === i ? e.target.value : f)) })} />
          </label>
        ))}
      </fieldset>
    </>
  );
}

function ChooseForm({ m, set }: { m: ChooseModel; set: (m: ChooseModel) => void }) {
  const patch = (id: string, p: Partial<ChooseModel["items"][number]>) => set({ items: m.items.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-bold text-ink-2">Savollar va variantlar (to&apos;g&apos;risini belgilang)</legend>
      {m.items.map((it, i) => (
        <div key={it.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border-2 border-border bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Bare aria-label={`${i + 1}-savol matni`} value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} />
            <Remove label={`${i + 1}-savolni o'chirish`} onClick={() => set({ items: m.items.filter((x) => x.id !== it.id) })} />
          </div>
          {it.options.map((o, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <input
                type="radio"
                className="size-6 shrink-0 accent-[var(--ok-shadow)]"
                name={`correct-${it.id}`}
                aria-label={`${i + 1}-savol: ${oi + 1}-variant to'g'ri`}
                checked={it.correct === oi}
                onChange={() => patch(it.id, { correct: oi })}
              />
              <Bare aria-label={`${i + 1}-savol: ${oi + 1}-variant`} value={o} onChange={(e) => patch(it.id, { options: it.options.map((x, j) => (j === oi ? e.target.value : x)) })} />
              {it.options.length > 2 && (
                <Remove
                  label={`${i + 1}-savol: ${oi + 1}-variantni o'chirish`}
                  onClick={() => patch(it.id, { options: it.options.filter((_, j) => j !== oi), correct: it.correct === oi ? -1 : it.correct > oi ? it.correct - 1 : it.correct })}
                />
              )}
            </div>
          ))}
          {it.options.length < 8 && <AddButton onClick={() => patch(it.id, { options: [...it.options, ""] })}>Variant qo&apos;shish</AddButton>}
        </div>
      ))}
      <AddButton onClick={() => set({ items: [...m.items, { id: genId(), text: "", options: ["", ""], correct: -1 }] })}>Savol qo&apos;shish</AddButton>
    </fieldset>
  );
}

function MatchForm({ m, set }: { m: MatchModel; set: (m: MatchModel) => void }) {
  const patch = (id: string, p: Partial<MatchModel["pairs"][number]>) => set({ pairs: m.pairs.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-ink-2">Juftliklar (o&apos;quvchiga aralashtirib ko&apos;rsatiladi)</legend>
      {m.pairs.map((p, i) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2">
          <div className="min-w-32 flex-1"><Bare aria-label={`${i + 1}-juftlik: chap`} value={p.left} onChange={(e) => patch(p.id, { left: e.target.value })} /></div>
          <div className="min-w-32 flex-1"><Bare aria-label={`${i + 1}-juftlik: o'ng`} value={p.right} onChange={(e) => patch(p.id, { right: e.target.value })} /></div>
          {m.pairs.length > 2 && <Remove label={`${i + 1}-juftlikni o'chirish`} onClick={() => set({ pairs: m.pairs.filter((x) => x.id !== p.id) })} />}
        </div>
      ))}
      {m.pairs.length < 30 && <AddButton onClick={() => set({ pairs: [...m.pairs, newPair()] })}>Juftlik qo&apos;shish</AddButton>}
    </fieldset>
  );
}

