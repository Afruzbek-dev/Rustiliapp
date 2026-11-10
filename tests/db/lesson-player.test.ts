import { beforeAll, describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createLesson } from './fixtures';

// The reads of src/server/lesson.ts (getLessonPart) under the student's JWT.
describe('lesson player reads (RLS)', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let other: Awaited<ReturnType<typeof createCourseWorld>>;
  let lesson: Awaited<ReturnType<typeof createLesson>>;
  let student: string;
  let outsider: string;
  let b1: string;
  let b2: string;
  let draft: string;
  let exercise: string;

  beforeAll(async () => {
    world = await createCourseWorld();
    other = await createCourseWorld();
    student = await createActiveStudent(world.cohort, world.group);
    outsider = await createActiveStudent(other.cohort, other.group);
    lesson = await createLesson(world.course);
    // inserted out of order on purpose: the player orders by position
    b2 = await createBlock(lesson.part1, 2, true, 'exercise');
    b1 = await createBlock(lesson.part1, 1, true, 'text');
    draft = await createBlock(lesson.part1, 3, false, 'text');
    exercise = await createExercise(b2);
    const [w] = await sql<{ id: string }>(
      `insert into public.words (course_id, ru, stress, uz) values ($1, 'мама', 'ма́ма', 'ona') returning id`,
      [world.course],
    );
    await sql('insert into public.lesson_words (lesson_id, word_id) values ($1, $2)', [lesson.lesson, w.id]);
    await sql(`update public.lessons set objective = 'Maqsad' where id = $1`, [lesson.lesson]);
  });

  it('returns published blocks of the part in position order and hides drafts', async () => {
    const rows = await withUser(student, (q) =>
      q('select id, position, type, payload, published from public.blocks where lesson_part_id = $1 and published order by position', [
        lesson.part1,
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual([b1, b2]);
    const all = await withUser(student, (q) => q('select id from public.blocks where lesson_part_id = $1', [lesson.part1]));
    expect(all.map((r) => r.id)).not.toContain(draft);
  });

  it('reads the part with its lesson title and objective', async () => {
    const [row] = await withUser(student, (q) =>
      q(
        `select p.id, p.kind, p.title, l.id as lesson_id, l.title as lesson_title, l.objective
           from public.lesson_parts p join public.lessons l on l.id = p.lesson_id where p.id = $1`,
        [lesson.part1],
      ),
    );
    expect(row).toMatchObject({ kind: 'grammar', lesson_id: lesson.lesson, objective: 'Maqsad' });
  });

  it('reads the exercise columns the player needs but never the answer key', async () => {
    const rows = await withUser(student, (q) =>
      q('select id, block_id, type, prompt, payload, check_mode from public.exercises where block_id = any($1)', [[b1, b2]]),
    );
    expect(rows.map((r) => r.id)).toEqual([exercise]);
    expect(await withUser(student, (q) => q('select 1 from public.exercise_keys'))).toHaveLength(0);
  });

  it('reads the lesson words (ru, stress, uz) through lesson_words', async () => {
    const rows = await withUser(student, (q) =>
      q('select w.id, w.ru, w.stress, w.uz from public.lesson_words lw join public.words w on w.id = lw.word_id where lw.lesson_id = $1', [
        lesson.lesson,
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ru: 'мама', uz: 'ona' });
  });

  it("a student of another course sees none of it", async () => {
    expect(await withUser(outsider, (q) => q('select id from public.blocks where lesson_part_id = $1', [lesson.part1]))).toHaveLength(0);
    expect(await withUser(outsider, (q) => q('select id from public.lesson_parts where id = $1', [lesson.part1]))).toHaveLength(0);
    expect(await withUser(outsider, (q) => q('select word_id from public.lesson_words where lesson_id = $1', [lesson.lesson]))).toHaveLength(0);
  });

  it('students cannot read other students submissions (speaking resume check is own-only)', async () => {
    const rows = await withUser(student, (q) => q('select exercise_id from public.submissions where student_id = $1', [outsider]));
    expect(rows).toHaveLength(0);
  });
});
