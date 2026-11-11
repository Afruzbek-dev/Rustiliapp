"use client";

import { useEffect } from "react";
import { Button, ErrorState } from "@/components/ui";

export default function CuratorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Name and digest only: the message may carry student data.
    console.error("curator queue failed", { name: error.name, digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">Tekshirish navbati</h1>
      <ErrorState
        title="Navbatni yuklab bo'lmadi"
        action={<Button onClick={reset}>Qayta urinish</Button>}
      />
    </main>
  );
}
