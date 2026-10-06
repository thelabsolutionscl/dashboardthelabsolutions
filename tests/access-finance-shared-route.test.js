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
const {CrmMutationGuard,worker,sharedFinanceDocumentAllowed,sharedFinanceActorAllowed,sharedFinanceEmpty}=
  new Function(workerSource+'\nreturn {CrmMutationGuard,worker,sharedFinanceDocumentAllowed,sharedFinanceActorAllowed,sharedFinanceEmpty};')();
const priorFetch=global.fetch;test.after(()=>{global.fetch=priorFetch;});
const APP='app1YtD74AqiPWQhy',TABLE='Monitor%20Sistema',BASE='/v0/'+APP+'/',REC='recAAAAAAAAAAAAAA';
const sha=x=>createHash('sha256').update(x).digest('hex');
function financeDoc(){
  return{version:1,updatedAt:1000,
    journal:[{id:'j1',fecha:'2026-10-06',tipo:'gasto',categoria:'Materiales e insumos',
      descripcion:'PLA',monto:25000,metodo:'Transferencia',referencia:'F123',contraparte:'Proveedor',
      documentoTributario:true}],
    budget:{'2026-10':{cats:[{id:'marketing',label:'Marketing & Ads',color:'#fff',icon:'',budget:100000,ejecutado:0}]}},
    scheduledPayments:[{id:'p1',concepto:'Arriendo',monto:500000,fecha:'2026-10-10',recurrente:true}],
    saldoInicial:2500000,arqueos:{'2026-10-06':{contado:100000,esperado:100000,dif:0,ts:1000}},
    cajaFondo:50000,manualSales:[{year:'2026',mes:'10',nombre:'A',empresa:'B',item:'Trofeo',cant:1,
      valor:100000,canal:'CONTACTO',cat:'3D',fact:'999',pago:119000,porCobrar:0,fechaFact:'2026-10-06',
      fechaPago:'2026-10-06',_manual:true}],
    loans:[{fecha:'06/10/26',prestamo:100000,devolucion:null,deuda:200000,obs:'prueba'}],
    cobranza:{cliente:[{ts:1000,via:'Email'}]},costosFijos:1500000,
    comisionCfg:{rate:3.5,base:'venta'},metasVendedor:{gustavo:10000000},plazoDefault:30};
}
function harness({initial=financeDoc()}={}){
  let current=initial===null?null:JSON.stringify(initial),patches=0,creates=0;
  const env={APP_KEY:'fixture-key',AIRTABLE_TOKEN:'fixture-airtable'};
  const guard=new CrmMutationGuard({storage:{async get(){},async put(){},async delete(){}}},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-shared-finance');return name;},
    get(){return{fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  global.fetch=async(uri,opts={})=>{
    const u=new URL(String(uri));assert.equal(u.hostname,'api.airtable.com');
    const auth=opts.headers instanceof Headers?opts.headers.get('Authorization'):opts.headers?.Authorization;
    assert.equal(auth,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    if(method==='GET'){
      assert.equal(u.pathname,BASE+TABLE);assert.match(u.searchParams.get('filterByFormula')||'',/FINANZAS_V2/);
      return Response.json({records:current===null?[]:[{id:REC,fields:{Name:'FINANZAS_V2',Notes:current}}]});
    }
    const body=JSON.parse(opts.body);assert.equal(body.fields.Name,'FINANZAS_V2');
    if(method==='PATCH'){patches++;assert.equal(u.pathname,BASE+TABLE+'/'+REC);}
    else if(method==='POST'){creates++;assert.equal(u.pathname,BASE+TABLE);}
    else throw Error('unexpected '+method);
    current=body.fields.Notes;
    return Response.json({id:REC,fields:{Name:'FINANZAS_V2',Notes:current}});
  };
  const run=(method,{body,identity={role:'finance',email:'finanzas@thelab.solutions'},legacy=false,query=''}={})=>{
    global.accessAuthorize=async(_req,_env,p)=>{
      if(legacy)return{legacy:true};
      return accessAllows(identity,method,p)?{identity}:{response:Response.json({error:'denied'},{status:403})};
    };
    return worker.fetch(new Request('https://proxy.example.com/shared/finance'+query,{
      method,headers:{Origin:'https://dashboard.thelab.solutions','X-App-Key':env.APP_KEY,
        ...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    }),env,{waitUntil(){}});
  };
  return{run,guard,get current(){return current},get patches(){return patches},get creates(){return creates}};
}
test('RBAC limita Finanzas compartidas a finance/admin',()=>{
  for(const method of ['GET','PUT']){
    assert.equal(accessAllows({role:'finance',email:'f@x.cl'},method,'/shared/finance'),true);
    assert.equal(accessAllows({role:'admin',email:'a@x.cl'},method,'/shared/finance'),true);
    for(const role of ['viewer','operator','sales'])
      assert.equal(accessAllows({role,email:role+'@x.cl'},method,'/shared/finance'),false);
  }
});
test('documento financiero válido cubre todas las áreas migradas',()=>{
  const d=financeDoc();assert.equal(sharedFinanceDocumentAllowed(d),true);
  assert.deepEqual(Object.keys(sharedFinanceEmpty()).sort(),Object.keys(d).sort());
  assert.equal(sharedFinanceDocumentAllowed({...d,secret:'x'}),false);
  assert.equal(sharedFinanceDocumentAllowed({...d,plazoDefault:366}),false);
});
test('GET no expone recordId y devuelve revisión CAS',async()=>{
  const h=harness(),res=await h.run('GET');assert.equal(res.status,200);
  const body=await res.json();assert.equal(body.exists,true);assert.equal(body.recordId,undefined);
  assert.equal(body.revision,sha(JSON.stringify(financeDoc())));
});
test('legacy APP_KEY no puede leer Finanzas compartidas',async()=>{
  const h=harness(),res=await h.run('GET',{legacy:true});assert.equal(res.status,503);
  const body=await res.json();assert.equal(body.code,'ACCESS_REQUIRED');
});
test('dos equipos con la misma revisión: sólo una escritura gana',async()=>{
  const base=financeDoc(),h=harness({initial:base}),revision=sha(JSON.stringify(base));
  const a={...base,updatedAt:2000,saldoInicial:3000000};
  const b={...base,updatedAt:2001,saldoInicial:4000000};
  const [ra,rb]=await Promise.all([
    h.run('PUT',{body:{data:a,expectedRevision:revision}}),
    h.run('PUT',{body:{data:b,expectedRevision:revision}})
  ]);
  assert.deepEqual([ra.status,rb.status],[200,409]);assert.equal(h.patches,1);
  const conflict=await rb.json();assert.equal(conflict.code,'FINANCE_REVISION_CONFLICT');
  assert.equal(conflict.data.saldoInicial,3000000);
});
test('crea FINANZAS_V2 una sola vez cuando aún no existe',async()=>{
  const h=harness({initial:null}),get=await h.run('GET'),state=await get.json();
  assert.equal(state.exists,false);assert.equal(state.revision,sha(''));
  const data={...sharedFinanceEmpty(),updatedAt:1};
  const put=await h.run('PUT',{body:{data,expectedRevision:state.revision}});
  assert.equal(put.status,200,await put.clone().text());assert.equal(h.creates,1);assert.equal(h.patches,0);
});
test('Durable Object revalida actor finance/admin',async()=>{
  const h=harness(),base=financeDoc(),revision=sha(JSON.stringify(base));
  assert.equal(sharedFinanceActorAllowed({role:'finance',email:'f@x.cl'}),true);
  assert.equal(sharedFinanceActorAllowed({role:'operator',email:'o@x.cl'}),false);
  const res=await h.guard.fetch(new Request('https://crm-write.internal/shared-finance',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({actor:{role:'operator',email:'o@x.cl'},data:base,expectedRevision:revision})
  }));
  assert.equal(res.status,403);assert.equal(h.patches,0);
});
test('payload inválido, query y método no permitido fallan cerrados',async()=>{
  const h=harness(),revision=sha(JSON.stringify(financeDoc()));
  let res=await h.run('GET',{query:'?x=1'});assert.equal(res.status,422);
  res=await h.run('PUT',{body:{data:{...financeDoc(),secret:'x'},expectedRevision:revision}});
  assert.equal(res.status,422);assert.equal(h.patches,0);
  assert.equal(accessAllows({role:'finance',email:'f@x.cl'},'POST','/shared/finance'),false);
});
