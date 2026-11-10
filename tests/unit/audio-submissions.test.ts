import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAudioComplete,
  handleAudioUpload,
  readSmallJson,
  type AudioDeps,
  type AudioStore,
  type AudioSubmissionRow,
  type SpeakingExercise,
} from "@/server/audio-submissions";
import { noopCuratorNotifier, notifyCuratorsOfSubmission, setCuratorNotifier } from "@/server/notify-curators";

const S = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const EX = "33333333-3333-4333-8333-333333333333";
const COURSE = "44444444-4444-4444-8444-444444444444";
const GROUP = "55555555-5555-4555-8555-555555555555";
const PART = "66666666-6666-4666-8666-666666666666";
const NEWID = "77777777-7777-4777-8777-777777777777";

function setup(over: { limited?: boolean; failPartOnce?: boolean; exercise?: Partial<SpeakingExercise> | null; testItem?: boolean; enrolled?: boolean; role?: string } = {}) {
  const subs = new Map<string, AudioSubmissionRow & { createdAt: number }>();
  const objects = new Map<string, { name: string; size: number }>();
  const awarded: string[] = [];
  let partDone = false;
  const failed = { done: false };
  const exercise: SpeakingExercise | null =
    over.exercise === null
      ? null
      : { id: EX, type: "speaking", checkMode: "review", courseId: COURSE, partId: PART, ...over.exercise };
  const calls = { signed: [] as string[], bump: 0, notify: [] as string[] };
  const nowMs = Date.parse("2026-11-10T07:00:00Z");

  const store: AudioStore = {
    getRole: async () => over.role ?? "student",
    getVisibleExercise: async (id) => (exercise && exercise.id === id ? exercise : null),
    isTestItem: async () => over.testItem ?? false,
    getActiveEnrollment: async () => (over.enrolled === false ? null : { curatorGroupId: GROUP }),
    createAudioSubmission: async (r) => {
      if (over.limited) return { limited: true };
      subs.set(NEWID, { id: NEWID, studentId: r.studentId, exerciseId: r.exerciseId, kind: "audio", storagePath: null, notifiedAt: null, createdAt: nowMs });
      (store as unknown as { lastGroup: string | null }).lastGroup = r.curatorGroupId;
      return { submissionId: NEWID };
    },
    createSignedUpload: async (path) => {
      calls.signed.push(path);
      return { uploadUrl: "https://x.test/upload", token: "tok" };
    },
    getSubmission: async (id) => subs.get(id) ?? null,
    findObject: async (sid, id) => objects.get(`${sid}/${id}`) ?? null,
    markComplete: async (id, sid, path) => {
      const s = subs.get(id)!;
      if (s.storagePath || s.studentId !== sid) return false;
      s.storagePath = path;
      return true;
    },
    hasOtherCompletedSince: async (sid, ex) => [...subs.values()].some((s) => s.studentId === sid && s.id !== ex && s.storagePath),
    getExerciseInfo: async () => ({ partId: PART, courseId: COURSE }),
    markNotified: async (id) => {
      subs.get(id)!.notifiedAt = "now";
    },
    getPartExercises: async () => {
      if (over.failPartOnce && !failed.done) {
        failed.done = true;
        throw new Error("boom");
      }
      return [{ id: EX, type: "speaking", checkMode: "review", key: null }];
    },
    getCorrectRefs: async () => [],
    getSubmittedExerciseIds: async (sid) => ([...subs.values()].some((s) => s.studentId === sid && s.storagePath) ? [EX] : []),
    ensurePartStarted: async () => undefined,
    markPartCompleted: async () => {
      const first = !partDone;
      partDone = true;
      return first;
    },
    awardXp: async (_s, _a, _r, ref) => {
      if (awarded.includes(ref)) return false;
      awarded.push(ref);
      return true;
    },
  };
  const deps: AudioDeps = {
    store,
    bumpSpeaking: async () => void calls.bump++,
    notify: async (id) => void calls.notify.push(id),
    now: () => new Date(nowMs),
  };
  return { store, deps, subs, objects, calls, awarded };
}

