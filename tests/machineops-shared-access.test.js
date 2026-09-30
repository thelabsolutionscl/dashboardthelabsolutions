#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const ADAPTER=fs.readFileSync(path.join(ROOT,'js/machineops-storage-adapter.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js/maquinas-operaciones.js'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js/maquinas.js'),'utf8');
function block(src,name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\(');
  const m=re.exec(src);assert.ok(m,'missing '+name);
  const tail=src.slice(m.index+m[0].length),next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return src.slice(m.index,next?m.index+m[0].length+next.index:src.length);
}
test('adaptador usa /shared/machineops con cookie Access y no intercepta Airtable global',()=>{
  assert.match(ADAPTER,/\/shared\/machineops/);
  assert.match(ADAPTER,/credentials:\s*['"]include['"]/);
  assert.doesNotMatch(ADAPTER,/target\.airtableFetch\s*=/);
  assert.doesNotMatch(ADAPTER,/target\._monitorUpsert\s*=/);
  assert.doesNotMatch(ADAPTER,/originalFetch|originalUpsert/);
});
test('sync principal de MachineOps depende de MachineOpsStorage y no de Monitor Sistema',()=>{
  const save=block(OPS,'saveRemote'),load=block(OPS,'loadRemote');
  assert.match(save,/MachineOpsStorage\?\.writeSnapshot/);
  assert.match(load,/MachineOpsStorage\?\.readSnapshot/);
  for(const src of [save,load]){
    assert.doesNotMatch(src,/airtableFetch/);
    assert.doesNotMatch(src,/_monitorUpsert/);
    assert.doesNotMatch(src,/Monitor Sistema/);
  }
});
test('historial de nivelación usa el mismo límite dedicado y no record ids Airtable',()=>{
  const read=block(MAQ,'_bedLevelHistoryFetchRemote'),write=block(MAQ,'_bedLevelHistorySyncRemote');
  assert.match(read,/MachineOpsStorage\?\.readRecord/);
  assert.match(write,/MachineOpsStorage\?\.writeRecord/);
  for(const src of [read,write]){
    assert.doesNotMatch(src,/airtableFetch|_monitorUpsert|bedLevelHistoryV2RecordId|Monitor Sistema/);
  }
  assert.match(write,/if\(!saved\)continue/,'solo un 409 confirmado puede rebasarse');
});
test('configuración de automatización y costos exige permiso de configuración local',()=>{
  const save=block(OPS,'saveIntelligenceConfig');
  assert.match(save,/RBAC\.canConfigRole/);
  assert.match(save,/Solo administración puede cambiar automatización y costos de MachineOps/);
  assert.ok(save.indexOf('canConfigRole')<save.indexOf('data().automation'),'el guard debe ejecutarse antes de mutar');
});
