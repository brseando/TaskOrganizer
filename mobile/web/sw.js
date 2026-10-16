// Service worker: keeps a copy of every app file on the phone so Task
// Organizer opens with no internet connection. mobile/build.py fills in the
// version and file list; each new build gets a fresh cache, which the phone
// picks up the next time the app is opened while online.

const VERSION = "__BUILD_VERSION__";
const FILES = __PRECACHE_FILES__;
const CACHE = `task-organizer-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("task-organizer-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Every page load gets the app shell; the views live after the "#".
      const cached = request.mode === "navigate" ? await cache.match("./") : await cache.match(request, { ignoreSearch: true });
      return cached || fetch(request);
    })()
  );
});

// Tapping a "time's up" notification brings the app back to the front.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (windows.length) return windows[0].focus();
      return self.clients.openWindow("./#/focus");
    })
  );
});
