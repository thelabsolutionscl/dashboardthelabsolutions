#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy-qa/src/worker.js'),'utf8')
 .replace(/^import \{ accessAuthorize \} from '[^']+';\s*$/m,'')
 .replace('export default {','const qaWorker = {');
assert.ok(source.includes('const qaWorker = {'),'Expected QA worker default export');
const people={
  'admin': {email:'gustavo@thelab.solutions',role:'admin'},
  'sales': {email:'florencia@thelab.solutions',role:'sales',seller:'florencia'},
  'viewer': {email:'viewer@example.invalid',role:'viewer'}
};
// Inject mock ONLY in tests. Production Worker imports the signature-verifying implementation.
const authorize=async request=>{
  const who=request.headers.get('X-QA-Mock-User');
  if(!people[who])return {response:Response.json({error:'Sign in required'},{status:401})};
  return {identity:people[who]};
};
const worker=new Function('accessAuthorize',source+'\nreturn qaWorker;')(authorize);
const QA_BASE='app55FbVNr3yhTlbL';
const ENV={QA_MODE:'true',QA_BASE_ID:QA_BASE,QA_AIRTABLE_TOKEN:'pat_synthetic_test_token_12345',ACCESS_ENFORCE:'true'};
const fId='recJ4XtW2jbDPCApI', gId='recCPX9vFGkAjZtBu';
const fixtures=[
  {id:fId,fields:{Empresa:'QA FLORENCIA - Cliente ficticio 1',Vendedor:'florencia',Email:'qa@example.invalid','Datos pago / banco':'MUST NOT LEAK',Cotizaciones:['recFAKE1234567890']}},
  {id:gId,fields:{Empresa:'QA GUSTAVO - Cliente ficticio 1',Vendedor:'gustavo','Facturas vencidas':99999}},
  {id:'recNHweZXaqTi3xH9',fields:{Empresa:'QA NICANOR - Cliente ficticio 1',Vendedor:'nicanor'}},
  {id:'recxPtoIdoc0IOC1T',fields:{Empresa:'QA FLORENCIA - Cliente ficticio 2',Vendedor:'florencia'}}
];
const originalFetch=global.fetch;
const calls=[];
global.fetch=async (url, options)=>{
  const u=new URL(url);
  calls.push({url:u,options});
  assert.equal(u.origin,'https://api.airtable.com');
  assert.ok(u.pathname.startsWith('/v0/'+QA_BASE+'/'));
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer '+ENV.QA_AIRTABLE_TOKEN);
  const id=u.pathname.split('/').at(-1);
  if(id.startsWith('rec')){
    const record=fixtures.find(r=>r.id===id);
    return record?Response.json(record):Response.json({error:'NOT_FOUND'},{status:404});
  }
  // Return deliberately unfiltered data: local guard MUST still enforce seller ownership.
  return Response.json({records:fixtures});
};
test.after(()=>{global.fetch=originalFetch;});
function request(route, who, method='GET',hostname='qa-proxy.thelab.solutions'){
  return new Request('https://'+hostname+route,{method,headers:who?{'X-QA-Mock-User':who}:{}});
}
test('never falls back to production when QA variables are missing, false or wrong',async()=>{
  for(const overrides of [{QA_MODE:'false'},{QA_BASE_ID:'app1YtD74AqiPWQhy'},{ACCESS_ENFORCE:''},{QA_AIRTABLE_TOKEN:''}]){
    const r=await worker.fetch(request('/crm/Clientes','admin'),{...ENV,...overrides});
    assert.equal(r.status,503);
  }
  assert.equal((await worker.fetch(request('/crm/Clientes','admin','GET','airtable-proxy.wast3dspa.workers.dev'),ENV)).status,503);
  assert.equal(calls.length,0);
});
test('no anonymous, viewer or unsupported methods',async()=>{
  assert.equal((await worker.fetch(request('/access/me'),ENV)).status,401);
  assert.equal((await worker.fetch(request('/crm/Clientes','viewer'),ENV)).status,403);
  assert.equal((await worker.fetch(request('/crm/Clientes','sales','POST'),ENV)).status,405);
  assert.equal((await worker.fetch(request('/crm/Clientes','admin','PATCH'),ENV)).status,405);
  assert.equal((await worker.fetch(request('/crm/Clientes?filterByFormula=1','admin'),ENV)).status,400);
  assert.equal((await worker.fetch(request('/v0/app1YtD74AqiPWQhy/Clientes','admin'),ENV)).status,404);
  assert.equal(calls.length,0);
});
test('identity endpoint reveals only email, role and permitted seller',async()=>{
  const r=await worker.fetch(request('/access/me','sales'),ENV);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{email:'florencia@thelab.solutions',role:'sales',seller:'florencia'});
  assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('sales list is both server-filtered and response-filtered; no secret fields or links',async()=>{
  const r=await worker.fetch(request('/crm/Clientes','sales'),ENV);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.records.length,2);
  for(const record of data.records){
    assert.equal(record.fields.Vendedor,'florencia');
    assert.equal(record.fields['Datos pago / banco'],undefined);
    assert.equal(record.fields.Cotizaciones,undefined);
  }
  const last=calls.at(-1).url;
  assert.equal(last.searchParams.get('filterByFormula'),"{Vendedor}='florencia'");
  assert.ok(last.searchParams.getAll('fields[]').includes('Vendedor'));
  assert.equal(last.searchParams.has('offset'),false);
});
test('sales cannot enumerate another seller via guessed record ID',async()=>{
  const denied=await worker.fetch(request('/crm/Clientes/'+gId,'sales'),ENV);
  assert.equal(denied.status,404);
  const allowed=await worker.fetch(request('/crm/Clientes/'+fId,'sales'),ENV);
  assert.equal(allowed.status,200);
  const record=await allowed.json();
  assert.equal(record.id,fId);
  assert.deepEqual(Object.keys(record.fields).sort(),['Email','Empresa','Vendedor'].sort());
});
test('admin sees approved QA records, never private Airtable fields',async()=>{
  const r=await worker.fetch(request('/crm/Clientes','admin'),ENV);
  const data=await r.json();
  assert.equal(data.records.length,4);
  assert.ok(data.records.every(x=>!Object.hasOwn(x.fields,'Facturas vencidas')));
  assert.ok(data.records.every(x=>!Object.hasOwn(x.fields,'Cotizaciones')));
});
