#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(authSource+'\nreturn {accessAllows};')();

const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
let identity={email:'visual@example.com',role:'operator'};
global.accessAuthorize=async()=>identity?{identity}:{legacy:true};
const api=new Function(source+'\nreturn {worker,CrmMutationGuard,visualAiPayloadAllowed,visualAiActorAllowed,VISUAL_AI_ALLOWED_ENDPOINTS};')();
const {worker,CrmMutationGuard,visualAiPayloadAllowed,visualAiActorAllowed,VISUAL_AI_ALLOWED_ENDPOINTS}=api;

const originalFetch=global.fetch;
test.after(()=>{global.fetch=originalFetch;});

function storage(){
  const m=new Map();
  return {
    async get(k){return m.get(k);},
    async put(k,v){m.set(k,v);},
    async delete(k){m.delete(k);},
    _map:m
  };
}
function harness({limit=40}={}){
  const store=storage();
  const ENV={
    APP_KEY:'public-test-key',
    MUAPI_KEY:'server-secret-key',
    VISUAL_AI_DAILY_LIMIT:String(limit)
  };
  const guard=new CrmMutationGuard({storage:store},ENV);
  ENV.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-visual-ai-global');return name;},
    get(){return {fetch:(url,init)=>guard.fetch(new Request(url,init))};}
  };
  const calls=[];
  global.fetch=async(url,opts={})=>{
    calls.push({url:String(url),opts});
    if(String(url).endsWith('/flux-schnell-image'))
      return Response.json({request_id:'req123'});
    if(String(url).includes('/predictions/req123/result'))
      return Response.json({status:'completed',url:'https://cdn.muapi.ai/result.png',cost_usd:0.031});
    if(String(url).endsWith('/upload_file'))
      return Response.json({url:'https://cdn.muapi.ai/upload.png'});
    throw Error('unexpected upstream '+url);
  };
  function req(body,{role='operator',method='POST',query='',origin='https://dashboard.thelab.solutions',withKey=true}={}){
    identity={email:role+'@example.com',role};
    const headers={Origin:origin,'Content-Type':'application/json'};
    if(withKey)headers['X-App-Key']=ENV.APP_KEY;
    return worker.fetch(new Request('https://proxy.example.com/visual-ai/rpc'+query,{
      method,headers,
      ...(method==='POST'?{body:JSON.stringify(body)}:{})
    }),ENV,{waitUntil(){}});
  }
  return{ENV,guard,store,calls,req};
}

test('RBAC Visual AI permite usuarios operativos firmados y niega viewer',()=>{
  for(const role of ['sales','operator','finance','admin'])
    assert.equal(accessAllows({role,email:role+'@x.cl'},'POST','/visual-ai/rpc'),true);
  assert.equal(accessAllows({role:'viewer',email:'v@x.cl'},'POST','/visual-ai/rpc'),false);
  assert.equal(accessAllows({role:'admin',email:'a@x.cl'},'GET','/visual-ai/rpc'),false);
});

test('OpenGen standalone puede usar el proxy sin APP_KEY pero solo con Access firmado y origen permitido',async()=>{
  const h=harness();
  let r=await h.req({action:'quota'},{origin:'https://thelabsolutionscl.github.io',withKey:false,role:'operator'});
  assert.equal(r.status,200,await r.clone().text());
  identity=null;
  global.accessAuthorize=async()=>({legacy:true});
  r=await worker.fetch(new Request('https://proxy.example.com/visual-ai/rpc',{
    method:'POST',headers:{Origin:'https://thelabsolutionscl.github.io','Content-Type':'application/json'},
    body:JSON.stringify({action:'quota'})
  }),h.ENV,{waitUntil(){}});
  assert.equal(r.status,403);
  global.accessAuthorize=async()=>identity?{identity}:{legacy:true};
});

test('allowlist y payload fallan cerrados',()=>{
  assert.equal(VISUAL_AI_ALLOWED_ENDPOINTS.has('flux-schnell-image'),true);
  assert.equal(VISUAL_AI_ALLOWED_ENDPOINTS.has('https://evil.example'),false);
  assert.equal(visualAiPayloadAllowed({prompt:'hola',aspect_ratio:'1:1'}),true);
  assert.equal(visualAiPayloadAllowed({prompt:'x'.repeat(3001)}),false);
  assert.equal(visualAiPayloadAllowed({image_url:'http://127.0.0.1/x.png'}),false);
  assert.equal(visualAiPayloadAllowed({evil:'x'}),false);
  assert.equal(visualAiActorAllowed({role:'operator',email:'o@x.cl'}),true);
  assert.equal(visualAiActorAllowed({role:'viewer',email:'v@x.cl'}),false);
});


