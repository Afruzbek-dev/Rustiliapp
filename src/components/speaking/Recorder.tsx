"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, MicOff, Mic, RotateCcw, Send, Square } from "lucide-react";
import { Button, Card, ErrorState } from "@/components/ui";
import { Waveform } from "./Waveform";

export const MAX_SECONDS = 180;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4"];

type Phase = "idle" | "recording" | "recorded" | "sending" | "done";
type Support = "unknown" | "yes" | "no";

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export function formatTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const ERRORS: Record<string, string> = {
  rate_limited: "Juda ko'p urinish. Bir necha daqiqadan so'ng qayta urinib ko'ring.",
  unauthenticated: "Seans tugagan. Qayta kiring.",
  forbidden: "Bu amal uchun ruxsat yo'q.",
  not_found: "Topshiriq topilmadi.",
  payload_too_large: "Yozuv juda katta. Qisqaroq yozing.",
  upload_missing: "Yozuv yuklanmadi. Qayta urinib ko'ring.",
};

class SendError extends Error {}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new SendError("Internet aloqasi yo'q. Qayta urinib ko'ring.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new SendError(ERRORS[String(json.error)] ?? "Yuborib bo'lmadi. Qayta urinib ko'ring.");
  return json;
}

export interface RecorderProps {
  exerciseId: string;
  /** Test hook; production uses the 03:00 limit. */
  maxSeconds?: number;
  onSent?: () => void;
}

