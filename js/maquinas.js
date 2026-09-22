/* js/maquinas.js — módulo extraído de index.html (carga en el mismo punto). */
// ── MÁQUINAS ──────────────────────────────────────────────────
// Formatea por el calendario local, no por UTC. Con toISOString(), fmtDate(new
// Date()) devolvía el día siguiente después de las 20:00 (Chile va UTC-4/-3), y
// eso es lo que marca "hoy" en las grillas de máquinas y de equipo: pasadas las
// 8 de la tarde la columna resaltada era la de mañana.
function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function fmtDayLabel(d){return['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]+' '+d.getDate();}
function getMaquinaSemanaLunes(){const t=new Date();t.setHours(0,0,0,0);const day=t.getDay();const l=new Date(t);l.setDate(t.getDate()-(day===0?6:day-1)+(maquinaState.semanaOffset*7));return l;}
function navSemana(d){maquinaState.semanaOffset+=d;renderMaquinasCalendar();}
function goToday(){maquinaState.semanaOffset=0;renderMaquinasCalendar();}
function _machineStatePendingKey(id){return 'estado_maq_pending_'+id;}
function getMaquinaEstadoGlobal(id){
  const m=MAQUINAS.find(x=>x.id===id);
  let pending='';try{pending=JSON.parse(localStorage.getItem(_machineStatePendingKey(id))||'null')?.value||'';}catch(_){}
  return pending||m?.estado||localStorage.getItem('estado_maq_'+id)||'disponible';
}
async function _saveMachineStateReliable(id,value){
  const payload={value,updatedAt:Date.now()};
  localStorage.setItem('estado_maq_'+id,value);
  localStorage.setItem(_machineStatePendingKey(id),JSON.stringify(payload));
  try{
    await saveMaquinaEstadoAirtable(id,value);
    localStorage.removeItem(_machineStatePendingKey(id));
    return true;
  }catch(e){return false;}
}
async function flushMachineStateOutbox(){
  for(const m of (MAQUINAS||[])){
    let pending=null;try{pending=JSON.parse(localStorage.getItem(_machineStatePendingKey(m.id))||'null');}catch(_){}
    if(!pending?.value)continue;
    try{await saveMaquinaEstadoAirtable(m.id,pending.value);m.estado=pending.value;localStorage.removeItem(_machineStatePendingKey(m.id));}
    catch(_){}
  }
}
const _MACHINE_EVENT_OUTBOX='maquina_eventos_outbox_v1';
function _machineEventOutbox(){
  try{const rows=JSON.parse(localStorage.getItem(_MACHINE_EVENT_OUTBOX)||'[]');return Array.isArray(rows)?rows:[];}catch(_){return[];}
}
function _queueMachineEventOps(ops){
  const rows=_machineEventOutbox(),map=new Map(rows.map(x=>[x.key,x]));
  for(const op of ops||[])if(op?.key)map.set(op.key,{...op,updatedAt:Date.now()});
  localStorage.setItem(_MACHINE_EVENT_OUTBOX,JSON.stringify([...map.values()].slice(-500)));
}
async function flushMachineEventOutbox(){
  const rows=_machineEventOutbox();if(!rows.length)return true;
  for(const op of rows){
    if(op.type==='delete')delete maquinaState.eventos[op.key];
    else if(op.type==='set'&&op.value)maquinaState.eventos[op.key]=op.value;
  }
  try{await saveMaquinaEventosAirtable();localStorage.removeItem(_MACHINE_EVENT_OUTBOX);return true;}
  catch(_){return false;}
}
const MAQUINA_ESTADOS={
  disponible:{label:'Disponible',short:'✓ Disp.',color:'green',icon:'✓'},
  reservada:{label:'Reservada',short:'◷ Res.',color:'yellow',icon:'◷'},
  calibrando:{label:'Calibrando',short:'📐 Cal.',color:'yellow',icon:'📐'},
  limpieza:{label:'En limpieza',short:'🧹 Limp.',color:'yellow',icon:'🧹'},
  mantencion:{label:'En mantención',short:'🔧 Mant.',color:'red',icon:'🔧'},
  esperando_repuesto:{label:'Esperando repuesto',short:'📦 Rep.',color:'red',icon:'📦'},
  fuera_servicio:{label:'Fuera de servicio',short:'⛔ Fuera',color:'red',icon:'⛔'},
};
function maquinaEstadoMeta(estado){return MAQUINA_ESTADOS[estado]||MAQUINA_ESTADOS.disponible;}
async function toggleMaquinaEstado(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const current=getMaquinaEstadoGlobal(id);
  if(!['disponible','mantencion'].includes(current)){
    toast(`${m.nombre} #${m.numG||m.num}: ${maquinaEstadoMeta(current).label}. Para reactivarla usa la ficha técnica y confirma el cambio.`,'info');
    try{window.MachineOps?.openTech?.(id);}catch(_){}
    return;
  }
  const nv=current==='disponible'?'mantencion':'disponible';
  if(current==='mantencion'&&nv==='disponible'&&!confirm(`¿Marcar ${m.nombre} #${m.numG||m.num} como DISPONIBLE?\n\nConfirma que la mantención terminó y la máquina fue revisada físicamente.`))return;
  m.estado=nv;renderMaquinasCalendar();
  const meta=maquinaEstadoMeta(nv);
  const synced=await _saveMachineStateReliable(id,nv);
  toast(`${m.nombre} #${m.numG||m.num}: ${meta.icon} ${meta.label}${synced?"":" · pendiente de sincronizar"}`,synced?(nv==='disponible'?'success':'error'):'info');
}
function _renderMaquinasMonitorNow(){
  // El monitor debe existir desde el primer frame de la pestaña. MAQUINAS ya
  // trae un registry base local; después se reconcilia con Airtable sin dejar
  // el grid vacío mientras esperan red, eventos o mantenciones.
  try{renderMonitorFilterTabs();}catch(_){}
  try{renderMonitorKPIs();}catch(_){}
  try{renderMonitorGrid();}catch(_){}
}
async function initMaquinas(){
  // También se ejecuta si ya hay una inicialización en curso: volver a abrir
  // Máquinas nunca depende de que termine un fetch anterior para pintar cards.
  _renderMaquinasMonitorNow();
  if(_maquinasInitPromise)return _maquinasInitPromise;
  _maquinasInitPromise=(async()=>{
    await loadMaquinasAirtable();
    await flushMachineStateOutbox();

    // Reconciliado el registry real, repintamos inmediatamente y arrancamos
    // telemetría/cámaras ANTES de esperar eventos de calendario/mantención.
    _renderMaquinasMonitorNow();
    ensurePrinterRealtimeService();
    _resumePrinterRealtime();

    await Promise.all([loadMaquinaEventosAirtable(), loadMaintLogAirtable()]);
    await flushMachineEventOutbox();
    await syncPendingMaintenance();
    seedOdometerIfNeeded();
    renderMaquinasCalendar();
    _renderMaquinasMonitorNow();
    renderMaintenanceTable();
    try{audit3DLoadDaily();}catch(_){}
    renderProductionAnalytics();
    try{renderCargaMaquinas();}catch(e){}
    requestNotificationPermission(false);
  })();
  try{return await _maquinasInitPromise;}
  finally{_maquinasInitPromise=null;}
}

// ── PRINTER LIVE MONITOR ──────────────────────────────────────
const MOONRAKER_PORT=7125;
// Cadencia y tolerancia a fallos del monitor. El intervalo es mayor que el
// peor caso de un ciclo (timeouts más cortos + backoff) para que no se salten
// ciclos. El umbral de fallos evita marcar "Offline" por un hipo de red.
const _MONITOR_INTERVAL_MS=15000;   // respaldo periódico; WS entrega los cambios en vivo
const _STATUS_TIMEOUT_MS=9000;      // túnel/WiFi lento del taller necesita margen (la histéresis evita falsos Offline)
const _THUMB_TIMEOUT_MS=2000;       // antes 3000
const _OFFLINE_AFTER_FAILS=3;       // fallos consecutivos antes de declarar Offline
const _WS_HEARTBEAT_MS=15000;       // una consulta ligera mantiene vivo el socket incluso cuando la impresora está idle
const _WS_STALE_MS=45000;           // un socket sin mensajes deja de ser autoritativo; vuelve a polling y se reconecta
const _WS_OPEN_TIMEOUT_MS=12000;    // evita conexiones TCP/WebSocket medio abiertas para siempre
const _CAM_SNAPSHOT_MS=2500;        // menos presión sobre go2rtc; siguiente frame sólo tras recibir el anterior
const _CAM_LOAD_TIMEOUT_MS=25000;   // K2 puede tardar ~20s negociando WebRTC
const _CAM_RETRY_MAX_MS=30000;
const _CAM_AUTORECOVER_FAILS=3;     // tras varios fallos reales, reinicia el stack de cámara por el bridge
const _CAM_AUTORECOVER_COOLDOWN_MS=10*60*1000;
const _CAM_RECOVER_TIMEOUT_MS=150000; // incluye preflight + S99camera + espera de imagen del bridge
const _CAM_HEALTH_INTERVAL_MS=60000;
const _REMOTE_STATUS_TIMEOUT_MS=13000;
const _REMOTE_CAM_SNAPSHOT_MS=5000;
const _REMOTE_BRIDGE_HEALTH_TTL_MS=5000;
let _remoteBridgeHealth={at:0,ok:null,promise:null};
function _printerUsesRemoteTunnel(){return !(typeof _isLocalMode==='function'&&_isLocalMode());}
function _centralFarmMachineEvidence(id,now=Date.now()){
  try{
    if(typeof window==='undefined'||!window.FarmHealth?.status)return null;
    const st=window.FarmHealth.status();
    if(!st?.lastSync||now-st.lastSync>90000)return null;
    return (Array.isArray(st.machines)?st.machines:[]).find(x=>x&&x.id===id)||null;
  }catch(_){return null;}
}
async function _remoteBridgeReachable(force=false){
  if(!_printerUsesRemoteTunnel())return true;
  const now=Date.now();
  if(!force&&_remoteBridgeHealth.ok!==null&&now-_remoteBridgeHealth.at<_REMOTE_BRIDGE_HEALTH_TTL_MS)return _remoteBridgeHealth.ok;
  if(_remoteBridgeHealth.promise)return _remoteBridgeHealth.promise;
  _remoteBridgeHealth.promise=(async()=>{
    let ok=false;
    try{
      const r=await fetch(getPrinterTunnel()+'/healthz',{cache:'no-store',signal:AbortSignal.timeout(4500)});
      ok=!!r?.ok;
    }catch(_){ok=false;}
    _remoteBridgeHealth={at:Date.now(),ok,promise:null};return ok;
  })();
  return _remoteBridgeHealth.promise;
}
function _remotePathFailure(ip,reason,code=0){
  return{_remotePathFail:true,ip,state:'remote',connectionError:reason||'Intermitencia en túnel/bridge remoto',httpStatus:code||0,checkedAt:Date.now()};
}
function getPrinterTunnel(){const d=(!_DEFAULTS.PRINTER_TUNNEL||_DEFAULTS.PRINTER_TUNNEL.startsWith('%%'))?'https://printers.thelab.solutions':_DEFAULTS.PRINTER_TUNNEL;return(localStorage.getItem('printer_tunnel')||d).replace(/\/$/,'');}
let _printerTunnelSessionToken='',_printerTunnelSessionExpires=0,_printerTunnelSessionSync=null,_printerTunnelSessionLastTry=0;
function _getPrinterTunnelLongToken(){
  const d=(_DEFAULTS.PRINTER_TUNNEL_TOKEN&&!_DEFAULTS.PRINTER_TUNNEL_TOKEN.startsWith('%%'))?_DEFAULTS.PRINTER_TUNNEL_TOKEN:'';
  let local=sessionStorage.getItem('printer_tunnel_token')||'';const legacy=localStorage.getItem('printer_tunnel_token')||'';
  if(!local&&legacy){local=legacy;sessionStorage.setItem('printer_tunnel_token',legacy);localStorage.removeItem('printer_tunnel_token');}
  const custom=(localStorage.getItem('printer_tunnel')||'').replace(/\/$/,'');
  const defaultTunnel=((!_DEFAULTS.PRINTER_TUNNEL||_DEFAULTS.PRINTER_TUNNEL.startsWith('%%'))?'https://printers.thelab.solutions':_DEFAULTS.PRINTER_TUNNEL).replace(/\/$/,'');
  return !custom||custom===defaultTunnel?(d||local):(local||d);
}
function getPrinterTunnelToken(){
  if(_printerTunnelSessionToken&&Date.now()<_printerTunnelSessionExpires-15000)return _printerTunnelSessionToken;
  return _getPrinterTunnelLongToken();
}
async function refreshPrinterTunnelSession(force=false){
  if(window._DEMO_MODE)return false;
  const longToken=_getPrinterTunnelLongToken(),base=getPrinterTunnel(),now=Date.now();
  if(!longToken||!base)return false;
  if(_printerTunnelSessionSync)return _printerTunnelSessionSync;
  if(!force&&_printerTunnelSessionToken&&now<_printerTunnelSessionExpires-120000)return true;
  if(!force&&now-_printerTunnelSessionLastTry<30000)return false;
  _printerTunnelSessionLastTry=now;
  _printerTunnelSessionSync=(async()=>{
    try{
      const r=await fetch(base+'/farm/session',{method:'POST',headers:{'X-Bridge-Token':longToken},signal:AbortSignal.timeout(6000),cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      if(!d?.token||!Number(d.expiresAt))throw new Error('sesión inválida');
      _printerTunnelSessionToken=String(d.token);_printerTunnelSessionExpires=Number(d.expiresAt);
      // Los sockets existentes siguen autenticados; los nuevos y las cámaras usan desde ahora el ticket breve.
      return true;
    }catch(e){
      // Compatibilidad: si el túnel móvil bloquea el preflight, seguimos con el token largo.
      return false;
    }finally{_printerTunnelSessionSync=null;}
  })();
  return _printerTunnelSessionSync;
}
// Media/WebSocket siguen necesitando autenticación en URL, pero el dashboard intenta
// canjear el secreto largo por un ticket efímero del Controller. Si una red móvil
// bloquea el preflight del canje, conserva compatibilidad usando el token largo.
 // Idempotente: printerMediaUrl lo aplica sobre URLs que ya lo traen.
function _appendBridgeToken(u){if(/[?&]bt=/.test(u))return u;const tk=getPrinterTunnelToken();return tk?u+(u.includes('?')?'&':'?')+'bt='+encodeURIComponent(tk):u;}
// Diagnóstico del túnel/bridge desde el propio dashboard (Mi cuenta → Túnel Impresoras)
async function testPrinterBridge(statusId){
  const el=document.getElementById(statusId);
  const url=getPrinterTunnel(),tk=getPrinterTunnelToken();
  const set=(c,t)=>{if(el){el.style.color=c;el.textContent=t;}};
  set('var(--text3)',`Probando ${url} …`);
  try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(7000)});if(!r.ok)throw 0;}
  catch(e){set('var(--danger)',`✗ No se alcanza ${url}. Revisa que el bridge y el túnel estén corriendo en el iMac.`);return;}
  if(!tk){set('var(--warn)','⚠ Túnel OK, pero falta el token del bridge. Pégalo y pulsa Guardar.');return;}
  try{
    const r=await fetch(url+'/authcheck?bt='+encodeURIComponent(tk),{signal:AbortSignal.timeout(7000)});
    if(r.status===401){set('var(--danger)','✗ Token incorrecto. Copia el token actual del bridge (lo imprime al arrancar / lo da install-launchd.sh).');return;}
    if(!r.ok)throw 0;
    set('var(--accent3)','✅ Bridge OK y token válido. Pon Máquinas en 🌐 Remoto.');
  }catch(e){set('var(--warn)','⚠ Túnel alcanzable pero no pude validar el token. ¿El bridge está actualizado?');}
}
async function restartPrinterBridge(statusId){
  const el=document.getElementById(statusId);
  const url=getPrinterTunnel(),tk=getPrinterTunnelToken();
  const set=(c,t)=>{if(el){el.style.color=c;el.textContent=t;}};
  if(!tk){set('var(--warn)','Necesitas el token guardado para reiniciar el bridge.');return;}
  if(!confirm('¿Reiniciar el bridge del iMac? Se reconecta en unos segundos.'))return;
  set('var(--text3)','Reiniciando bridge…');
  try{await fetch(url+'/restart?bt='+encodeURIComponent(tk),{method:'POST',signal:AbortSignal.timeout(7000)});}
  catch(e){/* la conexión se corta al salir el proceso: es esperado */}
  set('var(--text3)','Bridge reiniciándose… reprobando en unos segundos.');
  setTimeout(()=>testPrinterBridge(statusId),4500);
}
function printerUrl(ip,path){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return`http://${ip}:${MOONRAKER_PORT}${path}`;
  return _appendBridgeToken(`${getPrinterTunnel()}/${ip}${path}`);
}
function printerMediaUrl(ip,path){return _appendBridgeToken(printerUrl(ip,path));}
// Cámara por defecto según el modelo, derivada de la IP viva de la máquina (no
// una URL fija: las IP son DHCP y se mueven). Las K1/Ender publican MJPEG por
// mjpg_streamer en :8080; las K2/K2 Plus dan un snapshot JPEG por go2rtc en
// :1984. Así toda máquina intenta su cámara sola: la que no transmite muestra
// "sin señal", y en cuanto arranca mjpg_streamer aparece sin configurar nada.
function _defaultCamUrl(m){
  const ip=(typeof getPrinterIp==='function')?getPrinterIp(m):(m&&m.ip);
  if(!ip)return'';
  return /K2/.test((m&&m.modelo)||'')
    ? `http://${ip}:1984/api/frame.jpeg?src=k2plus`
    : `http://${ip}:8080/?action=stream`;
}
// Las URLs estándar de la cámara integrada siguen la IP viva del registry.
// Así una IP DHCP antigua guardada en Airtable/localStorage no deja la cámara
// apuntando para siempre al dueño anterior de esa dirección.
function _camFollowLivePrinterIp(raw,m){
  const s=String(raw||'').trim();if(!s||!m)return s;
  const standardMjpeg=/^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:8080\/\?action=stream(?:&.*)?$/i.test(s);
  const standardK2=/^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:1984\/api\/frame\.jpe?g\?src=k2plus(?:&.*)?$/i.test(s);
  return standardMjpeg||standardK2?_defaultCamUrl(m):s;
}
// Fuente única: override manual/Airtable para casos especiales; las rutas
// estándar integradas se normalizan a la IP viva de la máquina.
function _printerCamRaw(id){
  const m=(typeof MAQUINAS!=='undefined')?MAQUINAS.find(x=>x.id===id):null;
  const ex=localStorage.getItem('printer_cam_'+id);
  if(ex)return _camFollowLivePrinterIp(ex,m);
  if(m&&m.cam)return _camFollowLivePrinterIp(m.cam,m);
  return m?_defaultCamUrl(m):'';
}
// Webcam: en modo remoto reescribe http://IP_LAN:PUERTO/ruta → túnel /{ip}:{puerto}/ruta
function _printerCamUrlFromRaw(raw){
  if(!raw)return'';
  if(typeof _isLocalMode==='function'&&_isLocalMode())return raw;
  const mm=String(raw).match(/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?(\/.*)?$/);
  if(!mm)return raw;
  return _appendBridgeToken(`${getPrinterTunnel()}/${mm[1]}:${mm[2]||'80'}${mm[3]||'/'}`);
}
function printerCamUrl(id){return _printerCamUrlFromRaw(_printerCamRaw(id));}
function _cameraProbeUrl(id){
  let raw=_printerCamRaw(id);if(!raw)return'';
  if(/([?&])action=stream(?:&|$)/i.test(raw))raw=raw.replace(/action=stream/i,'action=snapshot');
  return _printerCamUrlFromRaw(raw);
}
// Cámaras tipo "snapshot" (p.ej. go2rtc /api/frame.jpeg de las K2, que no dan
// MJPEG): el <img> con data-snap se refresca solo cada ~1s para simular video.
function _camIsSnapshot(raw){return /\/api\/frame\.jpe?g|[?&]action=snapshot(?:&|$)/i.test(raw||'');}
function _printerGridCamRaw(id){
  const raw=_printerCamRaw(id);
  if(_printerUsesRemoteTunnel()&&/[?&]action=stream(?:&|$)/i.test(raw||''))return String(raw).replace(/action=stream/i,'action=snapshot');
  return raw;
}
function _printerGridCamUrl(id){const raw=_printerGridCamRaw(id);return raw?_printerCamUrlFromRaw(raw):'';}
function _cameraSnapshotDelay(im){
  const v=Number(im?.dataset?.camInterval||0);
  return Number.isFinite(v)&&v>0?v:_CAM_SNAPSHOT_MS;
}
function _safePrinterMediaUrl(raw){
  const s=String(raw||'').trim();
  if(!s)return'';
  try{
    const u=new URL(s,location.href);
    if(!['http:','https:','blob:'].includes(u.protocol))return'';
    return escapeHtml(u.href);
  }catch(e){return'';}
}
let _camSnapInterval=null,_camHealthInterval=null;
const _camRetryTimers={},_camPendingImages={},_camHealthFails={},_camSignalState={};
const _camRecovering={},_camLastRecover={};
let _camSortRenderTimer=null;
function _setCameraSignalState(id,state){
  id=String(id||'');if(!id)return;
  const next=['ok','down','unknown'].includes(state)?state:'unknown';
  if(_camSignalState[id]===next)return;
  _camSignalState[id]=next;
  clearTimeout(_camSortRenderTimer);
  _camSortRenderTimer=setTimeout(()=>{
    if(typeof renderMonitorGrid==='function')renderMonitorGrid();
    if(typeof renderMonitorFilterTabs==='function')renderMonitorFilterTabs();
  },120);
}
function _cameraTimerKey(im){return im?.dataset?.machineId||im?.id||'';}
function _cameraClearTimer(im){
  const key=_cameraTimerKey(im);if(!key)return;
  clearTimeout(_camRetryTimers[key]);delete _camRetryTimers[key];
  const pending=_camPendingImages[key];
  if(pending){pending.onload=null;pending.onerror=null;delete _camPendingImages[key];}
}
function _cameraRefreshNow(im){
  if(!im||!im.isConnected||im.dataset.camSuspended==='1')return;
  const base=im.dataset.camBase||im.getAttribute('data-snap')||'';if(!base)return;
  if(im.dataset.camLoading==='1')return;
  _cameraClearTimer(im);
  im.dataset.camLoading='1';
  const nextUrl=base+(base.includes('?')?'&':'?')+'_cam='+Date.now();
  const key=_cameraTimerKey(im);
  if(im.dataset.camKind==='snapshot'){
    // Doble buffer: nunca reemplazamos el frame visible hasta que el siguiente
    // JPEG esté completamente cargado. Un timeout/transitorio de go2rtc ya no
    // deja la tarjeta negra ni provoca el parpadeo ocultar/mostrar.
    const probe=new Image();if(key)_camPendingImages[key]=probe;
    probe.decoding='async';
    probe.onload=()=>{
      if(key&&_camPendingImages[key]!==probe)return;
      if(key)delete _camPendingImages[key];
      if(!im.isConnected||im.dataset.camSuspended==='1')return;
      im.src=probe.src; // queda en caché del navegador; onload visible programa el siguiente frame
    };
    probe.onerror=()=>{
      if(key&&_camPendingImages[key]!==probe)return;
      if(key)delete _camPendingImages[key];
      _cameraLoadError(im);
    };
    if(key)_camRetryTimers[key]=setTimeout(()=>{
      if(_camPendingImages[key]!==probe)return;
      probe.onload=null;probe.onerror=null;delete _camPendingImages[key];
      im.dataset.camLoading='0';_cameraLoadError(im);
    },_CAM_LOAD_TIMEOUT_MS);
    probe.src=nextUrl;
    return;
  }
  im.src=nextUrl;
}
function _cameraSchedule(im,delay){
  if(!im||!im.isConnected)return;
  const key=_cameraTimerKey(im);if(!key)return;
  _cameraClearTimer(im);
  _camRetryTimers[key]=setTimeout(()=>_cameraRefreshNow(im),Math.max(0,delay||0));
}
function _cameraLoadOk(im){
  if(!im)return;
  im.dataset.camLoading='0';im.dataset.camFails='0';im.dataset.camLastOk=String(Date.now());im.style.opacity='1';
  _setCameraSignalState(im.dataset.machineId,'ok');
  const o=im.parentElement?.querySelector('.pcam-off');if(o)o.style.display='none';
  _cameraClearTimer(im);
  if(im.dataset.camKind==='snapshot'&&im.dataset.camSuspended!=='1')_cameraSchedule(im,_cameraSnapshotDelay(im));
}
function _cameraManagedByPrinter(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return false;
  const raw=_printerCamRaw(id),def=_defaultCamUrl(m);
  return !!raw&&raw===def;
}
let _cameraBridgeUpdatePromise=null;
function _cameraOverlayStatus(overlay,text){
  const status=overlay?.querySelector('.pcam-off-status');if(status)status.textContent=text||'reconectando automáticamente…';
}
async function _cameraBridgeHealthWait(timeoutMs=20000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    try{
      const r=await fetch(_appendBridgeToken(`${getPrinterTunnel()}/healthz`),{cache:'no-store',signal:AbortSignal.timeout(3500)});
      if(r.ok)return true;
    }catch(_){}
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  return false;
}
async function _ensureCameraRecoveryBridge(overlay){
  if(_cameraBridgeUpdatePromise)return _cameraBridgeUpdatePromise;
  _cameraBridgeUpdatePromise=(async()=>{
    _cameraOverlayStatus(overlay,'actualizando printer bridge…');
    try{
      const r=await fetch(_appendBridgeToken(`${getPrinterTunnel()}/update`),{method:'POST',signal:AbortSignal.timeout(30000)});
      let d={};try{d=await r.json();}catch(_){}
      if(!r.ok||!d.ok){
        _cameraOverlayStatus(overlay,'bridge sin recuperación · actualización falló');
        return{ok:false,error:d.error||`HTTP ${r.status}`};
      }
      _cameraOverlayStatus(overlay,'bridge actualizado · reiniciando…');
      const healthy=await _cameraBridgeHealthWait(22000);
      if(!healthy){
        _cameraOverlayStatus(overlay,'bridge actualizado · esperando reconexión');
        return{ok:false,error:'el bridge no volvió a responder a tiempo'};
      }
      _cameraOverlayStatus(overlay,'bridge actualizado · recuperando cámara…');
      return{ok:true};
    }catch(e){
      _cameraOverlayStatus(overlay,'no se pudo actualizar el bridge');
      return{ok:false,error:e?.name==='TimeoutError'||e?.name==='AbortError'?'timeout al actualizar bridge':(e?.message||'fallo de red')};
    }finally{
      setTimeout(()=>{_cameraBridgeUpdatePromise=null;},1000);
    }
  })();
  return _cameraBridgeUpdatePromise;
}
async function _cameraRecoverRequest(ip,kind){
  const r=await fetch(_appendBridgeToken(`${getPrinterTunnel()}/recover-camera/${ip}?kind=${kind}`),{method:'POST',signal:AbortSignal.timeout(_CAM_RECOVER_TIMEOUT_MS)});
  let d={};try{d=await r.json();}catch(_){}
  return{r,d};
}
async function recoverPrinterCamera(id,silent=false){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return false;
  const ip=getPrinterIp(m);if(!ip)return false;
  if(silent&&!_cameraManagedByPrinter(id))return false;
  const now=Date.now();
  if(_camRecovering[id])return false;
  if(silent&&_camLastRecover[id]&&now-_camLastRecover[id]<_CAM_AUTORECOVER_COOLDOWN_MS)return false;
  _camLastRecover[id]=now;_camRecovering[id]=true;
  const slot=document.getElementById('mccam_'+id),overlay=slot?.querySelector('.pcam-off');
  if(overlay){overlay.style.display='flex';const status=overlay.querySelector('.pcam-off-status');if(status)status.textContent='recuperando cámara automáticamente…';}
  if(!silent)toast(`📷 Reiniciando cámara · ${m.nombre} #${m.numG}…`,'info');
  try{
    const kind=/K2/.test(String(m.modelo||''))?'k2':'mjpeg';
    let attempt=await _cameraRecoverRequest(ip,kind);
    // Un dashboard actualizado puede hablar con un bridge antiguo. Si la ruta
    // /recover-camera aún no existe, actualizamos el servicio del iMac por su
    // endpoint seguro /update, esperamos que launchd lo levante y reintentamos.
    if(attempt.r.status===404){
      const upgraded=await _ensureCameraRecoveryBridge(overlay);
      if(!upgraded.ok){
        if(!silent)toast('No se pudo actualizar el bridge: '+upgraded.error,'error');
        return false;
      }
      attempt=await _cameraRecoverRequest(ip,kind);
    }
    const {r,d}=attempt;
    if(r.status===403){
      _cameraOverlayStatus(overlay,'sin permiso admin para recuperar cámara');
      if(!silent)toast('El token actual no tiene permiso admin para reiniciar la cámara','error');
      return false;
    }
    if(r.status===404){
      _cameraOverlayStatus(overlay,'bridge sin soporte de recuperación');
      if(!silent)toast('El bridge sigue sin exponer recuperación de cámara tras actualizar','error');
      return false;
    }
    if(r.status===409){_cameraOverlayStatus(overlay,'recuperación ya en curso…');return false;}
    if(!r.ok||!d.ok){
      const why=d.error||`HTTP ${r.status}`;
      _cameraOverlayStatus(overlay,'no se pudo recuperar · '+why);
      if(!silent)toast('No se pudo recuperar la cámara: '+why,'error');
      return false;
    }
    _cameraOverlayStatus(overlay,'cámara recuperada · cargando imagen…');
    const cardImg=slot?.querySelector('img');
    if(cardImg){cardImg.dataset.camFails='0';cardImg.dataset.camLoading='0';_cameraClearTimer(cardImg);_cameraRefreshNow(cardImg);}
    const modalId=document.getElementById('webcamModalId')?.value;
    const modalImg=document.getElementById('webcamModalImg');
    if(modalId===id&&modalImg?.src){modalImg.dataset.camFails='0';modalImg.dataset.camLoading='0';_cameraClearTimer(modalImg);_cameraRefreshNow(modalImg);}
    if(!silent)toast(`✅ Cámara recuperada · ${m.nombre} #${m.numG}`,'success');
    return true;
  }catch(e){
    if(!silent)toast(e?.name==='TimeoutError'||e?.name==='AbortError'?'La cámara tardó demasiado en recuperarse':'No se pudo hablar con el bridge para recuperar la cámara','error');
    return false;
  }finally{
    _camRecovering[id]=false;
    const status=overlay?.querySelector('.pcam-off-status');
    if(status&&/recuperando cámara automáticamente|recuperación ya en curso/.test(status.textContent||''))status.textContent='reconectando automáticamente…';
  }
}
function _cameraLoadError(im){
  if(!im)return;
  im.dataset.camLoading='0';
  const hadGood=Number(im.dataset.camLastOk||0)>0;
  // Si ya hubo imagen, conservar el último frame es más útil que hacerla
  // desaparecer por un fallo transitorio. El estado "sin señal" solo tapa la
  // cámara cuando todavía nunca conseguimos un cuadro válido.
  im.style.opacity=hadGood?'1':'0';
  const o=im.parentElement?.querySelector('.pcam-off');if(o)o.style.display=hadGood?'none':'flex';
  const n=(parseInt(im.dataset.camFails||'0',10)||0)+1;im.dataset.camFails=String(n);
  const machineId=im.dataset.machineId||'';
  const snapshot=im.dataset.camKind==='snapshot';
  const firstSnapshotFailure=snapshot&&!hadGood&&n===1;
  // K2/K2 Plus usan k2rtc.py + go2rtc. Si nunca entregaron el primer frame,
  // esperar tres timeouts de 25 s dejaba la tarjeta negra durante demasiado
  // tiempo. El primer fallo real dispara la recuperación física; el cooldown y
  // _camRecovering impiden reinicios en bucle.
  if(machineId&&(firstSnapshotFailure||n>=_CAM_AUTORECOVER_FAILS))_setCameraSignalState(machineId,'down');
  if(machineId&&(firstSnapshotFailure||n>=_CAM_AUTORECOVER_FAILS))recoverPrinterCamera(machineId,true).catch(()=>{});
  const delay=Math.min(_CAM_RETRY_MAX_MS,1000*Math.pow(2,Math.min(n-1,5)));
  _cameraSchedule(im,delay);
}
function _cameraHealthProbe(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m||!_cameraManagedByPrinter(id))return Promise.resolve(true);
  const raw=_printerCamRaw(id);if(_camIsSnapshot(raw))return Promise.resolve(true);
  const url=_cameraProbeUrl(id);if(!url)return Promise.resolve(false);
  return new Promise(resolve=>{
    const probe=new Image();let done=false;
    const finish=ok=>{
      if(done)return;done=true;clearTimeout(to);probe.onload=null;probe.onerror=null;
      if(ok){_camHealthFails[id]=0;_setCameraSignalState(id,'ok');resolve(true);return;}
      const fails=(_camHealthFails[id]||0)+1;_camHealthFails[id]=fails;
      const card=document.getElementById('mccam_'+id)?.querySelector('img'),neverWorked=!Number(card?.dataset?.camLastOk||0);
      if(fails>=2)_setCameraSignalState(id,'down');
      if(neverWorked||fails>=2)recoverPrinterCamera(id,true).catch(()=>{});
      resolve(false);
    };
    const to=setTimeout(()=>finish(false),12000);
    probe.onload=()=>finish(true);probe.onerror=()=>finish(false);probe.src=url+(url.includes('?')?'&':'?')+'_probe='+Date.now();
  });
}
function _cameraHealthSweep(){
  if(document.hidden)return;
  (MAQUINAS||[]).filter(m=>_cameraManagedByPrinter(m.id)&&!_camIsSnapshot(_printerGridCamRaw(m.id))).forEach((m,i)=>{
    setTimeout(()=>_cameraHealthProbe(m.id).catch(()=>{}),i*350);
  });
}
function _refreshSnapshotCams(force=false){
  if(document.hidden&&!force)return;
  document.querySelectorAll('img[data-snap]').forEach(im=>{
    if(im.dataset.camSuspended==='1'||im.dataset.pageSuspended==='1')return;
    if(force){im.dataset.camLoading='0';_cameraRefreshNow(im);return;}
    const key=_cameraTimerKey(im);
    if(im.dataset.camLoading!=='1'&&(!key||!_camRetryTimers[key]))_cameraRefreshNow(im);
  });
}
function _cameraPageVisibility(){
  const hidden=!!document.hidden;
  document.querySelectorAll('#maquinaMonGrid img[data-machine-id],#webcamModal img[data-machine-id]').forEach(im=>{
    if(hidden){
      im.dataset.pageSuspended='1';_cameraClearTimer(im);im.dataset.camLoading='0';
      if(im.dataset.camKind==='snapshot'||im.dataset.camKind==='mjpeg')im.removeAttribute('src');
    }else if(im.dataset.pageSuspended==='1'){
      delete im.dataset.pageSuspended;
      if(im.dataset.camSuspended==='1')return;
      const base=im.dataset.camBase||im.getAttribute('data-snap')||'';
      if(!base)return;
      if(im.dataset.camKind==='snapshot')_cameraRefreshNow(im);
      else im.src=base+(base.includes('?')?'&':'?')+'_resume='+Date.now();
    }
  });
}
const HIST_KEY='printer_history_v1';
// Caché del historial: parsea localStorage una sola vez y reusa el resultado
// hasta que el string cambie (lo invalida automáticamente cualquier escritura).
// Evita cientos de JSON.parse por minuto al renderizar 13+ máquinas cada 15s.
let _histRaw=null,_histParsed=[];
function getHist(){const raw=localStorage.getItem(HIST_KEY)||'[]';if(raw!==_histRaw){try{_histParsed=JSON.parse(raw);}catch(e){_histParsed=[];}_histRaw=raw;}return _histParsed;}
// ── Odómetro acumulado por máquina ────────────────────────────
// El historial se recorta a 200 entradas, así que en una granja activa las
// horas/filamento "totales" se subestimarían con el tiempo. El odómetro acumula
// de forma persistente (horas completadas y mm de filamento) y no pierde datos
// al recortarse el historial. Se siembra una vez desde el historial actual.
const ODO_KEY='printer_odometer_v1';
let _odo=null;
function getOdometer(){if(_odo===null){try{_odo=JSON.parse(localStorage.getItem(ODO_KEY)||'{}');}catch(e){_odo={};}}return _odo;}
function _saveOdometer(){try{localStorage.setItem(ODO_KEY,JSON.stringify(_odo||{}));}catch(e){}}
function _useOdometer(){return!window._DEMO_MODE&&localStorage.getItem('printer_odometer_seeded')==='1';}
function seedOdometerIfNeeded(){
  if(window._DEMO_MODE||localStorage.getItem('printer_odometer_seeded')==='1')return;
  const o={};
  getHist().forEach(h=>{const e=o[h.id]||(o[h.id]={hours:0,filamentMm:0,prints:0});if(h.result==='Completado'){e.hours+=(h.dur||0)/60;e.prints++;}e.filamentMm+=(h.filamentMm||0);});
  _odo=o;_saveOdometer();localStorage.setItem('printer_odometer_seeded','1');
}
function odoAdd(id,hours,filamentMm,completed){
  if(window._DEMO_MODE)return;
  const e=getOdometer()[id]||(getOdometer()[id]={hours:0,filamentMm:0,prints:0});
  if(completed){e.hours+=hours;e.prints++;}
  e.filamentMm+=(filamentMm||0);_saveOdometer();
}
let _monitorInterval=null,_monitorFilter='all';
const _printerStatus={},_tempHistory={},_prevState={},_sessions={},_thumbCache={},_demoPrinterState={};
// Tolerancia a fallos / backoff por máquina, y conexiones WebSocket en vivo.
const _failCount={},_nextPollAt={};
const _wsConn={},_wsConnected={},_wsRaw={},_wsAttempts={},_wsTimers={};
const _wsLastMessage={},_wsLastProbe={},_wsOpenTimers={};
let _wsRpcId=0,_wsRenderTimer=null,_wsHeartbeatTimer=null,_printerLifecycleBound=false,_maquinasInitPromise=null;
// ── Print queue ──────────────────────────────────────────────
const _printQueue={};// { [printerId]: [{gcode,filename,secs,grams},...] }
function _queueGet(id){return _printQueue[id]||(_printQueue[id]=[]);}
function _queueCount(id){return(_printQueue[id]||[]).length;}
function _queueAdd(id,gcode,filename,secs,grams,meta={}){
  const metadata=meta&&typeof meta==='object'?JSON.parse(JSON.stringify(meta)):{};
  _queueGet(id).push({gcode,filename,secs,grams,meta:metadata,added:Date.now()});
  toast(`📋 Encolado en ${(MAQUINAS.find(m=>m.id===id)||{}).nombre||id} (#${_queueCount(id)} en cola)`,'success');
  renderMonitorGrid();
}
async function _queueStartNext(id){
  const q=_printQueue[id];if(!q||!q.length)return;
  const job=q[0];                                    // peek: no se saca hasta confirmar la subida
  const m=MAQUINAS.find(x=>x.id===id);const ip=getPrinterIp(m);
  if(typeof window!=='undefined'&&window._DEMO_MODE){q.shift();renderMonitorGrid();toast(`▶ DEMO: ${job.filename} iniciado de forma simulada en ${m?.nombre||id}`,'success');return;}
  if(!ip)return;                                     // sin IP: el trabajo queda en cola, se reintenta luego
  if(job._starting)return;                           // ya hay un intento en curso, no duplicar
  job._starting=true;
  // Antes se hacía q.shift() ANTES de subir: si la subida fallaba (la impresora
  // recién terminó y está ocupada un instante) el trabajo encolado se PERDÍA, y
  // como el disparo es por-transición no se reintentaba. Ahora solo se saca de la
  // cola tras una subida exitosa; ante fallo se reintenta unas veces y, si no,
  // queda en la cola para lanzarlo a mano.
  const reintentar=(msg)=>{
    job._starting=false;job._tries=(job._tries||0)+1;
    if(job._tries<3){toast(msg+' — reintentando…','info');setTimeout(()=>_queueStartNext(id),5000);}
    else toast(msg+' — el trabajo quedó en la cola; inícialo a mano','error');
  };
  try{
    const fd=new FormData();
    fd.append('file',new Blob([job.gcode],{type:'text/plain'}),job.filename);
    fd.append('root','gcodes');
    const xhr=new XMLHttpRequest();
    xhr.open('POST',printerUrl(ip,'/server/files/upload'));
    const hdrs=getPrinterAuthHeaders(id);for(const k in hdrs)xhr.setRequestHeader(k,hdrs[k]);
    xhr.onload=async()=>{
      if(xhr.status>=200&&xhr.status<300){
        try{
          const started=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(job.filename)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});
          if(!started.ok){reintentar('Cola: G-code subido, pero no se pudo iniciar ('+started.status+')');return;}
          job._starting=false;
          if(_printQueue[id]&&_printQueue[id][0]===job){_printQueue[id].shift();renderMonitorGrid();}
          toast(`▶ Cola: ${job.filename} iniciado en ${m?.nombre||id}`,'success');
          if(typeof pollPrinters==='function')pollPrinters();
        }catch(e){reintentar('Cola: G-code subido, pero START no fue confirmado');}
      }else reintentar('Cola: no se pudo subir el trabajo ('+xhr.status+')');
    };
    xhr.onerror=()=>reintentar('Cola: impresora inaccesible');
    xhr.send(fd);
  }catch(e){reintentar('Cola: '+e.message);}
}

