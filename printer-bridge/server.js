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
  // Mantención: estado de config y ejecución on-demand (para probar sin esperar a la hora)
  if (rawPath === '/maint/status') {
    const cfg = loadMaintConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cfg ? { ok: true, enabled: true, time: cfg.time, tz: cfg.tz, printers: cfg.printers.length, calibrate: cfg.calibrate, dryRun: cfg.dryRun, lastRun: _maintLastRun } : { ok: true, enabled: false }));
    return;
  }
  if (rawPath === '/maint/run' && req.method === 'POST') {
    const cfg = loadMaintConfig();
    if (!cfg) { jsonError(res, 400, 'maint-config.json no encontrado — ver README'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    runMaintenance(cfg).then(r => res.end(JSON.stringify({ ok: true, ...r }))).catch(e => res.end(JSON.stringify({ ok: false, error: e.message })));
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
  startMaintScheduler();
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

// ── Auditoría y mantención diaria de impresoras ───────────────────────────
// Lee maint-config.json (junto a este archivo). Si no existe, queda APAGADO.
// A la hora configurada (zona horaria del taller) audita cada impresora vía
// Moonraker y, SOLO sobre las que estén LIBRES (jamás imprimiendo/pausada):
//   1) si Klipper está en error → reinicia el firmware y reverifica.
//   2) si quedó OK y calibrate=true → corre G28 + BED_MESH_CALIBRATE y deja la
//      máquina segura (calentadores a 0 + motores liberados).
// Reporta a Airtable (tabla Maquinas_Auditoria) y por email (webhook opcional).
// SEGURIDAD: arranca en dryRun (no manda comandos físicos) hasta que pongas
// "dryRun": false en el config — así pruebas la auditoría antes de actuar solo.
const MAINT_CONFIG_FILE = path.join(__dirname, 'maint-config.json');
function loadMaintConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(MAINT_CONFIG_FILE, 'utf8'));
    if (!c || !Array.isArray(c.printers) || !c.printers.filter(p => p && p.ip).length) return null;
    return {
      printers: c.printers.filter(p => p && p.ip),
      time: (typeof c.time === 'string' && /^\d{1,2}:\d{2}$/.test(c.time)) ? c.time.padStart(5, '0') : '10:00',
      tz: c.tz || 'America/Santiago',
      calibrate: c.calibrate !== false,
      dryRun: c.dryRun !== false,                       // por defecto TRUE
      airtable: c.airtable || null,
      mailUrl: c.mailUrl || process.env.MAINT_MAIL_URL || '',
      mailKey: c.mailKey || process.env.MAINT_MAIL_KEY || '',
      mailTo: c.mailTo || process.env.MAINT_MAIL_TO || '',
    };
  } catch (e) { return null; }
}
function nowInTz(tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())) parts[p.type] = p.value;
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return { hm: `${hh}:${parts.minute}`, date: `${parts.year}-${parts.month}-${parts.day}` };
}
function moonraker(printer, method, mpath, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const headers = { 'x-forwarded-for': '127.0.0.1' };
    if (printer.key) headers['X-Api-Key'] = printer.key;
    const preq = http.request({ host: printer.ip, port: printer.port || 7125, path: mpath, method, headers, timeout: timeoutMs, agent: keepAliveAgent }, pres => {
      let data = ''; pres.on('data', d => (data += d));
      pres.on('end', () => { try { resolve({ ok: pres.statusCode < 400, status: pres.statusCode, json: data ? JSON.parse(data) : null }); } catch (e) { resolve({ ok: pres.statusCode < 400, status: pres.statusCode, json: null }); } });
    });
    preq.on('timeout', () => { preq.destroy(); resolve({ ok: false, status: 0, timeout: true }); });
    preq.on('error', () => resolve({ ok: false, status: 0 }));
    preq.end();
  });
}
const _sleep = ms => new Promise(r => setTimeout(r, ms));
async function auditPrinter(p) {
  const name = p.name || p.ip;
  const r = await moonraker(p, 'GET', '/printer/objects/query?print_stats&heater_bed&extruder&webhooks&toolhead&bed_mesh');
  if (!r.ok || !r.json || !r.json.result || !r.json.result.status) return { name, ip: p.ip, p, state: 'offline', errored: false, busy: false, homed: false, meshOk: false };
  const s = r.json.result.status, wh = s.webhooks || {}, ps = s.print_stats || {}, th = s.toolhead || {}, bm = s.bed_mesh || {}, ex = s.extruder || {}, hb = s.heater_bed || {};
  const klState = wh.state || 'ready';
  const errored = klState === 'shutdown' || klState === 'error';
  let state = ps.state || 'standby'; if (errored) state = 'shutdown';
  let klMsg = ''; if (wh.state_message) { try { klMsg = (JSON.parse(wh.state_message).msg) || wh.state_message; } catch (_) { klMsg = wh.state_message; } klMsg = String(klMsg).split('\n').map(x => x.trim()).filter(Boolean)[0] || ''; }
  return { name, ip: p.ip, p, state, errored, busy: state === 'printing' || state === 'paused', homed: String(th.homed_axes || '').toLowerCase() === 'xyz', meshOk: !!(bm.profile_name || (bm.mesh_matrix && bm.mesh_matrix.length)), klState, klMsg, hotend: Math.round(ex.temperature || 0), bed: Math.round(hb.temperature || 0), filename: (ps.filename || '').replace(/\.gcode$/i, '') };
}
async function maintainPrinter(a, cfg) {
  const acts = [];
  if (a.state === 'offline') { a.acts = ['offline — sin acción']; return a; }
  if (a.busy) { a.acts = ['imprimiendo — NO se tocó']; return a; }
  if (a.errored) {
    if (cfg.dryRun) acts.push('[dry-run] reiniciaría firmware');
    else {
      await moonraker(a.p, 'POST', '/printer/firmware_restart'); acts.push('firmware reiniciado'); await _sleep(8000);
      const re = await auditPrinter(a.p); a.errored = re.errored; a.state = re.state; a.homed = re.homed; a.meshOk = re.meshOk;
      if (re.errored) { acts.push('SIGUE EN ERROR tras reinicio — revisar hardware'); a.acts = acts; return a; }
    }
  }
  if (cfg.calibrate && !a.errored && !a.busy) {
    if (cfg.dryRun) acts.push('[dry-run] calibraría bed mesh');
    else {
      const sent = await moonraker(a.p, 'POST', '/printer/gcode/script?script=' + encodeURIComponent('G28\nBED_MESH_CALIBRATE'), 240000);
      if (sent.ok) { acts.push('bed mesh calibrada'); await moonraker(a.p, 'POST', '/printer/gcode/script?script=' + encodeURIComponent('M104 S0\nM140 S0\nM84'), 15000); }
      else acts.push('no se pudo calibrar (timeout/err)');
    }
  }
  if (!acts.length) acts.push('lista — sin acción necesaria');
  a.acts = acts; return a;
}
async function maintReport(cfg, stamp, resumen, detalle) {
  const token = process.env.AIRTABLE_TOKEN, base = (cfg.airtable && cfg.airtable.base) || process.env.AIRTABLE_BASE_ID, table = (cfg.airtable && cfg.airtable.table) || 'Maquinas_Auditoria';
  if (token && base) {
    try { await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { Fecha: new Date().toISOString(), Resumen: resumen, Detalle: detalle }, typecast: true }) }); }
    catch (e) { console.log('[mant] Airtable falló:', e.message); }
  }
  if (cfg.mailUrl && cfg.mailTo) {
    try {
      const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      const body = `<h2 style="font-family:system-ui">Auditoría 3D — ${stamp.date} ${stamp.hm}</h2><p><b>${esc(resumen)}</b></p><pre style="font-family:monospace;font-size:13px;white-space:pre-wrap">${esc(detalle)}</pre><p style="color:#888;font-size:12px">The Lab Solutions · printer-bridge</p>`;
      const headers = { 'Content-Type': 'application/json' }; if (cfg.mailKey) headers['X-App-Key'] = cfg.mailKey;
      await fetch(cfg.mailUrl, { method: 'POST', headers, body: JSON.stringify({ action: 'send', to: cfg.mailTo, subject: `Auditoría impresoras 3D — ${resumen}`, body, from_name: 'The Lab Solutions' }) });
    } catch (e) { console.log('[mant] Email falló:', e.message); }
  }
}
async function runMaintenance(cfg) {
  const stamp = nowInTz(cfg.tz);
  console.log(`[mant] ${stamp.date} ${stamp.hm} — auditoría${cfg.dryRun ? ' (DRY-RUN)' : ''} de ${cfg.printers.length} impresora(s)`);
  const results = [];
  for (const p of cfg.printers) { const r = await maintainPrinter(await auditPrinter(p), cfg); results.push(r); console.log(`[mant]  • ${r.name}: ${r.state}${r.errored ? ' ERROR' : ''} — ${(r.acts || []).join('; ')}`); }
  const ok = results.filter(r => !r.errored && !r.busy && r.state !== 'offline').length;
  const err = results.filter(r => r.errored).length, off = results.filter(r => r.state === 'offline').length, busy = results.filter(r => r.busy).length;
  const resumen = `${ok} lista(s) · ${err} con error · ${busy} imprimiendo · ${off} offline · ${results.length} total${cfg.dryRun ? ' · DRY-RUN' : ''}`;
  const detalle = results.map(r => `${r.name} (${r.ip}): ${r.errored ? 'ERROR Klipper' + (r.klMsg ? ' ' + r.klMsg : '') : r.busy ? 'imprimiendo' : r.state === 'offline' ? 'OFFLINE' : 'lista'} · home ${r.homed ? 'sí' : 'no'} · malla ${r.meshOk ? 'sí' : 'no'} → ${(r.acts || []).join('; ')}`).join('\n');
  await maintReport(cfg, stamp, resumen, detalle);
  console.log('[mant] listo —', resumen);
  return { resumen, detalle };
}
let _maintLastRun = '';
function startMaintScheduler() {
  const cfg = loadMaintConfig();
  if (!cfg) { console.log('  Mantención auto: APAGADA (crea maint-config.json para activarla — ver README)'); return; }
  console.log(`  Mantención auto: ${cfg.time} ${cfg.tz} · ${cfg.printers.length} impresora(s) · calibrar=${cfg.calibrate} · dryRun=${cfg.dryRun}`);
  const tick = async () => {
    try {
      const cur = loadMaintConfig(); if (!cur) return;
      const now = nowInTz(cur.tz);
      if (now.hm === cur.time && _maintLastRun !== now.date) { _maintLastRun = now.date; await runMaintenance(cur); }
    } catch (e) { console.log('[mant] tick error:', e.message); }
  };
  const t = setInterval(tick, 30 * 1000); if (t.unref) t.unref();
}
