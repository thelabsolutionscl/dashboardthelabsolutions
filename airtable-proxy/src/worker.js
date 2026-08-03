const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const OPENAI_BASE = 'https://api.openai.com';
const DEFAULT_ORIGINS = [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
];
const DEFAULT_AI_MODELS = [
  'claude-3-5-haiku-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-7-sonnet-latest',
  'claude-sonnet-4-20250514',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-image-1',
];
const AI_PATHS = new Set([
  '/anthropic/v1/messages',
  '/openai/v1/chat/completions',
  '/openai/v1/images/generations',
  '/openai/v1/images/edits',
]);
const STATE_KEYS = new Set(['cal-ops', 'print-queue', 'printer-odometer']);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 12 * 1024 * 1024;
const rateBuckets = new Map();
let accessKeysCache = { expiresAt: 0, issuer: '', keys: [] };
let lastHeartbeatAt = 0;

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function allowedOrigins(env) {
  return [...new Set([...DEFAULT_ORIGINS, ...csv(env.ALLOWED_ORIGINS)])];
}

function cors(origin, env) {
  const allowed = allowedOrigins(env);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,If-Match,If-None-Match,anthropic-version,X-App-Key',
    'Access-Control-Expose-Headers': 'ETag,X-Request-Id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function secureHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: secureHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...headers }),
  });
}

function requestId(request) {
  return request.headers.get('CF-Ray') || crypto.randomUUID();
}

function b64urlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function b64urlToJson(value) {
  const bytes = b64urlToBytes(value);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function normalizedTeamDomain(env) {
  const raw = String(env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  return /^https:\/\//i.test(raw) ? raw : `https://${raw}`;
}

async function getAccessKeys(env) {
  const issuer = normalizedTeamDomain(env);
  if (!issuer) throw new Error('CF_ACCESS_TEAM_DOMAIN no configurado');
  if (accessKeysCache.issuer === issuer && accessKeysCache.expiresAt > Date.now() && accessKeysCache.keys.length) {
    return accessKeysCache;
  }
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`No se pudieron obtener certificados Access (${response.status})`);
  const data = await response.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (!keys.length) throw new Error('Cloudflare Access no devolvió claves públicas');
  accessKeysCache = { issuer, keys, expiresAt: Date.now() + 5 * 60 * 1000 };
  return accessKeysCache;
}

async function verifyAccessJwt(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('JWT Access ausente o inválido');
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Algoritmo JWT no permitido');

  const { issuer, keys } = await getAccessKeys(env);
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error('Clave JWT desconocida');
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const validSignature = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) throw new Error('Firma JWT inválida');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error('JWT expirado');
  if (payload.nbf && payload.nbf > now + 30) throw new Error('JWT todavía no válido');
  if (String(payload.iss || '').replace(/\/$/, '') !== issuer) throw new Error('Issuer JWT inválido');
  const expectedAud = String(env.CF_ACCESS_AUD || '').trim();
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!expectedAud || !audiences.includes(expectedAud)) throw new Error('Audience JWT inválido');

  const email = String(payload.email || payload.common_name || '').toLowerCase();
  if (!email) throw new Error('JWT sin identidad');
  return { email, subject: payload.sub || email, mode: 'cloudflare-access', claims: payload };
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ''));
  const right = new TextEncoder().encode(String(b || ''));
  const length = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) diff |= (left[index % left.length] || 0) ^ (right[index % right.length] || 0);
  return diff === 0;
}

async function authenticate(request, env, origin) {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (assertion) return verifyAccessJwt(assertion, env);

  if (String(env.ALLOW_LEGACY_APP_KEY || '').toLowerCase() === 'true') {
    const allowed = allowedOrigins(env);
    const supplied = request.headers.get('X-App-Key') || '';
    if (!origin || !allowed.includes(origin)) throw new Error('Legacy auth exige un Origin permitido');
    if (!env.APP_KEY || !constantTimeEqual(supplied, env.APP_KEY)) throw new Error('Clave legacy inválida');
    return { email: 'legacy-dashboard', subject: 'legacy-dashboard', mode: 'legacy-app-key', claims: {} };
  }

  throw new Error('Cloudflare Access requerido');
}

function roleFor(auth, env) {
  const email = auth.email.toLowerCase();
  const admins = new Set(csv(env.ADMIN_EMAILS).map((item) => item.toLowerCase()));
  const writers = new Set(csv(env.WRITE_EMAILS).map((item) => item.toLowerCase()));
  if (admins.has(email)) return 'admin';
  if (writers.has(email)) return 'writer';
  return 'reader';
}

