import { describe, expect, it } from "vitest";
import { normalizeWord, splitToken } from "@/lib/blocks/normalize";
import { parseBlock } from "@/lib/blocks/types";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseBlock", () => {
  const ok: [string, unknown][] = [
    ["video", { provider: "youtube", videoId: "dQw4w9WgXcQ", title: "Salomlashish", durationSec: 120 }],
    ["audio", { path: "lesson1/dialog.mp3", title: "Dialog", transcript: "Привет!" }],
    ["rule_image", { path: "lesson1/rule.png", alt: "Jadval", caption: "Qoida" }],
    ["text", { title: "Qoida", body: "Первый абзац.\n\nВторой абзац.", glossary: [{ surface: "книги", wordId: UUID }] }],
    ["reading", { body: "Это мой дом." }],
    ["exercise", { exerciseId: UUID }],
    ["speaking", { exerciseId: UUID }],
    ["words", {}],
  ];
  for (const [type, payload] of ok) {
    it(`parses a valid ${type} block`, () => {
      const r = parseBlock({ id: "b1", type, payload });
      expect(r.type).toBe(type);
      expect(r.id).toBe("b1");
    });
  }

  it("reports an unknown type as unsupported without throwing", () => {
    expect(parseBlock({ id: "b", type: "hologram", payload: {} })).toEqual({
      id: "b",
      type: "unsupported",
      originalType: "hologram",
    });
  });

  const bad: [string, unknown][] = [
    ["video", { provider: "vimeo", videoId: "dQw4w9WgXcQ", title: "x" }],
    ["video", { provider: "youtube", videoId: "short", title: "x" }],
    ["video", { provider: "youtube", videoId: "dQw4w9WgXcQ" }],
    ["audio", { path: "../secret.mp3", title: "x" }],
    ["audio", { path: "/abs.mp3", title: "x" }],
    ["rule_image", { path: "a.png" }],
    ["text", { body: "" }],
    ["text", { body: "ok", glossary: [{ surface: "x", wordId: "not-a-uuid" }] }],
    ["exercise", { exerciseId: "nope" }],
    ["speaking", {}],
  ];
  for (const [type, payload] of bad) {
    it(`reports a malformed ${type} payload as unsupported`, () => {
      expect(parseBlock({ id: "b", type, payload }).type).toBe("unsupported");
    });
  }

  it("never throws on garbage input", () => {
    for (const payload of [null, undefined, 5, "x", [], { a: { b: 1 } }]) {
      expect(() => parseBlock({ id: "b", type: "video", payload })).not.toThrow();
      expect(() => parseBlock({ id: "b", type: "text", payload })).not.toThrow();
    }
    expect(() => parseBlock(null as never)).not.toThrow();
  });
});

describe("normalizeWord", () => {
  it("lowercases, folds ё and strips stress marks and punctuation", () => {
    expect(normalizeWord("Мама,")).toBe("мама");
    expect(normalizeWord("ёлка")).toBe("елка");
    expect(normalizeWord("кни́га")).toBe("книга");
    expect(normalizeWord("«Привет!»")).toBe("привет");
    expect(normalizeWord("кто-то")).toBe("кто-то");
    expect(normalizeWord("Йод")).toBe("йод");
  });
  it("splits punctuation off a token", () => {
    expect(splitToken("«дом».")).toEqual({ lead: "«", core: "дом", trail: "»." });
  });
});
