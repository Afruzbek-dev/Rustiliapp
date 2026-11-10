import { describe, expect, it } from 'vitest';
import { asService, sql, withUser } from './helpers';
import { createProfile } from './fixtures';

const tashkentToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

async function addXp(student: string, n: number, amount: number) {
  await sql(
    `insert into public.xp_events (student_id, amount, reason, ref_id)
     select $1, $2, 'exercise_correct', g::text from generate_series(1, $3::int) g`,
    [student, amount, n],
  );
}

describe('0007 my_total_xp', () => {
  it('sums more than 1000 events correctly', async () => {
    const s = await createProfile('student');
    await addXp(s, 1500, 2);
    const [row] = await withUser(s, (q) => q('select public.my_total_xp() as total'));
    expect(Number(row.total)).toBe(3000);
  });

  it('is 0 for a student with no events', async () => {
    const s = await createProfile('student');
    const [row] = await withUser(s, (q) => q('select public.my_total_xp() as total'));
    expect(Number(row.total)).toBe(0);
  });

  it("never counts another student's events, even for staff who can read them", async () => {
    const a = await createProfile('student');
    const b = await createProfile('student');
    const curator = await createProfile('curator');
    await addXp(a, 5, 10);
    await addXp(b, 3, 10);
    const [ra] = await withUser(a, (q) => q('select public.my_total_xp() as total'));
    const [rb] = await withUser(b, (q) => q('select public.my_total_xp() as total'));
    const [rc] = await withUser(curator, (q) => q('select public.my_total_xp() as total'));
    expect(Number(ra.total)).toBe(50);
    expect(Number(rb.total)).toBe(30);
    expect(Number(rc.total)).toBe(0);
  });

  it('cannot be called by anon', async () => {
    await expect(withUser(null, (q) => q('select public.my_total_xp()'))).rejects.toThrow(/permission denied/);
  });
});

describe('0007 bump_daily_task', () => {
  it('creates and increments today\'s Tashkent row as JSON numbers', async () => {
    const s = await createProfile('student');
    await asService(async (q) => {
      await q(`select public.bump_daily_task($1, 'words', 4)`, [s]);
      await q(`select public.bump_daily_task($1, 'words', 3)`, [s]);
      await q(`select public.bump_daily_task($1, 'grammar')`, [s]);
      const rows = await q(
        `select day::text as day, xp, tasks, jsonb_typeof(tasks -> 'words') as t from public.daily_activity where student_id = $1`,
        [s],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].day).toBe(tashkentToday());
      expect(rows[0].xp).toBe(0);
      expect(rows[0].tasks).toEqual({ words: 7, grammar: 1 });
      expect(rows[0].t).toBe('number');
    });
  });

  it('keeps existing xp on the row', async () => {
    const s = await createProfile('student');
    await sql(`insert into public.daily_activity (student_id, day, xp) values ($1, $2, 25)`, [s, tashkentToday()]);
    await asService(async (q) => {
      await q(`select public.bump_daily_task($1, 'audio')`, [s]);
      const [row] = await q(`select xp, tasks from public.daily_activity where student_id = $1`, [s]);
      expect(row.xp).toBe(25);
      expect(row.tasks).toEqual({ audio: 1 });
    });
  });

  it('rejects unknown keys and bad increments', async () => {
    const s = await createProfile('student');
    await asService(async (q) => {
      await expect(q(`select public.bump_daily_task($1, 'bogus')`, [s])).rejects.toThrow(/invalid key/);
    });
    await asService(async (q) => {
      await expect(q(`select public.bump_daily_task($1, 'words', 0)`, [s])).rejects.toThrow(/increment/);
    });
  });

  it('is service_role only', async () => {
    const s = await createProfile('student');
    await expect(withUser(s, (q) => q(`select public.bump_daily_task($1, 'words')`, [s]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(withUser(null, (q) => q(`select public.bump_daily_task($1, 'words')`, [s]))).rejects.toThrow(
      /permission denied/,
    );
  });
});
