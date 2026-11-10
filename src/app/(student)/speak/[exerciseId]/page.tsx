import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Video } from "lucide-react";
import { Card } from "@/components/ui";
import { PromptCard } from "@/components/speaking/PromptCard";
import { Recorder } from "@/components/speaking/Recorder";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { serverEnv } from "@/lib/env";
import { requireStudent } from "@/server/guards";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function botUsername(): string | null {
  try {
    return serverEnv().TELEGRAM_BOT_USERNAME.replace(/^@/, "");
  } catch {
    return null;
  }
}

export default async function SpeakPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const { exerciseId } = await params;
  const { user } = await requireStudent();
  if (!UUID.test(exerciseId)) notFound();

  // RLS proves visibility (published block of the student's active course); test items and
  // non-speaking exercises get the same 404.
  const supabase = await createClient();
  const { data: ex } = await supabase
    .from("exercises")
    .select("id, type, check_mode, prompt, blocks(lesson_part_id)")
    .eq("id", exerciseId)
    .maybeSingle();
  const blocks = ex?.blocks as { lesson_part_id: string } | { lesson_part_id: string }[] | null | undefined;
  const hasBlock = Array.isArray(blocks) ? blocks.length > 0 : !!blocks;
  if (!ex || !hasBlock || ex.check_mode !== "review" || (ex.type !== "speaking" && ex.type !== "open_text")) notFound();
  const { data: testItem } = await createServiceClient()
    .from("test_items")
    .select("test_id")
    .eq("exercise_id", exerciseId)
    .limit(1);
  if ((testItem ?? []).length > 0) notFound();

  const { data: last } = await supabase
    .from("submissions")
    .select("id, created_at, reviews(total, comment, created_at)")
    .eq("student_id", user.id)
    .eq("exercise_id", exerciseId)
    .eq("status", "reviewed")
    .order("created_at", { ascending: false })
    .limit(1);
  const reviews = ((last?.[0]?.reviews ?? []) as { total: number | string; comment: string | null; created_at: string }[])
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const review = reviews[0] ?? null;

  const bot = botUsername();

  return (
    <main className="flex flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Link
          href="/home"
          aria-label="Orqaga"
          className="inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] border-2 border-border-strong bg-surface-2"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </Link>
        <h1 className="text-xl font-extrabold">Gapirish</h1>
      </header>

      <PromptCard prompt={ex.prompt ?? ""} />
      <Recorder exerciseId={exerciseId} />

      {bot && (
        <a
          href={`https://t.me/${bot}?start=task_${exerciseId}`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-border-strong px-4 font-bold text-info-strong"
        >
          <Video aria-hidden="true" className="size-5" />
          Video-krujok yuborish
        </a>
      )}

      {review && (
        <Card tone="muted">
          <h2 className="font-extrabold">Oxirgi baho</h2>
          <p className="text-3xl font-extrabold">{Number(review.total).toFixed(1)} <span className="text-base text-ink-3">/ 5</span></p>
          {review.comment && <p className="mt-2 text-ink-2">{review.comment}</p>}
        </Card>
      )}
    </main>
  );
}
