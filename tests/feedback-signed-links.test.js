#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const WORKER=pathToFileURL(path.join(__dirname,'../lead-worker/src/index.js')).href;
const ORDER='recPE0000000000A1',SECRET='feedback-test-secret-'.repeat(4);
const BASE='https://worker.example.com';
const LEGACY=Buffer.from(ORDER).toString('base64');
const ctx={waitUntil(){}};
let calls=[];
const env=()=>({
 AIRTABLE_TOKEN:'PAT_TEST_ONLY',AIRTABLE_BASE_ID:'appTEST',
 FEEDBACK_LINK_SECRET:SECRET,FEEDBACK_SIGNED_ONLY:'true',
 PORTAL_ADMIN_KEY:'private-test-portal-admin-key-'.repeat(2),
 WORKER_PUBLIC_URL:BASE,
 RL:(()=>{const kv=new Map();return{
   async get(k){return kv.get(k)||null;},async put(k,v){kv.set(k,String(v));}
 };})()
});
function stubAirtable(){
 calls=[];
 globalThis.fetch=async(u,opts={})=>{
   const url=new URL(String(u));
   assert.equal(url.hostname,'api.airtable.com');
   assert.equal(opts.headers.Authorization,'Bearer PAT_TEST_ONLY');
   const method=opts.method||'GET';
   calls.push({method,path:url.pathname,body:opts.body?JSON.parse(opts.body):null});
   if(method==='PATCH')return Response.json({id:ORDER,fields:JSON.parse(opts.body).fields});
   return Response.json({id:ORDER,fields:{
     'N° Pedido':'PED-2026-042','Estado pedido':'Despachado',
     'Fecha entrega':'2026-09-27','NPS score':5,'Recepción confirmada':false
   }});
 };
}
const get=(path,headers={})=>new Request(BASE+path,{headers});
const issue=async(worker,e,purpose,days=undefined,opts={})=>{
 const body={recordId:ORDER,purpose,...(days===undefined?{}:{days}),...opts};
 return worker.fetch(new Request(BASE+'/feedback/link',{
   method:'POST',headers:{'Content-Type':'application/json',
     'X-Portal-Admin-Key':e.PORTAL_ADMIN_KEY},
   body:JSON.stringify(body)}),e,ctx);
};
test('a private admin credential is required; invalid purpose, record and expiry fail closed',async()=>{
 stubAirtable();
 const worker=(await import(WORKER)).default,e=env();
 const body={recordId:ORDER,purpose:'nps'};
 for(const key of ['', 'wrong']){
   const res=await worker.fetch(new Request(BASE+'/feedback/link',{
     method:'POST',headers:{'Content-Type':'application/json',
       ...(key?{'X-Portal-Admin-Key':key}:{})},body:JSON.stringify(body)
   }),e,ctx);
   assert.equal(res.status,401);
 }
 for(const b of [
   {recordId:'recINVALID',purpose:'nps'},
   {recordId:ORDER,purpose:'other'},
   {recordId:ORDER,purpose:'pod',days:91},
   {recordId:ORDER,purpose:'nps',days:0},
   {recordId:ORDER,purpose:'nps',days:'30'},
   {recordId:ORDER,purpose:'nps',extra:'injected'}
 ]){
   const res=await worker.fetch(new Request(BASE+'/feedback/link',{
     method:'POST',headers:{'Content-Type':'application/json',
       'X-Portal-Admin-Key':e.PORTAL_ADMIN_KEY},
     body:JSON.stringify(b)
   }),e,ctx);
   assert.equal(res.status,422,JSON.stringify(b));
 }
 const noSecret=env();delete noSecret.FEEDBACK_LINK_SECRET;
 assert.equal((await issue(worker,noSecret,'nps')).status,503);
 assert.equal(calls.length,0,'bad mint requests may not reach Airtable');
});
test('three distinct signed purposes work and the link never reveals the signing key',async()=>{
 stubAirtable();
 const worker=(await import(WORKER)).default,e=env();
 const links={};
 for(const purpose of ['nps','pod','pedido']){
   const res=await issue(worker,e,purpose,7);
   assert.equal(res.status,200,await res.clone().text());
   assert.equal(res.headers.get('Cache-Control'),'no-store');
   const data=await res.json();
   const parsed=new URL(data.url);
   assert.equal(parsed.origin,BASE);
   assert.equal(parsed.pathname,'/'+purpose);
   assert.match(parsed.searchParams.get('p'),
     /^rec[A-Za-z0-9]{14}\.[0-9a-z]{6,9}\.[A-Za-z0-9_-]{43}$/);
   assert.equal(data.purpose,purpose);
   assert.ok(data.expires_at>Math.floor(Date.now()/1000));
   assert.ok(!JSON.stringify(data).includes(SECRET));
   links[purpose]=parsed.searchParams.get('p');
 }
 assert.equal(new Set(Object.values(links)).size,3,'purpose must enter HMAC');
 const nps=await worker.fetch(get('/nps?p='+encodeURIComponent(links.nps)),e,ctx);
 assert.equal(nps.status,200);
 assert.ok((await nps.text()).includes(encodeURIComponent(links.nps)));
 const pod=await worker.fetch(get('/pod?p='+encodeURIComponent(links.pod)),e,ctx);
 assert.equal(pod.status,200);
 assert.ok((await pod.text()).includes(encodeURIComponent(links.pod)));
 const order=await worker.fetch(get('/pedido?p='+encodeURIComponent(links.pedido)),e,ctx);
 assert.equal(order.status,200);
 assert.ok((await order.text()).includes('PED-2026-042'));
 assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
});
test('signed-only mode refuses base64 links, wrong purposes, corrupted and expired tokens before Airtable',async()=>{
 stubAirtable();
 const worker=(await import(WORKER)).default,e=env();
 const issued=await (await issue(worker,e,'nps')).json();
 const raw=new URL(issued.url).searchParams.get('p');
 const parts=raw.split('.');
 const bad=parts[0]+'.'+parts[1]+'.'+(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);
 const exp=Math.floor(Date.now()/1000)-60;
 const expired=ORDER+'.'+exp.toString(36)+'.'+
   createHmac('sha256',SECRET).update('feedback:v1:nps:'+ORDER+':'+exp).digest('base64url');
 for(const [route,token] of [
   ['/nps',LEGACY],['/pod',LEGACY],['/pedido',LEGACY],
   ['/pod',raw],['/pedido',raw],['/nps',bad],['/nps',expired]
 ]){
   const res=await worker.fetch(get(route+'?p='+encodeURIComponent(token)),e,ctx);
   assert.equal(res.status,200);
   assert.match(await res.text(),/Enlace inválido/);
 }
 const invalidPost=await worker.fetch(new Request(BASE+'/nps',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({token:LEGACY,comentario:'manipulado'})
 }),e,ctx);
 assert.equal(invalidPost.status,400);
 assert.equal(calls.length,0,'invalid tokens must not read or write CRM');
 const missing=env();delete missing.FEEDBACK_LINK_SECRET;
 const x=await worker.fetch(get('/nps?p='+encodeURIComponent(raw)),missing,ctx);
 assert.match(await x.text(),/Enlace inválido/);
});
test('valid signed NPS score/comment and POD confirmation can mutate only their own purpose',async()=>{
 stubAirtable();
 const worker=(await import(WORKER)).default,e=env();
 const nps=await (await issue(worker,e,'nps')).json();
 const pod=await (await issue(worker,e,'pod')).json();
 const npsPath=new URL(nps.url).pathname+new URL(nps.url).search;
 const podPath=new URL(pod.url).pathname+new URL(pod.url).search;
 const score=await worker.fetch(get(npsPath+'&s=4'),e,ctx);
 assert.equal(score.status,200);
 assert.deepEqual(calls.at(-1).body.fields['NPS score'],4);
 assert.ok((await score.text()).includes(JSON.stringify(new URL(nps.url).searchParams.get('p'))));
 const comment=await worker.fetch(new Request(BASE+'/nps',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({token:new URL(nps.url).searchParams.get('p'),
     comentario:'Excelente servicio'})
 }),e,ctx);
 assert.equal(comment.status,200);
 assert.equal(calls.at(-1).body.fields['NPS comentario'],'Excelente servicio');
 const receipt=await worker.fetch(get(podPath+'&c=1'),e,ctx);
 assert.equal(receipt.status,200);
 assert.equal(calls.at(-1).body.fields['Recepción confirmada'],true);
 const before=calls.length;
 const cross=await worker.fetch(get('/pod?p='+
   encodeURIComponent(new URL(nps.url).searchParams.get('p'))+'&c=1'),e,ctx);
 assert.match(await cross.text(),/Enlace inválido/);
 assert.equal(calls.length,before);
});
test('legacy links remain functional by default to avoid breaking already-sent customer messages',async()=>{
 stubAirtable();
 const worker=(await import(WORKER)).default,e=env();
 delete e.FEEDBACK_SIGNED_ONLY;
 const res=await worker.fetch(get('/nps?p='+encodeURIComponent(LEGACY)),e,ctx);
 assert.equal(res.status,200);
 assert.ok((await res.text()).includes('experiencia'));
 const pod=await worker.fetch(get('/pod?p='+encodeURIComponent(LEGACY)+'&c=1'),e,ctx);
 assert.equal(pod.status,200);
 assert.equal(calls.at(-1).body.fields['Recepción confirmada'],true);
});
