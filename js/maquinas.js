/* js/maquinas.js — módulo extraído de index.html (carga en el mismo punto). */
// ── MÁQUINAS ──────────────────────────────────────────────────
function fmtDate(d){return d.toISOString().split('T')[0];}
function fmtDayLabel(d){return['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]+' '+d.getDate();}
function getMaquinaSemanaLunes(){const t=new Date();t.setHours(0,0,0,0);const day=t.getDay();const l=new Date(t);l.setDate(t.getDate()-(day===0?6:day-1)+(maquinaState.semanaOffset*7));return l;}
function navSemana(d){maquinaState.semanaOffset+=d;renderMaquinasCalendar();}
function goToday(){maquinaState.semanaOffset=0;renderMaquinasCalendar();}
function getMaquinaEstadoGlobal(id){const m=MAQUINAS.find(x=>x.id===id);return m?.estado||localStorage.getItem('estado_maq_'+id)||'disponible';}
async function toggleMaquinaEstado(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m) return;
  const nv=m.estado==='mantencion'?'disponible':'mantencion';
  m.estado=nv;
  localStorage.setItem('estado_maq_'+id,nv);
  renderMaquinasCalendar();
  toast(`${m.nombre} #${m.num}: ${nv==='mantencion'?'🔧 Mantención':'✓ Disponible'}`,nv==='mantencion'?'error':'success');
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

// ── PRINTER LIVE MONITOR ──────────────────────────────────────
const MOONRAKER_PORT=7125;
// Cadencia y tolerancia a fallos del monitor. El intervalo es mayor que el
// peor caso de un ciclo (timeouts más cortos + backoff) para que no se salten
// ciclos. El umbral de fallos evita marcar "Offline" por un hipo de red.
const _MONITOR_INTERVAL_MS=20000;   // sondeo base (el WebSocket lo hace casi irrelevante)
const _STATUS_TIMEOUT_MS=9000;      // túnel/WiFi lento del taller necesita margen (la histéresis evita falsos Offline)
const _THUMB_TIMEOUT_MS=2000;       // antes 3000
const _OFFLINE_AFTER_FAILS=3;       // fallos consecutivos antes de declarar Offline
function getPrinterTunnel(){const d=(!_DEFAULTS.PRINTER_TUNNEL||_DEFAULTS.PRINTER_TUNNEL.startsWith('%%'))?'https://printers.thelab.solutions':_DEFAULTS.PRINTER_TUNNEL;return(localStorage.getItem('printer_tunnel')||d).replace(/\/$/,'');}
function getPrinterTunnelToken(){const d=(_DEFAULTS.PRINTER_TUNNEL_TOKEN&&!_DEFAULTS.PRINTER_TUNNEL_TOKEN.startsWith('%%'))?_DEFAULTS.PRINTER_TUNNEL_TOKEN:'';return localStorage.getItem('printer_tunnel_token')||d;}
function _appendBridgeToken(u){const tk=getPrinterTunnelToken();return tk?u+(u.includes('?')?'&':'?')+'bt='+encodeURIComponent(tk):u;}
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
// Webcam: en modo remoto reescribe http://IP_LAN:PUERTO/ruta → túnel /{ip}:{puerto}/ruta
function printerCamUrl(id){
  const raw=localStorage.getItem('printer_cam_'+id)||(typeof MAQUINAS!=='undefined'?(MAQUINAS.find(x=>x.id===id)||{}).cam:'')||'';if(!raw)return'';
  if(typeof _isLocalMode==='function'&&_isLocalMode())return raw;
  const mm=raw.match(/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?(\/.*)?$/);
  if(!mm)return raw;
  return _appendBridgeToken(`${getPrinterTunnel()}/${mm[1]}:${mm[2]||'80'}${mm[3]||'/'}`);
}
// Cámaras tipo "snapshot" (p.ej. go2rtc /api/frame.jpeg de las K2, que no dan
// MJPEG): el <img> con data-snap se refresca solo cada ~1s para simular video.
function _camIsSnapshot(raw){return /\/api\/frame\.jpe?g/i.test(raw||'');}
let _camSnapInterval=null;
function _refreshSnapshotCams(){
  if(document.hidden)return;
  document.querySelectorAll('img[data-snap]').forEach(im=>{
    if(im.offsetParent===null)return;            // saltar las ocultas (otra sección / modal cerrado)
    const base=im.getAttribute('data-snap');if(!base)return;
    im.src=base+(base.includes('?')?'&':'?')+'_='+Date.now();
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
let _wsRpcId=0,_wsRenderTimer=null;
// ── Print queue ──────────────────────────────────────────────
const _printQueue={};// { [printerId]: [{gcode,filename,secs,grams},...] }
function _queueGet(id){return _printQueue[id]||(_printQueue[id]=[]);}
function _queueCount(id){return(_printQueue[id]||[]).length;}
function _queueAdd(id,gcode,filename,secs,grams){
  _queueGet(id).push({gcode,filename,secs,grams,added:Date.now()});
  toast(`📋 Encolado en ${(MAQUINAS.find(m=>m.id===id)||{}).nombre||id} (#${_queueCount(id)} en cola)`,'success');
  renderMonitorGrid();
}
async function _queueStartNext(id){
  const q=_printQueue[id];if(!q||!q.length)return;
  const job=q.shift();renderMonitorGrid();
  const m=MAQUINAS.find(x=>x.id===id);const ip=getPrinterIp(m);if(!ip)return;
  try{
    const fd=new FormData();
    fd.append('file',new Blob([job.gcode],{type:'text/plain'}),job.filename);
    fd.append('root','gcodes');
    const xhr=new XMLHttpRequest();
    xhr.open('POST',printerUrl(ip,'/server/files/upload'));
    const hdrs=getPrinterAuthHeaders(id);for(const k in hdrs)xhr.setRequestHeader(k,hdrs[k]);
    xhr.onload=async()=>{
      if(xhr.status>=200&&xhr.status<300){
        await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(job.filename)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});
        toast(`▶ Cola: iniciando ${job.filename} en ${m?.nombre||id}`,'success');
        if(typeof pollPrinters==='function')pollPrinters();
      }else toast('Cola: error al subir siguiente trabajo','error');
    };
    xhr.onerror=()=>toast('Cola: impresora inaccesible','error');
    xhr.send(fd);
  }catch(e){toast('Cola: '+e.message,'error');}
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
function getPrinterApiKey(id){return localStorage.getItem('printer_key_'+id)||'';}
function getPrinterAuthHeaders(id){const k=getPrinterApiKey(id);return k?{'X-Api-Key':k}:{};}

function savePrinterIp(id){
  const inp=document.getElementById('ipin_'+id);const val=(inp?.value||'').trim();if(!val)return;
  localStorage.setItem('printer_ip_'+id,val);
  const m=MAQUINAS.find(x=>x.id===id);
  if(m){m.ip=val;if(m._airtableId){if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:val}})});}}
  toast(`IP guardada · ${m?.nombre} #${m?.numG}`,'success');pollPrinters();
  if(m)connectPrinterWs(m);
}

function savePrinterApiKey(id){
  const inp=document.getElementById('ipkey_'+id);if(!inp)return;
  const val=inp.value.trim();
  if(val)localStorage.setItem('printer_key_'+id,val);else localStorage.removeItem('printer_key_'+id);
  const m=MAQUINAS.find(x=>x.id===id);
  toast(`API Key ${val?'guardada':'eliminada'} · ${m?.nombre} #${m?.numG}`,'success');
}

function openPrinterConnModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('printerConnTitle').textContent=`${m.nombre} #${m.numG}`;
  document.getElementById('printerConnId').value=id;
  document.getElementById('printerConnIp').value=getPrinterIp(m)||'';
  document.getElementById('printerConnKey').value=getPrinterApiKey(id);
  document.getElementById('printerConnModal').style.display='flex';
}
function closePrinterConnModal(){document.getElementById('printerConnModal').style.display='none';}
function savePrinterConn(){
  const id=document.getElementById('printerConnId').value;
  const ip=(document.getElementById('printerConnIp').value||'').trim();
  const key=(document.getElementById('printerConnKey').value||'').trim();
  if(ip)localStorage.setItem('printer_ip_'+id,ip);else localStorage.removeItem('printer_ip_'+id);
  if(key)localStorage.setItem('printer_key_'+id,key);else localStorage.removeItem('printer_key_'+id);
  const m=MAQUINAS.find(x=>x.id===id);
  if(m&&m._airtableId){m.ip=ip||m.ip;if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{ip:ip||''}})});}
  closePrinterConnModal();
  toast(`Conexión guardada · ${m?.nombre} #${m?.numG}`,'success');
  pollPrinters();
  if(m){_wsConnected[m.id]=false;connectPrinterWs(m);}
}

// Deriva el estado mostrable a partir de los objetos crudos de Moonraker
// (status = {print_stats, virtual_sdcard, heater_bed, extruder, webhooks, …}).
// Es puro/síncrono para reusarlo igual desde el polling REST y desde el WebSocket.
function _deriveStatus(m,s,ip){
  const ps=s.print_stats||{},vs=s.virtual_sdcard||{},hb=s.heater_bed||{},ex=s.extruder||{},wh=s.webhooks||{};
  // Estado real del firmware Klipper. Si está "shutdown"/"error" la impresora
  // dejó de imprimir y NO reporta sensores (todo 0) → hay que reiniciar el firmware.
  const klState=wh.state||'ready';
  let klMsg='';
  if(wh.state_message){
    try{const j=JSON.parse(wh.state_message);klMsg=j.msg||wh.state_message;}catch(_){klMsg=wh.state_message;}
    klMsg=String(klMsg).split('\n').map(x=>x.trim()).filter(Boolean)[0]||'';
  }
  const progress=Math.round((vs.progress||0)*100);
  const elapsed=ps.print_duration||0;
  const eta=progress>0&&progress<100?Math.round(elapsed/progress*(100-progress)):0;
  const filename=(ps.filename||'').replace(/\.gcode$/i,'');
  const filamentMm=Math.round(ps.filament_used||0);
  // Klipper caído o iniciando manda sobre el estado del print
  let state=ps.state||'standby';
  if(klState==='shutdown'||klState==='error')state='shutdown';
  else if(klState==='startup')state='startup';
  return{state,klState,klMsg,progress,filename,filamentMm,hotend:{actual:Math.round(ex.temperature||0),target:Math.round(ex.target||0)},bed:{actual:Math.round(hb.temperature||0),target:Math.round(hb.target||0)},elapsed,eta,ip};
}
// Miniatura del trabajo en curso (cacheada por archivo). Devuelve la URL o null.
async function _ensureThumb(m,ip,st){
  if(!((st.state==='printing'||st.state==='paused')&&st.filename))return st.thumbUrl||null;
  const ck=m.id+'::'+st.filename;
  if(_thumbCache[ck]!==undefined)return _thumbCache[ck];
  let thumbUrl=null;
  try{
    const tr=await fetch(printerUrl(ip,`/server/files/thumbnails?filename=${encodeURIComponent(st.filename+'.gcode')}`),{signal:AbortSignal.timeout(_THUMB_TIMEOUT_MS),headers:getPrinterAuthHeaders(m.id)});
    if(tr.ok){const td=await tr.json();const best=(td.result||[]).sort((a,b)=>b.size-a.size)[0];thumbUrl=best?printerUrl(ip,`/server/files/gcodes/.thumbnails/${best.relative_path}`):null;}
  }catch(e){}
  _thumbCache[ck]=thumbUrl;
  return thumbUrl;
}
async function fetchPrinterStatus(m){
  const ip=getPrinterIp(m);if(!ip)return{state:'noip'};
  const headers=getPrinterAuthHeaders(m.id);
  try{
    const r=await fetch(printerUrl(ip,`/printer/objects/query?print_stats&heater_bed&extruder&display_status&virtual_sdcard&webhooks`),{signal:AbortSignal.timeout(_STATUS_TIMEOUT_MS),headers});
    if(!r.ok)return{state:'offline',_fetchFail:true,ip};
    const d=await r.json();const s=d.result?.status||{};
    const st=_deriveStatus(m,s,ip);
    st.thumbUrl=await _ensureThumb(m,ip,st);
    return st;
  }catch(e){return{state:'offline',_fetchFail:true,ip};}
}

