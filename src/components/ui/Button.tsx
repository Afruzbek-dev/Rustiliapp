import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "dark";
export type ButtonSize = "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-ink shadow-[0_5px_0_var(--brand-shadow)] active:shadow-[0_2px_0_var(--brand-shadow)]",
  secondary:
    "bg-surface-2 text-ink border-2 border-border-strong shadow-[0_5px_0_var(--border-strong)] active:shadow-[0_2px_0_var(--border-strong)]",
  success:
    "bg-ok text-ink shadow-[0_5px_0_var(--ok-shadow)] active:shadow-[0_2px_0_var(--ok-shadow)]",
  danger:
    "bg-fire text-ink shadow-[0_5px_0_var(--fire-shadow)] active:shadow-[0_2px_0_var(--fire-shadow)]",
  dark: "bg-ink text-brand shadow-[0_5px_0_#000] active:shadow-[0_2px_0_#000]",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-12 px-5 text-base",
  lg: "h-14 px-6 text-lg",
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  href?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  href,
  fullWidth = false,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-bold",
    "transition-[transform,box-shadow] duration-150 active:translate-y-[3px]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong",
    "disabled:opacity-60 disabled:pointer-events-none aria-disabled:opacity-60 aria-disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    fullWidth && "w-full",
  );

  if (href !== undefined) {
    const isDisabled = disabled || loading;
    return (
      <Link
        href={href}
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        tabIndex={isDisabled ? -1 : undefined}
      >
        {loading && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
