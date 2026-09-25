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
// Una reserva representa una llamada en curso. El cliente corta las llamadas a los 60 s,
// así que cualquier reserva de más de 2 min es huérfana y no debe bloquear el día.
const AI_RESERVATION_STALE_MS = 2 * 60 * 1000;
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


/**
 * Contador de costo Anthropic con serialización real.
 *
 * KV se mantiene únicamente para migrar el saldo del día del guard anterior.
 * Todas las decisiones nuevas de presupuesto pasan por UNA instancia de este
 * Durable Object, evitando el read -> modify -> write concurrente de KV.
 */
export class AiBudgetGuard {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this._queue = Promise.resolve();
  }

  fetch(request) {
    // Una sola cola por Durable Object: reserva/reconciliación/lectura nunca
    // observan el mismo saldo en paralelo.
    const run = this._queue.then(() => this._handle(request));
    this._queue = run.catch(() => {});
    return run;
  }

  async _handle(request) {
    if (request.method !== 'POST') return this._json({ error: 'Method not allowed' }, 405);
    let payload = {};
    try { payload = await request.json(); }
    catch (_) { return this._json({ error: 'Invalid budget payload' }, 400); }

    const url = new URL(request.url);
    const date = String(payload.date || aiChileDate()).slice(0, 10);
    const budget = Math.max(0.05, Number(payload.budget_usd) || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT);
    const perRequest = Math.max(0.01, Number(payload.request_budget_usd) || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT);
    const maxConcurrent = Math.max(1, Math.min(4, Number(payload.max_concurrent) || 2));
    const loaded = await this._load(date);
    const row = loaded.row;

    if (url.pathname === '/usage') {
      return this._json(this._snapshot(date, budget, perRequest, row));
    }

    if (url.pathname === '/reserve') {
      const estimate = Math.max(0, Number(payload.estimated_request_usd) || 0);
      const source = sanitizeAiSource(payload.source || 'dashboard');
      const model = String(payload.model || '');

      if (estimate > perRequest) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'AI request exceeds per-request cost limit',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const active = Object.keys(row.reservations || {}).length;
      if (active >= maxConcurrent) {
        const snap = this._snapshot(date, budget, perRequest, row);
        return this._json({
          ok: false, status: 429, error: 'Too many concurrent AI requests',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const snap = this._snapshot(date, budget, perRequest, row);
      if (snap.used_usd + estimate > budget) {
        return this._json({
          ok: false, status: 429, error: 'Daily AI budget reached',
          budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
        });
      }

      const reservationId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      row.reservations = row.reservations || {};
      row.reservations[reservationId] = {
        estimate, source, model, at: new Date().toISOString(),
      };
      row.requests = Math.max(0, Number(row.requests) || 0) + 1;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.requests = Math.max(0, Number(src.requests) || 0) + 1;
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0);
      row.by_source[source] = src;
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);

      return this._json({
        ok: true, date, reservation_id: reservationId, source, estimate, model,
        budget_usd: budget, used_usd: snap.used_usd, estimated_request_usd: estimate,
      });
    }

    if (url.pathname === '/release') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};
      if (!row.finalized[reservationId]) {
        delete row.reservations[reservationId];
        row.finalized[reservationId] = { kind: 'release', at: new Date().toISOString() };
      }
      row.last_release_reason = String(payload.reason || 'no_usage').slice(0, 80);
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true });
    }

    if (url.pathname === '/reconcile') {
      const reservationId = String(payload.reservation_id || '');
      row.reservations = row.reservations || {};
      row.finalized = row.finalized || {};

      // Idempotencia: un waitUntil repetido o una entrega duplicada no cobra dos veces.
      if (row.finalized[reservationId]) return this._json({ ok: true, already_finalized: true });

      const reservation = row.reservations[reservationId] || null;
      const actual = Math.max(0, Number(payload.actual_usd) || 0);
      const source = sanitizeAiSource((reservation && reservation.source) || payload.source || 'dashboard');
      delete row.reservations[reservationId];

      row.spent_usd = Math.max(0, Number(row.spent_usd) || 0) + actual;
      row.by_source = row.by_source || {};
      const src = row.by_source[source] || { requests: 0, spent_usd: 0 };
      src.spent_usd = Math.max(0, Number(src.spent_usd) || 0) + actual;
      src.requests = Math.max(0, Number(src.requests) || 0);
      row.by_source[source] = src;
      row.finalized[reservationId] = { kind: 'reconcile', at: new Date().toISOString() };
      row.updated_at = new Date().toISOString();
      await this._save(loaded.key, row);
      return this._json({ ok: true, actual_usd: actual });
    }

    return this._json({ error: 'Unknown budget operation' }, 404);
  }

  async _load(date) {
    const key = 'anthropic-budget:' + date;
    let row = await this.state.storage.get(key);

    // Primer acceso después del deploy: migra el saldo KV del día de forma
    // conservadora. Las reservas agregadas antiguas se consideran ya gastadas,
    // así el cambio de guard NO regala presupuesto adicional a mitad del día.
    if (!row || typeof row !== 'object') {
      row = { spent_usd: 0, requests: 0, by_source: {}, reservations: {}, finalized: {} };
      try {
        const legacyRaw = this.env && this.env.AI_BUDGET ? await this.env.AI_BUDGET.get(key) : null;
        const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
        if (legacy && typeof legacy === 'object') {
          row.spent_usd = Math.max(0, Number(legacy.spent_usd) || 0) +
            Math.max(0, Number(legacy.reserved_usd) || 0);
          row.requests = Math.max(0, Number(legacy.requests) || 0);
          row.by_source = {};
          for (const [name, value] of Object.entries(legacy.by_source || {})) {
            row.by_source[sanitizeAiSource(name)] = {
              requests: Math.max(0, Number(value && value.requests) || 0),
              spent_usd: Math.max(0, Number(value && value.spent_usd) || 0) +
                Math.max(0, Number(value && value.reserved_usd) || 0),
            };
          }
          row.migrated_from_kv = true;
          row.migrated_at = new Date().toISOString();
        }
      } catch (_) {}
    }

    row.reservations = row.reservations || {};
    row.finalized = row.finalized || {};
    row.by_source = row.by_source || {};

    const now = Date.now();
    let dirty = false;
    for (const [id, reservation] of Object.entries(row.reservations)) {
      const at = Date.parse(reservation && reservation.at || '');
      if (!Number.isFinite(at) || now - at > AI_RESERVATION_STALE_MS) {
        delete row.reservations[id];
        dirty = true;
      }
    }
    for (const [id, finalized] of Object.entries(row.finalized)) {
      const at = Date.parse(finalized && finalized.at || '');
      if (!Number.isFinite(at) || now - at > 24 * 60 * 60 * 1000) {
        delete row.finalized[id];
        dirty = true;
      }
    }
    if (dirty) {
      row.recovered_stale_reservation_at = new Date().toISOString();
      row.updated_at = row.recovered_stale_reservation_at;
    }
    if (dirty || row.migrated_from_kv) await this._save(key, row);
    return { key, row };
  }

  async _save(key, row) {
    await this.state.storage.put(key, row);
  }

  _snapshot(date, budget, perRequest, row) {
    let reserved = 0;
    const bySource = {};
    for (const [name, src] of Object.entries(row.by_source || {})) {
      bySource[name] = {
        requests: Math.max(0, Number(src && src.requests) || 0),
        spent_usd: Math.max(0, Number(src && src.spent_usd) || 0),
        reserved_usd: 0,
      };
    }
    for (const reservation of Object.values(row.reservations || {})) {
      const estimate = Math.max(0, Number(reservation && reservation.estimate) || 0);
      reserved += estimate;
      const source = sanitizeAiSource(reservation && reservation.source || 'dashboard');
      bySource[source] = bySource[source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
      bySource[source].reserved_usd += estimate;
    }
    const spent = Math.max(0, Number(row.spent_usd) || 0);
    return {
      configured: true, atomic: true, date, budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
      remaining_usd: Math.max(0, budget - spent - reserved),
      requests: Math.max(0, Number(row.requests) || 0),
      by_source: bySource, updated_at: row.updated_at || null,
    };
  }

  _json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
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
      const reconciliation = reconcileAiBudget(env, reservation, usageCopy).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(reconciliation);
      else await reconciliation;
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

async function aiBudgetGuardCall(env, pathname, payload) {
  if (!env.AI_BUDGET_GUARD) throw new Error('AI budget Durable Object unavailable');
  const id = env.AI_BUDGET_GUARD.idFromName('anthropic-global-budget');
  const stub = env.AI_BUDGET_GUARD.get(id);
  const response = await stub.fetch('https://ai-budget.internal' + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) throw new Error('AI budget guard HTTP ' + response.status);
  return response.json();
}

async function readAiBudget(env) {
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  const guardDate = aiChileDate();
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/usage', {
        date: guardDate, budget_usd: budget, request_budget_usd: perRequest,
      });
    } catch (_) {
      return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
        request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
        remaining_usd: 0, requests: 0, by_source: {} };
    }
  }
  // Solo las pruebas unitarias pueden usar el ledger KV legado. Producción falla
  // cerrado si el Durable Object no está enlazado.
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { configured: false, atomic: false, date: guardDate, budget_usd: budget,
      request_budget_usd: perRequest, spent_usd: 0, reserved_usd: 0, used_usd: 0,
      remaining_usd: 0, requests: 0, by_source: {} };
  }
  const key = 'anthropic-budget:' + guardDate;
  if (!env.AI_BUDGET) {
    return { configured: false, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
      spent_usd: 0, reserved_usd: 0, used_usd: 0, remaining_usd: 0, requests: 0, by_source: {} };
  }
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(key)) || '{}'); } catch (_) {}
  const spent = Math.max(0, Number(row.spent_usd) || 0);
  let reserved = Math.max(0, Number(row.reserved_usd) || 0);
  // Autorreparación: antes una respuesta 4xx/5xx de Anthropic podía dejar la reserva
  // atrapada hasta 48 h. Eso hacía que, incluso después de recargar créditos,
  // el dashboard siguiera respondiendo AI_BUDGET_LIMIT. Las reservas viejas no son gasto.
  const reservationAt = Date.parse(row.reserved_at || row.updated_at || '');
  if (reserved > 0 && (!Number.isFinite(reservationAt) || Date.now() - reservationAt > AI_RESERVATION_STALE_MS)) {
    reserved = 0;
    row.reserved_usd = 0;
    row.by_source = row.by_source || {};
    for (const src of Object.values(row.by_source)) if (src && typeof src === 'object') src.reserved_usd = 0;
    row.reserved_at = null;
    row.recovered_stale_reservation_at = new Date().toISOString();
    row.updated_at = row.recovered_stale_reservation_at;
    await env.AI_BUDGET.put(key, JSON.stringify(row), { expirationTtl: 172800 });
  }
  return {
    configured: true, date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
    spent_usd: spent, reserved_usd: reserved, used_usd: spent + reserved,
    remaining_usd: Math.max(0, budget - spent - reserved),
    requests: Math.max(0, Number(row.requests) || 0), by_source: row.by_source || {},
    updated_at: row.updated_at || null,
  };
}
async function reserveAiBudget(env, payload, source) {
  const estimate = estimateAiRequestUsd(payload);
  const budget = Math.max(0.05, Number(env.ANTHROPIC_DAILY_BUDGET_USD || ANTHROPIC_DAILY_BUDGET_USD_DEFAULT));
  const perRequest = Math.max(0.01, Number(env.ANTHROPIC_REQUEST_BUDGET_USD || ANTHROPIC_REQUEST_BUDGET_USD_DEFAULT));
  if (env.AI_BUDGET_GUARD) {
    try {
      return await aiBudgetGuardCall(env, '/reserve', {
        date: aiChileDate(), budget_usd: budget, request_budget_usd: perRequest,
        max_concurrent: 2, estimated_request_usd: estimate, source, model: payload && payload.model,
      });
    } catch (_) {
      return { ok: false, status: 503, error: 'AI cost guard unavailable',
        budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
    }
  }
  if (!env.__TEST_ALLOW_KV_BUDGET) {
    return { ok: false, status: 503, error: 'AI cost guard unavailable',
      budget_usd: budget, used_usd: 0, estimated_request_usd: estimate };
  }
  const snap = await readAiBudget(env);
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
  row.reserved_at = row.updated_at;
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
async function releaseAiReservation(env, reservation, reason) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    try {
      await aiBudgetGuardCall(env, '/release', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        reason: String(reason || 'no_usage').slice(0, 80),
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  let row = {};
  try { row = JSON.parse((await env.AI_BUDGET.get(reservation.key)) || '{}'); } catch (_) {}
  row.reserved_usd = Math.max(0, (Number(row.reserved_usd) || 0) - reservation.estimate);
  row.by_source = row.by_source || {};
  const src = row.by_source[reservation.source] || { requests: 0, spent_usd: 0, reserved_usd: 0 };
  src.reserved_usd = Math.max(0, (Number(src.reserved_usd) || 0) - reservation.estimate);
  row.by_source[reservation.source] = src;
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
  row.last_release_reason = String(reason || 'no_usage').slice(0, 80);
  row.updated_at = new Date().toISOString();
  await env.AI_BUDGET.put(reservation.key, JSON.stringify(row), { expirationTtl: 172800 });
}
async function reconcileAiBudget(env, reservation, response) {
  if (!reservation?.ok) return;
  if (env.AI_BUDGET_GUARD) {
    if (!response || !response.ok) {
      await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
      return;
    }
    const parsedAtomic = await parseAnthropicUsage(response);
    // Un 2xx sin usage conserva su reserva; el guard la vence a los 2 min.
    if (!parsedAtomic) return;
    const actualAtomic = aiCostUsd(parsedAtomic.model || reservation.model, parsedAtomic.usage);
    try {
      await aiBudgetGuardCall(env, '/reconcile', {
        date: reservation.date || aiChileDate(),
        reservation_id: reservation.reservation_id || '',
        actual_usd: actualAtomic,
        source: reservation.source || 'dashboard',
      });
    } catch (_) {}
    return;
  }
  if (!env.__TEST_ALLOW_KV_BUDGET || !env.AI_BUDGET) return;
  // Un 4xx/5xx es un rechazo confirmado por Anthropic: no hubo una generación
  // facturable que justifique mantener la reserva. Liberarla permite reintentar
  // después de recargar créditos o resolver un rate limit.
  if (!response || !response.ok) {
    await releaseAiReservation(env, reservation, 'upstream_http_' + (response?.status || 'unknown'));
    return;
  }
  const parsed = await parseAnthropicUsage(response);
  // Si un 2xx excepcional no trae usage, conservamos la reserva por seguridad;
  // readAiBudget la recupera automáticamente si queda huérfana >2 min.
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
  if (row.reserved_usd <= 1e-9) row.reserved_at = null;
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
