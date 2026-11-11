import { Ban, Clock, Send } from "lucide-react";
import { Card } from "@/components/ui";
import { SignOutButton } from "./SignOutButton";

const linkBtn =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand px-6 text-lg font-bold text-ink " +
  "shadow-[0_5px_0_var(--brand-shadow)] active:translate-y-[3px] active:shadow-[0_2px_0_var(--brand-shadow)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong";

/**
 * Shown to a signed-in student without an active enrollment. `closed`: the enrollment was
 * rejected or expired, so "waiting for approval" would be misleading.
 */
export function PendingState({ telegramUrl, closed = false }: { telegramUrl: string; closed?: boolean }) {
  const Icon = closed ? Ban : Clock;
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 p-2 text-center">
        <span
          className={
            "flex size-14 items-center justify-center rounded-full " +
            (closed ? "bg-fire-bg text-fire-text" : "bg-info-bg text-info-strong")
          }
        >
          <Icon aria-hidden="true" className="size-7" />
        </span>
        <h2 className="text-xl font-extrabold">
          {closed ? "Kursga kirish yopilgan, ustoz bilan bog'laning" : "Ustoz tasdig'i kutilmoqda"}
        </h2>
        {!closed && (
          <p className="text-ink-2">
            Arizangiz ustozga yuborildi. Tasdiqlangach, botdan xabar olasiz va darslar ochiladi.
          </p>
        )}
        <p className="text-sm text-ink-2">Savollar bo&apos;lsa, ustozingizga Telegram orqali yozing.</p>
        <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className={linkBtn}>
          <Send aria-hidden="true" className="size-5" />
          Telegram&apos;ni ochish
        </a>
        <SignOutButton />
      </div>
    </Card>
  );
}
