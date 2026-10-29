#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const WORKER=fs.readFileSync(path.join(ROOT,'lead-worker/src/index.js'),'utf8');
const PROXY=fs.readFileSync(path.join(ROOT,'airtable-proxy/src/worker.js'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'airtable-proxy/src/access-auth.js'),'utf8');

function block(src,start,end){
  const i=src.indexOf(start);assert.ok(i>=0,'missing '+start);
  const j=end?src.indexOf(end,i+start.length):src.length;assert.ok(j>i,'missing end '+end);
  return src.slice(i,j);
}

test('el webhook social usa una instancia estable por red + external_event_id',()=>{
  const h=block(WORKER,'async function handleSocial(','function normalizeSocial');
  assert.match(h,/SOCIAL_EVENT_GUARD/);
  assert.match(h,/idFromName\(eventKey\)/);
  assert.match(h,/social\.red\+":"\+social\.externalEventId/);
});

test('SocialEventGuard persiste resultado y replay para el mismo evento',()=>{
  const g=block(WORKER,'export class SocialEventGuard','/* ════════════════════════════════════════════════════════════════════════\n * NÚCLEO: crear Cliente');
  assert.match(g,/storage\.get\("result"\)/);
  assert.match(g,/storage\.put\("result",result\)/);
  assert.match(g,/replayed:true/);
});

test('la publicación exige reserva, lease e idempotency key antes del commit',()=>{
  const reserve=block(WORKER,'async function handleSocialPublishReserve(','async function handleSocialPublish(');
  const publish=block(WORKER,'async function handleSocialPublish(','/* ════════════════════════════════════════════════════════════════════════\n * NÚCLEO: crear Cliente');
  const guard=block(WORKER,'export class SocialEventGuard','/* ════════════════════════════════════════════════════════════════════════\n * NÚCLEO: crear Cliente');
  assert.match(reserve,/Estado!=="Programado"/);
  assert.match(reserve,/approval\?\.status!=="approved"/);
  assert.match(reserve,/Idempotency key/);
  assert.match(reserve,/publish-reserve/);
  assert.match(guard,/publish-lease/);
  assert.match(guard,/10\*60\*1000/);
  assert.match(guard,/SOCIAL_PUBLISH_LOCKED/);
  assert.match(publish,/publish-commit/);
  assert.match(publish,/external_post_id/);
  assert.match(publish,/permalink HTTPS/);
});

test('la cola de publicación solo entrega posts aprobados y vencidos, con la media que Instagram acepta',()=>{
  const src=block(WORKER,'const SOCIAL_PUBLISH_MAX_DELAY_MS','async function handleSocialPublishDue(');
  const candidate=new Function(`${src}\nreturn socialPublishCandidate;`)();
  const now=Date.parse('2026-11-02T22:10:00Z'),H=3600*1000;
  const approved=JSON.stringify({status:'approved',approvedBy:'gustavo'});
  const post=(over={})=>({id:'recAAAAAAAAAAAAAA',fields:{Estado:'Programado','Aprobación editorial':approved,
    'Idempotency key':'social-post/recAAAAAAAAAAAAAA','Fecha programada':new Date(now-5*60*1000).toISOString(),
    'Media URL':'https://cdn.thelab.solutions/neon.jpg',Copy:'Neón listo ✨\n"OPEN"',Hashtags:'#neon #santiago',...over}});

  const ok=candidate(post(),now).post;
  assert.equal(ok.media_kind,'photo');
  assert.equal(ok.idempotency_key,'social-post/recAAAAAAAAAAAAAA');
  assert.equal(ok.caption,'Neón listo ✨\n"OPEN"\n\n#neon #santiago');
  assert.equal(candidate(post({'Media URL':'https://cdn.thelab.solutions/timelapse.MP4'}),now).post.media_kind,'reel');
  assert.equal(candidate(post({'Media URL':'https://v5.airtableusercontent.com/abc?x=1'}),now).post.media_kind,'photo');

  // Nada sin aprobación humana, futuro, ya publicado o ya marcado con error.
  assert.deepEqual(candidate(post({'Aprobación editorial':''}),now),{skip:true});
  assert.deepEqual(candidate(post({'Aprobación editorial':JSON.stringify({status:'pending_review'})}),now),{skip:true});
  assert.deepEqual(candidate(post({'Idempotency key':'social-post/recBBBBBBBBBBBBBB'}),now),{skip:true});
  assert.deepEqual(candidate(post({'Fecha programada':new Date(now+H).toISOString()}),now),{skip:true});
  assert.deepEqual(candidate(post({'External Post ID':'1789'}),now),{skip:true});
  assert.deepEqual(candidate(post({'Estado transporte':'Error'}),now),{skip:true});
  // Reservado sin confirmar: nunca se reentrega solo (a lo más una publicación).
  assert.deepEqual(candidate(post({'Estado transporte':'Publicando'}),now),{skip:true});
  assert.deepEqual(candidate(post({Estado:'Publicado'}),now),{skip:true});

  // Lo que Instagram rechazaría se marca como error en vez de intentarse.
  assert.match(candidate(post({'Fecha programada':new Date(now-49*H).toISOString()}),now).error,/48 h/);
  assert.match(candidate(post({'Media URL':''}),now).error,/JPG/);
  assert.match(candidate(post({'Media URL':'https://cdn.thelab.solutions/neon.png'}),now).error,/JPG/);
  assert.match(candidate(post({'Media URL':'http://cdn.thelab.solutions/neon.jpg'}),now).error,/HTTPS/);
  assert.match(candidate(post({Copy:'x'.repeat(2190)}),now).error,/2200/);
  assert.match(candidate(post({Hashtags:Array.from({length:31},(_,i)=>'#t'+i).join(' ')}),now).error,/hashtags; Instagram admite 30/);
});

