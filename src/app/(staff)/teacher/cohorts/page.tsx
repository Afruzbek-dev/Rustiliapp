import { CohortsPanel, type ShareLinks } from "@/components/staff/manage/CohortsPanel";
import { requireStaff } from "@/server/guards";
import { listCohortOverview, listCourses } from "@/server/manage-read";
import { createCohortAction, setCohortAccessAction, updateCohortAction } from "../manage-actions";

export const dynamic = "force-dynamic";

/** Share links come from plain env reads: a missing variable only hides that link. */
function shareLinks(): ShareLinks {
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const app = (process.env.APP_URL ?? "").trim().replace(/\/$/, "");
  return {
    bot: /^[A-Za-z0-9_]{3,64}$/.test(bot) ? `https://t.me/${bot}` : null,
    site: /^https?:\/\//.test(app) ? `${app}/login` : null,
  };
}

export default async function CohortsPage() {
  await requireStaff();
  const [cohorts, courses] = await Promise.all([listCohortOverview(), listCourses()]);
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-extrabold">Guruhlar (kohortalar)</h1>
      <CohortsPanel
        cohorts={cohorts}
        courses={courses}
        links={shareLinks()}
        handlers={{ create: createCohortAction, update: updateCohortAction, setAccess: setCohortAccessAction }}
      />
    </main>
  );
}
