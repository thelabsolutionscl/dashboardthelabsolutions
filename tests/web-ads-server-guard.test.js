#!/usr/bin/env node
'use strict';

global.accessAuthorize=async()=>({legacy:true});
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','airtable-proxy','src','worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker =');
const {CrmMutationGuard,adsMutationAllowed,adsSnapshotAllowed}=
  new Function(SOURCE+'\nreturn {CrmMutationGuard,adsMutationAllowed,adsSnapshotAllowed};')();

function storage(){
  const memory=new Map();
  return {memory,api:{
    async get(k){return memory.get(k);},
    async put(k,v){memory.set(k,structuredClone(v));},
    async delete(k){memory.delete(k);}
  }};
}
const actor={role:'admin',email:'admin@example.com'};
const createMutation=(ts='2026-10-06T19:10:00.000Z')=>({
  op:'create',id:'',data:{nombre:'Búsqueda - Premiaciones',presupuesto:6000,
    estado:'ENABLED',tipo:'SEARCH'},timestamp:ts,status:'pending'
});
const editMutation=(ts='2026-10-06T19:11:00.000Z')=>({
  op:'edit',id:'1234567890',data:{nombre:'Campaña',presupuesto:7000,
    estado:'ENABLED',tipo:'SEARCH'},timestamp:ts,status:'pending'
});
function invoke(guard,path,payload){
  return guard.fetch(new Request('https://ads.internal'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  }));
}

test('validador de mutaciones falla cerrado y no acepta operaciones desconocidas',()=>{
  assert.equal(adsMutationAllowed(createMutation()),true);
  assert.equal(adsMutationAllowed(editMutation()),true);
  assert.equal(adsMutationAllowed({...editMutation(),op:'run-script'}),false);
  assert.equal(adsMutationAllowed({...editMutation(),timestamp:'not-a-date'}),false);
  assert.equal(adsMutationAllowed({...editMutation(),data:{nested:()=>{}}}),false);
  assert.equal(adsMutationAllowed({op:'delete',id:'',data:{},timestamp:new Date().toISOString()}),false);
});

test('snapshot exige clave natural completa y métricas/campañas acotadas',()=>{
  const payload={actor,date:'2026-10-06',days:30,customerId:'757-781-2099',
    kpi:{gasto:1000,impresiones:100,clics:10,conversiones:2,valor_conversion:5000},
    campaigns:[{id:'123',nombre:'Campaña',estado:'ENABLED',presupuesto:6000,gasto:1000,
      impresiones:100,clics:10,conversiones:2,valor_conversion:5000,score:80}]};
  assert.equal(adsSnapshotAllowed(payload),true);
  assert.equal(adsSnapshotAllowed({...payload,date:'2026-02-30'}),false);
  assert.equal(adsSnapshotAllowed({...payload,days:0}),false);
  assert.equal(adsSnapshotAllowed({...payload,campaigns:[{...payload.campaigns[0],score:101}]}),false);
});

test('crear campaña confirma la cola antes de Make y un doble envío no duplica ninguna salida',async()=>{
  const st=storage(),events=[],original=global.fetch;
  let scriptPosts=0,makePosts=0;
  global.fetch=async(url,opts={})=>{
    const u=new URL(String(url));
    if(u.hostname==='script.google.com'){
      scriptPosts++;events.push('script');
      assert.equal(opts.method,'POST');
      const body=JSON.parse(opts.body);
      assert.equal(body.secret,'server-secret-123456789');
      assert.equal(body.type,'mutation');
      return Response.json({ok:true});
    }
    if(u.hostname==='hook.us2.make.com'){
      makePosts++;events.push('make');
      assert.equal(scriptPosts,1,'Make solo puede ejecutarse después de confirmar Script 1');
      assert.equal(u.searchParams.get('clave'),'make-secret-123456789');
      assert.equal(u.searchParams.get('nombre'),'Búsqueda - Premiaciones');
      return Response.json({ok:true});
    }
    throw Error('unexpected fetch '+u.href);
  };
  const env={AIRTABLE_TOKEN:'pat',ADS_MUTATION_URL:'https://script.google.com/macros/s/'+
    'A'.repeat(24)+'/exec',ADS_MUTATION_SECRET:'server-secret-123456789',
    ADS_MAKE_SHELL_URL:'https://hook.us2.make.com/abcdefghijklmno',
    ADS_MAKE_SHELL_KEY:'make-secret-123456789'};
  const guard=new CrmMutationGuard({storage:st.api},env);
  try{
    const a=await invoke(guard,'/ads-mutation',{actor,mutation:createMutation()});
    assert.equal(a.status,200);assert.equal((await a.json()).shell,'created');
    const b=await invoke(guard,'/ads-mutation',{actor,mutation:createMutation()});
    assert.equal(b.status,200);assert.equal((await b.json()).reused,true);
    assert.deepEqual(events,['script','make']);
    assert.equal(scriptPosts,1);assert.equal(makePosts,1);
  }finally{global.fetch=original;}
});

