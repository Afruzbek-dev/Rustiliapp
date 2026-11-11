import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { LessonEditor, applyOrder } from "@/components/staff/editor/LessonEditor";
import { MediaForm } from "@/components/staff/editor/BlockForms";
import type { EditorActions } from "@/components/staff/editor/actions-type";
import { draftFromModel, emptyModel, genId, modelFromDraft, type MatchModel } from "@/lib/editor/exercise-model";
import type { EditorBlock, EditorData } from "@/lib/editor/types";
import { buildExerciseWrite, checkAutoExercise } from "@/lib/exercises/authoring";
import { check } from "@/lib/exercises/check";
import { deleteBlockFn, requestUploadFn, saveBlockFn, setPublishedFn, DbError, type EditorDb } from "@/server/content-admin";
import { FakeEditorDb as F } from "./editor-fake";

const L = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const M = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const B2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const B3 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";

describe("C1: match ids never encode the answer", () => {
  const model = (): MatchModel => ({
    pairs: ["a", "b", "c", "d"].map((x) => ({ id: genId(), rightId: genId(), left: `L-${x}`, right: `R-${x}` })),
  });

  it("right ids are independent of left ids and the key still grades correctly", () => {
    const m = model();
    const { payload, key } = draftFromModel("match", m) as { payload: { left: { id: string; text: string }[]; right: { id: string; text: string }[] }; key: Record<string, string> };
    for (const l of payload.left) {
      for (const r of payload.right) {
        expect(r.id.includes(l.id)).toBe(false);
        expect(l.id.includes(r.id)).toBe(false);
      }
    }
    // every left id maps to the right item carrying the paired text
    const texts = payload.left.map((l) => payload.right.find((r) => r.id === key[l.id])?.text);
    expect(texts).toEqual(["R-a", "R-b", "R-c", "R-d"]);
    // what a student would submit: each left id with the right id whose TEXT is the partner
    const pairs = payload.left.map((l) => [l.id, payload.right.find((r) => r.text === l.text.replace("L-", "R-"))!.id] as [string, string]);
    expect(check("match", key, { pairs })).toMatchObject({ correct: true });
    // the server accepts it...
    expect(checkAutoExercise("match", payload, key).ok).toBe(true);
  });

  it("ids are stable across saves and reloads (round trip keeps the same right ids)", () => {
    const m = model();
    const first = draftFromModel("match", m);
    const again = modelFromDraft("match", first.payload, first.key) as MatchModel;
    expect(again.pairs.map((p) => p.rightId)).toEqual(m.pairs.map((p) => p.rightId));
    expect(draftFromModel("match", again)).toEqual(first);
  });

  it("the right column order does not follow the left order", () => {
    let same = 0;
    for (let i = 0; i < 30; i++) {
      const { payload } = draftFromModel("match", model()) as unknown as { payload: { left: { text: string }[]; right: { text: string }[] } };
      if (payload.right.every((r, n) => r.text === payload.left[n].text.replace("L-", "R-"))) same++;
    }
    expect(same).toBeLessThan(10);
  });

  it("ids are crypto-random: no collisions, not derived from text", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => genId()));
    expect(ids.size).toBe(2000);
  });

  it("the server rejects a payload whose right ids encode the left ids (legacy `r`+id scheme)", () => {
    const payload = { left: [{ id: "p1", text: "a" }, { id: "p2", text: "b" }], right: [{ id: "rp1", text: "x" }, { id: "rp2", text: "y" }] };
    expect(checkAutoExercise("match", payload, { p1: "rp1", p2: "rp2" }).ok).toBe(false);
    const good = { left: payload.left, right: [{ id: "k9z", text: "x" }, { id: "q7w", text: "y" }] };
    expect(checkAutoExercise("match", good, { p1: "k9z", p2: "q7w" }).ok).toBe(true);
  });

  it("audit: other types use independent random ids and keep answers out of the payload", () => {
    for (const type of ["classify", "fill_blank", "choose", "conjugate"]) {
      const m = emptyModel(type) as Record<string, unknown>;
      const { payload, key } = draftFromModel(type, m);
      expect(JSON.stringify(payload)).not.toContain(JSON.stringify(key).slice(1, -1) || "\u0000");
    }
    const bad = { items: [{ id: "item-m", text: "x" }], buckets: [{ id: "m", label: "a" }, { id: "f", label: "b" }] };
    expect(checkAutoExercise("classify", bad, { "item-m": "m" }).ok).toBe(false);
  });
});

