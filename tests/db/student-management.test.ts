import { beforeAll, describe, expect, it } from 'vitest';
import { pool, sql, withUser, type Query } from './helpers';
import {
  createActiveStudent,
  createBlock,
  createCohort,
  createCourseWorld,
  createGroup,
  createLesson,
  createProfile,
  enroll,
} from './fixtures';

/** Runs `fn` as service_role and COMMITS (the helper in helpers.ts always rolls back). */
async function asService<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const q: Query = async (text, params) => (await client.query(text, params)).rows;
    const out = await fn(q);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const rejects = async (p: Promise<unknown>, re: RegExp) => {
  await expect(p).rejects.toThrow(re);
};

describe('0017 student management', () => {
  let A: Awaited<ReturnType<typeof createCourseWorld>>;
  let B: Awaited<ReturnType<typeof createCourseWorld>>;
  let admin: string;
  let groupA2: string;
  let sMadina: string;
  let sBobur: string;
  let sPending: string;
  let sExpired: string;
  let sRejected: string;
  let enrMadina: string;
  let enrBobur: string;
  let enrPending: string;
  let enrExpired: string;
  let enrRejected: string;
  let foreignStudent: string;
  let foreignEnr: string;

  beforeAll(async () => {
    A = await createCourseWorld();
    B = await createCourseWorld();
    admin = await createProfile('admin', 'Admin');
    groupA2 = await createGroup(A.cohort, null);
    await sql(`update public.curator_groups set name = 'Guruh 2' where id = $1`, [groupA2]);

    sMadina = await createProfile('student', 'Madina Rahimova');
    sBobur = await createProfile('student', 'Bobur Aliyev');
    sPending = await createProfile('student', 'Pending Person');
    sExpired = await createProfile('student', 'Expired Person');
    sRejected = await createProfile('student', 'Rejected Person');
    await sql(`update public.profiles set phone = '+998901112233', telegram_id = 5550001 where id = $1`, [sMadina]);
    await sql(`update public.profiles set phone = '+998907776655' where id = $1`, [sBobur]);
    enrMadina = await enroll(sMadina, A.cohort, { status: 'active', groupId: A.group });
    enrBobur = await enroll(sBobur, A.cohort, { status: 'active', groupId: null });
    enrPending = await enroll(sPending, A.cohort, { status: 'pending' });
    enrExpired = await enroll(sExpired, A.cohort, { status: 'active', groupId: A.group, expiresAt: new Date(Date.now() - 86400_000).toISOString() });
    enrRejected = await enroll(sRejected, A.cohort, { status: 'rejected' });
    foreignStudent = await createActiveStudent(B.cohort, B.group, 'Foreign Student');
    const [fe] = await sql(`select id from public.enrollments where student_id = $1`, [foreignStudent]);
    foreignEnr = fe.id;
  });

  const list = (uid: string | null, args: unknown[]) =>
    withUser(uid, (q) =>
      q(`select * from public.manage_student_list($1, $2, $3, $4, $5, $6, $7)`, args),
    );
  // (cohort, search, status, group, ungrouped, limit, offset)
  const L = (cohort: string, o: { search?: string; status?: string; group?: string; ungrouped?: boolean; limit?: number; offset?: number } = {}) => [
    cohort, o.search ?? null, o.status ?? null, o.group ?? null, o.ungrouped ?? false, o.limit ?? 25, o.offset ?? 0,
  ];

  describe('manage_student_list', () => {
    it('teacher sees every enrollment of the own cohort with effective status', async () => {
      const rows = await list(A.teacher, L(A.cohort));
      expect(rows.map((r) => r.full_name)).toEqual([
        'Bobur Aliyev', 'Expired Person', 'Madina Rahimova', 'Pending Person', 'Rejected Person',
      ]);
      const by = Object.fromEntries(rows.map((r) => [r.full_name, r]));
      expect(by['Expired Person'].status).toBe('expired'); // active but lapsed
      expect(by['Madina Rahimova']).toMatchObject({ status: 'active', telegram_linked: true, group_id: A.group, total_count: 5 });
      expect(by['Bobur Aliyev']).toMatchObject({ telegram_linked: false, group_id: null, group_name: null });
    });

    it('admin sees it, foreign teacher / curator / student / anon get nothing', async () => {
      expect(await list(admin, L(A.cohort))).toHaveLength(5);
      expect(await list(B.teacher, L(A.cohort))).toEqual([]);
      expect(await list(A.curator, L(A.cohort))).toEqual([]);
      expect(await list(sMadina, L(A.cohort))).toEqual([]);
      await rejects(list(null, L(A.cohort)), /permission denied/); // anon cannot even execute it
      // and a teacher cannot read the other cohort
      expect(await list(A.teacher, L(B.cohort))).toEqual([]);
    });

    it('filters by status, group, ungrouped', async () => {
      expect((await list(A.teacher, L(A.cohort, { status: 'active' }))).map((r) => r.full_name)).toEqual(['Bobur Aliyev', 'Madina Rahimova']);
      expect((await list(A.teacher, L(A.cohort, { status: 'expired' }))).map((r) => r.full_name)).toEqual(['Expired Person']);
      expect((await list(A.teacher, L(A.cohort, { status: 'pending' }))).map((r) => r.full_name)).toEqual(['Pending Person']);
      expect((await list(A.teacher, L(A.cohort, { status: 'rejected' }))).map((r) => r.full_name)).toEqual(['Rejected Person']);
      expect(await list(A.teacher, L(A.cohort, { status: 'bogus' }))).toEqual([]);
      expect((await list(A.teacher, L(A.cohort, { group: A.group }))).map((r) => r.full_name)).toEqual(['Expired Person', 'Madina Rahimova']);
      expect((await list(A.teacher, L(A.cohort, { ungrouped: true }))).map((r) => r.full_name)).toEqual(['Bobur Aliyev', 'Pending Person', 'Rejected Person']);
    });

    it('searches by name substring and phone suffix, treating wildcards literally', async () => {
      expect((await list(A.teacher, L(A.cohort, { search: 'madi' }))).map((r) => r.full_name)).toEqual(['Madina Rahimova']);
      expect((await list(A.teacher, L(A.cohort, { search: '2233' }))).map((r) => r.full_name)).toEqual(['Madina Rahimova']);
      expect((await list(A.teacher, L(A.cohort, { search: '+998 90 777 66 55' }))).map((r) => r.full_name)).toEqual(['Bobur Aliyev']);
      expect(await list(A.teacher, L(A.cohort, { search: '22' }))).toEqual([]); // < 3 digits: no phone match
      expect(await list(A.teacher, L(A.cohort, { search: '%' }))).toEqual([]);
      expect(await list(A.teacher, L(A.cohort, { search: '_' }))).toEqual([]);
      expect(await list(A.teacher, L(A.cohort, { search: "x' or 1=1 --" }))).toEqual([]);
    });

    it('pages with total_count and clamps the limit to 50', async () => {
      const p1 = await list(A.teacher, L(A.cohort, { limit: 2, offset: 0 }));
      const p2 = await list(A.teacher, L(A.cohort, { limit: 2, offset: 2 }));
      const p3 = await list(A.teacher, L(A.cohort, { limit: 2, offset: 4 }));
      expect([p1.length, p2.length, p3.length]).toEqual([2, 2, 1]);
      expect(p1[0].total_count).toBe(5);
      expect(new Set([...p1, ...p2, ...p3].map((r) => r.enrollment_id)).size).toBe(5);
      expect(await list(A.teacher, L(A.cohort, { limit: 1000 }))).toHaveLength(5);
      expect(await list(A.teacher, L(A.cohort, { limit: 0 }))).toHaveLength(1);
      expect(await list(A.teacher, L(A.cohort, { offset: -5 }))).toHaveLength(5);
    });

    it('reports progress as completed / playable parts and the last active day', async () => {
      const lesson = await createLesson(A.course);
      await createBlock(lesson.part1, 1, true);
      await createBlock(lesson.part2, 1, false); // not playable
      await sql(`insert into public.part_progress (student_id, lesson_part_id, status, completed_at) values ($1, $2, 'completed', now())`, [sMadina, lesson.part1]);
      await sql(`insert into public.part_progress (student_id, lesson_part_id, status, completed_at) values ($1, $2, 'completed', now())`, [sMadina, lesson.part2]);
      await sql(`insert into public.daily_activity (student_id, day, xp) values ($1, '2026-03-04', 10)`, [sMadina]);
      const [m] = (await list(A.teacher, L(A.cohort, { search: 'Madina' })));
      expect(m.parts_total).toBe(1);
      expect(m.parts_completed).toBe(1); // the unpublished part does not count
      expect(String(m.last_active)).toContain('2026');
      const [b] = (await list(A.teacher, L(A.cohort, { search: 'Bobur' })));
      expect(b).toMatchObject({ parts_completed: 0, last_active: null });
    });
  });

  describe('manage_cohort_counts / manage_cohorts_overview', () => {
    it('counts per status, empty for outsiders', async () => {
      const [c] = await withUser(A.teacher, (q) => q(`select * from public.manage_cohort_counts($1)`, [A.cohort]));
      expect(c).toMatchObject({ total: 5, active: 2, pending: 1, expired: 1, rejected: 1 });
      expect(c.ungrouped).toBe(2); // Bobur + pending
      expect(await withUser(B.teacher, (q) => q(`select * from public.manage_cohort_counts($1)`, [A.cohort]))).toEqual([]);
      expect(await withUser(sMadina, (q) => q(`select * from public.manage_cohort_counts($1)`, [A.cohort]))).toEqual([]);
    });

    it('overview lists only own cohorts (admin: all) with the open flag', async () => {
      const own = await withUser(A.teacher, (q) => q(`select * from public.manage_cohorts_overview()`));
      expect(own.map((r) => r.cohort_id)).toEqual([A.cohort]);
      expect(own[0]).toMatchObject({ enrollment_open: true, active_students: 2, pending_students: 1, group_count: 2 });
      const all = await withUser(admin, (q) => q(`select cohort_id from public.manage_cohorts_overview()`));
      expect(all.map((r) => r.cohort_id)).toEqual(expect.arrayContaining([A.cohort, B.cohort]));
      expect(await withUser(sMadina, (q) => q(`select * from public.manage_cohorts_overview()`))).toEqual([]);
      expect(await withUser(null, (q) => q(`select * from public.manage_cohorts_overview()`).catch(() => 'denied'))).toBe('denied');
    });
  });

  describe('write functions are service-role only', () => {
    it('API roles cannot execute them at all', async () => {
      for (const uid of [A.teacher, A.curator, sMadina, null]) {
        await rejects(
          withUser(uid, (q) => q(`select * from public.manage_move_student($1, $2, $3)`, [A.teacher, enrBobur, A.group])),
          /permission denied/,
        );
        await rejects(
          withUser(uid, (q) => q(`select public.manage_assign_curator($1, $2, $3)`, [A.teacher, A.group, sMadina])),
          /permission denied/,
        );
        await rejects(
          withUser(uid, (q) => q(`select public.manage_set_expiry($1, $2, now() + interval '1 day')`, [A.teacher, enrBobur])),
          /permission denied/,
        );
      }
    });
  });

  describe('manage_move_student', () => {
    const move = (actor: string, enr: string, group: string | null) =>
      asService((q) => q(`select * from public.manage_move_student($1, $2, $3)`, [actor, enr, group]));

    it('moves, is idempotent, removes from group (service role call is committed only via the pool, so verify inside)', async () => {
      await asService(async (q) => {
        const r1 = await q(`select * from public.manage_move_student($1, $2, $3)`, [A.teacher, enrBobur, A.group]);
        expect(r1[0]).toEqual({ changed: true, previous_group: null });
        const r2 = await q(`select * from public.manage_move_student($1, $2, $3)`, [A.teacher, enrBobur, A.group]);
        expect(r2[0]).toEqual({ changed: false, previous_group: A.group });
        await q(`select * from public.manage_move_student($1, $2, $3)`, [admin, enrBobur, groupA2]);
        const [row] = await q(`select curator_group_id from public.enrollments where id = $1`, [enrBobur]);
        expect(row.curator_group_id).toBe(groupA2);
        await q(`select * from public.manage_move_student($1, $2, null)`, [A.teacher, enrBobur]);
        const [row2] = await q(`select curator_group_id from public.enrollments where id = $1`, [enrBobur]);
        expect(row2.curator_group_id).toBeNull();
      });
    });

    it('denies a foreign teacher, curator, student, unknown actor and unknown enrollment', async () => {
      for (const actor of [B.teacher, A.curator, sMadina, '00000000-0000-0000-0000-000000000000']) {
        await rejects(move(actor, enrMadina, groupA2), /forbidden/);
      }
      await rejects(move(A.teacher, '00000000-0000-0000-0000-000000000000', groupA2), /forbidden/);
      const [row] = await sql(`select curator_group_id from public.enrollments where id = $1`, [enrMadina]);
      expect(row.curator_group_id).toBe(A.group);
    });

    it('group must belong to the same cohort; rejected enrollments cannot move', async () => {
      await rejects(move(A.teacher, enrMadina, B.group), /invalid group/);
      await rejects(move(A.teacher, enrMadina, '00000000-0000-0000-0000-000000000000'), /invalid group/);
      await rejects(move(A.teacher, enrRejected, A.group), /rejected enrollment/);
      // admin cannot bypass the same-cohort rule either
      await rejects(move(admin, foreignEnr, A.group), /invalid group/);
    });

    it('two concurrent moves serialise: the student ends in exactly one group of the cohort', async () => {
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await Promise.all([
          c1.query(`select * from public.manage_move_student($1, $2, $3)`, [A.teacher, enrPending, A.group]),
          c2.query(`select * from public.manage_move_student($1, $2, $3)`, [A.teacher, enrPending, groupA2]),
        ]);
      } finally {
        c1.release();
        c2.release();
      }
      const rows = await sql(`select curator_group_id, cohort_id from public.enrollments where student_id = $1`, [sPending]);
      expect(rows).toHaveLength(1);
      expect([A.group, groupA2]).toContain(rows[0].curator_group_id);
      const [{ same }] = await sql(
        `select (select cohort_id from public.curator_groups where id = $1) = $2 as same`,
        [rows[0].curator_group_id, rows[0].cohort_id],
      );
      expect(same).toBe(true);
      await sql(`update public.enrollments set curator_group_id = null where id = $1`, [enrPending]);
    });

    it('the schema itself refuses a group of another cohort (composite FK)', async () => {
      await rejects(
        sql(`update public.enrollments set curator_group_id = $1 where id = $2`, [B.group, enrMadina]),
        /foreign key|violates/,
      );
    });
  });

  describe('manage_bulk_move', () => {
    const bulk = (actor: string, cohort: string, group: string | null, ids: string[]) =>
      asService(async (q) => {
        const r = await q(`select public.manage_bulk_move($1, $2, $3, $4::uuid[]) as n`, [actor, cohort, group, ids]);
        return r[0].n as number;
      });

    it('moves several, skips rejected, counts only real changes', async () => {
      const n = await bulk(A.teacher, A.cohort, groupA2, [enrMadina, enrBobur, enrRejected, enrMadina]);
      expect(n).toBe(2); // madina + bobur; rejected skipped; duplicate id ignored
      const rows = await sql(`select id, curator_group_id from public.enrollments where id = any($1::uuid[])`, [[enrMadina, enrBobur, enrRejected]]);
      const g = Object.fromEntries(rows.map((r) => [r.id, r.curator_group_id]));
      expect(g[enrMadina]).toBe(groupA2);
      expect(g[enrBobur]).toBe(groupA2);
      expect(g[enrRejected]).toBeNull();
      expect(await bulk(A.teacher, A.cohort, groupA2, [enrMadina])).toBe(0);
      // restore
      await bulk(A.teacher, A.cohort, A.group, [enrMadina]);
      await bulk(A.teacher, A.cohort, null, [enrBobur]);
    });

    it('is all-or-nothing: an id of another cohort aborts the whole call', async () => {
      await rejects(bulk(A.teacher, A.cohort, groupA2, [enrBobur, foreignEnr]), /outside the cohort/);
      const [r] = await sql(`select curator_group_id from public.enrollments where id = $1`, [enrBobur]);
      expect(r.curator_group_id).toBeNull();
    });

    it('rejects 0 or more than 100 ids, a foreign group, and foreign actors', async () => {
      await rejects(bulk(A.teacher, A.cohort, groupA2, []), /between 1 and 100/);
      const many = Array.from({ length: 101 }, () => crypto.randomUUID());
      await rejects(bulk(A.teacher, A.cohort, groupA2, many), /between 1 and 100/);
      await rejects(bulk(A.teacher, A.cohort, B.group, [enrBobur]), /invalid group/);
      await rejects(bulk(B.teacher, A.cohort, groupA2, [enrBobur]), /forbidden/);
      await rejects(bulk(A.curator, A.cohort, groupA2, [enrBobur]), /forbidden/);
      await rejects(bulk(sBobur, A.cohort, groupA2, [enrBobur]), /forbidden/);
    });

    it('accepts exactly 100 ids', async () => {
      const ids = await Promise.all(
        Array.from({ length: 100 }, async (_, i) => {
          const s = await createProfile('student', `Bulk ${i}`);
          return enroll(s, A.cohort, { status: 'active' });
        }),
      );
      expect(await bulk(A.teacher, A.cohort, groupA2, ids)).toBe(100);
      await sql(`delete from public.enrollments where id = any($1::uuid[])`, [ids]);
    });

    it('concurrent opposite bulk moves do not deadlock and keep one group each', async () => {
      const ids = [enrMadina, enrBobur, enrExpired];
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      try {
        await Promise.all([
          c1.query(`select public.manage_bulk_move($1, $2, $3, $4::uuid[])`, [A.teacher, A.cohort, A.group, ids]),
          c2.query(`select public.manage_bulk_move($1, $2, $3, $4::uuid[])`, [A.teacher, A.cohort, groupA2, [...ids].reverse()]),
        ]);
      } finally {
        c1.release();
        c2.release();
      }
      const rows = await sql(`select curator_group_id from public.enrollments where id = any($1::uuid[])`, [ids]);
      expect(rows.every((r) => [A.group, groupA2].includes(r.curator_group_id))).toBe(true);
      await sql(`update public.enrollments set curator_group_id = $2 where id = $1`, [enrMadina, A.group]);
      await sql(`update public.enrollments set curator_group_id = null where id = $1`, [enrBobur]);
      await sql(`update public.enrollments set curator_group_id = $2 where id = $1`, [enrExpired, A.group]);
    });
  });

  describe('manage_reassign_group', () => {
    const reassign = (actor: string, cohort: string, from: string, to: string | null, limit = 100) =>
      asService(async (q) => {
        const r = await q(`select public.manage_reassign_group($1, $2, $3, $4, $5) as n`, [actor, cohort, from, to, limit]);
        return r[0].n as number;
      });

    it('moves a limited batch of non-rejected students and reports the count', async () => {
      const ids: string[] = [];
      const rg = await createGroup(A.cohort, null);
      for (let i = 0; i < 5; i++) {
        const s = await createProfile('student', `Reassign ${i}`);
        ids.push(await enroll(s, A.cohort, { status: 'active', groupId: rg }));
      }
      const rejectedStudent = await createProfile('student', 'Reassign rejected');
      const rejectedEnr = await enroll(rejectedStudent, A.cohort, { status: 'rejected', groupId: rg });
      expect(await reassign(A.teacher, A.cohort, rg, groupA2, 3)).toBe(3);
      expect(await reassign(A.teacher, A.cohort, rg, groupA2)).toBe(2);
      expect(await reassign(A.teacher, A.cohort, rg, groupA2)).toBe(0);
      const [r] = await sql(`select curator_group_id from public.enrollments where id = $1`, [rejectedEnr]);
      expect(r.curator_group_id).toBe(rg);
      expect(await reassign(admin, A.cohort, groupA2, null, 1000)).toBeGreaterThanOrEqual(5);
      await sql(`update public.enrollments set curator_group_id = null where cohort_id = $1 and student_id <> all($2::uuid[])`, [A.cohort, [sMadina, sExpired]]);
      await sql(`update public.enrollments set curator_group_id = $2 where student_id in ($1, $3)`, [sMadina, A.group, sExpired]);
    });

    it('rejects same/foreign groups and foreign actors', async () => {
      await rejects(reassign(A.teacher, A.cohort, A.group, A.group), /invalid group/);
      await rejects(reassign(A.teacher, A.cohort, B.group, A.group), /invalid group/);
      await rejects(reassign(A.teacher, A.cohort, A.group, B.group), /invalid group/);
      await rejects(reassign(B.teacher, A.cohort, A.group, groupA2), /forbidden/);
      await rejects(reassign(A.curator, A.cohort, A.group, groupA2), /forbidden/);
    });
  });

  describe('manage_set_expiry', () => {
    const setExp = (actor: string, enr: string, when: string) =>
      asService(async (q) => {
        const r = await q(`select public.manage_set_expiry($1, $2, $3::timestamptz) as s`, [actor, enr, when]);
        const [row] = await q(`select status, expires_at from public.enrollments where id = $1`, [enr]);
        return { status: r[0].s, row };
      });
    const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

    it('extends an active enrollment and reactivates an expired one', async () => {
      const a = await setExp(A.teacher, enrMadina, inDays(30));
      expect(a.status).toBe('active');
      const e = await setExp(admin, enrExpired, inDays(10));
      expect(e.row.status).toBe('active');
      await sql(`update public.enrollments set status = 'active', expires_at = now() - interval '1 day' where id = $1`, [enrExpired]);
    });

    it('rejects past/too-far dates, pending/rejected rows and foreign actors', async () => {
      await rejects(setExp(A.teacher, enrMadina, inDays(-1)), /invalid expiry/);
      await rejects(setExp(A.teacher, enrMadina, inDays(365 * 4)), /invalid expiry/);
      await rejects(setExp(A.teacher, enrPending, inDays(5)), /not active/);
      await rejects(setExp(A.teacher, enrRejected, inDays(5)), /not active/);
      await rejects(setExp(B.teacher, enrMadina, inDays(5)), /forbidden/);
      await rejects(setExp(A.curator, enrMadina, inDays(5)), /forbidden/);
    });
  });

  describe('curator groups', () => {
    it('creates and updates groups; names are unique per cohort, chat ids globally', async () => {
      await asService(async (q) => {
        const [{ id }] = await q(`select public.manage_create_group($1, $2, '  Yangi  ', -1001234567890) as id`, [A.teacher, A.cohort]);
        const [g] = await q(`select name, telegram_chat_id from public.curator_groups where id = $1`, [id]);
        expect(g).toMatchObject({ name: 'Yangi' });
        expect(String(g.telegram_chat_id)).toBe('-1001234567890');
        await q(`select public.manage_update_group($1, $2, 'Yangi 2', null)`, [A.teacher, id]);
        const [g2] = await q(`select name, telegram_chat_id from public.curator_groups where id = $1`, [id]);
        expect(g2).toEqual({ name: 'Yangi 2', telegram_chat_id: null });
      });
      await sql(`select public.manage_create_group($1, $2, 'Unique', 42)`, [A.teacher, A.cohort]);
      await rejects(sql(`select public.manage_create_group($1, $2, ' unique ', null)`, [A.teacher, A.cohort]), /curator_groups_cohort_name_key/);
      await rejects(sql(`select public.manage_create_group($1, $2, 'Other', 42)`, [A.teacher, A.cohort]), /telegram_chat_id_key/);
      // same name in another cohort is fine
      await sql(`select public.manage_create_group($1, $2, 'Unique', null)`, [B.teacher, B.cohort]);
    });

    it('denies foreign actors and validates the name', async () => {
      await rejects(sql(`select public.manage_create_group($1, $2, 'X', null)`, [B.teacher, A.cohort]), /forbidden/);
      await rejects(sql(`select public.manage_create_group($1, $2, 'X', null)`, [A.curator, A.cohort]), /forbidden/);
      await rejects(sql(`select public.manage_create_group($1, $2, '   ', null)`, [A.teacher, A.cohort]), /invalid name/);
      await rejects(sql(`select public.manage_update_group($1, $2, 'X', null)`, [B.teacher, A.group]), /forbidden/);
      await rejects(sql(`select public.manage_update_group($1, $2, 'X', null)`, [A.teacher, '00000000-0000-0000-0000-000000000000']), /forbidden/);
    });
  });

  describe('manage_assign_curator', () => {
    let candidate: string;
    let noTelegram: string;
    let enrolledStudent: string;
    let grp: string;

    beforeAll(async () => {
      candidate = await createProfile('student', 'Future Curator');
      await sql(`update public.profiles set telegram_id = 7770001, phone = '+998909990001' where id = $1`, [candidate]);
      noTelegram = await createProfile('student', 'No Telegram');
      await sql(`update public.profiles set phone = '+998909990002' where id = $1`, [noTelegram]);
      enrolledStudent = sMadina; // telegram linked, active enrollment
      grp = await createGroup(A.cohort, null);
      await sql(`update public.curator_groups set name = 'Assign target' where id = $1`, [grp]);
    });
    const assign = (actor: string, group: string, who: string | null) =>
      asService(async (q) => {
        const r = await q(`select public.manage_assign_curator($1, $2, $3) as promoted`, [actor, group, who]);
        return r[0].promoted as boolean;
      });

    it('promotes a free student with a linked Telegram to curator and assigns; unassign keeps the role', async () => {
      expect(await assign(A.teacher, grp, candidate)).toBe(true);
      const [p] = await sql(`select role from public.profiles where id = $1`, [candidate]);
      expect(p.role).toBe('curator');
      const [g] = await sql(`select curator_id from public.curator_groups where id = $1`, [grp]);
      expect(g.curator_id).toBe(candidate);
      expect(await assign(A.teacher, grp, null)).toBe(false);
      const [p2] = await sql(`select role from public.profiles where id = $1`, [candidate]);
      expect(p2.role).toBe('curator');
      // an existing curator is re-assigned without promotion
      expect(await assign(admin, grp, candidate)).toBe(false);
      expect(await assign(A.teacher, grp, null)).toBe(false);
    });

    it('requires a linked Telegram, refuses enrolled students and unknown profiles', async () => {
      await rejects(assign(A.teacher, grp, noTelegram), /telegram_required/);
      await rejects(assign(A.teacher, grp, enrolledStudent), /student_enrolled/);
      await rejects(assign(A.teacher, grp, '00000000-0000-0000-0000-000000000000'), /unknown curator/);
      const [p] = await sql(`select role from public.profiles where id in ($1, $2) order by id`, [noTelegram, enrolledStudent]);
      expect(p.role).toBe('student');
    });

    it('is denied to foreign teachers, curators and students; role never changes then', async () => {
      const fresh = await createProfile('student', 'Fresh');
      await sql(`update public.profiles set telegram_id = 7770002 where id = $1`, [fresh]);
      for (const actor of [B.teacher, A.curator, sMadina]) {
        await rejects(assign(actor, grp, fresh), /forbidden/);
      }
      const [p] = await sql(`select role from public.profiles where id = $1`, [fresh]);
      expect(p.role).toBe('student');
    });

    it('a student can never write profiles.role through the API', async () => {
      await rejects(withUser(sBobur, (q) => q(`update public.profiles set role = 'admin' where id = $1`, [sBobur])), /permission denied/);
      await rejects(withUser(A.teacher, (q) => q(`update public.profiles set role = 'curator' where id = $1`, [sBobur])), /permission denied/);
    });
  });

  describe('manage_find_curator_candidates', () => {
    let target: string;
    beforeAll(async () => {
      target = await createProfile('student', 'Lookup Target');
      await sql(`update public.profiles set phone = '+998905550000', telegram_id = 8880001, telegram_username = 'Lookup_Target' where id = $1`, [target]);
    });
    const find = (actor: string, query: string) =>
      asService((q) => q(`select * from public.manage_find_curator_candidates($1, $2)`, [actor, query]));

    it('matches phone, telegram id and username exactly', async () => {
      for (const query of ['+998905550000', '998 90 555 00 00', '8880001', '@lookup_target', 'Lookup_Target']) {
        const r = await find(A.teacher, query);
        expect(r.map((x) => x.profile_id)).toEqual([target]);
        expect(r[0].telegram_linked).toBe(true);
      }
    });

    it('never does prefix/substring scans and is staff-only', async () => {
      expect(await find(A.teacher, '9989055')).toEqual([]);
      expect(await find(A.teacher, 'Lookup')).toEqual([]);
      expect(await find(A.teacher, 'looku')).toEqual([]);
      expect(await find(A.teacher, '')).toEqual([]);
      await rejects(find(A.curator, '8880001'), /forbidden/);
      await rejects(find(sMadina, '8880001'), /forbidden/);
    });
  });

  describe('manage_link_telegram', () => {
    let nophone: string;
    let adminCreated: string;
    let outsider: string;
    let curatorNoTg: string;
    beforeAll(async () => {
      adminCreated = await createProfile('student', 'Phone Only');
      await sql(`update public.profiles set phone = '+998903334455' where id = $1`, [adminCreated]);
      await enroll(adminCreated, A.cohort, { status: 'pending' });
      nophone = await createProfile('student', 'No Phone');
      await enroll(nophone, A.cohort, { status: 'pending' });
      outsider = await createProfile('student', 'Outsider');
      await sql(`update public.profiles set phone = '+998903334466' where id = $1`, [outsider]);
      curatorNoTg = await createProfile('curator', 'Curator No Tg');
      await sql(`update public.profiles set phone = '+998903334477' where id = $1`, [curatorNoTg]);
      await sql(`update public.curator_groups set curator_id = $1 where id = $2`, [curatorNoTg, groupA2]);
    });
    const link = (actor: string, profile: string, tg: number | string, username: string | null = null) =>
      asService((q) => q(`select public.manage_link_telegram($1, $2, $3, $4)`, [actor, profile, tg, username]));

    it('links a phone-only student of the actor cohort; second link refused', async () => {
      await link(A.teacher, adminCreated, 9990001, 'phone_only');
      const [p] = await sql(`select telegram_id, telegram_username from public.profiles where id = $1`, [adminCreated]);
      expect(String(p.telegram_id)).toBe('9990001');
      expect(p.telegram_username).toBe('phone_only');
      await rejects(link(A.teacher, adminCreated, 9990002), /already_linked/);
    });

    it('links a curator of an actor group', async () => {
      await link(A.teacher, curatorNoTg, 9990010);
      const [p] = await sql(`select telegram_id from public.profiles where id = $1`, [curatorNoTg]);
      expect(String(p.telegram_id)).toBe('9990010');
    });

    it('needs a phone, a valid id and a free id', async () => {
      await rejects(link(A.teacher, nophone, 9990003), /phone_required/);
      await rejects(link(admin, outsider, 0), /invalid telegram id/);
      await rejects(link(admin, outsider, '4503599627370496'), /invalid telegram id/);
      await rejects(link(admin, outsider, 9990001), /profiles_telegram_id_key/); // taken by adminCreated
    });

    it('refuses foreign teachers, outsiders, self, curators, students and staff targets', async () => {
      await rejects(link(B.teacher, nophone, 9990004), /forbidden/);
      await rejects(link(A.teacher, outsider, 9990005), /forbidden/); // not in any of the teacher's cohorts
      await rejects(link(A.teacher, A.teacher, 9990006), /forbidden/);
      await rejects(link(sMadina, outsider, 9990008), /forbidden/);
      await rejects(link(A.curator, outsider, 9990009), /forbidden/);
      await rejects(link(admin, admin, 9990011), /forbidden/);
      // a teacher may not link another staff profile even when related; admin may link an outsider
      await link(admin, outsider, 9990012);
    });
  });

  describe('cohort management', () => {
    const run = (text: string, params: unknown[]) => asService((q) => q(text, params));

    it('creates and updates cohorts under the actor course only', async () => {
      await asService(async (q) => {
        const [{ id }] = await q(
          `select public.manage_create_cohort($1, $2, '  Potok 7 ', '2026-09-01', '2026-12-01', null) as id`,
          [A.teacher, A.course],
        );
        const [c] = await q(`select name, starts_on, ends_on, access_until from public.cohorts where id = $1`, [id]);
        expect(c.name).toBe('Potok 7');
        expect(c.access_until).toBeNull();
        await q(`select public.manage_update_cohort($1, $2, 'Potok 7b', '2026-09-02', '2026-12-02')`, [admin, id]);
        const [c2] = await q(`select name from public.cohorts where id = $1`, [id]);
        expect(c2.name).toBe('Potok 7b');
      });
      await rejects(run(`select public.manage_create_cohort($1, $2, 'X', null, null, null)`, [B.teacher, A.course]), /forbidden/);
      await rejects(run(`select public.manage_create_cohort($1, $2, 'X', null, null, null)`, [A.curator, A.course]), /forbidden/);
      await rejects(run(`select public.manage_create_cohort($1, $2, '', null, null, null)`, [A.teacher, A.course]), /invalid name/);
      await rejects(run(`select public.manage_create_cohort($1, $2, repeat('x', 81), null, null, null)`, [A.teacher, A.course]), /invalid name/);
      await rejects(run(`select public.manage_create_cohort($1, $2, 'X', '2026-10-01', '2026-09-01', null)`, [A.teacher, A.course]), /invalid dates/);
      await rejects(run(`select public.manage_update_cohort($1, $2, 'X', null, null)`, [B.teacher, A.cohort]), /forbidden/);
    });

    it('closes and reopens enrollment', async () => {
      const cohort = await createCohort(A.course, 'Toggle');
      await run(`select public.manage_set_cohort_access($1, $2, false, null)`, [A.teacher, cohort]);
      const [closed] = await sql(`select access_until <= now() as closed from public.cohorts where id = $1`, [cohort]);
      expect(closed.closed).toBe(true);
      const [ov] = await withUser(A.teacher, (q) => q(`select enrollment_open from public.manage_cohorts_overview() where cohort_id = $1`, [cohort]));
      expect(ov.enrollment_open).toBe(false);
      await rejects(run(`select public.manage_set_cohort_access($1, $2, true, null)`, [A.teacher, cohort]), /invalid access date/);
      await rejects(run(`select public.manage_set_cohort_access($1, $2, true, now() - interval '1 day')`, [A.teacher, cohort]), /invalid access date/);
      await rejects(run(`select public.manage_set_cohort_access($1, $2, true, now() + interval '4 years')`, [A.teacher, cohort]), /invalid access date/);
      await run(`select public.manage_set_cohort_access($1, $2, true, now() + interval '30 days')`, [A.teacher, cohort]);
      const [ov2] = await withUser(A.teacher, (q) => q(`select enrollment_open from public.manage_cohorts_overview() where cohort_id = $1`, [cohort]));
      expect(ov2.enrollment_open).toBe(true);
      await rejects(run(`select public.manage_set_cohort_access($1, $2, false, null)`, [B.teacher, cohort]), /forbidden/);
    });
  });

  describe('privileges', () => {
    it('API roles have no execute on write functions and no table-level truncate/trigger/references', async () => {
      const rows = await sql(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
                has_function_privilege('anon', p.oid, 'execute') as anon_exec
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'manage\\_%'`,
      );
      const writes = rows.filter((r) => !['manage_student_list', 'manage_cohort_counts', 'manage_cohorts_overview', 'manage_student_detail'].includes(r.proname));
      expect(writes.length).toBeGreaterThanOrEqual(12);
      expect(writes.every((r) => !r.auth_exec && !r.anon_exec)).toBe(true);
      expect(rows.every((r) => !r.anon_exec)).toBe(true);
      const [g] = await sql(
        `select count(*)::int as n from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated')
            and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')`,
      );
      expect(g.n).toBe(0);
    });

    it('definer functions pin search_path', async () => {
      const rows = await sql(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'manage\\_%' and p.prosecdef
            and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
      );
      expect(rows).toEqual([]);
    });
  });
});
