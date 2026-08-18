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
//   POST /recover/{IP}             → reinicia Moonraker en la impresora (SSH) — telemetría caída
//   GET  /sshcheck/{IP}            → ¿puede el bridge entrar por SSH a esa impresora?
//   GET  /pubkey                   → llave pública del bridge (enrolar impresoras desde otro equipo)
//   POST /update                   → git pull + reinicio (actualiza el bridge sin ir al iMac)
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
const { execFile } = require('child_process');

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
// Recuperación de telemetría (ver "RECUPERAR MOONRAKER" más abajo)
const RECOVER_ENABLED = process.env.BRIDGE_RECOVER !== '0';
const SSH_USER = process.env.PRINTER_SSH_USER || 'root';
const SSH_PASS = process.env.PRINTER_SSH_PASS || '';
const SSH_KEY = process.env.PRINTER_SSH_KEY || '';
const UPDATE_ENABLED = process.env.BRIDGE_UPDATE !== '0';
const REPO_DIR = path.join(__dirname, '..');
const RECOVER_SSH_TIMEOUT_MS = 30000;   // la shell de la impresora es lenta por WiFi
const RECOVER_WAIT_MS = 45000;          // Moonraker tarda ~15s en registrar sus endpoints

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

// ── RECUPERAR MOONRAKER (telemetría caída) ───────────────────────────────
// Klipper y Moonraker son procesos distintos: cuando Moonraker se cae la
// máquina sigue imprimiendo pero el dashboard queda ciego ("Telemetría
// caída"). Levantarlo necesita una shell en la impresora, algo que el proxy
// HTTP no puede hacer — pero el bridge sí está en la LAN, así que lo hace por
// SSH. Reiniciar Moonraker NO interrumpe la impresión en curso: Klipper sigue
// moviendo la máquina por su cuenta.
//
// El guion reproduce el runbook (docs/TALLER_IMPRESORAS.md, Caso 1): repone
// moonraker.conf desde el respaldo cuando falta —la causa real de los dos
// incidentes de agosto— y reinicia el servicio se llame como se llame
// (S56moonraker_service en las K1, moonraker en las Ender-5 Max, systemd en
// una Klipper genérica).
function moonrakerRecoverScript() {
  return [
    'CFGDIRS="/usr/data/printer_data/config /mnt/UDISK/printer_data/config /root/printer_data/config /home/pi/printer_data/config"',
    'for d in $CFGDIRS; do',
    '  [ -d "$d" ] || continue',
    '  if [ ! -f "$d/moonraker.conf" ] && [ -f "$d/.moonraker.conf.bkp" ]; then',
    '    cp "$d/.moonraker.conf.bkp" "$d/moonraker.conf" && echo "moonraker.conf repuesto desde el respaldo ($d)"',
    '  elif [ -f "$d/moonraker.conf" ] && [ ! -f "$d/.moonraker.conf.bkp" ]; then',
    '    cp "$d/moonraker.conf" "$d/.moonraker.conf.bkp" && echo "respaldo de moonraker.conf creado ($d)"',
    '  fi',
    '  if [ ! -f "$d/moonraker.conf" ]; then echo "falta $d/moonraker.conf y no hay respaldo — copialo desde otra maquina sana"; fi',
    'done',
    'SVC=""',
    'for s in /etc/init.d/S56moonraker_service /etc/init.d/moonraker /etc/init.d/S56moonraker; do',
    '  [ -x "$s" ] && SVC="$s" && break',
    'done',
    '[ -n "$SVC" ] || SVC=$(ls /etc/init.d/ 2>/dev/null | grep -i moonraker | head -n 1 | sed "s|^|/etc/init.d/|")',
    'if [ -n "$SVC" ] && [ -x "$SVC" ]; then',
    // restart falla en algunos init de BusyBox si el proceso no estaba vivo —
    // que es justo nuestro caso — así que start es el segundo intento.
    '  if "$SVC" restart >/dev/null 2>&1 || "$SVC" start >/dev/null 2>&1; then',
    '    echo "servicio reiniciado: $SVC"',
    '  else',
    '    echo "$SVC devolvio error al arrancar — revisa moonraker.log"; exit 3',
    '  fi',
    'elif command -v systemctl >/dev/null 2>&1; then',
    '  if systemctl restart moonraker >/dev/null 2>&1; then',
    '    echo "servicio reiniciado: systemd/moonraker"',
    '  else',
    '    echo "systemctl no pudo reiniciar moonraker"; exit 3',
    '  fi',
    'else',
    '  echo "no se encontro el servicio de Moonraker en esta maquina"; exit 3',
    'fi',
    'exit 0',
  ].join('\n');
}
// El guion viaja como UN solo argumento de ssh: no pasa por ninguna shell
// local, y la IP ya viene validada por isPrivateIp, así que no hay forma de
// inyectar comandos desde la petición.
function recoverSshCommand(ip) {
  const opts = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=8', '-o', 'LogLevel=ERROR'];
  if (SSH_KEY) opts.push('-i', SSH_KEY, '-o', 'IdentitiesOnly=yes');
  const target = `${SSH_USER}@${ip}`;
  const script = moonrakerRecoverScript();
  if (SSH_PASS) {
    // sshpass -e toma la clave de la variable SSHPASS: nunca aparece en argv
    // (visible en `ps`) ni en los logs del bridge.
    return {
      cmd: 'sshpass',
      args: ['-e', 'ssh', ...opts, '-o', 'PubkeyAuthentication=no',
        '-o', 'PreferredAuthentications=password,keyboard-interactive', target, script],
      env: { ...process.env, SSHPASS: SSH_PASS },
    };
  }
  // Sin contraseña configurada solo se intenta con llave: BatchMode evita que
  // ssh se quede esperando una contraseña que nadie va a escribir.
  return { cmd: 'ssh', args: ['-o', 'BatchMode=yes', ...opts, target, script], env: process.env };
}
function runRecoverSsh(ip) {
  return new Promise(resolve => {
    const { cmd, args, env } = recoverSshCommand(ip);
    execFile(cmd, args, { timeout: RECOVER_SSH_TIMEOUT_MS, env, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      const errOut = String(stderr || '').trim();
      if (err && err.code === 'ENOENT') {
        return resolve({ ok: false, code: 'sin-ssh', out, error: cmd === 'sshpass'
          ? 'falta sshpass en el iMac (brew install sshpass) — o usa una llave SSH y quita PRINTER_SSH_PASS'
          : 'no se encontró el comando ssh en el iMac' });
      }
      if (err) {
        const detalle = errOut || out || err.message;
        return resolve({ ok: false, code: err.killed ? 'timeout-ssh' : 'ssh-falló', out, error: /permission denied|publickey/i.test(detalle)
          ? 'SSH rechazó la conexión — configura la llave (install-printer-keys.sh) o PRINTER_SSH_PASS'
          : detalle });
      }
      resolve({ ok: true, out });
    });
  });
}
async function waitMoonrakerUp(ip, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await moonraker({ ip }, 'GET', '/printer/info', 5000);
    if (r.ok) return true;
    await _sleep(3000);
  }
  return false;
}
// La llave pública del bridge, para que cualquier equipo de la red pueda
// enrolar una impresora A NOMBRE DEL IMAC. Sin esto hay que estar sentado
// frente al iMac: quien entra a las impresoras es él, no el portátil desde el
// que se corre el script. Una llave pública no es un secreto.
function bridgePublicKeys() {
  const home = process.env.HOME || '';
  const cands = SSH_KEY ? [SSH_KEY + '.pub']
    : [path.join(home, '.ssh', 'id_ed25519.pub'), path.join(home, '.ssh', 'id_rsa.pub')];
  const keys = [];
  for (const f of cands) {
    try { const t = fs.readFileSync(f, 'utf8').trim(); if (t) keys.push(t); } catch (e) {}
  }
  return keys;
}
// ¿Puede el bridge entrar a esta impresora? Es la pregunta que decide si el
// botón de recuperar va a servir, y solo el bridge puede responderla.
function sshCheck(ip) {
  return new Promise(resolve => {
    const { cmd, args, env } = recoverSshCommand(ip);
    const probe = args.slice(0, -1).concat('echo ok');   // mismo login, sin el guion de recuperación
    execFile(cmd, probe, { timeout: 20000, env }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ ok: false, error: `falta ${cmd} en el iMac` });
      if (err) return resolve({ ok: false, error: (String(stderr || '').trim() || err.message).split('\n')[0] });
      resolve({ ok: String(stdout || '').includes('ok') });
    });
  });
}
// git pull + salir: launchd lo levanta con el código nuevo. Así el bridge se
// actualiza desde el dashboard, sin ir hasta el iMac. Solo fast-forward.
function updateBridge() {
  return new Promise(resolve => {
    const run = git => execFile(git, ['-C', REPO_DIR, 'pull', '--ff-only', 'origin', 'main'], { timeout: 90000 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT' && git === 'git') return run('/usr/bin/git');
      const out = String(stdout || '').trim(), errOut = String(stderr || '').trim();
      if (err) return resolve({ ok: false, error: errOut || out || err.message });
      resolve({ ok: true, out });
    });
    run('git');
  });
}
const _recovering = new Set();
async function recoverPrinter(ip) {
  const t0 = Date.now();
  // Si contesta, no hay nada que reiniciar: pudo recuperarse sola entre que se
  // pintó la tarjeta y se pulsó el botón.
  const antes = await moonraker({ ip }, 'GET', '/printer/info', 4000);
  if (antes.ok) return { ok: true, moonraker: 'up', steps: ['Moonraker ya respondía — no hizo falta reiniciarlo'] };
  const r = await runRecoverSsh(ip);
  const steps = String(r.out || '').split('\n').map(s => s.trim()).filter(Boolean);
  console.log(`[recover] ${ip}: ${r.ok ? steps.join('; ') || 'sin salida' : 'ERROR ' + r.error}`);
  if (!r.ok) return { ok: false, code: r.code, error: r.error, steps };
  const up = await waitMoonrakerUp(ip, RECOVER_WAIT_MS);
  steps.push(up
    ? `Moonraker respondió tras ${Math.round((Date.now() - t0) / 1000)}s`
    : 'el servicio se reinició pero Moonraker no contestó — revisa moonraker.log en la impresora');
  return { ok: up, moonraker: up ? 'up' : 'down', steps };
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
  if (rawPath === '/pubkey') {
    const keys = bridgePublicKeys();
    // texto plano, una llave por línea: es un authorized_keys listo para usar
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(keys.join('\n') + (keys.length ? '\n' : ''));
    return;
  }
  const mChk = rawPath.match(/^\/sshcheck\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mChk) {
    if (!isPrivateIp(mChk[1])) { jsonError(res, 403, 'solo IPs de red privada'); return; }
    sshCheck(mChk[1]).then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); });
    return;
  }
  if (rawPath === '/update' && req.method === 'POST') {
    if (!UPDATE_ENABLED) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'actualización desactivada (BRIDGE_UPDATE=0)' }));
      return;
    }
    updateBridge().then(r => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...r, restarting: !!r.ok }));
      if (r.ok) { console.log('Actualizado vía /update — saliendo (launchd lo levanta con el código nuevo).'); setTimeout(() => process.exit(0), 400); }
    });
    return;
  }

  // Recuperar la telemetría de una impresora viva con Moonraker caído
  const mRec = rawPath.match(/^\/recover\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mRec) {
    const ip = mRec[1];
    if (req.method !== 'POST') { jsonError(res, 405, 'usa POST'); return; }
    if (!isPrivateIp(ip)) { jsonError(res, 403, 'solo IPs de red privada'); return; }
    if (!RECOVER_ENABLED) {
      // 200 con ok:false, no 503: por el túnel un 5xx no llega nunca (ver más abajo)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'desactivada', error: 'recuperación desactivada en el bridge (BRIDGE_RECOVER=0)', steps: [] }));
      return;
    }
    // Dos clics seguidos reiniciarían Moonraker en medio de su propio arranque
    if (_recovering.has(ip)) { jsonError(res, 409, 'ya hay una recuperación en curso para esa impresora'); return; }
    _recovering.add(ip);
    // SIEMPRE 200, incluso cuando la recuperación falla: el veredicto va en el
    // campo `ok` del cuerpo. Cloudflare descarta cualquier 5xx del origen y lo
    // reemplaza por su página de error —sin cabeceras CORS—, así que un 502
    // honesto llegaba al dashboard como un fetch rechazado sin explicación.
    recoverPrinter(ip)
      .then(r => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })
      .catch(e => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: 'error-interno', error: e.message, steps: [] })); })
      .finally(() => _recovering.delete(ip));
    return;
  }

  // Mantención: estado de config y ejecución on-demand (para probar sin esperar a la hora)
  if (rawPath === '/maint/status') {
    const cfg = loadMaintConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cfg ? { ok: true, enabled: true, time: cfg.time, tz: cfg.tz, printers: cfg.printers.length, calibrate: cfg.calibrate, restartAll: cfg.restartAll, dryRun: cfg.dryRun, lastRun: _maintLastRun } : { ok: true, enabled: false }));
    return;
  }
  if (rawPath === '/maint/run' && req.method === 'POST') {
    const cfg = loadMaintConfig();
    if (!cfg) { jsonError(res, 400, 'maint-config.json no encontrado — ver README'); return; }
    if (_maintRunning) { jsonError(res, 409, 'mantención ya en curso — espera a que termine'); return; }
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
  // 424 y no 502 por lo mismo: Cloudflare no deja pasar los 5xx del origen, y
  // el dashboard necesita distinguir "el bridge no llega a la impresora" de
  // "no llego al bridge". Los 4xx sí atraviesan el túnel intactos.
  preq.on('error', err => jsonError(res, 424, 'impresora inaccesible: ' + err.message));
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
  console.log(`  Recuperación   : ${RECOVER_ENABLED ? `activa por SSH como ${SSH_USER} (${SSH_PASS ? 'contraseña' : SSH_KEY ? 'llave ' + SSH_KEY : 'llave por defecto'})` : 'APAGADA (BRIDGE_RECOVER=0)'}`);
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
//   1) Audita estado (Klipper, home, malla, temps) + consola (errores `!!`
//      recientes en /server/gcode_store).
//   2) Reinicia el firmware: siempre si restartAll=true (chequeo matinal
//      preventivo), o solo si Klipper está en error. Espera a que Klipper
//      vuelva a "ready" antes de seguir; si reincide en error, avisa
//      "revisar hardware" y no calibra.
//   3) Si calibrate=true → corre G28 + BED_MESH_CALIBRATE y deja la máquina
//      segura (calentadores a 0 + motores liberados).
// Las impresoras se procesan EN PARALELO (cada una trabaja por su cuenta),
// así el parque completo queda listo en lo que tarda la más lenta.
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
      time: (typeof c.time === 'string' && /^\d{1,2}:\d{2}$/.test(c.time)) ? c.time.padStart(5, '0') : '09:00',
      tz: c.tz || 'America/Santiago',
      calibrate: c.calibrate !== false,
      restartAll: c.restartAll === true,                // reinicio de firmware preventivo a TODAS las libres
      calibrateTimeoutMs: (Number.isFinite(+c.calibrateTimeoutMs) && +c.calibrateTimeoutMs > 0) ? +c.calibrateTimeoutMs : 240000,
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
async function auditPrinter(p, opts = {}) {
  const name = p.name || p.ip;
  const r = await moonraker(p, 'GET', '/printer/objects/query?print_stats&heater_bed&extruder&webhooks&toolhead&bed_mesh&idle_timeout');
  if (!r.ok || !r.json || !r.json.result || !r.json.result.status) return { name, ip: p.ip, p, state: 'offline', errored: false, busy: false, busyGcode: false, homed: false, meshOk: false, consoleErrs: [] };
  const s = r.json.result.status, wh = s.webhooks || {}, ps = s.print_stats || {}, th = s.toolhead || {}, bm = s.bed_mesh || {}, ex = s.extruder || {}, hb = s.heater_bed || {};
  const klState = wh.state || 'ready';
  const errored = klState === 'shutdown' || klState === 'error';
  let state = ps.state || 'standby'; if (errored) state = 'shutdown';
  let klMsg = ''; if (wh.state_message) { try { klMsg = (JSON.parse(wh.state_message).msg) || wh.state_message; } catch (_) { klMsg = wh.state_message; } klMsg = String(klMsg).split('\n').map(x => x.trim()).filter(Boolean)[0] || ''; }
  // Ocupada = imprimiendo/pausada (print_stats) O ejecutando cualquier G-code
  // (idle_timeout "Printing"): print_stats solo refleja trabajos del virtual
  // SD, no macros, movimientos manuales ni calibraciones lanzadas por script.
  const busyPrint = state === 'printing' || state === 'paused';
  const busyGcode = !busyPrint && !errored && String((s.idle_timeout || {}).state || '') === 'Printing';
  // Chequeo de consola: errores de las últimas 24 h (líneas `!!` que Klipper
  // imprime en la consola, las mismas que se ven en Fluidd/Mainsail). Solo en
  // la auditoría inicial (opts.console) — no en los re-chequeos tras reinicio.
  let consoleErrs = [];
  if (opts.console) {
    const g = await moonraker(p, 'GET', '/server/gcode_store?count=100');
    const items = (g.ok && g.json && g.json.result && g.json.result.gcode_store) || [];
    const cutoff = Date.now() / 1000 - 24 * 3600;
    consoleErrs = [...new Set(items
      .filter(i => i && i.type === 'response' && (!i.time || i.time >= cutoff) && /^!!/.test(String(i.message || '').trim()))
      .map(i => String(i.message).trim().replace(/^!!\s*/, '').split('\n')[0]))].slice(-3);
  }
  return { name, ip: p.ip, p, state, errored, busy: busyPrint || busyGcode, busyGcode, homed: String(th.homed_axes || '').toLowerCase() === 'xyz', meshOk: !!(bm.profile_name || (bm.mesh_matrix && bm.mesh_matrix.length)), klState, klMsg, consoleErrs, hotend: Math.round(ex.temperature || 0), bed: Math.round(hb.temperature || 0), filename: (ps.filename || '').replace(/\.gcode$/i, '') };
}
// Tras un FIRMWARE_RESTART Klipper pasa por "startup" unos segundos antes de
// quedar "ready" — mandar G-code en ese lapso falla. Además, mientras Klippy
// se reconecta, Moonraker responde 503 y la auditoría lo lee como "offline"
// TRANSITORIO — por eso offline no corta la espera: se sigue sondeando hasta
// ver "ready", un error definitivo, o agotar maxMs.
async function waitKlippyReady(p, maxMs = 90000) {
  const t0 = Date.now();
  let a = await auditPrinter(p);
  while (!a.errored && a.klState !== 'ready' && Date.now() - t0 < maxMs) {
    await _sleep(3000);
    a = await auditPrinter(p);
  }
  return a;
}
function _copyAudit(a, re) {
  a.errored = re.errored; a.busy = re.busy; a.busyGcode = re.busyGcode;
  a.state = re.state; a.homed = re.homed; a.meshOk = re.meshOk;
  a.klState = re.klState; a.klMsg = re.klMsg;
}
async function maintainPrinter(a, cfg) {
  const acts = [];
  if (a.state === 'offline') { a.acts = ['offline — sin acción']; return a; }
  if (a.busy) { a.acts = [a.busyGcode ? 'ocupada (G-code/macro en curso) — NO se tocó' : 'imprimiendo — NO se tocó']; return a; }
  if (a.consoleErrs && a.consoleErrs.length) acts.push('consola con error reciente: "' + a.consoleErrs[a.consoleErrs.length - 1] + '"');
  // Reinicio de firmware: preventivo a todas las libres (restartAll) o solo si
  // Klipper está en error. Siempre reverifica antes de calibrar.
  if (cfg.restartAll || a.errored) {
    const motivo = a.errored ? 'Klipper en error' : 'preventivo';
    if (cfg.dryRun) acts.push(`[dry-run] reiniciaría firmware (${motivo})`);
    else {
      const rr = await moonraker(a.p, 'POST', '/printer/firmware_restart');
      if (!rr.ok) { acts.push(`no se pudo enviar el reinicio de firmware (${motivo}) — sin respuesta de Moonraker`); a.acts = acts; return a; }
      await _sleep(3000);
      const re = await waitKlippyReady(a.p);
      _copyAudit(a, re);
      if (re.errored) { acts.push(`firmware reiniciado (${motivo}) — SIGUE EN ERROR, revisar hardware`); a.acts = acts; return a; }
      if (re.busy) { acts.push(`firmware reiniciado (${motivo}) — empezó a imprimir/moverse justo después, no se calibra`); a.acts = acts; return a; }
      if (re.state === 'offline' || re.klState !== 'ready') { acts.push(`firmware reiniciado (${motivo}) — Klipper no volvió a "ready", no se calibra`); a.acts = acts; return a; }
      acts.push(`firmware reiniciado (${motivo}) ✓`);
    }
  } else if (!cfg.dryRun && a.klState === 'startup') {
    // Sin reinicio de por medio, una impresora recién encendida puede seguir
    // arrancando: espera a "ready" antes de calibrar.
    _copyAudit(a, await waitKlippyReady(a.p));
    if (a.errored) { acts.push('Klipper terminó en error al arrancar — revisar'); a.acts = acts; return a; }
  }
  // Calibración: global (calibrate) con opción de excluir una impresora
  // puntual poniéndole "calibrate": false en su entrada del config.
  if (cfg.calibrate && a.p.calibrate !== false && !a.errored && !a.busy) {
    if (cfg.dryRun) acts.push('[dry-run] calibraría bed mesh');
    else if (a.klState !== 'ready') acts.push(`Klipper no está "ready" (${a.klState || 'sin estado'}) — no se calibra`);
    else {
      const sent = await moonraker(a.p, 'POST', '/printer/gcode/script?script=' + encodeURIComponent('G28\nBED_MESH_CALIBRATE'), cfg.calibrateTimeoutMs);
      acts.push(sent.ok ? 'bed mesh calibrada' : 'no se pudo calibrar (timeout/err)');
      // Dejar la máquina segura pase lo que pase: calentadores a 0 y motores
      // liberados. Si la calibración sigue corriendo, esto se encola detrás.
      await moonraker(a.p, 'POST', '/printer/gcode/script?script=' + encodeURIComponent('M104 S0\nM140 S0\nM84'), 15000);
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
  // Exclusión mutua: una segunda corrida (POST /maint/run solapado con la de
  // las 9:00, o doble clic) vería "libres" a impresoras a media calibración y
  // les mandaría FIRMWARE_RESTART en pleno movimiento.
  if (_maintRunning) return { resumen: 'mantención ya en curso — no se lanzó otra', detalle: '', skipped: true };
  _maintRunning = true;
  try {
    const stamp = nowInTz(cfg.tz);
    console.log(`[mant] ${stamp.date} ${stamp.hm} — auditoría${cfg.dryRun ? ' (DRY-RUN)' : ''} de ${cfg.printers.length} impresora(s)${cfg.restartAll ? ' · reinicio preventivo' : ''}`);
    // En paralelo: cada impresora se audita/reinicia/calibra por su cuenta, así
    // el parque completo queda listo en lo que tarda la más lenta (secuencial,
    // con reinicio + calibración por máquina, podría pasarse de la hora).
    const results = await Promise.all(cfg.printers.map(async p => {
      const r = await maintainPrinter(await auditPrinter(p, { console: true }), cfg);
      console.log(`[mant]  • ${r.name}: ${r.state}${r.errored ? ' ERROR' : ''} — ${(r.acts || []).join('; ')}`);
      return r;
    }));
    const ok = results.filter(r => !r.errored && !r.busy && r.state !== 'offline' && (!r.klState || r.klState === 'ready')).length;
    const err = results.filter(r => r.errored).length, off = results.filter(r => r.state === 'offline').length, busy = results.filter(r => r.busy).length;
    const resumen = `${ok} lista(s) · ${err} con error · ${busy} ocupada(s) · ${off} offline · ${results.length} total${cfg.dryRun ? ' · DRY-RUN' : ''}`;
    const detalle = results.map(r => {
      const estado = r.errored ? 'ERROR Klipper' + (r.klMsg ? ' ' + r.klMsg : '')
        : r.busy ? (r.busyGcode ? 'ocupada (G-code/macro)' : 'imprimiendo')
        : r.state === 'offline' ? 'OFFLINE'
        : (r.klState && r.klState !== 'ready') ? `NO LISTA (Klipper ${r.klState})`
        : 'lista';
      return `${r.name} (${r.ip}): ${estado} · home ${r.homed ? 'sí' : 'no'} · malla ${r.meshOk ? 'sí' : 'no'}${r.consoleErrs && r.consoleErrs.length ? ' · consola: "' + r.consoleErrs[r.consoleErrs.length - 1] + '"' : ''} → ${(r.acts || []).join('; ')}`;
    }).join('\n');
    await maintReport(cfg, stamp, resumen, detalle);
    console.log('[mant] listo —', resumen);
    return { resumen, detalle };
  } finally { _maintRunning = false; }
}
let _maintLastRun = '';
let _maintRunning = false;
function startMaintScheduler() {
  const cfg = loadMaintConfig();
  if (!cfg) { console.log('  Mantención auto: APAGADA (crea maint-config.json para activarla — ver README)'); return; }
  console.log(`  Mantención auto: ${cfg.time} ${cfg.tz} · ${cfg.printers.length} impresora(s) · calibrar=${cfg.calibrate} · reinicioPreventivo=${cfg.restartAll} · dryRun=${cfg.dryRun}`);
  const tick = async () => {
    try {
      const cur = loadMaintConfig(); if (!cur) return;
      const now = nowInTz(cur.tz);
      // Si hay una corrida manual en vuelo a la hora agendada, cuenta como la
      // corrida del día (se marca la fecha igual) y no se lanza otra encima.
      if (now.hm === cur.time && _maintLastRun !== now.date) { _maintLastRun = now.date; if (!_maintRunning) await runMaintenance(cur); }
    } catch (e) { console.log('[mant] tick error:', e.message); }
  };
  const t = setInterval(tick, 30 * 1000); if (t.unref) t.unref();
}
