import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assignCuratorFn,
  bulkMoveFn,
  classifyDbError,
  createCohortFn,
  createGroupFn,
  endOfTashkentDay,
  findCuratorsFn,
  linkTelegramFn,
  ManageDbError,
  moveStudentFn,
  reassignGroupFn,
  setCohortAccessFn,
  setExpiryFn,
  supabaseManageDb,
  updateCohortFn,
  updateGroupFn,
  type ManageDb,
  type TelegramLinkDeps,
} from "@/server/manage";
import { telegramLinkDeps } from "@/server/telegram-link";

const U = () => randomUUID();
const ACTOR = U();

/** A fake port: every method is a spy; `deny` makes them behave like a foreign teacher. */
function fakeDb(over: Partial<ManageDb> = {}): ManageDb & Record<keyof ManageDb, ReturnType<typeof vi.fn>> {
  const db = {
    moveStudent: vi.fn(async () => ({ changed: true })),
    bulkMove: vi.fn(async (_a: string, _c: string, _g: string | null, ids: string[]) => ids.length),
    reassignGroup: vi.fn(async () => 3),
    setExpiry: vi.fn(async () => undefined),
    createCohort: vi.fn(async () => "cohort-1"),
    updateCohort: vi.fn(async () => undefined),
    setCohortAccess: vi.fn(async () => undefined),
    createGroup: vi.fn(async () => "group-1"),
    updateGroup: vi.fn(async () => undefined),
    assignCurator: vi.fn(async () => ({ promoted: true })),
    findCurators: vi.fn(async () => []),
    linkTelegram: vi.fn(async () => undefined),
    revertTelegramLink: vi.fn(async () => undefined),
    ...over,
  };
  return db as never;
}
const denied = () => vi.fn(async () => { throw new ManageDbError("forbidden"); });

