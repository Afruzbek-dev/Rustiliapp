import { describe, expect, it } from 'vitest';
import { asService, createUser, pool, withUser } from './helpers';

describe('0005 auth_user_id_by_email', () => {
  it('service_role can look a user up (case-insensitive) and gets null for unknown emails', async () => {
    const email = `tg_${Date.now()}@users.internal`;
    const id = await createUser(email);
    const hit = await asService((q) => q('select public.auth_user_id_by_email($1) as id', [email.toUpperCase()]));
    expect(hit[0]?.id).toBe(id);
    const miss = await asService((q) => q('select public.auth_user_id_by_email($1) as id', ['nobody@users.internal']));
    expect(miss[0]?.id).toBeNull();
  });

  it('anon cannot call it', async () => {
    await expect(withUser(null, (q) => q('select public.auth_user_id_by_email($1)', ['x@y.z']))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('authenticated cannot call it', async () => {
    const uid = await createUser();
    await expect(withUser(uid, (q) => q('select public.auth_user_id_by_email($1)', ['x@y.z']))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('0005 default privileges', () => {
  it('authenticated cannot TRUNCATE a table created after the migrations', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('create table public.zz_late_table (id int)');
      await client.query('set local role authenticated');
      await expect(client.query('truncate public.zz_late_table')).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  });
});
