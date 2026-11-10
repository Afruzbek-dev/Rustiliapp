import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32).regex(/^[A-Za-z0-9_-]+$/),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_ARCHIVE_CHAT_ID: z.string().min(1),
  TELEGRAM_STAFF_CHAT_ID: z.string().min(1),
  APP_URL: z.string().url(),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, unknown>, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ");
  throw new Error(`Invalid or missing ${label} environment variables: ${names}`);
}

let cachedServer: ServerEnv | undefined;
let cachedPublic: PublicEnv | undefined;

/** Validates lazily on first call (never at import time, so `next build` works without secrets). */
export function serverEnv(source?: Record<string, unknown>): ServerEnv {
  if (source) return parse(serverSchema, source, "server");
  return (cachedServer ??= parse(serverSchema, process.env, "server"));
}

export function publicEnv(source?: Record<string, unknown>): PublicEnv {
  if (source) return parse(publicSchema, source, "public");
  // NEXT_PUBLIC_* must be referenced statically so Next inlines them in the client bundle.
  return (cachedPublic ??= parse(
    publicSchema,
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    "public",
  ));
}
