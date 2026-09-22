#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','js','maquinas-farm-controller.js'),'utf8');

test('la integración usa cola durable y falla cerrado si Controller no confirma',()=>{
  assert.match(src,/window\._queueAdd=durableAdd/);
  assert.match(src,/window\._queueStartNext=durableStartNext/);
  assert.match(src,/\/farm\/queue/);
  assert.match(src,/No se creó una cola local de respaldo/);
  assert.doesNotMatch(src,/usando cola local/);
});

test('la cola durable propaga metadata a Farm Controller y MachineOps',()=>{
  assert.match(src,/async function durableAdd\(id,gcode,filename,secs,grams,meta=\{\}\)/);
  assert.match(src,/metadata/);
  assert.match(src,/MachineOps\?\.onLegacyQueueAdd/);
  assert.match(src,/idempotencyKey/);
  assert.match(src,/executionId\('upload'\)/);
  assert.doesNotMatch(src,/return original\.add\(/);
});

test('el registry compartido gana sobre overrides viejos del navegador',()=>{
  assert.match(src,/window\.getPrinterIp=durableGetPrinterIp/);
  const start=src.indexOf('function durableGetPrinterIp');
  const end=src.indexOf('\nasync function patchRegistryMachine',start);
  const fn=src.slice(start,end);
  assert.ok(fn.indexOf('registryById[m.id]')<fn.indexOf('confirmedPrinterIp(m.id)'),'registry debe evaluarse antes que IP confirmada local');
  assert.match(src,/if\(current\)continue/,'seed no debe pisar un registry existente con localStorage viejo');
  assert.match(src,/updateRegistryAfterManualSave/,'un cambio manual explícito sí actualiza registry');
  assert.match(src,/window\.FarmRegistry=/);
});

test('la capa conserva sincronización periódica de cola y registry',()=>{
  assert.match(src,/syncQueue\(false\)/);
  assert.match(src,/syncRegistry\(false\)/);
  assert.match(src,/addEventListener\('focus'/);
});


test('reimpresiones y cama libre pasan por Farm Controller',()=>{
  assert.match(src,/async function startExisting\(/);
  assert.match(src,/\/farm\/queue\/existing/);
  assert.match(src,/async function confirmBedClear\(/);
  assert.match(src,/\/farm\/ready\//);
  assert.match(src,/window\.FarmQueue=\{sync:syncQueue,startExisting,confirmBedClear/);
});

test('el registry comparte perfil físico además de IP e identidad',()=>{
  assert.match(src,/nozzleInstalled/);
  assert.match(src,/physicalProfile/);
  assert.match(src,/cfsInstalled/);
  assert.match(src,/cameraConfigured/);
});
