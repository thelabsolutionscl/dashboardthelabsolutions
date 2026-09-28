#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const SRC=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8');
function load(){
  const source=SRC.replace('export class AiBudgetGuard','class AiBudgetGuard')
    .replace('export class CrmMutationGuard','class CrmMutationGuard')
    .replace('export default','const worker =');
  return new Function(source+'\nreturn {CrmMutationGuard,worker};')();
}
const {CrmMutationGuard,worker}=load();
const BASE='/v0/app1YtD74AqiPWQhy/';
const PAT='pat-falso-tests';
const ORIGIN='https://dashboard.thelab.solutions';
const ENV={AIRTABLE_TOKEN:PAT,APP_KEY:'app-test-key'};
const order=(number,cot)=>({fields:{
  'N° Pedido':number, 'Estado pedido':'Confirmado',
  ...(cot?{Cotizaciones:[cot]}:{})
}});
function storage(){
  const map=new Map();
  return {
    map,
    api:{
      async get(k){const v=map.get(k);return v?structuredClone(v):undefined;},
      async put(k,v){map.set(k,structuredClone(v));},
      async delete(k){map.delete(k);},
    },
  };
}
function harness(opts={}){
  const st=storage(),records={Pedidos:[],Cotizaciones:[]},calls=[];
  let sequence=1,postCount=0;
  const original=global.fetch;
  global.fetch=async(url,init={})=>{
    const u=new URL(String(url)),method=init.method||'GET';
    const table=u.pathname.slice(BASE.length);
    calls.push({table,method,url:u.toString()});
    if(!u.pathname.startsWith(BASE)||!records[table]) throw Error('Unexpected Airtable URL: '+u.pathname);
    if(method==='GET'){
      if(opts.badRead)return new Response(JSON.stringify({records:null}),{status:200});
      return new Response(JSON.stringify({records:records[table]}),{status:200});
    }
    if(method!=='POST')throw Error('Unexpected method: '+method);
    postCount++;
    const body=JSON.parse(init.body);
    if(opts.holdFirst&&postCount===1)await opts.holdFirst;
    if(opts.reject422 && postCount===1)return new Response(JSON.stringify({error:'bad field'}),{status:422});
    const created={id:'recGenerated'+sequence++,fields:body.fields};
    if(!opts.failWithoutCommit||postCount!==1)records[table].push(created);
    if(opts.throwFirst && postCount===1)throw Error('timeout after request');
    return new Response(JSON.stringify(created),{status:201,headers:{'Content-Type':'application/json'}});
  };
  const guard=new CrmMutationGuard({storage:st.api},ENV);
  const request=(table,body)=>new Request('https://crm-write.internal/create',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({table,body})});
  return {
    guard,records,calls,map:st.map,
    create:(table,body)=>guard.fetch(request(table,body)),
    postCount:()=>postCount,
    restore:()=>{global.fetch=original;},
  };
}

test('dos computadores con el MISMO número pero distinta cotización no generan números duplicados',async()=>{
  const h=harness();
  try{
    const [a,b]=await Promise.all([
      h.create('Pedidos',order('PED-2026-050','recCotA')),
      h.create('Pedidos',order('PED-2026-050','recCotB')),
    ]);
    assert.equal(a.status,201);
    assert.equal(b.status,409);
    assert.equal((await b.json()).code,'CRM_NUMBER_CONFLICT');
    assert.equal(h.postCount(),1);
    assert.equal(h.records.Pedidos.length,1);
  }finally{h.restore();}
});