const MONITOR_GRUPOS=[
  {key:'all',label:'Todas',color:'var(--accent)'},
  {key:'K1',label:'K1',color:'#00d4cc'},
  {key:'K2',label:'K2',color:'#a78bfa'},
  {key:'K2 Plus',label:'K2 Plus',color:'#ff6b35'},
  {key:'Ender-5 Max',label:'Ender-5 Max',color:'#ffaa00'},
  {key:'Giga',label:'Giga',color:'#ff4444'},
];

function machineHasPhysicalCfs(machine){
  if(!machine)return false;
  const id=String(machine.id||''),globalNo=Number(machine.numG??machine.num??0);
  return machine.modelo==='K2 Plus'||id==='k1-1'||(machine.modelo==='K1'&&globalNo===1);
}

function getPrinterIp(m){
  if(!m)return null;
  // La IP compartida/registry debe ganar sobre un override guardado hace meses
  // en un navegador. Un guardado manual también actualiza m.ip inmediatamente.
  return m.ip||localStorage.getItem('printer_ip_'+m.id)||null;
}
function getPrinterApiKey(id){
  const key='printer_key_'+id;
  const session=sessionStorage.getItem(key);
  if(session)return session;
  // Migración de seguridad: las claves antiguas dejan de persistir entre sesiones.
  const legacy=localStorage.getItem(key)||'';
  if(legacy){sessionStorage.setItem(key,legacy);localStorage.removeItem(key);}
  return legacy;
}
// En remoto el token va en la URL (printerUrl lo agrega): mandarlo además como
// cabecera solo añadiría el preflight que queremos evitar.
function getPrinterAuthHeaders(id){const headers={},k=getPrinterApiKey(id);if(k)headers['X-Api-Key']=k;return headers;}

function _printerInitialStatus(m){return{state:getPrinterIp(m)?'connecting':'noip',checkedAt:0,lastSeenAt:0};}
// Una impresora que no contesta en Moonraker puede estar apagada o estar
// perfectamente encendida e imprimiendo con solo la telemetría caída. Son dos
// situaciones opuestas —una no necesita nada, la otra atención inmediata— y
// antes se veían idénticas: el 2026-08-11 dos K1 imprimían TPU y aparecían como
// desenchufadas. Se distinguen sondeando la UI web de la impresora (Fluidd en
// 4408, nginx en 80): si esa contesta, la máquina está viva y lo caído es la API.
const _ALIVE_PROBE_PORTS=[4408,80];
const _ALIVE_PROBE_TTL_MS=45000;
const _ALIVE_PROBE_TIMEOUT_MS=4000;
const _aliveProbe={};
function _printerPortUrl(ip,port,path){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return`http://${ip}:${port}${path}`;
  return _appendBridgeToken(`${getPrinterTunnel()}/${ip}:${port}${path}`);
}
// El bridge marca sus propios errores con X-Bridge-Error. El 424 queda como
// respaldo para un bridge viejo que todavía no manda la cabecera, o si algo en
// el camino la borra.
function _esErrorDelBridge(r){
  if(!r)return false;
  try{ if(r.headers&&typeof r.headers.get==='function'&&r.headers.get('X-Bridge-Error'))return true; }catch(_){}
  return r.status===424;
}

// Solo se llama cuando la consulta a Moonraker YA falló, y como mucho una vez
// cada 45s por máquina: el camino normal no paga ninguna petición extra.
async function _probePrinterAlive(id,ip){
  const cached=_aliveProbe[id];
  if(cached&&cached.ip===ip&&Date.now()-cached.at<_ALIVE_PROBE_TTL_MS)return cached.port;
  let port=0;
  for(const p of _ALIVE_PROBE_PORTS){
    try{
      const r=await fetch(_printerPortUrl(ip,p,'/'),{method:'GET',cache:'no-store',signal:AbortSignal.timeout(_ALIVE_PROBE_TIMEOUT_MS)});
      // Cualquier respuesta de la propia impresora prueba que hay algo
      // escuchando, incluido un 404. Pero el bridge también contesta por su
      // cuenta cuando NO logró conectar, y eso no prueba nada: el 2026-08-19 el
      // dashboard daba por vivas cinco máquinas apagadas porque el bridge había
      // pasado de responder 502 a 424 (Cloudflare se come los 5xx) y 424 caía
      // dentro del rango que aquí se tomaba por buena señal.
      if(_esErrorDelBridge(r))continue;
      if(r&&r.status>0&&r.status<500){port=p;break;}
    }catch(_){/* puerto cerrado o inalcanzable: probamos el siguiente */}
  }
  _aliveProbe[id]={ip,port,at:Date.now()};
  return port;
}
async function _printerFetchFailure(id,ip,reason,code=0){
  const base={_fetchFail:true,ip,connectionError:reason||'No se pudo consultar la impresora',httpStatus:code||0,checkedAt:Date.now()};
  const alivePort=await _probePrinterAlive(id,ip);
  return alivePort?{...base,state:'apidown',alivePort}:{...base,state:'offline'};
}
function _emitPrinterStatus(m,status){
  if(typeof window==='undefined'||typeof window.dispatchEvent!=='function'||typeof CustomEvent==='undefined')return;
  try{window.dispatchEvent(new CustomEvent('printerstatus',{detail:{id:m.id,status}}));}catch(_){}
}
function _crealityColor(value){
  const raw=String(value||'').replace(/[^0-9a-f]/gi,'');
  return raw.length>=6?'#'+raw.slice(-6):'';
}
function _extractFilamentTelemetry(status){
  const sensor=status?.['filament_switch_sensor filament_sensor'];
  const rack=status?.filament_rack;
  const box=status?.box;
  const chamber=status?.['temperature_sensor chamber_temp'];
  const detected=typeof sensor?.filament_detected==='boolean'?sensor.filament_detected:null;
  const boxState=String(box?.state||'').toLowerCase();
  const cfsConnected=!!box&&!['','none','disconnect','disconnected'].includes(boxState)&&Number(box.enable)!==0;
  const cfsSlots=[];
  if(cfsConnected){
    ['T1','T2','T3','T4'].forEach(unit=>{
      const row=box[unit]||{};
      (Array.isArray(row.remain_len)?row.remain_len:[]).forEach((remain,index)=>{
        if(Number(remain)>=0)cfsSlots.push({slot:`${unit}${String.fromCharCode(65+index)}`,remain:Number(remain),color:_crealityColor(row.color_value?.[index]),material:String(row.material_type?.[index]||'')});
      });
    });
  }
  const rackPresent=!!rack&&Object.keys(rack).length>0;
  const temperature=Number(chamber?.temperature);
  if(detected===null&&!rackPresent&&!box&&!Number.isFinite(temperature))return null;
  return{
    detected,
    source:cfsConnected?'cfs':rackPresent?'rack':'sensor',
    cfsConnected,
    cfsEnabled:!!box&&Number(box.enable)!==0,
    cfsAutoRefill:!!box&&Number(box.auto_refill)!==0,
    cfsSlots,
    chamber:Number.isFinite(temperature)?Math.round(temperature*10)/10:null,
    color:rackPresent?_crealityColor(rack.remain_material_color||rack.color_value):'',
    materialCode:rackPresent?String(rack.remain_material_type||rack.material_type||''):'',
  };
}

function savePrinterIp(id){
  const inp=document.getElementById('ipin_'+id);const val=(inp?.value||'').trim();if(!val)return;
  if(!_validPrivatePrinterIp(val)){toast('IP inválida: usa una IPv4 privada del taller','error');return;}
  localStorage.setItem('printer_ip_'+id,val);
  const m=MAQUINAS.find(x=>x.id===id);
  if(m){m.ip=val;if(m._airtableId){if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:val}})});}}
  toast(`IP guardada · ${m?.nombre} #${m?.numG}`,'success');pollPrinters();
  if(m)connectPrinterWs(m);
}

function savePrinterApiKey(id){
  const inp=document.getElementById('ipkey_'+id);if(!inp)return;
  const val=inp.value.trim();
  const key='printer_key_'+id;
  localStorage.removeItem(key);
  if(val)sessionStorage.setItem(key,val);else sessionStorage.removeItem(key);
  const m=MAQUINAS.find(x=>x.id===id);
  toast(`API Key ${val?'guardada':'eliminada'} · ${m?.nombre} #${m?.numG}`,'success');
}

function _validPrivatePrinterIp(value){
  const m=String(value||'').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);if(!m)return false;
  const o=m.slice(1).map(Number);if(o.some(v=>v<0||v>255))return false;
  return o[0]===10||(o[0]===172&&o[1]>=16&&o[1]<=31)||(o[0]===192&&o[1]===168);
}
function _ensurePrinterPhysicalFields(id){
  const light=document.getElementById('printerConnLight');if(!light||document.getElementById('printerConnNozzle'))return;
  const wrap=document.createElement('div');wrap.className='field-group';wrap.innerHTML='<label class="field-label">Boquilla instalada (mm)</label><select class="field-select" id="printerConnNozzle"><option value="">Sin registrar</option><option>0.2</option><option>0.4</option><option>0.6</option><option>0.8</option><option>1.0</option></select><small style="color:var(--text3);font-size:10px">Se usa para bloquear un G-code preparado para otra boquilla.</small>';
  const group=light.closest('.field-group');if(group)group.insertAdjacentElement('afterend',wrap);else light.parentElement?.appendChild(wrap);
}
function openPrinterConnModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('printerConnTitle').textContent=`${m.nombre} #${m.numG}`;
  document.getElementById('printerConnId').value=id;
  document.getElementById('printerConnIp').value=getPrinterIp(m)||'';
  document.getElementById('printerConnKey').value=getPrinterApiKey(id);
  document.getElementById('printerConnLight').value=localStorage.getItem('printer_light_override_'+id)||'';
  _ensurePrinterPhysicalFields(id);
  const nozzle=document.getElementById('printerConnNozzle');if(nozzle)nozzle.value=localStorage.getItem('printer_nozzle_'+id)||m.nozzleInstalled||'';
  document.getElementById('printerConnModal').style.display='flex';
}
function closePrinterConnModal(){document.getElementById('printerConnModal').style.display='none';}
function savePrinterConn(){
  const id=document.getElementById('printerConnId').value;
  const ip=(document.getElementById('printerConnIp').value||'').trim();
  const key=(document.getElementById('printerConnKey').value||'').trim();
  const light=(document.getElementById('printerConnLight').value||'').trim();
  const nozzle=(document.getElementById('printerConnNozzle')?.value||'').trim();
  if(ip&&!_validPrivatePrinterIp(ip)){toast('IP inválida: usa una IPv4 privada del taller','error');return;}
  if(nozzle&&!['0.2','0.4','0.6','0.8','1.0'].includes(nozzle)){toast('Boquilla inválida','error');return;}
  const lightCfg=_printerLightParseOverride(light);
  if(lightCfg?.error){toast(lightCfg.error,'error');document.getElementById('printerConnLight').focus();return;}
  if(ip)localStorage.setItem('printer_ip_'+id,ip);else localStorage.removeItem('printer_ip_'+id);
  const keyName='printer_key_'+id;
  localStorage.removeItem(keyName);
  if(key)sessionStorage.setItem(keyName,key);else sessionStorage.removeItem(keyName);
  if(light)localStorage.setItem('printer_light_override_'+id,light);else localStorage.removeItem('printer_light_override_'+id);
  if(nozzle)localStorage.setItem('printer_nozzle_'+id,nozzle);else localStorage.removeItem('printer_nozzle_'+id);
  delete _printerLightCaps[id];
  const m=MAQUINAS.find(x=>x.id===id);
  if(m){m.ip=ip||null;if(m._airtableId&&hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:ip||''}})});}
  closePrinterConnModal();
  toast(`Conexión guardada · ${m?.nombre} #${m?.numG}`,'success');
  pollPrinters();
  if(m){_wsConnected[m.id]=false;connectPrinterWs(m);}
}

// Deriva el estado mostrable a partir de los objetos crudos de Moonraker
// (status = {print_stats, virtual_sdcard, heater_bed, extruder, webhooks, …}).
// Es puro/síncrono para reusarlo igual desde el polling REST y desde el WebSocket.
function _deriveStatus(m,s,ip){
  const ps=s.print_stats||{},vs=s.virtual_sdcard||{},hb=s.heater_bed||{},ex=s.extruder||{},wh=s.webhooks||{},gm=s.gcode_move||{},it=s.idle_timeout||{};
  // Estado real del firmware Klipper. Si está "shutdown"/"error" la impresora
  // dejó de imprimir y NO reporta sensores (todo 0) → hay que reiniciar el firmware.
  const klState=wh.state||'ready';
  let klMsg='';
  if(wh.state_message){
    try{const j=JSON.parse(wh.state_message);klMsg=j.msg||wh.state_message;}catch(_){klMsg=wh.state_message;}
    klMsg=String(klMsg).split('\n').map(x=>x.trim()).filter(Boolean)[0]||'';
  }
  const progressRaw=Math.max(0,Math.min(100,Number(vs.progress||0)*100)),progress=Math.round(progressRaw);
  const elapsed=ps.print_duration||0;
  const eta=progress>0&&progress<100?Math.round(elapsed/progress*(100-progress)):0;
  const filename=(ps.filename||'').replace(/\.gcode$/i,'');
  const filamentMm=Math.round(ps.filament_used||0);
  // Klipper caído o iniciando manda sobre el estado del print.
  // Sin print_stats.state NO se asume "libre": la ausencia de telemetría se
  // muestra como desconocida (si no, una lectura incompleta se ve verde/OK y
  // el planificador la toma como disponible).
  let state=ps.state||'unknown';
  if(klState==='shutdown'||klState==='error')state='shutdown';
  else if(klState==='startup')state='startup';
  const light=_printerLightApplyStatus(m.id,s);
  const busyPrint=state==='printing'||state==='paused';
  const busyGcode=!busyPrint&&!['shutdown','error','startup'].includes(klState)&&String(it.state||'').toLowerCase()==='printing';
  const seen=Date.now();
  return{state,klState,klMsg,progress,progressRaw,filename,filamentMm,busyGcode,idleTimeoutState:String(it.state||''),hotend:{actual:Math.round(ex.temperature||0),target:Math.round(ex.target||0)},bed:{actual:Math.round(hb.temperature||0),target:Math.round(hb.target||0)},speedFactor:Math.round(Number(gm.speed_factor||1)*100),flowFactor:Math.round(Number(gm.extrude_factor||1)*100),elapsed,eta,ip,filament:_extractFilamentTelemetry(s),updatedAt:seen,lastSeenAt:seen,checkedAt:seen,light:light?.available?{available:true,on:!!light.on}:null};
}
// Miniatura del trabajo en curso (cacheada por archivo). Devuelve la URL o null.
async function _ensureThumb(m,ip,st){
  if(!((st.state==='printing'||st.state==='paused')&&st.filename))return st.thumbUrl||null;
  const ck=m.id+'::'+st.filename;
  if(_thumbCache[ck]!==undefined)return _thumbCache[ck];
  let thumbUrl=null;
  try{
    const tr=await fetch(printerUrl(ip,`/server/files/thumbnails?filename=${encodeURIComponent(st.filename+'.gcode')}`),{signal:AbortSignal.timeout(_THUMB_TIMEOUT_MS),headers:getPrinterAuthHeaders(m.id)});
    if(tr.ok){const td=await tr.json();const best=(td.result||[]).sort((a,b)=>b.size-a.size)[0];thumbUrl=best?printerMediaUrl(ip,`/server/files/gcodes/.thumbnails/${best.relative_path}`):null;}
  }catch(e){}
  _thumbCache[ck]=thumbUrl;
  return thumbUrl;
}
async function fetchPrinterStatus(m){
  const ip=getPrinterIp(m);if(!ip)return{state:'noip'};
  const headers=getPrinterAuthHeaders(m.id),remote=_printerUsesRemoteTunnel();
  try{
    const objects=['print_stats','heater_bed','extruder','display_status','virtual_sdcard','webhooks','gcode_move','idle_timeout'];
    if(machineHasPhysicalCfs(m))objects.push('filament_switch_sensor filament_sensor','temperature_sensor chamber_temp','filament_rack','box');
    const path='/printer/objects/query?'+objects.map(encodeURIComponent).join('&')+_printerLightQuerySuffix(m.id);
    const timeout=remote?_REMOTE_STATUS_TIMEOUT_MS:_STATUS_TIMEOUT_MS;
    const r=await fetch(printerUrl(ip,path),{signal:AbortSignal.timeout(timeout),headers});
    if(!r.ok){
      const reason=r.status===401?'Token del bridge inválido o vencido':(r.status===424||r.status===502)?'La impresora no responde al bridge':r.status===404?'Moonraker no está disponible en esta IP':`La consulta respondió HTTP ${r.status}`;
      // Bridge moderno usa 424 cuando él sí está vivo pero no alcanza la
      // impresora. Un bridge antiguo usaba 502. Si aún vemos ese 502 remoto,
      // contrastamos primero con la salud central y /healthz: así mantenemos
      // compatibilidad sin confundir un 502 de Cloudflare con una máquina caída.
      if(remote&&r.status===502){
        const central=_centralFarmMachineEvidence(m.id);
        if(central?.online===true||!(await _remoteBridgeReachable()))return _remotePathFailure(ip,reason,r.status);
      }
      if(remote&&(r.status===401||r.status===403||r.status===408||r.status===429||(r.status>=500&&r.status!==502)))return _remotePathFailure(ip,reason,r.status);
      return _printerFetchFailure(m.id,ip,reason,r.status);
    }
    const d=await r.json();const s=d.result?.status||{};
    const st=_deriveStatus(m,s,ip);
    st.thumbUrl=await _ensureThumb(m,ip,st);
    return st;
  }catch(e){
    const reason=e?.name==='TimeoutError'||e?.name==='AbortError'?'Tiempo de espera agotado al consultar Moonraker':'No se pudo alcanzar Moonraker';
    if(remote){
      const central=_centralFarmMachineEvidence(m.id);
      if(central?.online===true)return _remotePathFailure(ip,'Intermitencia remota: el Farm Controller confirma la impresora en línea');
      if(!(await _remoteBridgeReachable()))return _remotePathFailure(ip,'Intermitencia del túnel/bridge remoto');
    }
    return _printerFetchFailure(m.id,ip,reason);
  }
}

// ── Estado en vivo por WebSocket (Moonraker) ──────────────────────────────
// Moonraker empuja notify_status_update por /websocket (lo mismo que usan
// Fluidd/Mainsail). En remoto el bridge hace de proxy WS. Esto da estado en
// tiempo real SIN sondear; si el WS se cae, el polling toma el relevo solo.
// Desactivable con localStorage 'printer_ws_enabled'='0'.
function _wsEnabled(){
  if(window._DEMO_MODE||typeof WebSocket==='undefined')return false;
  const ov=localStorage.getItem('printer_ws_enabled');if(ov!==null)return ov!=='0';
  if(typeof _isLocalMode==='function'&&_isLocalMode())return true;
  return !!getPrinterTunnelToken();
}
function _wsFresh(id,now=Date.now()){return !!_wsConnected[id]&&!!_wsLastMessage[id]&&now-_wsLastMessage[id]<_WS_STALE_MS;}
function _printerWsUrl(ip){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return `ws://${ip}:${MOONRAKER_PORT}/websocket`;
  const base=getPrinterTunnel().replace(/^http/,'ws');   // https→wss, http→ws
  const tk=getPrinterTunnelToken();
  return `${base}/${ip}/websocket`+(tk?`?bt=${encodeURIComponent(tk)}`:'');
}
function _wsScheduleRender(){
  if(_wsRenderTimer)return;   // agrupa ráfagas de updates en un solo render
  _wsRenderTimer=setTimeout(()=>{
    _wsRenderTimer=null;
    if(document.hidden)return;
    if(!document.getElementById('tab-maquinas')?.classList.contains('active'))return;  // no renderizar una sección inactiva
    renderMonitorKPIs();renderMonitorGrid();
  },500);
}
function _wsMergeStatus(m,ip,status){
  if(window._DEMO_MODE)return;
  const raw=_wsRaw[m.id]||(_wsRaw[m.id]={});
  for(const k in status){
    if(status[k]&&typeof status[k]==='object'&&!Array.isArray(status[k]))raw[k]={...(raw[k]||{}),...status[k]};
    else raw[k]=status[k];
  }
  _wsConnected[m.id]=true;_failCount[m.id]=0;_nextPollAt[m.id]=0;_wsAttempts[m.id]=0;
  const st=_deriveStatus(m,raw,ip);
  st.thumbUrl=(_printerStatus[m.id]||{}).thumbUrl||null;
  checkTransitions(m,st);
  _printerStatus[m.id]=st;
  _emitPrinterStatus(m,st);
  if(st.hotend){if(!_tempHistory[m.id])_tempHistory[m.id]=[];_tempHistory[m.id].push({h:st.hotend.actual,b:st.bed?.actual||0});if(_tempHistory[m.id].length>20)_tempHistory[m.id].shift();}
  _ensureThumb(m,ip,st).then(t=>{if(t&&_printerStatus[m.id]&&_printerStatus[m.id].thumbUrl!==t){_printerStatus[m.id].thumbUrl=t;_wsScheduleRender();}});
  _wsScheduleRender();
}
function connectPrinterWs(m){
  if(!_wsEnabled())return;
  const ip=getPrinterIp(m);if(!ip||typeof WebSocket==='undefined')return;
  const current=_wsConn[m.id];
  if(current&&current.__printerIp===ip&&(current.readyState===WebSocket.OPEN||current.readyState===WebSocket.CONNECTING))return;
  if(current){try{current.onclose=null;current.close();}catch(e){}}
  clearTimeout(_wsOpenTimers[m.id]);
  let ws;
  try{ws=new WebSocket(_printerWsUrl(ip));}catch(e){_scheduleWsReconnect(m);return;}
  ws.__printerIp=ip;_wsConn[m.id]=ws;
  _wsOpenTimers[m.id]=setTimeout(()=>{
    if(_wsConn[m.id]===ws&&ws.readyState!==WebSocket.OPEN){try{ws.close();}catch(e){}}
  },_WS_OPEN_TIMEOUT_MS);
  ws.onopen=()=>{
    clearTimeout(_wsOpenTimers[m.id]);delete _wsOpenTimers[m.id];
    _wsAttempts[m.id]=0;_wsLastMessage[m.id]=Date.now();
    try{ws.send(JSON.stringify({jsonrpc:'2.0',method:'printer.objects.subscribe',params:{objects:_printerLightWsObjects(m.id)},id:++_wsRpcId}));}catch(e){}
  };
  ws.onmessage=ev=>{
    _wsLastMessage[m.id]=Date.now();
    let msg;try{msg=JSON.parse(ev.data);}catch(e){return;}
    let status=null;
    if(msg.result&&msg.result.status)status=msg.result.status;
    else if(msg.method==='notify_status_update'&&Array.isArray(msg.params))status=msg.params[0];
    if(status&&typeof status==='object')_wsMergeStatus(m,ip,status);
  };
  ws.onerror=()=>{try{ws.close();}catch(e){}};
  ws.onclose=()=>{
    clearTimeout(_wsOpenTimers[m.id]);delete _wsOpenTimers[m.id];
    if(_wsConn[m.id]===ws)_wsConn[m.id]=null;
    _wsConnected[m.id]=false;
    _scheduleWsReconnect(m);
  };
}
function _scheduleWsReconnect(m){
  if(!_wsEnabled())return;
  const n=(_wsAttempts[m.id]=(_wsAttempts[m.id]||0)+1);
  const delay=Math.min(30000,1000*Math.pow(2,Math.min(n,5)))+Math.floor(Math.random()*1000);
  clearTimeout(_wsTimers[m.id]);
  _wsTimers[m.id]=setTimeout(()=>{if(getPrinterIp(m))connectPrinterWs(m);},delay);
}
function connectAllPrinterWs(){
  if(!_wsEnabled())return;
  const liveIds=new Set(MAQUINAS.map(m=>m.id));
  Object.keys(_wsConn).forEach(id=>{
    if(liveIds.has(id))return;
    clearTimeout(_wsTimers[id]);clearTimeout(_wsOpenTimers[id]);
    const ws=_wsConn[id];if(ws){try{ws.onclose=null;ws.close();}catch(e){}}
    delete _wsConn[id];delete _wsConnected[id];delete _wsRaw[id];delete _wsLastMessage[id];delete _wsLastProbe[id];
  });
  MAQUINAS.forEach(m=>{if(getPrinterIp(m))connectPrinterWs(m);});
}
function disconnectAllPrinterWs(){
  MAQUINAS.forEach(m=>{
    clearTimeout(_wsTimers[m.id]);clearTimeout(_wsOpenTimers[m.id]);
    const ws=_wsConn[m.id];if(ws){try{ws.onclose=null;ws.close();}catch(e){}}
    _wsConn[m.id]=null;_wsConnected[m.id]=false;_wsRaw[m.id]=null;_wsAttempts[m.id]=0;
    _wsLastMessage[m.id]=0;_wsLastProbe[m.id]=0;
  });
}
function reconnectAllPrinterWs(){disconnectAllPrinterWs();connectAllPrinterWs();}
function _printerWsHeartbeat(){
  if(!_wsEnabled())return;
  const now=Date.now();
  MAQUINAS.forEach(m=>{
    const ip=getPrinterIp(m);if(!ip)return;
    const ws=_wsConn[m.id];
    if(!ws||ws.readyState===WebSocket.CLOSED||ws.readyState===WebSocket.CLOSING){connectPrinterWs(m);return;}
    if(ws.readyState!==WebSocket.OPEN)return;
    if(_wsLastMessage[m.id]&&now-_wsLastMessage[m.id]>=_WS_STALE_MS){
      _wsConnected[m.id]=false;
      try{ws.close();}catch(e){}
      return;
    }
    if(now-(_wsLastProbe[m.id]||0)>=_WS_HEARTBEAT_MS){
      _wsLastProbe[m.id]=now;
      try{ws.send(JSON.stringify({jsonrpc:'2.0',method:'printer.objects.query',params:{objects:{webhooks:null,print_stats:null,virtual_sdcard:null}},id:++_wsRpcId}));}
      catch(e){try{ws.close();}catch(_){}}
    }
  });
}
function _resumePrinterRealtime(){
  if(window._DEMO_MODE)return;
  refreshPrinterTunnelSession(false).then(ok=>{if(ok){try{reconnectAllPrinterWs();_refreshSnapshotCams(true);}catch(_){}}}).catch(()=>{});
  try{pollPrinters();}catch(e){}
  try{connectAllPrinterWs();_printerWsHeartbeat();}catch(e){}
  try{_refreshSnapshotCams(true);}catch(e){}
  try{window.FarmHealth?.refresh?.(true);}catch(e){}
  try{window.FarmRegistry?.sync?.(true);window.FarmQueue?.sync?.(true);}catch(e){}
}
function ensurePrinterRealtimeService(){
  refreshPrinterTunnelSession(false).catch(()=>{});
  if(!_monitorInterval){pollPrinters();_monitorInterval=setInterval(pollPrinters,_MONITOR_INTERVAL_MS);}
  if(!_wsHeartbeatTimer)_wsHeartbeatTimer=setInterval(_printerWsHeartbeat,_WS_HEARTBEAT_MS);
  if(!_camSnapInterval)_camSnapInterval=setInterval(()=>_refreshSnapshotCams(false),10000);
  if(!_camHealthInterval){_cameraHealthSweep();_camHealthInterval=setInterval(_cameraHealthSweep,_CAM_HEALTH_INTERVAL_MS);}
  connectAllPrinterWs();_printerWsHeartbeat();
  if(!_printerLifecycleBound){
    _printerLifecycleBound=true;
    window.addEventListener('focus',_resumePrinterRealtime);
    window.addEventListener('online',_resumePrinterRealtime);
    document.addEventListener('visibilitychange',()=>{_cameraPageVisibility();if(!document.hidden)_resumePrinterRealtime();});
  }
}
function fmtSecs(s){if(!s||s<=0)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;}
function fmtPrinterSeen(ts){
  const age=Math.max(0,Date.now()-Number(ts||0));if(!ts)return'Sin lectura previa';
  if(age<15000)return'Actualizado ahora';
  const min=Math.floor(age/60000);if(min<60)return`Última lectura hace ${Math.max(1,min)} min`;
  const h=Math.floor(min/60);return`Última lectura hace ${h} h`;
}

// print_stats solo describe trabajos del virtual SD. Una calibración, HOME o
// macro puede mover físicamente la impresora mientras print_stats sigue en
// standby. Esta capa evita mostrar "libre" cuando existe actividad real.
function _printerEffectiveState(id,state,status=null){
  const raw=String(state||status?.state||'unknown');
  if(['shutdown','error','offline','noip','apidown','connecting','startup'].includes(raw))return raw;
  let calibrating=false;
  try{calibrating=!!_bedLevelRuns?.[id]?.active;}catch(_){}
  if(calibrating)return'calibrating';
  if(status?.busyGcode)return'gcode';
  return raw;
}

function printerStateMeta(state){
  return({
    connecting:{label:'Conectando…',color:'#38bdf8',bg:'rgba(56,189,248,0.12)'},
    printing:{label:'Imprimiendo',color:'#fb923c',bg:'rgba(251,146,60,0.15)'},
    paused:{label:'Pausado',color:'#ffaa00',bg:'rgba(255,170,0,0.15)'},
    calibrating:{label:'Calibrando',color:'#ffaa00',bg:'rgba(255,170,0,0.15)'},
    gcode:{label:'Ejecutando G-code',color:'#a78bfa',bg:'rgba(167,139,250,0.14)'},
    error:{label:'Error',color:'#ff4444',bg:'rgba(255,68,68,0.15)'},
    complete:{label:'Impresión finalizada',color:'#34d399',bg:'rgba(52,211,153,0.15)'},
    cancelled:{label:'Impresión cancelada',color:'#ffaa00',bg:'rgba(255,170,0,0.12)'},
    standby:{label:'En línea · libre',color:'var(--accent3)',bg:'rgba(0,212,170,0.08)'},
    idle:{label:'En línea · libre',color:'var(--accent3)',bg:'rgba(0,212,170,0.08)'},
    unknown:{label:'Estado de impresión desconocido',color:'#ffaa00',bg:'rgba(255,170,0,0.12)'},
    shutdown:{label:'⚠ Detenida',color:'#ff4444',bg:'rgba(255,68,68,0.15)'},
    startup:{label:'Iniciando…',color:'#ffaa00',bg:'rgba(255,170,0,0.12)'},
    offline:{label:'Sin conexión',color:'#888',bg:'rgba(120,120,120,0.12)'},
    apidown:{label:'Telemetría caída',color:'#ffaa00',bg:'rgba(255,170,0,0.12)'},
    noip:{label:'Sin IP',color:'#ff6b35',bg:'rgba(255,107,53,0.12)'},
  }[state])||{label:state,color:'var(--text3)',bg:'var(--surface2)'};
}

function renderSparkline(readings,key,color){
  if(!readings||readings.length<2)return'';
  const vals=readings.map(r=>r[key]||0);
  const max=Math.max(...vals,50),min=Math.max(0,Math.min(...vals)-10),range=max-min||1;
  const W=110,H=22;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*W},${H-((v-min)/range)*H}`).join(' ');
  return`<svg width="${W}" height="${H}" style="overflow:visible;display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/></svg>`;
}

function renderMonitorFilterTabs(){
  const el=document.getElementById('monitorFilterTabs');if(!el)return;
  const chips=MONITOR_GRUPOS.map(g=>{
    const active=_monitorFilter===g.key;
    const count=g.key==='all'?MAQUINAS.length:MAQUINAS.filter(m=>m.modelo===g.key).length;
    return`<button onclick="filterMonitor('${g.key}')" style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;border:1px solid ${active?g.color:'var(--border2)'};background:${active?g.color+'22':'var(--surface2)'};color:${active?g.color:'var(--text3)'};font-size:12px;font-weight:${active?700:500};cursor:pointer;transition:all 0.15s">${g.label}<span style="background:${active?g.color+'33':'var(--surface3)'};border-radius:10px;padding:1px 6px;font-size:10.5px;font-weight:700">${count}</span></button>`;
  }).join('');
  const opt=(value,label)=>`<option value="${value}"${_monitorSortMode===value?' selected':''}>${label}</option>`;
  el.innerHTML=chips+`<label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--text3);white-space:nowrap">Ordenar
    <select id="monitorSortSelect" onchange="setMonitorSort(this.value)" style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text2);padding:5px 8px;font-size:11px;cursor:pointer">
      ${opt('camera_model','Cámara con señal → sin señal · modelo')}
      ${opt('model','Modelo')}
      ${opt('state','Estado / prioridad')}
      ${opt('original','Orden registrado')}
    </select>
  </label>`;
}

function filterMonitor(grupo){_monitorFilter=grupo;renderMonitorFilterTabs();renderMonitorKPIs();renderMonitorGrid();}

function renderMonitorKPIs(){
  const el=document.getElementById('monitorKPIs');if(!el)return;
  const lista=_monitorFilter==='all'?MAQUINAS:MAQUINAS.filter(m=>m.modelo===_monitorFilter);
  let printing=0,paused=0,calibrating=0,gcode=0,idle=0,error=0,down=0,offline=0,noip=0,connecting=0,apidown=0;
  lista.forEach(m=>{
    const status=_printerStatus[m.id]||_printerInitialStatus(m),st=_printerEffectiveState(m.id,status.state,status);
    if(st==='printing')printing++;else if(st==='paused')paused++;else if(st==='calibrating')calibrating++;else if(st==='gcode')gcode++;else if(st==='error')error++;else if(st==='shutdown')down++;else if(st==='noip')noip++;else if(st==='apidown')apidown++;else if(st==='offline')offline++;else if(st==='connecting')connecting++;else idle++;
  });
  const total=lista.length,utilPct=total>0?Math.round((printing+paused+calibrating+gcode)/total*100):0;
  el.innerHTML=`<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border:1px solid var(--border2);border-radius:10px;font-size:12px">
    ${printing>0?`<span style="color:#00d4aa;font-weight:700">🟢 ${printing} Imprimiendo</span>`:''}
    ${paused>0?`<span style="color:#ffaa00;font-weight:700">⏸ ${paused} Pausado</span>`:''}
    ${calibrating>0?`<span style="color:#ffaa00;font-weight:700">📐 ${calibrating} Calibrando</span>`:''}
    ${gcode>0?`<span style="color:#a78bfa;font-weight:700">⚙ ${gcode} Ejecutando G-code</span>`:''}
    ${idle>0?`<span style="color:var(--accent3)">⚪ ${idle} En línea · libres</span>`:''}
    ${connecting>0?`<span style="color:#38bdf8">◌ ${connecting} Conectando</span>`:''}
    ${error>0?`<span style="color:#ff4444;font-weight:700">🔴 ${error} Error</span>`:''}
    ${down>0?`<span style="color:#ff4444;font-weight:700">⚠ ${down} Detenida${down>1?'s':''} (Klipper)</span>`:''}
    ${apidown>0?`<span style="color:#ffaa00;font-weight:700">📡 ${apidown} Telemetría caída</span>`:''}
    ${offline>0?`<span style="color:#888">⚫ ${offline} Sin conexión</span>`:''}
    ${noip>0?`<span style="color:#ff6b35">❓ ${noip} Sin IP</span>`:''}
    <span style="margin-left:auto;font-weight:700;color:${utilPct>0?'#00d4aa':'var(--text3)'}">Utilización ${utilPct}%</span>
  </div>`;
  try{renderMaqOcupacion();}catch(e){}
}

