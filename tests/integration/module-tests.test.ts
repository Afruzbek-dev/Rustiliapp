import { describe, expect, it } from 'vitest';
import {
  finishTest,
  loadTestView,
  saveTestAnswer,
  startTest,
  TestError,
  type AttemptRow,
  type TestInfo,
  type TestItemRow,
  type TestStore,
} from '@/server/tests';
import { sql, withUser } from '../db/helpers';
import { createActiveStudent, createCourseWorld, createLesson } from '../db/fixtures';
import { asServiceCommitted } from './pg-store';

// TestStore backed by the local Postgres: user-scoped reads run as `authenticated` (RLS decides),
// everything else as `service_role` and COMMITS, so the real 0018 SQL functions are exercised by the
// real TypeScript flow (grading, deadline, idempotency, XP).
function pgTestStore(student: string, path: 'locked' | 'available' = 'available'): TestStore {
  const toAttempt = (r: Record<string, unknown>): AttemptRow & { testId: string } => ({
    id: r.id as string,
    testId: r.test_id as string,
    startedAt: new Date(r.started_at as string).toISOString(),
    deadline: r.deadline ? new Date(r.deadline as string).toISOString() : null,
    finishedAt: r.finished_at ? new Date(r.finished_at as string).toISOString() : null,
    score: r.score === null ? null : Number(r.score),
    passed: r.passed as boolean | null,
    correct: r.correct_count as number | null,
    total: r.total_count as number | null,
    timedOut: r.timed_out as boolean,
    itemResults: r.item_results as AttemptRow['itemResults'],
  });
  return {
    async getTest(testId): Promise<TestInfo | null> {
      const rows = await withUser(student, (q) =>
        q('select id, course_id, title, time_limit_min, pass_score, max_attempts, published from public.tests where id = $1', [testId]),
      );
      const t = rows[0];
      if (!t || !t.published) return null;
      return { id: t.id, courseId: t.course_id, title: t.title, timeLimitMin: t.time_limit_min, passScore: t.pass_score === null ? null : Number(t.pass_score), maxAttempts: t.max_attempts };
    },
    pathStatus: async () => path,
    async getItems(testId): Promise<TestItemRow[]> {
      const rows = await withUser(student, (q) =>
        q(
          `select i.exercise_id, i.section, i.position, i.lesson_id, e.type, e.prompt, e.payload
             from public.test_items i join public.exercises e on e.id = i.exercise_id where i.test_id = $1 order by i.position`,
          [testId],
        ),
      );
      return rows.map((r) => ({ exerciseId: r.exercise_id, section: r.section, position: r.position, lessonId: r.lesson_id, type: r.type, prompt: r.prompt, payload: r.payload }));
    },
    listAttempts: (s, testId) =>
      asServiceCommitted(async (q) =>
        (await q('select * from public.test_attempts where student_id = $1 and test_id = $2 order by started_at desc', [s, testId])).map(toAttempt),
      ),
    getAttempt: (s, attemptId) =>
      asServiceCommitted(async (q) => {
        const r = (await q('select * from public.test_attempts where id = $1 and student_id = $2', [attemptId, s]))[0];
        return r ? toAttempt(r) : null;
      }),
    getAnswers: (attemptId) =>
      asServiceCommitted(async (q) =>
        Object.fromEntries((await q('select exercise_id, answer from public.test_attempt_answers where attempt_id = $1', [attemptId])).map((r) => [r.exercise_id, r.answer])),
      ),
    startAttempt: (s, testId) =>
      asServiceCommitted(async (q) => {
        const r = (await q('select * from public.test_start_attempt($1,$2)', [s, testId]))[0];
        return { outcome: r.outcome, attemptId: r.attempt_id };
      }),
    saveAnswer: (s, attemptId, exerciseId, answer) =>
      asServiceCommitted(async (q) => (await q('select public.test_save_answer($1,$2,$3,$4) as o', [s, attemptId, exerciseId, JSON.stringify(answer)]))[0].o),
    getKeys: (ids) =>
      asServiceCommitted(async (q) => Object.fromEntries((await q('select exercise_id, answer from public.exercise_keys where exercise_id = any($1)', [ids])).map((r) => [r.exercise_id, r.answer]))),
    finishAttempt: (s, attemptId, g) =>
      asServiceCommitted(async (q) => {
        const r = (
          await q('select * from public.test_finish_attempt($1,$2,$3,$4,$5,$6,$7)', [s, attemptId, g.score, g.correct, g.total, JSON.stringify(g.sectionScores), JSON.stringify(g.itemResults)])
        )[0];
        return { outcome: r.outcome, score: Number(r.score), passed: r.passed, timedOut: r.timed_out };
      }),
    async getLessons(ids) {
      const rows = await sql('select id, title, position from public.lessons where id = any($1)', [ids]);
      return rows.map((r) => ({ id: r.id, title: r.title, order: r.position }));
    },
  };
}

