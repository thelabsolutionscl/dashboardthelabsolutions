#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const SOURCE=`${INDEX}\n${MAQ}\n${OPS}`;

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function functionSource(source,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const marker=new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\(`);
  const found=marker.exec(source);
  assert.ok(found,`falta ${name}`);
  const open=source.indexOf('{',found.index);
  let depth=0,quote='',escapedChar=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){
      if(escapedChar){escapedChar=false;continue;}
      if(ch==='\\'){escapedChar=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==='/'&&next==='/'){line=true;i++;continue;}
    if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return source.slice(found.index,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}
function hasFunction(source,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\(`).test(source);
}

test('Producción está enlazada entre Pedidos y Máquinas sin crear un flujo paralelo',()=>{
  assert.equal(count(/id=["']tab-pedidos["']/g,INDEX),1,'Pedidos debe ser único');
  assert.equal(count(/id=["']tab-maquinas["']/g,INDEX),1,'Máquinas debe ser único');
  assert.equal(count(/id=["']cargaMaquinas["']/g,INDEX),1,'la carga de producción debe existir una sola vez');
  assert.match(INDEX,/js\/maquinas\.js\?v=%%BUILD%%/);
  assert.match(INDEX,/js\/maquinas-operaciones\.js\?v=%%BUILD%%/);
});

test('las funciones críticas del flujo productivo existen una sola vez',()=>{
  const indexFunctions=['_pedidosActivosProd','_maqCarga','_maqMasLibre','renderCargaMaquinas','asignarMaquina','sugerirMaquina','prodStart','prodStop','_prodState','_prodTimersBackup'];
  for(const name of indexFunctions){
    assert.ok(hasFunction(INDEX,name),`falta ${name}`);
    assert.equal(count(new RegExp(`function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*\\(`,'g'),INDEX),1,`${name} debe definirse una vez`);
  }
  for(const name of ['initMaquinas','pollPrinters','renderMonitorGrid'])assert.ok(hasFunction(MAQ,name),`falta ${name}`);
});

test('la cola productiva incluye solo estados que todavía requieren fabricación',()=>{
  assert.match(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\['Confirmado','En producción','En cola'\]/);
  assert.doesNotMatch(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\[[^\]]*(?:Listo para despacho|Despachado|Completado|Cancelado)/);
  const active=functionSource(INDEX,'_pedidosActivosProd');
  assert.match(active,/state\.pedidos/);
  assert.match(active,/Estado pedido/);
});

test('asignar una máquina persiste antes de refrescar y revierte ante error',()=>{
  const body=functionSource(INDEX,'asignarMaquina');
  assert.match(body,/state\.pedidosById\[pedidoId\]/,'debe resolver el pedido por su índice estable');
  assert.match(body,/Máquina asignada/,'debe usar el campo operativo del pedido');
  const ensure=body.indexOf('await ensureMaqField()');
  const write=body.search(/await\s+airtableWrite\(\s*['"]Pedidos['"]\s*,\s*['"]PATCH['"]/);
  const render=body.indexOf('renderCargaMaquinas()');
  assert.ok(ensure>=0&&write>ensure,'debe asegurar el campo y luego guardar la asignación');
  assert.ok(render>write,'la interfaz debe refrescarse después de persistir');
  assert.match(body,/catch\s*\([^)]*\)\s*\{[\s\S]*Máquina asignada[\s\S]*prev/,'debe restaurar la asignación anterior si Airtable falla');
});

test('la sugerencia de máquina reutiliza la asignación oficial',()=>{
  const body=functionSource(INDEX,'sugerirMaquina');
  assert.match(body,/_maqMasLibre\(\)/);
  assert.match(body,/asignarMaquina\(pedidoId/,'no debe crear una segunda vía de escritura');
});

test('el tablero separa pedidos asignados de pedidos pendientes de asignación',()=>{
  const load=functionSource(INDEX,'_maqCarga');
  assert.match(load,/new Map\(\)/);
  assert.match(load,/sinAsignar/);
  assert.match(load,/Máquina asignada/);
  assert.match(load,/Fecha entrega/);
  const render=functionSource(INDEX,'renderCargaMaquinas');
  assert.match(render,/_maqCarga\(\)/);
  assert.match(render,/_prodTimerBtn\(p\)/,'el cronómetro debe estar dentro de la fila del pedido asignado');
  assert.match(render,/Sin asignar/,'los pedidos sin máquina deben permanecer visibles y accionables');
});

test('el cronómetro mide el ciclo pero no se salta QA ni despacho',()=>{
  const start=functionSource(INDEX,'prodStart');
  const stop=functionSource(INDEX,'prodStop');
  assert.match(start,/_prodTimers\(\)/);
  assert.match(start,/_prodTimersBackup\(\)/);
  assert.match(stop,/Inicia el cronómetro primero/,'no debe permitir detener un ciclo inexistente');
  assert.match(stop,/_prodTimersBackup\(\)/);
  assert.doesNotMatch(stop,/Listo para despacho|Despachado|Completado|advancePedido/,'terminar el cronómetro no debe saltarse control de calidad');
  // El respaldo compartido se hace vía _monitorUpsert('PROD_TIMERS',…), que es
  // quien escribe el campo Name en Monitor Sistema.
  assert.match(INDEX,/_monitorUpsert\(\s*['"]PROD_TIMERS['"]|Name['"]?\s*:\s*['"]PROD_TIMERS['"]/,'los tiempos deben tener respaldo compartido');
});

test('MachineOps conserva un orden de fabricación explícito',()=>{
  assert.match(OPS,/const ACTIVE_JOB_STATES=\['pendiente','planificado','en_cola','imprimiendo','qa'\]/);
  const ordered=['pendiente','planificado','en_cola','imprimiendo','qa','terminado','fallido','archivado'];
  for(const state of ordered)assert.match(OPS,new RegExp(`${state}:\\{`),`falta estado ${state}`);
  assert.match(OPS,/pedidoId/,'cada trabajo debe poder conservar su pedido de origen');
});

test('una máquina debe estar habilitada administrativa y técnicamente',()=>{
  const body=functionSource(OPS,'machineOperational');
  assert.match(body,/getMaquinaEstadoGlobal\(m\.id\)!==['"]disponible['"]/);
  assert.match(body,/offline/);
  assert.match(body,/noip/);
  assert.match(body,/shutdown/);
  assert.match(body,/error/);
});

test('compatibilidad, material y capacidad se revisan antes de producir',()=>{
  for(const name of ['modelCanRun','machineScore','compatibleSpools','spoolAvailable','reservedForSpool','preflightFromFacts']){
    assert.ok(hasFunction(OPS,name),`falta ${name}`);
  }
  assert.match(OPS,/connectionReady/);
  assert.match(OPS,/machineFree/);
  assert.match(OPS,/compatible/);
  assert.match(OPS,/hasFile/);
  assert.match(OPS,/filamentDetected/);
  assert.match(OPS,/gramsRequired/);
});

test('preflight bloquea el inicio cuando falta una condición crítica',()=>{
  assert.match(OPS,/confirmPreflight/);
  assert.match(OPS,/preflightFromFacts/);
  for(const key of ['connection','compatibility','file','sensor'])assert.match(OPS,new RegExp(key),`falta bloqueo ${key}`);
  assert.match(OPS,/blockers/);
});

test('QA y postproducción son la única salida hacia despacho',()=>{
  for(const id of ['mopsQuality','mopsPostProduction','mopsPreflightModal','mopsIncidentModal'])assert.ok(INDEX.includes(`id="${id}"`),`falta ${id}`);
  assert.match(OPS,/'Resultado QA':'QA aprobado'/);
  assert.match(OPS,/Postproducción terminada/);
  assert.match(OPS,/markOrderReady\(w\.pedidoId\)/,'postproducción debe actualizar el pedido vinculado');
  assert.match(OPS,/Listo para despacho/,'la salida productiva debe devolver el pedido a la etapa logística correcta');
});

test('producción conserva vínculos de pedido, calendario, máquina e incidentes',()=>{
  assert.match(INDEX,/pedido_id/,'los eventos de máquina deben conservar pedido_id');
  assert.match(INDEX,/pedidoId:f\.pedido_id\|\|''/,'el calendario debe rehidratar el pedido vinculado');
  assert.match(INDEX,/Máquina asignada/);
  assert.match(INDEX,/Fecha entrega/);
  assert.match(OPS,/incidents/);
  assert.match(OPS,/machineId/);
  assert.match(OPS,/pedidoId/);
});
