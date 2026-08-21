#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

process.env.FARM_PRODUCTION_PRELOAD_DISABLE='1';
process.env.BRIDGE_TOKEN='production-admin-test';
const store=require('../printer-bridge/farm-production-preload.js');

function event(overrides={}){
  return{
    machineId:'k1-01',nombre:'K1',numG:1,file:'pieza.gcode',
    start:1000,end:3601000,dur:60,result:'Completado',filamentMm:1000,ts:3601000,
    ...overrides,
  };
}

test('evento repetido es idempotente y no duplica odómetro',()=>{
  let state=store.normalizeProduction(null);
  let out=store.recordEvent(state,event(),5000);state=out.state;
  assert.equal(out.added,true);
  assert.equal(state.odometer['k1-01'].prints,1);
  assert.equal(state.odometer['k1-01'].hours,1);
  assert.equal(state.odometer['k1-01'].filamentMm,1000);

  out=store.recordEvent(state,event(),6000);state=out.state;
  assert.equal(out.added,false);
  assert.equal(state.odometer['k1-01'].prints,1);
  assert.equal(state.odometer['k1-01'].hours,1);
  assert.equal(state.history.length,1);
});

test('cancelado suma fallo y filamento, pero no horas ni impresión completada',()=>{
  const out=store.recordEvent(store.normalizeProduction(null),event({result:'Cancelado',dur:30,filamentMm:250}),5000);
  const row=out.state.odometer['k1-01'];
  assert.equal(row.prints,0);
  assert.equal(row.hours,0);
  assert.equal(row.failures,1);
  assert.equal(row.filamentMm,250);
});

test('migración conserva el mayor odómetro histórico sin sumar dos veces el historial',()=>{
  const historical=[event({start:1,end:3600001,ts:3600001})];
  const migrated=store.mergeMigration(
    {odometer:{'k1-01':{hours:10,filamentMm:9000,prints:8,failures:2}},history:historical},
    {odometer:{'k1-01':{hours:25,filamentMm:22000,prints:20}},history:historical},
    9999,
  );
  assert.equal(migrated.odometer['k1-01'].hours,25);
  assert.equal(migrated.odometer['k1-01'].prints,20);
  assert.equal(migrated.odometer['k1-01'].filamentMm,22000);
  assert.equal(migrated.odometer['k1-01'].failures,2);
  assert.equal(migrated.history.length,1);
});

test('merge de historial deduplica por máquina/archivo/inicio/fin/resultado',()=>{
  const a=event();
  const b={...a,ts:a.ts+10};
  const c=event({machineId:'k1-02'});
  const merged=store.mergeHistory([a],[b,c]);
  assert.equal(merged.length,2);
  assert.equal(merged.filter(x=>x.machineId==='k1-01').length,1);
});

test('roles del preload respetan viewer/operator/admin',()=>{
  assert.equal(store.roleForToken('production-admin-test'),'admin');
  assert.equal(store.roleForToken('incorrecto'),'');
});
