import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCourseWorld,
  createExercise,
  createLesson,
  createProfile,
  enroll,
} from './fixtures';

const rubric = (n: number) => JSON.stringify({ completeness: n, pronunciation: n, grammar: n, fluency: n });

describe('0004 gamification', () => {
  let a: Awaited<ReturnType<typeof createCourseWorld>>;
  let b: Awaited<ReturnType<typeof createCourseWorld>>;
  let speaking: string;

  beforeAll(async () => {
    a = await createCourseWorld();
    b = await createCourseWorld();
    const lesson = await createLesson(a.course);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    speaking = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });
  });

  /** `count` audio submissions for `student`, each reviewed with all criteria = `score`. */
  async function reviewed(student: string, count: number, score: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [s] = await sql(
        `insert into public.submissions (student_id, exercise_id, curator_group_id, kind, storage_path, status)
         values ($1, $2, $3, 'audio', 'a.webm', 'reviewed') returning id`,
        [student, speaking, a.group],
      );
      await sql(
        `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
         values ($1, $2, 'web', $3, $4)`,
        [s.id, a.curator, rubric(score), score],
      );
      ids.push(s.id);
    }
    return ids;
  }

  it('award_xp with the same ref_id twice: the second returns false and XP is counted once', async () => {
    const student = await createActiveStudent(a.cohort, a.group);
    const results = await asService(async (q) => {
      const [first] = await q(`select public.award_xp($1, 10, 'exercise_correct', 'ex-1:all') as ok`, [student]);
      const [second] = await q(`select public.award_xp($1, 10, 'exercise_correct', 'ex-1:all') as ok`, [student]);
      const events = await q('select amount from public.xp_events where student_id = $1', [student]);
      const days = await q(`select to_char(day, 'YYYY-MM-DD') as day, xp from public.daily_activity where student_id = $1`, [
        student,
      ]);
      // "today" from the database clock of this same transaction (now() is fixed per transaction)
      const [today] = await q(`select to_char((now() at time zone 'Asia/Tashkent')::date, 'YYYY-MM-DD') as day`);
      return { first: first.ok, second: second.ok, events, days, today: today.day as string };
    });
    expect(results.first).toBe(true);
    expect(results.second).toBe(false);
    expect(results.events).toEqual([{ amount: 10 }]);
    expect(results.days).toEqual([{ day: results.today, xp: 10 }]);
  });

  it('an XP event at 23:30 UTC is booked on the next Tashkent day', async () => {
    const student = await createActiveStudent(a.cohort, a.group);
    const days = await asService(async (q) => {
      await q(
        `insert into public.xp_events (student_id, amount, reason, ref_id, created_at)
         values ($1, 20, 'part_completed', 'p-1', '2026-11-10T23:30:00Z'),
                ($1, 5, 'exercise_correct', 'e-1', '2026-11-10T18:59:00Z')`,
        [student],
      );
      return q(
        `select to_char(day, 'YYYY-MM-DD') as day, xp from public.daily_activity where student_id = $1 order by day`,
        [student],
      );
    });
    expect(days).toEqual([
      { day: '2026-11-10', xp: 5 },
      { day: '2026-11-11', xp: 20 },
    ]);
  });

  it('students and curators cannot award XP or write the ledger directly', async () => {
    const student = await createActiveStudent(a.cohort, a.group);
    for (const uid of [student, a.curator, a.teacher]) {
      await expect(
        withUser(uid, (q) => q(`select public.award_xp($1, 100, 'daily_tasks', 'x')`, [student])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUser(uid, (q) =>
          q(`insert into public.xp_events (student_id, amount, reason, ref_id) values ($1, 100, 'daily_tasks', 'x')`, [
            student,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUser(uid, (q) => q(`update public.daily_activity set xp = 9999 where student_id = $1`, [student])),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      withUser(null, (q) => q(`select public.award_xp($1, 100, 'daily_tasks', 'x')`, [student])),
    ).rejects.toThrow(/permission denied/);
  });

  it('a student reads only their own XP ledger', async () => {
    const s1 = await createActiveStudent(a.cohort, a.group);
    const s2 = await createActiveStudent(a.cohort, a.group);
    await sql(`select public.award_xp($1, 10, 'exercise_correct', 'own')`, [s1]);
    await sql(`select public.award_xp($1, 10, 'exercise_correct', 'other')`, [s2]);
    const rows = await withUser(s1, (q) => q('select student_id from public.xp_events'));
    expect(rows).toEqual([{ student_id: s1 }]);
    const days = await withUser(s1, (q) => q('select student_id from public.daily_activity'));
    expect(days).toEqual([{ student_id: s1 }]);
    expect(await withUser(b.teacher, (q) => q('select * from public.xp_events where student_id = $1', [s1]))).toEqual(
      [],
    );
  });

  it('speaking leaderboard: students with 7 reviewed submissions are not eligible', async () => {
    const seven = await createActiveStudent(a.cohort, a.group, 'Aziz Karimov');
    const eight = await createActiveStudent(a.cohort, a.group, 'Madina Rahimova');
    await reviewed(seven, 7, 5);
    const eightIds = await reviewed(eight, 8, 3);
    // a later (override) review replaces the earlier one for that submission
    await sql(
      `insert into public.reviews (submission_id, reviewer_id, channel, scores, total, is_override, created_at)
       values ($1, $2, 'web', $3, 5, true, now() + interval '1 minute')`,
      [eightIds[0], a.teacher, rubric(5)],
    );

    const board = await withUser(seven, (q) =>
      q(`select * from public.leaderboard($1, 'speaking', 'month')`, [a.cohort]),
    );
    const bySeven = board.find((r) => r.student_id === seven);
    const byEight = board.find((r) => r.student_id === eight);
    expect(bySeven).toMatchObject({ eligible: false, score: '5.00', display_name: 'Aziz K.' });
    expect(byEight).toMatchObject({ eligible: true, score: '3.25', display_name: 'Madina R.' });
    // eligible students rank above ineligible ones regardless of mean
    expect(byEight!.rank).toBeLessThan(bySeven!.rank);
  });

  it('xp leaderboard ranks active cohort members by XP in the period', async () => {
    const c = await createCourseWorld();
    const top = await createActiveStudent(c.cohort, c.group, 'Bobur Toshmatov');
    const low = await createActiveStudent(c.cohort, c.group, 'Dilnoza');
    const pending = await createProfile('student', 'Kutayotgan Talaba');
    await enroll(pending, c.cohort, { status: 'pending' });
    await sql(`select public.award_xp($1, 50, 'part_completed', 'p')`, [top]);
    await sql(`select public.award_xp($1, 10, 'exercise_correct', 'e')`, [low]);
    await sql(`select public.award_xp($1, 99, 'exercise_correct', 'e')`, [pending]);
    // XP from before the period does not count
    await sql(
      `insert into public.xp_events (student_id, amount, reason, ref_id, created_at)
       values ($1, 1000, 'test_completed', 'old', now() - interval '40 days')`,
      [low],
    );
    const board = await withUser(low, (q) => q(`select * from public.leaderboard($1, 'xp', 'week')`, [c.cohort]));
    expect(board).toEqual([
      { rank: 1, student_id: top, display_name: 'Bobur T.', score: '50', eligible: true },
      { rank: 2, student_id: low, display_name: 'Dilnoza', score: '10', eligible: true },
    ]);
    // the cohort's teacher and curator may view it too
    expect(await withUser(c.teacher, (q) => q(`select * from public.leaderboard($1, 'xp', 'month')`, [c.cohort]))).toHaveLength(2);
    expect(await withUser(c.curator, (q) => q(`select * from public.leaderboard($1, 'xp', 'month')`, [c.cohort]))).toHaveLength(2);
    // a pending applicant of the cohort may not
    expect(await withUser(pending, (q) => q(`select * from public.leaderboard($1, 'xp', 'week')`, [c.cohort]))).toEqual([]);
  });

  it('a student of another cohort does not see the leaderboard', async () => {
    const outsider = await createActiveStudent(b.cohort, b.group);
    await createActiveStudent(a.cohort, a.group);
    for (const kind of ['xp', 'speaking']) {
      const rows = await withUser(outsider, (q) => q(`select * from public.leaderboard($1, $2, 'month')`, [a.cohort, kind]));
      expect(rows).toEqual([]);
    }
    expect(await withUser(b.teacher, (q) => q(`select * from public.leaderboard($1, 'xp', 'month')`, [a.cohort]))).toEqual(
      [],
    );
    await expect(
      withUser(null, (q) => q(`select * from public.leaderboard($1, 'xp', 'month')`, [a.cohort])),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects unknown leaderboard kinds and periods', async () => {
    const s = await createActiveStudent(a.cohort, a.group);
    await expect(withUser(s, (q) => q(`select * from public.leaderboard($1, 'gold', 'week')`, [a.cohort]))).rejects.toThrow(
      /invalid kind/,
    );
    await expect(withUser(s, (q) => q(`select * from public.leaderboard($1, 'xp', 'year')`, [a.cohort]))).rejects.toThrow(
      /invalid period/,
    );
  });

  it('achievements are seeded and readable; awards are server-only', async () => {
    const s = await createActiveStudent(a.cohort, a.group);
    const codes = await withUser(s, (q) => q('select code from public.achievements order by code'));
    expect(codes.map((r) => r.code)).toEqual([
      'first_lesson',
      'grammar_master',
      'listening_champion',
      'speaking_champion',
      'streak_7',
      'words_100',
    ]);
    await expect(
      withUser(s, (q) => q(`insert into public.student_achievements (student_id, code) values ($1, 'streak_7')`, [s])),
    ).rejects.toThrow(/permission denied/);
  });
});
