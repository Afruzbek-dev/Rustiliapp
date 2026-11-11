"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export type SaveOutcome =
  | { ok: true; updatedAt: string }
  | { ok: false; code: string; message: string; currentUpdatedAt?: string; issues?: string[] };

export interface AutosaveOptions<V> {
  value: V;
  /** The concurrency token (updated_at) the value was loaded with. */
  token: string;
  save: (value: V, token: string) => Promise<SaveOutcome>;
  /** Debounce in ms (plan: 1500). */
  delay?: number;
  onSaved?: (value: V, updatedAt: string) => void;
}

export interface Autosave {
  state: SaveState;
  message: string;
  issues: string[];
  /** Saves now (if dirty) and resolves true when everything is saved. */
  flush: () => Promise<boolean>;
  /** After a conflict: keep MY version and save over the server's. */
  overwrite: () => Promise<boolean>;
}

/**
 * Debounced autosave with optimistic concurrency. Saves are serial (never two in flight), always
 * carry the newest token, and the latest value always wins: a change made while saving is saved next.
 * A conflict stops saving until the user chooses overwrite (or reloads the page).
 */
export function useAutosave<V>({ value, token, save, delay = 1500, onSaved }: AutosaveOptions<V>): Autosave {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const valueRef = useRef(value);
  const tokenRef = useRef(token);
  const savedJson = useRef(JSON.stringify(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const blocked = useRef(false); // conflict or validation error: wait for a new change / overwrite
  const conflictToken = useRef<string | null>(null);
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  valueRef.current = value;
  saveRef.current = save;
  onSavedRef.current = onSaved;

  const isDirty = () => JSON.stringify(valueRef.current) !== savedJson.current;

  const run = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      let allSaved = true;
      while (isDirty() && !blocked.current) {
        const snapshot = valueRef.current;
        const json = JSON.stringify(snapshot);
        setState("saving");
        let res: SaveOutcome;
        try {
          res = await saveRef.current(snapshot, tokenRef.current);
        } catch {
          res = { ok: false, code: "failed", message: "Ulanishda xatolik: saqlanmadi" };
        }
        if (res.ok) {
          tokenRef.current = res.updatedAt;
          savedJson.current = json;
          onSavedRef.current?.(snapshot, res.updatedAt);
          continue;
        }
        allSaved = false;
        blocked.current = true;
        setMessage(res.message);
        setIssues(res.issues ?? []);
        if (res.code === "conflict") {
          conflictToken.current = res.currentUpdatedAt ?? null;
          setState("conflict");
        } else {
          setState("error");
        }
      }
      if (allSaved && !isDirty()) {
        setState("saved");
        setMessage("");
        setIssues([]);
      }
      return allSaved && !isDirty();
    })();
    inFlight.current = p;
    try {
      return await p;
    } finally {
      inFlight.current = null;
    }
  }, []);

  // A new edit unblocks validation errors (but not a conflict) and (re)starts the debounce.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!isDirty()) return;
    if (blocked.current && conflictToken.current === null) blocked.current = false;
    if (blocked.current) return;
    setState((s) => (s === "saving" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay, run]);

  // Leaving the editor (client navigation) must not drop an edit that is still waiting for the debounce.
  useEffect(
    () => () => {
      if (isDirty() && !blocked.current) void run();
    },
    [run],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (inFlight.current) await inFlight.current;
    if (!isDirty()) return !blocked.current;
    blocked.current = blocked.current && conflictToken.current !== null;
    return run();
  }, [run]);

  const overwrite = useCallback(async () => {
    if (conflictToken.current) tokenRef.current = conflictToken.current;
    conflictToken.current = null;
    blocked.current = false;
    return run();
  }, [run]);

  return { state, message, issues, flush, overwrite };
}
