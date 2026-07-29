/**
 * Grudge Forge service worker.
 *
 * CRITICAL: after SPA deploys, hashed /assets/* chunks change. Cache-first
 * on the shell (or stale precache of /) white-screens the app. Strategy:
 *   - Bump CACHE_VERSION on every breaking shell change
 *   - Network-first for navigations and index/HTML
 *   - Network-first for /assets/* (immutable hashes — miss is fine)
 *   - Precache only static icons/manifest (never the SPA shell)
 */
const CACHE_VERSION = "gameforge-v3-fast-options";
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/logo.png",
  "/pwa-192.png",
  "/pwa-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function networkFirst(req, cacheKey) {
  return fetch(req)
    .then((res) => {
      if (res.ok && res.type === "basic" && cacheKey) {
        const copy = res.clone();
        caches
          .open(CACHE_VERSION)
          .then((c) => c.put(cacheKey, copy))
          .catch(() => undefined);
      }
      return res;
    })
    .catch(() =>
      caches.match(cacheKey || req).then((m) => m ?? Response.error()),
    );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept API or Blazor — always network
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_framework/")) return;

  // SPA navigations: always prefer network so new deploys replace the shell.
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, "/"));
    return;
  }

  // HTML / entry document fragments — never stale-cache
  if (
    url.pathname === "/" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/index.html"
  ) {
    event.respondWith(networkFirst(req, url.pathname));
    return;
  }

  // Hashed bundles: network-first (new deploy = new hash = cache miss)
  // Falls back to cache only when offline.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(networkFirst(req, req));
    return;
  }

  // Icons / static: cache-first is fine
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches
              .open(CACHE_VERSION)
              .then((c) => c.put(req, copy))
              .catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached ?? Response.error());
    }),
  );
});
