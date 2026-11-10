import { describe, expect, it } from 'vitest';
import { asService, createUser, withUser } from './helpers';

describe('db harness', () => {
  it('withUser(x) sets auth.uid() to x', async () => {
    const uid = await createUser();
    const [row] = await withUser(uid, (q) => q('select auth.uid() as uid, auth.role() as role, current_user as cu'));
    expect(row.uid).toBe(uid);
    expect(row.role).toBe('authenticated');
    expect(row.cu).toBe('authenticated');
  });

  it("withUser(null) runs as anon: auth.role() = 'anon', auth.uid() is null", async () => {
    const [row] = await withUser(null, (q) => q('select auth.uid() as uid, auth.role() as role, current_user as cu'));
    expect(row.role).toBe('anon');
    expect(row.uid).toBeNull();
    expect(row.cu).toBe('anon');
  });

  it('asService runs as service_role', async () => {
    const [row] = await asService((q) => q('select current_user as cu, auth.role() as role'));
    expect(row.cu).toBe('service_role');
    expect(row.role).toBe('service_role');
  });

  it('changes made inside a role transaction are rolled back', async () => {
    const uid = await createUser();
    const [deleted] = await asService((q) => q('delete from auth.users where id = $1 returning id', [uid]));
    expect(deleted.id).toBe(uid);
    const [row] = await asService((q) => q('select count(*)::int as n from auth.users where id = $1', [uid]));
    expect(row.n).toBe(1);
  });
});
