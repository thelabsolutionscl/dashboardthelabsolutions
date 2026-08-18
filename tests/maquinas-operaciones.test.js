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
const SLICER=fs.readFileSync(path.join(ROOT,'js','slicer3d.js'),'utf8');

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
    setTimeout,clearTimeout,Date,Math,JSON,Number,String,Array,Object,Map,Set,URL,URLSearchParams,
    location:{href:'https://dashboard.example.com/index.html?vista=overview#overview',search:'?vista=overview'},
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

test('el modelo persistente incluye trazabilidad de postproducción, perfiles y seguridad',()=>{
  const d=loadOps().defaultData();
  assert.equal(d.version,4);
  assert.deepEqual(Array.from(d.workflows),[]);
  assert.deepEqual(Array.from(d.profiles),[]);
  assert.deepEqual(Array.from(d.safetyReadings),[]);
  assert.deepEqual(Array.from(d.incidents),[]);
  assert.equal(d.automation.autoLink,true);
  assert.equal(d.costConfig.electricityClpKwh,220);
  assert.equal(d.safetyConfig.enforce,false);
  assert.equal(d.safetyConfig.cameraRequired,true);
});

test('simulador reparte ciclos en la flota compatible y detecta falta de capacidad',()=>{
  const ops=loadOps();
  const fleet=[
    {id:'k1-1',modelo:'K1',nombre:'K1',operational:true},
    {id:'k2-1',modelo:'K2',nombre:'K2',operational:true},
  ];
  const result=ops.simulateCapacity({qty:30,unitsPerBed:10,minutesPerCycle:60,handlingMinutes:5,material:'PLA',bufferPct:15},fleet,{},Date.parse('2026-07-31T12:00:00Z'));
  assert.equal(result.ok,true);
  assert.equal(result.cycles,3);
  assert.equal(result.assignments.reduce((sum,row)=>sum+row.cycles,0),3);
  assert.equal(result.assignments.reduce((sum,row)=>sum+row.qty,0),30);
  assert.ok(result.machinesUsed>=1);

  const incompatible=ops.simulateCapacity({qty:10,unitsPerBed:5,minutesPerCycle:60,material:'ABS'},[{id:'k1-1',modelo:'K1',operational:true}]);
  assert.equal(incompatible.ok,false);
  assert.match(incompatible.reason,/compatibles/);
});

test('compuerta de seguridad bloquea humo y exige controles en modo estricto',()=>{
  const ops=loadOps(),now=Date.parse('2026-07-31T12:00:00Z');
  const smoke=ops.safetyDecision({enforce:false},{at:'2026-07-31T11:59:00Z',online:true,smoke:true,temperature:24,humidity:45,voc:100,ventilation:true},{unattended:false},now);
  assert.equal(smoke.ok,false);
  assert.match(smoke.blockers.join(' '),/humo/i);

  const strict=ops.safetyDecision({enforce:true,cameraRequired:true,ventilationRequired:true,smokeRequired:true},null,{unattended:true,cameraConfigured:false},now);
  assert.equal(strict.ok,false);
  assert.match(strict.blockers.join(' '),/cámara/i);
  assert.match(strict.blockers.join(' '),/lectura ambiental/i);

  const advisory=ops.safetyDecision({enforce:false,cameraRequired:true},null,{unattended:true,cameraConfigured:false},now);
  assert.equal(advisory.ok,true);
  assert.ok(advisory.warnings.length>0);
});

test('lector QR reconoce etiquetas compactas y enlaces operacionales',()=>{
  const ops=loadOps();
  assert.deepEqual({...ops.parseScan('TLS:MACHINE:k1-1')},{type:'machine',id:'k1-1'});
  assert.deepEqual({...ops.parseScan('https://dashboard.example.com/?ops=job&id=job-1')},{type:'job',id:'job-1'});
  assert.deepEqual({...ops.parseScan('https://dashboard.example.com/?ops=MACHINE&id=k2-1')},{type:'machine',id:'k2-1'});
  assert.equal(ops.parseScan('texto libre'),null);
});

