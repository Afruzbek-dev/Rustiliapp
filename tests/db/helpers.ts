import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll } from 'vitest';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — run the DB suite via `bash scripts/db-test.sh`');
}

/** Superuser pool (the migration owner). Use `sql` for fixtures; it bypasses RLS. */
export const pool = new pg.Pool({ connectionString, max: 2 });

afterAll(async () => {
  await pool.end();
});

export type Row = Record<string, any>;
export type Query = <R extends Row = Row>(text: string, params?: unknown[]) => Promise<R[]>;

/** Run a statement as the superuser (autocommit). For fixtures and assertions only. */
export const sql: Query = async (text, params) => {
  const res = await pool.query(text, params as any[]);
  return res.rows as any;
};

async function inRole<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  uid: string | null,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(
      `select set_config('request.jwt.claim.sub', $1, true),
              set_config('request.jwt.claim.role', $2, true),
              set_config('request.jwt.claims', $3, true)`,
      [uid ?? '', role, JSON.stringify(uid ? { sub: uid, role } : { role })],
    );
    const q: Query = async (text, params) => {
      const res = await client.query(text, params as any[]);
      return res.rows as any;
    };
    return await fn(q);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/**
 * Run `fn` inside a transaction as an API user: `authenticated` with `auth.uid() = uid`,
 * or `anon` when `uid` is null. Always rolled back.
 */
export function withUser<T>(uid: string | null, fn: (q: Query) => Promise<T>): Promise<T> {
  return uid ? inRole('authenticated', uid, fn) : inRole('anon', null, fn);
}

/** Run `fn` inside a transaction as `service_role` (bypasses RLS). Always rolled back. */
export function asService<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return inRole('service_role', null, fn);
}

/** Insert an `auth.users` row and return its id. */
export async function createUser(email: string = `u-${randomUUID()}@test.local`): Promise<string> {
  const [row] = await sql<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
  return row.id;
}