test('respuesta perdida del Apps Script deja reconciliación persistente y nunca reintenta a ciegas',async()=>{
  const st=storage(),original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;throw Error('connection reset after write');};
  const guard=new CrmMutationGuard({storage:st.api},{
    AIRTABLE_TOKEN:'pat',ADS_MUTATION_URL:'https://script.google.com/macros/s/'+
      'B'.repeat(24)+'/exec',ADS_MUTATION_SECRET:'server-secret-123456789'
  });
  try{
    const first=await invoke(guard,'/ads-mutation',{actor,mutation:editMutation()});
    assert.equal(first.status,503);
    assert.equal((await first.json()).code,'ADS_MUTATION_PENDING_RECONCILIATION');
    const second=await invoke(guard,'/ads-mutation',{actor,mutation:editMutation()});
    assert.equal(second.status,503);
    assert.equal((await second.json()).code,'ADS_MUTATION_PENDING_RECONCILIATION');
    assert.equal(calls,1,'un reintento no debe generar un segundo POST incierto');
  }finally{global.fetch=original;}
});

function airtableHarness(seed={}){
  const records={
    Google_Ads_KPIs:(seed.Google_Ads_KPIs||[]).map(x=>structuredClone(x)),
    Google_Ads_Campanas:(seed.Google_Ads_Campanas||[]).map(x=>structuredClone(x)),
    Agent_Queue:(seed.Agent_Queue||[]).map(x=>structuredClone(x))
  };
  let seq=1;const calls=[],original=global.fetch;
  global.fetch=async(url,opts={})=>{
    const u=new URL(String(url)),prefix='/v0/app1YtD74AqiPWQhy/';
    if(u.hostname!=='api.airtable.com')throw Error('unexpected host '+u.hostname);
    const rest=decodeURIComponent(u.pathname.slice(prefix.length));
    const slash=rest.indexOf('/'),table=slash<0?rest:rest.slice(0,slash),id=slash<0?'':rest.slice(slash+1);
    const method=opts.method||'GET';calls.push({table,id,method});
    if(method==='GET')return Response.json({records:records[table]||[]});
    const fields=JSON.parse(opts.body).fields;
    if(method==='POST'){
      const row={id:'rec'+String(seq++).padStart(14,'0'),createdTime:new Date().toISOString(),fields};
      records[table].push(row);return Response.json(row,{status:201});
    }
    if(method==='PATCH'){
      const row=records[table].find(r=>r.id===id);assert.ok(row,'missing '+table+'/'+id);
      row.fields={...row.fields,...fields};return Response.json(row);
    }
    throw Error('unexpected method '+method);
  };
  return{records,calls,restore(){global.fetch=original;}};
}
function snapshotPayload(){
  return {actor,date:'2026-10-06',days:30,customerId:'757-781-2099',
    kpi:{gasto:50000,impresiones:1000,clics:50,conversiones:5,valor_conversion:250000},
    campaigns:[{id:'camp-1',nombre:'Campaña 1',estado:'ENABLED',presupuesto:6000,
      gasto:30000,impresiones:600,clics:30,conversiones:3,valor_conversion:180000,score:82}]};
}

test('refrescar el mismo snapshot hace POST una vez y luego PATCH, sin duplicar filas',async()=>{
  const h=airtableHarness(),st=storage(),guard=new CrmMutationGuard({storage:st.api},{AIRTABLE_TOKEN:'pat'});
  try{
    assert.equal((await invoke(guard,'/ads-snapshot',snapshotPayload())).status,200);
    assert.equal((await invoke(guard,'/ads-snapshot',snapshotPayload())).status,200);
    assert.equal(h.records.Google_Ads_KPIs.length,1);
    assert.equal(h.records.Google_Ads_Campanas.length,1);
    const k=h.calls.filter(x=>x.table==='Google_Ads_KPIs');
    const c=h.calls.filter(x=>x.table==='Google_Ads_Campanas');
    assert.equal(k.filter(x=>x.method==='POST').length,1);
    assert.equal(k.filter(x=>x.method==='PATCH').length,1);
    assert.equal(c.filter(x=>x.method==='POST').length,1);
    assert.equal(c.filter(x=>x.method==='PATCH').length,1);
  }finally{h.restore();}
});

