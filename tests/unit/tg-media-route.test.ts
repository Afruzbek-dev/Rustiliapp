import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: null as { id: string } | null, row: null as { kind: string; tg_file_id: string | null } | null };
const maybeSingle = vi.fn(async () => ({ data: state.row, error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { GET } from "@/app/api/media/tg/[submissionId]/route";

const SUB = "33333333-3333-4333-8333-333333333333";
const call = (headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/media/tg/${SUB}`, { headers }), { params: Promise.resolve({ submissionId: SUB }) });

describe("GET /api/media/tg/[submissionId]", () => {
  beforeEach(() => {
    state.user = null;
    state.row = null;
    maybeSingle.mockClear();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:TOKEN-XYZ");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "w".repeat(40));
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "u");
    vi.stubEnv("TELEGRAM_ARCHIVE_CHAT_ID", "1");
    vi.stubEnv("TELEGRAM_STAFF_CHAT_ID", "2");
    vi.stubEnv("APP_URL", "http://localhost:3000");
  });

  it("401 anonymous, without touching the database", async () => {
    expect((await call()).status).toBe(401);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("404 when RLS hides the row", async () => {
    state.user = { id: "u" };
    expect((await call()).status).toBe(404);
  });

  it("proxies the file, forwarding Range, and never leaks the token", async () => {
    state.user = { id: "u" };
    state.row = { kind: "video", tg_file_id: "FILE" };
    const seen: { url: string; range: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), range: new Headers(init?.headers).get("range") });
        if (String(url).endsWith("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "videos/a.mp4", file_size: 5 } }));
        return new Response("DATA", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-3/4" } });
      }),
    );
    const res = await call({ range: "bytes=0-3" });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("DATA");
    expect(seen[1]!.range).toBe("bytes=0-3");
    const all = `${[...res.headers.entries()].join(";")}`;
    expect(all).not.toContain("TOKEN-XYZ");
    vi.unstubAllGlobals();
  });
});
