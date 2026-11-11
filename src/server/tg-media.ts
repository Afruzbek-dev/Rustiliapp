import { MAX_VIDEO_BYTES } from "./video-submissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGE_RE = /^bytes=\d*-\d*$/;

export interface MediaSubmission {
  kind: string;
  tgFileId: string | null;
}

export interface TgMediaDeps {
  /** USER-scoped read: RLS / can_read_submission decide; null when absent OR not readable. */
  readSubmission(submissionId: string): Promise<MediaSubmission | null>;
  /** Bot API getFile. Throws on failure (the message may contain the token: never logged). */
  getFile(fileId: string): Promise<{ filePath: string; fileSize?: number }>;
  /** GET the file from Telegram's file server (the URL, with the bot token, stays in here). */
  fetchFile(filePath: string, range: string | null): Promise<Response>;
}

/** Streams `body` through, erroring (aborting the response) once more than `max` bytes passed. */
export function capStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new Error("too_large"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

const baseHeaders ={ "X-Content-Type-Options": "nosniff" } as const;

function plain(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

/**
 * Streams a video submission from Telegram to the signed-in viewer. Only the response body is
 * proxied: the bot token never appears in a header, redirect, body or log line.
 */
export async function proxyTelegramVideo(
  deps: TgMediaDeps,
  req: { userId: string | null; submissionId: string; range: string | null },
): Promise<Response> {
  if (!req.userId) return plain(401, "unauthenticated");
  if (!UUID_RE.test(req.submissionId)) return plain(404, "not_found");
  let sub: MediaSubmission | null;
  try {
    sub = await deps.readSubmission(req.submissionId);
  } catch (e) {
    console.error("tg-media: read failed", e instanceof Error ? e.name : "unknown");
    return plain(502, "bad_gateway");
  }
  // Unknown, unreadable, non-video and Telegram-less rows are indistinguishable.
  if (!sub || sub.kind !== "video" || !sub.tgFileId) return plain(404, "not_found");

  try {
    const file = await deps.getFile(sub.tgFileId);
    if (file.fileSize !== undefined && file.fileSize > MAX_VIDEO_BYTES) return plain(413, "too_large");
    // an invalid Range is refused outright (never silently turned into a full download)
    if (req.range !== null && !RANGE_RE.test(req.range.trim())) return plain(416, "range_not_satisfiable");
    const range = req.range ? req.range.trim() : null;
    const upstream = await deps.fetchFile(file.filePath, range);
    if (upstream.status !== 200 && upstream.status !== 206) {
      await upstream.body?.cancel().catch(() => undefined);
      return upstream.status === 416 ? plain(416, "range_not_satisfiable") : plain(502, "bad_gateway");
    }
    const length = Number(upstream.headers.get("content-length"));
    if (upstream.status === 200 && Number.isFinite(length) && length > MAX_VIDEO_BYTES) {
      await upstream.body?.cancel().catch(() => undefined);
      return plain(413, "too_large");
    }
    // Only video types are passed through; anything else (html, octet-stream...) is served as mp4.
    const upstreamType = upstream.headers.get("content-type") ?? "";
    const contentType = /^video\/[\w.+-]+$/i.test(upstreamType.split(";")[0]!.trim()) ? upstreamType : "video/mp4";
    const headers = new Headers({
      ...baseHeaders,
      "Content-Type": contentType,
      "Cache-Control": "private, no-cache",
      Vary: "Cookie",
      "Accept-Ranges": "bytes",
    });
    for (const h of ["content-length", "content-range"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body ? capStream(upstream.body, MAX_VIDEO_BYTES) : null, { status: upstream.status, headers });
  } catch (e) {
    // Only the error class: messages and URLs can carry the token.
    console.error("tg-media: upstream failed", e instanceof Error ? e.name : "unknown");
    return plain(502, "bad_gateway");
  }
}
