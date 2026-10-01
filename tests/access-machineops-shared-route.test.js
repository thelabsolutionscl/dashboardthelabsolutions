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
  CrmMutationGuard,worker,SHARED_MACHINEOPS_DOMAINS,SHARED_MACHINEOPS_PREFIX,
  SHARED_MACHINEOPS_BED_HISTORY,sharedMachineRecordAllowed
}=new Function(workerSource+'\nreturn {CrmMutationGuard,worker,SHARED_MACHINEOPS_DOMAINS,SHARED_MACHINEOPS_PREFIX,SHARED_MACHINEOPS_BED_HISTORY,sharedMachineRecordAllowed};')();
const priorFetch=global.fetch;test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',BASE='/v0/'+APP+'/';
const sha=x=>createHash('sha256').update(x).digest('hex');
const emptyDomain=d=>['jobs','spools','qa','workflows','profiles','safetyReadings','incidents','audit'].includes(d)?[]:{};
const config={
  automation:{enabled:true,stallMinutes:12,tempTolerance:18,offlineMinutes:2,autoLink:true,autoIncident:true,bridgeIntervalSeconds:60},
  costConfig:{electricityClpKwh:220,machineKw:.35,laborClpHour:4500,operatorMinutes:12,wearClpHour:350,failureOverheadPct:8},
  safetyConfig:{enforce:false,cameraRequired:true,ventilationRequired:true,smokeRequired:true,maxTemperature:38,maxHumidity:75,maxVoc:600,staleMinutes:10,sensorUrl:'',updatedAt:0},
  maintenanceProfiles:Object.fromEntries(['K1','K2','K2 Plus','Ender-5 Max','Giga'].map(m=>[m,{nozzle:200,lubrication:90,belt:450,extruder:250,bed:220,sensors:500,general:50}]))
};
function initialRecords(){
  const out={};
  for(const domain of SHARED_MACHINEOPS_DOMAINS){
    const data=Object.hasOwn(config,domain)?config[domain]:emptyDomain(domain);
    out[SHARED_MACHINEOPS_PREFIX+domain]=JSON.stringify({schema:3,domain,writtenAt:100,data});
  }
  out[SHARED_MACHINEOPS_PREFIX+'meta']=JSON.stringify({schema:3,domain:'meta',writtenAt:101,version:5,updatedAt:101,domains:SHARED_MACHINEOPS_DOMAINS});
  out.MACHINE_OPS_V2=JSON.stringify({version:5,updatedAt:90,...Object.fromEntries(SHARED_MACHINEOPS_DOMAINS.map(d=>[d,Object.hasOwn(config,d)?config[d]:emptyDomain(d)]))});
  out[SHARED_MACHINEOPS_BED_HISTORY]=JSON.stringify([{id:'k1-1:1',machineId:'k1-1',calibratedAt:1,updatedAt:1,signature:'mesh',range:.1}]);
  return out;
}
function harness(){
  const current=initialRecords(),ids={};let seq=0,patches=0,creates=0;
  for(const name of Object.keys(current))ids[name]='rec'+String(++seq).padStart(14,'A').slice(-14);
  const env={APP_KEY:'fixture-key',AIRTABLE_TOKEN:'fixture-airtable'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-machineops');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri));assert.equal(u.hostname,'api.airtable.com');
    const auth=opts.headers instanceof Headers?opts.headers.get('Authorization'):opts.headers?.Authorization;
    assert.equal(auth,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    if(method==='GET'){
      assert.equal(u.pathname,BASE+TABLE);
      const formula=u.searchParams.get('filterByFormula')||'';
      const names=Object.keys(current).filter(name=>formula.includes("{Name}='"+name+"'"));
      return Response.json({records:names.filter(n=>current[n]!=null).map(n=>({id:ids[n],fields:{Name:n,Notes:current[n]}}))});
    }
    const body=JSON.parse(opts.body),name=body.fields.Name;
    if(method==='PATCH'){patches++;assert.equal(u.pathname,BASE+TABLE+'/'+ids[name]);}
    else if(method==='POST'){creates++;assert.equal(u.pathname,BASE+TABLE);ids[name]=ids[name]||'recZZZZZZZZZZZZZZ';}
    else throw Error('unexpected '+method);
    current[name]=body.fields.Notes;
    return Response.json({id:ids[name],fields:{Name:name,Notes:current[name]}});
  };
  const run=(method,{body,record='',identity={role:'operator',email:'operator@thelab.solutions'}}={})=>{
    global.accessAuthorize=async(_req,_env,p)=>accessAllows(identity,method,p)?{identity}:{response:Response.json({error:'denied'},{status:403})};
    const q=record?'?record='+encodeURIComponent(record):'';
    return worker.fetch(new Request('https://proxy.example.com/shared/machineops'+q,{
      method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil(){}});
  };
  return{run,guard,current,get patches(){return patches},get creates(){return creates}};
}
test('RBAC limita MachineOps a operator/admin y solo GET/PUT',()=>{
  for(const role of ['operator','admin']){
    assert.equal(accessAllows({role},'GET','/shared/machineops'),true);
    assert.equal(accessAllows({role},'PUT','/shared/machineops'),true);
  }
  for(const role of ['viewer','sales','finance']){
    assert.equal(accessAllows({role},'GET','/shared/machineops'),false);
    assert.equal(accessAllows({role},'PUT','/shared/machineops'),false);
  }
  for(const role of ['operator','admin'])for(const method of ['POST','PATCH','DELETE'])
    assert.equal(accessAllows({role},method,'/shared/machineops'),false);
});
test('GET expone solo registros MachineOps allowlisted y oculta ids Airtable',async()=>{
  const h=harness(),res=await h.run('GET');assert.equal(res.status,200);
  const body=await res.json();assert.ok(body.records.length>=SHARED_MACHINEOPS_DOMAINS.length);
  assert.equal(body.records.some(r=>r.name==='MACHINE_OPS_V2'),false,'V3 confirmado domina al legado');
  assert.equal(body.records.every(r=>r.name.startsWith('MACHINE_OPS_V3:')),true);
  assert.equal(body.records.some(r=>Object.hasOwn(r,'id')||Object.hasOwn(r,'recordId')),false);
  assert.doesNotMatch(JSON.stringify(body),/MAIL_SIGNATURES|CALENDARIO/);
});
test('todos los payloads fixture V3, legado e historial cumplen el validador',()=>{
  const current=initialRecords();
  for(const [name,notes] of Object.entries(current))
    assert.equal(sharedMachineRecordAllowed(name,notes),true,name);
});
test('operator no puede cambiar configuración; admin sí puede',async()=>{
  const h=harness(),name=SHARED_MACHINEOPS_PREFIX+'costConfig',revision=sha(h.current[name]);
  let res=await h.run('PUT',{body:{writes:[{domain:'costConfig',data:{...config.costConfig,electricityClpKwh:300},expectedRevision:revision}],meta:{version:5,updatedAt:200}}});
  assert.equal(res.status,403);assert.equal(h.patches,0);
  res=await h.run('PUT',{identity:{role:'admin',email:'admin@thelab.solutions'},body:{writes:[{domain:'costConfig',data:{...config.costConfig,electricityClpKwh:300},expectedRevision:revision}],meta:{version:5,updatedAt:200}}});
  assert.equal(res.status,200,await res.clone().text());assert.equal(JSON.parse(h.current[name]).data.electricityClpKwh,300);
});
test('dos escrituras del mismo dominio usan CAS y solo una gana',async()=>{
  const h=harness(),name=SHARED_MACHINEOPS_PREFIX+'jobs',revision=sha(h.current[name]);
  const body=text=>({writes:[{domain:'jobs',data:[{id:text}],expectedRevision:revision}],meta:{version:5,updatedAt:200}});
  const [a,b]=await Promise.all([h.run('PUT',{body:body('A')}),h.run('PUT',{body:body('B')})]);
  assert.deepEqual([a.status,b.status],[200,409]);
  assert.equal((await b.json()).code,'MACHINEOPS_REVISION_CONFLICT');
  assert.deepEqual(JSON.parse(h.current[name]).data,[{id:'A'}]);
});
test('dominios distintos no producen conflicto falso ni se pisan',async()=>{
  const h=harness(),j=SHARED_MACHINEOPS_PREFIX+'jobs',s=SHARED_MACHINEOPS_PREFIX+'spools';
  const [a,b]=await Promise.all([
    h.run('PUT',{body:{writes:[{domain:'jobs',data:[{id:'job-new'}],expectedRevision:sha(h.current[j])}],meta:{version:5,updatedAt:200}}}),
    h.run('PUT',{body:{writes:[{domain:'spools',data:[{id:'spool-new'}],expectedRevision:sha(h.current[s])}],meta:{version:5,updatedAt:201}}})
  ]);
  assert.deepEqual([a.status,b.status],[200,200]);
  assert.deepEqual(JSON.parse(h.current[j]).data,[{id:'job-new'}]);
  assert.deepEqual(JSON.parse(h.current[s]).data,[{id:'spool-new'}]);
});
test('historial de cama tiene ruta individual y CAS independiente',async()=>{
  const h=harness(),raw=h.current[SHARED_MACHINEOPS_BED_HISTORY],revision=sha(raw);
  let res=await h.run('GET',{record:SHARED_MACHINEOPS_BED_HISTORY});assert.equal(res.status,200);
  let body=await res.json();assert.equal(body.records.length,1);assert.equal(body.records[0].name,SHARED_MACHINEOPS_BED_HISTORY);
  const data=[{id:'k2-1:2',machineId:'k2-1',calibratedAt:2,updatedAt:2,signature:'mesh2',range:.2}];
  res=await h.run('PUT',{record:SHARED_MACHINEOPS_BED_HISTORY,body:{data,expectedRevision:revision}});
  assert.equal(res.status,200,await res.clone().text());
  assert.deepEqual(JSON.parse(h.current[SHARED_MACHINEOPS_BED_HISTORY]),data);
});
test('la ruta rechaza otros registros de Monitor Sistema',async()=>{
  const h=harness();
  const res=await h.run('GET',{record:'CALENDARIO'});
  assert.equal(res.status,403);
});
