import { ProgressBar } from "@/components/ui";
import type { LessonCompletionRow } from "@/server/teacher-stats";

export interface LessonCompletionProps {
  rows: LessonCompletionRow[];
}

export function LessonCompletion({ rows }: LessonCompletionProps) {
  if (rows.length === 0) {
    return <p className="text-ink-2">Hali darslar qo&apos;shilmagan.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const pct = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0;
        return (
          <li key={r.lessonId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-bold text-ink">{r.title}</span>
              <span className="shrink-0 text-ink-2">
                {r.completed} / {r.total} ({pct}%)
              </span>
            </div>
            <ProgressBar value={r.completed} max={Math.max(r.total, 1)} color="info" label={`${r.title}: ${pct}%`} />
          </li>
        );
      })}
    </ul>
  );
}