export function Recorder({ exerciseId, maxSeconds = MAX_SECONDS, onSent }: RecorderProps) {
  const [support, setSupport] = useState<Support>("unknown");
  const [denied, setDenied] = useState(false);
  const [micError, setMicError] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sendStep, setSendStep] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const limitRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const autoStopped = useRef(false);
  const [announce, setAnnounce] = useState("");
  // Survives a failed send so a retry resumes (a finished upload is not repeated).
  const uploadRef = useRef<{ submissionId: string; uploadUrl: string; uploaded: boolean } | null>(null);

  useEffect(() => {
    const ok =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";
    setSupport(ok ? "yes" : "no");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const releaseMic = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (limitRef.current !== null) {
      window.clearTimeout(limitRef.current);
      limitRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
    setAnalyser(null);
  }, []);

  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        if (rec.state !== "inactive") {
          try {
            rec.stop();
          } catch {
            /* already stopped */
          }
        }
      }
      releaseMic();
    },
    [releaseMic],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    setDenied(false);
    setMicError(false);
    setSendError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") setDenied(true);
      else setMicError(true);
      return;
    }
    if (!mountedRef.current) {
      // The component unmounted while the permission prompt was pending: do not keep the mic on.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(node);
        ctxRef.current = ctx;
        setAnalyser(node);
      }
    } catch {
      /* the waveform is decoration; recording still works */
    }
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      releaseMic();
      setMicError(true);
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onerror = () => {
      rec.ondataavailable = null;
      rec.onstop = null;
      releaseMic();
      setMicError(true);
      setPhase("idle");
      setAnnounce("Yozishda xatolik yuz berdi.");
    };
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
      uploadRef.current = null;
      releaseMic();
      setPreviewUrl(URL.createObjectURL(blob));
      setPhase("recorded");
      setAnnounce(autoStopped.current ? "Vaqt tugadi, yozish to'xtatildi." : "Yozish to'xtatildi.");
    };
    recorderRef.current = rec;
    rec.start();
    setSeconds(0);
    setPhase("recording");
    setAnnounce("Yozish boshlandi.");
    autoStopped.current = false;
    // Wall-clock based: a throttled background tab cannot stretch the limit. The timeout enforces
    // the limit, the interval only refreshes the on-screen timer.
    const startedAt = Date.now();
    const finish = () => {
      autoStopped.current = true;
      if (rec.state !== "inactive") rec.stop();
    };
    limitRef.current = window.setTimeout(finish, maxSeconds * 1000);
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.min(maxSeconds, Math.floor((Date.now() - startedAt) / 1000));
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) finish();
    }, 250);
  }, [maxSeconds, releaseMic]);

  const reset = useCallback(() => {
    blobRef.current = null;
    uploadRef.current = null;
    setPreviewUrl(null);
    setSeconds(0);
    setSendError(null);
    setPhase("idle");
  }, []);

  const send = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase("sending");
    setSendError(null);
    try {
      if (!uploadRef.current) {
        setSendStep("Tayyorlanmoqda");
        const mime = (blob.type || "audio/webm").split(";")[0]!;
        const j = await postJson("/api/submissions/audio-upload", { exerciseId, mime });
        uploadRef.current = { submissionId: String(j.submissionId), uploadUrl: String(j.uploadUrl), uploaded: false };
      }
      const up = uploadRef.current;
      if (!up.uploaded) {
        setSendStep("Yuklanmoqda");
        let res: Response;
        try {
          res = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": (blob.type || "audio/webm").split(";")[0]! }, body: blob });
        } catch {
          throw new SendError("Internet aloqasi yo'q. Qayta urinib ko'ring.");
        }
        if (!res.ok) throw new SendError("Yozuvni yuklab bo'lmadi. Qayta urinib ko'ring.");
        up.uploaded = true;
      }
      setSendStep("Yakunlanmoqda");
      await postJson("/api/submissions/audio-complete", { submissionId: up.submissionId });
      setPhase("done");
      onSent?.();
    } catch (e) {
      setSendError(e instanceof SendError ? e.message : "Yuborib bo'lmadi. Qayta urinib ko'ring.");
      setPhase("recorded");
    }
  }, [exerciseId, onSent]);

  if (support === "no") {
    return (
      <ErrorState
        title="Brauzer qo'llab-quvvatlamaydi"
        text="Bu brauzerda ovoz yozib bo'lmaydi. Chrome, Safari yoki Firefox'ning yangi versiyasidan foydalaning yoki video-krujok yuboring."
      />
    );
  }

  if (phase === "done") {
    return (
      <Card>
        <div role="status" className="flex flex-col items-center gap-2 p-4 text-center">
          <CheckCircle2 aria-hidden="true" className="size-10 text-ok-text" />
          <p className="text-lg font-extrabold">Yuborildi</p>
          <p className="text-ink-2">Kurator tez orada baholaydi.</p>
        </div>
      </Card>
    );
  }

  const recording = phase === "recording";
  return (
    <div className="flex flex-col items-center gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {denied && (
        <div role="alert" className="flex w-full items-start gap-3 rounded-[var(--radius-md)] bg-fire-bg p-3 text-fire-text">
          <MicOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p>Mikrofonga ruxsat berilmadi. Brauzer sozlamalarida mikrofonga ruxsat bering va qayta urinib ko&apos;ring.</p>
        </div>
      )}
      {micError && (
        <div role="alert" className="w-full rounded-[var(--radius-md)] bg-fire-bg p-3 text-fire-text">
          Mikrofonni ishga tushirib bo&apos;lmadi. Qurilmangizni tekshirib, qayta urinib ko&apos;ring.
        </div>
      )}

      {phase === "recorded" || phase === "sending" ? (
        <>
          {previewUrl && <audio controls src={previewUrl} aria-label="Yozuvni tinglash" className="w-full" />}
          <p className="text-ink-2">Yozuv uzunligi: {formatTime(seconds)}</p>
          {sendError && (
            <p role="alert" className="w-full rounded-[var(--radius-md)] bg-fire-bg p-3 text-fire-text">
              {sendError}
            </p>
          )}
          {phase === "sending" && (
            <p role="status" aria-live="polite" className="text-ink-2">
              {sendStep}...
            </p>
          )}
          <div className="flex w-full gap-3">
            <Button variant="secondary" onClick={reset} disabled={phase === "sending"}>
              <RotateCcw aria-hidden="true" className="size-5" />
              Qayta yozish
            </Button>
            <Button fullWidth loading={phase === "sending"} onClick={() => void send()}>
              <Send aria-hidden="true" className="size-5" />
              {sendError ? "Qayta yuborish" : "Yuborish"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Waveform analyser={analyser} active={recording} />
          <p aria-live="off" className="text-3xl font-extrabold tabular-nums">
            {formatTime(seconds)} <span className="text-base font-semibold text-ink-3">/ {formatTime(maxSeconds)}</span>
          </p>
          <button
            type="button"
            onClick={recording ? stop : () => void start()}
            disabled={support === "unknown"}
            aria-label={recording ? "Yozishni to'xtatish" : "Yozishni boshlash"}
            className={`flex size-[88px] items-center justify-center rounded-full text-ink transition-[transform,box-shadow] duration-150 active:translate-y-[3px] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:opacity-60 ${
              recording
                ? "bg-fire shadow-[0_5px_0_var(--fire-shadow)] active:shadow-[0_2px_0_var(--fire-shadow)]"
                : "bg-brand shadow-[0_5px_0_var(--brand-shadow)] active:shadow-[0_2px_0_var(--brand-shadow)]"
            }`}
          >
            {recording ? <Square aria-hidden="true" className="size-9" /> : <Mic aria-hidden="true" className="size-10" />}
          </button>
          <p className="text-sm text-ink-2">{recording ? "Yozilmoqda. To'xtatish uchun bosing." : "Yozishni boshlash uchun bosing."}</p>
        </>
      )}
    </div>
  );
}
