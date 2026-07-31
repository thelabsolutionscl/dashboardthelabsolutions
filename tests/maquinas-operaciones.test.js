#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');

const ROOT=path.join(__dirname,'..');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');

function storage(){
  const map=new Map();
  return{
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k),
  };
}
function loadOps(){
  const context={
    console,crypto:webcrypto,localStorage:storage(),sessionStorage:storage(),
    setTimeout,clearTimeout,Date,Math,JSON,Number,String,Array,Object,Map,Set,
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(OPS,context,{filename:'maquinas-operaciones.js'});
  return context.MachineOps._test;
}

test('compatibilidad por material y volumen de impresión',()=>{
  const ops=loadOps();
  assert.equal(ops.modelCanRun('K1',{material:'PETG',sizeX:150,sizeY:180,sizeZ:120}),true);
  assert.equal(ops.modelCanRun('K1',{material:'ABS',sizeX:100,sizeY:100,sizeZ:100}),false);
  assert.equal(ops.modelCanRun('K1',{material:'PLA',sizeX:400,sizeY:400,sizeZ:400}),false);
  assert.equal(ops.modelCanRun('Giga',{material:'PLA',sizeX:700,sizeY:600,sizeZ:500}),true);
});

test('horas de trabajo se calculan por ciclos reales',()=>{
  const ops=loadOps();
  assert.equal(ops.jobMinutes({cycles:6,minutesPerCycle:95}),570);
  assert.equal(ops.jobMinutes({cycles:0,minutesPerCycle:0}),1);
});

test('sincronización conserva la versión más nueva de cada registro',()=>{
  const ops=loadOps();
  const local=ops.defaultData();
  local.jobs=[{id:'job-1',name:'local',updatedAt:'2026-07-30T10:00:00.000Z'}];
  const remote=ops.defaultData();
  remote.jobs=[
    {id:'job-1',name:'remoto',updatedAt:'2026-07-30T12:00:00.000Z'},
    {id:'job-2',name:'nuevo',updatedAt:'2026-07-30T11:00:00.000Z'},
  ];
  const merged=ops.mergeData(local,remote);
  assert.equal(merged.jobs.length,2);
  assert.equal(merged.jobs.find(j=>j.id==='job-1').name,'remoto');
  local.updatedAt=10;
  local.maintenanceProfiles.K1.nozzle=333;
  remote.updatedAt=5;
  remote.maintenanceProfiles.K1.nozzle=111;
  assert.equal(ops.mergeData(local,remote).maintenanceProfiles.K1.nozzle,333);
});

test('Máquinas excluye pedidos terminados y conserva el vínculo del calendario',()=>{
  assert.match(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\['Confirmado','En producción','En cola'\]/);
  assert.match(INDEX,/\{name:'pedido_id',type:'singleLineText'\}/);
  assert.match(INDEX,/pedidoId:f\.pedido_id\|\|''/);
  assert.doesNotMatch(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\[[^\]]*Listo para despacho/);
});

test('credenciales Moonraker quedan limitadas a la sesión',()=>{
  assert.match(MAQ,/sessionStorage\.getItem\(key\)/);
  assert.match(MAQ,/localStorage\.removeItem\(key\)/);
  assert.match(MAQ,/sessionStorage\.setItem\(key,val\)/);
});

test('interfaz expone las áreas operacionales nuevas',()=>{
  for(const id of ['maqWorkspaceNav','maquinaPlanningOpsView','mopsJobs','mopsGantt','maquinaMaterialsView','mopsSpools','mopsQuality','mopsAnalytics']){
    assert.ok(INDEX.includes(`id="${id}"`),`falta ${id}`);
  }
  assert.ok(INDEX.includes('js/maquinas-operaciones.js?v=%%BUILD%%'));
  assert.match(INDEX,/\{name:'repuestos',type:'multilineText'\}/);
  assert.match(INDEX,/repuestos:rec\.parts\|\|''/);
  assert.match(OPS,/'Resultado QA':'QA aprobado'/);
});
