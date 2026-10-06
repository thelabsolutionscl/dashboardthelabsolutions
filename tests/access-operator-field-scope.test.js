#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {worker,OPERATOR_READ_FIELDS,VIEWER_READ_FIELDS}=
  new Function(source+'\nreturn {worker,OPERATOR_READ_FIELDS,VIEWER_READ_FIELDS};')();
const prior=global.fetch;
test.after(()=>{global.fetch=prior;});
const base='/v0/app1YtD74AqiPWQhy/',id='recAAAAAAAAAAAAAA';
global.accessAuthorize=async req=>({identity:{email:'operator@example.com',
  role:req.headers.get('X-Test-Role')||'operator'}});
function fixture(response){
  const calls=[],env={APP_KEY:'public-test',AIRTABLE_TOKEN:'private-test'};
  global.fetch=async(url,opts={})=>{
    calls.push({url:String(url),opts});
    const auth=opts.headers instanceof Headers?opts.headers.get('Authorization'):opts.headers.Authorization;
    assert.equal(auth,'Bearer '+env.AIRTABLE_TOKEN);
    return typeof response==='function'?response(url,opts):Response.json(response);
  };
  async function run(path,role='operator'){
    const r=await worker.fetch(new Request('https://proxy.example.com'+path,{
      headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,'X-Test-Role':role}
    }),env,{waitUntil:()=>{}});
    return {status:r.status,body:await r.json(),headers:r.headers};
  }
  return {run,calls};
}
function record(fields){return {id,fields,createdTime:'2026-09-29T12:00:00.000Z'};}
test('operator can see legitimate business totals, not margins, bank details or real production costs',()=>{
  const required={
    Clientes:['Empresa','Teléfono','Email','Pedidos','Cotizaciones'],
    Cotizaciones:['N° Cotización','Subtotal (CLP)','Total final (CLP)','Cliente','Pedido'],
    Pedidos:['N° Pedido','Estado pedido','Monto total (CLP)','Cliente','Cotizaciones'],
    Proveedores:['Nombre','Email','WhatsApp','Estado'],
    Maquinas:['id','nombre','modelo','estado','ip','cam'],
    Maquinas_Eventos:['maquina_id','fecha','tipo','desc','tiempo','pedido_id'],
    Maquinas_Mant:['maquina_id','tipo','notas','print_hours','fecha','ts'],
    Equipo_Eventos:['persona_id','fecha','tipo','desc','hora_inicio','hora_fin']
  };
  const forbidden={
    Clientes:['Datos pago / banco','Facturas vencidas',
      'Revenue total cliente (CLP)','FINANZAS - Ventas','Resumen IA'],
    Cotizaciones:['Margen real (%)','Detalle JSON','Ficha Propuesta'],
    Pedidos:['Costo real total (CLP)','Costo material real (CLP)',
      'Costo mano de obra (CLP)','Análisis FINANCE_AGENT',
      'N° documento tributario','Factura URL','Monto abono (CLP)'],
    Proveedores:['Condiciones de pago','RUT','Notas'],
    Maquinas:['WA: estado notificado','FutureMachineSecret'],
    Maquinas_Eventos:['FutureEventSecret'],
    Maquinas_Mant:['FutureMaintenanceSecret'],
    Equipo_Eventos:['FutureTeamSecret']
  };
  for(const [table,fields] of Object.entries(required))
    for(const field of fields)
      assert.ok(OPERATOR_READ_FIELDS[table].has(field),table+' '+field);
  for(const [table,fields] of Object.entries(forbidden))
    for(const field of fields)
      assert.equal(OPERATOR_READ_FIELDS[table].has(field),false,table+' '+field);
  assert.deepEqual([...Object.keys(OPERATOR_READ_FIELDS)].sort(),
    ['Clientes','Cotizaciones','Pedidos','Proveedores',
      'Maquinas','Maquinas_Eventos','Maquinas_Mant','Equipo_Eventos'].sort());
  assert.equal(VIEWER_READ_FIELDS.Cotizaciones.has('Total final (CLP)'),false);
  assert.equal(OPERATOR_READ_FIELDS.Cotizaciones.has('Total final (CLP)'),true);
});
test('operator company-wide lists have reviewed projections and upstream field filtering',async()=>{
  for(const [table,shown,privateField] of [
    ['Clientes','Empresa','Datos pago / banco'],
    ['Cotizaciones','Total final (CLP)','Margen real (%)'],
    ['Pedidos','Monto total (CLP)','Costo real total (CLP)'],
    ['Proveedores','Nombre','Condiciones de pago'],
    ['Maquinas','ip','WA: estado notificado'],
    ['Maquinas_Eventos','pedido_id','FutureEventSecret'],
    ['Maquinas_Mant','notas','FutureMaintenanceSecret'],
    ['Equipo_Eventos','desc','FutureTeamSecret']
  ]){
    const f=fixture({records:[record({[shown]:'business',
      [privateField]:'private',FutureUnknown:'unreviewed'})],
      metadata:{secret:'private'}});
    const x=await f.run(base+table);
    assert.equal(x.status,200,table);
    assert.equal(x.body.records[0].fields[shown],'business');
    assert.equal(Object.hasOwn(x.body.records[0].fields,privateField),false,table);
    assert.equal(x.body.records[0].fields.FutureUnknown,undefined);
    assert.equal(x.body.metadata,undefined);
    assert.equal(x.headers.get('Cache-Control'),'private, no-store');
    assert.equal(f.calls.length,1);
    const fields=new URL(f.calls[0].url).searchParams.getAll('fields[]');
    assert.equal(fields.includes(privateField),false);
    assert.equal(fields.includes(shown),true);
  }
});
test('operator direct record ID GET does not return unreviewed or protected fields',async()=>{
  const f=fixture(record({'N° Pedido':'PED-1',Vendedor:'nicanor',
    'Costo mano de obra (CLP)':400000,FutureUnknown:'private'}));
  const x=await f.run(base+'Pedidos/'+id);
  assert.equal(x.status,200);
  assert.equal(x.body.id,id);
  assert.equal(x.body.fields['N° Pedido'],'PED-1');
  assert.equal(x.body.fields['Costo mano de obra (CLP)'],undefined);
  assert.equal(x.body.fields.FutureUnknown,undefined);
  assert.equal(f.calls.length,1);
});
test('operator cannot infer hidden columns through formulas, sort, view, or field-ID projection',async()=>{
  for(const suffix of [
    '?filterByFormula='+encodeURIComponent("{Datos pago / banco}!=''"),
    '?sort[0][field]='+encodeURIComponent('Margen real (%)'),
    '?view=Private',
    '?fields[]='+encodeURIComponent('Margen real (%)'),
    '?returnFieldsByFieldId=true'
  ]){
    const f=fixture({records:[record({})]});
    const x=await f.run(base+'Cotizaciones'+suffix);
    assert.equal(x.status,422,suffix);
    assert.equal(f.calls.length,0);
  }
});
test('admin unaffected and signed operator may still read machine runtime in its existing role',async()=>{
  const f=fixture({records:[record({Empresa:'Acme',
    'Datos pago / banco':'private'})]});
  const admin=await f.run(base+'Clientes','admin');
  assert.equal(admin.status,200);
  assert.equal(admin.body.records[0].fields['Datos pago / banco'],'private');
  const runtime=await f.run(base+'Maquinas');
  assert.equal(runtime.status,200);
  assert.equal(f.calls.filter(c=>[base+'Clientes',base+'Maquinas']
    .includes(new URL(c.url).pathname)).length,2);
});

