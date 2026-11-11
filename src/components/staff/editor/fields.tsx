"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export const inputClass =
  "min-h-11 w-full rounded-[var(--radius-sm)] border-2 border-border-strong bg-card px-3 py-2 text-base text-ink " +
  "placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong disabled:opacity-60";

export interface FieldProps {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-bold text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <span className="text-sm text-ink-3">{hint}</span>}
    </div>
  );
}

export function TextField({ label, hint, ...rest }: { label: string; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id">) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} className={inputClass} {...rest} />}</Field>;
}

export function AreaField({ label, hint, ...rest }: { label: string; hint?: string } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id">) {
  return <Field label={label} hint={hint}>{(id) => <textarea id={id} className={`${inputClass} min-h-28 leading-relaxed`} {...rest} />}</Field>;
}

/** Plain bare input for dense rows (label supplied through aria-label). */
export function Bare(props: Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { "aria-label": string }) {
  return <input className={inputClass} {...props} />;
}

export function IssueList({ issues, title = "Tuzatish kerak" }: { issues: string[]; title?: string }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border-2 border-fire bg-fire-bg p-3 text-fire-text">
      <p className="font-bold">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {issues.map((i, n) => (
          <li key={`${n}:${i}`}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
