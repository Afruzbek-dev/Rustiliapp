import type { Db } from "@/lib/telegram/api";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type AuthUser = { id: string; email: string; app_metadata: Record<string, unknown> };

/** Minimal in-memory stand-in for the slice of the Supabase client the bot uses. */
export function createFakeDb(seed: { login_nonces?: Row[]; profiles?: Row[]; authUsers?: AuthUser[] } = {}) {
  const tables: Record<string, Row[]> = {
    login_nonces: seed.login_nonces ?? [],
    profiles: seed.profiles ?? [],
  };
  const authUsers: AuthUser[] = seed.authUsers ?? [];
  const calls = { createUser: 0, upsert: 0, deleteUser: 0 };
  const admin = {
    createUser: ({ email, app_metadata }: { email: string; app_metadata?: Record<string, unknown> }): Promise<unknown> => {
      calls.createUser++;
      if (authUsers.some((u) => u.email === email)) {
        return Promise.resolve({ data: { user: null }, error: { message: "exists", code: "email_exists" } });
      }
      const user = { id: `uid-${authUsers.length + 1}`, email, app_metadata: app_metadata ?? {} };
      authUsers.push(user);
      return Promise.resolve({ data: { user }, error: null });
    },
    getUserById: (id: string): Promise<unknown> => {
      const user = authUsers.find((u) => u.id === id) ?? null;
      return Promise.resolve({ data: { user }, error: user ? null : { message: "nf" } });
    },
    deleteUser: (id: string): Promise<unknown> => {
      calls.deleteUser++;
      const i = authUsers.findIndex((u) => u.id === id);
      if (i >= 0) authUsers.splice(i, 1);
      return Promise.resolve({ data: null, error: null });
    },
  };

  function from(name: string) {
    const rows = tables[name]!;
    const filters: Filter[] = [];
    let op: "select" | "update" | "upsert" | "delete" = "select";
    let patch: Row = {};
    let order: { col: string; asc: boolean } | undefined;
    let max = Infinity;
    let returning = false;

    const matches = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === "update") {
        const hit = matches();
        hit.forEach((r) => Object.assign(r, patch));
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "delete") {
        const hit = matches();
        hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const existing = rows.find((r) => r.id === patch.id);
        if (!existing && patch.phone && rows.some((r) => r.phone === patch.phone)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_phone_key"' } };
        }
        if (existing) Object.assign(existing, patch);
        else rows.push({ role: "student", ...patch });
        return { data: null, error: null };
      }
      let out = matches().map((r) => ({ ...r }));
      if (order) {
        const { col, asc } = order;
        out = out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return { data: out.slice(0, max), error: null };
    };

    const b: Record<string, unknown> = {
      select() {
        if (op === "update") returning = true;
        return b;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      upsert(p: Row) {
        op = "upsert";
        calls.upsert++;
        patch = p;
        return b;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return b;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return b;
      },
      in(c: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[c]));
        return b;
      },
      gt(c: string, v: string) {
        filters.push((r) => String(r[c]) > v);
        return b;
      },
      order(col: string, o: { ascending: boolean }) {
        order = { col, asc: o.ascending };
        return b;
      },
      limit(n: number) {
        max = n;
        return b;
      },
      maybeSingle() {
        const res = run();
        return Promise.resolve({ data: (res.data as Row[] | null)?.[0] ?? null, error: res.error });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return b;
  }

  const rpc = (fn: string, args: { p_email: string }) => {
    if (fn !== "auth_user_id_by_email") throw new Error("unexpected rpc");
    const u = authUsers.find((x) => x.email === args.p_email);
    return Promise.resolve({ data: u?.id ?? null, error: null });
  };

  const db = { from, rpc, auth: { admin } } as unknown as Db;
  return { db, tables, authUsers, calls, admin };
}
