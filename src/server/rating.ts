import "server-only";
import { createClient } from "@/lib/supabase/server";

export type RatingKind = "speaking" | "xp";
export type RatingPeriod = "week" | "month";

export interface LeaderboardRow {
  rank: number;
  student_id: string;
  display_name: string;
  score: number;
  eligible: boolean;
}

/** Narrow port; production adapter below uses the user-scoped Supabase client (RLS stays the authority). */
export interface RatingDb {
  /** Cohort of the student's current enrollment (active, not expired, newest approval first). */
  cohortId(studentId: string, nowIso: string): Promise<string | null>;
  leaderboard(cohortId: string, kind: RatingKind, period: RatingPeriod): Promise<LeaderboardRow[]>;
}

export interface Rating {
  kind: RatingKind;
  period: RatingPeriod;
  /** Top 3 eligible rows, best first (ties keep rank order, then name). */
  podium: LeaderboardRow[];
  /** Remaining eligible rows (4+). */
  rows: LeaderboardRow[];
  /** Rows below the 8-submission threshold, listed last. */
  ineligible: LeaderboardRow[];
  /** The signed-in student's own row, if present. */
  own: LeaderboardRow | null;
  empty: boolean;
}

export function parseKind(v: unknown): RatingKind {
  return v === "xp" ? "xp" : "speaking";
}
export function parsePeriod(v: unknown): RatingPeriod {
  return v === "month" ? "month" : "week";
}

const byRank = (a: LeaderboardRow, b: LeaderboardRow) =>
  a.rank - b.rank || a.display_name.localeCompare(b.display_name, "ru");

export async function getRatingWith(
  db: RatingDb,
  studentId: string,
  kind: RatingKind,
  period: RatingPeriod,
  now: Date = new Date(),
): Promise<Rating> {
  const cohort = await db.cohortId(studentId, now.toISOString());
  const all = cohort ? await db.leaderboard(cohort, kind, period) : [];
  const eligible = all.filter((r) => r.eligible).sort(byRank);
  const ineligible = all.filter((r) => !r.eligible).sort(byRank);
  return {
    kind,
    period,
    podium: eligible.slice(0, 3),
    rows: eligible.slice(3),
    ineligible,
    own: all.find((r) => r.student_id === studentId) ?? null,
    empty: all.length === 0,
  };
}

export async function getRating(studentId: string, kind: RatingKind, period: RatingPeriod): Promise<Rating> {
  const sb = await createClient();
  const db: RatingDb = {
    async cohortId(id, nowIso) {
      const { data, error } = await sb
        .from("enrollments")
        .select("cohort_id")
        .eq("student_id", id)
        .eq("status", "active")
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("approved_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`rating: enrollment: ${error.message}`);
      return (data?.cohort_id as string | undefined) ?? null;
    },
    async leaderboard(cohortId, k, p) {
      const { data, error } = await sb.rpc("leaderboard", { p_cohort: cohortId, p_kind: k, p_period: p });
      if (error) throw new Error(`rating: leaderboard: ${error.message}`);
      return ((data ?? []) as (Omit<LeaderboardRow, "score"> & { score: number | string })[]).map((r) => ({
        ...r,
        score: Number(r.score),
      }));
    },
  };
  return getRatingWith(db, studentId, kind, period);
}
