import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, withUser } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCourseWorld,
  createExercise,
  createGroup,
  createLesson,
  createProfile,
} from './fixtures';

describe('0009 storage: submissions bucket', () => {
  let world: Awaited<ReturnType<typeof createCourseWorld>>;
  let student: string;
  let other: string;
  let otherCurator: string;
  let incompleteName: string;
  let name: string;

  async function putObject(path: string) {
    await sql(`insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [path]);
  }

  beforeAll(async () => {
    world = await createCourseWorld();
    student = await createActiveStudent(world.cohort, world.group);
    other = await createActiveStudent(world.cohort, world.group);
    otherCurator = await createProfile('curator');
    await createGroup(world.cohort, otherCurator);
    const lesson = await createLesson(world.course);
    const block = await createBlock(lesson.part2, 1, true, 'speaking');
    const ex = await createExercise(block, { type: 'speaking', checkMode: 'review', answer: {} });

    const subId = randomUUID();
    name = `${student}/${subId}.webm`;
    await sql(
      `insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind, storage_path)
       values ($1, $2, $3, $4, 'audio', $5)`,
      [subId, student, ex, world.group, name],
    );
    await putObject(name);

    // an upload that was never completed: row has no storage_path yet
    const incId = randomUUID();
    incompleteName = `${student}/${incId}.webm`;
    await sql(
      `insert into public.submissions (id, student_id, exercise_id, curator_group_id, kind)
       values ($1, $2, $3, $4, 'audio')`,
      [incId, student, ex, world.group],
    );
    await putObject(incompleteName);
  });

  const read = (uid: string | null, path = name) =>
    withUser(uid, (q) => q(`select name from storage.objects where bucket_id = 'submissions' and name = $1`, [path]));

  it('bucket is private, size-limited and mime-restricted', async () => {
    const [b] = await sql(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'submissions'`);
    expect(b.public).toBe(false);
    expect(Number(b.file_size_limit)).toBe(10485760);
    expect(b.allowed_mime_types).toEqual(['audio/webm', 'audio/mp4', 'audio/ogg']);
  });

  it('the student reads their own object', async () => {
    expect(await read(student)).toHaveLength(1);
  });

  it('another student cannot read it', async () => {
    expect(await read(other)).toHaveLength(0);
  });

  it('the curator of the submission group can read it', async () => {
    expect(await read(world.curator)).toHaveLength(1);
  });

  it('the course teacher can read it', async () => {
    expect(await read(world.teacher)).toHaveLength(1);
  });

  it('a curator of another group cannot read it', async () => {
    expect(await read(otherCurator)).toHaveLength(0);
  });

  it('anon cannot read it', async () => {
    await expect(read(null)).rejects.toThrow(/permission denied/);
  });

  it('a curator cannot read the object of an uncompleted submission; the student still can', async () => {
    expect(await read(world.curator, incompleteName)).toHaveLength(0);
    expect(await read(student, incompleteName)).toHaveLength(1);
  });

  it('a curator cannot read a forged object name pointing at someone else’s folder', async () => {
    const [{ id }] = await sql(`select id from public.submissions where storage_path = $1`, [name]);
    const forged = `${other}/${id}.webm`;
    await putObject(forged);
    expect(await read(world.curator, forged)).toHaveLength(0);
  });

  it('nobody authenticated can write objects', async () => {
    for (const uid of [student, world.curator, world.teacher]) {
      await expect(
        withUser(uid, (q) => q(`insert into storage.objects (bucket_id, name) values ('submissions', $1)`, [`${uid}/${randomUUID()}.webm`])),
      ).rejects.toThrow(/permission denied/);
      await expect(withUser(uid, (q) => q(`update storage.objects set name = name || 'x' where name = $1`, [name]))).rejects.toThrow(
        /permission denied/,
      );
      await expect(withUser(uid, (q) => q(`delete from storage.objects where name = $1`, [name]))).rejects.toThrow(/permission denied/);
    }
  });

  it('authenticated cannot truncate or alter buckets', async () => {
    await expect(withUser(student, (q) => q('truncate storage.objects'))).rejects.toThrow(/permission denied/);
    await expect(withUser(student, (q) => q(`update storage.buckets set public = true where id = 'submissions'`))).rejects.toThrow(
      /permission denied/,
    );
  });
});
