'use strict';

/**
 * The Lab Solutions — aviso por WhatsApp de impresiones con error o finalizadas.
 *
 * Vive en el farm-controller (iMac del taller, 24/7) y no depende de que el
 * dashboard esté abierto. Cada POLL_MS consulta print_stats de TODAS las
 * impresoras del registry —también las que se lanzaron desde la pantalla o
 * Creality Print, no solo las de la cola— y cuando detecta una transición
 * avisa al lead-worker (POST /notify/printer), que la manda a Gustavo por WATI.
 *
 *   printing/paused → complete           = impresión finalizada
 *   printing/paused → error | Klipper caído = impresión con error
 *   printing → paused con mensaje        = pausa con aviso (p. ej. errores "key" de Creality)
 *
 * Se activa solo si hay URL y clave: variables PRINT_NOTIFY_URL / PRINT_NOTIFY_KEY
 * (Linux: /etc/thelab-farm.env) o el archivo <FARM_DATA_DIR>/print-notify-config.json
 * {"url":"https://…/notify/printer","key":"…"} (Mac: el instalador regenera el
 * plist, así que el archivo es lo que sobrevive a reinstalar).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.FARM_DATA_DIR || path.join(__dirname, 'data');
const REGISTRY_FILE = process.env.FARM_REGISTRY_FILE || path.join(DATA_DIR, 'registry.json');
const STATE_FILE = path.join(DATA_DIR, 'print-notify.json');
const POLL_MS = Math.max(15_000, Number(process.env.PRINT_NOTIFY_INTERVAL_MS || 30_000));
const CONFIG_FILE = path.join(DATA_DIR, 'print-notify-config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch (_) { return {}; } }
const FILE_CFG = readConfig();
const NOTIFY_URL = String(process.env.PRINT_NOTIFY_URL || FILE_CFG.url || '').trim();
const NOTIFY_KEY = String(process.env.PRINT_NOTIFY_KEY || FILE_CFG.key || '').trim();
const ACTIVE = ['printing', 'paused'];

function isPrivateIp(ip) {
  const m = String(ip || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(x => x > 255)) return false;
  return o[0] === 10 || o[0] === 127 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

// Decide si el cambio entre dos lecturas merece aviso. `prev` sin estado
// (primera lectura tras arrancar) nunca avisa: no sabemos si ya se avisó.
function detectPrintEvent(prev, cur) {
  if (!prev || !prev.state || !cur) return null;
  const was = prev.state, st = cur.state, klipperDown = ['shutdown', 'error'].includes(cur.klipper);
  if (!ACTIVE.includes(was)) return null;
  if (st === 'complete') return { state: 'complete', message: '' };
  if (st === 'error') return { state: 'error', message: cur.message || 'Klipper reportó error' };
  if (klipperDown) return { state: 'error', message: cur.klipperMessage || `Klipper ${cur.klipper}` };
  if (was === 'printing' && st === 'paused' && cur.message) return { state: 'paused', message: cur.message };
  return null;
}

function machineName(m) {
  return String(m.name || m.alias || m.nombre || m.hostname || m.ip || 'impresora');
}

function getJson(ip, pathname, timeout = 4000) {
  return new Promise(resolve => {
    const req = http.get({ host: ip, port: 7125, path: pathname, timeout }, res => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function readPrinter(ip) {
  const d = await getJson(ip, '/printer/objects/query?print_stats&webhooks');
  const st = d?.result?.status;
  if (!st) {
    // Con Klipper en shutdown/error Moonraker no responde objects/query, pero
    // /printer/info sí dice el estado: sin esto la falla pasaría sin aviso.
    const info = (await getJson(ip, '/printer/info'))?.result;
    const k = String(info?.state || '').toLowerCase();
    if (!['shutdown', 'error'].includes(k)) return null;
    return { state: '', filename: '', message: '', durationSec: 0, totalSec: 0, klipper: k, klipperMessage: String(info.state_message || '').trim() };
  }
  const ps = st.print_stats || {}, wh = st.webhooks || {};
  return {
    state: String(ps.state || '').toLowerCase(),
    filename: String(ps.filename || ''),
    message: String(ps.message || '').trim(),
    durationSec: Math.round(Number(ps.print_duration || 0)),
    totalSec: Math.round(Number(ps.total_duration || 0)),
    klipper: String(wh.state || '').toLowerCase(),
    klipperMessage: String(wh.state_message || '').trim(),
  };
}

function postNotify(payload) {
  return new Promise(resolve => {
    let u; try { u = new URL(NOTIFY_URL); } catch (_) { return resolve(false); }
    const body = Buffer.from(JSON.stringify(payload));
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', timeout: 15_000,
      headers: { 'content-type': 'application/json', 'content-length': String(body.length), 'x-notify-key': NOTIFY_KEY } }, res => {
      res.resume(); res.on('end', () => resolve((res.statusCode || 500) < 300));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

let last = {};
let pending = [];
let busy = false;

function loadState() { try { last = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch (_) { last = {}; } }
function saveState() {
  try { const tmp = STATE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(last), { mode: 0o600 }); fs.renameSync(tmp, STATE_FILE); } catch (_) {}
}
function machines() {
  try { const r = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); return Array.isArray(r.machines) ? r.machines : []; } catch (_) { return []; }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const m of machines()) {
      if (!isPrivateIp(m.ip)) continue;
      const id = String(m.id || m.ip);
      const cur = await readPrinter(m.ip);
      if (!cur) continue; // offline: conserva el último estado conocido
      const prev = last[id];
      const ev = detectPrintEvent(prev, cur);
      if (ev) {
        const filename = cur.filename || prev.filename || '';
        pending.push({
          eventId: `${id}|${filename}|${ev.state}|${prev.totalSec || 0}`,
          machine: machineName(m), state: ev.state, filename, message: ev.message,
          durationSec: cur.durationSec || prev.durationSec || 0,
        });
      }
      last[id] = { state: cur.state, filename: cur.filename, durationSec: cur.durationSec, totalSec: cur.totalSec, at: Date.now() };
    }
    saveState();
    // Reintenta los que fallaron; el Worker deduplica por eventId.
    const queue = pending.slice(-20); pending = [];
    for (const p of queue) {
      if (!(await postNotify(p))) pending.push(p);
      else console.log(`[print-notify] ${p.state} ${p.machine} ${p.filename}`);
    }
  } catch (e) {
    console.warn('[print-notify]', e.message);
  } finally { busy = false; }
}

function start() {
  if (!NOTIFY_URL || !NOTIFY_KEY) {
    console.log(`[print-notify] desactivado (faltan PRINT_NOTIFY_URL/KEY o ${CONFIG_FILE})`);
    return false;
  }
  loadState();
  setTimeout(tick, 8000).unref();
  setInterval(tick, POLL_MS).unref();
  console.log(`[print-notify] activo cada ${Math.round(POLL_MS / 1000)}s → ${NOTIFY_URL}`);
  return true;
}

module.exports = { detectPrintEvent, machineName, start };
