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
const CSS=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');

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
  assert.equal(d.version,5);
  assert.deepEqual(Array.from(d.workflows),[]);
  assert.deepEqual(Array.from(d.profiles),[]);
  assert.deepEqual(Array.from(d.safetyReadings),[]);
  assert.deepEqual(Array.from(d.incidents),[]);
  assert.deepEqual({...d.bedClearAcks},{});
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
  const result=ops.simulateCapacity({qty:30,unitsPerBed:10,minutesPerCycle:60,handlingMinutes:5,material:'PLA',sizeX:100,sizeY:100,sizeZ:100,bufferPct:15},fleet,{},Date.parse('2026-07-31T12:00:00Z'));
  assert.equal(result.ok,true);
  assert.equal(result.cycles,3);
  assert.equal(result.assignments.reduce((sum,row)=>sum+row.cycles,0),3);
  assert.equal(result.assignments.reduce((sum,row)=>sum+row.qty,0),30);
  assert.ok(result.machinesUsed>=1);

  const incompatible=ops.simulateCapacity({qty:10,unitsPerBed:5,minutesPerCycle:60,material:'ABS',sizeX:100,sizeY:100,sizeZ:100},[{id:'k1-1',modelo:'K1',operational:true}]);
  assert.equal(incompatible.ok,false);
  assert.match(incompatible.reason,/compatibles/);
});

test('simulador de Taller exige dimensiones y respeta literalmente el tiempo de ciclo',()=>{
  const ops=loadOps(),fleet=[{id:'k1-1',modelo:'K1',nombre:'K1',operational:true}];
  const missing=ops.simulateCapacity({qty:10,unitsPerBed:10,minutesPerCycle:60,material:'PLA'},fleet);
  assert.equal(missing.ok,false);
  assert.match(missing.reason,/dimensiones X, Y y Z/i);

  const result=ops.simulateCapacity({qty:10,unitsPerBed:10,minutesPerCycle:60,handlingMinutes:5,material:'PLA',sizeX:80,sizeY:80,sizeZ:20},fleet,{});
  assert.equal(result.ok,true);
  assert.equal(result.assignments[0].minutes,65,'no debe aplicar multiplicadores ocultos por modelo');
  assert.equal(result.confidence,'scenario');
});

test('seguridad conserva métricas ausentes como desconocidas, no como cero',()=>{
  const ops=loadOps(),now=Date.parse('2026-07-31T12:00:00Z');
  assert.equal(ops.optionalMeasure(''),null);
  assert.equal(ops.optionalMeasure(null),null);
  assert.equal(ops.optionalMeasure('23.5'),23.5);
  const decision=ops.safetyDecision(
    {enforce:true,cameraRequired:false,ventilationRequired:true,smokeRequired:true,maxTemperature:38,maxHumidity:75,maxVoc:600,staleMinutes:10},
    {at:'2026-07-31T11:59:00Z',online:true,temperature:null,humidity:null,voc:null,smoke:false,ventilation:true},
    {unattended:true,cameraConfigured:true},now
  );
  assert.equal(decision.ok,false);
  assert.match(decision.blockers.join(' '),/Temperatura ambiental sin lectura/i);
  assert.match(decision.blockers.join(' '),/VOC sin lectura/i);
  assert.match(decision.warnings.join(' '),/Humedad sin lectura/i);
});

test('perfil aprobado para producción exige metadata técnica mínima',()=>{
  const ops=loadOps();
  const bad=ops.profileProductionCheck({model:'',material:'PLA',nozzle:'0.4',params:{layerHeight:.2}});
  assert.equal(bad.ok,false);
  assert.ok(bad.missing.includes('modelo'));
  const good=ops.profileProductionCheck({model:'K1',material:'PLA',nozzle:'0.4',params:{layerHeight:.2},layerHeight:.2});
  assert.equal(good.ok,true);
});

test('Taller explicita fuentes de verdad y no apila sus ocho herramientas de entrada',()=>{
  assert.match(OPS,/mopsWorkshopHome/);
  assert.match(OPS,/TALLER · FUENTES DE VERDAD/);
  assert.match(OPS,/Inventario registrado/);
  assert.match(OPS,/Escenario, no promesa contractual/);
  assert.match(OPS,/group==='taller'.*target!=='taller'/s);
  assert.match(OPS,/aprobación humana registrada/i);
});

