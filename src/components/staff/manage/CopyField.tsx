"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui";
import { inputClass } from "../editor/fields";

/** Read-only text (a link) with a copy button; falls back to selecting the text when copying is blocked. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold text-ink-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button variant="secondary" onClick={copy} aria-label={`${label}: nusxalash`}>
          {state === "copied" ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
          {state === "copied" ? "Nusxalandi" : "Nusxalash"}
        </Button>
      </div>
      {state === "failed" && (
        <p role="alert" className="text-sm font-bold text-fire-text">
          Nusxalab bo&apos;lmadi: matnni qo&apos;lda belgilang.
        </p>
      )}
    </div>
  );
}
