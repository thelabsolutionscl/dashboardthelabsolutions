const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

// Cabeceras CORS que NO dependen del origen (métodos/headers permitidos).
// El valor de Access-Control-Allow-Origin se calcula por request en corsOrigin().
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,anthropic-version,x-api-key',
  Vary: 'Origin',
};

// Calcula el valor de Access-Control-Allow-Origin según una allowlist.
// - Si env.ALLOWED_ORIGINS está definida (lista separada por comas) y el Origin
//   de la request está en ella, se refleja ese origen.
// - Si no está definida, se mantiene '*' por retrocompatibilidad.
// - Si está definida pero el origen no coincide, no se autoriza ningún origen.
function corsOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const raw = (env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return '*'; // retrocompat: sin allowlist configurada => abierto
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : '';
}

// Construye el set completo de cabeceras CORS para una request concreta.
function corsHeaders(request, env) {
  const headers = { ...CORS_BASE };
  const allowOrigin = corsOrigin(request, env);
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

// Comparación de tiempo constante para strings ASCII (passphrase / APP_KEY).
// Recorre todo el largo y rechaza inmediatamente si difiere el largo, para no
// filtrar información por canal lateral de temporización.
function timingSafeEqualStr(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, airtable: !!env.AIRTABLE_TOKEN }, 200, cors);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real.
    // Comparación de tiempo constante para evitar ataques de temporización.
    const appKey = request.headers.get('X-App-Key');
    if (!appKey || !env.APP_KEY || !timingSafeEqualStr(appKey, env.APP_KEY)) {
      return json({ error: 'Unauthorized' }, 403, cors);
    }

    // ── Anthropic (Claude) — la API key vive como secreto del Worker ──
    // El dashboard llama a:  <worker>/anthropic/v1/messages
    if (url.pathname === '/anthropic/v1/messages' || url.pathname.startsWith('/anthropic/')) {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500, cors);
      }
      const target = ANTHROPIC_BASE + url.pathname.replace(/^\/anthropic/, '') + url.search;
      const headers = new Headers();
      headers.set('x-api-key', env.ANTHROPIC_TOKEN);
      headers.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
      headers.set('Content-Type', 'application/json');
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      });
      const respHeaders = new Headers(upstream.headers);
      Object.entries(cors).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // ── Airtable (default) — el PAT vive como secreto del Worker ──
    if (!env.AIRTABLE_TOKEN) {
      return json({ error: 'Worker misconfigured: missing AIRTABLE_TOKEN secret' }, 500, cors);
    }
    // El dashboard ya incluye /v0 en algunas rutas; normalizamos a una sola /v0
    const path = url.pathname.startsWith('/v0/') ? url.pathname : '/v0' + url.pathname;

    // Allowlist opcional de tablas (defensa en profundidad). Si env.ALLOWED_TABLES
    // está definida (lista separada por comas), solo se permiten rutas de Airtable
    // que apunten a esas tablas (formato /v0/<baseId>/<tabla>...). Si no está
    // definida, se deja pasar todo (retrocompat). No afecta a /anthropic/*.
    const tablesRaw = (env.ALLOWED_TABLES || '').trim();
    if (tablesRaw) {
      const allowedTables = tablesRaw.split(',').map((s) => s.trim()).filter(Boolean);
      // /v0/<baseId>/<tabla>/<...>  → segmento de tabla es el índice 3
      const segs = path.split('/').filter(Boolean); // ['v0', baseId, tabla, ...]
      const tableSeg = segs[2] ? decodeURIComponent(segs[2]) : '';
      if (!tableSeg || !allowedTables.includes(tableSeg)) {
        return json({ error: 'Forbidden: table not allowed' }, 403, cors);
      }
    }

    const target = AIRTABLE_BASE + path + url.search;

    const headers = new Headers();
    headers.set('Authorization', 'Bearer ' + env.AIRTABLE_TOKEN);
    const ct = request.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const respHeaders = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => respHeaders.set(k, v));

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
