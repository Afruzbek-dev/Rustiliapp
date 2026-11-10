import { pool, withUser, type Query } from '../db/helpers';
import type { AttemptStore } from '@/server/attempts';

// AttemptStore backed by the local Postgres: reads that Supabase does with the user-scoped client
// run as `authenticated` with auth.uid() = student (so RLS decides), key/attempt/XP operations run
// as `service_role` and COMMIT (the db helpers always roll back, so we manage our own tx here).
export async function asServiceCommitted<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const out = await fn(async (text, params) => (await client.query(text, params)).rows);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function pgStore(userId: string | null): AttemptStore {
  return {
    async getRole(id) {
      const rows = await withUser(id, (q) => q('select role from public.profiles where id = $1', [id]));
      return rows[0]?.role ?? null;
    },
    async getVisibleExercise(exerciseId) {
      const rows = await withUser(userId, (q) =>
        q(
          `select e.id, e.type, e.check_mode, b.lesson_part_id
             from public.exercises e left join public.blocks b on b.id = e.block_id
            where e.id = $1`,
          [exerciseId],
        ),
      );
      const r = rows[0];
      return r ? { id: r.id, type: r.type, checkMode: r.check_mode, partId: r.lesson_part_id ?? null } : null;
    },
    isTestItem: (id) =>
      asServiceCommitted(async (q) => (await q('select 1 from public.test_items where exercise_id = $1', [id])).length > 0),
    getKey: (id) =>
      asServiceCommitted(async (q) => (await q('select answer from public.exercise_keys where exercise_id = $1', [id]))[0]?.answer ?? null),
    countPriorAttempts: (s, e, item) =>
      asServiceCommitted(async (q) => {
        const r = (await q('select total, correct from public.attempt_stats($1,$2,$3)', [s, e, item]))[0];
        return { total: Number(r.total), correct: Number(r.correct) };
      }),
    insertAttempt: (s, e, answer, ok) =>
      asServiceCommitted(async (q) => {
        await q('insert into public.attempts (student_id, exercise_id, answer, is_correct) values ($1,$2,$3,$4)', [
          s,
          e,
          JSON.stringify(answer),
          ok,
        ]);
      }),
    awardXp: (s, amount, reason, ref) =>
      asServiceCommitted(async (q) => (await q('select public.award_xp($1,$2,$3::public.xp_reason,$4) as ok', [s, amount, reason, ref]))[0].ok === true),
    getPartExercises: (partId) =>
      asServiceCommitted(async (q) =>
        (
          await q(
            `select e.id, e.type, e.check_mode, k.answer
               from public.blocks b join public.exercises e on e.block_id = b.id
               left join public.exercise_keys k on k.exercise_id = e.id
              where b.lesson_part_id = $1 and b.published`,
            [partId],
          )
        ).map((r) => ({ id: r.id, type: r.type, checkMode: r.check_mode, key: r.answer ?? null })),
      ),
    getCorrectRefs: (s, part) =>
      asServiceCommitted(async (q) =>
        (await q('select exercise_id, item_id from public.correct_refs($1,$2)', [s, part])).map((r) => ({
          exerciseId: r.exercise_id,
          itemId: r.item_id ?? null,
        })),
      ),
    getSubmittedExerciseIds: (s, ids) =>
      asServiceCommitted(async (q) =>
        (
          await q('select distinct exercise_id from public.submissions where student_id = $1 and exercise_id = any($2::uuid[])', [s, ids])
        ).map((r) => r.exercise_id as string),
      ),
    ensurePartStarted: (s, p) =>
      asServiceCommitted(async (q) => {
        await q('insert into public.part_progress (student_id, lesson_part_id) values ($1,$2) on conflict do nothing', [s, p]);
      }),
    markPartCompleted: (s, p) =>
      asServiceCommitted(
        async (q) =>
          (
            await q(
              `update public.part_progress set status = 'completed', completed_at = now()
                where student_id = $1 and lesson_part_id = $2 and status <> 'completed' returning 1`,
              [s, p],
            )
          ).length > 0,
      ),
  };
}

