import { afterEach, describe, expect, it, vi } from "vitest";
import { signSubmissionAudio } from "@/server/submission-media";
import { fakeStore, U, type FakeWorld } from "./curator-fake";

const CUR = U(1);
const OTHER = U(2);
const ST = U(11);
const EX = U(21);
const SUB = U(101);

function world(over: Record<string, unknown> = {}): FakeWorld {
  return {
    roles: { [CUR]: "curator", [OTHER]: "curator", [ST]: "student" },
    names: {},
    groupOf: { [CUR]: "A", [OTHER]: "B" },
    exercises: [{ id: EX, prompt: null, lessonTitle: null, isTest: false }],
    reviews: [],
    submissions: [
      { id: SUB, student_id: ST, exercise_id: EX, kind: "audio", storage_path: `${ST}/${SUB}.webm`, tg_file_id: null, status: "pending", created_at: "2026-11-01T00:00:00Z", group: "A", ...over },
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("signSubmissionAudio", () => {
  it("signs a 10-minute URL for the path rebuilt from the row", async () => {
    const sign = vi.fn(async (path: string) => `https://signed.example/${path}`);
    const res = await signSubmissionAudio(CUR, SUB, { store: fakeStore(world(), CUR), sign });
    expect(res).toEqual({ status: "ok", url: `https://signed.example/${ST}/${SUB}.webm` });
    expect(sign).toHaveBeenCalledWith(`${ST}/${SUB}.webm`, 600);
  });

  it("ignores a hostile prefix in storage_path: the path always starts with the row's student and id", async () => {
    const sign = vi.fn(async (path: string) => path);
    await signSubmissionAudio(CUR, SUB, { store: fakeStore(world({ storage_path: "../../other/evil.mp3" }), CUR), sign });
    expect(sign).toHaveBeenCalledWith(`${ST}/${SUB}.mp3`, 600);
  });

  it("404 (and no signing) for a curator of another group, a student, unknown ids, video and unfinished rows", async () => {
    const sign = vi.fn(async () => "https://x");
    const cases: [string, FakeWorld, string][] = [
      [OTHER, world(), SUB],
      [ST, world(), SUB],
      [CUR, world(), U(999)],
      [CUR, world({ kind: "video", storage_path: null, tg_file_id: "F" }), SUB],
      [CUR, world({ storage_path: null }), SUB],
      [CUR, world({ storage_path: "no-extension" }), SUB],
    ];
    for (const [viewer, w, id] of cases) {
      expect(await signSubmissionAudio(viewer, id, { store: fakeStore(w, viewer), sign })).toEqual({ status: "not_found" });
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("404 when storage fails, and the URL / path never reach the logs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signSubmissionAudio(CUR, SUB, {
      store: fakeStore(world(), CUR),
      sign: async () => {
        throw new Error(`failed https://signed.example/${ST}/${SUB}.webm?token=SECRET`);
      },
    });
    expect(res).toEqual({ status: "not_found" });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain("SECRET");
    expect(logged).not.toContain("signed.example");
    expect(logged).not.toContain(ST);
  });
});
