/* js/maquinas.js â€” mÃ³dulo extraÃ­do de index.html (carga en el mismo punto). */
// â”€â”€ MÃQUINAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Formatea por el calendario local, no por UTC. Con toISOString(), fmtDate(new
// Date()) devolvÃ­a el dÃ­a siguiente despuÃ©s de las 20:00 (Chile va UTC-4/-3), y
// eso es lo que marca "hoy" en las grillas de mÃ¡quinas y de equipo: pasadas las
// 8 de la tarde la columna resaltada era la de maÃ±ana.
function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function fmtDayLabel(d){return['Dom','Lun','Mar','MiÃ©','Jue','Vie','SÃ¡b'][d.getDay()]+' '+d.getDate();}
function getMaquinaSemanaLunes(){const t=new Date();t.setHours(0,0,0,0);const day=t.getDay();const l=new Date(t);l.setDate(t.getDate()-(day===0?6:day-1)+(maquinaState.semanaOffset*7));return l;}
function navSemana(d){maquinaState.semanaOffset+=d;renderMaquinasCalendar();}
function goToday(){maquinaState.semanaOffset=0;renderMaquinasCalendar();}
function getMaquinaEstadoGlobal(id){const m=MAQUINAS.find(x=>x.id===id);return m?.estado||localStorage.getItem('estado_maq_'+id)||'disponible';}
const MAQUINA_ESTADOS={
  disponible:{label:'Disponible',short:'âœ“ Disp.',color:'green',icon:'âœ“'},
  reservada:{label:'Reservada',short:'â—· Res.',color:'yellow',icon:'â—·'},
  calibrando:{label:'Calibrando',short:'ğŸ“ Cal.',color:'yellow',icon:'ğŸ“'},
  limpieza:{label:'En limpieza',short:'ğŸ§¹ Limp.',color:'yellow',icon:'ğŸ§¹'},
  mantencion:{label:'En mantenciÃ³n',short:'ğŸ”§ Mant.',color:'red',icon:'ğŸ”§'},
  esperando_repuesto:{label:'Esperando repuesto',short:'ğŸ“¦ Rep.',color:'red',icon:'ğŸ“¦'},
  fuera_servicio:{label:'Fuera de servicio',short:'â›” Fuera',color:'red',icon:'â›”'},
};
function maquinaEstadoMeta(estado){return MAQUINA_ESTADOS[estado]||MAQUINA_ESTADOS.disponible;}
async function toggleMaquinaEstado(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m) return;
  const nv=m.estado==='disponible'?'mantencion':'disponible';
  m.estado=nv;
  localStorage.setItem('estado_maq_'+id,nv);
  renderMaquinasCalendar();
  const meta=maquinaEstadoMeta(nv);
  toast(`${m.nombre} #${m.num}: ${meta.icon} ${meta.label}`,nv==='disponible'?'success':'error');
  try{await saveMaquinaEstadoAirtable(id,nv);}catch(e){console.warn('No se pudo guardar estado en Airtable',e);}
}
async function initMaquinas(){
  await loadMaquinasAirtable();
  await Promise.all([loadMaquinaEventosAirtable(), loadMaintLogAirtable()]);
  seedOdometerIfNeeded();
  renderMaquinasCalendar();
  renderMonitorFilterTabs();
  renderMonitorKPIs();
  renderMaintenanceTable();
  try{audit3DLoadDaily();}catch(_){}
  renderProductionAnalytics();
  try{renderCargaMaquinas();}catch(e){}
  requestNotificationPermission(false);
  if(!_monitorInterval){
    pollPrinters();
    _monitorInterval=setInterval(pollPrinters,_MONITOR_INTERVAL_MS);
    connectAllPrinterWs();   // estado en vivo por WebSocket (el polling queda de respaldo)
  }
  if(!_camSnapInterval) _camSnapInterval=setInterval(_refreshSnapshotCams,1000);
}

// â”€â”€ PRINTER LIVE MONITOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MOONRAKER_PORT=7125;
// Cadencia y tolerancia a fallos del monitor. El intervalo es mayor que el
// peor caso de un ciclo (timeouts mÃ¡s cortos + backoff) para que no se salten
// ciclos. El umbral de fallos evita marcar "Offline" por un hipo de red.
const _MONITOR_INTERVAL_MS=20000;   // sondeo base (el WebSocket lo hace casi irrelevante)
const _STATUS_TIMEOUT_MS=9000;      // tÃºnel/WiFi lento del taller necesita margen (la histÃ©resis evita falsos Offline)
const _THUMB_TIMEOUT_MS=2000;       // antes 3000
const _OFFLINE_AFTER_FAILS=3;       // fallos consecutivos antes de declarar Offline
function getPrinterTunnel(){const d=(!_DEFAULTS.PRINTER_TUNNEL||_DEFAULTS.PRINTER_TUNNEL.startsWith('%%'))?'https://printers.thelab.solutions':_DEFAULTS.PRINTER_TUNNEL;return(localStorage.getItem('printer_tunnel')||d).replace(/\/$/,'');}
function getPrinterTunnelToken(){
  const d=(_DEFAULTS.PRINTER_TUNNEL_TOKEN&&!_DEFAULTS.PRINTER_TUNNEL_TOKEN.startsWith('%%'))?_DEFAULTS.PRINTER_TUNNEL_TOKEN:'';
  let local=sessionStorage.getItem('printer_tunnel_token')||'';const legacy=localStorage.getItem('printer_tunnel_token')||'';
  if(!local&&legacy){local=legacy;sessionStorage.setItem('printer_tunnel_token',legacy);localStorage.removeItem('printer_tunnel_token');}
  const custom=(localStorage.getItem('printer_tunnel')||'').replace(/\/$/,'');
  const defaultTunnel=((!_DEFAULTS.PRINTER_TUNNEL||_DEFAULTS.PRINTER_TUNNEL.startsWith('%%'))?'https://printers.thelab.solutions':_DEFAULTS.PRINTER_TUNNEL).replace(/\/$/,'');
  // En el tÃºnel oficial, el token del deploy es la versiÃ³n vigente. AsÃ­ un
  // token antiguo guardado en un telÃ©fono no invalida silenciosamente la ficha.
  return !custom||custom===defaultTunnel?(d||local):(local||d);
}
// El token viaja en la URL, no en una cabecera: una cabecera propia obliga al
// navegador a un preflight OPTIONS, y en redes mÃ³viles ese preflight se cae â€”
// el fetch se rechaza y la mÃ¡quina parece muerta. Con ?bt= no hay preflight.
// Idempotente: printerMediaUrl lo aplica sobre URLs que ya lo traen.
function _appendBridgeToken(u){if(/[?&]bt=/.test(u))return u;const tk=getPrinterTunnelToken();return tk?u+(u.includes('?')?'&':'?')+'bt='+encodeURIComponent(tk):u;}
// DiagnÃ³stico del tÃºnel/bridge desde el propio dashboard (Mi cuenta â†’ TÃºnel Impresoras)
async function testPrinterBridge(statusId){
  const el=document.getElementById(statusId);
  const url=getPrinterTunnel(),tk=getPrinterTunnelToken();
  const set=(c,t)=>{if(el){el.style.color=c;el.textContent=t;}};
  set('var(--text3)',`Probando ${url} â€¦`);
  try{const r=await fetch(url+'/healthz',{signal:AbortSignal.timeout(7000)});if(!r.ok)throw 0;}
  catch(e){set('var(--danger)',`âœ— No se alcanza ${url}. Revisa que el bridge y el tÃºnel estÃ©n corriendo en el iMac.`);return;}
  if(!tk){set('var(--warn)','âš  TÃºnel OK, pero falta el token del bridge. PÃ©galo y pulsa Guardar.');return;}
  try{
    const r=await fetch(url+'/authcheck?bt='+encodeURIComponent(tk),{signal:AbortSignal.timeout(7000)});
    if(r.status===401){set('var(--danger)','âœ— Token incorrecto. Copia el token actual del bridge (lo imprime al arrancar / lo da install-launchd.sh).');return;}
    if(!r.ok)throw 0;
    set('var(--accent3)','âœ… Bridge OK y token vÃ¡lido. Pon MÃ¡quinas en ğŸŒ Remoto.');
  }catch(e){set('var(--warn)','âš  TÃºnel alcanzable pero no pude validar el token. Â¿El bridge estÃ¡ actualizado?');}
}
async function restartPrinterBridge(statusId){
  const el=document.getElementById(statusId);
  const url=getPrinterTunnel(),tk=getPrinterTunnelToken();
  const set=(c,t)=>{if(el){el.style.color=c;el.textContent=t;}};
  if(!tk){set('var(--warn)','Necesitas el token guardado para reiniciar el bridge.');return;}
  if(!confirm('Â¿Reiniciar el bridge del iMac? Se reconecta en unos segundos.'))return;
  set('var(--text3)','Reiniciando bridgeâ€¦');
  try{await fetch(url+'/restart?bt='+encodeURIComponent(tk),{method:'POST',signal:AbortSignal.timeout(7000)});}
  catch(e){/* la conexiÃ³n se corta al salir el proceso: es esperado */}
  set('var(--text3)','Bridge reiniciÃ¡ndoseâ€¦ reprobando en unos segundos.');
  setTimeout(()=>testPrinterBridge(statusId),4500);
}
function printerUrl(ip,path){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return`http://${ip}:${MOONRAKER_PORT}${path}`;
  return _appendBridgeToken(`${getPrinterTunnel()}/${ip}${path}`);
}
function printerMediaUrl(ip,path){return _appendBridgeToken(printerUrl(ip,path));}
// CÃ¡mara por defecto segÃºn el modelo, derivada de la IP viva de la mÃ¡quina (no
// una URL fija: las IP son DHCP y se mueven). Las K1/Ender publican MJPEG por
// mjpg_streamer en :8080; las K2/K2 Plus dan un snapshot JPEG por go2rtc en
// :1984. AsÃ­ toda mÃ¡quina intenta su cÃ¡mara sola: la que no transmite muestra
// "sin seÃ±al", y en cuanto arranca mjpg_streamer aparece sin configurar nada.
function _defaultCamUrl(m){
  const ip=(typeof getPrinterIp==='function')?getPrinterIp(m):(m&&m.ip);
  if(!ip)return'';
  return /K2/.test((m&&m.modelo)||'')
    ? `http://${ip}:1984/api/frame.jpeg?src=k2plus`
    : `http://${ip}:8080/?action=stream`;
}
// Fuente Ãºnica de la URL de cÃ¡mara: primero lo que el usuario fijÃ³ a mano
// (localStorage o Airtable vÃ­a m.cam), y si no, el default por modelo.
function _printerCamRaw(id){
  const ex=localStorage.getItem('printer_cam_'+id);
  if(ex)return ex;
  const m=(typeof MAQUINAS!=='undefined')?MAQUINAS.find(x=>x.id===id):null;
  if(m&&m.cam)return m.cam;
  return m?_defaultCamUrl(m):'';
}
// Webcam: en modo remoto reescribe http://IP_LAN:PUERTO/ruta â†’ tÃºnel /{ip}:{puerto}/ruta
function printerCamUrl(id){
  const raw=_printerCamRaw(id);if(!raw)return'';
  if(typeof _isLocalMode==='function'&&_isLocalMode())return raw;
  const mm=raw.match(/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?(\/.*)?$/);
  if(!mm)return raw;
  return _appendBridgeToken(`${getPrinterTunnel()}/${mm[1]}:${mm[2]||'80'}${mm[3]||'/'}`);
}
// CÃ¡maras tipo "snapshot" (p.ej. go2rtc /api/frame.jpeg de las K2, que no dan
// MJPEG): el <img> con data-snap se refresca solo cada ~1s para simular video.
function _camIsSnapshot(raw){return /\/api\/frame\.jpe?g/i.test(raw||'');}
function _safePrinterMediaUrl(raw){
  const s=String(raw||'').trim();
  if(!s)return'';
  try{
    const u=new URL(s,location.href);
    if(!['http:','https:','blob:'].includes(u.protocol))return'';
    return escapeHtml(u.href);
  }catch(e){return'';}
}
let _camSnapInterval=null;
function _refreshSnapshotCams(){
  if(document.hidden)return;
  document.querySelectorAll('img[data-snap]').forEach(im=>{
    if(im.offsetParent===null)return;            // saltar las ocultas (otra secciÃ³n / modal cerrado)
    const base=im.getAttribute('data-snap');if(!base)return;
    im.src=base+(base.includes('?')?'&':'?')+'_='+Date.now();
  });
}
const HIST_KEY='printer_history_v1';
// CachÃ© del historial: parsea localStorage una sola vez y reusa el resultado
// hasta que el string cambie (lo invalida automÃ¡ticamente cualquier escritura).
// Evita cientos de JSON.parse por minuto al renderizar 13+ mÃ¡quinas cada 15s.
let _histRaw=null,_histParsed=[];
function getHist(){const raw=localStorage.getItem(HIST_KEY)||'[]';if(raw!==_histRaw){try{_histParsed=JSON.parse(raw);}catch(e){_histParsed=[];}_histRaw=raw;}return _histParsed;}
// â”€â”€ OdÃ³metro acumulado por mÃ¡quina â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// El historial se recorta a 200 entradas, asÃ­ que en una granja activa las
// horas/filamento "totales" se subestimarÃ­an con el tiempo. El odÃ³metro acumula
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
// Tolerancia a fallos / backoff por mÃ¡quina, y conexiones WebSocket en vivo.
const _failCount={},_nextPollAt={};
const _wsConn={},_wsConnected={},_wsRaw={},_wsAttempts={},_wsTimers={};
let _wsRpcId=0,_wsRenderTimer=null;
// â”€â”€ Print queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _printQueue={};// { [printerId]: [{gcode,filename,secs,grams},...] }
function _queueGet(id){return _printQueue[id]||(_printQueue[id]=[]);}
function _queueCount(id){return(_printQueue[id]||[]).length;}
function _queueAdd(id,gcode,filename,secs,grams){
  _queueGet(id).push({gcode,filename,secs,grams,added:Date.now()});
  toast(`ğŸ“‹ Encolado en ${(MAQUINAS.find(m=>m.id===id)||{}).nombre||id} (#${_queueCount(id)} en cola)`,'success');
  renderMonitorGrid();
}
async function _queueStartNext(id){
  const q=_printQueue[id];if(!q||!q.length)return;
  const job=q[0];                                    // peek: no se saca hasta confirmar la subida
  const m=MAQUINAS.find(x=>x.id===id);const ip=getPrinterIp(m);
  if(!ip)return;                                     // sin IP: el trabajo queda en cola, se reintenta luego
  if(job._starting)return;                           // ya hay un intento en curso, no duplicar
  job._starting=true;
  // Antes se hacÃ­a q.shift() ANTES de subir: si la subida fallaba (la impresora
  // reciÃ©n terminÃ³ y estÃ¡ ocupada un instante) el trabajo encolado se PERDÃA, y
  // como el disparo es por-transiciÃ³n no se reintentaba. Ahora solo se saca de la
  // cola tras una subida exitosa; ante fallo se reintenta unas veces y, si no,
  // queda en la cola para lanzarlo a mano.
  const reintentar=(msg)=>{
    job._starting=false;job._tries=(job._tries||0)+1;
    if(job._tries<3){toast(msg+' â€” reintentandoâ€¦','info');setTimeout(()=>_queueStartNext(id),5000);}
    else toast(msg+' â€” el trabajo quedÃ³ en la cola; inÃ­cialo a mano','error');
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
        job._starting=false;
        if(_printQueue[id]&&_printQueue[id][0]===job){_printQueue[id].shift();renderMonitorGrid();}  // reciÃ©n ahora se consume
        try{await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(job.filename)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});}catch(_){}
        toast(`â–¶ Cola: iniciando ${job.filename} en ${m?.nombre||id}`,'success');
        if(typeof pollPrinters==='function')pollPrinters();
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

function getPrinterIp(m){return localStorage.getItem('printer_ip_'+m.id)||m.ip||null;}
function getPrinterApiKey(id){
  const key='printer_key_'+id;
  const session=sessionStorage.getItem(key);
  if(session)return session;
  // MigraciÃ³n de seguridad: las claves antiguas dejan de persistir entre sesiones.
  const legacy=localStorage.getItem(key)||'';
  if(legacy){sessionStorage.setItem(key,legacy);localStorage.removeItem(key);}
  return legacy;
}
// En remoto el token va en la URL (printerUrl lo agrega): mandarlo ademÃ¡s como
// cabecera solo aÃ±adirÃ­a el preflight que queremos evitar.
function getPrinterAuthHeaders(id){const headers={},k=getPrinterApiKey(id);if(k)headers['X-Api-Key']=k;return headers;}

function _printerInitialStatus(m){return{state:getPrinterIp(m)?'connecting':'noip',checkedAt:0,lastSeenAt:0};}
// Una impresora que no contesta en Moonraker puede estar apagada o estar
// perfectamente encendida e imprimiendo con solo la telemetrÃ­a caÃ­da. Son dos
// situaciones opuestas â€”una no necesita nada, la otra atenciÃ³n inmediataâ€” y
// antes se veÃ­an idÃ©nticas: el 2026-08-11 dos K1 imprimÃ­an TPU y aparecÃ­an como
// desenchufadas. Se distinguen sondeando la UI web de la impresora (Fluidd en
// 4408, nginx en 80): si esa contesta, la mÃ¡quina estÃ¡ viva y lo caÃ­do es la API.
const _ALIVE_PROBE_PORTS=[4408,80];
const _ALIVE_PROBE_TTL_MS=45000;
const _ALIVE_PROBE_TIMEOUT_MS=4000;
const _aliveProbe={};
function _printerPortUrl(ip,port,path){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return`http://${ip}:${port}${path}`;
  return _appendBridgeToken(`${getPrinterTunnel()}/${ip}:${port}${path}`);
}
// El bridge marca sus propios errores con X-Bridge-Error. El 424 queda como
// respaldo para un bridge viejo que todavÃ­a no manda la cabecera, o si algo en
// el camino la borra.
function _esErrorDelBridge(r){
  if(!r)return false;
  try{ if(r.headers&&typeof r.headers.get==='function'&&r.headers.get('X-Bridge-Error'))return true; }catch(_){}
  return r.status===424;
}

// Solo se llama cuando la consulta a Moonraker YA fallÃ³, y como mucho una vez
// cada 45s por mÃ¡quina: el camino normal no paga ninguna peticiÃ³n extra.
async function _probePrinterAlive(id,ip){
  const cached=_aliveProbe[id];
  if(cached&&cached.ip===ip&&Date.now()-cached.at<_ALIVE_PROBE_TTL_MS)return cached.port;
  let port=0;
  for(const p of _ALIVE_PROBE_PORTS){
    try{
      const r=await fetch(_printerPortUrl(ip,p,'/'),{method:'GET',cache:'no-store',signal:AbortSignal.timeout(_ALIVE_PROBE_TIMEOUT_MS)});
      // Cualquier respuesta de la propia impresora prueba que hay algo
      // escuchando, incluido un 404. Pero el bridge tambiÃ©n contesta por su
      // cuenta cuando NO logrÃ³ conectar, y eso no prueba nada: el 2026-08-19 el
      // dashboard daba por vivas cinco mÃ¡quinas apagadas porque el bridge habÃ­a
      // pasado de responder 502 a 424 (Cloudflare se come los 5xx) y 424 caÃ­a
      // dentro del rango que aquÃ­ se tomaba por buena seÃ±al.
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
  localStorage.setItem('printer_ip_'+id,val);
  const m=MAQUINAS.find(x=>x.id===id);
  if(m){m.ip=val;if(m._airtableId){if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:val}})});}}
  toast(`IP guardada Â· ${m?.nombre} #${m?.numG}`,'success');pollPrinters();
  if(m)connectPrinterWs(m);
}

function savePrinterApiKey(id){
  const inp=document.getElementById('ipkey_'+id);if(!inp)return;
  const val=inp.value.trim();
  const key='printer_key_'+id;
  localStorage.removeItem(key);
  if(val)sessionStorage.setItem(key,val);else sessionStorage.removeItem(key);
  const m=MAQUINAS.find(x=>x.id===id);
  toast(`API Key ${val?'guardada':'eliminada'} Â· ${m?.nombre} #${m?.numG}`,'success');
}

function openPrinterConnModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('printerConnTitle').textContent=`${m.nombre} #${m.numG}`;
  document.getElementById('printerConnId').value=id;
  document.getElementById('printerConnIp').value=getPrinterIp(m)||'';
  document.getElementById('printerConnKey').value=getPrinterApiKey(id);
  document.getElementById('printerConnLight').value=localStorage.getItem('printer_light_override_'+id)||'';
  document.getElementById('printerConnModal').style.display='flex';
}
function closePrinterConnModal(){document.getElementById('printerConnModal').style.display='none';}
function savePrinterConn(){
  const id=document.getElementById('printerConnId').value;
  const ip=(document.getElementById('printerConnIp').value||'').trim();
  const key=(document.getElementById('printerConnKey').value||'').trim();
  const light=(document.getElementById('printerConnLight').value||'').trim();
  const lightCfg=_printerLightParseOverride(light);
  if(lightCfg?.error){toast(lightCfg.error,'error');document.getElementById('printerConnLight').focus();return;}
  if(ip)localStorage.setItem('printer_ip_'+id,ip);else localStorage.removeItem('printer_ip_'+id);
  const keyName='printer_key_'+id;
  localStorage.removeItem(keyName);
  if(key)sessionStorage.setItem(keyName,key);else sessionStorage.removeItem(keyName);
  if(light)localStorage.setItem('printer_light_override_'+id,light);else localStorage.removeItem('printer_light_override_'+id);
  delete _printerLightCaps[id];
  const m=MAQUINAS.find(x=>x.id===id);
  if(m&&m._airtableId){m.ip=ip||m.ip;if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:ip||''}})});}
  closePrinterConnModal();
  toast(`ConexiÃ³n guardada Â· ${m?.nombre} #${m?.numG}`,'success');
  pollPrinters();
  if(m){_wsConnected[m.id]=false;connectPrinterWs(m);}
}

// Deriva el estado mostrable a partir de los objetos crudos de Moonraker
// (status = {print_stats, virtual_sdcard, heater_bed, extruder, webhooks, â€¦}).
// Es puro/sÃ­ncrono para reusarlo igual desde el polling REST y desde el WebSocket.
function _deriveStatus(m,s,ip){
  const ps=s.print_stats||{},vs=s.virtual_sdcard||{},hb=s.heater_bed||{},ex=s.extruder||{},wh=s.webhooks||{};
  // Estado real del firmware Klipper. Si estÃ¡ "shutdown"/"error" la impresora
  // dejÃ³ de imprimir y NO reporta sensores (todo 0) â†’ hay que reiniciar el firmware.
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
  // Klipper caÃ­do o iniciando manda sobre el estado del print.
  // Sin print_stats.state NO se asume "libre": la ausencia de telemetrÃ­a se
  // muestra como desconocida (si no, una lectura incompleta se ve verde/OK y
  // el planificador la toma como disponible).
  let state=ps.state||'unknown';
  if(klState==='shutdown'||klState==='error')state='shutdown';
  else if(klState==='startup')state='startup';
  const light=_printerLightApplyStatus(m.id,s);
  const seen=Date.now();
  return{state,klState,klMsg,progress,progressRaw,filename,filamentMm,hotend:{actual:Math.round(ex.temperature||0),target:Math.round(ex.target||0)},bed:{actual:Math.round(hb.temperature||0),target:Math.round(hb.target||0)},elapsed,eta,ip,filament:_extractFilamentTelemetry(s),updatedAt:seen,lastSeenAt:seen,checkedAt:seen,light:light?.available?{available:true,on:!!light.on}:null};
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
  const headers=getPrinterAuthHeaders(m.id);
  try{
    const objects=['print_stats','heater_bed','extruder','display_status','virtual_sdcard','webhooks'];
    if(m.modelo==='K2'||m.modelo==='K2 Plus')objects.push('filament_switch_sensor filament_sensor','temperature_sensor chamber_temp','filament_rack','box');
    const path='/printer/objects/query?'+objects.map(encodeURIComponent).join('&')+_printerLightQuerySuffix(m.id);
    const r=await fetch(printerUrl(ip,path),{signal:AbortSignal.timeout(_STATUS_TIMEOUT_MS),headers});
    if(!r.ok){
      const reason=r.status===401?'Token del bridge invÃ¡lido o vencido':(r.status===424||r.status===502)?'La impresora no responde al bridge':r.status===404?'Moonraker no estÃ¡ disponible en esta IP':`La consulta respondiÃ³ HTTP ${r.status}`;
      return _printerFetchFailure(m.id,ip,reason,r.status);
    }
    const d=await r.json();const s=d.result?.status||{};
    const st=_deriveStatus(m,s,ip);
    st.thumbUrl=await _ensureThumb(m,ip,st);
    return st;
  }catch(e){return _printerFetchFailure(m.id,ip,e?.name==='TimeoutError'||e?.name==='AbortError'?'Tiempo de espera agotado al consultar Moonraker':'No se pudo alcanzar Moonraker');}
}