describe("input validation (nothing reaches the database)", () => {
  it("rejects malformed ids, names and dates", async () => {
    const db = fakeDb();
    expect(await moveStudentFn(db, ACTOR, { enrollmentId: "nope", groupId: null })).toMatchObject({ ok: false, code: "invalid" });
    expect(await bulkMoveFn(db, ACTOR, { cohortId: U(), groupId: null, enrollmentIds: [] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await bulkMoveFn(db, ACTOR, { cohortId: U(), groupId: null, enrollmentIds: Array.from({ length: 101 }, U) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await setExpiryFn(db, ACTOR, { enrollmentId: U(), expiresOn: "2026-02-31" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await setExpiryFn(db, ACTOR, { enrollmentId: U(), expiresOn: "tomorrow" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createGroupFn(db, ACTOR, { cohortId: U(), name: "   ", chatId: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createGroupFn(db, ACTOR, { cohortId: U(), name: "X", chatId: "12abc" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createGroupFn(db, ACTOR, { cohortId: U(), name: "X".repeat(81) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createCohortFn(db, ACTOR, { courseId: U(), name: "K", startsOn: "2026-10-01", endsOn: "2026-09-01" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateCohortFn(db, ACTOR, { cohortId: "x", name: "K" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await setCohortAccessFn(db, ACTOR, { cohortId: U(), open: true })).toMatchObject({ ok: false, code: "invalid" });
    expect(await findCuratorsFn(db, ACTOR, { query: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await reassignGroupFn(db, ACTOR, { cohortId: U(), fromGroupId: "g", toGroupId: null })).toMatchObject({ ok: false, code: "invalid" });
    const same = U();
    expect(await reassignGroupFn(db, ACTOR, { cohortId: U(), fromGroupId: same, toGroupId: same })).toMatchObject({ ok: false, code: "invalid" });
    expect(await reassignGroupFn(db, ACTOR, { cohortId: U(), fromGroupId: U(), toGroupId: null, limit: 101 })).toMatchObject({ ok: false, code: "invalid" });
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("authorised calls", () => {
  it("moves a student, normalising an empty group to 'remove from group'", async () => {
    const db = fakeDb();
    const enrollmentId = U();
    const r = await moveStudentFn(db, ACTOR, { enrollmentId, groupId: "" });
    expect(r).toMatchObject({ ok: true, message: "Guruhdan chiqarildi" });
    expect(db.moveStudent).toHaveBeenCalledWith(ACTOR, enrollmentId, null);
    const g = U();
    expect(await moveStudentFn(db, ACTOR, { enrollmentId, groupId: g })).toMatchObject({ ok: true, message: "Guruh almashtirildi" });
    expect(db.moveStudent).toHaveBeenLastCalledWith(ACTOR, enrollmentId, g);
  });

  it("reports an unchanged move", async () => {
    const db = fakeDb({ moveStudent: vi.fn(async () => ({ changed: false })) });
    expect(await moveStudentFn(db, ACTOR, { enrollmentId: U(), groupId: U() })).toMatchObject({ ok: true, changed: false });
  });

  it("bulk move de-duplicates ids and reports the count", async () => {
    const db = fakeDb();
    const id = U();
    const r = await bulkMoveFn(db, ACTOR, { cohortId: U(), groupId: U(), enrollmentIds: [id, id, U()] });
    expect(r).toMatchObject({ ok: true, moved: 2 });
    expect(db.bulkMove.mock.calls[0]![3]).toHaveLength(2);
    expect(await bulkMoveFn(db, ACTOR, { cohortId: U(), groupId: null, enrollmentIds: Array.from({ length: 100 }, U) })).toMatchObject({ ok: true, moved: 100 });
  });

  it("converts a calendar date into the end of that Tashkent day", async () => {
    expect(endOfTashkentDay("2026-12-31")).toBe("2026-12-31T18:59:59.000Z");
    const db = fakeDb();
    const enrollmentId = U();
    expect(await setExpiryFn(db, ACTOR, { enrollmentId, expiresOn: "2026-12-31" })).toMatchObject({ ok: true });
    expect(db.setExpiry).toHaveBeenCalledWith(ACTOR, enrollmentId, "2026-12-31T18:59:59.000Z");
  });

  it("creates cohorts and groups, trimming names and validating the chat id", async () => {
    const db = fakeDb();
    const course = U();
    expect(await createCohortFn(db, ACTOR, { courseId: course, name: "  Potok 3 ", startsOn: "2026-09-01", endsOn: "", accessUntil: "2026-12-01" })).toMatchObject({ ok: true, cohortId: "cohort-1" });
    expect(db.createCohort).toHaveBeenCalledWith(ACTOR, course, { name: "Potok 3", startsOn: "2026-09-01", endsOn: null, accessUntilIso: "2026-12-01T18:59:59.000Z" });
    const cohortId = U();
    expect(await createGroupFn(db, ACTOR, { cohortId, name: " G1 ", chatId: "-1001234567890" })).toMatchObject({ ok: true, groupId: "group-1" });
    expect(db.createGroup).toHaveBeenCalledWith(ACTOR, cohortId, "G1", "-1001234567890");
    expect(await updateGroupFn(db, ACTOR, { groupId: U(), name: "G2", chatId: "" })).toMatchObject({ ok: true });
    expect(db.updateGroup.mock.calls[0]![3]).toBeNull();
  });

  it("opens a cohort only with a date; closes without one", async () => {
    const db = fakeDb();
    const cohortId = U();
    expect(await setCohortAccessFn(db, ACTOR, { cohortId, open: false })).toMatchObject({ ok: true, message: "Qabul yopildi" });
    expect(db.setCohortAccess).toHaveBeenLastCalledWith(ACTOR, cohortId, false, null);
    expect(await setCohortAccessFn(db, ACTOR, { cohortId, open: true, until: "2027-01-15" })).toMatchObject({ ok: true, message: "Qabul ochildi" });
    expect(db.setCohortAccess).toHaveBeenLastCalledWith(ACTOR, cohortId, true, "2027-01-15T18:59:59.000Z");
  });

  it("assigns and unassigns a curator", async () => {
    const db = fakeDb();
    const groupId = U();
    const curatorId = U();
    expect(await assignCuratorFn(db, ACTOR, { groupId, curatorId })).toMatchObject({ ok: true, promoted: true });
    expect(db.assignCurator).toHaveBeenLastCalledWith(ACTOR, groupId, curatorId);
    expect(await assignCuratorFn(db, ACTOR, { groupId, curatorId: "" })).toMatchObject({ ok: true, message: "Kurator olib tashlandi" });
    expect(db.assignCurator).toHaveBeenLastCalledWith(ACTOR, groupId, null);
  });

  it("reassigns a group with the default limit of 100", async () => {
    const db = fakeDb();
    const [cohortId, from] = [U(), U()];
    expect(await reassignGroupFn(db, ACTOR, { cohortId, fromGroupId: from, toGroupId: "" })).toMatchObject({ ok: true, moved: 3 });
    expect(db.reassignGroup).toHaveBeenCalledWith(ACTOR, cohortId, from, null, 100);
  });
});

describe("foreign actors and database refusals", () => {
  it("a foreign teacher gets forbidden from every write", async () => {
    const d = denied();
    const db = fakeDb({
      moveStudent: d, bulkMove: d, reassignGroup: d, setExpiry: d, createCohort: d, updateCohort: d, setCohortAccess: d,
      createGroup: d, updateGroup: d, assignCurator: d, findCurators: d,
    });
    const results = await Promise.all([
      moveStudentFn(db, ACTOR, { enrollmentId: U(), groupId: U() }),
      bulkMoveFn(db, ACTOR, { cohortId: U(), groupId: null, enrollmentIds: [U()] }),
      reassignGroupFn(db, ACTOR, { cohortId: U(), fromGroupId: U(), toGroupId: null }),
      setExpiryFn(db, ACTOR, { enrollmentId: U(), expiresOn: "2027-01-01" }),
      createCohortFn(db, ACTOR, { courseId: U(), name: "K" }),
      updateCohortFn(db, ACTOR, { cohortId: U(), name: "K" }),
      setCohortAccessFn(db, ACTOR, { cohortId: U(), open: false }),
      createGroupFn(db, ACTOR, { cohortId: U(), name: "G" }),
      updateGroupFn(db, ACTOR, { groupId: U(), name: "G" }),
      assignCuratorFn(db, ACTOR, { groupId: U(), curatorId: U() }),
      findCuratorsFn(db, ACTOR, { query: "998901234567" }),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, code: "forbidden", message: "Sizda bu amal uchun ruxsat yo'q" });
  });

  it("unexpected errors become a generic failure and never leak details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeDb({ moveStudent: vi.fn(async () => { throw new Error("password=hunter2 select * from profiles"); }) });
    const r = await moveStudentFn(db, ACTOR, { enrollmentId: U(), groupId: null });
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("maps SQLSTATE + message to typed errors", () => {
    expect(classifyDbError({ code: "42501", message: "forbidden" })).toBe("forbidden");
    expect(classifyDbError({ code: "22023", message: "telegram_required" })).toBe("telegram_required");
    expect(classifyDbError({ code: "22023", message: "invalid group" })).toBe("invalid_group");
    expect(classifyDbError({ code: "22023", message: "invalid name" })).toBe("invalid");
    expect(classifyDbError({ code: "55000", message: "student_enrolled" })).toBe("student_enrolled");
    expect(classifyDbError({ code: "55000", message: "already_linked" })).toBe("already_linked");
    expect(classifyDbError({ code: "55000", message: "rejected enrollment" })).toBe("conflict");
    expect(classifyDbError({ code: "23505", message: 'duplicate key value violates unique constraint "curator_groups_cohort_name_key"' })).toBe("duplicate_name");
    expect(classifyDbError({ code: "23505", message: 'duplicate key ... "curator_groups_telegram_chat_id_key"' })).toBe("duplicate_chat");
    expect(classifyDbError({ code: "23505", message: 'duplicate key ... "profiles_telegram_id_key"' })).toBe("telegram_taken");
    expect(classifyDbError({ code: "XX000", message: "boom" })).toBe("failed");
  });

  it("the supabase adapter calls the service-role functions with the actor and maps errors", async () => {
    const rpc = vi.fn(async (fn: string) =>
      fn === "manage_move_student"
        ? { data: [{ changed: true, previous_group: null }], error: null }
        : { data: null, error: { code: "42501", message: "forbidden" } },
    );
    const db = supabaseManageDb({ rpc, from: vi.fn() } as never);
    const enr = U();
    expect(await db.moveStudent(ACTOR, enr, null)).toEqual({ changed: true });
    expect(rpc).toHaveBeenCalledWith("manage_move_student", { p_actor: ACTOR, p_enrollment: enr, p_group: null });
    await expect(db.assignCurator(ACTOR, U(), U())).rejects.toMatchObject({ kind: "forbidden" });
    await expect(db.bulkMove(ACTOR, U(), null, [U()])).rejects.toBeInstanceOf(ManageDbError);
  });

  it("curator candidates are masked", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ profile_id: "p1", full_name: "Ali", phone: "+998901234567", telegram_linked: true, telegram_username: "ali", role: "student" }],
      error: null,
    }));
    const db = supabaseManageDb({ rpc, from: vi.fn() } as never);
    const [c] = await db.findCurators(ACTOR, "ali_x1");
    expect(c!.phone).toBe("+998 ** *** ** 67");
    expect(JSON.stringify(c)).not.toContain("901234567");
  });
});

describe("manual Telegram link", () => {
  const profileId = U();
  const deps = (over: Partial<TelegramLinkDeps> = {}): TelegramLinkDeps & { verifyUser: ReturnType<typeof vi.fn>; mirrorToAuth: ReturnType<typeof vi.fn> } =>
    ({
      verifyUser: vi.fn(async () => ({ username: "ali_v" })),
      mirrorToAuth: vi.fn(async () => "ok"),
      ...over,
    }) as never;

  it("verifies the id with Telegram, writes the profile, mirrors into auth", async () => {
    const db = fakeDb();
    const d = deps();
    const r = await linkTelegramFn(db, d, ACTOR, { profileId, telegramId: " 123456789 " });
    expect(r.ok).toBe(true);
    expect(d.verifyUser).toHaveBeenCalledWith(123456789);
    expect(db.linkTelegram).toHaveBeenCalledWith(ACTOR, profileId, 123456789, "ali_v");
    expect(d.mirrorToAuth).toHaveBeenCalledWith(profileId, 123456789);
    expect(db.revertTelegramLink).not.toHaveBeenCalled();
  });

  it("refuses usernames, junk and out-of-range ids without calling anything", async () => {
    const db = fakeDb();
    const d = deps();
    for (const telegramId of ["@ali", "12", "0123456", "abc", "", "99999999999999999", "1".repeat(16)]) {
      expect(await linkTelegramFn(db, d, ACTOR, { profileId, telegramId })).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await linkTelegramFn(db, d, ACTOR, { profileId: "x", telegramId: "123456" })).toMatchObject({ ok: false, code: "invalid" });
    expect(d.verifyUser).not.toHaveBeenCalled();
    expect(db.linkTelegram).not.toHaveBeenCalled();
  });

  it("does not write when Telegram cannot confirm the id", async () => {
    const db = fakeDb();
    const r = await linkTelegramFn(db, deps({ verifyUser: vi.fn(async () => null) }), ACTOR, { profileId, telegramId: "123456" });
    expect(r).toMatchObject({ ok: false, code: "unverified_telegram" });
    expect(db.linkTelegram).not.toHaveBeenCalled();
  });

  it("a foreign teacher is refused by the database after verification; nothing is mirrored", async () => {
    const db = fakeDb({ linkTelegram: denied() });
    const d = deps();
    expect(await linkTelegramFn(db, d, ACTOR, { profileId, telegramId: "123456" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(d.mirrorToAuth).not.toHaveBeenCalled();
  });

  it("rolls the profile link back when the auth mirror conflicts or fails", async () => {
    for (const [mirror, code] of [["conflict", "telegram_taken"], ["failed", "failed"]] as const) {
      const db = fakeDb();
      const r = await linkTelegramFn(db, deps({ mirrorToAuth: vi.fn(async () => mirror) }), ACTOR, { profileId, telegramId: "123456" });
      expect(r).toMatchObject({ ok: false, code });
      expect(db.revertTelegramLink).toHaveBeenCalledWith(profileId, 123456);
    }
  });

  it("production deps: only a private chat with that very user verifies", async () => {
    const make = (chat: () => Promise<{ id: number; type: string; username?: string }>) =>
      telegramLinkDeps({} as never, { getChat: chat });
    expect(await make(async () => ({ id: 5, type: "private", username: "u" })).verifyUser(5)).toEqual({ username: "u" });
    expect(await make(async () => ({ id: 5, type: "private" })).verifyUser(5)).toEqual({ username: null });
    expect(await make(async () => ({ id: 5, type: "supergroup" })).verifyUser(5)).toBeNull();
    expect(await make(async () => ({ id: 6, type: "private" })).verifyUser(5)).toBeNull();
    expect(await make(async () => { throw new Error("chat not found"); }).verifyUser(5)).toBeNull();
  });

  it("production deps: mirrors into app_metadata, refuses a different existing id", async () => {
    const user = (meta: Record<string, unknown>) => ({ data: { user: { app_metadata: meta } }, error: null });
    const update = vi.fn(async () => ({ error: null }));
    const mk = (meta: Record<string, unknown>) =>
      telegramLinkDeps({ auth: { admin: { getUserById: vi.fn(async () => user(meta)), updateUserById: update } } } as never, { getChat: vi.fn() });
    expect(await mk({ provider: "email" }).mirrorToAuth("p", 7)).toBe("ok");
    expect(update).toHaveBeenCalledWith("p", { app_metadata: { provider: "email", telegram_id: 7 } });
    update.mockClear();
    expect(await mk({ telegram_id: 7 }).mirrorToAuth("p", 7)).toBe("ok");
    expect(update).not.toHaveBeenCalled();
    expect(await mk({ telegram_id: 8 }).mirrorToAuth("p", 7)).toBe("conflict");
    const broken = telegramLinkDeps({ auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null }, error: { message: "x" } })) } } } as never, { getChat: vi.fn() });
    expect(await broken.mirrorToAuth("p", 7)).toBe("failed");
  });
});
