import type { TestSection } from "@/lib/tests/grade";
import type { Result } from "@/server/content-admin";

export interface ExerciseDraftInput {
  type: string;
  prompt: string;
  payload: unknown;
  key: unknown;
}

/** Server actions of the teacher test pages (production: app/(staff)/teacher/tests/actions.ts; tests: fakes). */
export interface TestEditorActions {
  createTest(i: { moduleId: string; title: string }): Promise<Result<{ testId: string }>>;
  updateTest(i: { testId: string; title: string; passScore: number | null; timeLimitMin: number | null; maxAttempts: number }): Promise<Result<object>>;
  addItem(i: { testId: string; section: TestSection; lessonId: string | null; exercise: ExerciseDraftInput }): Promise<Result<{ exerciseId: string }>>;
  updateItem(i: { testId: string; exerciseId: string; section: TestSection; lessonId: string | null; exercise: ExerciseDraftInput }): Promise<Result<object>>;
  removeItem(i: { testId: string; exerciseId: string }): Promise<Result<object>>;
  reorderItems(i: { testId: string; ids: string[] }): Promise<Result<object>>;
  setPublished(i: { testId: string; published: boolean }): Promise<Result<{ warnings: string[] }>>;
  deleteTest(i: { testId: string }): Promise<Result<object>>;
}
