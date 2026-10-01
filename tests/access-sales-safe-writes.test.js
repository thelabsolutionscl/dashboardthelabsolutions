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
const {CrmMutationGuard,worker}=new Function(code+'\nreturn {CrmMutationGuard,worker};')();
const BASE='/v0/app1YtD74AqiPWQhy/';
const SALES={role:'sales',seller:'nicanor',email:'nicanor@example.com'};
const ADMIN={role:'admin',email:'admin@example.com'};
const OPERATOR={role:'operator',email:'operator@example.com'};
global.accessAuthorize=async request=>({
  identity:request.headers.get('X-Test-Role')==='admin'?ADMIN:
    request.headers.get('X-Test-Role')==='operator'?OPERATOR:SALES
});
const originalFetch=global.fetch;
test.after(()=>{global.fetch=originalFetch;});
const rec='recAAAAAAAAAAAAAA';
const other='recBBBBBBBBBBBBBB';
function record(fields,id=rec){return {id,fields:{Vendedor:'nicanor',...fields}};}
function fixture(options={}){
  const rows=new Map([[rec,record({'Notas internas':'original','Notas cotización':'old',
    'Notas followup':'pending','Notas pedido':'original','Contacto':'A'})],
    [other,record({'Notas internas':'not mine','Notas cotización':'private'})]]);
  rows.get(other).fields.Vendedor='florencia';
  const calls=[];
  const env={APP_KEY:'test-public-key',AIRTABLE_TOKEN:'test-private-token',
    ACCESS_SALES_WRITES_ENABLED:options.enabled===false?undefined:'true'};
  const guard=new CrmMutationGuard({storage:{}},env);
  env.CRM_MUTATION_GUARD={
    idFromName:name=>{assert.equal(name,'tls-crm-global');return name;},
    get:()=>({fetch:(url,opts)=>guard.fetch(new Request(url,opts))})
  };
  if(options.noGuard)delete env.CRM_MUTATION_GUARD;
  global.fetch=async (url,opts={})=>{
    const target=new URL(String(url));
    assert.equal(target.hostname,'api.airtable.com');
    assert.equal(opts.headers.Authorization,'Bearer '+env.AIRTABLE_TOKEN);
    calls.push({method:opts.method||'GET',url:target.pathname,body:opts.body});
    if(options.fetchOverride){
      const override=await options.fetchOverride(target,opts,rows,calls);
      if(override)return override;
    }
    const parts=target.pathname.slice(BASE.length).split('/');
    const table=parts[0],id=parts[1];
    assert.ok(['Clientes','Cotizaciones','Pedidos'].includes(table));
    if(opts.method==='GET'){
      const item=rows.get(id);
      return item?Response.json(structuredClone(item)):
        Response.json({error:'NOT_FOUND'},{status:404});
    }
    if(opts.method==='PATCH'&&id){
      const item=rows.get(id);
      if(!item)return Response.json({error:'NOT_FOUND'},{status:404});
      Object.assign(item.fields,JSON.parse(opts.body).fields);
      return Response.json(structuredClone(item));
    }
    if(opts.method==='PATCH'&&!id){
      const body=JSON.parse(opts.body);
      for(const row of body.records){
        const item=rows.get(row.id);
        if(item)Object.assign(item.fields,row.fields);
      }
      return Response.json({records:body.records.map(row=>structuredClone(rows.get(row.id)))});
    }
    throw new Error('Unexpected upstream method');
  };
  const request=(table,id=rec,fields={'Notas internas':'edited'},expected={'Notas internas':'original'},
      options={})=>new Request('https://proxy.example.com'+BASE+table+'/'+id,{
    method:options.method||'PATCH',
    headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,
      'Content-Type':'application/json','X-Test-Role':options.role||'sales'},
    body:JSON.stringify(options.body||{fields,expected_fields:expected})
  });
  const run=(request)=>worker.fetch(request,env,{waitUntil:()=>{}});
  return {env,guard,rows,calls,request,run};
}
async function parsed(response){return {status:response.status,body:await response.json()};}

