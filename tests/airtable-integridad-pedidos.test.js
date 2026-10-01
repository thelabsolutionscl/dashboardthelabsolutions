#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function block(start,end){
  const i=HTML.indexOf(start);
  assert.ok(i>=0,'No se encontró '+start);
  const j=HTML.indexOf(end,i+start.length);
  assert.ok(j>i,'No se encontró el fin de '+start);
  return HTML.slice(i,j);
}
const FETCH=block('async function airtableFetch(table,max=100){','// fetch con timeout');
const DELTA=block('async function airtableFetchSince(table,sinceIso,max=1000){','// Upsert por id');
const ORDER=block('async function crearPedidoDesdeCotizacion(cotId,opts){','// Cotizaciones aprobadas');

function page(records,offset){
  return { records, ...(offset ? {offset}: {}) };
}
function rows(n,start=0){
  return Array.from({length:n},(_,i)=>({id:'rec'+(start+i),fields:{'N° Pedido':'PED-2026-'+String(start+i+1).padStart(3,'0')}}));
}
function fetcher(pages,which=FETCH){
  let calls=0;
  const http=async()=>({
    ok:true,
    json:async()=>{const p=pages[Math.min(calls,pages.length-1)];calls++;return p;}
  });
  const deps={_airtableConfig:()=>({base:'https://proxy.test',headers:{}}),airtableHttp:http,BASE_ID:'app1YtD74AqiPWQhy'};
  const fn=new Function(...Object.keys(deps),which+'\nreturn '+(which===FETCH?'airtableFetch':'airtableFetchSince')+';')(...Object.values(deps));
  return {fn,calls:()=>calls};
}

test('la página 200 sin records no convierte el CRM en una lista vacía', async()=>{
  const a=fetcher([{success:true}]);
  await assert.rejects(()=>a.fn('Pedidos',1000),/página inválida/);
});
test('el helper de lectura conserva todos los registros de páginas válidas', async()=>{
  const a=fetcher([page(rows(100),'siguiente'),page(rows(2,100))]);
  const data=await a.fn('Pedidos',1000);
  assert.equal(data.records.length,102);
  assert.equal(a.calls(),2);
});
test('las tablas críticas no aceptan una carga cortada en el límite de 1000', async()=>{
  const pages=Array.from({length:10},(_,i)=>page(rows(100,i*100),'cursor'+i));
  const a=fetcher(pages);
  await assert.rejects(()=>a.fn('Pedidos',1000),/Carga parcial/);
  assert.equal(a.calls(),10);
});
test('la paginación repetida no puede quedar en bucle silenciosamente', async()=>{
  const a=fetcher([page(rows(1),'repetido'),page(rows(1,5),'repetido')]);
  await assert.rejects(()=>a.fn('Pedidos',1000),/paginación inválida/);
});
test('el delta malformado no debe sobrescribir ni mezclar registros', async()=>{
  const a=fetcher([page(null)],DELTA);
  await assert.rejects(()=>a.fn('Pedidos','2026-09-28T10:00:00.000Z'),/delta inválido/);
});
test('un delta crítico truncado se rechaza antes de propagarlo', async()=>{
  const pages=Array.from({length:10},(_,i)=>page(rows(100,i*100),'cursor'+i));
  const a=fetcher(pages,DELTA);
  await assert.rejects(()=>a.fn('Pedidos','2026-09-28T10:00:00.000Z'),/Delta parcial/);
});

function orderHarness(remote){
  const state={
    cotizacionesById:{cot1:{id:'cot1',fields:{'N° Cotización':'260901','Total final (CLP)':119000}}},
    pedidos:[],pedidosById:{}
  };
  const calls={get:0,write:0,toasts:[]};
  const deps={
    state,
    _pedidoDeCot:()=>null,
    airtableFetch:async()=>{
      calls.get++;
      if(typeof remote==='function')return remote(calls.get);
      if(remote==='down')throw new Error('Airtable 503');
      return {records:remote||[]};
    },
    _nextNumPedido:async()=> 'PED-2026-041',
    airtableWrite:async(tab,method,id,fields)=>{
      calls.write++;
      return {id:'recNuevo',fields};
    },
    _mergeRecords:(old,changed)=>{
      const m=new Map((old||[]).map(x=>[x.id,x]));
      (changed||[]).forEach(x=>m.set(x.id,x));
      return [...m.values()];
    },
    _rebuildPedidosById:()=>{state.pedidosById=Object.fromEntries(state.pedidos.map(x=>[x.id,x]));},
    hoyCL:()=> '2026-09-28',
    toast:(s)=>calls.toasts.push(s),
    renderPedidos:()=>{},
    renderCotizaciones:()=>{}
  };
  const source='const _pedidosCotEnCurso=new Set();\n'+ORDER+
     '\nreturn crearPedidoDesdeCotizacion;';
  return {fn:new Function(...Object.keys(deps),source)(...Object.values(deps)),state,calls};
}

test('no crea otro pedido si el mismo enlace ya existe en Airtable (otro computador)',async()=>{
  const h=orderHarness([{id:'recAnterior',fields:{'N° Pedido':'PED-2026-040',Cotizaciones:['cot1']}}]);
  assert.equal(await h.fn('cot1',{silent:true}),false);
  assert.equal(h.calls.write,0);
  assert.equal(h.state.pedidosById.recAnterior.id,'recAnterior');
});
test('no crea pedidos a ciegas cuando no se puede verificar el vínculo remoto',async()=>{
  const h=orderHarness('down');
  assert.equal(await h.fn('cot1',{silent:true}),false);
  assert.equal(h.calls.write,0);
});
test('conserva en pantalla el pedido recién creado aunque falle la recarga posterior',async()=>{
  const h=orderHarness(n=>{
    if(n===1)return {records:[]};
    throw new Error('Airtable timeout después de crear');
  });
  assert.equal(await h.fn('cot1',{silent:true}),true);
  assert.equal(h.calls.write,1);
  assert.equal(h.state.pedidosById.recNuevo.fields['Cotizaciones'][0],'cot1');
});
test('doble clic concurrente del mismo navegador no emite dos POST',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const h=orderHarness(async n=>{
    if(n===1)return pending;
    return {records:[]};
  });
  const primero=h.fn('cot1',{silent:true});
  const segundo=await h.fn('cot1',{silent:true});
  assert.equal(segundo,false);
  release({records:[]});
  assert.equal(await primero,true);
  assert.equal(h.calls.write,1);
});
test('la ruta manual nunca ignora errores al verificar un número repetido',()=>{
  const create=block('async function createCotizacion(){','// ════════════════════════════════════════════════════════════════\n// ASISTENTE');
  assert.match(create,/throw new Error\('No se pudo verificar el N° de cotización/);
});