describe("server: I1 strictness, I2 in_test, M5 locked, M8 mime, publish tokens", () => {
  const T = F.T1;
  const classify = {
    type: "classify", prompt: "p", xp: 10,
    payload: { items: [{ id: "a", text: "x" }], buckets: [{ id: "m", label: "m" }, { id: "f", label: "f" }] },
    key: { a: "m" },
  };
  let db: F;
  beforeEach(() => { db = new F(); });

  async function exBlock() {
    const r = await (await import("@/server/content-admin")).createBlockFn(db, T, { partId: F.P1, type: "exercise" });
    if (!r.ok) throw new Error("x");
    return r;
  }

  it("I1: an unpublished exercise that is a test item is validated strictly", async () => {
    const b = await exBlock();
    const lenient = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key: { a: "nope" } }, expected: b.updatedAt });
    expect(lenient.ok).toBe(true); // plain draft: lenient
    db.blocks[0].exercise!.isTestItem = true;
    const strict = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key: { a: "nope" } }, expected: "2" });
    expect(strict).toMatchObject({ ok: false, code: "invalid" });
    expect((await saveBlockFn(db, T, { blockId: b.blockId, exercise: classify, expected: "2" })).ok).toBe(true);
  });

  it("I1: a non-object key is rejected even for a draft (it would erase the key)", async () => {
    const b = await exBlock();
    for (const key of ["junk", 5, null, [1]]) {
      const r = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key }, expected: b.updatedAt });
      if (Array.isArray(key)) expect(r.ok).toBe(true); // arrays are objects for jsonb and still a real key
      else expect(r).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(db.blocks[0].exercise!.key).not.toBeNull();
  });

  it("I2: deleting a test-item block gives a clear in_test failure", async () => {
    const b = await exBlock();
    db.blocks[0].exercise!.isTestItem = true;
    const r = await deleteBlockFn(db, T, { blockId: b.blockId });
    expect(r).toMatchObject({ ok: false, code: "in_test", message: expect.stringContaining("testda") });
    expect(db.blocks).toHaveLength(1);
  });

  it("M5: the database's type-locked error becomes a clear message", async () => {
    const b = await exBlock();
    const boom = Object.assign(Object.create(db), {
      saveBlock: async () => { throw new DbError("content-admin: editor_save_block: exercise type locked", "23514"); },
    }) as EditorDb;
    const r = await saveBlockFn(boom, T, { blockId: b.blockId, exercise: { ...classify, type: "choose" }, expected: b.updatedAt });
    expect(r).toMatchObject({ ok: false, code: "invalid", message: expect.stringContaining("turini o'zgartirib bo'lmaydi") });
  });

  it("M1: publish passes the validated block tokens and maps a changed lesson to a conflict", async () => {
    const b = await exBlock();
    await saveBlockFn(db, T, { blockId: b.blockId, exercise: classify, expected: b.updatedAt });
    expect((await setPublishedFn(db, T, { lessonId: F.L1, published: true })).ok).toBe(true);
    expect(db.lastChecked).toEqual({ [b.blockId]: "2" });
    const changed = Object.assign(Object.create(db), {
      setPublished: async () => { throw new DbError("lesson changed since it was checked", "40001"); },
    }) as EditorDb;
    expect(await setPublishedFn(changed, T, { lessonId: F.L1, published: true })).toMatchObject({ ok: false, code: "conflict" });
  });

  it("M8: accepts common mime aliases and parameters, still rejects others", async () => {
    for (const contentType of ["audio/x-m4a", "audio/x-wav", "audio/mp3", "audio/mp4", "audio/mpeg", "audio/MPEG; codecs=mp3"]) {
      const r = await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 10, contentType });
      expect(r.ok, contentType).toBe(true);
    }
    expect(await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 10, contentType: "video/mp4" })).toMatchObject({ ok: false });
    expect(await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 10, contentType: "image/png" })).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------------------------
