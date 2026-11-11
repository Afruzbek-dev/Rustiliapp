import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { loadCourseTrees } from "@/server/content-admin-read";
import { requireStaff } from "@/server/guards";
import { CourseTrees } from "./CourseTrees";

export const dynamic = "force-dynamic";

export default async function LessonsIndexPage() {
  await requireStaff();
  const courses = await loadCourseTrees(await createClient());
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-extrabold">Kurslar va darslar</h1>
      {courses.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-10" />} title="Hali kurs yo'q" text="Kurs yaratilgach, darslar shu yerda ko'rinadi." />
      ) : (
        <CourseTrees courses={courses} />
      )}
    </main>
  );
}
