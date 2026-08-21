#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','js','maquinas-farm-controller.js'),'utf8');

test('la integración reemplaza la cola en memoria por la cola durable con fallback',()=>{
  assert.match(src,/window\._queueAdd=durableAdd/);
  assert.match(src,/window\._queueStartNext=durableStartNext/);
  assert.match(src,/\/farm\/queue/);
  assert.match(src,/usando cola local/);
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
