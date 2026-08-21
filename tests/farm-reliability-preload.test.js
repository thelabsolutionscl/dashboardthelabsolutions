#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.FARM_RELIABILITY_PRELOAD_DISABLE='1';
process.env.BRIDGE_TOKEN='reliability-admin-test';
const r=require('../printer-bridge/farm-reliability-preload.js');

const H=3600000;

test('parsea sólo incidentes de máquina que representan downtime',()=>{
  assert.deepEqual(r.parseIncidentAlertId('machine:k1-01:offline'),{machineId:'k1-01',type:'offline'});
  assert.deepEqual(r.parseIncidentAlertId('machine:k1-01:klipper-shutdown'),{machineId:'k1-01',type:'klipper-shutdown'});
  assert.equal(r.parseIncidentAlertId('machine:k1-01:probe-failed'),null);
  assert.equal(r.parseIncidentAlertId('queue:x:stuck'),null);
});

test('opened duplicado por restart no crea dos incidentes',()=>{
  const now=10*H;
  const events=[
    {alertId:'machine:k1:offline',state:'opened',at:2*H},
    {alertId:'machine:k1:offline',state:'opened',at:3*H},
    {alertId:'machine:k1:offline',state:'resolved',at:4*H},
  ];
  const out=r.incidentIntervals(events,now);
  assert.equal(out.length,1);
  assert.equal(out[0].start,2*H);
  assert.equal(out[0].end,4*H);
});

test('offline y klipper superpuestos cuentan como una ventana de indisponibilidad',()=>{
  const intervals=[
    {machineId:'k1',type:'offline',start:1*H,end:4*H,open:false},
    {machineId:'k1',type:'klipper-shutdown',start:2*H,end:3*H,open:false},
  ];
  const merged=r.mergeIntervals(intervals,0,10*H).k1;
  assert.equal(merged.length,1);
  assert.equal(merged[0].end-merged[0].start,3*H);
});

test('producción une intervalos para no duplicar utilización',()=>{
  const history=[
    {id:'k1',start:1*H,end:3*H,dur:120,result:'Completado'},
    {id:'k1',start:2*H,end:4*H,dur:120,result:'Cancelado'},
  ];
  const out=r.productionByMachine(history,0,10*H).k1;
  assert.equal(out.completed,1);
  assert.equal(out.notCompleted,1);
  assert.equal(out.merged.length,1);
  assert.equal(out.merged[0].end-out.merged[0].start,3*H);
});

test('métricas calculan disponibilidad, utilización, finalización, MTBF y MTTR',()=>{
  const machine={id:'k1',nombre:'K1 #1'};
  const incidents=[{machineId:'k1',start:2*H,end:3*H,rawStart:2*H,rawEnd:3*H,open:false,types:new Set(['offline'])}];
  const production={completed:3,notCompleted:1,merged:[{start:4*H,end:6*H}]};
  const m=r.machineMetrics({machine,incidents,production,windowStart:0,windowEnd:10*H,coverageStart:0,healthKnown:true});
  assert.equal(m.availabilityPct,90);
  assert.equal(m.downtimeHours,1);
  assert.equal(m.completionRatePct,75);
  assert.equal(m.incidents,1);
  assert.equal(m.mtbfHours,9);
  assert.equal(m.mttrHours,1);
  assert.equal(m.printHours,2);
  assert.equal(m.utilizationPct,22.2);
});

test('sin health.json no inventa disponibilidad ni MTBF',()=>{
  const snap=r.buildReliability({
    registry:{machines:[{id:'k1',nombre:'K1'}]},production:{history:[]},health:null,
    healthDetail:{exists:false,ok:true,mtimeMs:0},days:30,now:30*86400000,
  });
  assert.equal(snap.machines[0].availabilityPct,null);
  assert.equal(snap.machines[0].mtbfHours,null);
  assert.equal(snap.coverage.healthKnown,false);
});

test('roles permiten viewer/admin y rechazan token incorrecto',()=>{
  assert.equal(r.roleForToken('reliability-admin-test'),'admin');
  assert.equal(r.roleForToken('incorrecto'),'');
});
