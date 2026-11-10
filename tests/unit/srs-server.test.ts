import { describe, expect, it, vi } from "vitest";
import { intervalLabel, nextIntervalLabels } from "@/lib/srs-labels";
import { newCard } from "@/lib/srs";
import {
  DAILY_NEW_LIMIT,
  getStudyQueueWith,
  handleSrsDifficult,
  handleSrsGrade,
  tashkentDayStart,
  type CardRow,
  type QueueRow,
  type SrsQueueDb,
  type SrsStore,
} from "@/server/srs";

const NOW = new Date("2026-11-10T10:00:00Z");
const W = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const word = { ru: "дом", stress: "до́м", uz: "uy", gender: "m", exampleRu: null, exampleUz: null, audioUrl: null, lessonTitle: null };
const row = (n: number, over: Partial<QueueRow> = {}): QueueRow => ({
  wordId: W(n),
  intervalDays: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  dueAt: NOW.toISOString(),
  isDifficult: false,
  word,
  ...over,
});

function fakeQueueDb(opts: { due: QueueRow[]; fresh: QueueRow[]; introducedToday: number }) {
  const calls = { since: "" as string, newLimit: -1 };
  const db: SrsQueueDb = {
    dueCards: async () => opts.due,
    newCards: async (_s, limit) => {
      calls.newLimit = limit;
      return opts.fresh.slice(0, limit);
    },
    newStudiedSince: async (_s, since) => {
      calls.since = since;
      return opts.introducedToday;
    },
  };
  return { db, calls };
}

describe("intervalLabel / nextIntervalLabels", () => {
  it("formats minutes, days and months", () => {
    expect(intervalLabel(NOW, new Date(NOW.getTime() + 10 * 60_000))).toBe("10 daq");
    expect(intervalLabel(NOW, new Date(NOW.getTime() + 86_400_000))).toBe("1 kun");
    expect(intervalLabel(NOW, new Date(NOW.getTime() + 90 * 86_400_000))).toBe("3 oy");
  });

  it("new card: again 10 daq, hard 1 kun, good 1 kun; second good 4 kun; third 10 kun", () => {
    expect(nextIntervalLabels(newCard(NOW), NOW)).toEqual({ again: "10 daq", hard: "1 kun", good: "1 kun" });
    expect(nextIntervalLabels({ ...newCard(NOW), reps: 1, interval_days: 1 }, NOW).good).toBe("4 kun");
    expect(nextIntervalLabels({ ...newCard(NOW), reps: 2, interval_days: 4 }, NOW).good).toBe("10 kun");
  });
});

describe("getStudyQueueWith", () => {
  it("serves due cards first (as given, oldest first), then new cards", async () => {
    const { db } = fakeQueueDb({
      due: [row(1, { reps: 1, intervalDays: 1 }), row(2, { reps: 2, intervalDays: 4 })],
      fresh: [row(3), row(4)],
      introducedToday: 0,
    });
    const q = await getStudyQueueWith(db, "s", NOW);
    expect(q.cards.map((c) => c.wordId)).toEqual([W(1), W(2), W(3), W(4)]);
    expect(q.cards.map((c) => c.isNew)).toEqual([false, false, true, true]);
    expect(q.dueCount).toBe(2);
    expect(q.newCount).toBe(2);
    expect(q.cards[1].labels.good).toBe("10 kun");
  });

  it("caps new cards at 10 per Tashkent day, minus those already introduced today", async () => {
    const fresh = Array.from({ length: 25 }, (_, i) => row(100 + i));
    const a = fakeQueueDb({ due: [], fresh, introducedToday: 0 });
    expect((await getStudyQueueWith(a.db, "s", NOW)).newCount).toBe(DAILY_NEW_LIMIT);

    const b = fakeQueueDb({ due: [], fresh, introducedToday: 7 });
    const qb = await getStudyQueueWith(b.db, "s", NOW);
    expect(qb.newCount).toBe(3);
    expect(b.calls.newLimit).toBe(3);

    const c = fakeQueueDb({ due: [row(1, { reps: 1 })], fresh, introducedToday: 10 });
    const qc = await getStudyQueueWith(c.db, "s", NOW);
    expect(qc.newCount).toBe(0);
    expect(qc.newRemainingToday).toBe(0);
    expect(c.calls.newLimit).toBe(-1); // new cards are not even fetched
    expect(qc.cards).toHaveLength(1);
  });

  it("counts the day from Asia/Tashkent midnight (UTC+5)", async () => {
    // 20:00Z on the 10th is already 01:00 on the 11th in Tashkent.
    const late = new Date("2026-11-10T20:00:00Z");
    expect(tashkentDayStart(late).toISOString()).toBe("2026-11-10T19:00:00.000Z");
    expect(tashkentDayStart(NOW).toISOString()).toBe("2026-11-09T19:00:00.000Z");
    const { db, calls } = fakeQueueDb({ due: [], fresh: [], introducedToday: 0 });
    await getStudyQueueWith(db, "s", late);
    expect(calls.since).toBe("2026-11-10T19:00:00.000Z");
  });

  it("an empty queue is empty", async () => {
    const { db } = fakeQueueDb({ due: [], fresh: [], introducedToday: 0 });
    expect((await getStudyQueueWith(db, "s", NOW)).cards).toEqual([]);
  });
});

