/* Service worker del dashboard — el deploy estampa %%BUILD%%.
 *
 * Regla principal: NUNCA modificar ni cachear el HTML de navegación.
 * El dashboard cambia con frecuencia y mezclar un index.html de una versión con
 * JS/CSS de otra puede dejar el shell en negro hasta borrar datos del sitio.
 *
 * Estrategia:
 *  - Navegación / index.html -> red directa con cache reload; el SW no la guarda.
 *  - Assets versionados con ?v= -> cache-first (el hash de build cambia la URL).
 *  - Imágenes -> stale-while-revalidate.
 *  - APIs/CDNs/POST -> fuera del service worker.
 */
const VERSION = '%%BUILD%%';
const CACHE = 'thelab-' + VERSION;

self.addEventListener('install', event => {
  // La nueva versión no debe quedar esperando detrás de un SW viejo.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('thelab-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function offlineNavigationResponse() {
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0a0a"><title>Dashboard sin conexión</title><body style="margin:0;background:#0a0a0a;color:#e8e8e8;font:14px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;padding:28px;text-align:center"><h1 style="font-size:18px">Sin conexión</h1><p style="color:#aaa;line-height:1.5">No se pudo cargar una copia actual del dashboard. Revisa la conexión y vuelve a intentar.</p><button onclick="location.reload()" style="background:#00d4cc;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer">Reintentar</button></main></body></html>`, {
    status: 503,
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
  });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML siempre debe provenir de red. Antes el SW reescribía index.html para
  // inyectar maquinas-farm-controller.js; hoy ese módulo ya se carga desde el
  // bootstrap normal, por lo que esa mutación era redundante y podía mezclar
  // versiones del shell.
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req, {cache:'reload'}).catch(() => offlineNavigationResponse())
    );
    return;
  }

  // Sólo assets con versión explícita son persistentes. Al cambiar %%BUILD%% la
  // URL cambia, así que no existe riesgo de reutilizar JS/CSS de otro deploy.
  if (url.searchParams.has('v')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const response = await fetch(req, {cache:'no-cache'});
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req, response.clone());
      }
      return response;
    })());
    return;
  }

  if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      const network = fetch(req, {cache:'no-cache'}).then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(req, response.clone());
        }
        return response;
      }).catch(() => hit);
      return hit || network;
    })());
  }
});
