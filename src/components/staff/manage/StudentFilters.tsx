import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { inputClass } from "../editor/fields";
import { selectClass } from "./ActionForm";
import type { ListParams, StatusCounts, StudentStatus } from "@/server/manage-read";

export interface GroupOption {
  id: string;
  name: string;
}

const STATUS_LABEL: [StudentStatus | null, string][] = [
  [null, "Hammasi"],
  ["active", "Faol"],
  ["pending", "Kutmoqda"],
  ["expired", "Muddati tugagan"],
  ["rejected", "Rad etilgan"],
];

/** Query string for the students page; empty values are dropped so URLs stay short and shareable. */
export function studentsHref(cohortId: string, p: Partial<ListParams> & { group?: string | null }): string {
  const q = new URLSearchParams({ cohort: cohortId });
  if (p.search) q.set("q", p.search);
  if (p.status) q.set("status", p.status);
  const group = p.group ?? (p.ungrouped ? "none" : (p.groupId ?? null));
  if (group) q.set("group", group);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  return `/teacher/students?${q.toString()}`;
}

export interface StudentFiltersProps {
  cohortId: string;
  params: ListParams;
  counts: StatusCounts;
  groups: GroupOption[];
}

/**
 * Search + filters as a plain GET form (works without client JS and makes the view shareable).
 * Status chips link to the same list with another status.
 */
export function StudentFilters({ cohortId, params, counts, groups }: StudentFiltersProps) {
  const groupValue = params.ungrouped ? "none" : (params.groupId ?? "");
  const countOf = (s: StudentStatus | null) => (s === null ? counts.total : counts[s]);
  return (
    <div className="flex flex-col gap-3">
      <form method="get" action="/teacher/students" role="search" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohort" value={cohortId} />
        {params.status && <input type="hidden" name="status" value={params.status} />}
        <label className="flex min-w-52 flex-[2_1_220px] flex-col gap-1 text-sm font-bold text-ink-2">
          Qidiruv
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            maxLength={64}
            placeholder="Ism yoki telefon oxiri"
            className={inputClass}
          />
        </label>
        <label className="flex min-w-40 flex-[1_1_160px] flex-col gap-1 text-sm font-bold text-ink-2">
          Kurator guruhi
          <select name="group" defaultValue={groupValue} className={selectClass}>
            <option value="">Barcha guruhlar</option>
            <option value="none">Guruhsiz</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">
          <Search aria-hidden="true" className="size-5" />
          Qidirish
        </Button>
      </form>

      <nav aria-label="Holat bo'yicha filtr">
        <ul className="flex flex-wrap gap-2">
          {STATUS_LABEL.map(([status, label]) => {
            const active = params.status === status;
            return (
              <li key={label}>
                <Link
                  href={studentsHref(cohortId, { search: params.search, status, groupId: params.groupId, ungrouped: params.ungrouped })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-bold",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
                    active ? "border-ink bg-ink text-card" : "border-border-strong bg-card text-ink",
                  )}
                >
                  {label}{" "}
                  <span className={active ? "text-card" : "text-ink-2"}>{countOf(status)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
