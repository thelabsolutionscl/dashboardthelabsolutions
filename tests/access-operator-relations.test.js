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
  .replace('export default','const worker=');
const {operatorCrmRelationPreflight,CrmMutationGuard}=new Function(source+
  '\nreturn {operatorCrmRelationPreflight,CrmMutationGuard};')();

const oldFetch=global.fetch;
test.after(()=>{global.fetch=oldFetch;});

const clientA='recAAAAAAAAAAAAAA';
const clientB='recBBBBBBBBBBBBBB';
const quoteA='recCCCCCCCCCCCCCC';
const quoteB='recDDDDDDDDDDDDDD';
const orderA='recEEEEEEEEEEEEEE';
const orderB='recFFFFFFFFFFFFFF';
const BASE='/v0/app1YtD74AqiPWQhy/';

function dbFixture(){
  const db={
    Clientes:new Map([
      [clientA,{id:clientA,fields:{Empresa:'Cliente A'}}],
      [clientB,{id:clientB,fields:{Empresa:'Cliente B'}}]
    ]),
    Cotizaciones:new Map([
      [quoteA,{id:quoteA,fields:{'N° Cotización':'260901',Cliente:[clientA],Pedido:[orderA]}}],
      [quoteB,{id:quoteB,fields:{'N° Cotización':'260902',Cliente:[clientA],Pedido:[]}}]
    ]),
    Pedidos:new Map([
      [orderA,{id:orderA,fields:{'N° Pedido':'PED-1',Cliente:[clientA],Cotizaciones:[quoteA]}}],
      [orderB,{id:orderB,fields:{'N° Pedido':'PED-2',Cliente:[clientA],Cotizaciones:[]}}]
    ])
  };
  const calls=[];
  global.fetch=async(uri,opts={})=>{
    const url=new URL(String(uri));
    assert.equal(url.hostname,'api.airtable.com');
    const method=opts.method||'GET';
    const parts=url.pathname.slice(BASE.length).split('/');
    const table=decodeURIComponent(parts[0]);
    calls.push({method,table,url:url.toString(),body:opts.body});
    if(method==='GET'){
      const store=db[table];
      if(!store)throw Error('Unexpected table '+table);
      if(parts[1]){
        const row=store.get(parts[1]);
        return row?Response.json(structuredClone(row)):
          Response.json({error:'NOT_FOUND'},{status:404});
      }
      const formula=url.searchParams.get('filterByFormula')||'';
      const wanted=[...new Set(formula.match(/rec[A-Za-z0-9]{14}/g)||[])];
      const records=wanted.map(id=>store.get(id)).filter(Boolean).map(row=>structuredClone(row));
      return Response.json({records});
    }
    if(method==='PATCH'){
      const store=db[table],id=parts[1],body=JSON.parse(opts.body);
      if(id){
        const row=store.get(id);
        if(!row)return Response.json({error:'NOT_FOUND'},{status:404});
        Object.assign(row.fields,body.fields);
        return Response.json(structuredClone(row));
      }
      for(const item of body.records){
        const row=store.get(item.id);
        if(row)Object.assign(row.fields,item.fields);
      }
      return Response.json({records:body.records.map(x=>structuredClone(store.get(x.id)))});
    }
    if(method==='POST'){
      return Response.json({id:'recGGGGGGGGGGGGGG',fields:JSON.parse(opts.body).fields});
    }
    throw Error('Unexpected method '+method);
  };
  return {db,calls,env:{AIRTABLE_TOKEN:'pat-test'}};
}

test('valid operator quote/order relationships pass preflight',async()=>{
  const f=dbFixture();
  let result=await operatorCrmRelationPreflight('Cotizaciones',[{fields:{
    'N° Cotización':'260999',Cliente:[clientA]
  }}],f.env,{creating:true});
  assert.equal(result.ok,true);

  result=await operatorCrmRelationPreflight('Pedidos',[{fields:{
    'N° Pedido':'PED-NEW',Cliente:[clientA],Cotizaciones:[quoteB]
  }}],f.env,{creating:true});
  assert.equal(result.ok,true);
});

