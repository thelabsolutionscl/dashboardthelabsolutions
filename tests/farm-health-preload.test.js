#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.FARM_HEALTH_PRELOAD_DISABLE='1';
process.env.BRIDGE_TOKEN='health-admin-test';
const health=require('../printer-bridge/farm-health-preload.js');

function machine(overrides={}){return{id:'k1-01',name:'K1',ip:'192.168.100.51',lastSeenAt:new Date(Date.now()-1000).toISOString(),...overrides};}

test('dos fallos consecutivos convierten una máquina en offline',()=>{
  const now=Date.now();
  const first=health.classifyMachine(machine(),{ok:false,error:'timeout',latencyMs:2500},null,now);
  assert.equal(first.health,'degraded');
  const second=health.classifyMachine(machine(),{ok:false,error:'timeout',latencyMs:2500},first,now+30000);
  assert.equal(second.health,'offline');
  const alerts=health.deriveMachineAlerts(second);
  assert.equal(alerts.some(a=>a.id==='machine:k1-01:offline'&&a.severity==='critical'),true);
});

test('un probe sano reinicia contador y detecta Klipper shutdown',()=>{
  const prev={consecutiveFailures:4,lastOkAt:1};
  const current=health.classifyMachine(machine(),{ok:true,latencyMs:23,data:{result:{state:'shutdown',state_message:'MCU lost'}}},prev,5000);
  assert.equal(current.consecutiveFailures,0);
  assert.equal(current.online,true);
  assert.equal(current.klipperState,'shutdown');
  assert.equal(health.deriveMachineAlerts(current).some(a=>a.kind==='klipper'&&a.severity==='critical'),true);
});

test('IP ausente genera alerta de registry, no falsa alerta offline',()=>{
  const current=health.classifyMachine(machine({ip:''}),{ok:false,error:'IP privada inválida/no configurada',latencyMs:0},null,Date.now());
  const alerts=health.deriveMachineAlerts(current);
  assert.equal(alerts.some(a=>a.id==='machine:k1-01:no-ip'),true);
  assert.equal(alerts.some(a=>a.id==='machine:k1-01:offline'),false);
});

test('archivos corruptos y cola atascada aparecen como alertas',()=>{
  const now=Date.now();
  const good={exists:true,ok:true,value:{},mtimeMs:now,error:''};
  const bad={exists:true,ok:false,value:null,mtimeMs:0,error:'Unexpected token'};
  const alerts=health.deriveStaticAlerts({
    registryDetail:bad,queueDetail:good,safetyDetail:good,productionDetail:good,
    queue:{jobs:[{id:'j1',filename:'pieza.gcode',state:'retry',updatedAt:new Date(now-30*60000).toISOString()}]},
    safety:{updatedAt:now},now,dataWritable:true,
  });
  assert.equal(alerts.some(a=>a.id==='data:registry:invalid'&&a.severity==='critical'),true);
  assert.equal(alerts.some(a=>a.id==='queue:j1:stuck'),true);
});

test('snapshot de seguridad stale sólo alerta cuando puede haber trabajo desatendido',()=>{
  const now=Date.now();
  const good={exists:true,ok:true,value:{},mtimeMs:now,error:''};
  const stale={exists:true,ok:true,value:{updatedAt:now-10*60000},mtimeMs:now-10*60000,error:''};
  const base={registryDetail:good,queueDetail:good,safetyDetail:stale,productionDetail:good,safety:{updatedAt:now-10*60000},now,dataWritable:true};
  const short=health.deriveStaticAlerts({...base,queue:{jobs:[]}});
  assert.equal(short.some(a=>a.id==='safety:snapshot-stale'),false);
  const long=health.deriveStaticAlerts({...base,queue:{jobs:[{id:'j2',state:'queued',secs:5*3600,createdAt:new Date(now).toISOString()}]}});
  assert.equal(long.some(a=>a.id==='safety:snapshot-stale'),true);
});

test('roles del preload respetan token admin',()=>{
  assert.equal(health.roleForToken('health-admin-test'),'admin');
  assert.equal(health.roleForToken('malo'),'');
});