test('duplicados históricos se detectan pero no se borran automáticamente',async()=>{
  const kFields={'Customer ID':'757-781-2099','Fecha':'2026-10-06','Días período':30};
  const cFields={'Campaign ID':'camp-1','Fecha snapshot':'2026-10-06','Período (días)':30};
  const h=airtableHarness({
    Google_Ads_KPIs:[
      {id:'recKPI0000000001',createdTime:'2026-10-06T10:00:00Z',fields:{...kFields}},
      {id:'recKPI0000000002',createdTime:'2026-10-06T11:00:00Z',fields:{...kFields}}
    ],
    Google_Ads_Campanas:[
      {id:'recCAM0000000001',createdTime:'2026-10-06T10:00:00Z',fields:{...cFields}},
      {id:'recCAM0000000002',createdTime:'2026-10-06T11:00:00Z',fields:{...cFields}}
    ]
  });
  const guard=new CrmMutationGuard({storage:storage().api},{AIRTABLE_TOKEN:'pat'});
  try{
    const res=await invoke(guard,'/ads-snapshot',snapshotPayload());
    assert.equal(res.status,200);
    const body=await res.json();assert.equal(body.legacy_duplicates,2);
    assert.equal(h.records.Google_Ads_KPIs.length,2);
    assert.equal(h.records.Google_Ads_Campanas.length,2);
    assert.equal(h.calls.some(x=>x.method==='DELETE'),false);
  }finally{h.restore();}
});

test('piloto marca Procesando antes de mutar y Completado solo después de todas las confirmaciones',async()=>{
  const h=airtableHarness({Agent_Queue:[{
    id:'recQUEUE000000001',createdTime:'2026-10-06T18:00:00Z',
    fields:{Agente:'ADS_AUTOPILOT',Estado:'Pendiente'}
  }]});
  const st=storage(),events=[];
  const env={AIRTABLE_TOKEN:'pat',CRM_MUTATION_GUARD:{
    idFromName(name){assert.equal(name,'tls-ads-mutations-global');return name;},
    get(){return{fetch:async(_url,opts)=>{
      const current=h.records.Agent_Queue[0].fields.Estado;events.push('mutation:'+current);
      assert.equal(current,'Procesando');
      return Response.json({ok:true,queued:true});
    }};}
  }};
  const guard=new CrmMutationGuard({storage:st.api},env);
  try{
    const res=await invoke(guard,'/ads-autopilot',{
      actor,recordId:'recQUEUE000000001',approve:true,mutations:[editMutation()]
    });
    assert.equal(res.status,200);
    assert.equal(h.records.Agent_Queue[0].fields.Estado,'Completado');
    assert.deepEqual(events,['mutation:Procesando']);
    const patches=h.calls.filter(x=>x.table==='Agent_Queue'&&x.method==='PATCH');
    assert.equal(patches.length,2);
  }finally{h.restore();}
});

test('si una mutación del piloto falla, la propuesta vuelve a Pendiente y nunca se marca Completada',async()=>{
  const h=airtableHarness({Agent_Queue:[{
    id:'recQUEUE000000001',createdTime:'2026-10-06T18:00:00Z',
    fields:{Agente:'ADS_AUTOPILOT',Estado:'Pendiente'}
  }]});
  const env={AIRTABLE_TOKEN:'pat',CRM_MUTATION_GUARD:{
    idFromName(){return 'x';},
    get(){return{fetch:async()=>Response.json({error:'backend uncertain',code:'ADS_MUTATION_PENDING_RECONCILIATION'},{status:503})};}
  }};
  const guard=new CrmMutationGuard({storage:storage().api},env);
  try{
    const res=await invoke(guard,'/ads-autopilot',{
      actor,recordId:'recQUEUE000000001',approve:true,mutations:[editMutation()]
    });
    assert.equal(res.status,503);
    assert.equal(h.records.Agent_Queue[0].fields.Estado,'Pendiente');
    assert.match(String(h.records.Agent_Queue[0].fields.Error||''),/ADS_MUTATION_PENDING_RECONCILIATION/);
  }finally{h.restore();}
});
