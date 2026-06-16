const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

// Cabeceras CORS base (sin el Allow-Origin, que se resuelve por petición según
// la allowlist en env.ALLOWED_ORIGINS).
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key',
};

// Resuelve las cabeceras CORS para una petición concreta.
// - Si env.ALLOWED_ORIGINS está definida (lista separada por comas), refleja el
//   Origin solo si está en la lista y añade `Vary: Origin`.
// - Si NO está definida, conserva el comportamiento actual ('*') pero avisa.
function corsHeaders(request, env) {
  const headers = { ...CORS_BASE };
  const allowlist = (env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) {
    console.warn('[airtable-proxy] ALLOWED_ORIGINS no definida — CORS abierto a "*". Configúrala para restringir orígenes.');
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  const origin = request.headers.get('Origin') || '';
  headers['Vary'] = 'Origin';
  if (origin && allowlist.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    // Origen no permitido: no reflejamos. Caemos al primero de la lista para
    // mantener una cabecera válida (el navegador bloqueará si no coincide).
    headers['Access-Control-Allow-Origin'] = allowlist[0];
  }
  return headers;
}

// Comparación de cadenas en tiempo constante para evitar timing attacks sobre
// la clave de aplicación. Codifica a bytes UTF-8 y compara longitud fija.
function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a == null ? '' : a));
  const bb = enc.encode(String(b == null ? '' : b));
  // Longitud distinta → no igual, pero seguimos recorriendo para no filtrar
  // la longitud por tiempo.
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] || 0) ^ (bb[i] || 0);
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const CORS = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, airtable: !!env.AIRTABLE_TOKEN }, 200, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!appKey || !timingSafeEqualStr(appKey, env.APP_KEY || '')) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }

    // ── Whitelist de métodos/rutas ────────────────────────────────────────────
    // Bloquea la Metadata API (lectura/escritura de esquema de bases) y el
    // método DELETE, salvo que env.ALLOW_UNSAFE === 'true'. El path /anthropic/
    // se deja pasar tal cual.
    const allowUnsafe = env.ALLOW_UNSAFE === 'true';
    const isAnthropic = url.pathname.startsWith('/anthropic/');
    if (!allowUnsafe && !isAnthropic) {
      const isMeta = url.pathname.startsWith('/v0/meta') || url.pathname.includes('meta/bases');
      if (isMeta) {
        return json({ error: 'Forbidden: Metadata API bloqueada' }, 403, CORS);
      }
      if (request.method === 'DELETE') {
        return json({ error: 'Forbidden: método DELETE bloqueado' }, 403, CORS);
      }
    }

    // ── Anthropic (Claude) — la API key vive como secreto del Worker ──
    // El dashboard llama a:  <worker>/anthropic/v1/messages
    if (url.pathname === '/anthropic/v1/messages' || url.pathname.startsWith('/anthropic/')) {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500, CORS);
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
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // ── Airtable (default) — el PAT vive como secreto del Worker ──
    if (!env.AIRTABLE_TOKEN) {
      return json({ error: 'Worker misconfigured: missing AIRTABLE_TOKEN secret' }, 500, CORS);
    }
    // El dashboard ya incluye /v0 en algunas rutas; normalizamos a una sola /v0
    const path = url.pathname.startsWith('/v0/') ? url.pathname : '/v0' + url.pathname;
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
    Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));

    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  },
};

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
