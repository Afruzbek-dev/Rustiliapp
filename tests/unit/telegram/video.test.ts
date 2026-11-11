import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UserFromGetMe } from "grammy/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBot } from "@/lib/telegram/bot";
import { VIDEO_MSG } from "@/lib/telegram/handlers/video";
import { completeStaleVideoSubmissions } from "@/server/video-submissions";
import type { CreateVideoResult, VideoExercise, VideoStore } from "@/server/video-submissions";
import { createFakeDb } from "./fake-db";

const EX = "33333333-3333-4333-8333-333333333333";
const COURSE = "44444444-4444-4444-8444-444444444444";
const GROUP = "55555555-5555-4555-8555-555555555555";
const PART = "66666666-6666-4666-8666-666666666666";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const ARCHIVE = "-100999";

const botInfo = {
  id: 1, is_bot: true, first_name: "Bot", username: "po_russki_bot", can_join_groups: true,
  can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
} as UserFromGetMe;

type Sent = { method: string; payload: Record<string, unknown> };
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (name: string): Json => JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/telegram", `${name}.json`), "utf8"));

function setup(over: { exercise?: Partial<VideoExercise> | null; testItem?: boolean; enrolled?: boolean; noProfile?: boolean; failNotify?: boolean; now?: Date } = {}) {
  const sessions = new Map<number, { exerciseId: string; expiresAt: Date }>();
  const subs: { id: string; studentId: string; exerciseId: string; group: string | null; fileUniqueId: string; archive: number; notifiedAt: string | null; claimed: boolean; createdAt: number }[] = [];
  const calls = { notify: [] as string[], bump: 0, partXp: [] as string[], cleanup: [] as (number | "all")[] };
  let partDone = false;
  const exercise: VideoExercise | null =
    over.exercise === null ? null : { id: EX, type: "speaking", checkMode: "review", courseId: COURSE, partId: PART, ...over.exercise };
  let clock = over.now ?? new Date("2026-11-10T07:00:00Z");
  const world = { enrolled: over.enrolled !== false, race: null as null | "rate_limited" | "duplicate_other", random: 0.5 };

  const store: VideoStore = {
    getProfileByTelegramId: async (tid) => (over.noProfile || tid !== 777 ? null : { id: STUDENT }),
    getExercise: async (id) => (exercise && exercise.id === id ? exercise : null),
    isTestItem: async () => over.testItem ?? false,
    getActiveEnrollment: async () => (world.enrolled ? { curatorGroupId: GROUP } : null),
    upsertSession: async (tid, exerciseId, expiresAt) => void sessions.set(tid, { exerciseId, expiresAt }),
    getLiveSession: async (tid, now) => {
      const s = sessions.get(tid);
      return s && s.expiresAt > now ? { exerciseId: s.exerciseId } : null;
    },
    deleteSession: async (tid) => void sessions.delete(tid),
    deleteExpiredSessions: async (before, tid) => {
      calls.cleanup.push(tid ?? "all");
      for (const [k, v] of sessions) if (v.expiresAt < new Date(before) && (tid === undefined || k === tid)) sessions.delete(k);
    },
    findVideoByUnique: async (u) => {
      const s = subs.find((x) => x.fileUniqueId === u);
      return s ? { id: s.id, studentId: s.studentId, exerciseId: s.exerciseId, notifiedAt: s.notifiedAt } : null;
    },
    countRecentVideos: async (sid, ex, since) => subs.filter((x) => x.studentId === sid && x.exerciseId === ex && x.createdAt > Date.parse(since)).length,
    listStaleVideos: async (olderThan) =>
      subs.filter((s) => !s.notifiedAt && s.createdAt < Date.parse(olderThan)).map((s) => ({ id: s.id, studentId: s.studentId, exerciseId: s.exerciseId })),
    createVideoSubmission: async (r): Promise<CreateVideoResult> => {
      if (world.race) return { outcome: world.race };
      const dup = subs.find((x) => x.fileUniqueId === r.fileUniqueId);
      if (dup) return dup.studentId === r.studentId && dup.exerciseId === r.exerciseId ? { outcome: "duplicate", submissionId: dup.id } : { outcome: "duplicate_other" };
      if (subs.filter((x) => x.studentId === r.studentId && x.exerciseId === r.exerciseId && x.createdAt > clock.getTime() - 600_000).length >= 3) return { outcome: "rate_limited" };
      const id = `00000000-0000-4000-8000-${String(subs.length + 1).padStart(12, "0")}`;
      subs.push({ id, studentId: r.studentId, exerciseId: r.exerciseId, group: r.curatorGroupId, fileUniqueId: r.fileUniqueId, archive: r.archiveMessageId, notifiedAt: null, claimed: false, createdAt: clock.getTime() });
      return { outcome: "ok", submissionId: id };
    },
    hasOtherCompletedSince: async (sid, ex) => subs.some((s) => s.studentId === sid && s.id !== ex),
    claimNotification: async (id) => {
      const s = subs.find((x) => x.id === id)!;
      if (s.notifiedAt || s.claimed) return null;
      s.claimed = true;
      return "tok";
    },
    releaseNotification: async (id) => void (subs.find((x) => x.id === id)!.claimed = false),
    markNotified: async (id) => void (subs.find((x) => x.id === id)!.notifiedAt = "now"),
    getPartExercises: async () => [{ id: EX, type: "speaking", checkMode: "review", key: null }],
    getCorrectRefs: async () => [],
    getSubmittedExerciseIds: async () => (subs.length ? [EX] : []),
    ensurePartStarted: async () => undefined,
    markPartCompleted: async () => {
      const first = !partDone;
      partDone = true;
      return first;
    },
    awardXp: async (_s, _a, _r, ref) => {
      if (calls.partXp.includes(ref)) return false;
      calls.partXp.push(ref);
      return true;
    },
  };

  const fake = createFakeDb({});
  const wiring = {
    deps: () => ({
      store,
      bumpSpeaking: async () => void calls.bump++,
      notify: async (id: string) => {
        if (over.failNotify) throw new Error("tg down");
        calls.notify.push(id);
      },
      now: () => clock,
      random: () => world.random,
    }),
    archiveChatId: () => ARCHIVE,
  };
  const bot = createBot("123:TEST", () => fake.db, botInfo, wiring);
  const sent: Sent[] = [];
  let nextArchiveId = 900;
  bot.api.config.use((_prev, method, payload) => {
    sent.push({ method, payload: payload as unknown as Record<string, unknown> });
    if (method === "copyMessage") return Promise.resolve({ ok: true, result: { message_id: nextArchiveId++ } } as never);
    return Promise.resolve({ ok: true, result: true } as never);
  });
  return { bot, sent, subs, sessions, calls, world, deps: wiring.deps, setClock: (d: Date) => (clock = d) };
}

