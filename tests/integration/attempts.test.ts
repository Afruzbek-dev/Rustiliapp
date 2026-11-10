import { describe, expect, it, vi } from 'vitest';
import { AttemptError, handleAttemptRequest, readJsonBody, submitAttempt, type AttemptStore } from '@/server/attempts';
import { createSupabaseAttemptStore } from '@/server/attempts-store';
import { completePart } from '@/server/progress';
import { sql, withUser } from '../db/helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createLesson } from '../db/fixtures';
import { pgStore } from './pg-store';

const FORMS = ['работаю', 'работаешь', 'работает', 'работаем', 'работаете', 'работают'];
const NIL = '00000000-0000-4000-8000-000000000000';

/** Fresh course, student, lesson and exercises for every test (no cross-test state). */
async function setup() {
  const world = await createCourseWorld();
  const student = await createActiveStudent(world.cohort, world.group);
  const lesson = await createLesson(world.course);
  const b1 = await createBlock(lesson.part1, 1, true);
  const classify = await createExercise(b1, { type: 'classify', answer: { a: 'f', b: 'm' } });
  const b2 = await createBlock(lesson.part1, 2, true);
  const conjugate = await createExercise(b2, { type: 'conjugate', answer: { forms: FORMS } });
  const run = (exerciseId: unknown, answer: unknown, as: string | null = student, store: AttemptStore = pgStore(as)) =>
    handleAttemptRequest({ store }, { userId: as, body: { exerciseId, answer } });
  return { world, student, lesson, classify, conjugate, run };
}

const xpOf = async (student: string) =>
  Number((await sql('select coalesce(sum(amount),0)::int as s from public.xp_events where student_id = $1', [student]))[0].s);
const attemptsOf = async (student: string) =>
  Number((await sql('select count(*)::int as c from public.attempts where student_id = $1', [student]))[0].c);

