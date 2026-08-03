#!/usr/bin/env node
'use strict';

/*
 * Gateway seguro delante de server.js.
 *
 * Internet/Cloudflare Access -> 127.0.0.1:8347 (este proceso)
 * este proceso -> 127.0.0.1:8348 (server.js con token interno aleatorio)
 *
 * El servidor legado conserva compatibilidad Moonraker, cámaras, mantenimiento
 * y WebSocket; esta capa agrega identidad, roles, allowlist exacta de IPs,
 * métodos/rutas permitidos y evita publicar el token maestro al navegador.
 */

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC_HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PUBLIC_PORT = numberEnv('BRIDGE_PORT', 8347);
const INTERNAL_PORT = numberEnv('BRIDGE_INTERNAL_PORT', 8348);
const MAX_BODY_BYTES = numberEnv('BRIDGE_MAX_BODY_BYTES', 128 * 1024 * 1024);
const ORIGINS = listEnv('BRIDGE_ALLOW_ORIGINS', [
  'https://dashboard.thelab.solutions',
  'https://thelabsolutionscl.github.io',
]);
const PORTS = new Set(listEnv('BRIDGE_PORTS', ['7125', '8080', '4408', '4409', '80', '1984']).map(Number));
const ADMIN_EMAILS = new Set(listEnv('BRIDGE_ADMIN_EMAILS').map((value) => value.toLowerCase()));
const WRITE_EMAILS = new Set(listEnv('BRIDGE_WRITE_EMAILS').map((value) => value.toLowerCase()));
const ALLOW_LEGACY_TOKEN = String(process.env.BRIDGE_ALLOW_LEGACY_TOKEN || '').toLowerCase() === 'true';
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('base64url');
const READ_TOKEN = loadOrCreateToken('.bridge-read-token', process.env.BRIDGE_READ_TOKEN);
const ADMIN_TOKEN = loadOrCreateToken('.bridge-admin-token', process.env.BRIDGE_ADMIN_TOKEN);
const PRINTERS = loadPrinterAllowlist();

const CONTROL_POST_PATHS = [
  /^\/printer\/(?:print\/(?:start|pause|resume|cancel)|restart|firmware_restart)$/,
  /^\/printer\/gcode\/script$/,
  /^\/server\/files\/upload$/,
  /^\/machine\/(?:reboot|shutdown)$/,
  /^\/api\/printer\//,
];
const CONTROL_DELETE_PATHS = [
  /^\/server\/files\/(?:gcodes|config)\//,
];
const READ_PATHS = [
  /^\/printer\//,
  /^\/server\//,
  /^\/websocket$/,
  /^\/api\//,
  /^\/$/,
];

