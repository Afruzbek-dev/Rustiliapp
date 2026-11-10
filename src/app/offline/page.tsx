import type { Metadata } from "next";
import { RetryButton } from "@/components/pwa/RetryButton";

// sw-cache-version: v2 (must match CACHE_VERSION in public/sw.js; bump both when this page changes)
export const metadata: Metadata = { title: "Internet yo'q" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-extrabold text-[var(--ink)]">Internet aloqasi yo&apos;q</h1>
      <p className="text-[var(--ink-2)]">
        Hozir tarmoqqa ulanib bo&apos;lmadi. Aloqani tekshiring va qayta urinib ko&apos;ring.
      </p>
      <RetryButton />
    </main>
  );
}
