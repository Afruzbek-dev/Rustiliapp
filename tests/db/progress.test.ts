import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCohort,
  createCourse,
  createCourseWorld,
  createExercise,
  createGroup,
  createLesson,
  createProfile,
  enroll,
} from './fixtures';

const scores = (s: Record<string, unknown>) =>
  JSON.stringify({ completeness: 4, pronunciation: 4, grammar: 4, fluency: 4, ...s });

describe('0003 progress RLS', () => {
  let a: Awaited<ReturnType<typeof createCourseWorld>>;
  let b: Awaited<ReturnType<typeof createCourseWorld>>;
  let student1: string;
  let student2: string;
  let otherCurator: string;
  let otherGroupStudent: string;
  let speaking: string;
  let sub1: string;
  let sub2: string;
  let subOther: string;
  let part: string;

  async function submit(student: string, group: string) {
    const [row] = await sql(
      `insert into public.submissions (student_id, exercise_id, curator_group_id, kind, storage_path)
       values ($1, $2, $3, 'audio', 'x.webm') returning id`,
      [student, speaking, group],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    a = await createCourseWorld();
    b = await createCourseWorld();
    student1 = await createActiveStudent(a.cohort, a.group);
    student2 = await createActiveStudent(a.cohort, a.group);
    otherCurator = await createProfile('curator');
    const otherGroup = await createGroup(a.cohort, otherCurator);
    otherGroupStudent = await createActiveStudent(a.cohort, otherGroup);
    const lesson = await createLesson(a.course);
    part = lesson.part2;
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    speaking = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });
    sub1 = await submit(student1, a.group);
    sub2 = await submit(student2, a.group);
    subOther = await submit(otherGroupStudent, otherGroup);
    await sql(
      `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
       values ($1, $2, 'web', $3, 4.00)`,
      [sub1, a.curator, scores({})],
    );
  });

  it('a student does not see another student’s submission', async () => {
    const rows = await withUser(student1, (q) => q('select id from public.submissions'));
    expect(rows.map((r) => r.id)).toEqual([sub1]);
  });

  it('a student sees reviews of their own submissions only', async () => {
    expect((await withUser(student1, (q) => q('select submission_id from public.reviews'))).length).toBe(1);
    expect(await withUser(student2, (q) => q('select submission_id from public.reviews'))).toEqual([]);
  });

  it('a curator does not see another group’s submissions', async () => {
    const rows = await withUser(a.curator, (q) => q('select id from public.submissions'));
    expect(rows.map((r) => r.id).sort()).toEqual([sub1, sub2].sort());
    const other = await withUser(otherCurator, (q) => q('select id from public.submissions'));
    expect(other.map((r) => r.id)).toEqual([subOther]);
    expect(await withUser(otherCurator, (q) => q('select id from public.reviews'))).toEqual([]);
    expect(await withUser(b.curator, (q) => q('select id from public.submissions'))).toEqual([]);
  });

  it('a student cannot insert into reviews', async () => {
    await expect(
      withUser(student1, (q) =>
        q(
          `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
           values ($1, $2, 'web', $3, 5.00)`,
          [sub1, student1, scores({ completeness: 5, pronunciation: 5, grammar: 5, fluency: 5 })],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('a curator cannot write reviews directly either (server/service role only)', async () => {
    await expect(
      withUser(a.curator, (q) =>
        q(
          `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
           values ($1, $2, 'web', $3, 4.00)`,
          [sub2, a.curator, scores({})],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('a score of 6 is rejected', async () => {
    await expect(
      asService((q) =>
        q(
          `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
           values ($1, $2, 'web', $3, 4.50)`,
          [sub2, a.curator, scores({ fluency: 6 })],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('scores must have exactly the four rubric keys and a matching total', async () => {
    const insert = (s: string, total: number) =>
      asService((q) =>
        q(
          `insert into public.reviews (submission_id, reviewer_id, channel, scores, total)
           values ($1, $2, 'telegram', $3, $4) returning total`,
          [sub2, a.curator, s, total],
        ),
      );
    await expect(insert(JSON.stringify({ completeness: 4, pronunciation: 4, grammar: 4 }), 4)).rejects.toThrow(
      /check constraint/,
    );
    await expect(insert(scores({ extra: 3 }), 4)).rejects.toThrow(/check constraint/);
    await expect(insert(scores({ grammar: 0 }), 3)).rejects.toThrow(/check constraint/);
    await expect(insert(scores({ grammar: 3 }), 4)).rejects.toThrow(/check constraint/);
    expect(await insert(scores({ grammar: 3 }), 3.75)).toEqual([{ total: '3.75' }]);
  });

  it('draft_scores accepts a partial rubric but not out-of-range values', async () => {
    await asService((q) =>
      q(`update public.submissions set draft_scores = '{"completeness": 5}' where id = $1`, [sub2]),
    );
    await expect(
      asService((q) => q(`update public.submissions set draft_scores = '{"fluency": 6}' where id = $1`, [sub2])),
    ).rejects.toThrow(/check constraint/);
  });

  it('a student cannot write attempts, progress, SRS cards, submissions or test attempts', async () => {
    const statements: [string, unknown[]][] = [
      [`insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1, $2, '{}', true)`, [student1, speaking]],
      [`insert into public.part_progress (student_id, lesson_part_id) values ($1, $2)`, [student1, part]],
      [`insert into public.submissions (student_id, exercise_id, kind) values ($1, $2, 'text')`, [student1, speaking]],
      [`update public.submissions set status = 'reviewed' where id = $1`, [sub1]],
      [`delete from public.reviews`, []],
    ];
    for (const [text, params] of statements) {
      await expect(withUser(student1, (q) => q(text, params))).rejects.toThrow(/permission denied/);
    }
  });

  it('the course teacher sees all submissions of the course; another teacher none', async () => {
    const rows = await withUser(a.teacher, (q) => q('select id from public.submissions'));
    expect(rows.map((r) => r.id).sort()).toEqual([sub1, sub2, subOther].sort());
    expect(await withUser(b.teacher, (q) => q('select id from public.submissions'))).toEqual([]);
  });

  /** A published speaking exercise in `course`. */
  async function speakingIn(course: string) {
    const lesson = await createLesson(course);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    return createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });
  }

  async function submitTo(student: string, exercise: string, group: string) {
    const [row] = await sql(
      `insert into public.submissions (student_id, exercise_id, curator_group_id, kind, storage_path)
       values ($1, $2, $3, 'audio', 'y.webm') returning id`,
      [student, exercise, group],
    );
    await sql(
      `insert into public.reviews (submission_id, reviewer_id, channel, scores, total) values ($1, null, 'web', $2, 4.00)`,
      [row.id, scores({})],
    );
    return row.id as string;
  }

  it('a former curator cannot read a student’s submissions, reviews or profile after re-enrolment elsewhere', async () => {
    // S was in cohort 1 under C's group G1 (now expired), and re-enrolled in cohort 2 under D's group G2.
    const teacher = await createProfile('teacher');
    const course = await createCourse(teacher);
    const cohort1 = await createCohort(course, 'Potok 1');
    const cohort2 = await createCohort(course, 'Potok 2');
    const c = await createProfile('curator');
    const d = await createProfile('curator');
    const g1 = await createGroup(cohort1, c);
    const g2 = await createGroup(cohort2, d);
    const s = await createProfile('student');
    await enroll(s, cohort1, { status: 'expired', groupId: g1, expiresAt: '2020-01-01T00:00:00Z' });
    await enroll(s, cohort2, { status: 'active', groupId: g2 });
    const exercise = await speakingIn(course);
    const oldSub = await submitTo(s, exercise, g1);
    const newSub = await submitTo(s, exercise, g2);

    const cSubs = await withUser(c, (q) => q('select id from public.submissions'));
    expect(cSubs.map((r) => r.id)).toEqual([oldSub]); // history of their own group only
    const cReviews = await withUser(c, (q) => q('select submission_id from public.reviews'));
    expect(cReviews.map((r) => r.submission_id)).toEqual([oldSub]);
    expect(await withUser(c, (q) => q('select id from public.profiles where id = $1', [s]))).toEqual([]);

    const dSubs = await withUser(d, (q) => q('select id from public.submissions'));
    expect(dSubs.map((r) => r.id)).toEqual([newSub]);
    expect(await withUser(d, (q) => q('select id from public.profiles where id = $1', [s]))).toEqual([{ id: s }]);
  });

  it('a curator working in two courses only reads submissions filed under their own groups', async () => {
    // C curates groups in course X and course Y; S is in C's group in X, but in D's group in Y.
    const x = await createCourseWorld();
    const y = await createCourseWorld();
    const c = x.curator;
    await createGroup(y.cohort, c); // C also curates a group in course Y
    const s = await createActiveStudent(x.cohort, x.group);
    await enroll(s, y.cohort, { status: 'active', groupId: y.group }); // y.group is curated by D (y.curator)
    const subX = await submitTo(s, await speakingIn(x.course), x.group);
    const subY = await submitTo(s, await speakingIn(y.course), y.group);

    const cSubs = await withUser(c, (q) => q('select id from public.submissions'));
    expect(cSubs.map((r) => r.id)).toEqual([subX]);
    const cReviews = await withUser(c, (q) => q('select submission_id from public.reviews'));
    expect(cReviews.map((r) => r.submission_id)).toEqual([subX]);
    const dSubs = await withUser(y.curator, (q) => q('select id from public.submissions'));
    expect(dSubs.map((r) => r.id)).toEqual([subY]);
  });

  it('anon cannot call can_read_submission', async () => {
    await expect(withUser(null, (q) => q('select public.can_read_submission($1)', [sub1]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('anon sees nothing', async () => {
    await expect(withUser(null, (q) => q('select id from public.submissions'))).rejects.toThrow(/permission denied/);
  });
});