if (!PRINTERS.size) {
  console.error('✗ No hay impresoras permitidas. Crea printer-bridge/printers.json o define BRIDGE_PRINTERS.');
  process.exit(1);
}
if (PUBLIC_PORT === INTERNAL_PORT) {
  console.error('✗ BRIDGE_PORT y BRIDGE_INTERNAL_PORT deben ser distintos.');
  process.exit(1);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listEnv(name, fallback = []) {
  const value = String(process.env[name] || '').split(',').map((item) => item.trim()).filter(Boolean);
  return value.length ? value : fallback;
}

function loadOrCreateToken(filename, supplied) {
  if (supplied && String(supplied).trim()) return String(supplied).trim();
  const tokenPath = path.join(ROOT, filename);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch (_) {}
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function validPrivateIp(ip) {
  const match = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return octets[0] === 192 && octets[1] === 168;
}

function loadPrinterAllowlist() {
  const values = new Set(listEnv('BRIDGE_PRINTERS'));
  const configPath = path.join(ROOT, 'printers.json');
  try {
    const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const entries = Array.isArray(json) ? json : json.printers;
    for (const entry of entries || []) {
      const ip = typeof entry === 'string' ? entry : entry.ip;
      if (ip) values.add(String(ip).trim());
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('⚠ printers.json inválido:', error.message);
  }
  return new Set([...values].filter(validPrivateIp));
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length || !a.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function corsHeaders(origin) {
  if (!origin || !ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Bridge-Read-Token,X-Bridge-Admin-Token,X-Bridge-Token',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function setSecurityHeaders(res, origin) {
  for (const [name, value] of Object.entries(corsHeaders(origin))) res.setHeader(name, value);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function json(res, status, payload, origin, extra = {}) {
  setSecurityHeaders(res, origin);
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function accessIdentity(req) {
  const email = String(req.headers['cf-access-authenticated-user-email'] || '').trim().toLowerCase();
  if (email) {
    const role = ADMIN_EMAILS.has(email) ? 'admin' : WRITE_EMAILS.has(email) ? 'writer' : 'reader';
    return { email, role, mode: 'cloudflare-access' };
  }
  const admin = req.headers['x-bridge-admin-token'];
  if (constantTimeEqual(admin, ADMIN_TOKEN)) return { email: 'local-admin', role: 'admin', mode: 'admin-token' };
  const read = req.headers['x-bridge-read-token'];
  if (constantTimeEqual(read, READ_TOKEN)) return { email: 'local-reader', role: 'reader', mode: 'read-token' };
  if (ALLOW_LEGACY_TOKEN && constantTimeEqual(req.headers['x-bridge-token'], ADMIN_TOKEN)) {
    return { email: 'legacy-admin', role: 'admin', mode: 'legacy-token' };
  }
  return null;
}

function stripPublicAuth(url) {
  const parsed = new URL(url, 'http://bridge.local');
  parsed.searchParams.delete('bt');
  return `${parsed.pathname}${parsed.search}`;
}

function parseTarget(rawUrl) {
  const parsed = new URL(rawUrl, 'http://bridge.local');
  const match = parsed.pathname.match(/^\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(\/.*)?$/);
  if (!match) return null;
  return {
    ip: match[1],
    port: match[2] ? Number(match[2]) : 7125,
    path: match[3] || '/',
    query: parsed.search,
  };
}

function routePermission(req, identity, target) {
  const method = String(req.method || 'GET').toUpperCase();
  const pathName = target?.path || new URL(req.url, 'http://bridge.local').pathname;

  if (!target) {
    if (pathName === '/authcheck' || pathName === '/maint/status') return identity.role;
    if (pathName === '/restart' || pathName === '/maint/run') return identity.role === 'admin' ? 'admin' : '';
    return '';
  }
  if (!PRINTERS.has(target.ip) || !PORTS.has(target.port)) return '';
  if (target.port !== 7125) return ['GET', 'HEAD'].includes(method) ? identity.role : '';
  if (['GET', 'HEAD'].includes(method)) return READ_PATHS.some((pattern) => pattern.test(pathName)) ? identity.role : '';
  if (method === 'POST' || method === 'PUT') {
    if (!['writer', 'admin'].includes(identity.role)) return '';
    if (pathName === '/printer/gcode/script' || /^\/machine\//.test(pathName)) return identity.role === 'admin' ? 'admin' : '';
    return CONTROL_POST_PATHS.some((pattern) => pattern.test(pathName)) ? identity.role : '';
  }
  if (method === 'DELETE') return identity.role === 'admin' && CONTROL_DELETE_PATHS.some((pattern) => pattern.test(pathName)) ? 'admin' : '';
  return '';
}

function sanitizedHeaders(req, identity) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers.cookie;
  delete headers['cf-access-jwt-assertion'];
  delete headers['cf-access-authenticated-user-email'];
  delete headers['x-bridge-read-token'];
  delete headers['x-bridge-admin-token'];
  delete headers['x-bridge-token'];
  delete headers['cf-connecting-ip'];
  delete headers['cf-ray'];
  delete headers['cf-ipcountry'];
  headers['x-bridge-token'] = INTERNAL_TOKEN;
  headers['x-the-lab-user'] = identity.email;
  headers['x-the-lab-role'] = identity.role;
  return headers;
}

function audit(req, identity, status, target, startedAt) {
  const entry = {
    at: new Date().toISOString(),
    requestId: req._requestId,
    user: identity?.email || 'anonymous',
    role: identity?.role || 'none',
    method: req.method,
    resource: target ? `${target.ip}:${target.port}${target.path}` : new URL(req.url, 'http://bridge.local').pathname,
    status,
    durationMs: Date.now() - startedAt,
  };
  console.log(JSON.stringify({ bridgeAudit: entry }));
}

let child = null;
let shuttingDown = false;
let respawnTimer = null;

function startLegacyBridge() {
  clearTimeout(respawnTimer);
  const env = {
    ...process.env,
    BRIDGE_HOST: '127.0.0.1',
    BRIDGE_PORT: String(INTERNAL_PORT),
    BRIDGE_TOKEN: INTERNAL_TOKEN,
    BRIDGE_ALLOW_ORIGIN: 'http://127.0.0.1',
    BRIDGE_PORTS: [...PORTS].join(','),
  };
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (!shuttingDown) {
      console.error(`⚠ bridge interno terminó (${code ?? signal}); reinicio en 1 segundo`);
      respawnTimer = setTimeout(startLegacyBridge, 1000);
    }
  });
}

const server = http.createServer((req, res) => {
  const startedAt = Date.now();
  req._requestId = req.headers['cf-ray'] || crypto.randomUUID();
  const origin = String(req.headers.origin || '');
  setSecurityHeaders(res, origin);
  res.setHeader('X-Request-Id', req._requestId);

  if (origin && !ORIGINS.includes(origin)) {
    audit(req, null, 403, null, startedAt);
    return json(res, 403, { error: 'Origin no permitido' }, origin);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin && ORIGINS.includes(origin) ? 204 : 403);
    return res.end();
  }
  if (req.url === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
    const payload = { ok: Boolean(child && !child.killed), service: 'printer-bridge-secure', printers: PRINTERS.size, time: new Date().toISOString() };
    audit(req, { email: 'health', role: 'public' }, 200, null, startedAt);
    if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
    return json(res, 200, payload, origin);
  }

  const identity = accessIdentity(req);
  if (!identity) {
    audit(req, null, 401, null, startedAt);
    return json(res, 401, { error: 'Cloudflare Access o token local requerido' }, origin);
  }

  const target = parseTarget(req.url);
  if (!routePermission(req, identity, target)) {
    audit(req, identity, 403, target, startedAt);
    return json(res, 403, { error: 'Operación no permitida para este usuario, IP, puerto o ruta' }, origin);
  }

  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY_BYTES) {
    audit(req, identity, 413, target, startedAt);
    return json(res, 413, { error: 'Cuerpo demasiado grande' }, origin);
  }

  const internalPath = stripPublicAuth(req.url);
  const proxyReq = http.request({
    host: '127.0.0.1',
    port: INTERNAL_PORT,
    path: internalPath,
    method: req.method,
    headers: sanitizedHeaders(req, identity),
    timeout: 30000,
  }, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    delete headers['access-control-allow-methods'];
    delete headers['access-control-allow-headers'];
    for (const [name, value] of Object.entries(corsHeaders(origin))) headers[name] = value;
    headers['cache-control'] = 'no-store';
    headers['x-request-id'] = req._requestId;
    res.writeHead(proxyRes.statusCode || 502, headers);
    proxyRes.pipe(res);
    proxyRes.on('end', () => audit(req, identity, proxyRes.statusCode || 502, target, startedAt));
  });
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('timeout del bridge interno')));
  proxyReq.on('error', (error) => {
    audit(req, identity, 502, target, startedAt);
    if (!res.headersSent) json(res, 502, { error: 'Bridge interno no disponible', requestId: req._requestId }, origin);
    else res.destroy(error);
  });

  let received = 0;
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      proxyReq.destroy();
      req.destroy();
    }
  });
  req.pipe(proxyReq);
});

