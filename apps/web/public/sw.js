const CACHE_NAME = "t3code-shell-v4";
const APP_SHELL_PATHS = [
  "/",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/icon-192.png",
  "/icon-512.png",
];

async function cacheResponse(cache, request, response) {
  if (!response || !response.ok) {
    return response;
  }

  await cache.put(request, response.clone());
  return response;
}

async function updateNavigationCache(request) {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(request);
  await cacheResponse(cache, request, response);
  if (new URL(request.url).pathname !== "/") {
    await cacheResponse(cache, "/", response);
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_PATHS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = (await cache.match(request)) || (await cache.match("/"));
        const networkRefresh = updateNavigationCache(request).catch(() => null);

        if (cachedResponse) {
          void networkRefresh;
          return cachedResponse;
        }

        const networkResponse = await networkRefresh;
        if (networkResponse) {
          return networkResponse;
        }

        return Response.error();
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);
      const shouldCacheAsset = url.pathname.startsWith("/assets/");

      if (cachedResponse) {
        if (shouldCacheAsset) {
          void fetch(request)
            .then((response) => cacheResponse(cache, request, response))
            .catch(() => null);
        }
        return cachedResponse;
      }

      const response = await fetch(request);
      if (shouldCacheAsset) {
        await cacheResponse(cache, request, response);
      }
      return response;
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "T3 Code",
      body: event.data.text(),
      tag: undefined,
      url: "/",
      threadId: null,
    };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "T3 Code", {
      body: payload.body || "Assistant reply completed.",
      tag: payload.tag,
      data: {
        url: payload.url || "/",
        threadId: payload.threadId || null,
      },
      icon: "/icon-192.png",
      badge: "/favicon-32x32.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("navigate" in client) {
          try {
            await client.navigate(targetUrl);
          } catch {
            // Fall back to focusing the existing client.
          }
          await client.focus();
          return;
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
