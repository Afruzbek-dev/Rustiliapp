import { randomUUID } from 'node:crypto';
import { createUser, sql } from './helpers';

// Superuser fixture builders (bypass RLS). Every fixture uses fresh UUIDs, so test files
// sharing the database never collide.

export type Role = 'student' | 'curator' | 'teacher' | 'admin';

export async function createProfile(role: Role = 'student', fullName = 'Test User'): Promise<string> {
  const id = await createUser();
  await sql('insert into public.profiles (id, full_name, role) values ($1, $2, $3)', [id, fullName, role]);
  return id;
}

export async function createCourse(teacherId: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    'insert into public.courses (teacher_id, title, slug) values ($1, $2, $3) returning id',
    [teacherId, 'Course', `course-${randomUUID()}`],
  );
  return row.id;
}

export async function createCohort(courseId: string, name = 'Potok 1'): Promise<string> {
  const [row] = await sql<{ id: string }>(
    'insert into public.cohorts (course_id, name) values ($1, $2) returning id',
    [courseId, name],
  );
  return row.id;
}

export async function createGroup(cohortId: string, curatorId: string | null): Promise<string> {
  const [row] = await sql<{ id: string }>(
    'insert into public.curator_groups (cohort_id, curator_id, name) values ($1, $2, $3) returning id',
    [cohortId, curatorId, `Guruh ${randomUUID().slice(0, 8)}`], // names are unique per cohort (0017)
  );
  return row.id;
}

export async function enroll(
  studentId: string,
  cohortId: string,
  opts: { status?: 'pending' | 'active' | 'rejected' | 'expired'; groupId?: string | null; expiresAt?: string | null } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.enrollments (student_id, cohort_id, curator_group_id, status, expires_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [studentId, cohortId, opts.groupId ?? null, opts.status ?? 'active', opts.expiresAt ?? null],
  );
  return row.id;
}

/** A teacher with one course, one cohort, one curator group (with curator) — the common setup. */
export async function createCourseWorld() {
  const teacher = await createProfile('teacher', 'Zarina Kasimova');
  const course = await createCourse(teacher);
  const cohort = await createCohort(course);
  const curator = await createProfile('curator', 'Kurator Bir');
  const group = await createGroup(cohort, curator);
  return { teacher, course, cohort, curator, group };
}

/** module → lesson → two parts for `course`. */
export async function createLesson(course: string) {
  const [m] = await sql<{ id: string }>(
    `insert into public.modules (course_id, position, title)
     values ($1, coalesce((select max(position) from public.modules where course_id = $1), 0) + 1, 'Modul')
     returning id`,
    [course],
  );
  const [l] = await sql<{ id: string }>(
    `insert into public.lessons (module_id, position, title) values ($1, 1, 'Dars 1') returning id`,
    [m.id],
  );
  const [p1] = await sql<{ id: string }>(
    `insert into public.lesson_parts (lesson_id, position, kind, title)
     values ($1, 1, 'grammar', 'Grammatika') returning id`,
    [l.id],
  );
  const [p2] = await sql<{ id: string }>(
    `insert into public.lesson_parts (lesson_id, position, kind, title)
     values ($1, 2, 'conversation', 'Razgovor') returning id`,
    [l.id],
  );
  return { module: m.id, lesson: l.id, part1: p1.id, part2: p2.id };
}

export async function createBlock(part: string, position: number, published: boolean, type = 'exercise') {
  const [row] = await sql<{ id: string }>(
    `insert into public.blocks (lesson_part_id, position, type, published) values ($1, $2, $3, $4) returning id`,
    [part, position, type, published],
  );
  return row.id;
}

/** An exercise in `block` (course_id is filled from the block) with a hidden answer key. */
export async function createExercise(
  block: string,
  opts: { type?: string; answer?: unknown; checkMode?: 'auto' | 'review' } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into public.exercises (block_id, type, prompt, payload, check_mode)
     values ($1, $2, 'Prompt', '{"items":["тетрадь"]}', $3) returning id`,
    [block, opts.type ?? 'classify', opts.checkMode ?? 'auto'],
  );
  await sql('insert into public.exercise_keys (exercise_id, answer) values ($1, $2)', [
    row.id,
    JSON.stringify(opts.answer ?? { тетрадь: 'f' }),
  ]);
  return row.id;
}

/** An active student enrolled in `cohort` (optionally in `groupId`). */
export async function createActiveStudent(cohort: string, groupId: string | null = null, fullName = 'Madina Rahimova') {
  const student = await createProfile('student', fullName);
  await enroll(student, cohort, { status: 'active', groupId });
  return student;
}
