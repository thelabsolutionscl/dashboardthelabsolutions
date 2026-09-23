#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const INDEX=fs.readFileSync('index.html','utf8');
const CAL=fs.readFileSync('js/calendario-base.js','utf8');

test('barra de Calendario distingue Google Calendar de Drive',()=>{
  assert.match(INDEX,/id="calGoogleBtn"[^>]*>🔗 Conectar Google Calendar<\/button>/);
  assert.match(INDEX,/id="calSyncBtn"[^>]*>⇅ Sincronizar calendario<\/button>/);
  assert.doesNotMatch(INDEX,/calGoogleConnect\(\)"[^>]*>🔗 Conectar Google<\/button>/);
});

test('estado conectado cambia el botón a Google Calendar conectado',()=>{
  assert.match(CAL,/connect\.textContent=gOK\?'🟢 Google Calendar conectado':'🔗 Conectar Google Calendar'/);
  assert.match(CAL,/Google Calendar sin conectar/);
  assert.match(CAL,/connect\.style\.color=gOK\?'var\(--accent3\)'/);
});

test('sincronización muestra pendientes y estado al día sin perder estado busy',()=>{
  assert.match(CAL,/sync\.dataset\.syncBusy!=='1'/);
  assert.match(CAL,/sync\.textContent='✓ Sincronizado'/);
  assert.match(CAL,/⇅ Sincronizar calendario \(\$\{pend\}\)/);
  assert.match(CAL,/btn\.dataset\.syncBusy='1'/);
  assert.match(CAL,/btn\.dataset\.syncBusy='0'/);
});


test('Tauri evita OAuth GIS embebido y usa el comando nativo',()=>{
  assert.match(CAL,/function _calIsDesktopMac\(\)/);
  assert.match(CAL,/if\(_calIsDesktopMac\(\)\)return _calGetDesktopToken\(\)/);
  assert.match(CAL,/window\.__TAURI__\?\.core\?\.invoke/);
  assert.match(CAL,/invoke\('google_calendar_oauth',\{clientId:cid\}\)/);
  assert.match(CAL,/google_desktop_client_id/);
  assert.match(CAL,/Actualiza\/reinstala la app macOS 1\.2\.0/);
  const nativeBranch=CAL.indexOf("if(_calIsDesktopMac())return _calGetDesktopToken()");
  const gisBranch=CAL.indexOf("google.accounts.oauth2.initTokenClient");
  assert.ok(nativeBranch>=0&&gisBranch>nativeBranch,'el flujo nativo debe cortar antes de abrir GIS dentro de WKWebView');
});

test('el navegador web conserva GIS y la app explica que autoriza en el navegador del sistema',()=>{
  assert.match(CAL,/google\.accounts\.oauth2\.initTokenClient/);
  assert.match(CAL,/navegador del sistema \(modo seguro macOS\)/);
  assert.match(CAL,/Macintosh/);
  assert.match(CAL,/AppleWebKit/);
});