// ── OCUPACIÓN DE MÁQUINAS ──────────────────────────────────────
// Línea de tiempo por impresora con la telemetría viva del bridge: qué imprime
// cada una y a qué hora queda libre (ETA real). Para prometer fechas de entrega
// con datos, no con intuición. Se refresca junto con los KPIs del monitor.
function renderMaqOcupacion(){
  const el=document.getElementById('maqOcupacion');if(!el)return;
  const lista=_monitorFilter==='all'?MAQUINAS:MAQUINAS.filter(m=>m.modelo===_monitorFilter);
  if(!lista.length){el.style.display='none';return;}
  const clasif=st=>st==='printing'?'print':st==='paused'?'paused':st==='calibrating'?'calibrating':st==='gcode'?'gcode':(st==='error'||st==='shutdown'||st==='apidown')?'error':(st==='offline'||st==='noip')?'off':st==='connecting'?'connecting':'idle';
  const rows=lista.map(m=>{const s=_printerStatus[m.id]||_printerInitialStatus(m),effective=_printerEffectiveState(m.id,s.state,s);return{m,s,k:clasif(effective),effective,eta:(s.state==='printing'&&s.eta>0)?s.eta:0};});
  const etas=rows.filter(r=>r.eta>0).map(r=>r.eta);
  const horizon=Math.max(4*3600,Math.min(12*3600,etas.length?Math.max(...etas)*1.15:4*3600));
  const libres=rows.filter(r=>r.k==='idle').length;
  const imprimiendo=rows.filter(r=>r.k==='print').length;
  const calibrando=rows.filter(r=>r.k==='calibrating').length;
  const ejecutando=rows.filter(r=>r.k==='gcode').length;
  const hhmm=seg=>new Date(Date.now()+seg*1000).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  const proxima=etas.length?hhmm(Math.min(...etas)):null;
  // Eje: marcas de hora sobre el horizonte
  const marks=[];const stepH=horizon>6*3600?2:1;
  for(let hh=stepH;hh*3600<horizon;hh+=stepH) marks.push(`<span style="position:absolute;left:${(hh*3600/horizon*100).toFixed(1)}%;transform:translateX(-50%);font-size:10px;color:var(--text3)">+${hh}h</span>`);
  // La columna del nombre se encoge en pantallas chicas: fija en 158px tapaba
  // la barra en el teléfono. El eje de horas de abajo usa el mismo ancho + 23px
  // (el punto de estado y los dos gaps) para no desalinearse.
  const nameW='clamp(84px,26vw,158px)';
  const fila=r=>{
    const nom=`${escapeHtml(r.m.nombre||'—')} <span style="color:var(--text3)">#${r.m.numG||r.m.num||''}</span>`;
    let bar='',lbl='';
    if(r.k==='print'&&r.eta>0){
      const w=Math.min(100,r.eta/horizon*100).toFixed(1);
      const pct=(typeof r.s.progress==='number'&&r.s.progress>=0)?Math.round(r.s.progress<=1?r.s.progress*100:r.s.progress):null;
      // La etiqueta ya no vive DENTRO de la barra: cuando la barra era angosta,
      // el texto (más ancho que ella) se desbordaba a la izquierda y se encimaba
      // sobre el nombre. Ahora es una pastilla fija al borde derecho de la pista,
      // con fondo propio para leerse igual sobre la barra o sobre el fondo vacío.
      const txt=`${pct!=null?pct+'% · ':''}libre ${hhmm(r.eta)}`;
      bar=`<div title="${escapeHtml(r.s.filename||'Imprimiendo')}${pct!=null?' · '+pct+'%':''}" style="height:100%;width:${w}%;background:linear-gradient(90deg,#00d4aa,#00d4cc);border-radius:5px;min-width:6px"></div>`
        +`<span style="position:absolute;right:5px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:700;color:#00d4cc;white-space:nowrap;background:rgba(4,18,26,0.82);border:1px solid rgba(0,212,204,0.35);border-radius:4px;padding:0 4px;pointer-events:none">${txt}</span>`;
      lbl=`<span style="color:#00d4aa">🟢</span>`;
    }else if(r.k==='print'){
      bar=`<div title="Imprimiendo — sin ETA del bridge" style="height:100%;width:100%;background:repeating-linear-gradient(45deg,rgba(0,212,170,0.5),rgba(0,212,170,0.5) 8px,rgba(0,212,170,0.25) 8px,rgba(0,212,170,0.25) 16px);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#04121a">en curso · sin ETA</span></div>`;
      lbl=`<span style="color:#00d4aa">🟢</span>`;
    }else if(r.k==='paused'){
      bar=`<div style="height:100%;width:45%;background:rgba(255,170,0,0.6);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#1a1206">⏸ en pausa</span></div>`;
      lbl=`<span style="color:#ffaa00">⏸</span>`;
    }else if(r.k==='calibrating'){
      bar=`<div style="height:100%;width:100%;background:rgba(255,170,0,.14);border:1px dashed rgba(255,170,0,.55);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:800;color:#ffaa00">📐 calibrando cama</span></div>`;
      lbl=`<span style="color:#ffaa00">📐</span>`;
    }else if(r.k==='gcode'){
      bar=`<div style="height:100%;width:100%;background:rgba(167,139,250,.12);border:1px dashed rgba(167,139,250,.45);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:800;color:#a78bfa">⚙ ejecutando G-code</span></div>`;
      lbl=`<span style="color:#a78bfa">⚙</span>`;
    }else if(r.k==='error'){
      bar=`<div style="height:100%;width:100%;background:rgba(255,68,68,0.14);border:1px dashed rgba(255,68,68,0.5);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:var(--danger)">⚠ con falla — revisar</span></div>`;
      lbl=`<span style="color:var(--danger)">🔴</span>`;
    }else if(r.k==='connecting'){
      bar=`<div style="height:100%;width:100%;background:rgba(56,189,248,.08);border:1px dashed rgba(56,189,248,.35);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;color:#38bdf8">consultando telemetría…</span></div>`;
      lbl=`<span style="color:#38bdf8">◌</span>`;
    }else if(r.k==='off'){
      bar=`<div style="height:100%;width:100%;background:var(--surface3);border-radius:5px;display:flex;align-items:center;padding-left:8px;opacity:.55"><span style="font-size:10px;color:var(--text3)">sin conexión</span></div>`;
      lbl=`<span style="color:var(--text3)">⚫</span>`;
    }else{
      bar=`<div style="height:100%;width:100%;background:rgba(0,212,170,0.08);border:1px dashed rgba(0,212,170,0.35);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:10px;font-weight:700;color:#00d4aa">✓ libre ahora</span></div>`;
      lbl=`<span style="color:#00d4aa">⚪</span>`;
    }
    return`<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
      <span style="flex-shrink:0;width:14px;text-align:center;font-size:12px">${lbl}</span>
      <span style="flex-shrink:0;width:${nameW};font-size:11.5px;font-weight:600;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nom}</span>
      <div style="flex:1;min-width:0;height:20px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px;position:relative;overflow:hidden">${bar}</div>
    </div>`;
  };
  // Dentro de cada tipo: primero las libres, luego las que imprimen por hora de
  // liberación, y al final las desconectadas.
  const cmp=(a,b)=>(a.eta||(a.k==='idle'?-1:1e9))-(b.eta||(b.k==='idle'?-1:1e9));
  // Agrupadas por modelo, en un orden fijo del parque; un modelo desconocido
  // cae al final por nombre.
  const MODORDER=['K1','K2','K2 Plus','Ender-5 Max','Giga'];
  const groups={};
  rows.forEach(r=>{const g=r.m.modelo||'Otras';(groups[g]||(groups[g]=[])).push(r);});
  const gkeys=Object.keys(groups).sort((a,b)=>{
    const ia=MODORDER.indexOf(a),ib=MODORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);
  });
  const multiGrupo=gkeys.length>1;
  const cuerpo=gkeys.map(g=>{
    const items=groups[g].slice().sort(cmp).map(fila).join('');
    if(!multiGrupo)return items;   // ya filtrado a un solo tipo: sin encabezado
    const col=groups[g][0].m.color||'var(--text3)';
    return`<div style="display:flex;align-items:center;gap:6px;margin:11px 0 5px">
      <span style="width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0"></span>
      <span style="font-size:10.5px;font-weight:700;color:var(--text2);letter-spacing:.02em">${escapeHtml(g)}</span>
      <span style="font-size:10px;color:var(--text3)">${groups[g].length}</span>
    </div>`+items;
  }).join('');
  el.style.display='';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:var(--text)">⏱️ Ocupación de máquinas</span>
      <span style="font-size:10.5px;color:var(--text3)">${libres} libre${libres!==1?'s':''} ahora · ${imprimiendo} imprimiendo${calibrando?' · '+calibrando+' calibrando':''}${ejecutando?' · '+ejecutando+' ejecutando G-code':''}${proxima?' · próxima máquina libre ~'+proxima:''}</span>
    </div>
    <div style="position:relative;height:12px;margin:0 0 4px calc(${nameW} + 23px)">${marks.join('')}</div>
    ${cuerpo}`;
}

function renderMonitorGrid(){
  const el=document.getElementById('maquinaMonGrid');if(!el)return;
  // Las tarjetas permanecen montadas aunque un filtro las oculte: las cámaras
  // no se reinician al cambiar K1/K2/Ender/Todas.
  const lista=sortedList(MAQUINAS);
  const __cards=lista.map(m=>{
    const visible=_monitorFilter==='all'||m.modelo===_monitorFilter;
    const s=_printerStatus[m.id]||_printerInitialStatus(m);
    const effectiveState=_printerEffectiveState(m.id,s.state,s);
    const sm=printerStateMeta(effectiveState);
    const ip=getPrinterIp(m);
    const _rawCam=_printerCamRaw(m.id);
    const _gridCamRaw=_printerGridCamRaw(m.id);
    const _camU=_gridCamRaw?_printerCamUrlFromRaw(_gridCamRaw):'';
    const _camSnap=_camIsSnapshot(_gridCamRaw);
    const img=MODELO_IMGS[m.modelo]||'';
    const isPrinting=s.state==='printing';
    const isPaused=s.state==='paused';
    const isCalibrating=effectiveState==='calibrating';
    const isGcode=effectiveState==='gcode';
    const isActive=isPrinting||isPaused||isCalibrating||isGcode;
    const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);
    const hist=getHistoryForPrinter(m.id);
    const th=_tempHistory[m.id]||[];
    const maintAlerts=getMaintAlerts(m);
    const idleHours=getIdleHours(m.id,s.state);
    const idleWarn=idleHours>0;
    // La cámara se monta en un nodo aparte y persistente (no se recrea en cada
    // ciclo) para que el stream no parpadee. camKey cambia solo si cambia la URL.
    // Cámara y Moonraker son canales independientes. Mantener la cámara viva
    // incluso con telemetría caída permite verificar físicamente la impresión.
    const showCam=!!_rawCam;
    const camKey=showCam?(_camU+'|'+(_camSnap?'s':'m')):'';
    // Huella estructural: SOLO lo que cambia qué ramas se dibujan. Excluye
    // progreso/eta/temperaturas (se parchean en vivo) → la tarjeta no se
    // reconstruye cada 15s mientras imprime, evitando el parpadeo.
    const structFP=[visible?1:0,s.state,effectiveState,s.stale?1:0,s.filename||'',s.thumbUrl?1:0,isActive?1:0,isPrinting?1:0,isPaused?1:0,isCalibrating?1:0,isGcode?1:0,s.hotend?.target||0,s.bed?.target||0,maintAlerts.length,idleWarn?1:0,idleHours,ip||'',getPrinterApiKey(m.id)?1:0,_queueCount(m.id),hist.length,(_rawCam?1:0),(th.length>=2?1:0),_printerLightFingerprint(m.id)].join('~');

    let body='';
    if(s.state==='connecting'){
      body=`<div class="printer-connecting" style="margin-top:12px;text-align:center;color:#38bdf8;font-size:12px;padding:16px 8px"><span class="printer-connecting-dot">◌</span><br><b>Consultando telemetría…</b><br><span style="font-family:monospace;font-size:10.5px;color:var(--text3)">${ip}</span></div>`;
    } else if(s.state==='noip'){
      body=`<div style="margin-top:10px">
        <div style="font-size:10.5px;color:var(--text3);margin-bottom:6px;font-weight:600">Conexión OrcaSlicer / Moonraker</div>
        <div style="display:flex;gap:6px;margin-bottom:6px"><input id="ipin_${m.id}" type="text" placeholder="IP  192.168.100.xxx" style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;font-family:monospace;min-width:0">
        <button onclick="savePrinterIp('${m.id}')" style="background:var(--accent);color:#000;border:none;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0">OK</button></div>
        <div style="display:flex;gap:6px"><input id="ipkey_${m.id}" type="password" placeholder="API Key (opcional)" value="${getPrinterApiKey(m.id)}" style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;font-family:monospace;min-width:0">
        <button onclick="savePrinterApiKey('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;flex-shrink:0;color:var(--text3)">Key</button></div>
      </div>`;
    } else if(s.state==='apidown'){
      // La máquina contesta en su UI web pero no en Moonraker. NO es lo mismo
      // que estar apagada: puede estar imprimiendo ahora mismo.
      const uiPort=s.alivePort||_ALIVE_PROBE_PORTS[0];
      const svc=m.modelo==='K1'?'/etc/init.d/S56moonraker_service restart':'/etc/init.d/moonraker restart';
      body=`<div style="margin-top:10px;padding:10px;background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.3);border-radius:8px">
        <div style="font-size:12px;color:#ffaa00;font-weight:700;margin-bottom:4px">📡 Telemetría caída · la máquina está viva</div>
        <div style="font-size:10.5px;color:var(--text3);margin-bottom:6px;line-height:1.45">Responde en el puerto ${uiPort} pero Moonraker no contesta. <b style="color:var(--text2)">Puede estar imprimiendo sin que el dashboard lo vea</b> — revísala antes de darla por libre.</div>
        <button id="recov_${m.id}" onclick="recoverPrinterTelemetry('${m.id}')" style="width:100%;background:rgba(255,170,0,0.18);border:1px solid rgba(255,170,0,0.5);color:#ffaa00;border-radius:7px;padding:7px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:6px">🔧 Recuperar telemetría</button>
        <div class="op-expert-only" style="font-size:10px;color:var(--text3);margin-bottom:8px;line-height:1.4">Reinicia Moonraker desde el bridge del taller. No interrumpe la impresión en curso.<br>A mano, por SSH: <span style="font-family:monospace;color:var(--text2)">ssh root@${ip} '${escapeHtml(svc)}'</span></div>
        <a href="${escapeHtml(_printerPortUrl(ip,uiPort,'/'))}" target="_blank" rel="noopener" style="display:block;text-align:center;background:var(--surface2);border:1px solid var(--border2);color:var(--text3);border-radius:7px;padding:7px;font-size:12px;font-weight:700;text-decoration:none">🔎 Abrir la impresora</a>
      </div>`;
    } else if(s.state==='offline'){
      body=`<div style="margin-top:12px;text-align:center;color:var(--text3);font-size:12px;padding:8px 0"><b>Sin telemetría</b><br><span style="font-family:monospace;font-size:10.5px">${ip}</span><br><span style="font-size:10.5px">${escapeHtml(s.connectionError||'La impresora no respondió')}</span><br><span style="font-size:10px;color:#777">${escapeHtml(fmtPrinterSeen(s.lastSeenAt))}</span></div>`;
    } else if(s.state==='shutdown'){
      body=`<div style="margin-top:10px;padding:10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.3);border-radius:8px">
        <div style="font-size:12px;color:#ff6b6b;font-weight:700;margin-bottom:4px">⚠ Klipper detenido</div>
        <div style="font-size:10.5px;color:var(--text3);margin-bottom:9px;line-height:1.4">${escapeHtml(s.klMsg||'La impresora reportó un error y se detuvo. La impresión en curso se interrumpió.')}</div>
        <button onclick="printerFirmwareRestart('${m.id}')" style="width:100%;background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.45);color:#ff6b6b;border-radius:7px;padding:7px;font-size:12px;font-weight:700;cursor:pointer">🔄 Reiniciar firmware</button>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span style="font-size:10px;color:var(--text3);font-family:monospace">${ip}</span>
          <div style="display:flex;gap:4px">
            <button class="op-expert-only" onclick="openPrinterConnModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Configurar IP, API Key y LED">⚙</button>
            <button onclick="openWebcamModal('${m.id}')" style="background:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.12)':'var(--surface2)'};border:1px solid ${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.3)':'var(--border2)'};border-radius:6px;color:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'var(--accent)':'var(--text3)'};font-size:10.5px;padding:3px 7px;cursor:pointer" title="Configurar webcam">📷</button>
            <button class="op-expert-only" onclick="openHistoryModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Historial ${hist.length} registros">📋${hist.length>0?` <span style="color:var(--accent);font-weight:700">${hist.length}</span>`:''}</button>
          </div>
        </div>
      </div>`;
    } else {
      body=`
        ${isActive?`<div style="margin:10px 0 6px;display:flex;gap:9px;align-items:center">
          ${_safePrinterMediaUrl(s.thumbUrl)?`<img loading="lazy" decoding="async" src="${_safePrinterMediaUrl(s.thumbUrl)}" style="width:54px;height:54px;object-fit:cover;border-radius:8px;background:var(--surface2);flex-shrink:0" onerror="this.style.display='none'">`:''}
          <div style="flex:1;min-width:0">
            <div style="font-size:10.5px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px" title="${escapeHtml(s.filename)}">${escapeHtml(s.filename||'—')}</div>
            <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:5px">
              <span class="pbig" id="pbig_${m.id}" style="font-size:22px;font-weight:800;color:${sm.color}">${s.progress}%</span>
              <span id="peta_${m.id}" style="font-size:10.5px;color:var(--text3);margin-left:auto">⏱ ${fmtSecs(s.eta)} restante</span>
            </div>
            <div class="pbar ${isPrinting?'live':''}"><i id="pbar_${m.id}" style="width:${s.progress}%"></i></div>
          </div>
        </div>`:''}
        <details class="op-telemetry" open><summary>Temperaturas y telemetría</summary><div style="display:flex;gap:6px;margin-top:8px">
          <div style="flex:1;background:var(--surface2);border-radius:7px;padding:7px;text-align:center">
            <div style="font-size:10px;color:var(--text3);letter-spacing:.5px;margin-bottom:2px">HOTEND</div>
            <div class="ptemp" id="phot_${m.id}" style="font-size:17px;font-weight:700;color:${s.hotend?.target>0?'#ff6b35':'var(--text)'};line-height:1">${s.hotend?.actual||0}°</div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px">${s.hotend?.target>0?'→ '+s.hotend.target+'°':'fría'}</div>
          </div>
          <div style="flex:1;background:var(--surface2);border-radius:7px;padding:7px;text-align:center">
            <div style="font-size:10px;color:var(--text3);letter-spacing:.5px;margin-bottom:2px">CAMA</div>
            <div class="ptemp" id="pbed_${m.id}" style="font-size:17px;font-weight:700;color:${s.bed?.target>0?'#ffaa00':'var(--text)'};line-height:1">${s.bed?.actual||0}°</div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px">${s.bed?.target>0?'→ '+s.bed.target+'°':'fría'}</div>
          </div>
        </div>
        ${th.length>=2?`<div style="margin-top:8px;padding:6px 8px;background:var(--surface2);border-radius:7px">
          <div style="font-size:10px;color:var(--text3);margin-bottom:3px">Temperatura hotend</div>
          <div id="pspark_${m.id}">${renderSparkline(th,'h','#ff6b35')}</div>
        </div>`:''}
        </details>
        ${isActive?`<div style="display:flex;gap:6px;margin-top:8px">
          ${isPrinting?`<button onclick="printerControl('${m.id}','pause')" style="flex:1;background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.4);color:#ffaa00;border-radius:7px;padding:6px;font-size:12px;font-weight:700;cursor:pointer">⏸ Pausar</button>`:''}
          ${isPaused?`<button onclick="printerControl('${m.id}','resume')" style="flex:1;background:rgba(0,212,170,0.15);border:1px solid rgba(0,212,170,0.4);color:#00d4aa;border-radius:7px;padding:6px;font-size:12px;font-weight:700;cursor:pointer">▶ Reanudar</button>`:''}
          <button onclick="printerControl('${m.id}','cancel')" style="flex:1;background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.35);color:#ff4444;border-radius:7px;padding:6px;font-size:12px;font-weight:700;cursor:pointer">■ Detener</button>
        </div>`:''}
        <div class="pcard-iprow" style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span class="pcard-ip-address op-expert-only" style="font-size:10px;color:var(--text3);font-family:monospace">${ip}${getPrinterApiKey(m.id)?` <span style="color:var(--accent3)" title="API Key configurada">🔑</span>`:''}</span>
          <div class="pcard-actions" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
            ${_renderPrinterLightButton(m.id)}
            <button class="printer-control-btn" onclick="openPrinterControl('${m.id}')" style="background:${isActive?'rgba(0,212,170,0.13)':'var(--surface2)'};border:1px solid ${isActive?'rgba(0,212,170,0.38)':'var(--border2)'};border-radius:8px;color:${isActive?'var(--accent)':'var(--text2)'};font-size:10px;font-weight:800;letter-spacing:.35px;padding:4px 8px;cursor:pointer" title="Mover, temperaturas y controles de impresión">🎛 CONTROL</button>
            <button class="op-expert-only" onclick="openGcodeUpload('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Enviar G-code">📤</button>
            <button class="op-expert-only" onclick="openPrinterConnModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Configurar IP, API Key y LED">⚙</button>
            <button onclick="openWebcamModal('${m.id}')" style="background:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.12)':'var(--surface2)'};border:1px solid ${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.3)':'var(--border2)'};border-radius:6px;color:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'var(--accent)':'var(--text3)'};font-size:10.5px;padding:3px 7px;cursor:pointer" title="Configurar webcam">📷</button>
            <button class="op-expert-only" onclick="openBedMesh('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Bed mesh (mapa de nivelación de cama)">🗺️</button>
            <button class="op-expert-only" onclick="openHistoryModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:3px 7px;cursor:pointer" title="Historial ${hist.length} registros">📋${hist.length>0?` <span style="color:var(--accent);font-weight:700">${hist.length}</span>`:''}  </button>
            ${_queueCount(m.id)>0?`<button onclick="openQueueModal('${m.id}')" style="background:rgba(255,170,0,0.12);border:1px solid rgba(255,170,0,0.4);border-radius:6px;color:#ffaa00;font-size:10.5px;padding:3px 7px;cursor:pointer" title="${_queueCount(m.id)} trabajo(s) en cola">🔁 ${_queueCount(m.id)}</button>`:''}
          </div>
        </div>`;
    }

    const cardHtml=`<div id="mcard_${m.id}" class="pcard${isActive?' active':''}${s.stale?' stale':''}" style="--acc:${sm.color};background:var(--surface);border:1px solid ${maintAlerts.length?'rgba(255,170,0,0.4)':isActive?sm.color+'55':'var(--border2)'};border-top:3px solid ${gc?.color||'var(--border2)'};border-radius:13px;padding:13px;display:${visible?'flex':'none'};flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px">
        ${img?`<img loading="lazy" decoding="async" src="${img}" style="width:34px;height:34px;object-fit:contain;border-radius:7px;background:var(--surface2);flex-shrink:0" onerror="this.style.display='none'">`:''}
        <div style="flex:1;min-width:0">
          <div class="pcard-name" style="font-size:12px;font-weight:700;color:var(--text);line-height:1.25">${escHtml(m.nombre)}</div>
          <div style="font-size:10.5px;color:var(--text3)">Máquina #${m.numG}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          <span style="display:inline-flex;align-items:center;gap:5px;background:${sm.bg};color:${sm.color};border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700;border:1px solid ${sm.color}33"><span class="pdot${isActive?' live':''}"></span>${sm.label}</span>
          ${s.stale?`<span style="background:rgba(120,120,120,0.15);color:#999;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;border:1px solid rgba(120,120,120,0.25)" title="Sin señal momentánea — mostrando el último estado conocido">⟳ reconectando</span>`:''}
          ${maintAlerts.length?`<span style="background:rgba(255,170,0,0.15);color:#ffaa00;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;border:1px solid rgba(255,170,0,0.3)" title="${maintAlerts.map(a=>a.label).join(', ')}">🔧 ${maintAlerts.length} alerta${maintAlerts.length>1?'s':''}</span>`:''}
          ${idleWarn?`<span style="background:rgba(100,100,100,0.15);color:#888;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;border:1px solid rgba(100,100,100,0.2)">💤 ${idleHours}h idle</span>`:''}
        </div>
      </div>
      ${body}
      <div id="mccam_${m.id}" class="pcam-slot"></div>
    </div>`;
    return{id:m.id,fp:structFP,camKey,html:cardHtml};
  });
  // Reconciliación incremental: jamás vaciamos el grid por un cambio de orden.
  // appendChild mueve nodos existentes y conserva los streams abiertos.
  const __ids=__cards.map(c=>c.id).join('|');
  el.__fp=el.__fp||{};el.__cam=el.__cam||{};
  const wanted=new Set(__cards.map(c=>c.id));
  Array.from(el.children).forEach(node=>{
    const id=String(node.id||'').replace(/^mcard_/,'');
    if(node.id?.startsWith('mcard_')&&!wanted.has(id)){
      const im=node.querySelector('img[data-machine-id]');if(im)_cameraClearTimer(im);
      node.remove();
    }
  });
  __cards.forEach(c=>{
    let node=document.getElementById('mcard_'+c.id);
    if(!node){
      el.insertAdjacentHTML('beforeend',c.html);
      node=document.getElementById('mcard_'+c.id);
      el.__fp[c.id]=c.fp;
      _syncPrinterCam(c.id,c.camKey,true);
    }else if(el.__fp[c.id]!==c.fp){
      node=_replaceMonitorCardPreservingCamera(c.id,c.html)||node;
      el.__fp[c.id]=c.fp;
      _syncPrinterCam(c.id,c.camKey,false);
    }
    const slot=document.getElementById('mccam_'+c.id);
    if((slot?.__camKey||'')!==c.camKey)_syncPrinterCam(c.id,c.camKey,false);
    el.__cam[c.id]=c.camKey;
    if(node&&node.parentElement===el)el.appendChild(node);
    _patchLivePrinter(c.id,_printerStatus[c.id]);
  });
  el.__order=__ids;
  const lu=document.getElementById('monitorLastUpdate');
  if(lu)lu.textContent=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function _replaceMonitorCardPreservingCamera(id,html){
  const old=document.getElementById('mcard_'+id);if(!old)return null;
  const tpl=document.createElement('template');tpl.innerHTML=html.trim();
  const next=tpl.content.firstElementChild;if(!next)return old;
  const oldSlot=old.querySelector('.pcam-slot'),newSlot=next.querySelector('.pcam-slot');
  if(oldSlot&&newSlot)newSlot.replaceWith(oldSlot);
  old.replaceWith(next);
  return next;
}
// Monta/actualiza la cámara en su nodo persistente. Sin force, no toca el <img>
// si la URL no cambió → el stream sigue vivo entre ciclos (cero parpadeo).
function _syncPrinterCam(id,camKey,force){
  const slot=document.getElementById('mccam_'+id);if(!slot)return;
  if(!force&&slot.__camKey===camKey)return;
  const prev=slot.querySelector('img');if(prev)_cameraClearTimer(prev);
  if(!camKey){slot.innerHTML='';slot.__camKey='';return;}
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const raw=_printerGridCamRaw(id);
  const camU=_safePrinterMediaUrl(_printerGridCamUrl(id)),snap=_camIsSnapshot(raw);
  const camInterval=_printerUsesRemoteTunnel()?_REMOTE_CAM_SNAPSHOT_MS:_CAM_SNAPSHOT_MS;
  if(!camU){slot.innerHTML='';slot.__camKey='';return;}
  slot.innerHTML=`<div style="margin-top:8px;border-radius:8px;overflow:hidden;background:#000;position:relative;min-height:56px">
    <img loading="eager" decoding="async" data-machine-id="${id}" data-cam-base="${camU}" data-cam-kind="${snap?'snapshot':'mjpeg'}" data-cam-interval="${camInterval}" data-cam-loading="1" ${snap?`data-snap="${camU}"`:''} src="${camU}" style="width:100%;display:block;max-height:160px;object-fit:cover" onload="_cameraLoadOk(this)" onerror="_cameraLoadError(this)">
    <div class="pcam-off" style="display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#8a8a8a;font-size:10.5px;background:#0b0b0b;text-align:center;padding:6px"><span style="font-size:15px">📷</span>Cámara sin señal<span class="pcam-off-status" style="font-size:10px;color:#666">reconectando automáticamente…</span><button type="button" onclick="event.stopPropagation();recoverPrinterCamera('${id}')" style="margin-top:3px;background:#151515;border:1px solid #333;border-radius:6px;color:#bbb;padding:4px 8px;font-size:9.5px;cursor:pointer">↻ Reiniciar cámara</button></div>
  </div>`;
  slot.__camKey=camKey;
  const im=slot.querySelector('img');
  if(im&&snap){
    const key=_cameraTimerKey(im);
    if(key)_camRetryTimers[key]=setTimeout(()=>{
      if(!im.isConnected){delete _camRetryTimers[key];return;}
      // El primer <img src> también puede quedar esperando indefinidamente
      // cuando go2rtc está caído. Trátalo como fallo real para activar la
      // recuperación de K2/K2 Plus, no como un simple refresh.
      if(im.dataset.camLoading==='1'){im.dataset.camLoading='0';_cameraLoadError(im);}
    },_CAM_LOAD_TIMEOUT_MS);
  }
}
// Parchea los valores que cambian a cada lectura, en sitio, sin reconstruir la
// tarjeta. Si el elemento no existe (estado no activo), simplemente no hace nada.
function _patchLivePrinter(id,s){
  if(!s)return;
  const g=p=>document.getElementById(p+id);
  const set=(p,t)=>{const e=g(p);if(e&&e.textContent!==t)e.textContent=t;};
  const bar=g('pbar_');if(bar&&s.progress!=null){const w=s.progress+'%';if(bar.style.width!==w)bar.style.width=w;}
  if(s.progress!=null)set('pbig_',s.progress+'%');
  set('peta_','⏱ '+fmtSecs(s.eta)+' restante');
  if(s.hotend)set('phot_',(s.hotend.actual||0)+'°');
  if(s.bed)set('pbed_',(s.bed.actual||0)+'°');
  const sp=g('pspark_'),th=_tempHistory[id]||[];
  if(sp&&th.length>=2)sp.innerHTML=renderSparkline(th,'h','#ff6b35');
  _patchPrinterLightButton(id);
}

async function printerControl(id,action){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  if(!_printerControlFresh(id)){toast('🔒 '+_printerControlReason(id)+' — control bloqueado','error');return;}
  const state=_pcState(id);
  if(action==='pause'&&state!=='printing'){toast('La impresora no está imprimiendo','info');return;}
  if(action==='resume'&&state!=='paused'){toast('La impresora no está pausada','info');return;}
  if(action==='cancel'&&!['printing','paused'].includes(state)){toast('No hay una impresión activa que detener','info');return;}
  if(action==='cancel'&&!confirm(`¿Detener la impresión en ${m.nombre} #${m.numG}?\n\nSe cancelará el trabajo actual de forma normal. La parada de emergencia es una acción distinta.`))return;
  toast({pause:'⏸ Pausando',resume:'▶ Reanudando',cancel:'■ Deteniendo'}[action]+` ${m.nombre} #${m.numG}`,'info');
  const headers=getPrinterAuthHeaders(id);
  try{
    const r=await fetch(printerUrl(ip,`/printer/print/${action}`),{method:'POST',signal:AbortSignal.timeout(6000),headers});
    if(r.ok)setTimeout(pollPrinters,700);else toast('Error: '+r.status,'error');
  }catch(e){toast('Sin conexión con la impresora','error');}
}

// Reinicia el firmware Klipper (saca la impresora del estado "shutdown").
// Moonraker mantiene la petición abierta hasta reconectar; si tarda y caduca
// el timeout lo tratamos igual como "reiniciándose" (no es un error real).
async function printerFirmwareRestart(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  if(!confirm(`🔄 Reiniciar el firmware de ${m.nombre} #${m.numG}?\n\nSaca a Klipper del estado "detenido". Si la causa fue puntual, volverá a funcionar; si es un fallo de hardware (termistor/MCU) se detendrá otra vez — revisa la impresora.`))return;
  toast(`🔄 Reiniciando firmware de ${m.nombre} #${m.numG}…`,'info');
  try{
    const r=await fetch(printerUrl(ip,'/printer/firmware_restart'),{method:'POST',signal:AbortSignal.timeout(15000),headers:getPrinterAuthHeaders(id)});
    if(r.ok)toast('✅ Firmware reiniciado','success');
    else toast('Error: '+r.status,'error');
  }catch(e){toast('🔄 Comando enviado — la conexión se reinicia…','info');}
  setTimeout(pollPrinters,4000);
}

// Recupera la telemetría de una máquina viva cuyo Moonraker se cayó. El
// navegador no puede abrir una shell en la impresora, así que se lo pide al
// bridge del taller (POST /recover/{IP}), que sí está en la LAN: repone
// moonraker.conf si falta y reinicia el servicio. Klipper no se toca — una
// impresión en curso sigue su camino.
const _RECOVER_TIMEOUT_MS=90000;   // el bridge hace SSH + espera a que Moonraker vuelva (~75s peor caso)
async function recoverPrinterTelemetry(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  const btn=document.getElementById('recov_'+id);
  const label=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.style.opacity='.7';btn.innerHTML='⏳ Recuperando… (hasta 1 min)';}
  toast(`🔧 Reiniciando Moonraker en ${m.nombre} #${m.numG}…`,'info');
  const tk=getPrinterTunnelToken();
  try{
    const r=await fetch(_appendBridgeToken(`${getPrinterTunnel()}/recover/${ip}`),{method:'POST',signal:AbortSignal.timeout(_RECOVER_TIMEOUT_MS)});
    let d={};try{d=await r.json();}catch(_){}
    const detalle=d.error||(Array.isArray(d.steps)?d.steps[d.steps.length-1]:'')||`HTTP ${r.status}`;
    if(r.status===401)toast('Token del bridge inválido — pégalo de nuevo en Mi cuenta → Túnel Impresoras','error');
    else if(r.status===404)toast('Este bridge todavía no sabe recuperar: actualízalo en el iMac (git pull + reiniciar)','error');
    else if(r.status===409)toast('Ya hay una recuperación en curso para esa impresora','info');
    else if(r.ok&&d.ok)toast(`✅ Telemetría recuperada · ${m.nombre} #${m.numG}`,'success');
    else toast('No se pudo recuperar: '+detalle,'error');
  }catch(e){
    console.error('[recover]',e);
    let host=getPrinterTunnel();try{host=new URL(host).host;}catch(_){}
    toast(e?.name==='TimeoutError'||e?.name==='AbortError'
      ?'La recuperación tardó demasiado — revisa la impresora y su moonraker.log'
      :`No se pudo hablar con el bridge (${host}) — ${e?.name||'error de red'}`,'error');
  }finally{
    if(btn){btn.disabled=false;btn.style.opacity='';btn.innerHTML=label;}
    delete _aliveProbe[id];   // el sondeo cacheado quedó obsoleto
    _failCount[id]=0;
    pollPrinters();
  }
}

