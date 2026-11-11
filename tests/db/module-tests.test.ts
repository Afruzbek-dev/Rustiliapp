import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createActiveStudent, createCourseWorld, createLesson, createProfile } from './fixtures';

const rejects = async (p: Promise<unknown>, re: RegExp) => {
  await expect(p).rejects.toThrow(re);
};

const classify = (n: number) => ({
  type: 'classify',
  prompt: `Guruhlang ${n}`,
  payload: {
    items: [{ id: `i${n}a`, text: 'книга' }, { id: `i${n}b`, text: 'стол' }],
    buckets: [{ id: `b${n}x`, label: 'ж.р' }, { id: `b${n}y`, label: 'м.р' }],
  },
  key: { [`i${n}a`]: `b${n}x`, [`i${n}b`]: `b${n}y` },
});

type World = Awaited<ReturnType<typeof createCourseWorld>>;

/** Superuser helper: calls a SQL function and returns its rows (fixtures only). */
const call = <R extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[]) =>
  sql<R>(text, params);

async function makeTest(w: World, opts: { items?: number; publish?: boolean; max?: number; limit?: number | null; pass?: number } = {}) {
  const lesson = await createLesson(w.course);
  const [{ test_editor_create: testId }] = await call<{ test_editor_create: string }>(
    'select public.test_editor_create($1, $2, $3, $4)',
    [w.teacher, w.course, lesson.module, 'Test 1'],
  );
  await call('select public.test_editor_update($1, $2, $3, $4, $5, $6)', [
    w.teacher, testId, 'Test 1', opts.pass ?? 60, opts.limit === undefined ? null : opts.limit, opts.max ?? 1,
  ]);
  const exercises: string[] = [];
  for (let i = 0; i < (opts.items ?? 2); i++) {
    const [{ test_editor_add_item: ex }] = await call<{ test_editor_add_item: string }>(
      'select public.test_editor_add_item($1, $2, $3, $4, $5)',
      [w.teacher, testId, 'grammar', lesson.lesson, JSON.stringify(classify(i))],
    );
    exercises.push(ex);
  }
  if (opts.publish !== false) await call('select public.test_editor_set_published($1, $2, true)', [w.teacher, testId]);
  return { testId, lesson, exercises };
}

const start = async (student: string, test: string) =>
  (await call<{ outcome: string; attempt_id: string | null; deadline: string | null }>(
    'select * from public.test_start_attempt($1, $2)',
    [student, test],
  ))[0];
const finish = async (student: string, attempt: string, score: number, correct: number, total: number) =>
  (await call<{ outcome: string; score: string; passed: boolean; timed_out: boolean; xp_awarded: number }>(
    `select * from public.test_finish_attempt($1, $2, $3, $4, $5, '{"grammar":50}'::jsonb, '{}'::jsonb)`,
    [student, attempt, score, correct, total],
  ))[0];

