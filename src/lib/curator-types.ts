/** Shapes shared by the curator queue (server) and its UI (client). JSON-serialisable on purpose. */

export const CRITERIA = ["completeness", "pronunciation", "grammar", "fluency"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Record<Criterion, number>;

export const CRITERION_LABELS: Record<Criterion, string> = {
  completeness: "Matnni to'liq aytdi",
  pronunciation: "Talaffuz",
  grammar: "Grammatika",
  fluency: "Ravonlik",
};

export interface ReviewSummary {
  scores: Scores;
  total: number;
  comment: string | null;
  reviewerName: string | null;
  isOverride: boolean;
  createdAt: string;
}

export interface QueueItem {
  id: string;
  kind: "audio" | "video";
  status: "pending" | "reviewed";
  createdAt: string;
  /** first name + last initial, e.g. "Ali V." */
  studentName: string;
  lessonTitle: string | null;
  prompt: string | null;
  /** latest review (reviewed items of the teacher/admin list and deep links only) */
  review: ReviewSummary | null;
}

export const FALLBACK_STUDENT_NAME = "O'quvchi";

/** "Ali Valiyev Karimovich" -> "Ali V."; one word stays as is; empty -> fallback. */
export function displayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return FALLBACK_STUDENT_NAME;
  if (parts.length === 1) return parts[0]!;
  const initial = Array.from(parts[1]!)[0]!.toUpperCase();
  return `${parts[0]} ${initial}.`;
}

export function averageOf(scores: Scores): number {
  return (scores.completeness + scores.pronunciation + scores.grammar + scores.fluency) / 4;
}

/** Uzbek relative time; `now` is passed in so server and client render the same text. */
export function timeAgo(iso: string, nowIso: string): string {
  const diff = Math.max(0, Date.parse(nowIso) - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "hozirgina";
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} soat oldin`;
  return `${Math.floor(h / 24)} kun oldin`;
}
