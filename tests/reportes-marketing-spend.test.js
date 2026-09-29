#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
let identity={email:'finanzas@example.com',role:'finance'};
global.accessAuthorize=async()=>identity?{identity}:{legacy:true};
const {CrmMutationGuard,worker}=new Function(code+'\nreturn {CrmMutationGuard,worker};')();
const ORIGIN='https://dashboard.thelab.solutions';
function fixture(){
  const memory=new Map();
  const storage={
    async get(k){return memory.get(k);},
    async put(k,v){memory.set(k,structuredClone(v));},
    async delete(k){memory.delete(k);},
    async list({prefix,reverse,limit}){let items=[...memory].filter(([k])=>k.startsWith(prefix)).sort((a,b)=>a[0].localeCompare(b[0]));if(reverse)items.reverse();return new Map(items.slice(0,limit));},
    async transaction(fn){return fn(this);}
  };
  const guard=new CrmMutationGuard({storage},{});
  const ids=[];
  const env={APP_KEY:'public-test-key',CRM_MUTATION_GUARD:{
    idFromName:name=>(ids.push(name),name),
    get:()=>guard
  }};
  const req=(method,month,body=null,endpoint='/marketing/spend')=>new Request(
    'https://proxy.example.com'+endpoint+'?month='+month,{
      method,headers:{Origin:ORIGIN,'X-App-Key':env.APP_KEY,'Content-Type':'application/json'},
      ...(body===null?{}:{body:JSON.stringify(body)})
    });
  return {guard,storage,memory,ids,env,req,
    fetch:(m,month,b)=>worker.fetch(req(m,month,b),env,{waitUntil:()=>{}})
  };
}
test('two browsers cannot overwrite the same month concurrently; loser receives authoritative row',async()=>{
  const h=fixture(),body={channel:'Google Ads',amount_clp:50000,expected_revision:0};
  const [a,b]=await Promise.all([h.fetch('PUT','2026-09',body),
    h.fetch('PUT','2026-09',{...body,amount_clp:90000})]);
  assert.equal(a.status,200);assert.equal(b.status,409);
  assert.equal((await b.json()).code,'SPEND_REVISION_CONFLICT');
  const r=await h.fetch('GET','2026-09');
  assert.deepEqual((await r.json()).channels,{'Google Ads':50000});
  assert.deepEqual(h.ids,['tls-marketing-spend-global','tls-marketing-spend-global','tls-marketing-spend-global']);
});
test('writes preserve other channels and months; zero removes a channel with signed actor audit',async()=>{
  const h=fixture();
  let a=await h.fetch('PUT','2026-08',{channel:'Google Ads',amount_clp:60000,expected_revision:0});
  assert.equal(a.status,200);
  identity={email:'admin@example.com',role:'admin'};
  a=await h.fetch('PUT','2026-08',{channel:'LinkedIn',amount_clp:40000,expected_revision:1});
  assert.equal(a.status,200);
  a=await h.fetch('PUT','2026-09',{channel:'Google Ads',amount_clp:90000,expected_revision:0});
  assert.equal(a.status,200);
  a=await h.fetch('PUT','2026-08',{channel:'Google Ads',amount_clp:0,expected_revision:2});
  assert.equal(a.status,200);
  const aug=await (await h.fetch('GET','2026-08')).json();
  const sep=await (await h.fetch('GET','2026-09')).json();
  assert.deepEqual(aug.channels,{LinkedIn:40000});
  assert.deepEqual(sep.channels,{'Google Ads':90000});
  const audit=await (await worker.fetch(h.req('GET','2026-08',null,'/marketing/spend/history'),h.env)).json();
  assert.equal(audit.events.length,3);
  assert.equal(audit.events[0].before_clp,60000);
  assert.equal(audit.events[0].after_clp,0);
  assert.equal(audit.events[0].actor_email,'admin@example.com');
  assert.equal(audit.events[2].actor_email,'finanzas@example.com');
  identity={email:'finanzas@example.com',role:'finance'};
});
test('legacy shared app key, viewer role and malformed routes are rejected without writes',async()=>{
  const h=fixture();
  identity=null;
  assert.equal((await h.fetch('GET','2026-09')).status,503);
  assert.equal((await h.fetch('PUT','2026-09',{channel:'Google Ads',amount_clp:99,expected_revision:0})).status,503);
  identity={email:'view@example.com',role:'viewer'};
  assert.equal((await h.fetch('GET','2026-09')).status,403);
  identity={email:'finanzas@example.com',role:'finance'};
  for(const bad of [
    h.req('GET','2026-13'),
    h.req('GET','2026-09&month=2026-08'),
    h.req('PUT','2026-09',{channel:'Google Ads',amount_clp:-5,expected_revision:0}),
    h.req('PUT','2026-09',{channel:'Google Ads',amount_clp:500,expected_revision:0,url:'evil'}),
    h.req('PUT','2026-09',{channel:'Google Ads',amount_clp:500,expected_revision:0},'/marketing/spend/anything')
  ]){
    const res=await worker.fetch(bad,h.env);
    assert.ok(res.status>=400);
  }
  assert.equal(h.memory.size,0);
});
test('idempotent same-value write does not create duplicate audit revisions',async()=>{
  const h=fixture();
  assert.equal((await h.fetch('PUT','2026-09',{channel:'Meta Ads',amount_clp:100,expected_revision:0})).status,200);
  let r=await h.fetch('PUT','2026-09',{channel:'Meta Ads',amount_clp:100,expected_revision:1});
  let data=await r.json();
  assert.equal(data.unchanged,true);assert.equal(data.revision,1);
  const hist=await worker.fetch(h.req('GET','2026-09',null,'/marketing/spend/history'),h.env);
  assert.equal((await hist.json()).events.length,1);
});
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function browser(localRows,remote){
  const storage=new Map([['thelab_gasto_canal_por_mes_v2',JSON.stringify(localRows||{})]]);
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
  const calls=[],toasts=[];
  const months=off=>({key:off===0?'2026-09':'2026-08',label:off===0?'septiembre 2026':'agosto 2026'});
  const document={getElementById:id=>id==='cacCanalCard'?{dataset:{off:'0'}}:null};
  const prompts=['Meta Ads','65000'];
  const fetch=async(url,opts={})=>{
    calls.push({url:String(url),method:opts.method||'GET',payload:opts.body?JSON.parse(opts.body):null});
    if(opts.method==='PUT'){
      if(remote.revision!==opts.body&&JSON.parse(opts.body).expected_revision!==remote.revision)
        return Response.json({code:'SPEND_REVISION_CONFLICT'},{status:409});
      const body=JSON.parse(opts.body),channels={...remote.channels};
      if(body.amount_clp===0)delete channels[body.channel];else channels[body.channel]=body.amount_clp;
      remote.channels=channels;remote.revision++;
    }
    return Response.json({...remote,month:'2026-09'});
  };
  const source=index.slice(index.indexOf('const _GASTO_CANAL_KEY='),index.indexOf('function _canalStats(off){'));
  const api=new Function('localStorage','_mesRango','_proxyCfg','_proxyCredentials',
    'fetch','document','prompt','toast','formatCLP','renderCacCanal','confirm',
    source+'\nreturn {_marketingSpendLoad,_gastoCanalVisible,_marketingSpendImport,setGastoCanal};'
  )(localStorage,months,()=>({url:'https://proxy.example.com',key:'public-key'}),
    ()=> 'include',fetch,document,()=>prompts.shift(),m=>toasts.push(m),String,()=>{},()=>true);
  return {api,calls,storage,toasts,remote};
}
test('browser reads authoritative shared spend, never silently migrates conflicting local amounts',async()=>{
  identity={email:'finanzas@example.com',role:'finance'};
  const h=browser({'2026-09':{'Meta Ads':60000}},{channels:{'Google Ads':30000},revision:3});
  assert.deepEqual(h.api._gastoCanalVisible(0),{'Meta Ads':60000});
  await h.api._marketingSpendLoad(0,true);
  assert.deepEqual(h.api._gastoCanalVisible(0),{'Google Ads':30000});
  assert.equal(h.calls.filter(c=>c.method==='PUT').length,0);
  await h.api._marketingSpendImport();
  assert.deepEqual(h.api._gastoCanalVisible(0),{'Google Ads':30000,'Meta Ads':60000});
  assert.equal(h.remote.revision,4);
});
test('browser writes shared spend with expected revision and does not persist a local shadow',async()=>{
  const h=browser({'2026-09':{'Meta Ads':1000}},{channels:{'Google Ads':30000},revision:2});
  await h.api._marketingSpendLoad(0,true);
  await h.api.setGastoCanal();
  const write=h.calls.find(c=>c.method==='PUT');
  assert.deepEqual(write.payload,{channel:'Meta Ads',amount_clp:65000,expected_revision:2});
  assert.deepEqual(JSON.parse(h.storage.get('thelab_gasto_canal_por_mes_v2')),
    {'2026-09':{'Meta Ads':1000}});
});
