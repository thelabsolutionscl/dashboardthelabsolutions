const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';

// Solo se aceptan peticiones desde estos orígenes (el dashboard). Así, si la
// APP_KEY se filtrara (va horneada en el HTML público), no sirve desde otro sitio.
const ALLOWED_ORIGINS = [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
];
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,anthropic-version,x-api-key',
  'Vary': 'Origin',
};
// Headers CORS reflejando el origen permitido (si no, el principal).
function cors(origin) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, ...CORS_BASE };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const CORS = cors(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, openai: !!env.OPENAI_TOKEN, airtable: !!env.AIRTABLE_TOKEN }, 200, CORS);
    }

    // Allowlist de origen: un navegador en otro sitio (Origin distinto) se rechaza.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!appKey || appKey !== env.APP_KEY) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }

    // ── SEO fetch — trae el HTML de una página del PROPIO sitio para auditarla ──
    // Restringido a thelab.solutions (sin SSRF). Evita el CORS del navegador.
    if (url.pathname === '/seo-fetch') {
      let t;
      try { t = new URL(url.searchParams.get('url') || ''); } catch { return json({ error: 'URL inválida' }, 400, CORS); }
      const okHost = t.hostname === 'thelab.solutions' || t.hostname === 'www.thelab.solutions';
      if (t.protocol !== 'https:' || !okHost) {
        return json({ error: 'Solo se permite auditar thelab.solutions' }, 403, CORS);
      }
      try {
        const up = await fetch(t.toString(), { headers: { 'User-Agent': 'TheLab-SEO-Auditor/1.0' }, redirect: 'follow' });
        const html = await up.text();
        return json({ ok: true, status: up.status, finalUrl: up.url || t.toString(), html }, 200, CORS);
      } catch (e) {
        return json({ error: 'No se pudo traer la página: ' + (e && e.message || e) }, 502, CORS);
      }
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

    // ── OpenAI (visión + generación de imágenes de la ficha propuesta) ──
    // La API key vive como secreto del Worker; el navegador NO puede llamar a
    // api.openai.com directo (OpenAI no habilita CORS de navegador, a diferencia de
    // Anthropic). El dashboard llama a:  <worker>/openai/v1/{chat/completions,images/generations,images/edits}
    if (url.pathname.startsWith('/openai/')) {
      if (!env.OPENAI_TOKEN) {
        return json({ error: 'Worker misconfigured: missing OPENAI_TOKEN secret' }, 500, CORS);
      }
      const target = OPENAI_BASE + url.pathname.replace(/^\/openai/, '') + url.search;
      const headers = new Headers();
      headers.set('Authorization', 'Bearer ' + env.OPENAI_TOKEN);
      // Preserva el Content-Type ORIGINAL: en images/edits es multipart/form-data con
      // su boundary — forzarlo a JSON rompería el cuerpo. En el resto es application/json.
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

function json(data, status = 200, corsHeaders = cors('')) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
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

  // 2) Marcar como Activo con la hora actual; EjecucionesHoy con reseteo diario
  const f = rec.fields || {};
  const sameDay = f.UltimaEjecucion && new Date(f.UltimaEjecucion).toDateString() === new Date().toDateString();
  const ej = (sameDay ? (Number(f.EjecucionesHoy) || 0) : 0) + 1;
  await fetch(`${tbl}/${rec.id}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        Estado: 'Activo',
        UltimaEjecucion: new Date().toISOString(),
        EjecucionesHoy: ej,
        TareaActual: 'Proxy seguro Airtable + Claude operativo',
      },
      typecast: true,
    }),
  });
}
