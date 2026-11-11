"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { parseYouTubeId, type EditorWord } from "@/lib/editor/types";
import { DEFAULT_SPEAKING, SPEAKING_XP } from "@/lib/exercises/authoring";
import type { EditorActions, ExerciseInput, Uploader } from "./actions-type";
import { Bare, Field, TextField, AreaField, inputClass } from "./fields";

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---------------------------------------------------------------------------------------------
export function VideoForm({ value, onChange }: { value: Payload; onChange: (v: Payload) => void }) {
  const [url, setUrl] = useState(() => (str(value.videoId) ? `https://youtu.be/${str(value.videoId)}` : ""));
  const parsed = url.trim() ? parseYouTubeId(url) : null;
  const bad = url.trim() !== "" && parsed === null;
  return (
    <div className="flex flex-col gap-4">
      <Field label="YouTube havolasi" hint="Masalan: https://youtu.be/dQw4w9WgXcQ">
        {(id) => (
          <input
            id={id}
            className={inputClass}
            inputMode="url"
            value={url}
            aria-invalid={bad}
            aria-describedby={bad ? `${id}-err` : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              const vid = parseYouTubeId(e.target.value);
              onChange({ ...value, provider: "youtube", videoId: vid ?? "" });
            }}
          />
        )}
      </Field>
      {bad && (
        <p role="alert" className="font-bold text-fire-text">
          Bu YouTube havolasi emas. youtube.com yoki youtu.be havolasini kiriting.
        </p>
      )}
      {parsed && <p className="text-ok-text">Video aniqlandi: {parsed}</p>}
      <TextField label="Sarlavha" value={str(value.title)} maxLength={200} onChange={(e) => onChange({ ...value, provider: "youtube", title: e.target.value })} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export interface MediaFormProps {
  kind: "audio" | "image";
  lessonId: string;
  value: Payload;
  onChange: (v: Payload) => void;
  actions: Pick<EditorActions, "requestUpload">;
  uploader: Uploader;
}

const ACCEPT = { audio: "audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm", image: "image/png,image/jpeg,image/webp" };
export const MAX_UPLOAD = 20 * 1024 * 1024;

export function MediaForm({ kind, lessonId, value, onChange, actions, uploader }: MediaFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState("");
  const path = str(value.path);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD) {
      setState("error");
      setError("Fayl 20 MB dan katta");
      return;
    }
    setState("uploading");
    setError("");
    try {
      const req = await actions.requestUpload({ lessonId, kind, size: file.size, contentType: file.type });
      if (!req.ok) {
        setState("error");
        setError(req.message);
        return;
      }
      const up = await uploader(req.path, req.token, file);
      if (!up.ok) {
        setState("error");
        setError("Yuklab bo'lmadi, qayta urinib ko'ring");
        return;
      }
      onChange({ ...value, path: req.path });
      setState("idle");
    } catch {
      setState("error");
      setError("Yuklab bo'lmadi, qayta urinib ko'ring");
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-border-strong bg-surface-2 p-4">
        <span className="font-bold">{kind === "audio" ? "Audio fayl" : "Rasm"} (20 MB gacha)</span>
        {path ? <span className="break-all text-sm text-ok-text">Yuklangan: {path.split("/").pop()}</span> : <span className="text-sm text-ink-2">Fayl hali yuklanmagan</span>}
        <input
          ref={input}
          type="file"
          className="sr-only"
          id={`upload-${kind}`}
          accept={ACCEPT[kind]}
          aria-label={kind === "audio" ? "Audio faylni tanlash" : "Rasmni tanlash"}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <div>
          <Button variant="secondary" loading={state === "uploading"} onClick={() => input.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            {path ? "Almashtirish" : "Faylni tanlash"}
          </Button>
        </div>
        {state === "error" && (
          <p role="alert" className="font-bold text-fire-text">
            {error}
          </p>
        )}
      </div>
      {kind === "audio" ? (
        <>
          <TextField label="Sarlavha" value={str(value.title)} maxLength={200} onChange={(e) => onChange({ ...value, title: e.target.value })} />
          <AreaField label="Transkript (ixtiyoriy)" lang="ru" value={str(value.transcript)} maxLength={10000} onChange={(e) => onChange({ ...value, transcript: e.target.value })} />
        </>
      ) : (
        <>
          <TextField label="Rasm tavsifi (alt matn)" hint="Ko'rmaydigan o'quvchilar uchun" value={str(value.alt)} maxLength={300} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
          <TextField label="Izoh (ixtiyoriy)" value={str(value.caption)} maxLength={500} onChange={(e) => onChange({ ...value, caption: e.target.value })} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
interface GlossaryEntry {
  surface: string;
  wordId: string;
}

export function TextForm({ value, onChange, words }: { value: Payload; onChange: (v: Payload) => void; words: EditorWord[] }) {
  const glossary = (Array.isArray(value.glossary) ? value.glossary : []) as GlossaryEntry[];
  const body = str(value.body);
  const [surface, setSurface] = useState("");
  const [wordId, setWordId] = useState("");
  const missing = surface.trim() !== "" && !body.toLowerCase().includes(surface.trim().toLowerCase());
  const setGlossary = (g: GlossaryEntry[]) => onChange({ ...value, glossary: g });

  return (
    <div className="flex flex-col gap-4">
      <TextField label="Sarlavha (ixtiyoriy)" value={str(value.title)} maxLength={200} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <AreaField
        label="Matn"
        hint="Abzatslar bo'sh qator bilan ajratiladi"
        lang="ru"
        value={body}
        maxLength={20000}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-ink-2">Lug&apos;at: matndagi so&apos;zni darsdagi so&apos;zga bog&apos;lash</legend>
        {glossary.map((g, i) => {
          const w = words.find((x) => x.id === g.wordId);
          return (
            <div key={`${g.surface}:${i}`} className="flex items-center gap-2 rounded-[var(--radius-md)] bg-surface-2 p-2">
              <span lang="ru" className="flex-1 font-bold">{g.surface}</span>
              <span className="flex-1 text-ink-2">{w ? `${w.ru} (${w.uz})` : "So'z topilmadi"}</span>
              <IconButton aria-label={`«${g.surface}» ni lug'atdan olib tashlash`} icon={<Trash2 className="size-5" />} onClick={() => setGlossary(glossary.filter((_, j) => j !== i))} />
            </div>
          );
        })}
        {words.length === 0 ? (
          <p className="text-sm text-ink-2">Avval «So&apos;zlar» blokida darsga so&apos;z qo&apos;shing.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-36 flex-1">
              <Bare aria-label="Matndagi so'z shakli" lang="ru" placeholder="Matndagi shakl (книги)" value={surface} onChange={(e) => setSurface(e.target.value)} />
            </div>
            <select aria-label="Darsdagi so'z" className={`${inputClass} w-auto min-w-40 flex-1`} value={wordId} onChange={(e) => setWordId(e.target.value)}>
              <option value="">So&apos;zni tanlang</option>
              {words.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.ru} ({w.uz})
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!surface.trim() || !wordId || missing || /\s/.test(surface.trim())}
              onClick={() => {
                setGlossary([...glossary, { surface: surface.trim(), wordId }]);
                setSurface("");
                setWordId("");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Qo&apos;shish
            </Button>
          </div>
        )}
        {missing && <p role="alert" className="text-sm font-bold text-fire-text">Bu so&apos;z matnda topilmadi.</p>}
        {/\s/.test(surface.trim()) && <p role="alert" className="text-sm font-bold text-fire-text">Faqat bitta so&apos;z belgilanadi.</p>}
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function SpeakingForm({ draft, onChange }: { draft: ExerciseInput; onChange: (d: ExerciseInput) => void }) {
  const p = (draft.payload ?? {}) as { maxSeconds?: number; channel?: string };
  const maxSeconds = typeof p.maxSeconds === "number" ? p.maxSeconds : DEFAULT_SPEAKING.maxSeconds;
  const channel = p.channel === "voice" || p.channel === "video" || p.channel === "both" ? p.channel : DEFAULT_SPEAKING.channel;
  const set = (patch: Partial<{ maxSeconds: number; channel: string }>) => onChange({ ...draft, type: "speaking", payload: { maxSeconds, channel, ...patch } });
  return (
    <div className="flex flex-col gap-4">
      <AreaField
        label="Topshiriq matni (o'quvchiga ko'rinadi)"
        lang="ru"
        hint="Kurator to'liqlik, talaffuz, grammatika va ravonlik bo'yicha baholaydi"
        value={draft.prompt}
        maxLength={2000}
        onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
      />
      <Field label="Topshirish usuli">
        {(id) => (
          <select id={id} className={inputClass} value={channel} onChange={(e) => set({ channel: e.target.value })}>
            <option value="voice">Ovoz (ilovada)</option>
            <option value="video">Video-krujok (Telegram)</option>
            <option value="both">Ikkalasi ham</option>
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Limit (soniya)"
          type="number"
          min={15}
          max={600}
          inputMode="numeric"
          value={String(maxSeconds)}
          onChange={(e) => set({ maxSeconds: Math.floor(Number(e.target.value) || 0) })}
        />
        <TextField
          label={`XP (odatiy ${SPEAKING_XP})`}
          type="number"
          min={0}
          max={200}
          inputMode="numeric"
          value={String(draft.xp)}
          onChange={(e) => onChange({ ...draft, xp: Math.max(0, Math.min(200, Math.floor(Number(e.target.value) || 0))) })}
        />
      </div>
    </div>
  );
}
