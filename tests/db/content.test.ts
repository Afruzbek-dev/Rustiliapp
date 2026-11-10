import { beforeAll, describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCourseWorld,
  createExercise,
  createLesson,
  createProfile,
  enroll,
} from './fixtures';

describe('0002 content RLS', () => {
  let a: Awaited<ReturnType<typeof createCourseWorld>>;
  let b: Awaited<ReturnType<typeof createCourseWorld>>;
  let lesson: Awaited<ReturnType<typeof createLesson>>;
  let studentA: string;
  let studentB: string;
  let publishedBlock: string;
  let draftBlock: string;
  let publishedExercise: string;
  let draftExercise: string;

  beforeAll(async () => {
    a = await createCourseWorld();
    b = await createCourseWorld();
    studentA = await createActiveStudent(a.cohort, a.group);
    studentB = await createActiveStudent(b.cohort, b.group);
    lesson = await createLesson(a.course);
    publishedBlock = await createBlock(lesson.part1, 1, true);
    draftBlock = await createBlock(lesson.part1, 2, false);
    publishedExercise = await createExercise(publishedBlock);
    draftExercise = await createExercise(draftBlock);
  });

  it('an active student sees a published block but not a draft', async () => {
    const blocks = await withUser(studentA, (q) => q('select id from public.blocks'));
    expect(blocks.map((r) => r.id)).toEqual([publishedBlock]);
    const exercises = await withUser(studentA, (q) => q('select id from public.exercises'));
    expect(exercises.map((r) => r.id)).toEqual([publishedExercise]);
  });

  it('a student gets 0 rows from exercise_keys (even for published exercises)', async () => {
    const keys = await withUser(studentA, (q) => q('select * from public.exercise_keys'));
    expect(keys).toEqual([]);
    const [{ n }] = await sql('select count(*)::int as n from public.exercise_keys where exercise_id = $1', [
      publishedExercise,
    ]);
    expect(n).toBe(1);
  });

  it('a curator reads the course content but not the answer keys', async () => {
    const blocks = await withUser(a.curator, (q) => q('select id from public.blocks'));
    expect(blocks.map((r) => r.id).sort()).toEqual([publishedBlock, draftBlock].sort());
    expect(await withUser(a.curator, (q) => q('select * from public.exercise_keys'))).toEqual([]);
  });

  it('a student of another course sees nothing of this course', async () => {
    for (const table of ['modules', 'lessons', 'lesson_parts', 'blocks', 'exercises', 'exercise_keys']) {
      expect(await withUser(studentB, (q) => q(`select * from public.${table}`))).toEqual([]);
    }
  });

  it('a pending student sees no content', async () => {
    const pending = await createProfile('student');
    await enroll(pending, a.cohort, { status: 'pending' });
    expect(await withUser(pending, (q) => q('select id from public.modules'))).toEqual([]);
    expect(await withUser(pending, (q) => q('select id from public.blocks'))).toEqual([]);
  });

  it('the teacher can swap block order inside one transaction (deferrable unique)', async () => {
    const result = await withUser(a.teacher, async (q) => {
      await q('update public.blocks set position = 2 where id = $1', [publishedBlock]);
      await q('update public.blocks set position = 1 where id = $1', [draftBlock]);
      return q('select id, position from public.blocks where lesson_part_id = $1 order by position', [lesson.part1]);
    });
    expect(result).toEqual([
      { id: draftBlock, position: 1 },
      { id: publishedBlock, position: 2 },
    ]);
  });

  it('the teacher reads and writes answer keys; another teacher cannot', async () => {
    const keys = await withUser(a.teacher, (q) => q('select exercise_id from public.exercise_keys'));
    expect(keys.map((r) => r.exercise_id).sort()).toEqual([publishedExercise, draftExercise].sort());
    expect(await withUser(b.teacher, (q) => q('select * from public.exercise_keys'))).toEqual([]);
    expect(await withUser(b.teacher, (q) => q('select * from public.blocks'))).toEqual([]);
    await expect(
      withUser(b.teacher, (q) =>
        q(`insert into public.blocks (lesson_part_id, position, type) values ($1, 9, 'text')`, [lesson.part1]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('teacher B cannot write teacher A’s exercise_keys; teacher A can', async () => {
    const [ex] = await sql(`insert into public.exercises (block_id, type) values ($1, 'choose') returning id`, [
      draftBlock,
    ]);
    await expect(
      withUser(b.teacher, (q) =>
        q(`insert into public.exercise_keys (exercise_id, answer) values ($1, '"b"')`, [ex.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withUser(b.teacher, (q) =>
      q(`update public.exercise_keys set answer = '"hacked"' where exercise_id = $1 returning exercise_id`, [
        publishedExercise,
      ]),
    );
    expect(updated).toEqual([]);
    const deleted = await withUser(b.teacher, (q) =>
      q('delete from public.exercise_keys where exercise_id = $1 returning exercise_id', [publishedExercise]),
    );
    expect(deleted).toEqual([]);
    const [key] = await sql('select answer from public.exercise_keys where exercise_id = $1', [publishedExercise]);
    expect(key.answer).toEqual({ тетрадь: 'f' });

    const inserted = await withUser(a.teacher, (q) =>
      q(`insert into public.exercise_keys (exercise_id, answer) values ($1, '"a"') returning exercise_id`, [ex.id]),
    );
    expect(inserted).toEqual([{ exercise_id: ex.id }]);
  });

  it('anon cannot call the content helper functions', async () => {
    const calls = [
      ['select public.exercise_course_id($1)', publishedExercise],
      ['select public.exercise_is_published($1)', publishedExercise],
      ['select public.test_is_published($1)', publishedExercise],
      ['select public.block_course_id($1)', publishedBlock],
      ['select public.part_course_id($1)', lesson.part1],
      ['select public.can_view_course($1)', a.course],
    ] as const;
    for (const [text, arg] of calls) {
      await expect(withUser(null, (q) => q(text, [arg]))).rejects.toThrow(/permission denied/);
    }
  });

  it('authenticated cannot TRUNCATE content tables', async () => {
    await expect(withUser(a.teacher, (q) => q('truncate public.exercise_keys'))).rejects.toThrow(/permission denied/);
    await expect(withUser(a.teacher, (q) => q('truncate public.blocks'))).rejects.toThrow(/permission denied/);
  });

  it('a student cannot write content or publish a draft', async () => {
    await expect(
      withUser(studentA, (q) =>
        q(`insert into public.blocks (lesson_part_id, position, type) values ($1, 9, 'text')`, [lesson.part1]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withUser(studentA, (q) =>
      q('update public.blocks set published = true where id = $1 returning id', [draftBlock]),
    );
    expect(updated).toEqual([]);
    await expect(
      withUser(studentA, (q) =>
        q(`insert into public.exercise_keys (exercise_id, answer) values ($1, '{}')`, [publishedExercise]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('test-only exercises are visible to students only once the test is published', async () => {
    const [ex] = await sql(
      `insert into public.exercises (course_id, type, prompt) values ($1, 'choose', 'Мочь или уметь?') returning id`,
      [a.course],
    );
    const [t] = await sql(`insert into public.tests (course_id, title) values ($1, 'Test 1') returning id`, [a.course]);
    await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1, $2, 'grammar', 1)`, [
      t.id,
      ex.id,
    ]);
    const before = await withUser(studentA, (q) => q('select id from public.exercises where id = $1', [ex.id]));
    expect(before).toEqual([]);
    expect(await withUser(studentA, (q) => q('select id from public.tests'))).toEqual([]);

    await sql('update public.tests set published = true where id = $1', [t.id]);
    const after = await withUser(studentA, (q) => q('select id from public.exercises where id = $1', [ex.id]));
    expect(after).toEqual([{ id: ex.id }]);
    expect(await withUser(studentA, (q) => q('select test_id from public.test_items'))).toEqual([{ test_id: t.id }]);
    expect(await withUser(studentB, (q) => q('select id from public.tests'))).toEqual([]);
  });

  it('an exercise cannot claim a course other than its block’s', async () => {
    await expect(
      sql(`insert into public.exercises (course_id, block_id, type) values ($1, $2, 'choose')`, [
        b.course,
        publishedBlock,
      ]),
    ).rejects.toThrow(/must match/);
  });
});
