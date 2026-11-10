import "server-only";

/**
 * Tells the curators of a submission's group that a new submission is waiting. Task 22 replaces the
 * default implementation with the Telegram sender (see setCuratorNotifier / the default below).
 * Implementations must be best-effort and must never put PII (names, paths, tokens) in logs.
 */
export interface CuratorNotifier {
  notify(submissionId: string): Promise<void>;
}

/** Default: no-op that logs only the submission id. */
export const noopCuratorNotifier: CuratorNotifier = {
  async notify(submissionId) {
    console.info("notify-curators: submission ready", submissionId);
  },
};

let notifier: CuratorNotifier = noopCuratorNotifier;

/** Install the real notifier (Task 22). Also used by tests. */
export function setCuratorNotifier(next: CuratorNotifier): void {
  notifier = next;
}

export async function notifyCuratorsOfSubmission(submissionId: string): Promise<void> {
  await notifier.notify(submissionId);
}
