"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function TestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("test failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="p-4">
      <ErrorState
        title="Testni yuklab bo'lmadi"
        text="Javoblaringiz saqlanib qoladi. Qayta urinib ko'ring."
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
