#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const SRC=fs.readFileSync(path.join(__dirname,'../js/calendario-base.js'),'utf8');
function fn(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\(');
  const m=re.exec(SRC);assert.ok(m,'missing '+name);
  const tail=SRC.slice(m.index+m[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return SRC.slice(m.index,next?m.index+m[0].length+next.index:SRC.length);
}
test('calendar shared sync no longer requires generic Monitor Sistema access or Airtable record IDs',()=>{
  const backup=fn('_calBackup'),poll=fn('_calPoll'),request=fn('_calSharedRequest');
  assert.match(request,/\/shared\/calendar/);
  assert.match(request,/credentials:\s*['"]include['"]/);
  assert.match(request,/X-App-Key/);
  for(const block of [backup,poll]){
    assert.doesNotMatch(block,/Monitor Sistema/);
    assert.doesNotMatch(block,/_monitorUpsert/);
    assert.doesNotMatch(block,/calRecordId/);
    assert.doesNotMatch(block,/_atFetch/);
  }
});
test('calendar PUT retries only a confirmed revision conflict and never blindly retries 5xx',()=>{
  const backup=fn('_calBackup');
  assert.match(backup,/attempt<2/);
  assert.match(backup,/r\.status===409/);
  assert.match(backup,/CALENDAR_REVISION_CONFLICT/);
  assert.match(backup,/return false; \/\/ timeout\/5xx\/resultado incierto/);
  assert.doesNotMatch(backup,/r\.status>=500[\s\S]{0,300}continue/);
});
test('calendar starts with an immediate remote read instead of waiting 20 seconds',()=>{
  const start=fn('startCalSync');
  assert.match(start,/_calPoll\(\)\.catch/);
  assert.match(start,/setInterval\(_calPoll,20000\)/);
});
test('calendar keeps local merge/tombstone behavior while transport moves server-side',()=>{
  const build=fn('_calBuildSharedData'),accept=fn('_calAcceptShared');
  assert.match(build,/_calMerge/);
  assert.match(build,/_calPrune/);
  assert.match(build,/_calCrmMetaMerge/);
  assert.match(accept,/_calReconcile/);
  assert.match(accept,/_calSharedRevision/);
});
