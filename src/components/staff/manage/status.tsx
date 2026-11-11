import { Chip, type ChipTone } from "@/components/ui";
import type { StudentStatus } from "@/server/manage-read";

const LABEL: Record<StudentStatus, string> = {
  active: "Faol",
  pending: "Kutmoqda",
  expired: "Muddati tugagan",
  rejected: "Rad etilgan",
};
const TONE: Record<StudentStatus, ChipTone> = {
  active: "ok",
  pending: "info",
  expired: "fire",
  rejected: "neutral",
};

export function StatusChip({ status }: { status: StudentStatus }) {
  return <Chip tone={TONE[status]}>{LABEL[status]}</Chip>;
}

export const statusLabel = (s: StudentStatus): string => LABEL[s];

/** "2026-03-04" or an ISO timestamp -> "04.03.2026" (calendar day as written; no timezone shifts). */
export function formatDay(value: string | null): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "—";
}

/** An ISO instant shown as its Asia/Tashkent calendar day. */
export function formatInstantDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}.${p.year}`;
}
