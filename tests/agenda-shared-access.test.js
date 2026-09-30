#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const SRC=fs.readFileSync(path.join(__dirname,'../js/operativo-secciones.js'),'utf8');
function fn(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\(');
  const m=re.exec(SRC);assert.ok(m,'missing '+name);
  const tail=SRC.slice(m.index+m[0].length);
  const next=/\n\s*(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return SRC.slice(m.index,next?m.index+m[0].length+next.index:SRC.length);
}
test('agenda shared transport uses the dedicated scoped route with the Access cookie',()=>{
  const request=fn('request');
  assert.match(request,/\/shared\/agenda\?scope=/);
  assert.match(request,/credentials:\s*['"]include['"]/);
  assert.match(request,/X-App-Key/);
});
test('agenda backup and poll no longer use generic Monitor Sistema or Airtable record IDs',()=>{
  const backup=fn('agendaBackupScoped'),poll=fn('agendaPollScoped');
  for(const block of [backup,poll]){
    assert.doesNotMatch(block,/_monitorUpsert\s*\(/);
    assert.doesNotMatch(block,/agendaRecordId/);
    assert.doesNotMatch(block,/_atFetch\s*\(/);
    assert.doesNotMatch(block,/Monitor Sistema/);
  }
});
test('agenda retries only a confirmed scoped revision conflict',()=>{
  const backup=fn('agendaBackupScoped');
  assert.match(backup,/attempt<2/);
  assert.match(backup,/r\.status===409/);
  assert.match(backup,/AGENDA_REVISION_CONFLICT/);
  assert.match(backup,/return false; \/\/ timeout\/5xx\/resultado incierto/);
  assert.doesNotMatch(backup,/r\.status>=500[\s\S]{0,300}continue/);
});
test('agenda starts with an immediate scoped read and keeps the 15 second poll',()=>{
  const start=fn('startAgendaScopedSync');
  assert.match(start,/agendaPollScoped\(\)\.catch/);
  assert.match(start,/setInterval\(agendaPollScoped,15000\)/);
});
test('generic Monitor Sistema hydration explicitly filters AGENDA',()=>{
  assert.match(SRC,/global\._applyMonitorSistema=function agendaMonitorFiltered/);
  assert.match(SRC,/scopedNames=new Set\(\[[^\]]*['"]AGENDA['"]/);
  assert.match(SRC,/scopedNames\.has\(r\?\.fields\?\.Name\)/);
  assert.match(SRC,/global\._agendaBackup=agendaBackupScoped/);
  assert.match(SRC,/global\.startAgendaSync=startAgendaScopedSync/);
});
test('scoped adapter preserves the existing merge, prune and reconciliation semantics',()=>{
  const build=fn('build'),accept=fn('accept');
  assert.match(build,/_agendaMerge/);
  assert.match(build,/_agendaPrune/);
  assert.match(accept,/_agendaReconcile/);
});
