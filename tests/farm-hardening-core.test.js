'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
process.env.FARM_DATA_DIR='/tmp/tls-hardening-core';process.env.FARM_MIN_FREE_BYTES='67108864';process.env.FARM_MIN_FREE_RATIO='.01';process.env.BRIDGE_ADMIN_TOKEN='adm';
const guard=require('../printer-bridge/farm-queue-guard-preload.js');
const life=require('../printer-bridge/farm-lifecycle-preload.js');
const safety=require('../printer-bridge/farm-safety-agent-preload.js');

test('guard rechaza cantidad bytes y disco sin espacio',()=>{
  assert.equal(guard.guardDecision({stats:{count:guard.MAX_PENDING,bytes:0},disk:{ok:true},contentLength:1}).status,429);
  assert.equal(guard.guardDecision({stats:{count:0,bytes:guard.MAX_PENDING_BYTES},disk:{ok:true},contentLength:1}).status,413);
  assert.equal(guard.guardDecision({stats:{count:0,bytes:0},disk:{ok:false},contentLength:1}).status,507);
  assert.equal(guard.guardDecision({stats:{count:0,bytes:0},disk:{ok:true},contentLength:1}).ok,true);
});
test('lifecycle sólo termina estados terminales del archivo esperado',()=>{
  const j={filename:'a.gcode'};assert.equal(life.terminalDecision(j,{state:'printing',filename:'a.gcode'},{}).terminal,false);
  assert.equal(life.terminalDecision(j,{state:'complete',filename:'a.gcode'},{}).result,'Completado');
  assert.equal(life.terminalDecision(j,{state:'cancelled',filename:'a.gcode'},{}).result,'Cancelado');
  assert.equal(life.terminalDecision(j,{state:'error',filename:'a.gcode'},{}).result,'Fallido');
  assert.equal(life.terminalDecision(j,{state:'complete',filename:'otro.gcode'},{}).terminal,false);
});
test('evento lifecycle es idempotente por queue job',()=>{const a=life.eventFor({id:'q1',machineId:'m1',filename:'a.gcode',startedAt:new Date(1000).toISOString()},'Completado',61000);const b=life.eventFor({id:'q1',machineId:'m1',filename:'a.gcode',startedAt:new Date(1000).toISOString()},'Completado',62000);assert.equal(a.eventId,b.eventId);assert.equal(a.machineId,'m1');});
test('candidatos de cámara prefieren configuración y agregan K2 go2rtc',()=>{const rows=safety.cameraCandidates({ip:'192.168.1.2',model:'K2 Plus',cam:'http://x/snap'});assert.equal(rows[0],'http://x/snap');assert.ok(rows.some(x=>x.includes(':1984/api/frame.jpeg')));});