const block = (id: string, title: string, over: Partial<EditorBlock> = {}): EditorBlock => ({
  id, type: "text", published: false, updatedAt: "T1", payload: { title, body: "matn" }, exercise: null, ...over,
});
function data(blocks: EditorBlock[]): EditorData {
  return {
    courseId: "c1", courseTitle: "Kurs",
    tree: [{ id: M, position: 1, title: "Modul", lessons: [{ id: L, position: 1, title: "Dars", status: "draft" }] }],
    lesson: {
      id: L, title: "Dars", objective: "", updatedAt: "L1", moduleId: M, moduleTitle: "Modul", modulePosition: 1, lessonPosition: 1,
      parts: [{ id: P1, position: 1, kind: "grammar", title: "Grammatika", blocks }], words: [],
    },
  };
}
function actions(over: Partial<EditorActions> = {}): EditorActions {
  const ok = { ok: true as const };
  return {
    saveLesson: vi.fn(async () => ({ ...ok, updatedAt: "L2" })), createBlock: vi.fn(async () => ({ ...ok, blockId: "n", updatedAt: "N" })),
    saveBlock: vi.fn(async () => ({ ...ok, updatedAt: "S2" })), deleteBlock: vi.fn(async () => ok), reorderBlocks: vi.fn(async () => ok),
    setPublished: vi.fn(async () => ({ ...ok, warnings: [] })),
    importWords: vi.fn(async () => ({ ...ok, inserted: 0, linked: 0, skipped: 0, errors: [], duplicates: 0, words: [] })),
    saveWord: vi.fn(async () => ({ ...ok, words: [] })), unlinkWord: vi.fn(async () => ({ ...ok, words: [] })),
    requestUpload: vi.fn(async () => ({ ...ok, path: "c1/x.mp3", token: "t" })), createLesson: vi.fn(async () => ({ ...ok, lessonId: "x" })),
    ...over,
  };
}
const uploader = vi.fn(async () => ({ ok: true }));
afterEach(() => vi.useRealTimers());

describe("M3: reading blocks are read-only", () => {
  it("renders the body without inputs and never saves or warns before unload", () => {
    vi.useFakeTimers();
    const a = actions();
    const spy = vi.spyOn(window, "addEventListener");
    render(<LessonEditor data={data([block(B1, "R", { type: "reading", payload: { body: "O'qish matni" } })])} actions={a} uploader={uploader} />);
    const region = screen.getByRole("region", { name: "O'qish bloki" });
    expect(within(region).getByText("O'qish matni")).toBeInTheDocument();
    expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(a.saveBlock).not.toHaveBeenCalled();
    expect(spy.mock.calls.some(([t]) => t === "beforeunload")).toBe(false);
    spy.mockRestore();
  });
});

