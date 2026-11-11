import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the href for a page number (1-based). */
  hrefFor: (page: number) => string;
}

const linkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-[var(--radius-sm)] border-2 border-border-strong bg-card px-3 font-bold text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong";
const disabledClass = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-[var(--radius-sm)] border-2 border-border px-3 font-bold text-ink-3";

export function Pagination({ page, pageSize, total, hrefFor }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Sahifalar" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-2">
        {from}–{to} / {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
            <ChevronLeft aria-hidden="true" className="size-5" />
            Oldingi
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            <ChevronLeft aria-hidden="true" className="size-5" />
            Oldingi
          </span>
        )}
        <span className="text-sm font-bold text-ink">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
            Keyingi
            <ChevronRight aria-hidden="true" className="size-5" />
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Keyingi
            <ChevronRight aria-hidden="true" className="size-5" />
          </span>
        )}
      </div>
    </nav>
  );
}
