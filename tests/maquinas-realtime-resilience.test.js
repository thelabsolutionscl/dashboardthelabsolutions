#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const CTRL=fs.readFileSync(path.join(ROOT,'js','maquinas-farm-controller.js'),'utf8');
const HEALTH=fs.readFileSync(path.join(ROOT,'js','farm-health-adapter.js'),'utf8');

function fn(source,name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(');
  const m=re.exec(source);assert.ok(m,'falta '+name);
  let paren=0,open=-1;
  for(let i=m.index+m[0].length-1;i<source.length;i++){
    const ch=source[i];
    if(ch==='(')paren++;
    else if(ch===')'&&--paren===0){open=source.indexOf('{',i);break;}
  }
  assert.ok(open>=0,'sin cuerpo '+name);
  let depth=0,quote='',esc=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;}if(ch==='\\'){esc=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&next==='/'){line=true;i++;continue;}
    if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='\x60'){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return source.slice(m.index,i+1);
  }
  throw new Error('no se pudo aislar '+name);
}

test('polling es respaldo permanente y no confía en un WebSocket stale',()=>{
  const poll=fn(MAQ,'pollPrinters');
  assert.doesNotMatch(poll,/document\.hidden/,'no debe congelar telemetría por ocultar la pestaña');
  assert.match(poll,/_wsFresh\(m\.id,now\)/,'solo un WS fresco puede saltarse el polling');
  const fresh=fn(MAQ,'_wsFresh');
  assert.match(fresh,/_WS_STALE_MS/);
});

test('WebSocket remoto queda activo por defecto y tiene heartbeat + watchdog',()=>{
  const enabled=fn(MAQ,'_wsEnabled');
  assert.match(enabled,/getPrinterTunnelToken\(\)/,'remoto con token debe usar WSS');
  const heartbeat=fn(MAQ,'_printerWsHeartbeat');
  assert.match(heartbeat,/printer\.objects\.query/,'debe consultar aunque la impresora esté idle');
  assert.match(heartbeat,/_WS_STALE_MS/,'debe detectar socket medio abierto');
  assert.match(heartbeat,/ws\.close\(\)/,'un socket stale debe forzar reconexión');
  const reconnect=fn(MAQ,'_scheduleWsReconnect');
  assert.doesNotMatch(reconnect,/document\.hidden/,'reconectar no depende de que la sección esté visible');
});

