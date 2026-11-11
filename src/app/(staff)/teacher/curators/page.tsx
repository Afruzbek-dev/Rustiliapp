import { GraduationCap } from "lucide-react";
import { CohortSelect } from "@/components/staff/CohortSelect";
import { CuratorsPanel } from "@/components/staff/manage/CuratorsPanel";
import { Button, EmptyState } from "@/components/ui";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStaff } from "@/server/guards";
import { findCuratorsFn, supabaseManageDb, type CuratorCandidate } from "@/server/manage";
import { getCohortCounts, listGroups } from "@/server/manage-read";
import { listCohorts, pickCohort } from "@/server/teacher-stats";
import { assignCuratorAction, createGroupAction, reassignGroupAction, updateGroupAction } from "../manage-actions";

export const dynamic = "force-dynamic";

export default async function CuratorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireStaff();
  const sp = await searchParams;
  const cohorts = await listCohorts();
  const cohort = pickCohort(cohorts, sp.cohort);

  if (!cohort) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-2xl font-extrabold">Kuratorlar</h1>
        <EmptyState
          icon={<GraduationCap className="size-10" />}
          title="Hali guruh yo'q"
          text="Kurator guruhlari kohorta ichida yaratiladi."
          action={<Button href="/teacher/cohorts">Guruh yaratish</Button>}
        />
      </main>
    );
  }

  const rawFind = sp.find;
  const findQuery = (Array.isArray(rawFind) ? rawFind[0] : rawFind)?.trim().slice(0, 64) ?? "";
  let candidates: CuratorCandidate[] | null = null;
  let findError: string | null = null;
  if (findQuery) {
    // The actor comes from the verified session; the SQL function re-checks teacher/admin role.
    const found = await findCuratorsFn(supabaseManageDb(createServiceClient()), user.id, { query: findQuery });
    if (found.ok) candidates = found.candidates;
    else findError = found.message;
  }

  const [groups, counts] = await Promise.all([listGroups(cohort.id), getCohortCounts(cohort.id)]);
  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Kuratorlar</h1>
        <CohortSelect cohorts={cohorts} selectedId={cohort.id} basePath="/teacher/curators" />
      </div>
      <p className="text-ink-2">Guruh: {cohort.name}</p>
      <CuratorsPanel
        cohortId={cohort.id}
        groups={groups}
        counts={counts}
        candidates={candidates}
        findQuery={findQuery}
        findError={findError}
        handlers={{
          createGroup: createGroupAction,
          updateGroup: updateGroupAction,
          assign: assignCuratorAction,
          reassign: reassignGroupAction,
        }}
      />
    </main>
  );
}
