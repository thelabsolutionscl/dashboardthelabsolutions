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
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Reutiliza conexiones TCP hacia las impresoras (keep-alive) en vez de abrir
// una nueva por cada petición. Con el dashboard sondeando 14 máquinas cada
// pocos segundos, esto evita el coste de handshake repetido y reduce timeouts
// bajo ráfaga. maxSockets alto: el cuello de botella es la impresora, no aquí.
const keepAliveAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 64, maxFreeSockets: 16 });

const PORT = parseInt(process.env.BRIDGE_PORT || '8347', 10);
const ALLOW_ORIGIN = process.env.BRIDGE_ALLOW_ORIGIN || '*';
// CORS "fijado": BRIDGE_ALLOW_ORIGIN puede ser '*' (default, cualquier origen) o una
// lista separada por comas de orígenes permitidos. Con lista, se refleja SOLO el Origin
// de la petición cuando está en la lista. La auth real es el token del bridge (no cookies),
// así que '*' no es una vulnerabilidad; esto es defensa en profundidad.
const ALLOW_ORIGINS = ALLOW_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_ANY_ORIGIN = ALLOW_ORIGINS.length === 1 && ALLOW_ORIGINS[0] === '*';
// 1984 = go2rtc (cámaras WebRTC de las K2/K2 Plus; el dashboard consume su /api/frame.jpeg)
const ALLOWED_PORTS = (process.env.BRIDGE_PORTS || '7125,8080,4408,4409,80,1984')
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

function setCors(req, res) {
  const origin = req && req.headers && req.headers.origin;
  if (ALLOW_ANY_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', (origin && ALLOW_ORIGINS.includes(origin)) ? origin : ALLOW_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key,X-Bridge-Token,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function jsonError(res, code, msg) {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

const server = http.createServer((req, res) => {
  setCors(req, res);
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
  if (given !== TOKEN) { jsonError(res, 401, 'unauthorized'); return; }

  // Token válido — endpoints de diagnóstico/control (no son proxy a impresora)
  if (rawPath === '/authcheck') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ports: ALLOWED_PORTS }));
    return;
  }
  if (rawPath === '/restart') {
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

  const preq = http.request({ host: ip, port, path: targetPath, method: req.method, headers, timeout: 15000, agent: keepAliveAgent }, pres => {
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

// ── Proxy de WebSocket ────────────────────────────────────────────────────
// Moonraker expone /websocket (JSON-RPC) y empuja notify_status_update en
// tiempo real (es lo que usan Fluidd/Mainsail). Hacemos un proxy transparente
// a nivel TCP: tras el handshake HTTP de upgrade, los frames WS son bytes que
// se reenvían en ambos sentidos sin parsearlos. Reusa la auth por token y la
// validación de IP/puerto del proxy HTTP. Así el dashboard recibe estado en
// vivo sin sondear, eliminando las ráfagas de polling.
server.on('upgrade', (req, clientSocket, head) => {
  const fail = () => { try { clientSocket.destroy(); } catch (e) {} };
  const qIdx = req.url.indexOf('?');
  const rawPath = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? '' : req.url.slice(qIdx + 1);
  const qParts = rawQuery ? rawQuery.split('&') : [];

  // Auth: header X-Bridge-Token (no llega desde el navegador) o ?bt=
  const btPart = qParts.find(p => p.startsWith('bt='));
  const given = req.headers['x-bridge-token'] || (btPart ? decodeURIComponent(btPart.slice(3)) : '');
  if (given !== TOKEN) return fail();

  const m = rawPath.match(/^\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?(\/.*)?$/);
  if (!m) return fail();
  const ip = m[1];
  const port = m[2] ? parseInt(m[2], 10) : 7125;
  let targetPath = m[3] || '/websocket';
  if (!isPrivateIp(ip)) return fail();
  if (!ALLOWED_PORTS.includes(port)) return fail();

  const fwdQuery = qParts.filter(p => p && !p.startsWith('bt=')).join('&');
  if (fwdQuery) targetPath += '?' + fwdQuery;

  const upstream = net.connect(port, ip, () => {
    // Reconstruir la petición de upgrade hacia Moonraker, reenviando los
    // headers del handshake (Sec-WebSocket-Key/Version/Protocol/Extensions)
    // tal cual — así el Accept que calcula Moonraker valida en el navegador.
    const h = { ...req.headers };
    delete h['x-bridge-token'];
    delete h.origin; delete h.referer;
    delete h['x-forwarded-proto']; delete h['x-real-ip'];
    delete h['cf-connecting-ip']; delete h['cf-ray']; delete h['cf-ipcountry']; delete h['cf-visitor'];
    h.host = `${ip}:${port}`;
    h['x-forwarded-for'] = '127.0.0.1';   // cae en trusted_clients de Moonraker
    let raw = `GET ${targetPath} HTTP/1.1\r\n`;
    for (const k in h) {
      const v = h[k];
      if (Array.isArray(v)) v.forEach(vv => { raw += `${k}: ${vv}\r\n`; });
      else raw += `${k}: ${v}\r\n`;
    }
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', fail);
  clientSocket.on('error', () => { try { upstream.destroy(); } catch (e) {} });
  upstream.on('close', () => { try { clientSocket.destroy(); } catch (e) {} });
  clientSocket.on('close', () => { try { upstream.destroy(); } catch (e) {} });
});

server.listen(PORT, () => {
  console.log('─'.repeat(60));
  console.log('  The Lab Solutions — Printer Bridge');
  console.log(`  Escuchando en  : http://0.0.0.0:${PORT}`);
  console.log(`  Token          : ${TOKEN}`);
  console.log(`  Puertos        : ${ALLOWED_PORTS.join(', ')}`);
  console.log(`  WebSocket      : proxy activo (/{IP}/websocket → tiempo real)`);
  console.log(`  CORS origin    : ${ALLOW_ORIGIN}`);
  console.log('  Pega el token en el dashboard: Mi cuenta → Túnel Impresoras');
  console.log('─'.repeat(60));
  startHeartbeat();
});

// ── Latido a la tabla Automations (Oficina Virtual del dashboard) ─────────
// Como el bridge es un proceso persistente, reporta "Activo" cada 5 min.
// Opcional: solo si se definen AIRTABLE_TOKEN y AIRTABLE_BASE_ID en el entorno
// (p.ej. en el .plist de launchd). Best-effort; cualquier error se ignora.
function startHeartbeat() {
  const token = process.env.AIRTABLE_TOKEN;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!token || !base) return;
  const api = 'https://api.airtable.com/v0';
  const tbl = `${api}/${base}/${encodeURIComponent('Automations')}`;
  const auth = { Authorization: 'Bearer ' + token };
  const beat = async () => {
    try {
      const q = `${tbl}?maxRecords=1&filterByFormula=${encodeURIComponent("{ID}='printer-bridge'")}`;
      const found = await fetch(q, { headers: auth });
      if (!found.ok) return;
      const data = await found.json();
      const rec = data.records && data.records[0];
      if (!rec) return;
      const ff = rec.fields || {};
      const sameDay = ff.UltimaEjecucion && new Date(ff.UltimaEjecucion).toDateString() === new Date().toDateString();
      const ej = (sameDay ? (Number(ff.EjecucionesHoy) || 0) : 0) + 1;
      await fetch(`${tbl}/${rec.id}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { Estado: 'Activo', UltimaEjecucion: new Date().toISOString(), EjecucionesHoy: ej },
          typecast: true,
        }),
      });
    } catch (e) { /* best-effort */ }
  };
  beat();
  const t = setInterval(beat, 5 * 60 * 1000);
  if (t.unref) t.unref();
}