// ── CONTROL MOONRAKER (temperatura · máquina · archivos · historial) ──
// SEGURIDAD: todos los comandos de ESCRITURA verifican _isPrinterBusy antes
// de enviar nada — si la impresora está imprimiendo/pausada se rechazan, para
// no arriesgar un trabajo en curso. Solo la parada de emergencia ignora esto.
const PREHEAT_PRESETS={PLA:{h:210,b:60},PETG:{h:240,b:80},ABS:{h:250,b:100},TPU:{h:225,b:50}};
function _isPrinterBusy(state){return state==='printing'||state==='paused';}
function _pcState(id){return(_printerStatus[id]||{}).state||'offline';}
function _printerControlFresh(id){
  const s=_printerStatus[id]||{},state=String(s.state||'');
  if(!state||s.stale)return false;
  return !['offline','noip','apidown','connecting','shutdown','startup','error','unknown'].includes(state);
}
function _printerControlReason(id){
  const s=_printerStatus[id]||{},state=String(s.state||'offline');
  if(s.stale)return'Telemetría desactualizada';
  if(state==='shutdown'||state==='error')return'Klipper detenido';
  if(state==='startup'||state==='connecting')return'La impresora todavía está conectando';
  if(state==='noip')return'Sin IP configurada';
  if(state==='apidown')return'Moonraker no responde';
  if(state==='unknown')return'Estado de impresión desconocido';
  return'Sin conexión con la impresora';
}
// ── AGENTE: Auditoría y mantención 3D ──────────────────────────────────
// Audita cada impresora vía Moonraker. SEGURIDAD: no propone ni ejecuta nada
// sobre una máquina imprimiendo/pausada; las acciones reutilizan _sendGcode (gated).
async function audit3DPrinter(m){
  const id=m.id, ip=getPrinterIp(m);
  if(!ip)return{id,nombre:m.nombre,numG:m.numG,state:'noip',issues:[{sev:1,txt:'Sin IP configurada'}],actions:[]};
  const d=await _moonrakerGet(id,'/printer/objects/query?print_stats&heater_bed&extruder&webhooks&toolhead&bed_mesh',7000);
  if(!d||!d.result||!d.result.status)return{id,nombre:m.nombre,numG:m.numG,state:'offline',issues:[{sev:2,txt:'No responde (offline o apagada)'}],actions:[]};
  const s=d.result.status,wh=s.webhooks||{},ps=s.print_stats||{},th=s.toolhead||{},ex=s.extruder||{},hb=s.heater_bed||{},bm=s.bed_mesh||{};
  const klState=wh.state||'ready';
  let klMsg=''; if(wh.state_message){try{const j=JSON.parse(wh.state_message);klMsg=j.msg||wh.state_message;}catch(_){klMsg=wh.state_message;}klMsg=String(klMsg).split('\n').map(x=>x.trim()).filter(Boolean)[0]||'';}
  const errored=(klState==='shutdown'||klState==='error');
  let state=ps.state||'unknown'; if(errored)state='shutdown';
  const busy=(state==='printing'||state==='paused');
  const homed=String(th.homed_axes||'').toLowerCase()==='xyz';
  const meshOk=!!(bm.profile_name||(bm.mesh_matrix&&bm.mesh_matrix.length));
  const issues=[],actions=[];
  if(errored){issues.push({sev:1,txt:'Klipper detenido ('+klState+')'+(klMsg?': '+klMsg:'')});actions.push({key:'firmware',txt:'🔄 Reiniciar firmware'});}
  if(busy)issues.push({sev:0,txt:'Imprimiendo'+(ps.filename?' · '+ps.filename.replace(/\.gcode$/i,''):'')+' — no se tocará'});
  if(!busy&&!errored){
    if(!homed){issues.push({sev:2,txt:'Sin home (ejes sin referenciar)'});actions.push({key:'home',txt:'🏠 Home'});}
    if(!meshOk){issues.push({sev:2,txt:'Sin malla de cama activa'});actions.push({key:'mesh',txt:'📐 Calibrar malla'});}
    else actions.push({key:'mesh',txt:'📐 Recalibrar malla'});
  }
  let fc=null; try{if(typeof getMaintForecast==='function')fc=getMaintForecast(m);}catch(_){}
  if(fc&&fc.hoursLeft<=0)issues.push({sev:1,txt:'Mantención '+fc.tipo+' VENCIDA'});
  else if(fc&&fc.rate>0&&fc.weeks<1.5)issues.push({sev:2,txt:'Mantención '+fc.tipo+' próxima (~'+Math.max(1,Math.round(fc.weeks*7))+'d)'});
  return{id,nombre:m.nombre,numG:m.numG,state,busy,errored,klState,klMsg,homed,meshOk,hotend:Math.round(ex.temperature||0),bed:Math.round(hb.temperature||0),lastFile:(ps.filename||'').replace(/\.gcode$/i,''),issues,actions};
}
async function audit3DAll(){
  const list=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).filter(m=>getPrinterIp(m));
  const res=await Promise.all(list.map(m=>audit3DPrinter(m).catch(e=>({id:m.id,nombre:m.nombre,numG:m.numG,state:'error',issues:[{sev:2,txt:'Error auditando: '+(e&&e.message||e)}],actions:[]}))));
  window._audit3D={ts:Date.now(),printers:res};
  return res;
}
function _audit3DDot(sev){return sev===0?'var(--accent3)':sev===1?'var(--danger)':'var(--warn)';}
async function audit3DRun(silent){
  const el=document.getElementById('audit3DResult');if(el&&!silent)el.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Auditando impresoras…</div>';
  audit3DRenderResult(await audit3DAll());
  try{audit3DLoadDaily();}catch(_){}
}
// El panel de auditoría es un snapshot: antes, tras Home/calibrar se quedaba con
// el dato viejo (p.ej. "Sin home") hasta apretar "Auditar ahora". Ahora la propia
// acción re-audita en silencio (sin el spinner) en varios momentos, para reflejar
// el estado nuevo a medida que la máquina termina el home/nivelación.
let _audit3DBurstTimers=[];
function _audit3DRefreshBurst(delays){
  _audit3DBurstTimers.forEach(t=>clearTimeout(t));_audit3DBurstTimers=[];
  (delays||[8000]).forEach(d=>_audit3DBurstTimers.push(setTimeout(()=>{
    const el=document.getElementById('audit3DResult');
    if(el&&el.innerHTML.trim()&&document.getElementById('tab-maquinas')?.classList.contains('active'))audit3DRun(true);
  },d)));
}
function audit3DHome(id){printerHome(id);_audit3DRefreshBurst([7000,12000]);}
function audit3DRenderResult(res){
  const el=document.getElementById('audit3DResult');if(!el)return;
  if(!res.length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">Sin impresoras con IP configurada. Configura las IPs en cada tarjeta del monitor.</div>';return;}
  const okN=res.filter(a=>!a.errored&&!a.busy&&a.state!=='offline'&&a.state!=='noip'&&a.state!=='error'&&(a.issues||[]).every(i=>i.sev===0)).length;
  const errN=res.filter(a=>a.errored).length,offN=res.filter(a=>a.state==='offline'||a.state==='noip').length;
  const cards=res.map(a=>{
    const stCol=a.errored?'var(--danger)':a.busy?'var(--accent)':(a.state==='offline'||a.state==='noip')?'var(--text3)':'var(--success)';
    const stTxt=a.errored?'⚠ Detenida (Klipper)':a.busy?'🖨 Imprimiendo':a.state==='offline'?'⚫ Offline':a.state==='noip'?'Sin IP':'✓ Lista';
    const issues=(a.issues||[]).map(i=>`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)"><span style="width:6px;height:6px;border-radius:50%;background:${_audit3DDot(i.sev)};flex-shrink:0"></span>${escapeHtml(i.txt)}</div>`).join('');
    const acts=(a.actions||[]).map(ac=>{const fn=ac.key==='firmware'?`printerFirmwareRestart('${a.id}')`:ac.key==='home'?`audit3DHome('${a.id}')`:`audit3DCalibrate('${a.id}')`;return `<button class="btn btn-ghost btn-sm" onclick="${fn}" style="font-size:10.5px">${escapeHtml(ac.txt)}</button>`;}).join('');
    return `<div style="padding:11px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--surface2)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
        <b style="font-size:12px">${escapeHtml(a.nombre)} <span style="color:var(--text3)">#${a.numG}</span></b>
        <span style="font-size:12px;color:${stCol};font-weight:600">${stTxt}</span>
        ${!a.busy&&a.state!=='offline'&&a.state!=='noip'&&a.state!=='error'?`<span style="font-size:10.5px;color:var(--text3)">🌡 ${a.hotend}°/${a.bed}°${a.homed?' · home ✓':''}${a.meshOk?' · malla ✓':''}</span>`:''}
        <span style="margin-left:auto;display:flex;gap:5px;flex-wrap:wrap">${acts}</span>
      </div>
      ${issues||'<div style="font-size:12px;color:var(--success)">Sin observaciones — lista para imprimir.</div>'}
    </div>`;}).join('');
  el.innerHTML=`<div style="font-size:12px;color:var(--text2);margin-bottom:10px">✓ <b style="color:var(--success)">${okN}</b> lista(s) · <b style="color:var(--danger)">${errN}</b> con error · ${offN} offline · ${res.length} total</div>`+cards;
}
async function audit3DCalibrate(id){
  const m=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('🔒 Está imprimiendo — no se calibra','error');return;}
  if(!confirm(`📐 Calibrar bed mesh en ${m.nombre} #${m.numG}?\n\nHará home + nivelación de cama (1-2 min). Asegúrate de que la cama esté despejada.`))return;
  _sendGcode(id,'G28\nBED_MESH_CALIBRATE','📐 Calibrando bed mesh… (1-2 min)',{timeout:180000});
  _audit3DRefreshBurst([8000,60000,95000,140000]);
}
async function audit3DCalibrateAll(){
  const free=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).filter(m=>getPrinterIp(m)&&!_isPrinterBusy(_pcState(m.id))&&_pcState(m.id)!=='offline'&&_pcState(m.id)!=='shutdown');
  if(!free.length){toast('No hay impresoras libres y listas para calibrar','info');return;}
  if(!confirm(`📐 Lanzar bed mesh en ${free.length} impresora(s) libre(s)?\n\n${free.map(m=>m.nombre+' #'+m.numG).join(', ')}\n\nCada una hace home + nivelación. No toca las que estén imprimiendo.`))return;
  free.forEach(m=>_sendGcode(m.id,'G28\nBED_MESH_CALIBRATE',null,{timeout:180000}));
  toast(`📐 Calibración lanzada en ${free.length} impresora(s)`,'success');
  _audit3DRefreshBurst([8000,60000,95000,140000]);
}
async function audit3DReport(){
  const out=document.getElementById('audit3DAiOut');if(out){out.style.display='block';out.textContent='🧠 Analizando el estado del parque…';}
  if(!window._audit3D)await audit3DRun();
  try{showAgentWorking('MANTENCION3D',{verb:'está auditando el parque de impresoras…',messages:['Revisando el estado de cada máquina…','Detectando errores y mantenciones…','Sugiriendo calibraciones…']});}catch(e){}
  try{const cfg=(typeof AGENTES_CFG!=='undefined')?AGENTES_CFG.find(a=>a.id==='MANTENCION3D'):null;const started=typeof beginAgentResultRun==='function'?beginAgentResultRun('MANTENCION3D'):Date.now();const resp=await callAgentClaude('MANTENCION3D',cfg?cfg.sys:'',buildAgentContext('MANTENCION3D'));const meta=typeof agentResultMeta==='function'?agentResultMeta('MANTENCION3D',started):{};if(out){out.style.whiteSpace='normal';out.innerHTML=typeof renderAgentResult==='function'?renderAgentResult('MANTENCION3D',resp,meta):formatAgentReport(resp);}try{AGENT_LOG.add('AUDITOR_3D','Auditoría del parque 3D',resp,meta);}catch(e){}}
  catch(e){if(out)out.textContent='Error IA: '+(e&&e.message||e);}
  finally{try{hideAgentWorking();}catch(e){}}
}
// Último reporte de la rutina automática de la mañana (lo escribe el printer-bridge en Airtable)
async function audit3DLoadDaily(){
  const el=document.getElementById('audit3DDaily');if(!el)return;
  try{const r=await airtableFetch('Maquinas_Auditoria',1);const rec=(r.records||[])[0];if(!rec){el.innerHTML='';return;}
    const f=rec.fields;el.innerHTML=`<div style="padding:11px 14px;border:1px dashed var(--border2);border-radius:10px;font-size:12px;color:var(--text3)"><b style="color:var(--text2)">📋 Última auditoría automática</b> · ${escapeHtml(String(f['Fecha']||rec.createdTime||''))}<br><span style="white-space:pre-wrap">${escapeHtml(String(f['Resumen']||f['Detalle']||'').slice(0,700))}</span></div>`;
  }catch(_){el.innerHTML='';}
}
async function _moonrakerGet(id,path,timeout=6000){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return null;
  const ip=getPrinterIp(m);if(!ip)return null;
  try{const r=await fetch(printerUrl(ip,path),{signal:AbortSignal.timeout(timeout),headers:getPrinterAuthHeaders(id)});if(!r.ok)return null;return await r.json();}catch(e){return null;}
}
async function _sendGcode(id,script,label,opts={}){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return false;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return false;}
  if(!opts.allowStale&&!_printerControlFresh(id)){toast('🔒 '+_printerControlReason(id)+' — no se envió nada','error');return false;}
  if(!opts.allowBusy&&_isPrinterBusy(_pcState(id))){toast('🔒 Bloqueado durante una impresión — no se envió nada','error');return false;}
  try{
    const r=await fetch(printerUrl(ip,`/printer/gcode/script?script=${encodeURIComponent(script)}`),{method:'POST',signal:AbortSignal.timeout(opts.timeout||9000),headers:getPrinterAuthHeaders(id)});
    if(r.ok){if(label)toast(label,'success');setTimeout(pollPrinters,650);return true;}
    toast('Error: '+r.status,'error');return false;
  }catch(e){toast('Sin conexión con la impresora','error');return false;}
}
function _printerTempLimit(heater){return heater==='hotend'?300:120;}
function setPrinterTemp(id,heater){
  const inp=document.getElementById('pcTemp_'+heater);if(!inp)return;
  let t=Math.round(+inp.value);if(!isFinite(t)||t<0)t=0;
  const max=_printerTempLimit(heater);if(t>max){toast(`Máximo ${max}° para ${heater==='hotend'?'el nozzle':'la cama'}`,'error');return;}
  _sendGcode(id,heater==='hotend'?`M104 S${t}`:`M140 S${t}`,`🌡️ ${heater==='hotend'?'Nozzle':'Cama'} → ${t}°`,{allowBusy:true});
}
function printerAdjustTemp(id,heater,delta){
  const inp=document.getElementById('pcTemp_'+heater),s=_printerStatus[id]||{},obj=heater==='hotend'?s.hotend:s.bed;
  const base=inp&&inp.value!==''?Number(inp.value):Number(obj?.target>0?obj.target:obj?.actual||0);
  const max=_printerTempLimit(heater),next=Math.max(0,Math.min(max,Math.round(base+delta)));
  if(inp)inp.value=next;
  _sendGcode(id,heater==='hotend'?`M104 S${next}`:`M140 S${next}`,`🌡️ ${heater==='hotend'?'Nozzle':'Cama'} → ${next}°`,{allowBusy:true});
}
function preheatPrinter(id,mat){
  const p=PREHEAT_PRESETS[mat];if(!p)return;
  _sendGcode(id,`M104 S${p.h}\nM140 S${p.b}`,`🔥 Precalentando ${mat} · nozzle ${p.h}° · cama ${p.b}°`);
}
function cooldownPrinter(id){_sendGcode(id,'M104 S0\nM140 S0','❄️ Enfriando — calentadores apagados');}

const _bedLevelRuns={};
const _BED_LEVEL_TIMEOUT_MS=300000;
const _BED_LEVEL_HISTORY_KEY='printer_bedmesh_history_v2';
const _BED_LEVEL_HISTORY_LEGACY_KEY='printer_bedmesh_history_v1';
const _BED_LEVEL_HISTORY_REMOTE='BED_LEVEL_HISTORY_V2';
const _BED_LEVEL_HISTORY_PER_MACHINE=16;
const _BED_LEVEL_HISTORY_TOTAL=180;
const _BED_LEVEL_HISTORY_MAX_NOTES=85000;
const _BED_LEVEL_OBSERVATION_PREFIX='printer_bedmesh_active_v1_';
let _bedLevelHistoryRemoteAt=0,_bedLevelHistoryRemotePromise=null,_bedLevelHistorySyncPromise=null;

function _bedLevelTimeoutMs(m){return /Giga/i.test(String(m?.modelo||''))?600000:_BED_LEVEL_TIMEOUT_MS;}
function _bedLevelFiniteOrNull(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function _bedLevelPair(value){
  if(Array.isArray(value)&&value.length>=2){
    const a=_bedLevelFiniteOrNull(value[0]),b=_bedLevelFiniteOrNull(value[1]);
    return a===null||b===null?null:[a,b];
  }
  if(typeof value==='string'){
    const p=value.replace(/[\[\]()]/g,'').split(',').map(v=>Number(String(v).trim()));
    return p.length>=2&&p.every(Number.isFinite)?[p[0],p[1]]:null;
  }
  return null;
}
function _bedLevelStats(mesh){
  const matrix=mesh?.probed_matrix||mesh?.mesh_matrix;
  if(!Array.isArray(matrix)||!matrix.length)return null;
  let min=Infinity,max=-Infinity,sum=0,points=0,minPos=null,maxPos=null,cols=0;
  matrix.forEach((row,r)=>{
    if(!Array.isArray(row))return;
    cols=Math.max(cols,row.length);
    row.forEach((raw,c)=>{
      const v=Number(raw);if(!Number.isFinite(v))return;
      points++;sum+=v;
      if(v<min){min=v;minPos={row:r,col:c};}
      if(v>max){max=v;maxPos={row:r,col:c};}
    });
  });
  if(!points)return null;
  const meshMin=_bedLevelPair(mesh?.mesh_min),meshMax=_bedLevelPair(mesh?.mesh_max);
  return{matrix,min,max,range:max-min,avg:sum/points,points,rows:matrix.length,cols,minPos,maxPos,meshMin,meshMax,profileName:String(mesh?.profile_name||'')};
}
function _bedLevelSignature(st){
  if(!st?.matrix)return'';
  return st.matrix.map(row=>Array.isArray(row)?row.map(v=>Number.isFinite(Number(v))?Number(v).toFixed(4):'x').join(','):'').join('|');
}
function _bedLevelGrade(range){
  if(range<=0.15)return{label:'EXCELENTE',color:'#00d4aa',hint:'Cama muy pareja'};
  if(range<=0.25)return{label:'CORRECTA',color:'#38bdf8',hint:'Dentro de un rango razonable'};
  if(range<=0.40)return{label:'ATENCIÓN',color:'#ffaa00',hint:'Conviene revisar nivelación mecánica'};
  return{label:'DESNIVEL ALTO',color:'#ff5555',hint:'Revisa mecánicamente la cama antes de confiar solo en el mesh'};
}
function _bedLevelCoords(st,row,col){
  if(!st)return{x:col,y:row};
  const min=st.meshMin,max=st.meshMax;
  if(min&&max){
    const x=st.cols>1?min[0]+(max[0]-min[0])*(col/(st.cols-1)):min[0];
    const y=st.rows>1?min[1]+(max[1]-min[1])*(row/(st.rows-1)):min[1];
    return{x,y};
  }
  return{x:col,y:row};
}
function _bedLevelPositionLabel(st,pos){
  if(!st||!pos)return'posición desconocida';
  const p=_bedLevelCoords(st,pos.row,pos.col),grid=`F${pos.row+1}/C${pos.col+1}`;
  return st.meshMin&&st.meshMax?`${grid} · X ${p.x.toFixed(0)} / Y ${p.y.toFixed(0)} mm`:grid;
}
function _bedLevelPlaneFit(st){
  if(!st?.matrix||!st.points)return null;
  const pts=[];
  st.matrix.forEach((row,r)=>Array.isArray(row)&&row.forEach((raw,c)=>{
    const z=Number(raw);if(!Number.isFinite(z))return;
    const {x,y}=_bedLevelCoords(st,r,c);pts.push({x,y,z,r,c});
  }));
  if(pts.length<3)return null;
  const n=pts.length,xm=pts.reduce((s,p)=>s+p.x,0)/n,ym=pts.reduce((s,p)=>s+p.y,0)/n,zm=pts.reduce((s,p)=>s+p.z,0)/n;
  let sxx=0,syy=0,sxy=0,sxz=0,syz=0;
  pts.forEach(p=>{const x=p.x-xm,y=p.y-ym,z=p.z-zm;sxx+=x*x;syy+=y*y;sxy+=x*y;sxz+=x*z;syz+=y*z;});
  const det=sxx*syy-sxy*sxy;if(Math.abs(det)<1e-12)return null;
  const a=(sxz*syy-syz*sxy)/det,b=(syz*sxx-sxz*sxy)/det,c=zm-a*xm-b*ym;
  let rMin=Infinity,rMax=-Infinity,rss=0,center=null,centerD=Infinity;
  pts.forEach(p=>{
    const predicted=a*p.x+b*p.y+c,residual=p.z-predicted;
    rMin=Math.min(rMin,residual);rMax=Math.max(rMax,residual);rss+=residual*residual;
    const d=Math.hypot(p.x-xm,p.y-ym);if(d<centerD){centerD=d;center={...p,residual};}
  });
  const xSpan=st.meshMin&&st.meshMax?st.meshMax[0]-st.meshMin[0]:Math.max(1,st.cols-1);
  const ySpan=st.meshMin&&st.meshMax?st.meshMax[1]-st.meshMin[1]:Math.max(1,st.rows-1);
  const tiltX=a*xSpan,tiltY=b*ySpan,tiltRange=Math.abs(tiltX)+Math.abs(tiltY),residualRange=rMax-rMin,rms=Math.sqrt(rss/n);
  let shape='MIXTA';
  if(tiltRange>=0.12&&tiltRange>residualRange*1.35)shape='INCLINACIÓN';
  else if(residualRange>=0.12&&residualRange>tiltRange*1.15)shape='DEFORMACIÓN LOCAL';
  else if(tiltRange<0.12&&residualRange<0.12)shape='UNIFORME';
  return{a,b,c,tiltX,tiltY,tiltRange,residualRange,rms,centerResidual:center?.residual??0,shape};
}
function _bedLevelDiagnose(st){
  if(!st)return null;
  const fit=_bedLevelPlaneFit(st),high=_bedLevelPositionLabel(st,st.maxPos),low=_bedLevelPositionLabel(st,st.minPos),um=Math.round(st.range*1000);
  let action='Mesh dentro de un rango razonable.';
  if(st.range>0.80)action='Desnivel muy alto: revisa fijaciones, tornillos, separadores y posible deformación antes de imprimir.';
  else if(st.range>0.40)action='Revisa mecánicamente la cama; no conviene depender solo de la compensación electrónica.';
  else if(st.range>0.25)action='Aceptable para pruebas, pero conviene vigilar primera capa y estabilidad mecánica.';
  let geometry='';
  if(fit){
    const x=Math.round(fit.tiltX*1000),y=Math.round(fit.tiltY*1000),local=Math.round(fit.residualRange*1000),center=Math.round(fit.centerResidual*1000);
    geometry=`Patrón ${fit.shape.toLowerCase()} · inclinación X ${x>=0?'+':''}${x} µm · Y ${y>=0?'+':''}${y} µm · deformación local ${local} µm`;
    if(Math.abs(center)>=80)geometry+=` · centro ${center>0?'abombado':'hundido'} ${Math.abs(center)} µm`;
  }
  return{high,low,um,action,fit,geometry,summary:`Punto alto ${high}; punto bajo ${low}; diferencia ${um} µm.`};
}
function _bedLevelTypicalBedTemp(material){
  const m=String(material||'').toUpperCase();
  if(m.includes('ABS')||m.includes('ASA'))return 100;
  if(m.includes('PETG'))return 75;
  if(m.includes('TPU'))return 50;
  if(m.includes('PLA'))return 60;
  return 0;
}

function _bedLevelMetaKey(id){return'printer_bedmesh_verified_'+id;}
function _bedLevelMetaRead(id,signature=''){
  try{
    const meta=JSON.parse(localStorage.getItem(_bedLevelMetaKey(id))||'null');
    if(!meta||!meta.signature||!meta.calibratedAt)return null;
    if(signature&&meta.signature!==signature)return null;
    return meta;
  }catch(_){return null;}
}
function _bedLevelMetaWrite(id,st,extra={}){
  const signature=_bedLevelSignature(st);if(!signature)return null;
  const meta={signature,calibratedAt:Number(extra.calibratedAt)||Date.now(),range:st.range,bedTemp:_bedLevelFiniteOrNull(extra.bedTemp),bedTarget:_bedLevelFiniteOrNull(extra.bedTarget)};
  try{localStorage.setItem(_bedLevelMetaKey(id),JSON.stringify(meta));}catch(_){}
  return meta;
}
function _bedLevelObservationKey(id){return _BED_LEVEL_OBSERVATION_PREFIX+id;}
function _bedLevelObservationWrite(id,st,present=true){
  const obs={machineId:id,present:!!present,observedAt:Date.now(),signature:st?_bedLevelSignature(st):'',range:st?st.range:null};
  try{localStorage.setItem(_bedLevelObservationKey(id),JSON.stringify(obs));}catch(_){}
  return obs;
}
function _bedLevelObservationRead(id){try{return JSON.parse(localStorage.getItem(_bedLevelObservationKey(id))||'null');}catch(_){return null;}}

function _bedLevelHistoryNormalize(row){
  if(!row||!row.machineId||!Number(row.calibratedAt))return null;
  return{...row,id:String(row.id||`${row.machineId}:${row.calibratedAt}`),machineId:String(row.machineId),calibratedAt:Number(row.calibratedAt),range:_bedLevelFiniteOrNull(row.range),min:_bedLevelFiniteOrNull(row.min),max:_bedLevelFiniteOrNull(row.max),avg:_bedLevelFiniteOrNull(row.avg),points:Number(row.points)||0,signature:String(row.signature||''),bedTemp:_bedLevelFiniteOrNull(row.bedTemp),bedTarget:_bedLevelFiniteOrNull(row.bedTarget),hotendTemp:_bedLevelFiniteOrNull(row.hotendTemp),updatedAt:Number(row.updatedAt)||Number(row.calibratedAt)};
}
function _bedLevelHistoryPrune(rows){
  const groups=new Map();
  (Array.isArray(rows)?rows:[]).map(_bedLevelHistoryNormalize).filter(Boolean).forEach(row=>{
    if(!groups.has(row.machineId))groups.set(row.machineId,[]);
    groups.get(row.machineId).push(row);
  });
  const clean=[];
  for(const list of groups.values()){list.sort((a,b)=>b.calibratedAt-a.calibratedAt);clean.push(...list.slice(0,_BED_LEVEL_HISTORY_PER_MACHINE));}
  clean.sort((a,b)=>b.calibratedAt-a.calibratedAt);
  while(clean.length>_BED_LEVEL_HISTORY_TOTAL)clean.pop();
  while(clean.length>1&&JSON.stringify(clean).length>_BED_LEVEL_HISTORY_MAX_NOTES)clean.pop();
  return clean;
}
function _bedLevelHistoryAll(){
  try{
    let rows=JSON.parse(localStorage.getItem(_BED_LEVEL_HISTORY_KEY)||'[]');
    if(!Array.isArray(rows)||!rows.length){const legacy=JSON.parse(localStorage.getItem(_BED_LEVEL_HISTORY_LEGACY_KEY)||'[]');if(Array.isArray(legacy)&&legacy.length)rows=legacy;}
    return _bedLevelHistoryPrune(rows);
  }catch(_){return[];}
}
function _bedLevelHistorySave(rows){const clean=_bedLevelHistoryPrune(rows);try{localStorage.setItem(_BED_LEVEL_HISTORY_KEY,JSON.stringify(clean));}catch(_){}return clean;}
function _bedLevelHistoryMerge(a,b){
  const map=new Map();
  [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].map(_bedLevelHistoryNormalize).filter(Boolean).forEach(row=>{const prev=map.get(row.id);if(!prev||row.updatedAt>=prev.updatedAt)map.set(row.id,row);});
  return _bedLevelHistoryPrune([...map.values()]);
}
function _bedLevelHistoryFor(id){return _bedLevelHistoryAll().filter(x=>x.machineId===id).sort((a,b)=>b.calibratedAt-a.calibratedAt);}
function _bedLevelHistoryMatch(id,signature){return signature?_bedLevelHistoryFor(id).find(x=>x.signature===signature)||null:null;}
async function _bedLevelHistoryFetchRemote(){
  if(typeof airtableFetch!=='function')return{rows:[],record:null};
  const res=await airtableFetch('Monitor Sistema',200),rec=(res?.records||[]).find(r=>r?.fields?.Name===_BED_LEVEL_HISTORY_REMOTE)||null;
  let rows=[];if(rec){try{const parsed=JSON.parse(rec.fields?.Notes||'[]');if(Array.isArray(parsed))rows=parsed;}catch(_){}}
  try{if(rec&&typeof state!=='undefined'&&state)state.bedLevelHistoryV2RecordId=rec.id;}catch(_){}
  return{rows:_bedLevelHistoryPrune(rows),record:rec};
}
async function _bedLevelHistoryLoadRemote(force=false){
  if(!force&&Date.now()-_bedLevelHistoryRemoteAt<60000)return true;
  if(_bedLevelHistoryRemotePromise)return _bedLevelHistoryRemotePromise;
  _bedLevelHistoryRemotePromise=(async()=>{try{const remote=await _bedLevelHistoryFetchRemote();_bedLevelHistorySave(_bedLevelHistoryMerge(remote.rows,_bedLevelHistoryAll()));_bedLevelHistoryRemoteAt=Date.now();return true;}catch(_){return false;}finally{_bedLevelHistoryRemotePromise=null;}})();
  return _bedLevelHistoryRemotePromise;
}
async function _bedLevelHistorySyncRemote(){
  if(_bedLevelHistorySyncPromise)return _bedLevelHistorySyncPromise;
  if(typeof _monitorUpsert!=='function'||typeof airtableFetch!=='function')return false;
  _bedLevelHistorySyncPromise=(async()=>{
    try{
      let local=_bedLevelHistoryAll();
      for(let attempt=0;attempt<2;attempt++){
        const remote=await _bedLevelHistoryFetchRemote(),merged=_bedLevelHistoryMerge(remote.rows,local);_bedLevelHistorySave(merged);local=merged;
        await _monitorUpsert(_BED_LEVEL_HISTORY_REMOTE,JSON.stringify(merged),'bedLevelHistoryV2RecordId');
        const verify=await _bedLevelHistoryFetchRemote(),ids=new Set(verify.rows.map(x=>x.id)),needed=merged.slice(0,Math.min(30,merged.length)).every(x=>ids.has(x.id));
        if(needed){_bedLevelHistorySave(_bedLevelHistoryMerge(verify.rows,merged));_bedLevelHistoryRemoteAt=Date.now();return true;}
      }
      return false;
    }catch(_){return false;}finally{_bedLevelHistorySyncPromise=null;}
  })();
  return _bedLevelHistorySyncPromise;
}
function _bedLevelHistoryAppend(id,st,ctx={}){
  const at=Number(ctx.calibratedAt)||Date.now(),diag=_bedLevelDiagnose(st),s=_printerStatus[id]||{},signature=_bedLevelSignature(st);
  const entry=_bedLevelHistoryNormalize({id:`${id}:${at}:${signature.slice(0,24)}`,machineId:id,calibratedAt:at,updatedAt:Date.now(),signature,range:st.range,min:st.min,max:st.max,avg:st.avg,points:st.points,bedTemp:_bedLevelFiniteOrNull(ctx.bedTemp??s.bed?.actual),bedTarget:_bedLevelFiniteOrNull(ctx.bedTarget??s.bed?.target),hotendTemp:_bedLevelFiniteOrNull(s.hotend?.actual),high:diag?.high||'',low:diag?.low||'',geometry:diag?.geometry||''});
  if(!entry)return null;
  _bedLevelHistorySave([entry,..._bedLevelHistoryAll().filter(x=>x.id!==entry.id)]);_bedLevelHistoryRender(id,st);_bedLevelHistorySyncRemote().catch(()=>{});return entry;
}
function _bedLevelAge(ts){
  const ms=Math.max(0,Date.now()-Number(ts||0)),min=Math.floor(ms/60000);if(min<1)return'hace menos de 1 min';if(min<60)return`hace ${min} min`;const h=Math.floor(min/60);if(h<24)return`hace ${h} h`;const d=Math.floor(h/24);return`hace ${d} día${d===1?'':'s'}`;
}
function _bedLevelVerifiedEntry(id,signature){
  const shared=_bedLevelHistoryMatch(id,signature);if(shared)return{...shared,verifiedSource:'shared'};
  const local=_bedLevelMetaRead(id,signature);return local?{...local,machineId:id,verifiedSource:'local'}:null;
}
function _bedLevelAssessment(id,st,material=''){
  if(!st)return{code:'no-mesh',level:'warn',strongConfirm:true,color:'#ff5555',label:'SIN MALLA ACTIVA',detail:'Moonraker no tiene un bed mesh activo. Calibra o carga una malla antes de producción.'};
  const signature=_bedLevelSignature(st),verified=_bedLevelVerifiedEntry(id,signature),range=Number(st.range)||0,um=Math.round(range*1000);
  if(!verified)return{code:'unverified',level:'warn',strongConfirm:true,color:'#ffaa00',label:'MALLA NO VERIFICADA',detail:`La malla activa mide ${um} µm, pero no coincide con ninguna calibración verificada en el historial.`,signature,range};
  const ageDays=(Date.now()-Number(verified.calibratedAt))/86400000,expected=_bedLevelTypicalBedTemp(material),actualBed=_bedLevelFiniteOrNull(verified.bedTemp);
  if(range>0.80)return{code:'extreme',level:'warn',strongConfirm:true,color:'#ff5555',label:'CORREGIR FÍSICAMENTE',detail:`Malla activa verificada: ${um} µm. Desnivel extremo; revisa la cama antes de iniciar.`,signature,range,verified};
  if(range>0.40)return{code:'high',level:'warn',strongConfirm:false,color:'#ff5555',label:'REVISAR Y RECALIBRAR',detail:`Malla activa verificada: ${um} µm. Conviene corregir mecánicamente y recalibrar.`,signature,range,verified};
  if(ageDays>=7)return{code:'old',level:'warn',strongConfirm:false,color:'#ffaa00',label:'RECALIBRAR POR ANTIGÜEDAD',detail:`La malla activa coincide con una calibración verificada ${_bedLevelAge(verified.calibratedAt)}.`,signature,range,verified};
  if(expected>0&&actualBed!==null&&Math.abs(expected-actualBed)>=20)return{code:'thermal',level:'warn',strongConfirm:false,color:'#ffaa00',label:'RECALIBRAR A TEMPERATURA DE TRABAJO',detail:`Malla activa verificada a ${actualBed.toFixed(0)} °C; ${material||'este material'} suele trabajar cerca de ${expected} °C.`,signature,range,verified};
  return{code:'ok',level:'pass',strongConfirm:false,color:'#00d4aa',label:'MALLA VERIFICADA',detail:`Malla activa = calibración verificada ${_bedLevelAge(verified.calibratedAt)} · ${um} µm${actualBed!==null?' · cama '+actualBed.toFixed(0)+' °C':''}.`,signature,range,verified};
}
function _bedLevelRecommendation(id,st=null,material=''){return _bedLevelAssessment(id,st,material);}
function _bedLevelHistoryTrendSvg(rows){
  const data=(rows||[]).slice(0,8).reverse();if(!data.length)return'';const W=260,H=58,pad=7,max=Math.max(400,...data.map(x=>Math.max(0,Number(x.range)||0)*1000));
  const x=i=>data.length===1?W/2:pad+i*(W-pad*2)/(data.length-1),y=v=>H-pad-Math.min(1,Math.max(0,v/max))*(H-pad*2),pts=data.map((r,i)=>`${x(i).toFixed(1)},${y((Number(r.range)||0)*1000).toFixed(1)}`).join(' ');
  const dots=data.map((r,i)=>`<circle cx="${x(i)}" cy="${y((Number(r.range)||0)*1000)}" r="3.2" fill="${Number(r.range)>0.4?'#ff5555':Number(r.range)>0.25?'#ffaa00':'#00d4aa'}"><title>${Math.round(Number(r.range)*1000)} µm · ${new Date(r.calibratedAt).toLocaleString('es-CL')}</title></circle>`).join('');
  return`<svg viewBox="0 0 ${W} ${H}" width="100%" height="58"><line x1="${pad}" y1="${y(400)}" x2="${W-pad}" y2="${y(400)}" stroke="rgba(255,170,0,.32)" stroke-dasharray="4 3"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}</svg>`;
}
function _bedLevelHistoryMarkup(id){
  const rows=_bedLevelHistoryFor(id),latest=rows[0];if(!latest)return'<div style="font-size:9.5px;color:var(--text3)">Aún no hay calibraciones verificadas compartidas.</div>';
  const recent=rows.slice(0,8),temp=_bedLevelFiniteOrNull(latest.bedTemp);
  return`<div style="font-size:9px;color:var(--text3);margin-bottom:3px">ÚLTIMAS ${recent.length} CALIBRACIONES VERIFICADAS</div>${_bedLevelHistoryTrendSvg(recent)}<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:9.5px;color:var(--text3)"><span>Última: <b style="color:var(--text2)">${Math.round(Number(latest.range)*1000)} µm</b></span><span>Cama: <b style="color:var(--text2)">${temp===null?'—':temp.toFixed(0)+' °C'}</b></span><span>${_bedLevelAge(latest.calibratedAt)}</span></div>`;
}
function _bedLevelHistoryRender(id,st=null,material=''){
  const hist=document.getElementById('pcBedHistory_'+id),rec=document.getElementById('pcBedRecommendation_'+id);if(hist)hist.innerHTML=_bedLevelHistoryMarkup(id);
  if(rec){const r=_bedLevelRecommendation(id,st,material);rec.innerHTML=`<b style="color:${r.color}">${r.label}</b><span style="color:var(--text3)"> · ${r.detail}</span>`;rec.style.borderColor=r.color;rec.style.background='color-mix(in srgb, '+r.color+' 7%, transparent)';}
}
function _bedLevelSetState(id,label,color='var(--text3)'){
  const el=document.getElementById('pcBedLevelState_'+id);if(el){el.textContent=label||'';el.style.color=color;el.style.borderColor=color;el.style.background=color==='var(--text3)'?'var(--surface)':'color-mix(in srgb, '+color+' 10%, transparent)';}
}
function _bedLevelSetStatus(id,text,color){const el=document.getElementById('pcBedLevelRun_'+id);if(el){el.textContent=text||'';el.style.color=color||'var(--text3)';}}
function _bedLevelSetSource(id,st,opts={}){
  const el=document.getElementById('pcBedLevelSource_'+id);if(!el||!st)return;const sig=_bedLevelSignature(st),verified=_bedLevelVerifiedEntry(id,sig);
  if(verified){
    const when=new Date(verified.calibratedAt).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),temp=_bedLevelFiniteOrNull(verified.bedTemp);
    el.innerHTML=`<b style="color:#00d4aa">✓ MALLA = CALIBRACIÓN VERIFICADA</b> · ${when} · ${_bedLevelAge(verified.calibratedAt)}${temp===null?'':' · cama '+temp.toFixed(0)+' °C'}<br><span style="color:var(--text3)">Firma de la malla activa coincide con el registro ${verified.verifiedSource==='shared'?'compartido':'local'}.</span>`;
  }else el.innerHTML=`<b style="color:#ffaa00">⚠ MALLA ACTIVA NO VERIFICADA</b><br><span style="color:var(--text3)">La malla existe, pero su firma no coincide con una calibración verificada.</span>`;
}
function _bedLevelSetBusy(id,busy,label){
  const btn=document.getElementById('pcBedAuto_'+id);if(btn){btn.disabled=!!busy;btn.textContent=busy?(label||'⏳ CALIBRANDO…'):'⚙ CALIBRAR AUTOMÁTICAMENTE';btn.style.opacity=busy?'.72':'1';btn.style.cursor=busy?'not-allowed':'pointer';}
  ['pcBedRefresh_','pcBedMap_','pcBedCold_','pcBedPla_','pcBedPetg_','pcBedAbs_'].forEach(prefix=>{const el=document.getElementById(prefix+id);if(!el)return;el.disabled=!!busy;el.style.opacity=busy?'.45':'1';el.style.cursor=busy?'not-allowed':'pointer';});
}
function _bedLevelMarkPrevious(id){const src=document.getElementById('pcBedLevelSource_'+id);if(src)src.innerHTML='<b style="color:#ffaa00">VALOR ANTERIOR</b><br><span style="color:var(--text3)">La cifra visible corresponde a la malla previa. Se reemplazará cuando termine y se verifique la nueva calibración.</span>';}
function _bedLevelRestoreRunUi(id){
  const run=_bedLevelRuns[id];if(!run?.active)return false;const elapsed=Math.max(0,Math.floor((Date.now()-run.startedAt)/1000));
  _bedLevelSetBusy(id,true,`⏳ ${run.uiLabel||'CALIBRANDO'} · ${elapsed}s`);_bedLevelSetState(id,run.uiLabel||'CALIBRANDO','#ffaa00');_bedLevelSetStatus(id,run.phaseText||'Calibrando cama…','#ffaa00');_bedLevelMarkPrevious(id);return true;
}
function _bedLevelRenderStats(id,st,opts={}){
  const value=document.getElementById('pcBedLevelValue_'+id),gradeEl=document.getElementById('pcBedLevelGrade_'+id),detail=document.getElementById('pcBedLevelDetail_'+id),fill=document.getElementById('pcBedLevelFill_'+id),marker=document.getElementById('pcBedLevelMarker_'+id);if(!st)return;
  const g=_bedLevelGrade(st.range),pct=Math.max(0,Math.min(100,(st.range/0.60)*100)),diag=_bedLevelDiagnose(st);
  if(value)value.textContent=(st.range*1000).toFixed(0)+' µm';if(gradeEl){gradeEl.textContent=g.label;gradeEl.style.color=g.color;}
  if(detail)detail.textContent=`mín ${st.min.toFixed(3)} mm (${_bedLevelPositionLabel(st,st.minPos)}) · máx ${st.max.toFixed(3)} mm (${_bedLevelPositionLabel(st,st.maxPos)}) · prom ${st.avg.toFixed(3)} mm · ${st.points} puntos${diag?.fit?' · '+diag.fit.shape:''}`;
  if(fill){fill.style.width=pct+'%';fill.style.background=g.color;}if(marker){marker.style.left=`calc(${pct}% - 5px)`;marker.style.background=g.color;}
  _bedLevelSetSource(id,st,opts);if(opts.verifiedAt)_bedLevelSetState(id,'CALIBRADA AHORA','#00d4aa');else _bedLevelSetState(id,'MALLA ACTIVA',g.color);
  if(opts.status!==false)_bedLevelSetStatus(id,opts.statusText||`Malla leída ahora · ${new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`,g.color);_bedLevelHistoryRender(id,st,opts.material||'');
}
async function _bedLevelReadActive(id,timeout=9000){
  const data=await _moonrakerGet(id,'/printer/objects/query?bed_mesh',timeout);if(!data?.result?.status)return{ok:false,st:null,data:null};const st=_bedLevelStats(data.result.status.bed_mesh);_bedLevelObservationWrite(id,st,!!st);return{ok:true,st,data};
}
async function printerBedLevelRefresh(id,opts={}){
  const value=document.getElementById('pcBedLevelValue_'+id),gradeEl=document.getElementById('pcBedLevelGrade_'+id),detail=document.getElementById('pcBedLevelDetail_'+id),fill=document.getElementById('pcBedLevelFill_'+id),marker=document.getElementById('pcBedLevelMarker_'+id);
  if(!value&&!detail)return null;if(_bedLevelRuns[id]?.active&&!opts.forceDuringRun){_bedLevelRestoreRunUi(id);return null;}
  if(!opts.quietStatus){_bedLevelSetState(id,'LEYENDO','var(--text3)');_bedLevelSetStatus(id,'Leyendo malla activa desde Moonraker…','var(--text3)');}
  const read=await _bedLevelReadActive(id,9000);
  if(!read.ok){
    if(value)value.textContent='—';if(gradeEl){gradeEl.textContent='SIN RESPUESTA';gradeEl.style.color='var(--danger)';}if(detail)detail.textContent='No se pudo leer la malla desde Moonraker.';if(fill)fill.style.width='0%';if(marker)marker.style.left='0%';const src=document.getElementById('pcBedLevelSource_'+id);if(src)src.textContent='No hay una lectura confiable disponible.';_bedLevelSetState(id,'SIN RESPUESTA','var(--danger)');_bedLevelSetStatus(id,'Moonraker no respondió','var(--danger)');return null;
  }
  const st=read.st;if(!st){
    if(value)value.textContent='—';if(gradeEl){gradeEl.textContent='SIN MALLA';gradeEl.style.color='#ff5555';}if(detail)detail.textContent='Moonraker no tiene una malla activa. Ejecuta calibración o carga un perfil antes de producción.';if(fill)fill.style.width='0%';if(marker)marker.style.left='0%';const src=document.getElementById('pcBedLevelSource_'+id);if(src)src.innerHTML='<b style="color:#ff5555">SIN MALLA ACTIVA</b><br><span style="color:var(--text3)">El historial no sustituye una malla cargada en la impresora.</span>';_bedLevelSetState(id,'SIN MALLA','#ff5555');_bedLevelSetStatus(id,'Sin bed mesh activo','#ff5555');_bedLevelHistoryRender(id,null,opts.material||'');return null;
  }
  _bedLevelRenderStats(id,st,{status:!opts.quietStatus,statusText:opts.statusText,verifiedAt:opts.verifiedAt,material:opts.material});
  if(opts.announce){const a=_bedLevelAssessment(id,st,opts.material||'');toast(`🛏 ${(st.range*1000).toFixed(0)} µm · ${a.label}`,a.level==='pass'?'success':st.range<=0.40?'info':'error');}return st;
}
async function getBedLevelPreflightFact(id,material=''){
  try{
    const read=await _bedLevelReadActive(id,9000);
    if(!read.ok){const obs=_bedLevelObservationRead(id),fresh=obs&&Date.now()-Number(obs.observedAt)<30000;return{code:'unreachable',level:'warn',strongConfirm:true,detail:fresh?'No se pudo verificar Moonraker en vivo; la última lectura reciente no reemplaza la validación previa al inicio.':'No se pudo verificar en vivo la malla activa de Moonraker.'};}
    let a=_bedLevelAssessment(id,read.st,material);
    // Airtable no forma parte del camino crítico si ya hay una coincidencia local.
    // Solo esperamos una lectura compartida cuando la malla activa aún aparece no verificada.
    if(a.code==='unverified'){
      await _bedLevelHistoryLoadRemote(true).catch(()=>false);
      a=_bedLevelAssessment(id,read.st,material);
    }else _bedLevelHistoryLoadRemote(false).catch(()=>{});
    return{...a,detail:a.detail,activeSignature:read.st?_bedLevelSignature(read.st):'',activeRange:read.st?.range??null};
  }catch(e){return{code:'error',level:'warn',strongConfirm:true,detail:'Error verificando malla activa: '+(e?.message||'desconocido')};}
}
if(typeof window!=='undefined')window.getBedLevelPreflightFact=getBedLevelPreflightFact;

