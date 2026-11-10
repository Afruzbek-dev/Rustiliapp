import { describe, expect, it } from "vitest";
import {
  approveEnrollment,
  computeExpiresAt,
  EnrollmentError,
  ensurePendingEnrollment,
  rejectEnrollment,
} from "@/server/enrollment";
import { createFakeDb } from "./telegram/fake-db";

type Row = Record<string, unknown>;

const NOW = new Date("2026-11-10T10:00:00Z");

function world(over: { cohorts?: Row[]; groups?: Row[]; enrollments?: Row[]; profiles?: Row[] } = {}) {
  return createFakeDb({
    profiles: over.profiles ?? [
      { id: "teacher", role: "teacher", full_name: "Zarina", telegram_id: 1 },
      { id: "teacher2", role: "teacher", full_name: "Boshqa", telegram_id: 2 },
      { id: "admin", role: "admin", full_name: "Admin", telegram_id: 3 },
      { id: "curator", role: "curator", full_name: "Kurator", telegram_id: 4 },
      { id: "s1", role: "student", full_name: "Ali Valiyev", telegram_id: 777 },
    ],
    courses: [{ id: "course", teacher_id: "teacher" }],
    cohorts: over.cohorts ?? [
      { id: "c1", course_id: "course", starts_on: "2026-11-01", ends_on: null, access_until: null, created_at: "2026-10-01T00:00:00Z" },
    ],
    curator_groups: over.groups ?? [],
    enrollments: over.enrollments ?? [],
  });
}

const cohort = (id: string, over: Row = {}): Row => ({
  id,
  course_id: "course",
  starts_on: null,
  ends_on: null,
  access_until: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});
const enr = (id: string, over: Row = {}): Row => ({
  id,
  student_id: "s1",
  cohort_id: "c1",
  curator_group_id: null,
  status: "pending",
  source: "manual",
  approved_by: null,
  approved_at: null,
  expires_at: null,
  ...over,
});

