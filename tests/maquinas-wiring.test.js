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
const SLICER=fs.existsSync(path.join(ROOT,'js','slicer3d.js'))?fs.readFileSync(path.join(ROOT,'js','slicer3d.js'),'utf8'):'';
const SOURCE=`${INDEX}\n${MAQ}\n${OPS}\n${SLICER}`;

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function functionSource(source,name){
  const marker=new RegExp(`(?:async\\s+)?function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*\\(`);
  const found=marker.exec(source);
  assert.ok(found,`falta ${name}`);
  // El cuerpo empieza DESPUÉS de la lista de parámetros: con un valor por
  // defecto tipo `opts={}` el primer `{` pertenece al parámetro, no al cuerpo.
  let paren=0,open=-1;
  for(let i=found.index+found[0].length-1;i<source.length;i++){
    const ch=source[i];
    if(ch==='(')paren++;
    else if(ch===')'&&--paren===0){open=source.indexOf('{',i);break;}
  }
  assert.ok(open>=0,`no se pudo ubicar el cuerpo de ${name}`);
  let depth=0,quote='',escape=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===quote)quote='';continue;}
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

test('la pestaña Máquinas y sus módulos se cargan una sola vez y en orden',()=>{
  assert.equal(count(/id=["']tab-maquinas["']/g,INDEX),1,'#tab-maquinas debe ser único');
  assert.equal(count(/js\/maquinas\.js\?v=%%BUILD%%/g,INDEX),1,'maquinas.js debe cargarse una vez');
  assert.equal(count(/js\/maquinas-operaciones\.js\?v=%%BUILD%%/g,INDEX),1,'maquinas-operaciones.js debe cargarse una vez');
  const base=INDEX.indexOf('js/maquinas.js?v=%%BUILD%%');
  const ops=INDEX.indexOf('js/maquinas-operaciones.js?v=%%BUILD%%');
  assert.ok(base>=0&&ops>base,'telemetría debe cargarse antes que MachineOps');
});

test('la inicialización respeta datos, render y conexión en vivo',()=>{
  const body=functionSource(MAQ,'initMaquinas');
  const load=body.indexOf('await loadMaquinasAirtable()');
  const events=body.indexOf('loadMaquinaEventosAirtable()');
  const render=body.indexOf('renderMaquinasCalendar()');
  const poll=body.indexOf('pollPrinters()');
  const ws=body.indexOf('connectAllPrinterWs()');
  assert.ok(load>=0&&events>load&&render>events,'primero deben cargarse datos y luego renderizar');
  assert.ok(poll>render&&ws>poll,'polling inicial debe anteceder al WebSocket');
  assert.match(body,/renderCargaMaquinas\(\)/,'debe enlazar la carga de pedidos por máquina');
});

test('las funciones críticas no están ausentes ni duplicadas',()=>{
  const base=['initMaquinas','renderMaquinasCalendar','renderMonitorGrid','renderMonitorKPIs','pollPrinters','connectAllPrinterWs','disconnectAllPrinterWs','getPrinterIp','printerUrl','openPrinterControl','openWebcamModal'];
  for(const name of base){
    assert.ok(hasFunction(MAQ,name),`falta ${name}`);
    assert.equal(count(new RegExp(`function\\s+${name}\\s*\\(`,'g'),MAQ),1,`${name} debe definirse una vez`);
  }
  for(const name of ['renderCargaMaquinas','asignarMaquina','sugerirMaquina'])assert.ok(hasFunction(INDEX,name),`falta ${name}`);
});

test('telemetría K2 y CFS mantiene separados conexión, filamento y cámara',()=>{
  const extract=functionSource(MAQ,'_extractFilamentTelemetry');
  const derive=functionSource(MAQ,'_deriveStatus');
  assert.match(extract,/filament_switch_sensor filament_sensor/);
  assert.match(extract,/filament_rack/);
  assert.match(extract,/const box=status\?\.box/);
  assert.match(extract,/cfsConnected/);
  assert.match(extract,/temperature_sensor chamber_temp/);
  assert.match(derive,/lastSeenAt:seen/,'cada lectura válida debe guardar cuándo fue vista');
  assert.match(derive,/klState==='shutdown'\|\|klState==='error'/,'Klipper detenido debe dominar el estado visual');
  assert.match(MAQ,/Estado de impresión desconocido|SENSOR SIN LECTURA/,'la ausencia de telemetría no debe mostrarse como éxito');
});

test('el monitor evita falsos Offline y conserva el último estado bueno',()=>{
  assert.match(MAQ,/const _OFFLINE_AFTER_FAILS=3/);
  const apply=functionSource(MAQ,'_applyStatus');
  assert.match(apply,/n<_OFFLINE_AFTER_FAILS/);
  assert.match(apply,/state:'connecting'/);
  assert.match(apply,/stale:true/);
  assert.match(apply,/lastSeenAt:prev\?\.lastSeenAt\|\|0/);
});

test('el ciclo WebSocket se cierra fuera de Máquinas y no renderiza oculto',()=>{
  assert.match(INDEX,/disconnectAllPrinterWs\(\)/,'al salir debe cerrarse la telemetría en vivo');
  const scheduled=functionSource(MAQ,'_wsScheduleRender');
  assert.match(scheduled,/tab-maquinas|activeTab|active-tab|\.active/,'el render WebSocket debe comprobar que Máquinas esté visible');
});

test('estado administrativo y estado técnico conservan responsabilidades distintas',()=>{
  for(const state of ['disponible','reservada','calibrando','limpieza','mantencion','esperando_repuesto','fuera_servicio']){
    assert.match(MAQ,new RegExp(`${state}:\\{`),`falta estado administrativo ${state}`);
  }
  assert.match(OPS,/getMaquinaEstadoGlobal\(m\.id\)!==['"]disponible['"]/,'MachineOps debe respetar bloqueos administrativos');
  assert.match(OPS,/\['offline','noip','shutdown','error'\]\.includes\(liveState\(m\.id\)\)/,'MachineOps debe respetar fallas técnicas');
});

test('Pedidos se enlaza con planificación sin incluir pedidos terminados',()=>{
  assert.match(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\['Confirmado','En producción','En cola'\]/);
  assert.doesNotMatch(INDEX,/const _MAQ_ESTADOS_ACTIVOS=\[[^\]]*(?:Completado|Listo para despacho|Despachado)/);
  assert.match(INDEX,/pedido_id/,'los eventos de máquina deben conservar el vínculo al pedido');
  assert.match(INDEX,/renderCargaMaquinas/);
  assert.match(INDEX,/asignarMaquina/);
  assert.match(INDEX,/sugerirMaquina/);
});

test('las áreas del centro operacional están enlazadas con su navegación',()=>{
  const views=['operacion','inteligencia','planificacion','postproduccion','capacidad','materiales','calidad','mantenimiento','seguridad','analitica','perfiles','laminado'];
  for(const view of views){
    assert.match(INDEX,new RegExp(`data-maq-nav=["']${view}["']`),`falta navegación ${view}`);
    assert.match(INDEX,new RegExp(`data-maq-view=["']${view}["']`),`falta vista ${view}`);
  }
  assert.match(OPS,/showView/);
  assert.match(INDEX,/MachineOps\.showView\(/);
});

test('NFC y enlaces directos vuelven a Máquinas después del login',()=>{
  assert.match(OPS,/function directRoute\(/);
  assert.match(OPS,/tab:['"]maquinas['"]/);
  assert.match(OPS,/function opsLink\(/);
  assert.match(INDEX,/const route=window\.MachineOps\?\.directRoute\?\.\(\);[\s\S]*switchTab\(route\.tab\)/);
  assert.match(INDEX,/MachineOps\.openTech/);
  assert.match(INDEX,/MachineOps\.copyTechLinkFor/);
});

test('credenciales y enlaces remotos no quedan expuestos permanentemente',()=>{
  assert.match(MAQ,/sessionStorage\.getItem\('printer_tunnel_token'\)/);
  assert.match(MAQ,/sessionStorage\.setItem\('printer_tunnel_token'/);
  assert.match(MAQ,/localStorage\.removeItem\('printer_tunnel_token'\)/);
  assert.match(MAQ,/headers\['X-Bridge-Token'\]=token/);
  assert.match(MAQ,/function printerMediaUrl\(ip,path\)\{return _appendBridgeToken\(printerUrl\(ip,path\)\);\}/);
});

test('acciones peligrosas están bloqueadas durante una impresión',()=>{
  const send=functionSource(MAQ,'_sendGcode');
  assert.match(send,/!opts\.allowBusy&&_isPrinterBusy/);
  assert.match(send,/no se envió nada/);
  const emergency=functionSource(MAQ,'printerEmergencyStop');
  assert.match(emergency,/confirm\(/);
  assert.match(emergency,/printer\/emergency_stop/);
  const control=functionSource(MAQ,'openPrinterControl');
  assert.match(control,/const busy=_isPrinterBusy/);
  assert.match(control,/disabled/);
});

test('preflight, QA, postproducción e incidentes forman un flujo continuo',()=>{
  for(const id of ['mopsPreflightModal','mopsIncidentModal','mopsJobs','mopsGantt','mopsSpools','mopsQuality','mopsPostProduction','mopsAnalytics']){
    assert.ok(INDEX.includes(`id="${id}"`),`falta ${id}`);
  }
  assert.match(OPS,/confirmPreflight/);
  assert.match(OPS,/preflightFromFacts/);
  assert.match(OPS,/markOrderReady\(w\.pedidoId\)/,'postproducción debe devolver el pedido a su siguiente etapa');
  assert.match(OPS,/'Resultado QA':'QA aprobado'/);
  assert.match(OPS,/incidents/);
});
