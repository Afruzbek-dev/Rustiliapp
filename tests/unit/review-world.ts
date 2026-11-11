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
  kind: "audio" | "video" | "text";
  studentId: string;
  groupCurator: string; // curator of the submission's group
  complete: boolean;
  status: "pending" | "reviewed";
  draft: Partial<Scores>;
  curatorChatId: number | null;
  curatorMessageId: number | null;
}

/** In-memory model of the SQL functions (submit_review, review_authority, set_draft_score). */
export function createReviewWorld(opts: { sub?: Partial<FakeSub>; failDm?: boolean; failEdit?: boolean } = {}) {
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
  const submitCalls: { allowOverride: boolean; channel: string }[] = [];
  const reviews: { id: string; reviewerId: string; channel: string; scores: Scores; total: number; comment: string | null; isOverride: boolean }[] = [];
  const xp: { studentId: string; amount: number; ref: string }[] = [];
  const dms: { chatId: number; text: string }[] = [];
  const edits: { chatId: number; messageId: number; kind: string; text: string }[] = [];

  const authority = (id: string, reviewer: string): "curator" | "staff" | null => {
    if (id !== sub.id) return null;
    const r = roles[reviewer];
    if (!r || reviewer === sub.studentId) return null; // nobody reviews their own submission
    if (r.role === "admin" || r.role === "teacher") return "staff";
    if (r.role === "curator" && reviewer === sub.groupCurator) return "curator";
    return null;
  };

  const store: ReviewStore & ReviewBotStore = {
    async submit(a): Promise<SubmitOutcome> {
      submitCalls.push({ allowOverride: a.allowOverride, channel: a.channel });
      if (a.submissionId !== sub.id) return { outcome: "not_found" };
      const auth = authority(a.submissionId, a.reviewerId);
      if (!auth) return { outcome: "forbidden" };
      if (sub.kind !== "audio" && sub.kind !== "video") return { outcome: "unsupported_kind" };
      if (!sub.complete) return { outcome: "incomplete" };
      let isOverride = false;
      const s = a.scores;
      const total = Math.round(((s.completeness + s.pronunciation + s.grammar + s.fluency) / 4) * 100) / 100;
      if (sub.status === "pending") {
        sub.status = "reviewed";
        sub.draft = {};
      } else if (!(a.allowOverride && auth === "staff")) return { outcome: "already_reviewed" };
      else {
        isOverride = true;
        const dup = reviews.find((r) => r.isOverride && r.reviewerId === a.reviewerId && JSON.stringify(r.scores) === JSON.stringify(s) && r.comment === a.comment);
        if (dup) return { outcome: "duplicate", reviewId: dup.id, total: dup.total };
      }
      const id = `r${reviews.length + 1}`;
      reviews.push({ id, reviewerId: a.reviewerId, channel: a.channel, scores: s, total, comment: a.comment, isOverride });
      let xpAwarded = false;
      if (!isOverride) {
        // XP inside the same "transaction": idempotent per (student, ref)
        if (!xp.some((x) => x.studentId === sub.studentId && x.ref === sub.id)) {
          xp.push({ studentId: sub.studentId, amount: Math.round((40 * total) / 5), ref: sub.id });
          xpAwarded = true;
        }
      }
      return { outcome: "ok", reviewId: id, total, isOverride, studentId: sub.studentId, xpAwarded };
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
    async setDraft(id, actorId, criterion, value) {
      if (!authority(id, actorId)) throw new Error("forbidden"); // SQL: review_authority inside set_draft_score
      if (id !== sub.id || sub.status !== "pending") return null;
      sub.draft = { ...sub.draft, [criterion]: value };
      return { ...sub.draft };
    },
    async getDraftState(id) {
      const first = reviews[0];
      return id === sub.id ? { status: sub.status, draft: { ...sub.draft }, firstReviewerId: first ? first.reviewerId : null } : null;
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
  return { sub, roles, reviews, xp, dms, edits, store, deps, submitCalls };
}
