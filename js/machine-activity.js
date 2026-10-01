/* Fuente única de verdad para actividad y disponibilidad física de impresoras.
 * No confundir `print_stats.state` con disponibilidad: Klipper puede ejecutar
 * HOME, macros o calibraciones mientras print_stats continúa en standby.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.MachineActivity=api;api.install(root);}
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';

const STORAGE_KEY='thelab_machine_operations_v1';
const FREE_STATES=new Set(['idle','ready','standby']);
const PRINTING_STATES=new Set(['printing','paused']);
const FAULT_STATES=new Set(['shutdown','error','offline','noip','apidown']);
const TRANSIENT_STATES=new Set(['','unknown','startup','connecting']);
const TERMINAL_STATES=new Set(['complete','completed','cancelled','canceled']);
const OP_TYPES=new Set(['bed_calibration','gcode','maintenance']);
const DEFAULT_TTL_MS=30*60*1000;

function num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function normalizeState(value){return String(value||'unknown').trim().toLowerCase();}
function normalizeOperation(value,now=Date.now()){
  if(!value||typeof value!=='object')return null;
  const type=OP_TYPES.has(String(value.type||''))?String(value.type):'gcode';
  const startedAt=num(value.startedAt,now),expiresAt=num(value.expiresAt,startedAt+DEFAULT_TTL_MS);
  if(expiresAt<=now)return null;
  return{machineId:String(value.machineId||''),type,label:String(value.label||''),phase:String(value.phase||''),source:String(value.source||''),sessionId:String(value.sessionId||''),startedAt,expiresAt,updatedAt:num(value.updatedAt,startedAt)};
}
function derive(status={},options={}){
  const now=num(options.now,Date.now()),rawState=normalizeState(status?.state),operation=normalizeOperation(options.operation,now);
  const lastSeenAt=num(status?.lastSeenAt||status?.updatedAt),telemetryFresh=status?.stale!==true&&!!lastSeenAt&&now-lastSeenAt<Math.max(1000,num(options.freshMs,60000));
  const adminAvailable=options.adminAvailable!==false,bedCleared=options.bedCleared!==false;
  const busyGcode=status?.busyGcode===true||normalizeState(status?.idleTimeoutState)==='printing'&&!PRINTING_STATES.has(rawState);
  let state=rawState,label=rawState,reason='Estado no confirmado';
  if(FAULT_STATES.has(rawState)){label='No disponible';reason='Falla o desconexión: '+rawState;}
  else if(operation?.type==='bed_calibration'){state='calibrating';label='Calibrando';reason=(operation.phase||operation.label||'Nivelación de cama en curso')+(telemetryFresh?'':' · telemetría pendiente');}
  else if(TRANSIENT_STATES.has(rawState)||!telemetryFresh){state=telemetryFresh?rawState:'unknown';label='Sin telemetría confiable';reason=!lastSeenAt?'Sin lectura reciente':'Telemetría desactualizada';}
  else if(rawState==='printing'){state='printing';label='Imprimiendo';reason='Trabajo de impresión activo';}
  else if(rawState==='paused'){state='paused';label='Pausada';reason='Impresión pausada';}
  else if(operation||busyGcode){state=operation?.type==='bed_calibration'?'calibrating':'gcode';label=state==='calibrating'?'Calibrando':'Ejecutando G-code';reason=operation?.phase||operation?.label||'Macro o G-code en curso';}
  else if(rawState==='complete'||rawState==='completed'){state='complete';label='Impresión finalizada';reason=bedCleared?'Trabajo terminado; esperando estado libre':'Retirar pieza y confirmar cama libre';}
  else if(rawState==='cancelled'||rawState==='canceled'){state='cancelled';label='Impresión cancelada';reason='Revisión requerida antes de reutilizar';}
  else if(FREE_STATES.has(rawState)){state=rawState;label='En línea · libre';reason='Telemetría reciente y sin actividad física';}
  const physicalBusy=PRINTING_STATES.has(rawState)||!!operation||busyGcode||state==='calibrating'||state==='gcode';
  const available=adminAvailable&&telemetryFresh&&FREE_STATES.has(rawState)&&!physicalBusy&&bedCleared;
  const plannable=adminAvailable&&telemetryFresh&&!FAULT_STATES.has(rawState)&&!TRANSIENT_STATES.has(rawState)&&!TERMINAL_STATES.has(rawState)&&state!=='calibrating'&&state!=='gcode';
  if(!adminAvailable){label='No operativa';reason='Bloqueo administrativo';}
  return{state,rawState,label,reason,physicalBusy,available,plannable,telemetryFresh,lastSeenAt,busyGcode,operation,adminAvailable,bedCleared};
}

function createStore(host=root){
  let cache=Object.create(null),loaded=false;
  const storage=()=>{try{return host?.localStorage||null;}catch(_){return null;}};
  function load(){
    if(loaded)return cache;loaded=true;
    try{const parsed=JSON.parse(storage()?.getItem(STORAGE_KEY)||'{}');cache=parsed&&typeof parsed==='object'?parsed:Object.create(null);}catch(_){cache=Object.create(null);}
    prune(false);return cache;
  }
  function persist(){try{storage()?.setItem(STORAGE_KEY,JSON.stringify(cache));}catch(_){};notify();}
  function notify(){try{host?.dispatchEvent?.(new CustomEvent('machine-activity-change'));}catch(_){}}
  function prune(save=true){
    const now=Date.now();let changed=false;
    for(const id of Object.keys(cache)){if(!normalizeOperation(cache[id],now)){delete cache[id];changed=true;}}
    if(changed&&save)persist();return changed;
  }
  function get(id){load();const op=normalizeOperation(cache[String(id||'')]);if(!op&&cache[String(id||'')]){delete cache[String(id||'')];persist();}return op;}
  function set(id,patch={}){
    load();const key=String(id||'');if(!key)return null;const now=Date.now(),previous=get(key)||{};
    const op=normalizeOperation({...previous,...patch,machineId:key,startedAt:num(patch.startedAt,previous.startedAt||now),updatedAt:now,expiresAt:num(patch.expiresAt,previous.expiresAt||now+DEFAULT_TTL_MS)},now);
    if(!op)return null;cache[key]=op;persist();return op;
  }
  function clear(id){load();const key=String(id||'');if(!cache[key])return false;delete cache[key];persist();return true;}
  function merge(rows){
    load();const incoming=Array.isArray(rows)?rows:Object.values(rows||{}),seen=new Set();
    for(const row of incoming){const op=normalizeOperation(row);if(!op||!op.machineId)continue;seen.add(op.machineId);if(!cache[op.machineId]||num(cache[op.machineId].updatedAt)<=op.updatedAt)cache[op.machineId]=op;}
    prune(false);persist();return snapshot();
  }
  function snapshot(){load();prune(false);return Object.values(cache).map(x=>({...x}));}
  try{host?.addEventListener?.('storage',e=>{if(e.key===STORAGE_KEY){loaded=false;load();notify();}});}catch(_){}
  return{get,set,clear,merge,snapshot,prune};
}
function install(host){
  if(!host||host.MachineActivityStore)return false;
  host.MachineActivityStore=createStore(host);
  return true;
}

return{derive,normalizeOperation,normalizeState,createStore,install,FREE_STATES,FAULT_STATES,TRANSIENT_STATES,TERMINAL_STATES,STORAGE_KEY,DEFAULT_TTL_MS};
});
