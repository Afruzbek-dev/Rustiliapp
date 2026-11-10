import { beforeAll, describe, expect, it } from 'vitest';
import { handleAttemptRequest, submitAttempt, AttemptError, type AttemptStore } from '@/server/attempts';
import { completePart } from '@/server/progress';
import { pool, sql, withUser, type Query } from '../db/helpers';
import {
  createActiveStudent,
  createBlock,
  createCourseWorld,
  createExercise,
  createLesson,
} from '../db/fixtures';

// AttemptStore backed by the local Postgres: reads that Supabase does with the user-scoped client
// run as `authenticated` with auth.uid() = student (so RLS decides), key/attempt/XP operations run
// as `service_role` and COMMIT (the db helpers always roll back, so we manage our own tx here).
async function asServiceCommitted<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const out = await fn(async (text, params) => (await client.query(text, params)).rows);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function pgStore(userId: string | null): AttemptStore {
  return {
    async getRole(id) {
      const rows = await withUser(id, (q) => q('select role from public.profiles where id = $1', [id]));
      return rows[0]?.role ?? null;
    },
    async getVisibleExercise(exerciseId) {
      const rows = await withUser(userId, (q) =>
        q(
          `select e.id, e.type, e.check_mode, b.lesson_part_id
             from public.exercises e left join public.blocks b on b.id = e.block_id
            where e.id = $1`,
          [exerciseId],
        ),
      );
      const r = rows[0];
      return r ? { id: r.id, type: r.type, checkMode: r.check_mode, partId: r.lesson_part_id ?? null } : null;
    },
    getKey: (id) =>
      asServiceCommitted(async (q) => (await q('select answer from public.exercise_keys where exercise_id = $1', [id]))[0]?.answer ?? null),
    countPriorAttempts: (s, e, item) =>
      asServiceCommitted(async (q) => {
        const rows = await q(
          `select count(*)::int as total, count(*) filter (where is_correct)::int as correct
             from public.attempts where student_id = $1 and exercise_id = $2
              and ($3::text is null or answer->>'itemId' = $3)`,
          [s, e, item],
        );
        return rows[0] as { total: number; correct: number };
      }),
    insertAttempt: (s, e, answer, ok) =>
      asServiceCommitted(async (q) => {
        await q('insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1,$2,$3,$4)', [
          s,
          e,
          JSON.stringify(answer),
          ok,
        ]);
      }),
    awardXp: (s, amount, reason, ref) =>
      asServiceCommitted(async (q) => (await q('select public.award_xp($1,$2,$3::public.xp_reason,$4) as ok', [s, amount, reason, ref]))[0].ok === true),
    getPartExercises: (partId) =>
      asServiceCommitted(async (q) =>
        (
          await q(
            `select e.id, e.type, e.check_mode, k.answer
               from public.blocks b join public.exercises e on e.block_id = b.id
               left join public.exercise_keys k on k.exercise_id = e.id
              where b.lesson_part_id = $1 and b.published`,
            [partId],
          )
        ).map((r) => ({ id: r.id, type: r.type, checkMode: r.check_mode, key: r.answer ?? null })),
      ),
    getCorrectRefs: (s, ids) =>
      asServiceCommitted(async (q) =>
        (
          await q(
            `select exercise_id, answer->>'itemId' as item from public.attempts
              where student_id = $1 and is_correct and exercise_id = any($2::uuid[])`,
            [s, ids],
          )
        ).map((r) => ({ exerciseId: r.exercise_id, itemId: r.item ?? null })),
      ),
    getSubmittedExerciseIds: (s, ids) =>
      asServiceCommitted(async (q) =>
        (
          await q('select distinct exercise_id from public.submissions where student_id = $1 and exercise_id = any($2::uuid[])', [s, ids])
        ).map((r) => r.exercise_id as string),
      ),
    ensurePartStarted: (s, p) =>
      asServiceCommitted(async (q) => {
        await q('insert into public.part_progress (student_id, lesson_part_id) values ($1,$2) on conflict do nothing', [s, p]);
      }),
    markPartCompleted: (s, p) =>
      asServiceCommitted(
        async (q) =>
          (
            await q(
              `update public.part_progress set status = 'completed', completed_at = now()
                where student_id = $1 and lesson_part_id = $2 and status <> 'completed' returning 1`,
              [s, p],
            )
          ).length > 0,
      ),
  };
}

const xpOf = async (student: string) =>
  Number((await sql('select coalesce(sum(amount),0)::int as s from public.xp_events where student_id = $1', [student]))[0].s);