test('dos equipos convierten la misma cotización con números distintos y adoptan el mismo registro',async()=>{
  const h=harness();
  try{
    const [a,b]=await Promise.all([
      h.create('Pedidos',order('PED-2026-050','recCotA')),
      h.create('Pedidos',order('PED-2026-051','recCotA')),
    ]);
    assert.equal(a.status,201);
    assert.equal(b.status,200);
    const first=await a.json(),second=await b.json();
    assert.equal(first.id,second.id);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});


test('dos equipos: mismo contrato/mes y N° distintos devuelven el MISMO pedido',async()=>{
  const h=harness();
  try{
    const ret=(num)=>order(num);
    const a=ret('PED-2026-060');a.fields['Notas pedido']='Retainer ret-abc 2026-09';
    const b=ret('PED-2026-061');b.fields['Notas pedido']='Retainer ret-abc 2026-09';
    const [first,second]=await Promise.all([h.create('Pedidos',a),h.create('Pedidos',b)]);
    assert.equal(first.status,201);
    assert.equal(second.status,200);
    assert.equal((await first.json()).id,(await second.json()).id);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});

test('timeout tras crear un contrato: otro equipo lo reconcilia aun con N° diferente',async()=>{
  const h=harness({throwFirst:true});
  try{
    const a=order('PED-2026-070');a.fields['Notas pedido']='Retainer ret-abc 2026-09';
    const b=order('PED-2026-071');b.fields['Notas pedido']='Retainer ret-abc 2026-09';
    assert.equal((await h.create('Pedidos',a)).status,503);
    const res=await h.create('Pedidos',b);
    assert.equal(res.status,200);
    assert.equal((await res.json()).id,h.records.Pedidos[0].id);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});

test('un contrato incierto sin alta visible bloquea otro N° del mismo mes',async()=>{
  const h=harness({throwFirst:true,failWithoutCommit:true});
  try{
    const a=order('PED-2026-080');a.fields['Notas pedido']='Retainer ret-abc 2026-09';
    const b=order('PED-2026-081');b.fields['Notas pedido']='Retainer ret-abc 2026-09';
    assert.equal((await h.create('Pedidos',a)).status,503);
    const res=await h.create('Pedidos',b);
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'CRM_PENDING_RECONCILIATION');
    assert.equal(h.postCount(),1);
    assert.ok(h.map.has('pending:retainer:Retainer ret-abc 2026-09'));
  }finally{h.restore();}
});

test('rechazo 422 confirmado libera la reserva del contrato recurrente',async()=>{
  const h=harness({reject422:true});
  try{
    const r=order('PED-2026-090');r.fields['Notas pedido']='Retainer ret-abc 2026-09';
    assert.equal((await h.create('Pedidos',r)).status,422);
    assert.equal(h.map.has('pending:retainer:Retainer ret-abc 2026-09'),false);
    assert.equal((await h.create('Pedidos',r)).status,201);
    assert.equal(h.postCount(),2);
  }finally{h.restore();}
});

test('las cotizaciones también se serializan en la misma instancia global',async()=>{
  const h=harness();
  try{
    const body={fields:{'N° Cotización':'260950','Estado cotización':'Enviada'}};
    const [a,b]=await Promise.all([h.create('Cotizaciones',body),h.create('Cotizaciones',body)]);
    assert.equal(a.status,201);
    assert.equal(b.status,409);
    assert.equal(h.records.Cotizaciones.length,1);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});

test('un POST de resultado incierto con registro creado se reconcilia sin duplicar',async()=>{
  const h=harness({throwFirst:true});
  try{
    const a=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(a.status,503);
    const b=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(b.status,200);
    assert.equal((await b.json()).id,h.records.Pedidos[0].id);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});

test('un POST incierto sin registro visible conserva una reserva que bloquea el reintento',async()=>{
  const h=harness({throwFirst:true,failWithoutCommit:true});
  try{
    const a=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(a.status,503);
    const b=await h.create('Pedidos',order('PED-2026-052','recCotA'));
    assert.equal(b.status,503);
    assert.equal((await b.json()).code,'CRM_PENDING_RECONCILIATION');
    assert.equal(h.postCount(),1);
    assert.ok(h.map.has('pending:cot:recCotA'));
  }finally{h.restore();}
});

test('un 422 confirmado libera la reserva para corregir el esquema y reintentar',async()=>{
  const h=harness({reject422:true});
  try{
    const a=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(a.status,422);
    assert.equal(h.map.has('pending:cot:recCotA'),false);
    const b=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(b.status,201);
    assert.equal(h.postCount(),2);
  }finally{h.restore();}
});

test('si falla el GET autoritativo, jamás se ejecuta un POST',async()=>{
  const h=harness({badRead:true});
  try{
    const a=await h.create('Pedidos',order('PED-2026-051','recCotA'));
    assert.equal(a.status,503);
    assert.equal(h.postCount(),0);
  }finally{h.restore();}
});

test('el Worker no permite POST directo si falta el Durable Object',async()=>{
  const old=global.fetch;
  let calls=0;global.fetch=async()=>{calls++;throw Error('should not fetch Airtable');};
  try{
    const req=new Request('https://proxy.test/app1YtD74AqiPWQhy/Pedidos',{
      method:'POST',headers:{Origin:ORIGIN,'X-App-Key':ENV.APP_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(order('PED-2026-052','recCotA'))
    });
    const resp=await worker.fetch(req,ENV,undefined);
    assert.equal(resp.status,503);
    assert.equal(calls,0);
  }finally{global.fetch=old;}
});

test('el Worker delega los POST al guard y conserva la respuesta idempotente',async()=>{
  const h=harness();
  try{
    const routeEnv={...ENV,CRM_MUTATION_GUARD:{
      idFromName:(name)=>{assert.equal(name,'tls-crm-global');return 'the-single-global-guard';},
      get:()=>({fetch:(url,init)=>h.guard.fetch(new Request(url,init))}),
    }};
    const req=new Request('https://proxy.test/app1YtD74AqiPWQhy/Pedidos',{
      method:'POST',headers:{Origin:ORIGIN,'X-App-Key':ENV.APP_KEY,'Content-Type':'application/json'},
      body:JSON.stringify(order('PED-2026-053','recCotA'))
    });
    const resp=await worker.fetch(req,routeEnv,undefined);
    assert.equal(resp.status,201);
    assert.equal((await resp.json()).id,h.records.Pedidos[0].id);
    assert.equal(resp.headers.get('Access-Control-Allow-Origin'),ORIGIN);
    assert.equal(h.postCount(),1);
  }finally{h.restore();}
});
