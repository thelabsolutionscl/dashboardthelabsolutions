#!/usr/bin/env node
'use strict';

/**
 * The Lab Solutions — Farm Controller
 * Capa de control delante del printer-bridge legado.
 * - cola durable en disco, independiente del navegador
 * - registry con identidad estable y discovery LAN
 * - autorización por roles viewer/operator/admin
 * - CORS cerrado al dashboard por defecto
 * - compatibilidad hacia atrás con el mismo túnel y ?bt=TOKEN
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = process.env.FARM_DATA_DIR || path.join(ROOT, 'data');
const QUEUE_FILE = process.env.FARM_QUEUE_FILE || path.join(DATA_DIR, 'queue.json');
const REGISTRY_FILE = process.env.FARM_REGISTRY_FILE || path.join(DATA_DIR, 'registry.json');
const PUBLIC_PORT = Number(process.env.BRIDGE_PORT || 8347);
const LEGACY_PORT = Number(process.env.LEGACY_BRIDGE_PORT || 8348);
const DASHBOARD_ORIGIN = process.env.BRIDGE_ALLOW_ORIGIN || 'https://dashboard.thelab.solutions';
const DISCOVERY_PREFIX = process.env.FARM_LAN_PREFIX || '192.168.100.';
const DISCOVERY_INTERVAL_MS = Math.max(60_000, Number(process.env.FARM_DISCOVERY_INTERVAL_MS || 10 * 60_000));
const MAX_BODY = 64 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

function atomicWrite(file, value) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex'); }
function nowIso() { return new Date().toISOString(); }
function safeEq(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function isPrivateIp(ip) {
  const m = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(x => x < 0 || x > 255)) return false;
  return o[0] === 10 || o[0] === 127 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}
function cleanPrintFilename(value) {
  const s = String(value || '').replace(/\\/g, '/');
  return decodeURIComponentSafe(s.split('/').pop() || '').trim().toLowerCase();
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch (_) { return value; } }
function samePrintFilename(a, b) { return !!a && !!b && cleanPrintFilename(a) === cleanPrintFilename(b); }

function loadOrCreateMasterToken() {
  if (process.env.BRIDGE_TOKEN) return process.env.BRIDGE_TOKEN.trim();
  const file = path.join(ROOT, '.bridge-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t) return t; } catch (_) {}
  const t = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}
const MASTER_TOKEN = loadOrCreateMasterToken();
const TOKENS = {
  admin: (process.env.BRIDGE_ADMIN_TOKEN || MASTER_TOKEN).trim(),
  operator: (process.env.BRIDGE_OPERATOR_TOKEN || '').trim(),
  viewer: (process.env.BRIDGE_VIEWER_TOKEN || '').trim(),
};
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('base64url');
const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };
function tokenFromReq(req) {
  const u = new URL(req.url, 'http://farm.local');
  return String(req.headers['x-bridge-token'] || u.searchParams.get('bt') || '');
}
function roleForToken(token) {
  if (TOKENS.admin && safeEq(token, TOKENS.admin)) return 'admin';
  if (TOKENS.operator && safeEq(token, TOKENS.operator)) return 'operator';
  if (TOKENS.viewer && safeEq(token, TOKENS.viewer)) return 'viewer';
  return '';
}
function requireRole(req, res, minimum) {
  const role = roleForToken(tokenFromReq(req));
  if (!role || ROLE_RANK[role] < ROLE_RANK[minimum]) {
    json(res, 403, { ok: false, error: 'forbidden', requiredRole: minimum });
    return '';
  }
  return role;
}

function normalizeQueue(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  return { version: 1, updatedAt: q.updatedAt || 0, jobs: Array.isArray(q.jobs) ? q.jobs : [] };
}
function recoverQueueJobs(q) {
  let recovered = 0;
  for (const j of (q && Array.isArray(q.jobs) ? q.jobs : [])) {
    if (['checking', 'uploading', 'uploaded'].includes(j.state)) {
      j.state = 'retry';
      j.lastError = 'recuperado tras reinicio del Farm Controller';
      j.updatedAt = nowIso();
      recovered++;
    }
  }
  return recovered;
}
function normalizeRegistry(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { version: 1, updatedAt: r.updatedAt || 0, machines: Array.isArray(r.machines) ? r.machines : [] };
}
let queue = normalizeQueue(readJson(QUEUE_FILE, null));
let registry = normalizeRegistry(readJson(REGISTRY_FILE, null));
let queueWrite = Promise.resolve(), registryWrite = Promise.resolve();
function persistQueue() {
  queue.updatedAt = Date.now();
  queueWrite = queueWrite.then(() => atomicWrite(QUEUE_FILE, queue)).catch(e => console.error('[queue] persist', e));
  return queueWrite;
}
function persistRegistry() {
  registry.updatedAt = Date.now();
  registryWrite = registryWrite.then(() => atomicWrite(REGISTRY_FILE, registry)).catch(e => console.error('[registry] persist', e));
  return registryWrite;
}
const recoveredAtBoot = recoverQueueJobs(queue);
if (recoveredAtBoot) {
  console.warn(`[queue] ${recoveredAtBoot} trabajo(s) intermedio(s) recuperado(s) tras reinicio`);
  persistQueue();
}
function publicJob(j) { const { gcodeBase64, ...rest } = j; return { ...rest, hasPayload: !!gcodeBase64 }; }
function machineByIdentity({ id, serial, mac, hostname, ip } = {}) {
  let hit = registry.machines.find(m =>
    (id && m.id === id) || (serial && m.serial && m.serial === serial) ||
    (mac && m.mac && m.mac.toLowerCase() === String(mac).toLowerCase()) || (ip && m.ip === ip));
  if (hit || !hostname) return hit;
  const same = registry.machines.filter(m => m.hostname && m.hostname === hostname);
  return same.length === 1 ? same[0] : undefined;
}
function upsertMachine(patch) {
  let m = machineByIdentity(patch);
  if (!m) {
    m = { id: patch.id || uid('machine'), createdAt: nowIso(), firstSeenAt: nowIso() };
    registry.machines.push(m);
  }
  const oldIp = m.ip;
  Object.assign(m, patch, { updatedAt: nowIso(), lastSeenAt: patch.lastSeenAt || m.lastSeenAt || nowIso() });
  if (oldIp && patch.ip && oldIp !== patch.ip) {
    m.ipHistory = Array.isArray(m.ipHistory) ? m.ipHistory : [];
    m.ipHistory.unshift({ ip: oldIp, until: nowIso() });
    m.ipHistory = m.ipHistory.slice(0, 20);
  }
  persistRegistry();
  return m;
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin || DASHBOARD_ORIGIN === '*' || origin === DASHBOARD_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin || DASHBOARD_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key,X-Bridge-Token,Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'X-Bridge-Error,X-Farm-Role');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, body, headers = {}) {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('payload demasiado grande')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
function cleanForwardPath(rawUrl) {
  const u = new URL(rawUrl, 'http://farm.local');
  u.searchParams.delete('bt');
  return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
}

let legacy = null;
function startLegacy() {
  if (legacy) return;
  const env = { ...process.env, BRIDGE_PORT: String(LEGACY_PORT), BRIDGE_TOKEN: INTERNAL_TOKEN, BRIDGE_ALLOW_ORIGIN: 'http://127.0.0.1' };
  legacy = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  legacy.on('exit', (code, signal) => {
    console.error(`[farm] legacy bridge salió code=${code} signal=${signal || ''}; reiniciando en 2s`);
    legacy = null;
    setTimeout(startLegacy, 2000).unref();
  });
}

function routeMinimumRole(req, pathname) {
  if (pathname === '/healthz') return null;
  if (pathname === '/authcheck') return 'viewer';
  if (pathname.startsWith('/farm/')) return null;
  if (pathname === '/restart' || pathname === '/update' || pathname === '/pubkey' || pathname.startsWith('/sshcheck/') || pathname.startsWith('/recover/') || pathname.startsWith('/maint/')) return 'admin';
  if (req.method === 'GET' || req.method === 'HEAD') return 'viewer';
  if (/\/printer\/(print|gcode|objects\/subscribe|emergency_stop)/.test(pathname) || /\/server\/files\/(upload|delete)/.test(pathname)) return 'operator';
  return 'admin';
}
function proxyLegacy(req, res, role) {
  const bodyless = req.method === 'GET' || req.method === 'HEAD';
  const forward = (body) => {
    const targetPath = cleanForwardPath(req.url);
    const headers = { ...req.headers, host: `127.0.0.1:${LEGACY_PORT}`, 'x-bridge-token': INTERNAL_TOKEN };
    delete headers.origin; delete headers.referer; delete headers['content-length'];
    if (body) headers['content-length'] = String(body.length);
    const p = http.request({ host: '127.0.0.1', port: LEGACY_PORT, path: targetPath, method: req.method, headers, timeout: 20_000 }, pr => {
      const h = { ...pr.headers, 'x-farm-role': role || 'public' };
      delete h['access-control-allow-origin']; delete h['access-control-allow-methods']; delete h['access-control-allow-headers'];
      res.writeHead(pr.statusCode || 502, h);
      pr.pipe(res);
    });
    p.on('timeout', () => p.destroy(new Error('legacy timeout')));
    p.on('error', e => json(res, 502, { ok: false, error: 'legacy bridge no disponible: ' + e.message }, { 'X-Bridge-Error': '1' }));
    if (body) p.end(body); else req.pipe(p);
  };
  if (bodyless) forward(null); else readBody(req).then(forward).catch(e => json(res, 413, { ok: false, error: e.message }));
}

function queueJobById(id) { return queue.jobs.find(j => j.id === id); }
function enqueue(payload) {
  const machineId = String(payload.machineId || '');
  const machine = machineByIdentity({ id: machineId }) || machineByIdentity({ ip: payload.ip });
  // El registry es canónico: si conoce la máquina, su IP gana a cualquier IP
  // enviada por un navegador que podría llevar horas/días guardada.
  const ip = String(machine?.ip || payload.ip || '');
  if (!machineId && !ip) throw new Error('machineId o ip requerido');
  if (ip && !isPrivateIp(ip)) throw new Error('IP no válida');
  const filename = String(payload.filename || '').replace(/[\\/]/g, '_').slice(0, 200);
  if (!filename) throw new Error('filename requerido');
  const gcodeBase64 = String(payload.gcodeBase64 || '');
  if (!gcodeBase64) throw new Error('gcodeBase64 requerido');
  const j = {
    id: payload.id || uid('print'), machineId: machineId || machine?.id || '', ip,
    filename, gcodeBase64, bytes: Buffer.byteLength(gcodeBase64, 'base64'),
    grams: Number(payload.grams || 0), secs: Number(payload.secs || 0),
    priority: Math.max(0, Math.min(100, Number(payload.priority || 50))),
    state: 'queued', attempts: 0, createdAt: nowIso(), updatedAt: nowIso(),
    source: String(payload.source || 'dashboard'), lastError: '',
  };
  queue.jobs.push(j);
  queue.jobs.sort((a, b) => b.priority - a.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  persistQueue();
  return j;
}
function markJob(id, patch) {
  const j = queueJobById(id); if (!j) return null;
  Object.assign(j, patch, { updatedAt: nowIso() }); persistQueue(); return j;
}
function requestLegacy(method, targetPath, body, headers = {}) {
  return new Promise(resolve => {
    const h = { ...headers, 'x-bridge-token': INTERNAL_TOKEN };
    if (body) h['content-length'] = String(body.length);
    const r = http.request({ host: '127.0.0.1', port: LEGACY_PORT, path: targetPath, method, headers: h, timeout: 25_000 }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ ok: (res.statusCode || 500) < 300, status: res.statusCode || 0, body: Buffer.concat(parts) }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, status: 0, body: Buffer.from('timeout') }); });
    r.on('error', e => resolve({ ok: false, status: 0, body: Buffer.from(e.message) }));
    if (body) r.end(body); else r.end();
  });
}
function multipartUpload(filename, content) {
  const boundary = '----tlsfarm' + crypto.randomBytes(10).toString('hex');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '')}"\r\nContent-Type: text/plain\r\n\r\n`);
  const mid = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="root"\r\n\r\ngcodes\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, mid]), contentType: 'multipart/form-data; boundary=' + boundary };
}
const activeJobRuns = new Set();
async function runQueuedJob(j) {
  if (!j || !['queued', 'retry'].includes(j.state) || activeJobRuns.has(j.id)) return;
  activeJobRuns.add(j.id);
  const queuedState = j.state;
  try {
    markJob(j.id, { state: 'checking', lastError: '' });
    const machine = machineByIdentity({ id: j.machineId }) || machineByIdentity({ ip: j.ip });
    const ip = machine?.ip || j.ip;
    if (!isPrivateIp(ip)) return markJob(j.id, { state: 'blocked', lastError: 'IP de máquina no disponible' });
    const live = await requestLegacy('GET', `/${ip}/printer/objects/query?print_stats&webhooks`);
    if (!live.ok) return markJob(j.id, { state: 'retry', lastError: `preflight HTTP ${live.status}` });
    try {
      const body = JSON.parse(live.body.toString('utf8') || '{}');
      const st = body.result?.status || {}, ps = st.print_stats || {}, wh = st.webhooks || {};
      const printState = String(ps.state || '').toLowerCase();
      if (['printing', 'paused'].includes(printState)) {
        // Si caímos justo después de /print/start, queue.json puede decir
        // retry/uploaded aunque Moonraker YA esté imprimiendo ese archivo. En
        // vez de reimprimirlo cuando termine, reconciliamos y lo damos por started.
        if (samePrintFilename(ps.filename, j.filename)) {
          return markJob(j.id, { state: 'started', ip, startedAt: j.startedAt || nowIso(), recovered: true, gcodeBase64: '', lastError: '' });
        }
        // La impresora está ocupada por OTRO trabajo: este sigue esperando.
        return markJob(j.id, { state: queuedState, lastError: `esperando: impresora ${printState}` });
      }
      if (['shutdown', 'error', 'startup'].includes(String(wh.state || '').toLowerCase())) return markJob(j.id, { state: 'blocked', lastError: `Klipper ${wh.state}` });
    } catch (_) { return markJob(j.id, { state: 'retry', lastError: 'preflight inválido' }); }
    const nextAttempts = Number(j.attempts || 0) + 1;
    markJob(j.id, { state: 'uploading', ip, attempts: nextAttempts, lastError: '' });
    const gcode = Buffer.from(j.gcodeBase64 || '', 'base64');
    if (!gcode.length) return markJob(j.id, { state: 'failed', lastError: 'payload G-code ausente' });
    const mp = multipartUpload(j.filename, gcode);
    const upload = await requestLegacy('POST', `/${ip}/server/files/upload`, mp.body, { 'content-type': mp.contentType });
    if (!upload.ok) return markJob(j.id, { state: nextAttempts < 4 ? 'retry' : 'failed', lastError: `upload HTTP ${upload.status}: ${upload.body.toString('utf8').slice(0, 300)}` });
    markJob(j.id, { state: 'uploaded' });
    const start = await requestLegacy('POST', `/${ip}/printer/print/start?filename=${encodeURIComponent(j.filename)}`);
    if (!start.ok) return markJob(j.id, { state: nextAttempts < 4 ? 'retry' : 'failed', lastError: `start HTTP ${start.status}: ${start.body.toString('utf8').slice(0, 300)}` });
    return markJob(j.id, { state: 'started', startedAt: nowIso(), gcodeBase64: '', lastError: '' });
  } finally {
    activeJobRuns.delete(j.id);
  }
}
let queueWorkerBusy = false;
async function queueWorker() {
  if (queueWorkerBusy) return;
  queueWorkerBusy = true;
  try {
    const candidates = queue.jobs.filter(j => ['queued', 'retry'].includes(j.state));
    for (const j of candidates) {
      // `started` es histórico, NO un lock: el estado vivo de Moonraker decide
      // si la máquina sigue ocupada. Contarlo aquí dejaba bloqueado el segundo
      // trabajo para siempre después de arrancar el primero.
      const sameMachineTransition = queue.jobs.some(x => x.id !== j.id && x.machineId === j.machineId && ['checking', 'uploading', 'uploaded'].includes(x.state));
      if (!sameMachineTransition) await runQueuedJob(j);
    }
  } catch (e) { console.error('[queue] worker', e); } finally { queueWorkerBusy = false; }
}

function probe(ip, port, pathname, timeout = 1200) {
  return new Promise(resolve => {
    const r = http.get({ host: ip, port, path: pathname, timeout }, res => {
      const parts = []; let total = 0;
      res.on('data', c => { total += c.length; if (total < 128 * 1024) parts.push(c); });
      res.on('end', () => resolve({ ok: true, status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false }); });
    r.on('error', () => resolve({ ok: false }));
  });
}
function findMac(value) {
  if (!value || typeof value !== 'object') return '';
  for (const [k,v] of Object.entries(value)) {
    if (/^(mac|mac_address|hwaddr)$/i.test(k) && typeof v === 'string' && /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v)) return v.toLowerCase();
    const nested = findMac(v); if (nested) return nested;
  }
  return '';
}
async function identifyPrinter(ip) {
  const info = await probe(ip, 7125, '/printer/info', 1800);
  if (!info.ok) return null;
  let parsed = {}; try { parsed = JSON.parse(info.body || '{}').result || {}; } catch (_) {}
  const [serverInfo, systemInfo] = await Promise.all([probe(ip, 7125, '/server/info', 1800), probe(ip, 7125, '/machine/system_info', 1800)]);
  let si = {}, sys = {};
  try { si = JSON.parse(serverInfo.body || '{}').result || {}; } catch (_) {}
  try { sys = JSON.parse(systemInfo.body || '{}').result?.system_info || {}; } catch (_) {}
  const hostname = String(si.hostname || sys.hostname || parsed.hostname || '');
  const mac = findMac(sys);
  return { ip, hostname, mac, klipper: parsed.software_version || '', moonraker: si.moonraker_version || '', lastSeenAt: nowIso(), online: true };
}
async function discoverLan() {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.$/.test(DISCOVERY_PREFIX)) return;
  const ips = Array.from({ length: 253 }, (_, i) => DISCOVERY_PREFIX + (i + 2));
  const concurrency = 32; let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < ips.length) { const ip = ips[cursor++]; const id = await identifyPrinter(ip); if (id) upsertMachine(id); }
  });
  await Promise.all(workers);
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://farm.local'), p = u.pathname;
  // El bridge legado ejecutaba /restart sin validar método. Desde el controller
  // el reinicio es admin + POST-only, evitando que una navegación/GET lo dispare.
  if (p === '/restart' && req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { ok: false, error: 'method not allowed' }); }
  if (p === '/healthz') return json(res, 200, { ok: true, service: 'farm-controller', uptime: Math.round(process.uptime()), queue: queue.jobs.filter(j => ['queued', 'retry', 'checking', 'uploading', 'uploaded'].includes(j.state)).length, machines: registry.machines.length });
  if (p === '/authcheck') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, role, rolesEnabled: { viewer: !!TOKENS.viewer, operator: !!TOKENS.operator, admin: !!TOKENS.admin } }, { 'X-Farm-Role': role });
  }
  if (p === '/farm/queue' && req.method === 'GET') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, updatedAt: queue.updatedAt, jobs: queue.jobs.map(publicJob) });
  }
  if (p === '/farm/queue' && req.method === 'POST') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    try { const body = JSON.parse((await readBody(req, 48 * 1024 * 1024)).toString('utf8') || '{}'); const j = enqueue(body); return json(res, 201, { ok: true, job: publicJob(j) }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  const qRun = p.match(/^\/farm\/queue\/([^/]+)\/run$/);
  if (qRun && req.method === 'POST') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    const j = queueJobById(decodeURIComponent(qRun[1])); if (!j) return json(res, 404, { ok: false, error: 'job no encontrado' });
    runQueuedJob(j).catch(e => markJob(j.id, { state: 'failed', lastError: e.message }));
    return json(res, 202, { ok: true, job: publicJob(j) });
  }
  const qDel = p.match(/^\/farm\/queue\/([^/]+)$/);
  if (qDel && req.method === 'DELETE') {
    const role = requireRole(req, res, 'operator'); if (!role) return;
    const id = decodeURIComponent(qDel[1]), before = queue.jobs.length;
    queue.jobs = queue.jobs.filter(j => j.id !== id || ['checking', 'uploading', 'started'].includes(j.state));
    if (queue.jobs.length === before) return json(res, 409, { ok: false, error: 'job no encontrado o ya está ejecutándose' });
    persistQueue(); return json(res, 200, { ok: true });
  }
  if (p === '/farm/registry' && req.method === 'GET') {
    const role = requireRole(req, res, 'viewer'); if (!role) return;
    return json(res, 200, { ok: true, updatedAt: registry.updatedAt, machines: registry.machines });
  }
  if (p === '/farm/registry' && (req.method === 'POST' || req.method === 'PATCH')) {
    const role = requireRole(req, res, 'admin'); if (!role) return;
    try { const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}'); if (body.ip && !isPrivateIp(body.ip)) throw new Error('IP no válida'); const m = upsertMachine(body); return json(res, 200, { ok: true, machine: m }); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  }
  if (p === '/farm/discover' && req.method === 'POST') {
    const role = requireRole(req, res, 'admin'); if (!role) return;
    discoverLan().catch(e => console.warn('[registry] manual discovery', e.message));
    return json(res, 202, { ok: true, started: true });
  }
  const minimum = routeMinimumRole(req, p);
  if (minimum === null) return proxyLegacy(req, res, 'public');
  const role = requireRole(req, res, minimum); if (!role) return;
  proxyLegacy(req, res, role);
});

function start(){
  startLegacy();
  setInterval(queueWorker, 10_000).unref();
  setTimeout(queueWorker, 1500).unref();
  if (process.env.FARM_DISCOVERY_ENABLED !== '0') {
    setTimeout(() => discoverLan().catch(e => console.warn('[registry] discovery', e.message)), 5000).unref();
    setInterval(() => discoverLan().catch(e => console.warn('[registry] discovery', e.message)), DISCOVERY_INTERVAL_MS).unref();
  }
  server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log('─'.repeat(64));
    console.log('  The Lab Solutions — Farm Controller');
    console.log(`  Público         : 0.0.0.0:${PUBLIC_PORT}`);
    console.log(`  Bridge interno  : 127.0.0.1:${LEGACY_PORT}`);
    console.log(`  CORS            : ${DASHBOARD_ORIGIN}`);
    console.log(`  Queue           : ${QUEUE_FILE}`);
    console.log(`  Registry        : ${REGISTRY_FILE}`);
    console.log(`  Roles           : viewer=${TOKENS.viewer ? 'sí' : 'fallback'} operator=${TOKENS.operator ? 'sí' : 'fallback'} admin=sí`);
    console.log('─'.repeat(64));
  });
}
function shutdown() {
  try { if (legacy) legacy.kill('SIGTERM'); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
if (require.main === module) {
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  start();
}
module.exports = { isPrivateIp, normalizeQueue, recoverQueueJobs, samePrintFilename, normalizeRegistry, roleForToken, routeMinimumRole, start };
