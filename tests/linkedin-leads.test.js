#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ROOT=path.join(__dirname,'..');
const LI=fs.readFileSync(path.join(ROOT,'js','linkedin.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','access-auth.js'),'utf8');
const PROXY=fs.readFileSync(path.join(ROOT,'airtable-proxy','src','worker.js'),'utf8');

test('LinkedIn engine is loaded once inside dashboard bundle order',()=>{
  assert.equal((INDEX.match(/js\/linkedin\.js\?v=%%BUILD%%/g)||[]).length,1);
  assert.match(INDEX,/js\/redes\.js\?v=%%BUILD%%[\s\S]{0,100}js\/linkedin\.js\?v=%%BUILD%%/);
});

test('prospecting uses staging and protected server conversion',()=>{
  assert.match(LI,/LinkedIn_Prospects/);
  for(const state of ['Descubierto','Analizado','Calificado','Por contactar','Contactado','Respondió','Oportunidad','Cliente','Descartado'])
    assert.ok(LI.includes("'"+state+"'"),state);
  assert.match(LI,/linkedinApi\('\/linkedin\/command','POST'/);
  assert.match(PROXY,/'Origen lead':'LinkedIn'/);
  assert.match(PROXY,/'Etapa venta':'Lead nuevo'/);
  assert.match(PROXY,/Convertido:true/);
});

test('prospect conversion deduplicates server-side before creating Clientes',()=>{
  assert.doesNotMatch(LI,/function findClient\(/);
  assert.doesNotMatch(LI,/wr\('Clientes','POST'/);
  assert.match(PROXY,/function liClientMatches\(/);
  assert.match(PROXY,/liEmail\(p\.Email\)/);
  assert.match(PROXY,/liUrl\(p\['LinkedIn URL'\]\)/);
  assert.match(PROXY,/liPhone\(p\['Teléfono'\]\)/);
  assert.match(PROXY,/clients\.find\(r=>liClientMatches/);
  assert.match(PROXY,/liMutate\(this\.env,'Clientes','POST'/);
});

test('LINKEDIN_AGENT scores and drafts outreach server-side',()=>{
  assert.doesNotMatch(LI,/callAgentClaude\('LINKEDIN'/);
  assert.match(LI,/action:'analyze'/);
  assert.match(PROXY,/function liRunAgentAnalysis\(/);
  assert.match(PROXY,/score_b2b/);
  assert.match(PROXY,/mensaje_linkedin/);
  assert.match(PROXY,/follow_up/);
  assert.match(PROXY,/identidad_recomendada/);
  assert.match(PROXY,/reserveAiBudget\(env,payload,'linkedin-agent'\)/);
});

test('personal outreach remains human initiated',()=>{
  assert.match(LI,/window\.open\('https:\/\/www\.linkedin\.com\/search\/results\//);
  assert.match(LI,/navigator\.clipboard\.writeText/);
  assert.doesNotMatch(LI,/fetch\([^\n]*linkedin\.com/i);
  assert.doesNotMatch(LI,/\/messagingApi|\/invitations|voyager\/api/i);
});

test('server-side access catalog recognizes staging/events while LinkedIn uses dedicated RBAC routes',()=>{
  assert.ok((ACCESS.match(/'LinkedIn_Prospects'/g)||[]).length>=2);
  assert.ok((ACCESS.match(/'LinkedIn_Events'/g)||[]).length>=2);
  assert.match(ACCESS,/path\.startsWith\('\/linkedin\/'\)/);
  assert.match(ACCESS,/path==='\/linkedin\/prospects'/);
  assert.match(ACCESS,/path==='\/linkedin\/metrics'/);
  assert.match(ACCESS,/path==='\/linkedin\/command'/);
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
  assert.match(PROXY,/linkedin:convert:/);
});


test('funnel rejects impossible transitions and re-analysis does not regress active stages',()=>{
  assert.match(LI,/function stateAllowed\(/);
  assert.match(LI,/stateAllowed\(id,\['Calificado'\],'pasar a Por contactar'\)/);
  assert.match(LI,/stateAllowed\(id,\['Contactado'\],'marcar como Respondió'\)/);
  assert.match(LI,/stateAllowed\(id,\['Respondió'\],'marcar como Oportunidad'\)/);
  assert.match(PROXY,/fields\.Estado=\['Descubierto','Analizado','Calificado'\]\.includes\(oldState\)/);
  assert.match(PROXY,/allowedFrom=\{/);
});

test('short phone fragments are not used as dedupe identifiers',()=>{
  assert.match(LI,/d\.length>=9\?d\.slice\(-9\):''/);
  assert.match(WORKER,/phoneDigitsRaw\.length >= 9 \? phoneDigitsRaw\.slice\(-9\) : ""/);
});

test('webhook idempotency uses the real LinkedIn lead id, not click attribution',()=>{
  const start=WORKER.indexOf('async function handleLinkedin');
  const end=WORKER.indexOf('async function syncLinkedinInboundProspect',start);
  const fn=WORKER.slice(start,end);
  assert.match(fn,/const eventId = norm\.linkedinLeadId;/);
  assert.doesNotMatch(fn,/const eventId = norm\.linkedinLeadId \|\| norm\.linkedinClickId/);
});


test('browser never performs direct LinkedIn/CRM persistence anymore',()=>{
  assert.match(LI,/linkedinApi\('\/linkedin\/prospects','GET'\)/);
  assert.match(LI,/linkedinApi\('\/linkedin\/metrics','GET'\)/);
  assert.match(LI,/action:'convert'/);
  assert.doesNotMatch(LI,/await\s+wr\(/);
  assert.doesNotMatch(LI,/airtableFetch\(TABLE/);
  assert.doesNotMatch(LI,/airtableFetch\('Clientes'/);
});

test('server serializes LinkedIn commands in the same global CRM Durable Object',()=>{
  assert.match(PROXY,/path==='\/linkedin-command'/);
  assert.match(PROXY,/_handleLinkedinCommand\(request\)/);
  assert.match(PROXY,/idFromName\('tls-crm-global'\)/);
  assert.match(PROXY,/linkedin:convert:/);
  assert.match(PROXY,/LINKEDIN_CONVERSION_PENDING_RECONCILIATION/);
  assert.match(PROXY,/this\.state\.storage\.put\(key/);
});

test('LinkedIn metrics use event history and non-causal post-LinkedIn revenue labeling',()=>{
  assert.match(PROXY,/LinkedIn_Events/);
  assert.match(PROXY,/avg_response_hours/);
  assert.match(PROXY,/median_response_hours/);
  assert.match(PROXY,/revenue_net_after_linkedin/);
  assert.match(PROXY,/Monto total \(CLP\)/);
  assert.match(PROXY,/\/1\.19/);
  assert.match(LI,/Contacto → respuesta/);
  assert.match(LI,/Revenue neto posterior/);
  assert.match(LI,/no implica causalidad/);
});

test('official Lead Sync verifies challenge, raw-body signature and notification dedupe',()=>{
  assert.match(WORKER,/\/webhooks\/linkedin\/official/);
  assert.match(WORKER,/hmacHex\(secret, challengeCode\)/);
  assert.match(WORKER,/request\.headers\.get\("X-LI-Signature"\)/);
  assert.match(WORKER,/hmacHex\(secret, "hmacsha256=" \+ raw\)/);
  assert.match(WORKER,/linkedin:official:/);
  assert.match(WORKER,/notification\.leadGenFormResponse/);
  assert.match(WORKER,/notification\.occurredAt/);
  assert.match(WORKER,/fetchLinkedinLeadResponse/);
  assert.match(WORKER,/r_marketing_leadgen_automation|Lead Sync/);
});

test('official Lead Sync can manage subscriptions and refresh OAuth tokens',()=>{
  assert.match(WORKER,/\/linkedin\/subscriptions/);
  assert.match(WORKER,/X-Linkedin-Admin-Key/);
  assert.match(WORKER,/https:\/\/api\.linkedin\.com\/rest\/leadNotifications/);
  assert.match(WORKER,/grant_type: "refresh_token"/);
  assert.match(WORKER,/LINKEDIN_REFRESH_TOKEN/);
  assert.match(WORKER,/LINKEDIN_API_VERSION \|\| "202609"/);
});

test('prospect edits can intentionally clear optional fields without bypassing validation',()=>{
  assert.match(PROXY,/function liProspectEdit\(/);
  assert.match(PROXY,/patch\[key\]=value\|\|null/);
  assert.match(PROXY,/!liText\(merged\.Prospecto,500\)&&!liText\(merged\.Empresa,500\)/);
  assert.match(PROXY,/liDuplicate\(edit\.merged/);
});