async function setup(opts: { max?: number; limit?: number | null } = {}) {
  const w = await createCourseWorld();
  const lesson = await createLesson(w.course);
  const [{ test_editor_create: testId }] = await sql('select public.test_editor_create($1,$2,$3,$4)', [w.teacher, w.course, lesson.module, 'Modul testi']);
  await sql('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [w.teacher, testId, 'Modul testi', 60, opts.limit === undefined ? 30 : opts.limit, opts.max ?? 1]);
  const add = async (section: string, ex: unknown) =>
    (await sql('select public.test_editor_add_item($1,$2,$3,$4,$5) as id', [w.teacher, testId, section, lesson.lesson, JSON.stringify(ex)]))[0].id as string;
  const e1 = await add('vocab', {
    type: 'classify', prompt: 'Rodni belgilang',
    payload: { items: [{ id: 'it_a1', text: 'книга' }, { id: 'it_b2', text: 'стол' }], buckets: [{ id: 'bk_z9', label: 'ж.р' }, { id: 'bk_y8', label: 'м.р' }] },
    key: { it_a1: 'bk_z9', it_b2: 'bk_y8' },
  });
  const e2 = await add('grammar', {
    type: 'choose', prompt: 'Tanlang',
    payload: { items: [{ id: 'q1', text: 'Я ... читать', options: ['могу', 'умею'] }] },
    key: { q1: 0 },
  });
  await sql('select public.test_editor_set_published($1,$2,true)', [w.teacher, testId]);
  const student = await createActiveStudent(w.cohort, w.group);
  return { w, lesson, testId: testId as string, e1, e2, student, store: pgTestStore(student) };
}

const GOOD1 = { answers: { it_a1: 'bk_z9', it_b2: 'bk_y8' } };
const GOOD2 = { answers: { q1: 0 } };
const xp = async (s: string) => (await sql(`select amount from public.xp_events where student_id = $1 and reason = 'test_completed'`, [s])).map((r) => r.amount);

describe('module test flow against the real SQL functions', () => {
  it('start -> answer -> finish: graded on the server, XP once, result only after finish', async () => {
    const t = await setup();
    const intro = await loadTestView(t.store, t.student, t.testId);
    expect(intro).toMatchObject({ kind: 'intro', itemCount: 2 });

    const { attemptId } = await startTest(t.store, t.student, t.testId);
    expect(await saveTestAnswer(t.store, t.student, { attemptId, exerciseId: t.e1, answer: GOOD1 })).toBe('saved');
    const active = await loadTestView(t.store, t.student, t.testId);
    expect(active).toMatchObject({ kind: 'active', attemptId });
    expect(JSON.stringify(active)).not.toMatch(/"(key|expected|score)"/);

    const r = await finishTest(t.store, t.student, { attemptId, answers: { [t.e2]: { answers: { q1: 1 } } } });
    expect(r).toMatchObject({ correct: 2, total: 3, wrong: 1, score: 66.67, passed: true, xp: 133, answersRevealed: true });
    expect(await xp(t.student)).toEqual([133]);
    expect(r.review[0].lines[0]).toMatchObject({ yours: 'умею', expected: 'могу' });

    const again = await finishTest(t.store, t.student, { attemptId, answers: { [t.e2]: GOOD2 } });
    expect(again).toEqual(r);
    expect(await xp(t.student)).toEqual([133]);
    expect((await sql('select count(*)::int as c from public.test_attempts where student_id=$1', [t.student]))[0].c).toBe(1);
  });

  it('a second attempt is refused after the limit; a failed first attempt hides the answers while a retake exists', async () => {
    const one = await setup({ max: 1 });
    const a = await startTest(one.store, one.student, one.testId);
    await finishTest(one.store, one.student, { attemptId: a.attemptId });
    await expect(startTest(one.store, one.student, one.testId)).rejects.toMatchObject({ code: 'limit' });

    const two = await setup({ max: 2 });
    const b = await startTest(two.store, two.student, two.testId);
    const failed = await finishTest(two.store, two.student, { attemptId: b.attemptId });
    expect(failed).toMatchObject({ passed: false, answersRevealed: false, canRetake: true, attemptsLeft: 1, xp: 0 });
    expect(JSON.stringify(failed.review)).not.toContain('могу');
    expect(await xp(two.student)).toEqual([]);
    const c = await startTest(two.store, two.student, two.testId);
    expect(c.attemptId).not.toBe(b.attemptId);
  });

  it('the time limit is enforced by the server: late saves refused, expired attempt auto-graded on open', async () => {
    const t = await setup({ limit: 10 });
    const { attemptId } = await startTest(t.store, t.student, t.testId);
    await saveTestAnswer(t.store, t.student, { attemptId, exerciseId: t.e1, answer: { answers: { it_a1: 'bk_z9' } } });
    await sql(`update public.test_attempts set deadline = now() - interval '1 minute' where id = $1`, [attemptId]);
    expect(await saveTestAnswer(t.store, t.student, { attemptId, exerciseId: t.e2, answer: GOOD2 })).toBe('expired');
    const done = (await sql('select finished_at, timed_out, correct_count, total_count, passed from public.test_attempts where id=$1', [attemptId]))[0];
    expect(done).toMatchObject({ timed_out: true, correct_count: 1, total_count: 3, passed: false });
    expect(done.finished_at).not.toBeNull();

    const t2 = await setup({ limit: 10 });
    const a2 = await startTest(t2.store, t2.student, t2.testId);
    await saveTestAnswer(t2.store, t2.student, { attemptId: a2.attemptId, exerciseId: t2.e1, answer: GOOD1 });
    await sql(`update public.test_attempts set deadline = now() - interval '5 minutes' where id = $1`, [a2.attemptId]);
    const view = await loadTestView(t2.store, t2.student, t2.testId);
    expect(view).toMatchObject({ kind: 'result', result: { timedOut: true, correct: 2, total: 3 } });
  });

  it('locked test, other students and other courses', async () => {
    const t = await setup();
    const locked = pgTestStore(t.student, 'locked');
    await expect(startTest(locked, t.student, t.testId)).rejects.toMatchObject({ code: 'locked' });
    expect(await loadTestView(locked, t.student, t.testId)).toMatchObject({ kind: 'locked' });

    const { attemptId } = await startTest(t.store, t.student, t.testId);
    const other = await createActiveStudent(t.w.cohort, t.w.group);
    const otherStore = pgTestStore(other);
    await expect(saveTestAnswer(otherStore, other, { attemptId, exerciseId: t.e1, answer: GOOD1 })).rejects.toBeInstanceOf(TestError);
    await expect(finishTest(otherStore, other, { attemptId })).rejects.toMatchObject({ code: 'not_found' });

    const outsiderWorld = await createCourseWorld();
    const outsider = await createActiveStudent(outsiderWorld.cohort, outsiderWorld.group);
    expect(await loadTestView(pgTestStore(outsider), outsider, t.testId)).toBeNull();
    await expect(startTest(pgTestStore(outsider), outsider, t.testId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('students cannot read keys or other attempts through their own client', async () => {
    const t = await setup();
    await startTest(t.store, t.student, t.testId);
    expect(await withUser(t.student, (q) => q('select * from public.exercise_keys where exercise_id = any($1)', [[t.e1, t.e2]]))).toHaveLength(0);
    expect(await withUser(t.student, (q) => q('select id from public.test_attempts where test_id = $1', [t.testId]))).toHaveLength(1);
    const peer = await createActiveStudent(t.w.cohort, t.w.group);
    expect(await withUser(peer, (q) => q('select id from public.test_attempts where test_id = $1', [t.testId]))).toHaveLength(0);
  });
});
