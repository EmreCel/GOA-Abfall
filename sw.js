const CACHE_NAME = 'muelltonne-v6';

// App-Shell: wird beim Install vorgeladen → App startet offline
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png'
];

// Live-Daten NIEMALS aus dem Cache servieren — veraltete
// Abfahrtszeiten oder Spritpreise sind schlimmer als eine
// Fehlermeldung (die App hat dafür eigene Error-States).
const NO_CACHE_HOSTS = [
  'moegglingen-bus.emre18celik.workers.dev',
  'api.open-meteo.com'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // Nur ALTE Caches löschen — nicht den aktuellen
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live-APIs: immer Netz, kein Cache-Fallback
  if (NO_CACHE_HOSTS.includes(url.hostname)) {
    e.respondWith(fetch(req));
    return;
  }

  // Network-first MIT Cache-Schreiben:
  // frisch laden → Kopie in den Cache → bei Offline aus dem Cache
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(cached => {
          if (cached) return cached;
          // Navigation offline ohne Treffer → App-Shell liefern
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(list => {
    for (const c of list) { if (c.url && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});
