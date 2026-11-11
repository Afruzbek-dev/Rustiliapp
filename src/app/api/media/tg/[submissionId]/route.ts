import { serverEnv } from "@/lib/env";
import { createTelegramFiles } from "@/lib/telegram/files";
import { createClient } from "@/lib/supabase/server";
import { proxyTelegramVideo } from "@/server/tg-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/media/tg/<submissionId>: streams a video submission from Telegram (RLS decides access). */
export async function GET(request: Request, ctx: { params: Promise<{ submissionId: string }> }): Promise<Response> {
  const { submissionId } = await ctx.params;
  const user = await createClient();
  const { data } = await user.auth.getUser();
  // env is read lazily so an anonymous caller gets 401 even when the server env is incomplete
  const files = () => createTelegramFiles(serverEnv().TELEGRAM_BOT_TOKEN);
  return proxyTelegramVideo(
    {
      // USER-scoped client: submissions_select (student / group curator / course teacher / admin).
      async readSubmission(id) {
        const { data: row, error } = await user
          .from("submissions")
          .select("kind, tg_file_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error("read failed");
        return row ? { kind: row.kind as string, tgFileId: (row.tg_file_id as string | null) ?? null } : null;
      },
      getFile: (fileId) => files().getFile(fileId),
      fetchFile: (path, range) => files().fetchFile(path, range),
    },
    { userId: data.user?.id ?? null, submissionId, range: request.headers.get("range") },
  );
}
