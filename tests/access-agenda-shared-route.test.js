#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(authSource+'\nreturn {accessAllows};')();
const workerSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {CrmMutationGuard,worker,sharedAgendaItemsAllowed,sharedAgendaDocumentAllowed}=
  new Function(workerSource+'\nreturn {CrmMutationGuard,worker,sharedAgendaItemsAllowed,sharedAgendaDocumentAllowed};')();
const priorFetch=global.fetch;
test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',REC='recAAAAAAAAAAAAAA';
const BASE='/v0/'+APP+'/';
const oldItem={id:'ag1784074963853',texto:'Llamar a cliente',fecha:'2026-07-15',
  cliId:null,cliNombre:null,done:true,ts:1784074963853};
const newItem={id:'ag1784921447961',texto:'Enviar propuesta',fecha:'2026-09-30',
  cliId:'recBBBBBBBBBBBBBB',cliNombre:'Cliente Demo',done:false,del:false,
  ts:1784921447961,mts:1784921447961};
const doc=()=>({
  'seller@example.com':[oldItem],
  'other@example.com':[{...newItem,id:'ag-other'}],
  '__equipo__':[newItem]
});
function sha256(text){
  const {createHash}=require('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}
function harness({initial=doc()}={}){
  let current=initial?JSON.stringify(initial):null,patches=0,creates=0;
  const env={APP_KEY:'public-test',AIRTABLE_TOKEN:'pat-private'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-agenda');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri));
    assert.equal(u.hostname,'api.airtable.com');
    const authorization=opts.headers instanceof Headers
      ?opts.headers.get('Authorization'):opts.headers?.Authorization;
    assert.equal(authorization,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    if(method==='GET'){
      assert.equal(u.pathname,BASE+TABLE);
      if(!current)return Response.json({records:[]});
      return Response.json({records:[{id:REC,fields:{Name:'AGENDA',Notes:current}}]});
    }
    if(method==='PATCH'){
      patches++;
      assert.equal(u.pathname,BASE+TABLE+'/'+REC);
      const body=JSON.parse(opts.body);
      assert.equal(body.fields.Name,'AGENDA');
      current=body.fields.Notes;
      return Response.json({id:REC,fields:{Name:'AGENDA',Notes:current}});
    }
    if(method==='POST'){
      creates++;
      assert.equal(u.pathname,BASE+TABLE);
      const body=JSON.parse(opts.body);
      assert.equal(body.fields.Name,'AGENDA');
      current=body.fields.Notes;
      return Response.json({id:REC,fields:{Name:'AGENDA',Notes:current}});
    }
    throw Error('unexpected '+method);
  };
  const run=(method,{body,scope='__equipo__',identity={role:'operator',email:'operator@example.com'},legacy=false}={})=>{
    global.accessAuthorize=async()=>legacy?{legacy:true}:{identity};
    return worker.fetch(new Request('https://proxy.example.com/shared/agenda?scope='+encodeURIComponent(scope),{
      method,headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil:()=>{}});
  };
  return{env,guard,run,get current(){return current},get patches(){return patches},get creates(){return creates}};
}
test('role matrix: every signed role can read agenda; viewer cannot write it',()=>{
  for(const role of ['viewer','sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'GET','/shared/agenda'),true,role);
  assert.equal(accessAllows({role:'viewer'},'PUT','/shared/agenda'),false);
  for(const role of ['sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'PUT','/shared/agenda'),true,role);
  for(const role of ['viewer','sales','operator','finance','admin'])
    for(const method of ['POST','PATCH','DELETE'])
      assert.equal(accessAllows({role},method,'/shared/agenda'),false,role+' '+method);
});
test('historical and current agenda shapes are accepted; unknown fields are rejected',()=>{
  assert.equal(sharedAgendaDocumentAllowed(doc()),true);
  assert.equal(sharedAgendaItemsAllowed([oldItem,newItem]),true);
  assert.equal(sharedAgendaItemsAllowed([{...newItem,secret:'x'}]),false);
  assert.equal(sharedAgendaItemsAllowed([{...newItem,texto:'x\u0001y'}]),false);
  assert.equal(sharedAgendaDocumentAllowed({'NOT A SCOPE':[newItem]}),false);
});
test('sales GET returns only its own scope and never other agendas or Airtable metadata',async()=>{
  const h=harness(),res=await h.run('GET',{
    scope:'seller@example.com',identity:{role:'sales',email:'seller@example.com'}
  });
  assert.equal(res.status,200);
  assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  const body=await res.json();
  assert.equal(body.scope,'seller@example.com');
  assert.deepEqual(body.data,[oldItem]);
  assert.equal(body.revision,sha256(JSON.stringify([oldItem])));
  assert.equal(body.recordId,undefined);assert.equal(body.fields,undefined);
  assert.doesNotMatch(JSON.stringify(body),/other@example\.com|__equipo__/);
});
test('operator GET is forced to team scope; requesting a personal scope is denied',async()=>{
  const h=harness();
  let res=await h.run('GET');
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).data,[newItem]);
  res=await h.run('GET',{scope:'seller@example.com'});
  assert.equal(res.status,403);
});
test('same-scope concurrent writes use scoped CAS so only one overwrites',async()=>{
  const h=harness(),revision=sha256(JSON.stringify(doc().__equipo__));
  const a=[{...newItem,texto:'Equipo A'}],b=[{...newItem,texto:'Equipo B'}];
  const [ra,rb]=await Promise.all([
    h.run('PUT',{body:{scope:'__equipo__',data:a,expectedRevision:revision}}),
    h.run('PUT',{body:{scope:'__equipo__',data:b,expectedRevision:revision}})
  ]);
  assert.deepEqual([ra.status,rb.status],[200,409]);
  const conflict=await rb.json();
  assert.equal(conflict.code,'AGENDA_REVISION_CONFLICT');
  assert.equal(conflict.data[0].texto,'Equipo A');
  assert.equal(h.patches,1);
});
test('different seller scopes can write from the same starting document without false conflicts',async()=>{
  const h=harness(),start=doc();
  const a=[{...oldItem,texto:'Seller A'}],b=[{...newItem,id:'ag-b',texto:'Seller B'}];
  const [ra,rb]=await Promise.all([
    h.run('PUT',{scope:'seller@example.com',identity:{role:'sales',email:'seller@example.com'},
      body:{scope:'seller@example.com',data:a,
        expectedRevision:sha256(JSON.stringify(start['seller@example.com']))}}),
    h.run('PUT',{scope:'other@example.com',identity:{role:'sales',email:'other@example.com'},
      body:{scope:'other@example.com',data:b,
        expectedRevision:sha256(JSON.stringify(start['other@example.com']))}})
  ]);
  assert.deepEqual([ra.status,rb.status],[200,200]);
  const final=JSON.parse(h.current);
  assert.deepEqual(final['seller@example.com'],a);
  assert.deepEqual(final['other@example.com'],b);
  assert.deepEqual(final.__equipo__,start.__equipo__);
  assert.equal(h.patches,2);
});
test('legacy mode keeps explicit scope compatibility without exposing the full document',async()=>{
  const h=harness(),res=await h.run('GET',{scope:'seller@example.com',legacy:true,identity:null});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.scope,'seller@example.com');
  assert.deepEqual(body.data,[oldItem]);
});
test('server creates AGENDA once when absent and selected scope revision matches empty array',async()=>{
  const h=harness({initial:null});
  const data=[newItem],revision=sha256('[]');
  const res=await h.run('PUT',{body:{scope:'__equipo__',data,expectedRevision:revision}});
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(h.creates,1);assert.equal(h.patches,0);
});
test('direct DO independently rejects viewer actor, signed scope mismatch and stale revision',async()=>{
  const h=harness(),endpoint='https://crm-write.internal/shared-agenda';
  let res=await h.guard.fetch(new Request(endpoint,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'viewer',email:'viewer@example.com'},scope:'__equipo__',
      data:[newItem],expectedRevision:sha256(JSON.stringify(doc().__equipo__))})}));
  assert.equal(res.status,403);
  res=await h.guard.fetch(new Request(endpoint,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'sales',email:'seller@example.com'},scope:'other@example.com',
      data:[newItem],expectedRevision:sha256(JSON.stringify(doc()['other@example.com']))})}));
  assert.equal(res.status,403);
  res=await h.guard.fetch(new Request(endpoint,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'operator',email:'operator@example.com'},scope:'__equipo__',
      data:[newItem],expectedRevision:'0'.repeat(64)})}));
  assert.equal(res.status,409);
  assert.equal(h.patches,0);
});
