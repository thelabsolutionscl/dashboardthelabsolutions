#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function fn(name){
  let start=HTML.indexOf('async function '+name+'(');
  if(start<0)start=HTML.indexOf('function '+name+'(');
  assert.ok(start>=0,'falta '+name);
  const open=HTML.indexOf('{',start);
  let d=0,q='',esc=false,line=false,block=false;
  for(let i=open;i<HTML.length;i++){
    const c=HTML[i],n=HTML[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q='';continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c.charCodeAt(0)===96){q=c;continue;}
    if(c==='{')d++;else if(c==='}'&&--d===0)return HTML.slice(start,i+1);
  }
  assert.fail('no cerró '+name);
}
const schema=fn('_clienteSchemaRetryable');
const refs=fn('_clienteRefs');
const depsFn=fn('_clientesDependencias');
const summary=fn('_clienteDependenciasResumen');
const bulk=fn('bulkChangeEtapa');
const delOne=fn('deleteCliente');
const delMany=fn('deleteSelectedClientes');
const createLead=fn('createLead');
const newFlow=fn('startNewClientFlow');

test('solo HTTP 422 de campo desconocido habilita fallback de esquema',()=>{
  const check=new Function(schema+'\nreturn _clienteSchemaRetryable;')();
  assert.equal(check(new Error('HTTP 422: Unknown field name: Comuna')),true);
  assert.equal(check(new Error('HTTP 422: INVALID_VALUE_FOR_COLUMN')),false);
  assert.equal(check(new Error('HTTP 503: unknown upstream')),false);
  assert.equal(check(new Error('timeout unknown')),false);
});

test('crear cliente no repite POST por 5xx/timeout con texto unknown',()=>{
  assert.match(createLead,/if\(ciudadVal&&_clienteSchemaRetryable\(e\)\)/);
  assert.doesNotMatch(createLead,/toLowerCase\(\)\.includes\('unknown'\)/);
  assert.match(newFlow,/catch\(e\)\{if\(_clienteSchemaRetryable\(e\)\)/);
  assert.doesNotMatch(newFlow,/catch\(e\)\{if\(e\.message\.toLowerCase\(\)\.includes\('unknown'\)\)/);
});

test('cambio masivo a etapa de cliente también persiste Validado=true',async()=>{
  const writes=[],state={clientesByIdRec:{
    recCliente000001:{id:'recCliente000001',fields:{'Etapa venta':'Contactado','Validado':false}}
  }};
  const elements={
    bulkEtapaSelect:{value:'Cliente activo'},
    bulkApplyBtn:{disabled:false,textContent:''},
    bulkDelBtn:{disabled:false}
  };
  const run=new Function('selectedClientes','document','confirm','airtableWrite','state','_ETAPAS_CLIENTE','toast','renderClientes','renderOverview',
    bulk+'\nreturn bulkChangeEtapa;')(
      new Set(['recCliente000001']),
      {getElementById:id=>elements[id]},
      ()=>true,
      async(table,method,id,fields)=>{writes.push({table,method,id,fields});return{fields};},
      state,['Cliente activo','Cliente inactivo','Inactivo'],()=>{},()=>{},()=>{}
    );
  await run();
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].fields,{'Etapa venta':'Cliente activo','Validado':true});
  assert.equal(state.clientesByIdRec.recCliente000001.fields.Validado,true);
});

function depWorld(){
  const airtableFetch=async table=>{
    if(table==='Cotizaciones')return{records:[
      {id:'cot1',fields:{Cliente:['recA']}},
      {id:'cot2',fields:{Cliente:['recB']}}
    ]};
    if(table==='Pedidos')return{records:[{id:'ped1',fields:{Cliente:['recA']}}]};
    if(table==='Facturas')return{records:[{id:'fac1',fields:{'Cliente ID':'recA'}}]};
    throw Error('tabla inesperada');
  };
  return new Function('airtableFetch',refs+'\n'+depsFn+'\n'+summary+
    '\nreturn {_clientesDependencias,_clienteDependenciasResumen};')(airtableFetch);
}

