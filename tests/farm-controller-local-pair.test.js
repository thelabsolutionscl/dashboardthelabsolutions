#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const ROOT=path.join(__dirname,'..');
const CTRL=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.js'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const PAIR=fs.readFileSync(path.join(ROOT,'printer-bridge','pair-dashboard.sh'),'utf8');

test('emparejamiento local no expone el master token ni acepta túnel remoto',()=>{
  assert.match(CTRL,/function isLoopbackRequest\(req\)/);
  assert.match(CTRL,/p==='\/farm\/local-pair'/);
  assert.match(CTRL,/if\(!isLoopbackRequest\(req\)\)return json\(res,403/);
  assert.match(CTRL,/https:\/\/dashboard\.thelab\.solutions\/#printer_pair=/);
  assert.doesNotMatch(CTRL,/local-pair[\s\S]{0,1200}MASTER_TOKEN/);
});

test('credenciales de navegador se guardan hasheadas y sobreviven reinicios',()=>{
  assert.match(CTRL,/const PAIR_FILE = .*browser-pairs\.json/);
  assert.match(CTRL,/pairTokenHash\(token\)/);
  assert.match(CTRL,/tokenHash:pairTokenHash\(token\)/);
  assert.match(CTRL,/roleForBrowserPair\(token\)/);
  assert.match(CTRL,/const pairedRole=roleForBrowserPair\(token\)/);
  assert.doesNotMatch(CTRL,/pairs\.push\([^\n]*token,/,'no debe persistirse el token claro');
});

test('dashboard consume el fragmento local sin enviarlo al servidor web',()=>{
  assert.match(MAQ,/function _consumePrinterPairingFragment\(\)/);
  assert.match(MAQ,/location\.hash/);
  assert.match(MAQ,/localStorage\.setItem\('printer_device_token',token\)/);
  assert.match(MAQ,/history\.replaceState\(null,'',clean\)/);
  assert.match(MAQ,/return local\|\|paired\|\|d/,'el pairing debe ser persistente, pero un override temporal de sesión debe poder ganar para diagnóstico');
});

test('script de emparejamiento valida el Controller, se autorepara y abre la URL final',()=>{
  assert.match(PAIR,/BASE="http:\/\/127\.0\.0\.1:\$\{PORT\}"/);
  assert.match(PAIR,/PAIR_URL="\$\{BASE\}\/farm\/local-pair"/);
  assert.match(PAIR,/'"service":"farm-controller"'/,'no basta con que cualquier proceso responda healthz');
  assert.match(PAIR,/install-farm-controller\.sh/,'debe reparar launchd si 8347 sirve el proceso equivocado o stale');
  assert.match(PAIR,/repo_revision\(\)/,'debe conocer la revisión del repo local');
  assert.match(PAIR,/controller_revision\(\)/,'debe comparar la revisión realmente cargada');
  assert.match(PAIR,/farm\/health\/probe/,'debe probar que el Controller llega realmente a Moonraker');
  assert.match(PAIR,/printer\/objects\/query\?print_stats&extruder&webhooks/,'debe validar por el túnel la misma clase de consulta que alimenta telemetría');
  assert.match(PAIR,/--max-redirs 0/,'debe capturar la redirección local sin entregar la credencial a curl remoto');
  assert.match(PAIR,/Location:\[\[:space:\]\]\*/,'debe extraer la URL de pairing emitida por el Controller');
  assert.match(PAIR,/\$BASE\/farm\/session/,'debe validar que la credencial recién emitida sea aceptada');
  assert.match(PAIR,/open "\$LOCATION"/,'macOS debe abrir directamente la URL final validada');
  assert.doesNotMatch(PAIR,/open "\$PAIR_URL"/,'el navegador no debe depender de navegar primero al endpoint loopback');
  assert.doesNotMatch(PAIR,/\.bridge-token|cat .*token|pbcopy/,'el pairing no debe leer ni copiar el master token');
});


test('script de emparejamiento conserva sintaxis bash válida',()=>{
  const result=spawnSync('bash',['-n',path.join(ROOT,'printer-bridge','pair-dashboard.sh')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||'bash -n falló');
});


test('pairing autorepara cloudflared usando el servicio oficial de usuario',()=>{
  assert.match(PAIR,/repair_public_tunnel\(\)/);
  assert.match(PAIR,/cloudflared/);
  assert.match(PAIR,/\.cloudflared\/config\.yml/);
  assert.match(PAIR,/hostname: printers\.thelab\.solutions/);
  assert.ok(PAIR.includes("service:[[:space:]]*http://(localhost|127\\.0\\.0\\.1):8347"),'debe validar que el origen local sea :8347');
  assert.match(PAIR,/service install/,'debe usar el instalador oficial de cloudflared');
  assert.doesNotMatch(PAIR,/sudo\\s+cloudflared\\s+service\\s+install/,'config en HOME debe instalar LaunchAgent de usuario');
  assert.match(PAIR,/launchctl kickstart -k "\$label"/);
  assert.match(PAIR,/if repair_public_tunnel; then/,'un fallo público debe intentar recuperación antes de rendirse');
  assert.match(PAIR,/530\/1033/,'el mensaje debe distinguir la caída real del conector');
});
