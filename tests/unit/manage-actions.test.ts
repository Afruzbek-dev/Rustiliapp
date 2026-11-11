import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE } from "@/components/staff/action-state";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  expire: vi.fn(),
  revalidate: vi.fn(),
  send: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/guards", () => ({ requireStaff: m.requireStaff }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ service: true, rpc: m.rpc }) }));
vi.mock("@/lib/telegram/api-client", () => ({ getTelegramApi: () => ({ sendMessage: m.send, getChat: vi.fn() }) }));
vi.mock("@/server/enrollment", async (orig) => ({
  ...(await orig<typeof import("@/server/enrollment")>()),
  approveEnrollment: m.approve,
  rejectEnrollment: m.reject,
  expireEnrollment: m.expire,
}));

import {
  approveStudentAction,
  assignCuratorAction,
  bulkMoveAction,
  createCohortAction,
  expireStudentAction,
  moveStudentAction,
  rejectStudentAction,
  setCohortAccessAction,
} from "@/app/(staff)/teacher/manage-actions";
import { EnrollmentError } from "@/server/enrollment";

const form = (data: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const TEACHER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.requireStaff.mockResolvedValue({ user: { id: TEACHER }, role: "teacher" });
  m.rpc.mockResolvedValue({ data: [{ changed: true }], error: null });
});

describe("enrollment actions", () => {
  it("approve uses the session actor (not a forged field), passes the group, DMs the student once", async () => {
    const id = randomUUID();
    const group = randomUUID();
    m.approve.mockResolvedValue({ outcome: "approved", studentTelegramId: 555 });
    const res = await approveStudentAction(IDLE, form({ enrollmentId: id, groupId: group, actorProfileId: "attacker" }));
    expect(res).toEqual({ status: "success", message: "Ochildi" });
    expect(m.approve).toHaveBeenCalledWith({ service: true, rpc: m.rpc }, id, TEACHER, { curatorGroupId: group });
    expect(m.send).toHaveBeenCalledWith(555, expect.any(String));
    expect(m.revalidate).toHaveBeenCalledWith("/teacher/students");
  });

  it("approve without a group lets the server pick; a repeat sends nothing", async () => {
    m.approve.mockResolvedValue({ outcome: "already_approved", studentTelegramId: 555 });
    const res = await approveStudentAction(IDLE, form({ enrollmentId: randomUUID(), groupId: "" }));
    expect(res.status).toBe("info");
    expect(m.approve.mock.calls[0]![3]).toEqual({ curatorGroupId: undefined });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("a closed cohort is reported and changes nothing visible", async () => {
    m.approve.mockResolvedValue({ outcome: "cohort_closed", studentTelegramId: 555 });
    const res = await approveStudentAction(IDLE, form({ enrollmentId: randomUUID() }));
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/yopilgan/);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.revalidate).toHaveBeenCalled(); // harmless refresh
  });

  it("a foreign teacher is forbidden and a failed DM does not fail the approval", async () => {
    m.approve.mockRejectedValueOnce(new EnrollmentError("forbidden", "authorize"));
    expect(await approveStudentAction(IDLE, form({ enrollmentId: randomUUID() }))).toEqual({ status: "error", message: "Sizda bu amal uchun ruxsat yo'q" });
    m.approve.mockResolvedValueOnce({ outcome: "approved", studentTelegramId: 5 });
    m.send.mockRejectedValueOnce(new Error("blocked"));
    expect((await approveStudentAction(IDLE, form({ enrollmentId: randomUUID() }))).status).toBe("success");
  });

  it("invalid input never reaches enrollment.ts", async () => {
    for (const fn of [approveStudentAction, rejectStudentAction, expireStudentAction]) {
      expect(await fn(IDLE, form({ enrollmentId: "not-a-uuid" }))).toEqual({ status: "error", message: "Noto'g'ri so'rov" });
    }
    expect(await approveStudentAction(IDLE, form({ enrollmentId: randomUUID(), groupId: "xx" }))).toMatchObject({ status: "error" });
    expect(m.approve).not.toHaveBeenCalled();
    expect(m.reject).not.toHaveBeenCalled();
    expect(m.expire).not.toHaveBeenCalled();
  });

  it("reject and expire map their outcomes", async () => {
    const id = randomUUID();
    m.reject.mockResolvedValueOnce({ outcome: "rejected" });
    expect(await rejectStudentAction(IDLE, form({ enrollmentId: id }))).toEqual({ status: "success", message: "Rad etildi" });
    m.reject.mockResolvedValueOnce({ outcome: "conflict" });
    expect((await rejectStudentAction(IDLE, form({ enrollmentId: id }))).status).toBe("error");
    m.expire.mockResolvedValueOnce({ outcome: "expired" });
    expect((await expireStudentAction(IDLE, form({ enrollmentId: id }))).status).toBe("success");
    m.expire.mockResolvedValueOnce({ outcome: "already_expired" });
    expect((await expireStudentAction(IDLE, form({ enrollmentId: id }))).status).toBe("info");
    m.expire.mockResolvedValueOnce({ outcome: "conflict" });
    expect((await expireStudentAction(IDLE, form({ enrollmentId: id }))).status).toBe("error");
    expect(m.expire).toHaveBeenCalledWith({ service: true, rpc: m.rpc }, id, TEACHER);
  });
});