// ── Estado en vivo por WebSocket (Moonraker) ──────────────────────────────
// Moonraker empuja notify_status_update por /websocket (lo mismo que usan
// Fluidd/Mainsail). En remoto el bridge hace de proxy WS. Esto da estado en
// tiempo real SIN sondear; si el WS se cae, el polling toma el relevo solo.
// Desactivable con localStorage 'printer_ws_enabled'='0'.
function _wsEnabled(){if(window._DEMO_MODE)return false;const ov=localStorage.getItem('printer_ws_enabled');if(ov!==null)return ov!=='0';return (typeof _isLocalMode==='function')?_isLocalMode():true;/* por defecto WS solo en modo local; en remoto el WS del túnel es inestable, se usa polling */}
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
  if(st.hotend){if(!_tempHistory[m.id])_tempHistory[m.id]=[];_tempHistory[m.id].push({h:st.hotend.actual,b:st.bed?.actual||0});if(_tempHistory[m.id].length>20)_tempHistory[m.id].shift();}
  _ensureThumb(m,ip,st).then(t=>{if(t&&_printerStatus[m.id]&&_printerStatus[m.id].thumbUrl!==t){_printerStatus[m.id].thumbUrl=t;_wsScheduleRender();}});
  _wsScheduleRender();
}
function connectPrinterWs(m){
  if(!_wsEnabled())return;
  const ip=getPrinterIp(m);if(!ip)return;
  if(typeof WebSocket==='undefined')return;
  if(_wsConn[m.id]){try{_wsConn[m.id].onclose=null;_wsConn[m.id].close();}catch(e){}_wsConn[m.id]=null;}
  let ws;
  try{ws=new WebSocket(_printerWsUrl(ip));}catch(e){return;}
  _wsConn[m.id]=ws;
  ws.onopen=()=>{try{ws.send(JSON.stringify({jsonrpc:'2.0',method:'printer.objects.subscribe',params:{objects:{print_stats:null,heater_bed:null,extruder:null,display_status:null,virtual_sdcard:null,webhooks:null}},id:++_wsRpcId}));}catch(e){}};
  ws.onmessage=ev=>{
    let msg;try{msg=JSON.parse(ev.data);}catch(e){return;}
    let status=null;
    if(msg.result&&msg.result.status)status=msg.result.status;                              // respuesta a subscribe/query
    else if(msg.method==='notify_status_update'&&Array.isArray(msg.params))status=msg.params[0]; // push en vivo
    if(status&&typeof status==='object')_wsMergeStatus(m,ip,status);
  };
  ws.onerror=()=>{try{ws.close();}catch(e){}};
  ws.onclose=()=>{if(_wsConn[m.id]===ws)_wsConn[m.id]=null;_wsConnected[m.id]=false;_scheduleWsReconnect(m);};
}
function _scheduleWsReconnect(m){
  if(!_wsEnabled())return;
  const n=(_wsAttempts[m.id]=(_wsAttempts[m.id]||0)+1);
  const delay=Math.min(30000,1000*Math.pow(2,Math.min(n,5)))+Math.floor(Math.random()*1000);
  clearTimeout(_wsTimers[m.id]);
  _wsTimers[m.id]=setTimeout(()=>{if(!document.hidden&&getPrinterIp(m))connectPrinterWs(m);},delay);
}
function connectAllPrinterWs(){if(!_wsEnabled())return;MAQUINAS.forEach(m=>{if(getPrinterIp(m))connectPrinterWs(m);});}
function disconnectAllPrinterWs(){
  MAQUINAS.forEach(m=>{
    clearTimeout(_wsTimers[m.id]);
    const ws=_wsConn[m.id];if(ws){try{ws.onclose=null;ws.close();}catch(e){}}
    _wsConn[m.id]=null;_wsConnected[m.id]=false;_wsRaw[m.id]=null;_wsAttempts[m.id]=0;
  });
}
function reconnectAllPrinterWs(){disconnectAllPrinterWs();connectAllPrinterWs();}

function fmtSecs(s){if(!s||s<=0)return'—';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;}