function _bedLevelSleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function _bedLevelReadBedTemp(id){const data=await _moonrakerGet(id,'/printer/objects/query?heater_bed',7000),bed=data?.result?.status?.heater_bed;return{actual:_bedLevelFiniteOrNull(bed?.temperature),target:_bedLevelFiniteOrNull(bed?.target)};}
function _bedLevelPreset(preset){
  const p=String(preset||'current').toLowerCase();if(p==='cold')return{key:'cold',label:'EN FRÍO',target:0};if(p==='pla')return{key:'pla',label:'PLA 60 °C',target:60};if(p==='petg')return{key:'petg',label:'PETG 75 °C',target:75};if(p==='abs'||p==='asa')return{key:'abs',label:'ABS/ASA 100 °C',target:100};return{key:'current',label:'TEMPERATURA ACTUAL',target:null};
}
async function _bedLevelWaitTemperature(id,preset,run){
  if(preset.target===null)return true;run.uiLabel=preset.key==='cold'?'ENFRIANDO':'ESTABILIZANDO';
  const setOk=await _sendGcode(id,`M140 S${preset.target}`,null,{timeout:15000,allowBusy:true});if(!setOk)return false;
  const timeout=preset.key==='cold'?1200000:900000,started=Date.now();let stableSince=0;
  while(Date.now()-started<timeout){
    if(!run.active||run.cancelled)return false;const t=await _bedLevelReadBedTemp(id),actual=t.actual;
    if(actual===null){run.phaseText=`${run.uiLabel} · esperando telemetría de cama…`;_bedLevelSetStatus(id,run.phaseText,'#ffaa00');await _bedLevelSleep(2500);continue;}
    const ready=preset.key==='cold'?actual<=35:Math.abs(actual-preset.target)<=1.5;if(ready){if(!stableSince)stableSince=Date.now();}else stableSince=0;
    const need=preset.key==='cold'?10000:20000,remain=Math.max(0,Math.ceil((need-(stableSince?Date.now()-stableSince:0))/1000));
    run.phaseText=preset.key==='cold'?`ENFRIANDO · cama ${actual.toFixed(1)} °C · objetivo ≤35 °C${ready?' · estabilizando '+remain+'s':''}`:`ESTABILIZANDO · cama ${actual.toFixed(1)} / ${preset.target} °C${ready?' · soak '+remain+'s':''}`;
    _bedLevelSetBusy(id,true,`⏳ ${run.uiLabel} · ${Math.floor((Date.now()-run.startedAt)/1000)}s`);_bedLevelSetState(id,run.uiLabel,'#ffaa00');_bedLevelSetStatus(id,run.phaseText,'#ffaa00');
    if(stableSince&&Date.now()-stableSince>=need)return true;await _bedLevelSleep(2000);
  }
  return false;
}
async function _bedLevelWaitForCompletion(id,beforeSig,timeoutMs){
  const started=Date.now();let sawCleared=false,sawDifferent=false;
  while(Date.now()-started<timeoutMs){
    const run=_bedLevelRuns[id];if(!run?.active||run.cancelled)return null;const elapsed=Math.max(1,Math.round((Date.now()-run.startedAt)/1000));run.uiLabel='CALIBRANDO';_bedLevelSetBusy(id,true,`⏳ CALIBRANDO · ${elapsed}s`);_bedLevelSetState(id,'CALIBRANDO','#ffaa00');
    const read=await _bedLevelReadActive(id,9000);
    if(read.ok){
      const st=read.st;if(!st){sawCleared=true;run.phaseText='CALIBRANDO · malla anterior limpiada · midiendo puntos…';_bedLevelSetStatus(id,run.phaseText,'#ffaa00');}
      else{const sig=_bedLevelSignature(st);if(beforeSig&&sig!==beforeSig)sawDifferent=true;if(sawCleared||sawDifferent||!beforeSig){run.observedFresh=true;return st;}run.phaseText='CALIBRANDO · esperando la nueva malla…';_bedLevelSetStatus(id,run.phaseText,'#ffaa00');}
    }else{run.phaseText='CALIBRANDO · esperando respuesta de Moonraker…';_bedLevelSetStatus(id,run.phaseText,'#ffaa00');}
    await _bedLevelSleep(1200);
  }
  return null;
}
async function _bedLevelRefreshAfterFailure(id,message){
  const run=_bedLevelRuns[id];if(run)run.active=false;const st=await printerBedLevelRefresh(id,{forceDuringRun:true,quietStatus:true,statusText:message});if(st){_bedLevelSetState(id,'MALLA NO VERIFICADA','#ffaa00');_bedLevelSetStatus(id,message,'#ffaa00');}return st;
}
async function printerAutoBedCalibrate(id,presetKey='current'){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;if(_bedLevelRuns[id]?.active){toast('⏳ Esta impresora ya está calibrando la cama','info');return;}if(!_printerControlFresh(id)){toast('🔒 '+_printerControlReason(id)+' — no se puede calibrar','error');return;}if(_isPrinterBusy(_pcState(id))){toast('🔒 Está imprimiendo o pausada — la calibración de cama está bloqueada','error');return;}
  const preset=_bedLevelPreset(presetKey);if(!confirm(`🛏 Calibrar automáticamente la cama de ${m.nombre} #${m.numG}?\n\nModo: ${preset.label}.\n\nLa impresora hará HOME, BED_MESH_CLEAR y BED_MESH_CALIBRATE. La cifra actual se marcará como VALOR ANTERIOR hasta verificar la nueva malla.\n\nAsegúrate de que la cama esté despejada.`))return;
  const timeoutMs=_bedLevelTimeoutMs(m),run={active:true,cancelled:false,startedAt:Date.now(),phaseText:'Preparando calibración…',uiLabel:preset.target===null?'CALIBRANDO':preset.key==='cold'?'ENFRIANDO':'ESTABILIZANDO',observedFresh:false,preset};
  _bedLevelRuns[id]=run;_bedLevelSetBusy(id,true,`⏳ ${run.uiLabel} · 0s`);_bedLevelSetState(id,run.uiLabel,'#ffaa00');_bedLevelSetStatus(id,run.phaseText,'#ffaa00');_bedLevelMarkPrevious(id);
  try{renderMonitorKPIs();renderMonitorGrid();}catch(_){}
  try{
    const thermalOk=await _bedLevelWaitTemperature(id,preset,run);if(!thermalOk){run.cancelled=true;await _bedLevelRefreshAfterFailure(id,'⚠ No se alcanzó una temperatura estable para calibrar.');toast('No se pudo estabilizar la temperatura de cama','error');return;}
    const beforeRead=await _bedLevelReadActive(id,9000),before=beforeRead.st,beforeSig=_bedLevelSignature(before);run.beforeRange=before?.range??null;run.beforeSig=beforeSig;run.uiLabel='CALIBRANDO';run.phaseText='CALIBRANDO · iniciando HOME…';
    const tempStart=await _bedLevelReadBedTemp(id);run.bedTempStart=tempStart.actual;run.bedTargetStart=tempStart.target;
    const waitPromise=_bedLevelWaitForCompletion(id,beforeSig,timeoutMs),ok=await _sendGcode(id,'G28\nBED_MESH_CLEAR\nBED_MESH_CALIBRATE',null,{timeout:timeoutMs+30000});
    if(!ok){run.cancelled=true;await _bedLevelRefreshAfterFailure(id,'⚠ La calibración falló. Se releyó la malla real de Moonraker.');toast('No se pudo completar la calibración de cama','error');return;}
    run.phaseText='VERIFICANDO · comprobando malla nueva…';run.uiLabel='VERIFICANDO';_bedLevelSetState(id,'VERIFICANDO','#38bdf8');_bedLevelSetStatus(id,run.phaseText,'#38bdf8');
    let after=await waitPromise;if(!after){const current=await _bedLevelReadActive(id,9000);if(current.st&&(!beforeSig||_bedLevelSignature(current.st)!==beforeSig))after=current.st;}
    if(!after){await _bedLevelRefreshAfterFailure(id,'⚠ Terminó el comando, pero no se pudo demostrar que la malla visible sea nueva.');toast('Calibración terminada, pero la malla nueva no pudo verificarse','error');return;}
    const verifiedAt=Date.now(),tempEnd=await _bedLevelReadBedTemp(id),bedTemp=tempEnd.actual??run.bedTempStart,bedTarget=tempEnd.target??run.bedTargetStart,meta=_bedLevelMetaWrite(id,after,{calibratedAt:verifiedAt,bedTemp,bedTarget});
    _bedLevelHistoryAppend(id,after,{calibratedAt:verifiedAt,bedTemp,bedTarget});
    const delta=before?after.range-before.range:null;let resultText='Calibración nueva verificada';if(delta!==null&&Math.abs(delta)>=0.005)resultText+=delta<0?` · mejoró ${Math.abs(delta*1000).toFixed(0)} µm`:` · aumentó ${Math.abs(delta*1000).toFixed(0)} µm`;else if(delta!==null)resultText+=' · cambio <5 µm';
    _bedLevelRenderStats(id,after,{statusText:resultText,verifiedAt:meta?.calibratedAt||verifiedAt});const g=_bedLevelGrade(after.range);toast(`🛏 ${resultText} · ${(after.range*1000).toFixed(0)} µm · ${g.label}`,after.range<=0.25?'success':after.range<=0.40?'info':'error');_audit3DRefreshBurst([1500,8000,30000]);
  }finally{
    run.active=false;_bedLevelSetBusy(id,false);
    try{renderMonitorKPIs();renderMonitorGrid();}catch(_){}
  }
}
function _bedLevelCapabilitiesFromConfig(configfile){
  const settings=configfile?.settings||configfile?.config||{},keys=Object.keys(settings||{}).map(k=>String(k).toLowerCase());return{screwsTilt:keys.some(k=>k==='screws_tilt_adjust'||k.startsWith('screws_tilt_adjust ')),zTilt:keys.some(k=>k==='z_tilt'||k.startsWith('z_tilt '))};
}
async function _bedLevelCapabilities(id){try{const d=await _moonrakerGet(id,'/printer/objects/query?configfile',9000);return _bedLevelCapabilitiesFromConfig(d?.result?.status?.configfile);}catch(_){return{screwsTilt:false,zTilt:false};}}
async function printerScrewsTiltGuide(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;if(!_printerControlFresh(id)||_isPrinterBusy(_pcState(id))){toast('La impresora debe estar libre y con telemetría fresca','error');return;}if(!confirm(`🪛 Ejecutar SCREWS_TILT_CALCULATE en ${m.nombre} #${m.numG}?\n\nLa máquina hará HOME y medirá los puntos configurados.`))return;
  const ok=await _sendGcode(id,'G28\nSCREWS_TILT_CALCULATE',null,{timeout:120000});if(!ok)return;await _bedLevelSleep(1200);
  try{
    const d=await _moonrakerGet(id,'/server/gcode_store?count=80',9000),rows=d?.result?.gcode_store||[],lines=rows.map(x=>String(x?.message||'')).filter(x=>/(cw|ccw|screw|base)/i.test(x)).slice(-20);
    if(!lines.length){toast('SCREWS_TILT_CALCULATE ejecutado. Revisa la consola de Klipper para el detalle.','success');return;}
    const modal=document.createElement('div');modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10020;display:flex;align-items:center;justify-content:center';modal.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border2);border-radius:12px;padding:16px;max-width:620px;width:min(92vw,620px)"><div style="display:flex;justify-content:space-between;gap:10px"><b>🪛 Guía de tornillos · ${escapeHtml(m.nombre)} #${m.numG}</b><button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:var(--text3);font-size:18px">✕</button></div><pre style="white-space:pre-wrap;color:var(--text2);font-size:11px;line-height:1.5;background:#0b0b0b;padding:10px;border-radius:8px;margin-top:10px">${escapeHtml(lines.join('\n'))}</pre><div style="font-size:9.5px;color:var(--text3)">CW = horario · CCW = antihorario. Sigue la referencia que entregue Klipper.</div></div>`;modal.onclick=e=>{if(e.target===modal)modal.remove();};document.body.appendChild(modal);
  }catch(_){toast('Cálculo ejecutado; no pude leer el detalle desde gcode_store','info');}
}
async function printerZTiltAdjust(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;if(!_printerControlFresh(id)||_isPrinterBusy(_pcState(id))){toast('La impresora debe estar libre y con telemetría fresca','error');return;}if(!confirm(`⚙ Ejecutar Z_TILT_ADJUST en ${m.nombre} #${m.numG}?\n\nSolo continúa si la máquina tiene Z_TILT configurado y la cama está despejada.`))return;
  const ok=await _sendGcode(id,'G28\nZ_TILT_ADJUST\nG28',null,{timeout:180000});toast(ok?'Z_TILT_ADJUST completado. Conviene recalibrar el bed mesh.':'No se pudo completar Z_TILT_ADJUST',ok?'success':'error');
}
function printerHome(id){_sendGcode(id,'G28','🏠 Home en curso');}
function printerMotorsOff(id){_sendGcode(id,'M84','Motores liberados');}
function printerJog(id,axis,dist){_sendGcode(id,`G91\nG1 ${axis}${dist} F${axis==='Z'?600:3000}\nG90`,`Mover ${axis} ${dist>0?'+':''}${dist} mm`);}
function printerJogStep(id,axis,sign){
  const sel=document.getElementById('pcJogStep_'+id),step=Math.max(0.1,Math.min(50,Number(sel?.value)||10));
  printerJog(id,axis,step*(sign>=0?1:-1));
}
function printerFilament(id,dir){
  const ht=(_printerStatus[id]||{}).hotend?.actual||0;
  if(ht<170){toast(`🌡️ Nozzle a ${ht}°. Usa “Calentar 220°” y espera ≥170° antes de mover filamento.`,'error');return;}
  const dist=dir==='load'?60:-60;
  _sendGcode(id,`M83\nG1 E${dist} F300\nM82`,dir==='load'?'⬇️ Cargando filamento (60 mm)':'⬆️ Descargando filamento (60 mm)');
}
function printerHeatForFilament(id){_sendGcode(id,'M104 S220','🔥 Nozzle → 220°',{allowBusy:false});}
function printerSetTune(id,type){
  if(!_isPrinterBusy(_pcState(id))){toast('Los ajustes en vivo aparecen durante impresión o pausa','info');return;}
  const input=document.getElementById('pcTune_'+type);if(!input)return;
  let value=Math.round(Number(input.value)||100),script='',label='';
  if(type==='speed'){value=Math.max(50,Math.min(150,value));script=`M220 S${value}`;label=`⚡ Velocidad → ${value}%`;}
  else if(type==='flow'){value=Math.max(80,Math.min(120,value));script=`M221 S${value}`;label=`🧵 Flujo → ${value}%`;}
  else return;
  input.value=value;
  const st=_printerStatus[id];if(st)st[type==='speed'?'speedFactor':'flowFactor']=value;
  _sendGcode(id,script,label,{allowBusy:true});
}
function printerAdjustTune(id,type,delta){
  const input=document.getElementById('pcTune_'+type);if(!input)return;
  input.value=Math.round((Number(input.value)||100)+delta);
  printerSetTune(id,type);
}
function printerSetFan(id,pct){
  if(!_isPrinterBusy(_pcState(id))){toast('El ventilador en vivo se ajusta durante impresión o pausa','info');return;}
  const p=Math.max(0,Math.min(100,Math.round(Number(pct)||0))),s=Math.round(255*p/100);
  _sendGcode(id,p===0?'M107':`M106 S${s}`,`💨 Ventilador → ${p}%`,{allowBusy:true});
}
function printerZAdjust(id,delta){
  if(!_isPrinterBusy(_pcState(id))){toast('El Z-offset en vivo solo está disponible durante impresión o pausa','info');return;}
  const d=Math.max(-0.05,Math.min(0.05,Number(delta)||0));
  if(Math.abs(d)>=0.05&&!confirm(`Ajustar Z ${d>0?'+':''}${d.toFixed(2)} mm durante la impresión?\n\nEste es un control experto. Observa la primera capa mientras lo aplicas.`))return;
  _sendGcode(id,`SET_GCODE_OFFSET Z_ADJUST=${d.toFixed(2)} MOVE=1`,`↕ Z-offset ${d>0?'+':''}${d.toFixed(2)} mm`,{allowBusy:true});
}
function printerEmergencyStop(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(!confirm(`⛔ PARADA DE EMERGENCIA — ${m.nombre} #${m.numG}\n\nDetiene TODO de inmediato y deja el firmware apagado hasta reiniciarlo. Úsalo solo ante un peligro real.\n\n¿Continuar?`))return;
  const ip=getPrinterIp(m);
  fetch(printerUrl(ip,'/printer/emergency_stop'),{method:'POST',headers:getPrinterAuthHeaders(id),signal:AbortSignal.timeout(6000)}).then(r=>{
    if(!r.ok)throw new Error('HTTP '+r.status);
    toast('⛔ Parada de emergencia confirmada','info');setTimeout(pollPrinters,1000);
  }).catch(e=>toast('No se pudo confirmar la parada de emergencia: '+(e?.message||'sin conexión'),'error'));
}

// Archivos en la impresora
async function loadPrinterFiles(id){
  const cont=document.getElementById('pcFiles');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Cargando archivos…</div>';
  const d=await _moonrakerGet(id,'/server/files/list?root=gcodes');
  if(!d||!Array.isArray(d.result)){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">No se pudo leer la lista de archivos</div>';return;}
  const files=d.result.sort((a,b)=>(b.modified||0)-(a.modified||0)).slice(0,30);
  const busy=_isPrinterBusy(_pcState(id));
  cont.innerHTML=files.length?files.map(f=>{
    const kb=Math.round((f.size||0)/1024),path=escapeHtml(f.path||'');
    return`<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${path}">${path}</div><div style="font-size:10px;color:var(--text3)">${kb.toLocaleString('es-CL')} KB</div></div>
      <button data-f="${path}" onclick="reprintFile('${id}',this.dataset.f)" ${busy?'disabled':''} style="background:${busy?'var(--surface3)':'rgba(0,212,170,0.15)'};border:1px solid ${busy?'var(--border2)':'rgba(0,212,170,0.4)'};color:${busy?'var(--text3)':'#00d4aa'};border-radius:6px;padding:4px 10px;font-size:10.5px;font-weight:700;cursor:${busy?'not-allowed':'pointer'};flex-shrink:0">▶ Imprimir</button>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:12px;padding:8px">Sin archivos g-code en esta impresora</div>';
}
async function reprintFile(id,filename){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('🔒 La impresora ya está ocupada','error');return;}
  if(window.MachineOps?.startExistingFile){
    closePrinterControl();
    return window.MachineOps.startExistingFile(id,filename);
  }
  toast('Centro de operaciones no disponible: no se inicia una impresión sin preflight','error');
}
// Historial real de Moonraker (para costos)
async function loadPrinterHistory(id){
  const cont=document.getElementById('pcHistory');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Cargando historial…</div>';
  const d=await _moonrakerGet(id,'/server/history/list?limit=15&order=desc');
  if(!d||!d.result||!Array.isArray(d.result.jobs)){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Historial no disponible (la impresora necesita el componente [history] de Moonraker, activo por defecto en Fluidd/Mainsail)</div>';return;}
  const jobs=d.result.jobs;
  if(!jobs.length){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Sin trabajos registrados aún</div>';return;}
  let totT=0,totF=0,ok=0;
  jobs.forEach(j=>{totT+=j.print_duration||0;totF+=j.filament_used||0;if(j.status==='completed')ok++;});
  const rows=jobs.map(j=>{
    const fn=escapeHtml((j.filename||'—').replace(/\.gcode$/i,''));
    const dur=fmtSecs(j.print_duration||0),fm=((j.filament_used||0)/1000).toFixed(1);
    const okj=j.status==='completed';
    return`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${fn}">${fn}</td>
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text3);text-align:right">${dur}</td>
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text3);text-align:right">${fm} m</td>
      <td style="padding:5px 6px;text-align:right"><span style="font-size:10px;font-weight:700;color:${okj?'#00d4aa':'#ff6b35'}">${okj?'✓':'✕'}</span></td>
    </tr>`;
  }).join('');
  cont.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span class="badge badge-green">${jobs.length} trabajos · ${ok} ok</span>
      <span class="badge badge-gray">⏱ ${fmtSecs(totT)} totales</span>
      <span class="badge badge-gray">🧵 ${(totF/1000).toFixed(1)} m filamento</span>
    </div>
    <table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text3)">
      <th style="text-align:left;font-size:10px;padding:3px 6px;font-weight:600">ARCHIVO</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">TIEMPO</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">FILAM.</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">OK</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}
// Modal de control
function openPrinterControl(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Configura primero la IP de esta impresora','error');return;}
  const s=_printerStatus[id]||{},busy=_isPrinterBusy(s.state),fresh=_printerControlFresh(id);
  const motionLocked=busy||!fresh,tempLocked=!fresh,active=busy;
  document.getElementById('pcTitle').textContent=`${m.nombre} #${m.numG} · CONTROL`;
  const button=(label,onclick,disabled=false,extra='')=>`<button onclick="${onclick}" ${disabled?'disabled':''} style="background:${disabled?'var(--surface3)':'var(--surface2)'};border:1px solid var(--border2);color:${disabled?'var(--text3)':'var(--text)'};border-radius:9px;padding:8px 11px;font-size:12px;font-weight:700;cursor:${disabled?'not-allowed':'pointer'};${extra}">${label}</button>`;
  const printActions=s.state==='printing'
    ?`<button onclick="printerControl('${id}','pause')" style="flex:1;background:rgba(255,170,0,.14);border:1px solid rgba(255,170,0,.45);color:#ffaa00;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">⏸ PAUSAR</button><button onclick="printerControl('${id}','cancel')" style="flex:1;background:rgba(255,68,68,.12);border:1px solid rgba(255,68,68,.4);color:#ff4444;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">■ DETENER</button>`
    :s.state==='paused'
      ?`<button onclick="printerControl('${id}','resume')" style="flex:1;background:rgba(0,212,170,.14);border:1px solid rgba(0,212,170,.45);color:#00d4aa;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">▶ REANUDAR</button><button onclick="printerControl('${id}','cancel')" style="flex:1;background:rgba(255,68,68,.12);border:1px solid rgba(255,68,68,.4);color:#ff4444;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">■ DETENER</button>`:'';
  const lockBanner=!fresh
    ?`<div style="background:rgba(255,68,68,.08);border:1px solid rgba(255,68,68,.32);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#ff7777">🔒 <b>Control bloqueado:</b> ${escapeHtml(_printerControlReason(id))}. Los comandos se habilitan cuando vuelva telemetría fresca.</div>`
    :busy?`<div style="background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.32);border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#ffaa00">🛡️ <b>Impresión activa:</b> movimiento, Home, filamento, precalentados y enfriado están bloqueados. Temperatura, velocidad, flujo y ventilador siguen disponibles.</div>`:'';
  const hotTarget=s.hotend?.target||s.hotend?.actual||0,bedTarget=s.bed?.target||s.bed?.actual||0;
  const speed=Math.max(50,Math.min(150,Number(s.speedFactor)||100)),flow=Math.max(80,Math.min(120,Number(s.flowFactor)||100));
  document.getElementById('pcBody').innerHTML=`
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <span style="padding:4px 9px;border-radius:999px;background:${fresh?'rgba(0,212,170,.12)':'rgba(255,68,68,.1)'};border:1px solid ${fresh?'rgba(0,212,170,.3)':'rgba(255,68,68,.3)'};color:${fresh?'#00d4aa':'#ff6666'};font-size:11px;font-weight:800">${fresh?'● EN LÍNEA':'● SIN CONTROL'}</span>
      <span style="font-size:11px;color:var(--text3)">${escapeHtml(s.filename||'Sin trabajo activo')}</span>
      <button onclick="closePrinterControl();openWebcamModal('${id}')" style="margin-left:auto;background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer">📷 CÁMARA</button>
    </div>
    ${printActions?`<div style="display:flex;gap:8px;margin-bottom:12px">${printActions}</div>`:''}
    ${lockBanner}
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🌡️ Temperaturas</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:10px">
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:11px;padding:10px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:7px">NOZZLE · <b style="color:var(--text)">${s.hotend?.actual||0}°</b> ${s.hotend?.target>0?'→ '+s.hotend.target+'°':''}</div>
        <div style="display:flex;gap:5px">${button('−5°',`printerAdjustTemp('${id}','hotend',-5)`,tempLocked,'padding:7px 9px')}<input id="pcTemp_hotend" type="number" min="0" max="300" value="${hotTarget}" ${tempLocked?'disabled':''} style="width:74px;flex:1;min-width:64px;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:7px;color:var(--text);font-size:12px;text-align:center">${button('+5°',`printerAdjustTemp('${id}','hotend',5)`,tempLocked,'padding:7px 9px')}<button onclick="setPrinterTemp('${id}','hotend')" ${tempLocked?'disabled':''} style="background:${tempLocked?'var(--surface3)':'var(--accent)'};border:none;color:${tempLocked?'var(--text3)':'#07110f'};border-radius:8px;padding:7px 10px;font-weight:800;cursor:${tempLocked?'not-allowed':'pointer'}">OK</button></div>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:11px;padding:10px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:7px">CAMA · <b style="color:var(--text)">${s.bed?.actual||0}°</b> ${s.bed?.target>0?'→ '+s.bed.target+'°':''}</div>
        <div style="display:flex;gap:5px">${button('−5°',`printerAdjustTemp('${id}','bed',-5)`,tempLocked,'padding:7px 9px')}<input id="pcTemp_bed" type="number" min="0" max="120" value="${bedTarget}" ${tempLocked?'disabled':''} style="width:74px;flex:1;min-width:64px;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:7px;color:var(--text);font-size:12px;text-align:center">${button('+5°',`printerAdjustTemp('${id}','bed',5)`,tempLocked,'padding:7px 9px')}<button onclick="setPrinterTemp('${id}','bed')" ${tempLocked?'disabled':''} style="background:${tempLocked?'var(--surface3)':'#ffaa00'};border:none;color:#111;border-radius:8px;padding:7px 10px;font-weight:800;cursor:${tempLocked?'not-allowed':'pointer'}">OK</button></div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px"><span style="font-size:10px;color:var(--text3);align-self:center">Precalentar:</span>${Object.keys(PREHEAT_PRESETS).map(mat=>button(mat,`preheatPrinter('${id}','${mat}')`,motionLocked,'padding:5px 10px')).join('')}${button('❄️ ENFRIAR',`cooldownPrinter('${id}')`,motionLocked,'padding:5px 10px;margin-left:auto')}</div>

    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🛏 Nivelación de cama</div>
    <div id="pcBedLevel_${id}" style="background:var(--surface2);border:1px solid var(--border2);border-radius:11px;padding:12px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;align-items:center">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px"><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.8px">Desnivel máximo de la malla activa</span><span id="pcBedLevelState_${id}" style="font-size:9px;font-weight:900;letter-spacing:.6px;border:1px solid var(--text3);border-radius:999px;padding:3px 7px;color:var(--text3)">LEYENDO</span></div>
          <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
            <span id="pcBedLevelValue_${id}" style="font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:var(--text)">—</span>
            <span id="pcBedLevelGrade_${id}" style="font-size:11px;font-weight:900;color:var(--text3)">LEYENDO…</span>
          </div>
          <div style="position:relative;height:10px;border-radius:999px;background:linear-gradient(to right,#00d4aa 0%,#38bdf8 35%,#ffaa00 68%,#ff5555 100%);margin:9px 0 7px;overflow:visible">
            <div id="pcBedLevelFill_${id}" style="position:absolute;inset:0 auto 0 0;width:0%;border-radius:999px;background:#00d4aa;opacity:.24"></div>
            <span id="pcBedLevelMarker_${id}" style="position:absolute;top:-3px;left:0;width:10px;height:16px;border-radius:5px;background:var(--text3);box-shadow:0 0 0 2px var(--surface2)"></span>
          </div>
          <div style="position:relative;height:13px;font-size:9px;color:var(--text3)"><span style="position:absolute;left:0">0 µm</span><span style="position:absolute;left:25%;transform:translateX(-50%)">150</span><span style="position:absolute;left:41.67%;transform:translateX(-50%)">250</span><span style="position:absolute;left:66.67%;transform:translateX(-50%)">400</span><span style="position:absolute;right:0">600+ µm</span></div>
          <div id="pcBedLevelDetail_${id}" style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.4">Leyendo bed mesh…</div>
          <div id="pcBedLevelSource_${id}" style="font-size:9.5px;color:var(--text3);margin-top:7px;line-height:1.4;padding:7px 8px;border:1px solid var(--border2);border-radius:7px;background:var(--surface)">Identificando procedencia de la malla…</div>
          <div id="pcBedLevelRun_${id}" style="font-size:10px;color:var(--text3);margin-top:7px;font-weight:800">Estado: leyendo…</div>
          <div id="pcBedRecommendation_${id}" style="font-size:9.5px;line-height:1.4;margin-top:7px;padding:7px 8px;border:1px solid var(--border2);border-radius:7px;background:var(--surface)">Analizando si conviene recalibrar…</div>
          <div id="pcBedHistory_${id}" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border2)"><div style="font-size:9.5px;color:var(--text3)">Cargando historial de calibraciones…</div></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:7px">
          <button id="pcBedAuto_${id}" onclick="printerAutoBedCalibrate('${id}','current')" ${motionLocked?'disabled':''} style="background:${motionLocked?'var(--surface3)':'rgba(0,212,170,.12)'};border:1px solid ${motionLocked?'var(--border2)':'rgba(0,212,170,.4)'};color:${motionLocked?'var(--text3)':'var(--accent)'};border-radius:9px;padding:10px 12px;font-size:11px;font-weight:900;cursor:${motionLocked?'not-allowed':'pointer'}">⚙ CALIBRAR AUTOMÁTICAMENTE</button>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px">
            <button id="pcBedCold_${id}" onclick="printerAutoBedCalibrate('${id}','cold')" style="padding:7px 4px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer">❄ FRÍO</button>
            <button id="pcBedPla_${id}" onclick="printerAutoBedCalibrate('${id}','pla')" style="padding:7px 4px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer">PLA 60°</button>
            <button id="pcBedPetg_${id}" onclick="printerAutoBedCalibrate('${id}','petg')" style="padding:7px 4px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer">PETG 75°</button>
            <button id="pcBedAbs_${id}" onclick="printerAutoBedCalibrate('${id}','abs')" style="padding:7px 4px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:9px;font-weight:800;cursor:pointer">ABS 100°</button>
          </div>
          <div style="font-size:8.8px;color:var(--text3);line-height:1.35">Los presets térmicos esperan estabilidad antes de medir: ±1,5 °C durante 20 s; FRÍO espera ≤35 °C.</div>
          <button id="pcBedRefresh_${id}" onclick="printerBedLevelRefresh('${id}',{announce:true})" style="background:var(--surface);border:1px solid var(--border2);color:var(--text2);border-radius:9px;padding:9px 12px;font-size:11px;font-weight:800;cursor:pointer">↻ ACTUALIZAR LECTURA</button>
          <button id="pcBedMap_${id}" onclick="openBedMesh('${id}')" style="background:var(--surface);border:1px solid var(--border2);color:var(--text2);border-radius:9px;padding:9px 12px;font-size:11px;font-weight:800;cursor:pointer">🗺 VER MAPA DE CAMA</button>
          <div style="font-size:9.5px;color:var(--text3);line-height:1.45"><b>ACTUALIZAR LECTURA</b> solo relee la malla que Moonraker tiene activa; no vuelve a medir físicamente la cama.<br><b>CALIBRAR</b> ejecuta HOME + BED_MESH_CLEAR + BED_MESH_CALIBRATE y crea una malla nueva. Si supera 400 µm conviene corregir la cama físicamente.</div>
        </div>
      </div>
    </div>
    ${active?`
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">⚡ Ajustes en vivo</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:9px;margin-bottom:10px">
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:9px"><div style="font-size:10px;color:var(--text3);margin-bottom:6px">VELOCIDAD · 50–150%</div><div style="display:flex;gap:5px"><button onclick="printerAdjustTune('${id}','speed',-10)" style="flex:1">−10</button><input id="pcTune_speed" type="number" value="${speed}" min="50" max="150" style="width:64px;text-align:center;background:var(--surface);border:1px solid var(--border2);border-radius:6px;color:var(--text)"><button onclick="printerAdjustTune('${id}','speed',10)" style="flex:1">+10</button><button onclick="printerSetTune('${id}','speed')">OK</button></div></div>
      <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:9px"><div style="font-size:10px;color:var(--text3);margin-bottom:6px">FLUJO · 80–120%</div><div style="display:flex;gap:5px"><button onclick="printerAdjustTune('${id}','flow',-5)" style="flex:1">−5</button><input id="pcTune_flow" type="number" value="${flow}" min="80" max="120" style="width:64px;text-align:center;background:var(--surface);border:1px solid var(--border2);border-radius:6px;color:var(--text)"><button onclick="printerAdjustTune('${id}','flow',5)" style="flex:1">+5</button><button onclick="printerSetTune('${id}','flow')">OK</button></div></div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span style="font-size:10px;color:var(--text3)">VENTILADOR:</span>${[0,50,75,100].map(p=>button(p+'%',`printerSetFan('${id}',${p})`,!fresh,'padding:5px 9px')).join('')}</div>
    <div class="op-expert-only" style="background:rgba(255,170,0,.06);border:1px solid rgba(255,170,0,.22);border-radius:10px;padding:9px;margin-bottom:18px"><div style="font-size:10px;color:#ffaa00;margin-bottom:6px;font-weight:800">EXPERTO · Z-OFFSET EN VIVO</div><div style="display:flex;gap:6px;flex-wrap:wrap">${[-0.05,-0.01,0.01,0.05].map(v=>button((v>0?'+':'')+v.toFixed(2)+' mm',`printerZAdjust('${id}',${v})`,!fresh,'padding:6px 9px')).join('')}</div></div>
    `:''}
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🎮 Movimiento</div>
    <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:12px">
      <div style="display:grid;grid-template-columns:54px 54px 54px;grid-template-rows:42px 42px 42px;gap:5px"><span></span>${button('Y +',`printerJogStep('${id}','Y',1)`,motionLocked,'grid-column:2;grid-row:1')}<span></span>${button('X −',`printerJogStep('${id}','X',-1)`,motionLocked,'grid-column:1;grid-row:2')}${button('HOME',`printerHome('${id}')`,motionLocked,'grid-column:2;grid-row:2;padding:5px')}${button('X +',`printerJogStep('${id}','X',1)`,motionLocked,'grid-column:3;grid-row:2')}<span></span>${button('Y −',`printerJogStep('${id}','Y',-1)`,motionLocked,'grid-column:2;grid-row:3')}<span></span></div>
      <div style="display:flex;flex-direction:column;gap:6px;min-width:80px">${button('Z +',`printerJogStep('${id}','Z',1)`,motionLocked)}${button('Z −',`printerJogStep('${id}','Z',-1)`,motionLocked)}</div>
      <div style="min-width:130px"><div style="font-size:10px;color:var(--text3);margin-bottom:5px">PASO</div><select id="pcJogStep_${id}" ${motionLocked?'disabled':''} style="width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:8px"><option value=".1">0,1 mm</option><option value="1">1 mm</option><option value="10" selected>10 mm</option><option value="50">50 mm</option></select></div>
    </div>
    <div style="font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🧰 Utilidades</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">${button('🔥 Calentar 220°',`printerHeatForFilament('${id}')`,motionLocked)}${button('⬇️ Cargar filamento',`printerFilament('${id}','load')`,motionLocked)}${button('⬆️ Descargar',`printerFilament('${id}','unload')`,motionLocked)}${button('💤 Soltar motores',`printerMotorsOff('${id}')`,motionLocked)}</div>
    <div style="border-top:1px solid var(--border2);padding-top:14px;margin-bottom:20px"><div style="font-size:10px;color:var(--text3);margin-bottom:7px">EMERGENCIA · no confundir con “Detener impresión”</div><button onclick="printerEmergencyStop('${id}')" style="background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.45);color:#ff4444;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer;width:100%">⛔ PARADA DE EMERGENCIA</button></div>
    <details class="op-expert-only" style="margin-bottom:12px"><summary style="cursor:pointer;font-size:11px;font-weight:800;color:var(--text2)">📂 Archivos en la impresora</summary><div style="display:flex;justify-content:flex-end;margin:8px 0"><button onclick="loadPrinterFiles('${id}')">↻ Cargar</button></div><div id="pcFiles" style="max-height:160px;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px"><div style="color:var(--text3);font-size:12px;padding:8px">Pulsa “Cargar” para ver los G-code y reimprimir.</div></div></details>
    <details class="op-expert-only"><summary style="cursor:pointer;font-size:11px;font-weight:800;color:var(--text2)">📊 Historial real (Moonraker)</summary><div style="display:flex;justify-content:flex-end;margin:8px 0"><button onclick="loadPrinterHistory('${id}')">↻ Cargar</button></div><div id="pcHistory" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px"><div style="color:var(--text3);font-size:12px;padding:8px">Tiempo y filamento reales de cada trabajo.</div></div></details>`;
  document.getElementById('printerControlModal').style.display='flex';
  setTimeout(()=>{
    _bedLevelHistoryRender(id);
    if(!_bedLevelRestoreRunUi(id))printerBedLevelRefresh(id).catch(()=>{});
    _bedLevelHistoryLoadRemote(false).then(()=>{
      if(!_bedLevelRuns[id]?.active)printerBedLevelRefresh(id,{quietStatus:true}).catch(()=>{});
    }).catch(()=>{});
  },0);
}
function closePrinterControl(){const el=document.getElementById('printerControlModal');if(el)el.style.display='none';}
if(typeof window!=='undefined'){
  setTimeout(()=>_bedLevelHistoryLoadRemote(false).catch(()=>{}),2500);
  window.addEventListener?.('focus',()=>{if(Date.now()-_bedLevelHistoryRemoteAt>60000)_bedLevelHistoryLoadRemote(false).catch(()=>{});});
}

// ── Queue modal ───────────────────────────────────────────────
function openQueueModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const q=_queueGet(id);
  const fmtTime=s=>{const h=Math.floor(s/3600),mn=Math.floor((s%3600)/60);return h?`${h}h ${mn}m`:`${mn}m`;};
  const rows=q.map((j,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:12px;font-weight:700;color:var(--accent);min-width:18px">#${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(j.filename)}</div>
        <div style="font-size:10.5px;color:var(--text3)">⏱ ~${j.secs?fmtTime(j.secs):'—'} · ⚖ ~${j.grams?j.grams.toFixed(0):'—'}g</div>
      </div>
      <button onclick="_queueRemove('${id}',${i})" style="background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.3);border-radius:6px;color:#ff4444;font-size:10.5px;padding:3px 8px;cursor:pointer">✕</button>
    </div>`).join('');
  const body=q.length?`<div style="display:flex;flex-direction:column;gap:6px">${rows}</div>`:`<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Cola vacía</div>`;
  document.getElementById('queueModalTitle').textContent=`Cola de impresión — ${m.nombre} #${m.numG}`;
  document.getElementById('queueModalBody').innerHTML=body;
  document.getElementById('queueModal').style.display='flex';
}
function closeQueueModal(){document.getElementById('queueModal').style.display='none';}
function _queueRemove(id,idx){
  const q=_printQueue[id];if(!q)return;
  q.splice(idx,1);
  renderMonitorGrid();
  if(q.length>0)openQueueModal(id);else closeQueueModal();
  toast('Trabajo eliminado de la cola','success');
}

function _sendWaAlertIfEnabled(title,body){
  if(localStorage.getItem('monitor_wa_enabled')!=='1')return;
  const phone=localStorage.getItem('monitor_wa_phone');if(!phone)return;
  sendWatiMessage(phone,`${title}\n${body}`).catch(()=>{});
}
// Decide qué hacer con la sesión de impresión según el estado actual:
//   open  = abrir sesión nueva (empezó a imprimir y no había una viva)
//   close = cerrar la sesión (llegó a un estado terminal)
//   result= 'Completado' | 'Cancelado' cuando close
// PAUSA y la pérdida de telemetría (offline/connecting/startup/unknown/noip) NO
// abren ni cierran: la impresión sigue viva, solo está pausada o no la estamos
// viendo. Reanudar desde pausa conserva el inicio real (no reabre la sesión).
// Antes cualquier salida de 'printing' salvo 'offline' cerraba la sesión: una
// pausa (printing→paused) se registraba como "Cancelado", perdía el inicio y, al
// completar, calculaba la duración solo desde la reanudación — corrompiendo horas
// de odómetro/mantención y la autocalibración de tiempo que usa el cotizador.
function _printSessionAction(st,hasSession){
  const transitorio=st==='paused'||st==='offline'||st==='apidown'||st==='connecting'||st==='startup'||st==='unknown'||st==='noip';
  const open=st==='printing'&&!hasSession;
  const close=hasSession&&st!=='printing'&&!transitorio;
  return{open,close,result:close?(st==='complete'?'Completado':'Cancelado'):null};
}
function _controllerOwnsPrint(machineId,filename){
  try{
    const status=window.FarmQueue?.status?.()||{},target=String(filename||'').replace(/\.gcode$/i,'').toLowerCase();
    return (status.jobs||[]).some(j=>j.machineId===machineId&&String(j.filename||'').replace(/\.gcode$/i,'').toLowerCase()===target&&
      ['started','printing','paused','completed','cancelled','failed'].includes(String(j.state||''))&&Date.now()-Date.parse(j.updatedAt||j.createdAt||0)<48*3600000);
  }catch(_){return false;}
}
function checkTransitions(m,s){
  const prev=_prevState[m.id];const st=s.state;
  if(st==='error'&&prev!=='error'){
    const title=`⚠ Error en ${m.nombre} #${m.numG}`;
    sendBrowserNotification(title,'Requiere atención');
    sendWebhookAlert(m,'error');
    _sendWaAlertIfEnabled(title,'Requiere atención inmediata.');
  }
  if(st==='shutdown'&&prev!=='shutdown'&&prev!==undefined&&prev!=='offline'){
    const title=`⚠ ${m.nombre} #${m.numG} se detuvo (Klipper)`;
    const detail=s.klMsg||'El firmware entró en shutdown. Revisa la impresora y reinicia el firmware.';
    sendBrowserNotification(title,detail);
    sendWebhookAlert(m,'shutdown');
    _sendWaAlertIfEnabled(title,detail);
  }
  const act=_printSessionAction(st,!!_sessions[m.id]);
  if(act.open){
    const elapsedMs=Math.max(0,Number(s.elapsed||0))*1000;
    _sessions[m.id]={file:s.filename,start:Date.now()-elapsedMs,filamentStart:Math.max(0,(s.filamentMm||0)),controllerOwned:_controllerOwnsPrint(m.id,s.filename)};
  }
  if(act.close){
    const sess=_sessions[m.id];
    if(sess){
      const end=Date.now(),dur=Math.max(1,Math.round((Number(s.elapsed||0)>0?Number(s.elapsed)*1000:end-sess.start)/60000));
      const filamentMm=Math.max(0,(s.filamentMm||0)-sess.filamentStart);
      const owned=sess.controllerOwned||_controllerOwnsPrint(m.id,sess.file);
      if(!owned)saveHistoryEntry(m,sess.file,sess.start,end,dur,act.result,filamentMm);
      delete _sessions[m.id];
      if(st==='complete'){
        // Auto-calibrar estimación de tiempo por modelo de impresora
        const estKey='sl_last_est_secs';const estSecs=parseFloat(localStorage.getItem(estKey));
        if(estSecs>0&&dur>0){const ratio=(dur*60)/estSecs;if(ratio>0.4&&ratio<4){const calKey='sl_time_cal_'+(m.modelo||'default');const prevCal=parseFloat(localStorage.getItem(calKey))||1;localStorage.setItem(calKey,(prevCal*0.75+ratio*0.25).toFixed(4));}}
        localStorage.removeItem(estKey);
        const title=`✅ ${m.nombre} #${m.numG} completado`;
        sendBrowserNotification(title,`${sess.file} · ${dur}m`);
        _sendWaAlertIfEnabled(title,`Archivo: ${sess.file} | Duración: ${dur} min`);
        if(_queueCount(m.id)>0)setTimeout(()=>_queueStartNext(m.id),2000);
      }
    }
  }
  _prevState[m.id]=st;
}

function saveHistoryEntry(m,file,start,end,dur,result,filamentMm=0){
  try{const h=JSON.parse(localStorage.getItem(HIST_KEY)||'[]');h.unshift({id:m.id,nombre:m.nombre,numG:m.numG,file,start,end,dur,result,filamentMm,ts:Date.now()});if(h.length>200)h.splice(200);localStorage.setItem(HIST_KEY,JSON.stringify(h));}catch(e){}
  odoAdd(m.id,(dur||0)/60,filamentMm,result==='Completado');
}

function getHistoryForPrinter(id){return getHist().filter(h=>h.id===id);}

function requestNotificationPermission(manual){
  if(!('Notification'in window))return;
  if(Notification.permission==='default')Notification.requestPermission().then(p=>{if(manual)toast(p==='granted'?'🔔 Notificaciones activadas':'Permiso denegado',p==='granted'?'success':'error');});
  else if(manual)toast(Notification.permission==='granted'?'🔔 Notificaciones ya activas':'Permiso denegado',Notification.permission==='granted'?'success':'error');
}

function sendBrowserNotification(title,body){if('Notification'in window&&Notification.permission==='granted')new Notification(title,{body});}

async function sendWebhookAlert(m,event){
  const url=localStorage.getItem('monitor_webhook_url');if(!url)return;
  try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maquina:m.nombre,num:m.numG,evento:event,timestamp:new Date().toISOString()})});}catch(e){}
}

