// PJ Portal service worker: makes the portal installable and opens the
// app shell fast (even on weak mobile data). It only caches this site's own
// files. Data from the API (script.google.com) and Google sign-in are never
// cached here; the page keeps its own last-known data.

const CACHE = 'pj-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API, Google: straight to network

  // Pages: network first (always the newest version), cached copy if offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('./', res.clone())); return res; })
        .catch(() => caches.match('./')),
    );
    return;
  }
  // Built files have unique names, so a cached copy is always correct.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});

// ---- Phone notifications (Firebase Cloud Messaging, data messages from the PJ Portal API).
// The text is generic on purpose ("💬 Babu · New message"), never the message itself.
self.addEventListener('push', (event) => {
  let p = {};
  try { const j = event.data ? event.data.json() : {}; p = j.data || j; } catch {}
  const title = p.title || 'PJ Portal';
  const url = new URL(`./${p.url || ''}`, self.registration.scope).href;
  event.waitUntil((async () => {
    // Skip if the portal is open and on screen: the page already shows it live.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
    await self.registration.showNotification(title, {
      body: p.body || '', tag: p.tag || undefined, renotify: Boolean(p.tag),
      icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  const hash = url.slice(url.indexOf('#'));   // '#messages/other%40example.com' (or '' if none)
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      // navigate() is not supported everywhere and fails silently on some
      // browsers; tell the already-open page to route itself too (this also
      // wakes its chat connection, which can have gone stale while this
      // window sat in the background — see main.js/messages.js).
      try { if (open.navigate && hash) await open.navigate(url); } catch {}
      open.postMessage({ type: 'pj-notification-open', hash });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