function printerStateMeta(state){
  return({
    printing:{label:'Imprimiendo',color:'#00d4aa',bg:'rgba(0,212,170,0.15)'},
    paused:{label:'Pausado',color:'#ffaa00',bg:'rgba(255,170,0,0.15)'},
    error:{label:'Error',color:'#ff4444',bg:'rgba(255,68,68,0.15)'},
    complete:{label:'Completado',color:'#a78bfa',bg:'rgba(167,139,250,0.15)'},
    standby:{label:'Idle',color:'var(--text3)',bg:'var(--surface2)'},
    shutdown:{label:'⚠ Detenida',color:'#ff4444',bg:'rgba(255,68,68,0.15)'},
    startup:{label:'Iniciando…',color:'#ffaa00',bg:'rgba(255,170,0,0.12)'},
    offline:{label:'Offline',color:'#888',bg:'rgba(120,120,120,0.12)'},
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
  el.innerHTML=MONITOR_GRUPOS.map(g=>{
    const active=_monitorFilter===g.key;
    const count=g.key==='all'?MAQUINAS.length:MAQUINAS.filter(m=>m.modelo===g.key).length;
    return`<button onclick="filterMonitor('${g.key}')" style="display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;border:1px solid ${active?g.color:'var(--border2)'};background:${active?g.color+'22':'var(--surface2)'};color:${active?g.color:'var(--text3)'};font-size:11px;font-weight:${active?700:500};cursor:pointer;transition:all 0.15s">${g.label}<span style="background:${active?g.color+'33':'var(--surface3)'};border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700">${count}</span></button>`;
  }).join('');
}

function filterMonitor(grupo){_monitorFilter=grupo;renderMonitorFilterTabs();renderMonitorKPIs();renderMonitorGrid();}

function renderMonitorKPIs(){
  const el=document.getElementById('monitorKPIs');if(!el)return;
  const lista=_monitorFilter==='all'?MAQUINAS:MAQUINAS.filter(m=>m.modelo===_monitorFilter);
  let printing=0,paused=0,idle=0,error=0,down=0,offline=0,noip=0;
  lista.forEach(m=>{const st=(_printerStatus[m.id]||{}).state||'offline';if(st==='printing')printing++;else if(st==='paused')paused++;else if(st==='error')error++;else if(st==='shutdown')down++;else if(st==='noip')noip++;else if(st==='offline')offline++;else idle++;});
  const total=lista.length,utilPct=total>0?Math.round((printing+paused)/total*100):0;
  el.innerHTML=`<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--surface);border:1px solid var(--border2);border-radius:10px;font-size:11px">
    ${printing>0?`<span style="color:#00d4aa;font-weight:700">🟢 ${printing} Imprimiendo</span>`:''}
    ${paused>0?`<span style="color:#ffaa00;font-weight:700">⏸ ${paused} Pausado</span>`:''}
    ${idle>0?`<span style="color:var(--text3)">⚪ ${idle} Idle</span>`:''}
    ${error>0?`<span style="color:#ff4444;font-weight:700">🔴 ${error} Error</span>`:''}
    ${down>0?`<span style="color:#ff4444;font-weight:700">⚠ ${down} Detenida${down>1?'s':''} (Klipper)</span>`:''}
    ${offline>0?`<span style="color:#888">⚫ ${offline} Offline</span>`:''}
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
  const clasif=st=>st==='printing'?'print':st==='paused'?'paused':(st==='error'||st==='shutdown')?'error':(st==='offline'||st==='noip')?'off':'idle';
  const rows=lista.map(m=>{const s=_printerStatus[m.id]||{state:'offline'};return{m,s,k:clasif(s.state),eta:(s.state==='printing'&&s.eta>0)?s.eta:0};});
  const etas=rows.filter(r=>r.eta>0).map(r=>r.eta);
  const horizon=Math.max(4*3600,Math.min(12*3600,etas.length?Math.max(...etas)*1.15:4*3600));
  const libres=rows.filter(r=>r.k==='idle').length;
  const imprimiendo=rows.filter(r=>r.k==='print').length;
  const hhmm=seg=>new Date(Date.now()+seg*1000).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  const proxima=etas.length?hhmm(Math.min(...etas)):null;
  // Eje: marcas de hora sobre el horizonte
  const marks=[];const stepH=horizon>6*3600?2:1;
  for(let hh=stepH;hh*3600<horizon;hh+=stepH) marks.push(`<span style="position:absolute;left:${(hh*3600/horizon*100).toFixed(1)}%;transform:translateX(-50%);font-size:8.5px;color:var(--text3)">+${hh}h</span>`);
  const fila=r=>{
    const nom=`${escapeHtml(r.m.nombre||'—')} <span style="color:var(--text3)">#${r.m.numG||r.m.num||''}</span>`;
    let bar='',lbl='';
    if(r.k==='print'&&r.eta>0){
      const w=Math.min(100,r.eta/horizon*100).toFixed(1);
      const pct=(typeof r.s.progress==='number'&&r.s.progress>=0)?Math.round(r.s.progress<=1?r.s.progress*100:r.s.progress):null;
      bar=`<div title="${escapeHtml(r.s.filename||'Imprimiendo')}${pct!=null?' · '+pct+'%':''}" style="height:100%;width:${w}%;background:linear-gradient(90deg,#00d4aa,#00d4cc);border-radius:5px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;min-width:52px"><span style="font-size:9px;font-weight:700;color:#04121a;white-space:nowrap">${pct!=null?pct+'% · ':''}libre ${hhmm(r.eta)}</span></div>`;
      lbl=`<span style="color:#00d4aa">🟢</span>`;
    }else if(r.k==='print'){
      bar=`<div title="Imprimiendo — sin ETA del bridge" style="height:100%;width:100%;background:repeating-linear-gradient(45deg,rgba(0,212,170,0.5),rgba(0,212,170,0.5) 8px,rgba(0,212,170,0.25) 8px,rgba(0,212,170,0.25) 16px);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:9px;font-weight:700;color:#04121a">en curso · sin ETA</span></div>`;
      lbl=`<span style="color:#00d4aa">🟢</span>`;
    }else if(r.k==='paused'){
      bar=`<div style="height:100%;width:45%;background:rgba(255,170,0,0.6);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:9px;font-weight:700;color:#1a1206">⏸ en pausa</span></div>`;
      lbl=`<span style="color:#ffaa00">⏸</span>`;
    }else if(r.k==='error'){
      bar=`<div style="height:100%;width:100%;background:rgba(255,68,68,0.14);border:1px dashed rgba(255,68,68,0.5);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:9px;font-weight:700;color:var(--danger)">⚠ con falla — revisar</span></div>`;
      lbl=`<span style="color:var(--danger)">🔴</span>`;
    }else if(r.k==='off'){
      bar=`<div style="height:100%;width:100%;background:var(--surface3);border-radius:5px;display:flex;align-items:center;padding-left:8px;opacity:.55"><span style="font-size:9px;color:var(--text3)">sin conexión</span></div>`;
      lbl=`<span style="color:var(--text3)">⚫</span>`;
    }else{
      bar=`<div style="height:100%;width:100%;background:rgba(0,212,170,0.08);border:1px dashed rgba(0,212,170,0.35);border-radius:5px;display:flex;align-items:center;padding-left:8px"><span style="font-size:9px;font-weight:700;color:#00d4aa">✓ libre ahora</span></div>`;
      lbl=`<span style="color:#00d4aa">⚪</span>`;
    }
    return`<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
      <span style="flex-shrink:0;width:14px;text-align:center;font-size:11px">${lbl}</span>
      <span style="flex-shrink:0;width:158px;font-size:10.5px;font-weight:600;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nom}</span>
      <div style="flex:1;height:20px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:2px;position:relative">${bar}</div>
    </div>`;
  };
  el.style.display='';
  el.innerHTML=`<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--text)">⏱️ Ocupación de máquinas</span>
      <span style="font-size:10px;color:var(--text3)">${libres} libre${libres!==1?'s':''} ahora · ${imprimiendo} imprimiendo${proxima?' · próxima máquina libre ~'+proxima:''}</span>
    </div>
    <div style="position:relative;height:12px;margin:0 0 4px 181px">${marks.join('')}</div>
    ${rows.sort((a,b)=>(a.eta||(a.k==='idle'?-1:1e9))-(b.eta||(b.k==='idle'?-1:1e9))).map(fila).join('')}`;
}

function renderMonitorGrid(){
  const el=document.getElementById('maquinaMonGrid');if(!el)return;
  const base=_monitorFilter==='all'?MAQUINAS:MAQUINAS.filter(m=>m.modelo===_monitorFilter);
  const lista=sortedList(base);
  const __cards=lista.map(m=>{
    const s=_printerStatus[m.id]||{state:'offline'};
    const sm=printerStateMeta(s.state);
    const ip=getPrinterIp(m);
    const _rawCam=localStorage.getItem('printer_cam_'+m.id)||m.cam;
    const _camU=_rawCam?printerCamUrl(m.id):'';
    const _camSnap=_camIsSnapshot(_rawCam);
    const img=MODELO_IMGS[m.modelo]||'';
    const isPrinting=s.state==='printing';
    const isPaused=s.state==='paused';
    const isActive=isPrinting||isPaused;
    const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);
    const hist=getHistoryForPrinter(m.id);
    const th=_tempHistory[m.id]||[];
    const maintAlerts=getMaintAlerts(m);
    const idleHours=getIdleHours(m.id,s.state);
    const idleWarn=idleHours>0;
    // La cámara se monta en un nodo aparte y persistente (no se recrea en cada
    // ciclo) para que el stream no parpadee. camKey cambia solo si cambia la URL.
    const showCam=!(s.state==='noip'||s.state==='offline'||s.state==='shutdown');
    const camKey=(_rawCam&&showCam)?(_camU+'|'+(_camSnap?'s':'m')):'';
    // Huella estructural: SOLO lo que cambia qué ramas se dibujan. Excluye
    // progreso/eta/temperaturas (se parchean en vivo) → la tarjeta no se
    // reconstruye cada 15s mientras imprime, evitando el parpadeo.
    const structFP=[s.state,s.stale?1:0,s.filename||'',s.thumbUrl?1:0,isActive?1:0,isPrinting?1:0,isPaused?1:0,s.hotend?.target||0,s.bed?.target||0,maintAlerts.length,idleWarn?1:0,idleHours,ip||'',getPrinterApiKey(m.id)?1:0,_queueCount(m.id),hist.length,(_rawCam?1:0),(th.length>=2?1:0)].join('~');

    let body='';
    if(s.state==='noip'){
      body=`<div style="margin-top:10px">
        <div style="font-size:10px;color:var(--text3);margin-bottom:6px;font-weight:600">Conexión OrcaSlicer / Moonraker</div>
        <div style="display:flex;gap:6px;margin-bottom:6px"><input id="ipin_${m.id}" type="text" placeholder="IP  192.168.100.xxx" style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;color:var(--text);font-size:11px;font-family:monospace;min-width:0">
        <button onclick="savePrinterIp('${m.id}')" style="background:var(--accent);color:#000;border:none;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">OK</button></div>
        <div style="display:flex;gap:6px"><input id="ipkey_${m.id}" type="password" placeholder="API Key (opcional)" value="${getPrinterApiKey(m.id)}" style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 8px;color:var(--text);font-size:11px;font-family:monospace;min-width:0">
        <button onclick="savePrinterApiKey('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;flex-shrink:0;color:var(--text3)">Key</button></div>
      </div>`;
    } else if(s.state==='offline'){
      body=`<div style="margin-top:12px;text-align:center;color:var(--text3);font-size:11px;padding:8px 0">Sin respuesta<br><span style="font-family:monospace;font-size:10px">${ip}</span><br><span style="font-size:10px">Verifica que esté encendida</span></div>`;
    } else if(s.state==='shutdown'){
      body=`<div style="margin-top:10px;padding:10px;background:rgba(255,68,68,0.08);border:1px solid rgba(255,68,68,0.3);border-radius:8px">
        <div style="font-size:11px;color:#ff6b6b;font-weight:700;margin-bottom:4px">⚠ Klipper detenido</div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:9px;line-height:1.4">${escapeHtml(s.klMsg||'La impresora reportó un error y se detuvo. La impresión en curso se interrumpió.')}</div>
        <button onclick="printerFirmwareRestart('${m.id}')" style="width:100%;background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.45);color:#ff6b6b;border-radius:7px;padding:7px;font-size:11px;font-weight:700;cursor:pointer">🔄 Reiniciar firmware</button>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span style="font-size:9px;color:var(--text3);font-family:monospace">${ip}</span>
          <div style="display:flex;gap:4px">
            <button onclick="openPrinterConnModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Configurar IP y API Key">⚙</button>
            <button onclick="openWebcamModal('${m.id}')" style="background:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.12)':'var(--surface2)'};border:1px solid ${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.3)':'var(--border2)'};border-radius:6px;color:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'var(--accent)':'var(--text3)'};font-size:10px;padding:3px 7px;cursor:pointer" title="Configurar webcam">📷</button>
            <button onclick="openHistoryModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Historial ${hist.length} registros">📋${hist.length>0?` <span style="color:var(--accent);font-weight:700">${hist.length}</span>`:''}</button>
          </div>
        </div>
      </div>`;
    } else {
      body=`
        ${isActive?`<div style="margin:10px 0 6px;display:flex;gap:9px;align-items:center">
          ${s.thumbUrl?`<img loading="lazy" decoding="async" src="${s.thumbUrl}" style="width:54px;height:54px;object-fit:cover;border-radius:8px;background:var(--surface2);flex-shrink:0" onerror="this.style.display='none'">`:''}
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px" title="${escapeHtml(s.filename)}">${escapeHtml(s.filename||'—')}</div>
            <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:5px">
              <span class="pbig" id="pbig_${m.id}" style="font-size:22px;font-weight:800;color:${sm.color}">${s.progress}%</span>
              <span id="peta_${m.id}" style="font-size:10px;color:var(--text3);margin-left:auto">⏱ ${fmtSecs(s.eta)} restante</span>
            </div>
            <div class="pbar ${isPrinting?'live':''}"><i id="pbar_${m.id}" style="width:${s.progress}%"></i></div>
          </div>
        </div>`:''}
        <div style="display:flex;gap:6px;margin-top:8px">
          <div style="flex:1;background:var(--surface2);border-radius:7px;padding:7px;text-align:center">
            <div style="font-size:9px;color:var(--text3);letter-spacing:.5px;margin-bottom:2px">HOTEND</div>
            <div class="ptemp" id="phot_${m.id}" style="font-size:17px;font-weight:700;color:${s.hotend?.target>0?'#ff6b35':'var(--text)'};line-height:1">${s.hotend?.actual||0}°</div>
            <div style="font-size:9px;color:var(--text3);margin-top:2px">${s.hotend?.target>0?'→ '+s.hotend.target+'°':'fría'}</div>
          </div>
          <div style="flex:1;background:var(--surface2);border-radius:7px;padding:7px;text-align:center">
            <div style="font-size:9px;color:var(--text3);letter-spacing:.5px;margin-bottom:2px">CAMA</div>
            <div class="ptemp" id="pbed_${m.id}" style="font-size:17px;font-weight:700;color:${s.bed?.target>0?'#ffaa00':'var(--text)'};line-height:1">${s.bed?.actual||0}°</div>
            <div style="font-size:9px;color:var(--text3);margin-top:2px">${s.bed?.target>0?'→ '+s.bed.target+'°':'fría'}</div>
          </div>
        </div>
        ${isActive?`<div style="display:flex;gap:6px;margin-top:8px">
          ${isPrinting?`<button onclick="printerControl('${m.id}','pause')" style="flex:1;background:rgba(255,170,0,0.15);border:1px solid rgba(255,170,0,0.4);color:#ffaa00;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer">⏸ Pausar</button>`:''}
          ${isPaused?`<button onclick="printerControl('${m.id}','resume')" style="flex:1;background:rgba(0,212,170,0.15);border:1px solid rgba(0,212,170,0.4);color:#00d4aa;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer">▶ Reanudar</button>`:''}
          <button onclick="printerControl('${m.id}','cancel')" style="flex:1;background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.35);color:#ff4444;border-radius:7px;padding:6px;font-size:11px;font-weight:700;cursor:pointer">■ Cancelar</button>
        </div>`:''}
        ${th.length>=2?`<div style="margin-top:8px;padding:6px 8px;background:var(--surface2);border-radius:7px">
          <div style="font-size:9px;color:var(--text3);margin-bottom:3px">Temperatura hotend</div>
          <div id="pspark_${m.id}">${renderSparkline(th,'h','#ff6b35')}</div>
        </div>`:''}
        <div class="pcard-iprow" style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
          <span style="font-size:9px;color:var(--text3);font-family:monospace">${ip}${getPrinterApiKey(m.id)?` <span style="color:var(--accent3)" title="API Key configurada">🔑</span>`:''}</span>
          <div class="pcard-actions" style="display:flex;gap:4px">
            <button onclick="openPrinterControl('${m.id}')" style="background:${isActive?'rgba(0,212,170,0.12)':'var(--surface2)'};border:1px solid ${isActive?'rgba(0,212,170,0.35)':'var(--border2)'};border-radius:6px;color:${isActive?'var(--accent)':'var(--text3)'};font-size:10px;padding:3px 7px;cursor:pointer" title="Control de impresora">🎛️</button>
            <button onclick="openGcodeUpload('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Enviar G-code">📤</button>
            <button onclick="openPrinterConnModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Configurar IP y API Key">⚙</button>
            <button onclick="openWebcamModal('${m.id}')" style="background:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.12)':'var(--surface2)'};border:1px solid ${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'rgba(0,212,204,0.3)':'var(--border2)'};border-radius:6px;color:${(localStorage.getItem('printer_cam_'+m.id)||m.cam)?'var(--accent)':'var(--text3)'};font-size:10px;padding:3px 7px;cursor:pointer" title="Configurar webcam">📷</button>
            <button onclick="openBedMesh('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Bed mesh (mapa de nivelación de cama)">🗺️</button>
            <button onclick="openHistoryModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:3px 7px;cursor:pointer" title="Historial ${hist.length} registros">📋${hist.length>0?` <span style="color:var(--accent);font-weight:700">${hist.length}</span>`:''}  </button>
            ${_queueCount(m.id)>0?`<button onclick="openQueueModal('${m.id}')" style="background:rgba(255,170,0,0.12);border:1px solid rgba(255,170,0,0.4);border-radius:6px;color:#ffaa00;font-size:10px;padding:3px 7px;cursor:pointer" title="${_queueCount(m.id)} trabajo(s) en cola">🔁 ${_queueCount(m.id)}</button>`:''}
          </div>
        </div>`;
    }

    const cardHtml=`<div id="mcard_${m.id}" class="pcard${isActive?' active':''}${s.stale?' stale':''}" style="--acc:${sm.color};background:var(--surface);border:1px solid ${maintAlerts.length?'rgba(255,170,0,0.4)':isActive?sm.color+'55':'var(--border2)'};border-top:3px solid ${gc?.color||'var(--border2)'};border-radius:13px;padding:13px;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px">
        ${img?`<img loading="lazy" decoding="async" src="${img}" style="width:34px;height:34px;object-fit:contain;border-radius:7px;background:var(--surface2);flex-shrink:0" onerror="this.style.display='none'">`:''}
        <div style="flex:1;min-width:0">
          <div class="pcard-name" style="font-size:11px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(m.nombre)}</div>
          <div style="font-size:10px;color:var(--text3)">Máquina #${m.numG}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0">
          <span style="display:inline-flex;align-items:center;gap:5px;background:${sm.bg};color:${sm.color};border-radius:5px;padding:2px 8px;font-size:9px;font-weight:700;border:1px solid ${sm.color}33"><span class="pdot${isActive?' live':''}"></span>${sm.label}</span>
          ${s.stale?`<span style="background:rgba(120,120,120,0.15);color:#999;border-radius:5px;padding:1px 6px;font-size:9px;font-weight:700;border:1px solid rgba(120,120,120,0.25)" title="Sin señal momentánea — mostrando el último estado conocido">⟳ reconectando</span>`:''}
          ${maintAlerts.length?`<span style="background:rgba(255,170,0,0.15);color:#ffaa00;border-radius:5px;padding:1px 6px;font-size:9px;font-weight:700;border:1px solid rgba(255,170,0,0.3)" title="${maintAlerts.map(a=>a.label).join(', ')}">🔧 ${maintAlerts.length} alerta${maintAlerts.length>1?'s':''}</span>`:''}
          ${idleWarn?`<span style="background:rgba(100,100,100,0.15);color:#888;border-radius:5px;padding:1px 6px;font-size:9px;font-weight:700;border:1px solid rgba(100,100,100,0.2)">💤 ${idleHours}h idle</span>`:''}
        </div>
      </div>
      ${body}
      <div id="mccam_${m.id}" class="pcam-slot"></div>
    </div>`;
    return{id:m.id,fp:structFP,camKey,html:cardHtml};
  });
  // Render selectivo en dos niveles + parche en vivo:
  //  · structFP (forma de la tarjeta) → solo se reescribe el DOM si cambió.
  //  · cámara → nodo propio (#mccam_), se (re)monta solo si cambia su URL,
  //    así el stream MJPEG/snapshot NO parpadea en cada ciclo.
  //  · números en vivo (progreso/eta/temps/sparkline) → se parchean en sitio
  //    cada ciclo sin reconstruir DOM (no reinicia animaciones ni roba foco).
  // El grid completo solo se reconstruye si cambia el conjunto/orden de máquinas.
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
        _syncPrinterCam(c.id,c.camKey,true);   // la tarjeta se rehízo → re-montar cámara
        el.__cam[c.id]=c.camKey;
      }else if(el.__cam[c.id]!==c.camKey){
        _syncPrinterCam(c.id,c.camKey,false);  // solo cambió la cámara
        el.__cam[c.id]=c.camKey;
      }
      _patchLivePrinter(c.id,_printerStatus[c.id]);
    });
  }
  const lu=document.getElementById('monitorLastUpdate');
  if(lu)lu.textContent=new Date().toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
