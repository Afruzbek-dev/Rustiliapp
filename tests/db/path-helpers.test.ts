import { describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';
import { createActiveStudent, createBlock, createCourseWorld, createLesson } from './fixtures';

const ids = (rows: { published_part_ids: string }[]) => rows.map((r) => r.published_part_ids).sort();

describe('0010 published_part_ids', () => {
  it('returns each part once, even with more than 1000 published blocks, and skips unpublished', async () => {
    const w = await createCourseWorld();
    const student = await createActiveStudent(w.cohort, w.group);
    const lesson = await createLesson(w.course);
    await sql(
      `insert into public.blocks (lesson_part_id, position, type, published)
       select $1, g, 'text', true from generate_series(1, 1200) g`,
      [lesson.part1],
    );
    await createBlock(lesson.part2, 1, false);
    const rows = await withUser(student, (q) =>
      q<{ published_part_ids: string }>('select * from public.published_part_ids($1::uuid[])', [
        [lesson.part1, lesson.part2],
      ]),
    );
    expect(ids(rows)).toEqual([lesson.part1]);
  });

  it('is limited by RLS: a student of another course gets nothing for foreign parts', async () => {
    const mine = await createCourseWorld();
    const other = await createCourseWorld();
    const student = await createActiveStudent(mine.cohort, mine.group);
    const foreign = await createLesson(other.course);
    await createBlock(foreign.part1, 1, true);
    const own = await createLesson(mine.course);
    await createBlock(own.part1, 1, true);
    const rows = await withUser(student, (q) =>
      q<{ published_part_ids: string }>('select * from public.published_part_ids($1::uuid[])', [
        [foreign.part1, own.part1],
      ]),
    );
    expect(ids(rows)).toEqual([own.part1]);
  });

  it('is denied to anon', async () => {
    const w = await createCourseWorld();
    const lesson = await createLesson(w.course);
    await expect(
      withUser(null, (q) => q('select * from public.published_part_ids($1::uuid[])', [[lesson.part1]])),
    ).rejects.toThrow(/permission denied/);
  });
});
