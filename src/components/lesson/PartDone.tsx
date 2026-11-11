import { Trophy } from "lucide-react";
import { Button } from "@/components/ui";

export interface PartDoneProps {
  /** XP earned by finishing this part; 0 when the student had already completed it. */
  xp: number;
  nextPartId: string | null;
}

export function PartDone({ xp, nextPartId }: PartDoneProps) {
  return (
    <section role="status" className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <span aria-hidden="true" className="inline-flex size-20 items-center justify-center rounded-full bg-brand text-ink">
        <Trophy className="size-10" />
      </span>
      <h1 className="text-3xl font-extrabold">Dars tugallandi!</h1>
      {xp > 0 ? (
        <p className="text-xl font-extrabold text-ok-text">+{xp} XP</p>
      ) : (
        <p className="text-ink-2">Dars tugallangan.</p>
      )}
      <div className="mt-4 flex w-full max-w-sm flex-col gap-3">
        {nextPartId && (
          <Button size="lg" fullWidth href={`/lesson/${nextPartId}`}>
            Keyingi dars
          </Button>
        )}
        <Button size="lg" fullWidth variant={nextPartId ? "secondary" : "primary"} href="/path">
          Yo&apos;lga qaytish
        </Button>
      </div>
    </section>
  );
}
