#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../js/machineops-unattended-safety.js');

const NOW=Date.parse('2026-08-20T16:00:00Z');
const GOOD_READING={online:true,at:'2026-08-20T15:55:00Z',temperature:24,humidity:45,voc:120,ventilation:true,smoke:false};
function snapshot(extra={}){
  return policy.normalizeSnapshot({
    config:{strict:true,unattendedMinutes:240,nightStart:19,nightEnd:9,staleMinutes:10,cameraRequired:true,ventilationRequired:true,smokeRequired:true},
    reading:GOOD_READING,cameras:{m1:true},...extra,
  });
}

test('trabajo de 4 horas es desatendido aunque sea de día',()=>{
  assert.equal(policy.jobIsUnattended({machineId:'m1',secs:4*3600},NOW,{},12),true);
});

test('trabajo corto nocturno también es desatendido',()=>{
  assert.equal(policy.jobIsUnattended({machineId:'m1',secs:30*60},NOW,{},22),true);
  assert.equal(policy.jobIsUnattended({machineId:'m1',secs:30*60},NOW,{},12),false);
});

test('trabajo largo sin estado ambiental bloquea fail-closed',()=>{
  const r=policy.evaluateSnapshot(snapshot({reading:null}),{machineId:'m1',secs:5*3600},NOW,12);
  assert.equal(r.ok,false);
  assert.match(r.blockers.join(' '),/ausente|vencida|conexión/i);
});

test('trabajo nocturno sin cámara bloquea aunque sensor esté sano',()=>{
  const r=policy.evaluateSnapshot(snapshot({cameras:{m1:false}}),{machineId:'m1',secs:30*60},NOW,22);
  assert.equal(r.ok,false);
  assert.match(r.blockers.join(' '),/cámara/i);
});

test('lectura fresca, cámara, ventilación y humo normal permiten desatendido',()=>{
  const r=policy.evaluateSnapshot(snapshot(),{machineId:'m1',secs:5*3600},NOW,12);
  assert.equal(r.ok,true,JSON.stringify(r.blockers));
  assert.equal(r.fresh,true);
});

test('humo bloquea incluso con el resto sano',()=>{
  const r=policy.evaluateSnapshot(snapshot({reading:{...GOOD_READING,smoke:true}}),{machineId:'m1',secs:5*3600},NOW,12);
  assert.equal(r.ok,false);
  assert.match(r.blockers.join(' '),/humo/i);
});

test('un trabajo corto diurno no queda secuestrado por la política desatendida',()=>{
  const r=policy.evaluateSnapshot(snapshot({reading:null,cameras:{}}),{machineId:'m1',secs:45*60},NOW,12);
  assert.equal(r.unattended,false);
  assert.equal(r.ok,true);
});
