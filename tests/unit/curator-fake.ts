import type { ExerciseInfo, QueueStore, ReviewRow, Role, SubmissionRow } from "@/server/curator-queue";

export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export interface FakeWorld {
  roles: Record<string, Role>;
  names: Record<string, string>;
  /** submission rows plus the curator group they belong to */
  submissions: (SubmissionRow & { group: string })[];
  /** which group a curator owns (RLS: curated_group_ids) */
  groupOf: Record<string, string>;
  exercises: ExerciseInfo[];
  reviews: ReviewRow[];
}

/** A fake DB that applies the RLS rule itself: curators see their group, teachers/admins see everything. */
export function fakeStore(world: FakeWorld, viewer: string): QueueStore & { calls: string[] } {
  const calls: string[] = [];
  const visible = (s: SubmissionRow & { group: string }) => {
    const role = world.roles[viewer];
    if (s.student_id === viewer) return true;
    if (role === "curator") return world.groupOf[viewer] === s.group;
    return role === "teacher" || role === "admin";
  };
  const strip = (s: SubmissionRow & { group: string }): SubmissionRow => {
    const row: Partial<SubmissionRow & { group: string }> = { ...s };
    delete row.group;
    return row as SubmissionRow;
  };
  return {
    calls,
    async getRole(id) {
      calls.push("role");
      return world.roles[id] ?? null;
    },
    async listPending(limit) {
      calls.push("pending");
      // the real query already excludes unfinished rows; the service re-checks anyway
      return world.submissions
        .filter((s) => s.status === "pending" && visible(s))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map(strip);
    },
    async getSubmission(id) {
      const s = world.submissions.find((x) => x.id === id && visible(x));
      return s ? strip(s) : null;
    },
    async getSubmissionsByIds(ids) {
      return world.submissions.filter((s) => ids.includes(s.id) && visible(s)).map(strip);
    },
    async listReviewsSince(since, limit) {
      return world.reviews
        .filter((r) => r.created_at >= since && world.submissions.some((s) => s.id === r.submission_id && visible(s)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    },
    async getReviewsFor(ids) {
      return world.reviews.filter((r) => ids.includes(r.submission_id));
    },
    async getExercises(ids) {
      return world.exercises.filter((e) => ids.includes(e.id));
    },
    async getNames(ids) {
      return Object.fromEntries(ids.filter((i) => world.names[i]).map((i) => [i, world.names[i]!]));
    },
  };
}
