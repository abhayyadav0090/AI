/* NexOS service worker: instant cached app-shell startup plus task-reminder push notifications. */
const CACHE = 'nexos-shell-v7';
const PRECACHE_URLS = [
  '/',
  '/style.css?v=3.2.0',
  '/design.css?v=3.2.0',
  '/push-client.js?v=3.2.0',
  '/app.js?v=3.2.0',
  '/ui.js?v=3.2.0',
  '/manifest.json?v=3.2.0',
  '/favicon.svg',
  '/nexos-icon-192.png',
  '/nexos-icon-512.png',
];
const APP_SHELL_ROUTES = new Set(['/', '/classic', '/classic/']);
const CACHE_FIRST_ASSETS = new Set(PRECACHE_URLS.filter((url) => url !== '/'));

async function cacheSuccessfulResponse(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Best-effort precache: one optional asset failure must not block the worker update.
  await Promise.all(PRECACHE_URLS.map(async (url) => {
    try {
      const response = await fetch(url);
      if (response && response.ok && response.type === 'basic') await cache.put(url, response);
    } catch (_) {}
  }));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('nexos-shell-') && key !== CACHE).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache authentication, workspace, AI, or notification API responses.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate' && APP_SHELL_ROUTES.has(url.pathname)) {
    // Return the installed app shell immediately; refresh its HTML quietly for the next launch.
    const refresh = fetch(req).then((response) => cacheSuccessfulResponse(req, response));
    event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
    event.respondWith((async () => {
      const cached = await caches.match(req) || (url.pathname === '/' ? await caches.match('/') : null);
      if (cached) return cached;
      try { return await refresh; }
      catch (error) {
        const fallback = await caches.match('/');
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }

  // Static assets (including versioned JS/CSS) are served from cache before the network.
  if (CACHE_FIRST_ASSETS.has(url.pathname + url.search)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      return cacheSuccessfulResponse(req, response);
    })());
    return;
  }

  // Other same-origin resources retain the previous network-first/offline-fallback behaviour.
  event.respondWith((async () => {
    try {
      const response = await fetch(req);
      return await cacheSuccessfulResponse(req, response);
    } catch (error) {
      const fallback = await caches.match(req) || (req.mode === 'navigate' ? await caches.match('/') : null);
      if (fallback) return fallback;
      throw error;
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = typeof data.title === 'string' ? data.title : 'NexOS reminder';
  const body = typeof data.body === 'string' ? data.body : 'You have an update in NexOS.';
  const target = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/nexos-icon-192.png', badge: '/nexos-icon-192.png', tag: typeof data.tag === 'string' ? data.tag : 'nexos-notification', data: { url: target, taskId: data.taskId || null }, renotify: false }));
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
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
