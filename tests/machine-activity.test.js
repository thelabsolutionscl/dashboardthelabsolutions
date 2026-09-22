#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Activity=require('../js/machine-activity.js');

const now=1_800_000_000_000;
const fresh=state=>({state,lastSeenAt:now-1000});

test('standby con idle_timeout Printing nunca queda libre',()=>{
  const row=Activity.derive({...fresh('standby'),busyGcode:true,idleTimeoutState:'Printing'},{now});
  assert.equal(row.state,'gcode');
  assert.equal(row.physicalBusy,true);
  assert.equal(row.available,false);
});

test('una calibración durable domina standby y sobrevive sin estado local de la vista',()=>{
  const operation={machineId:'k2-1',type:'bed_calibration',phase:'Midiendo puntos',startedAt:now-5000,expiresAt:now+300000,updatedAt:now-1000};
  const row=Activity.derive(fresh('standby'),{now,operation});
  assert.equal(row.state,'calibrating');
  assert.equal(row.physicalBusy,true);
  assert.equal(row.available,false);
  assert.match(row.reason,/Midiendo puntos/);
});

test('una pérdida temporal de telemetría no convierte una calibración durable en libre',()=>{
  const operation={machineId:'k2-1',type:'bed_calibration',phase:'Midiendo puntos',startedAt:now-5000,expiresAt:now+300000,updatedAt:now-1000};
  const row=Activity.derive({state:'standby',lastSeenAt:now-120000},{now,operation});
  assert.equal(row.state,'calibrating');
  assert.equal(row.available,false);
  assert.equal(row.telemetryFresh,false);
});

test('solo whitelist libre + telemetría fresca produce available',()=>{
  for(const state of ['idle','ready','standby'])assert.equal(Activity.derive(fresh(state),{now}).available,true,state);
  for(const state of ['unknown','startup','complete','cancelled','printing','paused','error','offline'])assert.equal(Activity.derive(fresh(state),{now}).available,false,state);
  assert.equal(Activity.derive({state:'standby',lastSeenAt:now-61000},{now}).available,false,'standby stale');
});

test('bloqueo administrativo y cama no liberada impiden disponibilidad',()=>{
  assert.equal(Activity.derive(fresh('standby'),{now,adminAvailable:false}).available,false);
  assert.equal(Activity.derive(fresh('standby'),{now,bedCleared:false}).available,false);
});

test('operaciones vencidas se ignoran y no dejan un falso calibrando',()=>{
  const operation={machineId:'k1-1',type:'bed_calibration',startedAt:now-60000,expiresAt:now-1};
  const row=Activity.derive(fresh('standby'),{now,operation});
  assert.equal(row.state,'standby');
  assert.equal(row.available,true);
});

test('store local conserva operación entre instancias y limpia expiradas',()=>{
  const memory=new Map(),host={localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},addEventListener(){},dispatchEvent(){}};
  const a=Activity.createStore(host),op=a.set('k1-1',{type:'bed_calibration',startedAt:Date.now(),expiresAt:Date.now()+60000});
  assert.equal(op.type,'bed_calibration');
  const b=Activity.createStore(host);
  assert.equal(b.get('k1-1').machineId,'k1-1');
  b.set('old',{type:'gcode',startedAt:1,expiresAt:2});
  assert.equal(b.get('old'),null);
});