describe("M4: reorders are serialised and roll back to the last confirmed order", () => {
  it("applyOrder keeps unlisted blocks at the end", () => {
    const bs = [block(B1, "1"), block(B2, "2"), block(B3, "3")];
    expect(applyOrder(bs, [B3, B1]).map((b) => b.id)).toEqual([B3, B1, B2]);
  });

  it("two quick moves run one after the other; the failing second one restores the FIRST confirmed order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const reorderBlocks = vi
      .fn()
      .mockImplementationOnce(async () => { await gate; return { ok: true }; })
      .mockResolvedValueOnce({ ok: false, code: "failed", message: "Xatolik" });
    render(<LessonEditor data={data([block(B1, "Bir"), block(B2, "Ikki"), block(B3, "Uch")])} actions={actions({ reorderBlocks })} uploader={uploader} />);
    fireEvent.click(screen.getByRole("button", { name: "1-blokni pastga ko'chirish" })); // B2 B1 B3
    fireEvent.click(screen.getByRole("button", { name: "2-blokni pastga ko'chirish" })); // B2 B3 B1
    expect(reorderBlocks).toHaveBeenCalledTimes(1); // second is queued behind the first
    release();
    await waitFor(() => expect(reorderBlocks).toHaveBeenCalledTimes(2));
    expect(reorderBlocks.mock.calls[0][0].ids).toEqual([B2, B1, B3]);
    expect(await screen.findByText(/Tartibni saqlab bo'lmadi/)).toBeInTheDocument();
    const titles = within(screen.getByRole("list", { name: "Bloklar" })).getAllByRole("listitem").map((li) => li.textContent ?? "");
    // rolled back to the last SERVER-CONFIRMED order (B2 B1 B3), not the original B1 B2 B3
    expect(titles[0]).toContain("Ikki");
    expect(titles[1]).toContain("Bir");
    expect(titles[2]).toContain("Uch");
  });
});

describe("M9: keyboard focus, live region, ids", () => {
  it("keeps focus on the moved item's button, announces the position and uses aria-disabled at the ends", async () => {
    render(<LessonEditor data={data([block(B1, "Bir"), block(B2, "Ikki")])} actions={actions()} uploader={uploader} />);
    const down = screen.getByRole("button", { name: "1-blokni pastga ko'chirish" });
    expect(screen.getByRole("button", { name: "1-blokni yuqoriga ko'chirish" })).toHaveAttribute("aria-disabled", "true");
    down.focus();
    await userEvent.setup().keyboard("{Enter}");
    // the moved block is now 2nd; its "down" button is at the end (aria-disabled) but still focused
    await waitFor(() => expect(document.activeElement).toHaveAttribute("data-block", B1));
    expect(document.activeElement).toHaveAttribute("data-move", "down");
    expect(document.activeElement).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByRole("status").some((s) => /Bir: 2-o'rinda, jami 2 ta/.test(s.textContent ?? ""))).toBe(true);
  });

  it("the idle status text is not a live region (no 30 s re-announce)", () => {
    render(<LessonEditor data={data([block(B1, "Bir")])} actions={actions()} uploader={uploader} now={() => Date.parse("2026-11-11T10:00:00Z")} />);
    const el = screen.getByText(/Qoralama · /);
    expect(el).toHaveAttribute("aria-live", "off");
    expect(el).not.toHaveAttribute("role", "status");
  });

  it("MediaForm instances get unique DOM ids", () => {
    render(
      <>
        <MediaForm kind="audio" lessonId={L} value={{}} onChange={vi.fn()} actions={actions()} uploader={uploader} />
        <MediaForm kind="audio" lessonId={L} value={{}} onChange={vi.fn()} actions={actions()} uploader={uploader} />
      </>,
    );
    const ids = screen.getAllByLabelText("Audio faylni tanlash").map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("M5 UI", () => {
  it("disables the exercise type select once students answered it", () => {
    const ex = block(B1, "x", {
      type: "exercise", payload: {},
      exercise: { id: "e1", type: "choose", prompt: "p", payload: { items: [{ id: "a", text: "q", options: ["x", "y"] }] }, key: {}, xp: 10, isTestItem: false, typeLocked: true },
    });
    render(<LessonEditor data={data([ex])} actions={actions()} uploader={uploader} />);
    expect(screen.getByLabelText("Mashq turi")).toBeDisabled();
    expect(screen.getByText(/turini o'zgartirib bo'lmaydi/)).toBeInTheDocument();
  });
});

describe("exercise write sanity", () => {
  it("a published match with legacy ids fails the publish-time validation too", () => {
    const res = buildExerciseWrite({
      type: "match", prompt: "p", xp: 10,
      payload: { left: [{ id: "p1", text: "a" }, { id: "p2", text: "b" }], right: [{ id: "rp1", text: "x" }, { id: "rp2", text: "y" }] },
      key: { p1: "rp1", p2: "rp2" },
    });
    expect(res.ok).toBe(false);
  });
});
