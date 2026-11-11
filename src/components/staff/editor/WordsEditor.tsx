"use client";

import { useRef, useState } from "react";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton } from "@/components/ui";
import type { EditorWord } from "@/lib/editor/types";
import { parseWordsCsv, type WordsCsvResult } from "@/lib/editor/words-csv";
import type { EditorActions } from "./actions-type";
import { Bare, IssueList } from "./fields";

export interface WordsEditorProps {
  lessonId: string;
  words: EditorWord[];
  onWords: (words: EditorWord[]) => void;
  actions: Pick<EditorActions, "importWords" | "saveWord" | "unlinkWord">;
}

const EMPTY: Omit<EditorWord, "id"> = { ru: "", stress: "", uz: "", pos: "", gender: "", example_ru: "", example_uz: "" };

export function WordsEditor({ lessonId, words, onWords, actions }: WordsEditorProps) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [csv, setCsv] = useState<{ text: string; result: WordsCsvResult; name: string } | null>(null);
  const [report, setReport] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function startEdit(w: EditorWord | null) {
    setError("");
    setEditing(w ? w.id : "new");
    setForm(w ? { ru: w.ru, stress: w.stress, uz: w.uz, pos: w.pos, gender: w.gender, example_ru: w.example_ru, example_uz: w.example_uz } : EMPTY);
  }

  async function submit() {
    setBusy(true);
    setError("");
    const r = await actions.saveWord({ lessonId, wordId: editing === "new" ? null : editing, fields: form });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onWords(r.words);
    setEditing(null);
  }

  async function unlink(id: string) {
    setError("");
    const r = await actions.unlinkWord({ lessonId, wordId: id });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onWords(r.words);
  }

  async function chooseFile(file: File | undefined) {
    setReport("");
    if (!file) return;
    const text = await file.text();
    setCsv({ text, result: parseWordsCsv(text), name: file.name });
    if (fileRef.current) fileRef.current.value = "";
  }

  async function runImport() {
    if (!csv) return;
    setBusy(true);
    const r = await actions.importWords({ lessonId, csv: csv.text });
    setBusy(false);
    if (!r.ok) {
      setError(r.message + (r.issues?.length ? `: ${r.issues[0]}` : ""));
      return;
    }
    onWords(r.words);
    setReport(`${r.inserted} ta yangi so'z, ${r.linked} ta mavjud so'z darsga bog'landi, ${r.skipped + r.duplicates} ta takror o'tkazib yuborildi.`);
    setCsv(null);
  }

  const res = csv?.result;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">Bu darsning so&apos;zlari. «So&apos;zlar» bloki o&apos;quvchiga shularni ko&apos;rsatadi.</p>

      {words.length === 0 ? (
        <EmptyState icon={<Plus className="size-10" />} title="Hali so'z yo'q" text="So'zni qo'lda qo'shing yoki CSV fayldan yuklang." />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Dars so'zlari">
          {words.map((w) => (
            <li key={w.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border-2 border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p lang="ru" className="truncate font-extrabold">{w.stress || w.ru}</p>
                <p className="truncate text-ink-2">{w.uz}</p>
              </div>
              <IconButton aria-label={`«${w.ru}» ni tahrirlash`} icon={<Pencil className="size-5" />} onClick={() => startEdit(w)} />
              <IconButton aria-label={`«${w.ru}» ni darsdan olib tashlash`} icon={<Trash2 className="size-5" />} onClick={() => void unlink(w.id)} />
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border-2 border-border-strong bg-surface-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h3 className="font-extrabold">{editing === "new" ? "Yangi so'z" : "So'zni tahrirlash"}</h3>
          {(
            [
              ["ru", "Ruscha so'z"], ["stress", "Urg'u bilan (ixtiyoriy)"], ["uz", "O'zbekcha tarjima"], ["pos", "So'z turkumi (ixtiyoriy)"],
              ["gender", "Jinsi (ixtiyoriy)"], ["example_ru", "Ruscha misol (ixtiyoriy)"], ["example_uz", "O'zbekcha misol (ixtiyoriy)"],
            ] as const
          ).map(([k, label]) => (
            <Bare key={k} aria-label={label} placeholder={label} lang={k.endsWith("uz") || k === "uz" ? undefined : "ru"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          ))}
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!form.ru.trim() || !form.uz.trim()}>Saqlash</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>Bekor qilish</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => startEdit(null)}>
            <Plus className="size-4" aria-hidden="true" />
            So&apos;z qo&apos;shish
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <FileUp className="size-4" aria-hidden="true" />
            CSV&apos;dan yuklash
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label="CSV faylni tanlash" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        </div>
      )}

      {error && <p role="alert" className="font-bold text-fire-text">{error}</p>}
      {report && <p role="status" className="font-bold text-ok-text">{report}</p>}

      {csv && res && (
        <section aria-label="CSV tekshiruvi" className="flex flex-col gap-2 rounded-[var(--radius-lg)] border-2 border-border-strong bg-card p-3">
          <h3 className="font-extrabold">{csv.name}</h3>
          <p className="text-sm text-ink-2">Ustunlar: ru, uz (majburiy), stress, pos, gender, example_ru, example_uz. Eng ko&apos;pi bilan 500 qator, 200 KB.</p>
          {res.fileError ? (
            <IssueList title="Faylni o'qib bo'lmadi" issues={[res.fileError]} />
          ) : (
            <>
              <p role="status" className="font-bold">
                {res.rows.length} ta to&apos;g&apos;ri qator{res.duplicates > 0 ? `, ${res.duplicates} ta takror` : ""}{res.errors.length > 0 ? `, ${res.errors.length} ta xato` : ""}
              </p>
              {res.ignoredColumns.length > 0 && <p className="text-sm text-ink-2">E&apos;tiborsiz qoldirilgan ustunlar: {res.ignoredColumns.join(", ")}</p>}
              <IssueList title="Xato qatorlar (import qilinmaydi)" issues={res.errors.slice(0, 50).map((e) => `${e.line}-qator: ${e.message}`)} />
            </>
          )}
          <div className="flex gap-2">
            <Button loading={busy} disabled={!!res.fileError || res.rows.length === 0} onClick={() => void runImport()}>
              {res.rows.length} ta so&apos;zni import qilish
            </Button>
            <Button variant="secondary" onClick={() => setCsv(null)}>Bekor qilish</Button>
          </div>
        </section>
      )}
    </div>
  );
}
