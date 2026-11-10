"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Volume2 } from "lucide-react";
import { IconButton } from "@/components/ui";

function canSpeak(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

/** White card with the big Russian word and an optional pronunciation button. */
export function WordCard({
  text,
  speak = true,
  children,
}: {
  text: string;
  speak?: boolean;
  children?: ReactNode;
}) {
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(canSpeak()), []);

  function play() {
    if (!canSpeak()) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-[28px] border-2 border-border bg-card px-4 py-8 text-center">
      <p lang="ru" className="text-[2rem] leading-tight font-extrabold break-words text-ink">
        {text}
      </p>
      {children}
      {speak && supported && (
        <IconButton aria-label="Talaffuzni eshitish" icon={<Volume2 className="size-5" />} onClick={play} />
      )}
    </div>
  );
}
