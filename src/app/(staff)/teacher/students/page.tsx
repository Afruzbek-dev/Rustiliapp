import { GraduationCap } from "lucide-react";
import { CohortSelect } from "@/components/staff/CohortSelect";
import { Pagination } from "@/components/staff/manage/Pagination";
import { StudentFilters, studentsHref } from "@/components/staff/manage/StudentFilters";
import { StudentTable } from "@/components/staff/manage/StudentTable";
import { Button, EmptyState } from "@/components/ui";
import { requireStaff } from "@/server/guards";
import { listGroups, listStudents, parseListParams } from "@/server/manage-read";
import { listCohorts, pickCohort } from "@/server/teacher-stats";
import { approveStudentAction, bulkMoveAction, rejectStudentAction } from "../manage-actions";

export const dynamic = "force-dynamic";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const sp = await searchParams;
  const cohorts = await listCohorts();
  const cohort = pickCohort(cohorts, sp.cohort);

  if (!cohort) {
    return (
      <main className="p-4">
        <h1 className="mb-4 text-2xl font-extrabold">O&apos;quvchilar</h1>
        <EmptyState
          icon={<GraduationCap className="size-10" />}
          title="Hali guruh yo'q"
          text="O'quvchilarni ko'rish uchun avval guruh yarating."
          action={<Button href="/teacher/cohorts">Guruh yaratish</Button>}
        />
      </main>
    );
  }

  const params = parseListParams(sp);
  const [data, groups] = await Promise.all([listStudents(cohort.id, params), listGroups(cohort.id)]);
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const filtered = Boolean(params.search || params.status || params.groupId || params.ungrouped);

  return (
    <main className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">O&apos;quvchilar</h1>
        <CohortSelect cohorts={cohorts} selectedId={cohort.id} basePath="/teacher/students" />
      </div>
      <p className="text-ink-2">Guruh: {cohort.name}</p>
      <StudentFilters cohortId={cohort.id} params={params} counts={data.counts} groups={groupOptions} />
      <StudentTable
        key={`${params.page}-${params.search}-${params.status}-${params.groupId}`}
        cohortId={cohort.id}
        rows={data.rows}
        groups={groupOptions}
        filtered={filtered}
        approveAction={approveStudentAction}
        rejectAction={rejectStudentAction}
        bulkMoveAction={bulkMoveAction}
      />
      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        hrefFor={(page) => studentsHref(cohort.id, { ...params, page })}
      />
    </main>
  );
}
