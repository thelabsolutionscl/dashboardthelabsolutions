#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const auth=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/access-auth.js'),'utf8')
  .replace('export async function accessAuthorize','async function accessAuthorize');
const {accessAllows}=new Function(auth+'\nreturn {accessAllows};')();
const source=fs.readFileSync(path.join(__dirname,'../airtable-proxy/src/worker.js'),'utf8')
  .replace("import { accessAuthorize } from './access-auth.js';",'')
  .replace('export class AiBudgetGuard','class AiBudgetGuard')
  .replace('export class CrmMutationGuard','class CrmMutationGuard')
  .replace('export default','const worker=');
const {operatorWritePayloadAllowed,operatorSafeMutationResponse,OPERATOR_WRITE_FIELDS,
  CrmMutationGuard,worker}=new Function(source+'\nreturn {operatorWritePayloadAllowed,operatorSafeMutationResponse,OPERATOR_WRITE_FIELDS,CrmMutationGuard,worker};')();
const root='/v0/app1YtD74AqiPWQhy/',rec='recAAAAAAAAAAAAAA',id2='recBBBBBBBBBBBBBB';
const prior=global.fetch;
test.after(()=>{global.fetch=prior;});
global.accessAuthorize=async request=>{
  const role=request.headers.get('X-Test-Role')||'operator';
  return {identity:{role,email:role+'@example.com'}};
};
function storage(){
  const saved=new Map();
  return {async get(k){return saved.get(k)},async put(k,v){saved.set(k,v)},async delete(k){saved.delete(k)}};
}
function harness(options={}){
  const rows=new Map(),calls=[];
  const env={APP_KEY:'public-test-key',AIRTABLE_TOKEN:'private-test-pat'};
  const guard=new CrmMutationGuard({storage:storage()},env);
  env.CRM_MUTATION_GUARD={
    idFromName(name){assert.equal(name,'tls-crm-global');return name;},
    get(){return {fetch:(url,init)=>guard.fetch(new Request(url,init))}}
  };
  if(options.noGuard)delete env.CRM_MUTATION_GUARD;
  global.fetch=async (uri,opts={})=>{
    const url=new URL(String(uri));
    if(url.hostname!=='api.airtable.com')throw Error('Unexpected external URL');
    const auth=opts.headers instanceof Headers?opts.headers.get('Authorization'):
      opts.headers?.Authorization;
    assert.equal(auth,'Bearer '+env.AIRTABLE_TOKEN);
    const method=opts.method||'GET';
    calls.push({url:url.toString(),method,body:opts.body});
    if(typeof options.override==='function'){
      const response=await options.override(url,opts,rows,calls);
      if(response)return response;
    }
    const sub=url.pathname.slice(root.length).split('/');
    const table=sub[0],id=sub[1];
    if(method==='GET'){
      if(!id)return Response.json({records:[...rows.entries()]
        .filter(([_,row])=>row.table===table).map(([id,row])=>({id,fields:row.fields}))});
      const row=rows.get(id);
      return row?Response.json({id,fields:structuredClone(row.fields)}):
        Response.json({error:'NOT_FOUND'},{status:404});
    }
    if(method==='POST'){
      const body=JSON.parse(opts.body);
      const id=rec;
      rows.set(id,{table,fields:{...body.fields,
        'Datos pago / banco':'private bank','Margen real (%)':52,
        'Costo real total (CLP)':210000,'Condiciones de pago':'private terms'}});
      return Response.json({id,fields:structuredClone(rows.get(id).fields)});
    }
    if(method==='DELETE'){
      if(!id)return Response.json({error:'NOT_FOUND'},{status:404});
      rows.delete(id);
      return Response.json({id,deleted:true});
    }
    if(method==='PATCH'){
      const body=JSON.parse(opts.body);
      const items=body.records||[{id,fields:body.fields}];
      for(const row of items){
        let current=rows.get(row.id);
        if(!current){current={table,fields:{}};rows.set(row.id,current);}
        Object.assign(current.fields,row.fields);
        current.fields['Datos pago / banco']='private bank';
        current.fields['Margen real (%)']=52;
        current.fields['Costo real total (CLP)']=210000;
        current.fields['Condiciones de pago']='private terms';
      }
      if(body.records)
        return Response.json({records:items.map(r=>({id:r.id,fields:structuredClone(rows.get(r.id).fields)}))});
      return Response.json({id,fields:structuredClone(rows.get(id).fields)});
    }
    throw Error('Unexpected upstream method '+method);
  };
  const make=(table,method,body,{id=rec,role='operator',query=''}={})=>{
    let endpoint=root+encodeURIComponent(table);
    if(method==='PATCH'||method==='DELETE')endpoint+='/'+id;
    return new Request('https://proxy.example.com'+endpoint+query,{
      method,headers:{Origin:'https://dashboard.thelab.solutions',
        'X-App-Key':env.APP_KEY,'X-Test-Role':role,'Content-Type':'application/json'},
      ...(!['GET','DELETE'].includes(method)?{body:JSON.stringify(body)}:{})
    });
  };
  const run=request=>worker.fetch(request,env,{waitUntil:()=>{}});
  return {env,guard,rows,calls,make,run};
}
test('operator has no destructive CRM or machine permission; Equipo delete is narrowly reviewed',()=>{
  for(const table of ['Clientes','Cotizaciones','Pedidos','Proveedores','Maquinas',
      'Maquinas_Eventos','Maquinas_Mant','Monitor%20Sistema','Inventario'])
    assert.equal(accessAllows({role:'operator'},'DELETE',root+table+'/'+rec),false,table);
  for(const table of ['Monitor%20Sistema','Inventario']){
    assert.equal(accessAllows({role:'operator'},'POST',root+table),false);
    assert.equal(accessAllows({role:'operator'},'PATCH',root+table+'/'+rec),false);
  }
  assert.equal(accessAllows({role:'operator'},'POST',root+'Equipo_Eventos'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',root+'Equipo_Eventos/'+rec),true);
  assert.equal(accessAllows({role:'operator'},'DELETE',root+'Equipo_Eventos/'+rec),true);
  assert.equal(accessAllows({role:'admin'},'DELETE',root+'Clientes/'+rec),true);
});
test('operator mutations are strict opt-in fields by verified table and type',()=>{
  const examples=[
    ['Clientes','POST',{Empresa:'Cliente nuevo',Contacto:'María',Validado:false}],
    ['Cotizaciones','POST',{'N° Cotización':'260901',Cliente:[rec],'Total final (CLP)':120000}],
    ['Pedidos','POST',{'N° Pedido':'PED-2026-050',Cotizaciones:[rec],
      'Estado pedido':'Confirmado','Monto total (CLP)':150000}],
    ['Proveedores','POST',{Nombre:'Proveedor A',Categoría:['Impresión'],Reputación:3}],
    ['Clientes','PATCH',{Empresa:'Cliente existente',Validado:true}],
    ['Cotizaciones','PATCH',{'Estado cotización':'Enviada',Cliente:[rec]}],
    ['Pedidos','PATCH',{'Estado pedido':'En producción','Equipo asignado':'Taller'}],
    ['Proveedores','PATCH',{Contacto:'Ana',Teléfono:'+56912345678'}]
  ];
  for(const [table,method,fields] of examples)
    assert.equal(operatorWritePayloadAllowed(table,method,{fields}),true,table+' '+method);
  for(const [table,field,value] of [
    ['Clientes','Vendedor','nicanor'],['Clientes','Datos pago / banco','0123'],
    ['Clientes','Revenue total cliente (CLP)',100000],
    ['Clientes','FINANZAS - Ventas',[rec]],['Cotizaciones','Vendedor','gustavo'],
    ['Cotizaciones','Margen real (%)',60],['Cotizaciones','Detalle JSON','{}'],
    ['Pedidos','Vendedor','florencia'],['Pedidos','Costo real total (CLP)',10000],
    ['Pedidos','Anticipo pagado (50%)',true],
    ['Pedidos','N° documento tributario','33-100'],
    ['Pedidos','Factura URL','https://evil.example'],
    ['Proveedores','Condiciones de pago','a 30 días'],
    ['Proveedores','RUT','11.111.111-1']
  ]){
    assert.equal(operatorWritePayloadAllowed(table,'PATCH',{fields:{[field]:value}}),false,
      table+' forbidden '+field);
  }
  for(const table of Object.keys(OPERATOR_WRITE_FIELDS))
    assert.equal(Object.hasOwn(OPERATOR_WRITE_FIELDS[table],'Vendedor'),false);
});
test('typecast, invalid links, invalid JSON shapes, future columns and edit of document number fail closed',()=>{
  const valid={fields:{Cliente:[rec],'Estado pedido':'Confirmado'}};
  assert.equal(operatorWritePayloadAllowed('Pedidos','PATCH',valid),true);
  for(const body of [
    {...valid,typecast:true},{...valid,typecast:'true'},
    {fields:{Cliente:[id2,id2]}},{fields:{Cliente:['recInvalid']}},
    {fields:{Cliente:[rec,id2]}},{fields:{Cliente:'recAAAAAAAAAAAAAA'}},
    {fields:{'Monto total (CLP)':'999999'}},
    {fields:{'Monto total (CLP)':Infinity}},
    {fields:{'Monto total (CLP)':-1}},
    {fields:{'Texto a grabar / imprimir':'x'.repeat(20001)}},
    {fields:{'New sensitive field':'data'}},
    {fields:{'N° Pedido':'changed'}},
    {fields:{'Estado pedido':'Confirmado'},records:[]}
  ]){
    assert.equal(operatorWritePayloadAllowed('Pedidos','PATCH',body),false,
      JSON.stringify(body).slice(0,150));
  }
  assert.equal(operatorWritePayloadAllowed('Pedidos','POST',
    {fields:{'N° Pedido':'PED-2026-050','Vendedor':'nicanor'}}),false);
  assert.equal(operatorWritePayloadAllowed('Clientes','PATCH',{
    records:[{id:rec,fields:{Empresa:'One'}},{id:rec,fields:{Empresa:'Two'}}]}),false);
  assert.equal(operatorWritePayloadAllowed('Clientes','PATCH',{
    records:[{id:rec,fields:{Empresa:'One'}},{id:id2,fields:{Contacto:'Two'}}]}),true);
});
test('operator creates CRM records through DO and receives only approved fields on success',async()=>{
  const client='recCCCCCCCCCCCCCC',quote='recDDDDDDDDDDDDDD';
  for(const [table,fields,visible,hidden,seed] of [
    ['Cotizaciones',{'N° Cotización':'260901',Cliente:[client],
      'Total final (CLP)':170000},'Total final (CLP)','Margen real (%)',[
        [client,{table:'Clientes',fields:{Empresa:'Cliente correcto'}}]
      ]],
    ['Pedidos',{'N° Pedido':'PED-2026-050',Cliente:[client],
      Cotizaciones:[quote],'Monto total (CLP)':150000},
      'Monto total (CLP)','Costo real total (CLP)',[
        [client,{table:'Clientes',fields:{Empresa:'Cliente correcto'}}],
        [quote,{table:'Cotizaciones',fields:{
          'N° Cotización':'260900',Cliente:[client],Pedido:[]
        }}]
      ]]
  ]){
    const h=harness();
    for(const [id,row] of seed)h.rows.set(id,row);
    const res=await h.run(h.make(table,'POST',{fields}));
    assert.equal(res.status,200,table+' '+await res.clone().text());
    const data=await res.json();
    assert.equal(data.id,rec);
    assert.equal(data.fields[visible],fields[visible]);
    assert.equal(data.fields[hidden],undefined);
    assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
    assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  }
});
test('operator CRM PATCH is serialized and redacted for single and batch writes',async()=>{
  const h=harness();
  const single=await h.run(h.make('Pedidos','PATCH',{
    fields:{'Estado pedido':'En producción',Cantidad:2}
  }));
  assert.equal(single.status,200,await single.clone().text());
  const result=await single.json();
  assert.equal(result.fields['Estado pedido'],'En producción');
  assert.equal(result.fields['Costo real total (CLP)'],undefined);
  const batchUrl='https://proxy.example.com'+root+'Clientes';
  const batch=new Request(batchUrl,{method:'PATCH',headers:{
    Origin:'https://dashboard.thelab.solutions','X-App-Key':h.env.APP_KEY,
    'X-Test-Role':'operator','Content-Type':'application/json'
  },body:JSON.stringify({records:[
    {id:rec,fields:{Empresa:'Uno'}},{id:id2,fields:{Empresa:'Dos'}}
  ]})});
  const many=await h.run(batch);
  assert.equal(many.status,200,await many.clone().text());
  const rows=(await many.json()).records;
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.fields.Empresa),['Uno','Dos']);
  assert.ok(rows.every(r=>r.fields['Datos pago / banco']===undefined));
  assert.equal(h.calls.filter(c=>c.method==='PATCH').length,2);
});
test('direct supplier and customer writes do not expose hidden columns',async()=>{
  for(const [table,method,fields,shown,hidden] of [
    ['Clientes','POST',{Empresa:'Prueba'},'Empresa','Datos pago / banco'],
    ['Proveedores','POST',{Nombre:'Proveedor prueba'},'Nombre','Condiciones de pago'],
    ['Proveedores','PATCH',{Contacto:'Patricia'},'Contacto','Condiciones de pago']
  ]){
    const h=harness();
    const res=await h.run(h.make(table,method,{fields}));
    assert.equal(res.status,200,table+' '+method+' '+await res.clone().text());
    const data=await res.json();
    assert.equal(data.fields[shown],fields[shown]);
    assert.equal(data.fields[hidden],undefined);
    assert.equal(h.calls.filter(c=>c.method===method).length,1);
  }
});
test('operator cannot reach upstream for owner, payment, margin, real-cost or delete mutation',async()=>{
  for(const [table,method,fields] of [
    ['Clientes','PATCH',{Vendedor:'nicanor'}],
    ['Cotizaciones','PATCH',{'Margen real (%)':50}],
    ['Pedidos','PATCH',{'Anticipo pagado (50%)':true}],
    ['Pedidos','PATCH',{'Costo material real (CLP)':1500}],
    ['Proveedores','PATCH',{'Condiciones de pago':'immediate'}],
    ['Clientes','DELETE',null],
    ['Pedidos','DELETE',null]
  ]){
    const h=harness();
    const res=await h.run(h.make(table,method,fields?{fields}:null));
    assert.ok(res.status>=400,table+' '+method);
    assert.equal(h.calls.filter(c=>c.method==='PATCH'||c.method==='POST'||
      c.method==='DELETE').length,0,'no Airtable mutations for '+table+' '+method);
  }
});
test('DO independently blocks forbidden field if outer validation is accidentally bypassed',async()=>{
  const h=harness();
  const endpoint='https://crm-write.internal/scoped-patch';
  const disallowed=await h.guard.fetch(new Request(endpoint,{method:'POST',
    body:JSON.stringify({table:'Pedidos',method:'PATCH',actor:{
      email:'operator@example.com',role:'operator'
    },path:root+'Pedidos/'+rec,search:'',
    body:JSON.stringify({fields:{Vendedor:'florencia'}})})
  }));
  assert.equal(disallowed.status,422);
  const create=await h.guard.fetch(new Request('https://crm-write.internal/create',{
    method:'POST',body:JSON.stringify({table:'Pedidos',actor:{
      email:'operator@example.com',role:'operator'
    },body:{fields:{'N° Pedido':'PED-2026-050',
      'Datos pago / banco':'sensitive'}},search:''})
  }));
  assert.equal(create.status,422);
  assert.equal(h.calls.length,0);
});
test('ambiguous Airtable response never triggers a retry and is not reflected to operator',async()=>{
  const h=harness({override:async(url,opts,rows)=>{
    if(opts.method==='PATCH'){
      const raw=JSON.parse(opts.body);
      rows.set(rec,{table:'Pedidos',fields:{...raw.fields,'Costo real total (CLP)':60000}});
      throw new Error('Response lost after commit');
    }
  }});
  const res=await h.run(h.make('Pedidos','PATCH',{fields:{'Estado pedido':'En producción'}}));
  assert.equal(res.status,503);
  const body=await res.json();
  assert.equal(body.fields,undefined);
  assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);
});