/** In-memory store keyed by student+word; mirrors RLS (own cards only) and srs_apply_grade. */
function fakeStore(cards: Record<string, CardRow & { first: boolean }>, role = "student") {
  const bump = vi.fn(async () => undefined);
  const store: SrsStore = {
    getRole: async () => role,
    getCard: async (s, w) => {
      const c = cards[`${s}:${w}`];
      return c ? { ...c } : null;
    },
    applyGrade: async (s, w, next) => {
      const c = cards[`${s}:${w}`];
      if (!c) return null;
      const wasNew = !c.first;
      Object.assign(c, { ...next, first: true });
      return wasNew;
    },
    bumpWordsTask: bump,
    setDifficult: async (s, w, v) => {
      const c = cards[`${s}:${w}`];
      if (!c) return false;
      c.isDifficult = v;
      return true;
    },
  };
  return { store, bump };
}
const card = (n: number): CardRow & { first: boolean } => ({
  wordId: W(n),
  intervalDays: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  dueAt: NOW.toISOString(),
  isDifficult: false,
  first: false,
});

describe("handleSrsGrade", () => {
  it("401 anonymous, 403 non-student, 400 invalid bodies", async () => {
    const { store } = fakeStore({ [`s1:${W(1)}`]: card(1) });
    expect((await handleSrsGrade({ store }, { userId: null, body: {} })).status).toBe(401);
    const staff = fakeStore({}, "curator");
    expect((await handleSrsGrade({ store: staff.store }, { userId: "c", body: { wordId: W(1), grade: "good" } })).status).toBe(403);
    for (const body of [
      null,
      {},
      { wordId: "x", grade: "good" },
      { wordId: W(1), grade: "easy" },
      { wordId: W(1) },
      { wordId: W(1), grade: "good", studentId: "s2" },
    ]) {
      expect((await handleSrsGrade({ store }, { userId: "s1", body })).status).toBe(400);
    }
  });

  it("404 for another student's card or an unknown word (same body)", async () => {
    const { store, bump } = fakeStore({ [`s1:${W(1)}`]: card(1) });
    const a = await handleSrsGrade({ store }, { userId: "s2", body: { wordId: W(1), grade: "good" } });
    const b = await handleSrsGrade({ store }, { userId: "s1", body: { wordId: W(99), grade: "good" } });
    expect(a.status).toBe(404);
    expect(b).toEqual(a);
    expect(bump).not.toHaveBeenCalled();
  });

  it("applies srs.grade server-side and stores ISO due", async () => {
    const cards = { [`s1:${W(1)}`]: card(1) };
    const { store } = fakeStore(cards);
    const r = await handleSrsGrade({ store }, { userId: "s1", body: { wordId: W(1), grade: "good" }, now: NOW });
    expect(r.status).toBe(200);
    const c = (r.json as { card: CardRow }).card;
    expect(c).toMatchObject({ intervalDays: 1, reps: 1, ease: 2.5, dueAt: "2026-11-11T10:00:00.000Z" });
    expect(cards[`s1:${W(1)}`].dueAt).toBe("2026-11-11T10:00:00.000Z");

    const again = await handleSrsGrade({ store }, { userId: "s1", body: { wordId: W(1), grade: "again" }, now: NOW });
    expect((again.json as { card: CardRow }).card).toMatchObject({
      reps: 0,
      lapses: 1,
      ease: 2.3,
      dueAt: "2026-11-10T10:10:00.000Z",
    });
  });

  it("bumps the daily words task exactly once per card (first study only)", async () => {
    const { store, bump } = fakeStore({ [`s1:${W(1)}`]: card(1), [`s1:${W(2)}`]: card(2) });
    const g = (w: number, grade: string) => handleSrsGrade({ store }, { userId: "s1", body: { wordId: W(w), grade }, now: NOW });
    expect(((await g(1, "again")).json as { firstStudy: boolean }).firstStudy).toBe(true);
    expect(bump).toHaveBeenCalledTimes(1);
    expect(((await g(1, "good")).json as { firstStudy: boolean }).firstStudy).toBe(false);
    await g(1, "good");
    expect(bump).toHaveBeenCalledTimes(1);
    await g(2, "good");
    expect(bump).toHaveBeenCalledTimes(2);
    expect(bump).toHaveBeenCalledWith("s1");
  });

  it("a failing bump does not fail the stored grade", async () => {
    const { store, bump } = fakeStore({ [`s1:${W(1)}`]: card(1) });
    bump.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await handleSrsGrade({ store }, { userId: "s1", body: { wordId: W(1), grade: "good" }, now: NOW });
    expect(r.status).toBe(200);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("boom");
    spy.mockRestore();
  });
});

describe("handleSrsDifficult", () => {
  it("toggles is_difficult for the own card, 404 otherwise, 400 on bad value", async () => {
    const cards = { [`s1:${W(1)}`]: card(1) };
    const { store } = fakeStore(cards);
    const r = await handleSrsDifficult({ store }, { userId: "s1", body: { wordId: W(1), value: true } });
    expect(r).toEqual({ status: 200, json: { wordId: W(1), isDifficult: true } });
    expect(cards[`s1:${W(1)}`].isDifficult).toBe(true);
    await handleSrsDifficult({ store }, { userId: "s1", body: { wordId: W(1), value: false } });
    expect(cards[`s1:${W(1)}`].isDifficult).toBe(false);
    expect((await handleSrsDifficult({ store }, { userId: "s2", body: { wordId: W(1), value: true } })).status).toBe(404);
    expect((await handleSrsDifficult({ store }, { userId: "s1", body: { wordId: W(1), value: "yes" } })).status).toBe(400);
    expect((await handleSrsDifficult({ store }, { userId: null, body: {} })).status).toBe(401);
  });
});
