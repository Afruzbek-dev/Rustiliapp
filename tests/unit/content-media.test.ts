import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { signContentUrl, signLessonMedia } from "@/server/content-media";
import { bumpDailyTaskOnce } from "@/server/daily-tasks";
import { createGrammarTaskHook } from "@/server/grammar-task";
import { submitAttempt, type AttemptStore } from "@/server/attempts";

type Block = { id: string; type: string; payload: unknown; published: boolean } | null;

function userClient(block: Block, error: { message: string } | null = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: block, error }) }));
  return {
    client: { from: vi.fn(() => ({ select: () => ({ eq }) })) } as unknown as SupabaseClient,
    eq,
  };
}

function serviceClient(result: { data: { signedUrl: string } | null; error: { message: string } | null } | "throw") {
  const createSignedUrl = vi.fn(async () => {
    if (result === "throw") throw new Error("bucket gone");
    return result;
  });
  const from = vi.fn(() => ({ createSignedUrl }));
  return { client: { storage: { from } } as unknown as SupabaseClient, from, createSignedUrl };
}

const audio = { id: "b1", type: "audio", payload: { path: "l1/own.mp3", title: "A" }, published: true };

describe("signContentUrl", () => {
  it("signs only the block's own path for 1 hour in the content bucket", async () => {
    const u = userClient(audio);
    const s = serviceClient({ data: { signedUrl: "https://signed/x" }, error: null });
    await expect(signContentUrl(u.client, "b1", s.client)).resolves.toEqual({ status: "ok", url: "https://signed/x" });
    expect(s.from).toHaveBeenCalledWith("content");
    expect(s.createSignedUrl).toHaveBeenCalledWith("l1/own.mp3", 3600);
    expect(u.eq).toHaveBeenCalledWith("id", "b1");
  });

  it("works for rule_image blocks", async () => {
    const u = userClient({ id: "b2", type: "rule_image", payload: { path: "r.png", alt: "x" }, published: true });
    const s = serviceClient({ data: { signedUrl: "https://signed/i" }, error: null });
    expect((await signContentUrl(u.client, "b2", s.client)).status).toBe("ok");
    expect(s.createSignedUrl).toHaveBeenCalledWith("r.png", 3600);
  });

  it("404 (not_found) for a block the user cannot see, without touching storage", async () => {
    const s = serviceClient({ data: { signedUrl: "u" }, error: null });
    expect(await signContentUrl(userClient(null).client, "b1", s.client)).toEqual({ status: "not_found" });
    expect(await signContentUrl(userClient({ ...audio, published: false }).client, "b1", s.client)).toEqual({ status: "not_found" });
    expect(s.createSignedUrl).not.toHaveBeenCalled();
  });

  it("not_found for non-media blocks and for malformed / traversing paths", async () => {
    const s = serviceClient({ data: { signedUrl: "u" }, error: null });
    const text = { id: "t", type: "text", payload: { body: "x" }, published: true };
    expect((await signContentUrl(userClient(text).client, "t", s.client)).status).toBe("not_found");
    const evil = { ...audio, payload: { path: "../other/secret.mp3", title: "A" } };
    expect((await signContentUrl(userClient(evil).client, "b1", s.client)).status).toBe("not_found");
    expect(s.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 'unavailable' (not a throw) when the bucket or object is missing", async () => {
    const u = userClient(audio);
    expect(
      await signContentUrl(u.client, "b1", serviceClient({ data: null, error: { message: "Bucket not found" } }).client),
    ).toEqual({ status: "unavailable" });
    expect(await signContentUrl(u.client, "b1", serviceClient("throw").client)).toEqual({ status: "unavailable" });
  });

  it("throws on a user-client read error (surfaced as 500 by the route)", async () => {
    await expect(
      signContentUrl(userClient(null, { message: "rls" }).client, "b1", serviceClient("throw").client),
    ).rejects.toThrow(/rls/);
  });
});

describe("signLessonMedia", () => {
  it("signs audio and rule_image blocks only, null when unavailable", async () => {
    const s = serviceClient({ data: null, error: { message: "Bucket not found" } });
    const out = await signLessonMedia(
      [
        { id: "a", type: "audio", payload: { path: "a.mp3", title: "A" } },
        { id: "t", type: "text", payload: { body: "x" } },
        { id: "u", type: "unsupported", originalType: "x" },
      ],
      s.client,
    );
    expect(out).toEqual({ a: null });
  });
});

// ---------------------------------------------------------------------------------------------
function dailyClient(tasks: Record<string, unknown> | null) {
  const rpc = vi.fn(async () => ({ error: null }));
  const eqDay = vi.fn(() => ({ maybeSingle: async () => ({ data: tasks === null ? null : { tasks }, error: null }) }));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ eq: eqDay }) }) }));
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, eqDay };
}

