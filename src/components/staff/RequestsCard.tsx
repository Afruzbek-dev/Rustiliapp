"use client";

import { useActionState, useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { IDLE, type ActionState, type StaffAction } from "./action-state";

export interface RequestItem {
  enrollmentId: string;
  studentName: string;
  /** Already masked. */
  phone: string | null;
}

export interface RequestsCardProps {
  requests: RequestItem[];
  approveAction: StaffAction;
  rejectAction: StaffAction;
}

const toneClass: Record<ActionState["status"], string> = {
  idle: "text-ink-2",
  success: "text-ok-text",
  info: "text-ink-2",
  error: "text-fire-text",
};

function Message({ state }: { state: ActionState }) {
  return (
    <p role="status" className={`text-sm font-bold ${toneClass[state.status]}`}>
      {state.message}
    </p>
  );
}

function Person({ request }: { request: RequestItem }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-bold text-ink">{request.studentName}</p>
      <p className="text-sm text-ink-2">{request.phone ?? "Telefon yo'q"}</p>
    </div>
  );
}

function RequestRow({
  request,
  approveAction,
  rejectAction,
  onSettled,
}: {
  request: RequestItem;
  approveAction: StaffAction;
  rejectAction: StaffAction;
  onSettled: (request: RequestItem, state: ActionState) => void;
}) {
  const [approved, approveForm, approving] = useActionState(approveAction, IDLE);
  const [rejected, rejectForm, rejecting] = useActionState(rejectAction, IDLE);
  const state = rejected.status !== "idle" && approved.status === "idle" ? rejected : approved.status !== "idle" ? approved : IDLE;
  const done = state.status === "success" || state.status === "info";

  useEffect(() => {
    if (state.status === "success" || state.status === "info") onSettled(request, state);
  }, [state, request, onSettled]);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <Person request={request} />
      <div className="flex flex-wrap items-center gap-2">
        {!done && (
          <>
            <form action={approveForm}>
              <input type="hidden" name="enrollmentId" value={request.enrollmentId} />
              <Button type="submit" variant="success" loading={approving} disabled={rejecting}>
                Ruxsat
              </Button>
            </form>
            <form action={rejectForm}>
              <input type="hidden" name="enrollmentId" value={request.enrollmentId} />
              <Button type="submit" variant="secondary" loading={rejecting} disabled={approving}>
                Rad etish
              </Button>
            </form>
          </>
        )}
        <Message state={state} />
      </div>
    </li>
  );
}

/**
 * Pending enrollment requests of the selected cohort. The buttons post to server actions that take
 * the actor from the verified session; the page revalidates after each, so a settled row would
 * vanish: the card keeps its result visible until the next navigation.
 */
export function RequestsCard({ requests, approveAction, rejectAction }: RequestsCardProps) {
  const [settled, setSettled] = useState<Record<string, { request: RequestItem; state: ActionState }>>({});
  const onSettled = (request: RequestItem, state: ActionState) =>
    setSettled((cur) =>
      cur[request.enrollmentId]?.state.message === state.message ? cur : { ...cur, [request.enrollmentId]: { request, state } },
    );
  const live = new Set(requests.map((r) => r.enrollmentId));
  const gone = Object.values(settled).filter((s) => !live.has(s.request.enrollmentId));

  if (requests.length === 0 && gone.length === 0) {
    return (
      <EmptyState icon={<Inbox className="size-8" />} title="Yangi so'rovlar yo'q" text="Ruxsat kutayotgan o'quvchilar shu yerda ko'rinadi." />
    );
  }
  return (
    <ul className="flex flex-col">
      {requests.map((r) => (
        <RequestRow key={r.enrollmentId} request={r} approveAction={approveAction} rejectAction={rejectAction} onSettled={onSettled} />
      ))}
      {gone.map(({ request, state }) => (
        <li key={request.enrollmentId} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
          <Person request={request} />
          <Message state={state} />
        </li>
      ))}
    </ul>
  );
}
