import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createExercise, createGroup, createLesson, createProfile } from './fixtures';

describe('0013 notification lease (token-scoped)', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let exercise: string;
  let exercise2: string;
  let student: string;

  beforeAll(async () => {
    world = await createCourseWorld();
    const lesson = await createLesson(world.course);
    exercise = await createExercise(await createBlock(lesson.part2, 1, true, 'speaking'), { type: 'speaking', checkMode: 'review', answer: {} });
    exercise2 = await createExercise(await createBlock(lesson.part2, 2, true, 'speaking'), { type: 'speaking', checkMode: 'review', answer: {} });
    student = await createActiveStudent(world.cohort, world.group);
  });

  async function videoRow() {
    const s = await createActiveStudent(world.cohort, world.group);
    const [r] = await sql(`select * from public.create_video_submission($1, $2, $3, 'F', $4, 1)`, [s, exercise, world.group, randomUUID()]);
    return { s, id: r.submission_id as string };
  }
  // The token is read as text so microseconds survive the round trip.
  const claim = (id: string, s: string) =>
    sql(`select public.claim_submission_notification($1, $2)::text as t`, [id, s]).then((r) => r[0].t as string | null);
  const release = (id: string, token: string | null) => sql('select public.release_submission_notification($1, $2::timestamptz)', [id, token]);
  const claimedAt = (id: string) => sql('select notify_claimed_at::text t from public.submissions where id = $1', [id]).then((r) => r[0].t as string | null);

  it('concurrency: 8 parallel claims -> exactly one token', async () => {
    const { s, id } = await videoRow();
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(id, s)));
    expect(results.filter((t) => t !== null)).toHaveLength(1);
  });

  it('the token is the stored claim timestamp', async () => {
    const { s, id } = await videoRow();
    const token = await claim(id, s);
    expect(token).not.toBeNull();
    expect(await claimedAt(id)).toBe(token);
  });

  it('release with the right token lets a retry claim; notified_at ends the lease for good', async () => {
    const { s, id } = await videoRow();
    const t1 = (await claim(id, s))!;
    expect(await claim(id, s)).toBeNull();
    await release(id, t1);
    const t2 = await claim(id, s);
    expect(t2).not.toBeNull();
    await sql('update public.submissions set notified_at = now() where id = $1', [id]);
    await release(id, t2);
    expect(await claim(id, s)).toBeNull();
  });

  it("a stale holder's release is a no-op after the lease was re-claimed", async () => {
    const { s, id } = await videoRow();
    const stale = (await claim(id, s))!;
    await sql(`update public.submissions set notify_claimed_at = now() - interval '121 seconds' where id = $1`, [id]);
    const fresh = (await claim(id, s))!;
    expect(fresh).not.toBe(stale);
    await release(id, stale); // the old worker gives up late
    expect(await claimedAt(id)).toBe(fresh); // the newer lease survives
    expect(await claim(id, s)).toBeNull();
    await release(id, fresh);
    expect(await claimedAt(id)).toBeNull();
  });

  it('an expired lease (older than 2 minutes) can be re-claimed; a fresh one cannot', async () => {
    const { s, id } = await videoRow();
    await claim(id, s);
    await sql(`update public.submissions set notify_claimed_at = now() - interval '119 seconds' where id = $1`, [id]);
    expect(await claim(id, s)).toBeNull();
    await sql(`update public.submissions set notify_claimed_at = now() - interval '121 seconds' where id = $1`, [id]);
    expect(await claim(id, s)).not.toBeNull();
  });

  it("only the owner's completed submissions are claimable (foreign student, unfinished audio)", async () => {
    const { id } = await videoRow();
    const other = await createActiveStudent(world.cohort, world.group);
    expect(await claim(id, other)).toBeNull();
    const [audio] = await sql(`select * from public.create_audio_submission($1, $2, $3, 'webm')`, [student, exercise2, world.group]);
    expect(await claim(audio.submission_id, student)).toBeNull(); // storage_path is null: unfinished upload
    await sql(`update public.submissions set storage_path = $2 where id = $1`, [audio.submission_id, `${student}/${audio.submission_id}.webm`]);
    expect(await claim(audio.submission_id, student)).not.toBeNull();
  });

  it('both functions are service_role only', async () => {
    const { s, id } = await videoRow();
    await expect(withUser(s, (q) => q('select public.claim_submission_notification($1, $2)', [id, s]))).rejects.toThrow(/permission denied/);
    await expect(withUser(s, (q) => q('select public.release_submission_notification($1, now())', [id]))).rejects.toThrow(/permission denied/);
    await asService(async (q) => {
      expect((await q('select public.claim_submission_notification($1, $2) as t', [id, s]))[0].t).not.toBeNull();
    });
  });

  it('RLS: a curator of another group and a teacher of another course read nothing of a video submission; the owner, group curator and course teacher do', async () => {
    const { s, id } = await videoRow();
    const otherCurator = await createProfile('curator');
    await createGroup(world.cohort, otherCurator);
    const otherTeacher = await createProfile('teacher');
    const read = (uid: string) => withUser(uid, (q) => q('select id from public.submissions where id = $1', [id]));
    expect(await read(otherCurator)).toHaveLength(0);
    expect(await read(otherTeacher)).toHaveLength(0);
    for (const uid of [s, world.curator, world.teacher]) expect(await read(uid)).toHaveLength(1);
  });
});
