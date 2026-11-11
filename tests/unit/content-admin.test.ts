import { beforeEach, describe, expect, it } from "vitest";
import {
  createBlockFn,
  createLessonFn,
  deleteBlockFn,
  importWordsFn,
  reorderBlocksFn,
  requestUploadFn,
  saveBlockFn,
  saveLessonFn,
  saveWordFn,
  setPublishedFn,
  DbError,
  type EditorDb,
} from "@/server/content-admin";
import { FakeEditorDb as F, id } from "./editor-fake";

const T = F.T1;
let db: F;
beforeEach(() => {
  db = new F();
});

const classify = {
  type: "classify",
  prompt: "Guruhlang",
  xp: 10,
  payload: { items: [{ id: "a", text: "стол" }], buckets: [{ id: "m", label: "м" }, { id: "f", label: "ж" }] },
  key: { a: "m" },
};

async function newBlock(type: "text" | "exercise" | "video" | "speaking" | "audio", part = F.P1) {
  const r = await createBlockFn(db, T, { partId: part, type });
  if (!r.ok) throw new Error("create failed");
  return r;
}

describe("authorisation", () => {
  it("rejects a teacher writing to another teacher's course on every entry point", async () => {
    const own = await newBlock("text");
    const T2 = F.T2;
    const results = await Promise.all([
      createLessonFn(db, T2, { moduleId: F.M1, title: "x" }),
      saveLessonFn(db, T2, { lessonId: F.L1, title: "x", objective: "", expected: "1" }),
      createBlockFn(db, T2, { partId: F.P1, type: "text" }),
      saveBlockFn(db, T2, { blockId: own.blockId, payload: { body: "x" }, expected: own.updatedAt }),
      deleteBlockFn(db, T2, { blockId: own.blockId }),
      reorderBlocksFn(db, T2, { partId: F.P1, ids: [own.blockId] }),
      setPublishedFn(db, T2, { lessonId: F.L1, published: true }),
      importWordsFn(db, T2, { lessonId: F.L1, csv: "ru,uz\nа,б" }),
      saveWordFn(db, T2, { lessonId: F.L1, wordId: null, fields: { ru: "а", uz: "б", stress: "", pos: "", gender: "", example_ru: "", example_uz: "" } }),
      requestUploadFn(db, T2, { lessonId: F.L1, kind: "audio", size: 10, contentType: "audio/mpeg" }),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.calls).toEqual([]);
    expect(db.blocks).toHaveLength(1);
  });

  it("a student or unknown actor has no rights; unknown ids are forbidden, not 500", async () => {
    expect(await createBlockFn(db, id(999), { partId: F.P1, type: "text" })).toMatchObject({ code: "forbidden" });
    expect(await createBlockFn(db, T, { partId: id(777), type: "text" })).toMatchObject({ code: "forbidden" });
    expect(await createBlockFn(db, T, { partId: "not-a-uuid", type: "text" })).toMatchObject({ code: "invalid" });
  });

  it("maps database permission errors to forbidden", async () => {
    const boom = Object.assign(Object.create(db), { createLesson: async () => { throw new DbError("x", "42501"); } }) as EditorDb;
    expect(await createLessonFn(boom, T, { moduleId: F.M1, title: "x" })).toMatchObject({ code: "forbidden" });
  });
});

describe("blocks", () => {
  it("only offers editor types (no reading / arrange / listen_pick blocks)", async () => {
    expect(await createBlockFn(db, T, { partId: F.P1, type: "reading" })).toMatchObject({ code: "invalid" });
    expect(await createBlockFn(db, T, { partId: F.P1, type: "arrange" })).toMatchObject({ code: "invalid" });
  });

  it("exercise draft rejects arrange / listen_pick types", async () => {
    const b = await newBlock("exercise");
    for (const type of ["arrange", "listen_pick", "open_text"]) {
      const r = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, type }, expected: b.updatedAt });
      expect(r).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("a speaking block only takes a speaking exercise and exercise block never takes speaking", async () => {
    const sp = await newBlock("speaking");
    const ex = await newBlock("exercise");
    expect(await saveBlockFn(db, T, { blockId: sp.blockId, exercise: classify, expected: sp.updatedAt })).toMatchObject({ code: "invalid" });
    expect(await saveBlockFn(db, T, { blockId: ex.blockId, exercise: { type: "speaking", prompt: "p", xp: 40, payload: {}, key: null }, expected: ex.updatedAt })).toMatchObject({ code: "invalid" });
  });

  it("autosave of a draft stores a sanitised payload; answers never enter payload", async () => {
    const b = await newBlock("exercise");
    const leaky = { ...classify, payload: { ...classify.payload, answer: "m", key: { a: "m" }, items: [{ id: "a", text: "стол", correct: "m" }] } };
    const r = await saveBlockFn(db, T, { blockId: b.blockId, exercise: leaky, expected: b.updatedAt });
    expect(r.ok).toBe(true);
    const stored = db.blocks[0].exercise!;
    expect(JSON.stringify(stored.payload)).not.toMatch(/answer|correct|"key"/);
    expect(stored.key).toEqual({ a: "m" });
  });

  it("a published block only accepts a complete, consistent exercise (wrong key rejected)", async () => {
    const b = await newBlock("exercise");
    await saveBlockFn(db, T, { blockId: b.blockId, exercise: classify, expected: b.updatedAt });
    db.blocks[0].published = true;
    db.blocks[0].updatedAt = 2;
    const bad = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key: { a: "zzz" } }, expected: "2" });
    expect(bad).toMatchObject({ ok: false, code: "invalid" });
    const missing = await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key: {} }, expected: "2" });
    expect(missing).toMatchObject({ ok: false, code: "invalid" });
    const good = await saveBlockFn(db, T, { blockId: b.blockId, exercise: classify, expected: "2" });
    expect(good.ok).toBe(true);
  });

  it("autosave conflict by updated_at returns the current token and writes nothing", async () => {
    const b = await newBlock("text");
    const first = await saveBlockFn(db, T, { blockId: b.blockId, payload: { body: "one" }, expected: b.updatedAt });
    expect(first).toMatchObject({ ok: true, updatedAt: "2" });
    const stale = await saveBlockFn(db, T, { blockId: b.blockId, payload: { body: "two" }, expected: "1" });
    expect(stale).toMatchObject({ ok: false, code: "conflict", currentUpdatedAt: "2" });
    expect(db.blocks[0].payload).toEqual(expect.objectContaining({ body: "one" }));
    const overwrite = await saveBlockFn(db, T, { blockId: b.blockId, payload: { body: "two" }, expected: "2" });
    expect(overwrite.ok).toBe(true);
  });

  it("draft media blocks may be incomplete, live ones may not; path must be in the course folder", async () => {
    const b = await newBlock("audio");
    expect((await saveBlockFn(db, T, { blockId: b.blockId, payload: { title: "T" }, expected: b.updatedAt })).ok).toBe(true);
    const foreign = await saveBlockFn(db, T, { blockId: b.blockId, payload: { title: "T", path: `${F.C2}/x.mp3` }, expected: "2" });
    expect(foreign).toMatchObject({ code: "invalid" });
    const own = await saveBlockFn(db, T, { blockId: b.blockId, payload: { title: "T", path: `${F.C1}/x.mp3` }, expected: "2" });
    expect(own.ok).toBe(true);
    db.blocks[0].published = true;
    const live = await saveBlockFn(db, T, { blockId: b.blockId, payload: { title: "" }, expected: "3" });
    expect(live).toMatchObject({ ok: false, code: "invalid" });
  });

  it("text glossary may only reference words of this lesson", async () => {
    const b = await newBlock("text");
    db.words.push({ id: id(500), ru: "дом", uz: "uy", stress: "", pos: "", gender: "", example_ru: "", example_uz: "" });
    const bad = await saveBlockFn(db, T, { blockId: b.blockId, payload: { body: "дома", glossary: [{ surface: "дома", wordId: id(501) }] }, expected: b.updatedAt });
    expect(bad).toMatchObject({ code: "invalid" });
    const good = await saveBlockFn(db, T, { blockId: b.blockId, payload: { body: "дома", glossary: [{ surface: "дома", wordId: id(500) }] }, expected: b.updatedAt });
    expect(good.ok).toBe(true);
  });

  it("reorder is saved", async () => {
    const a = await newBlock("text");
    const b = await newBlock("video");
    expect((await reorderBlocksFn(db, T, { partId: F.P1, ids: [b.blockId, a.blockId] })).ok).toBe(true);
    expect(db.blocks.find((x) => x.id === b.blockId)!.position).toBe(1);
    expect(db.blocks.find((x) => x.id === a.blockId)!.position).toBe(2);
    expect(await reorderBlocksFn(db, T, { partId: F.P1, ids: [a.blockId, a.blockId] })).toMatchObject({ code: "invalid" });
  });

  it("lesson meta autosave conflicts by updated_at", async () => {
    expect((await saveLessonFn(db, T, { lessonId: F.L1, title: "A", objective: "", expected: "1" })).ok).toBe(true);
    expect(await saveLessonFn(db, T, { lessonId: F.L1, title: "B", objective: "", expected: "1" })).toMatchObject({ code: "conflict" });
    expect(await saveLessonFn(db, T, { lessonId: F.L1, title: " ", objective: "", expected: "2" })).toMatchObject({ code: "invalid" });
  });
});

