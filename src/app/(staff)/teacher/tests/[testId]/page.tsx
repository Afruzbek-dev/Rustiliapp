import { notFound } from "next/navigation";
import { TestEditor } from "@/components/tests/TestEditor";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/server/guards";
import { loadTestEditor } from "@/server/tests-admin-read";
import {
  addItemAction,
  createTestAction,
  deleteTestAction,
  removeItemAction,
  reorderItemsAction,
  setTestPublishedAction,
  updateItemAction,
  updateTestAction,
} from "../actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TeacherTestPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  await requireStaff();
  if (!UUID.test(testId)) notFound();
  // RLS-scoped: a test of another teacher's course is simply not visible -> 404.
  const test = await loadTestEditor(await createClient(), testId);
  if (!test) notFound();
  return (
    <TestEditor
      test={test}
      actions={{
        createTest: createTestAction,
        updateTest: updateTestAction,
        addItem: addItemAction,
        updateItem: updateItemAction,
        removeItem: removeItemAction,
        reorderItems: reorderItemsAction,
        setPublished: setTestPublishedAction,
        deleteTest: deleteTestAction,
      }}
    />
  );
}