test('dependencias remotas incluyen cotizaciones, pedidos y facturas',async()=>{
  const w=depWorld(),m=await w._clientesDependencias(['recA','recB','recC']);
  assert.deepEqual(m.get('recA'),{cotizaciones:['cot1'],pedidos:['ped1'],facturas:['fac1']});
  assert.deepEqual(m.get('recB'),{cotizaciones:['cot2'],pedidos:[],facturas:[]});
  assert.deepEqual(m.get('recC'),{cotizaciones:[],pedidos:[],facturas:[]});
  assert.match(w._clienteDependenciasResumen(m.get('recA')),/1 cotización, 1 pedido, 1 factura/);
});

test('borrado individual falla cerrado si no puede verificar historial',async()=>{
  let deletes=0,confirmed=0;const notes=[];
  const run=new Function('_clientesDependencias','_clienteDependenciasResumen','toast','confirm','airtableDelete','state','sanitizeForRestore','closeClienteDetalle','renderClientes','renderOverview','toastUndo','airtableWrite',
    delOne+'\nreturn deleteCliente;')(
      async()=>{throw new Error('Airtable 503');},()=>'',(m,k)=>notes.push({m,k}),
      ()=>{confirmed++;return true;},async()=>{deletes++;},
      {clientesByIdRec:{recA:{fields:{Empresa:'A'}}},clientes:[],clientesById:{}},x=>x,()=>{},()=>{},()=>{},()=>{},async()=>{}
    );
  await run('recA','A');
  assert.equal(deletes,0);
  assert.equal(confirmed,0);
  assert.match(notes[0].m,/Eliminación bloqueada/);
});

test('borrado individual bloquea cliente con historial',async()=>{
  let deletes=0,confirmed=0;const notes=[];
  const dep=new Map([['recA',{cotizaciones:['cot1'],pedidos:[],facturas:[]}]]);
  const run=new Function('_clientesDependencias','_clienteDependenciasResumen','toast','confirm','airtableDelete','state','sanitizeForRestore','closeClienteDetalle','renderClientes','renderOverview','toastUndo','airtableWrite',
    delOne+'\nreturn deleteCliente;')(
      async()=>dep,d=>d.cotizaciones.length+' cotización',(m,k)=>notes.push({m,k}),
      ()=>{confirmed++;return true;},async()=>{deletes++;},
      {clientesByIdRec:{recA:{fields:{Empresa:'A'}}},clientes:[],clientesById:{}},x=>x,()=>{},()=>{},()=>{},()=>{},async()=>{}
    );
  await run('recA','A');
  assert.equal(deletes,0);assert.equal(confirmed,0);
  assert.match(notes[0].m,/No se puede eliminar/);
});

test('borrado masivo verifica una vez y conserva registros vinculados',()=>{
  assert.match(delMany,/await _clientesDependencias\(ids\)/);
  assert.match(delMany,/bloqueados\.push/);
  assert.match(delMany,/selectedClientes\.delete\(id\)/);
  assert.doesNotMatch(delMany,/selectedClientes\.clear\(\)/);
});

test('el borrado usa datos remotos antes de preguntar o ejecutar DELETE',()=>{
  const get=delOne.indexOf('await _clientesDependencias([id])');
  const confirmAt=delOne.indexOf('confirm(');
  const del=delOne.indexOf("airtableDelete('Clientes'");
  assert.ok(get>=0&&confirmAt>get&&del>confirmAt);
  const getMany=delMany.indexOf('await _clientesDependencias(ids)');
  const confirmMany=delMany.indexOf('confirm(');
  const delManyAt=delMany.indexOf("airtableDelete('Clientes'");
  assert.ok(getMany>=0&&confirmMany>getMany&&delManyAt>confirmMany);
});