function enforceRateLimit(identity, env, type = 'default') {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const configured = Number(type === 'ai' ? env.AI_RATE_LIMIT_PER_MINUTE : env.RATE_LIMIT_PER_MINUTE);
  const limit = Number.isFinite(configured) && configured > 0 ? configured : type === 'ai' ? 20 : 180;
  const key = `${type}:${identity}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2000) {
    for (const [bucketKey, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(bucketKey);
  }
  if (bucket.count > limit) {
    const error = new Error('Demasiadas solicitudes');
    error.status = 429;
    error.retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw error;
  }
}

async function readBody(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) {
    const error = new Error('Cuerpo demasiado grande');
    error.status = 413;
    throw error;
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) {
    const error = new Error('Cuerpo demasiado grande');
    error.status = 413;
    throw error;
  }
  return body;
}

function allowedTables(env) {
  return new Set(csv(env.AIRTABLE_ALLOWED_TABLES));
}

function parseAirtablePath(url, env) {
  const normalized = url.pathname.replace(/^\/v0\//, '/').replace(/^\//, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) throw Object.assign(new Error('Ruta Airtable inválida'), { status: 404 });
  const base = decodeURIComponent(segments[0]);
  const table = decodeURIComponent(segments[1]);
  const configuredBase = String(env.AIRTABLE_BASE_ID || '').trim();
  if (!configuredBase || base !== configuredBase) throw Object.assign(new Error('Base Airtable no permitida'), { status: 403 });
  const tables = allowedTables(env);
  if (!tables.size || !tables.has(table)) throw Object.assign(new Error(`Tabla no permitida: ${table}`), { status: 403 });
  return { base, table, recordId: segments[2] ? decodeURIComponent(segments[2]) : '', path: `/v0/${segments.join('/')}` };
}

function methodAllowed(method, role, env) {
  if (method === 'GET' || method === 'HEAD') return true;
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') return role === 'writer' || role === 'admin';
  if (method === 'DELETE') return role === 'admin' && String(env.ALLOW_AIRTABLE_DELETE || '').toLowerCase() === 'true';
  return false;
}

function allowedAiModels(env) {
  const configured = csv(env.AI_ALLOWED_MODELS);
  return new Set(configured.length ? configured : DEFAULT_AI_MODELS);
}

async function validateAiRequest(pathname, request, env) {
  if (request.method !== 'POST' || !AI_PATHS.has(pathname)) {
    throw Object.assign(new Error('Ruta o método de IA no permitido'), { status: 405 });
  }
  const contentType = request.headers.get('Content-Type') || '';
  const maxBytes = contentType.includes('multipart/form-data') ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES;
  const body = await readBody(request, Number(env.MAX_AI_BODY_BYTES) || maxBytes);
  let model = '';
  if (contentType.includes('application/json')) {
    let data;
    try { data = JSON.parse(new TextDecoder().decode(body)); } catch { throw Object.assign(new Error('JSON de IA inválido'), { status: 400 }); }
    model = String(data.model || '');
    if (!model || !allowedAiModels(env).has(model)) throw Object.assign(new Error(`Modelo no permitido: ${model || 'sin modelo'}`), { status: 403 });
    if (Number(data.max_tokens || 0) > (Number(env.AI_MAX_TOKENS) || 8192)) throw Object.assign(new Error('max_tokens excede el límite'), { status: 400 });
  } else if (pathname.endsWith('/images/edits')) {
    const copy = new Request(request.url, { method: 'POST', headers: request.headers, body });
    const form = await copy.formData();
    model = String(form.get('model') || 'gpt-image-1');
    if (!allowedAiModels(env).has(model)) throw Object.assign(new Error(`Modelo no permitido: ${model}`), { status: 403 });
  } else {
    throw Object.assign(new Error('Content-Type no permitido'), { status: 415 });
  }
  return { body, contentType, model };
}

async function proxyAi(url, request, env, auth, headers) {
  enforceRateLimit(auth.email, env, 'ai');
  const { body, contentType, model } = await validateAiRequest(url.pathname, request, env);
  const anthropic = url.pathname.startsWith('/anthropic/');
  const token = anthropic ? env.ANTHROPIC_TOKEN : env.OPENAI_TOKEN;
  if (!token) return json({ error: 'Servicio IA no configurado' }, 503, headers);
  const upstreamUrl = (anthropic ? ANTHROPIC_BASE : OPENAI_BASE)
    + url.pathname.replace(anthropic ? /^\/anthropic/ : /^\/openai/, '')
    + url.search;
  const upstreamHeaders = new Headers();
  upstreamHeaders.set('Content-Type', contentType);
  if (anthropic) {
    upstreamHeaders.set('x-api-key', token);
    upstreamHeaders.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
  } else {
    upstreamHeaders.set('Authorization', `Bearer ${token}`);
  }
  const upstream = await fetch(upstreamUrl, { method: 'POST', headers: upstreamHeaders, body });
  const responseHeaders = new Headers(headers);
  const upstreamType = upstream.headers.get('Content-Type');
  if (upstreamType) responseHeaders.set('Content-Type', upstreamType);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-AI-Model', model);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function proxyAirtable(url, request, env, auth, role, headers) {
  if (!env.AIRTABLE_TOKEN) return json({ error: 'Airtable no configurado' }, 503, headers);
  const route = parseAirtablePath(url, env);
  if (!methodAllowed(request.method, role, env)) return json({ error: 'Operación Airtable no autorizada' }, 403, headers);
  enforceRateLimit(auth.email, env, 'airtable');

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) body = await readBody(request, Number(env.MAX_AIRTABLE_BODY_BYTES) || MAX_JSON_BYTES);
  const upstreamHeaders = new Headers({ Authorization: `Bearer ${env.AIRTABLE_TOKEN}` });
  const contentType = request.headers.get('Content-Type');
  if (contentType) upstreamHeaders.set('Content-Type', contentType);
  const upstream = await fetch(`${AIRTABLE_BASE}${route.path}${url.search}`, {
    method: request.method,
    headers: upstreamHeaders,
    body,
  });
  const responseHeaders = new Headers(headers);
  const upstreamType = upstream.headers.get('Content-Type');
  if (upstreamType) responseHeaders.set('Content-Type', upstreamType);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function stateEndpoint(url, request, env, role, headers) {
  if (!env.DASHBOARD_STATE) return json({ error: 'Almacenamiento compartido no configurado' }, 503, headers);
  const key = decodeURIComponent(url.pathname.slice('/state/'.length));
  if (!STATE_KEYS.has(key)) return json({ error: 'Estado no permitido' }, 404, headers);
  const storageKey = `dashboard:${key}`;

  if (request.method === 'GET') {
    const stored = await env.DASHBOARD_STATE.get(storageKey, { type: 'json' });
    if (!stored) return json({ key, version: 0, data: null, updatedAt: null }, 200, { ...headers, ETag: '"0"' });
    return json(stored, 200, { ...headers, ETag: `"${stored.version}"` });
  }

  if (request.method !== 'PUT') return json({ error: 'Método no permitido' }, 405, headers);
  if (role !== 'writer' && role !== 'admin') return json({ error: 'Permiso de escritura requerido' }, 403, headers);
  const body = await readBody(request, Number(env.MAX_STATE_BODY_BYTES) || MAX_JSON_BYTES);
  let data;
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: 'JSON inválido' }, 400, headers); }
  const current = await env.DASHBOARD_STATE.get(storageKey, { type: 'json' });
  const currentVersion = Number(current?.version || 0);
  const requestedMatch = String(request.headers.get('If-Match') || '').replace(/"/g, '');
  if (requestedMatch && requestedMatch !== '*' && Number(requestedMatch) !== currentVersion) {
    return json({ error: 'Conflicto de versión', currentVersion, current }, 409, { ...headers, ETag: `"${currentVersion}"` });
  }
  const record = {
    key,
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
    data: data.data ?? data,
  };
  await env.DASHBOARD_STATE.put(storageKey, JSON.stringify(record));
  return json(record, 200, { ...headers, ETag: `"${record.version}"` });
}

async function seoFetch(url, env, headers) {
  let target;
  try { target = new URL(url.searchParams.get('url') || ''); } catch { return json({ error: 'URL inválida' }, 400, headers); }
  const allowedHosts = new Set(['thelab.solutions', 'www.thelab.solutions']);
  if (target.protocol !== 'https:' || !allowedHosts.has(target.hostname) || target.username || target.password || target.port) {
    return json({ error: 'Solo se permite auditar thelab.solutions por HTTPS' }, 403, headers);
  }
  const upstream = await fetch(target.toString(), {
    headers: { 'User-Agent': 'TheLab-SEO-Auditor/2.0' },
    redirect: 'manual',
    cf: { cacheTtl: 0 },
  });
  if (upstream.status >= 300 && upstream.status < 400) return json({ error: 'Redirección no permitida' }, 502, headers);
  const contentLength = Number(upstream.headers.get('Content-Length') || 0);
  if (contentLength > MAX_JSON_BYTES) return json({ error: 'Página demasiado grande' }, 413, headers);
  const html = (await upstream.text()).slice(0, MAX_JSON_BYTES);
  return json({ ok: true, status: upstream.status, finalUrl: target.toString(), html }, 200, headers);
}

async function audit(env, ctx, entry) {
  if (!ctx || !env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AUDIT_TABLE) return;
  const fields = {
    Fecha: new Date().toISOString(),
    Usuario: String(entry.email || '').slice(0, 200),
    Rol: String(entry.role || '').slice(0, 40),
    Accion: String(entry.action || '').slice(0, 200),
    Recurso: String(entry.resource || '').slice(0, 500),
    Metodo: String(entry.method || '').slice(0, 20),
    Resultado: Number(entry.status || 0),
    RequestId: String(entry.requestId || '').slice(0, 100),
  };
  ctx.waitUntil(fetch(`${AIRTABLE_BASE}/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(env.AUDIT_TABLE)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  }).catch(() => {}));
}

