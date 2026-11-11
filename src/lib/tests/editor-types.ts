import type { TestSection } from "./grade";

/** Data shapes shared by the teacher test pages, their components and the server loaders. */
export interface TestListEntry {
  id: string;
  title: string;
  courseTitle: string;
  moduleTitle: string | null;
  published: boolean;
  itemCount: number;
  passScore: number | null;
  timeLimitMin: number | null;
}

export interface TestsOverview {
  courses: { id: string; title: string; modules: { id: string; title: string; position: number; hasTest: boolean }[] }[];
  tests: TestListEntry[];
}

export interface EditorTestItem {
  exerciseId: string;
  position: number;
  section: TestSection;
  lessonId: string | null;
  type: string;
  prompt: string;
  payload: unknown;
  /** Teacher-only: read through the teacher's own RLS-scoped client. */
  key: unknown;
}

export interface TestResultRow {
  studentId: string;
  fullName: string;
  attempts: number;
  bestScore: number | null;
  passed: boolean;
  lastFinishedAt: string | null;
  inProgress: boolean;
}

export interface EditorTest {
  id: string;
  title: string;
  courseTitle: string;
  moduleId: string | null;
  moduleTitle: string | null;
  published: boolean;
  passScore: number | null;
  timeLimitMin: number | null;
  maxAttempts: number;
  /** Students already have attempts: the items are frozen (settings and publishing still work). */
  hasAttempts: boolean;
  items: EditorTestItem[];
  /** Lessons of the test's module, for the "Qayta ko'ring" tag of an item. */
  lessons: { id: string; title: string; position: number }[];
  results: TestResultRow[];
}