const up = (deps: AudioDeps, body: unknown, userId: string | null = S) => handleAudioUpload(deps, { userId, body });
const done = (deps: AudioDeps, body: unknown, userId: string | null = S) => handleAudioComplete(deps, { userId, body });

describe("audio-upload", () => {
  it("401 without a session, 403 for non-students", async () => {
    expect((await up(setup().deps, { exerciseId: EX, mime: "audio/webm" }, null)).status).toBe(401);
    expect((await up(setup({ role: "curator" }).deps, { exerciseId: EX, mime: "audio/webm" })).status).toBe(403);
  });

  it("400 on bad body, extra keys and disallowed mime", async () => {
    const { deps } = setup();
    expect((await up(deps, { exerciseId: "nope", mime: "audio/webm" })).status).toBe(400);
    expect((await up(deps, { exerciseId: EX, mime: "audio/webm", studentId: OTHER })).status).toBe(400);
    expect((await up(deps, { exerciseId: EX, mime: "video/mp4" })).json).toEqual({ error: "invalid_mime" });
    expect((await up(deps, { exerciseId: EX, mime: "audio/mpeg" })).status).toBe(400);
  });

  it("404 for unknown, unpublished (no block), auto, wrong-type, test-only and unenrolled exercises", async () => {
    const cases = [
      setup({ exercise: null }),
      setup({ exercise: { partId: null } }),
      setup({ exercise: { checkMode: "auto" } }),
      setup({ exercise: { type: "classify" } }),
      setup({ testItem: true }),
      setup({ enrolled: false }),
    ];
    for (const c of cases) {
      const r = await up(c.deps, { exerciseId: EX, mime: "audio/webm" });
      expect(r).toEqual({ status: 404, json: { error: "not_found" } });
    }
  });

  it("creates a pending row without storage_path, group from enrollment, signed path with ext", async () => {
    const { deps, subs, calls, store } = setup();
    const r = await up(deps, { exerciseId: EX, mime: "audio/mp4;codecs=mp4a.40.2" });
    expect(r).toEqual({ status: 200, json: { submissionId: NEWID, uploadUrl: "https://x.test/upload", token: "tok" } });
    expect(calls.signed).toEqual([`${S}/${NEWID}.mp4`]);
    expect(subs.get(NEWID)?.storagePath).toBeNull();
    expect((store as unknown as { lastGroup: string }).lastGroup).toBe(GROUP);
  });

  it("open_text exercises are accepted", async () => {
    const { deps } = setup({ exercise: { type: "open_text" } });
    expect((await up(deps, { exerciseId: EX, mime: "audio/ogg" })).status).toBe(200);
  });

  it("maps the SQL rate limit to 429", async () => {
    const { deps } = setup({ limited: true });
    expect(await up(deps, { exerciseId: EX, mime: "audio/webm" })).toEqual({ status: 429, json: { error: "rate_limited" } });
  });
});

