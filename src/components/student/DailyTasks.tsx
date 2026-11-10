import { CheckCircle2, Circle } from "lucide-react";
import { Card } from "@/components/ui";
import type { DailyTask, DailyTaskKey } from "@/server/dashboard";

const labels: Record<DailyTaskKey, string> = {
  words: "So'zlar",
  grammar: "Grammatika",
  audio: "Audio",
  speaking: "Gapirish",
};

export function DailyTasks({ tasks }: { tasks: DailyTask[] }) {
  return (
    <Card>
      <h2 className="mb-2 text-lg font-extrabold">Bugungi vazifalar</h2>
      <ul className="flex flex-col">
        {tasks.map((t) => {
          const done = t.done >= t.target;
          return (
            <li key={t.key} className="flex min-h-11 items-center gap-3">
              {done ? (
                <CheckCircle2 aria-hidden="true" className="size-6 text-ok-text" />
              ) : (
                <Circle aria-hidden="true" className="size-6 text-ink-3" />
              )}
              <span className="flex-1 font-bold">{labels[t.key]}</span>
              <span className="text-sm font-bold text-ink-2">
                {t.done}/{t.target}
                <span className="sr-only">{done ? " bajarildi" : ""}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