async function openBedMesh(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  toast('Consultando bed mesh…','info');
  try{
    await _bedLevelHistoryLoadRemote(false).catch(()=>false);
    const [read,caps]=await Promise.all([_bedLevelReadActive(id,10000),_bedLevelCapabilities(id)]);
    const st=read.st;if(!st){toast('Sin bed mesh activo — ejecuta la calibración automática primero','error');return;}
    const matrix=st.matrix,rows=st.rows,cols=st.cols,cell=Math.min(52,Math.floor(360/Math.max(rows,cols))),offset=34,W=cols*cell,H=rows*cell;
    const diag=_bedLevelDiagnose(st),latest=_bedLevelHistoryFor(id)[0]||null,rec=_bedLevelRecommendation(id,st),grade=_bedLevelGrade(st.range),scale=0.40;
    const colorFor=v=>{
      const dev=Math.max(-scale,Math.min(scale,Number(v)-st.avg)),t=(dev+scale)/(scale*2);
      const neutral=0.5,rr=t>=neutral?Math.round(45+(t-neutral)*2*185):Math.round(45*(t/neutral));
      const bb=t<=neutral?Math.round(45+(neutral-t)*2*185):Math.round(45*((1-t)/(1-neutral)));
      const gg=Math.round(60+(1-Math.min(1,Math.abs(t-neutral)*2))*95);
      return{fill:`rgb(${rr},${gg},${bb})`,dev};
    };
    const svgCells=matrix.map((row,ri)=>row.map((raw,ci)=>{
      const v=Number(raw),col=colorFor(v),isMin=st.minPos?.row===ri&&st.minPos?.col===ci,isMax=st.maxPos?.row===ri&&st.maxPos?.col===ci,stroke=isMax?'#ff5555':isMin?'#38bdf8':'rgba(255,255,255,.09)',sw=isMax||isMin?3:1,p=_bedLevelCoords(st,ri,ci);
      return`<g><rect x="${offset+ci*cell}" y="${offset+ri*cell}" width="${cell-2}" height="${cell-2}" fill="${col.fill}" stroke="${stroke}" stroke-width="${sw}" rx="4"/><text x="${offset+ci*cell+cell/2}" y="${offset+ri*cell+cell/2+4}" text-anchor="middle" fill="#fff" font-size="${Math.max(8,cell/4.5)}" font-family="monospace">${v.toFixed(2)}</text><title>F${ri+1}/C${ci+1} · X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)} · ${v.toFixed(3)} mm · Δprom ${col.dev>=0?'+':''}${col.dev.toFixed(3)} mm</title>${isMax?`<text x="${offset+ci*cell+cell/2}" y="${offset+ri*cell+10}" text-anchor="middle" fill="#fff" font-size="7" font-weight="700">ALTO</text>`:''}${isMin?`<text x="${offset+ci*cell+cell/2}" y="${offset+ri*cell+10}" text-anchor="middle" fill="#fff" font-size="7" font-weight="700">BAJO</text>`:''}</g>`;
    }).join('')).join('');
    const rowLabels=Array.from({length:rows},(_,ri)=>`<text x="10" y="${offset+ri*cell+cell/2+4}" fill="rgba(255,255,255,.48)" font-size="9">F${ri+1}</text>`).join('');
    const colLabels=Array.from({length:cols},(_,ci)=>`<text x="${offset+ci*cell+cell/2}" y="14" text-anchor="middle" fill="rgba(255,255,255,.48)" font-size="9">C${ci+1}</text>`).join('');
    const latestTemp=_bedLevelFiniteOrNull(latest?.bedTemp);
    const capButtons=`${caps.screwsTilt?'<button onclick="printerScrewsTiltGuide(\''+id+'\')" style="padding:8px 10px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-weight:800;cursor:pointer">🪛 CALCULAR TORNILLOS</button>':''}${caps.zTilt?'<button onclick="printerZTiltAdjust(\''+id+'\')" style="padding:8px 10px;border-radius:8px;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-weight:800;cursor:pointer">⚙ Z_TILT_ADJUST</button>':''}`;
    const modal=document.createElement('div');modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:20px;max-width:96vw;max-height:92vh;overflow:auto;min-width:340px">
      <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:14px"><div><div style="font-weight:800;font-size:14px">🗺️ Heatmap de cama — ${escapeHtml(m.nombre)} #${m.numG}</div><div style="font-size:10.5px;color:var(--text3)">mín ${st.min.toFixed(3)} mm · máx ${st.max.toFixed(3)} mm · rango <b style="color:${grade.color}">${Math.round(st.range*1000)} µm</b> · ${rows}×${cols} puntos</div></div><button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer">✕</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;align-items:start">
        <div><svg width="${W+offset+4}" height="${H+offset+5}" viewBox="0 0 ${W+offset+4} ${H+offset+5}" style="display:block;max-width:100%;height:auto;border-radius:8px;background:#0b0b0b">${rowLabels}${colLabels}${svgCells}</svg>
          <div style="margin-top:9px;display:flex;gap:8px;align-items:center;font-size:10px;color:var(--text3)"><div style="width:110px;height:10px;background:linear-gradient(to right,rgb(0,60,230),rgb(45,155,45),rgb(230,60,0));border-radius:3px"></div><span>−400 µm · promedio · +400 µm</span></div>
          <div style="font-size:9px;color:var(--text3);margin-top:6px">Escala fija respecto del promedio: una cama buena ya no aparece artificialmente “roja/azul”. Las coordenadas X/Y provienen de Moonraker cuando están disponibles.</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="padding:10px;border:1px solid ${grade.color};border-radius:9px;background:color-mix(in srgb, ${grade.color} 6%, transparent)"><div style="font-size:9px;color:var(--text3);letter-spacing:.7px">DIAGNÓSTICO GEOMÉTRICO</div><div style="font-size:11px;font-weight:800;margin-top:4px">${escapeHtml(diag.summary)}</div>${diag.geometry?`<div style="font-size:10px;color:var(--text2);margin-top:5px">${escapeHtml(diag.geometry)}</div>`:''}<div style="font-size:10px;color:var(--text3);margin-top:5px">${escapeHtml(diag.action)}</div></div>
          <div style="padding:10px;border:1px solid ${rec.color};border-radius:9px;background:color-mix(in srgb, ${rec.color} 6%, transparent)"><div style="font-size:9px;color:var(--text3);letter-spacing:.7px">MALLA ACTIVA VS HISTORIAL</div><div style="font-size:11px;font-weight:900;color:${rec.color};margin-top:4px">${rec.label}</div><div style="font-size:10px;color:var(--text3);margin-top:4px">${escapeHtml(rec.detail)}</div></div>
          ${capButtons?`<div style="display:flex;gap:7px;flex-wrap:wrap">${capButtons}</div>`:''}
          <div style="padding:10px;border:1px solid var(--border2);border-radius:9px;background:var(--surface2)">${_bedLevelHistoryMarkup(id)}</div>
          <div style="font-size:9.5px;color:var(--text3)">Última calibración compartida: ${latest?`${new Date(latest.calibratedAt).toLocaleString('es-CL')} · cama ${latestTemp===null?'—':latestTemp.toFixed(0)+' °C'}`:'sin registro verificado'}.</div>
        </div>
      </div>
    </div>`;
    modal.onclick=e=>{if(e.target===modal)modal.remove();};document.body.appendChild(modal);
  }catch(e){toast('Error consultando bed mesh: '+e.message,'error');}
}
function openWebcamModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const url=_printerCamRaw(id)||'';
  document.getElementById('webcamModalTitle').textContent=`${m.nombre} #${m.numG}`;
  document.getElementById('webcamModalId').value=id;
  document.getElementById('webcamModalUrl').value=url;
  const img=document.getElementById('webcamModalImg');
  const nf=document.getElementById('webcamNoFeed');
  if(url){
    const cu=printerCamUrl(id),snap=_camIsSnapshot(url);
    // Las K2 pueden aceptar un solo consumidor WebRTC estable. Mientras el modal
    // está abierto congelamos el último frame de la tarjeta y dejamos que el modal
    // sea el único que pida snapshots; al cerrar se reanuda la tarjeta.
    if(snap){
      const cardImg=document.getElementById('mccam_'+id)?.querySelector('img');
      if(cardImg){cardImg.dataset.camSuspended='1';_cameraClearTimer(cardImg);}
      img.setAttribute('data-snap',cu);
    }else img.removeAttribute('data-snap');
    img.dataset.camBase=cu;img.dataset.camKind=snap?'snapshot':'mjpeg';img.dataset.camLoading='1';img.dataset.camFails='0';
    img.onload=()=>_cameraLoadOk(img);img.onerror=()=>_cameraLoadError(img);
    img.src=cu;img.style.display='block';nf.style.display='none';
  }else{
    img.removeAttribute('data-snap');img.removeAttribute('data-cam-base');img.removeAttribute('data-cam-kind');img.src='';img.style.display='none';nf.style.display='flex';
  }
  const ts=document.getElementById('webcamTestStatus');if(ts)ts.textContent='';
  document.getElementById('webcamModal').style.display='flex';
}
// Diagnóstico de cámara: hace la petición REAL (a través del túnel/bridge en
// modo remoto) y traduce el resultado a un mensaje claro — así se sabe si el
// problema es el token, el puerto, que go2rtc no responde, o el nombre del stream.
async function testWebcam(){
  const inp=document.getElementById('webcamModalUrl');
  const out=document.getElementById('webcamTestStatus');
  if(!inp||!out)return;
  const raw=(inp.value||'').trim();
  const set=(msg,col)=>{out.textContent=msg;out.style.color=col;};
  if(!raw){set('Ingresa una URL primero.','var(--warn)');return;}
  // Misma reescritura que printerCamUrl: en remoto va por el bridge con el token.
  let url=raw;
  if(!(typeof _isLocalMode==='function'&&_isLocalMode())){
    const mm=raw.match(/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?(\/.*)?$/);
    if(mm&&typeof _appendBridgeToken==='function') url=_appendBridgeToken(`${getPrinterTunnel()}/${mm[1]}:${mm[2]||'80'}${mm[3]||'/'}`);
  }
  set('⏳ Probando…','var(--text3)');
  const ctrl=new AbortController();const to=setTimeout(()=>ctrl.abort(),12000);
  try{
    const r=await fetch(url,{method:'GET',cache:'no-store',signal:ctrl.signal});
    try{r.body&&r.body.cancel();}catch(_){}
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    if(r.ok&&(ct.includes('image')||ct.includes('multipart'))) set('✓ Cámara OK — está entregando video.','var(--success)');
    else if(r.ok) set(`⚠ Responde 200 pero no es imagen (tipo: ${ct||'?'}). Si es go2rtc, revisa el nombre del stream (src=…).`,'var(--warn)');
    else if(r.status===401) set('✖ 401 — token del bridge inválido.','var(--danger)');
    else if(r.status===403) set('✖ 403 — el bridge bloqueó ese puerto (agrégalo a BRIDGE_PORTS).','var(--danger)');
    else if(r.status===404) set('✖ 404 — ruta o stream no encontrado. Revisa la URL / el src=.','var(--danger)');
    else if(r.status===502||r.status===504) set(`✖ ${r.status} — el bridge no pudo conectar con la cámara: go2rtc no responde en esa IP:puerto (¿apagado, IP equivocada, o cámara off al terminar la impresión?).`,'var(--danger)');
    else set(`✖ ${r.status} ${r.statusText||''}`.trim(),'var(--danger)');
  }catch(e){
    if(e.name==='AbortError') set('✖ Sin respuesta (12s) — el bridge o la cámara no contestaron.','var(--danger)');
    else set('✖ No se pudo conectar: bridge caído, sin red, o bloqueo del navegador. ('+(e.message||'error')+')','var(--danger)');
  }finally{clearTimeout(to);}
}
function saveWebcamUrl(){const id=document.getElementById('webcamModalId').value;const url=document.getElementById('webcamModalUrl').value.trim();if(url&&!_safePrinterMediaUrl(url)){toast('URL de webcam inválida — usa http:// o https://','error');return;}if(url)localStorage.setItem('printer_cam_'+id,url);else localStorage.removeItem('printer_cam_'+id);const m=MAQUINAS.find(x=>x.id===id);if(m){m.cam=url||null;if(m._airtableId){if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{cam:url||''}})});}}closeWebcamModal();renderMonitorGrid();toast(url?'📷 Webcam configurada — guardada en Airtable':'Webcam eliminada','success');}
function closeWebcamModal(){
  const id=document.getElementById('webcamModalId')?.value||'';
  document.getElementById('webcamModal').style.display='none';
  const wi=document.getElementById('webcamModalImg');
  if(wi){_cameraClearTimer(wi);wi.onload=null;wi.onerror=null;wi.removeAttribute('data-snap');wi.removeAttribute('data-cam-base');wi.removeAttribute('data-cam-kind');wi.src='';}
  const cardImg=id?document.getElementById('mccam_'+id)?.querySelector('img'):null;
  if(cardImg&&cardImg.dataset.camSuspended==='1'){delete cardImg.dataset.camSuspended;cardImg.dataset.camLoading='0';_cameraRefreshNow(cardImg);}
}

function openHistoryModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('histModalTitle').textContent=`${m.nombre} #${m.numG}`;
  const hist=getHistoryForPrinter(id);
  const el=document.getElementById('histModalBody');
  el.innerHTML=hist.length?hist.slice(0,50).map(h=>{const d=new Date(h.start);return`<div style="padding:8px 0;border-bottom:1px solid var(--border2);display:flex;align-items:center;gap:10px">
    <span style="background:${h.result==='Completado'?'rgba(0,212,170,0.15)':'rgba(255,68,68,0.12)'};color:${h.result==='Completado'?'#00d4aa':'#ff4444'};border-radius:5px;padding:2px 7px;font-size:10px;font-weight:700;flex-shrink:0">${h.result}</span>
    <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.file||'—')}</div>
    <div style="font-size:10.5px;color:var(--text3)">${d.toLocaleDateString('es-CL')} ${d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})} · ${h.dur}m</div></div>
  </div>`;}).join(''):'<div style="text-align:center;color:var(--text3);padding:24px;font-size:12px">Sin historial registrado aún</div>';
  document.getElementById('histModal').style.display='flex';
}
function closeHistoryModal(){document.getElementById('histModal').style.display='none';}

function openAlertSettings(){
  document.getElementById('alertWebhookUrl').value=localStorage.getItem('monitor_webhook_url')||'';
  const wp=document.getElementById('alertWaPhone');const wc=document.getElementById('alertWaEnabled');
  if(wp)wp.value=localStorage.getItem('monitor_wa_phone')||'';
  if(wc)wc.checked=localStorage.getItem('monitor_wa_enabled')==='1';
  document.getElementById('alertSettingsModal').style.display='flex';
}
function saveAlertSettings(){
  const url=document.getElementById('alertWebhookUrl').value.trim();
  if(url)localStorage.setItem('monitor_webhook_url',url);else localStorage.removeItem('monitor_webhook_url');
  const wp=document.getElementById('alertWaPhone');const wc=document.getElementById('alertWaEnabled');
  if(wp){const ph=wp.value.trim();if(ph)localStorage.setItem('monitor_wa_phone',ph);else localStorage.removeItem('monitor_wa_phone');}
  if(wc)localStorage.setItem('monitor_wa_enabled',wc.checked?'1':'0');
  toast('Alertas guardadas ✓','success');closeAlertSettings();
}
function closeAlertSettings(){document.getElementById('alertSettingsModal').style.display='none';}

// ── SORT & KIOSK ──────────────────────────────────────────────
const MONITOR_SORT_MODES=['camera_model','model','state','original'];
let _monitorSortMode='camera_model',_kioskMode=false;
try{
  const saved=localStorage.getItem('monitor_sort_mode');
  if(MONITOR_SORT_MODES.includes(saved))_monitorSortMode=saved;
}catch(_){}
function stateOrder(s){return{error:0,shutdown:1,paused:2,calibrating:3,gcode:4,apidown:5,printing:6,complete:7,standby:8,idle:8,offline:9,noip:10}[s]??11;}
function _monitorModelOrder(m){
  const i=MONITOR_GRUPOS.findIndex(g=>g.key===m?.modelo);
  return i<=0?99:i;
}
function _monitorMachineNumber(m){const n=Number(m?.numG??m?.num);return Number.isFinite(n)?n:9999;}
function _monitorModelCompare(a,b){
  return _monitorModelOrder(a)-_monitorModelOrder(b)||String(a?.modelo||'').localeCompare(String(b?.modelo||''),'es')||_monitorMachineNumber(a)-_monitorMachineNumber(b)||String(a?.nombre||'').localeCompare(String(b?.nombre||''),'es');
}
function _cameraSignalRank(m){
  if(!_printerCamRaw(m?.id))return 3;
  const state=_camSignalState[m.id]||'unknown';
  return state==='ok'?0:state==='down'?2:1;
}
function sortedList(lista){
  const rows=[...(lista||[])];
  if(_monitorSortMode==='original')return rows;
  if(_monitorSortMode==='model')return rows.sort(_monitorModelCompare);
  if(_monitorSortMode==='state')return rows.sort((a,b)=>{
    const sa=_printerStatus[a.id]||{},sb=_printerStatus[b.id]||{};
    const ea=_printerEffectiveState(a.id,sa.state||'offline',sa),eb=_printerEffectiveState(b.id,sb.state||'offline',sb);
    return stateOrder(ea)-stateOrder(eb)||((sa.state==='printing'&&sb.state==='printing')?((sa.eta??Infinity)-(sb.eta??Infinity)):0)||_monitorModelCompare(a,b);
  });
  return rows.sort((a,b)=>_cameraSignalRank(a)-_cameraSignalRank(b)||_monitorModelCompare(a,b));
}
function setMonitorSort(mode){
  _monitorSortMode=MONITOR_SORT_MODES.includes(mode)?mode:'camera_model';
  try{localStorage.setItem('monitor_sort_mode',_monitorSortMode);}catch(_){}
  const btn=document.getElementById('btnSort');if(btn){btn.style.color=_monitorSortMode==='state'?'var(--accent)':'var(--text3)';btn.title='Orden actual: '+_monitorSortMode;}
  renderMonitorFilterTabs();renderMonitorGrid();
}
function toggleSort(){setMonitorSort(_monitorSortMode==='state'?'camera_model':'state');}
function toggleKiosk(){
  // Compatibilidad con botones/enlaces antiguos: ya no crea una segunda capa
  // ni pone documentElement en fullscreen. Todo converge al Taller TV único.
  _kioskMode=false;document.body.classList.remove('kiosk');
  if(typeof tvStartTaller==='function'){tvStartTaller();return;}
  if(typeof toast==='function')toast('Modo Taller (TV) todavía no está disponible','error');
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&_kioskMode){_kioskMode=false;document.body.classList.remove('kiosk');renderMonitorGrid();}});

// ── IDLE ALERT ────────────────────────────────────────────────
const _lastActiveTime={},_idleAlerted={};
function getIdleHours(id,state){
  const effective=_printerEffectiveState(id,state,_printerStatus[id]||null);
  if(['printing','paused','calibrating','gcode','offline','noip'].includes(effective))return 0;
  const last=_lastActiveTime[id];if(!last)return 0;
  const threshold=parseFloat(localStorage.getItem('idle_alert_hours')||'2');
  const h=(Date.now()-last)/3600000;
  return h>=threshold?Math.round(h):0;
}
function checkIdleAlerts(){
  const now=new Date();const h=now.getHours();
  const isWork=h>=8&&h<19&&now.getDay()>0&&now.getDay()<6;
  MAQUINAS.forEach(m=>{
    const raw=_printerStatus[m.id]||{},st=_printerEffectiveState(m.id,raw.state||'offline',raw);
    if(['printing','paused','calibrating','gcode'].includes(st)){_lastActiveTime[m.id]=Date.now();delete _idleAlerted[m.id];}
    else if(isWork&&_lastActiveTime[m.id]&&!_idleAlerted[m.id]){
      const idleH=(Date.now()-_lastActiveTime[m.id])/3600000;
      const threshold=parseFloat(localStorage.getItem('idle_alert_hours')||'2');
      if(idleH>=threshold){sendBrowserNotification(`💤 ${m.nombre} #${m.numG} lleva ${Math.round(idleH)}h sin imprimir`,'Máquina inactiva en horario laboral');sendWebhookAlert(m,'idle');_idleAlerted[m.id]=true;}
    }
  });
}

