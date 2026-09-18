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

test('cámaras hacen autoretry y K2 espera cada frame antes de pedir el siguiente',()=>{
  const sync=fn(MAQ,'_syncPrinterCam');
  assert.match(sync,/loading="eager"/,'las cámaras deben arrancar aunque estén bajo el fold');
  assert.match(sync,/onerror="_cameraLoadError\(this\)"/);
  assert.match(sync,/onload="_cameraLoadOk\(this\)"/);
  const ok=fn(MAQ,'_cameraLoadOk');
  assert.match(ok,/_CAM_SNAPSHOT_MS/,'el siguiente snapshot parte después del frame recibido');
  const err=fn(MAQ,'_cameraLoadError');
  assert.match(err,/_CAM_RETRY_MAX_MS/,'los fallos deben reintentarse con backoff');
  const refresh=fn(MAQ,'_refreshSnapshotCams');
  assert.match(refresh,/camLoading/,'el watchdog no debe abortar una petición aún en vuelo');
  assert.match(MAQ,/const _CAM_LOAD_TIMEOUT_MS=25000/,'K2 necesita margen para negociar WebRTC');
  const refreshNow=fn(MAQ,'_cameraRefreshNow');
  assert.match(refreshNow,/camKind==='snapshot'/,'el timeout de frame no debe reiniciar un MJPEG sano');
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
  assert.match(recover,/\/recover-camera\/\$\{ip\}/,'la recuperación física va por el bridge del taller');
  assert.match(recover,/_CAM_AUTORECOVER_COOLDOWN_MS/,'debe tener cooldown para no reiniciar en bucle');
  assert.match(MAQ,/↻ Reiniciar cámara/,'también debe existir recuperación manual en la tarjeta');
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
