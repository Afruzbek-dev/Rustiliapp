import { Chip } from "@/components/ui";
import type { CuratorRow } from "@/server/teacher-stats";

export const QUEUE_ALERT = 15;

const dash = "—";
const fmt = (v: number | null, digits: number, suffix = "") => (v === null ? dash : `${v.toFixed(digits)}${suffix}`);

export interface CuratorTableProps {
  rows: CuratorRow[];
}

export function CuratorTable({ rows }: CuratorTableProps) {
  if (rows.length === 0) {
    return <p className="text-ink-2">Kurator guruhlari hali yo&apos;q.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-sm">
        <caption className="sr-only">Kuratorlar statistikasi</caption>
        <thead>
          <tr className="text-ink-2">
            <th scope="col" className="py-2 pr-3 font-bold">Guruh</th>
            <th scope="col" className="py-2 pr-3 font-bold">Kurator</th>
            <th scope="col" className="py-2 pr-3 text-right font-bold">O&apos;quvchilar</th>
            <th scope="col" className="py-2 pr-3 text-right font-bold">Navbat</th>
            <th scope="col" className="py-2 pr-3 text-right font-bold">O&apos;rtacha baho</th>
            <th scope="col" className="py-2 text-right font-bold">Javob vaqti</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.groupId} className="border-t border-border text-ink">
              <th scope="row" className="py-2 pr-3 font-bold">{r.groupName}</th>
              <td className="py-2 pr-3">{r.curatorName || "Tayinlanmagan"}</td>
              <td className="py-2 pr-3 text-right">{r.students}</td>
              <td className="py-2 pr-3 text-right">
                {r.pendingQueue > QUEUE_ALERT ? (
                  <Chip tone="fire">
                    {r.pendingQueue}
                    <span className="sr-only"> ta, navbat uzun</span>
                  </Chip>
                ) : (
                  r.pendingQueue
                )}
              </td>
              <td className="py-2 pr-3 text-right">{fmt(r.avgScore, 2)}</td>
              <td className="py-2 text-right">{fmt(r.avgResponseHours, 1, " soat")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
