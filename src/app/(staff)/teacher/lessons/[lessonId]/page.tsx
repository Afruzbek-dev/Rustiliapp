import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/server/guards";
import { loadEditorData } from "@/server/content-admin-read";
import { EditorShell } from "./EditorShell";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LessonEditorPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  await requireStaff();
  if (!UUID.test(lessonId)) notFound();
  // RLS-scoped: a lesson of another teacher's course is simply not visible -> 404.
  const data = await loadEditorData(await createClient(), lessonId);
  if (!data) notFound();
  return <EditorShell data={data} />;
}
