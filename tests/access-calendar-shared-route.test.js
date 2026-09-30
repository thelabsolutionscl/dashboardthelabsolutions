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
const {CrmMutationGuard,worker,sharedCalendarPayloadAllowed}=
  new Function(workerSource+'\nreturn {CrmMutationGuard,worker,sharedCalendarPayloadAllowed};')();
const priorFetch=global.fetch;
test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',REC='recAAAAAAAAAAAAAA';
const BASE='/v0/'+APP+'/';
const doc=()=>({events:[{
  id:'evt-1',ts:1710000000000,creadoPor:'user@example.com',gcal:{gustavo:{cal:'x',ev:'y',mode:'owner'}},
  titulo:'Reunión',fecha:'2026-09-30',allDay:false,hIni:'10:00',hFin:'11:00',
  personas:['gustavo'],lugar:'Oficina',desc:'Seguimiento',alarmMin:30,emailMin:60,
  avisoApp:true,mts:1710000000000,del:false,gsyncMts:1710000000000
}],gmap:{gustavo:'calendar@example.com'},gmapMts:1710000000000,crmSync:{
  'ped-recAAAAAAAAAAAAAA':{gcal:{gustavo:{cal:'x',ev:'z',mode:'owner'}},
    gsyncMts:1710000000000,signature:'sig',type:'pedido',syncKey:'PED-1',del:false}
}});
function sha256(text){
  const {createHash}=require('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}
function harness({role='operator',initial=doc()}={}){
  let current=initial?JSON.stringify(initial):null,patches=0,creates=0;
  const env={APP_KEY:'public-test',AIRTABLE_TOKEN:'pat-private'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-calendar');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.accessAuthorize=async()=>({identity:{role,email:role+'@example.com'}});
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
      return Response.json({records:[{id:REC,fields:{Name:'CALENDARIO',Notes:current}}]});
    }
    if(method==='PATCH'){
      patches++;
      assert.equal(u.pathname,BASE+TABLE+'/'+REC);
      const body=JSON.parse(opts.body);
      assert.deepEqual(Object.keys(body.fields).sort(),['Name','Notes']);
      assert.equal(body.fields.Name,'CALENDARIO');
      current=body.fields.Notes;
      return Response.json({id:REC,fields:{Name:'CALENDARIO',Notes:current}});
    }
    if(method==='POST'){
      creates++;
      assert.equal(u.pathname,BASE+TABLE);
      const body=JSON.parse(opts.body);current=body.fields.Notes;
      return Response.json({id:REC,fields:{Name:'CALENDARIO',Notes:current}});
    }
    throw Error('unexpected '+method);
  };
  const run=(method,body,asRole=role)=>{
    global.accessAuthorize=async()=>({identity:{role:asRole,email:asRole+'@example.com'}});
    return worker.fetch(new Request('https://proxy.example.com/shared/calendar',{
      method,headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil:()=>{}});
  };
  return{env,guard,run,get current(){return current},get patches(){return patches},get creates(){return creates}};
}
test('role matrix: every signed role can read calendar; viewer cannot write it',()=>{
  for(const role of ['viewer','sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'GET','/shared/calendar'),true,role);
  assert.equal(accessAllows({role:'viewer'},'PUT','/shared/calendar'),false);
  for(const role of ['sales','operator','finance','admin'])
    assert.equal(accessAllows({role},'PUT','/shared/calendar'),true,role);
  for(const role of ['viewer','sales','operator','finance','admin'])
    for(const method of ['POST','PATCH','DELETE'])
      assert.equal(accessAllows({role},method,'/shared/calendar'),false,role+' '+method);
});
test('live-shaped calendar payload is accepted but arbitrary monitor data is not',()=>{
  assert.equal(sharedCalendarPayloadAllowed(doc()),true);
  const bad=[
    {...doc(),WATI_CONFIG:{token:'secret'}},
    {...doc(),events:[{...doc().events[0],unknownSecret:'x'}]},
    {...doc(),events:[{...doc().events[0],personas:['x'.repeat(81)]}]},
    {...doc(),gmap:{admin:'x'.repeat(501)}},
    {...doc(),crmSync:{x:{...doc().crmSync['ped-recAAAAAAAAAAAAAA'],rawSecret:'x'}}}
  ];
  for(const value of bad)assert.equal(sharedCalendarPayloadAllowed(value),false);
});
test('GET returns only calendar document and revision, never Airtable record metadata',async()=>{
  const h=harness({role:'viewer'}),res=await h.run('GET');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  const body=await res.json();
  assert.equal(body.ok,true);
  assert.deepEqual(body.data,doc());
  assert.equal(body.revision,sha256(JSON.stringify(doc())));
  assert.equal(body.recordId,undefined);
  assert.equal(body.fields,undefined);
});
test('PUT with current revision is serialized, verified and returns redacted document response',async()=>{
  const h=harness(),before=sha256(h.current),next=doc();
  next.events[0].titulo='Reunión actualizada';
  const res=await h.run('PUT',{data:next,expectedRevision:before});
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(h.patches,1);assert.equal(h.creates,0);
  const body=await res.json();
  assert.equal(body.ok,true);assert.deepEqual(body.data,next);
  assert.equal(body.revision,sha256(JSON.stringify(next)));
  assert.equal(body.recordId,undefined);
});
test('two devices with same revision cannot overwrite each other; only one PATCH occurs',async()=>{
  const h=harness(),revision=sha256(h.current),a=doc(),b=doc();
  a.events[0].titulo='Equipo A';b.events[0].titulo='Equipo B';
  const [ra,rb]=await Promise.all([
    h.run('PUT',{data:a,expectedRevision:revision}),
    h.run('PUT',{data:b,expectedRevision:revision})
  ]);
  assert.deepEqual([ra.status,rb.status],[200,409]);
  const conflict=await rb.json();
  assert.equal(conflict.code,'CALENDAR_REVISION_CONFLICT');
  assert.equal(conflict.data.events[0].titulo,'Equipo A');
  assert.equal(h.patches,1);
});
test('server creates CALENDARIO once when absent and expected revision is empty',async()=>{
  const h=harness({initial:null}),res=await h.run('PUT',{data:doc(),expectedRevision:''});
  assert.equal(res.status,200,await res.clone().text());
  assert.equal(h.creates,1);assert.equal(h.patches,0);
});
test('query parameters, malformed content, unsupported roles and unknown payloads fail before Airtable mutation',async()=>{
  const h=harness();
  const viewer=await h.run('PUT',{data:doc(),expectedRevision:sha256(h.current)},'viewer');
  assert.equal(viewer.status,403);
  assert.equal(h.patches,0);
  const bad=new Request('https://proxy.example.com/shared/calendar?record=CALENDARIO',{
    method:'GET',headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':h.env.APP_KEY}
  });
  global.accessAuthorize=async()=>({identity:{role:'operator',email:'operator@example.com'}});
  const q=await worker.fetch(bad,h.env,{waitUntil:()=>{}});
  assert.equal(q.status,422);
  const malformed=await h.run('PUT',{data:{events:[]},expectedRevision:''});
  assert.equal(malformed.status,422);
  assert.equal(h.patches,0);
});
test('DO independently rejects direct unapproved actor and stale revision',async()=>{
  const h=harness(),endpoint='https://crm-write.internal/shared-calendar';
  let res=await h.guard.fetch(new Request(endpoint,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'viewer',email:'viewer@example.com'},
      data:doc(),expectedRevision:sha256(h.current)})}));
  assert.equal(res.status,403);
  res=await h.guard.fetch(new Request(endpoint,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'operator',email:'operator@example.com'},
      data:doc(),expectedRevision:'0'.repeat(64)})}));
  assert.equal(res.status,409);
  assert.equal(h.patches,0);
});
