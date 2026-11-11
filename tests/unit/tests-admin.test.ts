import { beforeEach, describe, expect, it } from "vitest";
import type { ExerciseWrite } from "@/lib/exercises/authoring";
import type { TestSection } from "@/lib/tests/grade";
import { DbError } from "@/server/content-admin";
import {
  addItemFn,
  createTestFn,
  deleteTestFn,
  removeItemFn,
  reorderItemsFn,
  setTestPublishedFn,
  updateItemFn,
  updateTestFn,
  type TestSettings,
  type TestSnapshot,
  type TestsAdminDb,
} from "@/server/tests-admin";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = id(1); // teaches C1
const T2 = id(2); // teaches C2
const C1 = id(10);
const C2 = id(11);
const M1 = id(20);
const M2 = id(21);
const TEST = id(100);

const goodExercise = {
  type: "classify",
  prompt: "Rodni belgilang",
  payload: { items: [{ id: "it_a1", text: "книга" }], buckets: [{ id: "bk_z9", label: "ж.р" }, { id: "bk_y8", label: "м.р" }] },
  key: { it_a1: "bk_z9" },
};

class FakeDb implements TestsAdminDb {
  calls: string[] = [];
  snap: TestSnapshot = { courseId: C1, moduleId: M1, published: false, passScore: 60, timeLimitMin: 20, items: [] };
  failWith: DbError | null = null;
  written: ExerciseWrite[] = [];

  private maybeFail() {
    if (this.failWith) throw this.failWith;
  }
  async canEdit(actor: string, course: string) {
    return (actor === T1 && course === C1) || (actor === T2 && course === C2);
  }
  async courseOfModule(m: string) {
    return m === M1 ? C1 : m === M2 ? C2 : null;
  }
  async snapshot(testId: string) {
    return testId === TEST ? this.snap : null;
  }
  async create(_a: string, _c: string, m: string, title: string) {
    this.calls.push(`create:${m}:${title}`);
    this.maybeFail();
    return TEST;
  }
  async update(_a: string, _t: string, s: TestSettings) {
    this.calls.push(`update:${JSON.stringify(s)}`);
    this.maybeFail();
  }
  async addItem(_a: string, _t: string, section: TestSection, lesson: string | null, e: ExerciseWrite) {
    this.calls.push(`add:${section}:${lesson}`);
    this.maybeFail();
    this.written.push(e);
    return id(300);
  }
  async updateItem(_a: string, _t: string, ex: string, section: TestSection, _l: string | null, e: ExerciseWrite) {
    this.calls.push(`updateItem:${ex}:${section}`);
    this.written.push(e);
  }
  async removeItem(_a: string, _t: string, ex: string) {
    this.calls.push(`remove:${ex}`);
    this.maybeFail();
  }
  async reorderItems(_a: string, _t: string, ids: string[]) {
    this.calls.push(`reorder:${ids.length}`);
  }
  async setPublished(_a: string, _t: string, p: boolean) {
    this.calls.push(`publish:${p}`);
    this.maybeFail();
  }
  async remove() {
    this.calls.push("delete");
    this.maybeFail();
  }
}

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
});

const readyItem = { exerciseId: id(300), type: "classify", prompt: "Rodni belgilang", payload: goodExercise.payload, key: goodExercise.key, blockId: null };

