// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const root = resolve(__dirname, "../..");
const swSource = readFileSync(resolve(root, "public/sw.js"), "utf8");
const offlineSource = readFileSync(resolve(root, "src/app/offline/page.tsx"), "utf8");

type Handler = (event: unknown) => void;
interface FakeRes {
  status: number;
  type: string;
  clone(): FakeRes;
}
const res = (status = 200, type = "basic"): FakeRes => ({
  status,
  type,
  clone() {
    return this;
  },
});

function setup(fetchImpl: (req: unknown) => Promise<FakeRes>) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, unknown>>();
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      add: async (r: { url: string }) => void m.set(r.url, res()),
      match: async (r: { url: string }) => m.get(r.url),
      put: vi.fn(async (r: { url: string }, v: unknown) => void m.set(r.url, v)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: { url: string }) => m.delete(r.url),
    };
  };
  const claim = vi.fn(async () => {});
  const caches = {
    open: async (n: string) => open(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (r: string | { url: string }) => {
      const u = typeof r === "string" ? r : r.url;
      for (const m of stores.values()) {
        for (const [k, v] of m) if (k === u || k.endsWith(u)) return v;
      }
      return undefined;
    },
  };
  const fetchMock = vi.fn(fetchImpl);
  const self = {
    addEventListener: (t: string, h: Handler) => void (handlers[t] = h),
    location: { origin: "https://app.test" },
    clients: { claim },
    skipWaiting: vi.fn(),
  };
  class Request {
    url: string;
    constructor(u: string) {
      this.url = new URL(u, "https://app.test").toString();
    }
  }
  const Response = { error: () => ({ status: 0, type: "error", clone() { return this; } }) };
  vm.runInNewContext(swSource, { self, caches, fetch: fetchMock, Request, Response, URL, Promise });

  const fire = async (req: { url: string; method?: string; mode?: string }) => {
    let responded: Promise<unknown> | undefined;
    const waits: Promise<unknown>[] = [];
    handlers.fetch({
      request: { method: "GET", mode: "cors", ...req },
      respondWith: (p: Promise<unknown>) => void (responded = p),
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    const result = responded ? await responded : undefined;
    await Promise.all(waits);
    return { handled: responded !== undefined, result };
  };
  return { handlers, stores, caches, fetchMock, fire, claim, self };
}

const A = "https://app.test";

describe("service worker version", () => {
  it("derives the cache name from CACHE_VERSION, referenced by the offline page", () => {
    const v = /const CACHE_VERSION = "([^"]+)"/.exec(swSource)?.[1];
    expect(v).toBeTruthy();
    expect(swSource).toMatch(/STATIC_CACHE = CACHE_PREFIX \+ CACHE_VERSION/);
    expect(offlineSource).toContain(`sw-cache-version: ${v}`);
  });
});

describe("public/sw.js", () => {
  it("ignores non-GET and cross-origin requests and bypasses /api", async () => {
    const t = setup(async () => res());
    expect((await t.fire({ url: `${A}/_next/static/a.js`, method: "POST" })).handled).toBe(false);
    expect((await t.fire({ url: "https://cdn.other/_next/static/a.js" })).handled).toBe(false);
    expect((await t.fire({ url: `${A}/api/progress` })).handled).toBe(false);
    expect((await t.fire({ url: `${A}/photo.png` })).handled).toBe(false);
    expect((await t.fire({ url: `${A}/_next/image?url=x` })).handled).toBe(false);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("serves /offline only when the network fails, not on 4xx/5xx", async () => {
    const t = setup(async () => res(500));
    const install = t.handlers.install as (e: unknown) => void;
    let p: Promise<unknown> = Promise.resolve();
    install({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    const bad = await t.fire({ url: `${A}/home`, mode: "navigate" });
    expect((bad.result as FakeRes).status).toBe(500);

    const t2 = setup(async () => {
      throw new TypeError("offline");
    });
    let p2: Promise<unknown> = Promise.resolve();
    t2.handlers.install({ waitUntil: (x: Promise<unknown>) => (p2 = x) });
    await p2.catch(() => {});
    // install itself fetches nothing (cache.add is mocked), so the fallback must now exist.
    const off = await t2.fire({ url: `${A}/home`, mode: "navigate" });
    expect((off.result as FakeRes).status).toBe(200);
  });

  it("does not cache 206 or opaque responses, caches 200 basic under /_next/static", async () => {
    const t = setup(async () => res(206));
    await t.fire({ url: `${A}/_next/static/a.js` });
    expect(t.stores.get("po-russki-v2")?.size ?? 0).toBe(0);

    const t2 = setup(async () => res(200, "opaque"));
    await t2.fire({ url: `${A}/_next/static/a.js` });
    expect(t2.stores.get("po-russki-v2")?.size ?? 0).toBe(0);

    const t3 = setup(async () => res(200));
    await t3.fire({ url: `${A}/_next/static/a.js` });
    await t3.fire({ url: `${A}/_next/static/a.js` });
    expect(t3.fetchMock).toHaveBeenCalledTimes(1); // second is cache-first
    expect(t3.stores.get("po-russki-v2")?.size).toBe(1);
  });

  it("revalidates /icons (stale-while-revalidate), always fetching", async () => {
    const t = setup(async () => res(200));
    await t.fire({ url: `${A}/icons/icon-192.png` });
    await t.fire({ url: `${A}/icons/icon-192.png` });
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes old po-russki-* caches on activate but keeps unrelated ones", async () => {
    const t = setup(async () => res());
    t.stores.set("po-russki-v1", new Map());
    t.stores.set("po-russki-v2", new Map());
    t.stores.set("other", new Map());
    let p: Promise<unknown> = Promise.resolve();
    t.handlers.activate({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect([...t.stores.keys()].sort()).toEqual(["other", "po-russki-v2"]);
    expect(t.claim).toHaveBeenCalled();
  });

  it("caps the runtime cache at 80 entries", async () => {
    const t = setup(async () => res(200));
    for (let i = 0; i < 85; i++) await t.fire({ url: `${A}/_next/static/c${i}.js` });
    expect(t.stores.get("po-russki-v2")?.size).toBe(80);
  });
});
