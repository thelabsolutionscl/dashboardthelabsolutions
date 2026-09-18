#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const FARM=fs.readFileSync(path.join(ROOT,'js','maquinas-farm-controller.js'),'utf8');
const CTRL=fs.readFileSync(path.join(ROOT,'printer-bridge','farm-controller.js'),'utf8');
const STORAGE=fs.readFileSync(path.join(ROOT,'js','machineops-storage-adapter.js'),'utf8');

function fn(src,name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\('),m=re.exec(src);
  assert.ok(m,'falta '+name);
  const start=m.index,open=src.indexOf('{',m.index+m[0].length),stack=[];
  let quote='',esc=false,line=false,block=false,depth=0;
  for(let i=open;i<src.length;i++){
    const ch=src[i],n=src[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&n==='/'){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&n==='/'){line=true;i++;continue;}
    if(ch==='/'&&n==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='\x60'){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return src.slice(start,i+1);
  }
  throw new Error('sin cierre '+name);
}

test('CFS físico: sólo K1 #1 y K2 Plus reciben objetos CFS también por polling',()=>{
  const helper=fn(MAQ,'machineHasPhysicalCfs'),poll=fn(MAQ,'fetchPrinterStatus');
  assert.match(helper,/machine\.modelo==='K2 Plus'/);
  assert.match(helper,/id==='k1-1'/);
  assert.match(poll,/machineHasPhysicalCfs\(m\)/);
  assert.doesNotMatch(poll,/m\.modelo==='K2'\|\|m\.modelo==='K2 Plus'/);
});

test('complete no equivale a cama libre y la confirmación se persiste',()=>{
  const operational=fn(OPS,'machineOperational'),clear=fn(OPS,'confirmBedCleared');
  assert.match(operational,/evidence\.state==='complete'.*!bedIsCleared/s);
  assert.match(clear,/bedClearAcks/);
  assert.match(clear,/FarmQueue\?\.confirmBedClear/);
  assert.match(STORAGE,/bedClearAcks/);
});

test('estado administrativo crítico no puede reactivarse con un clic rápido',()=>{
  const toggle=fn(MAQ,'toggleMaquinaEstado');
  assert.match(toggle,/!\['disponible','mantencion'\]\.includes\(current\)/);
  assert.match(toggle,/openTech/);
  assert.match(toggle,/confirm\(/);
});

test('parada de emergencia sólo informa éxito después de HTTP ok',()=>{
  const emergency=fn(MAQ,'printerEmergencyStop');
  assert.match(emergency,/if\(!r\.ok\)throw/);
  assert.match(emergency,/Parada de emergencia confirmada/);
});

test('reimpresión no usa Moonraker directo',()=>{
  const reprint=fn(MAQ,'reprintFile');
  assert.match(reprint,/MachineOps\?\.startExistingFile/);
  assert.doesNotMatch(reprint,/printer\/print\/start/);
});

test('preflight final se vuelve a calcular justo antes del Controller',()=>{
  const start=fn(OPS,'startJob');
  assert.match(start,/evaluatePreflight\(j,m\)/);
  assert.match(start,/FarmQueue\.startExisting/);
  assert.doesNotMatch(start,/printer\/print\/start/);
});

test('cola durable es idempotente y no cae a una cola local ambigua',()=>{
  const add=fn(FARM,'durableAdd');
  assert.match(add,/idempotencyKey/);
  assert.match(add,/_postQueue/);
  assert.doesNotMatch(add,/original\.add/);
  assert.match(CTRL,/queue\.jobs\.find\(j=>j\.idempotencyKey===idempotencyKey\)/);
});

test('Controller posee lifecycle hasta terminal y escribe historial durable',()=>{
  assert.match(CTRL,/async function reconcileStartedJobs\(/);
  assert.match(CTRL,/state:'printing'/);
  assert.match(CTRL,/state:'completed'/);
  assert.match(CTRL,/state:'cancelled'/);
  assert.match(CTRL,/recordProductionEvent/);
  assert.match(OPS,/function reconcileFarmQueueJobs\(/);
});

test('fallback local no consume el trabajo hasta confirmar START',()=>{
  const q=fn(MAQ,'_queueStartNext');
  const start=q.indexOf('if(!started.ok)'),shift=q.indexOf('_printQueue[id].shift()');
  assert.ok(start>=0&&shift>start);
});

test('sesión del navegador recupera inicio desde elapsed y cede al Controller',()=>{
  const trans=fn(MAQ,'checkTransitions');
  assert.match(trans,/Date\.now\(\)-elapsedMs/);
  assert.match(trans,/_controllerOwnsPrint/);
  assert.match(trans,/if\(!owned\)saveHistoryEntry/);
});

test('boquilla física queda registrada y la IP se limita a red privada',()=>{
  assert.match(MAQ,/printerConnNozzle/);
  assert.match(MAQ,/printer_nozzle_/);
  assert.match(MAQ,/function _validPrivatePrinterIp\(/);
  assert.match(FARM,/nozzleInstalled/);
  assert.match(OPS,/function installedNozzle\(/);
});

test('agenda, estado y mantención tienen recuperación de sincronización',()=>{
  assert.match(MAQ,/estado_maq_pending_/);
  assert.match(MAQ,/maquina_eventos_outbox_v1/);
  assert.match(MAQ,/printer_maint_outbox_v1/);
  assert.match(MAQ,/flushMachineStateOutbox/);
  assert.match(MAQ,/flushMachineEventOutbox/);
  assert.match(MAQ,/syncPendingMaintenance/);
});

test('planificador no usa multiplicadores hardcodeados de velocidad',()=>{
  assert.doesNotMatch(OPS,/speed:1\.22|speed:1\.18|speed:1\.12|speed:\.92|speed:\.72/);
  assert.doesNotMatch(OPS,/\/cap\.speed/);
});

test('seguridad del Controller no puede ser debilitada por token operator',()=>{
  assert.match(CTRL,/safeBody=role==='admin'\?body:\{\.\.\.body,config:safety\.config\}/);
});
