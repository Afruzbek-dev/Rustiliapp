import { EnrollmentError, type ApproveResult, type RejectResult } from "./enrollment";

import type { ActionState } from "@/components/staff/action-state";

export type { ActionState };

export function approveState(res: Pick<ApproveResult, "outcome">): ActionState {
  switch (res.outcome) {
    case "approved":
      return { status: "success", message: "Ochildi" };
    case "already_approved":
      return { status: "info", message: "Allaqachon tasdiqlangan" };
    case "cohort_closed":
      return { status: "error", message: "Guruh yopilgan" };
  }
}

export function rejectState(res: Pick<RejectResult, "outcome">): ActionState {
  switch (res.outcome) {
    case "rejected":
      return { status: "success", message: "Rad etildi" };
    case "already_rejected":
      return { status: "info", message: "Allaqachon rad etilgan" };
    case "conflict":
      return { status: "error", message: "Holat o'zgargan, sahifani yangilang" };
  }
}

/** Typed failure -> teacher-facing state. Logs only the code, never row data. */
export function failureState(err: unknown): ActionState {
  if (err instanceof EnrollmentError) {
    console.error("teacher request failed", { op: err.op, code: err.code });
    if (err.code === "forbidden") return { status: "error", message: "Sizda bu amal uchun ruxsat yo'q" };
    if (err.code === "not_found") return { status: "error", message: "So'rov topilmadi" };
    return { status: "error", message: "Xatolik yuz berdi, qayta urinib ko'ring" };
  }
  console.error("teacher request failed", { code: err instanceof Error ? err.name : "unknown" });
  return { status: "error", message: "Xatolik yuz berdi, qayta urinib ko'ring" };
}

export function reminderState(outcome: "sent" | "already_sent" | "not_member" | "no_telegram" | "send_failed"): ActionState {
  switch (outcome) {
    case "sent":
      return { status: "success", message: "Eslatma yuborildi" };
    case "already_sent":
      return { status: "info", message: "Bugun eslatma yuborilgan" };
    case "no_telegram":
      return { status: "error", message: "Telegram ulanmagan" };
    case "not_member":
      return { status: "error", message: "Sizda bu o'quvchi uchun ruxsat yo'q" };
    case "send_failed":
      return { status: "error", message: "Xabarni yuborib bo'lmadi, keyinroq urinib ko'ring" };
  }
}
