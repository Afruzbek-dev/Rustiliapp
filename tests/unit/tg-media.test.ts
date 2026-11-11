import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramFiles } from "@/lib/telegram/files";
import { proxyTelegramVideo, type MediaSubmission, type TgMediaDeps } from "@/server/tg-media";

const SUB = "33333333-3333-4333-8333-333333333333";
const TOKEN = "123456:SECRET-TOKEN-VALUE";

function setup(over: { sub?: MediaSubmission | null; fileSize?: number; upstream?: Response; getFileFails?: boolean; readFails?: boolean } = {}) {
  const calls = { read: [] as string[], fetch: [] as { path: string; range: string | null }[], getFile: [] as string[] };
  const deps: TgMediaDeps = {
    readSubmission: async (id) => {
      calls.read.push(id);
      if (over.readFails) throw new Error(`boom ${TOKEN}`);
      return over.sub === undefined ? { kind: "video", tgFileId: "FILE" } : over.sub;
    },
    getFile: async (fileId) => {
      calls.getFile.push(fileId);
      if (over.getFileFails) throw new Error(`https://api.telegram.org/bot${TOKEN}/getFile failed`);
      return { filePath: "videos/file_1.mp4", fileSize: over.fileSize };
    },
    fetchFile: async (path, range) => {
      calls.fetch.push({ path, range });
      return over.upstream ?? new Response("VIDEO-BYTES", { status: 200, headers: { "content-type": "video/mp4", "content-length": "11" } });
    },
  };
  return { deps, calls };
}

const get = (deps: TgMediaDeps, over: Partial<{ userId: string | null; submissionId: string; range: string | null }> = {}) =>
  proxyTelegramVideo(deps, { userId: "u1", submissionId: SUB, range: null, ...over });

async function everything(res: Response): Promise<string> {
  return `${res.status} ${[...res.headers.entries()].map(([k, v]) => `${k}:${v}`).join(";")} ${await res.text()}`;
}

describe("media proxy", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("401 without a session and no database read", async () => {
    const { deps, calls } = setup();
    expect((await get(deps, { userId: null })).status).toBe(401);
    expect(calls.read).toEqual([]);
  });

  it("404 for a malformed id, an unreadable/unknown submission (RLS null), a non-video and a video without file id", async () => {
    for (const s of [setup({ sub: null }), setup({ sub: { kind: "audio", tgFileId: null } }), setup({ sub: { kind: "audio", tgFileId: "F" } }), setup({ sub: { kind: "video", tgFileId: null } })]) {
      const r = await get(s.deps);
      expect(r.status).toBe(404);
      expect(s.calls.getFile).toEqual([]);
    }
    expect((await get(setup().deps, { submissionId: "nope" })).status).toBe(404);
  });

  it("the 404s are indistinguishable", async () => {
    const a = await everything(await get(setup({ sub: null }).deps));
    const b = await everything(await get(setup({ sub: { kind: "audio", tgFileId: "F" } }).deps));
    expect(a).toBe(b);
  });

  it("streams the file with safe headers", async () => {
    const { deps, calls } = setup();
    const r = await get(deps);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("VIDEO-BYTES");
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-length")).toBe("11");
    expect(calls.fetch).toEqual([{ path: "videos/file_1.mp4", range: null }]);
  });

  it("forwards a valid Range header and passes 206 + Content-Range through; ignores a malformed one", async () => {
    const upstream = new Response("PART", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/11", "content-length": "4" } });
    const s = setup({ upstream });
    const r = await get(s.deps, { range: "bytes=0-3" });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-3/11");
    expect(s.calls.fetch[0]!.range).toBe("bytes=0-3");
    const bad = setup();
    await get(bad.deps, { range: "bytes=0-1,5-9; evil" });
    expect(bad.calls.fetch[0]!.range).toBeNull();
  });

  it("never serves a non-video content type from upstream", async () => {
    const s = setup({ upstream: new Response("<script>", { status: 200, headers: { "content-type": "text/html" } }) });
    expect((await get(s.deps)).headers.get("content-type")).toBe("video/mp4");
  });

  it("getFile / upstream failures answer a generic 502 and never expose or log the token", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = await get(setup({ getFileFails: true }).deps);
    expect(failing.status).toBe(502);
    expect(await everything(failing)).not.toContain(TOKEN);
    const upstream500 = await get(setup({ upstream: new Response("x", { status: 500 }) }).deps);
    expect(upstream500.status).toBe(502);
    const readFails = await get(setup({ readFails: true }).deps);
    expect(readFails.status).toBe(502);
    expect(JSON.stringify(err.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(err.mock.calls)).not.toContain("api.telegram.org");
  });

  it("refuses files larger than 20 MB (declared by getFile or by the upstream length)", async () => {
    expect((await get(setup({ fileSize: 21 * 1024 * 1024 }).deps)).status).toBe(413);
    const big = new Response("x", { status: 200, headers: { "content-type": "video/mp4", "content-length": String(21 * 1024 * 1024) } });
    expect((await get(setup({ upstream: big }).deps)).status).toBe(413);
  });
});

describe("telegram file client", () => {
  it("getFile posts to the bot API; fetchFile forwards Range; no redirects", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "videos/a.mp4", file_size: 10 } }));
      return new Response("bytes", { status: 206 });
    }) as unknown as typeof fetch;
    const files = createTelegramFiles(TOKEN, fetchImpl);
    expect(await files.getFile("F1")).toEqual({ filePath: "videos/a.mp4", fileSize: 10 });
    await files.fetchFile("videos/a.mp4", "bytes=0-9");
    expect(calls[1]!.url).toBe(`https://api.telegram.org/file/bot${TOKEN}/videos/a.mp4`);
    expect((calls[1]!.init!.headers as Record<string, string>).Range).toBe("bytes=0-9");
    expect(calls.every((c) => c.init?.redirect === "error")).toBe(true);
  });

  it("errors never carry the token or URL", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getFile`);
    }) as unknown as typeof fetch;
    const files = createTelegramFiles(TOKEN, boom);
    for (const p of [files.getFile("x"), files.fetchFile("a.mp4", null)]) {
      const e = await p.catch((x: Error) => x);
      expect(String(e)).not.toContain(TOKEN);
      expect((e as Error).message).not.toContain("telegram.org");
    }
    const notOk = createTelegramFiles(TOKEN, (async () => new Response("no", { status: 400 })) as unknown as typeof fetch);
    await expect(notOk.getFile("x")).rejects.toThrow(/http_400/);
    const traversal = createTelegramFiles(TOKEN, (async () => new Response(JSON.stringify({ ok: true, result: { file_path: "../x" } }))) as unknown as typeof fetch);
    await expect(traversal.getFile("x")).rejects.toThrow(/no_path/);
  });
});
