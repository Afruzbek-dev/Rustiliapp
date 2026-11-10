"use client";

export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand)] px-6 font-bold text-[var(--ink)] shadow-[0_5px_0_var(--brand-shadow)] transition-all duration-150 active:translate-y-[3px] active:shadow-[0_2px_0_var(--brand-shadow)]"
    >
      Qayta urinish
    </button>
  );
}
