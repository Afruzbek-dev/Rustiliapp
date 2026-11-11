import type { Bot, Context } from "grammy";
import { reviewKeyboard, REVIEW_ROWS } from "@/lib/telegram/keyboards";
import { logBotError } from "@/lib/telegram/log";
import { CRITERIA, fmtTotal, ReviewError, type Criterion, type ReviewInput, type ReviewResult, type Scores } from "@/server/reviews";

export const RV_MSG = {
  denied: "Ruxsat yo'q",
  incomplete: "Barcha mezonlarni belgilang",
  alreadyByOther: "Boshqa kurator allaqachon baholagan",
  alreadyReviewed: "Allaqachon baholangan",
  notFound: "Topshiriq topilmadi",
  error: "Xatolik, qayta urinib ko'ring",
} as const;

/** Reads/writes the bot needs besides submitReview itself (service-role backed in production). */
export interface ReviewBotStore {
  /** Telegram user -> profile (null for unknown users). */
  getReviewer(telegramId: number): Promise<{ id: string } | null>;
  /** SQL review_authority: 'curator' | 'staff' | null. */
  authority(submissionId: string, profileId: string): Promise<"curator" | "staff" | null>;
  /** SQL set_draft_score (atomic jsonb_set); the new draft, or null when the submission is not pending. */
  setDraft(submissionId: string, criterion: Criterion, value: number): Promise<Partial<Scores> | null>;
  getDraftState(submissionId: string): Promise<{ status: "pending" | "reviewed"; draft: Partial<Scores> } | null>;
}

export interface ReviewWiring {
  store: ReviewBotStore;
  submit(input: ReviewInput): Promise<ReviewResult>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SCORE_RE = new RegExp(`^rv:(${UUID}):(cm|pr|gr|fl):([1-5])$`);
const SAVE_RE = new RegExp(`^rv:(${UUID}):save$`);
const CODE_TO_KEY = Object.fromEntries(REVIEW_ROWS.map((r) => [r.code, r.key])) as Record<string, Criterion>;

/**
 * Curator rubric buttons. The actor is ALWAYS identified by `from.id` -> profiles.telegram_id and
 * authorised by the server (review_authority / submit_review): neither the callback payload nor the
 * chat it came from grants anything. Whatever fails, the spinner is answered with a generic notice.
 */
export function registerReview(bot: Bot, getWiring: () => ReviewWiring) {
  bot.callbackQuery([SCORE_RE, SAVE_RE], async (ctx) => {
    try {
      await handle(ctx, getWiring());
    } catch (e) {
      logBotError(e, ctx.update.update_id);
      await ctx.answerCallbackQuery({ text: RV_MSG.error, show_alert: true }).catch(() => undefined);
    }
  });
}

async function handle(ctx: Context, w: ReviewWiring) {
  const data = ctx.callbackQuery!.data!;
  const deny = () => ctx.answerCallbackQuery({ text: RV_MSG.denied, show_alert: true });
  const from = ctx.from;
  if (!from) return void (await deny());

  const actor = await w.store.getReviewer(from.id);
  if (!actor) return void (await deny());

  const score = SCORE_RE.exec(data);
  const submissionId = (score ?? SAVE_RE.exec(data))![1]!;
  if (!(await w.store.authority(submissionId, actor.id))) return void (await deny());

  if (score) {
    const draft = await w.store.setDraft(submissionId, CODE_TO_KEY[score[2]!]!, Number(score[3]));
    if (!draft) {
      await ctx.answerCallbackQuery({ text: RV_MSG.alreadyReviewed, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    // "message is not modified" (a repeated tap) is expected: ignore it.
    await ctx.editMessageReplyMarkup({ reply_markup: reviewKeyboard(submissionId, draft) }).catch(() => undefined);
    return;
  }

  const state = await w.store.getDraftState(submissionId);
  if (!state) {
    await ctx.answerCallbackQuery({ text: RV_MSG.notFound, show_alert: true });
    return;
  }
  if (state.status === "reviewed") {
    await ctx.answerCallbackQuery({ text: RV_MSG.alreadyReviewed, show_alert: true });
    return;
  }
  if (!CRITERIA.every((c) => Number.isInteger(state.draft[c]))) {
    await ctx.answerCallbackQuery({ text: RV_MSG.incomplete, show_alert: true });
    return;
  }
  try {
    const r = await w.submit({
      submissionId,
      reviewerProfileId: actor.id,
      scores: state.draft as Scores,
      comment: null,
      channel: "telegram",
    });
    // The curator message edit (text + keyboard removal) is done by submitReview after the commit.
    await ctx.answerCallbackQuery({ text: `Baholandi: ${fmtTotal(r.total)}` });
  } catch (e) {
    if (e instanceof ReviewError) {
      const text =
        e.code === "forbidden"
          ? RV_MSG.denied
          : e.code === "already_reviewed"
            ? RV_MSG.alreadyByOther
            : e.code === "not_found"
              ? RV_MSG.notFound
              : RV_MSG.error;
      await ctx.answerCallbackQuery({ text, show_alert: true });
      return;
    }
    throw e;
  }
}