// ── MANTENIMIENTO ─────────────────────────────────────────────
const MAINT_KEY='printer_maint_v1',MAINT_CFG_KEY='printer_maint_cfg',FILAMENT_COST_KEY='filament_cost_clp';
// Peso del filamento según material y diámetro (configurable en Umbrales de mantención).
// Devuelve kg por mm de filamento extruido. Por defecto PLA 1.75 mm ≈ 0.000002982 kg/mm.
const FILAMENT_DENSITY={PLA:1.24,PETG:1.27,ABS:1.04,ASA:1.07,TPU:1.21,Nylon:1.14};
function getFilamentKgPerMm(){
  const dens=FILAMENT_DENSITY[localStorage.getItem('filament_material')||'PLA']||1.24; // g/cm³
  const dia=parseFloat(localStorage.getItem('filament_diameter')||'1.75')||1.75;       // mm
  const area=Math.PI*(dia/2)*(dia/2);                                                  // mm²
  return area*dens/1e6;                                                                // kg/mm
}
const MAINT_TYPES=[
  {key:'nozzle',label:'Nozzle',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-nut"/></svg>',defaultHours:200},
  {key:'lubrication',label:'Lubricación',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-droplet"/></svg>',defaultHours:100},
  {key:'belt',label:'Correa',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-settings"/></svg>',defaultHours:500},
  {key:'extruder',label:'Extrusor',icon:'⚙️',defaultHours:300},
  {key:'bed',label:'Cama / superficie',icon:'▦',defaultHours:250},
  {key:'sensors',label:'Sensores / eléctrico',icon:'⚡',defaultHours:600},
  {key:'general',label:'General',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-wrench"/></svg>',defaultHours:50},
];
function getMaintConfig(){try{return JSON.parse(localStorage.getItem(MAINT_CFG_KEY)||'{}');}catch(e){return{};}}
function getMaintThreshold(tipo,maquinaId){
  if(maquinaId&&window.MachineOps?.maintenanceThreshold){
    const specific=window.MachineOps.maintenanceThreshold(maquinaId,tipo);
    if(specific>0)return specific;
  }
  const cfg=getMaintConfig();return parseInt(cfg[tipo])||MAINT_TYPES.find(t=>t.key===tipo)?.defaultHours||100;
}
function _maintRecordKey(r){return String(r?.id||r?.recordId||[r?.maquinaId||'',r?.tipo||'',Number(r?.ts)||0,String(r?.notas||'')].join('|'));}
function getMaintLog(){
  const map=new Map();
  for(const r of getMaintLogLocal())if(r&&r.maquinaId)map.set(_maintRecordKey(r),r);
  for(const r of (maquinaState.maintLog||[]))if(r&&r.maquinaId)map.set(_maintRecordKey(r),r);
  return[...map.values()].sort((a,b)=>(Number(b.ts)||0)-(Number(a.ts)||0));
}
function getPrintHours(id){if(_useOdometer())return(getOdometer()[id]||{}).hours||0;return getHist().filter(x=>x.id===id&&x.result==='Completado').reduce((s,x)=>s+(x.dur||0)/60,0);}
function getHoursSinceMaint(id,tipo){
  const log=getMaintLog().filter(x=>x.maquinaId===id&&x.tipo===tipo).sort((a,b)=>b.ts-a.ts);
  const total=getPrintHours(id);
  if(!log.length)return total;
  return Math.max(0,total-log[0].printHoursAtTime);
}
function getMaintAlerts(m){
  const log=getMaintLog();
  return MAINT_TYPES.map(t=>{
    const last=log.filter(x=>x.maquinaId===m.id&&x.tipo===t.key).sort((a,b)=>(b.ts||0)-(a.ts||0))[0]||null;
    const hours=getHoursSinceMaint(m.id,t.key),threshold=getMaintThreshold(t.key,m.id);
    return{...t,hours,threshold,last,verified:!!last};
  }).filter(t=>t.hours>=t.threshold*0.9);
}
// Ritmo de impresión (h/semana) de las últimas 4 semanas, para proyectar mantención
function getWeeklyPrintRate(id){
  const cut=Date.now()-28*86400000;return getHist().filter(x=>x.id===id&&x.result==='Completado'&&(x.ts||x.end||0)>=cut).reduce((s,x)=>s+(x.dur||0)/60,0)/4;
}
// Mantención más próxima a vencer, con ETA en semanas según el ritmo de uso
function getMaintForecast(m){
  const rate=getWeeklyPrintRate(m.id);let soonest=null;
  MAINT_TYPES.forEach(t=>{
    const left=getMaintThreshold(t.key,m.id)-getHoursSinceMaint(m.id,t.key);
    const weeks=left<=0?0:(rate>0?left/rate:Infinity);
    if(!soonest||weeks<soonest.weeks)soonest={tipo:t.label,key:t.key,hoursLeft:left,weeks,rate};
  });
  return soonest;
}
function getTotalFilamentKg(id){
  const mm=_useOdometer()?((getOdometer()[id]||{}).filamentMm||0):getHist().filter(x=>x.id===id).reduce((s,x)=>s+(x.filamentMm||0),0);return mm*getFilamentKgPerMm();}
function getFilamentCost(id){const kg=getTotalFilamentKg(id);const cost=parseFloat(localStorage.getItem(FILAMENT_COST_KEY)||'0');return Math.round(kg*cost);}

function renderMaintenanceTable(){
  const el=document.getElementById('maintTable');if(!el)return;
  let hist={};try{hist=window.PrinterHistory?.status?.()||{};}catch(_){}
  const histFresh=hist.mode==='durable'&&hist.lastSync&&Date.now()-Number(hist.lastSync)<120000;
  const sourceLabel=histFresh?'Historial central reciente':hist.mode==='local-fallback'?'Caché local':'Historial sin confirmar';
  const evidenceHtml='<div class="mops-source-note '+(histFresh?'ok':'warning')+'"><b>Horas y proyección: '+sourceLabel+'.</b><span>'+(histFresh?'Sincronización central reciente.':'Los valores pueden estar incompletos o diferir en otro dispositivo.')+' Una mantención sin registro base no se considera evidencia de una fecha previa.</span></div>';
  let totH=0,totKg=0,totCost=0,totPrints=0,totAlerts=0;       // acumuladores de flota
  const rows=MAQUINAS.map(m=>{
    const ph=getPrintHours(m.id);
    const totalH=ph.toFixed(1);
    const filKgN=getTotalFilamentKg(m.id);const filKg=filKgN.toFixed(3);
    const filCost=getFilamentCost(m.id);
    const prints=(getOdometer()[m.id]||{}).prints||0;
    // Una sola pasada por el log de mantención de la máquina (evita ~12 recálculos)
    const mLog=getMaintLog().filter(x=>x.maquinaId===m.id);
    const perType=MAINT_TYPES.map(t=>{
      const l=mLog.filter(x=>x.tipo===t.key).sort((a,b)=>b.ts-a.ts);const last=l[0];
      const h=last?Math.max(0,ph-last.printHoursAtTime):ph;const thresh=getMaintThreshold(t.key,m.id);
      return{t,h,thresh,last,pct:thresh>0?h/thresh:0,verified:!!last};
    });
    const alertsN=perType.filter(p=>p.pct>=0.9).length;
    totH+=ph;totKg+=filKgN;totCost+=filCost;totPrints+=prints;totAlerts+=alertsN;
    const chips=perType.map(({t,h,thresh,last,pct})=>{
      const ok=pct<0.9,over=!!last&&pct>=1;
      const lastStr=last?_DTF_DM.format(new Date(last.ts)):'sin reg.';
      const statusIcon=over?'⚠':ok?'✓':'~';
      return`<span title="${t.label}: ${h.toFixed(1)}h / ${thresh}h (${Math.round(pct*100)}%) · Último: ${lastStr}" style="display:inline-flex;align-items:center;gap:3px;background:${over?'rgba(255,68,68,0.15)':pct>=0.9?'rgba(255,170,0,0.15)':last?'rgba(0,212,170,0.12)':'rgba(255,255,255,0.04)'};color:${over?'#ff4444':pct>=0.9?'#ffaa00':last?'#00d4aa':'var(--text3)'};border:1px solid ${over?'rgba(255,68,68,0.3)':pct>=0.9?'rgba(255,170,0,0.3)':last?'rgba(0,212,170,0.25)':'var(--border2)'};border-radius:5px;padding:2px 6px;font-size:10px;font-weight:700">${t.icon} ${statusIcon} <span style="font-weight:400;opacity:0.85">${Math.round(pct*100)}%</span></span>`;
    }).join('');
    const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);
    const alerts={length:alertsN};
    const rate=getWeeklyPrintRate(m.id);let fc=null;
    perType.filter(p=>p.last).forEach(p=>{const left=p.thresh-p.h;const weeks=left<=0?0:(rate>0?left/rate:Infinity);if(!fc||weeks<fc.weeks)fc={tipo:p.t.label,hoursLeft:left,weeks,rate};});
    let fcHtml;
    if(!fc){fcHtml=`<span style="color:var(--warn);font-size:10.5px;font-weight:600" title="No hay un servicio base registrado para proyectar horas desde la última mantención">? sin mantención base registrada</span>`;}
    else if(fc.rate<=0&&fc.hoursLeft>0){fcHtml=`<span style="color:var(--text3);font-size:10.5px" title="No hay suficientes impresiones recientes para proyectar una fecha">sin ritmo suficiente para proyectar</span>`;}
    else if(fc.hoursLeft<=0)fcHtml=`<span style="color:#ff4444;font-size:10.5px;font-weight:700">⚠ ${escapeHtml(fc.tipo)} vencida</span>`;
    else{const w=fc.weeks;const col=w<1?'#ff4444':w<2?'#ffaa00':'#00d4aa';const lbl=w<1?'esta semana':w<2?`~${Math.round(w*7)} días`:`~${Math.round(w)} sem`;fcHtml=`<span style="color:${col};font-size:10.5px;font-weight:600" title="${escapeHtml(fc.tipo)}: faltan ${fc.hoursLeft.toFixed(0)}h al ritmo de ${fc.rate.toFixed(1)}h/semana">${escapeHtml(fc.tipo)} en ${lbl}</span> <span style="color:var(--text3);font-size:10px">· ${fc.rate.toFixed(0)}h/sem</span>`;}
    return`<tr style="border-bottom:1px solid var(--border2)">
      <td style="padding:9px 10px;font-size:12px;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${gc?.color||'#888'};margin-right:6px"></span><b>${m.nombre}</b> <span style="color:var(--text3)">#${m.numG}</span></td>
      <td style="padding:9px 10px;font-size:12px;text-align:center;font-weight:700;color:var(--accent)">${totalH}h</td>
      <td style="padding:9px 10px"><div style="display:flex;gap:4px;flex-wrap:wrap">${chips}</div></td>
      <td style="padding:9px 10px;white-space:nowrap">${fcHtml}</td>
      <td style="padding:9px 10px;font-size:10.5px;color:var(--text3);white-space:nowrap">${filKg}kg${filCost>0?` · $${filCost.toLocaleString('es-CL')}`:''}  </td>
      <td style="padding:9px 10px"><button onclick="openMaintModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:4px 10px;cursor:pointer;white-space:nowrap" ${alerts.length?'style="border-color:rgba(255,170,0,0.5)"':''}>+ Registrar</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=evidenceHtml+`<div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:700px">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">Máquina</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:center">Horas totales</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">Estado mantención</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left" title="Proyección según horas de impresión de las últimas 4 semanas">Próxima mantención</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">Filamento</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3)"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border);background:var(--surface2)">
      <td style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text)">FLOTA · ${MAQUINAS.length} máq.</td>
      <td style="padding:9px 10px;font-size:12px;text-align:center;font-weight:700;color:var(--accent)">${totH.toFixed(0)}h</td>
      <td style="padding:9px 10px;font-size:10.5px;color:${totAlerts>0?'#ffaa00':'var(--text3)'};font-weight:700">${totAlerts>0?`🔧 ${totAlerts} alerta${totAlerts>1?'s':''}`:'✓ sin alertas'}</td>
      <td style="padding:9px 10px;font-size:10.5px;color:var(--text3)">${totPrints} impresiones</td>
      <td style="padding:9px 10px;font-size:10.5px;color:var(--text3);white-space:nowrap;font-weight:700">${totKg.toFixed(2)}kg${totCost>0?` · $${totCost.toLocaleString('es-CL')}`:''}</td>
      <td></td>
    </tr></tfoot>
  </table></div>`;
}

function openMaintModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('maintModalId').value=id;
  document.getElementById('maintModalNombre').textContent=`${m.nombre} — Máquina #${m.numG}`;
  document.getElementById('maintModalNotas').value='';
  const partsEl=document.getElementById('maintModalParts');if(partsEl)partsEl.value='';
  document.getElementById('maintModal').style.display='flex';
}
function closeMaintModal(){document.getElementById('maintModal').style.display='none';}
const _MAINT_OUTBOX_KEY='printer_maint_outbox_v1';
function _pendingMaintRows(){try{const rows=JSON.parse(localStorage.getItem(_MAINT_OUTBOX_KEY)||'[]');return Array.isArray(rows)?rows:[];}catch(_){return[];}}
function _setPendingMaintRows(rows){if(rows.length)localStorage.setItem(_MAINT_OUTBOX_KEY,JSON.stringify(rows.slice(-100)));else localStorage.removeItem(_MAINT_OUTBOX_KEY);}
async function syncPendingMaintenance(){
  let pending=_pendingMaintRows();if(!pending.length)return true;
  const remoteKeys=new Set((maquinaState.maintLog||[]).map(_maintRecordKey));
  const remaining=[];
  for(const rec of pending){
    if(remoteKeys.has(_maintRecordKey(rec)))continue;
    try{await saveMaintRecordAirtable(rec);}
    catch(_){remaining.push(rec);}
  }
  _setPendingMaintRows(remaining);
  if(!remaining.length)localStorage.removeItem('printer_maint_sync_pending');
  return remaining.length===0;
}
async function saveMaintRecord(){
  const id=document.getElementById('maintModalId').value;
  const tipo=document.getElementById('maintModalTipo').value;
  const notas=document.getElementById('maintModalNotas').value.trim();
  const parts=document.getElementById('maintModalParts')?.value.trim()||'';
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const rec={maquinaId:id,nombre:m.nombre,numG:m.numG,tipo,notas,parts,printHoursAtTime:getPrintHours(id),ts:Date.now(),fecha:new Date().toISOString()};
  maquinaState.maintLog.unshift(rec);
  // guardar también en localStorage como backup
  const local=getMaintLogLocal();local.unshift(rec);localStorage.setItem(MAINT_KEY,JSON.stringify(local.slice(0,200)));
  closeMaintModal();renderMaintenanceTable();renderMonitorGrid();
  try{await saveMaintRecordAirtable(rec);localStorage.removeItem('printer_maint_sync_pending');toast(`🔧 Mantención registrada y sincronizada · ${MAINT_TYPES.find(t=>t.key===tipo)?.label}`,'success');}
  catch(e){
    console.warn('No se pudo guardar mantención en Airtable',e);
    const pending=_pendingMaintRows();if(!pending.some(x=>_maintRecordKey(x)===_maintRecordKey(rec)))pending.push(rec);_setPendingMaintRows(pending);
    localStorage.setItem('printer_maint_sync_pending','1');
    toast('Mantención guardada localmente; queda en cola de sincronización y se reintentará contra el registro remoto.','info');
  }
}
function openMaintConfig(){
  const cfg=getMaintConfig();
  document.getElementById('cfgNozzle').value=cfg.nozzle||200;
  document.getElementById('cfgLubrication').value=cfg.lubrication||100;
  document.getElementById('cfgBelt').value=cfg.belt||500;
  document.getElementById('cfgGeneral').value=cfg.general||50;
  document.getElementById('cfgIdle').value=localStorage.getItem('idle_alert_hours')||2;
  document.getElementById('cfgFilamentCost').value=localStorage.getItem(FILAMENT_COST_KEY)||0;
  document.getElementById('cfgFilamentMaterial').value=localStorage.getItem('filament_material')||'PLA';
  document.getElementById('cfgFilamentDiameter').value=localStorage.getItem('filament_diameter')||'1.75';
  document.getElementById('maintConfigModal').style.display='flex';
}
function saveMaintConfig(){
  const cfg={nozzle:parseInt(document.getElementById('cfgNozzle').value)||200,lubrication:parseInt(document.getElementById('cfgLubrication').value)||100,belt:parseInt(document.getElementById('cfgBelt').value)||500,general:parseInt(document.getElementById('cfgGeneral').value)||50};
  localStorage.setItem(MAINT_CFG_KEY,JSON.stringify(cfg));
  localStorage.setItem('idle_alert_hours',document.getElementById('cfgIdle').value||2);
  localStorage.setItem(FILAMENT_COST_KEY,document.getElementById('cfgFilamentCost').value||0);
  localStorage.setItem('filament_material',document.getElementById('cfgFilamentMaterial').value||'PLA');
  localStorage.setItem('filament_diameter',document.getElementById('cfgFilamentDiameter').value||'1.75');
  closeMaintConfig();renderMaintenanceTable();renderMonitorGrid();renderProductionAnalytics();toast('Configuración guardada ✓','success');
}
function closeMaintConfig(){document.getElementById('maintConfigModal').style.display='none';}

// ── ANALÍTICA ─────────────────────────────────────────────────
function renderProductionAnalytics(){
  const el=document.getElementById('analyticsContent');if(!el)return;
  const hist=getHist();
  if(!hist.length){el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:20px;text-align:center">Sin datos aún — el historial se generará automáticamente cuando las impresoras estén conectadas</div>';return;}
  const kgPerMm=getFilamentKgPerMm();

  // Impresiones últimas 7 días
  const days=[];const today=new Date();today.setHours(0,0,0,0);
  for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);days.push(d);}
  const dayData=days.map(d=>{
    const ds=d.toDateString();
    const entries=hist.filter(h=>new Date(h.start).toDateString()===ds);
    const count=entries.filter(h=>h.result==='Completado').length;
    const hours=entries.reduce((s,h)=>s+(h.dur||0)/60,0);
    const filKg=entries.reduce((s,h)=>s+(h.filamentMm||0),0)*kgPerMm;
    return{label:`${d.getDate()}/${d.getMonth()+1}`,count,hours:Math.round(hours*10)/10,filKg:Math.round(filKg*100)/100};
  });
  const maxCount=Math.max(...dayData.map(d=>d.count),1);
  const maxHours=Math.max(...dayData.map(d=>d.hours),1);
  const totalPrints=dayData.reduce((s,d)=>s+d.count,0);
  const totalHours=dayData.reduce((s,d)=>s+d.hours,0).toFixed(1);
  const totalFilKg=(hist.reduce((s,h)=>s+(h.filamentMm||0),0)*kgPerMm).toFixed(2);

  // Top printers by hours
  const byPrinter=MAQUINAS.map(m=>({m,h:getPrintHours(m.id)})).sort((a,b)=>b.h-a.h).slice(0,5);
  const maxPH=Math.max(...byPrinter.map(x=>x.h),1);

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Impresiones (7d)</div><div class="kpi-value">${totalPrints}</div></div>
      <div class="kpi-card"><div class="kpi-label">Horas activas (7d)</div><div class="kpi-value">${totalHours}h</div></div>
      <div class="kpi-card" title="Peso calculado con ${localStorage.getItem('filament_material')||'PLA'} de ${localStorage.getItem('filament_diameter')||'1.75'} mm (configurable en Umbrales de mantención)"><div class="kpi-label">Filamento total · ${localStorage.getItem('filament_material')||'PLA'} ${localStorage.getItem('filament_diameter')||'1.75'}mm</div><div class="kpi-value">${totalFilKg}kg</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
      <div class="card" style="padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">IMPRESIONES POR DÍA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.count/maxCount*76,d.count>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:var(--accent);border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.count>0?4:1}px;opacity:0.85"></div><div style="font-size:10px;color:var(--text3)">${d.label}</div>${d.count>0?`<div style="font-size:10px;font-weight:700;color:var(--accent)">${d.count}</div>`:'<div style="font-size:10px;color:var(--border2)">—</div>'}</div>`;}).join('')}
        </div>
      </div>
      <div class="card" style="padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">HORAS ACTIVAS POR DÍA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.hours/maxHours*76,d.hours>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:#a78bfa;border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.hours>0?4:1}px;opacity:0.85"></div><div style="font-size:10px;color:var(--text3)">${d.label}</div>${d.hours>0?`<div style="font-size:10px;font-weight:700;color:#a78bfa">${d.hours}h</div>`:'<div style="font-size:10px;color:var(--border2)">—</div>'}</div>`;}).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="padding:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">TOP MÁQUINAS POR HORAS ACUMULADAS</div>
      ${byPrinter.map(({m,h})=>{const pct=Math.round(h/maxPH*100);const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div style="font-size:12px;color:var(--text);white-space:nowrap;min-width:160px">${m.nombre} <span style="color:var(--text3)">#${m.numG}</span></div><div style="flex:1;background:var(--surface2);border-radius:4px;height:8px;overflow:hidden"><div style="background:${gc?.color||'var(--accent)'};height:100%;width:${pct}%;border-radius:4px"></div></div><div style="font-size:10.5px;color:var(--text3);min-width:40px;text-align:right">${h.toFixed(1)}h</div></div>`;}).join('')}
    </div>`;
}

function initDemoPrinters(){
  const files=['soporte_repisa_v2','pieza_engranaje_caja_v3','carcasa_iot_slim',
    'base_macetero_espiral_lg','articulacion_robotica_v3','soporte_camara_tripode',
    'organizador_cables_escritorio','cubierta_sensor_v2','tapa_contenedor_h80',
    'pieza_personalizada_47b','frame_display_7in_v2','boquilla_riego_360deg',
    'bisagra_mueble_oculta','soporte_pantalla_doble'];
  const states=[
    {state:'printing',pct:15,file:files[0]},
    {state:'printing',pct:43,file:files[1]},
    {state:'printing',pct:72,file:files[2]},
    {state:'printing',pct:28,file:files[3]},
    {state:'printing',pct:88,file:files[4]},
    {state:'printing',pct:56,file:files[5]},
    {state:'printing',pct:34,file:files[6]},
    {state:'printing',pct:8, file:files[7]},
    {state:'printing',pct:65,file:files[8]},
    {state:'paused',  pct:48,file:files[9]},
    {state:'paused',  pct:19,file:files[10]},
    {state:'standby', pct:0, file:''},
    {state:'standby', pct:0, file:''},
    {state:'complete',pct:100,file:files[13]},
  ];
  MAQUINAS.forEach((m,i)=>{
    const ds=states[i]||{state:'standby',pct:0,file:''};
    _demoPrinterState[m.id]={...ds};
    const ip=ds.state==='printing'||ds.state==='paused';
    const hotend=ip?{actual:210+Math.floor(Math.random()*10),target:220}:{actual:24+Math.floor(Math.random()*4),target:0};
    const bed=ip?{actual:57+Math.floor(Math.random()*4),target:60}:{actual:22,target:0};
    const elapsed=ds.pct>0?Math.round(ds.pct*210):0;
    const eta=ds.pct>0&&ds.pct<100?Math.round((100-ds.pct)*210):0;
    _printerStatus[m.id]={state:ds.state,progress:ds.pct,filename:ds.file,thumbUrl:null,filamentMm:Math.round(ds.pct*3.2),hotend,bed,elapsed,eta,ip:getPrinterIp(m)||m.ip||'192.168.100.x'};
    _tempHistory[m.id]=[];
    for(let j=0;j<15;j++) _tempHistory[m.id].push({h:hotend.actual+(Math.random()*4-2)|0,b:bed.actual+(Math.random()*2-1)|0});
  });
  // Pre-poblar historial de impresión para renderProductionAnalytics()
  const _existingHist=[];try{const _eh=localStorage.getItem(HIST_KEY);if(_eh) _existingHist.push(...JSON.parse(_eh));}catch(e){}
  if(!_existingHist.length){
    const _hFiles=['soporte_repisa_v2','pieza_engranaje_v3','carcasa_iot_slim','base_macetero_lg','articulacion_robotica','soporte_camara','organizador_cables','cubierta_sensor','tapa_contenedor','pieza_custom_47','frame_display_7in','bisagra_mueble','soporte_pantalla_doble','boquilla_riego_360'];
    const _now=Date.now();
    const _demoHist=[];
    // 7 días de historial: [impresiones, horasPromedio] por día
    const _dayPlan=[
      [8,2.5],[11,2.8],[6,3.1],[9,2.4],[12,2.6],[10,2.9],[5,2.2]
    ];
    _dayPlan.forEach((plan,dayOffset)=>{
      const [count,avgH]=plan;
      const dayBase=_now-(6-dayOffset)*86400000;
      const mqList=MAQUINAS.filter(m=>m.modelo!=='Giga');
      for(let j=0;j<count;j++){
        const m=mqList[j%mqList.length];
        const dur=Math.round((avgH+(Math.random()*0.8-0.4))*60);
        const startT=dayBase+j*3600000*2;
        const endT=startT+dur*60000;
        const filMm=Math.round(dur*18+Math.random()*400);
        _demoHist.push({id:m.id,nombre:m.nombre,numG:m.numG,file:_hFiles[j%_hFiles.length],start:startT,end:endT,dur,result:'Completado',filamentMm:filMm,ts:endT});
      }
    });
    try{localStorage.setItem(HIST_KEY,JSON.stringify(_demoHist));}catch(e){}
  }
}

async function pollPrintersDemoTick(){
  if(Object.keys(_demoPrinterState).length===0) initDemoPrinters();
  MAQUINAS.forEach(m=>{
    const ds=_demoPrinterState[m.id];if(!ds)return;
    if(ds.state==='printing'){
      ds.pct=Math.min(99,ds.pct+(Math.floor(Math.random()*2)+1));
      if(ds.pct>=99){ds.state='complete';ds.pct=100;}
    }
    const ip=ds.state==='printing'||ds.state==='paused';
    const hotend=ip?{actual:210+Math.floor(Math.random()*10),target:220}:{actual:24+Math.floor(Math.random()*4),target:0};
    const bed=ip?{actual:57+Math.floor(Math.random()*4),target:60}:{actual:22,target:0};
    const elapsed=ds.pct>0?Math.round(ds.pct*210):0;
    const eta=ds.pct>0&&ds.pct<100?Math.round((100-ds.pct)*210):0;
    _printerStatus[m.id]={state:ds.state,progress:ds.pct,filename:ds.file,thumbUrl:null,filamentMm:Math.round(ds.pct*3.2),hotend,bed,elapsed,eta,ip:getPrinterIp(m)||m.ip||'192.168.100.x'};
    if(!_tempHistory[m.id])_tempHistory[m.id]=[];
    _tempHistory[m.id].push({h:hotend.actual,b:bed.actual});
    if(_tempHistory[m.id].length>20)_tempHistory[m.id].shift();
  });
  _pollCount++;
  checkIdleAlerts();
  renderMonitorKPIs();
  renderMonitorGrid();
  const lu=document.getElementById('monitorLastUpdate');
  if(lu)lu.textContent=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  if(_pollCount%4===0){renderMaintenanceTable();renderProductionAnalytics();}
}

let _pollCount=0;
let _pollInFlight=false;
// Recorre los items con concurrencia limitada para no disparar todas las
// impresoras a la vez: en modo remoto esa ráfaga simultánea satura el único
// túnel/bridge (timeouts → "Offline") y es más amable con el host Moonraker.
async function _mapLimit(items,limit,fn){
  let i=0;
  const run=async()=>{while(i<items.length){const idx=i++;try{await fn(items[idx]);}catch(e){}}};
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
}
// Aplica una lectura al estado, con histéresis: un fallo aislado NO marca
// Offline ni borra el estado bueno — lo conserva como "stale" hasta acumular
// _OFFLINE_AFTER_FAILS fallos seguidos. Además programa backoff por máquina
// para no martillar al bridge con una impresora apagada. Lo usan polling y WS.
function _applyStatus(m,s){
  if(s&&s._remotePathFail){
    const prev=_printerStatus[m.id];
    _nextPollAt[m.id]=Date.now()+4000+Math.floor(Math.random()*1200);
    if(prev&&prev.state!=='offline'&&prev.state!=='noip'&&prev.state!=='connecting'){
      _printerStatus[m.id]={...prev,stale:true,remoteDegraded:true,connectionError:s.connectionError,checkedAt:s.checkedAt,staleSince:prev.staleSince||Date.now()};
    }else{
      _printerStatus[m.id]={...(prev||_printerInitialStatus(m)),state:'connecting',remoteDegraded:true,connectionError:s.connectionError,checkedAt:s.checkedAt};
    }
    _emitPrinterStatus(m,_printerStatus[m.id]);return;
  }
  if(s&&s._fetchFail){
    const central=_printerUsesRemoteTunnel()?_centralFarmMachineEvidence(m.id):null;
    if(central?.online===true){
      const prev=_printerStatus[m.id];
      _failCount[m.id]=0;_nextPollAt[m.id]=Date.now()+5000+Math.floor(Math.random()*1200);
      if(prev&&prev.state!=='offline'&&prev.state!=='noip'&&prev.state!=='connecting'){
        _printerStatus[m.id]={...prev,stale:true,remoteDegraded:true,connectionError:'Lectura remota intermitente; Farm Controller confirma máquina en línea',checkedAt:s.checkedAt,staleSince:prev.staleSince||Date.now()};
      }else{
        _printerStatus[m.id]={...(prev||_printerInitialStatus(m)),state:'connecting',remoteDegraded:true,connectionError:'Farm Controller confirma máquina en línea; esperando telemetría remota',checkedAt:s.checkedAt};
      }
      _emitPrinterStatus(m,_printerStatus[m.id]);return;
    }
    const n=(_failCount[m.id]=(_failCount[m.id]||0)+1);
    const prev=_printerStatus[m.id];
    // backoff exponencial (2s,4s,8s… máx 60s) + jitter
    _nextPollAt[m.id]=Date.now()+Math.min(60000,2000*Math.pow(2,Math.max(0,n-1)))+Math.floor(Math.random()*1500);
    if(n<_OFFLINE_AFTER_FAILS&&prev&&prev.state!=='offline'&&prev.state!=='noip'&&prev.state!=='connecting'){
      _printerStatus[m.id]={...prev,stale:true,connectionError:s.connectionError,checkedAt:s.checkedAt,staleSince:prev.staleSince||Date.now()};
      _emitPrinterStatus(m,_printerStatus[m.id]);
      return;
    }
    if(n<_OFFLINE_AFTER_FAILS&&(!prev||prev.state==='connecting')){
      _printerStatus[m.id]={...(prev||_printerInitialStatus(m)),state:'connecting',attempt:n,connectionError:s.connectionError,checkedAt:s.checkedAt};
      _emitPrinterStatus(m,_printerStatus[m.id]);
      return;
    }
    const failed={...s,lastSeenAt:prev?.lastSeenAt||0,disconnectedAt:prev?.disconnectedAt||Date.now()};
    checkTransitions(m,failed);_printerStatus[m.id]=failed;_emitPrinterStatus(m,failed);return;
  }
  _failCount[m.id]=0;_nextPollAt[m.id]=0;
  checkTransitions(m,s);_printerStatus[m.id]=s;_emitPrinterStatus(m,s);
  if(s&&s.hotend){if(!_tempHistory[m.id])_tempHistory[m.id]=[];_tempHistory[m.id].push({h:s.hotend.actual,b:s.bed?.actual||0});if(_tempHistory[m.id].length>20)_tempHistory[m.id].shift();}
}
async function pollPrinters(){
  if(window._DEMO_MODE){await pollPrintersDemoTick();return;}
  if(_pollInFlight)return;
  _pollInFlight=true;
  try{
    const now=Date.now();
    await _mapLimit(MAQUINAS,_printerUsesRemoteTunnel()?2:4,async m=>{
      if(_wsFresh(m.id,now))return;
      if(_nextPollAt[m.id]&&now<_nextPollAt[m.id])return;
      const s=await fetchPrinterStatus(m);
      _applyStatus(m,s);
    });
  }finally{_pollInFlight=false;}
  _pollCount++;
  checkIdleAlerts();
  renderMonitorKPIs();
  renderMonitorGrid();
  const lu=document.getElementById('monitorLastUpdate');if(lu)lu.textContent=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  if(_pollCount%4===0){renderMaintenanceTable();renderProductionAnalytics();}
}

function renderMaquinasKPIs(dias,todayStr){
  const total=MAQUINAS.length*dias.length;
  let usados=0,mant=0,horas=0,dispHoy=0,usoHoy=0,mantHoy=0;
  MAQUINAS.forEach(m=>{
    const globalMant=getMaquinaEstadoGlobal(m.id)!=='disponible';
    dias.forEach(d=>{
      const ds=fmtDate(d),key=`${m.id}_${ds}`,ev=maquinaState.eventos[key];
      const esMant=globalMant||ev?.tipo==='mantencion';
      const esUso=!globalMant&&ev?.tipo==='uso';
      if(esMant){mant++;if(ds===todayStr) mantHoy++;}
      else if(esUso){usados++;horas+=ev.tiempo||0;if(ds===todayStr) usoHoy++;}
      else{if(ds===todayStr) dispHoy++;}
    });
  });
  const ocupados=usados+mant,pct=Math.round(ocupados/total*100);
  const pctColor=pct>=80?'var(--danger)':pct>=50?'var(--warn)':'var(--accent3)';
  const pctCls=pct>=80?'red':pct>=50?'yellow':'green';
  document.getElementById('maquinasKPIs').innerHTML=`<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:0">
    <div class="kpi-card green"><div class="kpi-label">Disponibles hoy</div><div class="kpi-value" style="color:var(--accent3)">${dispHoy}</div><div class="kpi-sub">de ${MAQUINAS.length} máquinas</div></div>
    <div class="kpi-card orange"><div class="kpi-label">En uso hoy</div><div class="kpi-value" style="color:var(--accent2)">${usoHoy}</div><div class="kpi-sub">${mantHoy>0?`${mantHoy} en mantención`:'sin mantención'}</div></div>
    <div class="kpi-card ${pctCls}"><div class="kpi-label">Utilización semana</div><div class="kpi-value" style="color:${pctColor}">${pct}%</div><div class="kpi-sub">${ocupados}/${total} slots</div></div>
    <div class="kpi-card yellow"><div class="kpi-label">Horas en producción</div><div class="kpi-value" style="color:var(--accent)">${horas>0?horas.toFixed(0)+'h':'—'}</div><div class="kpi-sub">estimadas semana</div></div>
  </div>`;
}

function renderHeatmapSemanas(){
  const el=document.getElementById('heatmapSemanas');if(!el) return;
  const todayDate=new Date();todayDate.setHours(0,0,0,0);
  const dow=todayDate.getDay();
  const thisMon=todayDate.getTime()-((dow===0?6:dow-1)*86400000);
  const fmtC=d=>_DTF_DM.format(d);
  const pctColor=p=>p>=80?'var(--danger)':p>=50?'var(--warn)':p>0?'var(--accent3)':'var(--text3)';
  const pctBg=p=>p>=80?'rgba(255,68,68,0.1)':p>=50?'rgba(255,170,0,0.1)':'transparent';
  const chips=[];
  for(let w=-2;w<=9;w++){
    const lunMs=thisMon+w*7*86400000;
    const lun=new Date(lunMs);
    const dias=[];for(let i=0;i<7;i++) dias.push(fmtDate(new Date(lunMs+i*86400000)));
    let occ=0;
    MAQUINAS.forEach(m=>{dias.forEach(ds=>{const ev=maquinaState.eventos[`${m.id}_${ds}`];if(ev&&ev.tipo!=='disponible') occ++;});});
    const pct=Math.round(occ/(MAQUINAS.length*7)*100);
    const isCur=w===maquinaState.semanaOffset;
    const isNow=w===0;
    chips.push(`<button onclick="jumpToSemana(${w})" title="${fmtC(lun)}" style="flex-shrink:0;background:${isCur?'rgba(0,212,204,0.1)':pctBg(pct)};border:1px solid ${isCur?'var(--accent)':'var(--border2)'};border-radius:8px;padding:6px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:68px;transition:border-color 0.12s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='${isCur?'var(--accent)':'var(--border2)'}'">
      <div style="font-size:9.5px;color:${isCur?'var(--accent)':isNow?'var(--text)':'var(--text3)'};font-family:'JetBrains Mono',monospace;white-space:nowrap;font-weight:${isNow?700:400}">${isNow?'← HOY':fmtC(lun)}</div>
      <div style="width:46px;height:4px;border-radius:2px;background:var(--surface3);overflow:hidden"><div style="width:${pct}%;height:100%;background:${pctColor(pct)};border-radius:2px;transition:width 0.3s"></div></div>
      <div style="font-size:10px;font-weight:700;color:${isCur?'var(--accent)':pctColor(pct)}">${pct>0?pct+'%':'libre'}</div>
    </button>`);
  }
  el.innerHTML=`<div style="display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px">${chips.join('')}</div>`;
}
function jumpToSemana(w){maquinaState.semanaOffset=w;renderMaquinasCalendar();}

function renderMaquinasCalendar(){
  const lunes=getMaquinaSemanaLunes();const dias=[];for(let i=0;i<7;i++){const d=new Date(lunes);d.setDate(lunes.getDate()+i);dias.push(d);}
  const today=fmtDate(new Date());const opts={day:'numeric',month:'short'};
  document.getElementById('semanaLabel').textContent=`${dias[0].toLocaleDateString('es-CL',opts)} — ${dias[6].toLocaleDateString('es-CL',opts)} ${dias[0].getFullYear()}`;
  renderHeatmapSemanas();
  renderMaquinasKPIs(dias,today);
  document.getElementById('maquinasHeader').innerHTML=`<tr><th style="padding:9px 14px;font-size:10.5px;text-transform:uppercase;color:var(--text3);text-align:left;border-bottom:1px solid var(--border);min-width:160px;background:var(--surface);position:sticky;left:0;z-index:3">Máquina</th><th style="padding:9px 10px;font-size:10.5px;color:var(--text3);text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:3;min-width:70px">Estado</th>${dias.map(d=>{const isH=fmtDate(d)===today;return`<th style="padding:7px 4px;font-size:10.5px;font-weight:${isH?700:500};color:${isH?'var(--accent)':'var(--text3)'};text-align:center;border-bottom:1px solid var(--border);min-width:95px;background:var(--surface)">${fmtDayLabel(d)}</th>`;}).join('')}</tr>`;
  // pre-calcular stats por modelo para los headers de grupo
  const modeloStats={};[...new Set(MAQUINAS.map(m=>m.modelo))].forEach(modelo=>{
    const mqs=MAQUINAS.filter(x=>x.modelo===modelo);
    const disp=mqs.filter(x=>getMaquinaEstadoGlobal(x.id)==='disponible'&&!maquinaState.eventos[`${x.id}_${today}`]).length;
    const usados=mqs.reduce((s,x)=>{let u=0;dias.forEach(d=>{const ev=maquinaState.eventos[`${x.id}_${fmtDate(d)}`];if(ev&&ev.tipo==='uso') u++;});return s+u;},0);
    const totalSlots=mqs.length*dias.length;
    modeloStats[modelo]={total:mqs.length,disp,pct:Math.round(usados/totalSlots*100)};
  });
  let lastModelo='';
  document.getElementById('maquinasBody').innerHTML=MAQUINAS.map(m=>{
    const isNewGroup=m.modelo!==lastModelo;lastModelo=m.modelo;
    const ms=modeloStats[m.modelo]||{total:0,disp:0,pct:0};
    const dispColor=ms.disp>0?'var(--accent3)':'var(--danger)';
    const dispBg=ms.disp>0?'rgba(0,212,170,0.1)':'rgba(255,68,68,0.1)';
    const dispBorder=ms.disp>0?'rgba(0,212,170,0.3)':'rgba(255,68,68,0.3)';
    const groupRow=isNewGroup?`<tr><td colspan="${dias.length+2}" style="padding:7px 14px;background:rgba(0,0,0,0.35);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        ${MODELO_IMGS[m.modelo]?`<img loading="lazy" decoding="async" src="${MODELO_IMGS[m.modelo]}" alt="${m.modelo}" style="height:32px;width:auto;object-fit:contain;filter:brightness(0.9)" onerror="this.style.display='none'">`:''}
        <div>
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${m.color}">${m.modelo}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:1px">${MODEL_SPECS[m.modelo]||''}</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;font-weight:700;color:${dispColor};background:${dispBg};border:1px solid ${dispBorder};border-radius:4px;padding:2px 8px">${ms.disp}/${ms.total} disponibles hoy</span>
          ${ms.pct>0?`<span style="font-size:10px;color:var(--text3)">${ms.pct>0?ms.pct+'% uso semana':''}</span>`:''}
        </div>
      </div>
    </td></tr>`:'' ;
    const estadoGlobal=getMaquinaEstadoGlobal(m.id),estadoMeta=maquinaEstadoMeta(estadoGlobal);
    const estadoBtn=`<button class="btn-mini btn-mini-${estadoMeta.color}" onclick="toggleMaquinaEstado('${m.id}')" title="${escapeHtml(estadoMeta.label)} · clic para ${estadoGlobal==='disponible'?'poner en mantención':'marcar disponible'}">${estadoMeta.short}</button>`;
    const celdas=dias.map(d=>{const ds=fmtDate(d),key=`${m.id}_${ds}`,ev=maquinaState.eventos[key],isH=ds===today;let bg='',content='';if(ev){if(ev.tipo==='mantencion'){bg='rgba(255,68,68,0.2)';content=`<div style="font-size:10px;font-weight:700;color:var(--danger)">🔧 MANT.</div>`;}else if(ev.tipo==='uso'){bg='rgba(255,107,53,0.2)';const pedLabel=ev.pedidoId?state.pedidosById[ev.pedidoId]?.fields['N° Pedido']||null:null;const descLabel=pedLabel?`🔗 ${pedLabel}`:(ev.desc||'En uso');content=`<div style="font-size:10px;color:${pedLabel?'var(--accent)':'var(--accent2)'};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:85px" title="${escapeHtml(ev.desc||'')}">${escapeHtml(descLabel)}</div>${ev.tiempo?`<div style="font-size:9.5px;color:var(--text3)">${ev.tiempo}h</div>`:''}`;}else{bg='rgba(0,212,170,0.12)';content=`<div style="font-size:10px;color:var(--accent3);font-weight:600">✓ Libre</div>`;}}return`<td onclick="openMaquinaModal('${m.id}','${m.nombre} #${m.num}','${ds}')" style="padding:3px;text-align:center;border-bottom:1px solid var(--border);border-left:${isH?'2px solid var(--accent)':'1px solid var(--border)'};background:${bg||'transparent'};cursor:pointer;vertical-align:middle" onmouseenter="this.style.filter='brightness(1.5)'" onmouseleave="this.style.filter='brightness(1)'"><div style="min-height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${content||`<span style="color:var(--text3);font-size:10.5px">+</span>`}${ev?`<button onclick="event.stopPropagation();deleteMaquinaEvento('${m.id}','${ds}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:9.5px;padding:0">✕</button>`:''}</div></td>`;}).join('');
    return`${groupRow}<tr><td style="padding:9px 14px;font-size:12px;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:2"><span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block;margin-right:6px"></span>${escapeHtml(m.nombre)} <span style="color:var(--text3)">#${m.num}</span></td><td style="padding:4px 6px;text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:2">${estadoBtn}</td>${celdas}</tr>`;
  }).join('');
  document.getElementById('maquinasSubtitle').textContent=`${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)==='disponible').length} disponibles · ${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)!=='disponible').length} no operativas`;
}
function openMaquinaModal(maqId,nombre,dateStr){
  document.getElementById('maquinaModalId').value=maqId;
  document.getElementById('maquinaModalDate').value=dateStr;
  document.getElementById('maquinaModalTitle').textContent=`📅 ${nombre} — ${dateStr}`;
  document.getElementById('maquinaModalFechaInicio').value=dateStr;
  document.getElementById('maquinaModalFechaFin').value=dateStr;
  // poblar select de pedidos activos
  const activos=state.pedidos.filter(p=>!['Despachado','Completado','Cancelado'].includes(p.fields['Estado pedido']||''));
  const sel=document.getElementById('maquinaModalPedido');
  sel.innerHTML='<option value="">— sin pedido vinculado —</option>'+activos.map(p=>{
    const f=p.fields;
    return`<option value="${p.id}">${escapeHtml(f['N° Pedido']||'—')} · ${escapeHtml(resolveClienteName(f['Cliente']))} · ${escapeHtml(f['Estado pedido']||'—')}</option>`;
  }).join('');
  // restaurar estado del evento existente si lo hay
  const ev=maquinaState.eventos[`${maqId}_${dateStr}`];
  if(ev){
    document.getElementById('maquinaModalTipo').value=ev.tipo||'uso';
    document.getElementById('maquinaModalDesc').value=ev.desc||'';
    document.getElementById('maquinaModalTiempo').value=ev.tiempo||'';
    // intentar re-vincular pedido desde descripción
    if(ev.pedidoId) sel.value=ev.pedidoId;
    else{const match=activos.find(p=>ev.desc&&ev.desc.startsWith(p.fields['N° Pedido']||'##'));if(match) sel.value=match.id;}
  }else{
    document.getElementById('maquinaModalTipo').value='uso';
    document.getElementById('maquinaModalDesc').value='';
    document.getElementById('maquinaModalTiempo').value='';
    sel.value='';
  }
  onMaquinaModalTipoChange();
  document.getElementById('maquinaEventModal').style.display='flex';
}
function closeMaquinaModal(){document.getElementById('maquinaEventModal').style.display='none';}
function onMaquinaModalTipoChange(){
  const tipo=document.getElementById('maquinaModalTipo').value;
  const esUso=tipo==='uso',esDisp=tipo==='disponible';
  document.getElementById('maquinaModalPedidoGroup').style.display=esUso?'flex':'none';
  document.getElementById('maquinaModalDescGroup').style.display=esDisp?'none':'flex';
  document.getElementById('maquinaModalTiempoGroup').style.display=esUso?'flex':'none';
}
function onMaquinaModalPedidoChange(){
  const sel=document.getElementById('maquinaModalPedido');
  const pid=sel.value;if(!pid) return;
  const p=state.pedidosById[pid];if(!p) return;
  const f=p.fields;
  const nPed=f['N° Pedido']||'—',cliente=resolveClienteName(f['Cliente']),estado=f['Estado pedido']||'—';
  document.getElementById('maquinaModalDesc').value=`${nPed} · ${cliente}`;
  // Sugerir horas sólo desde trabajos técnicos MachineOps vinculados a esta
  // impresora/pedido. El valor comercial del pedido no representa horas de máquina.
  if(!document.getElementById('maquinaModalTiempo').value){
    try{
      const machineId=document.getElementById('maquinaModalId')?.value||'';
      const ops=JSON.parse(localStorage.getItem('thelab_machine_ops_v2')||'{}');
      const jobs=(Array.isArray(ops.jobs)?ops.jobs:[]).filter(j=>!j.archived&&j.pedidoId===pid&&(!machineId||j.machineId===machineId));
      const minutes=jobs.reduce((sum,j)=>sum+Math.max(1,Number(j.cycles)||1)*Math.max(1,Number(j.minutesPerCycle)||0),0);
      if(minutes>0)document.getElementById('maquinaModalTiempo').value=Math.round(minutes/60*10)/10;
    }catch(_){}
  }
}
async function saveMaquinaEvento(){
  const maqId=document.getElementById('maquinaModalId').value,tipo=document.getElementById('maquinaModalTipo').value,desc=document.getElementById('maquinaModalDesc').value,tiempo=document.getElementById('maquinaModalTiempo').value,fi=document.getElementById('maquinaModalFechaInicio').value,ff=document.getElementById('maquinaModalFechaFin').value;
  if(!fi||!ff){toast('Ingresa las fechas','error');return;}
  const pedidoId=document.getElementById('maquinaModalPedido')?.value||'';
  const start=new Date(fi+'T00:00:00'),end=new Date(ff+'T00:00:00');let count=0;
  const outboxOps=[];
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const key=`${maqId}_${fmtDate(new Date(d))}`;
    if(tipo==='disponible'){delete maquinaState.eventos[key];outboxOps.push({type:'delete',key});}
    else{const ev={tipo,desc,tiempo:parseFloat(tiempo)||null};if(pedidoId)ev.pedidoId=pedidoId;maquinaState.eventos[key]=ev;outboxOps.push({type:'set',key,value:ev});}
    count++;
  }
  _queueMachineEventOps(outboxOps);
  closeMaquinaModal();renderMaquinasCalendar();toast(`✓ ${count} día${count>1?'s':''} marcados — sincronizando...`,'info');
  const synced=await flushMachineEventOutbox();
  toast(synced?'✓ Guardado en Airtable':'Guardado localmente · sincronización pendiente',synced?'success':'info');
}
async function deleteMaquinaEvento(maqId,dateStr){
  const key=`${maqId}_${dateStr}`;delete maquinaState.eventos[key];_queueMachineEventOps([{type:'delete',key}]);renderMaquinasCalendar();
  const synced=await flushMachineEventOutbox();
  toast(synced?'Evento eliminado':'Eliminación guardada localmente · sincronización pendiente',synced?'info':'warning');
}

// ── EQUIPO ────────────────────────────────────────────────────
async function initEquipo(){
  await loadEquipoEventosAirtable();
  const el=document.getElementById('gcalPersonasConfig');if(el) el.innerHTML=PERSONAS.map(p=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${_avHtml(p,28)}<span style="min-width:140px;font-size:12px">${p.nombre}</span><input class="field-input" id="gcal_cid_${p.id}" placeholder="email@gmail.com" value="${p.gcalId}" style="font-size:12px;flex:1"><input class="field-input" id="gcal_key_${p.id}" placeholder="AIza... API Key" value="${sessionStorage.getItem('gcal_api_key')||''}" style="font-size:12px;flex:1"></div>`).join('');
  const anyGcal=PERSONAS.some(p=>sessionStorage.getItem('gcal_persona_'+p.id));if(anyGcal){PERSONAS.forEach(p=>{const cid=sessionStorage.getItem('gcal_persona_'+p.id);if(cid) p.gcalId=cid;});document.getElementById('gcalEquipoSyncBtn').style.display='inline-flex';}
  renderEquipoCalendar();
  try{renderComisiones();}catch(e){}
}
function toggleGcalEquipoConfig(){const el=document.getElementById('gcalEquipoConfig');el.style.display=el.style.display==='none'?'block':'none';}
function saveGcalEquipoConfig(){PERSONAS.forEach(p=>{const cid=document.getElementById(`gcal_cid_${p.id}`)?.value.trim();const key=document.getElementById(`gcal_key_${p.id}`)?.value.trim();if(cid){p.gcalId=cid;sessionStorage.setItem('gcal_persona_'+p.id,cid);}if(key) sessionStorage.setItem('gcal_api_key',key);});toggleGcalEquipoConfig();document.getElementById('gcalEquipoSyncBtn').style.display='inline-flex';toast('✓ Calendarios configurados','success');syncGcalEquipo();}
function getEquipoSemanaLunes(){const t=new Date();t.setHours(0,0,0,0);const day=t.getDay();const l=new Date(t);l.setDate(t.getDate()-(day===0?6:day-1)+(equipoState.semanaOffset*7));return l;}
function navEquipoSemana(d){equipoState.semanaOffset+=d;renderEquipoCalendar();}
function goEquipoToday(){equipoState.semanaOffset=0;renderEquipoCalendar();}
function renderEquipoCalendar(){
  const lunes=getEquipoSemanaLunes();const dias=[];for(let i=0;i<7;i++){const d=new Date(lunes);d.setDate(lunes.getDate()+i);dias.push(d);}
  const today=fmtDate(new Date());const opts={day:'numeric',month:'short'};
  document.getElementById('equipoSemanaLabel').textContent=`${dias[0].toLocaleDateString('es-CL',opts)} — ${dias[6].toLocaleDateString('es-CL',opts)} ${dias[0].getFullYear()}`;
  renderEquipoResumenHoy(today);
  document.getElementById('equipoHeader').innerHTML=`<tr><th style="padding:10px 14px;font-size:10.5px;text-transform:uppercase;color:var(--text3);text-align:left;border-bottom:1px solid var(--border);min-width:170px;background:var(--surface);position:sticky;left:0;z-index:2">Persona</th>${dias.map(d=>{const isH=fmtDate(d)===today,esFinde=d.getDay()===0||d.getDay()===6;return`<th style="padding:7px 5px;font-size:10.5px;font-weight:${isH?700:500};color:${isH?'var(--accent)':esFinde?'var(--text3)':'var(--text2)'};text-align:center;border-bottom:1px solid var(--border);min-width:100px;background:var(--surface)">${fmtDayLabel(d)}${esFinde?'<br><span style="font-size:9.5px;color:var(--text3)">finde</span>':''}</th>`;}).join('')}</tr>`;
  document.getElementById('equipoBody').innerHTML=PERSONAS.map(p=>{
    const celdas=dias.map(d=>{const ds=fmtDate(d),key=`${p.id}_${ds}`,ev=equipoState.eventos[key],isH=ds===today,esFinde=d.getDay()===0||d.getDay()===6;const cfg=ev?(EQUIPO_TIPOS[ev.tipo]||EQUIPO_TIPOS.disponible):null;const bg=cfg?cfg.bg:esFinde?'rgba(255,255,255,0.01)':'transparent';let content='';if(cfg){content=`<div style="font-size:10.5px;font-weight:700;color:${cfg.color}">${cfg.icon} ${cfg.label}</div>${ev.desc?`<div style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:88px">${escapeHtml(ev.desc)}</div>`:''}<button onclick="event.stopPropagation();deleteEquipoEvento('${p.id}','${ds}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:9.5px;padding:0">✕</button>`;}else{content=`<span style="color:var(--text3);font-size:10.5px">${esFinde?'—':'+'}</span>`;}return`<td onclick="openEquipoModal('${p.id}','${p.nombre}','${ds}')" style="padding:3px;text-align:center;border-bottom:1px solid var(--border);border-left:${isH?'2px solid var(--accent)':'1px solid var(--border)'};background:${bg};cursor:pointer;vertical-align:middle" onmouseenter="this.style.filter='brightness(1.4)'" onmouseleave="this.style.filter='brightness(1)'"><div style="min-height:42px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${content}</div></td>`;}).join('');
    const dispCount=dias.filter(d=>{const ev=equipoState.eventos[`${p.id}_${fmtDate(d)}`];return !ev||ev.tipo==='disponible';}).length;
    return`<tr><td style="padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:1"><div style="display:flex;align-items:center;gap:9px">${_avHtml(p,34)}<div><div style="font-size:12px;font-weight:600">${escapeHtml(p.nombre)}</div><div style="font-size:10.5px;color:var(--text3)">${p.rol} · ${dispCount}/7 disp.</div></div></div></td>${celdas}</tr>`;
  }).join('');
  renderEquipoDetalleSemana(dias);
  const ausentes=PERSONAS.filter(p=>{const ev=equipoState.eventos[`${p.id}_${today}`];return ev&&['ausente','vacaciones'].includes(ev.tipo);}).length;
  document.getElementById('equipoSubtitle').textContent=`${PERSONAS.length-ausentes} disponibles · ${ausentes} ausentes hoy`;
}
function renderEquipoResumenHoy(today){
  const todayDate=new Date(today+'T00:00:00');
  document.getElementById('equipoResumenHoy').innerHTML=PERSONAS.map(p=>{
    const ev=equipoState.eventos[`${p.id}_${today}`];
    const cfg=ev?(EQUIPO_TIPOS[ev.tipo]||EQUIPO_TIPOS.disponible):EQUIPO_TIPOS.disponible;
    // #1 Carga de trabajo: pedidos activos asignados a esta persona
    const fn=p.nombre.split(' ')[0].toLowerCase();
    const misPedidos=state.pedidos.filter(x=>{
      const ea=(x.fields['Equipo asignado']||'').toLowerCase();
      return ea.includes(fn)&&!['Despachado','Completado','Cancelado'].includes(x.fields['Estado pedido']||'');
    });
    const proxEntrega=misPedidos
      .filter(x=>x.fields['Fecha entrega']&&new Date(x.fields['Fecha entrega']+'T00:00:00')>=todayDate)
      .map(x=>x.fields['Fecha entrega']).sort()[0];
    const proxLabel=proxEntrega?` · próx: ${proxEntrega.substring(5).replace('-','/')}` :'';
    const cargaHtml=misPedidos.length
      ?`<div style="font-size:10.5px;color:var(--accent);margin-top:3px">📦 ${misPedidos.length} pedido${misPedidos.length>1?'s':''} activo${misPedidos.length>1?'s':''}${proxLabel}</div>`
      :`<div style="font-size:10.5px;color:var(--text3);margin-top:3px">Sin pedidos activos</div>`;
    // #2 Alertas de cobertura: ausencia coincide con fecha entrega de un pedido
    const conflictos=[];
    Object.entries(equipoState.eventos).forEach(([key,ev2])=>{
      if(!key.startsWith(p.id+'_')||!['ausente','vacaciones'].includes(ev2.tipo)) return;
      const dk=key.substring(p.id.length+1);
      misPedidos.forEach(x=>{
        if((x.fields['Fecha entrega']||'')===dk)
          conflictos.push({ped:x.fields['N° Pedido']||'?',fecha:dk.substring(5).replace('-','/')});
      });
    });
    const alertaHtml=conflictos.length
      ?`<div style="font-size:10.5px;color:var(--danger);font-weight:700;margin-top:3px">⚠ Conflicto: ${conflictos.map(c=>`${c.ped} vence el ${c.fecha}`).join(' · ')}</div>`
      :'';
    return`<div class="card" style="padding:14px;display:flex;align-items:center;gap:10px${conflictos.length?';border-color:rgba(255,68,68,0.4)':''}">${_avHtml(p,40)}<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700">${escapeHtml(p.nombre)}</div><div style="font-size:12px;color:${cfg.color};font-weight:700">${cfg.icon} ${cfg.label}</div>${ev?.desc?`<div style="font-size:10.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.desc)}</div>`:''}${cargaHtml}${alertaHtml}</div><button class="btn-mini ${ev&&ev.tipo!=='disponible'?'btn-mini-red':'btn-mini-green'}" onclick="quickToggleEquipo('${p.id}','${today}')">${ev&&ev.tipo!=='disponible'?'🔴 Disp.':'🟢 OK'}</button></div>`;
  }).join('');
}
function renderEquipoDetalleSemana(dias){
  document.getElementById('equipoDetalleSemana').innerHTML=PERSONAS.map(p=>{
    // #1 Pedidos activos asignados a esta persona
    const fn=p.nombre.split(' ')[0].toLowerCase();
    const misPedidos=state.pedidos.filter(x=>{
      const ea=(x.fields['Equipo asignado']||'').toLowerCase();
      return ea.includes(fn)&&!['Despachado','Completado','Cancelado'].includes(x.fields['Estado pedido']||'');
    });
    // Mapa fecha→lista de N°Pedido que vencen ese día
    const entregasDias={};
    misPedidos.forEach(x=>{const fe=x.fields['Fecha entrega'];if(fe){if(!entregasDias[fe])entregasDias[fe]=[];entregasDias[fe].push(x.fields['N° Pedido']||'?');}});
    // Contar conflictos en la semana visible
    const conflictCount=dias.filter(d=>{const ds=fmtDate(d),ev=equipoState.eventos[`${p.id}_${ds}`];return ev&&['ausente','vacaciones'].includes(ev.tipo)&&(entregasDias[ds]||[]).length>0;}).length;
    // Filas de días con indicadores de entrega y conflicto
    const eventosHtml=dias.map(d=>{
      const ds=fmtDate(d),ev=equipoState.eventos[`${p.id}_${ds}`],cfg=ev?(EQUIPO_TIPOS[ev.tipo]||null):null,esFinde=d.getDay()===0||d.getDay()===6;
      const pedEseDia=entregasDias[ds]||[];
      const estaAusente=ev&&['ausente','vacaciones'].includes(ev.tipo);
      const conflicto=estaAusente&&pedEseDia.length>0;
      const pedTag=pedEseDia.length?`<span style="font-size:10px;font-weight:700;color:${conflicto?'var(--danger)':'var(--accent)'};margin-left:auto;flex-shrink:0">${conflicto?'⚠ ':'📦 '}${pedEseDia.join(', ')}</span>`:'';
      return`<div style="display:flex;align-items:center;gap:7px;padding:6px 0;border-bottom:1px solid var(--border)${conflicto?';background:rgba(255,68,68,0.06)':''}"><span style="font-size:10.5px;color:var(--text3);min-width:44px">${fmtDayLabel(d)}</span>${cfg?`<span style="font-size:10.5px;font-weight:600;color:${cfg.color}">${cfg.icon} ${cfg.label}</span>${ev.desc?`<span style="font-size:10.5px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;flex:1">${escapeHtml(ev.desc)}</span>`:''}`: `<span style="font-size:10.5px;color:${esFinde?'var(--text3)':'var(--accent3)'}">✓ ${esFinde?'Finde':'Disponible'}</span>`}${pedTag}</div>`;
    }).join('');
    const dispDias=dias.filter(d=>{const ev=equipoState.eventos[`${p.id}_${fmtDate(d)}`];return !ev||ev.tipo==='disponible';}).length;
    const pct=Math.round((dispDias/7)*100);
    const barColor=pct>=70?'var(--accent3)':pct>=40?'var(--warn)':'var(--danger)';
    const statHtml=misPedidos.length
      ?`<div style="font-size:10px;color:${conflictCount?'var(--danger)':'var(--accent)'};margin-top:2px">${conflictCount?`⚠ ${conflictCount} conflicto${conflictCount>1?'s':''}`:`📦 ${misPedidos.length} ped. activo${misPedidos.length>1?'s':''}`}</div>`
      :'';
    return`<div class="card"><div class="card-header"><div style="display:flex;align-items:center;gap:9px">${_avHtml(p,30)}<div><div style="font-size:12px;font-weight:700">${escapeHtml(p.nombre)}</div><div style="font-size:10.5px;color:var(--text3)">${p.rol}</div></div></div><div style="text-align:right"><div style="font-size:16px;font-family:'Bebas Neue';color:${barColor}">${dispDias}/7</div><div style="font-size:10px;color:var(--text3)">días disp.</div>${statHtml}</div></div><div style="padding:0 14px 6px"><div style="height:3px;background:var(--surface3);border-radius:2px;margin-bottom:8px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px"></div></div>${eventosHtml}</div></div>`;
  }).join('');
}
async function quickToggleEquipo(personaId,dateStr){const key=`${personaId}_${dateStr}`,ev=equipoState.eventos[key];if(ev&&ev.tipo!=='disponible'){delete equipoState.eventos[key];renderEquipoCalendar();await saveEquipoEventosAirtable();toast('✓ Disponible','success');}else openEquipoModal(personaId,PERSONAS.find(p=>p.id===personaId)?.nombre||'',dateStr);}
function openEquipoModal(personaId,nombre,dateStr){document.getElementById('equipoModalPersonaId').value=personaId;document.getElementById('equipoModalDate').value=dateStr;const p=PERSONAS.find(x=>x.id===personaId);document.getElementById('equipoModalTitle').innerHTML=`<span style="display:flex;align-items:center;gap:8px">${_avHtml(p,28)}📅 ${escapeHtml(nombre)} — ${dateStr}</span>`;document.getElementById('equipoModalDesc').value='';document.getElementById('equipoModalFechaInicio').value=dateStr;document.getElementById('equipoModalFechaFin').value=dateStr;document.getElementById('equipoModalHoraInicio').value='09:00';document.getElementById('equipoModalHoraFin').value='18:00';document.getElementById('equipoModalTipo').value='ocupado';onEquipoModalTipoChange();document.getElementById('equipoEventModal').style.display='flex';}
function closeEquipoModal(){document.getElementById('equipoEventModal').style.display='none';}
function onEquipoModalTipoChange(){const tipo=document.getElementById('equipoModalTipo').value;const showDesc=!['vacaciones','ausente','disponible'].includes(tipo);const showHoras=['ocupado','reunion','remoto'].includes(tipo);document.getElementById('equipoModalDescGroup').style.display=showDesc?'flex':'none';document.getElementById('equipoModalHorasGroup').style.display=showHoras?'flex':'none';}
async function saveEquipoEvento(){
  const pId=document.getElementById('equipoModalPersonaId').value,tipo=document.getElementById('equipoModalTipo').value,desc=document.getElementById('equipoModalDesc').value,fi=document.getElementById('equipoModalFechaInicio').value,ff=document.getElementById('equipoModalFechaFin').value,horaInicio=document.getElementById('equipoModalHoraInicio').value,horaFin=document.getElementById('equipoModalHoraFin').value;
  if(!fi||!ff){toast('Ingresa las fechas','error');return;}
  const start=new Date(fi+'T00:00:00'),end=new Date(ff+'T00:00:00');let count=0;
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const key=`${pId}_${fmtDate(new Date(d))}`;if(tipo==='disponible') delete equipoState.eventos[key];else equipoState.eventos[key]={tipo,desc,horaInicio,horaFin};count++;}
  const p=PERSONAS.find(x=>x.id===pId);closeEquipoModal();renderEquipoCalendar();
  toast(`✓ ${count} día${count>1?'s':''} → ${p?.nombre} — guardando...`,'info');
  await saveEquipoEventosAirtable();toast('✓ Guardado en Airtable','success');
}
async function deleteEquipoEvento(pId,dateStr){delete equipoState.eventos[`${pId}_${dateStr}`];renderEquipoCalendar();await saveEquipoEventosAirtable();toast('Evento eliminado','info');}
async function syncGcalEquipo(){
  const btn=document.getElementById('gcalEquipoSyncBtn');btn.disabled=true;btn.textContent='⏳ Sync...';
  const lunes=getEquipoSemanaLunes();const dias=[];for(let i=0;i<7;i++){const d=new Date(lunes);d.setDate(lunes.getDate()+i);dias.push(d);}
  const timeMin=encodeURIComponent(dias[0].toISOString()),timeMax=encodeURIComponent(new Date(dias[6].getTime()+86400000).toISOString());let total=0;
  for(const p of PERSONAS){const gcalId=sessionStorage.getItem('gcal_persona_'+p.id);const apiKey=sessionStorage.getItem('gcal_api_key');if(!gcalId||!apiKey) continue;
    try{const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gcalId)}/events?key=${apiKey}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`);if(!r.ok) continue;const data=await r.json();
      (data.items||[]).forEach(ev=>{const sd=(ev.start?.date||ev.start?.dateTime||'').slice(0,10);if(!sd) return;const title=(ev.summary||'').toLowerCase();let tipo='ocupado';if(title.includes('vacacion')) tipo='vacaciones';else if(title.includes('ausente')) tipo='ausente';else if(title.includes('remoto')) tipo='remoto';else if(title.includes('reuni')) tipo='reunion';
        const s=new Date(sd+'T00:00:00'),e2=new Date((ev.end?.date||ev.end?.dateTime||sd).slice(0,10)+'T00:00:00');
        for(let d=new Date(s);d<=e2;d.setDate(d.getDate()+1)){const ds=fmtDate(new Date(d));if(dias.some(x=>fmtDate(x)===ds)){equipoState.eventos[`${p.id}_${ds}`]={tipo,desc:ev.summary,horaInicio:'',horaFin:''};total++;}}});
    }catch(e){toast(`Error sync ${p.nombre}`,'error');}
  }
  toast(`✓ ${total} eventos importados`,'success');await saveEquipoEventosAirtable();renderEquipoCalendar();btn.disabled=false;btn.textContent='🔄 Sync';
}

// ── SOLICITUD ITEMS ───────────────────────────────────────────
function toggleTipoDias(){
  const inp=document.getElementById('cot-tipo-dias');
  const btn=document.getElementById('cot-tipo-dias-btn');
  if(!inp||!btn) return;
  if(inp.value==='DÍAS HÁBILES'){
    inp.value='DÍAS NORMALES';
    btn.textContent='DÍAS NORMALES';
    btn.style.background='rgba(255,170,0,0.15)';
    btn.style.borderColor='rgba(255,170,0,0.5)';
    btn.style.color='var(--accent2)';
  } else {
    inp.value='DÍAS HÁBILES';
    btn.textContent='DÍAS HÁBILES';
    btn.style.background='rgba(0,212,204,0.15)';
    btn.style.borderColor='rgba(0,212,204,0.5)';
    btn.style.color='var(--accent)';
  }
}
function toggleEditTipoDias(){
  const inp=document.getElementById('editCotTipoDias');
  const btn=document.getElementById('editCotTipoDiasBtn');
  if(!inp||!btn) return;
  if(inp.value==='DÍAS HÁBILES'){
    inp.value='DÍAS NORMALES';btn.textContent='DÍAS NORMALES';
    btn.style.background='rgba(255,170,0,0.15)';btn.style.borderColor='rgba(255,170,0,0.5)';btn.style.color='var(--accent2)';
  } else {
    inp.value='DÍAS HÁBILES';btn.textContent='DÍAS HÁBILES';
    btn.style.background='rgba(0,212,204,0.15)';btn.style.borderColor='rgba(0,212,204,0.5)';btn.style.color='var(--accent)';
  }
}

// ── PLAZO DE ENTREGA (rango de días o fecha fija) ─────────────
// Un mismo control en el formulario nuevo ('new') y en el de edición ('edit').
const COT_PLAZO_IDS={
  'new': {modo:'cotPlazoModo',diasWrap:'cotPlazoDiasWrap',fechaWrap:'cotPlazoFechaWrap',min:'cot-tiempo-prod',max:'cot-tiempo-prod-max',tipo:'cot-tipo-dias',tipoBtn:'cot-tipo-dias-btn',fecha:'cot-fecha-entrega',btnDias:'cotPlazoBtnDias',btnFecha:'cotPlazoBtnFecha'},
  'edit':{modo:'editCotPlazoModo',diasWrap:'editCotPlazoDiasWrap',fechaWrap:'editCotPlazoFechaWrap',min:'editCotTiempoProd',max:'editCotTiempoProdMax',tipo:'editCotTipoDias',tipoBtn:'editCotTipoDiasBtn',fecha:'editCotFechaEntrega',btnDias:'editCotPlazoBtnDias',btnFecha:'editCotPlazoBtnFecha'}
};
// Alterna el modo del control: 'dias' (rango N-M) o 'fecha' (fecha fija).
function cotPlazoSetModo(scope,modo){
  const ids=COT_PLAZO_IDS[scope];if(!ids)return;modo=(modo==='fecha')?'fecha':'dias';
  const hid=document.getElementById(ids.modo);if(hid)hid.value=modo;
  const dw=document.getElementById(ids.diasWrap),fw=document.getElementById(ids.fechaWrap);
  if(dw)dw.style.display=(modo==='fecha')?'none':'flex';
  if(fw)fw.style.display=(modo==='fecha')?'flex':'none';
  [[ids.btnDias,modo==='dias'],[ids.btnFecha,modo==='fecha']].forEach(([id,on])=>{const b=document.getElementById(id);if(!b)return;b.style.background=on?'rgba(0,212,204,0.18)':'transparent';b.style.borderColor=on?'rgba(0,212,204,0.55)':'var(--border2)';b.style.color=on?'var(--accent)':'var(--text3)';});
}
// Pinta el botón de tipo de días (hábiles/normales) según el valor guardado.
function _cotPintaTipoDias(ids,tipo){
  const td=document.getElementById(ids.tipo);if(td)td.value=tipo;
  const tdb=document.getElementById(ids.tipoBtn);if(!tdb)return;
  const norm=(tipo==='DÍAS NORMALES');tdb.textContent=tipo;
  tdb.style.background=norm?'rgba(255,170,0,0.15)':'rgba(0,212,204,0.15)';
  tdb.style.borderColor=norm?'rgba(255,170,0,0.5)':'rgba(0,212,204,0.5)';
  tdb.style.color=norm?'var(--accent2)':'var(--accent)';
}
// Carga los valores de plazo de un registro (o vacío) en el control.
function cotPlazoLoad(scope,f){
  const ids=COT_PLAZO_IDS[scope];if(!ids)return;f=f||{};
  const setV=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  setV(ids.min,f['Tiempo de producción']||'');
  setV(ids.max,f['Tiempo de producción máx']||'');
  setV(ids.fecha,f['Fecha de entrega']||'');
  _cotPintaTipoDias(ids,f['Tipo días producción']||'DÍAS HÁBILES');
  cotPlazoSetModo(scope,f['Fecha de entrega']?'fecha':'dias');
}
// Reúne los campos de plazo para Airtable según el modo activo.
// En cada modo pone en null los campos del otro para que al cambiar de modo se limpien.
function cotPlazoFields(scope){
  const ids=COT_PLAZO_IDS[scope];
  const modo=document.getElementById(ids.modo)?.value||'dias';
  if(modo==='fecha'){
    const fecha=document.getElementById(ids.fecha)?.value||'';
    return {'Fecha de entrega':fecha||null,'Tiempo de producción':null,'Tiempo de producción máx':null,'Tipo días producción':null};
  }
  const min=parseInt(document.getElementById(ids.min)?.value)||null;
  let max=parseInt(document.getElementById(ids.max)?.value)||null;
  if(!(min&&max&&max>min))max=null; // el máximo solo cuenta si es mayor que el mínimo
  return {'Tiempo de producción':min,'Tiempo de producción máx':max,'Tipo días producción':min?(document.getElementById(ids.tipo)?.value||'DÍAS HÁBILES'):null,'Fecha de entrega':null};
}

function addSolicitudItem(){
  const inp=document.getElementById('cot-solicitud-inp');const val=(inp?.value||'').trim();if(!val) return;
  const container=document.getElementById('solicitudItems');const item=document.createElement('div');
  item.dataset.value=val;
  item.style.cssText='display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:5px 10px;font-size:12px';
  item.innerHTML=`<span style="color:var(--accent);flex-shrink:0">•</span><span style="flex:1">${escapeHtml(val)}</span><button onclick="removeSolicitudItem(this)" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px;padding:0;line-height:1" onmouseenter="this.style.color='var(--danger)'" onmouseleave="this.style.color='var(--text3)'">✕</button>`;
  container.appendChild(item);inp.value='';syncSolicitudToTextarea();inp.focus();
}
function removeSolicitudItem(btn){btn.closest('[data-value]').remove();syncSolicitudToTextarea();}
function syncSolicitudToTextarea(){
  const items=[...document.querySelectorAll('#solicitudItems [data-value]')].map(el=>'• '+el.dataset.value);
  const ta=document.getElementById('cot-solicitud');if(ta) ta.value=items.join('\n');
}

