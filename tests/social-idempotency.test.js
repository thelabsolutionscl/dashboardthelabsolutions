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
