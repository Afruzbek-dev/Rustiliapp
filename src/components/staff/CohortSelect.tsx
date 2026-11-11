import Link from "next/link";
import { cn } from "@/components/ui/cn";
import type { CohortOption } from "@/server/teacher-stats";

export interface CohortSelectProps {
  cohorts: CohortOption[];
  selectedId: string;
  basePath?: string;
}

/** Cohort switcher: plain links to `?cohort=<id>`, so it works without client JS and is shareable. */
export function CohortSelect({ cohorts, selectedId, basePath = "/teacher" }: CohortSelectProps) {
  if (cohorts.length < 2) return null;
  return (
    <nav aria-label="Guruhni tanlash">
      <ul className="flex flex-wrap gap-2">
        {cohorts.map((c) => {
          const active = c.id === selectedId;
          return (
            <li key={c.id}>
              <Link
                href={`${basePath}?cohort=${c.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border-2 px-4 text-sm font-bold",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
                  active ? "border-ink bg-ink text-card" : "border-border-strong bg-card text-ink",
                )}
              >
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
