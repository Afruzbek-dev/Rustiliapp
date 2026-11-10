"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui";

export function PromptCard({ prompt }: { prompt: string }) {
  const [hidden, setHidden] = useState(false);
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-extrabold">Topshiriq</h2>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          aria-pressed={hidden}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 font-semibold text-info-strong"
        >
          {hidden ? <Eye aria-hidden="true" className="size-5" /> : <EyeOff aria-hidden="true" className="size-5" />}
          {hidden ? "Matnni ko'rsatish" : "Matnni yashirish"}
        </button>
      </div>
      {hidden ? (
        <p className="mt-2 text-ink-3">Matn yashirilgan.</p>
      ) : (
        <p lang="ru" className="mt-2 text-lg">
          {prompt}
        </p>
      )}
    </Card>
  );
}
