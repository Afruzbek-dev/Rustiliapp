import { describe, expect, it } from "vitest";
import { buildExerciseWrite, sanitizePayload } from "@/lib/exercises/authoring";

const ok = (type: string, payload: unknown, key: unknown) => buildExerciseWrite({ type, prompt: "p", xp: 10, payload, key });

describe("buildExerciseWrite", () => {
  it("accepts one valid exercise of every authorable type", () => {
    expect(ok("classify", { items: [{ id: "a", text: "x" }], buckets: [{ id: "m", label: "m" }, { id: "f", label: "f" }] }, { a: "f" }).ok).toBe(true);
    expect(ok("fill_blank", { items: [{ id: "a", before: "Я ", after: " дома" }] }, { a: ["был", "была"] }).ok).toBe(true);
    expect(ok("conjugate", { verb: "читать", pronouns: ["1", "2", "3", "4", "5", "6"] }, { forms: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(true);
    expect(ok("choose", { items: [{ id: "a", text: "q", options: ["x", "y"] }] }, { a: 1 }).ok).toBe(true);
    expect(ok("match", { left: [{ id: "l1", text: "a" }], right: [{ id: "r1", text: "b" }] }, { l1: "r1" }).ok).toBe(true);
  });

  it("rejects wrong keys per type", () => {
    const classify = { items: [{ id: "a", text: "x" }], buckets: [{ id: "m", label: "m" }, { id: "f", label: "f" }] };
    expect(ok("classify", classify, { a: "zz" }).ok).toBe(false);
    expect(ok("classify", classify, {}).ok).toBe(false);
    expect(ok("classify", classify, { a: "m", ghost: "m" }).ok).toBe(false);
    expect(ok("fill_blank", { items: [{ id: "a", before: "x", after: "" }] }, { a: [] }).ok).toBe(false);
    expect(ok("fill_blank", { items: [{ id: "a", before: "x", after: "" }] }, { a: [" "] }).ok).toBe(false);
    expect(ok("conjugate", { verb: "v", pronouns: ["1", "2", "3", "4", "5", "6"] }, { forms: ["a"] }).ok).toBe(false);
    const choose = { items: [{ id: "a", text: "q", options: ["x", "y"] }] };
    expect(ok("choose", choose, { a: 2 }).ok).toBe(false);
    expect(ok("choose", choose, { a: "1" }).ok).toBe(false);
    expect(ok("choose", choose, {}).ok).toBe(false);
    const match = { left: [{ id: "l1", text: "a" }, { id: "l2", text: "b" }], right: [{ id: "r1", text: "c" }, { id: "r2", text: "d" }] };
    expect(ok("match", match, { l1: "r1", l2: "r1" }).ok).toBe(false);
    expect(ok("match", match, { l1: "r1" }).ok).toBe(false);
    expect(ok("match", match, { l1: "r1", l2: "nope" }).ok).toBe(false);
  });

  it("rejects types outside the MVP and out-of-range xp / empty prompts", () => {
    for (const t of ["arrange", "listen_pick", "open_text", "bogus"]) expect(ok(t, {}, {}).ok).toBe(false);
    expect(buildExerciseWrite({ type: "choose", prompt: "", xp: 10, payload: {}, key: {} }).ok).toBe(false);
    expect(buildExerciseWrite({ type: "choose", prompt: "p", xp: -1, payload: {}, key: {} }).ok).toBe(false);
  });

  it("strips unknown payload fields so no answer can hide there", () => {
    const r = ok("choose", { items: [{ id: "a", text: "q", options: ["x", "y"], correct: 1 }], answer: 1 }, { a: 1 });
    expect(r.ok && JSON.stringify(r.write.payload)).not.toMatch(/correct|answer/);
  });

  it("speaking: review mode, no key, limits", () => {
    const r = buildExerciseWrite({ type: "speaking", prompt: "Расскажите о себе", xp: 40, payload: { maxSeconds: 180, channel: "both" }, key: { x: 1 } });
    expect(r).toMatchObject({ ok: true, write: { check_mode: "review", key: null, xp: 40 } });
    expect(buildExerciseWrite({ type: "speaking", prompt: "p", xp: 40, payload: { maxSeconds: 5, channel: "voice" }, key: null }).ok).toBe(false);
    expect(buildExerciseWrite({ type: "speaking", prompt: "", xp: 40, payload: { maxSeconds: 60, channel: "voice" }, key: null }).ok).toBe(false);
  });
});

describe("sanitizePayload", () => {
  it("keeps only playable fields", () => {
    expect(sanitizePayload("choose", { items: [{ id: "a", text: "q", options: ["x"], correct: 1 }], secret: 1 })).toEqual({
      items: [{ id: "a", text: "q", options: ["x"] }],
    });
    expect(sanitizePayload("nonsense", { a: 1 })).toEqual({});
  });
});
