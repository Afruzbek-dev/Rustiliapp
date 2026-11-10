import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { getWebhookHandler } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  // Hash first so both buffers have equal length and timing does not leak the secret's length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(request: Request): Promise<Response> {
  const given = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(given, serverEnv().TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return getWebhookHandler()(request);
}
