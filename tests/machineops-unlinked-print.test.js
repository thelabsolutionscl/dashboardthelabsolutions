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
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const status={m1:{state:'printing',filename:'pieza.gcode',elapsed:300,progress:54,progressRaw:54,lastSeenAt:now-1000}};
const store={jobs:[],ignoredPrints:{}};
const deps={num,clamp,fileKey,data:()=>store,_printerStatus:status,MAQUINAS:[{id:'m1'}],
  filenameMatchScore:(j,file)=>fileKey(j.gcodeFile)===fileKey(file)?100:0,
  liveEvidence:(id,t)=>({known:t-status[id].lastSeenAt<60000,live:status[id]})};
const names=Object.keys(deps);
const functions=new Function(...names,[
  extract('livePrintActive'),extract('liveProgressPct'),extract('printRun'),extract('samePrintRun'),extract('currentPrintRunMatches'),extract('ignoredPrintMatches'),extract('linkedLiveJob'),extract('unlinkedPrints'),
  'return {livePrintActive,liveProgressPct,printRun,samePrintRun,currentPrintRunMatches,ignoredPrintMatches,linkedLiveJob,unlinkedPrints};',
].join('\n'))(...names.map(n=>deps[n]));

test('detecta una impresión activa sin trabajo y no usa telemetría vencida',()=>{
  assert.equal(functions.unlinkedPrints(now).length,1);
  assert.equal(functions.unlinkedPrints(now+61000).length,0);
});
test('saltar mantiene oculta la misma impresión aunque elapsed tenga una lectura inestable',()=>{
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  assert.equal(functions.unlinkedPrints(now+30000).length,0);
  status.m1.elapsed=10;status.m1.progress=55;status.m1.progressRaw=55;status.m1.lastSeenAt=now+180000;
  assert.equal(functions.unlinkedPrints(now+180000).length,0,'un salto aislado de elapsed no debe reabrir el aviso');
});

test('una impresión pausada sigue siendo una ejecución activa y se puede silenciar',()=>{
  status.m1={state:'paused',filename:'pieza.gcode',elapsed:420,progress:60,progressRaw:60,lastSeenAt:now-1000};
  store.ignoredPrints={};
  assert.equal(functions.unlinkedPrints(now).length,1);
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  assert.equal(functions.unlinkedPrints(now+1000).length,0);
});

test('filename vacío momentáneo no revive un skip de la misma ejecución',()=>{
  status.m1={state:'printing',filename:'pieza.gcode',elapsed:500,progress:64,progressRaw:64,lastSeenAt:now-1000};
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  status.m1.filename='';status.m1.elapsed=510;status.m1.progress=65;status.m1.progressRaw=65;status.m1.lastSeenAt=now+10000;
  assert.equal(functions.unlinkedPrints(now+10000).length,0);
});

test('otro inicio claro del mismo archivo vuelve a avisar incluso en trabajos relativamente cortos',()=>{
  status.m1={state:'printing',filename:'pieza.gcode',elapsed:180,progress:18,progressRaw:18,lastSeenAt:now-1000};
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now};
  status.m1.elapsed=20;status.m1.progress=3;status.m1.progressRaw=3;status.m1.lastSeenAt=now+180000;
  assert.equal(functions.unlinkedPrints(now+180000).length,1,'elapsed y progreso retrocediendo indican una ejecución nueva');
});

test('un skip no expira por reloj mientras la misma impresión sigue activa',()=>{
  status.m1={state:'printing',filename:'pieza.gcode',elapsed:26*3600,progress:80,progressRaw:80,lastSeenAt:now-1000};
  store.ignoredPrints.m1={...functions.printRun(status.m1,now),ignoredAt:now-25*3600*1000};
  assert.equal(functions.unlinkedPrints(now).length,0,'una impresión larga no debe reavisar solo por superar 24 h');
  store.ignoredPrints={};
});

test('progreso ya normalizado no se multiplica de nuevo al inicio',()=>{
  assert.equal(functions.liveProgressPct({progress:1,progressRaw:1}),1);
  assert.equal(functions.liveProgressPct({progress:.4,progressRaw:.4}),.4);
});

test('el código cierra el skip con tombstone al observar un estado terminal real',()=>{
  const transition=extract('handlePrinterTransition');
  assert.match(transition,/\['complete','cancelled','error','shutdown'\]\.includes\(s\.state\)/);
  assert.match(transition,/clearIgnoredPrint\(m\.id,'terminal:'\+s\.state\)/);
});

test('un tombstone no oculta una impresión nueva',()=>{
  store.ignoredPrints.m1={clearedAt:now,reason:'terminal:complete'};
  status.m1.elapsed=25;status.m1.progress=4;status.m1.lastSeenAt=now+1000;
  assert.equal(functions.unlinkedPrints(now+1000).length,1);
  store.ignoredPrints={};status.m1.elapsed=300;status.m1.progress=54;status.m1.lastSeenAt=now-1000;
});

test('un trabajo vinculado a la misma ejecución oculta el aviso; uno antiguo no',()=>{
  status.m1={state:'printing',filename:'pieza.gcode',elapsed:300,progress:54,progressRaw:54,lastSeenAt:now-1000};store.ignoredPrints={};
  const run=functions.printRun(status.m1,now);
  store.jobs=[{id:'j1',machineId:'m1',status:'imprimiendo',gcodeFile:'pieza.gcode',livePrintRun:run}];
  assert.equal(functions.unlinkedPrints(now).length,0);
  store.jobs[0].livePrintRun={...run,startedAt:run.startedAt-600000};
  assert.equal(functions.unlinkedPrints(now).length,1);
});


test('un trabajo ya vinculado no se pierde si Moonraker vacía filename momentáneamente',()=>{
  status.m1={state:'printing',filename:'pieza.gcode',elapsed:300,progress:54,progressRaw:54,lastSeenAt:now-1000};
  store.ignoredPrints={};
  const run=functions.printRun(status.m1,now);
  store.jobs=[{id:'j-live',machineId:'m1',status:'imprimiendo',gcodeFile:'pieza.gcode',livePrintRun:run}];
  status.m1.filename='';status.m1.elapsed=310;status.m1.progress=55;status.m1.progressRaw=55;status.m1.lastSeenAt=now+10000;
  assert.equal(functions.unlinkedPrints(now+10000).length,0);
  store.jobs=[];
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


test('la auditoría alinea la alerta interna con el botón Saltar real',()=>{
  assert.match(source,/if\(key\.startsWith\('unlinked-'\)\)return skipUnlinkedPrint/);
  assert.match(source,/row\.key\.startsWith\('unlinked-'\)\?'Saltar':'Atendida'/);
  assert.match(source,/const rows=\[\],active=activeJobs\(\),unlinkedIds=new Set\(unlinkedPrints\(now\)/);
});

test('la creación y asignación aceptan impresión pausada',()=>{
  const open=extract('openUnlinkedAssignment'),assign=extract('assignUnlinkedPrint'),create=extract('openJobFromLive'),save=extract('saveJob');
  assert.match(open,/livePrintActive\(live\)/);
  assert.match(assign,/livePrintActive\(live\)/);
  assert.match(create,/livePrintActive\(live\)/);
  assert.match(save,/livePrintActive\(live\)/);
});
