/**
 * Shared completion path of a stored submission (audio-complete and the Telegram video flow):
 * part completion, the once-a-day speaking bump and the curator notice, guarded by an atomic
 * lease (SQL claim_submission_notification) so two simultaneous completions cannot notify twice.
 *
 * Ordering and the residual window:
 *   1. claim the lease (only the winner continues);
 *   2. `work` (completePart + bump; both idempotent). A failure releases the lease and rethrows;
 *   3. `notify` (the notifier itself skips when the curator message already exists). A failure
 *      releases the lease so a retry can proceed at once;
 *   4. `markNotified` (notified_at). If THIS throws after a successful send the lease is kept
 *      (NOT released), so a retry cannot re-send for the lease duration (2 minutes). After that an
 *      at-least-once re-send is possible, which the notifier's own "message already stored" check
 *      closes except for a crash between the Telegram send and storing its message id.
 */
export interface CompletionSteps {
  claim(): Promise<boolean>;
  release(): Promise<void>;
  work(): Promise<void>;
  notify(): Promise<void>;
  markNotified(): Promise<void>;
}

export type CompletionResult = "done" | "skipped" | "notify_failed" | "unmarked";

export async function runSubmissionCompletion(
  steps: CompletionSteps,
  log: (op: string, e: unknown) => void = (op, e) =>
    console.error(`submission-completion: ${op}`, e instanceof Error ? e.name : "unknown"),
): Promise<CompletionResult> {
  if (!(await steps.claim())) return "skipped";
  try {
    await steps.work();
  } catch (e) {
    await steps.release().catch(() => undefined);
    throw e;
  }
  try {
    await steps.notify();
  } catch (e) {
    log("notify failed", e);
    await steps.release().catch(() => undefined);
    return "notify_failed";
  }
  try {
    await steps.markNotified();
  } catch (e) {
    log("markNotified failed", e);
    return "unmarked";
  }
  return "done";
}