test('servicio realtime se recupera al volver, recuperar red o foco',()=>{
  const service=fn(MAQ,'ensurePrinterRealtimeService');
  assert.match(service,/setInterval\(_printerWsHeartbeat/);
  assert.match(service,/setInterval\(pollPrinters/);
  assert.match(service,/addEventListener\('online',_resumePrinterRealtime\)/);
  assert.match(service,/visibilitychange/);
  const resume=fn(MAQ,'_resumePrinterRealtime');
  assert.match(resume,/FarmHealth/);
  assert.match(resume,/FarmRegistry/);
});

test('navegar por el dashboard no destruye el monitor de Máquinas',()=>{
  const a=INDEX.indexOf('function switchTab(name)'),b=INDEX.indexOf('// ── OVERVIEW',a);
  const sw=INDEX.slice(a,b);
  assert.doesNotMatch(sw,/clearInterval\(_monitorInterval\)/);
  assert.doesNotMatch(sw,/disconnectAllPrinterWs\(\)/);
});

test('monitor permite ordenar por señal de cámara y luego por modelo',()=>{
  const sort=fn(MAQ,'sortedList');
  const signal=fn(MAQ,'_cameraSignalRank');
  const setSort=fn(MAQ,'setMonitorSort');
  const filters=fn(MAQ,'renderMonitorFilterTabs');
  const loadOk=fn(MAQ,'_cameraLoadOk');
  const loadError=fn(MAQ,'_cameraLoadError');
  assert.match(MAQ,/let _monitorSortMode='camera_model'/,'cámara+modelo debe ser el orden por defecto');
  assert.match(sort,/_cameraSignalRank\(a\)-_cameraSignalRank\(b\)/,'primero separa con señal de sin señal');
  assert.match(sort,/_monitorModelCompare\(a,b\)/,'dentro de cada estado de cámara ordena por modelo/número');
  assert.match(signal,/state==='ok'\?0:state==='down'\?2:1/);
  assert.match(setSort,/monitor_sort_mode/,'el orden elegido debe persistir');
  assert.match(filters,/monitorSortSelect/);
  assert.match(filters,/Cámara con señal → sin señal · modelo/);
  assert.match(loadOk,/_setCameraSignalState\(im\.dataset\.machineId,'ok'\)/);
  assert.match(loadError,/_setCameraSignalState\(machineId,'down'\)/);
});

test('modo remoto aligera polling y distingue bridge de impresora',()=>{
  const poll=fn(MAQ,'pollPrinters');
  const fetchStatus=fn(MAQ,'fetchPrinterStatus');
  const apply=fn(MAQ,'_applyStatus');
  assert.match(poll,/_printerUsesRemoteTunnel\(\)\?2:4/,'remoto debe limitar concurrencia');
  assert.match(fetchStatus,/_REMOTE_STATUS_TIMEOUT_MS/);
  assert.match(fetchStatus,/_remoteBridgeReachable/);
  assert.match(fetchStatus,/_remotePathFailure/);
  assert.match(apply,/_remotePathFail/,'un fallo común del túnel no debe convertirse en offline individual');
  assert.match(apply,/_centralFarmMachineEvidence/,'usa evidencia del controller dentro de la oficina');
});

test('grid remoto convierte MJPEG continuo en snapshots finitos',()=>{
  const raw=fn(MAQ,'_printerGridCamRaw');
  const sync=fn(MAQ,'_syncPrinterCam');
  const ok=fn(MAQ,'_cameraLoadOk');
  assert.match(raw,/action=stream/);
  assert.match(raw,/action=snapshot/);
  assert.match(sync,/_REMOTE_CAM_SNAPSHOT_MS/);
  assert.match(sync,/data-cam-interval/);
  assert.match(ok,/_cameraSnapshotDelay/);
});

test('cámaras permanecen montadas aunque cambie estado, orden o filtro',()=>{
  const render=fn(MAQ,'renderMonitorGrid');
  assert.match(render,/const showCam=!!_rawCam/,'Moonraker caído no debe apagar una cámara configurada');
  assert.match(render,/sortedList\(MAQUINAS\)/,'los filtros no deben desmontar cámaras');
  assert.match(render,/appendChild\(node\)/,'reordenar debe mover nodos, no recrearlos');
  assert.doesNotMatch(render,/el\.innerHTML=__cards/,'no debe vaciar el grid al cambiar orden');
  const replace=fn(MAQ,'_replaceMonitorCardPreservingCamera');
  assert.match(replace,/oldSlot/);
  assert.match(replace,/replaceWith\(oldSlot\)/,'una tarjeta actualizada debe conservar el slot de cámara');
});

test('cámaras hacen autoretry y K2 conserva el último frame sin parpadear',()=>{
  const sync=fn(MAQ,'_syncPrinterCam');
  assert.match(sync,/loading="eager"/,'las cámaras deben arrancar aunque estén bajo el fold');
  assert.match(sync,/onerror="_cameraLoadError\(this\)"/);
  assert.match(sync,/onload="_cameraLoadOk\(this\)"/);
  const ok=fn(MAQ,'_cameraLoadOk');
  assert.match(ok,/_cameraSnapshotDelay/,'el siguiente snapshot parte después del frame recibido y respeta cadencia local/remota');
  const err=fn(MAQ,'_cameraLoadError');
  assert.match(err,/_CAM_RETRY_MAX_MS/,'los fallos deben reintentarse con backoff');
  assert.match(err,/hadGood/,'un fallo transitorio debe distinguir una cámara que ya entregó imagen');
  assert.match(err,/hadGood\?'1':'0'/,'si había frame bueno no debe ocultar la imagen');
  const refresh=fn(MAQ,'_refreshSnapshotCams');
  assert.match(refresh,/camLoading/,'el watchdog no debe abortar una petición aún en vuelo');
  assert.match(MAQ,/const _CAM_LOAD_TIMEOUT_MS=25000/,'K2 necesita margen para negociar WebRTC');
  assert.match(MAQ,/const _CAM_SNAPSHOT_MS=2500/,'go2rtc no debe saturarse con solicitudes cada segundo');
  const refreshNow=fn(MAQ,'_cameraRefreshNow');
  assert.match(refreshNow,/const probe=new Image\(\)/,'K2 debe precargar el frame fuera del img visible');
  assert.match(refreshNow,/im\.src=probe\.src/,'solo cambia el frame visible después de una carga exitosa');
  assert.match(refreshNow,/_cameraLoadError\(im\)/,'timeouts reales sí alimentan recuperación');
});

test('K1 y Ender tienen sonda finita de cámara aunque el MJPEG quede colgado',()=>{
  const probe=fn(MAQ,'_cameraHealthProbe');
  const sweep=fn(MAQ,'_cameraHealthSweep');
  const probeUrl=fn(MAQ,'_cameraProbeUrl');
  assert.match(probeUrl,/action=snapshot/,'la sonda MJPEG debe ser una petición finita');
  assert.match(probe,/setTimeout\(\(\)=>finish\(false\),12000\)/,'una cámara que cuelga no puede quedar esperando para siempre');
  assert.match(probe,/recoverPrinterCamera\(id,true\)/,'si nunca hubo un frame válido debe intentar recuperación física');
  assert.match(sweep,/_cameraManagedByPrinter/,'solo se recuperan automáticamente cámaras integradas');
  assert.match(MAQ,/setInterval\(_cameraHealthSweep,_CAM_HEALTH_INTERVAL_MS\)/,'la vigilancia debe continuar durante la sesión');
});

test('si el bridge remoto es viejo se autoactualiza y reintenta recover-camera',()=>{
  const recover=fn(MAQ,'recoverPrinterCamera');
  const ensure=fn(MAQ,'_ensureCameraRecoveryBridge');
  const wait=fn(MAQ,'_cameraBridgeHealthWait');
  assert.match(recover,/attempt\.r\.status===404/);
  assert.match(recover,/_ensureCameraRecoveryBridge\(overlay\)/);
  assert.match(recover,/attempt=await _cameraRecoverRequest\(ip,kind\)/);
  assert.match(ensure,/\/update/,'debe actualizar el bridge sin ir físicamente al iMac');
  assert.match(ensure,/method:'POST'/);
  assert.match(ensure,/_cameraBridgeUpdatePromise/,'dos cámaras no deben actualizar el bridge en paralelo');
  assert.match(ensure,/_cameraBridgeHealthWait/,'debe esperar a launchd después del update');
  assert.match(wait,/\/healthz/);
  assert.match(MAQ,/no se pudo recuperar ·/,'la tarjeta debe mostrar el motivo concreto si falla');
});

test('K2/K2 Plus recuperan go2rtc desde el primer frame fallido',()=>{
  const err=fn(MAQ,'_cameraLoadError');
  const sync=fn(MAQ,'_syncPrinterCam');
  const recover=fn(MAQ,'recoverPrinterCamera');
  assert.match(err,/firstSnapshotFailure/,'el primer fallo de una snapshot K2 debe escalar de inmediato');
  assert.match(err,/snapshot&&!hadGood&&n===1/);
  assert.match(err,/recoverPrinterCamera\(machineId,true\)/);
  assert.match(sync,/_cameraLoadError\(im\)/,'el timeout del primer src debe contar como fallo real');
  assert.match(recover,/pcam-off-status/,'la tarjeta debe indicar que está recuperando');
  assert.match(recover,/_CAM_AUTORECOVER_COOLDOWN_MS/,'la recuperación sigue protegida por cooldown');
});

test('K2 evita doble consumidor y recupera su stack de cámara automáticamente',()=>{
  const open=fn(MAQ,'openWebcamModal');
  const close=fn(MAQ,'closeWebcamModal');
  const err=fn(MAQ,'_cameraLoadError');
  const recover=fn(MAQ,'recoverPrinterCamera');
  const refresh=fn(MAQ,'_refreshSnapshotCams');
  assert.match(open,/_printerCamRaw\(id\)/,'el modal debe usar también la cámara por defecto, no solo overrides');
  assert.doesNotMatch(open,/localStorage\.getItem\('printer_cam_'/,'la ausencia de override no puede ocultar una cámara K2 válida');
  assert.match(open,/camSuspended='1'/,'al abrir una K2 debe congelar el polling de la tarjeta');
  assert.match(close,/delete cardImg\.dataset\.camSuspended/,'al cerrar debe liberar la tarjeta');
  assert.match(close,/_cameraRefreshNow\(cardImg\)/,'al cerrar debe retomar imagen inmediatamente');
  assert.match(refresh,/camSuspended/,'el watchdog global no puede reactivar la tarjeta mientras el modal consume la K2');
  assert.match(err,/_CAM_AUTORECOVER_FAILS/,'la cámara caída debe escalar de retry a recuperación');
  assert.match(err,/recoverPrinterCamera\(machineId,true\)/,'la recuperación automática debe ser silenciosa');
  const request=fn(MAQ,'_cameraRecoverRequest');
  assert.match(request,/\/recover-camera\/\$\{ip\}/,'la recuperación física va por el bridge del taller');
  assert.match(request,/\?kind=\$\{kind\}/,'el modelo viaja al bridge para elegir backend');
  assert.match(recover,/_CAM_AUTORECOVER_COOLDOWN_MS/,'debe tener cooldown para no reiniciar en bucle');
  assert.match(MAQ,/↻ Reiniciar cámara/,'también debe existir recuperación manual en la tarjeta');
});

test('el primer ingreso a Máquinas no depende del primer polling para mostrar impresoras',()=>{
  const init=fn(MAQ,'initMaquinas');
  const paint=fn(MAQ,'_renderMaquinasMonitorNow');
  assert.match(paint,/renderMonitorGrid\(\)/,'el grid debe pintarse desde el registry local inmediatamente');
  assert.match(paint,/renderMonitorKPIs\(\)/);
  assert.ok(init.indexOf('_renderMaquinasMonitorNow()')<init.indexOf('await loadMaquinasAirtable()'),'el primer paint debe ocurrir antes de Airtable');
  const afterLoad=init.indexOf('_renderMaquinasMonitorNow()',init.indexOf('await loadMaquinasAirtable()'));
  assert.ok(afterLoad>init.indexOf('await loadMaquinasAirtable()'),'debe repintar cuando llegue el registry remoto');
  assert.ok(init.indexOf('ensurePrinterRealtimeService()',afterLoad)>afterLoad,'el realtime arranca sobre cards ya montadas');
});

test('cargas concurrentes de Máquinas comparten una sola inicialización',()=>{
  const init=fn(MAQ,'initMaquinas');
  assert.match(init,/_maquinasInitPromise/);
  assert.match(init,/ensurePrinterRealtimeService\(\)/);
});

test('registry, cola y salud central no se pausan explícitamente al ocultar el navegador',()=>{
  assert.match(CTRL,/setInterval\(\(\)=>\{syncQueue\(false\);syncRegistry\(false\);\},15000\)/);
  assert.match(CTRL,/visibilitychange/);
  assert.match(CTRL,/addEventListener\('online'/);
  assert.match(HEALTH,/setInterval\(\(\)=>refresh\(false\),30000\)/);
  assert.match(HEALTH,/visibilitychange/);
  assert.match(HEALTH,/addEventListener\('online'/);
});
