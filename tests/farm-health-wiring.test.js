#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('macOS carga producción y observabilidad antes del controller',()=>{
  const plist=read('printer-bridge/com.thelab.farm-controller.plist');
  const prod=plist.indexOf('farm-production-preload.js');
  const health=plist.indexOf('farm-health-preload.js');
  const controller=plist.indexOf('farm-controller.js');
  assert.ok(prod>=0&&health>prod&&controller>health);
  assert.match(plist,/<string>-r<\/string>[\s\S]*farm-health-preload\.js/);
});

test('systemd carga ambos preloads antes del controller',()=>{
  const service=read('printer-bridge/farm-controller.service');
  const line=service.split('\n').find(x=>x.startsWith('ExecStart='))||'';
  assert.match(line,/farm-production-preload\.js/);
  assert.match(line,/farm-health-preload\.js/);
  assert.ok(line.indexOf('farm-production-preload.js')<line.indexOf('farm-health-preload.js'));
  assert.ok(line.indexOf('farm-health-preload.js')<line.lastIndexOf('farm-controller.js'));
});

test('dashboard carga FarmHealth desde bootstrap independiente',()=>{
  const storage=read('js/machineops-storage-adapter.js');
  assert.match(storage,/__TLS_FARM_HEALTH_LOADER__/);
  assert.match(storage,/js\/farm-health-adapter\.js/);
  assert.match(storage,/no se pudo cargar observabilidad central/);
});

test('rutas frontend y backend de observabilidad coinciden',()=>{
  const backend=read('printer-bridge/farm-health-preload.js');
  const frontend=read('js/farm-health-adapter.js');
  for(const route of ['/farm/health','/farm/health/probe','/farm/health/ack']){
    assert.ok(backend.includes(route),`backend debe contener ${route}`);
    assert.ok(frontend.includes(route),`frontend debe contener ${route}`);
  }
});
