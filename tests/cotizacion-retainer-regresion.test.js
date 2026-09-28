#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function cut(a,b){
  const i=HTML.indexOf(a);assert.ok(i>=0,a+' missing');
  const j=HTML.indexOf(b,i+a.length);assert.ok(j>i,b+' missing');
  return HTML.slice(i,j);
}
const HELPER=cut('async function _saveCotFields(method,id,fields){','async function saveEditCot(){');
const GUIDED=cut('async function crearCotizacionGuiada(d){','// Pantalla final con opciones de compartir');
const MANUAL=cut('async function createCotizacion(){','// ════════════════════════════════════════════════════════════════');
const AUTO=cut('async function retainersAutoCheck(){','function renderRetainers()');

function helper(responses){
  const calls=[];
  const deps={
    airtableWrite:async(table,method,id,fields)=>{
      calls.push({table,method,id,fields:{...fields}});
      const value=responses.shift();
      if(value instanceof Error)throw value;
      return value;
    },
    ensureCotizacionFields:async()=>calls.push({kind:'schema'})
  };
  return {fn:new Function(...Object.keys(deps),HELPER+'\nreturn _saveCotFields;')(...Object.values(deps)),calls};
}
test('no reintenta un POST ambiguo aunque diga unknown',async()=>{
  const h=helper([new Error('HTTP 503: unknown upstream'),{id:'duplicate'}]);
  await assert.rejects(()=>h.fn('POST',null,{'N° Cotización':'260901'}),/503/);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
});
test('no reintenta un POST por timeout ni corte de red',async()=>{
  const h=helper([new Error('Error de red: timeout'),{id:'duplicate'}]);
  await assert.rejects(()=>h.fn('POST',null,{}),/timeout/);
  assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
});
test('reintenta 422 de campo desconocido, no cualquier error 422',async()=>{
  const yes=helper([new Error('HTTP 422: Unknown field name: Detalle JSON'),{id:'recNueva',fields:{}}]);
  assert.equal((await yes.fn('POST',null,{})).id,'recNueva');
  assert.equal(yes.calls.filter(x=>x.method==='POST').length,2);
  const no=helper([new Error('HTTP 422: INVALID_VALUE_FOR_COLUMN'),{id:'duplicate'}]);
  await assert.rejects(()=>no.fn('POST',null,{}),/422/);
  assert.equal(no.calls.filter(x=>x.method==='POST').length,1);
});

function guided(first){
  let writes=0, rendered=0;
  const state={cotizaciones:[],cotizacionesById:{}};
  const deps={
    _nextNumCotizacion:async()=> '260901',
    _crmRequestId:()=> 'crm:test-guided',
    hoyCL:()=> '2026-09-28',
    calBusinessDate:()=> '2026-10-12',
    isVendorMode:()=>false,
    currentVendorId:()=>null,
    state,
    airtableWrite:async(_table,method,id,fields)=>{
      writes++;
      if(first)throw first;
      return {id:'recQuote',fields};
    },
    ensureCotizacionFields:async()=>{},
    _mergeRecords:(_old,changed)=>changed,
    _rebuildCotizacionesById:()=>{state.cotizacionesById=Object.fromEntries(state.cotizaciones.map(x=>[x.id,x]));},
    _advanceEtapaCliente:async()=>{},
    loadAllDataSilent:async()=>{}, // refresco real se salta por throttling
    renderCotizaciones:()=>{rendered++;},
    renderOverview:()=>{},
    syncCotizacionADrive:()=>{}
  };
  return {fn:new Function(...Object.keys(deps),GUIDED+'\nreturn crearCotizacionGuiada;')(...Object.values(deps)),state,writes:()=>writes,rendered:()=>rendered};
}
test('la guiada adopta el ID recién creado aun si el refresco está limitado',async()=>{
  const h=guided();
  const result=await h.fn({items:[{desc:'Trofeo',und:1,costo:10000,venta:20000}],estadoInicial:'Solicitada'});
  assert.equal(result.cotId,'recQuote');
  assert.equal(h.state.cotizaciones.length,1);
  assert.equal(h.state.cotizacionesById.recQuote.id,'recQuote');
  assert.equal(h.writes(),1);
  assert.equal(h.rendered(),1);
});
test('guiada no hace doble POST tras un error ambiguo',async()=>{
  const h=guided(new Error('HTTP 502: unknown gateway error'));
  await assert.rejects(()=>h.fn({items:[]}),/502/);
  assert.equal(h.writes(),1);
});

function auto(results){
  const notes=[];
  const retainers=results.map((_,i)=>({id:'r'+i,activo:true,ultimoGenerado:'',dia:1}));
  const deps={
    state:{loaded:true},
    _retainers:()=>retainers,
    _mesActualKey:()=> '2026-09',
    generarRetainer:async id=>{
      const item=results[+id.slice(1)];
      if(item instanceof Error)throw item;
      return item;
    },
    toast:(message,kind)=>notes.push({message,kind}),
    console:{error:()=>{}}
  };
  const fn=new Function(...Object.keys(deps),'let _retainersRunning=false;\n'+AUTO+'\nreturn retainersAutoCheck;')(...Object.values(deps));
  return {fn,notes};
}
test('recurrentes: solo cuenta los pedidos confirmados y alerta sobre fallos',async()=>{
  const h=auto([true,false,new Error('red')]);
  await h.fn();
  assert.equal(h.notes.filter(n=>n.kind==='success').length,1);
  assert.match(h.notes.find(n=>n.kind==='success').message,/1 contrato/);
  assert.equal(h.notes.filter(n=>n.kind==='error').length,1);
  assert.match(h.notes.find(n=>n.kind==='error').message,/2 contrato/);
});
test('recurrentes: no anuncia éxitos si fallan todos los pedidos',async()=>{
  const h=auto([false,false]);
  await h.fn();
  assert.equal(h.notes.filter(n=>n.kind==='success').length,0);
  assert.equal(h.notes.filter(n=>n.kind==='error').length,1);
});
test('cotización manual adopta respuesta POST antes del refresco en segundo plano',()=>{
  assert.match(MANUAL,/const _creada=await _saveCotFields\('POST'/);
  assert.match(MANUAL,/_mergeRecords\(state\.cotizaciones,\[_creada\]\)/);
  assert.match(MANUAL,/const _newCot=\(_creada&&_creada\.id\)/);
});
