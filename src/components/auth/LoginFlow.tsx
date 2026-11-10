"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Send, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/browser";

const POLL_MS = 2000;
const MAX_POLL_FAILURES = 5;

type Session = { nonce: string; deepLink: string; matchCode: string; expiresAt: string };
type Identity = { name: string; phoneMasked: string };
type Phase = "starting" | "waiting" | "confirmed" | "exchanging" | "no_profile" | "expired" | "error" | "done";

export interface LoginFlowProps {
  /** Where to go after the session is established; /login re-resolves active vs pending server-side. */
  navigate?: (to: string) => void;
}

const defaultNavigate = (to: string) => window.location.assign(to);

const STEPS = ["Botni oching", "Telefon raqamni ulashing", "Tasdiqlang"] as const;

const LIVE: Record<Phase, string> = {
  starting: "Havola tayyorlanmoqda",
  waiting: "Telegram'da botni oching va telefon raqamingizni ulashing",
  confirmed: "Bot sizni tanidi. Bu siz ekaningizni tasdiqlang",
  exchanging: "Kirilmoqda",
  no_profile: "Telefon raqam ulashilmagan",
  expired: "Havola muddati tugadi",
  error: "Xatolik yuz berdi",
  done: "Kirildi",
};

const linkBtn =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand px-6 text-lg font-bold text-ink " +
  "shadow-[0_5px_0_var(--brand-shadow)] active:translate-y-[3px] active:shadow-[0_2px_0_var(--brand-shadow)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong";

function Spinner() {
  return <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />;
}