// â”€â”€ Estado en vivo por WebSocket (Moonraker) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Moonraker empuja notify_status_update por /websocket (lo mismo que usan
// Fluidd/Mainsail). En remoto el bridge hace de proxy WS. Esto da estado en
// tiempo real SIN sondear; si el WS se cae, el polling toma el relevo solo.
// Desactivable con localStorage 'printer_ws_enabled'='0'.
function _wsEnabled(){if(window._DEMO_MODE)return false;const ov=localStorage.getItem('printer_ws_enabled');if(ov!==null)return ov!=='0';return (typeof _isLocalMode==='function')?_isLocalMode():true;/* por defecto WS solo en modo local; en remoto el WS del tÃºnel es inestable, se usa polling */}
function _printerWsUrl(ip){
  if(typeof _isLocalMode==='function'&&_isLocalMode())return `ws://${ip}:${MOONRAKER_PORT}/websocket`;
  const base=getPrinterTunnel().replace(/^http/,'ws');   // httpsâ†’wss, httpâ†’ws
  const tk=getPrinterTunnelToken();
  return `${base}/${ip}/websocket`+(tk?`?bt=${encodeURIComponent(tk)}`:'');
}
function _wsScheduleRender(){
  if(_wsRenderTimer)return;   // agrupa rÃ¡fagas de updates en un solo render
  _wsRenderTimer=setTimeout(()=>{
    _wsRenderTimer=null;
    if(document.hidden)return;
    if(!document.getElementById('tab-maquinas')?.classList.contains('active'))return;  // no renderizar una secciÃ³n inactiva
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
  const ip=getPrinterIp(m);if(!ip)return;
  if(typeof WebSocket==='undefinedm«ëŒ+Š×®º+º$zzb¥âr—&WGW&ã°¢–b…÷w46öæå¶Òæ–EÒ—·G'—µ÷w46öæå¶Òæ–EÒæöæ6Æ÷6SÖçVÆÃµ÷w46öæå¶Òæ–EÒæ6Æ÷6R‚“·Ö6F6‚†R—·Õ÷w46öæå¶Òæ–EÓÖçVÆÃ·Ğ¢ÆWBw3°¢G'—·w3ÖæWrvV%6ö6¶WB…÷&–çFW%w5W&Â†—’“·Ö6F6‚†R—·&WGW&ã·Ğ¢÷w46öæå¶Òæ–EÓ×w3°¢w2æöæ÷VãÒ‚“Óç·G'—·w2ç6VæB„¥4ôâç7G&–æv–g’‡¶§6öç'3¢s"ãrÆÖWF†öC¢w&–çFW"æö&¦V7G2ç7V'67&–&RrÇ&×3§¶ö&¦V7G3¥÷&–çFW$Æ–v‡Ew4ö&¦V7G2†Òæ–B—ÒÆ–C¢²µ÷w5'4–GÒ’“·Ö6F6‚†R—·×Ó°¢w2æöæÖW76vSÖWcÓç°¢ÆWB×6s·G'—¶×6sÔ¥4ôâç'6R†WbæFF“·Ö6F6‚†R—·&WGW&ã·Ğ¢ÆWB7FGW3ÖçVÆÃ°¢–b†×6rç&W7VÇBbf×6rç&W7VÇBç7FGW2—7FGW3Ö×6rç&W7VÇBç7FGW3²òò&W7VW7F7V'67&–&R÷VW'¢VÇ6R–b†×6ræÖWF†öCÓÓÒvæ÷F–g•÷7FGW5÷WFFRrbd'&’æ—4'&’†×6rç&×2’—7FGW3Ö×6rç&×5³Ó²òòW6‚Vâf—fğ¢–b‡7FGW2bgG—Vöb7FGW3ÓÓÒvö&¦V7Br•÷w4ÖW&vU7FGW2†ÒÆ—Ç7FGW2“°¢Ó°¢w2æöæW'&÷#Ò‚“Óç·G'—·w2æ6Æ÷6R‚“·Ö6F6‚†R—·×Ó°¢w2æöæ6Æ÷6SÒ‚“Óç¶–b…÷w46öæå¶Òæ–EÓÓÓ×w2•÷w46öæå¶Òæ–EÓÖçVÆÃµ÷w46öææV7FVE¶Òæ–EÓÖfÇ6Sµ÷66†VGVÆUw5&V6öææV7B†Ò“·Ó°§Ğ¦gVæ7F–öâ÷66†VGVÆUw5&V6öææV7B†Ò—°¢–b‚÷w4Væ&ÆVB‚’—&WGW&ã°¢6öç7BãÒ…÷w4GFV×G5¶Òæ–EÓÒ…÷w4GFV×G5¶Òæ–E×ÇÃ’³“°¢6öç7BFVÆ“ÔÖF‚æÖ–âƒ3Ã¤ÖF‚ç÷rƒ"ÄÖF‚æÖ–â†âÃR’’’´ÖF‚æfÆö÷"„ÖF‚ç&æFöÒ‚’£“°¢6ÆV%F–ÖV÷WB…÷w5F–ÖW'5¶Òæ–EÒ“°¢÷w5F–ÖW'5¶Òæ–EÓ×6WEF–ÖV÷WB‚‚“Óç¶–b‚Fö7VÖVçBæ†–FFVâbfvWE&–çFW$—†Ò’–6öææV7E&–çFW%w2†Ò“·ÒÆFVÆ’“°§Ğ¦gVæ7F–öâ6öææV7DÆÅ&–çFW%w2‚—¶–b‚÷w4Væ&ÆVB‚’—&WGW&ã´ÔT”ä2æf÷$V6‚†ÓÓç¶–b†vWE&–çFW$—†Ò’–6öææV7E&–çFW%w2†Ò“·Ò“·Ğ¦gVæ7F–öâF—66öææV7DÆÅ&–çFW%w2‚—°¢ÔT”ä2æf÷$V6‚†ÓÓç°¢6ÆV%F–ÖV÷WB…÷w5F–ÖW'5¶Òæ–EÒ“°¢6öç7Bw3Õ÷w46öæå¶Òæ–EÓ¶–b‡w2—·G'—·w2æöæ6Æ÷6SÖçVÆÃ·w2æ6Æ÷6R‚“·Ö6F6‚†R—·×Ğ¢÷w46öæå¶Òæ–EÓÖçVÆÃµ÷w46öææV7FVE¶Òæ–EÓÖfÇ6Sµ÷w5&u¶Òæ–EÓÖçVÆÃµ÷w4GFV×G5¶Òæ–EÓÓ°¢Ò“°§Ğ¦gVæ7F–öâ&V6öææV7DÆÅ&–çFW%w2‚—¶F—66öææV7DÆÅ&–çFW%w2‚“¶6öææV7DÆÅ&–çFW%w2‚“·Ğ ¦gVæ7F–öâf×E6V72‡2—¶–b‚7ÇÇ3ÃÓ—&WGW&â~(	Bs¶6öç7BƒÔÖF‚æfÆö÷"‡2ó3c’ÆÓÔÖF‚æfÆö÷"‚‡2S3c’óc“·&WGW&âƒãöG¶‡Ö‚G¶×ÖÖ¦G¶×ÖÖ·Ğ¦gVæ7F–öâf×E&–çFW%6VVâ‡G2—°¢6öç7BvSÔÖF‚æÖ‚ƒÄFFRææ÷r‚’ÔçVÖ&W"‡G7ÇÃ’“¶–b‚G2—&WGW&âu6–âÆV7GW&&Wf–s°¢–b†vSÃS—&WGW&ât7GVÆ—¦Fò†÷&s°¢6öç7BÖ–ãÔÖF‚æfÆö÷"†vRóc“¶–b†Ö–ãÃc—&WGW&æ9¦ÇF–ÖÆV7GW&†6RG´ÖF‚æÖ‚ƒÆÖ–â—ÒÖ–æ°¢6öç7BƒÔÖF‚æfÆö÷"†Ö–âóc“·&WGW&æ9¦ÇF–ÖÆV7GW&†6RG¶‡Ò†°§Ğ ¦gVæ7F–öâ&–çFW%7FFTÖWF‡7FFR—°¢&WGW&â‡°¢6öææV7F–æs§¶Æ&VÃ¢t6öæV7FæFş(
brÆ6öÆ÷#¢r33†&Fc‚rÆ&s¢w&v&ƒSbÃƒ’Ã#C‚Ãã"’wÒÀ¢&–çF–æs§¶Æ&VÃ¢t–×&–Ö–VæFòrÆ6öÆ÷#¢r3CFrÆ&s¢w&v&ƒÃ#"ÃsÃãR’wÒÀ¢W6VC§¶Æ&VÃ¢uW6FòrÆ6öÆ÷#¢r6ffrÆ&s¢w&v&ƒ#SRÃsÃÃãR’wÒÀ¢W'&÷#§¶Æ&VÃ¢tW'&÷"rÆ6öÆ÷#¢r6fcCCCBrÆ&s¢w&v&ƒ#SRÃc‚Ãc‚ÃãR’wÒÀ¢6ö×ÆWFS§¶Æ&VÃ¢t–×&W6œ;6âf–æÆ—¦FrÆ6öÆ÷#¢r6s†&frÆ&s¢w&v&ƒcrÃ3’Ã#SÃãR’wÒÀ¢6æ6VÆÆVC§¶Æ&VÃ¢t–×&W6œ;6â6æ6VÆFrÆ6öÆ÷#¢r6ffrÆ&s¢w&v&ƒ#SRÃsÃÃã"’wÒÀ¢7FæF'“§¶Æ&VÃ¢tVâÌ:ÖæV+rÆ–'&RrÆ6öÆ÷#¢wf"‚ÒÖ66VçC2’rÆ&s¢w&v&ƒÃ#"ÃsÃã‚’wÒÀ¢–FÆS§¶Æ&VÃ¢tVâÌ:ÖæV+rÆ–'&RrÆ6öÆ÷#¢wf"‚ÒÖ66VçC2’rÆ&s¢w&v&ƒÃ#"ÃsÃã‚’wÒÀ¢Væ¶æ÷vã§¶Æ&VÃ¢tW7FFòFR–×&W6œ;6âFW66öæö6–FòrÆ6öÆ÷#¢r6ffrÆ&s¢w&v&ƒ#SRÃsÃÃã"’wÒÀ¢6‡WFF÷vã§¶Æ&VÃ¢~)ªFWFVæ–FrÆ6öÆ÷#¢r6fcCCCBrÆ&s¢w&v&ƒ#SRÃc‚Ãc‚ÃãR’wÒÀ¢7F'GW§¶Æ&VÃ¢t–æ–6–æFş(
brÆ6öÆ÷#¢r6ffrÆ&s¢w&v&ƒ#SRÃsÃÃã"’wÒÀ¢öffÆ–æS§¶Æ&VÃ¢u6–â6öæW†œ;6ârÆ6öÆ÷#¢r3ƒƒ‚rÆ&s¢w&v&ƒ#Ã#Ã#Ãã"’wÒÀ¢–F÷vã§¶Æ&VÃ¢uFVÆVÖWG,:Ö6:ÖFrÆ6öÆ÷#¢r6ffrÆ&s¢w&v&ƒ#SRÃsÃÃã"’wÒÀ¢æö—§¶Æ&VÃ¢u6–â•rÆ6öÆ÷#¢r6fcf#3RrÆ&s¢w&v&ƒ#SRÃrÃS2Ãã"’wÒÀ¢Õ·7FFUÒ—ÇÇ¶Æ&VÃ§7FFRÆ6öÆ÷#¢wf"‚Ò×FW‡C2’rÆ&s¢wf"‚Ò×7W&f6S"’wÓ°§Ğ ¦gVæ7F–öâ&VæFW%7&¶Æ–æR‡&VF–æw2Æ¶W’Æ6öÆ÷"—°¢–b‚&VF–æw7ÇÇ&VF–æw2æÆVæwFƒÃ"—&WGW&ârs°¢6öç7BfÇ3×&VF–æw2æÖ‡#Óç%¶¶W•×ÇÃ“°¢6öç7BÖƒÔÖF‚æÖ‚‚ââçfÇ2ÃS’ÆÖ–ãÔÖF‚æÖ‚ƒÄÖF‚æÖ–â‚ââçfÇ2’Ó’Ç&ævSÖÖ‚ÖÖ–çÇÃ°¢6öç7BsÓÄƒÓ##°¢6öç7BG3×fÇ2æÖ‚‡bÆ’“ÓæG²†’ò‡fÇ2æÆVæwF‚Ó’’¥wÒÂG´‚Ò‚‡bÖÖ–â’÷&ævR’¤‡Ö’æ¦ö–â‚rr“°¢&WGW&æÇ7frv–GFƒÒ"GµwÒ"†V–v‡CÒ"G´‡Ò"7G–ÆSÒ&÷fW&fÆ÷s§f—6–&ÆS¶F—7Æ“¦&Æö6²#ãÇöÇ–Æ–æRö–çG3Ò"G·G7Ò"f–ÆÃÒ&æöæR"7G&ö¶SÒ"G¶6öÆ÷'Ò"7G&ö¶R×v–GFƒÒ#ãR"7G&ö¶RÖÆ–æV6Ò'&÷VæB"7G&ö¶RÖÆ–æV¦ö–ãÒ'&÷VæB"÷6—G“Ò#ãƒR"óãÂ÷7fsæ°§Ğ ¦gVæ7F–öâ&VæFW$Ööæ—F÷$f–ÇFW%F'2‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖöæ—F÷$f–ÇFW%F'2r“¶–b‚VÂ—&WGW&ã°¢VÂæ–ææW$…DÔÃÔÔôä•Dõ%ôu%Uõ2æÖ†sÓç°¢6öç7B7F—fSÕöÖöæ—F÷$f–ÇFW#ÓÓÖræ¶W“°¢6öç7B6÷VçCÖræ¶W“ÓÓÒvÆÂsôÔT”ä2æÆVæwFƒ¤ÔT”ä2æf–ÇFW"†ÓÓæÒæÖöFVÆóÓÓÖræ¶W’’æÆVæwFƒ°¢&WGW&æÆ'WGFöâöæ6Æ–6³Ò&f–ÇFW$Ööæ—F÷"‚rG¶ræ¶W—Òr’"7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£Wƒ·FF–æs£W‚'ƒ¶&÷&FW"×&F—W3£#ƒ¶&÷&FW#£‚6öÆ–BG¶7F—fSöræ6öÆ÷#¢wf"‚ÒÖ&÷&FW#"’wÓ¶&6¶w&÷VæC¢G¶7F—fSöræ6öÆ÷"²s#"s¢wf"‚Ò×7W&f6S"’wÓ¶6öÆ÷#¢G¶7F—fSöræ6öÆ÷#¢wf"‚Ò×FW‡C2’wÓ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C¢G¶7F—fSós£SÓ¶7W'6÷#§ö–çFW#·G&ç6—F–öã¦ÆÂãW2#âG¶ræÆ&VÇÓÇ7â7G–ÆSÒ&&6¶w&÷VæC¢G¶7F—fSöræ6öÆ÷"²s32s¢wf"‚Ò×7W&f6S2’wÓ¶&÷&FW"×&F—W3£ƒ·FF–æs£‚gƒ¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s#âG¶6÷VçGÓÂ÷7ããÂö'WGFöãæ°¢Ò’æ¦ö–â‚rr“°§Ğ ¦gVæ7F–öâf–ÇFW$Ööæ—F÷"†w'Wò—µöÖöæ—F÷$f–ÇFW#Öw'Wó·&VæFW$Ööæ—F÷$f–ÇFW%F'2‚“·&VæFW$Ööæ—F÷$µ—2‚“·&VæFW$Ööæ—F÷$w&–B‚“·Ğ ¦gVæ7F–öâ&VæFW$Ööæ—F÷$µ—2‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖöæ—F÷$µ—2r“¶–b‚VÂ—&WGW&ã°¢6öç7BÆ—7FÕöÖöæ—F÷$f–ÇFW#ÓÓÒvÆÂsôÔT”ä3¤ÔT”ä2æf–ÇFW"†ÓÓæÒæÖöFVÆóÓÓÕöÖöæ—F÷$f–ÇFW"“°¢ÆWB&–çF–æsÓÇW6VCÓÆ–FÆSÓÆW'&÷#ÓÆF÷vãÓÆöffÆ–æSÓÆæö—ÓÆ6öææV7F–æsÓÆ–F÷vãÓ°¢Æ—7Fæf÷$V6‚†ÓÓç¶6öç7B7CÒ…÷&–çFW%7FGW5¶Òæ–E×ÇÅ÷&–çFW$–æ—F–Å7FGW2†Ò’’ç7FFS¶–b‡7CÓÓÒw&–çF–ærr—&–çF–ær²³¶VÇ6R–b‡7CÓÓÒwW6VBr—W6VB²³¶VÇ6R–b‡7CÓÓÒvW'&÷"r–W'&÷"²³¶VÇ6R–b‡7CÓÓÒw6‡WFF÷vâr–F÷vâ²³¶VÇ6R–b‡7CÓÓÒvæö—r–æö—²³¶VÇ6R–b‡7CÓÓÒv–F÷vâr––F÷vâ²³¶VÇ6R–b‡7CÓÓÒvöffÆ–æRr–öffÆ–æR²³¶VÇ6R–b‡7CÓÓÒv6öææV7F–ærr–6öææV7F–ær²³¶VÇ6R–FÆR²³·Ò“°¢6öç7BF÷FÃÖÆ—7FæÆVæwF‚ÇWF–Å7C×F÷FÃãôÖF‚ç&÷VæB‚‡&–çF–ær·W6VB’÷F÷FÂ£“£°¢VÂæ–ææW$…DÔÃÖÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£Gƒ¶Æ–vâÖ—FV×3¦6VçFW#¶fÆW‚×w&§w&·FF–æs£‚gƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£ƒ¶föçB×6—¦S£'‚#à¢G·&–çF–æsãöÇ7â7G–ÆSÒ&6öÆ÷#¢3CF¶föçB×vV–v‡C£s#ï	ùú"G·&–çF–æwÒ–×&–Ö–VæFóÂ÷7ãæ¢rwĞ¢G·W6VCãöÇ7â7G–ÆSÒ&6öÆ÷#¢6ff¶föçB×vV–v‡C£s#î(û‚G·W6VGÒW6FóÂ÷7ãæ¢rwĞ¢G¶–FÆSãöÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’#î)ª¢G¶–FÆWÒVâÌ:ÖæV+rÆ–'&W3Â÷7ãæ¢rwĞ¢G¶6öææV7F–æsãöÇ7â7G–ÆSÒ&6öÆ÷#¢33†&Fc‚#î)xÂG¶6öææV7F–æwÒ6öæV7FæFóÂ÷7ãæ¢rwĞ¢G¶W'&÷#ãöÇ7â7G–ÆSÒ&6öÆ÷#¢6fcCCCC¶föçB×vV–v‡C£s#ï	ùKBG¶W'&÷'ÒW'&÷#Â÷7ãæ¢rwĞ¢G¶F÷vããöÇ7â7G–ÆSÒ&6öÆ÷#¢6fcCCCC¶föçB×vV–v‡C£s#î)ªG¶F÷vçÒFWFVæ–FG¶F÷vããòw2s¢rwÒ„¶Æ—W"“Â÷7ãæ¢rwĞ¢G¶–F÷vããöÇ7â7G–ÆSÒ&6öÆ÷#¢6ff¶föçB×vV–v‡C£s#ï	ù:G¶–F÷vçÒFVÆVÖWG,:Ö6:ÖFÂ÷7ãæ¢rwĞ¢G¶öffÆ–æSãöÇ7â7G–ÆSÒ&6öÆ÷#¢3ƒƒ‚#î)ª²G¶öffÆ–æWÒ6–â6öæW†œ;6ãÂ÷7ãæ¢rwĞ¢G¶æö—ãöÇ7â7G–ÆSÒ&6öÆ÷#¢6fcf#3R#î)Ù2G¶æö—Ò6–â•Â÷7ãæ¢rwĞ¢Ç7â7G–ÆSÒ&Ö&v–âÖÆVgC¦WFó¶föçB×vV–v‡C£s¶6öÆ÷#¢G·WF–Å7Cãòr3CFs¢wf"‚Ò×FW‡C2’wÒ#åWF–Æ—¦6œ;6âG·WF–Å7GÒSÂ÷7ãà¢ÂöF—cæ°¢G'—·&VæFW$Öö7W6–öâ‚“·Ö6F6‚†R—·Ğ§Ğ ¢òò)H)Hô5U4œ94âDRÜ8T”ä2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòÌ:ÖæVFRF–V×ò÷"–×&W6÷&6öâÆFVÆVÖWG,:Öf—fFVÂ'&–FvS¢\:’–×&–ÖP¢òò6FVæ’\:’†÷&VVFÆ–'&R„UD&VÂ’â&&öÖWFW"fV6†2FRVçG&Vv¢òò6öâFF÷2Âæò6öâ–çGV–6œ;6ââ6R&Vg&W66§VçFò6öâÆ÷2µ—2FVÂÖöæ—F÷"à¦gVæ7F–öâ&VæFW$Öö7W6–öâ‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖö7W6–öâr“¶–b‚VÂ—&WGW&ã°¢6öç7BÆ—7FÕöÖöæ—F÷$f–ÇFW#ÓÓÒvÆÂsôÔT”ä3¤ÔT”ä2æf–ÇFW"†ÓÓæÒæÖöFVÆóÓÓÕöÖöæ—F÷$f–ÇFW"“°¢–b‚Æ—7FæÆVæwF‚—¶VÂç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ğ¢6öç7B6Æ6–c×7CÓç7CÓÓÒw&–çF–ærsòw&–çBs§7CÓÓÒwW6VBsòwW6VBs¢‡7CÓÓÒvW'&÷"wÇÇ7CÓÓÒw6‡WFF÷vâwÇÇ7CÓÓÒv–F÷vâr“òvW'&÷"s¢‡7CÓÓÒvöffÆ–æRwÇÇ7CÓÓÒvæö—r“òvöfbs§7CÓÓÒv6öææV7F–ærsòv6öææV7F–ærs¢v–FÆRs°¢6öç7B&÷w3ÖÆ—7FæÖ†ÓÓç¶6öç7B3Õ÷&–çFW%7FGW5¶Òæ–E×ÇÅ÷&–çFW$–æ—F–Å7FGW2†Ò“·&WGW&ç¶ÒÇ2Æ³¦6Æ6–b‡2ç7FFR’ÆWF¢‡2ç7FFSÓÓÒw&–çF–ærrbg2æWFã“÷2æWF£Ó·Ò“°¢6öç7BWF3×&÷w2æf–ÇFW"‡#Óç"æWFã’æÖ‡#Óç"æWF“°¢6öç7B†÷&—¦öãÔÖF‚æÖ‚ƒB£3cÄÖF‚æÖ–âƒ"£3cÆWF2æÆVæwFƒôÖF‚æÖ‚‚ââæWF2’£ãS£B£3c’“°¢6öç7BÆ–'&W3×&÷w2æf–ÇFW"‡#Óç"æ³ÓÓÒv–FÆRr’æÆVæwFƒ°¢6öç7B–×&–Ö–VæFó×&÷w2æf–ÇFW"‡#Óç"æ³ÓÓÒw&–çBr’æÆVæwFƒ°¢6öç7B††ÖÓ×6VsÓææWrFFR„FFRææ÷r‚’·6Vr£’çFôÆö6ÆUF–ÖU7G&–ær‚vW2Ô4ÂrÇ¶†÷W#¢s"ÖF–v—BrÆÖ–çWFS¢s"ÖF–v—BwÒ“°¢6öç7B&÷†–ÖÖWF2æÆVæwFƒö††ÖÒ„ÖF‚æÖ–â‚ââæWF2’“¦çVÆÃ°¢òòV¦S¢Ö&62FR†÷&6ö'&RVÂ†÷&—¦öçFP¢6öç7BÖ&·3ÕµÓ¶6öç7B7FWƒÖ†÷&—¦öããb£3có#£°¢f÷"†ÆWB†ƒ×7FWƒ¶†‚£3cÆ†÷&—¦öã¶†‚³×7FW‚’Ö&·2çW6‚†Ç7â7G–ÆSÒ'÷6—F–öã¦'6öÇWFS¶ÆVgC¢G²††‚£3cö†÷&—¦öâ£’çFôf—†VBƒ—ÒS·G&ç6f÷&Ó§G&ç6ÆFU‚‚ÓSR“¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#â²G¶†‡ÖƒÂ÷7ãæ“°¢òòÆ6öÇVÖæFVÂæöÖ'&R6RVæ6övRVâçFÆÆ26†–63¢f–¦VâS‡‚F&¢òòÆ&'&VâVÂFVÌ:–föæòâVÂV¦RFR†÷&2FR&¦òW6VÂÖ—6Öòæ6†ò²#7€¢òò†VÂVçFòFRW7FFò’Æ÷2F÷2v2’&æòFW6Æ–æV'6Rà¢6öç7BæÖUsÒv6Æ×ƒƒG‚Ã#ggrÃS‡‚’s°¢6öç7Bf–Æ×#Óç°¢6öç7BæöÓÖG¶W66T‡FÖÂ‡"æÒææöÖ'&WÇÂ~(	Br—ÒÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#â2G·"æÒæçVÔwÇÇ"æÒæçV×ÇÂrwÓÂ÷7ãæ°¢ÆWB&#ÒrrÆÆ&ÃÒrs°¢–b‡"æ³ÓÓÒw&–çBrbg"æWFã—°¢6öç7BsÔÖF‚æÖ–âƒÇ"æWFö†÷&—¦öâ£’çFôf—†VBƒ“°¢6öç7B7CÒ‡G—Vöb"ç2ç&öw&W73ÓÓÒvçVÖ&W"rbg"ç2ç&öw&W73ãÓ“ôÖF‚ç&÷VæB‡"ç2ç&öw&W73ÃÓ÷"ç2ç&öw&W72£§"ç2ç&öw&W72“¦çVÆÃ°¢òòÆWF—VWF–æòf—fRDTåE$òFRÆ&'&¢7VæFòÆ&'&W&æv÷7FÀ¢òòVÂFW‡Fò†Ü:2æ6†òVRVÆÆ’6RFW6&÷&F&Æ—§V–W&F’6RVæ6–Ö&¢òò6ö'&RVÂæöÖ'&Râ†÷&W2Væ7F–ÆÆf–¦Â&÷&FRFW&V6†òFRÆ—7FÀ¢òò6öâföæFò&÷–ò&ÆVW'6R–wVÂ6ö'&RÆ&'&ò6ö'&RVÂföæFòf<:Öòà¢6öç7BG‡CÖG·7BÖçVÆÃ÷7B²rR+rs¢rwÖÆ–'&RG¶††ÖÒ‡"æWF—Ö°¢&#ÖÆF—bF—FÆSÒ"G¶W66T‡FÖÂ‡"ç2æf–ÆVæÖWÇÂt–×&–Ö–VæFòr—ÒG·7BÖçVÆÃòr+rr·7B²rRs¢rwÒ"7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G·wÒS¶&6¶w&÷VæC¦Æ–æV"Öw&F–VçBƒ“FVrÂ3CFÂ3CF62“¶&÷&FW"×&F—W3£Wƒ¶Ö–â×v–GFƒ£g‚#ãÂöF—cæ ¢¶Ç7â7G–ÆSÒ'÷6—F–öã¦'6öÇWFS·&–v‡C£Wƒ·F÷£SS·G&ç6f÷&Ó§G&ç6ÆFU’‚ÓSR“¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3CF63·v†—FR×76S¦æ÷w&¶&6¶w&÷VæC§&v&ƒBÃ‚Ã#bÃãƒ"“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"Ã#BÃã3R“¶&÷&FW"×&F—W3£Gƒ·FF–æs£Gƒ·ö–çFW"ÖWfVçG3¦æöæR#âG·G‡GÓÂ÷7ãæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢3CF#ï	ùú#Â÷7ãæ°¢ÖVÇ6R–b‡"æ³ÓÓÒw&–çBr—°¢&#ÖÆF—bF—FÆSÒ$–×&–Ö–VæFò(	B6–âUDFVÂ'&–FvR"7G–ÆSÒ&†V–v‡C£S·v–GFƒ£S¶&6¶w&÷VæC§&WVF–ærÖÆ–æV"Öw&F–VçBƒCVFVrÇ&v&ƒÃ#"ÃsÃãR’Ç&v&ƒÃ#"ÃsÃãR’‡‚Ç&v&ƒÃ#"ÃsÃã#R’‡‚Ç&v&ƒÃ#"ÃsÃã#R’g‚“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3C##æVâ7W'6ò+r6–âUDÂ÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢3CF#ï	ùú#Â÷7ãæ°¢ÖVÇ6R–b‡"æ³ÓÓÒwW6VBr—°¢&#ÖÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ£CRS¶&6¶w&÷VæC§&v&ƒ#SRÃsÃÃãb“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3#b#î(û‚VâW6Â÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢6ff#î(ûƒÂ÷7ãæ°¢ÖVÇ6R–b‡"æ³ÓÓÒvW'&÷"r—°¢&#ÖÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ£S¶&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚ÃãB“¶&÷&FW#£‚F6†VB&v&ƒ#SRÃc‚Ãc‚ÃãR“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚ÒÖFævW"’#î)ª6öâfÆÆ(	B&Wf—6#Â÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#ï	ùKCÂ÷7ãæ°¢ÖVÇ6R–b‡"æ³ÓÓÒv6öææV7F–ærr—°¢&#ÖÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ£S¶&6¶w&÷VæC§&v&ƒSbÃƒ’Ã#C‚Âã‚“¶&÷&FW#£‚F6†VB&v&ƒSbÃƒ’Ã#C‚Âã3R“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢33†&Fc‚#æ6öç7VÇFæFòFVÆVÖWG,:Ö(
cÂ÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢33†&Fc‚#î)xÃÂ÷7ãæ°¢ÖVÇ6R–b‡"æ³ÓÓÒvöfbr—°¢&#ÖÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ£S¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡ƒ¶÷6—G“¢ãSR#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#ç6–â6öæW†œ;6ãÂ÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#î)ª³Â÷7ãæ°¢ÖVÇ6W°¢&#ÖÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ£S¶&6¶w&÷VæC§&v&ƒÃ#"ÃsÃã‚“¶&÷&FW#£‚F6†VB&v&ƒÃ#"ÃsÃã3R“¶&÷&FW"×&F—W3£Wƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ærÖÆVgC£‡‚#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3CF#î)É2Æ–'&R†÷&Â÷7ããÂöF—cæ°¢Æ&ÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢3CF#î)ª£Â÷7ãæ°¢Ğ¢&WGW&æÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£—ƒ¶Ö&v–âÖ&÷GFöÓ£g‚#à¢Ç7â7G–ÆSÒ&fÆW‚×6‡&–æ³£·v–GFƒ£Gƒ·FW‡BÖÆ–vã¦6VçFW#¶föçB×6—¦S£'‚#âG¶Æ&ÇÓÂ÷7ãà¢Ç7â7G–ÆSÒ&fÆW‚×6‡&–æ³£·v–GFƒ¢G¶æÖUwÓ¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚Ò×FW‡C"“¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3·v†—FR×76S¦æ÷w&#âG¶æö×ÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£¶†V–v‡C£#ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£gƒ·FF–æs£'ƒ·÷6—F–öã§&VÆF—fS¶÷fW&fÆ÷s¦†–FFVâ#âG¶&'ÓÂöF—cà¢ÂöF—cæ°¢Ó°¢òòFVçG&òFR6FF—ó¢&–ÖW&òÆ2Æ–'&W2ÂÇVVvòÆ2VR–×&–ÖVâ÷"†÷&FP¢òòÆ–&W&6œ;6âÂ’Âf–æÂÆ2FW66öæV7FF2à¢6öç7B6×Ò†Æ"“Óâ†æWFÇÂ†æ³ÓÓÒv–FÆRsòÓ£S’’’Ò†"æWFÇÂ†"æ³ÓÓÒv–FÆRsòÓ£S’’“°¢òòw'WF2÷"ÖöFVÆòÂVâVâ÷&FVâf–¦òFVÂ'VS²VâÖöFVÆòFW66öæö6–Fğ¢òò6RÂf–æÂ÷"æöÖ'&Rà¢6öç7BÔôDõ$DU#Õ²t³rÂt³"rÂt³"ÇW2rÂtVæFW"ÓRÖ‚rÂtv–vuÓ°¢6öç7Bw&÷W3×·Ó°¢&÷w2æf÷$V6‚‡#Óç¶6öç7Bs×"æÒæÖöFVÆ÷ÇÂt÷G&2s²†w&÷W5¶u×ÇÂ†w&÷W5¶uÓÕµÒ’’çW6‚‡"“·Ò“°¢6öç7Bv¶W—3Ôö&¦V7Bæ¶W—2†w&÷W2’ç6÷'B‚†Æ"“Óç°¢6öç7B–ÔÔôDõ$DU"æ–æFW„öb†’Æ–#ÔÔôDõ$DU"æ–æFW„öb†"“°¢&WGW&â†–Ãó““¦–’Ò†–#Ãó““¦–"—ÇÆæÆö6ÆT6ö×&R†"“°¢Ò“°¢6öç7B×VÇF”w'WóÖv¶W—2æÆVæwFƒã°¢6öç7B7VW'óÖv¶W—2æÖ†sÓç°¢6öç7B—FV×3Öw&÷W5¶uÒç6Æ–6R‚’ç6÷'B†6×’æÖ†f–Æ’æ¦ö–â‚rr“°¢–b‚×VÇF”w'Wò—&WGW&â—FV×3²òò–f–ÇG&FòVâ6öÆòF—ó¢6–âVæ6&W¦Fğ¢6öç7B6öÃÖw&÷W5¶uÕ³ÒæÒæ6öÆ÷'ÇÂwf"‚Ò×FW‡C2’s°¢&WGW&æÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£gƒ¶Ö&v–ã£‚W‚#à¢Ç7â7G–ÆSÒ'v–GFƒ£wƒ¶†V–v‡C£wƒ¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢G¶6öÇÓ¶fÆW‚×6‡&–æ³£#ãÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚Ò×FW‡C"“¶ÆWGFW"×76–æs¢ã&VÒ#âG¶W66T‡FÖÂ†r—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶w&÷W5¶uÒæÆVæwF‡ÓÂ÷7ãà¢ÂöF—cæ¶—FV×3°¢Ò’æ¦ö–â‚rr“°¢VÂç7G–ÆRæF—7Æ“Òrs°¢VÂæ–ææW$…DÔÃÖÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£ƒ¶fÆW‚×w&§w&#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚Ò×FW‡B’#î(ûûˆòö7W6œ;6âFRÜ:V–æ3Â÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶Æ–'&W7ÒÆ–'&RG¶Æ–'&W2ÓÓòw2s¢rwÒ†÷&+rG¶–×&–Ö–VæF÷Ò–×&–Ö–VæFòG·&÷†–Öòr+r,;7†–ÖÜ:V–æÆ–'&Râr·&÷†–Ö¢rwÓÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ'÷6—F–öã§&VÆF—fS¶†V–v‡C£'ƒ¶Ö&v–ã£G‚6Æ2‚G¶æÖUwÒ²#7‚’#âG¶Ö&·2æ¦ö–â‚rr—ÓÂöF—cà¢G¶7VW'÷Ö°§Ğ ¦gVæ7F–öâ&VæFW$Ööæ—F÷$w&–B‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöäw&–Br“¶–b‚VÂ—&WGW&ã°¢6öç7B&6SÕöÖöæ—F÷$f–ÇFW#ÓÓÒvÆÂsôÔT”ä3¤ÔT”ä2æf–ÇFW"†ÓÓæÒæÖöFVÆóÓÓÕöÖöæ—F÷$f–ÇFW"“°¢6öç7BÆ—7F×6÷'FVDÆ—7B†&6R“°¢6öç7Bõö6&G3ÖÆ—7FæÖ†ÓÓç°¢6öç7B3Õ÷&–çFW%7FGW5¶Òæ–E×ÇÅ÷&–çFW$–æ—F–Å7FGW2†Ò“°¢6öç7B6Ó×&–çFW%7FFTÖWF‡2ç7FFR“°¢6öç7B—ÖvWE&–çFW$—†Ò“°¢6öç7B÷&t6ÓÕ÷&–çFW$6Õ&r†Òæ–B“°¢6öç7Bö6ÕSÕ÷&t6Ó÷&–çFW$6ÕW&Â†Òæ–B“¢rs°¢6öç7Bö6Õ6æÕö6Ô—56æ6†÷B…÷&t6Ò“°¢6öç7B–ÖsÔÔôDTÄõô”Ôu5¶ÒæÖöFVÆõ×ÇÂrs°¢6öç7B—5&–çF–æs×2ç7FFSÓÓÒw&–çF–ærs°¢6öç7B—5W6VC×2ç7FFSÓÓÒwW6VBs°¢6öç7B—47F—fSÖ—5&–çF–æwÇÆ—5W6VC°¢6öç7Bv3ÔÔôä•Dõ%ôu%Uõ2æf–æB†sÓæræ¶W“ÓÓÖÒæÖöFVÆò“°¢6öç7B†—7CÖvWD†—7F÷'”f÷%&–çFW"†Òæ–B“°¢6öç7BFƒÕ÷FV×†—7F÷'•¶Òæ–E×ÇÅµÓ°¢6öç7BÖ–çDÆW'G3ÖvWDÖ–çDÆW'G2†Ò“°¢6öç7B–FÆT†÷W'3ÖvWD–FÆT†÷W'2†Òæ–BÇ2ç7FFR“°¢6öç7B–FÆUv&ãÖ–FÆT†÷W'3ã°¢òòÆ<:Ö&6RÖöçFVâVâæöFò'FR’W'6—7FVçFR†æò6R&V7&VVâ6F¢òò6–6Æò’&VRVÂ7G&VÒæò'FVRâ6Ô¶W’6Ö&–6öÆò6’6Ö&–ÆU$Âà¢6öç7B6†÷t6ÓÒ‡2ç7FFSÓÓÒvæö—wÇÇ2ç7FFSÓÓÒvöffÆ–æRwÇÇ2ç7FFSÓÓÒw6‡WFF÷vâr“°¢6öç7B6Ô¶W“Ò…÷&t6Òbg6†÷t6Ò“ò…ö6ÕR²wÂr²…ö6Õ6æòw2s¢vÒr’“¢rs°¢òò‡VVÆÆW7G'V7GW&Ã¢4ôÄòÆòVR6Ö&–\:’&Ö26RF–'V¦ââW†6ÇW–P¢òò&öw&W6òöWF÷FV×W&GW&2‡6R&6†VâVâf—fò’(i"ÆF&¦WFæò6P¢òò&V6öç7G'W–R6FW2Ö–VçG&2–×&–ÖRÂWf—FæFòVÂ'FVòà¢6öç7B7G'V7DeÕ·2ç7FFRÇ2ç7FÆSó£Ç2æf–ÆVæÖWÇÂrrÇ2çF‡VÖ%W&Ãó£Æ—47F—fSó£Æ—5&–çF–æsó£Æ—5W6VCó£Ç2æ†÷FVæCòçF&vWGÇÃÇ2æ&VCòçF&vWGÇÃÆÖ–çDÆW'G2æÆVæwF‚Æ–FÆUv&ãó£Æ–FÆT†÷W'2Æ—ÇÂrrÆvWE&–çFW$”¶W’†Òæ–B“ó£Å÷VWVT6÷VçB†Òæ–B’Æ†—7BæÆVæwF‚Â…÷&t6Óó£’Â‡F‚æÆVæwFƒãÓ#ó£’Å÷&–çFW$Æ–v‡Df–ævW'&–çB†Òæ–B•Òæ¦ö–â‚wâr“° ¢ÆWB&öG“Òrs°¢–b‡2ç7FFSÓÓÒv6öææV7F–ærr—°¢&öG“ÖÆF—b6Æ73Ò'&–çFW"Ö6öææV7F–ær"7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#¢33†&Fcƒ¶föçB×6—¦S£'ƒ·FF–æs£g‚‡‚#ãÇ7â6Æ73Ò'&–çFW"Ö6öææV7F–ærÖF÷B#î)xÃÂ÷7ããÆ'#ãÆ#ä6öç7VÇFæFòFVÆVÖWG,:Ö(
cÂö#ãÆ'#ãÇ7â7G–ÆSÒ&föçBÖfÖ–Ç“¦Ööæ÷76S¶föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶—ÓÂ÷7ããÂöF—cæ°¢ÒVÇ6R–b‡2ç7FFSÓÓÒvæö—r—°¢&öG“ÖÆF—b7G–ÆSÒ&Ö&v–â×F÷£‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£gƒ¶föçB×vV–v‡C£c#ä6öæW†œ;6â÷&66Æ–6W"òÖööç&¶W#ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Ö&v–âÖ&÷GFöÓ£g‚#ãÆ–çWB–CÒ&—–åòG¶Òæ–GÒ"G—SÒ'FW‡B"Æ6V†öÆFW#Ò$•“"ãc‚ãç‡‡‚"7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ·FF–æs£W‚‡ƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçB×6—¦S£'ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76S¶Ö–â×v–GFƒ£#à¢Æ'WGFöâöæ6Æ–6³Ò'6fU&–çFW$—‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢3¶&÷&FW#¦æöæS¶&÷&FW"×&F—W3£gƒ·FF–æs£W‚ƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW#¶fÆW‚×6‡&–æ³£#äô³Âö'WGFöããÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£g‚#ãÆ–çWB–CÒ&—¶W•òG¶Òæ–GÒ"G—SÒ'77v÷&B"Æ6V†öÆFW#Ò$’¶W’†÷6–öæÂ’"fÇVSÒ"G¶vWE&–çFW$”¶W’†Òæ–B—Ò"7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ·FF–æs£W‚‡ƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶föçB×6—¦S£'ƒ¶föçBÖfÖ–Ç“¦Ööæ÷76S¶Ö–â×v–GFƒ£#à¢Æ'WGFöâöæ6Æ–6³Ò'6fU&–çFW$”¶W’‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ·FF–æs£W‚ƒ¶föçB×6—¦S£'ƒ¶7W'6÷#§ö–çFW#¶fÆW‚×6‡&–æ³£¶6öÆ÷#§f"‚Ò×FW‡C2’#ä¶W“Âö'WGFöããÂöF—cà¢ÂöF—cæ°¢ÒVÇ6R–b‡2ç7FFSÓÓÒv–F÷vâr—°¢òòÆÜ:V–æ6öçFW7FVâ7RT’vV"W&òæòVâÖööç&¶W"âäòW2ÆòÖ—6Öğ¢òòVRW7F"vF¢VVFRW7F"–×&–Ö–VæFò†÷&Ö—6Öòà¢6öç7BV•÷'C×2æÆ—fU÷'GÇÅôÄ•dUõ$ô$Uõõ%E5³Ó°¢6öç7B7f3ÖÒæÖöFVÆóÓÓÒt³sòröWF2ö–æ—BæBõ3SfÖööç&¶W%÷6W'f–6R&W7F'Bs¢röWF2ö–æ—BæBöÖööç&¶W"&W7F'Bs°¢&öG“ÖÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃsÃÃã‚“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃsÃÃã2“¶&÷&FW"×&F—W3£‡‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢6ff¶föçB×vV–v‡C£s¶Ö&v–âÖ&÷GFöÓ£G‚#ï	ù:FVÆVÖWG,:Ö6:ÖF+rÆÜ:V–æW7L:f—fÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£gƒ¶Æ–æRÖ†V–v‡C£ãCR#å&W7öæFRVâVÂVW'FòG·V•÷'GÒW&òÖööç&¶W"æò6öçFW7FâÆ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"’#åVVFRW7F"–×&–Ö–VæFò6–âVRVÂF6†&ö&BÆòfVÂö#â(	B&Wl:×6ÆçFW2FRF&Æ÷"Æ–'&RãÂöF—cà¢Æ'WGFöâ–CÒ'&V6÷eòG¶Òæ–GÒ"öæ6Æ–6³Ò'&V6÷fW%&–çFW%FVÆVÖWG'’‚rG¶Òæ–GÒr’"7G–ÆSÒ'v–GFƒ£S¶&6¶w&÷VæC§&v&ƒ#SRÃsÃÃã‚“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃsÃÃãR“¶6öÆ÷#¢6ff¶&÷&FW"×&F—W3£wƒ·FF–æs£wƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW#¶Ö&v–âÖ&÷GFöÓ£g‚#ï	ùJr&V7WW&"FVÆVÖWG,:ÖÂö'WGFöãà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶Æ–æRÖ†V–v‡C£ãB#å&V–æ–6–Öööç&¶W"FW6FRVÂ'&–FvRFVÂFÆÆW"âæò–çFW''V×RÆ–×&W6œ;6âVâ7W'6òãÆ'#äÖæòÂ÷"54ƒ¢Ç7â7G–ÆSÒ&föçBÖfÖ–Ç“¦Ööæ÷76S¶6öÆ÷#§f"‚Ò×FW‡C"’#ç76‚&ö÷DG¶—ÒrG¶W66T‡FÖÂ‡7f2—ÒsÂ÷7ããÂöF—cà¢Æ‡&VcÒ"G¶W66T‡FÖÂ…÷&–çFW%÷'EW&Â†—ÇV•÷'BÂròr’—Ò"F&vWCÒ%ö&Ææ²"&VÃÒ&æö÷VæW""7G–ÆSÒ&F—7Æ“¦&Æö6³·FW‡BÖÆ–vã¦6VçFW#¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶6öÆ÷#§f"‚Ò×FW‡C2“¶&÷&FW"×&F—W3£wƒ·FF–æs£wƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s·FW‡BÖFV6÷&F–öã¦æöæR#ï	ùHâ'&—"Æ–×&W6÷&Âöà¢ÂöF—cæ°¢ÒVÇ6R–b‡2ç7FFSÓÓÒvöffÆ–æRr—°¢&öG“ÖÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£'ƒ·FF–æs£‡‚#ãÆ#å6–âFVÆVÖWG,:ÖÂö#ãÆ'#ãÇ7â7G–ÆSÒ&föçBÖfÖ–Ç“¦Ööæ÷76S¶föçB×6—¦S£ãW‚#âG¶—ÓÂ÷7ããÆ'#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ãW‚#âG¶W66T‡FÖÂ‡2æ6öææV7F–öäW'&÷'ÇÂtÆ–×&W6÷&æò&W7öæFœ;2r—ÓÂ÷7ããÆ'#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢3ssr#âG¶W66T‡FÖÂ†f×E&–çFW%6VVâ‡2æÆ7E6VVäB’—ÓÂ÷7ããÂöF—cæ°¢ÒVÇ6R–b‡2ç7FFSÓÓÒw6‡WFF÷vâr—°¢&öG“ÖÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Ãã‚“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃc‚Ãc‚Ãã2“¶&÷&FW"×&F—W3£‡‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢6fcf#f#¶föçB×vV–v‡C£s¶Ö&v–âÖ&÷GFöÓ£G‚#î)ª¶Æ—W"FWFVæ–FóÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£—ƒ¶Æ–æRÖ†V–v‡C£ãB#âG¶W66T‡FÖÂ‡2æ¶Ä×6wÇÂtÆ–×&W6÷&&W÷'L;2VâW'&÷"’6RFWGWfòâÆ–×&W6œ;6âVâ7W'6ò6R–çFW''V×œ;2âr—ÓÂöF—cà¢Æ'WGFöâöæ6Æ–6³Ò'&–çFW$f—&×v&U&W7F'B‚rG¶Òæ–GÒr’"7G–ÆSÒ'v–GFƒ£S¶&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚ÃãR“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃc‚Ãc‚ÃãCR“¶6öÆ÷#¢6fcf#f#¶&÷&FW"×&F—W3£wƒ·FF–æs£wƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW"#ï	ùHB&V–æ–6–"f—&×v&SÂö'WGFöãà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Ö&v–â×F÷£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçBÖfÖ–Ç“¦Ööæ÷76R#âG¶—ÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£G‚#à¢Æ'WGFöâöæ6Æ–6³Ò&÷Vå&–çFW$6öæäÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$6öæf–wW&"•Â’¶W’’ÄTB#î)©“Âö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷VåvV&6ÔÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC¢G²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òw&v&ƒÃ#"Ã#BÃã"’s¢wf"‚Ò×7W&f6S"’wÓ¶&÷&FW#£‚6öÆ–BG²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òw&v&ƒÃ#"Ã#BÃã2’s¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢G²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òwf"‚ÒÖ66VçB’s¢wf"‚Ò×FW‡C2’wÓ¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$6öæf–wW&"vV&6Ò#ï	ù;sÂö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷Vä†—7F÷'”ÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$†—7F÷&–ÂG¶†—7BæÆVæwF‡Ò&Vv—7G&÷2#ï	ù8²G¶†—7BæÆVæwFƒãöÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçB“¶föçB×vV–v‡C£s#âG¶†—7BæÆVæwF‡ÓÂ÷7ãæ¢rwÓÂö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢ÂöF—cæ°¢ÒVÇ6R°¢&öG“Ö ¢G¶—47F—fSöÆF—b7G–ÆSÒ&Ö&v–ã£‚gƒ¶F—7Æ“¦fÆWƒ¶v£—ƒ¶Æ–vâÖ—FV×3¦6VçFW"#à¢Gµ÷6fU&–çFW$ÖVF–W&Â‡2çF‡VÖ%W&Â“öÆ–ÖrÆöF–æsÒ&Æ§’"FV6öF–æsÒ&7–æ2"7&3Ò"Gµ÷6fU&–çFW$ÖVF–W&Â‡2çF‡VÖ%W&Â—Ò"7G–ÆSÒ'v–GFƒ£SGƒ¶†V–v‡C£SGƒ¶ö&¦V7BÖf—C¦6÷fW#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶fÆW‚×6‡&–æ³£"öæW'&÷#Ò'F†—2ç7G–ÆRæF—7Æ“ÒvæöæRr#æ¢rwĞ¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“·v†—FR×76S¦æ÷w&¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3¶Ö&v–âÖ&÷GFöÓ£G‚"F—FÆSÒ"G¶W66T‡FÖÂ‡2æf–ÆVæÖR—Ò#âG¶W66T‡FÖÂ‡2æf–ÆVæÖWÇÂ~(	Br—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦&6VÆ–æS¶v£gƒ¶Ö&v–âÖ&÷GFöÓ£W‚#à¢Ç7â6Æ73Ò'&–r"–CÒ'&–uòG¶Òæ–GÒ"7G–ÆSÒ&föçB×6—¦S£#'ƒ¶föçB×vV–v‡C£ƒ¶6öÆ÷#¢G·6Òæ6öÆ÷'Ò#âG·2ç&öw&W77ÒSÂ÷7ãà¢Ç7â–CÒ'WFòG¶Òæ–GÒ"7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖÆVgC¦WFò#î(ûG¶f×E6V72‡2æWF—Ò&W7FçFSÂ÷7ãà¢ÂöF—cà¢ÆF—b6Æ73Ò'&"G¶—5&–çF–æsòvÆ—fRs¢rwÒ#ãÆ’–CÒ'&%òG¶Òæ–GÒ"7G–ÆSÒ'v–GFƒ¢G·2ç&öw&W77ÒR#ãÂö“ãÂöF—cà¢ÂöF—cà¢ÂöF—cæ¢rwĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Ö&v–â×F÷£‡‚#à¢ÆF—b7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£wƒ·FF–æs£wƒ·FW‡BÖÆ–vã¦6VçFW"#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶ÆWGFW"×76–æs¢ãWƒ¶Ö&v–âÖ&÷GFöÓ£'‚#ä„õDTäCÂöF—cà¢ÆF—b6Æ73Ò'FV×"–CÒ'†÷EòG¶Òæ–GÒ"7G–ÆSÒ&föçB×6—¦S£wƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G·2æ†÷FVæCòçF&vWCãòr6fcf#3Rs¢wf"‚Ò×FW‡B’wÓ¶Æ–æRÖ†V–v‡C£#âG·2æ†÷FVæCòæ7GVÇÇÃÜ+ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–â×F÷£'‚#âG·2æ†÷FVæCòçF&vWCãò~(i"r·2æ†÷FVæBçF&vWB²|+s¢vg,:ÖwÓÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£wƒ·FF–æs£wƒ·FW‡BÖÆ–vã¦6VçFW"#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶ÆWGFW"×76–æs¢ãWƒ¶Ö&v–âÖ&÷GFöÓ£'‚#ä4ÔÂöF—cà¢ÆF—b6Æ73Ò'FV×"–CÒ'&VEòG¶Òæ–GÒ"7G–ÆSÒ&föçB×6—¦S£wƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G·2æ&VCòçF&vWCãòr6ffs¢wf"‚Ò×FW‡B’wÓ¶Æ–æRÖ†V–v‡C£#âG·2æ&VCòæ7GVÇÇÃÜ+ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–â×F÷£'‚#âG·2æ&VCòçF&vWCãò~(i"r·2æ&VBçF&vWB²|+s¢vg,:ÖwÓÂöF—cà¢ÂöF—cà¢ÂöF—cà¢G¶—47F—fSöÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶Ö&v–â×F÷£‡‚#à¢G¶—5&–çF–æsöÆ'WGFöâöæ6Æ–6³Ò'&–çFW$6öçG&öÂ‚rG¶Òæ–GÒrÂwW6Rr’"7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§&v&ƒ#SRÃsÃÃãR“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃsÃÃãB“¶6öÆ÷#¢6ff¶&÷&FW"×&F—W3£wƒ·FF–æs£gƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW"#î(û‚W6#Âö'WGFöãæ¢rwĞ¢G¶—5W6VCöÆ'WGFöâöæ6Æ–6³Ò'&–çFW$6öçG&öÂ‚rG¶Òæ–GÒrÂw&W7VÖRr’"7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§&v&ƒÃ#"ÃsÃãR“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"ÃsÃãB“¶6öÆ÷#¢3CF¶&÷&FW"×&F—W3£wƒ·FF–æs£gƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW"#î)kb&VçVF#Âö'WGFöãæ¢rwĞ¢Æ'WGFöâöæ6Æ–6³Ò'&–çFW$6öçG&öÂ‚rG¶Òæ–GÒrÂv6æ6VÂr’"7G–ÆSÒ&fÆWƒ£¶&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Ãã"“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃc‚Ãc‚Ãã3R“¶6öÆ÷#¢6fcCCCC¶&÷&FW"×&F—W3£wƒ·FF–æs£gƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW"#î)j6æ6VÆ#Âö'WGFöãà¢ÂöF—cæ¢rwĞ¢G·F‚æÆVæwFƒãÓ#öÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£g‚‡ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£w‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£7‚#åFV×W&GW&†÷FVæCÂöF—cà¢ÆF—b–CÒ'7&µòG¶Òæ–GÒ#âG·&VæFW%7&¶Æ–æR‡F‚Âv‚rÂr6fcf#3Rr—ÓÂöF—cà¢ÂöF—cæ¢rwĞ¢ÆF—b6Æ73Ò'6&BÖ—&÷r"7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Ö&v–â×F÷£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçBÖfÖ–Ç“¦Ööæ÷76R#âG¶—ÒG¶vWE&–çFW$”¶W’†Òæ–B“öÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’"F—FÆSÒ$’¶W’6öæf–wW&F#ï	ùIÂ÷7ãæ¢rwÓÂ÷7ãà¢ÆF—b6Æ73Ò'6&BÖ7F–öç2"7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£G‚#à¢Gµ÷&VæFW%&–çFW$Æ–v‡D'WGFöâ†Òæ–B—Ğ¢Æ'WGFöâöæ6Æ–6³Ò&÷Vå&–çFW$6öçG&öÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC¢G¶—47F—fSòw&v&ƒÃ#"ÃsÃã"’s¢wf"‚Ò×7W&f6S"’wÓ¶&÷&FW#£‚6öÆ–BG¶—47F—fSòw&v&ƒÃ#"ÃsÃã3R’s¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢G¶—47F—fSòwf"‚ÒÖ66VçB’s¢wf"‚Ò×FW‡C2’wÓ¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$6öçG&öÂFR–×&W6÷&#ï	øé¾ûˆóÂö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷Väv6öFUWÆöB‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$Vçf–"rÖ6öFR#ï	ù:CÂö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷Vå&–çFW$6öæäÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$6öæf–wW&"•Â’¶W’’ÄTB#î)©“Âö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷VåvV&6ÔÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC¢G²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òw&v&ƒÃ#"Ã#BÃã"’s¢wf"‚Ò×7W&f6S"’wÓ¶&÷&FW#£‚6öÆ–BG²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òw&v&ƒÃ#"Ã#BÃã2’s¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢G²†Æö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶Òæ–B—ÇÆÒæ6Ò“òwf"‚ÒÖ66VçB’s¢wf"‚Ò×FW‡C2’wÓ¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$6öæf–wW&"vV&6Ò#ï	ù;sÂö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷Vä&VDÖW6‚‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$&VBÖW6‚†ÖFRæ—fVÆ6œ;6âFR6Ö’#ï	ù{®ûˆóÂö'WGFöãà¢Æ'WGFöâöæ6Æ–6³Ò&÷Vä†—7F÷'”ÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$†—7F÷&–ÂG¶†—7BæÆVæwF‡Ò&Vv—7G&÷2#ï	ù8²G¶†—7BæÆVæwFƒãöÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçB“¶föçB×vV–v‡C£s#âG¶†—7BæÆVæwF‡ÓÂ÷7ãæ¢rwÒÂö'WGFöãà¢Gµ÷VWVT6÷VçB†Òæ–B“ãöÆ'WGFöâöæ6Æ–6³Ò&÷VåVWVTÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃsÃÃã"“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃsÃÃãB“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢6ff¶föçB×6—¦S£ãWƒ·FF–æs£7‚wƒ¶7W'6÷#§ö–çFW""F—FÆSÒ"Gµ÷VWVT6÷VçB†Òæ–B—ÒG&&¦ò‡2’Vâ6öÆ#ï	ùHGµ÷VWVT6÷VçB†Òæ–B—ÓÂö'WGFöãæ¢rwĞ¢ÂöF—cà¢ÂöF—cæ°¢Ğ ¢6öç7B6&D‡FÖÃÖÆF—b–CÒ&Ö6&EòG¶Òæ–GÒ"6Æ73Ò'6&BG¶—47F—fSòr7F—fRs¢rwÒG·2ç7FÆSòr7FÆRs¢rwÒ"7G–ÆSÒ"ÒÖ63¢G·6Òæ6öÆ÷'Ó¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–BG¶Ö–çDÆW'G2æÆVæwFƒòw&v&ƒ#SRÃsÃÃãB’s¦—47F—fS÷6Òæ6öÆ÷"²sSRs¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×F÷£7‚6öÆ–BG¶v3òæ6öÆ÷'ÇÂwf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£7ƒ·FF–æs£7ƒ¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖâ#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡‚#à¢G¶–ÖsöÆ–ÖrÆöF–æsÒ&Æ§’"FV6öF–æsÒ&7–æ2"7&3Ò"G¶–ÖwÒ"7G–ÆSÒ'v–GFƒ£3Gƒ¶†V–v‡C£3Gƒ¶ö&¦V7BÖf—C¦6öçF–ã¶&÷&FW"×&F—W3£wƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶fÆW‚×6‡&–æ³£"öæW'&÷#Ò'F†—2ç7G–ÆRæF—7Æ“ÒvæöæRr#æ¢rwĞ¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#à¢ÆF—b6Æ73Ò'6&BÖæÖR"7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚Ò×FW‡B“¶Æ–æRÖ†V–v‡C£ã#R#âG¶W64‡FÖÂ†ÒææöÖ'&R—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#äÜ:V–æ2G¶ÒæçVÔwÓÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶Æ–vâÖ—FV×3¦fÆW‚ÖVæC¶v£7ƒ¶fÆW‚×6‡&–æ³£#à¢Ç7â7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖfÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£Wƒ¶&6¶w&÷VæC¢G·6Òæ&wÓ¶6öÆ÷#¢G·6Òæ6öÆ÷'Ó¶&÷&FW"×&F—W3£Wƒ·FF–æs£'‚‡ƒ¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶&÷&FW#£‚6öÆ–BG·6Òæ6öÆ÷'Ó32#ãÇ7â6Æ73Ò'F÷BG¶—47F—fSòrÆ—fRs¢rwÒ#ãÂ÷7ãâG·6ÒæÆ&VÇÓÂ÷7ãà¢G·2ç7FÆSöÇ7â7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#Ã#Ã#ÃãR“¶6öÆ÷#¢3“““¶&÷&FW"×&F—W3£Wƒ·FF–æs£‚gƒ¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶&÷&FW#£‚6öÆ–B&v&ƒ#Ã#Ã#Ãã#R’"F—FÆSÒ%6–â6\;ÂÖöÖVçL:æV(	BÖ÷7G&æFòVÂ;¦ÇF–ÖòW7FFò6öæö6–Fò#î)û2&V6öæV7FæFóÂ÷7ãæ¢rvÚ±î¸Â¸­yêë¢°k¢G§¦*^}
          ${maintAlerts.length?`<span style="background:rgba(255,170,0,0.15);color:#ffaa00;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;border:1px solid rgba(255,170,0,0.3)" title="${maintAlerts.map(a=>a.label).join(', ')}">ğŸ”§ ${maintAlerts.length} alerta${maintAlerts.length>1?'s':''}</span>`:''}
          ${idleWarn?`<span style="background:rgba(100,100,100,0.15);color:#888;border-radius:5px;padding:1px 6px;font-size:10px;font-weight:700;border:1px solid rgba(100,100,100,0.2)">ğŸ’¤ ${idleHours}h idle</span>`:''}
        </div>
      </div>
      ${body}
      <div id="mccam_${m.id}" class="pcam-slot"></div>
    </div>`;
    return{id:m.id,fp:structFP,camKey,html:cardHtml};
  });
  // Render selectivo en dos niveles + parche en vivo:
  //  Â· structFP (forma de la tarjeta) â†’ solo se reescribe el DOM si cambiÃ³.
  //  Â· cÃ¡mara â†’ nodo propio (#mccam_), se (re)monta solo si cambia su URL,
  //    asÃ­ el stream MJPEG/snapshot NO parpadea en cada ciclo.
  //  Â· nÃºmeros en vivo (progreso/eta/temps/sparkline) â†’ se parchean en sitio
  //    cada ciclo sin reconstruir DOM (no reinicia animaciones ni roba foco).
  // El grid completo solo se reconstruye si cambia el conjunto/orden de mÃ¡quinas.
  const __ids=__cards.map(c=>c.id).join('|');
  if(el.__order!==__ids){
    el.innerHTML=__cards.map(c=>c.html).join('');
    el.__order=__ids;el.__fp={};el.__cam={};
    __cards.forEach(c=>{el.__fp[c.id]=c.fp;_syncPrinterCam(c.id,c.camKey,true);el.__cam[c.id]=c.camKey;_patchLivePrinter(c.id,_printerStatus[c.id]);});
  }else{
    __cards.forEach(c=>{
      if(el.__fp[c.id]!==c.fp){
        const node=document.getElementById('mcard_'+c.id);
        if(node)node.outerHTML=c.html;else el.insertAdjacentHTML('beforeend',c.html);
        el.__fp[c.id]=c.fp;
        _syncPrinterCam(c.id,c.camKey,true);   // la tarjeta se rehÃ­zo â†’ re-montar cÃ¡mara
        el.__cam[c.id]=c.camKey;
      }else if(el.__cam[c.id]!==c.camKey){
        _syncPrinterCam(c.id,c.camKey,false);  // solo cambiÃ³ la cÃ¡mara
        el.__cam[c.id]=c.camKey;
      }
      _patchLivePrinter(c.id,_printerStatus[c.id]);
    });
  }
  const lu=document.getElementById('monitorLastUpdate');
  if(lu)lu.textContent=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
// Monta/actualiza la cÃ¡mara en su nodo persistente. Sin force, no toca el <img>
// si la URL no cambiÃ³ â†’ el stream sigue vivo entre ciclos (cero parpadeo).
function _syncPrinterCam(id,camKey,force){
  const slot=document.getElementById('mccam_'+id);if(!slot)return;
  if(!force&&slot.__camKey===camKey)return;
  if(!camKey){slot.innerHTML='';slot.__camKey='';return;}
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const raw=_printerCamRaw(id);
  const camU=_safePrinterMediaUrl(printerCamUrl(id)),snap=_camIsSnapshot(raw);
  if(!camU){slot.innerHTML='';slot.__camKey='';return;}
  // El <img> se conserva SIEMPRE (para snapshots se refresca cada 1s vÃ­a data-snap,
  // asÃ­ se recupera solo cuando la cÃ¡mara vuelve). En vez de romper el nodo al fallar,
  // mostramos una capa "sin seÃ±al" superpuesta y ocultamos la imagen â€” al primer frame
  // bueno (onload) la capa se esconde de nuevo.
  slot.innerHTML=`<div style="margin-top:8px;border-radius:8px;overflow:hidden;background:#000;position:relative;min-height:56px">
    <img loading="lazy" decoding="async" ${snap?`data-snap="${camU}"`:''} src="${camU}" style="width:100%;display:block;max-height:160px;object-fit:cover" onload="this.style.opacity='1';var o=this.parentElement.querySelector('.pcam-off');if(o)o.style.display='none'" onerror="this.style.opacity='0';var o=this.parentElement.querySelector('.pcam-off');if(o)o.style.display='flex'">
    <div class="pcam-off" style="display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:#8a8a8a;font-size:10.5px;background:#0b0b0b;text-align:center;padding:6px"><span style="font-size:15px">ğŸ“·</span>CÃ¡mara sin seÃ±al<span style="font-size:10px;color:#666">${snap?'reintentandoâ€¦':'verifica la URL'}</span></div>
  </div>`;
  slot.__camKey=camKey;
}
// Parchea los valores que cambian a cada lectura, en sitio, sin reconstruir la
// tarjeta. Si el elemento no existe (estado no activo), simplemente no hace nada.
function _patchLivePrinter(id,s){
  if(!s)return;
  const g=p=>document.getElementById(p+id);
  const set=(p,t)=>{const e=g(p);if(e&&e.textContent!==t)e.textContent=t;};
  const bar=g('pbar_');if(bar&&s.progress!=null){const w=s.progress+'%';if(bar.style.width!==w)bar.style.width=w;}
  if(s.progress!=null)set('pbig_',s.progress+'%');
  set('peta_','â± '+fmtSecs(s.eta)+' restante');
  if(s.hotend)set('phot_',(s.hotend.actual||0)+'Â°');
  if(s.bed)set('pbed_',(s.bed.actual||0)+'Â°');
  const sp=g('pspark_'),th=_tempHistory[id]||[];
  if(sp&&th.length>=2)sp.innerHTML=renderSparkline(th,'h','#ff6b35');
  _patchPrinterLightButton(id);
}

async function printerControl(id,action){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  if(action==='cancel'&&!confirm(`Â¿Cancelar impresiÃ³n en ${m.nombre} #${m.numG}?`))return;
  toast({pause:'â¸ Pausando',resume:'â–¶ Reanudando',cancel:'â–  Cancelando'}[action]+` ${m.nombre} #${m.numG}`,'info');
  const headers=getPrinterAuthHeaders(id);
  try{
    const r=await fetch(printerUrl(ip,`/printer/print/${action}`),{method:'POST',signal:AbortSignal.timeout(6000),headers});
    if(r.ok)setTimeout(pollPrinters,1500);else toast('Error: '+r.status,'error');
  }catch(e){toast('Sin conexiÃ³n con la impresora','error');}
}

// Reinicia el firmware Klipper (saca la impresora del estado "shutdown").
// Moonraker mantiene la peticiÃ³n abierta hasta reconectar; si tarda y caduca
// el timeout lo tratamos igual como "reiniciÃ¡ndose" (no es un error real).
async function printerFirmwareRestart(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  if(!confirm(`ğŸ”„ Reiniciar el firmware de ${m.nombre} #${m.numG}?\n\nSaca a Klipper del estado "detenido". Si la causa fue puntual, volverÃ¡ a funcionar; si es un fallo de hardware (termistor/MCU) se detendrÃ¡ otra vez â€” revisa la impresora.`))return;
  toast(`ğŸ”„ Reiniciando firmware de ${m.nombre} #${m.numG}â€¦`,'info');
  try{
    const r=await fetch(printerUrl(ip,'/printer/firmware_restart'),{method:'POST',signal:AbortSignal.timeout(15000),headers:getPrinterAuthHeaders(id)});
    if(r.ok)toast('âœ… Firmware reiniciado','success');
    else toast('Error: '+r.status,'error');
  }catch(e){toast('ğŸ”„ Comando enviado â€” la conexiÃ³n se reiniciaâ€¦','info');}
  setTimeout(pollPrinters,4000);
}

// Recupera la telemetrÃ­a de una mÃ¡quina viva cuyo Moonraker se cayÃ³. El
// navegador no puede abrir una shell en la impresora, asÃ­ que se lo pide al
// bridge del taller (POST /recover/{IP}), que sÃ­ estÃ¡ en la LAN: repone
// moonraker.conf si falta y reinicia el servicio. Klipper no se toca â€” una
// impresiÃ³n en curso sigue su camino.
const _RECOVER_TIMEOUT_MS=90000;   // el bridge hace SSH + espera a que Moonraker vuelva (~75s peor caso)
async function recoverPrinterTelemetry(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  const btn=document.getElementById('recov_'+id);
  const label=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.style.opacity='.7';btn.innerHTML='â³ Recuperandoâ€¦ (hasta 1 min)';}
  toast(`ğŸ”§ Reiniciando Moonraker en ${m.nombre} #${m.numG}â€¦`,'info');
  const tk=getPrinterTunnelToken();
  try{
    const r=await fetch(_appendBridgeToken(`${getPrinterTunnel()}/recover/${ip}`),{method:'POST',signal:AbortSignal.timeout(_RECOVER_TIMEOUT_MS)});
    let d={};try{d=await r.json();}catch(_){}
    const detalle=d.error||(Array.isArray(d.steps)?d.steps[d.steps.length-1]:'')||`HTTP ${r.status}`;
    if(r.status===401)toast('Token del bridge invÃ¡lido â€” pÃ©galo de nuevo en Mi cuenta â†’ TÃºnel Impresoras','error');
    else if(r.status===404)toast('Este bridge todavÃ­a no sabe recuperar: actualÃ­zalo en el iMac (git pull + reiniciar)','error');
    else if(r.status===409)toast('Ya hay una recuperaciÃ³n en curso para esa impresora','info');
    else if(r.ok&&d.ok)toast(`âœ… TelemetrÃ­a recuperada Â· ${m.nombre} #${m.numG}`,'success');
    else toast('No se pudo recuperar: '+detalle,'error');
  }catch(e){
    console.error('[recover]',e);
    let host=getPrinterTunnel();try{host=new URL(host).host;}catch(_){}
    toast(e?.name==='TimeoutError'||e?.name==='AbortError'
      ?'La recuperaciÃ³n tardÃ³ demasiado â€” revisa la impresora y su moonraker.log'
      :`No se pudo hablar con el bridge (${host}) â€” ${e?.name||'error de red'}`,'error');
  }finally{
    if(btn){btn.disabled=false;btn.style.opacity='';btn.innerHTML=label;}
    delete _aliveProbe[id];   // el sondeo cacheado quedÃ³ obsoleto
    _failCount[id]=0;
    pollPrinters();
  }
}

// â”€â”€ CONTROL MOONRAKER (temperatura Â· mÃ¡quina Â· archivos Â· historial) â”€â”€
// SEGURIDAD: todos los comandos de ESCRITURA verifican _isPrinterBusy antes
// de enviar nada â€” si la impresora estÃ¡ imprimiendo/pausada se rechazan, para
// no arriesgar un trabajo en curso. Solo la parada de emergencia ignora esto.
const PREHEAT_PRESETS={PLA:{h:210,b:60},PETG:{h:240,b:80},ABS:{h:250,b:100},TPU:{h:225,b:50}};
function _isPrinterBusy(state){return state==='printing'||state==='paused';}
function _pcState(id){return(_printerStatus[id]||{}).state||'offline';}
// â”€â”€ AGENTE: AuditorÃ­a y mantenciÃ³n 3D â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Audita cada impresora vÃ­a Moonraker. SEGURIDAD: no propone ni ejecuta nada
// sobre una mÃ¡quina imprimiendo/pausada; las acciones reutilizan _sendGcode (gated).
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
  if(errored){issues.push({sev:1,txt:'Klipper detenido ('+klState+')'+(klMsg?': '+klMsg:'')});actions.push({key:'firmware',txt:'ğŸ”„ Reiniciar firmware'});}
  if(busy)issues.push({sev:0,txt:'Imprimiendo'+(ps.filename?' Â· '+ps.filename.replace(/\.gcode$/i,''):'')+' â€” no se tocarÃ¡'});
  if(!busy&&!errored){
    if(!homed){issues.push({sev:2,txt:'Sin home (ejes sin referenciar)'});actions.push({key:'home',txt:'ğŸ  Home'});}
    if(!meshOk){issues.push({sev:2,txt:'Sin malla de cama activa'});actions.push({key:'mesh',txt:'ğŸ“ Calibrar malla'});}
    else actions.push({key:'mesh',txt:'ğŸ“ Recalibrar malla'});
  }
  let fc=null; try{if(typeof getMaintForecast==='function')fc=getMaintForecast(m);}catch(_){}
  if(fc&&fc.hoursLeft<=0)issues.push({sev:1,txt:'MantenciÃ³n '+fc.tipo+' VENCIDA'});
  else if(fc&&fc.rate>0&&fc.weeks<1.5)issues.push({sev:2,txt:'MantenciÃ³n '+fc.tipo+' prÃ³xima (~'+Math.max(1,Math.round(fc.weeks*7))+'d)'});
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
  const el=document.getElementById('audit3DResult');if(el&&!silent)el.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Auditando impresorasâ€¦</div>';
  audit3DRenderResult(await audit3DAll());
  try{audit3DLoadDaily();}catch(_){}
}
// El panel de auditorÃ­a es un snapshot: antes, tras Home/calibrar se quedaba con
// el dato viejo (p.ej. "Sin home") hasta apretar "Auditar ahora". Ahora la propia
// acciÃ³n re-audita en silencio (sin el spinner) en varios momentos, para reflejar
// el estado nuevo a medida que la mÃ¡quina termina el home/nivelaciÃ³n.
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
    const stTxt=a.errored?'âš  Detenida (Klipper)':a.busy?'ğŸ–¨ Imprimiendo':a.state==='offline'?'âš« Offline':a.state==='noip'?'Sin IP':'âœ“ Lista';
    const issues=(a.issues||[]).map(i=>`<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2)"><span style="width:6px;height:6px;border-radius:50%;background:${_audit3DDot(i.sev)};flex-shrink:0"></span>${escapeHtml(i.txt)}</div>`).join('');
    const acts=(a.actions||[]).map(ac=>{const fn=ac.key==='firmware'?`printerFirmwareRestart('${a.id}')`:ac.key==='home'?`audit3DHome('${a.id}')`:`audit3DCalibrate('${a.id}')`;return `<button class="btn btn-ghost btn-sm" onclick="${fn}" style="font-size:10.5px">${escapeHtml(ac.txt)}</button>`;}).join('');
    return `<div style="padding:11px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--surface2)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
        <b style="font-size:12px">${escapeHtml(a.nombre)} <span style="color:var(--text3)">#${a.numG}</span></b>
        <span style="font-size:12px;color:${stCol};font-weight:600">${stTxt}</span>
        ${!a.busy&&a.state!=='offline'&&a.state!=='noip'&&a.state!=='error'?`<span style="font-size:10.5px;color:var(--text3)">ğŸŒ¡ ${a.hotend}Â°/${a.bed}Â°${a.homed?' Â· home âœ“':''}${a.meshOk?' Â· malla âœ“':''}</span>`:''}
        <span style="margin-left:auto;display:flex;gap:5px;flex-wrap:wrap">${acts}</span>
      </div>
      ${issues||'<div style="font-size:12px;color:var(--success)">Sin observaciones â€” lista para imprimir.</div>'}
    </div>`;}).join('');
  el.innerHTML=`<div style="font-size:12px;color:var(--text2);margin-bottom:10px">âœ“ <b style="color:var(--success)">${okN}</b> lista(s) Â· <b style="color:var(--danger)">${errN}</b> con error Â· ${offN} offline Â· ${res.length} total</div>`+cards;
}
async function audit3DCalibrate(id){
  const m=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('ğŸ”’ EstÃ¡ imprimiendo â€” no se calibra','error');return;}
  if(!confirm(`ğŸ“ Calibrar bed mesh en ${m.nombre} #${m.numG}?\n\nHarÃ¡ home + nivelaciÃ³n de cama (1-2 min). AsegÃºrate de que la cama estÃ© despejada.`))return;
  _sendGcode(id,'G28\nBED_MESH_CALIBRATE','ğŸ“ Calibrando bed meshâ€¦ (1-2 min)',{timeout:180000});
  _audit3DRefreshBurst([8000,60000,95000,140000]);
}
async function audit3DCalibrateAll(){
  const free=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).filter(m=>getPrinterIp(m)&&!_isPrinterBusy(_pcState(m.id))&&_pcState(m.id)!=='offline'&&_pcState(m.id)!=='shutdown');
  if(!free.length){toast('No hay impresoras libres y listas para calibrar','info');return;}
  if(!confirm(`ğŸ“ Lanzar bed mesh en ${free.length} impresora(s) libre(s)?\n\n${free.map(m=>m.nombre+' #'+m.numG).join(', ')}\n\nCada una hace home + nivelaciÃ³n. No toca las que estÃ©n imprimiendo.`))return;
  free.forEach(m=>_sendGcode(m.id,'G28\nBED_MESH_CALIBRATE',null,{timeout:180000}));
  toast(`ğŸ“ CalibraciÃ³n lanzada en ${free.length} impresora(s)`,'success');
  _audit3DRefreshBurst([8000,60000,95000,140000]);
}
async function audit3DReport(){
  const out=document.getElementById('audit3DAiOut');if(out){out.style.display='block';out.textContent='ğŸ§  Analizando el estado del parqueâ€¦';}
  if(!window._audit3D)await audit3DRun();
  try{showAgentWorking('MANTENCION3D',{verb:'estÃ¡ auditando el parque de impresorasâ€¦',messages:['Revisando el estado de cada mÃ¡quinaâ€¦','Detectando errores y mantencionesâ€¦','Sugiriendo calibracionesâ€¦']});}catch(e){}
  try{const cfg=(typeof AGENTES_CFG!=='undefined')?AGENTES_CFG.find(a=>a.id==='MANTENCION3D'):null;const resp=await callAgentClaude('MANTENCION3D',cfg?cfg.sys:'',buildAgentContext('MANTENCION3D'));if(out)out.textContent=resp;}
  catch(e){if(out)out.textContent='Error IA: '+(e&&e.message||e);}
  finally{try{hideAgentWorking();}catch(e){}}
}
// Ãšltimo reporte de la rutina automÃ¡tica de la maÃ±ana (lo escribe el printer-bridge en Airtable)
async function audit3DLoadDaily(){
  const el=document.getElementById('audit3DDaily');if(!el)return;
  try{const r=await airtableFetch('Maquinas_Auditoria',1);const rec=(r.records||[])[0];if(!rec){el.innerHTML='';return;}
    const f=rec.fields;el.innerHTML=`<div style="padding:11px 14px;border:1px dashed var(--border2);border-radius:10px;font-size:12px;color:var(--text3)"><b style="color:var(--text2)">ğŸ“‹ Ãšltima auditorÃ­a automÃ¡tica</b> Â· ${escapeHtml(String(f['Fecha']||rec.createdTime||''))}<br><span style="white-space:pre-wrap">${escapeHtml(String(f['Resumen']||f['Detalle']||'').slice(0,700))}</span></div>`;
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
  if(!opts.allowBusy&&_isPrinterBusy(_pcState(id))){toast('ğŸ”’ Bloqueado: la impresora estÃ¡ imprimiendo â€” no se enviÃ³ nada','error');return false;}
  try{
    const r=await fetch(printerUrl(ip,`/printer/gcode/script?script=${encodeURIComponent(script)}`),{method:'POST',signal:AbortSignal.timeout(opts.timeout||9000),headers:getPrinterAuthHeaders(id)});
    if(r.ok){if(label)toast(label,'success');setTimeout(pollPrinters,1200);return true;}
    toast('Error: '+r.status,'error');return false;
  }catch(e){toast('Sin conexiÃ³n con la impresora','error');return false;}
}
// Temperatura
function setPrinterTemp(id,heater){
  const inp=document.getElementById('pcTemp_'+heater);if(!inp)return;
  let t=Math.round(+inp.value);if(!isFinite(t)||t<0)t=0;
  const max=heater==='hotend'?300:120;if(t>max){toast(`MÃ¡ximo ${max}Â° para ${heater==='hotend'?'el hotend':'la cama'}`,'error');return;}
  _sendGcode(id,heater==='hotend'?`M104 S${t}`:`M140 S${t}`,`ğŸŒ¡ï¸ ${heater==='hotend'?'Hotend':'Cama'} â†’ ${t}Â°`);
}
function preheatPrinter(id,mat){
  const p=PREHEAT_PRESETS[mat];if(!p)return;
  _sendGcode(id,`M104 S${p.h}\nM140 S${p.b}`,`ğŸ”¥ Precalentando ${mat} Â· hotend ${p.h}Â° Â· cama ${p.b}Â°`);
}
function cooldownPrinter(id){_sendGcode(id,`M104 S0\nM140 S0`,'â„ï¸ Enfriando â€” calentadores apagados');}
// MÃ¡quina
function printerHome(id){_sendGcode(id,'G28','ğŸ  Origen (home) en curso');}
function printerMotorsOff(id){_sendGcode(id,'M84','Motores liberados');}
function printerJog(id,axis,dist){_sendGcode(id,`G91\nG1 ${axis}${dist} F${axis==='Z'?600:3000}\nG90`,`Mover ${axis} ${dist>0?'+':''}${dist}mm`);}
function printerFilament(id,dir){
  const ht=(_printerStatus[id]||{}).hotend?.actual||0;
  if(ht<170){toast('ğŸŒ¡ï¸ Calienta el hotend a â‰¥170Â° antes de mover filamento','error');return;}
  const dist=dir==='load'?60:-60;
  _sendGcode(id,`M83\nG1 E${dist} F300\nM82`,dir==='load'?'â¬‡ï¸ Cargando filamento (60mm)':'â¬†ï¸ Descargando filamento (60mm)');
}
function printerEmergencyStop(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(!confirm(`â›” PARADA DE EMERGENCIA â€” ${m.nombre} #${m.numG}\n\nDetiene TODO de inmediato (incluido cualquier print en curso) y deja el firmware apagado hasta reiniciarlo desde Fluidd/Mainsail. Ãšsalo solo ante un peligro real.\n\nÂ¿Continuar?`))return;
  const ip=getPrinterIp(m);
  fetch(printerUrl(ip,'/printer/emergency_stop'),{method:'POST',headers:getPrinterAuthHeaders(id)}).then(()=>{toast('â›” Parada de emergencia enviada','info');setTimeout(pollPrinters,1500);}).catch(()=>toast('Sin conexiÃ³n','error'));
}
// Archivos en la impresora
async function loadPrinterFiles(id){
  const cont=document.getElementById('pcFiles');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Cargando archivosâ€¦</div>';
  const d=await _moonrakerGet(id,'/server/files/list?root=gcodes');
  if(!d||!Array.isArray(d.result)){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">No se pudo leer la lista de archivos</div>';return;}
  const files=d.result.sort((a,b)=>(b.modified||0)-(a.modified||0)).slice(0,30);
  const busy=_isPrinterBusy(_pcState(id));
  cont.innerHTML=files.length?files.map(f=>{
    const kb=Math.round((f.size||0)/1024),path=escapeHtml(f.path||'');
    return`<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${path}">${path}</div><div style="font-size:10px;color:var(--text3)">${kb.toLocaleString('es-CL')} KB</div></div>
      <button data-f="${path}" onclick="reprintFile('${id}',this.dataset.f)" ${busy?'disabled':''} style="background:${busy?'var(--surface3)':'rgba(0,212,170,0.15)'};border:1px solid ${busy?'var(--border2)':'rgba(0,212,170,0.4)'};color:${busy?'var(--text3)':'#00d4aa'};border-radius:6px;padding:4px 10px;font-size:10.5px;font-weight:700;cursor:${busy?'not-allowed':'pointer'};flex-shrink:0">â–¶ Imprimir</button>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:12px;padding:8px">Sin archivos g-code en esta impresora</div>';
}
async function reprintFile(id,filename){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('ğŸ”’ La impresora ya estÃ¡ ocupada','error');return;}
  if(!confirm(`Imprimir "${filename}" en ${m.nombre} #${m.numG}?`))return;
  const ip=getPrinterIp(m);
  try{const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(filename)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});if(r.ok){toast(`â–¶ Imprimiendo ${filename}`,'success');closePrinterControl();setTimeout(pollPrinters,1500);}else toast('Error al iniciar: '+r.status,'error');}catch(e){toast('Sin conexiÃ³n','error');}
}
// Historial real de Moonraker (para costos)
async function loadPrinterHistory(id){
  const cont=document.getElementById('pcHistory');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Cargando historialâ€¦</div>';
  const d=await _moonrakerGet(id,'/server/history/list?limit=15&order=desc');
  if(!d||!d.result||!Array.isArray(d.result.jobs)){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Historial no disponible (la impresora necesita el componente [history] de Moonraker, activo por defecto en Fluidd/Mainsail)</div>';return;}
  const jobs=d.result.jobs;
  if(!jobs.length){cont.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px">Sin trabajos registrados aÃºn</div>';return;}
  let totT=0,totF=0,ok=0;
  jobs.forEach(j=>{totT+=j.print_duration||0;totF+=j.filament_used||0;if(j.status==='completed')ok++;});
  const rows=jobs.map(j=>{
    const fn=escapeHtml((j.filename||'â€”').replace(/\.gcode$/i,''));
    const dur=fmtSecs(j.print_duration||0),fm=((j.filament_used||0)/1000).toFixed(1);
    const okj=j.status==='completed';
    return`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${fn}">${fn}</td>
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text3);text-align:right">${dur}</td>
      <td style="padding:5px 6px;font-size:10.5px;color:var(--text3);text-align:right">${fm} m</td>
      <td style="padding:5px 6px;text-align:right"><span style="font-size:10px;font-weight:700;color:${okj?'#00d4aa':'#ff6b35'}">${okj?'âœ“':'âœ•'}</span></td>
    </tr>`;
  }).join('');
  cont.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span class="badge badge-green">${jobs.length} trabajos Â· ${ok} ok</span>
      <span class="badge badge-gray">â± ${fmtSecs(totT)} totales</span>
      <span class="badge badge-gray">ğŸ§µ ${(totF/1000).toFixed(1)} m filamento</span>
    </div>
    <table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text3)">
      <th style="text-align:left;font-size:10px;padding:3px 6px;font-weight:600">ARCHIVO</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">TIEMPO</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">FILAM.</th><th style="text-align:right;font-size:10px;padding:3px 6px;font-weight:600">OK</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}
// Modal de control
function openPrinterControl(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Configura primero la IP de esta impresora','error');return;}
  const s=_printerStatus[id]||{};const busy=_isPrinterBusy(s.state);
  document.getElementById('pcTitle').textContent=`${m.nombre} #${m.numG}`;
  const dis=busy?'disabled':'';
  const lockBanner=busy?`<div style="background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.4);border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#ffaa00;line-height:1.5">ğŸ”’ <b>Imprimiendo ahora</b> â€” los controles de temperatura y mÃ¡quina estÃ¡n bloqueados para no arriesgar el trabajo en curso. Solo lectura de archivos e historial. La parada de emergencia sigue disponible.</div>`:'';
  const btn=(label,onclick,extra='')=>`<button onclick="${onclick}" ${dis} style="background:${busy?'var(--surface3)':'var(--surface2)'};border:1px solid var(--border2);color:${busy?'var(--text3)':'var(--text)'};border-radius:7px;padding:7px 10px;font-size:12px;font-weight:600;cursor:${busy?'not-allowed':'pointer'};${extra}">${label}</button>`;
  document.getElementById('pcBody').innerHTML=`
    ${lockBanner}
    <!-- TEMPERATURA -->
    <div style="font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">ğŸŒ¡ï¸ Temperatura</div>
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <div style="flex:1">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">HOTEND Â· actual ${s.hotend?.actual||0}Â°${s.hotend?.target>0?' â†’ '+s.hotend.target+'Â°':''}</div>
        <div style="display:flex;gap:5px"><input id="pcTemp_hotend" type="number" min="0" max="300" placeholder="${s.hotend?.target||0}" ${dis} style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px"><button onclick="setPrinterTemp('${id}','hotend')" ${dis} style="background:${busy?'var(--surface3)':'var(--accent2)'};border:none;color:${busy?'var(--text3)':'#000'};border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:${busy?'not-allowed':'pointer'}">OK</button></div>
      </div>
      <div style="flex:1">
        <div style="font-size:10px;color:var(--text3);margin-bottom:3px">CAMA Â· actual ${s.bed?.actual||0}Â°${s.bed?.target>0?' â†’ '+s.bed.target+'Â°':''}</div>
        <div style="display:flex;gap:5px"><input id="pcTemp_bed" type="number" min="0" max="120" placeholder="${s.bed?.target||0}" ${dis} style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px"><button onclick="setPrinterTemp('${id}','bed')" ${dis} style="background:${busy?'var(--surface3)':'#ffaa00'};border:none;color:${busy?'var(--text3)':'#000'};border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:${busy?'not-allowed':'pointer'}">OK</button></div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">
      <span style="font-size:10px;color:var(--text3);align-self:center">Precalentar:</span>
      ${Object.keys(PREHEAT_PRESETS).map(mat=>btn(mat,`preheatPrinter('${id}','${mat}')`,'padding:5px 10px')).join('m«ëŒ+Š×®º+º$zzb¥âr—Ğ¢G¶'Fâ‚~)ØNûˆòVæg&–"rÆ6ööÆF÷vå&–çFW"‚rG¶–GÒr–ÂwFF–æs£W‚ƒ¶Ö&v–âÖÆVgC¦WFòr—Ğ¢ÂöF—cà¢ÂÒÒÜ8T”äÒÓà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚ÒÖ66VçB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	øêâÜ:V–æÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&¶Ö&v–âÖ&÷GFöÓ£‡‚#à¢G¶'Fâ‚	øú†öÖRrÆ&–çFW$†öÖR‚rG¶–GÒr–—Ğ¢G¶'Fâ‚~*È~ûˆò6&v"f–ÆÖVçFòrÆ&–çFW$f–ÆÖVçB‚rG¶–GÒrÂvÆöBr–—Ğ¢G¶'Fâ‚~*ÈnûˆòFW66&v"rÆ&–çFW$f–ÆÖVçB‚rG¶–GÒrÂwVæÆöBr–—Ğ¢G¶'Fâ‚	ù*B6öÇF"Ö÷F÷&W2rÆ&–çFW$Ö÷F÷'4öfb‚rG¶–GÒr–—Ğ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£gƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#äÖ÷fW#£Â÷7ãà¢Gµ²u‚rÂu’rÂu¢uÒæÖ†ƒÓæG¶'Fâ†‚²r²rÆ&–çFW$¦ör‚rG¶–GÒrÂrG¶‡ÒrÂG¶ƒÓÓÒu¢só£Ò–ÂwFF–æs£W‚—‚r—ÒG¶'Fâ†‚²~(‰"rÆ&–çFW$¦ör‚rG¶–GÒrÂrG¶‡ÒrÂG¶ƒÓÓÒu¢sòÓ¢ÓÒ–ÂwFF–æs£W‚—‚r—Ö’æ¦ö–â‚sÇ7â7G–ÆSÒ'v–GFƒ£g‚#ãÂ÷7ãâr—Ğ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£‡‚#ãÆ'WGFöâöæ6Æ–6³Ò'&–çFW$VÖW&vVæ7•7F÷‚rG¶–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Ãã"“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃc‚Ãc‚ÃãB“¶6öÆ÷#¢6fcCCCC¶&÷&FW"×&F—W3£wƒ·FF–æs£w‚'ƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶7W'6÷#§ö–çFW#·v–GFƒ£R#î)¹B&FFRVÖW&vVæ6–Âö'WGFöããÂöF—cà¢ÂÒÒ$4„•dõ2ÒÓà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Ö&v–âÖ&÷GFöÓ£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚ÒÖ66VçB’#ï	ù8"&6†—f÷2VâÆ–×&W6÷&Â÷7ãà¢Æ'WGFöâöæ6Æ–6³Ò&ÆöE&–çFW$f–ÆW2‚rG¶–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶6öÆ÷#§f"‚Ò×FW‡C"“¶&÷&FW"×&F—W3£gƒ·FF–æs£G‚ƒ¶föçB×6—¦S£ãWƒ¶7W'6÷#§ö–çFW"#î(k²6&v#Âö'WGFöãà¢ÂöF—cà¢ÆF—b–CÒ'4f–ÆW2"7G–ÆSÒ&Ö‚Ö†V–v‡C£cƒ¶÷fW&fÆ÷r×“¦WFó¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£‡‚#ãÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£'ƒ·FF–æs£‡‚#åVÇ6$6&v""&fW"Æ÷2rÖ6öFR’&V–×&–Ö—"ãÂöF—cãÂöF—cà¢ÂÒÒ„•5Dõ$”ÂÒÓà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Ö&v–âÖ&÷GFöÓ£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s¶ÆWGFW"×76–æs£ƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚ÒÖ66VçB’#ï	ù8¢†—7F÷&–Â&VÂ„Öööç&¶W"“Â÷7ãà¢Æ'WGFöâöæ6Æ–6³Ò&ÆöE&–çFW$†—7F÷'’‚rG¶–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶6öÆ÷#§f"‚Ò×FW‡C"“¶&÷&FW"×&F—W3£gƒ·FF–æs£G‚ƒ¶föçB×6—¦S£ãWƒ¶7W'6÷#§ö–çFW"#î(k²6&v#Âö'WGFöãà¢ÂöF—cà¢ÆF—b–CÒ'4†—7F÷'’"7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£G‚#ãÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£'ƒ·FF–æs£‡‚#åF–V×ò’f–ÆÖVçFò&VÆW2FR6FG&&¦ò(	B;§F–Â&6÷7F÷2ãÂöF—cãÂöF—cæ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&–çFW$6öçG&öÄÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6Æ÷6U&–çFW$6öçG&öÂ‚—¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&–çFW$6öçG&öÄÖöFÂr“¶–b†VÂ–VÂç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ ¢òò)H)HVWVRÖöFÂ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâ÷VåVWVTÖöFÂ†–B—°¢6öç7BÓÔÔT”ä2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚Ò—&WGW&ã°¢6öç7BÕ÷VWVTvWB†–B“°¢6öç7Bf×EF–ÖS×3Óç¶6öç7BƒÔÖF‚æfÆö÷"‡2ó3c’ÆÖãÔÖF‚æfÆö÷"‚‡2S3c’óc“·&WGW&âƒöG¶‡Ö‚G¶ÖçÖÖ¦G¶ÖçÖÖ·Ó°¢6öç7B&÷w3×æÖ‚†¢Æ’“Óæ ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£‡‚#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚ÒÖ66VçB“¶Ö–â×v–GFƒ£‡‚#â2G¶’³ÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚Ò×FW‡B“·v†—FR×76S¦æ÷w&¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—2#âG¶W66T‡FÖÂ†¢æf–ÆVæÖR—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#î(ûâG¶¢ç6V73öf×EF–ÖR†¢ç6V72“¢~(	BwÒ+r)©bâG¶¢æw&×3ö¢æw&×2çFôf—†VBƒ“¢~(	BwÖsÂöF—cà¢ÂöF—cà¢Æ'WGFöâöæ6Æ–6³Ò%÷VWVU&VÖ÷fR‚rG¶–GÒrÂG¶—Ò’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Ãã“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃc‚Ãc‚Ãã2“¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢6fcCCCC¶föçB×6—¦S£ãWƒ·FF–æs£7‚‡ƒ¶7W'6÷#§ö–çFW"#î)ÉSÂö'WGFöãà¢ÂöF—cæ’æ¦ö–â‚rr“°¢6öç7B&öG“×æÆVæwFƒöÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£g‚#âG·&÷w7ÓÂöF—cæ¦ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚Ò×FW‡C2“·FF–æs£#ƒ¶föçB×6—¦S£'‚#ä6öÆf<:ÖÂöF—cæ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wVWVTÖöFÅF—FÆRr’çFW‡D6öçFVçCÖ6öÆFR–×&W6œ;6â(	BG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÖ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wVWVTÖöFÄ&öG’r’æ–ææW$…DÔÃÖ&öG“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wVWVTÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6Æ÷6UVWVTÖöFÂ‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚wVWVTÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ¦gVæ7F–öâ÷VWVU&VÖ÷fR†–BÆ–G‚—°¢6öç7BÕ÷&–çEVWVU¶–EÓ¶–b‚—&WGW&ã°¢ç7Æ–6R†–G‚Ã“°¢&VæFW$Ööæ—F÷$w&–B‚“°¢–b‡æÆVæwFƒã–÷VåVWVTÖöFÂ†–B“¶VÇ6R6Æ÷6UVWVTÖöFÂ‚“°¢Fö7B‚uG&&¦òVÆ–Ö–æFòFRÆ6öÆrÂw7V66W72r“°§Ğ ¦gVæ7F–öâ÷6VæEvÆW'D–dVæ&ÆVB‡F—FÆRÆ&öG’—°¢–b†Æö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷vöVæ&ÆVBr’ÓÒsr—&WGW&ã°¢6öç7B†öæSÖÆö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷v÷†öæRr“¶–b‚†öæR—&WGW&ã°¢6VæEvF”ÖW76vR‡†öæRÆG·F—FÆWÕÆâG¶&öG—Ö’æ6F6‚‚‚“Óç·Ò“°§Ğ¢òòFV6–FR\:’†6W"6öâÆ6W6œ;6âFR–×&W6œ;6â6V|;¦âVÂW7FFò7GVÃ ¢òò÷VâÒ'&—"6W6œ;6âçVWf†V×W¬;2–×&–Ö—"’æò†,:ÖVæf—f¢òò6Æ÷6RÒ6W'&"Æ6W6œ;6â†ÆÆV|;2VâW7FFòFW&Ö–æÂ¢òò&W7VÇCÒt6ö×ÆWFFòrÂt6æ6VÆFòr7VæFò6Æ÷6P¢òòU4’Æ:—&F–FFRFVÆVÖWG,:Ö†öffÆ–æRö6öææV7F–ær÷7F'GW÷Væ¶æ÷vâöæö—’äğ¢òò'&Vâæ’6–W'&ã¢Æ–×&W6œ;6â6–wVRf—fÂ6öÆòW7L:W6FòæòÆW7FÖ÷0¢òòf–VæFòâ&VçVF"FW6FRW66öç6W'fVÂ–æ–6–ò&VÂ†æò&V'&RÆ6W6œ;6â’à¢òòçFW27VÇV–W"6Æ–FFRw&–çF–ærr6ÇfòvöffÆ–æRr6W'&&Æ6W6œ;6ã¢Væ¢òòW6‡&–çF–æ~(i'W6VB’6R&Vv—7G&&6öÖò$6æ6VÆFò"ÂW&L:ÖVÂ–æ–6–ò’ÂÀ¢òò6ö×ÆWF"Â6Æ7VÆ&ÆGW&6œ;6â6öÆòFW6FRÆ&VçVF6œ;6â(	B6÷'&ö×–VæFò†÷&0¢òòFRöL;6ÖWG&òöÖçFVæ6œ;6â’ÆWFö6Æ–'&6œ;6âFRF–V×òVRW6VÂ6÷F—¦F÷"à¦gVæ7F–öâ÷&–çE6W76–öä7F–öâ‡7BÆ†56W76–öâ—°¢6öç7BG&ç6—F÷&–ó×7CÓÓÒwW6VBwÇÇ7CÓÓÒvöffÆ–æRwÇÇ7CÓÓÒv–F÷vâwÇÇ7CÓÓÒv6öææV7F–ærwÇÇ7CÓÓÒw7F'GWwÇÇ7CÓÓÒwVæ¶æ÷vâwÇÇ7CÓÓÒvæö—s°¢6öç7B÷Vã×7CÓÓÒw&–çF–ærrbb†56W76–öã°¢6öç7B6Æ÷6SÖ†56W76–öâbg7BÓÒw&–çF–ærrbbG&ç6—F÷&–ó°¢&WGW&ç¶÷VâÆ6Æ÷6RÇ&W7VÇC¦6Æ÷6Sò‡7CÓÓÒv6ö×ÆWFRsòt6ö×ÆWFFòs¢t6æ6VÆFòr“¦çVÆÇÓ°§Ğ¦gVæ7F–öâ6†V6µG&ç6—F–öç2†ÒÇ2—°¢6öç7B&WcÕ÷&We7FFU¶Òæ–EÓ¶6öç7B7C×2ç7FFS°¢–b‡7CÓÓÒvW'&÷"rbg&WbÓÒvW'&÷"r—°¢6öç7BF—FÆSÖ)ªW'&÷"VâG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÖ°¢6VæD'&÷w6W$æ÷F–f–6F–öâ‡F—FÆRÂu&WV–W&RFVæ6œ;6âr“°¢6VæEvV&†öö´ÆW'B†ÒÂvW'&÷"r“°¢÷6VæEvÆW'D–dVæ&ÆVB‡F—FÆRÂu&WV–W&RFVæ6œ;6â–æÖVF–Fâr“°¢Ğ¢–b‡7CÓÓÒw6‡WFF÷vârbg&WbÓÒw6‡WFF÷vârbg&WbÓ×VæFVf–æVBbg&WbÓÒvöffÆ–æRr—°¢6öç7BF—FÆSÖ)ªG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÒ6RFWGWfò„¶Æ—W"–°¢6öç7BFWF–Ã×2æ¶Ä×6wÇÂtVÂf—&×v&RVçG,;2Vâ6‡WFF÷vââ&Wf—6Æ–×&W6÷&’&V–æ–6–VÂf—&×v&Râs°¢6VæD'&÷w6W$æ÷F–f–6F–öâ‡F—FÆRÆFWF–Â“°¢6VæEvV&†öö´ÆW'B†ÒÂw6‡WFF÷vâr“°¢÷6VæEvÆW'D–dVæ&ÆVB‡F—FÆRÆFWF–Â“°¢Ğ¢6öç7B7CÕ÷&–çE6W76–öä7F–öâ‡7BÂ÷6W76–öç5¶Òæ–EÒ“°¢–b†7Bæ÷Vâ•÷6W76–öç5¶Òæ–EÓ×¶f–ÆS§2æf–ÆVæÖRÇ7F'C¤FFRææ÷r‚’Æf–ÆÖVçE7F'C§2æf–ÆÖVçDÖ×ÇÃÓ°¢–b†7Bæ6Æ÷6R—°¢6öç7B6W73Õ÷6W76–öç5¶Òæ–EÓ°¢–b‡6W72—°¢6öç7BGW#ÔÖF‚ç&÷VæB‚„FFRææ÷r‚’×6W72ç7F'B’óc“°¢6öç7Bf–ÆÖVçDÖÓÔÖF‚æÖ‚ƒÂ‡2æf–ÆÖVçDÖ×ÇÃ’×6W72æf–ÆÖVçE7F'B“°¢6fT†—7F÷'”VçG'’†ÒÇ6W72æf–ÆRÇ6W72ç7F'BÄFFRææ÷r‚’ÆGW"Æ7Bç&W7VÇBÆf–ÆÖVçDÖÒ“°¢FVÆWFR÷6W76–öç5¶Òæ–EÓ°¢–b‡7CÓÓÒv6ö×ÆWFRr—°¢òòWFòÖ6Æ–'&"W7F–Ö6œ;6âFRF–V×ò÷"ÖöFVÆòFR–×&W6÷&¢6öç7BW7D¶W“Òw6ÅöÆ7EöW7E÷6V72s¶6öç7BW7E6V73×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ†W7D¶W’’“°¢–b†W7E6V73ãbfGW#ã—¶6öç7B&F–óÒ†GW"£c’öW7E6V73¶–b‡&F–óããBbg&F–óÃB—¶6öç7B6Ä¶W“Òw6Å÷F–ÖUö6Åòr²†ÒæÖöFVÆ÷ÇÂvFVfVÇBr“¶6öç7B&Wd6Ã×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ†6Ä¶W’’—ÇÃ¶Æö6Å7F÷&vRç6WD—FVÒ†6Ä¶W’Â‡&Wd6Â£ãsR·&F–ò£ã#R’çFôf—†VBƒB’“·×Ğ¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ†W7D¶W’“°¢6öç7BF—FÆSÖ)ÈRG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÒ6ö×ÆWFFö°¢6VæD'&÷w6W$æ÷F–f–6F–öâ‡F—FÆRÆG·6W72æf–ÆWÒ+rG¶GW'ÖÖ“°¢÷6VæEvÆW'D–dVæ&ÆVB‡F—FÆRÆ&6†—fó¢G·6W72æf–ÆWÒÂGW&6œ;6ã¢G¶GW'ÒÖ–æ“°¢–b…÷VWVT6÷VçB†Òæ–B“ã—6WEF–ÖV÷WB‚‚“Óå÷VWVU7F'DæW‡B†Òæ–B’Ã#“°¢Ğ¢Ğ¢Ğ¢÷&We7FFU¶Òæ–EÓ×7C°§Ğ ¦gVæ7F–öâ6fT†—7F÷'”VçG'’†ÒÆf–ÆRÇ7F'BÆVæBÆGW"Ç&W7VÇBÆf–ÆÖVçDÖÓÓ—°¢G'—¶6öç7BƒÔ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ„„•5Eô´U’—ÇÂuµÒr“¶‚çVç6†–gB‡¶–C¦Òæ–BÆæöÖ'&S¦ÒææöÖ'&RÆçVÔs¦ÒæçVÔrÆf–ÆRÇ7F'BÆVæBÆGW"Ç&W7VÇBÆf–ÆÖVçDÖÒÇG3¤FFRææ÷r‚—Ò“¶–b†‚æÆVæwFƒã#–‚ç7Æ–6Rƒ#“¶Æö6Å7F÷&vRç6WD—FVÒ„„•5Eô´U’Ä¥4ôâç7G&–æv–g’†‚’“·Ö6F6‚†R—·Ğ¢öFôFB†Òæ–BÂ†GW'ÇÃ’ócÆf–ÆÖVçDÖÒÇ&W7VÇCÓÓÒt6ö×ÆWFFòr“°§Ğ ¦gVæ7F–öâvWD†—7F÷'”f÷%&–çFW"†–B—·&WGW&âvWD†—7B‚’æf–ÇFW"†ƒÓæ‚æ–CÓÓÖ–B“·Ğ ¦gVæ7F–öâ&WVW7Dæ÷F–f–6F–öåW&Ö—76–öâ†ÖçVÂ—°¢–b‚‚tæ÷F–f–6F–öâv–âv–æF÷r’—&WGW&ã°¢–b„æ÷F–f–6F–öâçW&Ö—76–öãÓÓÒvFVfVÇBr”æ÷F–f–6F–öâç&WVW7EW&Ö—76–öâ‚’çF†Vâ‡Óç¶–b†ÖçVÂ—Fö7B‡ÓÓÒvw&çFVBsò	ùIBæ÷F–f–66–öæW27F—fF2s¢uW&Ö—6òFVæVvFòrÇÓÓÒvw&çFVBsòw7V66W72s¢vW'&÷"r“·Ò“°¢VÇ6R–b†ÖçVÂ—Fö7B„æ÷F–f–6F–öâçW&Ö—76–öãÓÓÒvw&çFVBsò	ùIBæ÷F–f–66–öæW2–7F—f2s¢uW&Ö—6òFVæVvFòrÄæ÷F–f–6F–öâçW&Ö—76–öãÓÓÒvw&çFVBsòw7V66W72s¢vW'&÷"r“°§Ğ ¦gVæ7F–öâ6VæD'&÷w6W$æ÷F–f–6F–öâ‡F—FÆRÆ&öG’—¶–b‚tæ÷F–f–6F–öâv–âv–æF÷rbdæ÷F–f–6F–öâçW&Ö—76–öãÓÓÒvw&çFVBr–æWræ÷F–f–6F–öâ‡F—FÆRÇ¶&öG—Ò“·Ğ ¦7–æ2gVæ7F–öâ6VæEvV&†öö´ÆW'B†ÒÆWfVçB—°¢6öç7BW&ÃÖÆö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷vV&†ööµ÷W&Âr“¶–b‚W&Â—&WGW&ã°¢G'—¶v—BfWF6‚‡W&ÂÇ¶ÖWF†öC¢uõ5BrÆ†VFW'3§²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öâwÒÆ&öG“¤¥4ôâç7G&–æv–g’‡¶ÖV–æ¦ÒææöÖ'&RÆçVÓ¦ÒæçVÔrÆWfVçFó¦WfVçBÇF–ÖW7F×¦æWrFFR‚’çFô•4õ7G&–ær‚—Ò—Ò“·Ö6F6‚†R—·Ğ§Ğ ¦7–æ2gVæ7F–öâ÷Vä&VDÖW6‚†–B—°¢6öç7BÓÔÔT”ä2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚Ò—&WGW&ã°¢6öç7B—ÖvWE&–çFW$—†Ò“¶–b‚——·Fö7B‚u6–â•6öæf–wW&FrÂvW'&÷"r“·&WGW&ã·Ğ¢Fö7B‚t6öç7VÇFæFò&VBÖW6(
brÂv–æfòr“°¢G'—°¢6öç7BFFÖv—BöÖööç&¶W$vWB†–BÂr÷&–çFW"öö&¦V7G2÷VW'“ö&VEöÖW6‚r“°¢6öç7BÖW6ƒÖFFòç&W7VÇCòç7FGW3òæ&VEöÖW6ƒ°¢–b‚ÖW6‡ÇÂÖW6‚ç&ö&VEöÖG&—‚—·Fö7B‚u6–âFF÷2FR&VBÖW6‚(	BV¦V7WF$TEôÔU4…ô4Ä”%$DR&–ÖW&òrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BÖG&—ƒÖÖW6‚ç&ö&VEöÖG&—ƒ°¢6öç7B&÷w3ÖÖG&—‚æÆVæwF‚Æ6öÇ3ÖÖG&—…³ÒæÆVæwFƒ°¢ÆWBÖãÓS’Æ×ƒÒÓS“°¢ÖG&—‚æf÷$V6‚‡#Óç"æf÷$V6‚‡cÓç¶–b‡cÆÖâ–Öã×c¶–b‡cæ×‚–×ƒ×c·Ò’“°¢6öç7B&ævSÖ×‚ÖÖçÇÃã°¢6öç7B6VÆÃÔÖF‚æÖ–âƒCBÄÖF‚æfÆö÷"ƒ3#ôÖF‚æÖ‚‡&÷w2Æ6öÇ2’’“°¢6öç7B7ft6VÆÇ3ÖÖG&—‚æÖ‚‡&÷rÇ&’“Óç&÷ræÖ‚‡bÆ6’“Óç°¢6öç7BCÒ‡bÖÖâ’÷&ævS°¢6öç7B'#ÔÖF‚ç&÷VæB‡B£##’ÆvsÔÖF‚ç&÷VæB‚ƒÔÖF‚æ'2‡BÓãR’£"’£ƒ’Æ&#ÔÖF‚ç&÷VæB‚ƒ×B’£##“°¢&WGW&æÇ&V7BƒÒ"G¶6’¦6VÆÇÒ"“Ò"G·&’¦6VÆÇÒ"v–GFƒÒ"G¶6VÆÂÓÒ"†V–v‡CÒ"G¶6VÆÂÓÒ"f–ÆÃÒ'&v"‚G·''ÒÂG¶vwÒÂG¶&'Ò’"'ƒÒ#2"óà£ÇFW‡BƒÒ"G¶6’¦6VÆÂ¶6VÆÂó'Ò"“Ò"G·&’¦6VÆÂ¶6VÆÂó"³GÒ"FW‡BÖæ6†÷#Ò&Ö–FFÆR"f–ÆÃÒ'&v&ƒ#SRÃ#SRÃ#SRÃã’’"föçB×6—¦SÒ"G´ÖF‚æÖ‚ƒrÆ6VÆÂóB—Ò"föçBÖfÖ–Ç“Ò&Ööæ÷76R#âG·bçFôf—†VBƒ"—ÓÂ÷FW‡Cæ°¢Ò’æ¦ö–â‚rr’’æ¦ö–â‚rr“°¢6öç7BsÖ6öÇ2¦6VÆÂÄƒ×&÷w2¦6VÆÃ°¢6öç7BÖöFÃÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢ÖöFÂç7G–ÆRæ775FW‡CÒw÷6—F–öã¦f—†VC¶–ç6WC£¶&6¶w&÷VæC§&v&ƒÃÃÃãs‚“·¢Ö–æFWƒ£““““¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW"s°¢ÖöFÂæ–ææW$…DÔÃÖÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW"×&F—W3£Gƒ·FF–æs£#ƒ¶Ö‚×v–GFƒ£“Wgs¶Ö‚Ö†V–v‡C£“fƒ¶÷fW&fÆ÷s¦WFó¶Ö–â×v–GFƒ£3#‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶Ö&v–âÖ&÷GFöÓ£Gƒ¶v£g‚#à¢ÆF—cà¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£s¶föçB×6—¦S£7ƒ¶Ö&v–âÖ&÷GFöÓ£G‚#ï	ù{®ûˆò&VBÖW6‚(	BG¶W66T‡FÖÂ†ÒææöÖ'&R—Ò2G¶ÒæçVÔwÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#äFW7f–6œ;6ã¢G¶ÖâçFôf—†VBƒ2—ÖÖÒ(
bG¶×‚çFôf—†VBƒ2—ÖÖÒfæ'7¼+rfæ'7²&ævó¢Æ#âG²‡&ævR£’çFôf—†VBƒ—Ü+VÓÂö#âfæ'7¼+rfæ'7²G·&÷w7Ü9rG¶6öÇ7ÒVçF÷3ÂöF—cà¢ÂöF—cà¢Æ'WGFöâöæ6Æ–6³Ò'F†—2æ6Æ÷6W7B‚u·7G–ÆR£Öf—†VEÒr’ç&VÖ÷fR‚’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£#ƒ¶7W'6÷#§ö–çFW#¶fÆW‚×6‡&–æ³£¶Æ–æRÖ†V–v‡C£#î)ÉSÂö'WGFöãà¢ÂöF—cà¢Ç7frv–GFƒÒ"GµwÒ"†V–v‡CÒ"G´‡Ò"7G–ÆSÒ&F—7Æ“¦&Æö6³¶&÷&FW"×&F—W3£‡ƒ¶÷fW&fÆ÷s¦†–FFVâ#âG·7ft6VÆÇ7ÓÂ÷7fsà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶F—7Æ“¦fÆWƒ¶v£‡ƒ¶Æ–vâÖ—FV×3¦6VçFW#¶föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#à¢ÆF—b7G–ÆSÒ'v–GFƒ£ƒƒ¶†V–v‡C£ƒ¶&6¶w&÷VæC¦Æ–æV"Öw&F–VçB‡Fò&–v‡BÇ&v"ƒÃ#Ã##’Ç&v"ƒÃƒÃ’Ç&v"ƒ##ÃÃ’“¶&÷&FW"×&F—W3£7ƒ¶fÆW‚×6‡&–æ³£#ãÂöF—cà¢Ç7ãçÆæòö&¦ò†§VÂ’(i"&öÖVF–ò‡fW&FR’(i"ÇFò‡&ö¦ò“Â÷7ãà¢ÂöF—cà¢G·&ævSããCöÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃsÃÃã“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃsÃÃãB“¶&÷&FW"×&F—W3£‡ƒ¶föçB×6—¦S£ãWƒ¶6öÆ÷#¢6ff#î)ª&ævòfwC³C+VÒ(	BÆ6ÖVVFRæV6W6—F"æ—fVÆ6œ;6âÖçVÂçFW2FRW6"ÖW6‚6ö×Vç6F–öãÂöF—cæ¢rwĞ¢ÂöF—cæ°¢ÖöFÂæöæ6Æ–6³ÖSÓç¶–b†RçF&vWCÓÓÖÖöFÂ–ÖöFÂç&VÖ÷fR‚“·Ó°¢Fö7VÖVçBæ&öG’æVæD6†–ÆB†ÖöFÂ“°¢Ö6F6‚†R—·Fö7B‚tW'&÷"6öç7VÇFæFò&VBÖW6ƒ¢r¶RæÖW76vRÂvW'&÷"r“·Ğ§Ğ¦gVæ7F–öâ÷VåvV&6ÔÖöFÂ†–B—°¢6öç7BÓÔÔT”ä2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚Ò—&WGW&ã°¢6öç7BW&ÃÖÆö6Å7F÷&vRævWD—FVÒ‚w&–çFW%ö6Õòr¶–B—ÇÂrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÅF—FÆRr’çFW‡D6öçFVçCÖG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÖ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÄ–Br’çfÇVSÖ–C°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÅW&Âr’çfÇVS×W&Ã°¢6öç7B–ÖsÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÄ–Örr“°¢6öç7BæcÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔæôfVVBr“°¢–b‡W&Â—¶6öç7B7S×&–çFW$6ÕW&Â†–B“¶–b…ö6Ô—56æ6†÷B‡W&Â’––Örç6WDGG&–'WFR‚vFF×6ærÆ7R“¶VÇ6R–Örç&VÖ÷fTGG&–'WFR‚vFF×6ær“¶–Örç7&3Ö7S¶–Örç7G–ÆRæF—7Æ“Òv&Æö6²s¶æbç7G–ÆRæF—7Æ“ÒvæöæRs·ÖVÇ6W¶–Örç&VÖ÷fTGG&–'WFR‚vFF×6ær“¶–Örç7&3Òrs¶–Örç7G–ÆRæF—7Æ“ÒvæöæRs¶æbç7G–ÆRæF—7Æ“ÒvfÆW‚s·Ğ¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÕFW7E7FGW2r“¶–b‡G2—G2çFW‡D6öçFVçCÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¢òòF–vì;77F–6òFR<:Ö&¢†6RÆWF–6œ;6â$TÂ†G&l:—2FVÂL;¦æVÂö'&–FvRVà¢òòÖöFò&VÖ÷Fò’’G&GV6RVÂ&W7VÇFFòVâÖVç6¦R6Æ&ò(	B<:Ò6R6&R6’VÀ¢òò&ö&ÆVÖW2VÂFö¶VâÂVÂVW'FòÂVRvó''F2æò&W7öæFRÂòVÂæöÖ'&RFVÂ7G&VÒà¦7–æ2gVæ7F–öâFW7EvV&6Ò‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÅW&Âr“°¢6öç7B÷WCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÕFW7E7FGW2r“°¢–b‚–çÇÂ÷WB—&WGW&ã°¢6öç7B&sÒ†–ççfÇVWÇÂrr’çG&–Ò‚“°¢6öç7B6WCÒ†×6rÆ6öÂ“Óç¶÷WBçFW‡D6öçFVçCÖ×6s¶÷WBç7G–ÆRæ6öÆ÷#Ö6öÃ·Ó°¢–b‚&r—·6WB‚t–æw&W6VæU$Â&–ÖW&òârÂwf"‚Ò×v&â’r“·&WGW&ã·Ğ¢òòÖ—6Ö&VW67&—GW&VR&–çFW$6ÕW&Ã¢Vâ&VÖ÷Fòf÷"VÂ'&–FvR6öâVÂFö¶Vâà¢ÆWBW&Ã×&s°¢–b‚‡G—Vöbö—4Æö6ÄÖöFSÓÓÒvgVæ7F–öârbeö—4Æö6ÄÖöFR‚’’—°¢6öç7BÖÓ×&ræÖF6‚‚õæ‡GG¥ÂõÂò…ÆG³Ã7Òƒó¥ÂåÆG³Ã7Ò—³7Ò’ƒó£¢…ÆB²’“ò…Âòâ¢“òBò“°¢–b†ÖÒbgG—VöböVæD'&–FvUFö¶VãÓÓÒvgVæ7F–öâr’W&ÃÕöVæD'&–FvUFö¶Vâ†G¶vWE&–çFW%GVææVÂ‚—ÒòG¶ÖÕ³×Ó¢G¶ÖÕ³%×ÇÂsƒwÒG¶ÖÕ³5×ÇÂròwÖ“°¢Ğ¢6WB‚~(û2&ö&æFş(
brÂwf"‚Ò×FW‡C2’r“°¢6öç7B7G&ÃÖæWr&÷'D6öçG&öÆÆW"‚“¶6öç7BFó×6WEF–ÖV÷WB‚‚“Óæ7G&Âæ&÷'B‚’Ã#“°¢G'—°¢6öç7B#Öv—BfWF6‚‡W&ÂÇ¶ÖWF†öC¢ttUBrÆ66†S¢væò×7F÷&RrÇ6–væÃ¦7G&Âç6–væÇÒ“°¢G'—·"æ&öG’bg"æ&öG’æ6æ6VÂ‚“·Ö6F6‚…ò—·Ğ¢6öç7B7CÒ‡"æ†VFW'2ævWB‚v6öçFVçB×G—Rr—ÇÂrr’çFôÆ÷vW$66R‚“°¢–b‡"æö²bb†7Bæ–æ6ÇVFW2‚v–ÖvRr—ÇÆ7Bæ–æ6ÇVFW2‚v×VÇF—'Br’’’6WB‚~)É2<:Ö&ô²(	BW7L:VçG&VvæFòf–FVòârÂwf"‚Ò×7V66W72’r“°¢VÇ6R–b‡"æö²’6WB†)ª&W7öæFR#W&òæòW2–ÖvVâ‡F—ó¢G¶7GÇÂsòwÒ’â6’W2vó''F2Â&Wf—6VÂæöÖ'&RFVÂ7G&VÒ‡7&3Ş(
b’æÂwf"‚Ò×v&â’r“°¢VÇ6R–b‡"ç7FGW3ÓÓÓC’6WB‚~)ÉbC(	BFö¶VâFVÂ'&–FvR–çl:Æ–FòârÂwf"‚ÒÖFævW"’r“°¢VÇ6R–b‡"ç7FGW3ÓÓÓC2’6WB‚~)ÉbC2(	BVÂ'&–FvR&Æ÷V\;2W6RVW'Fò†w,:–vÆò%$”DtUõõ%E2’ârÂwf"‚ÒÖFævW"’r“°¢VÇ6R–b‡"ç7FGW3ÓÓÓCB’6WB‚~)ÉbCB(	B'WFò7G&VÒæòVæ6öçG&Fòâ&Wf—6ÆU$ÂòVÂ7&3ÒârÂwf"‚ÒÖFævW"’r“°¢VÇ6R–b‡"ç7FGW3ÓÓÓS'ÇÇ"ç7FGW3ÓÓÓSB’6WB†)ÉbG·"ç7FGW7Ò(	BVÂ'&–FvRæòVFò6öæV7F"6öâÆ<:Ö&¢vó''F2æò&W7öæFRVâW6•§VW'FòŒ+övFòÂ•WV—fö6FÂò<:Ö&öfbÂFW&Ö–æ"Æ–×&W6œ;6ãò’æÂwf"‚ÒÖFævW"’r“°¢VÇ6R6WB†)ÉbG·"ç7FGW7ÒG·"ç7FGW5FW‡GÇÂrwÖçG&–Ò‚’Âwf"‚ÒÖFævW"’r“°¢Ö6F6‚†R—°¢–b†RææÖSÓÓÒt&÷'DW'&÷"r’6WB‚~)Éb6–â&W7VW7Fƒ'2’(	BVÂ'&–FvRòÆ<:Ö&æò6öçFW7F&öâârÂwf"‚ÒÖFævW"’r“°¢VÇ6R6WB‚~)Ébæò6RVFò6öæV7F#¢'&–FvR6:ÖFòÂ6–â&VBÂò&Æ÷VVòFVÂæfVvF÷"â‚r²†RæÖW76vWÇÂvW'&÷"r’²r’rÂwf"‚ÒÖFævW"’r“°¢Öf–æÆÇ—¶6ÆV%F–ÖV÷WB‡Fò“·Ğ§Ğ¦gVæ7F–öâ6fUvV&6ÕW&Â‚—¶6öç7B–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÄ–Br’çfÇVS¶6öç7BW&ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÅW&Âr’çfÇVRçG&–Ò‚“¶–b‡W&Âbb÷6fU&–çFW$ÖVF–W&Â‡W&Â’—·Fö7B‚uU$ÂFRvV&6Ò–çl:Æ–F(	BW6‡GG¢òòò‡GG3¢òòrÂvW'&÷"r“·&WGW&ã·Ö–b‡W&Â–Æö6Å7F÷&vRç6WD—FVÒ‚w&–çFW%ö6Õòr¶–BÇW&Â“¶VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚w&–çFW%ö6Õòr¶–B“¶6öç7BÓÔÔT”ä2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b†Ò—¶Òæ6Ó×W&ÇÇÆçVÆÃ¶–b†Òåö—'F&ÆT–B—¶–b††4—'F&ÆT66W72‚’•öDfWF6‚†òG´$4Uô”GÒôÖV–æ2òG¶Òåö—'F&ÆT–GÖÇ¶ÖWF†öC¢uD4‚rÆ†VFW'3§²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öâwÒÆ&öG“¤¥4ôâç7G&–æv–g’‡¶f–VÆG3§¶6Ó§W&ÇÇÂrw×Ò—Ò“·×Ö6Æ÷6UvV&6ÔÖöFÂ‚“·&VæFW$Ööæ—F÷$w&–B‚“·Fö7B‡W&Ãò	ù;rvV&6Ò6öæf–wW&F(	BwV&FFVâ—'F&ÆRs¢uvV&6ÒVÆ–Ö–æFrÂw7V66W72r“·Ğ¦gVæ7F–öâ6Æ÷6UvV&6ÔÖöFÂ‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs¶6öç7Bv“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wvV&6ÔÖöFÄ–Örr“¶–b‡v’—·v’ç&VÖ÷fTGG&–'WFR‚vFF×6ær“·v’ç7&3Òrs·×Ğ ¦gVæ7F–öâ÷Vä†—7F÷'”ÖöFÂ†–B—°¢6öç7BÓÔÔT”ä2æf–æB‡ƒÓç‚æ–CÓÓÖ–B“¶–b‚Ò—&WGW&ã°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†—7DÖöFÅF—FÆRr’çFW‡D6öçFVçCÖG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÖ°¢6öç7B†—7CÖvWD†—7F÷'”f÷%&–çFW"†–B“°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v†—7DÖöFÄ&öG’r“°¢VÂæ–ææW$…DÔÃÖ†—7BæÆVæwFƒö†—7Bç6Æ–6RƒÃS’æÖ†ƒÓç¶6öç7BCÖæWrFFR†‚ç7F'B“·&WGW&æÆF—b7G–ÆSÒ'FF–æs£‡‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‚#à¢Ç7â7G–ÆSÒ&&6¶w&÷VæC¢G¶‚ç&W7VÇCÓÓÒt6ö×ÆWFFòsòw&v&ƒÃ#"ÃsÃãR’s¢w&v&ƒ#SRÃc‚Ãc‚Ãã"’wÓ¶6öÆ÷#¢G¶‚ç&W7VÇCÓÓÒt6ö×ÆWFFòsòr3CFs¢r6fcCCCBwÓ¶&÷&FW"×&F—W3£Wƒ·FF–æs£'‚wƒ¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶fÆW‚×6‡&–æ³£#âG¶‚ç&W7VÇGÓÂ÷7ãà¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#ãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚Ò×FW‡B“·v†—FR×76S¦æ÷w&¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—2#âG¶W66T‡FÖÂ†‚æf–ÆWÇÂ~(	Br—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶BçFôÆö6ÆTFFU7G&–ær‚vW2Ô4Âr—ÒG¶BçFôÆö6ÆUF–ÖU7G&–ær‚vW2Ô4ÂrÇ¶†÷W#¢s"ÖF–v—BrÆÖ–çWFS¢s"ÖF–v—BwÒ—Ò+rG¶‚æGW'ÖÓÂöF—cãÂöF—cà¢ÂöF—cæ·Ò’æ¦ö–â‚rr“¢sÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚Ò×FW‡C2“·FF–æs£#Gƒ¶föçB×6—¦S£'‚#å6–â†—7F÷&–Â&Vv—7G&Fò;¦ãÂöF—câs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†—7DÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6Æ÷6T†—7F÷'”ÖöFÂ‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†—7DÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ ¦gVæ7F–öâ÷VäÆW'E6WGF–æw2‚—°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'EvV&†ööµW&Âr’çfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷vV&†ööµ÷W&Âr—ÇÂrs°¢6öç7BwÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'Ev†öæRr“¶6öç7Bv3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'EvVæ&ÆVBr“°¢–b‡w—wçfÇVSÖÆö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷v÷†öæRr—ÇÂrs°¢–b‡v2—v2æ6†V6¶VCÖÆö6Å7F÷&vRævWD—FVÒ‚vÖöæ—F÷%÷vöVæ&ÆVBr“ÓÓÒss°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'E6WGF–æw4ÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6fTÆW'E6WGF–æw2‚—°¢6öç7BW&ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'EvV&†ööµW&Âr’çfÇVRçG&–Ò‚“°¢–b‡W&Â–Æö6Å7F÷&vRç6WD—FVÒ‚vÖöæ—F÷%÷vV&†ööµ÷W&ÂrÇW&Â“¶VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vÖöæ—F÷%÷vV&†ööµ÷W&Âr“°¢6öç7BwÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'Ev†öæRr“¶6öç7Bv3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'EvVæ&ÆVBr“°¢–b‡w—¶6öç7Bƒ×wçfÇVRçG&–Ò‚“¶–b‡‚–Æö6Å7F÷&vRç6WD—FVÒ‚vÖöæ—F÷%÷v÷†öæRrÇ‚“¶VÇ6RÆö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vÖöæ—F÷%÷v÷†öæRr“·Ğ¢–b‡v2–Æö6Å7F÷&vRç6WD—FVÒ‚vÖöæ—F÷%÷vöVæ&ÆVBrÇv2æ6†V6¶VCòss¢sr“°¢Fö7B‚tÆW'F2wV&FF2)É2rÂw7V66W72r“¶6Æ÷6TÆW'E6WGF–æw2‚“°§Ğ¦gVæ7F–öâ6Æ÷6TÆW'E6WGF–æw2‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆW'E6WGF–æw4ÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ ¢òò)H)H4õ%Bb´”õ4²)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦ÆWB÷6÷'D'•7FFS×G'VRÅö¶–÷6´ÖöFSÖfÇ6S°¦gVæ7F–öâ7FFT÷&FW"‡2—·&WGW&ç·&–çF–æs£ÇW6VC£ÆW'&÷#£"Æ–F÷vã£2Æ6ö×ÆWFS£BÇ7FæF'“£RÆöffÆ–æS£bÆæö—£wÕ·5Óóóƒ·Ğ¦gVæ7F–öâ6÷'FVDÆ—7B†Æ—7F—¶–b‚÷6÷'D'•7FFR—&WGW&âÆ—7F·&WGW&å²ââæÆ—7FÒç6÷'B‚†Æ"“Óç7FFT÷&FW"‚…÷&–çFW%7FGW5¶æ–E×ÇÇ·Ò’ç7FFWÇÂvöffÆ–æRr’×7FFT÷&FW"‚…÷&–çFW%7FGW5¶"æ–E×ÇÇ·Ò’ç7FFWÇÂvöffÆ–æRr’“·Ğ¦gVæ7F–öâFövvÆU6÷'B‚—µ÷6÷'D'•7FFSÒ÷6÷'D'•7FFS¶6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v'Få6÷'Br“¶–b†'Fâ–'Fâç7G–ÆRæ6öÆ÷#Õ÷6÷'D'•7FFSòwf"‚ÒÖ66VçB’s¢wf"‚Ò×FW‡C2’s·&VæFW$Ööæ—F÷$w&–B‚“·Ğ¦gVæ7F–öâFövvÆT¶–÷6²‚—°¢ö¶–÷6´ÖöFSÒö¶–÷6´ÖöFS°¢–b…ö¶–÷6´ÖöFR—¶Fö7VÖVçBæFö7VÖVçDVÆVÖVçBç&WVW7DgVÆÇ67&VVãòâ‚“¶Fö7VÖVçBæ&öG’æ6Æ74Æ—7BæFB‚v¶–÷6²r“·Ğ¢VÇ6W¶Fö7VÖVçBæW†—DgVÆÇ67&VVãòâ‚“¶Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bç&VÖ÷fR‚v¶–÷6²r“·Ğ¢&VæFW$Ööæ—F÷$w&–B‚“°§Ğ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚vgVÆÇ67&VVæ6†ævRrÂ‚“Óç¶–b‚Fö7VÖVçBægVÆÇ67&VVäVÆVÖVçBbeö¶–÷6´ÖöFR—µö¶–÷6´ÖöFSÖfÇ6S¶Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bç&VÖ÷fR‚v¶–÷6²r“·&VæFW$Ööæ—F÷$w&–B‚“·×Ò“° ¢òò)H)H”DÄRÄU%B)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦6öç7BöÆ7D7F—fUF–ÖS×·ÒÅö–FÆTÆW'FVC×·Ó°¦gVæ7F–öâvWD–FÆT†÷W'2†–BÇ7FFR—°¢–b‡7FFSÓÓÒw&–çF–ærwÇÇ7FFSÓÓÒwW6VBwÇÇ7FFSÓÓÒvöffÆ–æRwÇÇ7FFSÓÓÒvæö—r—&WGW&â°¢6öç7BÆ7CÕöÆ7D7F—fUF–ÖU¶–EÓ¶–b‚Æ7B—&WGW&â°¢6öç7BF‡&W6†öÆC×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ‚v–FÆUöÆW'Eö†÷W'2r—ÇÂs"r“°¢6öç7BƒÒ„FFRææ÷r‚’ÖÆ7B’ó3c°¢&WGW&âƒã×F‡&W6†öÆCôÖF‚ç&÷VæB†‚“£°§Ğ¦gVæ7F–öâ6†V6´–FÆTÆW'G2‚—°¢6öç7Bæ÷sÖæWrFFR‚“¶6öç7BƒÖæ÷rævWD†÷W'2‚“°¢6öç7B—5v÷&³ÖƒãÓ‚bfƒÃ’bfæ÷rævWDF’‚“ãbfæ÷rævWDF’‚“Ãc°¢ÔT”ä2æf÷$V6‚†ÓÓç°¢6öç7B7CÒ…÷&–çFW%7FGW5¶Òæ–E×ÇÇ·Ò’ç7FFWÇÂvöffÆ–æRs°¢–b‡7CÓÓÒw&–çF–ærwÇÇ7CÓÓÒwW6VBr—µöÆ7D7F—fUF–ÖU¶Òæ–EÓÔFFRææ÷r‚“¶FVÆWFRö–FÆTÆW'FVE¶Òæ–EÓ·Ğ¢VÇ6R–b†—5v÷&²beöÆ7D7F—fUF–ÖU¶Òæ–EÒbbö–FÆTÆW'FVE¶Òæ–EÒ—°¢6öç7B–FÆTƒÒ„FFRææ÷r‚’ÕöÆ7D7F—fUF–ÖU¶Òæ–EÒ’ó3c°¢6öç7BF‡&W6†öÆC×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ‚v–FÆUöÆW'Eö†÷W'2r—ÇÂs"r“°¢–b†–FÆTƒã×F‡&W6†öÆB—·6VæD'&÷w6W$æ÷F–f–6F–öâ†	ù*BG¶ÒææöÖ'&WÒ2G¶ÒæçVÔwÒÆÆWfG´ÖF‚ç&÷VæB†–FÆT‚—Ö‚6–â–×&–Ö—&ÂtÜ:V–æ–æ7F—fVâ†÷&&–òÆ&÷&Âr“·6VæEvV&†öö´ÆW'B†ÒÂv–FÆRr“µö–FÆTÆW'FVE¶Òæ–EÓ×G'VS·Ğ¢Ğ¢Ò“°§Ğ ¢òò)H)HÔåDTä”Ô”TåDò)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦6öç7BÔ”åEô´U“Òw&–çFW%öÖ–çE÷crÄÔ”åEô4duô´U“Òw&–çFW%öÖ–çEö6frrÄd”ÄÔTåEô4õ5Eô´U“Òvf–ÆÖVçEö6÷7Eö6Çs°¢òòW6òFVÂf–ÆÖVçFò6V|;¦âÖFW&–Â’Fœ:ÖWG&ò†6öæf–wW&&ÆRVâVÖ'&ÆW2FRÖçFVæ6œ;6â’à¢òòFWgVVÇfR¶r÷"ÖÒFRf–ÆÖVçFòW‡G'V–Fòâ÷"FVfV7FòÄãsRÖÒ(˜‚ã#“ƒ"¶röÖÒà¦6öç7Bd”ÄÔTåEôDTå4•E“×µÄ£ã#BÅUDs£ã#rÄ%3£ãBÄ4£ãrÅES£ã#Äç–Æöã£ãGÓ°¦gVæ7F–öâvWDf–ÆÖVçD¶uW$ÖÒ‚—°¢6öç7BFVç3Ôd”ÄÔTåEôDTå4•E•¶Æö6Å7F÷&vRævWD—FVÒ‚vf–ÆÖVçEöÖFW&–Âr—ÇÂuÄu×ÇÃã#C²òòrö6Ü+0¢6öç7BF–×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ‚vf–ÆÖVçEöF–ÖWFW"r—ÇÂsãsRr—ÇÃãsS²òòÖĞ¢6öç7B&VÔÖF‚å’¢†F–ó"’¢†F–ó"“²òòÖÜ+ ¢&WGW&â&V¦FVç2óSc²òò¶röÖĞ§Ğ¦6öç7BÔ”åEõE•U3Õ°¢¶¶W“¢væ÷§¦ÆRrÆÆ&VÃ¢tæ÷§¦ÆRrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâÖçWB"óãÂ÷7fsârÆFVfVÇD†÷W'3£#ÒÀ¢¶¶W“¢vÇV'&–6F–öârÆÆ&VÃ¢tÇV'&–66œ;6ârÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâÖG&÷ÆWB"óãÂ÷7fsârÆFVfVÇD†÷W'3£ÒÀ¢¶¶W“¢v&VÇBrÆÆ&VÃ¢t6÷'&VrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×6WGF–æw2"óãÂ÷7fsârÆFVfVÇD†÷W'3£SÒÀ¢¶¶W“¢vW‡G'VFW"rÆÆ&VÃ¢tW‡G'W6÷"rÆ–6öã¢~)©ûˆòrÆFVfVÇD†÷W'3£3ÒÀ¢¶¶W“¢v&VBrÆÆ&VÃ¢t6Öò7WW&f–6–RrÆ–6öã¢~)jbrÆFVfVÇD†÷W'3£#SÒÀ¢¶¶W“¢w6Vç6÷'2rÆÆ&VÃ¢u6Vç6÷&W2òVÌ:–7G&–6òrÆ–6öã¢~)ªrÆFVfVÇD†÷W'3£cÒÀ¢¶¶W“¢vvVæW&ÂrÆÆ&VÃ¢tvVæW&ÂrÆ–6öã¢sÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ#B"†V–v‡CÒ#B"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×w&Væ6‚"óãÂ÷7fsârÆFVfVÇD†÷W'3£SÒÀ¥Ó°¦gVæ7F–öâvWDÖ–çD6öæf–r‚—·G'—·&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ„Ô”åEô4duô´U’—ÇÂw·Òr“·Ö6F6‚†R—·&WGW&ç·Ó·×Ğ¦gVæ7F–öâvWDÖ–çEF‡&W6†öÆB‡F—òÆÖV–æ–B—°¢–b†ÖV–æ–Bbgv–æF÷räÖ6†–æT÷3òæÖ–çFVææ6UF‡&W6†öÆB—°¢6öç7B7V6–f–3×v–æF÷räÖ6†–æT÷2æÖ–çFVææ6UF‡&W6†öÆB†ÖV–æ–BÇF—ò“°¢–b‡7V6–f–3ã—&WGW&â7V6–f–3°¢Ğ¢6öç7B6fsÖvWDÖ–çD6öæf–r‚“·&WGW&â'6T–çB†6fu·F—õÒ—ÇÄÔ”åEõE•U2æf–æB‡CÓçBæ¶W“ÓÓ×F—ò“òæFVfVÇD†÷W'7ÇÃ°§Ğ¦gVæ7F–öâvWDÖ–çDÆör‚—·&WGW&âÖV–æ7FFRæÖ–çDÆöræÆVæwFƒöÖV–æ7FFRæÖ–çDÆös¦vWDÖ–çDÆötÆö6Â‚“·Ğ¦gVæ7F–öâvWE&–çD†÷W'2†–B—¶–b…÷W6TöFöÖWFW"‚’—&WGW&â†vWDöFöÖWFW"‚•¶–E×ÇÇ·Ò’æ†÷W'7ÇÃ·&WGW&âvWD†—7B‚’æf–ÇFW"‡ƒÓç‚æ–CÓÓÖ–Bbg‚ç&W7VÇCÓÓÒt6ö×ÆWFFòr’ç&VGV6R‚‡2Ç‚“Óç2²‡‚æGW'ÇÃ’ócÃ“·Ğ¦gVæ7F–öâvWD†÷W'56–æ6TÖ–çB†–BÇF—ò—°¢6öç7BÆösÖvWDÖ–çDÆör‚’æf–ÇFW"‡ƒÓç‚æÖV–æ–CÓÓÖ–Bbg‚çF—óÓÓ×F—ò’ç6÷'B‚†Æ"“Óæ"çG2ÖçG2“°¢6öç7BF÷FÃÖvWE&–çD†÷W'2†–B“°¢–b‚ÆöræÆVæwF‚—&WGW&âF÷FÃ°¢&WGW&âÖF‚æÖ‚ƒÇF÷FÂÖÆöu³Òç&–çD†÷W'4EF–ÖR“°§Ğ¦gVæ7F–öâvWDÖ–çDÆW'G2†Ò—°¢&WGW&âÔ”åEõE•U2æf–ÇFW"‡CÓævWD†÷W'56–æ6TÖ–çB†Òæ–BÇBæ¶W’“ãÖvWDÖ–çEF‡&W6†öÆB‡Bæ¶W’ÆÒæ–B’£ã’¢æÖ‡CÓâ‡²ââçBÆ†÷W'3¦vWD†÷W'56–æ6TÖ–çB†Òæ–BÇBæ¶W’’ÇF‡&W6†öÆC¦vWDÖ–çEF‡&W6†öÆB‡Bæ¶W’ÆÒæ–B—Ò’“°§Ğ¢òò&—FÖòFR–×&W6œ;6â†‚÷6VÖæ’FRÆ2;¦ÇF–Ö2B6VÖæ2Â&&÷–V7F"ÖçFVæ6œ;6à¦gVæ7F–öâvWEvVV¶Ç•&–çE&FR†–B—°¢6öç7B7WCÔFFRææ÷r‚’Ó#‚£ƒcC·&WGW&âvWD†—7B‚’æf–ÇFW"‡ƒÓç‚æ–CÓÓÖ–Bbg‚ç&W7VÇCÓÓÒt6ö×ÆWFFòrbb‡‚çG7ÇÇ‚æVæGÇÃ“ãÖ7WB’ç&VGV6R‚‡2Ç‚“Óç2²‡‚æGW'ÇÃ’ócÃ’óC°§Ğ¢òòÖçFVæ6œ;6âÜ:2,;7†–ÖfVæ6W"Â6öâUDVâ6VÖæ26V|;¦âVÂ&—FÖòFRW6ğ¦gVæ7F–öâvWDÖ–çDf÷&V67B†Ò—°¢6öç7B&FSÖvWEvVV¶Ç•&–çE&FR†Òæ–B“¶ÆWB6ööæW7CÖçVÆÃ°¢Ô”åEõE•U2æf÷$V6‚‡CÓç°¢6öç7BÆVgCÖvWDÖ–çEF‡&W6†öÆB‡Bæ¶W’ÆÒæ–B’ÖvWD†÷W'56–æ6TÖ–çB†Òæ–BÇBæ¶W’“°¢6öç7BvVV·3ÖÆVgCÃÓó¢‡&FSãöÆVgB÷&FS¤–æf–æ—G’“°¢–b‚6ööæW7GÇÇvVV·3Ç6ööæW7BçvVV·2—6ööæW7C×·F—ó§BæÆ&VÂÆ¶W“§Bæ¶W’Æ†÷W'4ÆVgC¦ÆVgBÇvVV·2Ç&FWÓ°¢Ò“°¢&WGW&â6ööæW7C°§Ğ¦gVæ7F–öâvWEF÷FÄf–ÆÖVçD¶r†–B—°¢6öç7BÖÓÕ÷W6TöFöÖWFW"‚“ò‚†vWDöFöÖWFW"‚•¶–E×ÇÇ·Ò’æf–ÆÖVçDÖ×ÇÃ“¦vWD†—7B‚’æf–ÇFW"‡ƒÓç‚æ–CÓÓÖ–B’ç&VGV6R‚‡2Ç‚“Óç2²‡‚æf–ÆÖVçDÖ×ÇÃ’Ã“·&WGW&âÖÒ¦vWDf–ÆÖVçD¶uW$ÖÒ‚“·Ğ¦gVæ7F–öâvWDf–ÆÖVçD6÷7B†–B—¶6öç7B¶sÖvWEF÷FÄf–ÆÖVçD¶r†–B“¶6öç7B6÷7C×'6TfÆöB†Æö6Å7F÷&vRævWD—FVÒ„d”ÄÔTåEô4õ5Eô´U’—ÇÂsr“·&WGW&âÖF‚ç&÷VæB†¶r¦6÷7B“·Ğ ¦gVæ7F–öâ&VæFW$Ö–çFVææ6UF&ÆR‚—°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–çEF&ÆRr“¶–b‚VÂ—&WGW&ã°¢ÆWBF÷DƒÓÇF÷D¶sÓÇF÷D6÷7CÓÇF÷E&–çG3ÓÇF÷DÆW'G3Ó²òò7V×VÆF÷&W2FRfÆ÷F¢6öç7B&÷w3ÔÔT”ä2æÖ†ÓÓç°¢6öç7BƒÖvWE&–çD†÷W'2†Òæ–B“°¢6öç7BF÷FÄƒ×‚çFôf—†VBƒ“°¢6öç7Bf–Ä¶tãÖvWEF÷FÄf–ÆÖVçD¶r†Òæ–B“¶6öç7Bf–Ä¶sÖf–Ä¶tâçFôf—†VBƒ2“°¢6öç7Bf–Ä6÷7CÖvWDf–ÆÖVçD6÷7B†Òæ–B“°¢6öç7B&–çG3Ò†vWDöFöÖWFW"‚•¶Òæ–E×ÇÇ·Ò’ç&–çG7ÇÃ°¢òòVæ6öÆ6F÷"VÂÆörFRÖçFVæ6œ;6âFRÆÜ:V–æ†Wf—Fã"&V<:Æ7VÆ÷2¢6öç7BÔÆösÖvWDÖ–çDÆör‚’æf–ÇFW"‡ƒÓç‚æÖV–æ–CÓÓÖÒæ–B“°¢6öç7BW%G—SÔÔ”åEõE•U2æÖ‡CÓç°¢6öç7BÃÖÔÆöræf–ÇFW"‡ƒÓç‚çF—óÓÓ×Bæ¶W’’ç6÷'B‚†Æ"“Óæ"çG2ÖçG2“¶6öç7BÆ7CÖÅ³Ó°¢6öç7BƒÖÆ7CôÖF‚æÖ‚ƒÇ‚ÖÆ7Bç&–çD†÷W'4EF–ÖR“§ƒ¶6öç7BF‡&W6ƒÖvWDÖ–çEF‡&W6†öÆB‡Bæ¶W’ÆÒæ–B“°¢&WGW&ç·BÆ‚ÇF‡&W6‚ÆÆ7BÇ7C§F‡&W6ƒãö‚÷F‡&W6ƒ£Ó°¢Ò“°¢6öç7BÆW'G4ã×W%G—Ræf–ÇFW"‡Óçç7CãÓã’’æÆVæwFƒ°¢F÷D‚³×ƒ·F÷D¶r³Öf–Ä¶tã·F÷D6÷7B³Öf–Ä6÷7C·F÷E&–çG2³×&–çG3·F÷DÆW'G2³ÖÆW'G4ã°¢6öç7B6†—3×W%G—RæÖ‚‡·BÆ‚ÇF‡&W6‚ÆÆ7BÇ7GÒ“Óç°¢6öç7Bö³×7CÃã’Æ÷fW#×7CãÓ°¢6öç7BÆ7E7G#ÖÆ7CõôEDeôDÒæf÷&ÖB†æWrFFR†Æ7BçG2’“¢w6–â&Vrâs°¢6öç7B7FGW4–6öãÖ÷fW#ò~)ªs¦ö³ò~)É2s¢wâs°¢&WGW&æÇ7âF—FÆSÒ"G·BæÆ&VÇÓ¢G¶‚çFôf—†VBƒ—Ö‚òG·F‡&W6‡Ö‚‚G´ÖF‚ç&÷VæB‡7B£—ÒR’+r9¦ÇF–Öó¢G¶Æ7E7G'Ò"7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖfÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£7ƒ¶&6¶w&÷VæC¢G¶÷fW#òw&v&ƒ#SRÃc‚Ãc‚ÃãR’s§7CãÓã“òw&v&ƒ#SRÃsÃÃãR’s¦Æ7Còw&v&ƒÃ#"ÃsÃã"’s¢w&v&ƒ#SRÃ#SRÃ#SRÃãB’wÓ¶6öÆ÷#¢G¶÷fW#òr6fcCCCBs§7CãÓã“òr6ffs¦Æ7Còr3CFs¢wf"‚Ò×FW‡C2’wÓ¶&÷&FW#£‚6öÆ–BG¶÷fW#òw&v&ƒ#SRÃc‚Ãc‚Ãã2’s§7CãÓã“òw&v&ƒ#SRÃsÃÃã2’s¦Æ7Còw&v&ƒÃ#"ÃsÃã#R’s¢wf"‚ÒÖ&÷&FW#"’wÓ¶&÷&FW"×&F—W3£Wƒ·FF–æs£'‚gƒ¶föçB×6—¦S£ƒ¶föçB×vV–v‡C£s#âG·Bæ–6öçÒG·7FGW4–6öçÒÇ7â7G–ÆSÒ&föçB×vV–v‡C£C¶÷6—G“£ãƒR#âG´ÖF‚ç&÷VæB‡7B£—ÒSÂ÷7ããÂ÷7ãæ°¢Ò’æ¦ö–â‚rr“°¢6öç7Bv3ÔÔôä•Dõ%ôu%Uõ2æf–æB†sÓæræ¶W“ÓÓÖÒæÖöFVÆò“°¢6öç7BÆW'G3×¶ÆVæwFƒ¦ÆW'G4çÓ°¢6öç7B&FSÖvWEvVV¶Ç•&–çE&FR†Òæ–B“¶ÆWBf3ÖçVÆÃ°¢W%G—Ræf÷$V6‚‡Óç¶6öç7BÆVgC×çF‡&W6‚×æƒ¶6öç7BvVV·3ÖÆVgCÃÓó¢‡&FSãöÆVgB÷&FS¤–æf–æ—G’“¶–b‚f7ÇÇvVV·3Æf2çvVV·2–f3×·F—ó§çBæÆ&VÂÆ†÷W'4ÆVgC¦ÆVgBÇvVV·2Ç&FWÓ·Ò“°¢ÆWBf4‡FÖÃ°¢–b‚f7ÇÂ†f2ç&FSÃÓbff2æ†÷W'4ÆVgCã’—¶6öç7BöF—7Ò‡G—VöbvWDÖV–æW7FFôvÆö&ÃÓÓÒvgVæ7F–öâsövWDÖV–æW7FFôvÆö&Â†Òæ–B“¢vF—7öæ–&ÆRr“ÓÓÒvF—7öæ–&ÆRs¶f4‡FÖÃÕöF—7öÇ7â7G–ÆSÒ&6öÆ÷#¢6ff¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£c"F—FÆSÒ$†&–Æ—FFW&ò6–â–×&W6–öæW26ö×ÆWFF2VâB6VÖæ2(	B66–FBö6–÷6#î)ª7V'WF–Æ—¦FÂ÷7ãæ¦Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãW‚"F—FÆSÒ%6–â–×&W6–öæW2&V6–VçFW2#ç6–âW6ò&V6–VçFSÂ÷7ãæ·Ğ¢VÇ6R–b†f2æ†÷W'4ÆVgCÃÓ–f4‡FÖÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢6fcCCCC¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s#î)ªG¶W66T‡FÖÂ†f2çF—ò—ÒfVæ6–FÂ÷7ãæ°¢VÇ6W¶6öç7BsÖf2çvVV·3¶6öç7B6öÃ×sÃòr6fcCCCBs§sÃ#òr6ffs¢r3CFs¶6öç7BÆ&Ã×sÃòvW7F6VÖæs§sÃ#öâG´ÖF‚ç&÷VæB‡r£r—ÒL:Ö6¦âG´ÖF‚ç&÷VæB‡r—Ò6VÖ¶f4‡FÖÃÖÇ7â7G–ÆSÒ&6öÆ÷#¢G¶6öÇÓ¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£c"F—FÆSÒ"G¶W66T‡FÖÂ†f2çF—ò—Ó¢fÇFâG¶f2æ†÷W'4ÆVgBçFôf—†VBƒ—Ö‚Â&—FÖòFRG¶f2ç&FRçFôf—†VBƒ—Ö‚÷6VÖæ#âG¶W66T‡FÖÂ†f2çF—ò—ÒVâG¶Æ&ÇÓÂ÷7ãâÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£‚#ì+rG¶f2ç&FRçFôf—†VBƒ—Ö‚÷6VÓÂ÷7ãæ·Ğ¢&WGW&æÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW#"’#à¢ÇFB7G–ÆSÒ'FF–æs£—‚ƒ¶föçB×6—¦S£'ƒ·v†—FR×76S¦æ÷w&#ãÇ7â7G–ÆSÒ&F—7Æ“¦–æÆ–æRÖ&Æö6³·v–GFƒ£‡ƒ¶†V–v‡C£‡ƒ¶&÷&FW"×&F—W3£SS¶&6¶w&÷VæC¢G¶v3òæ6öÆ÷'ÇÂr3ƒƒ‚wÓ¶Ö&v–â×&–v‡C£g‚#ãÂ÷7ããÆ#âG¶ÒææöÖ'&WÓÂö#âÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#â2G¶ÒæçVÔwÓÂ÷7ããÂ÷FCà¢ÇFB7G–ÆSÒ'FF–æs£—‚ƒ¶föçB×6—¦S£'ƒ·FW‡BÖÆ–vã¦6VçFW#¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚ÒÖ66VçB’#âG·F÷FÄ‡ÖƒÂ÷FCà¢ÇFB7G–ÆSÒ'FF–æs£—‚‚#ãÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£Gƒ¶fÆW‚×w&§w&#âG¶6†—7ÓÂöF—cãÂ÷FCà¢ÇFB7G–ÆSÒ'FF–æs£—‚ƒ·v†—FR×76S¦æ÷w&#âG¶f4‡FÖÇÓÂ÷FCà¢ÇFB7G–ÆSÒ'FF–æs£—‚ƒ¶föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“·v†—FR×76S¦æ÷w&#âG¶f–Ä¶wÖ¶rG¶f–Ä6÷7Cãö+rBG¶f–Ä6÷7BçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ö¢rwÒÂ÷FCà¢ÇFB7G–ÆSÒ'FF–æs£—‚‚#ãÆ'WGFöâöæ6Æ–6³Ò&÷VäÖ–çDÖöFÂ‚rG¶Òæ–GÒr’"7G–ÆSÒ&Ú±î¸Â¸­yêë¢°k¢G§¦*^background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10.5px;padding:4px 10px;cursor:pointer;white-space:nowrap" ${alerts.length?'style="border-color:rgba(255,170,0,0.5)"':''}>+ Registrar</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:700px">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">MÃ¡quina</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:center">Horas totales</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">Estado mantenciÃ³n</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left" title="ProyecciÃ³n segÃºn horas de impresiÃ³n de las Ãºltimas 4 semanas">PrÃ³xima mantenciÃ³n</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3);text-align:left">Filamento</th>
      <th style="padding:8px 10px;font-size:10.5px;color:var(--text3)"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border);background:var(--surface2)">
      <td style="padding:9px 10px;font-size:10.5px;font-weight:700;color:var(--text)">FLOTA Â· ${MAQUINAS.length} mÃ¡q.</td>
      <td style="padding:9px 10px;font-size:12px;text-align:center;font-weight:700;color:var(--accent)">${totH.toFixed(0)}h</td>
      <td style="padding:9px 10px;font-size:10.5px;color:${totAlerts>0?'#ffaa00':'var(--text3)'};font-weight:700">${totAlerts>0?`ğŸ”§ ${totAlerts} alerta${totAlerts>1?'s':''}`:'âœ“ sin alertas'}</td>
      <td style="padding:9px 10px;font-size:10.5px;color:var(--text3)">${totPrints} impresiones</td>
      <td style="padding:9px 10px;font-size:10.5px;color:var(--text3);white-space:nowrap;font-weight:700">${totKg.toFixed(2)}kg${totCost>0?` Â· $${totCost.toLocaleString('es-CL')}`:''}</td>
      <td></td>
    </tr></tfoot>
  </table></div>`;
}

function openMaintModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('maintModalId').value=id;
  document.getElementById('maintModalNombre').textContent=`${m.nombre} â€” MÃ¡quina #${m.numG}`;
  document.getElementById('maintModalNotas').value='';
  const partsEl=document.getElementById('maintModalParts');if(partsEl)partsEl.value='';
  document.getElementById('maintModal').style.display='flex';
}
function closeMaintModal(){document.getElementById('maintModal').style.display='none';}
async function saveMaintRecord(){
  const id=document.getElementById('maintModalId').value;
  const tipo=document.getElementById('maintModalTipo').value;
  const notas=document.getElementById('maintModalNotas').value.trim();
  const parts=document.getElementById('maintModalParts')?.value.trim()||'';
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const rec={maquinaId:id,nombre:m.nombre,numG:m.numG,tipo,notas,parts,printHoursAtTime:getPrintHours(id),ts:Date.now(),fecha:new Date().toISOString()};
  maquinaState.maintLog.unshift(rec);
  // guardar tambiÃ©n en localStorage como backup
  const local=getMaintLogLocal();local.unshift(rec);localStorage.setItem(MAINT_KEY,JSON.stringify(local.slice(0,200)));
  closeMaintModal();renderMaintenanceTable();renderMonitorGrid();
  toast(`ğŸ”§ MantenciÃ³n registrada Â· ${MAINT_TYPES.find(t=>t.key===tipo)?.label}`,'success');
  try{await saveMaintRecordAirtable(rec);}catch(e){console.warn('No se pudo guardar mantenciÃ³n en Airtable',e);}
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
  closeMaintConfig();renderMaintenanceTable();renderMonitorGrid();renderProductionAnalytics();toast('ConfiguraciÃ³n guardada âœ“','success');
}
function closeMaintConfig(){document.getElementById('maintConfigModal').style.display='none';}

// â”€â”€ ANALÃTICA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderProductionAnalytics(){
  const el=document.getElementById('analyticsContent');if(!el)return;
  const hist=getHist();
  if(!hist.length){el.innerHTML='<div style="color:var(--text3);font-size:12px;padding:20px;text-align:center">Sin datos aÃºn â€” el historial se generarÃ¡ automÃ¡ticamente cuando las impresoras estÃ©n conectadas</div>';return;}
  const kgPerMm=getFilamentKgPerMm();

  // Impresiones Ãºltimas 7 dÃ­as
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
      <div class="kpi-card" title="Peso calculado con ${localStorage.getItem('filament_material')||'PLA'} de ${localStorage.getItem('filament_diameter')||'1.75'} mm (configurable en Umbrales de mantenciÃ³n)"><div class="kpi-label">Filamento total Â· ${localStorage.getItem('filament_material')||'PLA'} ${localStorage.getItem('filament_diameter')||'1.75'}mm</div><div class="kpi-value">${totalFilKg}kg</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
      <div class="card" style="padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">IMPRESIONES POR DÃA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.count/maxCount*76,d.count>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:var(--accent);border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.count>0?4:1}px;opacity:0.85"></div><div style="font-size:10px;color:var(--text3)">${d.label}</div>${d.count>0?`<div style="font-size:10px;font-weight:700;color:var(--accent)">${d.count}</div>`:'<div style="font-size:10px;color:var(--border2)">â€”</div>'}</div>`;}).join('')}
        </div>
      </div>
      <div class="card" style="padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">HORAS ACTIVAS POR DÃA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.hours/maxHours*76,d.hours>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:#a78bfa;border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.hours>0?4:1}px;opacity:0.85"></div><div style="font-size:10px;color:var(--text3)">${d.label}</div>${d.hours>0?`<div style="font-size:10px;font-weight:700;color:#a78bfa">${d.hours}h</div>`:'<div style="font-size:10px;color:var(--border2)">â€”</div>'}</div>`;}).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="padding:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:12px">TOP MÃQUINAS POR HORAS ACUMULADAS</div>
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
  // Pre-poblar historial de impresiÃ³n para renderProductionAnalytics()
  const _existingHist=[];try{const _eh=localStorage.getItem(HIST_KEY);if(_eh) _existingHist.push(...JSON.parse(_eh));}catch(e){}
  if(!_existingHist.length){
    const _hFiles=['soporte_repisa_v2','pieza_engranaje_v3','carcasa_iot_slim','base_macetero_lg','articulacion_robotica','soporte_camara','organizador_cables','cubierta_sensor','tapa_contenedor','pieza_custom_47','frame_display_7in','bisagra_mueble','soporte_pantalla_doble','boquilla_riego_360'];
    const _now=Date.now();
    const _demoHist=[];
    // 7 dÃ­as de historial: [impresiones, horasPromedio] por dÃ­a
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
// impresoras a la vez: en modo remoto esa rÃ¡faga simultÃ¡nea satura el Ãºnico
// tÃºnel/bridge (timeouts â†’ "Offline") y es mÃ¡s amable con el host Moonraker.
async function _mapLimit(items,limit,fn){
  let i=0;
  const run=async()=>{while(i<items.length){const idx=i++;try{await fn(items[idx]);}catch(e){}}};
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));
}
// Aplica una lectura al estado, con histÃ©resis: un fallo aislado NO marca
// Offline ni borra el estado bueno â€” lo conserva como "stale" hasta acumular
// _OFFLINE_AFTER_FAILS fallos seguidos. AdemÃ¡s programa backoff por mÃ¡quina
// para no martillar al bridge con una impresora apagada. Lo usan polling y WS.
function _applyStatus(m,s){
  if(s&&s._fetchFail){
    const n=(_failCount[m.id]=(_failCount[m.id]||0)+1);
    const prev=_printerStatus[m.id];
    // backoff exponencial (2s,4s,8sâ€¦ mÃ¡x 60s) + jitter
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
  if(_pollInFlight)return;            // no solapar ciclos lentos (timeouts)
  if(document.hidden)return;          // no machacar bridge/impresoras con la pestaÃ±a oculta
  _pollInFlight=true;
  try{
    const now=Date.now();
    await _mapLimit(MAQUINAS,4,async m=>{
      if(_wsConnected[m.id])return;                          // el WebSocket ya da estado en vivo
      if(_nextPollAt[m.id]&&now<_nextPollAt[m.id])return;    // en backoff: mÃ¡quina caÃ­da
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
    <div class="kpi-card green"><div class="kpi-label">Disponibles hoy</div><div class="kpi-value" style="color:var(--accent3)">${dispHoy}</div><div class="kpi-sub">de ${MAQUINAS.length} mÃ¡quinas</div></div>
    <div class="kpi-card orange"><div class="kpi-label">En uso hoy</div><div class="kpi-value" style="color:var(--accent2)">${usoHoy}</div><div class="kpi-sub">${mantHoy>0?`${mantHoy} en mantenciÃ³n`:'sin mantenciÃ³n'}</div></div>
    <div class="kpi-card ${pctCls}"><div class="kpi-label">UtilizaciÃ³n semana</div><div class="kpi-value" style="color:${pctColor}">${pct}%</div><div class="kpi-sub">${ocupados}/${total} slots</div></div>
    <div class="kpi-card yellow"><div class="kpi-label">Horas en producciÃ³n</div><div class="kpi-value" style="color:var(--accent)">${horas>0?horas.toFixed(0)+'h':'â€”'}</div><div class="kpi-sub">estimadas semana</div></div>
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
      <div style="font-size:9.5px;color:${isCur?'var(--accent)':isNow?'var(--text)':'var(--text3)'};font-family:'JetBrains Mono',monospace;white-space:nowrap;font-weight:${isNow?700:400}">${isNow?'â† HOY':fmtC(lun)}</div>
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
  document.getElementById('semanaLabel').textContent=`${dias[0].toLocaleDateString('es-CL',opts)} â€” ${dias[6].toLocaleDateString('es-CL',opts)} ${dias[0].getFullYear()}`;
  renderHeatmapSemanas();
  renderMaquinasKPIs(dias,today);
  document.getElementById('maquinasHeader').innerHTML=`<tr><th style="padding:9px 14px;font-size:10.5px;text-transform:uppercase;color:var(--text3);text-align:left;border-bottom:1px solid var(--border);min-width:160px;background:var(--surface);position:sticky;left:0;z-index:3">MÃ¡quina</th><th style="padding:9px 10px;font-size:10.5px;color:var(--text3);text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:3;min-width:70px">Estado</th>${dias.map(d=>{const isH=fmtDate(d)===today;return`<th style="padding:7px 4px;font-size:10.5px;font-weight:${isH?700:500};color:${isH?'var(--accent)':'var(--text3)'};text-align:center;border-bottom:1px solid var(--border);min-width:95px;background:var(--surface)">${fmtDayLabel(d)}</th>`;}).join('')}</tr>`;
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
    const estadoBtn=`<button class="btn-mini btn-mini-${estadoMeta.color}" onclick="toggleMaquinaEstado('${m.id}')" title="${escapeHtml(estadoMeta.label)} Â· clic para ${estadoGlobal==='disponible'?'poner en mantenciÃ³n':'marcar disponible'}">${estadoMeta.short}</button>`;
    const celdas=dias.map(d=>{const ds=fmtDate(d),key=`${m.id}_${ds}`,ev=maquinaState.eventos[key],isH=ds===today;let bg='',content='';if(ev){if(ev.tipo==='mantencion'){bg='rgba(255,68,68,0.2)';content=`<div style="font-size:10px;font-weight:700;color:var(--danger)">ğŸ”§ MANT.</div>`;}else if(ev.tipo==='uso'){bg='rgba(255,107,53,0.2)';const pedLabel=ev.pedidoId?state.pedidosById[ev.pedidoId]?.fields['NÂ° Pedido']||null:null;const descLabel=pedLabel?`ğŸ”— ${pedLabel}`:(ev.desc||'En uso');content=`<div style="font-size:10px;color:${pedLabel?'var(--accent)':'var(--accent2)'};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:85px" title="${escapeHtml(ev.desc||'')}">${escapeHtml(descLabel)}</div>${ev.tiempo?`<div style="font-size:9.5px;color:var(--text3)">${ev.tiempo}h</div>`:''}`;}else{bg='rgba(0,212,170,0.12)';content=`<div style="font-size:10px;color:var(--accent3);font-weight:600">âœ“ Libre</div>`;}}return`<td onclick="openMaquinaModal('${m.id}','${m.nombre} #${m.num}','${ds}')" style="padding:3px;text-align:center;border-bottom:1px solid var(--border);border-left:${isH?'2px solid var(--accent)':'1px solid var(--border)'};background:${bg||'transparent'};cursor:pointer;vertical-align:middle" onmouseenter="this.style.filter='brightness(1.5)'" onmouseleave="this.style.filter='brightness(1)'"><div style="min-height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${content||`<span style="color:var(--text3);font-size:10.5px">+</span>`}${ev?`<button onclick="event.stopPropagation();deleteMaquinaEvento('${m.id}','${ds}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:9.5px;padding:0">âœ•</button>`:''}</div></td>`;}).join('');
    return`${groupRow}<tr><td style="padding:9px 14px;font-size:12px;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:2"><span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block;margin-right:6px"></span>${escapeHtml(m.nombre)} <span style="color:var(--text3)">#${m.num}</span></td><td style="padding:4px 6px;text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:2">${estadoBtn}</td>${celdas}</tr>`;
  }).join('');
  document.getElementById('maquinasSubtitle').textContent=`${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)==='disponible').length} disponibles Â· ${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)!=='disponible').length} no operativas`;
}
function openMaquinaModal(maqId,nombre,dateStr){
  document.getElementById('maquinaModalId').value=maqId;
  document.getElementById('maquinaModalDate').value=dateStr;
  document.getElementById('maquinaModalTitle').textContent=`ğŸ“… ${nombre} â€” ${dateStr}`;
  document.getElementById('maquinaModalFechaInicio').value=dateStr;
  document.getElementById('maquinaModalFechaFin').value=dateStr;
  // poblar select de pedidos activos
  const activos=state.pedidos.filter(p=>!['Despachado','Completado','Cancelado'].includes(p.fields['Estado pedido']||''));
  const sel=document.getElementById('maquinaModalPedido');
  sel.innerHTML='<option value="">â€” sin pedido vinculado â€”</option>'+activos.map(p=>{
    const f=p.fields;
    return`<option value="${p.id}">${escapeHtml(f['NÂ° Pedido']||'â€”')} Â· ${escapeHtml(resolveClienteName(f['Cliente']))} Â· ${escapeHtml(f['Estado pedido']||'â€”')}</option>`;
  }).join('');
  // restaurar estado del evento existente si lo hay
  const ev=maquinaState.eventos[`${maqId}_${dateStr}`];
  if(ev){
    document.getElementById('maquinaModalTipo').value=ev.tipo||'uso';
    document.getElementById('maquinaModalDesc').value=ev.desc||'';
    document.getElementById('maquinaModalTiempo').value=ev.tiempo||'';
    // intentar re-vincular pedido desde descripciÃ³n
    if(ev.pedidoId) sel.value=ev.pedidoId;
    else{const match=activos.find(p=>ev.desc&&ev.desc.startsWith(p.fields['NÂ° Pedido']||'##'));if(match) sel.value=match.id;}
  }else{
    document.getElementById('maquinaModalTipo').m«ëŒ+Š×®º+º$zzb¥çfÇVSÒwW6òs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄFW62r’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF–V×òr’çfÇVSÒrs°¢6VÂçfÇVSÒrs°¢Ğ¢öäÖV–æÖöFÅF—ô6†ævR‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æWfVçDÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6Æ÷6TÖV–æÖöFÂ‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æWfVçDÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ¦gVæ7F–öâöäÖV–æÖöFÅF—ô6†ævR‚—°¢6öç7BF—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF—òr’çfÇVS°¢6öç7BW5W6ó×F—óÓÓÒwW6òrÆW4F—7×F—óÓÓÒvF—7öæ–&ÆRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅVF–Fôw&÷Wr’ç7G–ÆRæF—7Æ“ÖW5W6óòvfÆW‚s¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄFW64w&÷Wr’ç7G–ÆRæF—7Æ“ÖW4F—7òvæöæRs¢vfÆW‚s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF–V×ôw&÷Wr’ç7G–ÆRæF—7Æ“ÖW5W6óòvfÆW‚s¢væöæRs°§Ğ¦gVæ7F–öâöäÖV–æÖöFÅVF–Fô6†ævR‚—°¢6öç7B6VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅVF–Fòr“°¢6öç7B–C×6VÂçfÇVS¶–b‚–B’&WGW&ã°¢6öç7B×7FFRçVF–F÷4'”–E·–EÓ¶–b‚’&WGW&ã°¢6öç7Bc×æf–VÆG3°¢6öç7BåVCÖe²tì+VF–Fòu×ÇÂ~(	BrÆ6Æ–VçFS×&W6öÇfT6Æ–VçFTæÖR†e²t6Æ–VçFRuÒ’ÆW7FFóÖe²tW7FFòVF–Fòu×ÇÂ~(	Bs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄFW62r’çfÇVSÖG¶åVGÒ+rG¶6Æ–VçFWÖ°¢òò7VvW&—"†÷&26V|;¦âVF–Fò6’F–VæRÖöçFò†W7F–Ö6œ;6â,:–F¢6öç7BÖöçFóÒ†e²tÖöçFòF÷FÂ„4Å’u×ÇÃ’óã“°¢–b†ÖöçFóãbbFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF–V×òr’çfÇVR—°¢6öç7B„W7CÔÖF‚æÖ‚ƒÄÖF‚ç&÷VæB†ÖöçFòóS’“²òò&÷‚CV²æWFòö‚6öÖò&VfW&Væ6–¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF–V×òr’çfÇVSÔÖF‚æÖ–â†„W7BÃ#B“°¢Ğ§Ğ¦7–æ2gVæ7F–öâ6fTÖV–æWfVçFò‚—°¢6öç7BÖ–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄ–Br’çfÇVRÇF—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF—òr’çfÇVRÆFW63ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄFW62r’çfÇVRÇF–V×óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅF–V×òr’çfÇVRÆf“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄfV6†–æ–6–òr’çfÇVRÆfcÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÄfV6†f–âr’çfÇVS°¢–b‚f—ÇÂfb—·Fö7B‚t–æw&W6Æ2fV6†2rÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BVF–Fô–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖV–æÖöFÅVF–Fòr“òçfÇVWÇÂrs°¢6öç7B7F'CÖæWrFFR†f’²uC££r’ÆVæCÖæWrFFR†fb²uC££r“¶ÆWB6÷VçCÓ°¢f÷"†ÆWBCÖæWrFFR‡7F'B“¶CÃÖVæC¶Bç6WDFFR†BævWDFFR‚’³’—¶6öç7B¶W“ÖG¶Ö–GÕòG¶f×DFFR†æWrFFR†B’—Ö¶–b‡F—óÓÓÒvF—7öæ–&ÆRr’FVÆWFRÖV–æ7FFRæWfVçF÷5¶¶W•Ó¶VÇ6W¶6öç7BWc×·F—òÆFW62ÇF–V×ó§'6TfÆöB‡F–V×ò—ÇÆçVÆÇÓ¶–b‡VF–Fô–B’WbçVF–Fô–C×VF–Fô–C¶ÖV–æ7FFRæWfVçF÷5¶¶W•ÓÖWc·Ö6÷VçB²³·Ğ¢6Æ÷6TÖV–æÖöFÂ‚“·&VæFW$ÖV–æ46ÆVæF"‚“·Fö7B†)É2G¶6÷VçGÒL:ÖG¶6÷VçCãòw2s¢rwÒÖ&6F÷2(	BwV&FæFòââæÂv–æfòr“°¢G'—¶v—B6fTÖV–æWfVçF÷4—'F&ÆR‚“·Fö7B‚~)É2wV&FFòVâ—'F&ÆRrÂw7V66W72r“·Ğ¢6F6‚†R—·Fö7B‚tW'&÷"ÂwV&F#¢r¶RæÖW76vRÂvW'&÷"r“·Ğ§Ğ¦7–æ2gVæ7F–öâFVÆWFTÖV–æWfVçFò†Ö–BÆFFU7G"—°¢FVÆWFRÖV–æ7FFRæWfVçF÷5¶G¶Ö–GÕòG¶FFU7G'ÖÓ·&VæFW$ÖV–æ46ÆVæF"‚“°¢G'—¶v—B6fTÖV–æWfVçF÷4—'F&ÆR‚“·Fö7B‚tWfVçFòVÆ–Ö–æFòrÂv–æfòr“·Ğ¢6F6‚†R—·Fö7B‚tW'&÷"ÂVÆ–Ö–æ#¢r¶RæÖW76vRÂvW'&÷"r“·Ğ§Ğ ¢òò)H)HUT•ò)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦7–æ2gVæ7F–öâ–æ—DWV—ò‚—°¢v—BÆöDWV—ôWfVçF÷4—'F&ÆR‚“°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vv6ÅW'6öæ46öæf–rr“¶–b†VÂ’VÂæ–ææW$…DÔÃÕU%4ôä2æÖ‡ÓæÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£‡‚#âGµöd‡FÖÂ‡Ã#‚—ÓÇ7â7G–ÆSÒ&Ö–â×v–GFƒ£Cƒ¶föçB×6—¦S£'‚#âG·ææöÖ'&WÓÂ÷7ããÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&v6Åö6–EòG·æ–GÒ"Æ6V†öÆFW#Ò&VÖ–ÄvÖ–Âæ6öÒ"fÇVSÒ"G·æv6Ä–GÒ"7G–ÆSÒ&föçB×6—¦S£'ƒ¶fÆWƒ£#ãÆ–çWB6Æ73Ò&f–VÆBÖ–çWB"–CÒ&v6Åö¶W•òG·æ–GÒ"Æ6V†öÆFW#Ò$—¦âââ’¶W’"fÇVSÒ"G·6W76–öå7F÷&vRævWD—FVÒ‚vv6Åö•ö¶W’r—ÇÂrwÒ"7G–ÆSÒ&föçB×6—¦S£'ƒ¶fÆWƒ£#ãÂöF—cæ’æ¦ö–â‚rr“°¢6öç7Bç”v6ÃÕU%4ôä2ç6öÖR‡Óç6W76–öå7F÷&vRævWD—FVÒ‚vv6Å÷W'6öæòr·æ–B’“¶–b†ç”v6Â—µU%4ôä2æf÷$V6‚‡Óç¶6öç7B6–C×6W76–öå7F÷&vRævWD—FVÒ‚vv6Å÷W'6öæòr·æ–B“¶–b†6–B’æv6Ä–CÖ6–C·Ò“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vv6ÄWV—õ7–æ4'Fâr’ç7G–ÆRæF—7Æ“Òv–æÆ–æRÖfÆW‚s·Ğ¢&VæFW$WV—ô6ÆVæF"‚“°¢G'—·&VæFW$6öÖ—6–öæW2‚“·Ö6F6‚†R—·Ğ§Ğ¦gVæ7F–öâFövvÆTv6ÄWV—ô6öæf–r‚—¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vv6ÄWV—ô6öæf–rr“¶VÂç7G–ÆRæF—7Æ“ÖVÂç7G–ÆRæF—7Æ“ÓÓÒvæöæRsòv&Æö6²s¢væöæRs·Ğ¦gVæ7F–öâ6fTv6ÄWV—ô6öæf–r‚—µU%4ôä2æf÷$V6‚‡Óç¶6öç7B6–CÖFö7VÖVçBævWDVÆVÖVçD'”–B†v6Åö6–EòG·æ–GÖ“òçfÇVRçG&–Ò‚“¶6öç7B¶W“ÖFö7VÖVçBævWDVÆVÖVçD'”–B†v6Åö¶W•òG·æ–GÖ“òçfÇVRçG&–Ò‚“¶–b†6–B—·æv6Ä–CÖ6–C·6W76–öå7F÷&vRç6WD—FVÒ‚vv6Å÷W'6öæòr·æ–BÆ6–B“·Ö–b†¶W’’6W76–öå7F÷&vRç6WD—FVÒ‚vv6Åö•ö¶W’rÆ¶W’“·Ò“·FövvÆTv6ÄWV—ô6öæf–r‚“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vv6ÄWV—õ7–æ4'Fâr’ç7G–ÆRæF—7Æ“Òv–æÆ–æRÖfÆW‚s·Fö7B‚~)É26ÆVæF&–÷26öæf–wW&F÷2rÂw7V66W72r“·7–æ4v6ÄWV—ò‚“·Ğ¦gVæ7F–öâvWDWV—õ6VÖæÇVæW2‚—¶6öç7BCÖæWrFFR‚“·Bç6WD†÷W'2ƒÃÃÃ“¶6öç7BF“×BævWDF’‚“¶6öç7BÃÖæWrFFR‡B“¶Âç6WDFFR‡BævWDFFR‚’Ò†F“ÓÓÓóc¦F’Ó’²†WV—õ7FFRç6VÖæöfg6WB£r’“·&WGW&âÃ·Ğ¦gVæ7F–öâædWV—õ6VÖæ†B—¶WV—õ7FFRç6VÖæöfg6WB³ÖC·&VæFW$WV—ô6ÆVæF"‚“·Ğ¦gVæ7F–öâvôWV—õFöF’‚—¶WV—õ7FFRç6VÖæöfg6WCÓ·&VæFW$WV—ô6ÆVæF"‚“·Ğ¦gVæ7F–öâ&VæFW$WV—ô6ÆVæF"‚—°¢6öç7BÇVæW3ÖvWDWV—õ6VÖæÇVæW2‚“¶6öç7BF–3ÕµÓ¶f÷"†ÆWB“Ó¶“Ãs¶’²²—¶6öç7BCÖæWrFFR†ÇVæW2“¶Bç6WDFFR†ÇVæW2ævWDFFR‚’¶’“¶F–2çW6‚†B“·Ğ¢6öç7BFöF“Öf×DFFR†æWrFFR‚’“¶6öç7B÷G3×¶F“¢vçVÖW&–2rÆÖöçFƒ¢w6†÷'BwÓ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—õ6VÖæÆ&VÂr’çFW‡D6öçFVçCÖG¶F–5³ÒçFôÆö6ÆTFFU7G&–ær‚vW2Ô4ÂrÆ÷G2—Ò(	BG¶F–5³eÒçFôÆö6ÆTFFU7G&–ær‚vW2Ô4ÂrÆ÷G2—ÒG¶F–5³ÒævWDgVÆÅ–V"‚—Ö°¢&VæFW$WV—õ&W7VÖVä†÷’‡FöF’“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ô†VFW"r’æ–ææW$…DÔÃÖÇG#ãÇF‚7G–ÆSÒ'FF–æs£‚Gƒ¶föçB×6—¦S£ãWƒ·FW‡B×G&ç6f÷&Ó§WW&66S¶6öÆ÷#§f"‚Ò×FW‡C2“·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶Ö–â×v–GFƒ£sƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“·÷6—F–öã§7F–6·“¶ÆVgC£·¢Ö–æFWƒ£"#åW'6öæÂ÷FƒâG¶F–2æÖ†CÓç¶6öç7B—4ƒÖf×DFFR†B“ÓÓ×FöF’ÆW4f–æFSÖBævWDF’‚“ÓÓÓÇÆBævWDF’‚“ÓÓÓc·&WGW&æÇF‚7G–ÆSÒ'FF–æs£w‚Wƒ¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C¢G¶—4ƒós£SÓ¶6öÆ÷#¢G¶—4ƒòwf"‚ÒÖ66VçB’s¦W4f–æFSòwf"‚Ò×FW‡C2’s¢wf"‚Ò×FW‡C"’wÓ·FW‡BÖÆ–vã¦6VçFW#¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶Ö–â×v–GFƒ£ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R’#âG¶f×DF”Æ&VÂ†B—ÒG¶W4f–æFSòsÆ'#ãÇ7â7G–ÆSÒ&föçB×6—¦S£’ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#æf–æFSÂ÷7ãâs¢rwÓÂ÷Fƒæ·Ò’æ¦ö–â‚rr—ÓÂ÷G#æ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ô&öG’r’æ–ææW$…DÔÃÕU%4ôä2æÖ‡Óç°¢6öç7B6VÆF3ÖF–2æÖ†CÓç¶6öç7BG3Öf×DFFR†B’Æ¶W“ÖG·æ–GÕòG¶G7ÖÆWcÖWV—õ7FFRæWfVçF÷5¶¶W•ÒÆ—4ƒÖG3ÓÓ×FöF’ÆW4f–æFSÖBævWDF’‚“ÓÓÓÇÆBævWDF’‚“ÓÓÓc¶6öç7B6fsÖWcò„UT•õõD•õ5¶WbçF—õ×ÇÄUT•õõD•õ2æF—7öæ–&ÆR“¦çVÆÃ¶6öç7B&sÖ6fsö6fræ&s¦W4f–æFSòw&v&ƒ#SRÃ#SRÃ#SRÃã’s¢wG&ç7&VçBs¶ÆWB6öçFVçCÒrs¶–b†6fr—¶6öçFVçCÖÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G¶6fræ6öÆ÷'Ò#âG¶6fræ–6öçÒG¶6fræÆ&VÇÓÂöF—câG¶WbæFW63öÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3·v†—FR×76S¦æ÷w&¶Ö‚×v–GFƒ£ƒ‡‚#âG¶W66T‡FÖÂ†WbæFW62—ÓÂöF—cæ¢rwÓÆ'WGFöâöæ6Æ–6³Ò&WfVçBç7F÷&÷vF–öâ‚“¶FVÆWFTWV—ôWfVçFò‚rG·æ–GÒrÂrG¶G7Òr’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£’ãWƒ·FF–æs£#î)ÉSÂö'WGFöãæ·ÖVÇ6W¶6öçFVçCÖÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2“¶föçB×6—¦S£ãW‚#âG¶W4f–æFSò~(	Bs¢r²wÓÂ÷7ãæ·×&WGW&æÇFBöæ6Æ–6³Ò&÷VäWV—ôÖöFÂ‚rG·æ–GÒrÂrG·ææöÖ'&WÒrÂrG¶G7Òr’"7G–ÆSÒ'FF–æs£7ƒ·FW‡BÖÆ–vã¦6VçFW#¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"ÖÆVgC¢G¶—4ƒòs'‚6öÆ–Bf"‚ÒÖ66VçB’s¢s‚6öÆ–Bf"‚ÒÖ&÷&FW"’wÓ¶&6¶w&÷VæC¢G¶&wÓ¶7W'6÷#§ö–çFW#·fW'F–6ÂÖÆ–vã¦Ö–FFÆR"öæÖ÷W6VVçFW#Ò'F†—2ç7G–ÆRæf–ÇFW#Òv'&–v‡FæW72ƒãB’r"öæÖ÷W6VÆVfSÒ'F†—2ç7G–ÆRæf–ÇFW#Òv'&–v‡FæW72ƒ’r#ãÆF—b7G–ÆSÒ&Ö–âÖ†V–v‡C£C'ƒ¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW#¶v£'‚#âG¶6öçFVçGÓÂöF—cãÂ÷FCæ·Ò’æ¦ö–â‚rr“°¢6öç7BF—76÷VçCÖF–2æf–ÇFW"†CÓç¶6öç7BWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG¶f×DFFR†B—ÖÓ·&WGW&âWgÇÆWbçF—óÓÓÒvF—7öæ–&ÆRs·Ò’æÆVæwFƒ°¢&WGW&æÇG#ãÇFB7G–ÆSÒ'FF–æs£‚Gƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚Ò×7W&f6R“·÷6—F–öã§7F–6·“¶ÆVgC£·¢Ö–æFWƒ£#ãÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£—‚#âGµöd‡FÖÂ‡Ã3B—ÓÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£c#âG¶W66T‡FÖÂ‡ææöÖ'&R—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG·ç&öÇÒ+rG¶F—76÷VçGÒórF—7ãÂöF—cãÂöF—cãÂöF—cãÂ÷FCâG¶6VÆF7ÓÂ÷G#æ°¢Ò’æ¦ö–â‚rr“°¢&VæFW$WV—ôFWFÆÆU6VÖæ†F–2“°¢6öç7BW6VçFW3ÕU%4ôä2æf–ÇFW"‡Óç¶6öç7BWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG·FöF—ÖÓ·&WGW&âWbbe²vW6VçFRrÂwf66–öæW2uÒæ–æ6ÇVFW2†WbçF—ò“·Ò’æÆVæwFƒ°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—õ7V'F—FÆRr’çFW‡D6öçFVçCÖGµU%4ôä2æÆVæwF‚ÖW6VçFW7ÒF—7öæ–&ÆW2+rG¶W6VçFW7ÒW6VçFW2†÷–°§Ğ¦gVæ7F–öâ&VæFW$WV—õ&W7VÖVä†÷’‡FöF’—°¢6öç7BFöF”FFSÖæWrFFR‡FöF’²uC££r“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—õ&W7VÖVä†÷’r’æ–ææW$…DÔÃÕU%4ôä2æÖ‡Óç°¢6öç7BWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG·FöF—ÖÓ°¢6öç7B6fsÖWcò„UT•õõD•õ5¶WbçF—õ×ÇÄUT•õõD•õ2æF—7öæ–&ÆR“¤UT•õõD•õ2æF—7öæ–&ÆS°¢òò36&vFRG&&¦ó¢VF–F÷27F—f÷26–væF÷2W7FW'6öæ¢6öç7Bfã×ææöÖ'&Rç7Æ—B‚rr•³ÒçFôÆ÷vW$66R‚“°¢6öç7BÖ—5VF–F÷3×7FFRçVF–F÷2æf–ÇFW"‡ƒÓç°¢6öç7BVÒ‡‚æf–VÆG5²tWV—ò6–væFòu×ÇÂrr’çFôÆ÷vW$66R‚“°¢&WGW&âVæ–æ6ÇVFW2†fâ’bb²tFW76†FòrÂt6ö×ÆWFFòrÂt6æ6VÆFòuÒæ–æ6ÇVFW2‡‚æf–VÆG5²tW7FFòVF–Fòu×ÇÂrr“°¢Ò“°¢6öç7B&÷„VçG&VvÖÖ—5VF–F÷0¢æf–ÇFW"‡ƒÓç‚æf–VÆG5²tfV6†VçG&VvuÒbfæWrFFR‡‚æf–VÆG5²tfV6†VçG&VvuÒ²uC££r“ã×FöF”FFR¢æÖ‡ƒÓç‚æf–VÆG5²tfV6†VçG&VvuÒ’ç6÷'B‚•³Ó°¢6öç7B&÷„Æ&VÃ×&÷„VçG&Vvö+r,;7ƒ¢G·&÷„VçG&Vvç7V'7G&–ærƒR’ç&WÆ6R‚rÒrÂròr—Ö¢rs°¢6öç7B6&v‡FÖÃÖÖ—5VF–F÷2æÆVæwF€¢öÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚ÒÖ66VçB“¶Ö&v–â×F÷£7‚#ï	ù:bG¶Ö—5VF–F÷2æÆVæwF‡ÒVF–FòG¶Ö—5VF–F÷2æÆVæwFƒãòw2s¢rwÒ7F—fòG¶Ö—5VF–F÷2æÆVæwFƒãòw2s¢rwÒG·&÷„Æ&VÇÓÂöF—cæ ¢¦ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–â×F÷£7‚#å6–âVF–F÷27F—f÷3ÂöF—cæ°¢òò3"ÆW'F2FR6ö&W'GW&¢W6Væ6–6ö–æ6–FR6öâfV6†VçG&VvFRVâVF–Fğ¢6öç7B6öæfÆ–7F÷3ÕµÓ°¢ö&¦V7BæVçG&–W2†WV—õ7FFRæWfVçF÷2’æf÷$V6‚‚…¶¶W’ÆWc%Ò“Óç°¢–b‚¶W’ç7F'G5v—F‚‡æ–B²uòr—ÇÂ²vW6VçFRrÂwf66–öæW2uÒæ–æ6ÇVFW2†Wc"çF—ò’’&WGW&ã°¢6öç7BF³Ö¶W’ç7V'7G&–ær‡æ–BæÆVæwF‚³“°¢Ö—5VF–F÷2æf÷$V6‚‡ƒÓç°¢–b‚‡‚æf–VÆG5²tfV6†VçG&Vvu×ÇÂrr“ÓÓÖF²¢6öæfÆ–7F÷2çW6‚‡·VC§‚æf–VÆG5²tì+VF–Fòu×ÇÂsòrÆfV6†¦F²ç7V'7G&–ærƒR’ç&WÆ6R‚rÒrÂròr—Ò“°¢Ò“°¢Ò“°¢6öç7BÆW'F‡FÖÃÖ6öæfÆ–7F÷2æÆVæwF€¢öÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚ÒÖFævW"“¶föçB×vV–v‡C£s¶Ö&v–â×F÷£7‚#î)ª6öæfÆ–7Fó¢G¶6öæfÆ–7F÷2æÖ†3ÓæG¶2çVGÒfVæ6RVÂG¶2æfV6†Ö’æ¦ö–â‚r+rr—ÓÂöF—cæ ¢¢rs°¢&WGW&æÆF—b6Æ73Ò&6&B"7G–ÆSÒ'FF–æs£Gƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‚G¶6öæfÆ–7F÷2æÆVæwFƒòs¶&÷&FW"Ö6öÆ÷#§&v&ƒ#SRÃc‚Ãc‚ÃãB’s¢rwÒ#âGµöd‡FÖÂ‡ÃC—ÓÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#ãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s#âG¶W66T‡FÖÂ‡ææöÖ'&R—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢G¶6fræ6öÆ÷'Ó¶föçB×vV–v‡C£s#âG¶6fræ–6öçÒG¶6fræÆ&VÇÓÂöF—câG¶WcòæFW63öÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3·v†—FR×76S¦æ÷w&#âG¶W66T‡FÖÂ†WbæFW62—ÓÂöF—cæ¢rwÒG¶6&v‡FÖÇÒG¶ÆW'F‡FÖÇÓÂöF—cãÆ'WGFöâ6Æ73Ò&'FâÖÖ–æ’G¶WbbfWbçF—òÓÒvF—7öæ–&ÆRsòv'FâÖÖ–æ’×&VBs¢v'FâÖÖ–æ’Öw&VVâwÒ"öæ6Æ–6³Ò'V–6µFövvÆTWV—ò‚rG·æ–GÒrÂrG·FöF—Òr’#âG¶WbbfWbçF—òÓÒvF—7öæ–&ÆRsò	ùKBF—7âs¢	ùú"ô²wÓÂö'WGFöããÂöF—cæ°¢Ò’æ¦ö–â‚rr“°§Ğ¦gVæ7F–öâ&VæFW$WV—ôFWFÆÆU6VÖæ†F–2—°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôFWFÆÆU6VÖær’æ–ææW$…DÔÃÕU%4ôä2æÖ‡Óç°¢òò3VF–F÷27F—f÷26–væF÷2W7FW'6öæ¢6öç7Bfã×ææöÖ'&Rç7Æ—B‚rr•³ÒçFôÆ÷vW$66R‚“°¢6öç7BÖ—5VF–F÷3×7FFRçVF–F÷2æf–ÇFW"‡ƒÓç°¢6öç7BVÒ‡‚æf–VÆG5²tWV—ò6–væFòu×ÇÂrr’çFôÆ÷vW$66R‚“°¢&WGW&âVæ–æ6ÇVFW2†fâ’bb²tFW76†FòrÂt6ö×ÆWFFòrÂt6æ6VÆFòuÒæ–æ6ÇVFW2‡‚æf–VÆG5²tW7FFòVF–Fòu×ÇÂrr“°¢Ò“°¢òòÖfV6†(i&Æ—7FFRì+VF–FòVRfVæ6VâW6RL:Ö¢6öç7BVçG&Vv4F–3×·Ó°¢Ö—5VF–F÷2æf÷$V6‚‡ƒÓç¶6öç7BfS×‚æf–VÆG5²tfV6†VçG&VvuÓ¶–b†fR—¶–b‚VçG&Vv4F–5¶fUÒ–VçG&Vv4F–5¶fUÓÕµÓ¶VçG&Vv4F–5¶fUÒçW6‚‡‚æf–VÆG5²tì+VF–Fòu×ÇÂsòr“·×Ò“°¢òò6öçF"6öæfÆ–7F÷2VâÆ6VÖæf—6–&ÆP¢6öç7B6öæfÆ–7D6÷VçCÖF–2æf–ÇFW"†CÓç¶6öç7BG3Öf×DFFR†B’ÆWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG¶G7ÖÓ·&WGW&âWbbe²vW6VçFRrÂwf66–öæW2uÒæ–æ6ÇVFW2†WbçF—ò’bb†VçG&Vv4F–5¶G5×ÇÅµÒ’æÆVæwFƒã·Ò’æÆVæwFƒ°¢òòf–Æ2FRL:Ö26öâ–æF–6F÷&W2FRVçG&Vv’6öæfÆ–7Fğ¢6öç7BWfVçF÷4‡FÖÃÖF–2æÖ†CÓç°¢6öç7BG3Öf×DFFR†B’ÆWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG¶G7ÖÒÆ6fsÖWcò„UT•õõD•õ5¶WbçF—õ×ÇÆçVÆÂ“¦çVÆÂÆW4f–æFSÖBævWDF’‚“ÓÓÓÇÆBævWDF’‚“ÓÓÓc°¢6öç7BVDW6TF–ÖVçG&Vv4F–5¶G5×ÇÅµÓ°¢6öç7BW7FW6VçFSÖWbbe²vW6VçFRrÂwf66–öæW2uÒæ–æ6ÇVFW2†WbçF—ò“°¢6öç7B6öæfÆ–7FóÖW7FW6VçFRbgVDW6TF–æÆVæwFƒã°¢6öç7BVEFs×VDW6TF–æÆVæwFƒöÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G¶6öæfÆ–7Fóòwf"‚ÒÖFævW"’s¢wf"‚ÒÖ66VçB’wÓ¶Ö&v–âÖÆVgC¦WFó¶fÆW‚×6‡&–æ³£#âG¶6öæfÆ–7Fóò~)ªs¢	ù:bwÒG·VDW6TF–æ¦ö–â‚rÂr—ÓÂ÷7ãæ¢rs°¢&WGW&æÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£wƒ·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’G¶6öæfÆ–7Fóòs¶&6¶w&÷VæC§&v&ƒ#SRÃc‚Ãc‚Ããb’s¢rwÒ#ãÇ7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö–â×v–GFƒ£CG‚#âG¶f×DF”Æ&VÂ†B—ÓÂ÷7ãâG¶6fsöÇ7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢G¶6fræ6öÆ÷'Ò#âG¶6fræ–6öçÒG¶6fræÆ&VÇÓÂ÷7ãâG¶WbæFW63öÇ7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3¶fÆWƒ£#âG¶W66T‡FÖÂ†WbæFW62—ÓÂ÷7ãæ¢rwÖ¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#¢G¶W4f–æFSòwf"‚Ò×FW‡C2’s¢wf"‚ÒÖ66VçC2’wÒ#î)É2G¶W4f–æFSòtf–æFRs¢tF—7öæ–&ÆRwÓÂ÷7ãæÒG·VEFwÓÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢6öç7BF—7F–3ÖF–2æf–ÇFW"†CÓç¶6öç7BWcÖWV—õ7FFRæWfVçF÷5¶G·æ–GÕòG¶f×DFFR†B—ÖÓ·&WGW&âWgÇÆWbçF—óÓÓÒvF—7öæ–&ÆRs·Ò’æÆVæwFƒ°¢6öç7B7CÔÖF‚ç&÷VæB‚†F—7F–2ór’£“°¢6öç7B&$6öÆ÷#×7CãÓsòwf"‚ÒÖ66VçC2’s§7CãÓCòwf"‚Ò×v&â’s¢wf"‚ÒÖFævW"’s°¢6öç7B7FD‡FÖÃÖÖ—5VF–F÷2æÆVæwF€¢öÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#¢G¶6öæfÆ–7D6÷VçCòwf"‚ÒÖFævW"’s¢wf"‚ÒÖ66VçB’wÓ¶Ö&v–â×F÷£'‚#âG¶6öæfÆ–7D6÷VçCö)ªG¶6öæfÆ–7D6÷VçGÒ6öæfÆ–7FòG¶6öæfÆ–7D6÷VçCãòw2s¢rwÖ¦	ù:bG¶Ö—5VF–F÷2æÆVæwF‡ÒVBâ7F—fòG¶Ö—5VF–F÷2æÆVæwFƒãòw2s¢rwÖÓÂöF—cæ ¢¢rs°¢&WGW&æÆF—b6Æ73Ò&6&B#ãÆF—b6Æ73Ò&6&BÖ†VFW"#ãÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£—‚#âGµöd‡FÖÂ‡Ã3—ÓÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶föçB×vV–v‡C£s#âG¶W66T‡FÖÂ‡ææöÖ'&R—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG·ç&öÇÓÂöF—cãÂöF—cãÂöF—cãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÆF—b7G–ÆSÒ&föçB×6—¦S£gƒ¶föçBÖfÖ–Ç“¢t&V&2æWVRs¶6öÆ÷#¢G¶&$6öÆ÷'Ò#âG¶F—7F–7ÒósÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#æL:Ö2F—7ãÂöF—câG·7FD‡FÖÇÓÂöF—cãÂöF—cãÆF—b7G–ÆSÒ'FF–æs£G‚g‚#ãÆF—b7G–ÆSÒ&†V–v‡C£7ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£'ƒ¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶÷fW&fÆ÷s¦†–FFVâ#ãÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G·7GÒS¶&6¶w&÷VæC¢G¶&$6öÆ÷'Ó¶&÷&FW"×&F—W3£'‚#ãÂöF—cãÂöF—câG¶WfVçF÷4‡FÖÇÓÂöF—cãÂöF—cæ°¢Ò’æ¦ö–â‚rr“°§Ğ¦7–æ2gVæ7F–öâV–6µFövvÆTWV—ò‡W'6öæ–BÆFFU7G"—¶6öç7B¶W“ÖG·W'6öæ–GÕòG¶FFU7G'ÖÆWcÖWV—õ7FFRæWfVçF÷5¶¶W•Ó¶–b†WbbfWbçF—òÓÒvF—7öæ–&ÆRr—¶FVÆWFRWV—õ7FFRæWfVçF÷5¶¶W•Ó·&VæFW$WV—ô6ÆVæF"‚“¶v—B6fTWV—ôWfVçF÷4—'F&ÆR‚“·Fö7B‚~)É2F—7öæ–&ÆRrÂw7V66W72r“·ÖVÇ6R÷VäWV—ôÖöFÂ‡W'6öæ–BÅU%4ôä2æf–æB‡Óçæ–CÓÓ×W'6öæ–B“òææöÖ'&WÇÂrrÆFFU7G"“·Ğ¦gVæ7F–öâ÷VäWV—ôÖöFÂ‡W'6öæ–BÆæöÖ'&RÆFFU7G"—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅW'6öæ–Br’çfÇVS×W'6öæ–C¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄFFRr’çfÇVSÖFFU7G#¶6öç7BÕU%4ôä2æf–æB‡ƒÓç‚æ–CÓÓ×W'6öæ–B“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅF—FÆRr’æ–ææW$…DÔÃÖÇ7â7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡‚#âGµöd‡FÖÂ‡Ã#‚—ß	ù8RG¶W66T‡FÖÂ†æöÖ'&R—Ò(	BG¶FFU7G'ÓÂ÷7ãæ¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄFW62r’çfÇVSÒrs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄfV6†–æ–6–òr’çfÇVSÖFFU7G#¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄfV6†f–âr’çfÇVSÖFFU7G#¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄ†÷&–æ–6–òr’çfÇVSÒs“£s¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄ†÷&f–âr’çfÇVSÒsƒ£s¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅF—òr’çfÇVSÒvö7WFòs¶öäWV—ôÖöFÅF—ô6†ævR‚“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôWfVçDÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s·Ğ¦gVæ7F–öâ6Æ÷6TWV—ôÖöFÂ‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôWfVçDÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs·Ğ¦gVæ7F–öâöäWV—ôÖöFÅF—ô6†ævR‚—¶6öç7BF—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅF—òr’çfÇVS¶6öç7B6†÷tFW63Ò²wf66–öæW2rÂvW6VçFRrÂvF—7öæ–&ÆRuÒæ–æ6ÇVFW2‡F—ò“¶6öç7B6†÷t†÷&3Õ²vö7WFòrÂw&WVæ–öârÂw&VÖ÷FòuÒæ–æ6ÇVFW2‡F—ò“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄFW64w&÷Wr’ç7G–ÆRæF—7Æ“×6†÷tFW63òvfÆW‚s¢væöæRs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄ†÷&4w&÷Wr’ç7G–ÆRæF—7Æ“×6†÷t†÷&3òvfÆW‚s¢væöæRs·Ğ¦7–æ2gVæ7F–öâ6fTWV—ôWfVçFò‚—°¢6öç7B–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅW'6öæ–Br’çfÇVRÇF—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÅF—òr’çfÇVRÆFW63ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄFW62r’çfÇVRÆf“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄfV6†–æ–6–òr’çfÇVRÆfcÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄfV6†f–âr’çfÇVRÆ†÷&–æ–6–óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄ†÷&–æ–6–òr’çfÇVRÆ†÷&f–ãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV—ôÖöFÄ†÷&f–âr’çfÇVS°¢–b‚f—ÇÂfb—·Fö7B‚t–æw&W6Æ2fV6†2rÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7B7F'CÖæWrFFR†f’²uC££r’ÆVæCÖæWrFFR†fb²uC££r“¶ÆWB6÷VçCÓ°¢f÷"†ÆWBCÖæWrFFR‡7F'B“¶CÃÖVæC¶Bç6WDFFR†BævWDFFR‚’³’—¶6öç7B¶W“ÖG·–GÕòG¶f×DFFR†æWrFFR†B’—Ö¶–b‡F—óÓÓÒvF—7öæ–&ÆRr’FVÆWFRWV—õ7FFRæWfVçF÷5¶¶W•Ó¶VÇ6RWV—õ7FFRæWfVçF÷5¶¶W•Ó×·F—òÆFW62Æ†÷&–æ–6–òÆ†÷&f–çÓ¶6÷VçB²³·Ğ¢6öç7BÕU%4ôä2æf–æB‡ƒÓç‚æ–CÓÓ×–B“¶6Æ÷6TWV—ôÖöFÂ‚“·&VæFW$WV—ô6ÆVæF"‚“°¢Fö7B†)É2G¶6÷VçGÒL:ÖG¶6÷VçCãòw2s¢rwÒ(i"G·òææöÖ'&WÒ(	BwV&FæFòââæÂv–æfòr“°¢v—B6fTWV—ôWfVçF÷4—'F&ÆR‚“·Fö7B‚~)É2wV&FFòVâ—'F&ÆRrÂw7V66W72r“°§Ğ¦7–æ2gVæ7F–öâFVÆWFTWV—ôWfVçFò‡–BÆFFU7G"—¶FVÆWFRWV—õ7FFRæWfVçF÷5¶G·–GÕòG¶FFU7G'ÖÓ·&VæFW$WV—ô6ÆVæF"‚“¶v—B6fTWV—ôWfVçF÷4—'F&ÆR‚“·Fö7B‚tWfVçFòVÆ–Ö–æFòrÂv–æfòr“·Ğ¦7–æ2gVæ7F–öâ7–æ4v6ÄWV—ò‚—°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vv6ÄWV—õ7–æ4'Fâr“¶'FâæF—6&ÆVC×G'VS¶'FâçFW‡D6öçFVçCÒ~(û27–æ2âââs°¢6öç7BÇVæW3ÖvWDWV—õ6VÖæÇVæW2‚“¶6öç7BF–3ÕµÓ¶f÷"†ÆWB“Ó¶“Ãs¶’²²—¶6öç7BCÖæWrFFR†ÇVæW2“¶Bç6WDFFR†ÇVæW2ævWDFFR‚’¶’“¶F–2çW6‚†B“·Ğ¢6öç7BF–ÖTÖ–ãÖVæ6öFUU$”6ö×öæVçB†F–5³ÒçFô•4õ7G&–ær‚’’ÇF–ÖTÖƒÖVæ6öFUU$”6ö×öæVçB†æWrFFR†F–5³eÒævWEF–ÖR‚’³ƒcC’çFô•4õ7G&–ær‚’“¶ÆWBF÷FÃÓ°¢f÷"†6öç7BöbU%4ôä2—¶6öç7Bv6Ä–C×6W76–öå7F÷&vRævWD—FVÒ‚vv6Å÷W'6öæòr·æ–B“¶6öç7B”¶W“×6W76–öå7F÷&vRævWD—FVÒ‚vv6Åö•ö¶W’r“¶–b‚v6Ä–GÇÂ”¶W’’6öçF–çVS°¢G'—¶6öç7B#Öv—BfWF6‚†‡GG3¢ò÷wwrævöövÆV—2æ6öÒö6ÆVæF"÷c2ö6ÆVæF'2òG¶Væ6öFUU$”6ö×öæVçB†v6Ä–B—ÒöWfVçG3ö¶W“ÒG¶”¶W—ÒgF–ÖTÖ–ãÒG·F–ÖTÖ–çÒgF–ÖTÖƒÒG·F–ÖTÖ‡Òg6–ævÆTWfVçG3×G'VRf÷&FW$'“×7F'EF–ÖRfÖ…&W7VÇG3ÓS“¶–b‚"æö²’6öçF–çVS¶6öç7BFFÖv—B"æ§6öâ‚“°¢†FFæ—FV×7ÇÅµÒ’æf÷$V6‚†WcÓç¶6öç7B6CÒ†Wbç7F'CòæFFWÇÆWbç7F'CòæFFUF–ÖWÇÂrr’ç6Æ–6RƒÃ“¶–b‚6B’&WGW&ã¶6öç7BF—FÆSÒ†Wbç7VÖÖ'—ÇÂrr’çFôÆ÷vW$66R‚“¶ÆWBF—óÒvö7WFòs¶–b‡F—FÆRæ–æ6ÇVFW2‚wf66–öâr’’F—óÒwf66–öæW2s¶VÇ6R–b‡F—FÆRæ–æ6ÇVFW2‚vW6VçFRr’’F—óÒvW6VçFRs¶VÇ6R–b‡F—FÆRæ–æ6ÇVFW2‚w&VÖ÷Fòr’’F—óÒw&VÖ÷Fòs¶VÇ6R–b‡F—FÆRæ–æ6ÇVFW2‚w&WVæ’r’’F—óÒw&WVæ–öâs°¢6öç7B3ÖæWrFFR‡6B²uC££r’ÆS#ÖæWrFFR‚†WbæVæCòæFFWÇÆWbæVæCòæFFUF–ÖWÇÇ6B’ç6Æ–6RƒÃ’²uC££r“°¢f÷"†ÆWBCÖæWrFFR‡2“¶CÃÖS#¶Bç6WDFFR†BævWDFFR‚’³’—¶6öç7BG3Öf×DFFR†æWrFFR†B’“¶–b†F–2ç6öÖR‡ƒÓæf×DFFR‡‚“ÓÓÖG2’—¶WV—õ7FFRæWfVçF÷5¶G·æ–GÕòG¶G7ÖÓ×·F—òÆFW63¦Wbç7VÖÖ'’Æ†÷&–æ–6–ó¢rrÆ†÷&f–ã¢rwÓ·F÷FÂ²³·××Ò“°¢Ö6F6‚†R—·Fö7B†W'&÷"7–æ2G·ææöÖ'&WÖÂvW'&÷"r“·Ğ¢Ğ¢Fö7B†)É2G·F÷FÇÒWfVçF÷2–×÷'FF÷6Âw7V66W72r“¶v—B6fTWV—ôWfVçF÷4—'F&ÆR‚“·&VæFW$WV—ô6ÆVæF"‚“¶'FâæF—6&ÆVCÖfÇ6S¶'FâçFW‡D6öçFVçCÒ	ùHB7–æ2s°§Ğ ¢òò)H)H4ôÄ”4•ETB•DTÕ2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâFövvÆUF—ôF–2‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷B×F—òÖF–2r“°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷B×F—òÖF–2Ö'Fâr“°¢–b‚–çÇÂ'Fâ’&WGW&ã°¢–b†–ççfÇVSÓÓÒtL8Ô2Œ8$”ÄU2r—°¢–ççfÇVSÒtL8Ô2äõ$ÔÄU2s°¢'FâçFW‡D6öçFVçCÒtL8Ô2äõ$ÔÄU2s°¢'Fâç7G–ÆRæ&6¶w&÷VæCÒw&v&ƒ#SRÃsÃÃãR’s°¢'Fâç7G–ÆRæ&÷&FW$6öÆ÷#Òw&v&ƒ#SRÃsÃÃãR’s°¢'Fâç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖ66VçC"’s°¢ÒVÇ6R°¢–ççfÇVSÒtL8Ô2Œ8$”ÄU2s°¢'FâçFW‡D6öçFVçCÒtL8Ô2Œ8$”ÄU2s°¢'Fâç7G–ÆRæ&6¶w&÷VæCÒw&v&ƒÃ#"Ã#BÃãR’s°¢'Fâç7G–ÆRæ&÷&FW$6öÆ÷#Òw&v&ƒÃ#"Ã#BÃãR’s°¢'Fâç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖ66VçB’s°¢Ğ§Ğ¦gVæ7F–öâFövvÆTVF—EF—ôF–2‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vVF—D6÷EF—ôF–2r“°¢6öç7B'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vVF—D6÷EF—ôF–4'Fâr“°¢–b‚–çÇÂ'Fâ’&WGW&ã°¢–b†–ççfÇVSÓÓÒtL8Ô2Œ8$”ÄU2r—°¢–ççfÇVSÒtL8Ô2äõ$ÔÄU2s¶'FâçFW‡D6öçFVçCÒtL8Ô2äõ$ÔÄU2s°¢'Fâç7G–ÆRæ&6¶w&÷VæCÒw&v&ƒ#SRÃsÃÃãR’s¶'Fâç7G–ÆRæ&÷&FW$6öÆ÷#Òw&v&ƒ#SRÃsÃÃãR’s¶'Fâç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖ66VçC"’s°¢ÒVÇ6R°¢–ççfÇVSÒtL8Ô2Œ8$”ÄU2s¶'FâçFW‡D6öçFVçCÒtL8Ô2Œ8$”ÄU2s°¢'Fâç7G–ÆRæ&6¶w&÷VæCÒw&v&ƒÃ#"Ã#BÃãR’s¶'Fâç7G–ÆRæ&÷&FW$6öÆ÷#Òw&v&ƒÃ#"Ã#BÃãR’s¶'Fâç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖ66VçB’s°¢Ğ§Ğ ¢òò)H)HÄ¤òDRTåE$Tt‡&ævòFRL:Ö2òfV6†f–¦’)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòVâÖ—6Öò6öçG&öÂVâVÂf÷&×VÆ&–òçVWfò‚væWrr’’VâVÂFRVF–6œ;6â‚vVF—Br’à¦6öç7B4õEõÄ¤õô”E3×°¢væWrs¢¶ÖöFó¢v6÷EÆ¦ôÖöFòrÆF–5w&¢v6÷EÆ¦ôF–5w&rÆfV6†w&¢v6÷EÆ¦ôfV6†w&rÆÖ–ã¢v6÷B×F–V×ò×&öBrÆÖƒ¢v6÷B×F–V×ò×&öBÖÖ‚rÇF—ó¢v6÷B×F—òÖF–2rÇF—ô'Fã¢v6÷B×F—òÖF–2Ö'FârÆfV6†¢v6÷BÖfV6†ÖVçG&VvrÆ'FäF–3¢v6÷EÆ¦ô'FäF–2rÆ'FäfV6†¢v6÷EÆ¦ô'FäfV6†wÒÀ¢vVF—Bs§¶ÖöFó¢vVF—D6÷EÆ¦ôÖöFòrÆF–5w&¢vVF—D6÷EÆ¦ôF–5w&rÆfV6†w&¢vVF—D6÷EÆ¦ôfV6†w&rÆÖ–ã¢vVF—D6÷EF–V×õ&öBrÆÖƒ¢vVF—D6÷EF–V×õ&öDÖ‚rÇF—ó¢vVF—D6÷EF—ôF–2rÇF—ô'Fã¢vVF—D6÷EF—ôF–4'FârÆfV6†¢vVF—D6÷DfV6†VçG&VvrÆ'FäF–3¢vVF—D6÷EÆ¦ô'FäF–2rÆ'FäfV6†¢vVF—D6÷EÆ¦ô'FäfV6†wĞ§Ó°¢òòÇFW&æVÂÖöFòFVÂ6öçG&öÃ¢vF–2r‡&ævòâÔÒ’òvfV6†r†fV6†f–¦’à¦gVæ7F–öâ6÷EÆ¦õ6WDÖöFò‡66÷RÆÖöFò—°¢6öç7B–G3Ô4õEõÄ¤õô”E5·66÷UÓ¶–b‚–G2—&WGW&ã¶ÖöFóÒ†ÖöFóÓÓÒvfV6†r“òvfV6†s¢vF–2s°¢6öç7B†–CÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2æÖöFò“¶–b††–B–†–BçfÇVSÖÖöFó°¢6öç7BGsÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2æF–5w&’ÆgsÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2æfV6†w&“°¢–b†Gr–Grç7G–ÆRæF—7Æ“Ò†ÖöFóÓÓÒvfV6†r“òvæöæRs¢vfÆW‚s°¢–b†gr–grç7G–ÆRæF—7Æ“Ò†ÖöFóÓÓÒvfV6†r“òvfÆW‚s¢væöæRs°¢µ¶–G2æ'FäF–2ÆÖöFóÓÓÒvF–2uÒÅ¶–G2æ'FäfV6†ÆÖöFóÓÓÒvfV6†uÕÒæf÷$V6‚‚…¶–BÆöåÒ“Óç¶6öç7B#ÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b‚"—&WGW&ã¶"ç7G–ÆRæ&6¶w&÷VæCÖöãòw&v&ƒÃ#"Ã#BÃã‚’s¢wG&ç7&VçBs¶"ç7G–ÆRæ&÷&FW$6öÆ÷#Ööãòw&v&ƒÃ#"Ã#BÃãSR’s¢wf"‚ÒÖ&÷&FW#"’s¶"ç7G–ÆRæ6öÆ÷#Ööãòwf"‚ÒÖ66VçB’s¢wf"‚Ò×FW‡C2’s·Ò“°§Ğ¢òò–çFVÂ&÷L;6âFRF—òFRL:Ö2†Œ:&–ÆW2öæ÷&ÖÆW2’6V|;¦âVÂfÆ÷"wV&FFòà¦gVæ7F–öâö6÷E–çFF—ôF–2†–G2ÇF—ò—°¢6öç7BFCÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2çF—ò“¶–b‡FB—FBçfÇVS×F—ó°¢6öç7BFF#ÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2çF—ô'Fâ“¶–b‚FF"—&WGW&ã°¢6öç7Bæ÷&ÓÒ‡F—óÓÓÒtL8Ô2äõ$ÔÄU2r“·FF"çFW‡D6öçFVçC×F—ó°¢FF"ç7G–ÆRæ&6¶w&÷VæCÖæ÷&Óòw&v&ƒ#SRÃsÃÃãR’s¢w&v&ƒÃ#"Ã#BÃãR’s°¢FF"ç7G–ÆRæ&÷&FW$6öÆ÷#Öæ÷&Óòw&v&ƒ#SRÃsÃÃãR’s¢w&v&ƒÃ#"Ã#BÃãR’s°¢FF"ç7G–ÆRæ6öÆ÷#Öæ÷&Óòwf"‚ÒÖ66VçC"’s¢wf"‚ÒÖ66VçB’s°§Ğ¢òò6&vÆ÷2fÆ÷&W2FRÆ¦òFRVâ&Vv—7G&ò†òf<:Öò’VâVÂ6öçG&öÂà¦gVæ7F–öâ6÷EÆ¦ôÆöB‡66÷RÆb—°¢6öç7B–G3Ô4õEõÄ¤õô”E5·66÷UÓ¶–b‚–G2—&WGW&ã¶cÖgÇÇ·Ó°¢6öç7B6WEcÒ†–BÇb“Óç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂçfÇVS×c·Ó°¢6WEb†–G2æÖ–âÆe²uF–V×òFR&öGV66œ;6âu×ÇÂrr“°¢6WEb†–G2æÖ‚Æe²uF–V×òFR&öGV66œ;6âÜ:‚u×ÇÂrr“°¢6WEb†–G2æfV6†Æe²tfV6†FRVçG&Vvu×ÇÂrr“°¢ö6÷E–çFF—ôF–2†–G2Æe²uF—òL:Ö2&öGV66œ;6âu×ÇÂtL8Ô2Œ8$”ÄU2r“°¢6÷EÆ¦õ6WDÖöFò‡66÷RÆe²tfV6†FRVçG&VvuÓòvfV6†s¢vF–2r“°§Ğ¢òò&\;¦æRÆ÷26×÷2FRÆ¦ò&—'F&ÆR6V|;¦âVÂÖöFò7F—fòà¢òòVâ6FÖöFòöæRVâçVÆÂÆ÷26×÷2FVÂ÷G&ò&VRÂ6Ö&–"FRÖöFò6RÆ–×–Vâà¦gVæ7F–öâ6÷EÆ¦ôf–VÆG2‡66÷R—°¢6öç7B–G3Ô4õEõÄ¤õô”E5·66÷UÓ°¢6öç7BÖöFóÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2æÖöFò“òçfÇVWÇÂvF–2s°¢–b†ÖöFóÓÓÒvfV6†r—°¢6öç7BfV6†ÖFö7VÖVçBævWDVÆVÖVçD'”–B†–G2æfV6†“òçfÇVWÇÂrs°¢&WGW&â²tfV6†FRVçG&Vvs¦fV6†ÇÆçVÆÂÂuF–V×òFR&öGV66œ;6âs¦çVÆÂÂuF–V×òFR&öGV66œ;6âÜ:‚s¦çVÆÂÂuF—òL:Ö2&öGV66œ;6âs¦çVÆÇÓ°¢Ğ¢6öç7BÖ–ã×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B†–G2æÖ–â“òçfÇVR—ÇÆçVÆÃ°¢ÆWBÖƒ×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B†–G2æÖ‚“òçfÇVR—ÇÆçVÆÃ°¢–b‚†Ö–âbfÖ‚bfÖƒæÖ–â’–ÖƒÖçVÆÃ²òòVÂÜ:†–Öò6öÆò7VVçF6’W2Ö–÷"VRVÂÜ:Öæ–Öğ¢&WGW&â²uF–V×òFR&öGV66œ;6âs¦Ö–âÂuF–V×òFR&öGV66œ;6âÜ:‚s¦Ö‚ÂuF—òL:Ö2&öGV66œ;6âs¦Ö–ãò†Fö7VÖVçBævWDVÆVÖVçD'”–B†–G2çF—ò“òçfÇVWÇÂtL8Ô2Œ8$”ÄU2r“¦çVÆÂÂtfV6†FRVçG&Vvs¦çVÆÇÓ°§Ğ ¦gVæ7F–öâFE6öÆ–6—GVD—FVÒ‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷B×6öÆ–6—GVBÖ–çr“¶6öç7BfÃÒ†–çòçfÇVWÇÂrr’çG&–Ò‚“¶–b‚fÂ’&WGW&ã°¢6öç7B6öçF–æW#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w6öÆ–6—GVD—FV×2r“¶6öç7B—FVÓÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢—FVÒæFF6WBçfÇVS×fÃ°¢—FVÒç7G–ÆRæ775FW‡CÒvF—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Wƒ·FF–æs£W‚ƒ¶föçB×6—¦S£'‚s°¢—FVÒæ–ææW$…DÔÃÖÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçB“¶fÆW‚×6‡&–æ³£#î(
#Â÷7ããÇ7â7G–ÆSÒ&fÆWƒ£#âG¶W66T‡FÖÂ‡fÂ—ÓÂ÷7ããÆ'WGFöâöæ6Æ–6³Ò'&VÖ÷fU6öÆ–6—GVD—FVÒ‡F†—2’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£7ƒ·FF–æs£¶Æ–æRÖ†V–v‡C£"öæÖ÷W6VVçFW#Ò'F†—2ç7G–ÆRæ6öÆ÷#Òwf"‚ÒÖFævW"’r"öæÖ÷W6VÆVfSÒ'F†—2ç7G–ÆRæ6öÆ÷#Òwf"‚Ò×FW‡C2’r#î)ÉSÂö'WGFöãæ°¢6öçF–æW"æVæD6†–ÆB†—FVÒ“¶–ççfÇVSÒrs·7–æ56öÆ–6—GVEFõFW‡F&V‚“¶–çæfö7W2‚“°§Ğ¦gVæ7F–öâ&VÖ÷fU6öÆ–6—GVD—FVÒ†'Fâ—¶'Fâæ6Æ÷6W7B‚u¶FF×fÇVUÒr’ç&VÖ÷fR‚“·7–æ56öÆ–6—GVEFõFW‡F&V‚“·Ğ¦gVæ7F–öâ7–æ56öÆ–6—GVEFõFW‡F&V‚—°¢6öç7B—FV×3Õ²ââæFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚r76öÆ–6—GVD—FV×2¶FF×fÇVUÒr•ÒæÖ†VÃÓâ~(
"r¶VÂæFF6WBçfÇVR“°¢6öç7BFÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷B×6öÆ–6—GVBr“¶–b‡F’FçfÇVSÖ—FV×2æ¦ö–â‚uÆâr“°§Ğ ¢òò)H)Hdõ$Ò„TÅU%2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâöä6Æ–VçFU6V&6„–çWB‚—°¢6öç7B–çÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFR×6V&6‚r’ÆG&÷F÷vãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖG&÷F÷vâr“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–Br’çfÇVSÒrs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–æfòr’çFW‡D6öçFVçCÒrs°¢6öç7BÖ–ççfÇVRçFôÆ÷vW$66R‚’çG&–Ò‚“¶6öç7B7&3×÷7FFRæ6Æ–VçFW2æf–ÇFW"†3Óâ‚†2æf–VÆG5²tV×&W6u×ÇÂrr’²rr²†2æf–VÆG5²t6öçF7Fòu×ÇÂrr’’çFôÆ÷vW$66R‚’æ–æ6ÇVFW2‡’’ç6Æ–6RƒÃ‚“§7FFRæ6Æ–VçFW2ç6Æ–6RƒÃb“°¢ÆWB‡FÖÃ×7&2æÖ†3ÓæÆF—b6Æ73Ò'6V&6‚×6VÆV7BÖ—FVÒ"öæ6Æ–6³Ò'6VÆV7D6Æ–VçFR‚rG¶2æ–GÒr’#ãÇ7G&öæsâG¶W66T‡FÖÂ†2æf–VÆG5²tV×&W6u×ÇÂ~(	Br—ÓÂ÷7G&öæsãÇ7â6Æ73Ò'FW‡BÖ×WFVBFW‡B×6ÖÆÂ"7G–ÆSÒ&Ö&v–âÖÆVgC£w‚#âG¶W66T‡FÖÂ†2æf–VÆG5²t6öçF7Fòu×ÇÂrr—ÓÂ÷7ããÂöF—cæ’æ¦ö–â‚rr“°¢–b‡bb7&2ç6öÖR†3Óâ†2æf–VÆG5²tV×&W6u×ÇÂrr’çFôÆ÷vW$66R‚“ÓÓ×’’‡FÖÂ³ÖÆF—b6Æ73Ò'6V&6‚×6VÆV7BÖ—FVÒ7&VFRÖæWr"öæ6Æ–6³Ò'6VÆV7D6Æ–VçFTæWr‚’#â²W6""G¶W66T‡FÖÂ†–ççfÇVR—Ò#ÂöF—cæ°¢G&÷F÷vâæ–ææW$…DÔÃÖ‡FÖÃ¶G&÷F÷vâæ6Æ74Æ—7BçFövvÆR‚v÷VârÂ‡FÖÂ“°§Ğ¦gVæ7F–öâ6VÆV7D6Æ–VçFR†–B—¶6öç7B3×7FFRæ6Æ–VçFW4'”–E&V5¶–EÓ¶–b‚2’&WGW&ã¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFR×6V&6‚r’çfÇVSÖ2æf–VÆG5²tV×&W6u×ÇÂrs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–Br’çfÇVSÖ–C¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖG&÷F÷vâr’æ6Æ74Æ—7Bç&VÖ÷fR‚v÷Vâr“¶6öç7BfVæ3Ö2æf–VÆG5²tf7GW&2fVæ6–F2u×ÇÃÆ–æfóÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–æfòr“¶6öç7B&Wd6÷G3×7FFRæ6÷F—¦6–öæW2æf–ÇFW"‡ƒÓç¶6öç7B6Ã×‚æf–VÆG5²t6Æ–VçFRuÓ·&WGW&â'&’æ—4'&’†6Â“ö6Âæ–æ6ÇVFW2†–B“¦6ÃÓÓÖ–C·Ò’ç6÷'B‚†Æ"“Óâ†"æf–VÆG5²tfV6†6÷F—¦6œ;6âu×ÇÆ"æ7&VFVEF–ÖWÇÂrr’æÆö6ÆT6ö×&R†æf–VÆG5²tfV6†6÷F—¦6œ;6âu×ÇÆæ7&VFVEF–ÖWÇÂrr’“¶6öç7B&Wd'Fã×&Wd6÷G2æÆVæwFƒöfæ'7³Æ'WGFöâG—SÒ&'WGFöâ"öæ6Æ–6³Ò&÷Vä6÷”6÷E–6¶W"‚vâr’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒcrÃ3’Ã#SÃã"“¶&÷&FW#£‚6öÆ–B&v&ƒcrÃ3’Ã#SÃã3R“¶&÷&FW"×&F—W3£Wƒ¶6öÆ÷#§f"‚ÒÖ66VçCB“¶föçB×6—¦S£ãWƒ¶föçB×vV–v‡C£s·FF–æs£'‚‡ƒ¶7W'6÷#§ö–çFW#·fW'F–6ÂÖÆ–vã¦Ö–FFÆR#ï	ù8²6÷BâçFW&–÷"‚G·&Wd6÷G2æÆVæwF‡Ò“Âö'WGFöãæ¢rs¶ÆWBFW65FsÒrs·G'—¶6öç7BCÒ‡G—VöböFW646Æ–VçFSÓÓÒvgVæ7F–öâr“õöFW646Æ–VçFR†–B“£¶–b†Cã—¶6öç7BF—63ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖFW67VVçFòr“¶–b†F—62bb‚F—62çfÇVWÇÇ'6TfÆöB†F—62çfÇVR“ÓÓÓ’—¶F—62çfÇVSÖC¶–b‡G—VöbWFFT—FV×5F÷FÃÓÓÒvgVæ7F–öâr—WFFT—FV×5F÷FÂ‚“·ÖFW65FsÖfæ'7³Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçCB“¶föçB×6—¦S£'‚#ï	øû~ûˆòG¶GÒRGFòâ6Æ–VçFSÂ÷7ãæ·×Ö6F6‚†R—·Ğ¢–æfòæ–ææW$…DÔÃÒ‡fVæ3ãÓ#öÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#î)ªG·fVæ7Òf7GW&2fVæ6–F3Â÷7ãæ¦Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"’#î)É26Æ–VçFR6VÆV66–öæFóÂ÷7ãæ’¶FW65Fr·&Wd'Fã·Ğ¦gVæ7F–öâ6VÆV7D6Æ–VçFTæWr‚—¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–Br’çfÇVSÒrs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖG&÷F÷vâr’æ6Æ74Æ—7Bç&VÖ÷fR‚v÷Vâr“·Ğ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÆSÓç¶–b‚RçF&vWBæ6Æ÷6W7B‚rç6V&6‚×6VÆV7B×w&r’’Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚rç6V&6‚×6VÆV7BÖG&÷F÷vâr’æf÷$V6‚†CÓæBæ6Æ74Æ—7Bç&VÖ÷fR‚v÷Vâr’“·Ò“°¦gVæ7F–öâ6ÆV$f÷&Ò‡G—R—°¢–b‡G—SÓÓÒvÆVBr—µ²væÂÖV×&W6rÂvæÂÖ6öçF7FòrÂvæÂÖ6&vòrÂvæÂ×FVÆVföæòrÂvæÂÖVÖ–ÂrÂvæÂ×'WBrÂvæÂ×vV"rÂvæÂÖæ÷F2rÂvæÂÖ6—VFBrÂvæÂÖF—&V66–öâuÒæf÷$V6‚†–CÓç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ’VÂçfÇVSÒrs·Ò“°¢G'—µöæÄV×6VÃÖçVÆÃµöæÄV×f÷&6SÖfÇ6S¶æÄV×&W66W'&"‚“¶6öç7BcÖFö7VÖVçBævWDVÆVÖVçD'”–B‚væÄV×&W6f—6òr“¶–b†b–bç7G–ÆRæF—7Æ“ÒvæöæRs·Ö6F6‚†R—·ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚væÂÖ÷&–vVâr’çfÇVSÒu&VfW&–Fòs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚væÂÖ–æGW7G&–r’çfÇVSÒrs¶6öç7Bç#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚væÂ×&Vv–öâr“¶–b†ç"’ç"çfÇVSÒrs¶6öç7Bæ3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚væÂÖ6ö×Vær“¶–b†æ2—¶æ2æ–ææW$…DÔÃÒsÆ÷F–öâfÇVSÒ"#î(	B6VÆV66–öæ"&Vvœ;6â&–ÖW&ò(	CÂö÷F–öãâs¶æ2æF—6&ÆVC×G'VS·×Ğ¢–b‡G—SÓÓÒv6÷Br—µ²v6÷BÖçVÒrÂv6÷BÖÆ–2rÂv6÷B×7V'F÷FÂrÂv6÷B×F÷FÂrÂv6÷B×6öÆ–6—GVBrÂv6÷B×6öÆ–6—GVBÖ–çrÂv6÷BÖæ÷F2rÂv6÷BÖ6Æ–VçFR×6V&6‚rÂv6÷BÖ6Æ–VçFRÖ–BrÂv6÷B×F–V×ò×&öBrÂv6÷B×F–V×ò×&öBÖÖ‚rÂv6÷BÖfV6†ÖVçG&VvrÂv6÷BÖfV6†ÖÆ–Ö—FRrÂv6÷BÖFW67VVçFòuÒæf÷$V6‚†–CÓç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ’VÂçfÇVSÖ–CÓÓÒv6÷BÖFW67VVçFòsòss¢rs·Ò“¶6öç7B6“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w6öÆ–6—GVD—FV×2r“¶–b‡6’’6’æ–ææW$…DÔÃÒrs¶6öç7BgÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖf÷&Ö×vòr“¶–b†g’gçfÇVSÒrs¶6öç7B7SÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷B×W&vVçFRr“¶–b†7R’7RçfÇVSÒvfÇ6Rs¶6öç7B6SÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖW7FFòÖ–æ–6–Âr“¶–b†6R–6RçfÇVSÒtVçf–Fs·G'—¶6÷EÆ¦ôÆöB‚væWrrÇ·Ò“·Ö6F6‚†R—·Ó¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖ–æfòr’çFW‡D6öçFVçCÒrs¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6÷BÖ6Æ–VçFRÖG&÷F÷vâr“òæ6Æ74Æ—7Bç&VÖ÷fR‚v÷Vâr“¶–æ—DFFW2‚“¶–æ—D—FV×46öçF–æW"‚“¶6öç7B36GÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ–æÆ–æR×æVÂr“¶–b†36G’36Gç7G–ÆRæF—7Æ“ÒvæöæRs´ö&¦V7BçfÇVW2…ö36D'Fç2‚’’æf÷$V6‚†#Óç¶–b†"–"ç7G–ÆRæ&6¶w&÷VæCÒrs·Ò“¶6öç7B36FÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v36BÖ’×–W¦2r“¶–b†36FÂ’36FÂæ–ææW$…DÔÃÒrs¶36E–W¦47F—f3ÕµÓ¶36E–W¦6÷VçFW#Óµ²vÇ7"rÂvæVòvÚ±î¸Â¸­yêë¢°k¢G§¦*^