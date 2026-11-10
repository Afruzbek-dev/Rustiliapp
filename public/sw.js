/* Hand-written service worker (no build dependency).
 * - Precaches the /offline fallback page.
 * - Cache-first ONLY for immutable, hashed /_next/static assets (next/font files live there too).
 * - Stale-while-revalidate for unhashed /icons/*.
 * - Navigations go to the network only; /offline is served only when the network request fails.
 * - NEVER caches /api/**, /_next/image, generic images or any HTML other than /offline.
 */

// Bump on every change to /offline (src/app/offline/page.tsx) or to this file.
const CACHE_VERSION = "v2";
const CACHE_PREFIX = "po-russki-";
const STATIC_CACHE = CACHE_PREFIX + CACHE_VERSION;
const OFFLINE_URL = "/offline";
const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheable(res) {
  return res.status === 200 && res.type === "basic";
}

/** Keeps the runtime cache bounded; the offline page is never evicted. */
async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname !== OFFLINE_URL);
  for (let i = 0; i < keys.length - MAX_RUNTIME_ENTRIES; i++) await cache.delete(keys[i]);
}

function store(event, cache, request, res) {
  if (!isCacheable(res)) return;
  event.waitUntil(
    cache
      .put(request, res.clone())
      .then(() => trim(cache))
      .catch(() => {}),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        store(event, cache, request, res);
        return res;
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/")) {
    // Stale-while-revalidate. waitUntil MUST be called synchronously here (never from a later .then),
    // otherwise the event may already be finished and the background refresh would be dropped.
    const state = caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      // Clone synchronously, before the page can start reading the body.
      const net = fetch(request).then((res) => ({ res, copy: isCacheable(res) ? res.clone() : null }));
      // Cache write failures (quota etc.) must never affect the response the page gets.
      const write = net
        .then(async ({ copy }) => {
          if (!copy) return;
          await cache.put(request, copy);
          await trim(cache);
        })
        .catch(() => {});
      const response = net.then(({ res }) => res);
      response.catch(() => {}); // avoid an unhandled rejection when a cached icon is served
      return { hit, response, write };
    });
    event.waitUntil(state.then((s) => s.write).catch(() => {}));
    event.respondWith(state.then((s) => s.hit || s.response));
  }
});
