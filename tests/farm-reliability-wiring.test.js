#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('macOS carga confiabilidad después de health y antes del controller',()=>{
  const plist=read('printer-bridge/com.thelab.farm-controller.plist');
  const health=plist.indexOf('farm-health-preload.js');
  const reliability=plist.indexOf('farm-reliability-preload.js');
  const controller=plist.indexOf('farm-controller.js');
  assert.ok(health>=0&&reliability>health&&controller>reliability);
});

test('systemd carga confiabilidad después de health y antes del controller',()=>{
  const service=read('printer-bridge/farm-controller.service');
  const line=service.split('\n').find(x=>x.startsWith('ExecStart='))||'';
  assert.ok(line.indexOf('farm-health-preload.js')>=0);
  assert.ok(line.indexOf('farm-health-preload.js')<line.indexOf('farm-reliability-preload.js'));
  assert.ok(line.indexOf('farm-reliability-preload.js')<line.lastIndexOf('farm-controller.js'));
});

test('dashboard carga panel de confiabilidad desde bootstrap de UI',()=>{
  const client=read('js/farm-health-adapter.js');
  assert.match(client,/js\/farm-reliability-adapter\.js/);
  assert.match(client,/confiabilidad histórica de máquinas/);
});

test('frontend y backend usan la misma ruta',()=>{
  const backend=read('printer-bridge/farm-reliability-preload.js');
  const frontend=read('js/farm-reliability-adapter.js');
  assert.ok(backend.includes('/farm/reliability'));
  assert.ok(frontend.includes('/farm/reliability?days='));
});
