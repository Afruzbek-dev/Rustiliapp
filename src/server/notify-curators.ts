import "server-only";

/**
 * Tells the curators of a submission's group that a new submission is waiting. The default
 * implementation is the Telegram sender (telegram-notifier.ts); tests replace it with
 * setCuratorNotifier. Implementations must be best-effort and must never put PII (names, paths,
 * tokens) in logs.
 */
export interface CuratorNotifier {
  notify(submissionId: string): Promise<void>;
}

/** No-op notifier that logs only the submission id (for tests / local runs). */
export const noopCuratorNotifier: CuratorNotifier = {
  async notify(submissionId) {
    console.info("notify-curators: submission ready", submissionId);
  },
};

let notifier: CuratorNotifier | undefined;

/** Install another notifier (tests). */
export function setCuratorNotifier(next: CuratorNotifier): void {
  notifier = next;
}

export async function notifyCuratorsOfSubmission(submissionId: string): Promise<void> {
  // The Telegram notifier is built lazily: env and clients are not touched at import time.
  const active = notifier ?? (notifier = (await import("./telegram-notifier")).createDefaultTelegramNotifier());
  await active.notify(submissionId);
}