server.on('upgrade', (req, clientSocket, head) => {
  const startedAt = Date.now();
  req._requestId = req.headers['cf-ray'] || crypto.randomUUID();
  const identity = accessIdentity(req);
  const target = parseTarget(req.url);
  if (!identity || !target || target.port !== 7125 || target.path !== '/websocket' || !routePermission({ ...req, method: 'GET' }, identity, target)) {
    audit(req, identity, 403, target, startedAt);
    return clientSocket.destroy();
  }

  const upstream = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    const headers = sanitizedHeaders(req, identity);
    headers.host = `127.0.0.1:${INTERNAL_PORT}`;
    let raw = `GET ${stripPublicAuth(req.url)} HTTP/1.1\r\n`;
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) value.forEach((entry) => { raw += `${name}: ${entry}\r\n`; });
      else if (value != null) raw += `${name}: ${value}\r\n`;
    }
    raw += '\r\n';
    upstream.write(raw);
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    audit(req, identity, 101, target, startedAt);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
  upstream.on('close', () => clientSocket.destroy());
  clientSocket.on('close', () => upstream.destroy());
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(respawnTimer);
  server.close(() => process.exit(0));
  if (child && !child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  console.error('printer-bridge-secure uncaughtException', error);
  shutdown();
});
process.on('unhandledRejection', (error) => console.error('printer-bridge-secure unhandledRejection', error));

startLegacyBridge();
server.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
  console.log('─'.repeat(64));
  console.log('  The Lab Solutions — Printer Bridge seguro');
  console.log(`  Público local : http://${PUBLIC_HOST}:${PUBLIC_PORT}`);
  console.log(`  Bridge interno: http://127.0.0.1:${INTERNAL_PORT}`);
  console.log(`  Impresoras    : ${[...PRINTERS].join(', ')}`);
  console.log(`  Orígenes      : ${ORIGINS.join(', ')}`);
  console.log('  Auth remota   : Cloudflare Access');
  console.log(`  Read token    : guardado en ${path.join(ROOT, '.bridge-read-token')}`);
  console.log(`  Admin token   : guardado en ${path.join(ROOT, '.bridge-admin-token')}`);
  console.log('─'.repeat(64));
});
