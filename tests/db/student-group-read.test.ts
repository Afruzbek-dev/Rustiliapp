import { describe, expect, it } from 'vitest';
import { withUser } from './helpers';
import { createCourseWorld, createGroup, createProfile, enroll } from './fixtures';

const past = () => new Date(Date.now() - 86_400_000).toISOString();

describe('0012 student reads own curator group', () => {
  it('reads only the group of an active enrollment, not other groups of the same cohort', async () => {
    const w = await createCourseWorld();
    const other = await createGroup(w.cohort, await createProfile('curator'));
    const student = await createProfile('student');
    await enroll(student, w.cohort, { status: 'active', groupId: w.group });
    const rows = await withUser(student, (q) => q('select id, name from public.curator_groups'));
    expect(rows.map((r) => r.id)).toEqual([w.group]);
    expect(rows.map((r) => r.id)).not.toContain(other);
    const [mine] = await withUser(student, (q) => q('select * from public.my_group_ids() as id'));
    expect(mine.id).toBe(w.group);
  });

  it('does not expose the curator profile or fellow students', async () => {
    const w = await createCourseWorld();
    const student = await createProfile('student');
    const fellow = await createProfile('student');
    await enroll(student, w.cohort, { status: 'active', groupId: w.group });
    await enroll(fellow, w.cohort, { status: 'active', groupId: w.group });
    const profiles = await withUser(student, (q) => q('select id from public.profiles'));
    expect(profiles.map((r) => r.id)).toEqual([student]);
    const enrollments = await withUser(student, (q) => q('select student_id from public.enrollments'));
    expect(enrollments.map((r) => r.student_id)).toEqual([student]);
  });

  it('gives nothing for pending, rejected or expired enrollments', async () => {
    const w = await createCourseWorld();
    const pending = await createProfile('student');
    const rejected = await createProfile('student');
    const expired = await createProfile('student');
    const lapsed = await createProfile('student');
    await enroll(pending, w.cohort, { status: 'pending', groupId: w.group });
    await enroll(rejected, w.cohort, { status: 'rejected', groupId: w.group });
    await enroll(expired, w.cohort, { status: 'expired', groupId: w.group });
    await enroll(lapsed, w.cohort, { status: 'active', groupId: w.group, expiresAt: past() });
    for (const s of [pending, rejected, expired, lapsed]) {
      expect(await withUser(s, (q) => q('select id from public.curator_groups'))).toEqual([]);
    }
  });

  it('a student with a foreign cohort enrollment sees only that group', async () => {
    const a = await createCourseWorld();
    const b = await createCourseWorld();
    const student = await createProfile('student');
    await enroll(student, b.cohort, { status: 'active', groupId: b.group });
    const rows = await withUser(student, (q) => q('select id from public.curator_groups'));
    expect(rows.map((r) => r.id)).toEqual([b.group]);
    expect(rows.map((r) => r.id)).not.toContain(a.group);
  });

  it('the policy does not grant writes', async () => {
    const w = await createCourseWorld();
    const student = await createProfile('student');
    await enroll(student, w.cohort, { status: 'active', groupId: w.group });
    const updated = await withUser(student, (q) =>
      q(`update public.curator_groups set name = 'x' where id = $1 returning id`, [w.group]),
    ).catch(() => []);
    expect(updated).toEqual([]);
  });

  it('is denied to anon', async () => {
    await expect(withUser(null, (q) => q('select * from public.my_group_ids()'))).rejects.toThrow(/permission denied/);
    const w = await createCourseWorld();
    expect(await withUser(null, (q) => q('select id from public.curator_groups where id = $1', [w.group]))).toEqual([]);
  });
});