describe('0018 module tests', () => {
  let A: World;
  let B: World;
  let admin: string;

  beforeAll(async () => {
    A = await createCourseWorld();
    B = await createCourseWorld();
    admin = await createProfile('admin');
  });

  describe('student attempt lifecycle', () => {
    it('starts once, resumes, saves answers and finishes idempotently with XP once', async () => {
      const t = await makeTest(A, { limit: 30 });
      const s = await createActiveStudent(A.cohort, A.group);
      const first = await start(s, t.testId);
      expect(first.outcome).toBe('started');
      expect(first.deadline).not.toBeNull();
      const again = await start(s, t.testId);
      expect(again.outcome).toBe('resumed');
      expect(again.attempt_id).toBe(first.attempt_id);
      expect(await sql('select 1 from public.test_attempts where student_id=$1 and test_id=$2', [s, t.testId])).toHaveLength(1);

      const [{ test_save_answer: r1 }] = await call('select public.test_save_answer($1,$2,$3,$4)', [
        s, first.attempt_id, t.exercises[0], JSON.stringify({ answers: { i0a: 'b0x' } }),
      ]);
      expect(r1).toBe('ok');
      await call('select public.test_save_answer($1,$2,$3,$4)', [s, first.attempt_id, t.exercises[0], JSON.stringify({ answers: { i0a: 'b0y' } })]);
      const stored = await sql('select answer from public.test_attempt_answers where attempt_id=$1', [first.attempt_id]);
      expect(stored).toHaveLength(1);
      expect(stored[0].answer).toEqual({ answers: { i0a: 'b0y' } });

      const f1 = await finish(s, first.attempt_id!, 75, 3, 4);
      expect(f1).toMatchObject({ outcome: 'finished', passed: true, timed_out: false, xp_awarded: 150 });
      // double submit: unchanged, no second payout, different numbers ignored
      const f2 = await finish(s, first.attempt_id!, 10, 1, 4);
      expect(f2).toMatchObject({ outcome: 'already', passed: true, xp_awarded: 0 });
      expect(Number(f2.score)).toBe(75);
      const xp = await sql(`select amount from public.xp_events where student_id=$1 and reason='test_completed'`, [s]);
      expect(xp).toEqual([{ amount: 150 }]);
      // after finish no more answers, and no retake after a pass
      const [{ test_save_answer: r3 }] = await call('select public.test_save_answer($1,$2,$3,$4)', [s, first.attempt_id, t.exercises[0], '{"answers":{}}']);
      expect(r3).toBe('finished');
      expect((await start(s, t.testId)).outcome).toBe('passed');
    });

    it('enforces the retake limit and pays XP only for a pass', async () => {
      const t = await makeTest(A, { max: 2 });
      const s = await createActiveStudent(A.cohort, A.group);
      const a1 = await start(s, t.testId);
      expect(await finish(s, a1.attempt_id!, 25, 1, 4)).toMatchObject({ passed: false, xp_awarded: 0 });
      expect(await sql(`select 1 from public.xp_events where student_id=$1 and reason='test_completed'`, [s])).toHaveLength(0);
      const a2 = await start(s, t.testId);
      expect(a2.outcome).toBe('started');
      expect(a2.attempt_id).not.toBe(a1.attempt_id);
      await finish(s, a2.attempt_id!, 50, 2, 4);
      expect((await start(s, t.testId)).outcome).toBe('limit');
      expect(await sql('select 1 from public.test_attempts where student_id=$1 and test_id=$2', [s, t.testId])).toHaveLength(2);
    });

    it('enforces the time limit on the server (expired start, late save, timed_out finish)', async () => {
      const t = await makeTest(A, { limit: 10 });
      const s = await createActiveStudent(A.cohort, A.group);
      const a = await start(s, t.testId);
      // 5 seconds late: still inside the grace window
      await sql(`update public.test_attempts set deadline = now() - interval '5 seconds' where id=$1`, [a.attempt_id]);
      const [{ test_save_answer: inGrace }] = await call('select public.test_save_answer($1,$2,$3,$4)', [s, a.attempt_id, t.exercises[0], '{"answers":{}}']);
      expect(inGrace).toBe('ok');
      expect((await start(s, t.testId)).outcome).toBe('expired');
      await sql(`update public.test_attempts set deadline = now() - interval '2 minutes' where id=$1`, [a.attempt_id]);
      const [{ test_save_answer: late }] = await call('select public.test_save_answer($1,$2,$3,$4)', [s, a.attempt_id, t.exercises[0], '{"answers":{"i0a":"b0x"}}']);
      expect(late).toBe('expired');
      expect((await sql('select answer from public.test_attempt_answers where attempt_id=$1', [a.attempt_id]))[0].answer).toEqual({ answers: {} });
      expect(await finish(s, a.attempt_id!, 0, 0, 4)).toMatchObject({ outcome: 'finished', timed_out: true, passed: false });
    });

    it('refuses foreign attempts, non-items, invalid results, unenrolled / unpublished / unknown tests', async () => {
      const t = await makeTest(A);
      const s = await createActiveStudent(A.cohort, A.group);
      const other = await createActiveStudent(A.cohort, A.group);
      const a = await start(s, t.testId);
      await rejects(call('select public.test_save_answer($1,$2,$3,$4)', [other, a.attempt_id, t.exercises[0], '{"answers":{}}']), /forbidden/);
      await rejects(finish(other, a.attempt_id!, 100, 4, 4), /forbidden/);
      await rejects(call('select public.test_save_answer($1,$2,$3,$4)', [s, a.attempt_id, A.course, '{}']), /not a test item/);
      await rejects(finish(s, a.attempt_id!, 140, 4, 4), /invalid result/);
      await rejects(finish(s, a.attempt_id!, 50, 5, 4), /invalid result/);

      const outsider = await createActiveStudent(B.cohort, B.group);
      await rejects(start(outsider, t.testId), /forbidden/);
      const pending = await createProfile('student');
      await rejects(start(pending, t.testId), /forbidden/);
      const draft = await makeTest(A, { publish: false });
      await rejects(start(s, draft.testId), /forbidden/);
      await rejects(start(s, A.course), /forbidden/);
      // staff accounts cannot take tests
      await rejects(start(A.teacher, t.testId), /forbidden/);
    });

    it('allows at most one active attempt per student and test (index)', async () => {
      const t = await makeTest(A);
      const s = await createActiveStudent(A.cohort, A.group);
      await start(s, t.testId);
      await rejects(sql('insert into public.test_attempts (student_id, test_id) values ($1,$2)', [s, t.testId]), /duplicate key/);
    });
  });

  describe('role switching', () => {
    it('API roles cannot call the student / editor functions', async () => {
      const t = await makeTest(A);
      const s = await createActiveStudent(A.cohort, A.group);
      const a = await start(s, t.testId);
      const calls: [string, unknown[]][] = [
        ['select * from public.test_start_attempt($1,$2)', [s, t.testId]],
        ['select public.test_save_answer($1,$2,$3,$4)', [s, a.attempt_id, t.exercises[0], '{}']],
        ["select * from public.test_finish_attempt($1,$2,50,1,2,'{}'::jsonb,'{}'::jsonb)", [s, a.attempt_id]],
        ['select public.test_editor_set_published($1,$2,false)', [A.teacher, t.testId]],
        ['select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, t.testId, 'x', 50, null, 1]],
      ];
      for (const [text, params] of calls) {
        await rejects(withUser(s, (q) => q(text, params)), /permission denied/);
        await rejects(withUser(A.teacher, (q) => q(text, params)), /permission denied/);
        await rejects(withUser(null, (q) => q(text, params)), /permission denied/);
      }
      // service role may
      await asService((q) => q('select * from public.test_start_attempt($1,$2)', [s, t.testId]));
    });

    it('a student sees only their own attempts and never answers or keys', async () => {
      const t = await makeTest(A);
      const s1 = await createActiveStudent(A.cohort, A.group);
      const s2 = await createActiveStudent(A.cohort, A.group);
      const a1 = await start(s1, t.testId);
      await start(s2, t.testId);
      await call('select public.test_save_answer($1,$2,$3,$4)', [s1, a1.attempt_id, t.exercises[0], '{"answers":{"i0a":"b0x"}}']);

      const own = await withUser(s1, (q) => q('select student_id from public.test_attempts where test_id=$1', [t.testId]));
      expect(own).toEqual([{ student_id: s1 }]);
      expect(await withUser(s2, (q) => q('select id from public.test_attempts where id=$1', [a1.attempt_id]))).toHaveLength(0);
      await rejects(withUser(s1, (q) => q('select * from public.test_attempt_answers')), /permission denied/);
      expect(await withUser(s1, (q) => q('select * from public.exercise_keys where exercise_id = any($1)', [t.exercises]))).toHaveLength(0);
      await rejects(
        withUser(s1, (q) => q(`update public.test_attempts set score = 100, passed = true where id=$1`, [a1.attempt_id])),
        /permission denied/,
      );
      await rejects(withUser(s1, (q) => q(`insert into public.test_attempts (student_id, test_id) values ($1,$2)`, [s1, t.testId])), /permission denied/);
      // the teacher of the course reads attempts; a foreign teacher does not
      expect((await withUser(A.teacher, (q) => q('select id from public.test_attempts where test_id=$1', [t.testId]))).length).toBe(2);
      expect(await withUser(B.teacher, (q) => q('select id from public.test_attempts where test_id=$1', [t.testId]))).toHaveLength(0);
    });
  });

  describe('test_results', () => {
    it('lists best score and attempts for the course teacher and admin only', async () => {
      const t = await makeTest(A, { max: 3 });
      const s = await createActiveStudent(A.cohort, A.group, 'Aziza Karimova');
      const idle = await createActiveStudent(A.cohort, A.group, 'Bobur Ergashev');
      const a1 = await start(s, t.testId);
      await finish(s, a1.attempt_id!, 40, 2, 5);
      const a2 = await start(s, t.testId);
      await finish(s, a2.attempt_id!, 80, 4, 5);

      const rows = await withUser(A.teacher, (q) => q('select * from public.test_results($1)', [t.testId]));
      const row = rows.find((r) => r.student_id === s)!;
      expect(row).toMatchObject({ full_name: 'Aziza Karimova', attempts: 2, passed: true, in_progress: false });
      expect(Number(row.best_score)).toBe(80);
      const idleRow = rows.find((r) => r.student_id === idle)!;
      expect(idleRow).toMatchObject({ attempts: 0, best_score: null, passed: false });

      expect((await withUser(admin, (q) => q('select * from public.test_results($1)', [t.testId]))).length).toBe(rows.length);
      await rejects(withUser(B.teacher, (q) => q('select * from public.test_results($1)', [t.testId])), /forbidden/);
      await rejects(withUser(s, (q) => q('select * from public.test_results($1)', [t.testId])), /forbidden/);
      await rejects(withUser(null, (q) => q('select * from public.test_results($1)', [t.testId])), /permission denied/);
      await rejects(withUser(A.teacher, (q) => q('select * from public.test_results($1)', [A.course])), /forbidden/);
    });
  });

  describe('teacher editor functions', () => {
    it('denies a foreign teacher and a student, also for unknown ids', async () => {
      const t = await makeTest(A, { publish: false });
      const s = await createActiveStudent(A.cohort, A.group);
      for (const actor of [B.teacher, s]) {
        await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [actor, t.testId, 'x', 50, null, 1]), /forbidden/);
        await rejects(call('select public.test_editor_add_item($1,$2,$3,$4,$5)', [actor, t.testId, 'vocab', null, JSON.stringify(classify(9))]), /forbidden/);
        await rejects(call('select public.test_editor_remove_item($1,$2,$3)', [actor, t.testId, t.exercises[0]]), /forbidden/);
        await rejects(call('select public.test_editor_set_published($1,$2,true)', [actor, t.testId]), /forbidden/);
        await rejects(call('select public.test_editor_delete($1,$2)', [actor, t.testId]), /forbidden/);
      }
      await rejects(call('select public.test_editor_set_published($1,$2,true)', [A.teacher, A.course]), /forbidden/);
      const lesson = await createLesson(A.course);
      await rejects(call('select public.test_editor_create($1,$2,$3,$4)', [B.teacher, A.course, lesson.module, 'x']), /forbidden/);
      // module of another course
      const foreign = await createLesson(B.course);
      await rejects(call('select public.test_editor_create($1,$2,$3,$4)', [A.teacher, A.course, foreign.module, 'x']), /invalid module/);
      // admin may
      await call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [admin, t.testId, 'Admin edit', 70, 20, 2]);
      expect((await sql('select title, pass_score, time_limit_min, max_attempts from public.tests where id=$1', [t.testId]))[0]).toMatchObject({
        title: 'Admin edit', time_limit_min: 20, max_attempts: 2,
      });
    });

    it('allows one test per module', async () => {
      const t = await makeTest(A, { publish: false });
      const [{ after_module_id }] = await sql('select after_module_id from public.tests where id=$1', [t.testId]);
      await rejects(call('select public.test_editor_create($1,$2,$3,$4)', [A.teacher, A.course, after_module_id, 'Ikkinchi']), /duplicate key/);
    });

    it('rejects non-gradable types, missing keys and foreign lessons; items never hold a block', async () => {
      const t = await makeTest(A, { publish: false, items: 1 });
      const add = (ex: unknown, lesson: string | null = null) =>
        call('select public.test_editor_add_item($1,$2,$3,$4,$5)', [A.teacher, t.testId, 'grammar', lesson, JSON.stringify(ex)]);
      await rejects(add({ ...classify(5), type: 'open_text' }), /auto-gradable/);
      await rejects(add({ ...classify(5), type: 'speaking' }), /auto-gradable/);
      await rejects(add({ ...classify(5), key: {} }), /answer key required/);
      const noKey = classify(6) as Record<string, unknown>;
      delete noKey.key;
      await rejects(add(noKey), /answer key required/);
      const foreign = await createLesson(B.course);
      await rejects(add(classify(7), foreign.lesson), /invalid lesson/);
      await add(classify(8));
      const rows = await sql('select e.block_id, e.check_mode, e.xp from public.test_items i join public.exercises e on e.id=i.exercise_id where i.test_id=$1', [t.testId]);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.block_id === null && r.check_mode === 'auto')).toBe(true);
      // the key landed in exercise_keys, never in the payload
      const [ex] = await sql('select payload from public.exercises where id=$1', [t.exercises[0]]);
      expect(JSON.stringify(ex.payload)).not.toContain('"i0a":"b0x"');
      expect(ex.payload).not.toHaveProperty('key');
      const [k] = await sql('select answer from public.exercise_keys where exercise_id=$1', [t.exercises[0]]);
      expect(k.answer).toEqual({ i0a: 'b0x', i0b: 'b0y' });
    });

    it('validates publishing (module, pass score, items, keys, block exercises)', async () => {
      const empty = await makeTest(A, { publish: false, items: 0 });
      await rejects(call('select public.test_editor_set_published($1,$2,true)', [A.teacher, empty.testId]), /no items/);
      const noPass = await makeTest(A, { publish: false, items: 1 });
      await sql('update public.tests set pass_score = null where id=$1', [noPass.testId]);
      await rejects(call('select public.test_editor_set_published($1,$2,true)', [A.teacher, noPass.testId]), /pass score/);
      await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, noPass.testId, 'x', 101, null, 1]), /invalid test settings/);
      await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, noPass.testId, 'x', 0, null, 1]), /invalid test settings/);
      await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, noPass.testId, 'x', 50, 0, 1]), /invalid test settings/);
      await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, noPass.testId, 'x', 50, null, 0]), /invalid test settings/);

      const keyless = await makeTest(A, { publish: false, items: 1 });
      await sql('delete from public.exercise_keys where exercise_id=$1', [keyless.exercises[0]]);
      await rejects(call('select public.test_editor_set_published($1,$2,true)', [A.teacher, keyless.testId]), /test-owned auto-gradable/);

      const withBlock = await makeTest(A, { publish: false, items: 1 });
      const lesson = await createLesson(A.course);
      const [b] = await sql(`insert into public.blocks (lesson_part_id, position, type) values ($1, 1, 'exercise') returning id`, [lesson.part1]);
      const [e] = await sql(`insert into public.exercises (block_id, type, prompt, payload) values ($1,'classify','p','{}') returning id`, [b.id]);
      await sql(`insert into public.exercise_keys (exercise_id, answer) values ($1, '{"a":"b"}')`, [e.id]);
      await sql(`insert into public.test_items (test_id, exercise_id, section, position) values ($1,$2,'vocab',9)`, [withBlock.testId, e.id]);
      await rejects(call('select public.test_editor_set_published($1,$2,true)', [A.teacher, withBlock.testId]), /test-owned auto-gradable/);

      const ok = await makeTest(A, { items: 1 });
      expect((await sql('select published from public.tests where id=$1', [ok.testId]))[0].published).toBe(true);
      await call('select public.test_editor_set_published($1,$2,false)', [A.teacher, ok.testId]);
      expect((await sql('select published from public.tests where id=$1', [ok.testId]))[0].published).toBe(false);
      await call('select public.test_editor_set_published($1,$2,true)', [A.teacher, ok.testId]);
      await rejects(call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, ok.testId, 'x', null, null, 1]), /pass score/);
    });

    it('removes and reorders items and keeps positions contiguous', async () => {
      const t = await makeTest(A, { publish: false, items: 3 });
      const [x, y, z] = t.exercises;
      await call('select public.test_editor_reorder_items($1,$2,$3)', [A.teacher, t.testId, [z, x, y]]);
      const order = async () =>
        (await sql('select exercise_id from public.test_items where test_id=$1 order by position', [t.testId])).map((r) => r.exercise_id);
      expect(await order()).toEqual([z, x, y]);
      await rejects(call('select public.test_editor_reorder_items($1,$2,$3)', [A.teacher, t.testId, [z, x]]), /invalid order/);
      await rejects(call('select public.test_editor_reorder_items($1,$2,$3)', [A.teacher, t.testId, [z, x, x]]), /invalid order/);
      await call('select public.test_editor_remove_item($1,$2,$3)', [A.teacher, t.testId, x]);
      expect(await order()).toEqual([z, y]);
      expect((await sql('select position from public.test_items where test_id=$1 order by position', [t.testId])).map((r) => r.position)).toEqual([1, 2]);
      expect(await sql('select 1 from public.exercises where id=$1', [x])).toHaveLength(0);
      await rejects(call('select public.test_editor_remove_item($1,$2,$3)', [A.teacher, t.testId, x]), /forbidden/);
    });

    it('updates an item and freezes the structure once students have attempts', async () => {
      const t = await makeTest(A, { items: 2 });
      await call('select public.test_editor_update_item($1,$2,$3,$4,$5,$6)', [
        A.teacher, t.testId, t.exercises[0], 'reading', null, JSON.stringify({ ...classify(0), prompt: 'Yangi savol' }),
      ]);
      const [row] = await sql(
        'select i.section, i.lesson_id, e.prompt from public.test_items i join public.exercises e on e.id=i.exercise_id where i.test_id=$1 and i.exercise_id=$2',
        [t.testId, t.exercises[0]],
      );
      expect(row).toMatchObject({ section: 'reading', lesson_id: null, prompt: 'Yangi savol' });
      // an exercise of another test cannot be edited through this one
      const other = await makeTest(A, { items: 1, publish: false });
      await rejects(
        call('select public.test_editor_update_item($1,$2,$3,$4,$5,$6)', [A.teacher, t.testId, other.exercises[0], 'vocab', null, JSON.stringify(classify(0))]),
        /forbidden/,
      );

      const s = await createActiveStudent(A.cohort, A.group);
      await start(s, t.testId);
      await rejects(call('select public.test_editor_add_item($1,$2,$3,$4,$5)', [A.teacher, t.testId, 'vocab', null, JSON.stringify(classify(4))]), /has attempts/);
      await rejects(call('select public.test_editor_remove_item($1,$2,$3)', [A.teacher, t.testId, t.exercises[0]]), /has attempts/);
      await rejects(call('select public.test_editor_update_item($1,$2,$3,$4,$5,$6)', [A.teacher, t.testId, t.exercises[0], 'vocab', null, JSON.stringify(classify(0))]), /has attempts/);
      await rejects(call('select public.test_editor_delete($1,$2)', [A.teacher, t.testId]), /has attempts/);
      // settings and publishing stay possible
      await call('select public.test_editor_update($1,$2,$3,$4,$5,$6)', [A.teacher, t.testId, 'Test 1', 55, 45, 2]);
      await call('select public.test_editor_set_published($1,$2,false)', [A.teacher, t.testId]);
    });

    it('deletes an attempt-free test with its own exercises', async () => {
      const t = await makeTest(A, { publish: false, items: 2 });
      await call('select public.test_editor_delete($1,$2)', [A.teacher, t.testId]);
      expect(await sql('select 1 from public.tests where id=$1', [t.testId])).toHaveLength(0);
      expect(await sql('select 1 from public.exercises where id = any($1)', [t.exercises])).toHaveLength(0);
    });
  });

  describe('privileges', () => {
    it('API roles hold no write grants on the new table and cannot truncate', async () => {
      const grants = await sql(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema='public' and table_name='test_attempt_answers' and grantee in ('anon','authenticated')`,
      );
      expect(grants).toEqual([]);
      const trunc = await sql(
        `select 1 from information_schema.role_table_grants
          where table_schema='public' and table_name in ('test_attempts','tests','test_items') and grantee in ('anon','authenticated')
            and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')`,
      );
      expect(trunc).toEqual([]);
    });
  });
});
