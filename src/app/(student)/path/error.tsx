"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function PathError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("learning path failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="p-4">
      <ErrorState
        title="Yo'lni yuklab bo'lmadi"
        action={<Button onClick={reset}>Qayta urinish</Button>}
      />
    </main>
  );
}
