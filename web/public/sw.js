const SHELL_CACHE = "rc-shell-v1";
const ASSET_CACHE = "rc-assets-v1";
const FONT_CACHE = "rc-fonts-v1";

const KEEP_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !KEEP_CACHES.has(name)).map((name) => caches.delete(name)));
      return self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (url.origin === self.location.origin && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  if (url.origin === self.location.origin && (request.destination === "style" || url.pathname === "/manifest.webmanifest")) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    cache.put("/", response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match("/");
    if (cached !== undefined) {
      return cached;
    }
    return new Response("<!doctype html><meta charset=utf-8><title>RemoteControl</title><p>Offline. Open it once while online first.</p>", {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  const cached = await cache.match(request);
  if (cached !== undefined) {
    return cached;
  }
  const fresh = await refresh;
  if (fresh !== undefined) {
    return fresh;
  }
  return new Response("", { status: 504 });
}
