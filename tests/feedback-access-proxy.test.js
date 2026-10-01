#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
 .replace("import { accessAuthorize } from './access-auth.js';",'')
 .replace('export class AiBudgetGuard','class AiBudgetGuard')
 .replace('export class CrmMutationGuard','class CrmMutationGuard')
 .replace('export default','const worker=');
let identity={email:'operator@example.com',role:'operator'};
global.accessAuthorize=async (req,env,path)=>{
 if(!identity)return {legacy:true};
 if(path==='/feedback/link'&&!['admin','operator','finance'].includes(identity.role))
   return {response:Response.json({error:'Role denied'},{status:403})};
 if(path==='/feedback/link'&&req.method!=='POST')
   return {response:Response.json({error:'Method denied'},{status:403})};
 return {identity};
};
const worker=new Function(code+'\nreturn worker;')();
const lead='https://thelab-leads-worker.wast3dspa.workers.dev';
const env={APP_KEY:'public-compat-key',PORTAL_ADMIN_KEY:'server-held-private-credential-12345',
 LEAD_WORKER_URL:lead+'/'};
const id='recPE0000000000A1';
const future=()=>Math.floor(Date.now()/1000)+30*86400;
const signed=p=>lead+'/'+p+'?p='+id+'.'+future().toString(36)+'.'+'a'.repeat(43);
const requests=(path='/feedback/link',body={recordId:id,purpose:'nps'},opts={})=>new Request(
 'https://proxy.example.com'+path,{
   method:opts.method||'POST',
   headers:{Origin:opts.origin||'https://dashboard.thelab.solutions',
     'X-App-Key':opts.key||env.APP_KEY,
     'Content-Type':'application/json'},
   ...(opts.method==='GET'?{}:{body:JSON.stringify(body)})
 });
const originalFetch=global.fetch,calls=[];
test.after(()=>{global.fetch=originalFetch;});
function spy(result){
 calls.length=0;
 global.fetch=async (url,opts)=>{
   calls.push({url:String(url),opts});
   return typeof result==='function'?result(url,opts):
     result||Response.json({ok:true,url:signed('nps'),expires_at:future(),purpose:'nps'});
 };
}
test('legacy APP_KEY, viewer and sales cannot mint purpose-bound links',async()=>{
 spy();
 identity=null;
 assert.equal((await worker.fetch(requests(),env)).status,503);
 identity={email:'viewer@example.com',role:'viewer'};
 assert.equal((await worker.fetch(requests(),env)).status,403);
 identity={email:'seller@example.com',role:'sales',seller:'nicanor'};
 assert.equal((await worker.fetch(requests(),env)).status,403);
 assert.equal(calls.length,0);
});
test('signed operator/admin requests forward only to approved issuer with private server-side credential',async()=>{
 identity={email:'operator@example.com',role:'operator'};
 for(const p of ['nps','pod','pedido']){
   spy(()=>Response.json({ok:true,url:signed(p),expires_at:future(),purpose:p}));
   const response=await worker.fetch(requests('/feedback/link',{recordId:id,purpose:p,days:15}),env);
   assert.equal(response.status,200,await response.clone().text());
   assert.equal(response.headers.get('Cache-Control'),'no-store');
   const result=await response.json();
   assert.equal(result.ok,true);
   assert.equal(result.purpose,p);
   assert.equal(calls.length,1);
   assert.equal(calls[0].url,lead+'/feedback/link');
   assert.equal(calls[0].opts.redirect,'manual');
   assert.deepEqual(JSON.parse(calls[0].opts.body),{recordId:id,purpose:p,days:15});
   assert.equal(calls[0].opts.headers['X-Portal-Admin-Key'],env.PORTAL_ADMIN_KEY);
   assert.ok(!JSON.stringify(result).includes(env.PORTAL_ADMIN_KEY));
 }
 identity={email:'finance@example.com',role:'finance'};
 spy();
 assert.equal((await worker.fetch(requests(),env)).status,200);
});
test('invalid requests and untrusted lead URL cannot reach backend',async()=>{
 identity={email:'admin@example.com',role:'admin'};
 spy();
 for(const body of [
   {recordId:'recINVALID',purpose:'nps'},
   {recordId:id,purpose:'foo'},
   {recordId:id,purpose:'nps',days:91},
   {recordId:id,purpose:'nps',days:'30'},
   {recordId:id,purpose:'nps',extra:'forged'}
 ]){
   assert.equal((await worker.fetch(requests('/feedback/link',body),env)).status,422);
 }
 assert.equal((await worker.fetch(requests('/feedback/link?next=https://evil.example'),env)).status,422);
 assert.equal((await worker.fetch(requests(),{...env,PORTAL_ADMIN_KEY:''})).status,503);
 for(const url of ['https://evil.example/','http://'+new URL(lead).hostname+'/',
   'https://thelab-leads-worker.evil.example/',
   lead+'/api','https://'+new URL(lead).hostname+':8443/']){
   assert.equal((await worker.fetch(requests(),{...env,LEAD_WORKER_URL:url})).status,503,url);
 }
 assert.equal(calls.length,0);
});
test('redirect, HTML, untrusted minted URL or malformed token fail closed without redirect-following',async()=>{
 identity={email:'admin@example.com',role:'admin'};
 for(const reply of [
   new Response(null,{status:302,headers:{Location:'https://evil.example'}}),
   new Response('<html>bad</html>',{status:200,headers:{'Content-Type':'text/html'}}),
   Response.json({ok:true,url:'https://evil.example/nps?p=x',expires_at:future(),purpose:'nps'}),
   Response.json({ok:true,url:lead+'/pod?p='+id+'.'+future().toString(36)+'.'+'a'.repeat(43),
     expires_at:future(),purpose:'nps'}),
   Response.json({ok:true,url:lead+'/nps?p='+id+'.'+future().toString(36)+'.bad',
     expires_at:future(),purpose:'nps'}),
 ]){
   spy(reply);
   const res=await worker.fetch(requests(),env);
   assert.equal(res.status,502);
   assert.equal(calls.length,1);
   assert.equal(calls[0].opts.redirect,'manual');
 }
});
