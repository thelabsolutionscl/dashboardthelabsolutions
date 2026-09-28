#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const workerSource=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8');
const {CrmWriteGuard, worker}=new Function(workerSource
  .replaceAll('export class ', 'class ')
  .replace('export default', 'const __worker =')+
  '\nreturn { CrmWriteGuard, worker: __worker };')();
const CURRENT_YEAR=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago'}).format(new Date()).slice(0,4);
const BASE='app1YtD74AqiPWQhy';
const APP_KEY='local-test-credential-not-production';
const ORIGIN='https://dashboard.thelab.solutions';

function fixture({failGet=false,postErrorAfterCreate=false,badGet=false,rejectFirstPost=false}={}){
  const memory=new Map(), writes=[], state={Pedidos:[],Cotizaciones:[]};
  let firstPostRejected=false, postErrorConsumed=false;
  const storage={
    get:async key=>memory.get(key),
    put:async (key,value)=>memory.set(key,value),
    delete:async key=>memory.delete(key)
  };
  const env={AIRTABLE_TOKEN:'pat-testing-only',APP_KEY,AI_BUDGET_GUARD:null};
  const guard=new CrmWriteGuard({storage},env);
  const original=global.fetch;
  global.fetch=async(raw,opts={})=>{
    const u=new URL(String(raw));
    assert.equal(u.hostname,'api.airtable.com');
    const t=decodeURIComponent(u.pathname.split('/').at(-1));
    if(opts.method==='POST'){
      if(rejectFirstPost&&!firstPostRejected){
        firstPostRejected=true;
        return new Response(JSON.stringify({error:{message:'Unknown field'}}),{status:422});
      }
      const incoming=JSON.parse(opts.body);
      assert.ok(['Pedidos','Cotizaciones'].includes(t));
      const record={id:'rec'+String(state[t].length+1).padStart(14,'0'),fields:incoming.fields};
      writes.push({table:t,record});
      state[t].push(record);
      if(postErrorAfterCreate&&!postErrorConsumed){
        postErrorConsumed=true;
        throw new Error('ECONNRESET after creation');
      }
      return new Response(JSON.stringify(record),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(failGet)return new Response('{}',{status:503});
    if(badGet)return new Response('{"success":true}',{status:200});
    if(!state[t])throw new Error('Unexpected GET '+u.pathname);
    return new Response(JSON.stringify({records:state[t]}),{status:200});
  };
  const restore=()=>{global.fetch=original;};
  const post=async(table,fields,requestId)=>guard.fetch(new Request('https://crm.internal/create',{
    method:'POST',body:JSON.stringify({table,payload:{fields,typecast:true},requestId}),
    headers:{'Content-Type':'application/json'}
  }));
  return {env,guard,state,writes,memory,post,restore,storage};
}

test('dos computadores creando pedidos al mismo tiempo reciben correlativos únicos',async()=>{
  const f=fixture();
  try{
    const fields={'N° Pedido':'PED-'+CURRENT_YEAR+'-001','Estado pedido':'Confirmado'};
    const [a,b]=await Promise.all([
      f.post('Pedidos',fields,'crm:computer-1'),
      f.post('Pedidos',fields,'crm:computer-2')
    ]);
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    const records=[await a.json(),await b.json()];
    assert.deepEqual(records.map(x=>x.fields['N° Pedido']),[
      'PED-'+CURRENT_YEAR+'-001','PED-'+CURRENT_YEAR+'-002'
    ]);
    assert.equal(f.writes.length,2);
    assert.equal(new Set(f.state.Pedidos.map(x=>x.fields['N° Pedido'])).size,2);
  }finally{f.restore();}
});

test('dos computadores convirtiendo la misma cotización solo crean un pedido',async()=>{
  const f=fixture();
  try{
    const fields={'N° Pedido':'PED-'+CURRENT_YEAR+'-001',Cotizaciones:['recCot1234567890']};
    const [a,b]=await Promise.all([
      f.post('Pedidos',fields,'crm:quote:recCot1234567890'),
      f.post('Pedidos',fields,'crm:other-computer')
    ]);
    const [first,second]=await Promise.all([a.json(),b.json()]);
    assert.equal(first.id,second.id);
    assert.equal(f.writes.length,1);
  }finally{f.restore();}
});

test('dos contratos recurrentes del mismo ID/mes generan un solo pedido',async()=>{
  const f=fixture();
  try{
    const fields={'N° Pedido':'PED-'+CURRENT_YEAR+'-001',
      'Notas pedido':'Retainer ret-abc 2026-09'};
    const [a,b]=await Promise.all([
      f.post('Pedidos',fields,'crm:retainer:ret-abc:2026-09'),
      f.post('Pedidos',fields,'crm:retainer:ret-abc:2026-09-copy')
    ]);
    const [first,second]=await Promise.all([a.json(),b.json()]);
    assert.equal(first.id,second.id);
    assert.equal(f.writes.length,1);
  }finally{f.restore();}
});

test('dos cotizaciones simultáneas no reutilizan el número de la copia local',async()=>{
  const f=fixture();
  try{
    const fields={'N° Cotización':'260901','Fecha cotización':'2026-09-28'};
    const [a,b]=await Promise.all([
      f.post('Cotizaciones',fields,'crm:tab-a'),
      f.post('Cotizaciones',fields,'crm:tab-b')
    ]);
    const q1=await a.json(),q2=await b.json();
    assert.deepEqual([q1.fields['N° Cotización'],q2.fields['N° Cotización']],['260901','260902']);
    assert.equal(f.writes.length,2);
  }finally{f.restore();}
});

test('reintento con la MISMA key devuelve el registro sin repetir POST',async()=>{
  const f=fixture();
  try{
    const fields={'N° Pedido':'PED-'+CURRENT_YEAR+'-001'};
    const first=await (await f.post('Pedidos',fields,'crm:repeat-1')).json();
    const again=await (await f.post('Pedidos',fields,'crm:repeat-1')).json();
    assert.equal(first.id,again.id);
    assert.equal(f.writes.length,1);
  }finally{f.restore();}
});

test('después de un corte de red POSPOST se reconcilia en Airtable sin duplicar',async()=>{
  const f=fixture({postErrorAfterCreate:true});
  try{
    const fields={'N° Pedido':'PED-'+CURRENT_YEAR+'-001'};
    const first=await f.post('Pedidos',fields,'crm:timeout');
    assert.equal(first.status,502);
    assert.equal((await first.json()).code,'CRM_AMBIGUOUS_CREATE');
    const second=await f.post('Pedidos',fields,'crm:timeout');
    assert.equal(second.status,200);
    assert.equal(f.writes.length,1);
    assert.equal((await second.json()).id,f.state.Pedidos[0].id);
  }finally{f.restore();}
});

test('si Airtable no permite verificar el máximo no se realiza ningún POST',async()=>{
  const f=fixture({failGet:true});
  try{
    const r=await f.post('Pedidos',{'N° Pedido':'PED-'+CURRENT_YEAR+'-001'},'crm:no-read');
    assert.equal(r.status,503);
    assert.equal((await r.json()).code,'CRM_VERIFY_UNAVAILABLE');
    assert.equal(f.writes.length,0);
  }finally{f.restore();}
});

test('respuesta GET 200 malformada tampoco autoriza una creación',async()=>{
  const f=fixture({badGet:true});
  try{
    const r=await f.post('Cotizaciones',{'N° Cotización':'260901'},'crm:bad-page');
    assert.equal(r.status,503);
    assert.equal(f.writes.length,0);
  }finally{f.restore();}
});

test('rechazo de esquema 422 libera la misma key para fallback controlado',async()=>{
  const f=fixture({rejectFirstPost:true});
  try{
    const fields={'N° Cotización':'260901','Fecha cotización':'2026-09-28'};
    const first=await f.post('Cotizaciones',fields,'crm:schema');
    assert.equal(first.status,422);
    const second=await f.post('Cotizaciones',fields,'crm:schema');
    assert.equal(second.status,200);
    assert.equal(f.writes.length,1);
    assert.equal((await second.json()).fields['N° Cotización'],'260902');
  }finally{f.restore();}
});

test('sin binding del guard el proxy falla cerrado antes de enviar a Airtable',async()=>{
  const f=fixture();
  try{
    const r=await worker.fetch(new Request(
      'https://proxy.workers.dev/'+BASE+'/Pedidos',{
        method:'POST',
        headers:{Origin:ORIGIN,'X-App-Key':APP_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({fields:{'N° Pedido':'PED-'+CURRENT_YEAR+'-001'}}),
      }),f.env,undefined);
    assert.equal(r.status,503);
    assert.equal((await r.json()).code,'CRM_GUARD_UNAVAILABLE');
    assert.equal(f.writes.length,0);
  }finally{f.restore();}
});

test('el proxy enruta altas por el guard sin emitir POST directamente',async()=>{
  const f=fixture();
  try{
    f.env.CRM_WRITE_GUARD={
      idFromName: name=>name,
      get: id=>{assert.equal(id,'crm-global-writes');return {fetch:(url,opts)=>f.guard.fetch(new Request(url,opts))};}
    };
    const r=await worker.fetch(new Request(
      'https://proxy.workers.dev/'+BASE+'/Pedidos',{
        method:'POST',
        headers:{Origin:ORIGIN,'X-App-Key':APP_KEY,'Content-Type':'application/json','X-Crm-Request-Id':'crm:integration'},
        body:JSON.stringify({fields:{'N° Pedido':'PED-'+CURRENT_YEAR+'-001'}}),
      }),f.env,undefined);
    assert.equal(r.status,200);
    assert.equal((await r.json()).fields['N° Pedido'],'PED-'+CURRENT_YEAR+'-001');
    assert.equal(f.writes.length,1);
  }finally{f.restore();}
});
