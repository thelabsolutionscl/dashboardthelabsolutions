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
  assert.match(f,/await _calGetToken\(\)/,'renueva OAuth desde la acción de guardar');
  assert.match(f,/await _calSyncEvento\(syncCopy\)/,'publica el evento antes de confirmar sync');
  assert.match(f,/_calWritebackSync\(arr,syncCopy\)/,'persiste googleEventId en el evento manual');
});

test('no confirma sincronización cuando Google falla',()=>{
  const f=body('calSaveEvento');
  assert.match(f,/pendiente de Google/);
  assert.match(f,/guardado y sincronizado con Google/);
  const success=f.indexOf("guardado y sincronizado con Google");
  const api=f.indexOf('await _calSyncEvento(syncCopy)');
  assert.ok(success>api,'éxito sólo aparece después del intento Google');
});

test('autosync sigue siendo silencioso fuera de una acción explícita',()=>{
  const start=SRC.indexOf('async function _calAutoSync()');
  assert.ok(start>=0);
  const chunk=SRC.slice(start,start+900);
  assert.match(chunk,/if\(!_calTokenVigente\(\)\)return/);
});
