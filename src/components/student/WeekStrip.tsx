import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { WeekDay } from "@/server/dashboard";

export function WeekStrip({ week }: { week: WeekDay[] }) {
  return (
    <ol aria-label="Hafta kunlari" className="flex justify-between gap-1">
      {week.map((d) => (
        <li
          key={d.day}
          aria-current={d.today ? "date" : undefined}
          data-today={d.today ? "true" : undefined}
          className="flex flex-1 flex-col items-center gap-1"
        >
          <span className={cn("text-xs font-bold", d.today ? "text-ink" : "text-ink-2")}>{d.label}</span>
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-full border-2",
              d.done ? "border-ok-shadow bg-ok text-ink" : "border-border bg-card text-ink-3",
              d.today && "border-ink ring-2 ring-brand",
            )}
          >
            {d.done ? (
              <Check aria-hidden="true" className="size-5" />
            ) : (
              <span aria-hidden="true" className="size-2 rounded-full bg-border-strong" />
            )}
            <span className="sr-only">
              {d.done ? "Bajarildi" : d.today ? "Bugun, hali bajarilmagan" : "Bajarilmagan"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
