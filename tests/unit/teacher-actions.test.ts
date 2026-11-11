import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE } from "@/components/staff/action-state";

const m = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  revalidate: vi.fn(),
  deps: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/guards", () => ({ requireStaff: m.requireStaff }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ service: true }) }));
vi.mock("@/server/enrollment", async (orig) => ({
  ...(await orig<typeof import("@/server/enrollment")>()),
  approveEnrollment: m.approve,
  rejectEnrollment: m.reject,
}));
vi.mock("@/server/teacher-reminders", async (orig) => ({
  ...(await orig<typeof import("@/server/teacher-reminders")>()),
  productionReminderDeps: m.deps,
  appHomeUrl: () => "https://app.test/home",
}));

import { approveRequestAction, rejectRequestAction, remindStudentAction } from "@/app/(staff)/teacher/actions";
import { EnrollmentError } from "@/server/enrollment";

const form = (data: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
};
const TEACHER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.requireStaff.mockResolvedValue({ user: { id: TEACHER }, role: "teacher" });
});

describe("approve / reject actions", () => {
  it("approves with the actor taken from the verified session, then revalidates", async () => {
    const id = randomUUID();
    m.approve.mockResolvedValue({ outcome: "approved" });
    const res = await approveRequestAction(IDLE, form({ enrollmentId: id, actorProfileId: "attacker" }));
    expect(res).toEqual({ status: "success", message: "Ochildi" });
    expect(m.approve).toHaveBeenCalledWith({ service: true }, id, TEACHER);
    expect(m.revalidate).toHaveBeenCalledWith("/teacher");
  });

  it("maps the typed outcomes", async () => {
    const id = randomUUID();
    m.approve.mockResolvedValueOnce({ outcome: "cohort_closed" });
    expect(await approveRequestAction(IDLE, form({ enrollmentId: id }))).toEqual({ status: "error", message: "Guruh yopilgan" });
    m.approve.mockResolvedValueOnce({ outcome: "already_approved" });
    expect((await approveRequestAction(IDLE, form({ enrollmentId: id }))).message).toBe("Allaqachon tasdiqlangan");
    m.reject.mockResolvedValueOnce({ outcome: "rejected" });
    expect(await rejectRequestAction(IDLE, form({ enrollmentId: id }))).toEqual({ status: "success", message: "Rad etildi" });
    expect(m.reject).toHaveBeenCalledWith({ service: true }, id, TEACHER);
    m.reject.mockResolvedValueOnce({ outcome: "conflict" });
    expect((await rejectRequestAction(IDLE, form({ enrollmentId: id }))).status).toBe("error");
  });

  it("a foreign teacher gets a forbidden error and no revalidation", async () => {
    m.approve.mockRejectedValue(new EnrollmentError("forbidden", "authorize"));
    const res = await approveRequestAction(IDLE, form({ enrollmentId: randomUUID() }));
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/ruxsat yo'q/);
    expect(m.revalidate).not.toHaveBeenCalled();
    m.reject.mockRejectedValue(new EnrollmentError("forbidden", "authorize"));
    expect((await rejectRequestAction(IDLE, form({ enrollmentId: randomUUID() }))).status).toBe("error");
  });

  it("other failures become a generic error without leaking details", async () => {
    m.approve.mockRejectedValue(new Error("secret db detail"));
    const res = await approveRequestAction(IDLE, form({ enrollmentId: randomUUID() }));
    expect(res.status).toBe("error");
    expect(res.message).not.toContain("secret");
  });

  it("rejects a malformed id before touching anything", async () => {
    const res = await approveRequestAction(IDLE, form({ enrollmentId: "not-a-uuid" }));
    expect(res.status).toBe("error");
    expect(m.approve).not.toHaveBeenCalled();
    expect((await rejectRequestAction(IDLE, new FormData())).status).toBe("error");
    expect(m.reject).not.toHaveBeenCalled();
  });

  it("the staff guard runs first: its redirect aborts the action", async () => {
    m.requireStaff.mockRejectedValue(new Error("redirect:/home"));
    await expect(approveRequestAction(IDLE, form({ enrollmentId: randomUUID() }))).rejects.toThrow(/redirect/);
    expect(m.approve).not.toHaveBeenCalled();
  });
});

describe("remindStudentAction", () => {
  const ids = () => ({ studentId: randomUUID(), cohortId: randomUUID() });
  function deps(over: Partial<Record<string, unknown>> = {}) {
    return {
      mayRemind: vi.fn(async () => true),
      telegramIdOf: vi.fn(async () => 555),
      claim: vi.fn(async () => true),
      release: vi.fn(async () => undefined),
      send: vi.fn(async () => undefined),
      ...over,
    };
  }

  it("sends the reminder with the app link", async () => {
    const d = deps();
    m.deps.mockResolvedValue(d);
    const res = await remindStudentAction(IDLE, form(ids()));
    expect(res).toEqual({ status: "success", message: "Eslatma yuborildi" });
    expect(d.send).toHaveBeenCalledWith(555, "Salom! Bugun ham mashq qilishni unutmang.\nhttps://app.test/home");
    expect(m.revalidate).toHaveBeenCalledWith("/teacher");
  });

  it("a student outside the teacher's cohort is rejected and nothing is sent", async () => {
    const d = deps({ mayRemind: vi.fn(async () => false) });
    m.deps.mockResolvedValue(d);
    const res = await remindStudentAction(IDLE, form(ids()));
    expect(res.status).toBe("error");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("validates ids with zod", async () => {
    m.deps.mockResolvedValue(deps());
    expect((await remindStudentAction(IDLE, form({ studentId: "x", cohortId: "y" }))).status).toBe("error");
    expect(m.deps).not.toHaveBeenCalled();
  });

  it("an unexpected failure is reported without details", async () => {
    m.deps.mockRejectedValue(new Error("pii: +998901234567"));
    const res = await remindStudentAction(IDLE, form(ids()));
    expect(res.status).toBe("error");
    expect(res.message).not.toContain("998");
    expect(JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("998");
  });
});
