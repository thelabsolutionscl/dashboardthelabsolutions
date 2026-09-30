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
const {worker}=new Function(code+'\nreturn {worker};')();
const base='/v0/app1YtD74AqiPWQhy/';
const owner={email:'sales@example.com',role:'sales',seller:'nicanor'};
global.accessAuthorize=async()=>({identity:owner});
const oldFetch=global.fetch;
test.after(()=>{global.fetch=oldFetch;});
const ids={customer:'recAAAAAAAAAAAAAA',quote:'recBBBBBBBBBBBBBB',
  order:'recCCCCCCCCCCCCCC',foreign:'recDDDDDDDDDDDDDD',
  unassigned:'recEEEEEEEEEEEEEE',missing:'recFFFFFFFFFFFFFF'};
function linkRow(id,seller){return {id,fields:seller?{Vendedor:seller}:{}};}
function fixture(table,sourceFields,{badTarget=null,failTarget=false,foreignSource=false}={}){
  const tableId={Clientes:ids.customer,Cotizaciones:ids.quote,Pedidos:ids.order}[table];
  const source={id:tableId,fields:{Vendedor:foreignSource?'florencia':'nicanor',
    ...sourceFields,'Datos pago / banco':'PRIVATE BANK',
    'Margen real (%)':82,'Costo real total (CLP)':900,
    'Nueva columna futura':'FUTURE SECRET'}};
  const lookup={
    Clientes:new Map([
      [ids.customer,linkRow(ids.customer,'nicanor')],
      [ids.foreign,linkRow(ids.foreign,'florencia')],
      [ids.unassigned,linkRow(ids.unassigned,null)]
    ]),
    Cotizaciones:new Map([
      [ids.quote,linkRow(ids.quote,'nicanor')],
      [ids.foreign,linkRow(ids.foreign,'gustavo')],
      [ids.unassigned,linkRow(ids.unassigned,null)]
    ]),
    Pedidos:new Map([
      [ids.order,linkRow(ids.order,'nicanor')],
      [ids.foreign,linkRow(ids.foreign,'florencia')],
      [ids.unassigned,linkRow(ids.unassigned,null)]
    ])
  };
  const calls=[];
  global.fetch=async (u,opts)=>{
    const url=new URL(String(u));
    assert.equal(url.hostname,'api.airtable.com');
    assert.equal(opts.headers.Authorization,'Bearer TEST_PAT');
    assert.equal(opts.redirect,'manual');
    calls.push({path:url.pathname,search:url.searchParams});
    const suffix=url.pathname.slice(base.length);
    const [target,id]=suffix.split('/');
    if(id)return Response.json(source);
    if(failTarget)return Response.json({error:'upstream failure'},{status:503});
    if(badTarget){
      return Response.json(badTarget==='offset'?
        {records:[],offset:'unknown'}:
        {records:[linkRow(ids.foreign,'florencia')]});
    }
    // The server, not the caller, constructs both owner and requested IDs.
    const formula=url.searchParams.get('filterByFormula')||'';
    assert.match(formula,/^\s*AND\(\{Vendedor\}="nicanor",/);
    assert.deepEqual(url.searchParams.getAll('fields[]'),['Vendedor']);
    const asked=new Set(formula.match(/rec[A-Za-z0-9]{14}/g)||[]);
    const rows=[...asked].map(rid=>lookup[target]?.get(rid))
      .filter(row=>row&&row.fields.Vendedor==='nicanor');
    return Response.json({records:rows});
  };
  const req=(suffix='?includeVerifiedLinks=1')=>new Request(
    'https://proxy.example.com'+base+table+'/'+tableId+suffix,{
      headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':'APP'}
    });
  const env={APP_KEY:'APP',AIRTABLE_TOKEN:'TEST_PAT'};
  return {calls,req,run:r=>worker.fetch(r,env,{}),source};
}
test('one owned customer reveals only verified related quotes and orders',async()=>{
  const f=fixture('Clientes',{
    Pedidos:[ids.order,ids.foreign,ids.unassigned,ids.missing],
    Cotizaciones:[ids.quote,ids.foreign,ids.unassigned]
  });
  const response=await f.run(f.req());
  assert.equal(response.status,200,await response.clone().text());
  const row=await response.json();
  assert.deepEqual(row.fields.Pedidos,[ids.order]);
  assert.deepEqual(row.fields.Cotizaciones,[ids.quote]);
  assert.equal(row.fields.Vendedor,'nicanor');
  for(const secret of ['Datos pago / banco','Margen real (%)',
    'Costo real total (CLP)','Nueva columna futura'])
    assert.equal(row.fields[secret],undefined,secret);
  assert.equal(f.calls.length,3,'one source lookup plus two bounded joins');
  assert.ok(f.calls.some(c=>c.path===base+'Pedidos'&&
    c.search.get('filterByFormula').includes(ids.order)));
  assert.ok(f.calls.some(c=>c.path===base+'Cotizaciones'&&
    c.search.get('filterByFormula').includes(ids.quote)));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('owned quotes and orders resolve links solely to same-owner CRM records',async()=>{
  for(const [table,fields,expected] of [
    ['Cotizaciones',{Cliente:[ids.customer,ids.foreign],
      Pedido:[ids.order,ids.unassigned]},
      {Cliente:[ids.customer],Pedido:[ids.order]}],
    ['Pedidos',{Cliente:[ids.customer,ids.unassigned],
      Cotizaciones:[ids.quote,ids.foreign]},
      {Cliente:[ids.customer],Cotizaciones:[ids.quote]}]
  ]){
    const f=fixture(table,fields);
    const res=await f.run(f.req());
    assert.equal(res.status,200,table);
    const row=await res.json();
    for(const [field,value] of Object.entries(expected))
      assert.deepEqual(row.fields[field],value,table+' '+field);
    assert.equal(f.calls.length,3);
  }
});
test('normal owned reads never return links or trigger additional queries',async()=>{
  const f=fixture('Clientes',{Pedidos:[ids.order],Cotizaciones:[ids.quote]});
  const r=await f.run(f.req(''));
  assert.equal(r.status,200);
  assert.equal((await r.json()).fields.Pedidos,undefined);
  assert.equal(f.calls.length,1);
});
test('an unowned source returns the same 404 as an absent record before any join',async()=>{
  const f=fixture('Cotizaciones',{Cliente:[ids.customer]},{foreignSource:true});
  const r=await f.run(f.req());
  assert.equal(r.status,404);
  assert.deepEqual(await r.json(),{error:'Record not found'});
  assert.equal(f.calls.length,1);
});
test('caller cannot supply arbitrary related IDs, filters, list joins or extra single-record queries',async()=>{
  for(const suffix of [
    '?includeVerifiedLinks=1&filterByFormula=TRUE()',
    '?includeVerifiedLinks=0','?includeVerifiedLinks=1&includeVerifiedLinks=1',
    '?fields[]=Vendedor','?includeVerifiedLinks=true'
  ]){
    const f=fixture('Clientes',{Pedidos:[ids.order]});
    const res=await f.run(f.req(suffix));
    assert.equal(res.status,422,suffix);
    assert.equal(f.calls.length,0);
  }
  const f=fixture('Clientes',{Pedidos:[ids.order]});
  const req=new Request('https://proxy.example.com'+base+
    'Clientes?includeVerifiedLinks=1',{
    headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':'APP'}});
  const res=await f.run(req);
  assert.equal(res.status,422);
  assert.equal(f.calls.length,0);
});
test('tampered, malformed, oversized and failed relationship verification fail closed',async()=>{
  for(const options of [{badTarget:'foreign'},{badTarget:'offset'},
    {failTarget:true}]){
    const f=fixture('Pedidos',{Cliente:[ids.customer]},options);
    const res=await f.run(f.req());
    assert.equal(res.status,502,JSON.stringify(options));
    assert.deepEqual(await res.json(),{error:'Cannot verify related CRM ownership'});
    assert.equal(f.calls.length,2);
  }
  for(const fields of [
    {Cliente:['recBOGUS']},{Cliente:'recAAAAAAAAAAAAAA'},
    {Cliente:Array(26).fill(ids.customer)},
    {Cliente:[ids.customer],Cotizaciones:Array(25).fill(ids.quote)}
  ]){
    const f=fixture('Pedidos',fields);
    const res=await f.run(f.req());
    assert.equal(res.status,502);
    assert.deepEqual(await res.json(),{error:'Cannot verify related CRM ownership'});
    assert.equal(f.calls.length,1,'malformed relationship rejected before fetching targets');
  }
});
