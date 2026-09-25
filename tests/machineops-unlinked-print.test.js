#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../js/maquinas-operaciones.js'),'utf8');
function extract(name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,name);
  return source.slice(start,end+2);
}
const now=Date.parse('2026-09-24T20:00:00Z');
const fileKey=v=>String(v||'').replace(/\.gcode$/,'').toLowerCase();
const num=v=>Number(v)||0;
const status={m1:{state:'printing',filename:'pieza.gcode',elapsed:300,progress:54,lastSeenAt:now-1000}};
const store={jobs:[],ignoredPrints:{}};
const deps={num,fileKey,data:()=>store,_printerStatus:status,MAQUINAS:[{id:'m1'}],
  filenameMatchScore:(j,file)=>fileKey(j.gcodeFile)===fileKey(file)?100:0,
  liveEvidence:(id,t)=>({known:t-status[id].lastSeenAt<60000,live:status[id]})};
const names=Object.keys(deps);
const functions=new Function(...names,[
  extract('printRun'),extract('samePrintRun'),extract('ignoredPrintMatches'),extract('linkedLiveJob'),extract('unlinkedPrints'),
  'return {printRun,samePrintRun,ignoredPrintMatches,linkedLiveJob,unlinkedPrints};',
].join('\n'))(...names.map(n=>deps[n]));

test('detecta una impresión activa sin trabajo y no usa telemetría vencida',()=>{
  assert.equal(functions.unlinkedPrints(now).length,1);
  assert.equal(functions.unlinkedPrints(now+61000).length,0);
});
test('saltar mantiene oculta la misma impresión aunque elapsed tenga una lectura inestable',()=>{
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  assert.equal(functions.unlinkedPrints(now+30000).length,0);
  status.m1.elapsed=10;status.m1.progress=55;status.m1.lastSeenAt=now+180000;
  assert.equal(functions.unlinkedPrints(now+180000).length,0,'un salto aislado de elapsed no debe reabrir el aviso');
});
test('otro inicio claro del mismo archivo vuelve a avisar',()=>{
  status.m1.elapsed=300;status.m1.progress=54;status.m1.lastSeenAt=now-1000;
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  status.m1.elapsed=10;status.m1.progress=3;status.m1.lastSeenAt=now+180000;
  assert.equal(functions.unlinkedPrints(now+180000).length,1,'elapsed y progreso retrocediendo juntos indican una ejecución nueva');
  store.ignoredPrints={};status.m1.elapsed=300;status.m1.progress=54;status.m1.lastSeenAt=now-1000;
});

test('un skip viejo expira como red de seguridad si no se observó el fin',()=>{
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now-25*3600*1000};
  assert.equal(functions.unlinkedPrints(now).length,1);
  store.ignoredPrints={};
});

test('el código limpia el skip al observar un estado terminal real',()=>{
  const transition=extract('handlePrinterTransition');
  assert.match(transition,/\['complete','cancelled','error','shutdown'\]\.includes\(s\.state\)/);
  assert.match(transition,/delete data\(\)\.ignoredPrints\[m\.id\]/);
});

test('un trabajo vinculado a la misma ejecución oculta el aviso; uno antiguo no',()=>{
  const run=functions.printRun(status.m1,now);
  store.jobs=[{id:'j1',machineId:'m1',status:'imprimiendo',gcodeFile:'pieza.gcode',livePrintRun:run}];
  assert.equal(functions.unlinkedPrints(now).length,0);
  store.jobs[0].livePrintRun={...run,startedAt:run.startedAt-600000};
  assert.equal(functions.unlinkedPrints(now).length,1);
});


test('la alerta permite crear un trabajo nuevo desde la impresión en curso',()=>{
  assert.match(source,/data-action="create">Crear trabajo<\/button>/);
  assert.match(source,/function openJobFromLive\(machineId\)/);
  assert.match(source,/Crear trabajo para impresión en curso/);
  assert.match(source,/Trabajo creado y vinculado a la impresión ✓/);
});


test('resolver una alerta vuelve a escanear inmediatamente y después del repintado',()=>{
  const refresh=extract('refreshUnlinkedPrintAlerts');
  const skip=extract('skipUnlinkedPrint');
  const assign=extract('assignUnlinkedPrint');
  const save=extract('saveJob');
  assert.match(refresh,/requestAnimationFrame\(refresh\)/);
  assert.match(refresh,/setTimeout\(refresh,180\)/);
  assert.match(skip,/refreshUnlinkedPrintAlerts\(\)/);
  assert.match(assign,/refreshUnlinkedPrintAlerts\(\)/);
  assert.match(save,/refreshUnlinkedPrintAlerts\(\)/);
  assert.match(save,/Trabajo creado y vinculado a la impresión ✓/);
});
