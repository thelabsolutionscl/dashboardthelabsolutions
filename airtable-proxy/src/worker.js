const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,anthropic-version,x-api-key',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, airtable: !!env.AIRTABLE_TOKEN });
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!appKey || appKey !== env.APP_KEY) {
      return json({ error: 'Unauthorized' }, 403);
    }

    // Latido para la "Oficina Virtual": marca este Worker como Activo en la tabla
    // Automations. Best-effort, throttled y fuera del camino crítico (waitUntil),
    // por lo que no añade latencia ni puede romper la respuesta.
    if (ctx && env.AIRTABLE_TOKEN) ctx.waitUntil(heartbeat(env).catch(() => {}));

    // ── Anthropic (Claude) — la API key vive como secreto del Worker ──
    // El dashboard llama a:  <worker>/anthropic/v1/messages
    if (url.pathname === '/anthropic/v1/messages' || url.pathname.startsWith('/anthropic/')) {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500);
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
      return json({ error: 'Worker misconfigured: missing AIRTABLE_TOKEN secret' }, 500);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Heartbeat hacia la tabla Automations ──────────────────────────────
// Actualiza la fila ID="airtable-proxy" con Estado=Activo y la hora actual,
// como máximo una vez cada 5 min (throttle por isolate). Totalmente opcional:
// si la base/tabla no existen o el token no puede escribir, falla en silencio.
let _lastBeat = 0;
const HEARTBEAT_ID = 'airtable-proxy';
const HEARTBEAT_TABLE = 'Automations';
const HEARTBEAT_MIN_MS = 5 * 60 * 1000;

async function heartbeat(env) {
  const now = Date.now();
  if (now - _lastBeat < HEARTBEAT_MIN_MS) return;
  _lastBeat = now;

  const base = env.HEARTBEAT_BASE || 'app1YtD74AqiPWQhy';
  const auth = { Authorization: 'Bearer ' + env.AIRTABLE_TOKEN };
  const tbl = `${AIRTABLE_BASE}/v0/${base}/${encodeURIComponent(HEARTBEAT_TABLE)}`;

  // 1) Buscar la fila del proxy por su ID técnico
  const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${HEARTBEAT_ID}'`)}`;
  const found = await fetch(q, { headers: auth });
  if (!found.ok) return;
  const data = await found.json();
  const rec = data.records && data.records[0];
  if (!rec) return;

  // 2) Marcar como Activo con la hora actual
  await fetch(`${tbl}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        Estado: 'Activo',
        UltimaEjecucion: new Date().toISOString(),
        TareaActual: 'Proxy seguro Airtable + Claude operativo',
      },
      typecast: true,
    }),
  });
}