describe("management actions", () => {
  it("move passes the session actor to the service-role function; forged actor ignored", async () => {
    const enrollmentId = randomUUID();
    const groupId = randomUUID();
    const res = await moveStudentAction(IDLE, form({ enrollmentId, groupId, actor: "attacker", p_actor: "attacker" }));
    expect(res.status).toBe("success");
    expect(m.rpc).toHaveBeenCalledWith("manage_move_student", { p_actor: TEACHER, p_enrollment: enrollmentId, p_group: groupId });
  });

  it("a foreign teacher's move is refused by the database", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    const res = await moveStudentAction(IDLE, form({ enrollmentId: randomUUID(), groupId: randomUUID() }));
    expect(res).toEqual({ status: "error", message: "Sizda bu amal uchun ruxsat yo'q" });
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("bulk move collects all ids and enforces the 100 cap before the database", async () => {
    m.rpc.mockResolvedValue({ data: 2, error: null });
    const ids = [randomUUID(), randomUUID()];
    const ok = await bulkMoveAction(IDLE, form({ cohortId: randomUUID(), groupId: "", enrollmentIds: ids }));
    expect(ok).toEqual({ status: "success", message: "2 ta o'quvchi ko'chirildi" });
    expect(m.rpc.mock.calls[0]![1]).toMatchObject({ p_actor: TEACHER, p_group: null, p_enrollments: ids });
    m.rpc.mockClear();
    const tooMany = await bulkMoveAction(IDLE, form({ cohortId: randomUUID(), groupId: "", enrollmentIds: Array.from({ length: 101 }, () => randomUUID()) }));
    expect(tooMany.status).toBe("error");
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("assign curator: actor from session; the telegram requirement surfaces to the teacher", async () => {
    const groupId = randomUUID();
    const curatorId = randomUUID();
    m.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect((await assignCuratorAction(IDLE, form({ groupId, curatorId }))).status).toBe("success");
    expect(m.rpc).toHaveBeenCalledWith("manage_assign_curator", { p_actor: TEACHER, p_group: groupId, p_curator: curatorId });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "telegram_required" } });
    expect(await assignCuratorAction(IDLE, form({ groupId, curatorId }))).toEqual({ status: "error", message: "Kurator profilida tasdiqlangan Telegram yo'q" });
  });

  it("cohort actions validate dates and cohort-closed semantics are explicit", async () => {
    const bad = await createCohortAction(IDLE, form({ courseId: randomUUID(), name: "K", startsOn: "2026-10-01", endsOn: "2026-09-01" }));
    expect(bad.status).toBe("error");
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValueOnce({ data: "2026-11-11T00:00:00Z", error: null });
    const closed = await setCohortAccessAction(IDLE, form({ cohortId: randomUUID(), open: "false" }));
    expect(closed).toEqual({ status: "success", message: "Qabul yopildi" });
    expect(m.rpc).toHaveBeenCalledWith("manage_set_cohort_access", expect.objectContaining({ p_actor: TEACHER, p_open: false, p_access: null }));
    expect((await setCohortAccessAction(IDLE, form({ cohortId: randomUUID(), open: "true" }))).status).toBe("error");
  });

  it("requireStaff is consulted first: a non-staff visitor never reaches any write", async () => {
    m.requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(moveStudentAction(IDLE, form({ enrollmentId: randomUUID(), groupId: "" }))).rejects.toThrow("NEXT_REDIRECT");
    await expect(approveStudentAction(IDLE, form({ enrollmentId: randomUUID() }))).rejects.toThrow("NEXT_REDIRECT");
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.approve).not.toHaveBeenCalled();
  });
});
