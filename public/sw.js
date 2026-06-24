// App-shell service worker for the dashboard PWA.
//
// Strategy:
//   - /api/* and cross-origin: always network (data must be fresh; never cached)
//   - app shell + static assets: cache-first with a network fallback, so the
//     app launches offline (showing the last shell; data then loads when online)
// Bump CACHE on any shell change to invalidate old copies.
const CACHE = "nutrition-shell-v1";
const SHELL = [
    "/dashboard",
    "/dashboard.css",
    "/dashboard.js",
    "/manifest.webmanifest",
    "/apple-touch-icon.png",
    "/favicon.ico",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== "GET" || url.origin !== self.location.origin) return;

    if (url.pathname.startsWith("/api/")) {
        return; // let the network handle data requests
    }

    event.respondWith(
        caches.match(req).then(
            (hit) =>
                hit ||
                fetch(req)
                    .then((res) => {
                        if (res.ok && SHELL.includes(url.pathname)) {
                            const copy = res.clone();
                            caches.open(CACHE).then((c) => c.put(req, copy));
                        }
                        return res;
                    })
                    .catch(() => caches.match("/dashboard")),
        ),
    );
});
