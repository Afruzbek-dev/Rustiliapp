import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  computeLessonStatus,
  computePathStatus,
  moduleTestStatus,
  type PartProgress,
  type PartStatus,
} from "@/lib/path-status";
import { supabaseDashboardDb, type CurrentEnrollment } from "@/server/dashboard";

export type PartKind = "grammar" | "conversation";

export interface PathPart {
  id: string;
  position: number;
  kind: PartKind;
  title: string;
  status: PartStatus;
}

export interface PathLesson {
  id: string;
  position: number;
  title: string;
  status: PartStatus;
  /** No published parts yet: shown locked as "Tez orada". */
  comingSoon: boolean;
  /** Published parts only, by position. */
  parts: PathPart[];
  /** First published part that is available or in progress, i.e. where "continue" leads. */
  continuePartId: string | null;
}

export interface PathTest {
  id: string;
  title: string;
  status: "locked" | "available";
}

export interface PathModule {
  id: string;
  position: number;
  title: string;
  lessons: PathLesson[];
  completedLessons: number;
  test: PathTest | null;
}

export interface Path {
  modules: PathModule[];
}

export interface ModuleRow {
  id: string;
  position: number;
  title: string;
  lessons: {
    id: string;
    position: number;
    title: string;
    lesson_parts: { id: string; position: number; kind: PartKind; title: string }[];
  }[];
}

export interface TestRow {
  id: string;
  title: string;
  after_module_id: string | null;
}

/** Narrow data port; production adapter below, tests inject an in-memory fake. */
export interface PathDb {
  enrollment(studentId: string, nowIso: string): Promise<CurrentEnrollment | null>;
  modules(courseId: string): Promise<ModuleRow[]>;
  /** Ids (of the given parts) that have at least one published block. */
  publishedPartIds(partIds: string[]): Promise<Set<string>>;
  progress(studentId: string): Promise<Map<string, PartProgress>>;
  /** Published tests of the course. */
  tests(courseId: string): Promise<TestRow[]>;
}

export async function getPathWith(db: PathDb, studentId: string, now: Date = new Date()): Promise<Path> {
  const enrollment = await db.enrollment(studentId, now.toISOString());
  if (!enrollment) return { modules: [] };

  const rawModules = [...(await db.modules(enrollment.courseId))].sort((a, b) => a.position - b.position);
  const allPartIds = rawModules.flatMap((m) =>
    (m.lessons ?? []).flatMap((l) => (l.lesson_parts ?? []).map((p) => p.id)),
  );
  const [published, progress, tests] = await Promise.all([
    allPartIds.length > 0 ? db.publishedPartIds(allPartIds) : Promise.resolve(new Set<string>()),
    db.progress(studentId),
    db.tests(enrollment.courseId),
  ]);

  // One global, ordered sequence of published parts across the whole course.
  const ordered: { id: string; order: number }[] = [];
  let seq = 0;
  for (const m of rawModules) {
    for (const l of [...(m.lessons ?? [])].sort((a, b) => a.position - b.position)) {
      for (const p of [...(l.lesson_parts ?? [])].sort((a, b) => a.position - b.position)) {
        if (published.has(p.id)) ordered.push({ id: p.id, order: seq++ });
      }
    }
  }
  const statuses = computePathStatus(ordered, progress);

  const modules: PathModule[] = rawModules.map((m) => {
    const lessons: PathLesson[] = [...(m.lessons ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((l) => {
        const parts: PathPart[] = [...(l.lesson_parts ?? [])]
          .filter((p) => published.has(p.id))
          .sort((a, b) => a.position - b.position)
          .map((p) => ({
            id: p.id,
            position: p.position,
            kind: p.kind,
            title: p.title,
            status: statuses.get(p.id) ?? "locked",
          }));
        const status = computeLessonStatus(parts.map((p) => p.status));
        const cont = parts.find((p) => p.status === "available" || p.status === "in_progress");
        return {
          id: l.id,
          position: l.position,
          title: l.title,
          status,
          comingSoon: parts.length === 0,
          parts,
          continuePartId: cont?.id ?? null,
        };
      });
    const test = tests.find((t) => t.after_module_id === m.id);
    return {
      id: m.id,
      position: m.position,
      title: m.title,
      lessons,
      completedLessons: lessons.filter((l) => l.status === "completed").length,
      test: test
        ? { id: test.id, title: test.title, status: moduleTestStatus(lessons.map((l) => l.status)) }
        : null,
    };
  });

  return { modules: modules.some((m) => m.lessons.length > 0) ? modules : [] };
}

function ok<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`path: ${what}: ${res.error.message}`);
  return res.data as T;
}

type Sb = Awaited<ReturnType<typeof createClient>>;

export function supabasePathDb(sb: Sb): PathDb {
  return {
    enrollment: (studentId, nowIso) => supabaseDashboardDb(sb).enrollment(studentId, nowIso),

    async modules(courseId) {
      const data = ok<ModuleRow[] | null>(
        await sb
          .from("modules")
          .select("id, position, title, lessons(id, position, title, lesson_parts(id, position, kind, title))")
          .eq("course_id", courseId)
          .order("position"),
        "modules",
      );
      return data ?? [];
    },

    async publishedPartIds(partIds) {
      const data = ok<{ lesson_part_id: string }[] | null>(
        await sb.from("blocks").select("lesson_part_id").eq("published", true).in("lesson_part_id", partIds),
        "blocks",
      );
      return new Set((data ?? []).map((b) => b.lesson_part_id));
    },

    async progress(studentId) {
      const data = ok<{ lesson_part_id: string; status: PartProgress }[] | null>(
        await sb.from("part_progress").select("lesson_part_id, status").eq("student_id", studentId),
        "part progress",
      );
      return new Map((data ?? []).map((r) => [r.lesson_part_id, r.status]));
    },

    async tests(courseId) {
      const data = ok<TestRow[] | null>(
        await sb
          .from("tests")
          .select("id, title, after_module_id")
          .eq("course_id", courseId)
          .eq("published", true),
        "tests",
      );
      return data ?? [];
    },
  };
}

export async function getPath(studentId: string): Promise<Path> {
  const sb = await createClient();
  return getPathWith(supabasePathDb(sb), studentId);
}