test('operator machine table methods and payloads are explicitly scoped',()=>{
  assert.equal(accessAllows({role:'operator'},'PATCH',root+'Maquinas/'+rec),true);
  assert.equal(accessAllows({role:'operator'},'POST',root+'Maquinas'),false);
  assert.equal(accessAllows({role:'operator'},'POST',root+'Maquinas_Eventos'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',root+'Maquinas_Eventos/'+rec),true);
  assert.equal(accessAllows({role:'operator'},'POST',root+'Maquinas_Mant'),true);
  assert.equal(accessAllows({role:'operator'},'PATCH',root+'Maquinas_Mant/'+rec),false);

  assert.equal(operatorWritePayloadAllowed('Maquinas','PATCH',{fields:{
    estado:'mantencion',ip:'192.168.100.51',
    cam:'http://192.168.100.51:8080/?action=stream'
  }}),true);
  assert.equal(operatorWritePayloadAllowed('Maquinas','POST',{fields:{
    estado:'disponible'
  }}),false);
  assert.equal(operatorWritePayloadAllowed('Maquinas_Eventos','POST',{fields:{
    maquina_id:'k1-1',fecha:'2026-10-06',tipo:'uso',
    desc:'PED-2026-050 · Cliente',tiempo:8,pedido_id:rec
  }}),true);
  assert.equal(operatorWritePayloadAllowed('Maquinas_Eventos','PATCH',{fields:{
    desc:'Reserva ajustada',tiempo:4,pedido_id:''
  }}),true);
  assert.equal(operatorWritePayloadAllowed('Maquinas_Mant','POST',{fields:{
    maquina_id:'e5-2',tipo:'belt',notas:'Correa revisada',
    print_hours:321.5,fecha:'2026-10-06',ts:1791234000000
  }}),true);

  for(const [table,method,fields] of [
    ['Maquinas','PATCH',{'WA: estado notificado':'disponible'}],
    ['Maquinas','PATCH',{nombre:'K1 alterada'}],
    ['Maquinas','PATCH',{ip:'8.8.8.8'}],
    ['Maquinas','PATCH',{estado:'hack'}],
    ['Maquinas','PATCH',{cam:'javascript:alert(1)'}],
    ['Maquinas_Eventos','POST',{maquina_id:'k1-1',fecha:'2026-10-06',
      tipo:'otro'}],
    ['Maquinas_Eventos','POST',{maquina_id:'../admin',fecha:'2026-10-06',
      tipo:'uso'}],
    ['Maquinas_Eventos','PATCH',{maquina_id:'k1-2'}],
    ['Maquinas_Eventos','PATCH',{pedido_id:'PED-2026-050'}],
    ['Maquinas_Mant','POST',{maquina_id:'k1-1',tipo:'shell',
      fecha:'2026-10-06',ts:1791234000000}],
    ['Maquinas_Mant','POST',{maquina_id:'k1-1',tipo:'nozzle',
      fecha:'2026-10-06',ts:123}],
    ['Maquinas_Mant','PATCH',{notas:'rewrite'}]
  ]){
    assert.equal(operatorWritePayloadAllowed(table,method,{fields}),false,
      table+' '+method+' '+JSON.stringify(fields));
  }
});
test('signed operator machine mutations are filtered before and after Airtable',async()=>{
  for(const [table,method,fields,shown] of [
    ['Maquinas','PATCH',{estado:'mantencion',ip:'192.168.100.51'},'estado'],
    ['Maquinas_Eventos','POST',{maquina_id:'k1-1',fecha:'2026-10-06',
      tipo:'uso',desc:'PED-2026-050',tiempo:6,pedido_id:rec},'tipo'],
    ['Maquinas_Mant','POST',{maquina_id:'k1-1',tipo:'nozzle',
      notas:'Cambio preventivo',print_hours:200,fecha:'2026-10-06',
      ts:1791234000000},'tipo']
  ]){
    const h=harness();
    const res=await h.run(h.make(table,method,{fields}));
    assert.equal(res.status,200,table+' '+await res.clone().text());
    const data=await res.json();
    assert.equal(data.fields[shown],fields[shown]);
    assert.equal(data.fields['Datos pago / banco'],undefined);
    assert.equal(data.fields['Costo real total (CLP)'],undefined);
    assert.equal(h.calls.filter(c=>c.method===method).length,1);
    assert.equal(res.headers.get('Cache-Control'),'private, no-store');
  }

  for(const [table,method,fields] of [
    ['Maquinas','PATCH',{'WA: estado notificado':'disponible'}],
    ['Maquinas','PATCH',{ip:'1.1.1.1'}],
    ['Maquinas_Eventos','POST',{maquina_id:'k1-1',fecha:'2026-10-06',
      tipo:'uso',FUTURE_SECRET:'x'}],
    ['Maquinas_Mant','POST',{maquina_id:'k1-1',tipo:'nozzle',
      fecha:'2026-10-06',ts:1791234000000,FUTURE_SECRET:'x'}]
  ]){
    const h=harness();
    const res=await h.run(h.make(table,method,{fields}));
    assert.ok(res.status>=400,table+' '+method);
    assert.equal(h.calls.filter(c=>['POST','PATCH','DELETE'].includes(c.method)).length,0);
  }
});

test('operator Equipo event writes are schema-scoped and identity/date are immutable',()=>{
  assert.equal(operatorWritePayloadAllowed('Equipo_Eventos','POST',{fields:{
    persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',
    desc:'Trabajo desde casa',hora_inicio:'09:00',hora_fin:'18:00'
  }}),true);
  assert.equal(operatorWritePayloadAllowed('Equipo_Eventos','PATCH',{fields:{
    tipo:'reunion',desc:'Reunión cliente',hora_inicio:'10:30',hora_fin:'11:30'
  }}),true);

  for(const [method,fields] of [
    ['POST',{persona_id:'desconocido',fecha:'2026-10-06',tipo:'remoto'}],
    ['POST',{persona_id:'gustavo',fecha:'2026-10-06',tipo:'hack'}],
    ['POST',{persona_id:'gustavo',fecha:'2026-13-40',tipo:'remoto'}],
    ['POST',{persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',hora_inicio:'25:00'}],
    ['POST',{persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',FutureSecret:'x'}],
    ['PATCH',{persona_id:'nicanor'}],
    ['PATCH',{fecha:'2026-10-07'}]
  ]){
    assert.equal(operatorWritePayloadAllowed('Equipo_Eventos',method,{fields}),false,
      method+' '+JSON.stringify(fields));
  }
});

test('signed operator can create, edit and delete only reviewed Equipo events',async()=>{
  const h=harness();
  let res=await h.run(h.make('Equipo_Eventos','POST',{fields:{
    persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',
    desc:'Casa',hora_inicio:'09:00',hora_fin:'18:00'
  }}));
  assert.equal(res.status,200,await res.clone().text());
  let body=await res.json();
  assert.equal(body.fields.persona_id,'gustavo');
  assert.equal(body.fields.FutureSecret,undefined);

  res=await h.run(h.make('Equipo_Eventos','PATCH',{fields:{
    tipo:'reunion',desc:'Cliente',hora_inicio:'10:00',hora_fin:'11:00'
  }}));
  assert.equal(res.status,200,await res.clone().text());

  res=await h.run(h.make('Equipo_Eventos','DELETE',null));
  assert.equal(res.status,200,await res.clone().text());
  body=await res.json();
  assert.deepEqual(body,{id:rec,deleted:true});
  assert.equal(res.headers.get('Cache-Control'),'private, no-store');

  const blocked=harness();
  const bad=await blocked.run(blocked.make('Equipo_Eventos','POST',{fields:{
    persona_id:'gustavo',fecha:'2026-10-06',tipo:'remoto',Secret:'x'
  }}));
  assert.equal(bad.status,422);
  assert.equal(blocked.calls.filter(c=>['POST','PATCH','DELETE'].includes(c.method)).length,0);
});