describe("bumpDailyTaskOnce", () => {
  it("bumps when today has no counter and uses the Tashkent day", async () => {
    const d = dailyClient(null);
    // 2026-11-10 20:00 UTC is already 2026-11-11 in Tashkent
    expect(await bumpDailyTaskOnce(d.client, "s1", "audio", new Date("2026-11-10T20:00:00Z"))).toBe(true);
    expect(d.eqDay).toHaveBeenCalledWith("day", "2026-11-11");
    expect(d.rpc).toHaveBeenCalledWith("bump_daily_task", { p_student: "s1", p_key: "audio", p_inc: 1 });
  });

  it("does not bump twice on the same day", async () => {
    const d = dailyClient({ audio: 1, words: 3 });
    expect(await bumpDailyTaskOnce(d.client, "s1", "audio")).toBe(false);
    expect(d.rpc).not.toHaveBeenCalled();
    const other = dailyClient({ words: 3 });
    expect(await bumpDailyTaskOnce(other.client, "s1", "audio")).toBe(true);
  });
});

describe("grammar task hook", () => {
  function svc(kind: string | null, tasks: Record<string, unknown> | null = null) {
    const rpc = vi.fn(async () => ({ error: null }));
    const from = vi.fn((table: string) => {
      if (table === "lesson_parts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: kind ? { kind } : null, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tasks ? { tasks } : null, error: null }) }) }) }) };
    });
    return { client: { from, rpc } as unknown as SupabaseClient, rpc };
  }
  const info = { studentId: "s1", partId: "p1", exerciseId: "e1" };

  it("bumps 'grammar' for grammar parts only, once per day", async () => {
    const g = svc("grammar");
    await createGrammarTaskHook(g.client)(info);
    expect(g.rpc).toHaveBeenCalledWith("bump_daily_task", { p_student: "s1", p_key: "grammar", p_inc: 1 });

    const conv = svc("conversation");
    await createGrammarTaskHook(conv.client)(info);
    expect(conv.rpc).not.toHaveBeenCalled();

    const again = svc("grammar", { grammar: 1 });
    await createGrammarTaskHook(again.client)(info);
    expect(again.rpc).not.toHaveBeenCalled();
  });
});

describe("submitAttempt onCorrect hook", () => {
  const store = (correct: boolean, partId: string | null = "p1"): AttemptStore =>
    ({
      getRole: async () => "student",
      getVisibleExercise: async () => ({ id: "e1", type: "choose", checkMode: "auto", partId }),
      isTestItem: async () => false,
      getKey: async () => ({ a: 1 }),
      countPriorAttempts: async () => ({ total: 0, correct: 0 }),
      insertAttempt: async () => undefined,
      ensurePartStarted: async () => undefined,
      awardXp: async () => true,
      getPartExercises: async () => [],
      getCorrectRefs: async () => [],
      getSubmittedExerciseIds: async () => [],
      markPartCompleted: async () => false,
      _correct: correct,
    }) as unknown as AttemptStore;

  const input = (index: number) => ({ studentId: "s1", exerciseId: "e1", answer: { itemId: "a", index } });

  it("is called after a correct attempt, not after a wrong one", async () => {
    const onCorrect = vi.fn(async () => undefined);
    await submitAttempt({ store: store(true), onCorrect }, input(1));
    expect(onCorrect).toHaveBeenCalledWith({ studentId: "s1", partId: "p1", exerciseId: "e1" });
    onCorrect.mockClear();
    await submitAttempt({ store: store(false), onCorrect }, input(0));
    expect(onCorrect).not.toHaveBeenCalled();
  });

  it("a failing hook is logged and never fails the attempt", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await submitAttempt(
      { store: store(true), onCorrect: async () => Promise.reject(new Error("pii: secret@example.com")) },
      input(1),
    );
    expect(res.correct).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret@example.com");
    log.mockRestore();
  });
});
