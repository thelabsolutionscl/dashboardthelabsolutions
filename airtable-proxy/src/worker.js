const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';
// Defensa de costo en el servidor: aunque alguien manipule el JavaScript del
// navegador, el proxy nunca permite Opus, Fable ni modelos futuros no revisados.
const ANTHROPIC_ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
]);
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4000;
const ANTHROPIC_DAILY_BUDGET_USD_DEFAULT = 1.00;
const ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT = 0.20;
const ANTHROPIC_PRICES = {
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

// Solo se aceptan peticiones desde estos orígenes (el dashboard). Así, si la
// APP_KEY se filtrara (va horneada en el HTML público), no sirve desde otro sitio.
const ALLOWED_ORIGINS = [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
];
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,X-AI-Agent,anthropic-version,x-api-key',
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

    // Allowlist de origen: solo se aceptan peticiones cuyo Origin esté en la lista.
    // Antes el chequeo era `if (origin && ...)`, así que una petición SIN header
    // Origin (curl, un script, server-to-server) se lo saltaba por completo: con la
    // APP_KEY —que va horneada en el HTML público— cualquiera podía leer/escribir
    // Airtable o gastar créditos de Claude/OpenAI desde fuera del navegador. Todo
    // cliente legítimo es un navegador en el dashboard, que SIEMPRE manda Origin
    // (la petición lleva X-App-Key, un header que fuerza CORS y no se puede falsear
    // desde otra página). /health queda libre más arriba para los monitores.
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Forbidden origin' }, 403, CORS);
    }

    // Auth — la passphrase nunca sale al cliente como un token de servicio real
    const appKey = request.headers.get('X-App-Key');
    if (!appKey || appKey !== env.APP_KEY) {
      return json({ error: 'Unauthorized' }, 403, CORS);
    }

    if (url.pathname === '/anthropic/usage') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, CORS);
      const usage = await readAiBudget(env);
      return json(usage, 200, CORS);
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
    if (url.pathname === '/anthropic/v1/messages') {
      if (!env.ANTHROPIC_TOKEN) {
        return json({ error: 'Worker misconfigured: missing ANTHROPIC_TOKEN secret' }, 500, CORS);
      }
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, CORS);
      let payload;
      try { payload = await readAnthropicJson(request); }
      catch (_) { return json({ error: 'Invalid Anthropic JSON body' }, 400, CORS); }
      if (!payload || !ANTHROPIC_ALLOWED_MODELS.has(payload.model)) {
        return json({ error: 'Anthropic model not allowed by cost policy' }, 403, CORS);
      }
      const maxTokens = Number(payload.max_tokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > ANTHROPIC_MAX_OUTPUT_TOKENS) {
        return json({ error: `max_tokens must be between 1 and ${ANTHROPIC_MAX_OUTPUT_TOKENS}` }, 400, CORS);
      }
      const source = sanitizeAiSource(request.headers.get('X-AI-Agent') || 'dashboard');
      const reservation = await reserveAiBudget(env, payload, source);
      if (!reservation.ok) {
        return json({
          error: reservation.error,
          code: 'AI_BUDGET_LIMIT',
          budget_usd: reservation.budget_usd,
          used_usd: reservation.used_usd,
          estimated_request_usd: reservation.estimated_request_usd,
        }, reservation.status || 429, CORS);
      }
      const target = ANTHROPIC_BASE + url.pathname.replace(/^\/anthropic/, '') + url.search;
      const headers = new Headers();
      headers.set('x-api-key', env.ANTHROPIC_TOKEN);
      headers.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
      headers.set('Content-Type', 'application/json');
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: JSON.stringify(payload),
      });
      const usageCopy = upstream.clone();
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(reconcileAiBudget(env, reservation, usageCopy).catch(() => {}));
      }
      const respHeaders = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    }

    // No funciona como proxy Anthropic genérico: solo Messages está expuesto.
    if (url.pathname.startsWith('/anthropic/')) return json({ error: 'Anthropic endpoint not allowed' }, 404, CORS);

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


