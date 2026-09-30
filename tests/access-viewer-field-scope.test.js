#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const authSource=fs.readFileSync(path.join(root,'airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows,ACCESS_VIEWER_TABLES}=
  new Function(authSource+'\nreturn {accessAllows,ACCESS_VIEWER_TABLES};')();
const source=fs.readFileSync(path.join(root,'airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {worker,VIEWER_READ_FIELDS}=new Function(source+'\nreturn {worker,VIEWER_READ_FIELDS};')();
const BASE='/v0/app1YtD74AqiPWQhy/';
const id='recAAAAAAAAAAAAAA';
global.accessAuthorize=async()=>({identity:{role:'viewer',email:'readonly@example.com'}});
const prior=global.fetch;
test.after(()=>{global.fetch=prior;});
function fixture(reply,options={}){
  const env={APP_KEY:'public-test',AIRTABLE_TOKEN:'secret-private'};
  const calls=[];
  global.fetch=async (url,opts)=>{
    calls.push({url:String(url),opts});
    assert.equal(opts.headers.Authorization,'Bearer '+env.AIRTABLE_TOKEN);
    assert.equal(opts.redirect,'manual');
    return typeof reply==='function'?reply(url,opts):Response.json(reply);
  };
  async function run(endpoint,method='GET'){
    const request=new Request('https://proxy.example.com'+endpoint,{
      method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY}
    });
    const r=await worker.fetch(request,env,{waitUntil:()=>{}});
    return {status:r.status,body:await r.json(),headers:r.headers};
  }
  return {run,calls};
}
function row(fields){return {id,createdTime:'2026-09-29T12:00:00.000Z',fields};}
test('viewer table catalog denies unreviewed systems; operator and admin retain existing authorizations',()=>{
  const reviewed=['Clientes','Cotizaciones','Pedidos','Proveedores',
    'Maquinas','Maquinas_Mant','Maquinas_Eventos'];
  assert.deepEqual([...ACCESS_VIEWER_TABLES].sort(),reviewed.sort());
  for(const table of reviewed){
    assert.equal(accessAllows({role:'viewer'},'GET',BASE+table),true);
    assert.equal(accessAllows({role:'viewer'},'GET',BASE+table+'/'+id),true);
    for(const method of ['POST','PATCH','DELETE'])
      assert.equal(accessAllows({role:'viewer'},method,BASE+table),false);
  }
  for(const table of ['Inventario','Monitor%20Sistema','Equipo_Eventos',
    'Facturas','Agent_Log','Reportes','Google_Ads_KPIs']){
    assert.equal(accessAllows({role:'viewer'},'GET',BASE+table),false,table);
  }
  assert.equal(accessAllows({role:'operator'},'GET',BASE+'Monitor%20Sistema'),true);
  assert.equal(accessAllows({role:'admin'},'GET',BASE+'Agent_Log'),true);
});
test('viewer catalog contains only live-reviewed fields and rejects dangerous columns',()=>{
  const forbidden={
    Clientes:['Datos pago / banco','Facturas vencidas','Revenue total cliente (CLP)',
      'RUT','FINANZAS - Ventas','Historial conversación','Adjuntos','Resumen IA'],
    Cotizaciones:['Margen real (%)','Subtotal (CLP)','Total final (CLP)','Detalle JSON',
      'Detalle productos','Ficha Propuesta','Descuento (%)'],
    Pedidos:['Costo real total (CLP)','Costo mano de obra (CLP)','Costo material real (CLP)',
      'Análisis FINANCE_AGENT','Anticipo pagado (50%)','N° documento tributario',
      'Factura URL','Adjuntos'],
    Maquinas:['ip','cam','WA: estado notificado'],
    Proveedores:['Condiciones de pago','RUT','Notas','Motivo evaluación']
  };
  for(const [table,fields] of Object.entries(forbidden)){
    for(const field of fields)
      assert.equal(VIEWER_READ_FIELDS[table].has(field),false,table+' '+field);
  }
});
test('viewer list projects only safe fields even if upstream unexpectedly returns confidential data',async()=>{
  for(const [table,shown,hidden] of [
    ['Clientes','Empresa','Datos pago / banco'],
    ['Cotizaciones','N° Cotización','Margen real (%)'],
    ['Pedidos','N° Pedido','Costo real total (CLP)'],
    ['Proveedores','Nombre','Condiciones de pago'],
    ['Maquinas','nombre','ip'],
    ['Maquinas_Eventos','maquina_id','pedido_id'],
    ['Maquinas_Mant','maquina_id','notas']
  ]){
    const f=fixture({records:[row({[shown]:'safe',[hidden]:'secret',FUTURE_SECRET:'secret'})],
      offset:'next-page',admin_email:'private'});
    const {status,body,headers}=await f.run(BASE+table+'?pageSize=20');
    assert.equal(status,200,table);
    assert.equal(body.records[0].fields[shown],'safe',table);
    assert.equal(Object.hasOwn(body.records[0].fields,hidden),false,table);
    assert.equal(Object.hasOwn(body.records[0].fields,'FUTURE_SECRET'),false);
    assert.equal(body.admin_email,undefined);
    assert.equal(body.offset,'next-page');
    assert.equal(headers.get('Cache-Control'),'private, no-store');
    assert.equal(f.calls.length,1);
    const q=new URL(f.calls[0].url).searchParams;
    assert.ok(q.getAll('fields[]').includes(shown));
    assert.equal(q.getAll('fields[]').includes(hidden),false);
    assert.equal(q.get('pageSize'),'20');
  }
});
test('viewer direct record reads also project, with no hidden financial fields or arbitrary query',async()=>{
  const f=fixture(row({Empresa:'Acme','Datos pago / banco':'private',
    'Revenue total cliente (CLP)':1234,FutureSecret:'private'}));
  let x=await f.run(BASE+'Clientes/'+id);
  assert.equal(x.status,200);
  assert.deepEqual(x.body.fields,{Empresa:'Acme'});
  assert.equal(x.body.id,id);
  x=await f.run(BASE+'Clientes/'+id+'?returnFieldsByFieldId=true');
  assert.equal(x.status,422);
  assert.equal(f.calls.length,1);
});
test('hidden-field inference via formula, view, sort or unreviewed field is denied before upstream',async()=>{
  for(const suffix of [
    '?filterByFormula='+encodeURIComponent("{Datos pago / banco}!=''"),
    '?sort[0][field]='+encodeURIComponent('Costo real total (CLP)'),
    '?view=Private','?fields[]='+encodeURIComponent('Datos pago / banco'),
    '?returnFieldsByFieldId=true','?fields[]=Empresa&fields[]=Empresa',
    '?pageSize=101','?maxRecords=501',
    '?offset=valid&offset=other'
  ]){
    const f=fixture({records:[]});
    const x=await f.run(BASE+'Clientes'+suffix);
    assert.equal(x.status,422,suffix);
    assert.equal(f.calls.length,0,suffix);
  }
  const u=fixture({records:[]});
  const x=await u.run(BASE+'Monitor%20Sistema');
  assert.equal(x.status,403);
  assert.equal(u.calls.length,0);
});
test('explicit safe fields cannot be expanded upstream',async()=>{
  const f=fixture({records:[row({Empresa:'Acme',Vendedor:'nicanor',
    'Datos pago / banco':'confidential'})]});
  const x=await f.run(BASE+'Clientes?fields[]=Empresa');
  assert.equal(x.status,200);
  assert.equal(x.body.records[0].fields['Datos pago / banco'],undefined);
  assert.deepEqual(new URL(f.calls[0].url).searchParams.getAll('fields[]'),['Empresa']);
});
test('malformed, redirected and unavailable upstream returns no content',async()=>{
  for(const reply of [
    {records:[{id,fields:null}]},
    {records:[row({Empresa:'A'})],offset:123},
    {records:[row({Empresa:'A'}),{id:'foreign-id',fields:{Empresa:'B'}}]},
    ()=>new Response('not-json',{status:200}),
    ()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}),
    ()=>Promise.reject(new Error('network'))
  ]){
    const f=fixture(reply);
    const x=await f.run(BASE+'Clientes');
    assert.equal(x.status,502);
    assert.equal(x.body.records,undefined);
    assert.equal(f.calls.length,1);
  }
});
test('viewer does not cross into unreviewed generic Airtable tables through encoded aliases',async()=>{
  const f=fixture({records:[row({Empresa:'Acme'})]});
  for(const path of [BASE+'tblKCNnXwAfDiKbQz',BASE+'Clientes/nested',
    BASE+'%43lientes',BASE+'Clientes/'+id+'/attachments',
    '/v0/meta/bases/app1YtD74AqiPWQhy/tables',BASE+'Monitor%20Sistema']){
    const x=await f.run(path);
    assert.ok(x.status>=400,path);
  }
  assert.equal(f.calls.length,0);
});
