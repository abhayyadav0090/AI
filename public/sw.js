/* NexOS service worker: network-first app shell, offline fallback, and task reminders. */
const CACHE = 'nexos-shell-v4';

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('nexos-shell-') && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

// Network first so deployments are picked up immediately; API requests are never cached.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic' && req.method === 'GET') {
        try {
          const cache = await caches.open(CACHE);
          await cache.put(req, res.clone());
        } catch (_) { /* A full/disabled cache must not break a successful network response. */ }
      }
      return res;
    } catch (err) {
      const hit = (await caches.match(req)) || (req.mode === 'navigate' ? await caches.match('/') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = typeof data.title === 'string' ? data.title : 'NexOS reminder';
  const body = typeof data.body === 'string' ? data.body : 'You have an update in NexOS.';
  const target = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/nexos-icon-192.png', badge: '/nexos-icon-192.png', tag: typeof data.tag === 'string' ? data.tag : 'nexos-notification', renotify: false, data: { url: target, taskId: data.taskId || null } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relativeUrl = event.notification.data && event.notification.data.url;
  const target = new URL(typeof relativeUrl === 'string' && relativeUrl.startsWith('/') ? relativeUrl : '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        await client.focus(); return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