test('create requires exactly one existing client and same-client linked records',async()=>{
  for(const [table,fields,code] of [
    ['Cotizaciones',{'N° Cotización':'260999'},'CRM_RELATION_INVALID'],
    ['Cotizaciones',{'N° Cotización':'260999',Cliente:['recZZZZZZZZZZZZZZ']},'CRM_RELATION_INVALID'],
    ['Pedidos',{'N° Pedido':'PED-X',Cliente:[clientB],Cotizaciones:[quoteB]},'CRM_RELATION_INVALID'],
    ['Pedidos',{'N° Pedido':'PED-X',Cliente:[clientA],Cotizaciones:['recZZZZZZZZZZZZZZ']},'CRM_RELATION_INVALID']
  ]){
    const f=dbFixture();
    const result=await operatorCrmRelationPreflight(table,[{fields}],f.env,{creating:true});
    assert.equal(result.ok,false,table+' '+JSON.stringify(fields));
    assert.equal(result.code,code);
    assert.equal(result.status,422);
  }
});

test('operator cannot reuse a quotation that is already assigned to an order',async()=>{
  const f=dbFixture();
  const result=await operatorCrmRelationPreflight('Pedidos',[{fields:{
    'N° Pedido':'PED-NEW',Cliente:[clientA],Cotizaciones:[quoteA]
  }}],f.env,{creating:true});
  assert.equal(result.ok,false);
  assert.equal(result.status,422);
  assert.match(result.error,/already assigned/i);
});

test('operator relation PATCH cannot cross clients, move a linked quote or detach order quotes',async()=>{
  let f=dbFixture();
  let result=await operatorCrmRelationPreflight('Cotizaciones',[{
    id:quoteA,fields:{Cliente:[clientB]}
  }],f.env,{creating:false});
  assert.equal(result.ok,false);
  assert.match(result.error,/different client/i);

  f=dbFixture();
  result=await operatorCrmRelationPreflight('Cotizaciones',[{
    id:quoteA,fields:{Pedido:[orderB]}
  }],f.env,{creating:false});
  assert.equal(result.ok,false);
  assert.match(result.error,/cannot reassign/i);

  f=dbFixture();
  result=await operatorCrmRelationPreflight('Pedidos',[{
    id:orderA,fields:{Cotizaciones:[]}
  }],f.env,{creating:false});
  assert.equal(result.ok,false);
  assert.match(result.error,/cannot detach/i);
});

test('operator can append an unassigned same-client quote to an existing order',async()=>{
  const f=dbFixture();
  const result=await operatorCrmRelationPreflight('Pedidos',[{
    id:orderA,fields:{Cotizaciones:[quoteA,quoteB]}
  }],f.env,{creating:false});
  assert.equal(result.ok,true);
});

test('non-relation PATCH does not add Airtable verification traffic',async()=>{
  const f=dbFixture();
  const result=await operatorCrmRelationPreflight('Pedidos',[{
    id:orderA,fields:{'Notas pedido':'texto'}
  }],f.env,{creating:false});
  assert.equal(result.ok,true);
  assert.equal(f.calls.length,0);
});

test('relation verification fails closed when Airtable cannot be verified',async()=>{
  const f=dbFixture();
  global.fetch=async()=>Response.json({error:'down'},{status:503});
  const result=await operatorCrmRelationPreflight('Pedidos',[{fields:{
    'N° Pedido':'PED-X',Cliente:[clientA],Cotizaciones:[quoteB]
  }}],f.env,{creating:true});
  assert.equal(result.ok,false);
  assert.equal(result.status,503);
  assert.equal(result.code,'CRM_RELATION_VERIFY_UNAVAILABLE');
});

function storage(){
  const map=new Map();
  return {async get(k){return map.get(k)},async put(k,v){map.set(k,v)},async delete(k){map.delete(k)}};
}

test('Durable Object blocks an invalid operator relationship before PATCH reaches Airtable',async()=>{
  const f=dbFixture();
  const guard=new CrmMutationGuard({storage:storage()},f.env);
  const payload={
    table:'Pedidos',method:'PATCH',actor:{role:'operator',email:'operator@example.com'},
    path:BASE+'Pedidos/'+orderA,search:'',
    body:JSON.stringify({fields:{Cliente:[clientB]}})
  };
  const response=await guard.fetch(new Request('https://crm-write.internal/scoped-patch',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  }));
  assert.equal(response.status,422,await response.clone().text());
  assert.equal(f.calls.some(c=>c.method==='PATCH'),false);
});

test('Durable Object blocks an operator create without a verified client before POST',async()=>{
  const f=dbFixture();
  const guard=new CrmMutationGuard({storage:storage()},f.env);
  const response=await guard.fetch(new Request('https://crm-write.internal/create',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      table:'Cotizaciones',search:'',actor:{role:'operator',email:'operator@example.com'},
      body:{fields:{'N° Cotización':'260999','Total final (CLP)':50000}}
    })
  }));
  assert.equal(response.status,422,await response.clone().text());
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
});
