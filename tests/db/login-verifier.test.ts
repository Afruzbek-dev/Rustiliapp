import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';

describe('0011 login verifier', () => {
  it('has a verifier_hash column that stores a sha256 hex digest', async () => {
    const cols = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'login_nonces' and column_name = 'verifier_hash'`,
    );
    expect(cols).toHaveLength(1);
    const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const nonce = `v-${randomBytes(8).toString('hex')}`;
    await sql(
      `insert into public.login_nonces (nonce, verifier_hash, expires_at) values ($1, $2, now() + interval '10 minutes')`,
      [nonce, hash],
    );
    const [row] = await sql(`select verifier_hash from public.login_nonces where nonce = $1`, [nonce]);
    expect(row.verifier_hash).toBe(hash);
  });

  it('anon and authenticated cannot read or write login_nonces (incl. verifier_hash)', async () => {
    await expect(withUser(null, (q) => q('select verifier_hash from public.login_nonces'))).rejects.toThrow(
      /permission denied/,
    );
    const uid = '00000000-0000-0000-0000-000000000001';
    await expect(withUser(uid, (q) => q('select verifier_hash from public.login_nonces'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(withUser(null, (q) => q(`update public.login_nonces set verifier_hash = 'x'`))).rejects.toThrow(
      /permission denied/,
    );
  });
});
