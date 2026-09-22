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

test('la inicialización pinta el monitor de inmediato y luego reconcilia datos en vivo',()=>{
  const body=functionSource(MAQ,'initMaquinas');
  const immediate=functionSource(MAQ,'_renderMaquinasMonitorNow');
  const service=functionSource(MAQ,'ensurePrinterRealtimeService');
  const firstPaint=body.indexOf('_renderMaquinasMonitorNow()');
  const guard=body.indexOf('if(_maquinasInitPromise)');
  const load=body.indexOf('await loadMaquinasAirtable()');
  const secondPaint=body.indexOf('_renderMaquinasMonitorNow()',load);
  const live=body.indexOf('ensurePrinterRealtimeService()',load);
  const events=body.indexOf('loadMaquinaEventosAirtable()');
  const render=body.indexOf('renderMaquinasCalendar()');
  const poll=service.indexOf('pollPrinters()');
  const ws=service.indexOf('connectAllPrinterWs()');
  assert.ok(firstPaint>=0&&firstPaint<guard,'la pestaña debe pintar cards incluso si ya existe una inicialización en curso');
  assert.ok(load>guard&&secondPaint>load,'después de Airtable debe repintar el registry real');
  assert.ok(live>secondPaint&&events>live,'telemetría y cámaras deben arrancar antes de esperar calendario/mantención');
  assert.ok(render>events,'el calendario completo puede terminar después sin bloquear el monitor');
  assert.match(immediate,/renderMonitorFilterTabs\(\)/);
  assert.match(immediate,/renderMonitorKPIs\(\)/);
  assert.match(immediate,/renderMonitorGrid\(\)/,'las tarjetas deben existir antes del primer polling');
  assert.ok(poll>=0&&ws>poll,'el servicio realtime debe arrancar polling antes de WebSocket');
  assert.match(body,/renderCargaMaquinas\(\)/,'debe enlazar la carga de pedidos por máquina');
});

test('el monitor en vivo se monta antes del diagnóstico sin destruir cámaras',()=>{
  const render=functionSource(OPS,'renderIntelligence');
  const park=functionSource(OPS,'_parkIntelligenceEmbeddedNodes');
  const mount=functionSource(OPS,'_mountIntelligenceEmbeddedNodes');
  const anchorPos=render.indexOf('mopsLiveMonitorAnchor');
  const healthPos=render.indexOf('Estado y evidencia por impresora');
  assert.ok(anchorPos>=0&&healthPos>anchorPos,'el monitor debe quedar antes del diagnóstico');
  assert.match(park,/maquinaMonitorView/,'debe reutilizar el monitor existente');
  assert.match(park,/insertAdjacentElement\('afterend',node\)/,'antes de regenerar inteligencia debe sacar nodos vivos del innerHTML');
  assert.match(mount,/monitorAnchor\.replaceWith\(nodes\.monitor\)/,'debe mover el mismo nodo, no clonarlo ni recrearlo');
  assert.match(mount,/renderMonitorGrid\(\)/,'al montarlo debe asegurar que las impresoras ya estén visibles');
  assert.doesNotMatch(mount,/cloneNode|innerHTML\s*=/,'no debe duplicar ni recrear el monitor/cámaras');
});