test('operator machine reads expose reviewed operations only and reject query side channels',async()=>{
  const f=fixture({records:[record({
    id:'k1-1',nombre:'Creality K1',estado:'disponible',ip:'192.168.100.51',
    cam:'http://192.168.100.51:8080/?action=stream',
    'WA: estado notificado':'mantencion',FutureMachineSecret:'private'
  })]});
  const x=await f.run(base+'Maquinas');
  assert.equal(x.status,200);
  assert.equal(x.body.records[0].fields.ip,'192.168.100.51');
  assert.equal(x.body.records[0].fields.cam,'http://192.168.100.51:8080/?action=stream');
  assert.equal(x.body.records[0].fields['WA: estado notificado'],undefined);
  assert.equal(x.body.records[0].fields.FutureMachineSecret,undefined);
  const upstreamFields=new URL(f.calls[0].url).searchParams.getAll('fields[]');
  assert.equal(upstreamFields.includes('WA: estado notificado'),false);

  const blocked=fixture({records:[]});
  const q=await blocked.run(base+'Maquinas?filterByFormula='+encodeURIComponent(
    "{WA: estado notificado}!=''"));
  assert.equal(q.status,422);
  assert.equal(blocked.calls.length,0);
});

test('operator Equipo reads expose only reviewed availability fields',async()=>{
  const f=fixture({records:[record({
    persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',
    desc:'Casa',hora_inicio:'09:00',hora_fin:'18:00',
    FutureTeamSecret:'private'
  })]});
  const x=await f.run(base+'Equipo_Eventos');
  assert.equal(x.status,200);
  assert.equal(x.body.records[0].fields.persona_id,'gustavo');
  assert.equal(x.body.records[0].fields.hora_inicio,'09:00');
  assert.equal(x.body.records[0].fields.FutureTeamSecret,undefined);
  const fields=new URL(f.calls[0].url).searchParams.getAll('fields[]');
  assert.equal(fields.includes('persona_id'),true);
  assert.equal(fields.includes('FutureTeamSecret'),false);
});

