"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function LessonError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("lesson failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="p-4">
      <ErrorState
        title="Darsni yuklab bo'lmadi"
        action={
          <div className="flex flex-col gap-3">
            <Button onClick={reset}>Qayta urinish</Button>
            <Button variant="secondary" href="/path">
              Yo&apos;lga qaytish
            </Button>
          </div>
        }
      />
    </main>
  );
}
