/*
 * Service Worker — The Lab Solutions dashboard (PWA).
 *
 * Estrategia NETWORK-FIRST: estando online siempre se sirve la versión fresca de la red
 * (coherente con el <meta no-cache> del HTML); la caché solo entra cuando no hay conexión.
 * Así añadimos capacidad offline e instalación SIN arriesgar servir un index.html viejo.
 *
 * Solo se cachean peticiones GET del mismo origen. Las llamadas a Airtable / Workers / APIs
 * (otro origen, o métodos != GET) pasan directo a la red y NUNCA se cachean.
 *
 * Para forzar una invalidación, sube el número de versión del nombre de caché.
 */
const CACHE = 'thelab-dash-v1';
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca interceptar escrituras (POST/PATCH/DELETE)

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNavigation = req.mode === 'navigate';

  // Navegación: network-first con fallback al index cacheado (app-shell offline).
  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Recursos GET del mismo origen: network-first, cachea la copia buena, cae a caché offline.
  if (sameOrigin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }
  // Otros orígenes (Airtable, fuentes, CDN, Workers): pasa directo a la red, sin caché.
});
