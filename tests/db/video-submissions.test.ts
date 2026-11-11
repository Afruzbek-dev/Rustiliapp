import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createLesson } from './fixtures';

describe('0013 bot_sessions + create_video_submission + notification lease', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let exercise: string;
  let exercise2: string;
  let student: string;

  beforeAll(async () => {
    world = await createCourseWorld();
    const lesson = await createLesson(world.course);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    exercise = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });
    const block2 = await createBlock(lesson.part2, 2, true, 'speaking');
    exercise2 = await createExercise(block2, { type: 'speaking', checkMode: 'review', answer: {} });
    student = await createActiveStudent(world.cohort, world.group);
  });

  describe('bot_sessions', () => {
    it('is invisible and unwritable for API roles (RLS on, no policies, no grants)', async () => {
      const [{ relrowsecurity }] = await sql(`select relrowsecurity from pg_class where oid = 'public.bot_sessions'::regclass`);
      expect(relrowsecurity).toBe(true);
      await expect(withUser(student, (q) => q('select * from public.bot_sessions'))).rejects.toThrow(/permission denied/);
      await expect(withUser(null, (q) => q('select * from public.bot_sessions'))).rejects.toThrow(/permission denied/);
      await expect(
        withUser(student, (q) => q(`insert into public.bot_sessions (telegram_id, exercise_id, expires_at) values (1, $1, now())`, [exercise])),
      ).rejects.toThrow(/permission denied/);
    });

    it('service_role upserts one session per telegram id', async () => {
      const tg = 9_000_000_000 + Math.floor(Math.random() * 1e6);
      await asService(async (q) => {
        await q(`insert into public.bot_sessions (telegram_id, exercise_id, expires_at) values ($1, $2, now() + interval '30 minutes')`, [tg, exercise]);
        await q(
          `insert into public.bot_sessions (telegram_id, exercise_id, expires_at) values ($1, $2, now() + interval '30 minutes')
           on conflict (telegram_id) do update set exercise_id = excluded.exercise_id`,
          [tg, exercise2],
        );
        const rows = await q('select exercise_id from public.bot_sessions where telegram_id = $1', [tg]);
        expect(rows).toEqual([{ exercise_id: exercise2 }]);
      });
    });
  });

  describe('create_video_submission', () => {
    const call = (s: string, ex: string, uniq: string, group: string | null = world.group) =>
      sql(`select * from public.create_video_submission($1, $2, $3, 'FILE', $4, 555)`, [s, ex, group, uniq]);

    it('creates a pending video row with no storage_path, archive id and unique id', async () => {
      const s = await createActiveStudent(world.cohort, world.group);
      const u = randomUUID();
      const [r] = await call(s, exercise, u);
      expect(r.outcome).toBe('ok');
      const [row] = await sql('select * from public.submissions where id = $1', [r.submission_id]);
      expect(row).toMatchObject({
        kind: 'video', status: 'pending', storage_path: null, tg_file_id: 'FILE', tg_file_unique_id: u,
        tg_archive_message_id: '555', curator_group_id: world.group, notified_at: null,
      });
    });

    it('the same file again is a duplicate of the SAME row (no second submission)', async () => {
      const s = await createActiveStudent(world.cohort, world.group);
      const u = randomUUID();
      const [first] = await call(s, exercise, u);
      const [again] = await call(s, exercise, u);
      expect(again).toEqual({ submission_id: first.submission_id, outcome: 'duplicate' });
      const [{ n }] = await sql(`select count(*)::int n from public.submissions where tg_file_unique_id = $1`, [u]);
      expect(n).toBe(1);
    });

    it('the same file for another student or exercise is duplicate_other and never reveals the id', async () => {
      const a = await createActiveStudent(world.cohort, world.group);
      const b = await createActiveStudent(world.cohort, world.group);
      const u = randomUUID();
      await call(a, exercise, u);
      expect(await call(b, exercise, u)).toEqual([{ submission_id: null, outcome: 'duplicate_other' }]);
      expect(await call(a, exercise2, u)).toEqual([{ submission_id: null, outcome: 'duplicate_other' }]);
    });

    it('rate limit: 3 per exercise per 10 minutes, then rate_limited; other exercises and old rows unaffected', async () => {
      const s = await createActiveStudent(world.cohort, world.group);
      for (let i = 0; i < 3; i++) expect((await call(s, exercise, randomUUID()))[0].outcome).toBe('ok');
      expect(await call(s, exercise, randomUUID())).toEqual([{ submission_id: null, outcome: 'rate_limited' }]);
      expect((await call(s, exercise2, randomUUID()))[0].outcome).toBe('ok');
      await sql(`update public.submissions set created_at = now() - interval '11 minutes' where student_id = $1 and exercise_id = $2`, [s, exercise]);
      expect((await call(s, exercise, randomUUID()))[0].outcome).toBe('ok');
    });

    it('concurrency: 6 parallel calls with different files admit exactly 3', async () => {
      const s = await createActiveStudent(world.cohort, world.group);
      const res = await Promise.all(Array.from({ length: 6 }, () => call(s, exercise, randomUUID())));
      const outcomes = res.map((r) => r[0].outcome);
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3);
      expect(outcomes.filter((o) => o === 'rate_limited')).toHaveLength(3);
    });

    it('concurrency: the same file delivered 5 times in parallel creates one row', async () => {
      const s = await createActiveStudent(world.cohort, world.group);
      const u = randomUUID();
      const res = await Promise.all(Array.from({ length: 5 }, () => call(s, exercise, u)));
      const outcomes = res.map((r) => r[0].outcome).sort();
      expect(outcomes).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'ok']);
      expect(new Set(res.map((r) => r[0].submission_id)).size).toBe(1);
      const [{ n }] = await sql(`select count(*)::int n from public.submissions where tg_file_unique_id = $1`, [u]);
      expect(n).toBe(1);
    });

    it('the unique index rejects a direct duplicate insert', async () => {
      const u = randomUUID();
      await call(student, exercise2, u);
      await expect(
        sql(`insert into public.submissions (student_id, exercise_id, kind, tg_file_id, tg_file_unique_id) values ($1, $2, 'video', 'F', $3)`, [student, exercise2, u]),
      ).rejects.toThrow(/duplicate key/);
    });

    it('rejects empty file ids and is service_role only', async () => {
      await expect(sql(`select * from public.create_video_submission($1, $2, null, '', 'x', 1)`, [student, exercise])).rejects.toThrow(/file ids/);
      await expect(
        withUser(student, (q) => q(`select * from public.create_video_submission($1, $2, null, 'F', 'U', 1)`, [student, exercise])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUser(null, (q) => q(`select * from public.create_video_submission($1, $2, null, 'F', 'U', 1)`, [student, exercise])),
      ).rejects.toThrow(/permission denied/);
      await asService(async (q) => {
        const [r] = await q(`select * from public.create_video_submission($1, $2, null, 'F', $3, 1)`, [student, exercise2, randomUUID()]);
        expect(['ok', 'rate_limited']).toContain(r.outcome);
      });
    });
  });

  describe('claim_submission_notification (lease)', () => {
    async function videoRow() {
      const s = await createActiveStudent(world.cohort, world.group);
      const [r] = await sql(`select * from public.create_video_submission($1, $2, $3, 'F', $4, 1)`, [s, exercise, world.group, randomUUID()]);
      return { s, id: r.submission_id as string };
    }
    const claim = (id: string, s: string) => sql(`select public.claim_submission_notification($1, $2) as ok`, [id, s]).then((r) => r[0].ok as boolean);

    it('concurrency: 8 parallel claims -> exactly one true', async () => {
      const { s, id } = await videoRow();
      const results = await Promise.all(Array.from({ length: 8 }, () => claim(id, s)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('release lets a retry claim again; notified_at ends the lease for good', async () => {
      const { s, id } = await videoRow();
      expect(await claim(id, s)).toBe(true);
      expect(await claim(id, s)).toBe(false);
      await sql('select public.release_submission_notification($1)', [id]);
      expect(await claim(id, s)).toBe(true);
      await sql('update public.submissions set notified_at = now() where id = $1', [id]);
      await sql('select public.release_submission_notification($1)', [id]);
      expect(await claim(id, s)).toBe(false);
    });

    it('an expired lease (older than 2 minutes) can be re-claimed; a fresh one cannot', async () => {
      const { s, id } = await videoRow();
      await claim(id, s);
      await sql(`update public.submissions set notify_claimed_at = now() - interval '119 seconds' where id = $1`, [id]);
      expect(await claim(id, s)).toBe(false);
      await sql(`update public.submissions set notify_claimed_at = now() - interval '121 seconds' where id = $1`, [id]);
      expect(await claim(id, s)).toBe(true);
    });

    it("only the owner's completed submissions are claimable (foreign student, unfinished audio)", async () => {
      const { id } = await videoRow();
      const other = await createActiveStudent(world.cohort, world.group);
      expect(await claim(id, other)).toBe(false);
      const [audio] = await sql(`select * from public.create_audio_submission($1, $2, $3, 'webm')`, [student, exercise2, world.group]);
      expect(await claim(audio.submission_id, student)).toBe(false); // storage_path is null: unfinished upload
      await sql(`update public.submissions set storage_path = $2 where id = $1`, [audio.submission_id, `${student}/${audio.submission_id}.webm`]);
      expect(await claim(audio.submission_id, student)).toBe(true);
    });

    it('both functions are service_role only', async () => {
      const { s, id } = await videoRow();
      await expect(withUser(s, (q) => q('select public.claim_submission_notification($1, $2)', [id, s]))).rejects.toThrow(/permission denied/);
      await expect(withUser(s, (q) => q('select public.release_submission_notification($1)', [id]))).rejects.toThrow(/permission denied/);
      await asService(async (q) => {
        expect((await q('select public.claim_submission_notification($1, $2) as ok', [id, s]))[0].ok).toBe(true);
      });
    });
  });
});
