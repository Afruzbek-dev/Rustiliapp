import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql, withUser } from './helpers';

const hashOf = () => createHash('sha256').update(randomBytes(32)).digest('hex');

async function nonce(over: { status?: string; tg?: number | null; hash?: string; expires?: string } = {}) {
  const n = `v-${randomBytes(8).toString('hex')}`;
  const hash = over.hash ?? hashOf();
  await sql(
    `insert into public.login_nonces (nonce, telegram_id, status, verifier_hash, expires_at)
     values ($1, $2, $3, $4, now() + $5::interval)`,
    [n, over.tg === undefined ? 777 : over.tg, over.status ?? 'confirmed', hash, over.expires ?? '10 minutes'],
  );
  return { n, hash };
}
const consume = async (n: string, h: string) =>
  (await sql<{ v: string | null }>(`select public.consume_login_nonce($1, $2) as v`, [n, h]))[0]!.v;
const statusOf = async (n: string) =>
  (await sql(`select status from public.login_nonces where nonce = $1`, [n]))[0]?.status;

describe('0011 login verifier', () => {
  it('has a verifier_hash column that only accepts a sha256 hex digest, and the indexes exist', async () => {
    const { n, hash } = await nonce();
    const [row] = await sql(`select verifier_hash from public.login_nonces where nonce = $1`, [n]);
    expect(row.verifier_hash).toBe(hash);
    await expect(
      sql(`insert into public.login_nonces (nonce, verifier_hash, expires_at) values ('bad', 'XYZ', now())`),
    ).rejects.toThrow(/check/);
    const idx = await sql<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'login_nonces'`,
    );
    expect(idx.map((i) => i.indexname)).toEqual(
      expect.arrayContaining(['login_nonces_expires_at_idx', 'login_nonces_telegram_id_idx']),
    );
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

  it('consume_login_nonce succeeds exactly once and returns the telegram id', async () => {
    const { n, hash } = await nonce({ tg: 4242 });
    expect(Number(await consume(n, hash))).toBe(4242);
    expect(await statusOf(n)).toBe('consumed');
    expect(await consume(n, hash)).toBeNull();
  });

  it('consume_login_nonce fails for a wrong verifier, an expired row and a non-confirmed row', async () => {
    const wrong = await nonce();
    expect(await consume(wrong.n, hashOf())).toBeNull();
    expect(await statusOf(wrong.n)).toBe('confirmed');

    const expired = await nonce({ expires: '-1 minute' });
    expect(await consume(expired.n, expired.hash)).toBeNull();
    expect(await statusOf(expired.n)).toBe('confirmed');

    const created = await nonce({ status: 'created', tg: null });
    expect(await consume(created.n, created.hash)).toBeNull();
    expect(await statusOf(created.n)).toBe('created');

    expect(await consume('does-not-exist', hashOf())).toBeNull();
  });

  it('concurrent consumes: exactly one wins', async () => {
    const { n, hash } = await nonce();
    const results = await Promise.all([consume(n, hash), consume(n, hash), consume(n, hash)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('consume and purge are service-role only', async () => {
    const uid = '00000000-0000-0000-0000-000000000001';
    for (const who of [null, uid]) {
      await expect(withUser(who, (q) => q(`select public.consume_login_nonce('a', 'b')`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(withUser(who, (q) => q(`select public.purge_login_nonces()`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('purge removes only long-expired rows, bounded by the limit', async () => {
    const old = await nonce({ expires: '-2 hours' });
    const recent = await nonce({ expires: '-5 minutes' });
    const live = await nonce();
    await sql(`select public.purge_login_nonces(100000)`);
    expect(await statusOf(old.n)).toBeUndefined();
    expect(await statusOf(recent.n)).toBe('confirmed');
    expect(await statusOf(live.n)).toBe('confirmed');
  });
});
