#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const authSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(authSource+'\nreturn {accessAllows};')();
const workerSource=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {
  CrmMutationGuard,worker,sharedSimulationNormalize,sharedSimulationDocumentAllowed,
  sharedSimulationActorAllowed
}=new Function(workerSource+'\nreturn {CrmMutationGuard,worker,sharedSimulationNormalize,sharedSimulationDocumentAllowed,sharedSimulationActorAllowed};')();
const priorFetch=global.fetch;test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',BASE='/v0/'+APP+'/',REC='recAAAAAAAAAAAAAA';
const sha=x=>createHash('sha256').update(x).digest('hex');
const item=(name='Concepto')=>({concepto:name,base:name,precio:49900,veredicto:'dudoso',
  pctCompra:12,promedio:2.4,cobertura:100,esperados:44,frenos:'precio',
  comprador:'perfil de prueba',precioSugerido:'$39.900'});
const oldRun={id:'sim_old',fecha:'2026-09-01',ts:1000,linea:'Lámparas (THE LAMP)',
  lineaKey:'lamparas',publico:'ambos',panel:1,nPerfiles:44,items:[item('Viejo')]};
const newRun={id:'sim_new',fecha:'2026-09-30',ts:3000,linea:'Lámparas (THE LAMP)',
  lineaKey:'lamparas',publico:'ambos',panel:1,nPerfiles:44,barrido:[39900,49900],items:[item('Nuevo')]};
