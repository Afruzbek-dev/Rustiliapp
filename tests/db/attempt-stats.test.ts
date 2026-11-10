import { describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createLesson } from './fixtures';

describe('0006 attempt_stats / correct_refs', () => {
  async function world() {
    const w = await createCourseWorld();
    const student = await createActiveStudent(w.cohort, w.group);
    const lesson = await createLesson(w.course);
    const ex = await createExercise(await createBlock(lesson.part1, 1, true), { type: 'classify', answer: { a: 'f', b: 'm' } });
    const hidden = await createExercise(await createBlock(lesson.part1, 2, false), { type: 'classify', answer: { a: 'f' } });
    return { student, lesson, ex, hidden };
  }
  const add = (student: string, ex: string, answer: unknown, ok: boolean) =>
    sql('insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1,$2,$3,$4)', [
      student,
      ex,
      JSON.stringify(answer),
      ok,
    ]);

  it('attempt_stats counts per ref and per whole exercise', async () => {
    const { student, ex } = await world();
    await add(student, ex, { itemId: 'a', bucketId: 'm' }, false);
    await add(student, ex, { itemId: 'a', bucketId: 'f' }, true);
    await add(student, ex, { itemId: 'b', bucketId: 'm' }, true);
    const stats = (item: string | null) =>
      asService((q) => q('select total::int, correct::int from public.attempt_stats($1,$2,$3)', [student, ex, item]));
    expect(await stats('a')).toEqual([{ total: 2, correct: 1 }]);
    expect(await stats('b')).toEqual([{ total: 1, correct: 1 }]);
    expect(await stats(null)).toEqual([{ total: 3, correct: 2 }]);
    expect(await stats('zzz')).toEqual([{ total: 0, correct: 0 }]);
  });

  it('correct_refs is distinct, correct-only and limited to published blocks of the part', async () => {
    const { student, lesson, ex, hidden } = await world();
    await add(student, ex, { itemId: 'a', bucketId: 'f' }, true);
    await add(student, ex, { itemId: 'a', bucketId: 'f' }, true);
    await add(student, ex, { itemId: 'b', bucketId: 'f' }, false);
    await add(student, hidden, { itemId: 'a', bucketId: 'f' }, true);
    const rows = await asService((q) => q('select exercise_id, item_id from public.correct_refs($1,$2)', [student, lesson.part1]));
    expect(rows).toEqual([{ exercise_id: ex, item_id: 'a' }]);
  });

  it('correct_refs excludes test items', async () => {
    const { student, lesson, ex } = await world();
    const [row] = await sql<{ id: string }>(`select course_id as id from public.exercises where id = $1`, [ex]);
    const [t] = await sql<{ id: string }>(`insert into public.tests (course_id, title, published) values ($1,'T',true) returning id`, [row.id]);
    await add(student, ex, { itemId: 'a', bucketId: 'f' }, true);
    expect(await asService((q) => q('select * from public.correct_refs($1,$2)', [student, lesson.part1]))).toHaveLength(1);
    await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1,$2,'grammar',1)`, [t.id, ex]);
    expect(await asService((q) => q('select * from public.correct_refs($1,$2)', [student, lesson.part1]))).toEqual([]);
  });

  it('does not truncate at 1000 rows', async () => {
    const { student, lesson, ex } = await world();
    await sql(
      `insert into public.attempts (student_id, exercise_id, answer, is_correct)
       select $1, $2, jsonb_build_object('itemId', 'i' || g, 'bucketId', 'f'), true from generate_series(1, 1500) g`,
      [student, ex],
    );
    const total = await asService((q) => q('select total::int, correct::int from public.attempt_stats($1,$2,null)', [student, ex]));
    expect(total).toEqual([{ total: 1500, correct: 1500 }]);
    const refs = await asService((q) => q('select count(*)::int as c from public.correct_refs($1,$2)', [student, lesson.part1]));
    expect(refs[0].c).toBe(1500);
  });

  it('is callable by service_role only', async () => {
    const { student, lesson, ex } = await world();
    for (const uid of [student, null]) {
      await expect(
        withUser(uid, (q) => q('select * from public.attempt_stats($1,$2,null)', [student, ex])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUser(uid, (q) => q('select * from public.correct_refs($1,$2)', [student, lesson.part1])),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