test('enlace NFC es estable y la ruta directa prioriza Máquinas',()=>{
  const ops=loadOps();
  assert.deepEqual({...ops.directRoute('?ops=machine&id=k1-1')},{tab:'maquinas',type:'machine',id:'k1-1'});
  assert.deepEqual({...ops.directRoute('?machine=k2-1')},{tab:'maquinas',type:'machine',id:'k2-1'});
  assert.equal(ops.directRoute('?vista=overview'),null);
  assert.equal(ops.opsLink('machine','k1-1'),'https://dashboard.example.com/index.html?ops=machine&id=k1-1#maquinas');
  assert.match(INDEX,/const route=window\.MachineOps\?\.directRoute\?\.\(\);[\s\S]*switchTab\(route\.tab\)/);
});

test('ficha operacional separa apertura y copia NFC con respaldo de portapapeles',()=>{
  assert.match(INDEX,/MachineOps\.openTech\('\$\{m\.id\}'\)[\s\S]*📱 Ficha/);
  assert.match(INDEX,/MachineOps\.copyTechLinkFor\('\$\{m\.id\}',this\)[\s\S]*📡 NFC/);
  assert.match(OPS,/async function copyTextSafe\(/);
  assert.match(OPS,/document\.execCommand\?\.\('copy'\)/);
  assert.match(OPS,/window\.prompt\('Copia este enlace para grabarlo en el NFC:'/);
  for(const label of ['Impresión actual','Trabajos asignados','Material y sensores','Mantención','Tiempo restante'])assert.ok(OPS.includes(label),`falta ${label}`);
  assert.match(OPS,/Estado de impresión desconocido/);
  assert.match(OPS,/MachineOps\.refreshTechStatus/);
});

test('ficha no confunde falta de telemetría con una máquina libre',()=>{
  const ops=loadOps(),now=Date.parse('2026-07-31T12:00:00Z');
  assert.equal(ops.techLiveFacts(null,now).connecting,true);
  assert.equal(ops.techLiveFacts({state:'offline'},now).canClaimIdle,false);
  assert.equal(ops.techLiveFacts({state:'standby',lastSeenAt:now},now).canClaimIdle,true);
  assert.equal(ops.techLiveFacts({state:'printing',lastSeenAt:now},now).active,true);
  assert.equal(ops.techLiveFacts({state:'printing',stale:true,lastSeenAt:now-60000},now).stale,true);
});

test('ficha prioriza sensor físico de filamento sobre inventario manual',()=>{
  const ops=loadOps();
  const detected=ops.techFilamentSummary({filament:{detected:true,source:'rack',cfsConnected:false,chamber:34.7}},null);
  assert.equal(detected.value,'Detectado');
  assert.match(detected.sub,/Portarrollos externo/);
  assert.match(detected.sub,/34\.7°/);
  const unknown=ops.techFilamentSummary({},null);
  assert.equal(unknown.value,'Sin datos');
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
  assert.match(MAQ,/return !custom\|\|custom===defaultTunnel\?\(d\|\|local\):\(local\|\|d\)/);
  assert.match(MAQ,/sessionStorage\.getItem\('printer_tunnel_token'\)/);
  // El token viaja en la URL (?bt=), no como cabecera: una cabecera propia
  // dispara un preflight OPTIONS que en redes móviles tumba la petición entera.
  assert.match(MAQ,/function printerUrl\(ip,path\)[\s\S]*?return _appendBridgeToken\(`\$\{getPrinterTunnel\(\)\}\/\$\{ip\}\$\{path\}`\)/);
  assert.doesNotMatch(MAQ,/headers\['X-Bridge-Token'\]/);
  assert.match(MAQ,/function printerMediaUrl\(ip,path\)\{return _appendBridgeToken\(printerUrl\(ip,path\)\);\}/);
});

test('monitor espera varios fallos antes de declarar una conexión nueva como caída',()=>{
  assert.match(MAQ,/n<_OFFLINE_AFTER_FAILS&&\(!prev\|\|prev\.state==='connecting'\)/);
  assert.match(MAQ,/state:'connecting',attempt:n,connectionError:s\.connectionError/);
  assert.match(MAQ,/lastSeenAt:prev\?\.lastSeenAt\|\|0/);
});

test('interfaz expone las áreas operacionales nuevas',()=>{
  for(const id of ['maqWorkspaceNav','maquinaIntelligenceView','mopsIntelligence','mopsNavIntel','maquinaPlanningOpsView','mopsJobs','mopsGantt','maquinaMaterialsView','mopsSpools','mopsQuality','mopsAnalytics','mopsPreflightModal','mopsIncidentModal']){
    assert.ok(INDEX.includes(`id="${id}"`),`falta ${id}`);
  }
  assert.ok(INDEX.includes('js/maquinas-operaciones.js?v=%%BUILD%%'));
  assert.match(INDEX,/\{name:'repuestos',type:'multilineText'\}/);
  assert.match(INDEX,/repuestos:rec\.parts\|\|''/);
  assert.match(OPS,/'Resultado QA':'QA aprobado'/);
});

test('vinculación inteligente reconoce variantes de nombre sin adivinar archivos distintos',()=>{
  const ops=loadOps(),job={id:'job-42',name:'Medallas Colegio',gcodeFile:'ped-2026-042_medallas_v3.gcode',pedidoId:''};
  assert.equal(ops.fileKey('folder/PED-2026-042_medallas_v3.gcode'),'ped2026042medallasv3');
  assert.equal(ops.filenameMatchScore(job,'PED-2026-042_medallas_v3.gcode'),100);
  assert.ok(ops.filenameMatchScore(job,'ped_2026_042_medallas_v3')>=82);
  assert.equal(ops.filenameMatchScore(job,'llaveros_cliente_b'),0);
});

test('preflight bloquea conexión, compatibilidad, archivo y filamento físico',()=>{
  const ops=loadOps();
  const blocked=ops.preflightFromFacts({connectionReady:false,machineFree:true,compatible:false,hasFile:false,gramsRequired:200,spoolKnown:true,spoolAvailable:500,filamentDetected:false,cameraConfigured:false,maintenanceOverdue:false,maintenanceSoon:false,safetyBlockers:[],safetyWarnings:[]});
  assert.equal(blocked.ok,false);
  for(const key of ['connection','compatibility','file','sensor'])assert.ok(blocked.blockers.some(row=>row.key===key),`falta bloqueo ${key}`);
  const ready=ops.preflightFromFacts({connectionReady:true,machineFree:true,compatible:true,hasFile:true,gramsRequired:200,spoolKnown:true,spoolAvailable:500,filamentDetected:true,cameraConfigured:true,maintenanceOverdue:false,maintenanceSoon:false,safetyBlockers:[],safetyWarnings:[]});
  assert.equal(ready.ok,true);
  assert.equal(ready.blockers.length,0);
});

test('interfaz expone postproducción, capacidad, perfiles, seguridad y QR móvil',()=>{
  for(const id of ['maquinaPostView','mopsPostProduction','maquinaCapacityView','mopsCapacityResult','maquinaProfilesView','mopsProfiles','mopsProfileImport','maquinaSafetyView','mopsSafety','mopsJobProfile','mopsJobPostStages','mopsScannerModal']){
    assert.ok(INDEX.includes(`id="${id}"`),`falta ${id}`);
  }
  assert.match(OPS,/Postproducción terminada/);
  assert.match(OPS,/markOrderReady\(w\.pedidoId\)/);
  assert.match(OPS,/sessionStorage\.setItem\('machine_ops_sensor_token'/);
  assert.doesNotMatch(OPS,/localStorage\.setItem\('machine_ops_sensor_token'/);
  assert.match(SLICER,/MachineOps\?\.captureSlicerProfile/);
});