const of = (sent: Sent[], m: string) => sent.filter((s) => s.method === m);
const texts = (sent: Sent[]) => of(sent, "sendMessage").map((s) => s.payload.text);
const send = (t: ReturnType<typeof setup>, u: Json) => t.bot.handleUpdate(u as never);
const note = (over: Json = {}, id = 202): Json => ({ ...fixture("video-note"), update_id: id, ...over });

describe("telegram video flow", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "w".repeat(40));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", "2");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  describe("/start task_<id>", () => {
    it("opens a 30-minute session and asks for the video", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      expect(texts(t.sent)).toEqual([VIDEO_MSG.started]);
      const s = t.sessions.get(777)!;
      expect(s.exerciseId).toBe(EX);
      expect(s.expiresAt.getTime() - Date.parse("2026-11-10T07:00:00Z")).toBe(30 * 60 * 1000);
    });

    it("unknown telegram user: 'Avval ilovada kiring', no session", async () => {
      const t = setup({ noProfile: true });
      await send(t, fixture("start-task"));
      expect(texts(t.sent)).toEqual([VIDEO_MSG.unknownUser]);
      expect(t.sessions.size).toBe(0);
    });

    it.each([
      ["unknown exercise", { exercise: null }],
      ["unpublished block", { exercise: { partId: null } }],
      ["auto exercise", { exercise: { checkMode: "auto" as const } }],
      ["wrong type", { exercise: { type: "classify" } }],
      ["test item", { testItem: true }],
      ["not enrolled (foreign course)", { enrolled: false }],
    ])("%s is refused and creates no session", async (_n, over) => {
      const t = setup(over);
      await send(t, fixture("start-task"));
      expect(texts(t.sent)).toEqual([VIDEO_MSG.notAvailable]);
      expect(t.sessions.size).toBe(0);
    });

    it("a malformed payload is not a task link (nothing happens)", async () => {
      const t = setup();
      const u = fixture("start-task");
      u.message.text = "/start task_not-a-uuid";
      await send(t, u);
      expect(t.sent).toHaveLength(0);
      expect(t.sessions.size).toBe(0);
    });

    it("login deep links still reach the login handler (fall through)", async () => {
      const t = setup();
      const u = fixture("start-login");
      await send(t, u);
      // the fake db has no nonce: the login handler answers 'expired', proving next() ran
      expect(texts(t.sent)).toHaveLength(1);
      expect(t.sessions.size).toBe(0);
    });
  });

  describe("video messages", () => {
    it("without a session: asks to press the button in the app, nothing stored or copied", async () => {
      const t = setup();
      await send(t, note());
      expect(texts(t.sent)).toEqual([VIDEO_MSG.noSession]);
      expect(t.subs).toHaveLength(0);
      expect(of(t.sent, "copyMessage")).toHaveLength(0);
    });

    it("with an expired session: same refusal", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      t.setClock(new Date("2026-11-10T07:31:00Z"));
      await send(t, note());
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.noSession);
      expect(t.subs).toHaveLength(0);
    });

    it("video from an unknown sender is refused", async () => {
      const t = setup();
      const u = note();
      u.message.from.id = 999;
      u.message.chat.id = 999;
      await send(t, u);
      expect(texts(t.sent)).toEqual([VIDEO_MSG.unknownUser]);
      expect(t.subs).toHaveLength(0);
    });

    it("videos in a group chat are ignored", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      const u = note();
      u.message.chat = { id: -5, type: "supergroup", title: "G" };
      await send(t, u);
      expect(t.subs).toHaveLength(0);
      expect(of(t.sent, "copyMessage")).toHaveLength(0);
    });

    it("an enrollment that lapsed after /start: refused, session dropped, nothing copied", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      t.world.enrolled = false;
      await send(t, note());
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.notAvailable);
      expect(t.sessions.size).toBe(0);
      expect(t.subs).toHaveLength(0);
      expect(of(t.sent, "copyMessage")).toHaveLength(0);
    });

    it("oversize video: asks for a shorter one and stores nothing", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      const u = fixture("video");
      u.message.video.file_size = 21 * 1024 * 1024;
      await send(t, u);
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.tooBig);
      expect(t.subs).toHaveLength(0);
      expect(of(t.sent, "copyMessage")).toHaveLength(0);
      expect(t.sessions.has(777)).toBe(true);
    });

    it("success: copies to the archive chat, stores the submission with the server-side group, completes once, confirms, drops the session", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await send(t, note());
      const copy = of(t.sent, "copyMessage");
      expect(copy).toHaveLength(1);
      expect(copy[0]!.payload).toMatchObject({ chat_id: ARCHIVE, from_chat_id: 777, message_id: 11 });
      expect(t.subs).toHaveLength(1);
      expect(t.subs[0]).toMatchObject({ studentId: STUDENT, exerciseId: EX, group: GROUP, archive: 900, notifiedAt: "now" });
      expect(t.calls.partXp).toEqual([PART]);
      expect(t.calls.bump).toBe(1);
      expect(t.calls.notify).toEqual([t.subs[0]!.id]);
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.accepted);
      expect(t.sessions.size).toBe(0);
    });

    it("a regular video (not a note) is accepted too", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await send(t, fixture("video"));
      expect(t.subs).toHaveLength(1);
      expect(t.subs[0]!.fileUniqueId).toBe("UNIQ-2");
    });

    it("the same update delivered twice: one submission, one archive copy, one confirmation", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await send(t, note());
      await send(t, note());
      expect(t.subs).toHaveLength(1);
      expect(of(t.sent, "copyMessage")).toHaveLength(1);
      expect(t.calls.notify).toHaveLength(1);
      expect(texts(t.sent).filter((x) => x === VIDEO_MSG.accepted)).toHaveLength(1);
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.already);
    });

    it("two simultaneous deliveries: one submission, one notice", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await Promise.all([send(t, note()), send(t, note())]);
      expect(t.subs).toHaveLength(1);
      expect(t.calls.notify).toHaveLength(1);
      expect(t.calls.bump).toBe(1);
    });

    it("rate limit: a fourth different video within 10 minutes is refused", async () => {
      const t = setup();
      for (let i = 1; i <= 4; i++) {
        await send(t, fixture("start-task"));
        const u = note({}, 300 + i);
        u.message.video_note.file_unique_id = `U${i}`;
        await send(t, u);
      }
      expect(t.subs).toHaveLength(3);
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.rateLimited);
      // the pre-check refuses BEFORE the copy: the archive chat is not flooded
      expect(of(t.sent, "copyMessage")).toHaveLength(3);
      expect(of(t.sent, "deleteMessage")).toHaveLength(0);
    });

    it("a duplicate file (own, already processed) is not copied again", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await send(t, note());
      await send(t, fixture("start-task"));
      await send(t, note({}, 777));
      expect(of(t.sent, "copyMessage")).toHaveLength(1);
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.already);
    });

    it("the same file for ANOTHER exercise says so without revealing anything else", async () => {
      const t = setup();
      await send(t, fixture("start-task"));
      await send(t, note());
      t.sessions.set(777, { exerciseId: "99999999-9999-4999-8999-999999999999", expiresAt: new Date("2026-11-10T08:00:00Z") });
      await send(t, note({}, 778));
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.duplicateElsewhere);
      expect(of(t.sent, "copyMessage")).toHaveLength(1);
    });

    it("a copy that turns out to be unused (race lost inside the lock) is deleted from the archive chat", async () => {
      for (const race of ["rate_limited", "duplicate_other"] as const) {
        const t = setup();
        await send(t, fixture("start-task"));
        t.world.race = race;
        await send(t, note());
        expect(of(t.sent, "copyMessage")).toHaveLength(1);
        const del = of(t.sent, "deleteMessage");
        expect(del).toHaveLength(1);
        expect(del[0]!.payload).toMatchObject({ chat_id: ARCHIVE, message_id: 900 });
        expect(texts(t.sent).at(-1)).toBe(race === "rate_limited" ? VIDEO_MSG.rateLimited : VIDEO_MSG.duplicateOther);
        expect(t.subs).toHaveLength(0);
      }
    });

    it("a stored but unfinished video: re-sending the SAME file completes it even without a live session", async () => {
      const t = setup();
      t.subs.push({ id: "00000000-0000-4000-8000-0000000000aa", studentId: STUDENT, exerciseId: EX, group: GROUP, fileUniqueId: "UNIQ-1", archive: 5, notifiedAt: null, claimed: false, createdAt: 0 });
      await send(t, note()); // no /start, no session
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.accepted);
      expect(t.subs).toHaveLength(1);
      expect(t.subs[0]!.notifiedAt).toBe("now");
      expect(t.calls.notify).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
      expect(of(t.sent, "copyMessage")).toHaveLength(0);
    });

    it("while another worker still holds the lease the student is told it is in progress, not 'already'", async () => {
      const t = setup();
      t.subs.push({ id: "00000000-0000-4000-8000-0000000000aa", studentId: STUDENT, exerciseId: EX, group: GROUP, fileUniqueId: "UNIQ-1", archive: 5, notifiedAt: null, claimed: true, createdAt: 0 });
      await send(t, note());
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.inProgress);
      expect(t.calls.notify).toEqual([]);
    });

    it("/start task_ from a group chat is ignored", async () => {
      const t = setup();
      const u = fixture("start-task");
      u.message.chat = { id: -5, type: "supergroup", title: "G" };
      await send(t, u);
      expect(t.sessions.size).toBe(0);
      expect(t.sent).toHaveLength(0);
    });

    it("/start cleans this user's long-expired session and sweeps globally 1 time in 50", async () => {
      const t = setup();
      t.sessions.set(5, { exerciseId: EX, expiresAt: new Date("2026-11-01T00:00:00Z") });
      await send(t, fixture("start-task"));
      expect(t.calls.cleanup).toEqual([777]);
      expect(t.sessions.has(5)).toBe(true);
      t.world.random = 0.01;
      await send(t, fixture("start-task"));
      expect(t.calls.cleanup).toEqual([777, 777, "all"]);
      expect(t.sessions.has(5)).toBe(false);
    });

    it("the sweeper completes stored, un-notified videos older than 2 minutes (and only once)", async () => {
      const t = setup();
      t.subs.push({ id: "00000000-0000-4000-8000-0000000000aa", studentId: STUDENT, exerciseId: EX, group: GROUP, fileUniqueId: "S1", archive: 5, notifiedAt: null, claimed: false, createdAt: Date.parse("2026-11-10T06:00:00Z") });
      t.subs.push({ id: "00000000-0000-4000-8000-0000000000bb", studentId: STUDENT, exerciseId: EX, group: GROUP, fileUniqueId: "S2", archive: 6, notifiedAt: null, claimed: false, createdAt: Date.parse("2026-11-10T06:59:30Z") });
      expect(await completeStaleVideoSubmissions(t.deps())).toBe(1);
      expect(t.calls.notify).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
      expect(await completeStaleVideoSubmissions(t.deps())).toBe(0);
    });

    it("a file already stored for another student is refused without leaking or completing anything", async () => {
      const t = setup();
      t.subs.push({ id: "x", studentId: "other", exerciseId: EX, group: null, fileUniqueId: "UNIQ-1", archive: 1, notifiedAt: null, claimed: false, createdAt: 0 });
      await send(t, fixture("start-task"));
      await send(t, note());
      expect(texts(t.sent).at(-1)).toBe(VIDEO_MSG.duplicateOther);
      expect(t.calls.notify).toEqual([]);
    });

    it("a notify failure keeps the session, releases the lease and tells the student", async () => {
      const failing = setup({ failNotify: true });
      await send(failing, fixture("start-task"));
      await send(failing, note());
      expect(texts(failing.sent).at(-1)).toBe(VIDEO_MSG.notifyFailed);
      expect(failing.sessions.has(777)).toBe(true);
      expect(failing.subs[0]!.notifiedAt).toBeNull();
      expect(failing.subs[0]!.claimed).toBe(false);
      expect(of(failing.sent, "copyMessage")).toHaveLength(1);
    });
  });
});
