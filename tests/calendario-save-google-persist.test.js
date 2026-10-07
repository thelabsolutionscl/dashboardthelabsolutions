#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const SRC=fs.readFileSync('js/calendario-base.js','utf8');

function body(name){
  const start=SRC.indexOf('async function '+name+'(');
  assert.ok(start>=0,'debe existir '+name);
  const open=SRC.indexOf('{',start); let d=0;
  for(let i=open;i<SRC.length;i++){
    if(SRC[i]==='{')d++;
    if(SRC[i]==='}'&&--d===0)return SRC.slice(start,i+1);
  }
  throw new Error('función sin cierre');
}

test('guardar evento intenta sincronizar Google de forma interactiva',()=>{
  const f=body('calSaveEvento');
  assert.match(f,/await _calGetToken\(\)/);
  assert.match(f,/await _calSyncEvento\(syncCopy\)/);
  assert.match(f,/_calWritebackSync\(arr,syncCopy\)/);
});
test('no confirma sincronización cuando Google falla',()=>{
  const f=body('calSaveEvento');
  assert.match(f,/pendiente de Google/);
  assert.match(f,/guardado y sincronizado con Google/);
  assert.ok(f.indexOf('guardado y sincronizado con Google')>f.indexOf('await _calSyncEvento(syncCopy)'));
});
test('autosync sigue siendo silencioso fuera de una acción explícita',()=>{
  const start=SRC.indexOf('async function _calAutoSync()');
  assert.ok(start>=0);
  assert.match(SRC.slice(start,start+900),/if\(!_calTokenVigente\(\)\)return/);
});
