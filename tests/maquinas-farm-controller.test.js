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

test('el registry pasa a ser la fuente preferida de IP y se actualiza al guardar manualmente',()=>{
  assert.match(src,/window\.getPrinterIp=durableGetPrinterIp/);
  assert.match(src,/registryById\[m\.id\]/);
  assert.match(src,/updateRegistryAfterManualSave/);
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

test('el registry comparte boquilla instalada además de IP e identidad',()=>{
  assert.match(src,/nozzleInstalled/);
});
