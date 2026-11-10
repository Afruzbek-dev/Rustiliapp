import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { completePart } from '@/server/progress';
import { sql, withUser } from '../db/helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createLesson } from '../db/fixtures';
import { asServiceCommitted, pgStore } from './pg-store';

async function addWord(course: string, lesson: string, ru: string) {
  const [w] = await sql<{ id: string }>(
    `insert into public.words (course_id, ru, uz) values ($1, $2, 'tarjima') returning id`,
    [course, ru],
  );
  await sql('insert into public.lesson_words (lesson_id, word_id) values ($1, $2)', [lesson, w.id]);
  return w.id;
}

async function setup() {
  const world = await createCourseWorld();
  const student = await createActiveStudent(world.cohort, world.group);
  const lesson = await createLesson(world.course);
  const words = [await addWord(world.course, lesson.lesson, 'дом'), await addWord(world.course, lesson.lesson, 'кот')];
  const block = await createBlock(lesson.part1, 1, true);
  const ex = await createExercise(block, { type: 'conjugate', answer: { forms: ['a', 'b', 'c', 'd', 'e', 'f'] } });
  // a correct attempt so completePart passes
  await sql('insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1,$2,$3,true)', [
    student,
    ex,
    JSON.stringify({ forms: [] }),
  ]);
  return { world, student, lesson, words, ex };
}

const cardsOf = (student: string) =>
  sql('select word_id, reps, first_studied_at from public.srs_cards where student_id = $1', [student]);

describe('srs cards on part completion (DB-backed)', () => {
  it('completePart creates one card per lesson word, idempotently and without touching progress', async () => {
    const t = await setup();
    const store = pgStore(t.student);
    const first = await completePart(store, t.student, t.lesson.part1);
    expect(first.completed).toBe(true);
    const rows = await cardsOf(t.student);
    expect(rows.map((r) => r.word_id).sort()).toEqual([...t.words].sort());
    expect(rows.every((r) => r.reps === 0 && r.first_studied_at === null)).toBe(true);

    // a studied card survives a second completion untouched
    await sql('update public.srs_cards set reps = 3, first_studied_at = now() where student_id = $1 and word_id = $2', [
      t.student,
      t.words[0],
    ]);
    await completePart(store, t.student, t.lesson.part1);
    const again = await cardsOf(t.student);
    expect(again).toHaveLength(2);
    expect(again.find((r) => r.word_id === t.words[0])?.reps).toBe(3);
  });

  it('does not create cards while the part is incomplete', async () => {
    const t = await setup();
    await sql('delete from public.attempts where student_id = $1', [t.student]);
    expect((await completePart(pgStore(t.student), t.student, t.lesson.part1)).completed).toBe(false);
    expect(await cardsOf(t.student)).toHaveLength(0);
  });

  it('srs_apply_grade reports first study once, is service-role only, and students cannot write cards', async () => {
    const t = await setup();
    await completePart(pgStore(t.student), t.student, t.lesson.part1);
    // expected state of a fresh card: reps 0, lapses 0, due_at as stored
    const apply = async (w: string, reps = 0, request: string | null = null) =>
      asServiceCommitted(async (q) => {
        const [c] = await q('select due_at from public.srs_cards where student_id = $1 and word_id = $2', [t.student, w]);
        return (
          await q(
            `select public.srs_apply_grade($1,$2,1,2.5, now() + interval '1 day', $3, 0, $3 - 1, 0, $4::timestamptz, $5) as r`,
            [t.student, w, reps + 1, c?.due_at ?? new Date(), request],
          )
        )[0].r;
      });
    expect(await apply(t.words[0])).toBe('first');
    expect(await apply(t.words[0], 1)).toBe('applied');
    expect(await apply('00000000-0000-4000-8000-000000000000')).toBe('missing');
    const row = (await cardsOf(t.student)).find((r) => r.word_id === t.words[0]);
    expect(row?.reps).toBe(2);
    expect(row?.first_studied_at).not.toBeNull();

    const grade = `select public.srs_apply_grade($1,$2,1,2.5, now(), 1, 0, 0, 0, now(), null)`;
    const add = `select public.srs_add_lesson_words($1,$2)`;
    for (const who of [t.student, null]) {
      await expect(withUser(who, (q) => q(grade, [t.student, t.words[1]]))).rejects.toThrow(/permission denied/);
      await expect(withUser(who, (q) => q(add, [t.student, t.lesson.part1]))).rejects.toThrow(/permission denied/);
    }
    await expect(
      withUser(t.student, (q) => q('update public.srs_cards set reps = 9 where student_id = $1', [t.student])),
    ).rejects.toThrow(/permission denied/);
  });

  it('two concurrent grades from the same stale state: one applies, the other conflicts', async () => {
    const t = await setup();
    await completePart(pgStore(t.student), t.student, t.lesson.part1);
    const [c] = await sql('select due_at from public.srs_cards where student_id = $1 and word_id = $2', [t.student, t.words[0]]);
    const grade = (request: string) =>
      asServiceCommitted(
        async (q) =>
          (
            await q(
              `select public.srs_apply_grade($1,$2,1,2.5, now() + interval '1 day', 1, 0, 0, 0, $3::timestamptz, $4) as r`,
              [t.student, t.words[0], c.due_at, request],
            )
          )[0].r as string,
      );
    const results = await Promise.all([grade(randomUUID()), grade(randomUUID())]);
    expect([...results].sort()).toEqual(['conflict', 'first']);
    const row = (await cardsOf(t.student)).find((r) => r.word_id === t.words[0]);
    expect(row?.reps).toBe(1); // advanced exactly once
  });

  it('an exact retry of the same request id is a replay and changes nothing', async () => {
    const t = await setup();
    await completePart(pgStore(t.student), t.student, t.lesson.part1);
    const [c] = await sql('select due_at from public.srs_cards where student_id = $1 and word_id = $2', [t.student, t.words[0]]);
    const request = randomUUID();
    const grade = (reps: number) =>
      asServiceCommitted(
        async (q) =>
          (
            await q(
              `select public.srs_apply_grade($1,$2,1,2.5, now() + interval '1 day', $3, 0, $3 - 1, 0, $4::timestamptz, $5) as r`,
              [t.student, t.words[0], reps, c.due_at, request],
            )
          )[0].r as string,
      );
    expect(await grade(1)).toBe('first');
    // the retry carries the (now stale) original expectation and the same request id
    expect(await grade(1)).toBe('replay');
    expect((await cardsOf(t.student)).find((r) => r.word_id === t.words[0])?.reps).toBe(1);
  });

  it("another student's cards are invisible to a student (RLS)", async () => {
    const t = await setup();
    await completePart(pgStore(t.student), t.student, t.lesson.part1);
    const other = await createActiveStudent(t.world.cohort, t.world.group);
    expect(await withUser(other, (q) => q('select 1 from public.srs_cards where student_id = $1', [t.student]))).toHaveLength(0);
  });

  it('first_studied_at drives the new-today count (>= start of day)', async () => {
    const t = await setup();
    await completePart(pgStore(t.student), t.student, t.lesson.part1);
    const count = async (since: Date) =>
      Number(
        (await sql('select count(*)::int c from public.srs_cards where student_id = $1 and first_studied_at >= $2', [t.student, since]))[0].c,
      );
    const now = new Date();
    await sql('update public.srs_cards set first_studied_at = $2 where student_id = $1 and word_id = $3', [t.student, now, t.words[0]]);
    expect(await count(new Date(now.getTime() - 3_600_000))).toBe(1);
    expect(await count(new Date(now.getTime() + 3_600_000))).toBe(0);
  });
});
