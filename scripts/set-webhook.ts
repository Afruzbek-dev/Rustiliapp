/**
 * Registers the Telegram webhook.
 * Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://example.com pnpm telegram:set-webhook
 * The token is never printed.
 */

interface TelegramResult {
  ok: boolean;
  description?: string;
  result?: unknown;
}

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;

  if (!token || !secret || !appUrl) {
    const missing = [
      !token && "TELEGRAM_BOT_TOKEN",
      !secret && "TELEGRAM_WEBHOOK_SECRET",
      !appUrl && "APP_URL",
    ].filter(Boolean);
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const url = `${appUrl.replace(/\/+$/, "")}/api/telegram/webhook`;
  console.log(`Setting webhook to ${url}`);

  let body: TelegramResult;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      }),
    });
    body = (await res.json()) as TelegramResult;
  } catch (err) {
    // Never print the error message: node may include the request URL, which contains the token.
    console.error("Request to Telegram failed:", err instanceof Error ? err.name : "unknown error");
    process.exit(1);
  }

  console.log(JSON.stringify(body, null, 2));
  if (!body.ok) {
    process.exit(1);
  }
}

void main();
