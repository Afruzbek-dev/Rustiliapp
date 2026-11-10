import "server-only";
import { createHmac } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Two-digit code shown both by the bot and on the web login page so the user can confirm
 * they are approving their own login request. Pure: same nonce + secret => same code.
 */
export function loginMatchCode(nonce: string, secret: string = serverEnv().TELEGRAM_WEBHOOK_SECRET): string {
  const mac = createHmac("sha256", secret).update(nonce).digest();
  return String(mac.readUInt32BE(0) % 100).padStart(2, "0");
}