test('quota previa lee uso real sin reservar ni contactar al proveedor',async()=>{
  const h=harness({limit:2});
  let res=await h.req({action:'quota'});
  assert.equal(res.status,200,await res.clone().text());
  let q=await res.json();
  assert.equal(q.daily_limit,2);assert.equal(q.used,0);assert.equal(q.remaining,2);
  assert.equal(q.estimated_cost_usd,null);
  assert.equal(h.calls.length,0);
  res=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'a'},jobId:'job_quota_view_01'});
  assert.equal(res.status,200,await res.clone().text());
  const before=h.calls.length;
  res=await h.req({action:'quota'});
  q=await res.json();
  assert.equal(q.used,1);assert.equal(q.remaining,1);
  assert.equal(h.calls.length,before,'consultar cuota no debe llamar a MuAPI');
});

test('generate usa secreto server-side, guarda receipt e informa cuota',async()=>{
  const h=harness();
  const res=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'trofeo',aspect_ratio:'1:1'},jobId:'job_1234567890'});
  assert.equal(res.status,200,await res.clone().text());
  const body=await res.json();
  assert.equal(body.request_id,'req123');
  assert.equal(body.quota.used,1);
  const upstream=h.calls.find(c=>c.url.endsWith('/flux-schnell-image'));
  assert.ok(upstream);
  assert.equal(upstream.opts.headers['x-api-key'],h.ENV.MUAPI_KEY);
  assert.doesNotMatch(JSON.stringify(body),/server-secret-key/);
});

test('mismo job confirmado se reproduce sin segundo POST al proveedor',async()=>{
  const h=harness();
  let r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'x'},jobId:'job_replay_12345'});
  assert.equal(r.status,200);
  r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'x'},jobId:'job_replay_12345'});
  assert.equal(r.status,200);
  const b=await r.json();assert.equal(b.replayed,true);assert.equal(b.request_id,'req123');
  assert.equal(h.calls.filter(c=>c.url.endsWith('/flux-schnell-image')).length,1);
});

test('resultado incierto queda bloqueado y no duplica generación',async()=>{
  const h=harness();
  global.fetch=async(url)=>{if(String(url).endsWith('/flux-schnell-image'))throw Error('socket lost');throw Error('unexpected');};
  let r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'x'},jobId:'job_uncertain_123'});
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'VISUAL_JOB_PENDING');
  let calls=0;
  global.fetch=async()=>{calls++;return Response.json({request_id:'should-not-run'});};
  r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'x'},jobId:'job_uncertain_123'});
  assert.equal(r.status,409);
  assert.equal((await r.json()).code,'VISUAL_JOB_PENDING');
  assert.equal(calls,0);
});

test('cuota diaria se aplica antes de contactar al proveedor',async()=>{
  const h=harness({limit:1});
  let r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'a'},jobId:'job_quota_00001'});
  assert.equal(r.status,200);
  const before=h.calls.length;
  r=await h.req({action:'generate',endpoint:'flux-schnell-image',payload:{prompt:'b'},jobId:'job_quota_00002'});
  assert.equal(r.status,429);
  const b=await r.json();assert.equal(b.code,'VISUAL_AI_QUOTA');assert.equal(b.limit,1);
  assert.equal(h.calls.length,before);
});

test('poll valida URL de salida y propaga costo si proveedor lo informa',async()=>{
  const h=harness();
  const r=await h.req({action:'poll',requestId:'req123'});
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(b.status,'completed');
  assert.equal(b.url,'https://cdn.muapi.ai/result.png');
  assert.equal(b.cost_usd,0.031);
});

test('upload valida firma real y no confía solo en data URL',async()=>{
  const h=harness();
  const tiny='data:image/png;base64,'+Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]).toString('base64');
  let r=await h.req({action:'upload',dataUrl:tiny});
  assert.equal(r.status,200,await r.clone().text());
  const call=h.calls.find(c=>c.url.endsWith('/upload_file'));assert.ok(call);
  assert.equal(call.opts.headers['x-api-key'],h.ENV.MUAPI_KEY);
  const fake='data:image/png;base64,'+Buffer.from('not-an-image').toString('base64');
  r=await h.req({action:'upload',dataUrl:fake});
  assert.equal(r.status,422);
});

test('método/query/endpoint desconocido y secreto ausente fallan cerrados',async()=>{
  const h=harness();
  let r=await h.req({action:'generate',endpoint:'evil',payload:{},jobId:'job_bad_123456'});
  assert.equal(r.status,422);
  r=await h.req({action:'quota'},{method:'GET'});assert.equal(r.status,405);
  r=await h.req({action:'quota'},{query:'?x=1'});assert.equal(r.status,405);
  const noSecret={...h.ENV,MUAPI_KEY:''};
  identity={email:'operator@example.com',role:'operator'};
  r=await worker.fetch(new Request('https://proxy.example.com/visual-ai/rpc',{
    method:'POST',headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':noSecret.APP_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({action:'quota'})
  }),noSecret,{waitUntil(){}});
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'VISUAL_AI_NOT_CONFIGURED');
});
