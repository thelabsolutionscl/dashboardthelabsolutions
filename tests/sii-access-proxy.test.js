#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const wk =');
let identity=null;
global.accessAuthorize=async()=>identity?{identity}:{legacy:true};
const worker=new Function(source+'\nreturn wk;')();
const ENV={APP_KEY:'test-public-key',SII_WORKER_KEY:'secret-never-to-browser',
  SII_WORKER_URL:'https://sii-dte-worker.example.workers.dev'};
const origFetch=global.fetch;
test.after(()=>{global.fetch=origFetch;});
function req(pathname,method='GET',body=null,key=ENV.APP_KEY){
  return new Request('https://proxy.example.com'+pathname,{
    method,
    headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':key,'Content-Type':'application/json'},
    ...(body===null?{}:{body:JSON.stringify(body)})
  });
}
function spy(upstream=Response.json({trackid:'TRK123',recibido:true}, {status:200})){
  const calls=[];
  global.fetch=async(url,opts)=>{calls.push({url:String(url),opts});return upstream;};
  return calls;
}
test('legacy APP_KEY alone cannot access SII, even if backend secret exists',async()=>{
  identity=null;const calls=spy();
  const r=await worker.fetch(req('/sii/emit','POST',{pedido_id:'recPedido123'}),ENV);
  assert.equal(r.status,503);
  assert.equal(calls.length,0);
});
test('authenticated finance emission forwards only server-held secret',async()=>{
  identity={email:'finance@example.com',role:'finance'};
  const calls=spy();
  const r=await worker.fetch(req('/sii/emit','POST',{pedido_id:'recPedido123'}),ENV);
  assert.equal(r.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,ENV.SII_WORKER_URL+'/emit');
  assert.equal(calls[0].opts.headers['X-Worker-Key'],ENV.SII_WORKER_KEY);
  assert.equal(calls[0].opts.redirect,'manual');
  assert.equal(JSON.parse(calls[0].opts.body).pedido_id,'recPedido123');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://dashboard.thelab.solutions');
});
test('authenticated status and admin CAF use fixed methods and paths',async()=>{
  identity={email:'finance@example.com',role:'finance'};
  let calls=spy();
  const r=await worker.fetch(req('/sii/folio/33'),ENV);
  assert.equal(r.status,200);
  assert.equal(calls[0].url,ENV.SII_WORKER_URL+'/folio/33');
  identity={email:'admin@example.com',role:'admin'};
  calls=spy();
  const caf=await worker.fetch(req('/sii/caf','PUT',{tipo_documento:'33',caf_xml:'test'}),ENV);
  assert.equal(caf.status,200);
  assert.equal(calls[0].opts.method,'PUT');
});
test('missing SII backend secrets and forged destinations fail closed',async()=>{
  identity={email:'finance@example.com',role:'finance'};
  const calls=spy();
  const miss=await worker.fetch(req('/sii/emit','POST',{}),{APP_KEY:ENV.APP_KEY,SII_WORKER_URL:ENV.SII_WORKER_URL});
  assert.equal(miss.status,503);
  const bad=await worker.fetch(req('/sii/emit','POST',{}),{...ENV,SII_WORKER_URL:'http://127.0.0.1'});
  assert.equal(bad.status,503);
  assert.equal(calls.length,0);
});
test('unsupported SII methods/paths and queries never contact backend',async()=>{
  identity={email:'admin@example.com',role:'admin'};
  const calls=spy();
  for(const request of [
    req('/sii/emit','GET'),req('/sii/folio/42'),
    req('/sii/caf','POST',{}),req('/sii/emit?redirect=http://evil','POST',{})
  ])assert.equal((await worker.fetch(request,ENV)).status,404);
  assert.equal(calls.length,0);
});
test('proxy refuses SII redirects without forwarding the next request',async()=>{
  identity={email:'finance@example.com',role:'finance'};
  const calls=spy(new Response(null,{status:302,headers:{Location:'https://evil.example'}}));
  const response=await worker.fetch(req('/sii/emit','POST',{}),ENV);
  assert.equal(response.status,502);
  assert.equal((await response.json()).code,'DTE_PENDING_RECONCILIATION');
  assert.equal(calls.length,1);
});
test('a failed or ambiguous SII upload is never retried by this gateway',async()=>{
  identity={email:'finance@example.com',role:'finance'};
  let attempts=0;
  global.fetch=async()=>{attempts++;throw Error('socket lost after upload');};
  const res=await worker.fetch(req('/sii/emit','POST',{}),ENV);
  assert.equal(res.status,502);
  assert.equal((await res.json()).code,'DTE_PENDING_RECONCILIATION');
  assert.equal(attempts,1);
});
