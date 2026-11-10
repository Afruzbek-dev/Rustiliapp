"use client";

import { Button, ErrorState } from "@/components/ui";

export default function HomeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="p-4">
      <ErrorState
        title="Bosh sahifani yuklab bo'lmadi"
        action={<Button onClick={reset}>Qayta urinish</Button>}
      />
    </main>
  );
}
