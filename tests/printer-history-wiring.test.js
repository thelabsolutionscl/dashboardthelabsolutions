#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const storage=fs.readFileSync(path.join(ROOT,'js','machineops-storage-adapter.js'),'utf8');
const adapter=fs.readFileSync(path.join(ROOT,'js','printer-history-adapter.js'),'utf8');
const preload=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-production-preload.js'),'utf8');
const plist=fs.readFileSync(path.join(ROOT,'printer-bridge','com.thelab.farm-controller.plist'),'utf8');
const service=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.service'),'utf8');

test('el adaptador de historial se carga desde el bootstrap vigente',()=>{
  assert.match(storage,/js\/printer-history-adapter\.js/);
  assert.match(storage,/js\/machineops-unattended-safety\.js/);
});

test('macOS carga el production preload antes del Farm Controller',()=>{
  const preloadAt=plist.indexOf('farm-production-preload.js');
  const controllerAt=plist.indexOf('farm-controller.js');
  assert.ok(plist.includes('<string>-r</string>'),'LaunchAgent debe usar node -r');
  assert.ok(preloadAt>=0&&controllerAt>preloadAt,'preload debe anteceder al controller');
});

test('systemd carga el production preload antes del Farm Controller',()=>{
  assert.match(service,/ExecStart=.*node -r .*farm-production-preload\.js .*farm-controller\.js/);
});

test('browser y preload comparten las tres rutas de producción',()=>{
  for(const route of ['/farm/production','/farm/production/migrate','/farm/production/events']){
    assert.ok(adapter.includes(route),`adapter no usa ${route}`);
    assert.ok(preload.includes(route),`preload no atiende ${route}`);
  }
});

test('localStorage queda sólo como caché/fallback, no como única fuente',()=>{
  assert.match(adapter,/mode:controllerOk===true\?'durable'/);
  assert.match(adapter,/local-fallback/);
  assert.match(adapter,/applyProduction/);
});
