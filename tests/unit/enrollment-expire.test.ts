import { describe, expect, it } from "vitest";
import { expireEnrollment } from "@/server/enrollment";
import { createFakeDb } from "./telegram/fake-db";

type Row = Record<string, unknown>;
const NOW = new Date("2026-11-10T10:00:00Z");

const enr = (over: Row = {}): Row => ({
  id: "e1", student_id: "s1", cohort_id: "c1", curator_group_id: null, status: "active", source: "manual",
  approved_by: null, approved_at: null, expires_at: "2027-01-01T00:00:00Z", ...over,
});

function world(enrollments: Row[]) {
  return createFakeDb({
    profiles: [
      { id: "teacher", role: "teacher", full_name: "Zarina" },
      { id: "teacher2", role: "teacher", full_name: "Boshqa" },
      { id: "admin", role: "admin", full_name: "Admin" },
      { id: "curator", role: "curator", full_name: "Kurator" },
      { id: "s1", role: "student", full_name: "Ali" },
    ],
    courses: [{ id: "course", teacher_id: "teacher" }],
    cohorts: [{ id: "c1", course_id: "course", starts_on: null, ends_on: null, access_until: null, created_at: "2026-01-01T00:00:00Z" }],
    enrollments,
  });
}

describe("expireEnrollment", () => {
  it("ends an active enrollment now and is idempotent", async () => {
    const w = world([enr()]);
    const res = await expireEnrollment(w.db, "e1", "teacher", NOW);
    expect(res.outcome).toBe("expired");
    expect(w.tables.enrollments![0]).toMatchObject({ status: "expired", expires_at: NOW.toISOString() });
    expect((await expireEnrollment(w.db, "e1", "teacher", NOW)).outcome).toBe("already_expired");
  });

  it("keeps an earlier expiry", async () => {
    const w = world([enr({ expires_at: "2026-11-01T00:00:00Z" })]);
    await expireEnrollment(w.db, "e1", "admin", NOW);
    expect(w.tables.enrollments![0]!.expires_at).toBe("2026-11-01T00:00:00Z");
  });

  it("pending and rejected rows are a conflict and stay untouched", async () => {
    for (const status of ["pending", "rejected"]) {
      const w = world([enr({ status })]);
      expect((await expireEnrollment(w.db, "e1", "teacher", NOW)).outcome).toBe("conflict");
      expect(w.tables.enrollments![0]!.status).toBe(status);
    }
  });

  it("a foreign teacher, a curator and an unknown actor are forbidden; unknown row is not_found", async () => {
    const w = world([enr()]);
    for (const actor of ["teacher2", "curator", "s1", "nobody"]) {
      await expect(expireEnrollment(w.db, "e1", actor, NOW)).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(expireEnrollment(w.db, "missing", "teacher", NOW)).rejects.toMatchObject({ code: "not_found" });
    expect(w.tables.enrollments![0]!.status).toBe("active");
  });
});
