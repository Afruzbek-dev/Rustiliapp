import "server-only";
import { TelegramDbError } from "@/lib/telegram/api";
import { EnrollmentError } from "@/server/enrollment";

/** Staff-visible log line. Only op, code and update_id: never phone numbers, tokens or messages. */
export function logBotError(error: unknown, updateId?: number): void {
  if (error instanceof TelegramDbError) {
    console.error("telegram bot error", { op: error.op, code: error.code, update_id: updateId });
  } else if (error instanceof EnrollmentError) {
    console.error("telegram bot error", {
      op: error.op,
      code: error.dbCode ? `${error.code}:${error.dbCode}` : error.code,
      update_id: updateId,
    });
  } else {
    console.error("telegram bot error", {
      op: "unknown",
      code: error instanceof Error ? error.name : "unknown",
      update_id: updateId,
    });
  }
}
