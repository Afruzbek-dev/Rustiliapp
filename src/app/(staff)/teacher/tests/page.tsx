import { TestsIndex } from "@/components/tests/TestsIndex";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/server/guards";
import { loadTestsOverview } from "@/server/tests-admin-read";
import { createTestAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TeacherTestsPage() {
  await requireStaff();
  // RLS-scoped: a teacher sees only the courses (and tests) they teach.
  const overview = await loadTestsOverview(await createClient());
  return <TestsIndex overview={overview} actions={{ createTest: createTestAction }} />;
}
