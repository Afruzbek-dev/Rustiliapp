"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function RatingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("rating failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="p-4">
      <ErrorState
        title="Reytingni yuklab bo'lmadi"
        action={<Button onClick={reset}>Qayta urinish</Button>}
      />
    </main>
  );
}