// ── FORM HELPERS ──────────────────────────────────────────────
function onClienteSearchInput(){
  const inp=document.getElementById('cot-cliente-search'),dropdown=document.getElementById('cot-cliente-dropdown');
  document.getElementById('cot-cliente-id').value='';document.getElementById('cot-cliente-info').textContent='';
  const q=inp.value.toLowerCase().trim();const src=q?state.clientes.filter(c=>((c.fields['Empresa']||'')+' '+(c.fields['Contacto']||'')).toLowerCase().includes(q)).slice(0,8):state.clientes.slice(0,6);
  let html=src.map(c=>`<div class="search-select-item" onclick="selectCliente('${c.id}')"><strong>${escapeHtml(c.fields['Empresa']||'—')}</strong><span class="text-muted text-small" style="margin-left:7px">${escapeHtml(c.fields['Contacto']||'')}</span></div>`).join('');
  if(q&&!src.some(c=>(c.fields['Empresa']||'').toLowerCase()===q)) html+=`<div class="search-select-item create-new" onclick="selectClienteNew()">+ Usar "${escapeHtml(inp.value)}"</div>`;
  dropdown.innerHTML=html;dropdown.classList.toggle('open',!!html);
}
function selectCliente(id){const c=state.clientesByIdRec[id];if(!c) return;document.getElementById('cot-cliente-search').value=c.fields['Empresa']||'';document.getElementById('cot-cliente-id').value=id;document.getElementById('cot-cliente-dropdown').classList.remove('open');const venc=c.fields['Facturas vencidas']||0,info=document.getElementById('cot-cliente-info');const prevCots=state.cotizaciones.filter(x=>{const cl=x.fields['Cliente'];return Array.isArray(cl)?cl.includes(id):cl===id;}).sort((a,b)=>(b.fields['Fecha cotización']||b.createdTime||'').localeCompare(a.fields['Fecha cotización']||a.createdTime||''));const prevBtn=prevCots.length?` &nbsp;<button type="button" onclick="openCopyCotPicker('n')" style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.35);border-radius:5px;color:var(--accent4);font-size:10.5px;font-weight:700;padding:2px 8px;cursor:pointer;vertical-align:middle">📋 Cot. anterior (${prevCots.length})</button>`:'';let descTag='';try{const d=(typeof _descCliente==='function')?_descCliente(id):0;if(d>0){const disc=document.getElementById('cot-descuento');if(disc&&(!disc.value||parseFloat(disc.value)===0)){disc.value=d;if(typeof updateItemsTotal==='function')updateItemsTotal();}descTag=` &nbsp;<span style="color:var(--accent4);font-size:12px">🏷️ ${d}% dto. cliente</span>`;}}catch(e){}
  info.innerHTML=(venc>=2?`<span style="color:var(--danger)">⚠ ${venc} facturas vencidas</span>`:`<span style="color:var(--text2)">✓ Cliente seleccionado</span>`)+descTag+prevBtn;}
function selectClienteNew(){document.getElementById('cot-cliente-id').value='';document.getElementById('cot-cliente-dropdown').classList.remove('open');}
document.addEventListener('click',e=>{if(!e.target.closest('.search-select-wrap')) document.querySelectorAll('.search-select-dropdown').forEach(d=>d.classList.remove('open'));});
function clearForm(type){
  if(type==='lead'){['nl-empresa','nl-contacto','nl-cargo','nl-telefono','nl-email','nl-rut','nl-web','nl-notas','nl-ciudad','nl-direccion'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});
    try{_nlEmpSel=null;_nlEmpForce=false;nlEmpresaCerrar();const av=document.getElementById('nlEmpresaAviso');if(av)av.style.display='none';}catch(e){}document.getElementById('nl-origen').value='Referido';document.getElementById('nl-industria').value='';const nr=document.getElementById('nl-region');if(nr) nr.value='';const nc=document.getElementById('nl-comuna');if(nc){nc.innerHTML='<option value="">— Seleccionar región primero —</option>';nc.disabled=true;}}
  if(type==='cot'){['cot-num','cot-alias','cot-subtotal','cot-total','cot-solicitud','cot-solicitud-inp','cot-notas','cot-cliente-search','cot-cliente-id','cot-tiempo-prod','cot-tiempo-prod-max','cot-fecha-entrega','cot-fecha-limite','cot-descuento'].forEach(id=>{const el=document.getElementById(id);if(el) el.value=id==='cot-descuento'?'0':'';});const si=document.getElementById('solicitudItems');if(si) si.innerHTML='';const fp=document.getElementById('cot-forma-pago');if(fp) fp.value='';const cu=document.getElementById('cot-urgente');if(cu) cu.value='false';const ce=document.getElementById('cot-estado-inicial');if(ce)ce.value='Enviada';try{cotPlazoLoad('new',{});}catch(e){};document.getElementById('cot-cliente-info').textContent='';document.getElementById('cot-cliente-dropdown')?.classList.remove('open');initDates();initItemsContainer();const c3dp=document.getElementById('c3d-inline-panel');if(c3dp) c3dp.style.display='none';Object.values(_c3dBtns()).forEach(b=>{if(b)b.style.background='';});const c3dl=document.getElementById('c3d-i-piezas');if(c3dl) c3dl.innerHTML='';c3dPiezasActivas=[];c3dPiezaCounter=0;['lsr','neo'].forEach(k=>{const p=document.getElementById(k+'-inline-panel');if(p)p.style.display='none';Object.values(_qcalcBtns(k)).forEach(b=>{if(b)b.style.background='';});});}
  if(type==='proveedor'){['np-nombre','np-contacto','np-cargo','np-telefono','np-whatsapp','np-email','np-web','np-rut','np-comuna','np-region','np-plazo','np-productos','np-notas'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});setPvSelectedCats('np',[]);const rep=document.getElementById('np-rep');if(rep) rep.value='3';const est=document.getElementById('np-estado');if(est) est.value='Activo';const cp=document.getElementById('np-condpago');if(cp) cp.value='';}
}
