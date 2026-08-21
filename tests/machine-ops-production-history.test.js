#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const api=require('../js/machine-production-history.js')._test;
const adapter=fs.readFileSync(path.join(__dirname,'..','js','machineops-storage-adapter.js'),'utf8');

function event(overrides={}){
  return{id:'k1-1',nombre:'K1',numG:1,file:'pieza.gcode',start:1000,end:361000,dur:6,result:'Completado',filamentMm:1200,ts:361000,...overrides};
}

test('la clave de evento es determinista entre navegadores',()=>{
  const a=event(),b={...a,ts:999999,nombre:'otro nombre visible'};
  assert.equal(api.eventKey(a),api.eventKey(b));
});

test('el mismo término de impresión no suma dos veces',()=>{
  const first=api.applyEvent({},event());
  assert.equal(first.added,true);
  assert.equal(first.production.odometer.prints,1);
  assert.equal(first.production.odometer.attempts,1);
  const second=api.applyEvent(first.production,event({ts:999999}));
  assert.equal(second.added,false);
  assert.equal(second.production.odometer.prints,1);
  assert.equal(second.production.odometer.attempts,1);
  assert.equal(second.production.odometer.filamentMm,1200);
});

test('fallos cuentan intento y fallo pero no horas completadas',()=>{
  const r=api.applyEvent({},event({result:'Fallido',dur:30,filamentMm:400}));
  assert.equal(r.production.odometer.attempts,1);
  assert.equal(r.production.odometer.failures,1);
  assert.equal(r.production.odometer.prints,0);
  assert.equal(r.production.odometer.hours,0);
  assert.equal(r.production.odometer.filamentMm,400);
});

test('seed conserva el odómetro histórico aunque el historial local esté recortado',()=>{
  const seed=api.seedProduction('k1-1',[event()],{hours:900,filamentMm:900000,prints:700});
  assert.equal(seed.odometer.hours,900);
  assert.equal(seed.odometer.filamentMm,900000);
  assert.equal(seed.odometer.prints,700);
  assert.equal(seed.history.length,1);
});

test('merge entre dos navegadores conserva máximos y une eventos sin duplicar',()=>{
  const a=api.seedProduction('k1-1',[event()],{hours:20,filamentMm:10000,prints:10});
  const b=api.applyEvent(api.seedProduction('k1-1',[],{hours:25,filamentMm:9000,prints:11}),event({start:2000,file:'pieza-2.gcode'})).production;
  const merged=api.mergeProduction(a,b,'k1-1');
  assert.equal(merged.history.length,2);
  assert.equal(merged.odometer.hours>=25,true);
  assert.equal(merged.odometer.prints>=11,true);
  assert.equal(merged.odometer.filamentMm>=10000,true);
});

test('el bootstrap carga historial central antes de safety',()=>{
  const p=adapter.indexOf("'js/machine-production-history.js'");
  const s=adapter.indexOf("'js/machineops-unattended-safety.js'");
  assert.ok(p>=0&&s>p,'historial central debe cargarse antes de safety');
});
