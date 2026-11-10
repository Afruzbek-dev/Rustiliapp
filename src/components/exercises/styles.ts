export type OptionState = "idle" | "ok" | "wrong" | "reveal";

const base =
  "w-full rounded-[var(--radius-lg)] border-2 px-4 text-left font-bold text-ink transition-[transform,box-shadow] duration-150 motion-reduce:transition-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:pointer-events-none";

const states: Record<OptionState, string> = {
  idle: "bg-card border-border-strong shadow-[0_5px_0_var(--border-strong)] active:translate-y-[3px] active:shadow-[0_2px_0_var(--border-strong)] motion-reduce:active:translate-y-0",
  ok: "bg-ok-bg border-ok text-ok-text shadow-[0_5px_0_var(--ok-shadow)]",
  wrong: "bg-fire-bg border-fire text-fire-text shadow-[0_5px_0_var(--fire-shadow)]",
  reveal: "bg-card border-dashed border-ok text-ok-text",
};

export function optionClass(state: OptionState, tall = false): string {
  return `${base} ${states[state]} ${tall ? "min-h-[104px] py-4" : "min-h-14 py-3"}`;
}

export type ExerciseProps<P> = {
  exerciseId: string;
  payload: P;
  /** Called after the student passed the last step. */
  onDone?: () => void;
};