async function heartbeat(env, ctx) {
  if (!ctx || !env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || Date.now() - lastHeartbeatAt < 5 * 60 * 1000) return;
  lastHeartbeatAt = Date.now();
  ctx.waitUntil((async () => {
    const table = env.HEARTBEAT_TABLE || 'Automations';
    const id = env.HEARTBEAT_ID || 'airtable-proxy';
    const auth = { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` };
    const root = `${AIRTABLE_BASE}/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
    const query = `${root}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID}='${id}'`)}`;
    const found = await fetch(query, { headers: auth });
    if (!found.ok) return;
    const record = (await found.json()).records?.[0];
    if (!record) return;
    await fetch(`${root}/${record.id}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { Estado: 'Activo', UltimaEjecucion: new Date().toISOString(), TareaActual: 'Proxy autenticado y operativo' }, typecast: true }),
    });
  })().catch(() => {}));
}

export default {
  async fetch(request, env, ctx) {
    const id = requestId(request);
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = cors(origin, env);
    const headers = { ...corsHeaders, 'X-Request-Id': id };

    if (request.method === 'OPTIONS') {
      if (!origin || !allowedOrigins(env).includes(origin)) return json({ error: 'Origin no permitido' }, 403, headers);
      return new Response(null, { status: 204, headers: secureHeaders(headers) });
    }

    if (origin && !allowedOrigins(env).includes(origin)) return json({ error: 'Origin no permitido' }, 403, headers);
    if (url.pathname === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: secureHeaders(headers) });
      return json({ ok: true, service: 'thelab-dashboard-gateway', time: new Date().toISOString() }, 200, headers);
    }

    let auth;
    let role = 'none';
    try {
      auth = await authenticate(request, env, origin);
      role = roleFor(auth, env);
      enforceRateLimit(auth.email, env);
    } catch (error) {
      return json({ error: 'No autorizado', requestId: id }, 401, headers);
    }

    await heartbeat(env, ctx);
    let response;
    try {
      if (url.pathname.startsWith('/state/')) {
        response = await stateEndpoint(url, request, env, role, headers);
      } else if (AI_PATHS.has(url.pathname) || url.pathname.startsWith('/anthropic/') || url.pathname.startsWith('/openai/')) {
        if (role === 'reader' && String(env.ALLOW_READER_AI || '').toLowerCase() !== 'true') response = json({ error: 'Permiso de IA requerido' }, 403, headers);
        else response = await proxyAi(url, request, env, auth, headers);
      } else if (url.pathname === '/seo-fetch' && request.method === 'GET') {
        response = await seoFetch(url, env, headers);
      } else {
        response = await proxyAirtable(url, request, env, auth, role, headers);
      }
    } catch (error) {
      const status = Number(error.status || 500);
      const publicMessage = status >= 500 ? 'Error interno del gateway' : error.message;
      const extra = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
      response = json({ error: publicMessage, requestId: id }, status, { ...headers, ...extra });
      if (status >= 500) console.error('[gateway]', id, error?.stack || error?.message || String(error));
    }

    const sensitive = !['GET', 'HEAD', 'OPTIONS'].includes(request.method) || AI_PATHS.has(url.pathname);
    if (sensitive) {
      await audit(env, ctx, {
        email: auth.email,
        role,
        action: AI_PATHS.has(url.pathname) ? 'ai-request' : url.pathname.startsWith('/state/') ? 'state-write' : 'airtable-write',
        resource: url.pathname,
        method: request.method,
        status: response.status,
        requestId: id,
      });
    }
    return response;
  },
};