export function LoginFlow({ navigate = defaultNavigate }: LoginFlowProps) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [opened, setOpened] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const begin = useCallback((signal: AbortSignal) => {
    setPhase("starting");
    setSession(null);
    setIdentity(null);
    setOpened(false);
    setInlineError(null);
    fetch("/api/auth/telegram/start", { method: "POST", signal, credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("start");
        const json = (await res.json()) as Session;
        setSession({ nonce: json.nonce, deepLink: json.deepLink, matchCode: json.matchCode, expiresAt: json.expiresAt });
        setPhase("waiting");
      })
      .catch((e) => {
        if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setPhase("error");
      });
  }, []);

  const startCtrl = useRef<AbortController | null>(null);
  const restart = useCallback(() => {
    startCtrl.current?.abort();
    const ctrl = new AbortController();
    startCtrl.current = ctrl;
    begin(ctrl.signal);
  }, [begin]);

  useEffect(() => {
    restart();
    return () => startCtrl.current?.abort();
  }, [restart]);

  // Status polling: every 2 s while waiting; paused while the tab is hidden; stops on any
  // terminal answer; aborted on unmount / state change.
  const nonce = session?.nonce;
  const expiresAt = session?.expiresAt;
  useEffect(() => {
    if (phase !== "waiting" || !nonce || !expiresAt) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;
    let stopped = false;
    let failures = 0;

    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    const stop = (next: Phase) => {
      stopped = true;
      setPhase(next);
    };
    async function tick() {
      if (stopped || inflight) return;
      if (document.hidden) return schedule();
      if (Date.now() >= Date.parse(expiresAt!)) return stop("expired");
      inflight = true;
      try {
        const res = await fetch(`/api/auth/telegram/status?nonce=${encodeURIComponent(nonce!)}`, {
          signal: ctrl.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        if (res.status === 404) return stop("expired");
        if (!res.ok) throw new Error("status");
        const json = (await res.json()) as { status: string; identity?: Identity | null };
        failures = 0;
        if (json.status === "expired") return stop("expired");
        if (json.status === "confirmed") {
          if (json.identity) {
            setIdentity(json.identity);
            return stop("confirmed");
          }
          return stop("no_profile");
        }
      } catch {
        if (ctrl.signal.aborted) return;
        if (++failures >= MAX_POLL_FAILURES) return stop("error");
      } finally {
        inflight = false;
      }
      schedule();
    }
    const onVisible = () => {
      if (!document.hidden && !inflight) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, nonce, expiresAt]);

  // Focus management: move focus to the new panel heading whenever the step changes.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [phase, opened]);

  async function confirmLogin() {
    if (!session) return;
    setInlineError(null);
    setPhase("exchanging");
    try {
      const res = await fetch("/api/auth/telegram/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nonce: session.nonce, confirm: true }),
      });
      if (res.ok) {
        const { tokenHash } = (await res.json()) as { tokenHash: string };
        const { error } = await createClient().auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (error) throw new Error("verify");
        setPhase("done");
        navigate("/login");
        return;
      }
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409 && err.error === "no_profile") return setPhase("no_profile");
      if (res.status === 404 || res.status === 409 || res.status === 410) return setPhase("expired");
      throw new Error("exchange");
    } catch {
      setInlineError("Kirishda xatolik yuz berdi. Qayta urinib ko'ring.");
      setPhase("confirmed");
    }
  }

  const step = phase === "confirmed" || phase === "exchanging" || phase === "done" ? 3 : opened ? 2 : 1;
  const failed = phase === "no_profile" || phase === "expired" || phase === "error";

  return (
    <div className="flex flex-col gap-6">
      <p role="status" aria-live="polite" className="sr-only">
        {LIVE[phase]}
      </p>

      <ol className="flex items-center gap-2" aria-label="Qadamlar">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = !failed && n < step;
          const current = !failed && n === step;
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1 text-center" aria-current={current ? "step" : undefined}>
              <span
                className={
                  "flex size-9 items-center justify-center rounded-full text-base font-extrabold " +
                  (done ? "bg-ok-bg text-ok-text" : current ? "bg-brand text-ink" : "bg-surface-2 text-ink-2")
                }
              >
                {done ? <Check aria-hidden="true" className="size-5" /> : n}
              </span>
              <span className={"text-xs font-bold " + (current ? "text-ink" : "text-ink-2")}>{label}</span>
            </li>
          );
        })}
      </ol>

      <Card>
        {phase === "starting" && (
          <Panel headingRef={headingRef} title="Havola tayyorlanmoqda">
            <p className="flex items-center gap-2 text-ink-2">
              <Spinner /> Biroz kuting...
            </p>
          </Panel>
        )}

        {phase === "waiting" && session && (
          <Panel
            headingRef={headingRef}
            title={opened ? "Telefon raqamni ulashing" : "Botni oching"}
          >
            <p className="text-ink-2">
              {opened
                ? "Botda \"Raqamni ulashish\" tugmasini bosing. Bu sahifa o'zi yangilanadi."
                : "Telegram'da botni oching va Start tugmasini bosing."}
            </p>
            <a
              href={session.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className={linkBtn}
              onClick={() => setOpened(true)}
            >
              <Send aria-hidden="true" className="size-5" />
              {opened ? "Botni qayta ochish" : "Telegram'ni ochish"}
            </a>
            <p className="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-sm text-ink-2">
              Botdagi kod: <strong className="text-lg text-ink">{session.matchCode}</strong> — kod mos kelishini
              tekshiring.
            </p>
            {opened && (
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Spinner /> Raqam ulashilishi kutilmoqda...
              </p>
            )}
          </Panel>
        )}

        {(phase === "confirmed" || phase === "exchanging") && identity && (
          <Panel headingRef={headingRef} title="Bu sizmisiz?">
            <p className="flex items-start gap-2 text-ink">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ok-text" />
              <span>
                Siz <strong>{identity.name}</strong>, <strong>{identity.phoneMasked}</strong> sifatida kirmoqdasiz — bu
                sizmisiz?
              </span>
            </p>
            {inlineError && (
              <p role="alert" className="text-sm font-bold text-fire-text">
                {inlineError}
              </p>
            )}
            <Button fullWidth size="lg" loading={phase === "exchanging"} onClick={confirmLogin}>
              Ha, kirish
            </Button>
            <Button fullWidth variant="secondary" disabled={phase === "exchanging"} onClick={restart}>
              Yo&apos;q, bekor qilish
            </Button>
          </Panel>
        )}

        {phase === "done" && (
          <Panel headingRef={headingRef} title="Kirilmoqda">
            <p className="flex items-center gap-2 text-ink-2">
              <Spinner /> Sahifa ochilmoqda...
            </p>
          </Panel>
        )}

        {failed && (
          <Panel
            headingRef={headingRef}
            title={
              phase === "no_profile"
                ? "Telefon raqam ulashilmagan"
                : phase === "expired"
                  ? "Havola muddati tugadi"
                  : "Ulanishda xatolik"
            }
            icon={<AlertTriangle aria-hidden="true" className="size-6 text-fire-text" />}
          >
            <p className="text-ink-2">
              {phase === "no_profile"
                ? "Telefon raqam ulashilmagan, botda raqamni ulashing."
                : phase === "expired"
                  ? "Xavfsizlik uchun havola 10 daqiqadan keyin eskiradi. Qaytadan boshlang."
                  : "Internet aloqasini tekshiring va qayta urinib ko'ring."}
            </p>
            <Button fullWidth onClick={restart}>
              Qayta urinish
            </Button>
          </Panel>
        )}
      </Card>
    </div>
  );
}

function Panel({
  title,
  icon,
  headingRef,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  headingRef: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-xl font-extrabold outline-none focus-visible:outline-2 focus-visible:outline-info-strong"
      >
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}
