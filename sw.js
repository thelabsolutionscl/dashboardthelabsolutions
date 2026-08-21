/* Service worker del dashboard — el deploy estampa %%BUILD%% (misma técnica que index.html).
 * Estrategia deliberadamente conservadora para no interferir con datos en vivo:
 *  - Navegación / index.html → red primero, caché solo como respaldo sin conexión.
 *  - Assets del mismo origen versionados con ?v= (styles.css, js/*) → caché primero.
 *  - Imágenes del mismo origen → caché con revalidación en segundo plano.
 *  - TODO lo demás (Airtable, proxy, mail-api, CDNs, POST) pasa directo a la red.
 *
 * Farm Controller: para evitar reescribir el index.html monolítico, la navegación
 * recibe un único script adicional que reemplaza SOLO la cola volátil de Máquinas
 * por la cola durable del controller. El resto del dashboard queda intacto.
 */
const VERSION = '%%BUILD%%';
const CACHE = 'thelab-' + VERSION;
const FARM_SCRIPT = `js/maquinas-farm-controller.js?v=${VERSION}`;

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('thelab-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function injectFarmController(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!/text\/html/i.test(type)) return response;
  const html = await response.text();
  if (html.includes('maquinas-farm-controller.js')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const tag = `<script src="${FARM_SCRIPT}"></script>`;
  const out = html.includes('</body>') ? html.replace('</body>', `${tag}\n</body>`) : html + tag;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(out, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith((async()=>{
      try {
        const network = await fetch(req, { cache: 'no-cache' });
        const cooked = await injectFarmController(network);
        const copy = cooked.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return cooked;
      } catch (_) {
        return caches.match(req);
      }
    })());
    return;
  }

  if (url.searchParams.has('v')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return r;
      }))
    );
    return;
  }

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
});