test('sales PATCH is OFF by default even with a valid signed identity, and never bypasses the DO',async()=>{
  const f=fixture({enabled:false});
  const r=await parsed(await f.run(f.request('Clientes')));
  assert.equal(r.status,503);
  assert.equal(r.body.code,'SALES_WRITE_CUTOVER_REQUIRED');
  assert.deepEqual(f.calls,[]);
  assert.equal(f.rows.get(rec).fields['Notas internas'],'original');
});
test('opt-in safe sales PATCH verifies original owner, expected fields and post-write owner',async()=>{
  for(const [table,field,old,next] of [
    ['Clientes','Notas internas','original','contactado'],
    ['Pedidos','Notas pedido','original','confirmado por ventas']
  ]){
    const f=fixture();
    // A PATCH must never return the unfiltered Airtable postflight row.
    Object.assign(f.rows.get(rec).fields,{
      'Datos pago / banco':'SECRET ACCOUNT',
      'Facturas vencidas':4,
      'Margen real (%)':98,
      'Costo real total (CLP)':999999,
      'Cliente':[other],
      'Pedido':[other],
      'Cotizaciones':[other],
      'Nueva columna futura':'PRIVATE'
    });
    const response=await f.run(f.request(table,rec,{[field]:next},{[field]:old}));
    assert.equal(response.status,200,await response.clone().text());
    const saved=await response.json();
    assert.equal(saved.id,rec);
    assert.equal(saved.fields[field],next);
    assert.equal(saved.fields.Vendedor,'nicanor');
    for(const hidden of ['Datos pago / banco','Facturas vencidas',
      'Margen real (%)','Costo real total (CLP)','Cliente','Pedido',
      'Cotizaciones','Nueva columna futura'])
      assert.equal(saved.fields[hidden],undefined,table+' PATCH leaked '+hidden);
    assert.deepEqual(f.calls.map(c=>c.method),['GET','PATCH','GET']);
    assert.equal(f.calls[1].body,JSON.stringify({fields:{[field]:next}}),
      'untrusted expected_fields and owner must not reach Airtable');
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  }
});
test('another seller, missing owner or missing record never receives data or a PATCH',async()=>{
  const f=fixture();
  f.rows.set(other,record({'Notas internas':'not mine'},other));
  f.rows.get(other).fields.Vendedor='florencia';
  for(const [id,kind] of [[other,'foreign'],[rec,'unassigned'],['recCCCCCCCCCCCCCC','missing']]){
    if(kind==='unassigned')delete f.rows.get(rec).fields.Vendedor;
    const before=f.calls.length;
    const outcome=await parsed(await f.run(f.request('Clientes',id)));
    assert.equal(outcome.status,404,kind);
    assert.equal(outcome.body.error,'Record not found',kind);
    assert.equal(f.calls.length,before+1);
    assert.equal(f.calls.at(-1).method,'GET');
  }
});
test('optimistic field precondition prevents two devices from clobbering one another',async()=>{
  const f=fixture();
  const [a,b]=await Promise.all([
    f.run(f.request('Clientes',rec,{'Notas internas':'device A'},
      {'Notas internas':'original'})),
    f.run(f.request('Clientes',rec,{'Notas internas':'device B'},
      {'Notas internas':'original'}))
  ]);
  assert.deepEqual([a.status,b.status],[200,409]);
  assert.equal((await b.json()).code,'SALES_PATCH_CONFLICT');
  assert.equal(f.rows.get(rec).fields['Notas internas'],'device A');
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
});
test('privileged owner reassignments use the SAME DO queue and invalidate a sales PATCH',async()=>{
  const f=fixture();
  const adminRequest=f.request('Clientes',rec,{}, {},{
    role:'admin',body:{fields:{Vendedor:'florencia'}}
  });
  const userRequest=f.request('Clientes',rec,
    {'Notas internas':'cannot edit'}, {'Notas internas':'original'});
  const [admin,sales]=await Promise.all([f.run(adminRequest),f.run(userRequest)]);
  assert.equal(admin.status,200,await admin.clone().text());
  assert.equal(sales.status,404,await sales.clone().text());
  assert.equal(f.rows.get(rec).fields.Vendedor,'florencia');
  assert.equal(f.rows.get(rec).fields['Notas internas'],'original');
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
  assert.equal(f.calls.at(-1).method,'GET');
});
test('admin batch owner reassignment shares the same global CRM guard',async()=>{
  const f=fixture();
  const uri='https://proxy.example.com'+BASE+'Clientes';
  const request=new Request(uri,{method:'PATCH',headers:{
    Origin:'https://dashboard.thelab.solutions','X-App-Key':f.env.APP_KEY,
    'Content-Type':'application/json','X-Test-Role':'admin'
  },body:JSON.stringify({records:[{id:rec,fields:{Vendedor:'gustavo'}}]})});
  const result=await f.run(request);
  assert.equal(result.status,200,await result.clone().text());
  assert.equal(f.rows.get(rec).fields.Vendedor,'gustavo');
  const sale=await parsed(await f.run(f.request('Clientes')));
  assert.equal(sale.status,404);
});
test('sales cannot edit owner, relationships, financial totals, approvals or workflow states',async()=>{
  for(const [table,fields] of [
    ['Clientes',{Vendedor:'nicanor'}],
    ['Clientes',{Cotizaciones:['recBBBBBBBBBBBBBB']}],
    ['Clientes',{'Revenue total cliente (CLP)':90000000}],
    ['Clientes',{'Cargo contacto':'Jefatura comercial'}],
    ['Cotizaciones',{'Notas cotización':'No sobrescribir el comentario de portal'}],
    ['Cotizaciones',{'Estado cotización':'Aprobada'}],
    ['Cotizaciones',{Cliente:['recBBBBBBBBBBBBBB']}],
    ['Cotizaciones',{'Total final (CLP)':9999999}],
    ['Pedidos',{'Estado pedido':'Despachado'}],
    ['Pedidos',{'Cotizaciones':['recBBBBBBBBBBBBBB']}],
    ['Pedidos',{'Notas internas':'Retainer unapproved 2026-09'}]
  ]){
    const f=fixture();
    const expected=Object.fromEntries(Object.keys(fields).map(k=>[k,'']));
    const response=await f.run(f.request(table,rec,fields,expected));
    assert.equal(response.status,422,table+' '+Object.keys(fields).join(','));
    assert.equal(f.calls.length,0);
  }
});
test('ambiguous PATCH is not retried and stale expected_fields prevents duplicate overwrites',async()=>{
  let failed=false;
  const f=fixture({fetchOverride:async (_url,opts,rows)=>{
    if(opts.method==='PATCH'&&!failed){
      failed=true;
      Object.assign(rows.get(rec).fields,JSON.parse(opts.body).fields);
      throw new Error('response lost after Airtable commit');
    }
  }});
  const req=()=>f.request('Clientes',rec,
    {'Notas internas':'already applied'},{'Notas internas':'original'});
  const first=await parsed(await f.run(req()));
  assert.equal(first.status,503);
  assert.equal(first.body.code,'SALES_PATCH_UNCERTAIN');
  const retry=await parsed(await f.run(req()));
  assert.equal(retry.status,409);
  assert.equal(retry.body.code,'SALES_PATCH_CONFLICT');
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
});
test('external owner reassignment detected on postflight without revealing foreign record',async()=>{
  const f=fixture({fetchOverride:async (_url,opts,rows)=>{
    if(opts.method==='PATCH'){
      Object.assign(rows.get(rec).fields,JSON.parse(opts.body).fields);
      rows.get(rec).fields.Vendedor='florencia'; // external writer simulation
      return Response.json(structuredClone(rows.get(rec)));
    }
  }});
  const res=await parsed(await f.run(f.request('Clientes')));
  assert.equal(res.status,409);
  assert.equal(res.body.code,'SALES_OWNER_CHANGED');
  assert.equal(res.body.fields,undefined);
  assert.deepEqual(f.calls.map(c=>c.method),['GET','PATCH','GET']);
});
test('malformed, oversized, unsupported query, wrong method and absent DO fail closed',async()=>{
  for(const [options,code] of [
    [{body:{fields:{'Notas internas':'test'}}},422],
    [{body:{fields:{'Notas internas':'test'},expected_fields:{}}},422],
    [{body:{fields:{'Notas internas':1},expected_fields:{'Notas internas':'original'}}},422],
    [{body:{fields:{'Notas internas':'x'.repeat(4001)},expected_fields:{'Notas internas':'original'}}},422],
    [{body:{fields:{'Notas internas':'test'},expected_fields:{'Notas internas':'original'},
      typecast:true}},422]
  ]){
    const f=fixture();
    const res=await f.run(f.request('Clientes',rec,{}, {},options));
    assert.equal(res.status,code);
    assert.equal(f.calls.length,0);
  }
  {
    const f=fixture({noGuard:true});
    const res=await f.run(f.request('Clientes'));
    assert.equal(res.status,503);
    assert.equal(f.calls.length,0);
  }
  {
    const f=fixture();
    const request=f.request('Clientes',rec);
    const bad=new Request(request.url+'?returnFieldsByFieldId=true',request);
    const res=await f.run(bad);
    assert.equal(res.status,403);
    assert.equal(f.calls.length,0);
  }
});
