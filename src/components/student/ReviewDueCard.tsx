import { Layers } from "lucide-react";
import { Button, Card } from "@/components/ui";

export function ReviewDueCard({ count }: { count: number }) {
  return (
    <Card tone="muted">
      <div className="flex items-center gap-3">
        <Layers aria-hidden="true" className="size-8 text-info-strong" />
        <div className="flex-1">
          <p className="font-extrabold">Takrorlash</p>
          <p className="text-sm text-ink-2">
            {count > 0 ? `${count} ta so'z takrorlashga tayyor` : "Hozircha takrorlash kerak emas"}
          </p>
        </div>
        {count > 0 && <Button href="/words">Boshlash</Button>}
      </div>
    </Card>
  );
}
