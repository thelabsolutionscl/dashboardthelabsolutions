#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const MAIL=fs.readFileSync(path.join(__dirname,'../js/correo.js'),'utf8');
const SHARED=fs.readFileSync(path.join(__dirname,'../js/correo-shared-features.js'),'utf8');
const OPS=fs.readFileSync(path.join(__dirname,'../js/operativo-secciones.js'),'utf8');
function method(name){
  const re=new RegExp('\\n\\s{2}(?:async\\s+)?'+name.replace(/[$]/g,'\\$&')+'\\s*\\([^)]*\\)\\s*\\{');
  const m=re.exec(MAIL);assert.ok(m,'missing MAIL.'+name);
  const tail=MAIL.slice(m.index+m[0].length);
  const next=/\n\s{2}(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.exec(tail);
  return MAIL.slice(m.index,next?m.index+m[0].length+next.index:MAIL.length);
}
test('mailbox metadata uses /shared/mail with Access cookie and no generic monitor write',()=>{
  const req=method('_sharedMailRequest');
  assert.match(req,/\/shared\/mail\?/);
  assert.match(req,/credentials:\s*['"]include['"]/);
  assert.match(req,/X-App-Key/);
  for(const name of ['_saveSigsAirtable','_saveSentAddrsAirtable']){
    const block=method(name);
    assert.match(block,/_writeSharedMail/);
    assert.doesNotMatch(block,/_monitorUpsert|Monitor Sistema|mailSigsRecordId|mailSentRecordId/);
  }
});
test('mailbox hydration reads signature and sent-addresses separately for the active account',()=>{
  const block=method('_hydrateSharedMailboxState');
  assert.match(block,/_readSharedMail\(['"]signature['"]/);
  assert.match(block,/_readSharedMail\(['"]sent-addresses['"]/);
  assert.match(block,/thelab_mail_sig_/);
  assert.match(block,/thelab_mail_sent_/);
});
test('mailbox writes retry only a confirmed revision conflict and never blind-retry 5xx',()=>{
  const block=method('_writeSharedMail');
  assert.match(block,/attempt<2/);
  assert.match(block,/r\.status===409/);
  assert.match(block,/MAIL_REVISION_CONFLICT/);
  assert.match(block,/return false; \/\/ timeout\/5xx\/resultado incierto/);
  assert.doesNotMatch(block,/r\.status>=500[\s\S]{0,240}continue/);
});
test('shared templates no longer call Airtable or _monitorUpsert from the browser',()=>{
  assert.match(SHARED,/\/shared\/mail\?resource=templates/);
  assert.match(SHARED,/credentials:\s*['"]include['"]/);
  assert.doesNotMatch(SHARED,/airtableFetch\(['"]Monitor Sistema['"]/);
  assert.doesNotMatch(SHARED,/_monitorUpsert\s*\(/);
  assert.match(SHARED,/MAIL_REVISION_CONFLICT/);
  assert.match(SHARED,/rebaseTemplateDelta/);
});
test('generic Monitor Sistema hydration filters every mail record already migrated',()=>{
  for(const name of ['MAIL_SIGNATURES','MAIL_SENT_ADDRESSES','MAIL_TEMPLATES'])
    assert.match(OPS,new RegExp("'"+name+"'"));
  assert.match(OPS,/scopedNames\.has\(r\?\.fields\?\.Name\)/);
});
