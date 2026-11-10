"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function WordsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Name and digest only: the message may carry user data.
    console.error("words page failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="p-4">
      <ErrorState
        title="So'zlarni yuklab bo'lmadi"
        action={<Button onClick={reset}>Qayta urinish</Button>}
      />
    </main>
  );
}
