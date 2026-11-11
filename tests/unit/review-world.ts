import type { ReviewBotStore } from "@/lib/telegram/handlers/review";
import type { ReviewDeps, ReviewNotice, ReviewStore, Scores, SubmitOutcome } from "@/server/reviews";

export const SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STUDENT = "11111111-1111-4111-8111-111111111111";
export const CURATOR = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
export const CURATOR2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
export const TEACHER = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
export const ADMIN = "adadadad-adad-4ada-8ada-adadadadadad";

type Role = "student" | "curator" | "teacher" | "admin";
export interface FakeSub {
  id: string;
  kind: "audio" | "video";
  studentId: string;
  groupCurator: string; // curator of the submission's group
  complete: boolean;
  status: "pending" | "reviewed";
  draft: Partial<Scores>;
  curatorChatId: number | null;
  curatorMessageId: number | null;
}

/** In-memory model of the SQL functions (submit_review, review_authority, set_draft_score). */
export function createReviewWorld(opts: { sub?: Partial<FakeSub>; failDm?: boolean; failXp?: boolean; failEdit?: boolean } = {}) {
  const roles: Record<string, { role: Role; name: string; telegramId: number | null }> = {
    [STUDENT]: { role: "student", name: "Ali Valiyev", telegramId: 777 },
    [CURATOR]: { role: "curator", name: "Kurator Bir", telegramId: 101 },
    [CURATOR2]: { role: "curator", name: "Kurator Ikki", telegramId: 102 },
    [TEACHER]: { role: "teacher", name: "Zarina", telegramId: 103 },
    [ADMIN]: { role: "admin", name: "Admin", telegramId: 104 },
  };
  const sub: FakeSub = {
    id: SUB, kind: "video", studentId: STUDENT, groupCurator: CURATOR, complete: true, status: "pending", draft: {},
    curatorChatId: -100500, curatorMessageId: 42, ...opts.sub,
  };
  const reviews: { reviewerId: string; channel: string; scores: Scores; total: number; comment: string | null; isOverride: boolean }[] = [];
  const xp: { studentId: string; amount: number; ref: string }[] = [];
  const dms: { chatId: number; text: string }[] = [];
  const edits: { chatId: number; messageId: number; kind: string; text: string }[] = [];

  const authority = (id: string, reviewer: string): "curator" | "staff" | null => {
    if (id !== sub.id) return null;
    const r = roles[reviewer];
    if (!r) return null;
    if (r.role === "admin" || r.role === "teacher") return "staff";
    if (r.role === "curator" && reviewer === sub.groupCurator) return "curator";
    return null;
  };

  const store: ReviewStore & ReviewBotStore = {
    async submit(a): Promise<SubmitOutcome> {
      if (a.submissionId !== sub.id) return { outcome: "not_found" };
      const auth = authority(a.submissionId, a.reviewerId);
      if (!auth) return { outcome: "forbidden" };
      if (!sub.complete) return { outcome: "incomplete" };
      let isOverride = false;
      if (sub.status === "pending") {
        sub.status = "reviewed";
        sub.draft = {};
      } else if (auth === "curator") return { outcome: "already_reviewed" };
      else isOverride = true;
      const s = a.scores;
      const total = Math.round(((s.completeness + s.pronunciation + s.grammar + s.fluency) / 4) * 100) / 100;
      reviews.push({ reviewerId: a.reviewerId, channel: a.channel, scores: s, total, comment: a.comment, isOverride });
      return { outcome: "ok", reviewId: `r${reviews.length}`, total, isOverride, studentId: sub.studentId };
    },
    async awardSpeakingXp(studentId, amount, ref) {
      if (opts.failXp) throw new Error("xp down");
      if (xp.some((x) => x.studentId === studentId && x.ref === ref)) return false;
      xp.push({ studentId, amount, ref });
      return true;
    },
    async getNotice(id, reviewerId): Promise<ReviewNotice | null> {
      if (id !== sub.id) return null;
      return {
        kind: sub.kind,
        studentTelegramId: roles[sub.studentId]!.telegramId,
        curatorChatId: sub.curatorChatId,
        curatorMessageId: sub.curatorMessageId,
        reviewerName: roles[reviewerId]?.name ?? null,
      };
    },
    // --- bot store
    async getReviewer(telegramId) {
      const hit = Object.entries(roles).find(([, r]) => r.telegramId === telegramId);
      return hit ? { id: hit[0] } : null;
    },
    async authority(id, profileId) {
      return authority(id, profileId);
    },
    async setDraft(id, criterion, value) {
      if (id !== sub.id || sub.status !== "pending") return null;
      sub.draft = { ...sub.draft, [criterion]: value };
      return { ...sub.draft };
    },
    async getDraftState(id) {
      return id === sub.id ? { status: sub.status, draft: { ...sub.draft } } : null;
    },
  };

  const deps: ReviewDeps = {
    store,
    telegram: {
      async sendDm(chatId, text) {
        if (opts.failDm) throw new Error("dm failed");
        dms.push({ chatId, text });
      },
      async markReviewed(m) {
        if (opts.failEdit) throw new Error("edit failed");
        edits.push(m);
      },
    },
  };
  return { sub, roles, reviews, xp, dms, edits, store, deps };
}