describe("publish", () => {
  async function validExercise() {
    const b = await newBlock("exercise");
    await saveBlockFn(db, T, { blockId: b.blockId, exercise: classify, expected: b.updatedAt });
    return b;
  }

  it("refuses an empty lesson", async () => {
    expect(await setPublishedFn(db, T, { lessonId: F.L1, published: true })).toMatchObject({ code: "invalid" });
  });

  it("refuses an exercise with an invalid key and lists the issue", async () => {
    const b = await newBlock("exercise");
    await saveBlockFn(db, T, { blockId: b.blockId, exercise: { ...classify, key: { a: "nope" } }, expected: b.updatedAt });
    const r = await setPublishedFn(db, T, { lessonId: F.L1, published: true });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(!r.ok && r.issues?.[0]).toMatch(/Mashq/);
    expect(db.published.get(F.L1)).toBeUndefined();
  });

  it("refuses a test-only exercise placed in a block (part would be uncompletable)", async () => {
    await validExercise();
    db.blocks[0].exercise!.isTestItem = true;
    expect(await setPublishedFn(db, T, { lessonId: F.L1, published: true })).toMatchObject({ code: "invalid" });
  });

  it("publishes a valid lesson, warns about a part without exercises, and unpublishes without checks", async () => {
    await validExercise();
    const r = await setPublishedFn(db, T, { lessonId: F.L1, published: true });
    expect(r).toMatchObject({ ok: true });
    expect(db.published.get(F.L1)).toBe(true);
    expect(r.ok && r.warnings.join(" ")).toMatch(/Razgovor bo'sh/);
    expect((await setPublishedFn(db, T, { lessonId: F.L1, published: false })).ok).toBe(true);
    expect(db.published.get(F.L1)).toBe(false);
  });

  it("refuses a words block when the lesson has no words and an incomplete video", async () => {
    await newBlock("video");
    expect(await setPublishedFn(db, T, { lessonId: F.L1, published: true })).toMatchObject({ code: "invalid" });
  });
});

describe("words and uploads", () => {
  it("imports a valid CSV, reports bad rows and never imports invalid ones", async () => {
    const r = await importWordsFn(db, T, { lessonId: F.L1, csv: "ru,uz\nкнига,kitob\nдом,\nстол,stol" });
    expect(r).toMatchObject({ ok: true, inserted: 2 });
    expect(r.ok && r.errors).toEqual([{ line: 3, message: "«uz» bo'sh" }]);
  });
  it("rejects a file with a missing column", async () => {
    expect(await importWordsFn(db, T, { lessonId: F.L1, csv: "ru,stress\nкнига,x" })).toMatchObject({ ok: false, message: expect.stringContaining("uz") });
    expect(db.calls).toEqual([]);
  });
  it("rejects a CSV with only bad rows", async () => {
    expect(await importWordsFn(db, T, { lessonId: F.L1, csv: "ru,uz\n,x" })).toMatchObject({ ok: false });
  });

  it("upload requests: course-scoped path, 20 MB and mime limits", async () => {
    const ok = await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 1000, contentType: "audio/mpeg" });
    expect(ok.ok && ok.path.startsWith(`${F.C1}/`)).toBe(true);
    expect(await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 21 * 1024 * 1024, contentType: "audio/mpeg" })).toMatchObject({ code: "invalid" });
    expect(await requestUploadFn(db, T, { lessonId: F.L1, kind: "audio", size: 1000, contentType: "image/png" })).toMatchObject({ code: "invalid" });
    expect(await requestUploadFn(db, T, { lessonId: F.L1, kind: "image", size: 1000, contentType: "image/svg+xml" })).toMatchObject({ code: "invalid" });
  });
});
