import { Users } from "lucide-react";
import { Chip, EmptyState } from "@/components/ui";
import type { TestResultRow } from "@/lib/tests/editor-types";

const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function status(r: TestResultRow): { label: string; tone: "ok" | "fire" | "info" | "neutral" } {
  if (r.passed) return { label: "O'tdi", tone: "ok" };
  if (r.inProgress) return { label: "Jarayonda", tone: "info" };
  if (r.attempts > 0) return { label: "O'tmadi", tone: "fire" };
  return { label: "Boshlamagan", tone: "neutral" };
}

/** Per student: best score, attempts, state. The data comes from test_results() (authorised in SQL). */
export function TestResultsTable({ rows }: { rows: TestResultRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={<Users className="size-10" />} title="Hali o'quvchi yo'q" text="Test topshirilganda natijalar shu yerda ko'rinadi." />;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border-2 border-border bg-card">
      <table className="w-full min-w-[34rem] text-left">
        <caption className="sr-only">Test natijalari</caption>
        <thead className="bg-surface-2 text-sm text-ink-2">
          <tr>
            <th scope="col" className="p-3">O&apos;quvchi</th>
            <th scope="col" className="p-3">Eng yaxshi ball</th>
            <th scope="col" className="p-3">Urinishlar</th>
            <th scope="col" className="p-3">Holat</th>
            <th scope="col" className="p-3">Oxirgi urinish</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = status(r);
            return (
              <tr key={r.studentId} className="border-t-2 border-border">
                <th scope="row" className="p-3 font-bold">{r.fullName}</th>
                <td className="p-3 tabular-nums">{r.bestScore === null ? "—" : `${r.bestScore}%`}</td>
                <td className="p-3 tabular-nums">{r.attempts}</td>
                <td className="p-3">
                  <Chip tone={s.tone}>{s.label}</Chip>
                </td>
                <td className="p-3 tabular-nums text-ink-2">{r.lastFinishedAt ? fmt.format(new Date(r.lastFinishedAt)) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
