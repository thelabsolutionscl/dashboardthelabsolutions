/* Service worker del dashboard — el deploy estampa %%BUILD%% (misma técnica que index.html).
 * Estrategia deliberadamente conservadora para no interferir con datos en vivo:
 *  - Navegación / index.html → red primero, caché solo como respaldo sin conexión.
 *  - Assets del mismo origen versionados con ?v= (styles.css, js/*) → caché primero:
 *    cada deploy cambia la URL, así que una entrada cacheada nunca queda obsoleta.
 *  - Imágenes del mismo origen → caché con revalidación en segundo plano.
 *  - TODO lo demás (Airtable, proxy, mail-api, CDNs, POST) pasa directo a la red.
 */
const VERSION = '%%BUILD%%';
const CACHE = 'thelab-' + VERSION;

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('thelab-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Shell: red primero, respaldo offline
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Assets versionados: inmutables por URL → caché primero
  if (url.searchParams.has('v')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }))
    );
    return;
  }

  // Imágenes propias: sirve caché y revalida en segundo plano
  if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return r;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // resto: sin respondWith → red normal
});