describe('POST /api/attempts service (DB-backed)', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let other: Awaited<ReturnType<typeof createCourseWorld>>;
  let student: string;
  let part1: string;
  let part2: string;
  let classify: string; // 2 items: a, b  (part1)
  let conjugate: string; // part1
  let fill: string; // 1 item (part2, retry tests)
  let foreign: string; // exercise of another course
  let unpublished: string;
  let speaking: string; // review (part2)
  const forms = ['работаю', 'работаешь', 'работает', 'работаем', 'работаете', 'работают'];
  const SECRET_VARIANT = 'совершенносекретныйответ';

  const run = (exerciseId: unknown, answer: unknown, as: string | null = student) =>
    handleAttemptRequest({ store: pgStore(as) }, { userId: as, body: { exerciseId, answer } });

  beforeAll(async () => {
    world = await createCourseWorld();
    other = await createCourseWorld();
    student = await createActiveStudent(world.cohort, world.group);
    const lesson = await createLesson(world.course);
    part1 = lesson.part1;
    part2 = lesson.part2;
    const b1 = await createBlock(part1, 1, true);
    classify = await createExercise(b1, { type: 'classify', answer: { a: 'f', b: 'm' } });
    const b2 = await createBlock(part1, 2, true);
    conjugate = await createExercise(b2, { type: 'conjugate', answer: { forms } });
    const b3 = await createBlock(part2, 1, true);
    fill = await createExercise(b3, { type: 'fill_blank', answer: { x: [SECRET_VARIANT] } });
    const b4 = await createBlock(part2, 2, true, 'speaking');
    speaking = await createExercise(b4, { type: 'speaking', checkMode: 'review', answer: {} });
    const bu = await createBlock(part2, 3, false);
    unpublished = await createExercise(bu, { type: 'classify', answer: { a: 'f' } });
    const otherLesson = await createLesson(other.course);
    foreign = await createExercise(await createBlock(otherLesson.part1, 1, true), { type: 'classify', answer: { a: 'f' } });
  });

  it('unauthenticated -> 401', async () => {
    const r = await run(classify, { itemId: 'a', bucketId: 'f' }, null);
    expect(r.status).toBe(401);
  });

  it('non-student roles -> 403', async () => {
    const r = await run(classify, { itemId: 'a', bucketId: 'f' }, world.curator);
    expect(r.status).toBe(403);
  });

  it('foreign-course, unpublished and unknown exercises -> 404 (same body)', async () => {
    const bodies = [];
    for (const id of [foreign, unpublished, '00000000-0000-4000-8000-000000000000']) {
      const r = await run(id, { itemId: 'a', bucketId: 'f' });
      expect(r.status).toBe(404);
      bodies.push(JSON.stringify(r.json));
    }
    expect(new Set(bodies).size).toBe(1);
    await expect(
      submitAttempt({ store: pgStore(student) }, { studentId: student, exerciseId: foreign, answer: {} }),
    ).rejects.toBeInstanceOf(AttemptError);
  });

  it('malformed bodies and answers -> 400, never 500', async () => {
    expect((await handleAttemptRequest({ store: pgStore(student) }, { userId: student, body: undefined })).status).toBe(400);
    expect((await run('not-a-uuid', {})).status).toBe(400);
    expect((await run(classify, undefined)).status).toBe(400);
    expect((await run(classify, { itemId: 'a' })).status).toBe(400);
    expect((await run(classify, { itemId: 'a', bucketId: 5 })).status).toBe(400);
    expect((await run(conjugate, { forms: ['работаю'] })).status).toBe(400);
    expect((await run(conjugate, { forms: [1, 2, 3, 4, 5, 6] })).status).toBe(400);
    expect((await run(conjugate, { forms: null })).status).toBe(400);
    expect((await run(conjugate, 'x')).status).toBe(400);
    expect((await run(speaking, { itemId: 'a' })).status).toBe(400); // review exercises are not attempt-checked
    expect(await sql('select 1 from public.attempts where student_id = $1', [student])).toEqual([]);
  });

  it('wrong answer returns expected, no XP; per-item feedback for conjugate', async () => {
    const r = await run(classify, { itemId: 'a', bucketId: 'm' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ correct: false, expected: 'f', xpAwarded: 0 });
    const bad = [...forms];
    bad[5] = 'работаут';
    const c = await run(conjugate, { forms: bad });
    expect(c.json.perItem).toEqual([true, true, true, true, true, false]);
    expect(c.json.expected).toEqual(forms);
  });

  it('first attempt creates part_progress in_progress', async () => {
    const rows = await sql('select status from public.part_progress where student_id = $1 and lesson_part_id = $2', [student, part1]);
    expect(rows.map((r) => r.status)).toEqual(['in_progress']);
  });

  it('retry after wrong pays 5; later correct attempt on the same ref pays 0', async () => {
    // item a: earlier attempt was wrong (see above) -> first correct counts as retry
    const first = await run(classify, { itemId: 'a', bucketId: 'f' });
    expect(first.json).toMatchObject({ correct: true, xpAwarded: 5 });
    expect(first.json.expected).toBeUndefined();
    const again = await run(classify, { itemId: 'a', bucketId: 'f' });
    expect(again.json).toMatchObject({ correct: true, xpAwarded: 0 });
    const third = await run(classify, { itemId: 'a', bucketId: 'f' });
    expect(third.json.xpAwarded).toBe(0);
    const rows = await sql(
      `select amount from public.xp_events where student_id = $1 and reason = 'exercise_correct' and ref_id = $2`,
      [student, `${classify}:a`],
    );
    expect(rows.map((r) => r.amount)).toEqual([5]);
  });

  it('first-try correct pays 10; refs are per item', async () => {
    const r = await run(classify, { itemId: 'b', bucketId: 'm' });
    expect(r.json).toMatchObject({ correct: true, xpAwarded: 10 });
    expect(await sql(`select 1 from public.xp_events where ref_id = $1`, [`${classify}:b`])).toHaveLength(1);
  });

  it('part completes only when every auto exercise (all items) is correct; pays 20 exactly once', async () => {
    expect((await sql('select status from public.part_progress where student_id=$1 and lesson_part_id=$2', [student, part1]))[0].status).toBe('in_progress');
    const before = await xpOf(student);
    const r = await run(conjugate, { forms: [...forms] });
    // conjugate had one wrong attempt earlier -> 5, plus part 20
    expect(r.json).toMatchObject({ correct: true, xpAwarded: 25, partCompleted: true });
    expect(await xpOf(student)).toBe(before + 25);
    const again = await run(conjugate, { forms: [...forms] });
    expect(again.json).toMatchObject({ correct: true, xpAwarded: 0 });
    expect(again.json.partCompleted).toBeUndefined();
    const parts = await sql(`select amount from public.xp_events where student_id=$1 and reason='part_completed' and ref_id=$2`, [student, part1]);
    expect(parts.map((p) => p.amount)).toEqual([20]);
    const pp = await sql('select status, completed_at from public.part_progress where student_id=$1 and lesson_part_id=$2', [student, part1]);
    expect(pp[0].status).toBe('completed');
    expect(pp[0].completed_at).not.toBeNull();
  });

  it('completePart is idempotent when called directly', async () => {
    const r = await completePart(pgStore(student), student, part1);
    expect(r).toEqual({ completed: true, newlyCompleted: false, xpAwarded: 0 });
  });

  it('a part with a review exercise needs a submission; unpublished blocks do not count', async () => {
    const store = pgStore(student);
    // fill_blank correct first (10 XP), speaking not submitted yet -> not complete
    const r = await run(fill, { itemId: 'x', value: ` ${SECRET_VARIANT.toUpperCase()}. ` });
    expect(r.json).toMatchObject({ correct: true, xpAwarded: 10 });
    expect(r.json.partCompleted).toBeUndefined();
    expect((await completePart(store, student, part2)).completed).toBe(false);
    await sql(
      `insert into public.submissions (student_id, exercise_id, curator_group_id, kind, text_answer)
       values ($1, $2, $3, 'text', 'privet')`,
      [student, speaking, world.group],
    );
    const done = await completePart(store, student, part2);
    expect(done).toEqual({ completed: true, newlyCompleted: true, xpAwarded: 20 });
    expect((await completePart(store, student, part2)).xpAwarded).toBe(0);
  });

  it('the answer key never appears in a correct response; only in wrong ones', async () => {
    const w2 = await createCourseWorld();
    const s2 = await createActiveStudent(w2.cohort, w2.group);
    const l = await createLesson(w2.course);
    const blk = await createBlock(l.part1, 1, true);
    const ex = await createExercise(blk, { type: 'fill_blank', answer: { x: ['ответсекрет', 'вариантдва'] } });
    const ok = await handleAttemptRequest({ store: pgStore(s2) }, { userId: s2, body: { exerciseId: ex, answer: { itemId: 'x', value: 'вариантдва' } } });
    const okText = JSON.stringify(ok);
    expect(ok.json.correct).toBe(true);
    expect(okText).not.toContain('ответсекрет');
    expect(okText).not.toContain('вариантдва');
    expect(okText).not.toContain('expected');
    // an invalid request never leaks it either
    const bad = await handleAttemptRequest({ store: pgStore(s2) }, { userId: s2, body: { exerciseId: ex, answer: { itemId: 5 } } });
    expect(JSON.stringify(bad)).not.toContain('ответсекрет');
    // the user-scoped read cannot see keys at all (RLS)
    const keys = await withUser(s2, (q) => q('select answer from public.exercise_keys'));
    expect(keys).toEqual([]);
  });
});
