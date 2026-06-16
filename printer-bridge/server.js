#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────
// The Lab Solutions — Printer Bridge
// Proxy reverso entre el dashboard (HTTPS) y las impresoras Moonraker
// de la red local. Corre en el iMac del taller; se expone a internet
// con un túnel Cloudflare (ver README.md).
//
//   Dashboard ──HTTPS──▶ Cloudflare Tunnel ──▶ este bridge ──HTTP──▶ impresora
//
// Rutas:
//   GET  /healthz                  → estado del bridge (sin token)
//   GET  /authcheck                → 200 si el token es válido (para "Probar" en el dashboard)
//   POST /restart                  → reinicia el bridge (sale; launchd lo levanta de nuevo)
//   *    /{IP}/{ruta...}           → http://{IP}:7125/{ruta...}   (Moonraker)
//   *    /{IP}:{puerto}/{ruta...}  → http://{IP}:{puerto}/{ruta...} (webcam, etc.)
//
// Autenticación: header X-Bridge-Token o query param ?bt=TOKEN
// Sin dependencias — solo Node.js ≥ 18.  Uso:  node server.js
// ─────────────────────────────────────────────────────────────────────
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.BRIDGE_PORT || '8347', 10);
// CORS: usa BRIDGE_ALLOW_ORIGIN; si no está definido mantenemos '*' para no
// romper instalaciones existentes, pero avisamos para que se configure.
let ALLOW_ORIGIN = process.env.BRIDGE_ALLOW_ORIGIN;
if (!ALLOW_ORIGIN) {
  console.warn('[printer-bridge] BRIDGE_ALLOW_ORIGIN no definida — CORS abierto a "*". Configúrala para restringir el origen.');
  ALLOW_ORIGIN = '*';
}
const ALLOWED_PORTS = (process.env.BRIDGE_PORTS || '7125,8080,4408,4409,80')
  .split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
const TOKEN_FILE = path.join(__dirname, '.bridge-token');

function loadToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN.trim();
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  } catch (e) {}
  const t = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

// Comparación de tokens en tiempo constante (crypto.timingSafeEqual). Iguala
// longitudes copiando sobre buffers del mismo tamaño y compara también la
// longitud para no aceptar prefijos.
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length;
}

// Solo IPs privadas (RFC 1918) + loopback — nunca proxy hacia internet
function isPrivateIp(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return false;
  if (o[0] === 10 || o[0] === 127) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return false;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key,X-Bridge-Token,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function jsonError(res, code, msg) {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

// Rate-limit mínimo para /restart (anti-DoS de reinicios).
const RESTART_MIN_INTERVAL_MS = parseInt(process.env.BRIDGE_RESTART_MIN_INTERVAL_MS || '5000', 10);
let lastRestartAt = 0;

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Separar ruta y query SIN re-codificar (Moonraker usa params sin valor,
  // p.ej. ?print_stats&extruder — re-serializarlos los rompería)
  const qIdx = req.url.indexOf('?');
  const rawPath = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : req.url.slice(qIdx + 1);

  if (rawPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    return;
  }

  // Token: header X-Bridge-Token o query ?bt=
  const qParts = rawQuery ? rawQuery.split('&') : [];
  const btPart = qParts.find(p => p.startsWith('bt='));
  const given = req.headers['x-bridge-token'] || (btPart ? decodeURIComponent(btPart.slice(3)) : '');
  if (!timingSafeEqualStr(given, TOKEN)) { jsonError(res, 401, 'unauthorized'); return; }

  // Token válido — endpoints de diagnóstico/control (no son proxy a impresora)
  if (rawPath === '/authcheck') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ports: ALLOWED_PORTS }));
    return;
  }
  if (rawPath === '/restart') {
    // Token ya verificado arriba en tiempo constante. Añadimos un rate-limit
    // mínimo: no más de un /restart cada RESTART_MIN_INTERVAL_MS para evitar
    // que se use como DoS de reinicios.
    const now = Date.now();
    if (now - lastRestartAt < RESTART_MIN_INTERVAL_MS) {
      jsonError(res, 429, 'demasiados reinicios — espera unos segundos');
      return;
    }
    lastRestartAt = now;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, restarting: true }));
    console.log('Reinicio solicitado vía /restart — saliendo (launchd lo levanta de nuevo).');
    setTimeout(() => process.exit(0), 250);
    return;
  }

  // Ruta: /{IP}[:puerto]/resto
  const m = rawPath.match(/^\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?(\/.*)?$/);
  if (!m) { jsonError(res, 404, 'ruta inválida — formato: /IP[:puerto]/...'); return; }
  const ip = m[1];
  const port = m[2] ? parseInt(m[2], 10) : 7125;
  let targetPath = m[3] || '/';

  if (!isPrivateIp(ip)) { jsonError(res, 403, 'solo IPs de red privada'); return; }
  if (!ALLOWED_PORTS.includes(port)) { jsonError(res, 403, `puerto no permitido (permitidos: ${ALLOWED_PORTS.join(',')})`); return; }

  // Reconstruir query sin el token bt, preservando el resto tal cual
  const fwdQuery = qParts.filter(p => p && !p.startsWith('bt=')).join('&');
  if (fwdQuery) targetPath += '?' + fwdQuery;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['x-bridge-token'];
  delete headers.origin;
  delete headers.referer;
  // Reescribir headers de Cloudflare/proxy: Moonraker usa xheaders=True y lee
  // X-Forwarded-For para determinar la IP del cliente. Forzamos 127.0.0.1 para
  // que siempre caiga en trusted_clients (127.0.0.0/8).
  headers['x-forwarded-for'] = '127.0.0.1';
  delete headers['x-forwarded-proto'];
  delete headers['x-real-ip'];
  delete headers['cf-connecting-ip'];
  delete headers['cf-ray'];
  delete headers['cf-ipcountry'];
  delete headers['cf-visitor'];

  const preq = http.request({ host: ip, port, path: targetPath, method: req.method, headers, timeout: 15000 }, pres => {
    const h = { ...pres.headers };
    // Quitar CORS del upstream para no duplicar los nuestros
    delete h['access-control-allow-origin'];
    delete h['access-control-allow-methods'];
    delete h['access-control-allow-headers'];
    res.writeHead(pres.statusCode, h);
    pres.pipe(res);
  });
  preq.on('timeout', () => preq.destroy(new Error('timeout — impresora no responde')));
  preq.on('error', err => jsonError(res, 502, 'impresora inaccesible: ' + err.message));
  req.pipe(preq);
});

server.listen(PORT, () => {
  console.log('─'.repeat(60));
  console.log('  The Lab Solutions — Printer Bridge');
  console.log(`  Escuchando en  : http://0.0.0.0:${PORT}`);
  console.log(`  Token          : ${TOKEN}`);
  console.log(`  Puertos        : ${ALLOWED_PORTS.join(', ')}`);
  console.log(`  CORS origin    : ${ALLOW_ORIGIN}`);
  console.log('  Pega el token en el dashboard: Mi cuenta → Túnel Impresoras');
  console.log('─'.repeat(60));
});