function doc(runs=[oldRun,newRun],clearedAt=0){
  const newest=Math.max(clearedAt,...runs.map(r=>r.ts));
  return{version:1,updatedAt:newest,clearedAt,runs};
}
function harness({initial=[oldRun]}={}){
  let current=initial===null?null:JSON.stringify(initial),patches=0,creates=0;
  const env={APP_KEY:'fixture-key',AIRTABLE_TOKEN:'fixture-airtable'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-simulation');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri));assert.equal(u.hostname,'api.airtable.com');
    const auth=opts.headers instanceof Headers?opts.headers.get('Authorization'):opts.headers?.Authorization;
    assert.equal(auth,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    if(method==='GET'){
      assert.equal(u.pathname,BASE+TABLE);
      assert.match(u.searchParams.get('filterByFormula')||'',/SIMULACION/);
      return Response.json({records:current===null?[]:[{id:REC,fields:{Name:'SIMULACION',Notes:current}}]});
    }
    const body=JSON.parse(opts.body);
    assert.equal(body.fields.Name,'SIMULACION');
    if(method==='PATCH'){patches++;assert.equal(u.pathname,BASE+TABLE+'/'+REC);}
    else if(method==='POST'){creates++;assert.equal(u.pathname,BASE+TABLE);}
    else throw Error('unexpected '+method);
    current=body.fields.Notes;
    return Response.json({id:REC,fields:{Name:'SIMULACION',Notes:current}});
  };
  const run=(method,{body,identity={role:'admin',email:'admin@thelab.solutions'},legacy=false,query=''}={})=>{
    global.accessAuthorize=async(_req,_env,p)=>{
      if(legacy)return{legacy:true};
      return accessAllows(identity,method,p)?{identity}:{response:Response.json({error:'denied'},{status:403})};
    };
    return worker.fetch(new Request('https://proxy.example.com/shared/simulation'+query,{
      method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,
        ...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil(){}});
  };
  return{run,guard,get current(){return current},get patches(){return patches},get creates(){return creates}};
}
test('RBAC: admin y marketing exacto usan GET/PUT; otros roles no heredan la ruta',()=>{
  for(const method of ['GET','PUT']){
    assert.equal(accessAllows({role:'admin',email:'admin@thelab.solutions'},method,'/shared/simulation'),true);
    assert.equal(accessAllows({role:'viewer',email:'marketing@thelab.solutions'},method,'/shared/simulation'),true);
    for(const identity of [
      {role:'viewer',email:'viewer@thelab.solutions'},
      {role:'operator',email:'operator@thelab.solutions'},
      {role:'finance',email:'finanzas@thelab.solutions'},
      {role:'sales',email:'ventas@thelab.solutions'}
    ])assert.equal(accessAllows(identity,method,'/shared/simulation'),false,identity.role);
  }
  for(const method of ['POST','PATCH','DELETE'])
    assert.equal(accessAllows({role:'admin',email:'admin@thelab.solutions'},method,'/shared/simulation'),false);
});
test('legacy array sin barrido se normaliza sin migrar ni perder la corrida',()=>{
  const normalized=sharedSimulationNormalize([oldRun]);
  assert.ok(normalized);
  assert.equal(normalized.version,1);assert.equal(normalized.clearedAt,0);
  assert.equal(normalized.runs.length,1);assert.equal(normalized.runs[0].id,'sim_old');
  assert.equal(sharedSimulationDocumentAllowed(normalized),true);
});
test('GET devuelve sólo documento, existencia y revisión; nunca recordId Airtable',async()=>{
  const h=harness(),res=await h.run('GET');assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.exists,true);assert.equal(body.data.runs[0].id,'sim_old');
  assert.equal(body.revision,sha(JSON.stringify([oldRun])));
  assert.equal(body.recordId,undefined);assert.equal(body.fields,undefined);
});
test('marketing exacto puede escribir aunque su rol Access sea viewer',async()=>{
  const h=harness(),data=doc([oldRun,newRun]);
  const res=await h.run('PUT',{
    identity:{role:'viewer',email:'marketing@thelab.solutions'},
    body:{data,expectedRevision:sha(JSON.stringify([oldRun]))}
  });
  assert.equal(res.status,200,await res.clone().text());assert.equal(h.patches,1);
  assert.deepEqual(JSON.parse(h.current),data);
});
test('dos escrituras desde la misma revisión usan CAS y sólo una gana',async()=>{
  const h=harness(),revision=sha(JSON.stringify([oldRun]));
  const a=doc([oldRun,{...newRun,id:'A',ts:3001}]);
  const b=doc([oldRun,{...newRun,id:'B',ts:3002}]);
  const [ra,rb]=await Promise.all([
    h.run('PUT',{body:{data:a,expectedRevision:revision}}),
    h.run('PUT',{body:{data:b,expectedRevision:revision}})
  ]);
  assert.deepEqual([ra.status,rb.status],[200,409]);
  const conflict=await rb.json();assert.equal(conflict.code,'SIMULATION_REVISION_CONFLICT');
  assert.equal(conflict.data.runs.some(r=>r.id==='A'),true);
  assert.equal(h.patches,1);
});
test('borrado se representa con clearedAt y queda persistido como documento versionado',async()=>{
  const h=harness(),revision=sha(JSON.stringify([oldRun]));
  const cleared={version:1,updatedAt:5000,clearedAt:5000,runs:[]};
  const res=await h.run('PUT',{body:{data:cleared,expectedRevision:revision}});
  assert.equal(res.status,200,await res.clone().text());
  assert.deepEqual(JSON.parse(h.current),cleared);
});
test('crea SIMULACION una sola vez cuando todavía no existe',async()=>{
  const h=harness({initial:null});
  const empty={version:1,updatedAt:0,clearedAt:0,runs:[]};
  const get=await h.run('GET');const state=await get.json();
  assert.equal(state.exists,false);assert.equal(state.revision,sha(''));
  const res=await h.run('PUT',{body:{data:empty,expectedRevision:state.revision}});
  assert.equal(res.status,200,await res.clone().text());assert.equal(h.creates,1);assert.equal(h.patches,0);
});
test('DO revalida identidad y rechaza viewer arbitrario aun si se invoca directo',async()=>{
  const h=harness(),revision=sha(JSON.stringify([oldRun]));
  assert.equal(sharedSimulationActorAllowed({role:'viewer',email:'marketing@thelab.solutions'}),true);
  assert.equal(sharedSimulationActorAllowed({role:'viewer',email:'otro@thelab.solutions'}),false);
  const res=await h.guard.fetch(new Request('https://crm-write.internal/shared-simulation',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'viewer',email:'otro@thelab.solutions'},
      data:doc([oldRun,newRun]),expectedRevision:revision})
  }));
  assert.equal(res.status,403);assert.equal(h.patches,0);
});
test('query params y campos inesperados fallan cerrados',async()=>{
  const h=harness();
  let res=await h.run('GET',{query:'?record=SIMULACION'});assert.equal(res.status,422);
  res=await h.run('PUT',{body:{data:{...doc([oldRun]),secret:'x'},expectedRevision:sha(JSON.stringify([oldRun]))}});
  assert.equal(res.status,422);assert.equal(h.patches,0);
});
