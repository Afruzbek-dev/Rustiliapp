import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginFlow } from "@/components/auth/LoginFlow";
import { PendingState } from "@/components/auth/PendingState";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { resolveLoginView } from "@/server/login-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kirish — Po russki" };

function botUrl(): string {
  try {
    return `https://t.me/${serverEnv().TELEGRAM_BOT_USERNAME}`;
  } catch {
    return "https://t.me";
  }
}

/**
 * Anonymous -> login steps. Active student -> /home. Signed-in student without an active
 * enrollment (also `?state=pending`, where requireStudent sends them) -> pending view, never /home.
 */
export default async function LoginPage() {
  const view = await resolveLoginView(await createClient());
  if (view.kind === "redirect") redirect(view.to);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold">Kirish</h1>
        <p className="text-ink-2">Telegram orqali xavfsiz kiring — parol kerak emas.</p>
      </header>
      {view.kind === "pending" || view.kind === "closed" ? (
        <PendingState telegramUrl={botUrl()} closed={view.kind === "closed"} />
      ) : (
        <LoginFlow />
      )}
    </main>
  );
}
