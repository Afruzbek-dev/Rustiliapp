import { notFound } from "next/navigation";
import { LessonPlayer } from "@/components/lesson/LessonPlayer";
import { requireStudent } from "@/server/guards";
import { signLessonMedia } from "@/server/content-media";
import { getLessonPart } from "@/server/lesson";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LessonPage({ params }: { params: Promise<{ partId: string }> }) {
  const { partId } = await params;
  const { user } = await requireStudent();
  if (!UUID.test(partId)) notFound();

  // RLS-scoped reads; a locked / unknown / unpublished part is a 404.
  const data = await getLessonPart(user.id, partId);
  // Media of blocks the student can see, signed for 1 hour with the service client (never a client path).
  const media = await signLessonMedia(data.blocks);

  // Position is not stored. Only when the student returns from /speak with a submission do we resume
  // after that speaking block; every other visit starts at block 1.
  let initialIndex = 0;
  if (data.progress === "in_progress") {
    data.blocks.forEach((b, i) => {
      if (b.type === "speaking" && data.submittedExerciseIds.includes(b.payload.exerciseId)) {
        initialIndex = Math.min(i + 1, data.blocks.length - 1);
      }
    });
  }

  return <LessonPlayer data={data} media={media} initialIndex={initialIndex} />;
}