function sanitizeAiSource(value) {
  return String(value || 'dashboard').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48) || 'dashboard';
}
function aiChileDate() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  catch (_) { return new Date().toISOString().slice(0, 10); }
}
function aiPrice(model) {
  return String(model || '').toLowerCase().includes('haiku') ? ANTHROPIC_PRICES.haiku : ANTHROPIC_PRICES.sonnet;
}
function aiCostUsd(model, usage) {
  const p = aiPrice(model), u = usage || {}, n = (k) => Math.max(0, Number(u[k]) || 0);
  return (n('input_tokens') * p.input +
    n('output_tokens') * p.output +
    n('cache_creation_input_tokens') * p.cacheWrite +
    n('cache_read_input_tokens') * p.cacheRead) / 1000000;
}
function estimateAiRequestUsd(payload) {
  const model = payload && payload.model;
  const p = aiPrice(model);
  const inputObj = { system: payload?.system || '', messages: payload?.messages || [], tools: payload?.tools || [] };
  const chars = JSON.stringify(inputObj).length;
  // 3 chars/token intentionally over-reserves versus the common ~4 chars/token.
  const inputTokens = Math.ceil(chars / 3);
  const outputTokens = Math.max(0, Number(payload?.max_tokens) || 0);
  return (inputTokens * p.input + outputTokens * p.output) / 1000000;
}
async function readAiBudget(env) {
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  const key = 'anthropic-budget:' + aiChileDate();
  if (!env.AI_BUDGET) {
    return { configured: false, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: 0, reserved_usd: 0, used_usd: 0, remaining_usd: 0, requests: 0, by_source: {} };
  }
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  const spent = Math.max(0, Number(row.spent_usd) || 0);
  const reserved = Math.max(0, Number(row.reserved_usd) || 0);
  return {
    configured: true, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
    spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
    remaining_usd: Math.max(0, budget - spent - reserved),
    requests: Math.max(0, Number(row.requests) || 0), by_source: row.by_source || {},
    updated_at: row.updated_at || null,
  };
}
async function reserveAiBudget(env, payload, source) {
  const snap = await readAiBudget(env);
  const estimate = estimateAiRequestUsd(payload);
  if (!snap.configured) return { ok: false, status: 503, error: 'AI cost guard unavailable', budget_usd: snap.budget_usd, used_usd: 0, estimated_request_usd: estimate };
  if (estimate > snap.request_budget_usd) return { ok: false, status: 429, error: 'AI request exceeds per-request cost limit', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
  if (snap.used_usd + estimate > snap.budget_usd) return { ok: false, status: 429, error: 'Daily AI budget reached', budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };

  const key = 'anthropic-budget:' + snap.date;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0);
  row.reserved_usd = Math.max(0, Number(row.reserved_usd) || 0) + estimate;
  row.requests = Math.max(0, Number(row.requests) || 0) + 1;
  row.by_source = row.by_source || {};
  const src = row.by_source[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.requests = Math.max(0, Number(src.requests) || 0) + 1;
  src.reserved_usd = Math.max(0, Number(src.reserved_usd) || 0) + estimate;
  row.by_source[source] = src;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  return { ok: true, key, source, estimate, model: payload.model, budget_usd: snap.budget_usd, used_usd: snap.used_usd, estimated_request_usd: estimate };
}
async function parseAnthropicUsage(response) {
  if (!response || !response.ok) return null;
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const txt = await response.text();
    let model = '', usage = {};
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(t.slice(5).trim()); } catch (_) { continue; }
      if (ev.type === 'message_start' && ev.message) {
        model = ev.message.model || model;
        usage = { ...usage, ...(ev.message.usage || {}) };
      } else if (ev.type === 'message_delta' && ev.usage) {
        usage = { ...usage, ...ev.usage };
      }
    }
    return Object.keys(usage).length ? { model, usage } : null;
  }
  try {
    const j = await response.json();
    return j && j.usage ? { model: j.model || '', usage: j.usage } : null;
  } catch (_) { return null; }
}
async function reconcileAiBudget(env, reservation, response) {
  if (!env.AI_BUDGET || !reservation?.ok) return;
  const parsed = await parseAnthropicUsage(response);
  // Si no hay usage verificable, mantenemos la reserva: fail-safe de costo.
  if (!parsed) return;
  const actual = aiCostUsd(parsed.model || reservation.model, parsed.usage);
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}

async function readAnthropicJson(request) {
  // Request real de Cloudflare: clone evita consumir el stream que luego se
  // reenvía. El fallback string mantiene simples las pruebas unitarias.
  if (request && typeof request.clone === 'function') return request.clone().json();
  if (typeof request.body === 'string') return JSON.parse(request.body);
  if (request.body && typeof request.body.text === 'function') return JSON.parse(await request.body.text());
  throw new Error('body unavailable');
}

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