describe('POST /api/attempts service (DB-backed)', () => {
  it('unauthenticated -> 401; non-student -> 403', async () => {
    const t = await setup();
    expect((await t.run(t.classify, { itemId: 'a', bucketId: 'f' }, null)).status).toBe(401);
    expect((await t.run(t.classify, { itemId: 'a', bucketId: 'f' }, t.world.curator)).status).toBe(403);
  });

  it('foreign-course, unpublished and unknown exercises -> identical 404', async () => {
    const t = await setup();
    const other = await createCourseWorld();
    const ol = await createLesson(other.course);
    const foreign = await createExercise(await createBlock(ol.part1, 1, true), { type: 'classify', answer: { a: 'f' } });
    const unpublished = await createExercise(await createBlock(t.lesson.part2, 1, false), { type: 'classify', answer: { a: 'f' } });
    const bodies = new Set<string>();
    for (const id of [foreign, unpublished, NIL]) {
      const r = await t.run(id, { itemId: 'a', bucketId: 'f' });
      expect(r.status).toBe(404);
      bodies.add(JSON.stringify(r.json));
    }
    expect(bodies.size).toBe(1);
    await expect(
      submitAttempt({ store: pgStore(t.student) }, { studentId: t.student, exerciseId: foreign, answer: {} }),
    ).rejects.toBeInstanceOf(AttemptError);
  });

  it('module-test exercises are not attemptable: 404, no expected, no attempt, no XP', async () => {
    const t = await setup();
    const [test] = await sql<{ id: string }>(
      `insert into public.tests (course_id, title, published) values ($1, 'Modul testi', true) returning id`,
      [t.world.course],
    );
    // (a) test-only exercise: no block at all
    const [only] = await sql<{ id: string }>(
      `insert into public.exercises (course_id, type, prompt, payload, check_mode)
       values ($1, 'match', 'p', '{}', 'auto') returning id`,
      [t.world.course],
    );
    await sql('insert into public.exercise_keys (exercise_id, answer) values ($1, $2)', [only.id, JSON.stringify({ a: '1', b: '2' })]);
    // (b) exercise that is in a published block AND a test item
    const both = await createExercise(await createBlock(t.lesson.part2, 1, true), { type: 'classify', answer: { a: 'f' } });
    await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1,$2,'grammar',1), ($1,$3,'grammar',2)`, [
      test.id,
      only.id,
      both,
    ]);
    // the student really can read the test-only exercise through RLS (this is the leak path)
    expect(await withUser(t.student, (q) => q('select id from public.exercises where id = $1', [only.id]))).toHaveLength(1);

    for (const [id, wrong] of [
      [only.id, { pairs: [['a', '2']] }],
      [both, { itemId: 'a', bucketId: 'm' }],
    ] as const) {
      const r = await t.run(id, wrong);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r)).not.toContain('expected');
    }
    expect(await attemptsOf(t.student)).toBe(0);
    expect(await xpOf(t.student)).toBe(0);
  });

  it('malformed bodies and answers -> 400, nothing stored', async () => {
    const t = await setup();
    const speaking = await createExercise(await createBlock(t.lesson.part2, 1, true, 'speaking'), {
      type: 'speaking',
      checkMode: 'review',
      answer: {},
    });
    expect((await handleAttemptRequest({ store: pgStore(t.student) }, { userId: t.student, body: undefined })).status).toBe(400);
    for (const [id, ans] of [
      ['not-a-uuid', {}],
      [t.classify, undefined],
      [t.classify, { itemId: 'a' }],
      [t.classify, { itemId: 'a', bucketId: 5 }],
      [t.classify, { itemId: 'x'.repeat(65), bucketId: 'f' }],
      [t.conjugate, { forms: ['работаю'] }],
      [t.conjugate, { forms: [1, 2, 3, 4, 5, 6] }],
      [t.conjugate, { forms: null }],
      [t.conjugate, 'x'],
      [speaking, { itemId: 'a' }],
    ] as const) {
      expect((await t.run(id, ans)).status).toBe(400);
    }
    expect(await attemptsOf(t.student)).toBe(0);
  });

  it('invented, __proto__ and casing-variant itemIds: 400, nothing inserted, 0 XP', async () => {
    const t = await setup();
    for (const itemId of ['zzz', '__proto__', 'constructor', 'A', 'a ']) {
      const r = await t.run(t.classify, { itemId, bucketId: 'f' });
      expect(r.status).toBe(400);
    }
    expect(await attemptsOf(t.student)).toBe(0);
    expect(await xpOf(t.student)).toBe(0);
  });

  it('wrong answer reveals expected, pays nothing; conjugate has per-item feedback; part becomes in_progress', async () => {
    const t = await setup();
    const r = await t.run(t.classify, { itemId: 'a', bucketId: 'm' });
    expect(r.json).toMatchObject({ correct: false, expected: 'f', xpAwarded: 0 });
    const bad = [...FORMS];
    bad[5] = 'работаут';
    const c = await t.run(t.conjugate, { forms: bad });
    expect(c.json.perItem).toEqual([true, true, true, true, true, false]);
    expect(c.json.expected).toEqual(FORMS);
    const rows = await sql('select status from public.part_progress where student_id=$1 and lesson_part_id=$2', [t.student, t.lesson.part1]);
    expect(rows.map((x) => x.status)).toEqual(['in_progress']);
  });

  it('retry after wrong pays 5, later correct attempts on the same ref pay 0', async () => {
    const t = await setup();
    await t.run(t.classify, { itemId: 'a', bucketId: 'm' });
    const first = await t.run(t.classify, { itemId: 'a', bucketId: 'f' });
    expect(first.json).toMatchObject({ correct: true, xpAwarded: 5 });
    expect(first.json.expected).toBeUndefined();
    expect((await t.run(t.classify, { itemId: 'a', bucketId: 'f' })).json.xpAwarded).toBe(0);
    expect((await t.run(t.classify, { itemId: 'a', bucketId: 'f' })).json.xpAwarded).toBe(0);
    const rows = await sql(`select amount from public.xp_events where student_id=$1 and reason='exercise_correct' and ref_id=$2`, [
      t.student,
      `${t.classify}:a`,
    ]);
    expect(rows.map((r) => r.amount)).toEqual([5]);
  });

  it('first-try correct pays 10; refs are per item', async () => {
    const t = await setup();
    expect((await t.run(t.classify, { itemId: 'b', bucketId: 'm' })).json).toMatchObject({ correct: true, xpAwarded: 10 });
    expect(await sql(`select 1 from public.xp_events where ref_id = $1`, [`${t.classify}:b`])).toHaveLength(1);
  });

  it('concurrent double-submit of the same first correct answer pays once', async () => {
    const t = await setup();
    const [r1, r2] = await Promise.all([
      t.run(t.classify, { itemId: 'a', bucketId: 'f' }),
      t.run(t.classify, { itemId: 'a', bucketId: 'f' }),
    ]);
    expect(Number(r1.json.xpAwarded) + Number(r2.json.xpAwarded)).toBe(10);
    expect(await xpOf(t.student)).toBe(10);
  });

  it('a failed award_xp is self-healing: the next correct attempt still pays', async () => {
    const t = await setup();
    const store = pgStore(t.student);
    const flaky: AttemptStore = {
      ...store,
      awardXp: () => Promise.reject(new Error('boom')),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await t.run(t.classify, { itemId: 'a', bucketId: 'f' }, t.student, flaky);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('boom'); // only the error class is logged
    spy.mockRestore();
    expect(await attemptsOf(t.student)).toBe(1); // the attempt row did commit
    expect(await xpOf(t.student)).toBe(0);
    const retry = await t.run(t.classify, { itemId: 'a', bucketId: 'f' });
    expect(retry.json).toMatchObject({ correct: true, xpAwarded: 5 });
    expect(await xpOf(t.student)).toBe(5);
  });

  it('part completes only when all items are correct; pays 20 exactly once', async () => {
    const t = await setup();
    await t.run(t.classify, { itemId: 'a', bucketId: 'f' });
    await t.run(t.classify, { itemId: 'b', bucketId: 'm' });
    const status = async () =>
      (await sql('select status from public.part_progress where student_id=$1 and lesson_part_id=$2', [t.student, t.lesson.part1]))[0].status;
    expect(await status()).toBe('in_progress');
    const r = await t.run(t.conjugate, { forms: [...FORMS] });
    expect(r.json).toMatchObject({ correct: true, xpAwarded: 30, partCompleted: true });
    expect(await status()).toBe('completed');
    const again = await t.run(t.conjugate, { forms: [...FORMS] });
    expect(again.json).toMatchObject({ correct: true, xpAwarded: 0 });
    expect(again.json.partCompleted).toBeUndefined();
    const parts = await sql(`select amount from public.xp_events where student_id=$1 and reason='part_completed' and ref_id=$2`, [
      t.student,
      t.lesson.part1,
    ]);
    expect(parts.map((p) => p.amount)).toEqual([20]);
    expect(await completePart(pgStore(t.student), t.student, t.lesson.part1)).toEqual({
      completed: true,
      newlyCompleted: false,
      xpAwarded: 0,
    });
  });

  it('review parts complete when completePart is called after the last submission', async () => {
    const t = await setup();
    const store = pgStore(t.student);
    const fill = await createExercise(await createBlock(t.lesson.part2, 1, true), { type: 'fill_blank', answer: { x: ['привет'] } });
    const speaking = await createExercise(await createBlock(t.lesson.part2, 2, true, 'speaking'), {
      type: 'speaking',
      checkMode: 'review',
      answer: {},
    });
    const r = await t.run(fill, { itemId: 'x', value: ' ПРИВЕТ. ' });
    expect(r.json).toMatchObject({ correct: true, xpAwarded: 10 });
    expect(r.json.partCompleted).toBeUndefined();
    expect((await completePart(store, t.student, t.lesson.part2)).completed).toBe(false);
    await sql(
      `insert into public.submissions (student_id, exercise_id, curator_group_id, kind, text_answer)
       values ($1, $2, $3, 'text', 'privet')`,
      [t.student, speaking, t.world.group],
    );
    expect(await completePart(store, t.student, t.lesson.part2)).toEqual({ completed: true, newlyCompleted: true, xpAwarded: 20 });
    expect((await completePart(store, t.student, t.lesson.part2)).xpAwarded).toBe(0);
  });

  it('the answer key never appears in a correct or invalid response', async () => {
    const t = await setup();
    const ex = await createExercise(await createBlock(t.lesson.part2, 1, true), {
      type: 'fill_blank',
      answer: { x: ['ответсекрет', 'вариантдва'] },
    });
    const ok = await t.run(ex, { itemId: 'x', value: 'вариантдва' });
    expect(ok.json.correct).toBe(true);
    const text = JSON.stringify(ok);
    for (const secret of ['ответсекрет', 'вариантдва', 'expected']) expect(text).not.toContain(secret);
    expect(JSON.stringify(await t.run(ex, { itemId: 5 }))).not.toContain('ответсекрет');
    expect(await withUser(t.student, (q) => q('select answer from public.exercise_keys'))).toEqual([]);
  });
});

describe('request body cap', () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request('http://x.test/api/attempts', { method: 'POST', body, headers });
  it('accepts small JSON, rejects bad JSON (400) and oversized bodies (413)', async () => {
    expect(await readJsonBody(req('{"a":1}'))).toEqual({ ok: true, body: { a: 1 } });
    expect(await readJsonBody(req('{nope'))).toEqual({ ok: false, status: 400 });
    expect(await readJsonBody(req(JSON.stringify({ x: 'y'.repeat(17 * 1024) })))).toEqual({ ok: false, status: 413 });
    expect(await readJsonBody(req('{}', { 'content-length': '999999' }))).toEqual({ ok: false, status: 413 });
  });
});

describe('supabase adapter RPC wiring (stub client)', () => {
  it('reads attempt aggregates through the SQL functions, not row fetches', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const service = {
      rpc: (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return Promise.resolve({
          data: fn === 'attempt_stats' ? [{ total: '1500', correct: 3 }] : [{ exercise_id: 'e1', item_id: null }, { exercise_id: 'e2', item_id: 'a' }],
          error: null,
        });
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = createSupabaseAttemptStore({} as any, service as any);
    expect(await store.countPriorAttempts('s', 'e', 'a')).toEqual({ total: 1500, correct: 3 });
    expect(await store.getCorrectRefs('s', 'p')).toEqual([
      { exerciseId: 'e1', itemId: null },
      { exerciseId: 'e2', itemId: 'a' },
    ]);
    expect(calls).toEqual([
      { fn: 'attempt_stats', args: { p_student: 's', p_exercise: 'e', p_item: 'a' } },
      { fn: 'correct_refs', args: { p_student: 's', p_part: 'p' } },
    ]);
  });
});
