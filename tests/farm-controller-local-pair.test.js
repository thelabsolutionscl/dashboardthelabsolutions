#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

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
  assert.match(MAQ,/return paired\|\|local\|\|d/,'el dispositivo emparejado debe ganar a secretos legacy');
});

test('script de emparejamiento valida el Controller, se autorepara y abre la URL final',()=>{
  assert.match(PAIR,/http:\/\/127\.0\.0\.1:\$\{PORT\}\/farm\/local-pair/);
  assert.match(PAIR,/'"service":"farm-controller"'/,'no basta con que cualquier proceso responda healthz');
  assert.match(PAIR,/install-farm-controller\.sh/,'debe reparar launchd si 8347 sirve el proceso equivocado o stale');
  assert.match(PAIR,/--max-redirs 0/,'debe capturar la redirección local sin entregar la credencial a curl remoto');
  assert.match(PAIR,/Location:\[\[:space:\]\]\*/,'debe extraer la URL de pairing emitida por el Controller');
  assert.match(PAIR,/\$BASE\/farm\/session/,'debe validar que la credencial recién emitida sea aceptada');
  assert.match(PAIR,/open "\$LOCATION"/,'macOS debe abrir directamente la URL final validada');
  assert.doesNotMatch(PAIR,/open "\$PAIR_URL"/,'el navegador no debe depender de navegar primero al endpoint loopback');
  assert.doesNotMatch(PAIR,/\.bridge-token|cat .*token|pbcopy/,'el pairing no debe leer ni copiar el master token');
});
