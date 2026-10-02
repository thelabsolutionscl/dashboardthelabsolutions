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


const WORKER=fs.readFileSync(path.join(ROOT,'lead-worker','src','index.js'),'utf8');

test('LinkedIn webhook requires its own secret and never falls back to the public lead key',()=>{
  const start=WORKER.indexOf('async function handleLinkedin');
  const end=WORKER.indexOf('async function syncLinkedinInboundProspect',start);
  const fn=WORKER.slice(start,end);
  assert.match(fn,/X-Linkedin-Webhook-Key/);
  assert.match(fn,/LINKEDIN_WEBHOOK_KEY/);
  assert.doesNotMatch(fn,/X-Public-Lead-Key/);
  assert.doesNotMatch(fn,/PUBLIC_LEAD_KEY/);
  assert.match(fn,/Webhook LinkedIn no configurado/);
});

test('inbound LinkedIn uses canonical CRM origin and staging/idempotency metadata',()=>{
  assert.match(WORKER,/const ORIGEN_LABEL = \{ web: "Web", linkedin: "LinkedIn" \}/);
  assert.match(WORKER,/linkedinLeadId/);
  assert.match(WORKER,/linkedin:webhook:/);
  assert.match(WORKER,/syncLinkedinInboundProspect/);
  assert.match(WORKER,/"LinkedIn_Prospects"/);
  assert.match(WORKER,/"Etapa venta": source === "linkedin" \? "Lead nuevo"/);
  assert.match(WORKER,/"LinkedIn URL": source === "linkedin" \? norm\.linkedinUrl/);
});

test('outbound normalizes LinkedIn URLs and deduplicates by profile, email and phone',()=>{
  assert.match(LI,/function canonicalLinkedinUrl\(/);
  assert.match(LI,/u\.search|new URL\(/);
  assert.match(LI,/normPhone/);
  assert.match(LI,/canonicalLinkedinUrl\(x\['LinkedIn URL'\]\)/);
  assert.match(LI,/normPhone\(x\['Teléfono'\]\)/);
});

test('funnel exposes real transitions and follow-up actions',()=>{
  for(const fn of ['linkedinQueueForContact','linkedinMarkContacted','linkedinMarkReplied','linkedinMarkOpportunity','linkedinDiscard','linkedinCopyFollowup'])
    assert.match(LI,new RegExp('function\\s+'+fn+'\\s*\\('),fn);
  assert.match(LI,/CONVERTIBLE_STATES/);
  assert.match(LI,/Primero califica el prospecto antes de pasarlo a Clientes/);
  assert.match(LI,/Próximo seguimiento/);
  assert.match(LI,/VENCIDO/);
});

test('conversion and analysis have in-flight guards against repeated clicks',()=>{
  assert.match(LI,/analyzeBusy=new Set\(\)/);
  assert.match(LI,/convertBusy=new Set\(\)/);
  assert.match(LI,/statusBusy=new Set\(\)/);
  assert.match(LI,/convertBusy\.has\(id\)/);
  assert.match(LI,/f\.Convertido&&Array\.isArray\(f\.Cliente\)/);
});
