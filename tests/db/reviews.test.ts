import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createGroup, createLesson, createProfile } from './fixtures';

const S = { completeness: 5, pronunciation: 4, grammar: 4, fluency: 4 };

describe('0014 review helpers', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let exercise: string;
  let student: string;
  let otherCurator: string;
  let otherTeacher: string;
  let admin: string;
  let otherStudent: string;

  /** A completed submission in the world's group (video by default). */
  async function newSub(kind: 'video' | 'audio' = 'video', complete = true): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, storage_path, tg_file_id, tg_file_unique_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id, student, exercise, world.group, kind,
        kind === 'audio' && complete ? `${student}/${id}.webm` : null,
        kind === 'video' && complete ? 'FILE' : null,
        kind === 'video' ? id : null,
      ],
    );
    return id;
  }
  const review = (sub: string, reviewer: string, scores: unknown = S, channel = 'web', comment: string | null = 'ok', allow = false) =>
    sql(`select * from public.submit_review($1, $2, $3::public.review_channel, $4::jsonb, $5, $6)`, [sub, reviewer, channel, JSON.stringify(scores), comment, allow]).then((r) => r[0]);

  beforeAll(async () => {
    world = await createCourseWorld();
    const lesson = await createLesson(world.course);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    exercise = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });
    student = await createActiveStudent(world.cohort, world.group);
    otherStudent = await createProfile('student');
    otherCurator = await createProfile('curator');
    await createGroup(world.cohort, otherCurator);
    otherTeacher = await createProfile('teacher');
    admin = await createProfile('admin');
  });

  describe('review_authority', () => {
    it('curator of the group, course teacher and admin; nobody else', async () => {
      const sub = await newSub();
      const auth = (p: string) => sql(`select public.review_authority($1, $2) a`, [sub, p]).then((r) => r[0].a);
      expect(await auth(world.curator)).toBe('curator');
      expect(await auth(world.teacher)).toBe('staff');
      expect(await auth(admin)).toBe('staff');
      expect(await auth(otherCurator)).toBeNull();
      expect(await auth(otherTeacher)).toBeNull();
      expect(await auth(student)).toBeNull();
      expect(await auth(otherStudent)).toBeNull();
      expect(await auth(randomUUID())).toBeNull();
    });

    it('a student profile set as curator_id gains nothing (role must match)', async () => {
      const sneaky = await createProfile('student');
      const g = await createGroup(world.cohort, sneaky);
      const id = randomUUID();
      await sql(`insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, tg_file_id) values ($1,$2,$3,$4,'video','F')`, [id, student, exercise, g]);
      expect((await sql(`select public.review_authority($1, $2) a`, [id, sneaky]))[0].a).toBeNull();
    });
  });

  describe('submit_review', () => {
    it('curator first review: flips status, inserts the review, mean total, clears the draft', async () => {
      const sub = await newSub();
      await sql(`update public.submissions set draft_scores = '{"grammar": 2}' where id = $1`, [sub]);
      const r = await review(sub, world.curator, S, 'telegram', '  Yaxshi  ');
      expect(r).toMatchObject({ outcome: 'ok', is_override: false, student_id: student });
      expect(Number(r.total)).toBe(4.25);
      const [row] = await sql('select status, draft_scores from public.submissions where id = $1', [sub]);
      expect(row).toEqual({ status: 'reviewed', draft_scores: {} });
      const [rv] = await sql('select * from public.reviews where submission_id = $1', [sub]);
      expect(rv).toMatchObject({ reviewer_id: world.curator, channel: 'telegram', comment: 'Yaxshi', is_override: false, scores: S });
      expect(Number(rv.total)).toBe(4.25);
    });

    it('total rounds the mean to two decimals', async () => {
      const sub = await newSub();
      const r = await review(sub, world.curator, { completeness: 1, pronunciation: 1, grammar: 2, fluency: 2 });
      expect(Number(r.total)).toBe(1.5);
      const sub2 = await newSub();
      expect(Number((await review(sub2, world.curator, { completeness: 5, pronunciation: 5, grammar: 5, fluency: 4 })).total)).toBe(4.75);
    });

    it('second curator review is already_reviewed and inserts nothing', async () => {
      const sub = await newSub();
      await review(sub, world.curator);
      const again = await review(sub, world.curator, { ...S, grammar: 1 });
      expect(again.outcome).toBe('already_reviewed');
      expect(await sql('select 1 from public.reviews where submission_id = $1', [sub])).toHaveLength(1);
    });

    it('teacher/admin override: a new row with is_override, history kept, status unchanged', async () => {
      const sub = await newSub();
      await review(sub, world.curator);
      const o1 = await review(sub, world.teacher, { completeness: 2, pronunciation: 2, grammar: 2, fluency: 2 }, 'web', 'ok', true);
      const o2 = await review(sub, admin, { completeness: 3, pronunciation: 3, grammar: 3, fluency: 3 }, 'web', 'ok', true);
      expect([o1.outcome, o1.is_override, o2.is_override]).toEqual(['ok', true, true]);
      const rows = await sql('select is_override, reviewer_id from public.reviews where submission_id = $1 order by created_at, id', [sub]);
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => !r.is_override)).toHaveLength(1);
      expect((await sql('select status from public.submissions where id = $1', [sub]))[0].status).toBe('reviewed');
    });

    it('a teacher reviewing a pending submission is the first (non-override) review', async () => {
      const sub = await newSub();
      expect((await review(sub, world.teacher)).is_override).toBe(false);
    });

    it('forbidden / not_found / incomplete outcomes change nothing', async () => {
      const sub = await newSub();
      for (const who of [otherCurator, otherTeacher, student, otherStudent]) expect((await review(sub, who)).outcome).toBe('forbidden');
      expect((await review(randomUUID(), world.curator)).outcome).toBe('not_found');
      const unfinishedAudio = await newSub('audio', false);
      const noFileVideo = randomUUID();
      await sql(`insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind) values ($1,$2,$3,$4,'video')`, [noFileVideo, student, exercise, world.group]);
      expect((await review(unfinishedAudio, world.curator)).outcome).toBe('incomplete');
      expect((await review(noFileVideo, world.curator)).outcome).toBe('incomplete');
      for (const id of [sub, unfinishedAudio, noFileVideo]) {
        expect((await sql('select status from public.submissions where id = $1', [id]))[0].status).toBe('pending');
        expect(await sql('select 1 from public.reviews where submission_id = $1', [id])).toHaveLength(0);
      }
    });

    it('completed audio is reviewable', async () => {
      expect((await review(await newSub('audio'), world.curator)).outcome).toBe('ok');
    });

    it('rejects invalid scores (extra/missing key, out of range) without side effects', async () => {
      const sub = await newSub();
      for (const bad of [{ ...S, extra: 1 }, { completeness: 5, pronunciation: 4, grammar: 4 }, { ...S, fluency: 6 }, { ...S, fluency: 0 }, { ...S, fluency: 3.5 }]) {
        await expect(review(sub, world.curator, bad)).rejects.toThrow(/invalid scores/);
      }
      expect((await sql('select status from public.submissions where id = $1', [sub]))[0].status).toBe('pending');
    });

    it('race: 8 parallel curator reviews -> exactly one ok, others already_reviewed, one review row', async () => {
      const sub = await newSub();
      const res = await Promise.all(Array.from({ length: 8 }, (_, i) => review(sub, world.curator, S, i % 2 ? 'web' : 'telegram')));
      const outcomes = res.map((r) => r.outcome);
      expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'already_reviewed')).toHaveLength(7);
      expect(await sql('select 1 from public.reviews where submission_id = $1', [sub])).toHaveLength(1);
    });

    it('race: a curator and a teacher at once (no override flag) -> one ok, one already_reviewed', async () => {
      const sub = await newSub();
      const [a, b] = await Promise.all([review(sub, world.curator), review(sub, world.teacher)]);
      expect([a.outcome, b.outcome].sort()).toEqual(['already_reviewed', 'ok']);
      expect(await sql('select 1 from public.reviews where submission_id = $1', [sub])).toHaveLength(1);
    });

    it('XP is paid INSIDE the transaction: formula, once, even after 8 concurrent reviews; none for overrides', async () => {
      const sub = await newSub();
      const res = await Promise.all(Array.from({ length: 8 }, () => review(sub, world.curator)));
      expect(res.filter((r) => r.outcome === 'ok')).toHaveLength(1);
      expect(res.find((r) => r.outcome === 'ok')!.xp_awarded).toBe(true);
      const xp = await sql(`select amount from public.xp_events where student_id = $1 and reason = 'speaking_reviewed' and ref_id = $2`, [student, sub]);
      expect(xp).toEqual([{ amount: 34 }]); // 4.25 -> 40 * 4.25 / 5
      const o = await review(sub, world.teacher, { completeness: 5, pronunciation: 5, grammar: 5, fluency: 5 }, 'web', 'ok', true);
      expect([o.outcome, o.is_override, o.xp_awarded]).toEqual(['ok', true, false]);
      expect(await sql(`select 1 from public.xp_events where ref_id = $1`, [sub])).toHaveLength(1);
    });

    it('the SQL XP formula equals speakingXp() for every total 1.00..5.00 step 0.25', async () => {
      const { speakingXp } = await import('../../src/lib/gamification/xp');
      for (let total = 1; total <= 5; total += 0.25) {
        const [row] = await sql('select round(40 * $1::numeric / 5)::int as xp', [total.toFixed(2)]);
        expect(row.xp).toBe(speakingXp(total));
      }
    });

    it('self-review is forbidden for curator, teacher and admin who are also the student; drafts too; no XP', async () => {
      for (const [role, uid] of [['curator', world.curator], ['teacher', world.teacher], ['admin', admin]] as const) {
        const id = randomUUID();
        // the staff member is enrolled as a student and recorded a task; the group is their own
        await sql(`insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, tg_file_id, tg_file_unique_id) values ($1,$2,$3,$4,'video','F',$5)`, [id, uid, exercise, world.group, id]);
        expect((await review(id, uid, S, 'web', null, true)).outcome, role).toBe('forbidden');
        expect((await sql('select public.review_authority($1, $2) a', [id, uid]))[0].a, role).toBeNull();
        await expect(sql(`select public.set_draft_score($1, $2, 'grammar', 5)`, [id, uid])).rejects.toThrow(/forbidden/);
        expect((await sql('select status from public.submissions where id = $1', [id]))[0].status).toBe('pending');
        expect(await sql(`select 1 from public.xp_events where ref_id = $1`, [id])).toHaveLength(0);
      }
    });

    it('override must be explicit: only teacher/admin WITH the flag; curators and the unflagged get already_reviewed', async () => {
      const sub = await newSub();
      await review(sub, world.curator);
      expect((await review(sub, world.teacher)).outcome).toBe('already_reviewed');
      expect((await review(sub, admin, S, 'telegram')).outcome).toBe('already_reviewed');
      expect((await review(sub, world.curator, S, 'web', 'x', true)).outcome).toBe('already_reviewed');
      expect(await sql('select 1 from public.reviews where submission_id = $1', [sub])).toHaveLength(1);
    });

    it('an identical staff override within 30 s is a duplicate (no extra row); concurrent doubles insert once', async () => {
      const sub = await newSub();
      await review(sub, world.curator);
      const two = { completeness: 2, pronunciation: 2, grammar: 2, fluency: 2 };
      const res = await Promise.all(Array.from({ length: 4 }, () => review(sub, world.teacher, two, 'web', 'same', true)));
      expect(res.map((r) => r.outcome).sort()).toEqual(['duplicate', 'duplicate', 'duplicate', 'ok']);
      expect(await sql('select 1 from public.reviews where submission_id = $1 and is_override', [sub])).toHaveLength(1);
      const different = await review(sub, world.teacher, { ...two, grammar: 3 }, 'web', 'same', true);
      expect(different.outcome).toBe('ok');
    });

    it('text submissions are unsupported (no review, no XP)', async () => {
      const id = randomUUID();
      await sql(`insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, text_answer) values ($1,$2,$3,$4,'text','salom')`, [id, student, exercise, world.group]);
      expect((await review(id, world.curator)).outcome).toBe('unsupported_kind');
      expect(await sql('select 1 from public.reviews where submission_id = $1', [id])).toHaveLength(0);
      expect(await sql(`select 1 from public.xp_events where ref_id = $1`, [id])).toHaveLength(0);
    });

    it('column-level read: a student cannot read the workflow columns of their own submission but can read the rest', async () => {
      const sub = await newSub();
      for (const col of ['draft_scores', 'curator_chat_id', 'curator_message_id', 'notify_claimed_at']) {
        await expect(withUser(student, (q) => q(`select ${col} from public.submissions where id = $1`, [sub]))).rejects.toThrow(/permission denied/);
      }
      await expect(withUser(student, (q) => q('select * from public.submissions where id = $1', [sub]))).rejects.toThrow(/permission denied/);
      const ok = await withUser(student, (q) => q('select id, status, kind, tg_file_id, created_at, notified_at from public.submissions where id = $1', [sub]));
      expect(ok).toHaveLength(1);
      // curators read the same safe columns; reviews stay readable
      expect(await withUser(world.curator, (q) => q('select id, status from public.submissions where id = $1', [sub]))).toHaveLength(1);
      await expect(withUser(world.curator, (q) => q('select draft_scores from public.submissions where id = $1', [sub]))).rejects.toThrow(/permission denied/);
    });

    it('is atomic: a failing insert rolls the status flip back', async () => {
      const sub = await newSub();
      // A trigger that fires only for THIS submission makes the review insert fail after the flip.
      const fn = `fail_review_${sub.replace(/-/g, '')}`;
      await sql(`create function public.${fn}() returns trigger language plpgsql as $$ begin
        if new.submission_id = '${sub}' then raise exception 'boom'; end if; return new; end $$`);
      await sql(`create trigger ${fn} before insert on public.reviews for each row execute function public.${fn}()`);
      try {
        await expect(review(sub, world.curator)).rejects.toThrow(/boom/);
      } finally {
        await sql(`drop trigger ${fn} on public.reviews`);
        await sql(`drop function public.${fn}()`);
      }
      expect((await sql('select status from public.submissions where id = $1', [sub]))[0].status).toBe('pending');
      expect(await sql('select 1 from public.reviews where submission_id = $1', [sub])).toHaveLength(0);
      expect((await review(sub, world.curator)).outcome).toBe('ok');
    });

    it('is service_role only (authenticated and anon are denied)', async () => {
      const sub = await newSub();
      const call = (q: (t: string, p?: unknown[]) => Promise<unknown>) =>
        q(`select * from public.submit_review($1, $2, 'web', $3::jsonb, null)`, [sub, world.curator, JSON.stringify(S)]);
      await expect(withUser(world.curator, call)).rejects.toThrow(/permission denied/);
      await expect(withUser(null, call)).rejects.toThrow(/permission denied/);
      await expect(withUser(world.curator, (q) => q('select public.review_authority($1, $2)', [sub, world.curator]))).rejects.toThrow(/permission denied/);
      expect((await asService((q) => q(`select * from public.submit_review($1, $2, 'web', $3::jsonb, null)`, [sub, world.curator, JSON.stringify(S)])))[0].outcome).toBe('ok');
    });

    it('the latest review is readable by the student through RLS', async () => {
      const sub = await newSub();
      await review(sub, world.curator);
      expect(await withUser(student, (q) => q('select total from public.reviews where submission_id = $1', [sub]))).toHaveLength(1);
      expect(await withUser(otherStudent, (q) => q('select total from public.reviews where submission_id = $1', [sub]))).toHaveLength(0);
    });
  });

  describe('set_draft_score', () => {
    const draft = (sub: string, c: string, v: number, actor: string = world.curator) => sql('select public.set_draft_score($1, $2, $3, $4) d', [sub, actor, c, v]).then((r) => r[0].d);

    it('sets one criterion at a time and overwrites the same one', async () => {
      const sub = await newSub();
      expect(await draft(sub, 'pronunciation', 4)).toEqual({ pronunciation: 4 });
      expect(await draft(sub, 'fluency', 2)).toEqual({ pronunciation: 4, fluency: 2 });
      expect(await draft(sub, 'pronunciation', 5)).toEqual({ pronunciation: 5, fluency: 2 });
      expect((await sql('select draft_scores from public.submissions where id = $1', [sub]))[0].draft_scores).toEqual({ pronunciation: 5, fluency: 2 });
    });

    it('is atomic per key: 4 parallel criteria all land (no lost update)', async () => {
      const sub = await newSub();
      await Promise.all([draft(sub, 'completeness', 5), draft(sub, 'pronunciation', 4), draft(sub, 'grammar', 3), draft(sub, 'fluency', 2)]);
      expect((await sql('select draft_scores from public.submissions where id = $1', [sub]))[0].draft_scores).toEqual({ completeness: 5, pronunciation: 4, grammar: 3, fluency: 2 });
    });

    it('rejects unknown criteria and out-of-range values; null for reviewed or unknown submissions', async () => {
      const sub = await newSub();
      await expect(draft(sub, 'vibes', 3)).rejects.toThrow(/invalid draft score/);
      await expect(draft(sub, 'grammar', 6)).rejects.toThrow(/invalid draft score/);
      await expect(draft(sub, 'grammar', 0)).rejects.toThrow(/invalid draft score/);
      await review(sub, world.curator);
      expect(await draft(sub, 'grammar', 3)).toBeNull();
      await expect(draft(randomUUID(), 'grammar', 3)).rejects.toThrow(/forbidden/);
    });

    it('authorises the actor itself: student, other curator/teacher and unknown profiles cannot write a draft', async () => {
      const sub = await newSub();
      for (const who of [student, otherStudent, otherCurator, otherTeacher, randomUUID()]) {
        await expect(draft(sub, 'grammar', 3, who)).rejects.toThrow(/forbidden/);
      }
      expect((await sql('select draft_scores from public.submissions where id = $1', [sub]))[0].draft_scores).toEqual({});
      expect(await draft(sub, 'grammar', 3, world.teacher)).toEqual({ grammar: 3 });
    });

    it('is service_role only', async () => {
      const sub = await newSub();
      await expect(withUser(world.curator, (q) => q(`select public.set_draft_score($1, $2, 'grammar', 3)`, [sub, world.curator]))).rejects.toThrow(/permission denied/);
      await expect(withUser(null, (q) => q(`select public.set_draft_score($1, $2, 'grammar', 3)`, [sub, world.curator]))).rejects.toThrow(/permission denied/);
    });
  });

  it('curator message columns exist and are not writable by API roles', async () => {
    const sub = await newSub();
    await sql('update public.submissions set curator_chat_id = -100123, curator_message_id = 7 where id = $1', [sub]);
    const [row] = await sql('select curator_chat_id, curator_message_id from public.submissions where id = $1', [sub]);
    expect(row).toEqual({ curator_chat_id: '-100123', curator_message_id: '7' });
    await expect(withUser(world.curator, (q) => q('update public.submissions set curator_message_id = 1 where id = $1', [sub]))).rejects.toThrow(/permission denied/);
  });
});