test('panel CFS muestra únicamente los dos equipos que físicamente tienen CFS',()=>{
  const render=functionSource(OPS,'renderIntelligence');
  const has=functionSource(OPS,'machineHasCfs');
  assert.match(render,/\.filter\(machineHasCfs\)/);
  assert.match(render,/Solo equipos con CFS instalado: K1 #1 y K2 Plus #11/);
  assert.match(render,/CFS confirmados/);
  assert.match(has,/machine\.modelo==='K2 Plus'/);
  assert.match(has,/id==='k1-1'/);
  assert.match(has,/machine\.modelo==='K1'&&globalNo===1/);
  assert.doesNotMatch(render,/\['K2','K2 Plus'\]\.includes\(machine\.modelo\)/);
});

test('Centro de granja distingue evidencia, eventos automáticos e historial',()=>{
  const render=functionSource(OPS,'renderIntelligence');
  const reliability=functionSource(OPS,'machineReliability');
  const overview=functionSource(OPS,'renderOpsOverview');
  const add=functionSource(OPS,'addIncident');
  assert.match(render,/Estado y evidencia por impresora/);
  assert.match(render,/No mostramos un porcentaje “mágico”/);
  assert.doesNotMatch(render,/row\.score\.toFixed|disponibilidad \$\{row\.availability/,'no debe mostrar precisión inventada');
  assert.match(render,/Pendientes por resolver/);
  const incidentCard=functionSource(OPS,'_incidentCard');
  assert.match(incidentCard,/Confirmar falla/);
  assert.match(incidentCard,/Descartar/);
  assert.match(render,/CFS físico/);
  assert.match(render,/mops-physical-details/,'CFS debe quedar como detalle técnico contraíble');
  assert.match(reliability,/PrinterHistory|printerHistoryEvidence/);
  assert.match(reliability,/FarmHealth|centralHealthEvidence/);
  assert.match(reliability,/liveFresh/,'salud actual debe exigir telemetría reciente');
  assert.match(add,/source==='telemetry'\?30\*60000:5\*60000/,'telemetría debe tener deduplicación más robusta');
  assert.match(overview,/Telemetría reciente/);
  assert.doesNotMatch(overview,/Máquinas no listas/,'no debe inferir disponibilidad con un KPI ambiguo');
});

test('resumen operativo queda dentro del Centro inteligente antes de alertas y monitor',()=>{
  const mount=functionSource(OPS,'_mountIntelligenceEmbeddedNodes');
  const park=functionSource(OPS,'_parkIntelligenceEmbeddedNodes');
  const render=functionSource(OPS,'renderIntelligence');
  const overviewPos=render.indexOf('mopsOpsOverviewAnchor');
  const alertsPos=render.indexOf('mops-intel-grid');
  const monitorPos=render.indexOf('mopsLiveMonitorAnchor');
  assert.ok(overviewPos>=0&&alertsPos>overviewPos,'el resumen operativo debe formar parte de la cabecera del Centro inteligente');
  assert.ok(monitorPos>overviewPos,'el resumen operativo debe quedar antes del monitor de impresoras');
  assert.match(mount,/overviewAnchor\.replaceWith\(nodes\.overview\)/);
  assert.match(park,/maquinaOpsOverview/);
  assert.match(mount,/renderOpsOverview\(\)/);
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

test('la telemetría permanece viva al navegar y el render evita trabajo visible fuera de Máquinas',()=>{
  const switchStart=INDEX.indexOf('function switchTab(name)');
  const switchEnd=INDEX.indexOf('// ── OVERVIEW',switchStart);
  const switchBody=INDEX.slice(switchStart,switchEnd);
  assert.doesNotMatch(switchBody,/clearInterval\(_monitorInterval\)/,'cambiar de sección no debe detener el monitor');
  assert.doesNotMatch(switchBody,/disconnectAllPrinterWs\(\)/,'cambiar de sección no debe cerrar WebSockets');
  const scheduled=functionSource(MAQ,'_wsScheduleRender');
  assert.match(scheduled,/tab-maquinas|activeTab|active-tab|\.active/,'el render visual de ráfagas WS puede esperar si Máquinas no está visible');
});

test('estado administrativo y estado técnico conservan responsabilidades distintas',()=>{
  for(const state of ['disponible','reservada','calibrando','limpieza','mantencion','esperando_repuesto','fuera_servicio']){
    assert.match(MAQ,new RegExp(`${state}:\\{`),`falta estado administrativo ${state}`);
  }
  assert.match(OPS,/getMaquinaEstadoGlobal\(m\.id\)!==['"]disponible['"]/,'MachineOps debe respetar bloqueos administrativos');
  assert.match(OPS,/const evidence=liveEvidence\(m\.id\);/,'MachineOps debe exigir evidencia técnica reciente');
  assert.match(OPS,/if\(!evidence\.known\)return false/,'MachineOps no debe planificar sobre estado desconocido o stale');
  assert.match(OPS,/\['offline','apidown','noip','shutdown','error'\]\.includes\(evidence\.state\)/,'MachineOps debe respetar fallas técnicas');
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
  // Las 12 áreas siguen existiendo como secciones; lo que cambió es que se
  // agrupan en tres pantallas en vez de tener una pestaña cada una.
  for(const view of views)assert.match(INDEX,new RegExp(`data-maq-view=["']${view}["']`),`falta vista ${view}`);
  for(const screen of ['hoy','trabajos','taller'])assert.match(INDEX,new RegExp(`data-maq-nav=["']${screen}["']`),`falta la pantalla ${screen}`);
  assert.match(OPS,/showView/);
  assert.match(INDEX,/MachineOps\.showView\(/);

  // Una sección que no pertenezca a ninguna pantalla queda inalcanzable para
  // siempre: nada la mostraría nunca. Esto lo detecta antes de que pase.
  const groups=OPS.slice(OPS.indexOf('const VIEW_GROUPS='),OPS.indexOf('const VIEW_TITLES='));
  const agrupadas=(groups.match(/'([a-z]+)'/g)||[]).map(s=>s.replace(/'/g,''));
  for(const view of views)assert.ok(agrupadas.includes(view),`${view} no pertenece a ninguna pantalla`);
  const declaradas=[...INDEX.matchAll(/data-maq-view=["']([a-z]+)["']/g)].map(m=>m[1]);
  for(const view of new Set(declaradas))assert.ok(agrupadas.includes(view),`la sección ${view} existe en el HTML pero ninguna pantalla la muestra`);
});

test('los enlaces al esquema anterior de áreas siguen funcionando',()=>{
  // Hay QR impresos, enlaces guardados y llamadas internas que usan los nombres
  // viejos ('planificacion', 'materiales'). Deben resolverse a su pantalla.
  assert.match(OPS,/function groupOf\(/,'falta la resolución de nombres antiguos');
  const show=functionSource(OPS,'showView');
  assert.match(show,/groupOf\(/,'showView debe resolver el nombre recibido a su pantalla');
  assert.match(show,/goToSection\(/,'un nombre de área concreto debe llevar la vista hasta esa sección');
  assert.match(OPS,/showView\(['"]planificacion['"]\)/,'los atajos internos siguen usando nombres de área');
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
  assert.match(MAQ,/function _appendBridgeToken\(u\)\{if\(\/\[\?&\]bt=\/\.test\(u\)\)return u;/,'el token va en la URL y sin duplicarse');
  assert.match(MAQ,/function printerMediaUrl\(ip,path\)\{return _appendBridgeToken\(printerUrl\(ip,path\)\);\}/);
});

test('controles operativos separan ajustes en vivo de movimientos peligrosos',()=>{
  const send=functionSource(MAQ,'_sendGcode');
  assert.match(send,/!opts\.allowBusy&&_isPrinterBusy/,'movimiento y utilidades siguen bloqueados durante impresión');
  assert.match(send,/_printerControlFresh/,'ningún comando normal debe salir con telemetría stale/offline');
  const temp=functionSource(MAQ,'setPrinterTemp');
  assert.match(temp,/allowBusy:true/,'temperatura sí puede ajustarse durante una impresión');
  assert.match(temp,/M104/);
  assert.match(temp,/M140/);
  const jog=functionSource(MAQ,'printerJogStep');
  assert.match(jog,/pcJogStep_/,'la cruceta usa paso seleccionable');
  const tune=functionSource(MAQ,'printerSetTune');
  assert.match(tune,/M220/,'velocidad en vivo');
  assert.match(tune,/M221/,'flujo en vivo');
  const fan=functionSource(MAQ,'printerSetFan');
  assert.match(fan,/M106|M107/,'ventilador en vivo');
  const z=functionSource(MAQ,'printerZAdjust');
  assert.match(z,/SET_GCODE_OFFSET/,'Z-offset experto en vivo');
  const emergency=functionSource(MAQ,'printerEmergencyStop');
  assert.match(emergency,/confirm\(/);
  assert.match(emergency,/printer\/emergency_stop/);
  const control=functionSource(MAQ,'openPrinterControl');
  assert.match(control,/motionLocked=busy\|\|!fresh/,'movimiento debe quedar bloqueado si imprime o falta telemetría fresca');
  assert.match(control,/printerAdjustTemp/);
  assert.match(control,/PAUSAR/);
  assert.match(control,/REANUDAR/);
  assert.match(control,/DETENER/);
});

test('telemetría incluye factor real de velocidad y flujo para el panel de control',()=>{
  const derive=functionSource(MAQ,'_deriveStatus');
  assert.match(MAQ,/webhooks','gcode_move/);
  assert.match(derive,/gm=s\.gcode_move/);
  assert.match(derive,/speedFactor/);
  assert.match(derive,/flowFactor/);
});
test('control de cama distingue malla activa, calibración nueva y estado en curso',()=>{
  const auto=functionSource(MAQ,'printerAutoBedCalibrate');
  const refresh=functionSource(MAQ,'printerBedLevelRefresh');
  const stats=functionSource(MAQ,'_bedLevelStats');
  const grade=functionSource(MAQ,'_bedLevelGrade');
  const wait=functionSource(MAQ,'_bedLevelWaitForCompletion');
  const render=functionSource(MAQ,'_bedLevelRenderStats');
  const source=functionSource(MAQ,'_bedLevelSetSource');
  const restore=functionSource(MAQ,'_bedLevelRestoreRunUi');
  const control=functionSource(MAQ,'openPrinterControl');

  assert.match(auto,/_printerControlFresh/,'calibración requiere telemetría fresca');
  assert.match(auto,/_isPrinterBusy/,'calibración debe bloquearse durante impresión o pausa');
  assert.match(auto,/_bedLevelRuns\[id\]\?\.active/,'no debe permitir una segunda calibración simultánea');
  assert.match(auto,/BED_MESH_CLEAR\\nBED_MESH_CALIBRATE/);
  assert.ok(auto.indexOf('_bedLevelWaitForCompletion')<auto.indexOf('_sendGcode'),'debe observar CLEAR antes/durante el POST para verificar incluso una malla idéntica');
  assert.match(auto,/CALIBRANDO · 0s/);
  assert.match(auto,/_bedLevelMetaWrite/,'una calibración verificada debe guardar fecha y firma');
  assert.match(auto,/_bedLevelTimeoutMs/,'timeout debe ser consistente y adaptable a camas grandes');

  assert.match(wait,/1200/,'durante calibración debe muestrear suficientemente rápido para observar BED_MESH_CLEAR');
  assert.match(wait,/sawCleared/);
  assert.match(wait,/CALIBRANDO · \$\{elapsed\}s/);
  assert.match(wait,/run\.cancelled/);

  assert.match(refresh,/forceDuringRun/,'una lectura manual no debe pisar visualmente el estado CALIBRANDO');
  assert.match(source,/EDAD DE LA MALLA DESCONOCIDA/,'una lectura de Moonraker no debe fingir fecha de calibración');
  assert.match(source,/CALIBRACIÓN VERIFICADA/);
  assert.match(render,/Malla leída ahora/,'debe distinguir hora de lectura de hora de calibración');
  assert.match(restore,/CALIBRANDO/,'al reabrir CONTROL debe recuperar el estado activo');

  assert.match(stats,/probed_matrix\|\|mesh\?\.mesh_matrix/);
  assert.match(grade,/range<=0\.15/);
  assert.match(grade,/range<=0\.25/);
  assert.match(grade,/range<=0\.40/);
  assert.match(control,/pcBedLevelState_/);
  assert.match(control,/pcBedLevelSource_/);
  assert.match(control,/ACTUALIZAR LECTURA/);
  assert.doesNotMatch(control,/MEDIR DESNIVEL/,'el botón que solo relee Moonraker no debe presentarse como medición física');
  assert.match(control,/BED_MESH_CLEAR/);
  assert.match(control,/_bedLevelRestoreRunUi/);
  assert.match(control,/repeat\(auto-fit,minmax\(220px,1fr\)\)/);
  assert.match(control,/pcBedRecommendation_/);
  assert.match(control,/pcBedHistory_/);
  assert.match(MAQ,/BED_LEVEL_HISTORY_V1/,'historial debe tener respaldo compartido');
  assert.match(MAQ,/function _bedLevelDiagnose\(/);
  assert.match(MAQ,/function _bedLevelHistoryTrendSvg\(/);
  assert.match(MAQ,/function _bedLevelRecommendation\(/);
  assert.match(MAQ,/bedTempStart/,'calibración debe registrar temperatura de cama');
  assert.match(MAQ,/DIAGNÓSTICO FÍSICO GUIADO/);
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
