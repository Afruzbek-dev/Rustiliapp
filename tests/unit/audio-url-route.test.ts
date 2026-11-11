import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: null as { id: string } | null };
const signSubmissionAudio = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/server/submission-media", () => ({ signSubmissionAudio: (...a: unknown[]) => signSubmissionAudio(...a) }));

import { GET } from "@/app/api/submissions/audio-url/route";

const ID = "33333333-3333-4333-8333-333333333333";
const call = (qs: string) => GET(new Request(`http://localhost/api/submissions/audio-url${qs}`));

describe("GET /api/submissions/audio-url", () => {
  beforeEach(() => {
    state.user = null;
    signSubmissionAudio.mockReset();
  });

  it("401 without a session and no signing", async () => {
    expect((await call(`?id=${ID}`)).status).toBe(401);
    expect(signSubmissionAudio).not.toHaveBeenCalled();
  });

  it("404 for a malformed id without touching the service", async () => {
    state.user = { id: "u" };
    expect((await call("?id=../../x")).status).toBe(404);
    expect(signSubmissionAudio).not.toHaveBeenCalled();
  });

  it("404 body is identical for any not_found; no-store on every answer", async () => {
    state.user = { id: "u" };
    signSubmissionAudio.mockResolvedValue({ status: "not_found" });
    const a = await call(`?id=${ID}`);
    const b = await call("?id=nope");
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.get("cache-control")).toBe("no-store");
  });

  it("200 { url } for a visible submission, scoped to the session user", async () => {
    state.user = { id: "u" };
    signSubmissionAudio.mockResolvedValue({ status: "ok", url: "https://signed.example/a" });
    const res = await call(`?id=${ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://signed.example/a" });
    expect(signSubmissionAudio).toHaveBeenCalledWith("u", ID);
  });
});