test('analítica sin muestra no inventa 100% de éxito ni precisión',()=>{
  assert.match(OPS,/const success=qa\.length\?approved\/qa\.length\*100:null/);
  assert.match(OPS,/const accuracy=est&&actual\?Math\.max\(0,100-Math\.abs\(actual-est\)\/est\*100\):null/);
  assert.match(OPS,/Contribución asignada\*/);
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

test('fiabilidad no inventa 100% cuando no existen datos suficientes',()=>{
  const ops=loadOps();
  const row=ops.machineReliability('k1-1');
  assert.equal(row.level,'unknown');
  assert.equal(row.label,'Sin datos actuales');
  assert.equal(row.confidence,'baja');
  assert.equal(row.history.total,0);
  assert.equal(row.completion,null);
});

test('eventos automáticos no cuentan como incidentes confirmados hasta validación humana',()=>{
  const ops=loadOps();
  assert.equal(ops.incidentIsConfirmed({source:'telemetry',confirmedAt:''}),false);
  assert.equal(ops.incidentIsConfirmed({source:'telemetry',confirmedAt:'2026-09-18T10:00:00Z'}),true);
  assert.equal(ops.incidentIsConfirmed({source:'manual'}),true);
});

test('solo K1 #1 y K2 Plus están marcadas físicamente con CFS',()=>{
  const ops=loadOps();
  assert.equal(ops.machineHasCfs({id:'k1-1',modelo:'K1',numG:1}),true);
  assert.equal(ops.machineHasCfs({id:'k1-2',modelo:'K1',numG:2}),false);
  assert.equal(ops.machineHasCfs({id:'k2p-1',modelo:'K2 Plus',numG:11}),true);
  assert.equal(ops.machineHasCfs({id:'k2-1',modelo:'K2',numG:12}),false);
  assert.equal(ops.machineHasCfs({id:'k2-2',modelo:'K2',numG:13}),false);
});

test('CFS sin telemetría reciente queda como dato desconocido y no como falla',()=>{
  const ops=loadOps();
  const row=ops._filamentPhysicalSummary({id:'k2-1',modelo:'K2'});
  assert.equal(row.level,'unknown');
  assert.equal(row.label,'Sin dato reciente');
  assert.match(row.detail,/más de 60 s|aún no llegó/);
});

test('planificación distingue plan local, telemetría y cola durable',()=>{
  assert.match(OPS,/Planificación del dashboard ≠ cola de ejecución/);
  assert.match(OPS,/Controller confirmado/);
  assert.match(OPS,/esto aún no crea una cola durable/);
  assert.match(OPS,/function farmQueueEvidence\(/);
  assert.match(OPS,/function farmQueueMatch\(/);
  assert.match(OPS,/function liveEvidence\(/);
  assert.match(OPS,/if\(!evidence\.known\)return false/);

  const ops=loadOps();
  const state=ops.planningJobState({id:'job-1',name:'Pieza',status:'pendiente',machineId:'',gcodeFile:'',grams:0,dueDate:''},Date.now());
  assert.equal(state.next.label,'Asignar máquina');
  assert.equal(ops.farmQueueEvidence().fresh,false);
});

test('planificación no inventa un minuto de carga en máquinas vacías',()=>{
  assert.doesNotMatch(OPS,/const total=Math\.max\(1,jobs\.reduce/);
  assert.match(OPS,/const total=jobs\.reduce\(\(s,j\)=>s\+jobMinutes\(j\),0\)/);
});

test('plan por impresora prioriza carga y pliega máquinas vacías',()=>{
  assert.match(OPS,/Primero mostramos las impresoras con carga/);
  assert.match(OPS,/mops-plan-machine-grid/);
  assert.match(OPS,/mops-plan-idle/);
  assert.match(OPS,/Ver \$\{visibleIdle\.length\} impresora\(s\) sin trabajos planificados/);
  assert.match(OPS,/setGanttFilter/);
  assert.match(OPS,/setGanttFamily/);
  assert.match(OPS,/Sin telemetría/);
  assert.match(OPS,/Controller sin confirmar/);
  assert.match(CSS,/Plan estimado por impresora · vista clara/);
  assert.match(CSS,/mops-plan-summary/);
  assert.match(CSS,/mops-plan-machine/);
  assert.match(CSS,/mops-plan-idle-grid/);
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
  const session=MAQ.slice(MAQ.indexOf('async function refreshPrinterTunnelSession('),MAQ.indexOf('// El token viaja',MAQ.indexOf('async function refreshPrinterTunnelSession(')));
  assert.match(session,/X-Bridge-Token/,'sólo el canje de sesión puede usar cabecera; media/ws siguen sin preflight');
  const printerUrl=MAQ.slice(MAQ.indexOf('function printerUrl('),MAQ.indexOf('function printerMediaUrl('));
  assert.doesNotMatch(printerUrl,/X-Bridge-Token/);
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

test('el slicer entra a MachineOps con material, boquilla, dimensiones y preflight real',()=>{
  assert.match(OPS,/function onLegacyQueueAdd\(machineId,filename,secs,grams,meta=\{\}\)/);
  assert.match(OPS,/material=String\(meta\.material/);
  assert.match(OPS,/nozzle=String\(meta\.nozzle/);
  assert.match(OPS,/sizeX:Math\.max\(0,num\(meta\.sizeX\)\)/);
  assert.match(OPS,/function startUploadedSlicerJob\(meta=\{\}\)/);
  assert.match(OPS,/openPreflight\(job\.id\)/,'el slicer no debe arrancar directo');
  assert.match(OPS,/_queueAdd=function\(id,gcode,filename,secs,grams,meta=\{\}\)/);
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


test('compatibilidad no acepta dimensiones parciales y no usa multiplicadores inventados por modelo',()=>{
  const ops=loadOps();
  assert.equal(ops.modelCanRun('K1',{material:'PLA',sizeX:100,sizeY:0,sizeZ:50}),false);
  assert.equal(ops.modelCanRun('K1',{material:'PLA',sizeX:0,sizeY:0,sizeZ:0}),true,'sin dimensiones queda desconocido, no falsamente incompatible');
  assert.doesNotMatch(OPS,/\/cap\.speed/);
  assert.doesNotMatch(OPS,/speed:1\.22|speed:1\.18|speed:1\.12|speed:\.92|speed:\.72/);
});

test('preflight separa material-volumen, boquilla y cama liberada',()=>{
  assert.match(OPS,/Boquilla instalada/);
  assert.match(OPS,/Dimensiones incompletas/);
  assert.match(OPS,/falta confirmar retiro de pieza/);
  assert.match(OPS,/function installedNozzle\(/);
  assert.match(OPS,/function bedIsCleared\(/);
  assert.match(OPS,/confirmBedCleared/);
});

test('inicio revalida inmediatamente y sólo ejecuta mediante Farm Controller',()=>{
  const start=OPS.slice(OPS.indexOf('async function startJob('),OPS.indexOf('\nfunction startExistingFile',OPS.indexOf('async function startJob(')));
  assert.match(start,/const fresh=evaluatePreflight\(j,m\)/);
  assert.match(start,/window\.FarmQueue\?\.startExisting/);
  assert.doesNotMatch(start,/printer\/print\/start/);
  assert.match(start,/j\.status='en_cola'/,'aceptación del Controller no debe fingir que ya imprime');
});

test('reimpresión desde archivos crea trabajo y exige preflight',()=>{
  assert.match(MAQ,/window\.MachineOps\?\.startExistingFile/);
  assert.doesNotMatch(MAQ.slice(MAQ.indexOf('async function reprintFile('),MAQ.indexOf('// Historial real',MAQ.indexOf('async function reprintFile('))),/printer\/print\/start/);
  assert.match(OPS,/function startExistingFile\(/);
  assert.match(OPS,/openPreflight\(j\.id\)/);
});

test('lifecycle de Controller reconcilia en cola, imprimiendo, QA y fallido',()=>{
  assert.match(OPS,/function reconcileFarmQueueJobs\(/);
  assert.match(OPS,/state==='completed'/);
  assert.match(OPS,/\['printing','paused'\]/);
  assert.match(OPS,/\['cancelled','failed'\]/);
});

test('la ficha de fiabilidad usa muestra real y no accede a propiedades score inexistentes',()=>{
  const open=OPS.slice(OPS.indexOf('function openTech('),OPS.indexOf('\nfunction closeTech',OPS.indexOf('function openTech(')));
  assert.doesNotMatch(open,/reliability\.score/);
  assert.match(open,/reliability\.completion/);
  assert.match(open,/reliability\.history\.total/);
});
