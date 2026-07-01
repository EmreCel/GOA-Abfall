const CACHE_NAME = 'muelltonne-v10';
const SW_VERSION = 'v10';
// Worker, der Push-Nachrichten verschickt und die "pending"-Texte vorhält.
const GOA_WORKER = 'https://goa-abfall.emre18celik.workers.dev';
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
    caches.open(CACHE_NAME).then(async cache => {
      // WICHTIG: cache.addAll() ist alles-oder-nichts — EIN fehlender/404er
      // Precache-Eintrag hätte bisher die GESAMTE Installation zu Fall gebracht,
      // wodurch der SW nie aktiv wurde (→ "keine Registrierung", obwohl sw.js
      // selbst einwandfrei lädt). Jetzt: jede Datei einzeln, best-effort.
      const results = await Promise.allSettled(PRECACHE.map(url => cache.add(url)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.warn('[SW] Precache übersprungen:', PRECACHE[i], r.reason);
      });
    }).then(() => self.skipWaiting())
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

// ── PUSH: feuert auch bei GESCHLOSSENER App ──
// Wir senden vom Server bewusst OHNE verschlüsselte Payload (spart fehleranfällige
// Crypto im Worker). Stattdessen holt sich der SW den konkreten Text per fetch von
// /push/pending. Klappt das nicht, zeigen wir trotzdem eine generische Notification
// (iOS verlangt zwingend eine sichtbare Notification pro Push).
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'Ostalb App';
    let body  = 'Erinnerung';
    // 1) Falls doch eine Payload mitkam (Zukunft): direkt nutzen.
    if (e.data) {
      try { const p = e.data.json(); if (p && p.title) { title = p.title; body = p.body || ''; } }
      catch (_) {}
    }
    // 2) Sonst: den vorgemerkten Text beim Worker abholen.
    if (title === 'Ostalb App') {
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const r = await fetch(GOA_WORKER + '/push/pending?ep=' + encodeURIComponent(sub.endpoint), { cache: 'no-store' });
          if (r.ok) {
            const d = await r.json();
            if (d && d.title) { title = d.title; body = d.body || ''; }
          }
        }
      } catch (_) {}
    }
    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'goa-reminder',
      renotify: true,
      requireInteraction: true,
      data: { url: './' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if (c.url && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});

// Diagnose: erlaubt der App zu fragen, WELCHE SW-Version gerade aktiv ist.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'getVersion') {
    const reply = { version: SW_VERSION };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source && e.source.postMessage) e.source.postMessage(reply);
  }
});
