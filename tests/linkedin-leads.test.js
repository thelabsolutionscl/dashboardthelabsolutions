#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ROOT=path.join(__dirname,'..');
const LI=fs.readFileSync(path.join(ROOT,'js','linkedin.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','access-auth.js'),'utf8');

test('LinkedIn engine is loaded once inside dashboard bundle order',()=>{
  assert.equal((INDEX.match(/js\/linkedin\.js\?v=%%BUILD%%/g)||[]).length,1);
  assert.match(INDEX,/js\/redes\.js\?v=%%BUILD%%[\s\S]{0,100}js\/linkedin\.js\?v=%%BUILD%%/);
});

test('prospecting uses staging before CRM conversion',()=>{
  assert.match(LI,/LinkedIn_Prospects/);
  for(const state of ['Descubierto','Analizado','Calificado','Por contactar','Contactado','Respondió','Oportunidad','Cliente','Descartado'])
    assert.ok(LI.includes("'"+state+"'"),state);
  assert.match(LI,/'Origen lead':'LinkedIn'/);
  assert.match(LI,/'Etapa venta':'Lead nuevo'/);
  assert.match(LI,/Convertido:true/);
});

test('prospect conversion deduplicates before creating Clientes',()=>{
  assert.match(LI,/function findClient\(/);
  assert.match(LI,/String\(f\.Email/);
  assert.match(LI,/LinkedIn URL/);
  assert.match(LI,/String\(f\.Prospecto/);
  assert.match(LI,/wr\('Clientes','POST'/);
});

test('LINKEDIN_AGENT scores and drafts outreach',()=>{
  assert.match(LI,/callAgentClaude\('LINKEDIN'/);
  assert.match(LI,/SCORE_B2B/);
  assert.match(LI,/MENSAJE_LINKEDIN/);
  assert.match(LI,/FOLLOW_UP/);
  assert.match(LI,/IDENTIDAD_RECOMENDADA/);
});

test('personal outreach remains human initiated',()=>{
  assert.match(LI,/window\.open\('https:\/\/www\.linkedin\.com\/search\/results\//);
  assert.match(LI,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(LI,/fetch\([^\n]*linkedin\.com/i);
  assert.doesNotMatch(LI,/\/messagingApi|\/invitations|voyager\/api/i);
});

test('server-side access catalog explicitly recognizes prospect staging',()=>{
  assert.equal((ACCESS.match(/'LinkedIn_Prospects'/g)||[]).length,2);
  assert.match(INDEX,/socialWriteTables:[^\n]*LinkedIn_Prospects/);
});
