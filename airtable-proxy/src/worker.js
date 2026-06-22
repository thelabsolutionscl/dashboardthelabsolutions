const AIRTABLE_BASE = 'https://api.airtable.com';
const ANTHROPIC_BASE = 'https://api.anthropic.com';

// Cabeceras CORS que NO dependen del origen (métodos/headers permitidos).
// El valor de Access-Control-Allow-Origin se calcula por request en corsOrigin().
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-App-Key,Authorization,anthropic-version,x-api-key',
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

// ── Autenticación server-side (OPT-IN) ─────────────────────────────────
// Se activa SOLO si están definidas env.SESSION_SECRET y env.AUTH_USERS. Mientras
// no lo estén, el proxy se comporta igual que antes (solo X-App-Key) y /auth/login
// responde 501. Así no rompe los despliegues actuales.
//
// env.AUTH_USERS = JSON: [{ "u":"correo", "name":"Nombre", "role":"admin",
//                           "salt":"<hex>", "iter":100000, "hash":"<hex pbkdf2-sha256>" }]
// Genera entradas con: node airtable-proxy/scripts/make-user.mjs <correo> <rol> <password>
const _enc = new TextEncoder();
function _bytesToHex(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
function _hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function _bytesToB64url(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function _strToB64url(str) { return _bytesToB64url(_enc.encode(str)); }
function _b64urlToStr(b64) { b64 = b64.replace(/-/g, '+').replace(/_/g, '/'); const s = atob(b64); const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); return new TextDecoder().decode(bytes); }
async function _hmacB64url(secret, msg) { const key = await crypto.subtle.importKey('raw', _enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, _enc.encode(msg)); return _bytesToB64url(sig); }
async function _pbkdf2Hex(password, saltHex, iter) { const key = await crypto.subtle.importKey('raw', _enc.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: _hexToBytes(saltHex), iterations: iter, hash: 'SHA-256' }, key, 256); return _bytesToHex(bits); }
async function makeSession(env, user, remember) {
  const exp = Date.now() + (remember ? 720 : 8) * 3600000; // 30 días / 8 h
  const payload = { u: user.u, name: user.name, role: user.role, exp };
  const body = _strToB64url(JSON.stringify(payload));
  const sig = await _hmacB64url(env.SESSION_SECRET, body);
  return { token: body + '.' + sig, exp, role: user.role, name: user.name, username: user.u };
}
async function verifySession(env, token) {
  if (!token || !env.SESSION_SECRET) return null;
  const i = token.lastIndexOf('.'); if (i < 0) return null;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const expected = await _hmacB64url(env.SESSION_SECRET, body);
  if (!timingSafeEqualStr(sig, expected)) return null;
  let p; try { p = JSON.parse(_b64urlToStr(body)); } catch (_) { return null; }
  if (!p || !p.exp || p.exp < Date.now()) return null;
  return p; // { u, name, role, exp }
}
// RBAC server-side: la verdad de autorización deja de vivir en el navegador.
const _WRITE_ROLES = ['admin', 'gerencia', 'comercial', 'produccion', 'finanzas', 'demo'];
const _DELETE_ROLES = ['admin', 'gerencia', 'demo'];
const _CARVEOUT_TABLES = ['Social_Posts', 'Social_Interactions', 'Social_Metrics', 'Clientes', 'Agent_Queue', 'Newsletter_Campañas', 'Newsletter_Envios'];
function checkRBAC(role, method, table) {
  if (method === 'GET' || method === 'HEAD') return null; // lectura: cualquier rol autenticado
  if (method === 'DELETE') return _DELETE_ROLES.includes(role) ? null : 'RBAC: borrado no permitido para rol ' + role;
  if (_WRITE_ROLES.includes(role)) return null; // POST/PATCH/PUT
  if (table && _CARVEOUT_TABLES.includes(table)) return null; // carve-out redes/newsletter (p.ej. marketing)
  return 'RBAC: escritura no permitida para rol ' + role;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, proxy: 'thelab-proxy', anthropic: !!env.ANTHROPIC_TOKEN, airtable: !!env.AIRTABLE_TOKEN, auth: !!(env.SESSION_SECRET && env.AUTH_USERS) }, 200, cors);
    }

    // ── Login server-side (opt-in) — emite una sesión firmada (HMAC) ──
    // El navegador nunca recibe el PAT de Airtable ni la API key: solo el token de sesión.
    if (url.pathname === '/auth/login') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
      if (!env.SESSION_SECRET || !env.AUTH_USERS) return json({ error: 'auth no configurada en el Worker' }, 501, cors);
      let creds; try { creds = await request.json(); } catch (_) { return json({ error: 'bad request' }, 400, cors); }
      const username = String(creds.username || '').trim().toLowerCase();
      const password = String(creds.password || '');
      let users; try { users = JSON.parse(env.AUTH_USERS); } catch (_) { return json({ error: 'AUTH_USERS mal formado' }, 500, cors); }
      const user = users.find((u) => String(u.u || '').toLowerCase() === username);
      // Calcular SIEMPRE un PBKDF2 (aunque el usuario no exista) para no filtrar su existencia por timing.
      const calc = await _pbkdf2Hex(password, user ? user.salt : '00', user ? (user.iter || 100000) : 100000);
      if (!user || !timingSafeEqualStr(calc, user.hash)) return json({ error: 'Usuario o contraseña incorrectos' }, 401, cors);
      const sess = await makeSession(env, user, !!creds.remember);
      return json(sess, 200, cors);
    }

    // ── Autorización del passthrough: sesión firmada (modo seguro + RBAC) O X-App-Key (retrocompat) ──
    let session = null;
    const authz = request.headers.get('Authorization') || '';
    if (authz.startsWith('Bearer ')) session = await verifySession(env, authz.slice(7));
    const appKey = request.headers.get('X-App-Key');
    const appKeyOk = !!(appKey && env.APP_KEY && timingSafeEqualStr(appKey, env.APP_KEY));
    if (!session && !appKeyOk) {
      return json({ error: 'Unauthorized' }, 401, cors);
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

    // /v0/<baseId>/<tabla>/<...> → el segmento de tabla es el índice 2 (tras filtrar vacíos).
    const segs = path.split('/').filter(Boolean); // ['v0', baseId, tabla, ...]
    const tableSeg = segs[2] ? decodeURIComponent(segs[2]) : '';

    // RBAC server-side: cuando se autoriza por SESIÓN (no por X-App-Key, que es la llave
    // de servicio de plena confianza), se aplican los permisos del rol. Esta es la
    // verdadera barrera de autorización (la del navegador es solo cosmética).
    if (session) {
      const rbacErr = checkRBAC(session.role, request.method, tableSeg);
      if (rbacErr) return json({ error: rbacErr }, 403, cors);
    }

    // Allowlist opcional de tablas (defensa en profundidad). Si env.ALLOWED_TABLES
    // está definida (lista separada por comas), solo se permiten rutas de Airtable
    // que apunten a esas tablas. Si no está definida, se deja pasar todo (retrocompat).
    const tablesRaw = (env.ALLOWED_TABLES || '').trim();
    if (tablesRaw) {
      const allowedTables = tablesRaw.split(',').map((s) => s.trim()).filter(Boolean);
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
