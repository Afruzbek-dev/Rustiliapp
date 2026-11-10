import { PlayCircle } from "lucide-react";
import { Button, Card, Chip, ProgressBar } from "@/components/ui";
import type { CurrentPart } from "@/server/dashboard";

const kindLabel = { grammar: "Grammatika kuni", conversation: "Suhbat kuni" } as const;

export function ContinueCard({ part }: { part: CurrentPart }) {
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <Chip tone="info">{kindLabel[part.kind]}</Chip>
        <h2 className="text-lg font-extrabold">{part.lessonTitle}</h2>
        <ProgressBar value={part.percent} color="ok" label={`${part.lessonTitle}: ${part.percent}%`} />
        <p className="text-sm font-bold text-ink-2">{part.percent}% bajarildi</p>
        <Button href={`/lesson/${part.partId}`} fullWidth>
          <PlayCircle aria-hidden="true" className="size-5" />
          {part.percent > 0 ? "Davom etish" : "Boshlash"}
        </Button>
      </div>
    </Card>
  );
}
