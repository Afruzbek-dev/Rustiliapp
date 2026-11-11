"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, SendHorizontal, Users } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import type { GroupOption } from "./StudentFilters";
import { IDLE, type ActionState, type StaffAction } from "../action-state";
import { ActionForm, selectClass } from "./ActionForm";
import { formatDay, StatusChip } from "./status";
import type { StudentRow } from "@/server/manage-read";

export const BULK_LIMIT = 100;

export interface StudentTableProps {
  cohortId: string;
  rows: StudentRow[];
  groups: GroupOption[];
  /** True when a search or filter is active (changes the empty-state text). */
  filtered: boolean;
  approveAction: StaffAction;
  rejectAction: StaffAction;
  bulkMoveAction: StaffAction;
}

function Row({
  row,
  selected,
  onToggle,
  approveAction,
  rejectAction,
}: {
  row: StudentRow;
  selected: boolean;
  onToggle: (id: string) => void;
  approveAction: StaffAction;
  rejectAction: StaffAction;
}) {
  const pending = row.status === "pending";
  return (
    <tr className="border-t border-border align-middle text-ink">
      <td className="py-1 pr-2">
        <label className="flex size-11 items-center justify-center">
          <input
            type="checkbox"
            className="size-5"
            checked={selected}
            onChange={() => onToggle(row.enrollmentId)}
            aria-label={`${row.name} tanlash`}
          />
        </label>
      </td>
      <th scope="row" className="py-2 pr-3 text-left font-bold">
        <Link
          href={`/teacher/students/${row.enrollmentId}`}
          className="inline-flex min-h-11 items-center underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
        >
          {row.name}
        </Link>
      </th>
      <td className="whitespace-nowrap py-2 pr-3">{row.phone ?? "—"}</td>
      <td className="py-2 pr-3">
        {row.telegramLinked ? (
          <span className="inline-flex items-center gap-1 text-ok-text">
            <Check aria-hidden="true" className="size-4" />
            Ulangan
          </span>
        ) : (
          <span className="text-fire-text">Ulanmagan</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <StatusChip status={row.status} />
      </td>
      <td className="py-2 pr-3">{row.groupName ?? "—"}</td>
      <td className="whitespace-nowrap py-2 pr-3">
        {row.partsTotal > 0 ? `${row.partsCompleted} / ${row.partsTotal}` : "—"}
      </td>
      <td className="whitespace-nowrap py-2 pr-3">{formatDay(row.lastActive)}</td>
      <td className="py-2">
        {pending ? (
          <div className="flex gap-2">
            <ActionForm action={approveAction} submitLabel="Ruxsat" variant="success">
              <input type="hidden" name="enrollmentId" value={row.enrollmentId} />
            </ActionForm>
            <ActionForm action={rejectAction} submitLabel="Rad etish" variant="secondary">
              <input type="hidden" name="enrollmentId" value={row.enrollmentId} />
            </ActionForm>
          </div>
        ) : (
          <Link
            href={`/teacher/students/${row.enrollmentId}`}
            className="inline-flex min-h-11 items-center font-bold text-info-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info-strong"
          >
            Batafsil
          </Link>
        )}
      </td>
    </tr>
  );
}

/**
 * The cohort's students. Rows can be ticked and moved to another curator group in bulk (at most
 * BULK_LIMIT per call, the same cap the server enforces). The table scrolls horizontally on a phone.
 */
export function StudentTable({ cohortId, rows, groups, filtered, approveAction, rejectAction, bulkMoveAction }: StudentTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [bulkState, bulkForm, bulkPending] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await bulkMoveAction(prev, fd);
      if (next.status === "success") setSelected(new Set());
      return next;
    },
    IDLE,
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-10" />}
        title={filtered ? "Hech kim topilmadi" : "Hali o'quvchilar yo'q"}
        text={filtered ? "Qidiruv yoki filtrni o'zgartirib ko'ring." : "O'quvchilar botdan ro'yxatdan o'tgach shu yerda ko'rinadi."}
      />
    );
  }

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pageIds = rows.map((r) => r.enrollmentId);
  const allSelected = pageIds.every((id) => selected.has(id));
  const tooMany = selected.size > BULK_LIMIT;

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <form
          action={bulkForm}
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border-2 border-border-strong bg-surface-2 p-3"
        >
          <input type="hidden" name="cohortId" value={cohortId} />
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="enrollmentIds" value={id} />
          ))}
          <p className="w-full text-sm font-bold text-ink" role="status">
            Tanlangan: {selected.size} ta
            {tooMany && <span className="text-fire-text"> (bir martada {BULK_LIMIT} tadan ko&apos;p emas)</span>}
          </p>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-bold text-ink-2">
            Guruhga ko&apos;chirish
            <select
              name="groupId"
              className={selectClass}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Guruhsiz</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" loading={bulkPending} disabled={tooMany}>
            <SendHorizontal aria-hidden="true" className="size-5" />
            Ko&apos;chirish
          </Button>
          <Button variant="secondary" onClick={() => setSelected(new Set())}>
            Bekor qilish
          </Button>
        </form>
      )}
      {bulkState.status !== "idle" && (
        <p
          role={bulkState.status === "error" ? "alert" : "status"}
          className={`text-sm font-bold ${bulkState.status === "error" ? "text-fire-text" : "text-ok-text"}`}
        >
          {bulkState.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <caption className="sr-only">O&apos;quvchilar ro&apos;yxati</caption>
          <thead>
            <tr className="text-ink-2">
              <th scope="col" className="py-2 pr-2">
                <label className="flex size-11 items-center justify-center">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(pageIds))}
                    aria-label="Sahifadagi hammasini tanlash"
                  />
                </label>
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">Ism</th>
              <th scope="col" className="py-2 pr-3 font-bold">Telefon</th>
              <th scope="col" className="py-2 pr-3 font-bold">Telegram</th>
              <th scope="col" className="py-2 pr-3 font-bold">Holat</th>
              <th scope="col" className="py-2 pr-3 font-bold">Guruh</th>
              <th scope="col" className="py-2 pr-3 font-bold">Progress</th>
              <th scope="col" className="py-2 pr-3 font-bold">Oxirgi faollik</th>
              <th scope="col" className="py-2 font-bold">
                <span className="sr-only">Amallar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row
                key={r.enrollmentId}
                row={r}
                selected={selected.has(r.enrollmentId)}
                onToggle={toggle}
                approveAction={approveAction}
                rejectAction={rejectAction}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
