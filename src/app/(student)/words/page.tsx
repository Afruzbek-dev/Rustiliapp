import { Flashcard } from "@/components/student/Flashcard";
import { requireStudent } from "@/server/guards";
import { getStudyQueue } from "@/server/srs-store";

export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const { user } = await requireStudent();
  const queue = await getStudyQueue(user.id);
  return <Flashcard cards={queue.cards} />;
}