test('la cola de publicación usa la clave social y no reintenta errores',()=>{
  const due=block(WORKER,'async function handleSocialPublishDue(','async function handleSocialPublish(');
  assert.match(WORKER,/url\.pathname === "\/webhooks\/social\/publish\/due"/);
  assert.match(due,/socialAuth\(request,env\)/);
  assert.match(due,/NOT\(\{Estado transporte\}='Error'\)/);
  assert.match(due,/NOT\(\{Estado transporte\}='Publicando'\)/);
  const reserve=block(WORKER,'async function handleSocialPublishReserve(','const SOCIAL_PUBLISH_MAX_DELAY_MS');
  assert.match(reserve,/out\?\.reserved&&!out\?\.replayed/);
  assert.match(reserve,/"Estado transporte":"Publicando"/);
  assert.match(due,/"Estado transporte":"Error","Error publicación":c\.error/);
  const publish=block(WORKER,'async function handleSocialPublish(','export class SocialEventGuard');
  assert.match(publish,/"Fecha publicación":new Date\(publishedAt\)\.toISOString\(\)/);
});

test('la conversión manual a lead usa un guard global y dedup social',()=>{
  assert.match(ACCESS,/path===['"]\/social\/lead['"]/);
  assert.match(PROXY,/tls-social-leads/);
  const h=block(PROXY,'async _handleSocialLead(request)','async _handleNewsletterSend');
  assert.match(h,/Social identity key/);
  assert.match(h,/social\.lead_received/);
  assert.match(h,/Agent Queue ID/);
  assert.match(h,/Lead creado/);
  assert.match(h,/storage\.get\(storageKey\)/);
  assert.match(h,/storage\.put\(storageKey,done\)/);
});

test('métricas usan upsert y publicación confirmada crea heartbeats',()=>{
  const metrics=block(WORKER,'async function handleSocialMetrics(','async function handleSocialPublishReserve');
  const publish=block(WORKER,'async function handleSocialPublish(','/* ════════════════════════════════════════════════════════════════════════\n * NÚCLEO: crear Cliente');
  assert.match(metrics,/socialFindOne\(env,"Social_Metrics"/);
  assert.match(metrics,/airtableUpdateTolerant\(env,"Social_Metrics"/);
  assert.match(metrics,/socialHeartbeat\(env,"social-metrics"/);
  assert.match(publish,/socialHeartbeat\(env,"social-publish"/);
  assert.match(WORKER,/socialHeartbeat\(env,"social-listen"/);
});
