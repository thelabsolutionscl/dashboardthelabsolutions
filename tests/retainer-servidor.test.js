#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const HTML=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const first=HTML.indexOf('async function _retainerCrearPedido(ret){');
const last=HTML.indexOf('async function generarRetainer(',first);
assert.ok(first>0&&last>first,'el código real del pedido recurrente debe existir');
const BODY=HTML.slice(first,last);

function setup(answers){
  const calls=[];
  let next=49,lookup=0;
  const state={pedidos:[],pedidosById:{}};
  const deps={
    _nextNumPedido:async()=>{
      lookup++;
      next++;
      return 'PED-2026-'+String(next).padStart(3,'0');
    },
    _mesActualKey:()=> '2026-09',
    state,
    airtableWrite:async(_tab,method,_id,fields)=>{
      calls.push({method,fields:{...fields}});
      const a=answers.shift();
      if(a instanceof Error)throw a;
      return a;
    },
    airtableFetch:async()=>({records:state.pedidos}),
    _mergeRecords:(old,fresh)=>{
      const m=new Map((old||[]).map(x=>[x.id,x]));
      for(const item of fresh)m.set(item.id,item);
      return [...m.values()];
    },
    _rebuildPedidosById:()=>{
      state.pedidosById=Object.fromEntries(state.pedidos.map(x=>[x.id,x]));
    },
    renderPedidos:()=>{},
    console:{warn:()=>{}}
  };
  const run=new Function(...Object.keys(deps),BODY+'\nreturn _retainerCrearPedido;')(...Object.values(deps));
  const ret={id:'ret-abc',clienteId:'recClient123',concepto:'Producción mensual',monto:150000};
  return {run,ret,state,calls,lookup:()=>lookup};
}

test('el servidor devuelve el número definitivo, que prevalece al estimado local',async()=>{
  const h=setup([{id:'recExisting',fields:{'N° Pedido':'PED-2026-051','Notas pedido':'Retainer ret-abc 2026-09'}}]);
  assert.equal(await h.run(h.ret),'PED-2026-051');
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].fields['Notas pedido'],'Retainer ret-abc 2026-09');
  assert.equal(h.state.pedidosById.recExisting.fields['N° Pedido'],'PED-2026-051');
});

test('solo el conflicto 409 confirmado autoriza UN reintento con número actualizado',async()=>{
  const h=setup([
    new Error('HTTP 409: CRM_NUMBER_CONFLICT — CRM document number already exists'),
    {id:'recNew',fields:{'N° Pedido':'PED-2026-051','Notas pedido':'Retainer ret-abc 2026-09'}}
  ]);
  assert.equal(await h.run(h.ret),'PED-2026-051');
  assert.equal(h.lookup(),2);
  assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls.map(x=>x.fields['N° Pedido']),['PED-2026-050','PED-2026-051']);
  assert.equal(h.calls[0].fields['Notas pedido'],h.calls[1].fields['Notas pedido']);
});

test('un 5xx ambiguo NO origina otro POST del contrato',async()=>{
  const h=setup([new Error('HTTP 503: CRM_PENDING_RECONCILIATION'),{id:'duplicate'}]);
  assert.equal(await h.run(h.ret),false);
  assert.equal(h.calls.length,1);
  assert.equal(h.lookup(),1);
});

test('el fallback 422 conserva la identidad natural del contrato',async()=>{
  const h=setup([
    new Error('HTTP 422: Unknown field name: Detalle productos'),
    {id:'recNew',fields:{'N° Pedido':'PED-2026-050','Notas pedido':'Retainer ret-abc 2026-09'}}
  ]);
  assert.equal(await h.run(h.ret),'PED-2026-050');
  assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[0].fields['Notas pedido'],h.calls[1].fields['Notas pedido']);
  assert.equal(h.calls[1].fields['Detalle productos'],undefined);
});

test('el 422 y luego un 409 confirmado usa de nuevo una sola reserva local',async()=>{
  const h=setup([
    new Error('HTTP 422: Unknown field'),
    new Error('HTTP 409: CRM_NUMBER_CONFLICT — already used'),
    {id:'recGood',fields:{'N° Pedido':'PED-2026-051'}}
  ]);
  assert.equal(await h.run(h.ret),'PED-2026-051');
  assert.equal(h.calls.length,3);
  assert.equal(h.lookup(),2);
  assert.equal(h.calls[2].fields['Notas pedido'],'Retainer ret-abc 2026-09');
});