describe("ensurePendingEnrollment", () => {
  it("creates a pending manual enrollment once and is idempotent", async () => {
    const w = world();
    const first = await ensurePendingEnrollment(w.db, "s1", NOW);
    expect(first.created).toBe(true);
    expect(w.tables.enrollments).toHaveLength(1);
    expect(w.tables.enrollments![0]).toMatchObject({ student_id: "s1", cohort_id: "c1", status: "pending", source: "manual" });
    const second = await ensurePendingEnrollment(w.db, "s1", NOW);
    expect(second).toMatchObject({ created: false, reason: "exists" });
    expect(w.tables.enrollments).toHaveLength(1);
  });

  it("returns no_cohort when there is no open cohort", async () => {
    expect(await ensurePendingEnrollment(world({ cohorts: [] }).db, "s1", NOW)).toEqual({ created: false, reason: "no_cohort" });
    const closed = world({ cohorts: [cohort("old", { access_until: "2026-01-01T00:00:00Z" })] });
    expect(await ensurePendingEnrollment(closed.db, "s1", NOW)).toEqual({ created: false, reason: "no_cohort" });
    expect(closed.tables.enrollments).toHaveLength(0);
  });

  it("targets the newest open cohort (starts_on, then created_at), skipping closed ones", async () => {
    const w = world({
      cohorts: [
        cohort("closed", { starts_on: "2027-01-01", access_until: "2026-01-01T00:00:00Z" }),
        cohort("older", { starts_on: "2026-09-01" }),
        cohort("newer", { starts_on: "2026-10-15", access_until: "2027-06-01T00:00:00Z" }),
        cohort("tie-late", { starts_on: "2026-10-15", created_at: "2026-02-01T00:00:00Z" }),
      ],
    });
    await ensurePendingEnrollment(w.db, "s1", NOW);
    expect(w.tables.enrollments![0]!.cohort_id).toBe("tie-late");
  });

  it("never downgrades an active or rejected enrollment in the target cohort", async () => {
    for (const status of ["active", "rejected", "expired"]) {
      const w = world({ enrollments: [enr("e1", { status, expires_at: "2027-01-01T00:00:00Z" })] });
      const res = await ensurePendingEnrollment(w.db, "s1", NOW);
      expect(res).toMatchObject({ created: false, reason: "exists" });
      expect(w.tables.enrollments).toEqual([expect.objectContaining({ id: "e1", status })]);
    }
  });

  it("does not open a second request for a student with a live enrollment in another cohort", async () => {
    const w = world({
      cohorts: [cohort("c1", { starts_on: "2026-11-01" }), cohort("c0", { starts_on: "2026-09-01" })],
      enrollments: [enr("e0", { cohort_id: "c0", status: "active", expires_at: "2027-01-01T00:00:00Z" })],
    });
    expect(await ensurePendingEnrollment(w.db, "s1", NOW)).toMatchObject({ created: false, reason: "already_enrolled" });
    expect(w.tables.enrollments).toHaveLength(1);
  });

  it("creates a new pending request when the older enrollment has expired or was rejected", async () => {
    const w = world({
      cohorts: [cohort("c1", { starts_on: "2026-11-01" }), cohort("c0", { starts_on: "2026-09-01" })],
      enrollments: [enr("e0", { cohort_id: "c0", status: "active", expires_at: "2026-10-01T00:00:00Z" })],
    });
    expect((await ensurePendingEnrollment(w.db, "s1", NOW)).created).toBe(true);
  });

  it("treats a unique violation from a concurrent request as 'exists'", async () => {
    const w = world();
    const realFrom = (w.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (w.db as unknown as { from: unknown }).from = (t: string) => {
      const b = realFrom(t);
      if (t === "enrollments") {
        b.insert = () => {
          // The winner commits between our checks and our insert.
          w.tables.enrollments!.push(enr("race"));
          const lost = { data: null, error: { code: "23505" } };
          return { select: () => Promise.resolve(lost) };
        };
      }
      return b;
    };
    const res = await ensurePendingEnrollment(w.db, "s1", NOW);
    expect(res).toMatchObject({ created: false, reason: "exists", enrollment: { id: "race" } });
    expect(w.tables.enrollments).toHaveLength(1);
  });
});

describe("computeExpiresAt", () => {
  it("uses access_until, else ends_on + 1 month, else now + 90 days; never null", () => {
    expect(computeExpiresAt({ access_until: "2027-03-01T00:00:00Z", ends_on: "2027-01-10" }, NOW)).toBe("2027-03-01T00:00:00.000Z");
    expect(computeExpiresAt({ access_until: null, ends_on: "2027-01-10" }, NOW)).toBe("2027-02-10T00:00:00.000Z");
    expect(computeExpiresAt({ access_until: null, ends_on: "2027-01-31" }, NOW)).toBe("2027-02-28T00:00:00.000Z");
    expect(computeExpiresAt({ access_until: null, ends_on: "2026-12-15" }, NOW)).toBe("2027-01-15T00:00:00.000Z");
    expect(computeExpiresAt({ access_until: null, ends_on: null }, NOW)).toBe("2027-02-08T10:00:00.000Z");
  });
});

describe("approveEnrollment", () => {
  const groups = [
    { id: "gB", cohort_id: "c1", name: "B guruh" },
    { id: "gA", cohort_id: "c1", name: "A guruh" },
  ];

  it("lets the course teacher approve: status, approver, time, expiry and least-loaded group", async () => {
    const w = world({
      groups,
      enrollments: [enr("e1"), enr("x1", { student_id: "o1", status: "active", curator_group_id: "gA", expires_at: "2027-01-01T00:00:00Z" })],
    });
    const res = await approveEnrollment(w.db, "e1", "teacher", {}, NOW);
    expect(res).toMatchObject({ outcome: "approved", groupName: "B guruh", noGroup: false, studentTelegramId: 777 });
    expect(w.tables.enrollments![0]).toMatchObject({
      status: "active",
      approved_by: "teacher",
      approved_at: NOW.toISOString(),
      curator_group_id: "gB",
      expires_at: "2027-02-08T10:00:00.000Z",
    });
  });

  it("breaks ties by group name then id", async () => {
    const w = world({ groups, enrollments: [enr("e1")] });
    const res = await approveEnrollment(w.db, "e1", "admin", {}, NOW);
    expect(res.groupName).toBe("A guruh");
    const same = world({
      groups: [
        { id: "g2", cohort_id: "c1", name: "Bir" },
        { id: "g1", cohort_id: "c1", name: "Bir" },
      ],
      enrollments: [enr("e1")],
    });
    expect((await approveEnrollment(same.db, "e1", "admin", {}, NOW)).enrollment.curator_group_id).toBe("g1");
  });

  it("ignores expired and non-active enrollments when counting group load", async () => {
    const w = world({
      groups,
      enrollments: [
        enr("e1"),
        enr("x1", { student_id: "o1", status: "active", curator_group_id: "gA", expires_at: "2026-01-01T00:00:00Z" }),
        enr("x2", { student_id: "o2", status: "pending", curator_group_id: "gA" }),
        enr("x3", { student_id: "o3", status: "active", curator_group_id: "gB", expires_at: "2027-01-01T00:00:00Z" }),
      ],
    });
    expect((await approveEnrollment(w.db, "e1", "admin", {}, NOW)).groupName).toBe("A guruh");
  });

  it("forbids a foreign teacher, a curator, a student and an unknown actor without changes", async () => {
    for (const actor of ["teacher2", "curator", "s1", "ghost"]) {
      const w = world({ groups, enrollments: [enr("e1")] });
      await expect(approveEnrollment(w.db, "e1", actor, {}, NOW)).rejects.toMatchObject({ name: "EnrollmentError", code: "forbidden" });
      expect(w.tables.enrollments![0]!.status).toBe("pending");
    }
  });

  it("lets an admin approve and reports not_found for a missing enrollment", async () => {
    const w = world({ groups, enrollments: [enr("e1")] });
    expect((await approveEnrollment(w.db, "e1", "admin", {}, NOW)).outcome).toBe("approved");
    await expect(approveEnrollment(w.db, "nope", "admin", {}, NOW)).rejects.toMatchObject({ code: "not_found" });
  });

  it("uses an explicit group of the same cohort and rejects one from another cohort", async () => {
    const w = world({
      cohorts: [cohort("c1"), cohort("c2")],
      groups: [...groups, { id: "gOther", cohort_id: "c2", name: "Boshqa" }],
      enrollments: [enr("e1")],
    });
    await expect(approveEnrollment(w.db, "e1", "teacher", { curatorGroupId: "gOther" }, NOW)).rejects.toMatchObject({
      code: "invalid_group",
    });
    expect(w.tables.enrollments![0]!.status).toBe("pending");
    const res = await approveEnrollment(w.db, "e1", "teacher", { curatorGroupId: "gB" }, NOW);
    expect(res.enrollment.curator_group_id).toBe("gB");
  });

  it("warns noGroup when the cohort has no groups, and still sets expires_at", async () => {
    const w = world({ enrollments: [enr("e1")] });
    const res = await approveEnrollment(w.db, "e1", "teacher", {}, NOW);
    expect(res).toMatchObject({ outcome: "approved", noGroup: true, groupName: null });
    expect(w.tables.enrollments![0]!.expires_at).not.toBeNull();
  });

  it("expires_at rules: access_until, ends_on + 1 month, fallback 90 days", async () => {
    const cases: [Row, string][] = [
      [cohort("c1", { access_until: "2027-05-01T00:00:00Z", ends_on: "2027-01-10" }), "2027-05-01T00:00:00.000Z"],
      [cohort("c1", { ends_on: "2027-01-10" }), "2027-02-10T00:00:00.000Z"],
      [cohort("c1"), "2027-02-08T10:00:00.000Z"],
    ];
    for (const [c, expected] of cases) {
      const w = world({ cohorts: [c], enrollments: [enr("e1")] });
      await approveEnrollment(w.db, "e1", "teacher", {}, NOW);
      expect(w.tables.enrollments![0]!.expires_at).toBe(expected);
    }
  });

  it("is idempotent: a second approval changes nothing", async () => {
    const w = world({ groups, enrollments: [enr("e1")] });
    await approveEnrollment(w.db, "e1", "teacher", {}, NOW);
    const snapshot = JSON.stringify(w.tables.enrollments);
    const again = await approveEnrollment(w.db, "e1", "admin", {}, new Date(NOW.getTime() + 3600_000));
    expect(again).toMatchObject({ outcome: "already_approved", groupName: "A guruh" });
    expect(JSON.stringify(w.tables.enrollments)).toBe(snapshot);
  });

  it("can re-approve a rejected enrollment", async () => {
    const w = world({ groups, enrollments: [enr("e1", { status: "rejected" })] });
    expect((await approveEnrollment(w.db, "e1", "teacher", {}, NOW)).outcome).toBe("approved");
  });

  it("wraps database failures in a typed error carrying only codes", async () => {
    const w = world({ enrollments: [enr("e1")] });
    const realFrom = (w.db as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (w.db as unknown as { from: unknown }).from = (t: string) => {
      if (t === "cohorts") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = () => Promise.resolve({ data: null, error: { code: "XX000", message: "+998901234567" } });
        return b;
      }
      return realFrom(t);
    };
    const err = await approveEnrollment(w.db, "e1", "teacher", {}, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(EnrollmentError);
    expect(err).toMatchObject({ code: "db", op: "loadCohort", dbCode: "XX000" });
    expect(err.message).not.toContain("998");
  });
});

describe("rejectEnrollment", () => {
  it("rejects a pending enrollment for the teacher or admin, idempotently", async () => {
    const w = world({ enrollments: [enr("e1")] });
    expect((await rejectEnrollment(w.db, "e1", "teacher")).outcome).toBe("rejected");
    expect(w.tables.enrollments![0]!.status).toBe("rejected");
    expect((await rejectEnrollment(w.db, "e1", "admin")).outcome).toBe("already_rejected");
  });

  it("forbids a foreign teacher", async () => {
    const w = world({ enrollments: [enr("e1")] });
    await expect(rejectEnrollment(w.db, "e1", "teacher2")).rejects.toMatchObject({ code: "forbidden" });
    expect(w.tables.enrollments![0]!.status).toBe("pending");
  });

  it("cannot reject an active (or expired) enrollment: conflict, row untouched", async () => {
    for (const status of ["active", "expired"]) {
      const w = world({ enrollments: [enr("e1", { status, expires_at: "2027-01-01T00:00:00Z" })] });
      expect((await rejectEnrollment(w.db, "e1", "teacher")).outcome).toBe("conflict");
      expect(w.tables.enrollments![0]!.status).toBe(status);
    }
  });
});