// Monta/actualiza la cámara en su nodo persistente. Sin force, no toca el <img>
// si la URL no cambió → el stream sigue vivo entre ciclos (cero parpadeo).
function _syncPrinterCam(id,camKey,force){
  const slot=document.getElementById('mccam_'+id);if(!slot)return;
  if(!force&&slot.__camKey===camKey)return;
  if(!camKey){slot.innerHTML='';slot.__camKey='';return;}
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const raw=localStorage.getItem('printer_cam_'+id)||m.cam;
  const camU=printerCamUrl(id),snap=_camIsSnapshot(raw);
  slot.innerHTML=`<div style="margin-top:8px;border-radius:8px;overflow:hidden;background:#000;position:relative">
    <img loading="lazy" decoding="async" ${snap?`data-snap="${camU}"`:''} src="${camU}" style="width:100%;display:block;max-height:160px;object-fit:cover" ${snap?'':`onerror="this.parentElement.innerHTML='<div style=\\'padding:12px;text-align:center;color:#666;font-size:10px\\'>Sin señal · verifica la URL</div>'"`}>
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
  set('peta_','⏱ '+fmtSecs(s.eta)+' restante');
  if(s.hotend)set('phot_',(s.hotend.actual||0)+'°');
  if(s.bed)set('pbed_',(s.bed.actual||0)+'°');
  const sp=g('pspark_'),th=_tempHistory[id]||[];
  if(sp&&th.length>=2)sp.innerHTML=renderSparkline(th,'h','#ff6b35');
}

async function printerControl(id,action){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Sin IP configurada','error');return;}
  if(action==='cancel'&&!confirm(`¿Cancelar impresión en ${m.nombre} #${m.numG}?`))return;
  toast({pause:'⏸ Pausando',resume:'▶ Reanudando',cancel:'■ Cancelando'}[action]+` ${m.nombre} #${m.numG}`,'info');
  const headers=getPrinterAuthHeaders(id);
  try{
    const r=await fetch(printerUrl(ip,`/printer/print/${action}`),{method:'POST',signal:AbortSignal.timeout(6000),headers});
    if(r.ok)setTimeout(pollPrinters,1500);else toast('Error: '+r.status,'error');
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

// ── CONTROL MOONRAKER (temperatura · máquina · archivos · historial) ──
// SEGURIDAD: todos los comandos de ESCRITURA verifican _isPrinterBusy antes
// de enviar nada — si la impresora está imprimiendo/pausada se rechazan, para
// no arriesgar un trabajo en curso. Solo la parada de emergencia ignora esto.
const PREHEAT_PRESETS={PLA:{h:210,b:60},PETG:{h:240,b:80},ABS:{h:250,b:100},TPU:{h:225,b:50}};
function _isPrinterBusy(state){return state==='printing'||state==='paused';}
function _pcState(id){return(_printerStatus[id]||{}).state||'offline';}
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
  let state=ps.state||'standby'; if(errored)state='shutdown';
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
async function audit3DRun(){
  const el=document.getElementById('audit3DResult');if(el)el.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Auditando impresoras…</div>';
  audit3DRenderResult(await audit3DAll());
  try{audit3DLoadDaily();}catch(_){}
}
function audit3DRenderResult(res){
  const el=document.getElementById('audit3DResult');if(!el)return;
  if(!res.length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">Sin impresoras con IP configurada. Configura las IPs en cada tarjeta del monitor.</div>';return;}
  const okN=res.filter(a=>!a.errored&&!a.busy&&a.state!=='offline'&&a.state!=='noip'&&a.state!=='error'&&(a.issues||[]).every(i=>i.sev===0)).length;
  const errN=res.filter(a=>a.errored).length,offN=res.filter(a=>a.state==='offline'||a.state==='noip').length;
  const cards=res.map(a=>{
    const stCol=a.errored?'var(--danger)':a.busy?'var(--accent)':(a.state==='offline'||a.state==='noip')?'var(--text3)':'var(--success)';
    const stTxt=a.errored?'⚠ Detenida (Klipper)':a.busy?'🖨 Imprimiendo':a.state==='offline'?'⚫ Offline':a.state==='noip'?'Sin IP':'✓ Lista';
    const issues=(a.issues||[]).map(i=>`<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2)"><span style="width:6px;height:6px;border-radius:50%;background:${_audit3DDot(i.sev)};flex-shrink:0"></span>${escapeHtml(i.txt)}</div>`).join('');
    const acts=(a.actions||[]).map(ac=>{const fn=ac.key==='firmware'?`printerFirmwareRestart('${a.id}')`:ac.key==='home'?`printerHome('${a.id}')`:`audit3DCalibrate('${a.id}')`;return `<button class="btn btn-ghost btn-sm" onclick="${fn}" style="font-size:10px">${escapeHtml(ac.txt)}</button>`;}).join('');
    return `<div style="padding:11px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--surface2)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">
        <b style="font-size:12px">${escapeHtml(a.nombre)} <span style="color:var(--text3)">#${a.numG}</span></b>
        <span style="font-size:11px;color:${stCol};font-weight:600">${stTxt}</span>
        ${!a.busy&&a.state!=='offline'&&a.state!=='noip'&&a.state!=='error'?`<span style="font-size:10px;color:var(--text3)">🌡 ${a.hotend}°/${a.bed}°${a.homed?' · home ✓':''}${a.meshOk?' · malla ✓':''}</span>`:''}
        <span style="margin-left:auto;display:flex;gap:5px;flex-wrap:wrap">${acts}</span>
      </div>
      ${issues||'<div style="font-size:11px;color:var(--success)">Sin observaciones — lista para imprimir.</div>'}
    </div>`;}).join('');
  el.innerHTML=`<div style="font-size:12px;color:var(--text2);margin-bottom:10px">✓ <b style="color:var(--success)">${okN}</b> lista(s) · <b style="color:var(--danger)">${errN}</b> con error · ${offN} offline · ${res.length} total</div>`+cards;
}
async function audit3DCalibrate(id){
  const m=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('🔒 Está imprimiendo — no se calibra','error');return;}
  if(!confirm(`📐 Calibrar bed mesh en ${m.nombre} #${m.numG}?\n\nHará home + nivelación de cama (1-2 min). Asegúrate de que la cama esté despejada.`))return;
  _sendGcode(id,'G28\nBED_MESH_CALIBRATE','📐 Calibrando bed mesh… (1-2 min)',{timeout:180000});
}
async function audit3DCalibrateAll(){
  const free=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).filter(m=>getPrinterIp(m)&&!_isPrinterBusy(_pcState(m.id))&&_pcState(m.id)!=='offline'&&_pcState(m.id)!=='shutdown');
  if(!free.length){toast('No hay impresoras libres y listas para calibrar','info');return;}
  if(!confirm(`📐 Lanzar bed mesh en ${free.length} impresora(s) libre(s)?\n\n${free.map(m=>m.nombre+' #'+m.numG).join(', ')}\n\nCada una hace home + nivelación. No toca las que estén imprimiendo.`))return;
  free.forEach(m=>_sendGcode(m.id,'G28\nBED_MESH_CALIBRATE',null,{timeout:180000}));
  toast(`📐 Calibración lanzada en ${free.length} impresora(s)`,'success');
}
async function audit3DReport(){
  const out=document.getElementById('audit3DAiOut');if(out){out.style.display='block';out.textContent='🧠 Analizando el estado del parque…';}
  if(!window._audit3D)await audit3DRun();
  try{showAgentWorking('MANTENCION3D',{verb:'está auditando el parque de impresoras…',messages:['Revisando el estado de cada máquina…','Detectando errores y mantenciones…','Sugiriendo calibraciones…']});}catch(e){}
  try{const cfg=(typeof AGENTES_CFG!=='undefined')?AGENTES_CFG.find(a=>a.id==='MANTENCION3D'):null;const resp=await callClaude(cfg?cfg.sys:'',buildAgentContext('MANTENCION3D'));if(out)out.textContent=resp;}
  catch(e){if(out)out.textContent='Error IA: '+(e&&e.message||e);}
  finally{try{hideAgentWorking();}catch(e){}}
}
// Último reporte de la rutina automática de la mañana (lo escribe el printer-bridge en Airtable)
async function audit3DLoadDaily(){
  const el=document.getElementById('audit3DDaily');if(!el)return;
  try{const r=await airtableFetch('Maquinas_Auditoria',1);const rec=(r.records||[])[0];if(!rec){el.innerHTML='';return;}
    const f=rec.fields;el.innerHTML=`<div style="padding:11px 14px;border:1px dashed var(--border2);border-radius:10px;font-size:11px;color:var(--text3)"><b style="color:var(--text2)">📋 Última auditoría automática</b> · ${escapeHtml(String(f['Fecha']||rec.createdTime||''))}<br><span style="white-space:pre-wrap">${escapeHtml(String(f['Resumen']||f['Detalle']||'').slice(0,700))}</span></div>`;
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
  if(!opts.allowBusy&&_isPrinterBusy(_pcState(id))){toast('🔒 Bloqueado: la impresora está imprimiendo — no se envió nada','error');return false;}
  try{
    const r=await fetch(printerUrl(ip,`/printer/gcode/script?script=${encodeURIComponent(script)}`),{method:'POST',signal:AbortSignal.timeout(opts.timeout||9000),headers:getPrinterAuthHeaders(id)});
    if(r.ok){if(label)toast(label,'success');setTimeout(pollPrinters,1200);return true;}
    toast('Error: '+r.status,'error');return false;
  }catch(e){toast('Sin conexión con la impresora','error');return false;}
}
// Temperatura
function setPrinterTemp(id,heater){
  const inp=document.getElementById('pcTemp_'+heater);if(!inp)return;
  let t=Math.round(+inp.value);if(!isFinite(t)||t<0)t=0;
  const max=heater==='hotend'?300:120;if(t>max){toast(`Máximo ${max}° para ${heater==='hotend'?'el hotend':'la cama'}`,'error');return;}
  _sendGcode(id,heater==='hotend'?`M104 S${t}`:`M140 S${t}`,`🌡️ ${heater==='hotend'?'Hotend':'Cama'} → ${t}°`);
}
function preheatPrinter(id,mat){
  const p=PREHEAT_PRESETS[mat];if(!p)return;
  _sendGcode(id,`M104 S${p.h}\nM140 S${p.b}`,`🔥 Precalentando ${mat} · hotend ${p.h}° · cama ${p.b}°`);
}
function cooldownPrinter(id){_sendGcode(id,`M104 S0\nM140 S0`,'❄️ Enfriando — calentadores apagados');}
// Máquina
function printerHome(id){_sendGcode(id,'G28','🏠 Origen (home) en curso');}
function printerMotorsOff(id){_sendGcode(id,'M84','Motores liberados');}
function printerJog(id,axis,dist){_sendGcode(id,`G91\nG1 ${axis}${dist} F${axis==='Z'?600:3000}\nG90`,`Mover ${axis} ${dist>0?'+':''}${dist}mm`);}
function printerFilament(id,dir){
  const ht=(_printerStatus[id]||{}).hotend?.actual||0;
  if(ht<170){toast('🌡️ Calienta el hotend a ≥170° antes de mover filamento','error');return;}
  const dist=dir==='load'?60:-60;
  _sendGcode(id,`M83\nG1 E${dist} F300\nM82`,dir==='load'?'⬇️ Cargando filamento (60mm)':'⬆️ Descargando filamento (60mm)');
}
function printerEmergencyStop(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(!confirm(`⛔ PARADA DE EMERGENCIA — ${m.nombre} #${m.numG}\n\nDetiene TODO de inmediato (incluido cualquier print en curso) y deja el firmware apagado hasta reiniciarlo desde Fluidd/Mainsail. Úsalo solo ante un peligro real.\n\n¿Continuar?`))return;
  const ip=getPrinterIp(m);
  fetch(printerUrl(ip,'/printer/emergency_stop'),{method:'POST',headers:getPrinterAuthHeaders(id)}).then(()=>{toast('⛔ Parada de emergencia enviada','info');setTimeout(pollPrinters,1500);}).catch(()=>toast('Sin conexión','error'));
}
// Archivos en la impresora
async function loadPrinterFiles(id){
  const cont=document.getElementById('pcFiles');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:11px;padding:8px">Cargando archivos…</div>';
  const d=await _moonrakerGet(id,'/server/files/list?root=gcodes');
  if(!d||!Array.isArray(d.result)){cont.innerHTML='<div style="color:var(--text3);font-size:11px;padding:8px">No se pudo leer la lista de archivos</div>';return;}
  const files=d.result.sort((a,b)=>(b.modified||0)-(a.modified||0)).slice(0,30);
  const busy=_isPrinterBusy(_pcState(id));
  cont.innerHTML=files.length?files.map(f=>{
    const kb=Math.round((f.size||0)/1024),path=escapeHtml(f.path||'');
    return`<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${path}">${path}</div><div style="font-size:9px;color:var(--text3)">${kb.toLocaleString('es-CL')} KB</div></div>
      <button data-f="${path}" onclick="reprintFile('${id}',this.dataset.f)" ${busy?'disabled':''} style="background:${busy?'var(--surface3)':'rgba(0,212,170,0.15)'};border:1px solid ${busy?'var(--border2)':'rgba(0,212,170,0.4)'};color:${busy?'var(--text3)':'#00d4aa'};border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;cursor:${busy?'not-allowed':'pointer'};flex-shrink:0">▶ Imprimir</button>
    </div>`;
  }).join(''):'<div style="color:var(--text3);font-size:11px;padding:8px">Sin archivos g-code en esta impresora</div>';
}
async function reprintFile(id,filename){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  if(_isPrinterBusy(_pcState(id))){toast('🔒 La impresora ya está ocupada','error');return;}
  if(!confirm(`Imprimir "${filename}" en ${m.nombre} #${m.numG}?`))return;
  const ip=getPrinterIp(m);
  try{const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(filename)}`),{method:'POST',signal:AbortSignal.timeout(8000),headers:getPrinterAuthHeaders(id)});if(r.ok){toast(`▶ Imprimiendo ${filename}`,'success');closePrinterControl();setTimeout(pollPrinters,1500);}else toast('Error al iniciar: '+r.status,'error');}catch(e){toast('Sin conexión','error');}
}
// Historial real de Moonraker (para costos)
async function loadPrinterHistory(id){
  const cont=document.getElementById('pcHistory');if(!cont)return;
  cont.innerHTML='<div style="color:var(--text3);font-size:11px;padding:8px">Cargando historial…</div>';
  const d=await _moonrakerGet(id,'/server/history/list?limit=15&order=desc');
  if(!d||!d.result||!Array.isArray(d.result.jobs)){cont.innerHTML='<div style="color:var(--text3);font-size:11px;padding:8px">Historial no disponible (la impresora necesita el componente [history] de Moonraker, activo por defecto en Fluidd/Mainsail)</div>';return;}
  const jobs=d.result.jobs;
  if(!jobs.length){cont.innerHTML='<div style="color:var(--text3);font-size:11px;padding:8px">Sin trabajos registrados aún</div>';return;}
  let totT=0,totF=0,ok=0;
  jobs.forEach(j=>{totT+=j.print_duration||0;totF+=j.filament_used||0;if(j.status==='completed')ok++;});
  const rows=jobs.map(j=>{
    const fn=escapeHtml((j.filename||'—').replace(/\.gcode$/i,''));
    const dur=fmtSecs(j.print_duration||0),fm=((j.filament_used||0)/1000).toFixed(1);
    const okj=j.status==='completed';
    return`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 6px;font-size:10px;color:var(--text);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${fn}">${fn}</td>
      <td style="padding:5px 6px;font-size:10px;color:var(--text3);text-align:right">${dur}</td>
      <td style="padding:5px 6px;font-size:10px;color:var(--text3);text-align:right">${fm} m</td>
      <td style="padding:5px 6px;text-align:right"><span style="font-size:9px;font-weight:700;color:${okj?'#00d4aa':'#ff6b35'}">${okj?'✓':'✕'}</span></td>
    </tr>`;
  }).join('');
  cont.innerHTML=`
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <span class="badge badge-green">${jobs.length} trabajos · ${ok} ok</span>
      <span class="badge badge-gray">⏱ ${fmtSecs(totT)} totales</span>
      <span class="badge badge-gray">🧵 ${(totF/1000).toFixed(1)} m filamento</span>
    </div>
    <table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text3)">
      <th style="text-align:left;font-size:9px;padding:3px 6px;font-weight:600">ARCHIVO</th><th style="text-align:right;font-size:9px;padding:3px 6px;font-weight:600">TIEMPO</th><th style="text-align:right;font-size:9px;padding:3px 6px;font-weight:600">FILAM.</th><th style="text-align:right;font-size:9px;padding:3px 6px;font-weight:600">OK</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}
// Modal de control
function openPrinterControl(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const ip=getPrinterIp(m);if(!ip){toast('Configura primero la IP de esta impresora','error');return;}
  const s=_printerStatus[id]||{};const busy=_isPrinterBusy(s.state);
  document.getElementById('pcTitle').textContent=`${m.nombre} #${m.numG}`;
  const dis=busy?'disabled':'';
  const lockBanner=busy?`<div style="background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.4);border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#ffaa00;line-height:1.5">🔒 <b>Imprimiendo ahora</b> — los controles de temperatura y máquina están bloqueados para no arriesgar el trabajo en curso. Solo lectura de archivos e historial. La parada de emergencia sigue disponible.</div>`:'';
  const btn=(label,onclick,extra='')=>`<button onclick="${onclick}" ${dis} style="background:${busy?'var(--surface3)':'var(--surface2)'};border:1px solid var(--border2);color:${busy?'var(--text3)':'var(--text)'};border-radius:7px;padding:7px 10px;font-size:11px;font-weight:600;cursor:${busy?'not-allowed':'pointer'};${extra}">${label}</button>`;
  document.getElementById('pcBody').innerHTML=`
    ${lockBanner}
    <!-- TEMPERATURA -->
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🌡️ Temperatura</div>
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <div style="flex:1">
        <div style="font-size:9px;color:var(--text3);margin-bottom:3px">HOTEND · actual ${s.hotend?.actual||0}°${s.hotend?.target>0?' → '+s.hotend.target+'°':''}</div>
        <div style="display:flex;gap:5px"><input id="pcTemp_hotend" type="number" min="0" max="300" placeholder="${s.hotend?.target||0}" ${dis} style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px"><button onclick="setPrinterTemp('${id}','hotend')" ${dis} style="background:${busy?'var(--surface3)':'var(--accent2)'};border:none;color:${busy?'var(--text3)':'#000'};border-radius:6px;padding:6px 12px;font-size:11px;font-weight:700;cursor:${busy?'not-allowed':'pointer'}">OK</button></div>
      </div>
      <div style="flex:1">
        <div style="font-size:9px;color:var(--text3);margin-bottom:3px">CAMA · actual ${s.bed?.actual||0}°${s.bed?.target>0?' → '+s.bed.target+'°':''}</div>
        <div style="display:flex;gap:5px"><input id="pcTemp_bed" type="number" min="0" max="120" placeholder="${s.bed?.target||0}" ${dis} style="flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px"><button onclick="setPrinterTemp('${id}','bed')" ${dis} style="background:${busy?'var(--surface3)':'#ffaa00'};border:none;color:${busy?'var(--text3)':'#000'};border-radius:6px;padding:6px 12px;font-size:11px;font-weight:700;cursor:${busy?'not-allowed':'pointer'}">OK</button></div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px">
      <span style="font-size:9px;color:var(--text3);align-self:center">Precalentar:</span>
      ${Object.keys(PREHEAT_PRESETS).map(mat=>btn(mat,`preheatPrinter('${id}','${mat}')`,'padding:5px 10px')).join('')}
      ${btn('❄️ Enfriar',`cooldownPrinter('${id}')`,'padding:5px 10px;margin-left:auto')}
    </div>
    <!-- MÁQUINA -->
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:8px">🎮 Máquina</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${btn('🏠 Home',`printerHome('${id}')`)}
      ${btn('⬇️ Cargar filamento',`printerFilament('${id}','load')`)}
      ${btn('⬆️ Descargar',`printerFilament('${id}','unload')`)}
      ${btn('💤 Soltar motores',`printerMotorsOff('${id}')`)}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span style="font-size:9px;color:var(--text3)">Mover:</span>
      ${['X','Y','Z'].map(ax=>`${btn(ax+'+',`printerJog('${id}','${ax}',${ax==='Z'?1:10})`,'padding:5px 9px')}${btn(ax+'−',`printerJog('${id}','${ax}',${ax==='Z'?-1:-10})`,'padding:5px 9px')}`).join('<span style="width:6px"></span>')}
    </div>
    <div style="margin-bottom:18px"><button onclick="printerEmergencyStop('${id}')" style="background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.4);color:#ff4444;border-radius:7px;padding:7px 12px;font-size:11px;font-weight:700;cursor:pointer;width:100%">⛔ Parada de emergencia</button></div>
    <!-- ARCHIVOS -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent)">📂 Archivos en la impresora</span>
      <button onclick="loadPrinterFiles('${id}')" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer">↻ Cargar</button>
    </div>
    <div id="pcFiles" style="max-height:160px;overflow-y:auto;margin-bottom:18px;background:var(--surface);border:1px solid var(--border);border-radius:8px"><div style="color:var(--text3);font-size:11px;padding:8px">Pulsa "Cargar" para ver los g-code y reimprimir.</div></div>
    <!-- HISTORIAL -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent)">📊 Historial real (Moonraker)</span>
      <button onclick="loadPrinterHistory('${id}')" style="background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:4px 10px;font-size:10px;cursor:pointer">↻ Cargar</button>
    </div>
    <div id="pcHistory" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px"><div style="color:var(--text3);font-size:11px;padding:8px">Tiempo y filamento reales de cada trabajo — útil para costos.</div></div>`;
  document.getElementById('printerControlModal').style.display='flex';
}
function closePrinterControl(){const el=document.getElementById('printerControlModal');if(el)el.style.display='none';}

// ── Queue modal ───────────────────────────────────────────────
function openQueueModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const q=_queueGet(id);
  const fmtTime=s=>{const h=Math.floor(s/3600),mn=Math.floor((s%3600)/60);return h?`${h}h ${mn}m`:`${mn}m`;};
  const rows=q.map((j,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:11px;font-weight:700;color:var(--accent);min-width:18px">#${i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(j.filename)}</div>
        <div style="font-size:10px;color:var(--text3)">⏱ ~${j.secs?fmtTime(j.secs):'—'} · ⚖ ~${j.grams?j.grams.toFixed(0):'—'}g</div>
      </div>
      <button onclick="_queueRemove('${id}',${i})" style="background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.3);border-radius:6px;color:#ff4444;font-size:10px;padding:3px 8px;cursor:pointer">✕</button>
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
  if(st==='printing'&&prev!=='printing')_sessions[m.id]={file:s.filename,start:Date.now(),filamentStart:s.filamentMm||0};
  // 'offline' NO es fin de impresión: la impresora puede seguir imprimiendo y
  // ser solo inalcanzable. No cerramos la sesión (evita un falso "Cancelado").
  if(prev==='printing'&&st!=='printing'&&st!=='offline'){
    const sess=_sessions[m.id];
    if(sess){
      const dur=Math.round((Date.now()-sess.start)/60000);
      const filamentMm=Math.max(0,(s.filamentMm||0)-sess.filamentStart);
      saveHistoryEntry(m,sess.file,sess.start,Date.now(),dur,st==='complete'?'Completado':'Cancelado',filamentMm);
      delete _sessions[m.id];
      if(st==='complete'){
        // Auto-calibrar estimación de tiempo por modelo de impresora
        const estKey='sl_last_est_secs';const estSecs=parseFloat(localStorage.getItem(estKey));
        if(estSecs>0&&dur>0){const ratio=(dur*60)/estSecs;if(ratio>0.4&&ratio<4){const calKey='sl_time_cal_'+(m.modelo||'default');const prev=parseFloat(localStorage.getItem(calKey))||1;localStorage.setItem(calKey,(prev*0.75+ratio*0.25).toFixed(4));}}
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
    const data=await _moonrakerGet(id,'/printer/objects/query?bed_mesh');
    const mesh=data?.result?.status?.bed_mesh;
    if(!mesh||!mesh.probed_matrix){toast('Sin datos de bed mesh — ejecuta BED_MESH_CALIBRATE primero','error');return;}
    const matrix=mesh.probed_matrix;
    const rows=matrix.length,cols=matrix[0].length;
    let mn=1e9,mx=-1e9;
    matrix.forEach(r=>r.forEach(v=>{if(v<mn)mn=v;if(v>mx)mx=v;}));
    const range=mx-mn||0.001;
    const cell=Math.min(44,Math.floor(320/Math.max(rows,cols)));
    const svgCells=matrix.map((row,ri)=>row.map((v,ci)=>{
      const t=(v-mn)/range;
      const rr=Math.round(t*220),gg=Math.round((1-Math.abs(t-0.5)*2)*180),bb=Math.round((1-t)*220);
      return`<rect x="${ci*cell}" y="${ri*cell}" width="${cell-1}" height="${cell-1}" fill="rgb(${rr},${gg},${bb})" rx="3"/>
<text x="${ci*cell+cell/2}" y="${ri*cell+cell/2+4}" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-size="${Math.max(7,cell/4)}" font-family="monospace">${v.toFixed(2)}</text>`;
    }).join('')).join('');
    const W=cols*cell,H=rows*cell;
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:20px;max-width:95vw;max-height:90vh;overflow:auto;min-width:320px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:16px">
        <div>
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">🗺️ Bed Mesh — ${escapeHtml(m.nombre)} #${m.numG}</div>
          <div style="font-size:10px;color:var(--text3)">Desviación: ${mn.toFixed(3)}mm … ${mx.toFixed(3)}mm &nbsp;·&nbsp; rango: <b>${(range*1000).toFixed(0)}µm</b> &nbsp;·&nbsp; ${rows}×${cols} puntos</div>
        </div>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;flex-shrink:0;line-height:1">✕</button>
      </div>
      <svg width="${W}" height="${H}" style="display:block;border-radius:8px;overflow:hidden">${svgCells}</svg>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;font-size:10px;color:var(--text3)">
        <div style="width:80px;height:10px;background:linear-gradient(to right,rgb(0,120,220),rgb(0,180,0),rgb(220,0,0));border-radius:3px;flex-shrink:0"></div>
        <span>plano/bajo (azul) → promedio (verde) → alto (rojo)</span>
      </div>
      ${range>0.4?`<div style="margin-top:8px;padding:8px 10px;background:rgba(255,170,0,0.1);border:1px solid rgba(255,170,0,0.4);border-radius:8px;font-size:10px;color:#ffaa00">⚠ Rango &gt;400µm — la cama puede necesitar nivelación manual antes de usar mesh compensation</div>`:''}
    </div>`;
    modal.onclick=e=>{if(e.target===modal)modal.remove();};
    document.body.appendChild(modal);
  }catch(e){toast('Error consultando bed mesh: '+e.message,'error');}
}
function openWebcamModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const url=localStorage.getItem('printer_cam_'+id)||'';
  document.getElementById('webcamModalTitle').textContent=`${m.nombre} #${m.numG}`;
  document.getElementById('webcamModalId').value=id;
  document.getElementById('webcamModalUrl').value=url;
  const img=document.getElementById('webcamModalImg');
  const nf=document.getElementById('webcamNoFeed');
  if(url){const cu=printerCamUrl(id);if(_camIsSnapshot(url))img.setAttribute('data-snap',cu);else img.removeAttribute('data-snap');img.src=cu;img.style.display='block';nf.style.display='none';}else{img.removeAttribute('data-snap');img.src='';img.style.display='none';nf.style.display='flex';}
  document.getElementById('webcamModal').style.display='flex';
}
function saveWebcamUrl(){const id=document.getElementById('webcamModalId').value;const url=document.getElementById('webcamModalUrl').value.trim();if(url)localStorage.setItem('printer_cam_'+id,url);else localStorage.removeItem('printer_cam_'+id);const m=MAQUINAS.find(x=>x.id===id);if(m){m.cam=url||null;if(m._airtableId){if(hasAirtableAccess())_atFetch(`/${BASE_ID}/Maquinas/${m._airtableId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{cam:url||''}})});}}closeWebcamModal();renderMonitorGrid();toast(url?'📷 Webcam configurada — guardada en Airtable':'Webcam eliminada','success');}
function closeWebcamModal(){document.getElementById('webcamModal').style.display='none';const wi=document.getElementById('webcamModalImg');if(wi){wi.removeAttribute('data-snap');wi.src='';}}

function openHistoryModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('histModalTitle').textContent=`${m.nombre} #${m.numG}`;
  const hist=getHistoryForPrinter(id);
  const el=document.getElementById('histModalBody');
  el.innerHTML=hist.length?hist.slice(0,50).map(h=>{const d=new Date(h.start);return`<div style="padding:8px 0;border-bottom:1px solid var(--border2);display:flex;align-items:center;gap:10px">
    <span style="background:${h.result==='Completado'?'rgba(0,212,170,0.15)':'rgba(255,68,68,0.12)'};color:${h.result==='Completado'?'#00d4aa':'#ff4444'};border-radius:5px;padding:2px 7px;font-size:9px;font-weight:700;flex-shrink:0">${h.result}</span>
    <div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.file||'—')}</div>
    <div style="font-size:10px;color:var(--text3)">${d.toLocaleDateString('es-CL')} ${d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'})} · ${h.dur}m</div></div>
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
let _sortByState=true,_kioskMode=false;
function stateOrder(s){return{printing:0,paused:1,error:2,complete:3,standby:4,offline:5,noip:6}[s]??7;}
function sortedList(lista){if(!_sortByState)return lista;return[...lista].sort((a,b)=>stateOrder((_printerStatus[a.id]||{}).state||'offline')-stateOrder((_printerStatus[b.id]||{}).state||'offline'));}
function toggleSort(){_sortByState=!_sortByState;const btn=document.getElementById('btnSort');if(btn)btn.style.color=_sortByState?'var(--accent)':'var(--text3)';renderMonitorGrid();}
function toggleKiosk(){
  _kioskMode=!_kioskMode;
  if(_kioskMode){document.documentElement.requestFullscreen?.();document.body.classList.add('kiosk');}
  else{document.exitFullscreen?.();document.body.classList.remove('kiosk');}
  renderMonitorGrid();
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&_kioskMode){_kioskMode=false;document.body.classList.remove('kiosk');renderMonitorGrid();}});

// ── IDLE ALERT ────────────────────────────────────────────────
const _lastActiveTime={},_idleAlerted={};
function getIdleHours(id,state){
  if(state==='printing'||state==='paused'||state==='offline'||state==='noip')return 0;
  const last=_lastActiveTime[id];if(!last)return 0;
  const threshold=parseFloat(localStorage.getItem('idle_alert_hours')||'2');
  const h=(Date.now()-last)/3600000;
  return h>=threshold?Math.round(h):0;
}
function checkIdleAlerts(){
  const now=new Date();const h=now.getHours();
  const isWork=h>=8&&h<19&&now.getDay()>0&&now.getDay()<6;
  MAQUINAS.forEach(m=>{
    const st=(_printerStatus[m.id]||{}).state||'offline';
    if(st==='printing'||st==='paused'){_lastActiveTime[m.id]=Date.now();delete _idleAlerted[m.id];}
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
  {key:'general',label:'General',icon:'<svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-wrench"/></svg>',defaultHours:50},
];
function getMaintConfig(){try{return JSON.parse(localStorage.getItem(MAINT_CFG_KEY)||'{}');}catch(e){return{};}}
function getMaintThreshold(tipo){const cfg=getMaintConfig();return parseInt(cfg[tipo])||MAINT_TYPES.find(t=>t.key===tipo)?.defaultHours||100;}
function getMaintLog(){return maquinaState.maintLog.length?maquinaState.maintLog:getMaintLogLocal();}
function getPrintHours(id){if(_useOdometer())return(getOdometer()[id]||{}).hours||0;return getHist().filter(x=>x.id===id&&x.result==='Completado').reduce((s,x)=>s+(x.dur||0)/60,0);}
function getHoursSinceMaint(id,tipo){
  const log=getMaintLog().filter(x=>x.maquinaId===id&&x.tipo===tipo).sort((a,b)=>b.ts-a.ts);
  const total=getPrintHours(id);
  if(!log.length)return total;
  return Math.max(0,total-log[0].printHoursAtTime);
}
function getMaintAlerts(m){
  return MAINT_TYPES.filter(t=>getHoursSinceMaint(m.id,t.key)>=getMaintThreshold(t.key)*0.9)
    .map(t=>({...t,hours:getHoursSinceMaint(m.id,t.key),threshold:getMaintThreshold(t.key)}));
}
// Ritmo de impresión (h/semana) de las últimas 4 semanas, para proyectar mantención
function getWeeklyPrintRate(id){
  const cut=Date.now()-28*86400000;return getHist().filter(x=>x.id===id&&x.result==='Completado'&&(x.ts||x.end||0)>=cut).reduce((s,x)=>s+(x.dur||0)/60,0)/4;
}
// Mantención más próxima a vencer, con ETA en semanas según el ritmo de uso
function getMaintForecast(m){
  const rate=getWeeklyPrintRate(m.id);let soonest=null;
  MAINT_TYPES.forEach(t=>{
    const left=getMaintThreshold(t.key)-getHoursSinceMaint(m.id,t.key);
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
      const h=last?Math.max(0,ph-last.printHoursAtTime):ph;const thresh=getMaintThreshold(t.key);
      return{t,h,thresh,last,pct:thresh>0?h/thresh:0};
    });
    const alertsN=perType.filter(p=>p.pct>=0.9).length;
    totH+=ph;totKg+=filKgN;totCost+=filCost;totPrints+=prints;totAlerts+=alertsN;
    const chips=perType.map(({t,h,thresh,last,pct})=>{
      const ok=pct<0.9,over=pct>=1;
      const lastStr=last?_DTF_DM.format(new Date(last.ts)):'sin reg.';
      const statusIcon=over?'⚠':ok?'✓':'~';
      return`<span title="${t.label}: ${h.toFixed(1)}h / ${thresh}h (${Math.round(pct*100)}%) · Último: ${lastStr}" style="display:inline-flex;align-items:center;gap:3px;background:${over?'rgba(255,68,68,0.15)':pct>=0.9?'rgba(255,170,0,0.15)':last?'rgba(0,212,170,0.12)':'rgba(255,255,255,0.04)'};color:${over?'#ff4444':pct>=0.9?'#ffaa00':last?'#00d4aa':'var(--text3)'};border:1px solid ${over?'rgba(255,68,68,0.3)':pct>=0.9?'rgba(255,170,0,0.3)':last?'rgba(0,212,170,0.25)':'var(--border2)'};border-radius:5px;padding:2px 6px;font-size:9px;font-weight:700">${t.icon} ${statusIcon} <span style="font-weight:400;opacity:0.85">${Math.round(pct*100)}%</span></span>`;
    }).join('');
    const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);
    const alerts={length:alertsN};
    const rate=getWeeklyPrintRate(m.id);let fc=null;
    perType.forEach(p=>{const left=p.thresh-p.h;const weeks=left<=0?0:(rate>0?left/rate:Infinity);if(!fc||weeks<fc.weeks)fc={tipo:p.t.label,hoursLeft:left,weeks,rate};});
    let fcHtml;
    if(!fc||(fc.rate<=0&&fc.hoursLeft>0)){const _disp=(typeof getMaquinaEstadoGlobal==='function'?getMaquinaEstadoGlobal(m.id):'disponible')==='disponible';fcHtml=_disp?`<span style="color:#ffaa00;font-size:10px;font-weight:600" title="Habilitada pero sin impresiones completadas en 4 semanas — capacidad ociosa">⚠ subutilizada</span>`:`<span style="color:var(--text3);font-size:10px" title="Sin impresiones recientes">sin uso reciente</span>`;}
    else if(fc.hoursLeft<=0)fcHtml=`<span style="color:#ff4444;font-size:10px;font-weight:700">⚠ ${escapeHtml(fc.tipo)} vencida</span>`;
    else{const w=fc.weeks;const col=w<1?'#ff4444':w<2?'#ffaa00':'#00d4aa';const lbl=w<1?'esta semana':w<2?`~${Math.round(w*7)} días`:`~${Math.round(w)} sem`;fcHtml=`<span style="color:${col};font-size:10px;font-weight:600" title="${escapeHtml(fc.tipo)}: faltan ${fc.hoursLeft.toFixed(0)}h al ritmo de ${fc.rate.toFixed(1)}h/semana">${escapeHtml(fc.tipo)} en ${lbl}</span> <span style="color:var(--text3);font-size:9px">· ${fc.rate.toFixed(0)}h/sem</span>`;}
    return`<tr style="border-bottom:1px solid var(--border2)">
      <td style="padding:9px 10px;font-size:11px;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${gc?.color||'#888'};margin-right:6px"></span><b>${m.nombre}</b> <span style="color:var(--text3)">#${m.numG}</span></td>
      <td style="padding:9px 10px;font-size:11px;text-align:center;font-weight:700;color:var(--accent)">${totalH}h</td>
      <td style="padding:9px 10px"><div style="display:flex;gap:4px;flex-wrap:wrap">${chips}</div></td>
      <td style="padding:9px 10px;white-space:nowrap">${fcHtml}</td>
      <td style="padding:9px 10px;font-size:10px;color:var(--text3);white-space:nowrap">${filKg}kg${filCost>0?` · $${filCost.toLocaleString('es-CL')}`:''}  </td>
      <td style="padding:9px 10px"><button onclick="openMaintModal('${m.id}')" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;color:var(--text3);font-size:10px;padding:4px 10px;cursor:pointer;white-space:nowrap" ${alerts.length?'style="border-color:rgba(255,170,0,0.5)"':''}>+ Registrar</button></td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div class="card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:700px">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="padding:8px 10px;font-size:10px;color:var(--text3);text-align:left">Máquina</th>
      <th style="padding:8px 10px;font-size:10px;color:var(--text3);text-align:center">Horas totales</th>
      <th style="padding:8px 10px;font-size:10px;color:var(--text3);text-align:left">Estado mantención</th>
      <th style="padding:8px 10px;font-size:10px;color:var(--text3);text-align:left" title="Proyección según horas de impresión de las últimas 4 semanas">Próxima mantención</th>
      <th style="padding:8px 10px;font-size:10px;color:var(--text3);text-align:left">Filamento</th>
      <th style="padding:8px 10px;font-size:10px;color:var(--text3)"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="border-top:2px solid var(--border);background:var(--surface2)">
      <td style="padding:9px 10px;font-size:10px;font-weight:700;color:var(--text)">FLOTA · ${MAQUINAS.length} máq.</td>
      <td style="padding:9px 10px;font-size:11px;text-align:center;font-weight:700;color:var(--accent)">${totH.toFixed(0)}h</td>
      <td style="padding:9px 10px;font-size:10px;color:${totAlerts>0?'#ffaa00':'var(--text3)'};font-weight:700">${totAlerts>0?`🔧 ${totAlerts} alerta${totAlerts>1?'s':''}`:'✓ sin alertas'}</td>
      <td style="padding:9px 10px;font-size:10px;color:var(--text3)">${totPrints} impresiones</td>
      <td style="padding:9px 10px;font-size:10px;color:var(--text3);white-space:nowrap;font-weight:700">${totKg.toFixed(2)}kg${totCost>0?` · $${totCost.toLocaleString('es-CL')}`:''}</td>
      <td></td>
    </tr></tfoot>
  </table></div>`;
}

function openMaintModal(id){
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  document.getElementById('maintModalId').value=id;
  document.getElementById('maintModalNombre').textContent=`${m.nombre} — Máquina #${m.numG}`;
  document.getElementById('maintModal').style.display='flex';
}
function closeMaintModal(){document.getElementById('maintModal').style.display='none';}
async function saveMaintRecord(){
  const id=document.getElementById('maintModalId').value;
  const tipo=document.getElementById('maintModalTipo').value;
  const notas=document.getElementById('maintModalNotas').value.trim();
  const m=MAQUINAS.find(x=>x.id===id);if(!m)return;
  const rec={maquinaId:id,nombre:m.nombre,numG:m.numG,tipo,notas,printHoursAtTime:getPrintHours(id),ts:Date.now(),fecha:new Date().toISOString()};
  maquinaState.maintLog.unshift(rec);
  // guardar también en localStorage como backup
  const local=getMaintLogLocal();local.unshift(rec);localStorage.setItem(MAINT_KEY,JSON.stringify(local.slice(0,200)));
  closeMaintModal();renderMaintenanceTable();renderMonitorGrid();
  toast(`🔧 Mantención registrada · ${MAINT_TYPES.find(t=>t.key===tipo)?.label}`,'success');
  try{await saveMaintRecordAirtable(rec);}catch(e){console.warn('No se pudo guardar mantención en Airtable',e);}
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
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:12px">IMPRESIONES POR DÍA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.count/maxCount*76,d.count>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:var(--accent);border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.count>0?4:1}px;opacity:0.85"></div><div style="font-size:9px;color:var(--text3)">${d.label}</div>${d.count>0?`<div style="font-size:9px;font-weight:700;color:var(--accent)">${d.count}</div>`:'<div style="font-size:9px;color:var(--border2)">—</div>'}</div>`;}).join('')}
        </div>
      </div>
      <div class="card" style="padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:12px">HORAS ACTIVAS POR DÍA</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px">
          ${dayData.map(d=>{const h=Math.max(d.hours/maxHours*76,d.hours>0?4:1);return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="background:#a78bfa;border-radius:3px 3px 0 0;width:100%;height:${h}px;min-height:${d.hours>0?4:1}px;opacity:0.85"></div><div style="font-size:9px;color:var(--text3)">${d.label}</div>${d.hours>0?`<div style="font-size:9px;font-weight:700;color:#a78bfa">${d.hours}h</div>`:'<div style="font-size:9px;color:var(--border2)">—</div>'}</div>`;}).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:12px">TOP MÁQUINAS POR HORAS ACUMULADAS</div>
      ${byPrinter.map(({m,h})=>{const pct=Math.round(h/maxPH*100);const gc=MONITOR_GRUPOS.find(g=>g.key===m.modelo);return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div style="font-size:11px;color:var(--text);white-space:nowrap;min-width:160px">${m.nombre} <span style="color:var(--text3)">#${m.numG}</span></div><div style="flex:1;background:var(--surface2);border-radius:4px;height:8px;overflow:hidden"><div style="background:${gc?.color||'var(--accent)'};height:100%;width:${pct}%;border-radius:4px"></div></div><div style="font-size:10px;color:var(--text3);min-width:40px;text-align:right">${h.toFixed(1)}h</div></div>`;}).join('')}
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
  if(s&&s._fetchFail){
    const n=(_failCount[m.id]=(_failCount[m.id]||0)+1);
    const prev=_printerStatus[m.id];
    // backoff exponencial (2s,4s,8s… máx 60s) + jitter
    _nextPollAt[m.id]=Date.now()+Math.min(60000,2000*Math.pow(2,Math.max(0,n-1)))+Math.floor(Math.random()*1500);
    if(n<_OFFLINE_AFTER_FAILS&&prev&&prev.state!=='offline'&&prev.state!=='noip'){
      _printerStatus[m.id]={...prev,stale:true,staleSince:prev.staleSince||Date.now()};
      return;
    }
    checkTransitions(m,s);_printerStatus[m.id]=s;return;
  }
  _failCount[m.id]=0;_nextPollAt[m.id]=0;
  checkTransitions(m,s);_printerStatus[m.id]=s;
  if(s&&s.hotend){if(!_tempHistory[m.id])_tempHistory[m.id]=[];_tempHistory[m.id].push({h:s.hotend.actual,b:s.bed?.actual||0});if(_tempHistory[m.id].length>20)_tempHistory[m.id].shift();}
}
async function pollPrinters(){
  if(window._DEMO_MODE){await pollPrintersDemoTick();return;}
  if(_pollInFlight)return;            // no solapar ciclos lentos (timeouts)
  if(document.hidden)return;          // no machacar bridge/impresoras con la pestaña oculta
  _pollInFlight=true;
  try{
    const now=Date.now();
    await _mapLimit(MAQUINAS,4,async m=>{
      if(_wsConnected[m.id])return;                          // el WebSocket ya da estado en vivo
      if(_nextPollAt[m.id]&&now<_nextPollAt[m.id])return;    // en backoff: máquina caída
      const s=await fetchPrinterStatus(m);
      _applyStatus(m,s);
    });
  }finally{_pollInFlight=false;}
  _pollCount++;
  checkIdleAlerts();
  renderMonitorKPIs();
  renderMonitorGrid();
  if(_pollCount%4===0){renderMaintenanceTable();renderProductionAnalytics();}
}

function renderMaquinasKPIs(dias,todayStr){
  const total=MAQUINAS.length*dias.length;
  let usados=0,mant=0,horas=0,dispHoy=0,usoHoy=0,mantHoy=0;
  MAQUINAS.forEach(m=>{
    const globalMant=getMaquinaEstadoGlobal(m.id)==='mantencion';
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
      <div style="font-size:8px;color:${isCur?'var(--accent)':isNow?'var(--text)':'var(--text3)'};font-family:'JetBrains Mono',monospace;white-space:nowrap;font-weight:${isNow?700:400}">${isNow?'← HOY':fmtC(lun)}</div>
      <div style="width:46px;height:4px;border-radius:2px;background:var(--surface3);overflow:hidden"><div style="width:${pct}%;height:100%;background:${pctColor(pct)};border-radius:2px;transition:width 0.3s"></div></div>
      <div style="font-size:9px;font-weight:700;color:${isCur?'var(--accent)':pctColor(pct)}">${pct>0?pct+'%':'libre'}</div>
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
  document.getElementById('maquinasHeader').innerHTML=`<tr><th style="padding:9px 14px;font-size:10px;text-transform:uppercase;color:var(--text3);text-align:left;border-bottom:1px solid var(--border);min-width:160px;background:var(--surface);position:sticky;left:0;z-index:3">Máquina</th><th style="padding:9px 10px;font-size:10px;color:var(--text3);text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:3;min-width:70px">Estado</th>${dias.map(d=>{const isH=fmtDate(d)===today;return`<th style="padding:7px 4px;font-size:10px;font-weight:${isH?700:500};color:${isH?'var(--accent)':'var(--text3)'};text-align:center;border-bottom:1px solid var(--border);min-width:95px;background:var(--surface)">${fmtDayLabel(d)}</th>`;}).join('')}</tr>`;
  // pre-calcular stats por modelo para los headers de grupo
  const modeloStats={};[...new Set(MAQUINAS.map(m=>m.modelo))].forEach(modelo=>{
    const mqs=MAQUINAS.filter(x=>x.modelo===modelo);
    const disp=mqs.filter(x=>getMaquinaEstadoGlobal(x.id)!=='mantencion'&&!maquinaState.eventos[`${x.id}_${today}`]).length;
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
          <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${m.color}">${m.modelo}</div>
          <div style="font-size:9px;color:var(--text3);margin-top:1px">${MODEL_SPECS[m.modelo]||''}</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <span style="font-size:9px;font-weight:700;color:${dispColor};background:${dispBg};border:1px solid ${dispBorder};border-radius:4px;padding:2px 8px">${ms.disp}/${ms.total} disponibles hoy</span>
          ${ms.pct>0?`<span style="font-size:9px;color:var(--text3)">${ms.pct>0?ms.pct+'% uso semana':''}</span>`:''}
        </div>
      </div>
    </td></tr>`:'' ;
    const enMant=getMaquinaEstadoGlobal(m.id)==='mantencion';
    const estadoBtn=enMant?`<button class="btn-mini btn-mini-red" onclick="toggleMaquinaEstado('${m.id}')"><svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-wrench"/></svg> Mant.</button>`:`<button class="btn-mini btn-mini-green" onclick="toggleMaquinaEstado('${m.id}')">✓ Disp.</button>`;
    const celdas=dias.map(d=>{const ds=fmtDate(d),key=`${m.id}_${ds}`,ev=maquinaState.eventos[key],isH=ds===today;let bg='',content='';if(ev){if(ev.tipo==='mantencion'){bg='rgba(255,68,68,0.2)';content=`<div style="font-size:9px;font-weight:700;color:var(--danger)">🔧 MANT.</div>`;}else if(ev.tipo==='uso'){bg='rgba(255,107,53,0.2)';const pedLabel=ev.pedidoId?state.pedidosById[ev.pedidoId]?.fields['N° Pedido']||null:null;const descLabel=pedLabel?`🔗 ${pedLabel}`:(ev.desc||'En uso');content=`<div style="font-size:9px;color:${pedLabel?'var(--accent)':'var(--accent2)'};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:85px" title="${escapeHtml(ev.desc||'')}">${escapeHtml(descLabel)}</div>${ev.tiempo?`<div style="font-size:8px;color:var(--text3)">${ev.tiempo}h</div>`:''}`;}else{bg='rgba(0,212,170,0.12)';content=`<div style="font-size:9px;color:var(--accent3);font-weight:600">✓ Libre</div>`;}}return`<td onclick="openMaquinaModal('${m.id}','${m.nombre} #${m.num}','${ds}')" style="padding:3px;text-align:center;border-bottom:1px solid var(--border);border-left:${isH?'2px solid var(--accent)':'1px solid var(--border)'};background:${bg||'transparent'};cursor:pointer;vertical-align:middle" onmouseenter="this.style.filter='brightness(1.5)'" onmouseleave="this.style.filter='brightness(1)'"><div style="min-height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${content||`<span style="color:var(--text3);font-size:10px">+</span>`}${ev?`<button onclick="event.stopPropagation();deleteMaquinaEvento('${m.id}','${ds}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:8px;padding:0">✕</button>`:''}</div></td>`;}).join('');
    return`${groupRow}<tr><td style="padding:9px 14px;font-size:12px;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:2"><span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block;margin-right:6px"></span>${escapeHtml(m.nombre)} <span style="color:var(--text3)">#${m.num}</span></td><td style="padding:4px 6px;text-align:center;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:160px;z-index:2">${estadoBtn}</td>${celdas}</tr>`;
  }).join('');
  document.getElementById('maquinasSubtitle').textContent=`${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)!=='mantencion').length} disponibles · ${MAQUINAS.filter(m=>getMaquinaEstadoGlobal(m.id)==='mantencion').length} en mantención`;
}
function openMaquinaModal(maqId,nombre,dateStr){
  document.getElementById('maquinaModalId').value=maqId;
  document.getElementById('maquinaModalDate').value=dateStr;
  document.getElementById('maquinaModalTitle').textContent=`📅 ${nombre} — ${dateStr}`;
  document.getElementById('maquinaModalFechaInicio').value=dateStr;
  document.getElementById('maquinaModalFechaFin').value=dateStr;
  // poblar select de pedidos activos
  const activos=state.pedidos.filter(p=>!['Despachado','Cancelado'].includes(p.fields['Estado pedido']||''));
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
  // sugerir horas según pedido si tiene monto (estimación rápida)
  const monto=(f['Monto total (CLP)']||0)/1.19;
  if(monto>0&&!document.getElementById('maquinaModalTiempo').value){
    const hEst=Math.max(1,Math.round(monto/15000)); // aprox $15k neto/h como referencia
    document.getElementById('maquinaModalTiempo').value=Math.min(hEst,24);
  }
}
async function saveMaquinaEvento(){
  const maqId=document.getElementById('maquinaModalId').value,tipo=document.getElementById('maquinaModalTipo').value,desc=document.getElementById('maquinaModalDesc').value,tiempo=document.getElementById('maquinaModalTiempo').value,fi=document.getElementById('maquinaModalFechaInicio').value,ff=document.getElementById('maquinaModalFechaFin').value;
  if(!fi||!ff){toast('Ingresa las fechas','error');return;}
  const pedidoId=document.getElementById('maquinaModalPedido')?.value||'';
  const start=new Date(fi+'T00:00:00'),end=new Date(ff+'T00:00:00');let count=0;
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const key=`${maqId}_${fmtDate(new Date(d))}`;if(tipo==='disponible') delete maquinaState.eventos[key];else{const ev={tipo,desc,tiempo:parseFloat(tiempo)||null};if(pedidoId) ev.pedidoId=pedidoId;maquinaState.eventos[key]=ev;}count++;}
  closeMaquinaModal();renderMaquinasCalendar();toast(`✓ ${count} día${count>1?'s':''} marcados — guardando...`,'info');
  try{await saveMaquinaEventosAirtable();toast('✓ Guardado en Airtable','success');}
  catch(e){toast('Error al guardar: '+e.message,'error');}
}
async function deleteMaquinaEvento(maqId,dateStr){
  delete maquinaState.eventos[`${maqId}_${dateStr}`];renderMaquinasCalendar();
  try{await saveMaquinaEventosAirtable();toast('Evento eliminado','info');}
  catch(e){toast('Error al eliminar: '+e.message,'error');}
}

// ── EQUIPO ────────────────────────────────────────────────────
async function initEquipo(){
  await loadEquipoEventosAirtable();
  const el=document.getElementById('gcalPersonasConfig');if(el) el.innerHTML=PERSONAS.map(p=>`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${_avHtml(p,28)}<span style="min-width:140px;font-size:12px">${p.nombre}</span><input class="field-input" id="gcal_cid_${p.id}" placeholder="email@gmail.com" value="${p.gcalId}" style="font-size:11px;flex:1"><input class="field-input" id="gcal_key_${p.id}" placeholder="AIza... API Key" value="${sessionStorage.getItem('gcal_api_key')||''}" style="font-size:11px;flex:1"></div>`).join('');
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
  document.getElementById('equipoHeader').innerHTML=`<tr><th style="padding:10px 14px;font-size:10px;text-transform:uppercase;color:var(--text3);text-align:left;border-bottom:1px solid var(--border);min-width:170px;background:var(--surface);position:sticky;left:0;z-index:2">Persona</th>${dias.map(d=>{const isH=fmtDate(d)===today,esFinde=d.getDay()===0||d.getDay()===6;return`<th style="padding:7px 5px;font-size:10px;font-weight:${isH?700:500};color:${isH?'var(--accent)':esFinde?'var(--text3)':'var(--text2)'};text-align:center;border-bottom:1px solid var(--border);min-width:100px;background:var(--surface)">${fmtDayLabel(d)}${esFinde?'<br><span style="font-size:8px;color:var(--text3)">finde</span>':''}</th>`;}).join('')}</tr>`;
  document.getElementById('equipoBody').innerHTML=PERSONAS.map(p=>{
    const celdas=dias.map(d=>{const ds=fmtDate(d),key=`${p.id}_${ds}`,ev=equipoState.eventos[key],isH=ds===today,esFinde=d.getDay()===0||d.getDay()===6;const cfg=ev?(EQUIPO_TIPOS[ev.tipo]||EQUIPO_TIPOS.disponible):null;const bg=cfg?cfg.bg:esFinde?'rgba(255,255,255,0.01)':'transparent';let content='';if(cfg){content=`<div style="font-size:10px;font-weight:700;color:${cfg.color}">${cfg.icon} ${cfg.label}</div>${ev.desc?`<div style="font-size:9px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:88px">${escapeHtml(ev.desc)}</div>`:''}<button onclick="event.stopPropagation();deleteEquipoEvento('${p.id}','${ds}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:8px;padding:0">✕</button>`;}else{content=`<span style="color:var(--text3);font-size:10px">${esFinde?'—':'+'}</span>`;}return`<td onclick="openEquipoModal('${p.id}','${p.nombre}','${ds}')" style="padding:3px;text-align:center;border-bottom:1px solid var(--border);border-left:${isH?'2px solid var(--accent)':'1px solid var(--border)'};background:${bg};cursor:pointer;vertical-align:middle" onmouseenter="this.style.filter='brightness(1.4)'" onmouseleave="this.style.filter='brightness(1)'"><div style="min-height:42px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">${content}</div></td>`;}).join('');
    const dispCount=dias.filter(d=>{const ev=equipoState.eventos[`${p.id}_${fmtDate(d)}`];return !ev||ev.tipo==='disponible';}).length;
    return`<tr><td style="padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:1"><div style="display:flex;align-items:center;gap:9px">${_avHtml(p,34)}<div><div style="font-size:12px;font-weight:600">${escapeHtml(p.nombre)}</div><div style="font-size:10px;color:var(--text3)">${p.rol} · ${dispCount}/7 disp.</div></div></div></td>${celdas}</tr>`;
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
      return ea.includes(fn)&&!['Despachado','Cancelado'].includes(x.fields['Estado pedido']||'');
    });
    const proxEntrega=misPedidos
      .filter(x=>x.fields['Fecha entrega']&&new Date(x.fields['Fecha entrega']+'T00:00:00')>=todayDate)
      .map(x=>x.fields['Fecha entrega']).sort()[0];
    const proxLabel=proxEntrega?` · próx: ${proxEntrega.substring(5).replace('-','/')}` :'';
    const cargaHtml=misPedidos.length
      ?`<div style="font-size:10px;color:var(--accent);margin-top:3px">📦 ${misPedidos.length} pedido${misPedidos.length>1?'s':''} activo${misPedidos.length>1?'s':''}${proxLabel}</div>`
      :`<div style="font-size:10px;color:var(--text3);margin-top:3px">Sin pedidos activos</div>`;
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
      ?`<div style="font-size:10px;color:var(--danger);font-weight:700;margin-top:3px">⚠ Conflicto: ${conflictos.map(c=>`${c.ped} vence el ${c.fecha}`).join(' · ')}</div>`
      :'';
    return`<div class="card" style="padding:14px;display:flex;align-items:center;gap:10px${conflictos.length?';border-color:rgba(255,68,68,0.4)':''}">${_avHtml(p,40)}<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700">${escapeHtml(p.nombre)}</div><div style="font-size:12px;color:${cfg.color};font-weight:700">${cfg.icon} ${cfg.label}</div>${ev?.desc?`<div style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.desc)}</div>`:''}${cargaHtml}${alertaHtml}</div><button class="btn-mini ${ev&&ev.tipo!=='disponible'?'btn-mini-red':'btn-mini-green'}" onclick="quickToggleEquipo('${p.id}','${today}')">${ev&&ev.tipo!=='disponible'?'🔴 Disp.':'🟢 OK'}</button></div>`;
  }).join('');
}
function renderEquipoDetalleSemana(dias){
  document.getElementById('equipoDetalleSemana').innerHTML=PERSONAS.map(p=>{
    // #1 Pedidos activos asignados a esta persona
    const fn=p.nombre.split(' ')[0].toLowerCase();
    const misPedidos=state.pedidos.filter(x=>{
      const ea=(x.fields['Equipo asignado']||'').toLowerCase();
      return ea.includes(fn)&&!['Despachado','Cancelado'].includes(x.fields['Estado pedido']||'');
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
      const pedTag=pedEseDia.length?`<span style="font-size:9px;font-weight:700;color:${conflicto?'var(--danger)':'var(--accent)'};margin-left:auto;flex-shrink:0">${conflicto?'⚠ ':'📦 '}${pedEseDia.join(', ')}</span>`:'';
      return`<div style="display:flex;align-items:center;gap:7px;padding:6px 0;border-bottom:1px solid var(--border)${conflicto?';background:rgba(255,68,68,0.06)':''}"><span style="font-size:10px;color:var(--text3);min-width:44px">${fmtDayLabel(d)}</span>${cfg?`<span style="font-size:10px;font-weight:600;color:${cfg.color}">${cfg.icon} ${cfg.label}</span>${ev.desc?`<span style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;flex:1">${escapeHtml(ev.desc)}</span>`:''}`: `<span style="font-size:10px;color:${esFinde?'var(--text3)':'var(--accent3)'}">✓ ${esFinde?'Finde':'Disponible'}</span>`}${pedTag}</div>`;
    }).join('');
    const dispDias=dias.filter(d=>{const ev=equipoState.eventos[`${p.id}_${fmtDate(d)}`];return !ev||ev.tipo==='disponible';}).length;
    const pct=Math.round((dispDias/7)*100);
    const barColor=pct>=70?'var(--accent3)':pct>=40?'var(--warn)':'var(--danger)';
    const statHtml=misPedidos.length
      ?`<div style="font-size:9px;color:${conflictCount?'var(--danger)':'var(--accent)'};margin-top:2px">${conflictCount?`⚠ ${conflictCount} conflicto${conflictCount>1?'s':''}`:`📦 ${misPedidos.length} ped. activo${misPedidos.length>1?'s':''}`}</div>`
      :'';
    return`<div class="card"><div class="card-header"><div style="display:flex;align-items:center;gap:9px">${_avHtml(p,30)}<div><div style="font-size:11px;font-weight:700">${escapeHtml(p.nombre)}</div><div style="font-size:10px;color:var(--text3)">${p.rol}</div></div></div><div style="text-align:right"><div style="font-size:16px;font-family:'Bebas Neue';color:${barColor}">${dispDias}/7</div><div style="font-size:9px;color:var(--text3)">días disp.</div>${statHtml}</div></div><div style="padding:0 14px 6px"><div style="height:3px;background:var(--surface3);border-radius:2px;margin-bottom:8px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px"></div></div>${eventosHtml}</div></div>`;
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
function selectCliente(id){const c=state.clientesByIdRec[id];if(!c) return;document.getElementById('cot-cliente-search').value=c.fields['Empresa']||'';document.getElementById('cot-cliente-id').value=id;document.getElementById('cot-cliente-dropdown').classList.remove('open');const venc=c.fields['Facturas vencidas']||0,info=document.getElementById('cot-cliente-info');const prevCots=state.cotizaciones.filter(x=>{const cl=x.fields['Cliente'];return Array.isArray(cl)?cl.includes(id):cl===id;}).sort((a,b)=>(b.fields['Fecha cotización']||b.createdTime||'').localeCompare(a.fields['Fecha cotización']||a.createdTime||''));const prevBtn=prevCots.length?` &nbsp;<button type="button" onclick="openCopyCotPicker('n')" style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.35);border-radius:5px;color:var(--accent4);font-size:10px;font-weight:700;padding:2px 8px;cursor:pointer;vertical-align:middle">📋 Cot. anterior (${prevCots.length})</button>`:'';info.innerHTML=(venc>=2?`<span style="color:var(--danger)">⚠ ${venc} facturas vencidas</span>`:`<span style="color:var(--text2)">✓ Cliente seleccionado</span>`)+prevBtn;}
function selectClienteNew(){document.getElementById('cot-cliente-id').value='';document.getElementById('cot-cliente-dropdown').classList.remove('open');}
document.addEventListener('click',e=>{if(!e.target.closest('.search-select-wrap')) document.querySelectorAll('.search-select-dropdown').forEach(d=>d.classList.remove('open'));});
function clearForm(type){
  if(type==='lead'){['nl-empresa','nl-contacto','nl-cargo','nl-telefono','nl-email','nl-rut','nl-web','nl-notas','nl-ciudad','nl-direccion'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});document.getElementById('nl-origen').value='Referido';document.getElementById('nl-industria').value='';const nr=document.getElementById('nl-region');if(nr) nr.value='';const nc=document.getElementById('nl-comuna');if(nc){nc.innerHTML='<option value="">— Seleccionar región primero —</option>';nc.disabled=true;}}
  if(type==='cot'){['cot-num','cot-alias','cot-subtotal','cot-total','cot-solicitud','cot-solicitud-inp','cot-notas','cot-cliente-search','cot-cliente-id','cot-tiempo-prod','cot-descuento'].forEach(id=>{const el=document.getElementById(id);if(el) el.value=id==='cot-descuento'?'0':'';});const si=document.getElementById('solicitudItems');if(si) si.innerHTML='';const fp=document.getElementById('cot-forma-pago');if(fp) fp.value='';const cu=document.getElementById('cot-urgente');if(cu) cu.value='false';const td=document.getElementById('cot-tipo-dias');if(td) td.value='DÍAS HÁBILES';const tdb=document.getElementById('cot-tipo-dias-btn');if(tdb){tdb.textContent='DÍAS HÁBILES';tdb.style.background='rgba(0,212,204,0.15)';tdb.style.borderColor='rgba(0,212,204,0.5)';tdb.style.color='var(--accent)';};document.getElementById('cot-cliente-info').textContent='';document.getElementById('cot-cliente-dropdown')?.classList.remove('open');initDates();initItemsContainer();const c3dp=document.getElementById('c3d-inline-panel');if(c3dp) c3dp.style.display='none';Object.values(_c3dBtns()).forEach(b=>{if(b)b.style.background='';});const c3dl=document.getElementById('c3d-i-piezas');if(c3dl) c3dl.innerHTML='';c3dPiezasActivas=[];c3dPiezaCounter=0;['lsr','neo'].forEach(k=>{const p=document.getElementById(k+'-inline-panel');if(p)p.style.display='none';Object.values(_qcalcBtns(k)).forEach(b=>{if(b)b.style.background='';});});}
  if(type==='proveedor'){['np-nombre','np-contacto','np-cargo','np-telefono','np-whatsapp','np-email','np-web','np-rut','np-comuna','np-region','np-plazo','np-productos','np-notas'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});setPvSelectedCats('np',[]);const rep=document.getElementById('np-rep');if(rep) rep.value='3';const est=document.getElementById('np-estado');if(est) est.value='Activo';const cp=document.getElementById('np-condpago');if(cp) cp.value='';}
}