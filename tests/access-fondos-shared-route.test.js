#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const auth=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(auth+'\nreturn {accessAllows};')();
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {CrmMutationGuard,worker,sharedFundsDocAllowed,sharedFundsRecordAllowed}=
  new Function(source+'\nreturn {CrmMutationGuard,worker,sharedFundsDocAllowed,sharedFundsRecordAllowed};')();
const originalFetch=global.fetch;
test.after(()=>{global.fetch=originalFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',REC='recAAAAAAAAAAAAAA';
const fund='corfo-crea-y-valida-proxima-vigilar';
const state=()=>({schema:1,funds:{
  [fund]:{stage:'evaluando',checks:['bases'],watching:true,updatedAt:'2026-10-15T17:00:00.000Z',updatedBy:'gustavo@thelab.solutions'}
}});
function sha(raw){return require('node:crypto').createHash('sha256').update(raw).digest('hex');}
function harness({initial=state()}={}){
  let current=initial?JSON.stringify(initial):null,writes=0,creates=0;
  const env={APP_KEY:'shared-test-key',AIRTABLE_TOKEN:'pat-private'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(n){assert.equal(n,'tls-shared-funds');return n;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))};}
  };
  global.fetch=async(url,options={})=>{
    const u=new URL(String(url));assert.equal(u.hostname,'api.airtable.com');
    assert.equal(options.headers.Authorization,'Bearer '+env.AIRTABLE_TOKEN);
    if(options.method==='GET'){
      assert.equal(u.pathname,'/v0/'+APP+'/'+TABLE);
      assert.equal(u.searchParams.get('filterByFormula'),"{Name}='FONDOS_TLS'");
      return Response.json({records:current?[{id:REC,fields:{Name:'FONDOS_TLS',Notes:current}}]:[]});
    }
    if(options.method==='PATCH'||options.method==='POST'){
      if(options.method==='PATCH')writes++;else creates++;
      const body=JSON.parse(options.body);
      assert.equal(body.fields.Name,'FONDOS_TLS');
      current=body.fields.Notes;
      return Response.json({id:REC,fields:{Name:'FONDOS_TLS',Notes:current}});
    }
    throw Error('Unexpected '+options.method);
  };
  function run(method,body,role='operator'){
    global.accessAuthorize=async()=>({identity:{role,email:role+'@thelab.solutions'}});
    return worker.fetch(new Request('https://proxy.thelab.solutions/shared/funds',{
      method,headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil(){}});
  }
  return{env,run,guard,get current(){return current},get writes(){return writes},get creates(){return creates}};
}
const rec=(stage='preparando',checks=['bases','empresa'],watching=true)=>({stage,checks,watching});
test('solo roles administrativos pueden leer y escribir seguimiento compartido',()=>{
  for(const role of ['viewer','sales','finance']){
    assert.equal(accessAllows({role},'GET','/shared/funds'),false);
    assert.equal(accessAllows({role},'PUT','/shared/funds'),false);
  }
  for(const role of ['operator','admin']){
    assert.equal(accessAllows({role},'GET','/shared/funds'),true);
    assert.equal(accessAllows({role},'PUT','/shared/funds'),true);
    assert.equal(accessAllows({role},'DELETE','/shared/funds'),false);
  }
});
test('servidor solo admite estados y casillas, no RUT, formularios, prompt ni datos libres',()=>{
  assert.equal(sharedFundsDocAllowed(state()),true);
  assert.equal(sharedFundsRecordAllowed(rec()),true);
  assert.equal(sharedFundsRecordAllowed({...rec(),RUT:'x'}),false);
  assert.equal(sharedFundsRecordAllowed({...rec(),checks:['bases','bases']}),false);
  assert.equal(sharedFundsRecordAllowed({...rec(),checks:['hack']}),false);
  assert.equal(sharedFundsDocAllowed({...state(),secrets:{}}),false);
});
test('GET devuelve documento limitado sin nombres de tablas ni IDs Airtable',async()=>{
  const h=harness(),r=await h.run('GET');
  assert.equal(r.status,200,await r.clone().text());
  const data=await r.json();
  assert.deepEqual(data.data,state());
  assert.equal(data.revision,sha(h.current));
  assert.equal(data.recordId,undefined);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});
test('actualiza solo el fondo seleccionado, conserva otras ediciones y exige revisión CAS',async()=>{
  const other='sercotec-crece-proximas';
  const h=harness();
  const revision=sha(h.current);
  const [first,stale]=await Promise.all([
    h.run('PUT',{fundId:other,record:rec(),expectedRevision:revision}),
    h.run('PUT',{fundId:fund,record:rec('descartado',[]),expectedRevision:revision})
  ]);
  assert.deepEqual([first.status,stale.status],[200,409]);
  const changed=JSON.parse(h.current);
  assert.equal(changed.funds[fund].stage,'evaluando','preserva ficha de otro operador');
  assert.equal(changed.funds[other].stage,'preparando');
  assert.equal(h.writes,1);
  const response=await stale.json();
  assert.equal(response.code,'FUNDS_REVISION_CONFLICT');
  assert.equal(response.data.funds[other].stage,'preparando');
});
test('permite dejar de seguir sin borrar el progreso de otros fondos',async()=>{
  const h=harness(),r=await h.run('PUT',{fundId:fund,
    record:rec('seguimiento',[],false),expectedRevision:sha(h.current)});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(Object.keys(JSON.parse(h.current).funds).length,0);
});
test('primer guardado crea registro FONDOS_TLS cuando aún no existe',async()=>{
  const h=harness({initial:null}),r=await h.run('PUT',{fundId:fund,
    record:rec('evaluando'),expectedRevision:''});
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(h.creates,1);
});
test('roles ajenos y datos ilegales nunca llegan a Airtable',async()=>{
  const h=harness(),revision=sha(h.current);
  assert.equal((await h.run('PUT',{fundId:fund,record:rec(),expectedRevision:revision},'viewer')).status,403);
  assert.equal((await h.run('PUT',{fundId:fund,record:{...rec(),token:'private'},expectedRevision:revision})).status,422);
  assert.equal(h.writes,0);
});
