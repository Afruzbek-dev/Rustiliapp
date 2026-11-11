"use client";

import { useActionState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/ui";
import { IDLE, type ActionState, type StaffAction } from "../action-state";

const toneClass: Record<ActionState["status"], string> = {
  idle: "text-ink-2",
  success: "text-ok-text",
  info: "text-ink-2",
  error: "text-fire-text",
};

export interface ActionFormProps {
  action: StaffAction;
  submitLabel: string;
  variant?: ButtonVariant;
  /** Hidden inputs (ids, flags) and visible fields. */
  children?: ReactNode;
  /** Arrange fields in a row on wide screens. */
  inline?: boolean;
  disabled?: boolean;
}

/**
 * A form posting to a server action. Shows a pending state on the button and the action's result
 * as a status line (green = done, red = failed), so every action reports loading and error states.
 */
export function ActionForm({ action, submitLabel, variant = "secondary", children, inline = false, disabled = false }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="flex min-w-0 flex-col gap-2">
      <div className={inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-2"}>
        {children}
        <Button type="submit" variant={variant} loading={pending} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
      {state.status !== "idle" && (
        <p role={state.status === "error" ? "alert" : "status"} className={`text-sm font-bold ${toneClass[state.status]}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export const selectClass =
  "min-h-11 w-full rounded-[var(--radius-sm)] border-2 border-border-strong bg-card px-3 py-2 text-base text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:opacity-60";
