#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lead-worker/src/index.js'),'utf8');
const begin=source.indexOf('const EXTERNAL_CRM_IMMUTABLE_FIELDS =');
const end=source.indexOf('// Busca un Cliente existente',begin);
const tolerantBegin=source.indexOf('async function airtableCreateTolerant(',end);
const tolerantEnd=source.indexOf('async function unknownFieldFrom(',tolerantBegin);
assert.ok(begin>0&&end>begin&&tolerantBegin>end&&tolerantEnd>tolerantBegin,
  'lead-worker Airtable helper boundaries must exist');
const code=source.slice(begin,end)+'\n'+source.slice(tolerantBegin,tolerantEnd);
const seen=[];
const fetchStub=async (url,opts)=>{
  seen.push({url:String(url),method:opts?.method,body:JSON.parse(opts.body)});
  return Response.json({id:'recAAAAAAAAAAAAAA',fields:JSON.parse(opts.body).fields});
};
const {check,create,update,tolerantCreate,tolerantUpdate}=new Function(
  'fetch','AIRTABLE_API','airtableErr','unknownFieldFrom','sleep',
  code+'\nreturn {check:assertExternalCrmOwnershipImmutable,'+
  'create:airtableCreate,update:airtableUpdate,'+
  'tolerantCreate:airtableCreateTolerant,tolerantUpdate:airtableUpdateTolerant};'
)(fetchStub,'https://api.airtable.com/v0',
  async()=> 'upstream error',async()=>null,async()=>{});
const env={AIRTABLE_BASE_ID:'app1YtD74AqiPWQhy',AIRTABLE_TOKEN:'TEST_PAT'};
const row='recAAAAAAAAAAAAAA';
const forbidden={
  Clientes:['Vendedor','Pedidos','Cotizaciones',
    'fldT2NeOO6YjQgVns','fldG06Nnt8AUYYhsJ','fldhKmcjZOeFFhaDM'],
  Cotizaciones:['Vendedor','Cliente','Pedido',
    'flde5UJLkiJzXLd4l','fldGBITDrhh7l5Ktd','fldbSn3RCRCKh4HSm'],
  Pedidos:['Vendedor','Cliente','Cotizaciones',
    'fldftHk62GM6kzPSt','fldDxnFAs3sjM4IMy','fldoLYes7JqA6cowK']
};
test('every live Airtable owner/relationship field name and ID is immutable in external CRM helpers',async()=>{
  for(const [table,names] of Object.entries(forbidden)){
    for(const field of names){
      const fields={[field]:field==='Vendedor'?'gustavo':['recBBBBBBBBBBBBBB']};
      const start=seen.length;
      for(const call of [
        ()=>create(env,table,fields),
        ()=>update(env,table,row,fields),
        ()=>tolerantCreate(env,table,fields,1),
        ()=>tolerantUpdate(env,table,row,fields,1)
      ]){
        await assert.rejects(call(),/owner and relationship changes are forbidden/,
          table+'/'+field);
      }
      assert.equal(seen.length,start,table+'/'+field+' reached Airtable unexpectedly');
    }
  }
});
test('ordinary lead, existing-customer, portal decision, NPS and POD writes still work',async()=>{
  const normal=[
    ['Clientes',{Empresa:'Acme',Email:'contacto@example.com',
      'Fecha primer contacto':'2026-09-29','Notas internas':'recibido'}],
    ['Clientes',{'Servicio interés':'Premiación','Cargo contacto':'Ventas',
      GCLID:'test','Campaña Ads':'test'}],
    ['Cotizaciones',{'Estado cotización':'Rechazada',
      'Notas cotización':'Comentario del cliente'}],
    ['Pedidos',{'NPS score':5,'NPS fecha':'2026-09-29'}],
    ['Pedidos',{'Recepción confirmada':true,'Recepción fecha':'2026-09-29'}],
    ['Agent_Queue',{Estado:'Procesando'}],
  ];
  for(const [table,fields] of normal){
    const count=seen.length;
    assert.doesNotThrow(()=>check(table,fields));
    const updated=await tolerantUpdate(env,table,row,fields,1);
    assert.equal(updated.id,row);
    assert.equal(seen.length,count+1);
    assert.deepEqual(seen.at(-1).body.fields,fields);
    assert.equal(seen.at(-1).method,'PATCH');
  }
  const count=seen.length;
  const created=await tolerantCreate(env,'Clientes',{Empresa:'Nuevo',Email:'test@example.com'},1);
  assert.equal(created.id,row);
  assert.equal(seen.length,count+1);
  assert.equal(seen.at(-1).method,'POST');
});
test('invalid CRM mutation payloads fail before an upstream request',()=>{
  for(const table of Object.keys(forbidden)){
    for(const payload of [null,[],false,'Vendedor']){
      assert.throws(()=>check(table,payload),/Invalid external CRM mutation fields/);
    }
  }
});
test('all generic create, basic PATCH and tolerant PATCH paths check the same owner guard',()=>{
  const positions=[
    /async function airtableCreate\(env, table, fields\)\s*{\s*assertExternalCrmOwnershipImmutable\(table, fields\);/,
    /async function airtableUpdate\(env, table, recordId, fields\)\s*{\s*assertExternalCrmOwnershipImmutable\(table, fields\);/,
    /async function airtableUpdateTolerant\(env, table, recordId, fields, maxTries = 8\)\s*{\s*assertExternalCrmOwnershipImmutable\(table, fields\);/
  ];
  for(const pattern of positions)assert.match(source,pattern);
  // The tolerant create helper always funnels through the guarded create.
  assert.match(source,/async function airtableCreateTolerant[\s\S]*?const r = await airtableCreate\(env, table, f\);/);
});
