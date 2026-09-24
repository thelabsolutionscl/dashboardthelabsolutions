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
const status={m1:{state:'printing',filename:'pieza.gcode',elapsed:300,lastSeenAt:now-1000}};
const store={jobs:[],ignoredPrints:{}};
const deps={num,fileKey,data:()=>store,_printerStatus:status,MAQUINAS:[{id:'m1'}],
  filenameMatchScore:(j,file)=>fileKey(j.gcodeFile)===fileKey(file)?100:0,
  liveEvidence:(id,t)=>({known:t-status[id].lastSeenAt<60000,live:status[id]})};
const names=Object.keys(deps);
const functions=new Function(...names,[
  extract('printRun'),extract('samePrintRun'),extract('linkedLiveJob'),extract('unlinkedPrints'),
  'return {printRun,samePrintRun,linkedLiveJob,unlinkedPrints};',
].join('\n'))(...names.map(n=>deps[n]));

test('detecta una impresión activa sin trabajo y no usa telemetría vencida',()=>{
  assert.equal(functions.unlinkedPrints(now).length,1);
  assert.equal(functions.unlinkedPrints(now+61000).length,0);
});
test('saltar solo descarta la impresión actual; otro inicio del mismo archivo vuelve a avisar',()=>{
  store.ignoredPrints.m1=functions.printRun(status.m1,now);
  assert.equal(functions.unlinkedPrints(now+30000).length,0);
  status.m1.elapsed=10;status.m1.lastSeenAt=now+180000;
  assert.equal(functions.unlinkedPrints(now+180000).length,1);
  store.ignoredPrints={};status.m1.elapsed=300;status.m1.lastSeenAt=now-1000;
});
test('un trabajo vinculado a la misma ejecución oculta el aviso; uno antiguo no',()=>{
  const run=functions.printRun(status.m1,now);
  store.jobs=[{id:'j1',machineId:'m1',status:'imprimiendo',gcodeFile:'pieza.gcode',livePrintRun:run}];
  assert.equal(functions.unlinkedPrints(now).length,0);
  store.jobs[0].livePrintRun={...run,startedAt:run.startedAt-600000};
  assert.equal(functions.unlinkedPrints(now).length,1);
});
