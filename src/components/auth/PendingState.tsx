import { Clock, Send } from "lucide-react";
import { Card } from "@/components/ui";

const linkBtn =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-brand px-6 text-lg font-bold text-ink " +
  "shadow-[0_5px_0_var(--brand-shadow)] active:translate-y-[3px] active:shadow-[0_2px_0_var(--brand-shadow)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong";

/** Shown to a signed-in student whose enrollment is not active yet (teacher has not approved). */
export function PendingState({ telegramUrl }: { telegramUrl: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center gap-4 p-2 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-info-bg text-info-strong">
          <Clock aria-hidden="true" className="size-7" />
        </span>
        <h2 className="text-xl font-extrabold">Ustoz tasdig&apos;i kutilmoqda</h2>
        <p className="text-ink-2">
          Arizangiz ustozga yuborildi. Tasdiqlangach, botdan xabar olasiz va darslar ochiladi.
        </p>
        <p className="text-sm text-ink-2">Savollar bo&apos;lsa, ustozingizga Telegram orqali yozing.</p>
        <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className={linkBtn}>
          <Send aria-hidden="true" className="size-5" />
          Telegram&apos;ni ochish
        </a>
      </div>
    </Card>
  );
}
