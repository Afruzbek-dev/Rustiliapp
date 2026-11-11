import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCourseWorld,
  createExercise,
  createGroup,
  createLesson,
  createProfile,
  enroll,
} from './fixtures';

const SCORES = (n: number) => JSON.stringify({ completeness: n, pronunciation: n, grammar: n, fluency: n });

describe('0015 teacher statistics', () => {
  let w: Awaited<ReturnType<typeof createCourseWorld>>;
  let other: Awaited<ReturnType<typeof createCourseWorld>>;
  let lesson: Awaited<ReturnType<typeof createLesson>>;
  let lesson2: string;
  let exercise: string;
  let s1: string;
  let s2: string;
  let s3: string;
  let pendingStudent: string;
  let admin: string;
  let outsider: string;
  let today: string;
  let utcToday: string;

  async function activity(student: string, dayExpr: string, xp: number) {
    await sql(
      `insert into public.daily_activity (student_id, day, xp) values ($1, ${dayExpr}, $2)
       on conflict (student_id, day) do update set xp = excluded.xp`,
      [student, xp],
    );
  }
  async function submission(student: string, opts: { status?: string; complete?: boolean; ago?: string; group?: string } = {}) {
    const id = randomUUID();
    await sql(
      `insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, tg_file_id, tg_file_unique_id, status, created_at)
       values ($1, $2, $3, $4, 'video', $5, $8, $6, now() - $7::interval)`,
      [id, student, exercise, opts.group ?? w.group, opts.complete === false ? null : 'FILE', opts.status ?? 'pending', opts.ago ?? '0 seconds', id],
    );
    return id;
  }
  async function review(sub: string, total: number, createdAgo: string, reviewer = w.curator) {
    await sql(
      `insert into public.reviews (submission_id, reviewer_id, channel, scores, total, created_at)
       values ($1, $2, 'web', $3::jsonb, $4, now() - $5::interval)`,
      [sub, reviewer, SCORES(total), total, createdAgo],
    );
  }

  beforeAll(async () => {
    w = await createCourseWorld();
    other = await createCourseWorld();
    lesson = await createLesson(w.course);
    const [l2] = await sql<{ id: string }>(
      `insert into public.lessons (module_id, position, title) values ($1, 2, 'Dars 2') returning id`,
      [lesson.module],
    );
    lesson2 = l2.id;
    const [p21] = await sql<{ id: string }>(
      `insert into public.lesson_parts (lesson_id, position, kind, title) values ($1, 1, 'grammar', 'Grammatika 2') returning id`,
      [lesson2],
    );
    // every part is playable (has a published block); lesson_completion ignores the others
    await createBlock(lesson.part1, 1, true);
    await createBlock(p21.id, 1, true);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    exercise = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });

    s1 = await createActiveStudent(w.cohort, w.group, 'Ali Valiyev');
    s2 = await createActiveStudent(w.cohort, w.group, 'Bobur Karimov');
    s3 = await createActiveStudent(w.cohort, w.group, 'Dilnoza Rahimova');
    pendingStudent = await createProfile('student', 'Kutuvchi');
    await enroll(pendingStudent, w.cohort, { status: 'pending' });
    await enroll(await createProfile('student', 'Rad'), w.cohort, { status: 'rejected' });
    await enroll(await createProfile('student', 'Eski'), w.cohort, { status: 'active', expiresAt: '2000-01-01T00:00:00Z' });
    await createActiveStudent(other.cohort, other.group, 'Begona');
    admin = await createProfile('admin');
    outsider = await createProfile('student');

    [{ d: today }] = await sql<{ d: string }>(`select to_char((now() at time zone 'Asia/Tashkent')::date, 'YYYY-MM-DD') as d`);
    [{ d: utcToday }] = await sql<{ d: string }>(`select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as d`);

    // progress: s1 finished lesson 1 (both parts) and lesson 2; s2 only part 1 of lesson 1; s3 nothing
    for (const [stu, part] of [[s1, lesson.part1], [s1, lesson.part2], [s1, p21.id], [s2, lesson.part1]] as const) {
      await sql(
        `insert into public.part_progress (student_id, lesson_part_id, status, completed_at) values ($1, $2, 'completed', now())`,
        [stu, part],
      );
    }
    // an in-progress part must not count
    await sql(`insert into public.part_progress (student_id, lesson_part_id, status) values ($1, $2, 'in_progress')`, [s3, lesson.part1]);

    // activity: s1 today and 2 days ago, s2 only 5 days ago, s3 never
    await activity(s1, `(now() at time zone 'Asia/Tashkent')::date`, 30);
    await activity(s1, `(now() at time zone 'Asia/Tashkent')::date - 2`, 10);
    await activity(s2, `(now() at time zone 'Asia/Tashkent')::date - 5`, 20);
    // zero xp does not count as active
    await activity(s3, `(now() at time zone 'Asia/Tashkent')::date`, 0);

    // submissions: one pending finished (counts), one unfinished (no), one reviewed (no)
    await submission(s1, { ago: '3 hours' });
    await submission(s1, { complete: false });
    const reviewed = await submission(s2, { status: 'reviewed', ago: '10 hours' });
    await review(reviewed, 3, '8 hours'); // first review: 2 h response
    await review(reviewed, 5, '1 hour'); // later override: effective score, not a response
    const reviewed2 = await submission(s3, { status: 'reviewed', ago: '5 hours' });
    await review(reviewed2, 4, '1 hour'); // 4 h response
    // an old review (outside 30 days) is excluded from the response time but still scores
    const old = await submission(s3, { status: 'reviewed', ago: '60 days' });
    await review(old, 1, '59 days');
    // a pending submission of another group's cohort must not leak in
    await submission(await createActiveStudent(other.cohort, other.group), { group: other.group });
  });

  describe('teacher_kpis', () => {
    it('counts the cohort correctly for its teacher', async () => {
      const [k] = await withUser(w.teacher, (q) => q('select * from public.teacher_kpis($1)', [w.cohort]));
      expect(k.active_students).toBe(3);
      expect(k.total_students).toBe(5); // 3 active + pending + expired; rejected excluded
      expect(k.pending_requests).toBe(1);
      expect(k.active_today).toBe(1); // s1 only: s3 has xp 0
      expect(k.unreviewed_submissions).toBe(1);
      expect(Number(k.avg_progress)).toBeCloseTo(4 / 3, 2); // 4 completed parts / 3 students
    });

    it('active_today uses the Tashkent day, not the UTC day', async () => {
      if (utcToday !== today) {
        await sql('delete from public.daily_activity where student_id = $1', [s2]);
        await activity(s2, `'${utcToday}'::date`, 50); // a UTC-day row that is not the Tashkent day
        const [k] = await withUser(w.teacher, (q) => q('select * from public.teacher_kpis($1)', [w.cohort]));
        expect(k.active_today).toBe(1);
        await sql('delete from public.daily_activity where student_id = $1', [s2]);
        await activity(s2, `(now() at time zone 'Asia/Tashkent')::date - 5`, 20);
      } else {
        await activity(s2, `(now() at time zone 'Asia/Tashkent')::date`, 5);
        const [k] = await withUser(w.teacher, (q) => q('select * from public.teacher_kpis($1)', [w.cohort]));
        expect(k.active_today).toBe(2);
        await sql('delete from public.daily_activity where student_id = $1 and day = $2::date', [s2, today]);
      }
    });

    it('an empty cohort returns zeros', async () => {
      const empty = await sql<{ id: string }>(
        `insert into public.cohorts (course_id, name) values ($1, 'Bo''sh') returning id`,
        [w.course],
      );
      const [k] = await withUser(w.teacher, (q) => q('select * from public.teacher_kpis($1)', [empty[0].id]));
      expect(k).toMatchObject({ active_students: 0, total_students: 0, pending_requests: 0, active_today: 0, unreviewed_submissions: 0 });
      expect(Number(k.avg_progress)).toBe(0);
    });

    it('the admin sees everything', async () => {
      const [k] = await withUser(admin, (q) => q('select * from public.teacher_kpis($1)', [w.cohort]));
      expect(k.active_students).toBe(3);
    });
  });

  describe('daily_active', () => {
    it('is zero-filled, oldest first, ending today', async () => {
      const rows = await withUser(w.teacher, (q) => q('select to_char(day, \'YYYY-MM-DD\') as day, active from public.daily_active($1)', [w.cohort]));
      expect(rows).toHaveLength(14);
      expect(rows[13]).toEqual({ day: today, active: 1 });
      const byOffset = (n: number) => rows[13 - n].active;
      expect(byOffset(2)).toBe(1);
      expect(byOffset(5)).toBe(1);
      expect([1, 3, 4, 6, 7, 13].map(byOffset).every((a) => a === 0)).toBe(true);
      const days = rows.map((r) => r.day);
      expect([...days].sort()).toEqual(days);
    });

    it('bounds p_days to 1..60', async () => {
      const lo = await withUser(w.teacher, (q) => q('select * from public.daily_active($1, 0)', [w.cohort]));
      const hi = await withUser(w.teacher, (q) => q('select * from public.daily_active($1, 1000)', [w.cohort]));
      const nul = await withUser(w.teacher, (q) => q('select * from public.daily_active($1, null)', [w.cohort]));
      expect([lo.length, hi.length, nul.length]).toEqual([1, 60, 14]);
    });
  });

  describe('lesson_completion', () => {
    it('counts students who finished every part of a lesson', async () => {
      const rows = await withUser(w.teacher, (q) => q('select * from public.lesson_completion($1)', [w.cohort]));
      expect(rows.map((r) => [r.title, r.completed_students, r.total_active_students])).toEqual([
        ['Dars 1', 1, 3], // only s1 has both parts
        ['Dars 2', 1, 3],
      ]);
    });
  });

  describe('lesson_completion: playable parts only', () => {
    it('ignores unpublished parts and skips lessons without a playable part', async () => {
      const x = await createCourseWorld();
      const a = await createLesson(x.course); // part1 published, part2 only an unpublished block
      await createBlock(a.part1, 1, true);
      await createBlock(a.part2, 1, false);
      const [lb] = await sql<{ id: string }>(
        `insert into public.lessons (module_id, position, title) values ($1, 2, 'Dars B') returning id`,
        [a.module],
      );
      const [pb] = await sql<{ id: string }>(
        `insert into public.lesson_parts (lesson_id, position, kind, title) values ($1, 1, 'grammar', 'B1') returning id`,
        [lb.id],
      );
      await createBlock(pb.id, 1, false);
      const stu = await createActiveStudent(x.cohort, x.group, 'Playable');
      for (const part of [a.part1, pb.id]) {
        await sql(`insert into public.part_progress (student_id, lesson_part_id, status, completed_at) values ($1, $2, 'completed', now())`, [stu, part]);
      }
      const rows = await withUser(x.teacher, (q) => q('select * from public.lesson_completion($1)', [x.cohort]));
      // Dars 1: finishing the one playable part is enough; Dars B has nothing playable
      expect(rows.map((r) => [r.title, r.completed_students])).toEqual([['Dars 1', 1], ['Dars B', 0]]);
    });
  });

  describe('curator_stats', () => {
    it('queue, effective scores and response time', async () => {
      const second = await createGroup(w.cohort, null);
      const rows = await withUser(w.teacher, (q) => q('select * from public.curator_stats($1) order by group_name, group_id', [w.cohort]));
      const mine = rows.find((r) => r.group_id === w.group)!;
      expect(mine.curator_name).toBe('Kurator Bir');
      expect(mine.students).toBe(3);
      expect(mine.pending_queue).toBe(1);
      // effective totals: 5 (override wins over 3), 4, 1 -> mean 3.33
      expect(Number(mine.avg_score)).toBeCloseTo(3.33, 2);
      // first reviews in the last 30 days: 2 h and 4 h -> 3 h; the 59-day-old one is excluded
      expect(Number(mine.avg_response_hours)).toBeCloseTo(3, 1);
      const empty = rows.find((r) => r.group_id === second)!;
      expect(empty.curator_name).toBe('');
      expect(empty.students).toBe(0);
      expect(empty.avg_score).toBeNull();
      expect(empty.avg_response_hours).toBeNull();
    });
  });

  describe('idle_students', () => {
    it('lists active students with no xp in the window, longest idle first', async () => {
      const rows = await withUser(w.teacher, (q) =>
        q(`select student_id, full_name, telegram_linked, to_char(last_active, 'YYYY-MM-DD') as last_active, last_part_title
           from public.idle_students($1, 3)`, [w.cohort]),
      );
      // s1 active today: excluded. s3 never active (first), s2 last active 5 days ago.
      expect(rows.map((r) => r.full_name)).toEqual(['Dilnoza Rahimova', 'Bobur Karimov']);
      expect(rows[0].last_active).toBeNull();
      expect(rows[0].telegram_linked).toBe(false);
      expect(rows[0].last_part_title).toBe('Grammatika'); // s3's only (in-progress) part
      expect(rows[1].last_part_title).toBe('Grammatika');
    });

    it("last_part_title only looks at parts of the cohort's own course", async () => {
      const x = await createCourseWorld();
      const mine = await createLesson(x.course);
      const foreign = await createLesson(other.course);
      await sql(`update public.lesson_parts set title = 'Mening qismim' where id = $1`, [mine.part1]);
      await sql(`update public.lesson_parts set title = 'Begona qism' where id = $1`, [foreign.part1]);
      const stu = await createActiveStudent(x.cohort, x.group, 'Ikki Kurs');
      await sql(`insert into public.part_progress (student_id, lesson_part_id, status, started_at) values ($1, $2, 'in_progress', now() - interval '2 days')`, [stu, mine.part1]);
      await sql(`insert into public.part_progress (student_id, lesson_part_id, status, started_at) values ($1, $2, 'in_progress', now())`, [stu, foreign.part1]);
      const rows = await withUser(x.teacher, (q) => q('select last_part_title from public.idle_students($1, 3)', [x.cohort]));
      expect(rows.map((r) => r.last_part_title)).toEqual(['Mening qismim']);
    });

    it('the window counts today: p_days = 3 keeps a student active 2 days ago, p_days = 2 drops them', async () => {
      await sql('delete from public.daily_activity where student_id = $1 and day = $2::date', [s1, today]);
      const three = await withUser(w.teacher, (q) => q('select full_name from public.idle_students($1, 3)', [w.cohort]));
      const two = await withUser(w.teacher, (q) => q('select full_name from public.idle_students($1, 2)', [w.cohort]));
      expect(three.map((r) => r.full_name)).not.toContain('Ali Valiyev');
      expect(two.map((r) => r.full_name)).toContain('Ali Valiyev');
      await activity(s1, `(now() at time zone 'Asia/Tashkent')::date`, 30);
    });
  });

  describe('authorization: foreign callers get nothing', () => {
    const calls = [
      'select * from public.teacher_kpis($1)',
      'select * from public.daily_active($1)',
      'select * from public.lesson_completion($1)',
      'select * from public.curator_stats($1)',
      'select * from public.idle_students($1)',
    ];

    it('the owner sees data (sanity)', async () => {
      for (const c of calls) {
        const rows = await withUser(w.teacher, (q) => q(c, [w.cohort]));
        expect(rows.length, c).toBeGreaterThan(0);
      }
    });

    it.each([
      ['another teacher', () => other.teacher],
      ['a student of the cohort', () => s1],
      ['an unrelated student', () => outsider],
      ['the curator of the cohort', () => w.curator],
    ])('%s gets empty results', async (_n, who) => {
      for (const c of calls) {
        const rows = await withUser(who(), (q) => q(c, [w.cohort]));
        expect(rows, c).toEqual([]);
      }
    });

    it('anon is denied', async () => {
      for (const c of calls) {
        await expect(withUser(null, (q) => q(c, [w.cohort])), c).rejects.toThrow(/permission denied/);
      }
    });

    it('API roles cannot call the internal helper or touch reminders', async () => {
      await expect(withUser(w.teacher, (q) => q('select * from public.stats_member_ids($1)', [w.cohort]))).rejects.toThrow(/permission denied/);
      await expect(withUser(w.teacher, (q) => q('select * from public.reminders'))).rejects.toThrow(/permission denied/);
      await expect(withUser(w.teacher, (q) => q('insert into public.reminders (student_id, day) values ($1, current_date)', [s1]))).rejects.toThrow(/permission denied/);
    });

    it('an unknown cohort is empty for a teacher and for an admin', async () => {
      const id = randomUUID();
      expect(await withUser(w.teacher, (q) => q('select * from public.teacher_kpis($1)', [id]))).toEqual([]);
      expect(await withUser(admin, (q) => q('select * from public.teacher_kpis($1)', [id]))).toEqual([]);
      expect(await withUser(admin, (q) => q('select * from public.lesson_completion($1)', [id]))).toEqual([]);
    });
  });

  describe('reminders', () => {
    it('one row per student and day', async () => {
      await sql('insert into public.reminders (student_id, day) values ($1, $2::date)', [s1, today]);
      await expect(sql('insert into public.reminders (student_id, day) values ($1, $2::date)', [s1, today])).rejects.toThrow(/duplicate key/);
      await sql('delete from public.reminders where student_id = $1', [s1]);
    });
  });
});
