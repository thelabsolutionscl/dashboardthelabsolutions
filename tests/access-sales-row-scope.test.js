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
const user={email:'vendedor@example.com',role:'sales',seller:'nicanor'};
global.accessAuthorize=async()=>({identity:user});
const {worker,sellerScopedRead}=new Function(code+'\nreturn {worker,sellerScopedRead};')();
const base='/v0/app1YtD74AqiPWQhy/';
const env={AIRTABLE_TOKEN:'private-test-airtable-pat',APP_KEY:'public-test-app-key'};
const originalFetch=global.fetch;
test.after(()=>{global.fetch=originalFetch;});
function req(path,opts={}){
  return new Request('https://proxy.example.com'+path,{
    method:opts.method||'GET',
    headers:{Origin:opts.origin||'https://dashboard.thelab.solutions',
      'X-App-Key':opts.key||env.APP_KEY},
    ...opts
  });
}
function record(id,seller='nicanor'){
  return {id,fields:{Empresa:'Prueba',Vendedor:seller}};
}
const own=record('recAAAAAAAAAAAAAA'),other=record('recBBBBBBBBBBBBBB','florencia'),
  unassigned=record('recCCCCCCCCCCCCCC',undefined);
unassigned.fields.Vendedor=null;
async function browse(path,respond,options){
  const calls=[];
  global.fetch=async (target,opts)=>{
    calls.push({url:String(target),method:opts.method,redirect:opts.redirect,headers:opts.headers});
    assert.equal(opts.headers.Authorization,'Bearer '+env.AIRTABLE_TOKEN);
    return typeof respond==='function'?respond(target,opts):Response.json(respond);
  };
  const response=await worker.fetch(req(path,options),env,{waitUntil:()=>{}});
  return {response,body:await response.clone().json(),calls};
}
test('signed salesperson only sees records with matching server-side Vendedor formula',async()=>{
  for(const table of ['Clientes','Cotizaciones','Pedidos']){
    const h=await browse(base+table,
      {records:[own],offset:'itr_5test'});
    assert.equal(h.response.status,200);
    assert.equal(h.body.records.length,1);
    assert.equal(h.body.offset,'itr_5test');
    assert.equal(h.response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(h.calls.length,1);
    const up=new URL(h.calls[0].url);
    assert.equal(up.pathname,base+table);
    assert.equal(up.searchParams.get('filterByFormula'),'{Vendedor}="nicanor"');
    assert.equal(h.calls[0].method,'GET');
    assert.equal(h.calls[0].redirect,'manual');
  }
});
test('field projection supports approved columns, always requests Vendedor and preserves paging',async()=>{
  const params=new URLSearchParams();
  params.set('pageSize','75');
  params.append('fields[]','Estado pedido');
  const h=await browse(base+'Pedidos?'+params,{records:[own]});
  assert.equal(h.response.status,200);
  const upstream=new URL(h.calls[0].url).searchParams;
  assert.equal(upstream.get('filterByFormula'),'{Vendedor}="nicanor"');
  assert.deepEqual(upstream.getAll('fields[]'),['Estado pedido','Vendedor']);
  assert.equal(upstream.get('pageSize'),'75');
  const all=await browse(base+'Clientes',{records:[own]});
  const columns=new URL(all.calls[0].url).searchParams.getAll('fields[]');
  assert.ok(columns.includes('Empresa'));
  assert.ok(columns.includes('Vendedor'));
  assert.ok(!columns.includes('Datos pago / banco'));
  assert.ok(!columns.includes('Facturas vencidas'));
  assert.ok(!columns.includes('FINANZAS - Ventas'));
  assert.ok(!columns.includes('Pedidos'),'unverified linked record IDs must not leak');
});
test('owned sales data is projected: bank details, margins and production costs never leave the proxy',async()=>{
  const restricted={
    Clientes:['Datos pago / banco','Facturas vencidas','Revenue total cliente (CLP)',
      'FINANZAS - Ventas','Pedidos','Cotizaciones','Adjuntos'],
    Cotizaciones:['Margen real (%)','Detalle JSON','Detalle productos','Ficha Propuesta',
      'Cliente','Pedido','Adjuntos'],
    Pedidos:['Costo real total (CLP)','Costo material real (CLP)',
      'Costo mano de obra (CLP)','Análisis FINANCE_AGENT','Factura URL',
      'Cliente','Cotizaciones','Adjuntos','Anticipo pagado (50%)']
  };
  for(const table of Object.keys(restricted)){
    const fields={Empresa:'Own client','N° Cotización':'COT-123','N° Pedido':'PED-123',
      'Notas internas':'Visible note','Notas cotización':'Visible quote note',
      Vendedor:'nicanor'};
    for(const key of restricted[table])
      fields[key]=key==='Cliente'||key==='Cotizaciones'||key==='Pedido'?
        ['recBBBBBBBBBBBBBB']:'TOP SECRET';
    const upstream={records:[{id:own.id,fields,createdTime:'2026-09-29T12:00:00Z',
      secret:'row-secret'}],offset:'next_cursor',secret:'page-secret'};
    const h=await browse(base+table,upstream);
    assert.equal(h.response.status,200,table);
    assert.equal(h.body.secret,undefined,table+' top-level');
    assert.equal(h.body.offset,'next_cursor');
    const row=h.body.records[0];
    assert.equal(row.secret,undefined,table+' row');
    assert.equal(row.fields.Vendedor,'nicanor');
    for(const key of restricted[table])
      assert.ok(!Object.hasOwn(row.fields,key),table+' leaked '+key);
    for(const name of Object.keys(row.fields))
      assert.ok(['Empresa','N° Cotización','N° Pedido','Notas internas',
        'Notas cotización','Vendedor'].includes(name),'unknown field leaked: '+name);
    const single=await browse(base+table+'/'+own.id,upstream.records[0]);
    assert.equal(single.response.status,200);
    assert.deepEqual(single.body,row,'record-by-ID must have the same projection');
  }
});
test('sales cannot probe hidden field values using filters, sort order, views or field projection',async()=>{
  for(const params of [
    'filterByFormula='+encodeURIComponent('{Datos pago / banco}!=""'),
    'filterByFormula='+encodeURIComponent('{Margen real (%)}>0'),
    'sort[0][field]=Costo+real+total+%28CLP%29',
    'sort[0][direction]=desc',
    'view=Financial+Clients',
    'fields%5B%5D='+encodeURIComponent('Datos pago / banco'),
    'fields%5B%5D='+encodeURIComponent('Margen real (%)'),
    'fields%5B%5D='+encodeURIComponent('Detalle JSON'),
    'fields%5B%5D='+encodeURIComponent('Cliente'),
    'fields%5B%5D=Vendedor&fields%5B%5D=Vendedor&'+'fields%5B%5D=x'
  ]){
    const h=await browse(base+'Clientes?'+params,{records:[own]});
    assert.equal(h.response.status,422,params);
    assert.equal(h.calls.length,0,'no upstream fetch for hidden-field probes');
  }
  const page=await browse(base+'Clientes?pageSize=25&maxRecords=50&offset=itr_test',
    {records:[own]});
  assert.equal(page.response.status,200);
  assert.equal(new URL(page.calls[0].url).searchParams.get('offset'),'itr_test');
});
test('a malformed or noncompliant upstream never leaks another salesperson or an unassigned customer',async()=>{
  for(const reply of [
    {records:[own,other]},{records:[own,unassigned]},
    {records:[{id:own.id,fields:{Empresa:'No owner'}}]},
    {records:'corrupted'},{}
  ]){
    const h=await browse(base+'Clientes',reply);
    assert.equal(h.response.status,502);
    assert.equal(h.body.records,undefined);
    assert.equal(h.body.error,'Scoped sales integrity error');
  }
});
test('single-record reads check owner; foreign, missing and unassigned records return indistinguishable 404',async()=>{
  let h=await browse(base+'Clientes/'+own.id,own);
  assert.equal(h.response.status,200);
  assert.equal(h.body.id,own.id);
  h=await browse(base+'Clientes/'+other.id,other);
  assert.equal(h.response.status,404);
  assert.equal(h.body.error,'Record not found');
  h=await browse(base+'Clientes/'+unassigned.id,unassigned);
  assert.equal(h.response.status,404);
  h=await browse(base+'Clientes/'+other.id,
    ()=>Response.json({error:{type:'NOT_FOUND'}},{status:404}));
  assert.equal(h.response.status,404);
  assert.equal(h.body.error,'Record not found');
});
test('no unscoped fallback on forbidden table, metadata, record path or mutation',async()=>{
  for(const [method,path] of [
    ['GET',base+'Facturas'],['GET',base+'Clientes/recAAAAAAAAAAAAAA/attachments'],
    ['GET',base+'Clientes/%72ecAAAAAAAAAAAAAA'],
    ['GET',base+'Clientes/'+own.id+'?fields[]=Empresa'],
    ['GET',base+'Clientes?returnFieldsByFieldId=true'],
    ['GET',base+'Clientes?filterByFormula=TRUE()&filterByFormula=FALSE()'],
    ['GET',base+'Clientes?sort%5B0%5D%5Bfield%5D=Datos+pago+%2F+banco'],
    ['GET',base+'Clientes?pageSize=200'],['GET',base+'Clientes?maxRecords=501'],
    ['POST',base+'Clientes'],['PATCH',base+'Pedidos/'+own.id],
    ['DELETE',base+'Cotizaciones/'+own.id],['GET','/v0/meta/bases/app1YtD74AqiPWQhy/tables']
  ]){
    const h=await browse(path,{records:[own]},{method});
    assert.ok(h.response.status>=400,method+' '+path);
    assert.equal(h.calls.length,0,'no backend fetch for '+method+' '+path);
  }
});
test('malformed or failed upstream fails closed, never retries write or reads from local state',async()=>{
  for(const respond of [
    ()=>new Response('not-json',{status:200}),
    ()=>new Response(null,{status:503}),
    ()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}),
    ()=>Promise.reject(new Error('outage'))
  ]){
    const h=await browse(base+'Clientes',respond);
    assert.equal(h.response.status,502);
    assert.equal(h.calls.length,1);
    assert.equal(h.body.records,undefined);
  }
});
test('missing or mismatched seller in server identity never falls back to global reading',async()=>{
  const old=user.seller;
  try{
    user.seller=undefined;
    const h=await browse(base+'Clientes',{records:[own]});
    assert.equal(h.response.status,403);
    assert.equal(h.calls.length,0);
    user.seller='fabricated';
    const otherH=await browse(base+'Clientes',{records:[own]});
    assert.equal(otherH.response.status,403);
    assert.equal(otherH.calls.length,0);
  }finally{user.seller=old;}
});
test('all row-scoped requests retain public APP_KEY and Origin checks',async()=>{
  const h=await browse(base+'Clientes',{records:[own]},{key:'wrong-key'});
  assert.equal(h.response.status,403);
  assert.equal(h.calls.length,0);
  const n=await browse(base+'Clientes',{records:[own]},{origin:'https://evil.example'});
  assert.equal(n.response.status,403);
  assert.equal(n.calls.length,0);
});