describe("authority", () => {
  it("a foreign teacher is refused everywhere and nothing is written", async () => {
    const results = await Promise.all([
      createTestFn(db, T2, { moduleId: M1, title: "x" }),
      updateTestFn(db, T2, { testId: TEST, title: "x", passScore: 50, timeLimitMin: null, maxAttempts: 1 }),
      addItemFn(db, T2, { testId: TEST, section: "vocab", lessonId: null, exercise: goodExercise }),
      updateItemFn(db, T2, { testId: TEST, exerciseId: id(300), section: "vocab", lessonId: null, exercise: goodExercise }),
      removeItemFn(db, T2, { testId: TEST, exerciseId: id(300) }),
      reorderItemsFn(db, T2, { testId: TEST, ids: [id(300)] }),
      setTestPublishedFn(db, T2, { testId: TEST, published: true }),
      deleteTestFn(db, T2, { testId: TEST }),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it("an unknown test and an unknown module look the same as a foreign one", async () => {
    expect(await removeItemFn(db, T1, { testId: id(999), exerciseId: id(1) })).toMatchObject({ code: "forbidden" });
    expect(await createTestFn(db, T1, { moduleId: id(998), title: "x" })).toMatchObject({ code: "forbidden" });
  });

  it("the owner teacher can create", async () => {
    expect(await createTestFn(db, T1, { moduleId: M1, title: "  Test 1 " })).toEqual({ ok: true, testId: TEST });
    expect(db.calls).toEqual(["create:" + M1 + ":Test 1"]);
  });
});

describe("validation", () => {
  it("rejects bad input before touching the database", async () => {
    expect(await createTestFn(db, T1, { moduleId: "nope", title: "x" })).toMatchObject({ code: "invalid" });
    expect(await createTestFn(db, T1, { moduleId: M1, title: "  " })).toMatchObject({ code: "invalid" });
    for (const bad of [{ passScore: 0 }, { passScore: 101 }, { timeLimitMin: 0 }, { timeLimitMin: 601 }, { maxAttempts: 0 }, { maxAttempts: 11 }, { timeLimitMin: 1.5 }]) {
      const r = await updateTestFn(db, T1, { testId: TEST, title: "x", passScore: 50, timeLimitMin: null, maxAttempts: 1, ...bad });
      expect(r).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(db.calls).toEqual([]);
  });

  it("a published test must keep a pass score", async () => {
    db.snap = { ...db.snap, published: true };
    expect(await updateTestFn(db, T1, { testId: TEST, title: "x", passScore: null, timeLimitMin: null, maxAttempts: 1 })).toMatchObject({ code: "invalid" });
    expect(db.calls).toEqual([]);
    expect(await updateTestFn(db, T1, { testId: TEST, title: "x", passScore: 70, timeLimitMin: 15, maxAttempts: 2 })).toEqual({ ok: true });
    expect(db.calls[0]).toBe('update:{"title":"x","passScore":70,"timeLimitMin":15,"maxAttempts":2}');
  });
});

describe("items are strict, test-owned and auto-gradable", () => {
  it("accepts a complete item and writes it with xp 0 and auto check mode", async () => {
    const r = await addItemFn(db, T1, { testId: TEST, section: "grammar", lessonId: id(30), exercise: goodExercise });
    expect(r).toEqual({ ok: true, exerciseId: id(300) });
    expect(db.written[0]).toMatchObject({ type: "classify", check_mode: "auto", xp: 0, key: goodExercise.key });
    expect(db.calls).toEqual([`add:grammar:${id(30)}`]);
  });

  it("rejects incomplete items (no key, empty prompt, junk key)", async () => {
    for (const bad of [{ key: {} }, { key: null }, { prompt: "  " }, { key: { it_a1: "nope" } }]) {
      const r = await addItemFn(db, T1, { testId: TEST, section: "vocab", lessonId: null, exercise: { ...goodExercise, ...bad } });
      expect(r).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(db.calls).toEqual([]);
  });

  it("rejects speaking / unsupported types and bad sections", async () => {
    expect(await addItemFn(db, T1, { testId: TEST, section: "vocab", lessonId: null, exercise: { type: "speaking", prompt: "Gapiring", payload: { maxSeconds: 60, channel: "voice" }, key: null } })).toMatchObject({ code: "invalid" });
    expect(await addItemFn(db, T1, { testId: TEST, section: "vocab", lessonId: null, exercise: { ...goodExercise, type: "open_text" } })).toMatchObject({ code: "invalid" });
    expect(await addItemFn(db, T1, { testId: TEST, section: "math" as never, lessonId: null, exercise: goodExercise })).toMatchObject({ code: "invalid" });
    expect(db.calls).toEqual([]);
  });

  it("updating an item is strict too", async () => {
    const r = await updateItemFn(db, T1, { testId: TEST, exerciseId: id(300), section: "reading", lessonId: null, exercise: { ...goodExercise, key: {} } });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateItemFn(db, T1, { testId: TEST, exerciseId: id(300), section: "reading", lessonId: null, exercise: goodExercise })).toEqual({ ok: true });
  });

  it("reorder rejects duplicates", async () => {
    expect(await reorderItemsFn(db, T1, { testId: TEST, ids: [id(300), id(300)] })).toMatchObject({ code: "invalid" });
    expect(await reorderItemsFn(db, T1, { testId: TEST, ids: [id(300), id(301)] })).toEqual({ ok: true });
  });
});

describe("publishing is validated", () => {
  it("refuses an empty test, a missing pass score, an unreachable pass score and incomplete items", async () => {
    const r1 = await setTestPublishedFn(db, T1, { testId: TEST, published: true });
    expect(r1).toMatchObject({ ok: false, code: "invalid", issues: ["Testda mashqlar yo'q"] });

    db.snap = { ...db.snap, passScore: null, items: [readyItem] };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: true })).toMatchObject({ issues: ["O'tish bali kiritilmagan"] });

    db.snap = { ...db.snap, passScore: 150 };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: true })).toMatchObject({ code: "invalid" });

    db.snap = { ...db.snap, passScore: 60, items: [{ ...readyItem, key: {} }] };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: true })).toMatchObject({ code: "invalid" });

    db.snap = { ...db.snap, items: [{ ...readyItem, blockId: id(5) }] };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: true })).toMatchObject({ code: "invalid" });
    expect(db.calls).toEqual([]);
  });

  it("publishes a complete test and returns warnings; unpublishing needs no check", async () => {
    db.snap = { ...db.snap, timeLimitMin: null, items: [readyItem] };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: true })).toEqual({ ok: true, warnings: ["Vaqt cheklanmagan"] });
    db.snap = { ...db.snap, items: [] };
    expect(await setTestPublishedFn(db, T1, { testId: TEST, published: false })).toEqual({ ok: true, warnings: [] });
    expect(db.calls).toEqual(["publish:true", "publish:false"]);
  });
});

describe("database errors map to readable failures", () => {
  it.each([
    ["42501", /ruxsat/],
    ["22023", /noto'g'ri/],
    ["23505", /allaqachon bor/],
    ["23514", /nashr qilishga tayyor emas/],
  ])("code %s", async (code, re) => {
    db.failWith = new DbError("x", code);
    const r = await createTestFn(db, T1, { moduleId: M1, title: "x" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { message: string }).message).toMatch(re);
  });

  it("a frozen test (students have attempts) says so", async () => {
    db.failWith = new DbError("tests-admin: test_editor_add_item: test has attempts", "23514");
    const r = await addItemFn(db, T1, { testId: TEST, section: "vocab", lessonId: null, exercise: goodExercise });
    expect((r as { message: string }).message).toMatch(/o'quvchilar bu testni topshirgan/i);
  });

  it("unknown errors do not leak details", async () => {
    db.failWith = new DbError("secret table name", "XX000");
    const r = await removeItemFn(db, T1, { testId: TEST, exerciseId: id(300) });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(r).toMatchObject({ ok: false, code: "failed" });
  });
});
