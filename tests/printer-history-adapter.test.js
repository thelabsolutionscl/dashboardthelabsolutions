#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/printer-history-adapter.js');
const t=api._test;

test('eventKey es estable y cambia entre impresiones distintas',()=>{
  const a={id:'k1',file:'A.gcode',start:100,end:200,result:'Completado'};
  assert.equal(t.eventKey(a),t.eventKey({...a,ts:999999}));
  assert.notEqual(t.eventKey(a),t.eventKey({...a,end:201}));
});

test('mergeHistory deduplica el mismo cierre reportado dos veces',()=>{
  const a={id:'k1',file:'A.gcode',start:100,end:200,dur:1,result:'Completado',filamentMm:50,ts:200};
  const b={...a,ts:300};
  const rows=t.mergeHistory([a],[b]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].ts,300);
});

test('deriveOdometer replica semántica histórica: horas sólo completadas y filamento siempre',()=>{
  const odo=t.deriveOdometer([
    {id:'k1',file:'ok',start:1,end:3600001,dur:60,result:'Completado',filamentMm:100},
    {id:'k1',file:'cancel',start:2,end:1800002,dur:30,result:'Cancelado',filamentMm:25},
  ]);
  assert.equal(odo.k1.hours,1);
  assert.equal(odo.k1.prints,1);
  assert.equal(odo.k1.failures,1);
  assert.equal(odo.k1.filamentMm,125);
});

test('mergeOdometers nunca hace retroceder acumulados',()=>{
  const out=t.mergeOdometers(
    {k1:{hours:100,filamentMm:9000,prints:80,failures:3}},
    {k1:{hours:90,filamentMm:12000,prints:75,failures:5}},
  );
  assert.deepEqual(out.k1,{hours:100,filamentMm:12000,prints:80,failures:5});
});

test('snapshot remoto vacío se detecta para resembrar desde caché local',()=>{
  assert.equal(t.emptyProduction({history:[],odometer:{}}),true);
  assert.equal(t.emptyProduction({history:[{id:'k1'}],odometer:{}}),false);
  assert.equal(t.emptyProduction({history:[],odometer:{k1:{hours:1}}}),false);
});
