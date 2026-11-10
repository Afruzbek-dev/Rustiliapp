"use client";

import { useCallback, useState } from "react";

export type MediaState = "ready" | "loading" | "unavailable";

/**
 * Signed media URL of a block. The page signs it on the server; if it is missing (bucket not
 * ready) or expired (1 hour), `refresh` asks GET /api/content/sign again.
 */
export function useMediaUrl(blockId: string, initial: string | null) {
  const [url, setUrl] = useState<string | null>(initial);
  const [state, setState] = useState<MediaState>(initial ? "ready" : "unavailable");

  const refresh = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/content/sign?blockId=${encodeURIComponent(blockId)}`, { cache: "no-store" });
      const data: unknown = res.ok ? await res.json() : null;
      const next = typeof (data as { url?: unknown } | null)?.url === "string" ? (data as { url: string }).url : null;
      setUrl(next);
      setState(next ? "ready" : "unavailable");
    } catch {
      setUrl(null);
      setState("unavailable");
    }
  }, [blockId]);

  const fail = useCallback(() => {
    setUrl(null);
    setState("unavailable");
  }, []);

  return { url, state, refresh, fail };
}