describe("audio-complete", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    t = setup();
    await up(t.deps, { exerciseId: EX, mime: "audio/webm" });
  });

  it("401 / 400", async () => {
    expect((await done(t.deps, { submissionId: NEWID }, null)).status).toBe(401);
    expect((await done(t.deps, { submissionId: "x" })).status).toBe(400);
  });

  it("another student gets 404 and nothing changes", async () => {
    const r = await done(t.deps, { submissionId: NEWID }, OTHER);
    expect(r.status).toBe(404);
    expect(t.subs.get(NEWID)?.storagePath).toBeNull();
  });

  it("unknown submission is 404", async () => {
    expect((await done(t.deps, { submissionId: OTHER })).status).toBe(404);
  });

  it("409 when the object was never uploaded", async () => {
    expect((await done(t.deps, { submissionId: NEWID })).json).toEqual({ error: "upload_missing" });
    expect(t.subs.get(NEWID)?.storagePath).toBeNull();
    expect(t.calls.notify).toEqual([]);
  });

  it("rejects empty and oversize objects", async () => {
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 0 });
    expect((await done(t.deps, { submissionId: NEWID })).status).toBe(400);
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 10 * 1024 * 1024 + 1 });
    expect((await done(t.deps, { submissionId: NEWID })).status).toBe(413);
    expect(t.subs.get(NEWID)?.storagePath).toBeNull();
  });

  it("completes: marks path, completes the part, bumps speaking, notifies", async () => {
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    const r = await done(t.deps, { submissionId: NEWID });
    expect(r).toEqual({ status: 200, json: { ok: true, alreadyComplete: false } });
    expect(t.subs.get(NEWID)?.storagePath).toBe(`${S}/${NEWID}.webm`);
    expect(t.awarded).toEqual([PART]);
    expect(t.calls.bump).toBe(1);
    expect(t.calls.notify).toEqual([NEWID]);
  });

  it("is idempotent: a second call changes nothing and does not bump or notify again", async () => {
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    await done(t.deps, { submissionId: NEWID });
    const r = await done(t.deps, { submissionId: NEWID });
    expect(r).toEqual({ status: 200, json: { ok: true, alreadyComplete: true } });
    expect(t.awarded).toEqual([PART]);
    expect(t.calls.bump).toBe(1);
    expect(t.calls.notify).toHaveLength(1);
  });

  it("bumps the daily task only once per day across submissions", async () => {
    t.subs.set("earlier", { id: "earlier", studentId: S, exerciseId: EX, kind: "audio", storagePath: `${S}/earlier.webm`, notifiedAt: null, createdAt: Date.parse("2026-11-10T05:00:00Z") });
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    await done(t.deps, { submissionId: NEWID });
    expect(t.calls.bump).toBe(0);
  });

  it("a failure after markComplete is finished by the retry exactly once; a third call does nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = setup({ failPartOnce: true });
    await up(f.deps, { exerciseId: EX, mime: "audio/webm" });
    f.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    expect((await done(f.deps, { submissionId: NEWID })).status).toBe(500);
    expect(f.subs.get(NEWID)?.storagePath).toBe(`${S}/${NEWID}.webm`);
    expect(f.calls.bump + f.calls.notify.length).toBe(0);
    const retry = await done(f.deps, { submissionId: NEWID });
    expect(retry).toEqual({ status: 200, json: { ok: true, alreadyComplete: false } });
    expect(f.calls.bump).toBe(1);
    expect(f.calls.notify).toEqual([NEWID]);
    expect(f.awarded).toEqual([PART]);
    expect((await done(f.deps, { submissionId: NEWID })).json).toEqual({ ok: true, alreadyComplete: true });
    expect(f.calls.bump).toBe(1);
    expect(f.calls.notify).toHaveLength(1);
  });

  it("404 when the enrollment lapsed before completion", async () => {
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    t.store.getActiveEnrollment = async () => null;
    expect((await done(t.deps, { submissionId: NEWID })).status).toBe(404);
    expect(t.subs.get(NEWID)?.storagePath).toBeNull();
  });

  it("a notifier failure does not fail the request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    t.objects.set(`${S}/${NEWID}`, { name: `${S}/${NEWID}.webm`, size: 5000 });
    const r = await done({ ...t.deps, notify: async () => Promise.reject(new Error("tg down")) }, { submissionId: NEWID });
    expect(r.status).toBe(200);
    expect(t.subs.get(NEWID)?.notifiedAt).toBeNull();
  });
});

describe("readSmallJson", () => {
  it("caps the body at 4 KB", async () => {
    const big = new Request("http://x", { method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) });
    expect(await readSmallJson(big)).toEqual({ ok: false, status: 413 });
    const streamed = new Request("http://x", {
      method: "POST",
      body: new ReadableStream({
        pull(c) {
          c.enqueue(new TextEncoder().encode("x".repeat(3000)));
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readSmallJson(streamed)).toEqual({ ok: false, status: 413 });
    expect(await readSmallJson(new Request("http://x", { method: "POST", body: "{" }))).toEqual({ ok: false, status: 400 });
    expect(await readSmallJson(new Request("http://x", { method: "POST", body: '{"a":1}' }))).toEqual({ ok: true, body: { a: 1 } });
  });
});

describe("notify-curators default", () => {
  it("logs only the submission id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    setCuratorNotifier(noopCuratorNotifier);
    await notifyCuratorsOfSubmission(NEWID);
    expect(info).toHaveBeenCalledWith("notify-curators: submission ready", NEWID);
  });
});
