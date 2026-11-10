import { beforeAll, describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';
import { createActiveStudent, createCourseWorld, createGroup, createProfile, enroll } from './fixtures';

describe('0001 identity RLS', () => {
  let a: Awaited<ReturnType<typeof createCourseWorld>>;
  let b: Awaited<ReturnType<typeof createCourseWorld>>;
  let studentA1: string;
  let studentA2: string;
  let studentOtherGroup: string;
  let studentB: string;

  beforeAll(async () => {
    a = await createCourseWorld();
    b = await createCourseWorld();
    studentA1 = await createActiveStudent(a.cohort, a.group);
    studentA2 = await createActiveStudent(a.cohort, a.group);
    const otherGroup = await createGroup(a.cohort, await createProfile('curator'));
    studentOtherGroup = await createActiveStudent(a.cohort, otherGroup);
    studentB = await createActiveStudent(b.cohort, b.group);
  });

  it('a student cannot see another student’s profile', async () => {
    const rows = await withUser(studentA1, (q) => q('select id from public.profiles'));
    expect(rows.map((r) => r.id)).toEqual([studentA1]);
  });

  it('a student cannot change their own role to teacher', async () => {
    await expect(
      withUser(studentA1, (q) => q(`update public.profiles set role = 'teacher' where id = $1`, [studentA1])),
    ).rejects.toThrow(/permission denied/);
    const [row] = await sql('select role from public.profiles where id = $1', [studentA1]);
    expect(row.role).toBe('student');
  });

  it('a student can update their own full_name but not phone or telegram_id', async () => {
    const updated = await withUser(studentA1, (q) =>
      q(`update public.profiles set full_name = 'Yangi Ism' where id = $1 returning full_name`, [studentA1]),
    );
    expect(updated).toEqual([{ full_name: 'Yangi Ism' }]);
    await expect(
      withUser(studentA1, (q) => q(`update public.profiles set phone = '+998900000000' where id = $1`, [studentA1])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withUser(studentA1, (q) => q(`update public.profiles set telegram_id = 42 where id = $1`, [studentA1])),
    ).rejects.toThrow(/permission denied/);
  });

  it('a student cannot rename another profile', async () => {
    const updated = await withUser(studentA1, (q) =>
      q(`update public.profiles set full_name = 'Hacked' where id = $1 returning id`, [studentA2]),
    );
    expect(updated).toEqual([]);
  });

  it('a curator sees only the students of their own group', async () => {
    const rows = await withUser(a.curator, (q) => q('select id from public.profiles where role = $1', ['student']));
    expect(rows.map((r) => r.id).sort()).toEqual([studentA1, studentA2].sort());

    const enrollments = await withUser(a.curator, (q) => q('select student_id from public.enrollments'));
    expect(enrollments.map((r) => r.student_id).sort()).toEqual([studentA1, studentA2].sort());
    expect(enrollments.map((r) => r.student_id)).not.toContain(studentOtherGroup);
  });

  it('teacher A cannot see teacher B’s course', async () => {
    const courses = await withUser(a.teacher, (q) => q('select id from public.courses'));
    expect(courses.map((r) => r.id)).toEqual([a.course]);
    const cohorts = await withUser(a.teacher, (q) => q('select id from public.cohorts where id = $1', [b.cohort]));
    expect(cohorts).toEqual([]);
    const enrollments = await withUser(a.teacher, (q) =>
      q('select id from public.enrollments where student_id = $1', [studentB]),
    );
    expect(enrollments).toEqual([]);
  });

  it('a pending student does not see the course; an active one does; an expired active one does not', async () => {
    const pending = await createProfile('student');
    await enroll(pending, a.cohort, { status: 'pending' });
    const expired = await createProfile('student');
    await enroll(expired, a.cohort, { status: 'active', expiresAt: '2020-01-01T00:00:00Z' });

    expect(await withUser(pending, (q) => q('select id from public.courses'))).toEqual([]);
    expect((await withUser(studentA1, (q) => q('select id from public.courses'))).map((r) => r.id)).toEqual([
      a.course,
    ]);
    expect(await withUser(expired, (q) => q('select id from public.courses'))).toEqual([]);

    // the pending student still sees their own enrollment (for the waiting screen)
    const own = await withUser(pending, (q) => q('select status from public.enrollments'));
    expect(own).toEqual([{ status: 'pending' }]);
  });

  it('anon cannot read login_nonces', async () => {
    await sql(`insert into public.login_nonces (nonce, expires_at) values ($1, now() + interval '10 minutes')`, [
      `n-${Math.random()}`,
    ]);
    await expect(withUser(null, (q) => q('select * from public.login_nonces'))).rejects.toThrow(/permission denied/);
    await expect(withUser(studentA1, (q) => q('select * from public.login_nonces'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('anon sees no profiles or courses', async () => {
    expect(await withUser(null, (q) => q('select id from public.profiles'))).toEqual([]);
    expect(await withUser(null, (q) => q('select id from public.courses'))).toEqual([]);
  });

  it('a student cannot create or activate their own enrollment', async () => {
    const pending = await createProfile('student');
    await enroll(pending, a.cohort, { status: 'pending' });
    await expect(
      withUser(pending, (q) =>
        q(`insert into public.enrollments (student_id, cohort_id, status) values ($1, $2, 'active')`, [
          pending,
          b.cohort,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withUser(pending, (q) =>
      q(`update public.enrollments set status = 'active' where student_id = $1 returning id`, [pending]),
    );
    expect(updated).toEqual([]);
  });

  it('a teacher manages enrollments of their own cohort only', async () => {
    const applicant = await createProfile('student');
    const id = await enroll(applicant, a.cohort, { status: 'pending' });
    const approved = await withUser(a.teacher, (q) =>
      q(
        `update public.enrollments set status = 'active', curator_group_id = $2, approved_by = auth.uid(), approved_at = now()
         where id = $1 returning status`,
        [id, a.group],
      ),
    );
    expect(approved).toEqual([{ status: 'active' }]);
    await expect(
      withUser(a.teacher, (q) =>
        q(`insert into public.enrollments (student_id, cohort_id) values ($1, $2)`, [applicant, b.cohort]),
      ),
    ).rejects.toThrow(/row-level security/);
    // moving a student into a group of another cohort violates the composite FK
    await expect(
      withUser(a.teacher, (q) => q(`update public.enrollments set curator_group_id = $2 where id = $1`, [id, b.group])),
    ).rejects.toThrow(/foreign key/);
  });

  it('a teacher cannot create a course on behalf of another teacher', async () => {
    await expect(
      withUser(a.teacher, (q) =>
        q(`insert into public.courses (teacher_id, title, slug) values ($1, 'X', $2)`, [b.teacher, `x-${Date.now()}`]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a student wrongly set as a group’s curator_id gains no curator access', async () => {
    const student = await createActiveStudent(a.cohort, a.group);
    const group = await createGroup(a.cohort, student);
    const peer = await createActiveStudent(a.cohort, group);
    const profiles = await withUser(student, (q) => q('select id from public.profiles'));
    expect(profiles.map((r) => r.id)).toEqual([student]);
    // Since 0012 the student reads only their OWN group (a.group), never the group they "curate".
    const groups = await withUser(student, (q) => q('select id from public.curator_groups'));
    expect(groups.map((r) => r.id)).toEqual([a.group]);
    expect(
      await withUser(student, (q) => q('select id from public.enrollments where student_id = $1', [peer])),
    ).toEqual([]);
  });

  it('teacher A cannot read teacher B’s students’ profiles but reads their own pending applicant and curators', async () => {
    const applicant = await createProfile('student');
    await enroll(applicant, a.cohort, { status: 'pending' });
    const unrelated = await createProfile('student'); // no enrollment anywhere
    const rows = await withUser(a.teacher, (q) => q('select id from public.profiles'));
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([a.teacher, a.curator, studentA1, studentA2, studentOtherGroup, applicant]));
    expect(ids).not.toContain(studentB);
    expect(ids).not.toContain(b.curator);
    expect(ids).not.toContain(b.teacher);
    expect(ids).not.toContain(unrelated);
  });

  it('an admin reads every profile', async () => {
    const admin = await createProfile('admin');
    const rows = await withUser(admin, (q) =>
      q('select id from public.profiles where id = any($1::uuid[])', [[studentA1, studentB, b.teacher]]),
    );
    expect(rows).toHaveLength(3);
  });

  it('a curator stops seeing the profile of an expired or rejected ex-student', async () => {
    const expired = await createProfile('student');
    await enroll(expired, a.cohort, { status: 'active', groupId: a.group, expiresAt: '2020-01-01T00:00:00Z' });
    const rejected = await createProfile('student');
    await enroll(rejected, a.cohort, { status: 'rejected', groupId: a.group });
    const pending = await createProfile('student');
    await enroll(pending, a.cohort, { status: 'pending', groupId: a.group });
    const ids = (await withUser(a.curator, (q) => q('select id from public.profiles'))).map((r) => r.id);
    expect(ids).not.toContain(expired);
    expect(ids).not.toContain(rejected);
    expect(ids).toContain(pending);
  });

  it('authenticated cannot TRUNCATE enrollments', async () => {
    await expect(withUser(a.teacher, (q) => q('truncate public.enrollments'))).rejects.toThrow(/permission denied/);
    await expect(withUser(studentA1, (q) => q('truncate public.profiles'))).rejects.toThrow(/permission denied/);
  });

  it('anon cannot call the RLS helper functions', async () => {
    const calls = [
      'select public.app_role()',
      'select public.is_admin()',
      'select public.teaches_course(gen_random_uuid())',
      'select * from public.active_course_ids()',
      'select * from public.curated_student_ids()',
      'select * from public.taught_student_ids()',
    ];
    for (const text of calls) {
      await expect(withUser(null, (q) => q(text))).rejects.toThrow(/permission denied/);
    }
    // signed-in users still can (RLS evaluates them as the caller)
    const [row] = await withUser(studentA1, (q) => q('select public.app_role() as role'));
    expect(row.role).toBe('student');
  });

  it('a curator sees their own group and cohort, not other groups', async () => {
    const groups = await withUser(a.curator, (q) => q('select id from public.curator_groups'));
    expect(groups.map((r) => r.id)).toEqual([a.group]);
    const cohorts = await withUser(a.curator, (q) => q('select id from public.cohorts'));
    expect(cohorts.map((r) => r.id)).toEqual([a.cohort]);
  });
});
