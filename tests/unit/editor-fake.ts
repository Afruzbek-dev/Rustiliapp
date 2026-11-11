import type { BlockType } from "@/lib/blocks/types";
import type { CheckPart } from "@/lib/editor/publish-check";
import type { EditorWord } from "@/lib/editor/types";
import type { WordRow } from "@/lib/editor/words-csv";
import type { ExerciseWrite } from "@/lib/exercises/authoring";
import type { BlockMeta, EditorDb } from "@/server/content-admin";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface FBlock {
  id: string;
  part: string;
  type: string;
  published: boolean;
  payload: Record<string, unknown>;
  updatedAt: number;
  exercise: (ExerciseWrite & { id: string; isTestItem: boolean }) | null;
  position: number;
}

/** In-memory EditorDb: teacher T1 teaches course C1 (module M1 > lesson L1 > parts P1, P2); course C2 belongs to someone else. */
export class FakeEditorDb implements EditorDb {
  static readonly T1 = id(1);
  static readonly T2 = id(2);
  static readonly C1 = id(10);
  static readonly C2 = id(11);
  static readonly M1 = id(20);
  static readonly L1 = id(30);
  static readonly P1 = id(40);
  static readonly P2 = id(41);
  static readonly L2 = id(31); // lesson of the foreign course
  static readonly P3 = id(42);

  blocks: FBlock[] = [];
  words: (EditorWord & { lesson?: string })[] = [];
  lessonUpdated = 1;
  nextId = 100;
  published = new Map<string, boolean>();
  calls: string[] = [];

  private course(entity: string): string | null {
    if ([FakeEditorDb.M1, FakeEditorDb.L1, FakeEditorDb.P1, FakeEditorDb.P2].includes(entity)) return FakeEditorDb.C1;
    if ([FakeEditorDb.L2, FakeEditorDb.P3].includes(entity)) return FakeEditorDb.C2;
    return null;
  }
  async canEdit(actor: string, courseId: string) {
    return (actor === FakeEditorDb.T1 && courseId === FakeEditorDb.C1) || (actor === FakeEditorDb.T2 && courseId === FakeEditorDb.C2);
  }
  async courseOfModule(i: string) {
    return this.course(i);
  }
  async courseOfLesson(i: string) {
    return this.course(i);
  }
  async courseOfPart(i: string) {
    return this.course(i);
  }
  async blockMeta(i: string): Promise<BlockMeta | null> {
    const b = this.blocks.find((x) => x.id === i);
    if (!b) return null;
    return { courseId: this.course(b.part) as string, lessonId: this.course(b.part) === FakeEditorDb.C1 ? FakeEditorDb.L1 : FakeEditorDb.L2, partId: b.part, type: b.type, published: b.published };
  }
  async createModule() {
    return id(this.nextId++);
  }
  async createLesson() {
    this.calls.push("createLesson");
    return id(this.nextId++);
  }
  async saveLesson(_a: string, _l: string, _t: string, _o: string | null, expected: string) {
    if (expected !== String(this.lessonUpdated)) return { outcome: "conflict" as const, updatedAt: String(this.lessonUpdated) };
    this.lessonUpdated++;
    return { outcome: "ok" as const, updatedAt: String(this.lessonUpdated) };
  }
  async createBlock(_a: string, part: string, type: BlockType, payload: Record<string, unknown>, exercise: ExerciseWrite | null) {
    const b: FBlock = {
      id: id(this.nextId++), part, type, published: false, payload, updatedAt: 1, position: this.blocks.filter((x) => x.part === part).length + 1,
      exercise: exercise ? { ...exercise, id: id(this.nextId++), isTestItem: false } : null,
    };
    this.blocks.push(b);
    return { blockId: b.id, updatedAt: "1" };
  }
  async saveBlock(_a: string, block: string, payload: Record<string, unknown> | null, exercise: ExerciseWrite | null, expected: string) {
    const b = this.blocks.find((x) => x.id === block) as FBlock;
    if (expected !== String(b.updatedAt)) return { outcome: "conflict" as const, updatedAt: String(b.updatedAt) };
    b.updatedAt++;
    if (payload) b.payload = payload;
    if (exercise) b.exercise = { ...exercise, id: b.exercise?.id ?? id(this.nextId++), isTestItem: b.exercise?.isTestItem ?? false };
    return { outcome: "ok" as const, updatedAt: String(b.updatedAt) };
  }
  async deleteBlock(_a: string, block: string) {
    this.blocks = this.blocks.filter((x) => x.id !== block);
    return "ok" as const;
  }
  async reorderBlocks(_a: string, part: string, ids: string[]) {
    ids.forEach((i, n) => {
      const b = this.blocks.find((x) => x.id === i && x.part === part);
      if (b) b.position = n + 1;
    });
  }
  async setPublished(_a: string, lesson: string, published: boolean) {
    this.published.set(lesson, published);
    this.blocks.forEach((b) => (b.published = published));
    return this.blocks.length;
  }
  async lessonCheckData(): Promise<{ parts: CheckPart[]; wordIds: string[] }> {
    const mk = (part: string, title: string, position: number): CheckPart => ({
      position, title,
      blocks: this.blocks.filter((b) => b.part === part).sort((a, b) => a.position - b.position).map((b) => ({
        id: b.id, type: b.type, payload: b.payload,
        exercise: b.exercise ? { id: b.exercise.id, type: b.exercise.type, prompt: b.exercise.prompt, payload: b.exercise.payload, key: b.exercise.key, xp: b.exercise.xp, isTestItem: b.exercise.isTestItem } : null,
      })),
    });
    return { parts: [mk(FakeEditorDb.P1, "Grammatika", 1), mk(FakeEditorDb.P2, "Razgovor", 2)], wordIds: this.words.map((w) => w.id) };
  }
  async lessonWords() {
    return this.words;
  }
  async importWords(_a: string, lesson: string, rows: WordRow[]) {
    this.calls.push(`import:${rows.length}`);
    rows.forEach((r) => this.words.push({ id: id(this.nextId++), lesson, ...r }));
    return { inserted: rows.length, linked: 0, skipped: 0 };
  }
  async saveWord(_a: string, lesson: string, word: string | null, f: Omit<EditorWord, "id">) {
    const wid = word ?? id(this.nextId++);
    this.words = this.words.filter((w) => w.id !== wid);
    this.words.push({ id: wid, lesson, ...f });
    return wid;
  }
  async unlinkWord(_a: string, _l: string, word: string) {
    this.words = this.words.filter((w) => w.id !== word);
  }
  async signUpload() {
    return { token: "tok" };
  }
}
