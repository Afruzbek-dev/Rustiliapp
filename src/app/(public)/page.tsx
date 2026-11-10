import { Send } from "lucide-react";
import { Button } from "@/components/ui";

/** Welcome screen [Artboard: Main]. The 32px grid background is used only here. */
export default function WelcomePage() {
  return (
    <main className="bg-grid flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <span className="rounded-full bg-brand px-4 py-1.5 text-sm font-extrabold text-ink">Po russki</span>

      <div className="flex gap-3" aria-hidden="true">
        <span className="flex size-20 items-center justify-center rounded-[var(--radius-lg)] bg-ink text-4xl font-extrabold text-brand">
          Я
        </span>
        <span className="flex size-20 items-center justify-center rounded-[var(--radius-lg)] bg-brand text-4xl font-extrabold text-ink">
          Ж
        </span>
        <span className="flex size-20 items-center justify-center rounded-[var(--radius-lg)] border-2 border-border-strong bg-card text-4xl font-extrabold text-ink">
          Ы
        </span>
      </div>

      <h1 className="max-w-xs text-4xl font-extrabold leading-tight">Rus tilida gapirishni boshlang.</h1>

      <div className="w-full max-w-xs">
        <Button href="/login" size="lg" fullWidth>
          <Send aria-hidden="true" className="size-5" />
          Telegram orqali kirish
        </Button>
      </div>
    </main>
  );
}
