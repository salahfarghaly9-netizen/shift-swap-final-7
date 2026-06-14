/**
 * Nextcare Shift Swap System — Service Worker
 * Designed by Salah Farghaly
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS) → Cache First
 *  - API calls → Network First (fallback to cache)
 *  - Images/icons → Cache First
 */

const CACHE_NAME    = 'nextcare-v1.2';
const API_CACHE     = 'nextcare-api-v1';
const OFFLINE_URL   = '/offline.html';

// Files to cache on install (app shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
];

// ── INSTALL ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing Nextcare Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      // Cache what we can — ignore failures for optional files
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => console.warn('[SW] Could not cache:', url)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== API_CACHE)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls → Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else → Cache First
  event.respondWith(cacheFirst(request));
});

// Cache First strategy
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback
    const fallback = await caches.match('/index.html');
    return fallback || new Response('Offline — يرجى التحقق من الاتصال بالإنترنت', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Network First strategy (for API)
async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response(JSON.stringify({
      success: false,
      message: 'You are offline. Please check your connection.',
      offline: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── PUSH NOTIFICATIONS ─────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'Nextcare';
  const options = {
    body:    data.body    || 'You have a new notification',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    tag:     data.tag     || 'nextcare-notif',
    data:    { url: data.url || '/' },
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss'  }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── BACKGROUND SYNC ────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(syncNotifications());
  }
});

async function syncNotifications() {
  try {
    const response = await fetch('/api/notifications');
    if (response.ok) {
      const data = await response.json();
      const unread = data.unreadCount || 0;
      if (unread > 0) {
        await self.registration.showNotification('Nextcare', {
          body:  `You have ${unread} unread notification${unread > 1 ? 's' : ''}`,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-72.png',
          tag:   'nextcare-sync'
        });
      }
    }
  } catch { /* offline — skip */ }
}
