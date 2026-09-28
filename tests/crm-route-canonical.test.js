#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8');
const worker=new Function(source.replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const wk =')+'\nreturn wk;')();
const BASE='app1YtD74AqiPWQhy';
const env={APP_KEY:'test-public-proxy-key',AIRTABLE_TOKEN:'pat-fake'};
const make=(suffix,method='POST')=>new Request('https://proxy.test/'+suffix,{
  method,
  headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,'Content-Type':'application/json'},
  ...(method==='GET'?{}:{body:JSON.stringify({fields:{'N° Pedido':'PED-2026-070'}})}),
});
async function simulate(fn){
  const old=global.fetch,requests=[];
  global.fetch=async(url,opts)=>{requests.push({url:String(url),opts});return new Response('{"id":"recTest","fields":{}}',{status:201});};
  try{await fn(requests);}
  finally{global.fetch=old;}
}
test('no se puede esquivar CrmMutationGuard usando percent-encoding del nombre',async()=>{
  await simulate(async calls=>{
    for(const suffix of [
      BASE+'/%50edidos',
      BASE+'/Pedi%64os',
      BASE+'/Coti%7Aaciones',
      'v0/'+BASE+'/%50edidos',
      BASE+'/pedidos',
      BASE+'/Cotizaciones/',
      BASE+'/Pedidos/',
      BASE+'/Pedidos%2Fotro',
      BASE+'/%2574blvVAc4TtiERA0Tc',
    ]){
      const res=await worker.fetch(make(suffix),env,undefined);
      assert.equal(res.status,403,'debe rechazar '+suffix);
    }
    assert.equal(calls.length,0,'ningún POST disfrazado alcanza Airtable');
  });
});
test('tampoco se pueden usar IDs tbl... como rutas de escritura',async()=>{
  await simulate(async calls=>{
    for(const method of ['POST','PATCH','DELETE']){
      const res=await worker.fetch(make(BASE+'/tblvVAc4TtiERA0Tc',method),env,undefined);
      assert.equal(res.status,403,method);
    }
    assert.equal(calls.length,0);
  });
});
test('sin binding, la URL canónica de Pedidos suspende la creación antes del upstream',async()=>{
  await simulate(async calls=>{
    const res=await worker.fetch(make(BASE+'/Pedidos'),env,undefined);
    assert.equal(res.status,503);
    assert.match((await res.json()).error,/guard unavailable/);
    assert.equal(calls.length,0);
  });
});
test('las altas legítimas de otras tablas siguen funcionando con URL canónica',async()=>{
  await simulate(async calls=>{
    const resp=await worker.fetch(make(BASE+'/Clientes'),env,undefined);
    assert.equal(resp.status,201);
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/\/v0\/app1YtD74AqiPWQhy\/Clientes$/);
  });
});
test('una tabla con espacios codificados conserva la compatibilidad',async()=>{
  await simulate(async calls=>{
    const resp=await worker.fetch(make(BASE+'/Monitor%20Sistema'),env,undefined);
    assert.equal(resp.status,201);
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/Monitor%20Sistema$/);
  });
});
