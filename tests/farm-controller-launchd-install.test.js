#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const SCRIPT=fs.readFileSync(path.join(ROOT,'printer-bridge','install-farm-controller.sh'),'utf8');

test('instalador valida el plist antes de registrarlo',()=>{
  assert.match(SCRIPT,/plutil -lint "\$PLIST"/);
});

test('instalador limpia y rehabilita estados stale o disabled antes de bootstrap',()=>{
  assert.match(SCRIPT,/launchctl remove "\$LABEL"/);
  assert.match(SCRIPT,/launchctl enable "\$UID_GUI\/\$LABEL"/);
  assert.match(SCRIPT,/if launchctl bootstrap "\$UID_GUI" "\$PLIST"/);
  assert.match(SCRIPT,/bootstrap inicial rechazado/);
});

test('instalador no usa sudo para el LaunchAgent de la sesión gráfica',()=>{
  assert.doesNotMatch(SCRIPT,/sudo\s+launchctl/);
});


test('instalador cae a proceso directo si launchd rechaza bootstrap y load',()=>{
  assert.match(SCRIPT,/launchctl load -w "\$PLIST"/,'intenta compatibilidad legacy antes del fallback');
  assert.match(SCRIPT,/start_direct_fallback\(\)/);
  assert.match(SCRIPT,/nohup "\$NODE"/);
  assert.match(SCRIPT,/FARM_DATA_DIR="\$DATA"/);
  assert.match(SCRIPT,/BRIDGE_REPO_DIR="\$REPO"/);
  assert.match(SCRIPT,/farm-controller\.pid/);
  assert.match(SCRIPT,/modo directo de contingencia/);
});

test('instalador conserva sintaxis bash válida',()=>{
  const result=spawnSync('bash',['-n',path.join(ROOT,'printer-bridge','install-farm-controller.sh')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||'bash -n falló');
});


test('instalador elimina sólo un bridge interno huérfano antes de levantar el Controller',()=>{
  assert.match(SCRIPT,/INTERNAL_PORT="\$\{LEGACY_BRIDGE_PORT:-8348\}"/);
  assert.match(SCRIPT,/cleanup_stale_internal_bridge\(\)/);
  assert.match(SCRIPT,/lsof[^\n]*-tiTCP:"\$INTERNAL_PORT"[^\n]*-sTCP:LISTEN/);
  assert.match(SCRIPT,/\$HERE\/server\.js/,'sólo puede matar el server.js conocido');
  assert.match(SCRIPT,/kill -9 "\$pid"/,'si el bridge huérfano no termina, fuerza sólo ese PID validado');
  assert.match(SCRIPT,/legacyReady":true/,'la instalación no debe declarar salud si el bridge hijo no acepta el token actual');
});
