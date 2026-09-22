/* Integración del Farm Controller con Máquinas.
 * Se carga después de maquinas.js y envuelve la cola/IP existentes sin romper
 * el fallback local si el controller aún no está desplegado.
 */
(function(){
'use strict';
if(window.__TLS_FARM_CONTROLLER_INTEGRATION__)return;
window.__TLS_FARM_CONTROLLER_INTEGRATION__=true;

const original={
  add:typeof window._queueAdd==='function'?window._queueAdd:null,
  start:typeof window._queueStartNext==='function'?window._queueStartNext:null,
  count:typeof window._queueCount==='function'?window._queueCount:null,
  getIp:typeof window.getPrinterIp==='function'?window.getPrinterIp:null,
  saveIp:typeof window.savePrinterIp==='function'?window.savePrinterIp:null,
  saveConn:typeof window.savePrinterConn==='function'?window.savePrinterConn:null,
};

const ACTIVE_QUEUE_STATES=new Set(['queued','retry','checking','uploading','uploaded','started','printing']);
const counts=Object.create(null);
let jobs=[],lastQueueSync=0,queueSyncing=null,controllerOk=null;
let registry=[],registryById=Object.create(null),lastRegistrySync=0,registrySyncing=null;
let controllerRole='';
let operations=[],lastOperationsSync=0,operationsSyncing=null;

function token(){try{return typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';}catch(_){return'';}}
function base(){try{return typeof getPrinterTunnel==='function'?getPrinterTunnel().replace(/\/$/,''):'';}catch(_){return'';}}
function url(path){const t=token();return base()+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
function render(){try{if(typeof renderMonitorGrid==='function')renderMonitorGrid();}catch(_){}}
function machines(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}
function executionId(prefix='exec'){
  try{if(globalThis.crypto?.randomUUID)return prefix+'-'+globalThis.crypto.randomUUID();}catch(_){}
  return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function readJson(r){
  let d=null;try{d=await r.json();}catch(_){}
  if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));
  return d||{};
}
async function authRole(force=false){
  if(controllerRole&&!force)return controllerRole;
  const b=base(),t=token();if(!b||!t)return'';
  try{const r=await fetch(url('/authcheck'),{cache:'no-store',signal:AbortSignal.timeout(5000)});const d=await readJson(r);controllerRole=String(d.role||'');controllerOk=true;return controllerRole;}
  catch(_){controllerOk=false;return'';}
}

// ── Registry: identidad estable > IP guardada en navegador ───────────────
function rebuildRegistry(){
  registryById=Object.create(null);
  for(const m of registry){if(m&&m.id)registryById[m.id]=m;}
}
async function syncRegistry(force=false){
  if(registrySyncing)return registrySyncing;
  if(!force&&Date.now()-lastRegistrySync<15000)return registry;
  const b=base(),t=token();if(!b||!t)return registry;
  registrySyncing=(async()=>{
    try{
      const r=await fetch(url('/farm/registry'),{cache:'no-store',signal:AbortSignal.timeout(6000)});
      const d=await readJson(r);
      registry=Array.isArray(d.machines)?d.machines:[];
      rebuildRegistry();lastRegistrySync=Date.now();controllerOk=true;
    }catch(e){controllerOk=false;}
    finally{registrySyncing=null;}
    return registry;
  })();
  return registrySyncing;
}
function confirmedPrinterIp(id){
  if(!id)return'';
  try{return String(localStorage.getItem('printer_ip_confirmed_'+id)||'').trim();}catch(_){return'';}
}
function durableGetPrinterIp(m){
  if(m&&m.id){
    const hit=registryById[m.id];if(hit&&hit.ip)return hit.ip;
    if(m.ip)return m.ip;
    const confirmed=confirmedPrinterIp(m.id);if(confirmed)return confirmed;
  }
  return original.getIp?original.getIp(m):(m&&m.ip)||null;
}
async function patchRegistryMachine(m,forcedIp){
  if(!m||!m.id)return null;
  const role=await authRole();if(role!=='admin')return null;
  const forced=arguments.length>=2;
  const fallback=forced?String(forcedIp||''):(original.getIp?original.getIp(m):(m.ip||''));
  if(!forced&&!fallback)return null;
  const nozzle=localStorage.getItem('printer_nozzle_'+m.id)||m.nozzleInstalled||'';
  let cfsInstalled=false;try{cfsInstalled=typeof machineHasPhysicalCfs==='function'?machineHasPhysicalCfs(m):false;}catch(_){}
  let cameraConfigured=false;try{cameraConfigured=!!(localStorage.getItem('printer_cam_'+m.id)||m.cam||(typeof _defaultCamUrl==='function'&&_defaultCamUrl(m)));}catch(_){}
  const body={id:m.id,ip:fallback,name:m.nombre||m.name||'',model:m.modelo||m.model||'',num:m.numG||m.num||'',nozzleInstalled:nozzle,
    physicalProfile:{cfsInstalled,cameraConfigured,profileVersion:1}};
  const r=await fetch(url('/farm/registry'),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});
  const d=await readJson(r);
  if(d.machine){
    const ix=registry.findIndex(x=>x.id===m.id||x.ip===fallback);
    if(ix>=0)registry[ix]=d.machine;else registry.push(d.machine);
    rebuildRegistry();lastRegistrySync=Date.now();
  }
  return d.machine||null;
}
async function seedRegistry(){
  await syncRegistry(true);
  const role=await authRole();if(role!=='admin')return;
  // Solo si falta el ID canónico. Si ya existe, jamás pisamos una IP descubierta
  // con un override viejo del navegador. Un guardado manual sí actualiza abajo.
  for(const m of machines()){
    if(!m||!m.id)continue;
    const confirmed=confirmedPrinterIp(m.id),current=registryById[m.id];
    try{
      // Un navegador viejo jamás puede pisar un registry que ya existe.
      // Los cambios manuales explícitos pasan por updateRegistryAfterManualSave.
      if(current)continue;
      if(confirmed)await patchRegistryMachine(m,confirmed);
      else await patchRegistryMachine(m);
    }catch(e){console.warn('[FarmRegistry] seed',m.id,e.message);}
  }
  await syncRegistry(true);
}
async function updateRegistryAfterManualSave(id){
  const m=machines().find(x=>x.id===id);if(!m)return;
  const hasLocal=localStorage.getItem('printer_ip_'+id)!==null;
  const ip=hasLocal?(localStorage.getItem('printer_ip_'+id)||''):(m.ip||'');
  if(ip)localStorage.setItem('printer_ip_confirmed_'+id,ip);else localStorage.removeItem('printer_ip_confirmed_'+id);
  const current=registryById[id]||{id};Object.assign(current,{ip,updatedAt:new Date().toISOString()});
  if(!registryById[id])registry.push(current);registryById[id]=current;
  try{await patchRegistryMachine(m,ip);}catch(e){console.warn('[FarmRegistry] manual update',e.message);}
}
let registryDiscovery=null;
async function discoverRegistry(){
  if(registryDiscovery)return registryDiscovery;
  registryDiscovery=(async()=>{
    const role=await authRole();
    if(role!=='admin')return{started:false,reason:'admin-required'};
    const b=base(),t=token();if(!b||!t)return{started:false,reason:'controller-unavailable'};
    const r=await fetch(url('/farm/discover'),{method:'POST',signal:AbortSignal.timeout(6000)});
    const d=await readJson(r);
    if(d.started){
      const refresh=async()=>{
        try{
          await syncRegistry(true);
          if(typeof pollPrinters==='function')pollPrinters();
          render();
        }catch(e){console.warn('[FarmRegistry] refresh tras discovery',e.message);}
      };
      // El endpoint inicia un barrido LAN asíncrono. Refrescamos una vez durante
      // el barrido y otra al final del peor caso habitual para adoptar cambios DHCP.
      setTimeout(refresh,4000);
      setTimeout(refresh,16000);
    }
    return d;
  })().finally(()=>{registryDiscovery=null;});
  return registryDiscovery;
}

// ── Cola durable ─────────────────────────────────────────────────────────
function rebuildCounts(){
  Object.keys(counts).forEach(k=>delete counts[k]);
  jobs.filter(j=>ACTIVE_QUEUE_STATES.has(j.state)).forEach(j=>{if(j.machineId)counts[j.machineId]=(counts[j.machineId]||0)+1;});
}
async function syncQueue(force=false){
  if(queueSyncing)return queueSyncing;
  if(!force&&Date.now()-lastQueueSync<5000)return jobs;
  const b=base(),t=token();if(!b||!t)return jobs;
  queueSyncing=(async()=>{
    try{
      const r=await fetch(url('/farm/queue'),{cache:'no-store',signal:AbortSignal.timeout(5000)});
      const d=await readJson(r);
      jobs=Array.isArray(d.jobs)?d.jobs:[];lastQueueSync=Date.now();controllerOk=true;rebuildCounts();
      try{window.MachineOps?.reconcileFarmQueueJobs?.(jobs);}catch(_){}
      render();
    }catch(e){controllerOk=false;}
    finally{queueSyncing=null;}
    return jobs;
  })();
  return queueSyncing;
}
function bytesToBase64(buffer){
  const bytes=new Uint8Array(buffer);let binary='';const CHUNK=0x8000;
  for(let i=0;i<bytes.length;i+=CHUNK)binary+=String.fromCharCode(...bytes.subarray(i,i+CHUNK));
  return btoa(binary);
}
async function _postQueue(path,payload,timeout=15000){
  const b=base(),t=token();if(!b||!t)throw new Error('Farm Controller/token no disponible');
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url(path),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});
      return await readJson(r);
    }catch(e){lastError=e;if(attempt===0)await sleep(450);}
  }
  throw lastError||new Error('Controller sin respuesta');
}
async function durableAdd(id,gcode,filename,secs,grams,meta={}){
  const m=machines().find(x=>x.id===id),metadata=meta&&typeof meta==='object'?{...meta}:{};
  const idempotencyKey=String(metadata.idempotencyKey||metadata.executionId||executionId('upload'));
  metadata.idempotencyKey=idempotencyKey;
  try{
    const payload={machineId:id,filename,secs:Number(secs||0),grams:Number(grams||0),source:metadata.source||'dashboard',metadata,idempotencyKey,
      gcodeBase64:bytesToBase64(await new Blob([gcode],{type:'text/plain'}).arrayBuffer())};
    const d=await _postQueue('/farm/queue',payload,20000);if(!d.ok)throw new Error(d.error||'cola rechazada');
    controllerOk=true;
    try{toast(`📋 Controller confirmó ${filename} en ${m?.nombre||id}`,'success');}catch(_){}
    try{window.MachineOps?.onLegacyQueueAdd?.(id,filename,secs,grams,metadata);}catch(_){}
    await syncQueue(true);render();return d.job||null;
  }catch(e){
    console.warn('[FarmQueue] no se confirmó cola durable',e);
    controllerOk=false;
    try{toast('No se creó una cola local de respaldo: Controller no confirmó el trabajo. Reintenta al recuperar conexión.','error');}catch(_){}
    return null;
  }
}
async function startExisting(id,filename,meta={}){
  const metadata=meta&&typeof meta==='object'?{...meta}:{},idempotencyKey=String(metadata.idempotencyKey||metadata.executionId||executionId('existing'));
  metadata.idempotencyKey=idempotencyKey;
  const d=await _postQueue('/farm/queue/existing',{machineId:id,filename,source:metadata.source||'machineops',metadata,idempotencyKey,existingFile:true},12000);
  controllerOk=true;await syncQueue(true);render();return d.job||null;
}
async function confirmBedClear(id,signature){
  if(!id||!signature)throw new Error('machineId/signature requeridos');
  const d=await _postQueue('/farm/ready/'+encodeURIComponent(id),{signature},8000);
  controllerOk=true;await syncQueue(true);render();return d;
}
async function syncOperations(force=false){
  if(operationsSyncing)return operationsSyncing;
  if(!force&&Date.now()-lastOperationsSync<5000)return operations;
  const b=base(),t=token();if(!b||!t)return operations;
  operationsSyncing=(async()=>{
    try{
      const r=await fetch(url('/farm/operations'),{cache:'no-store',signal:AbortSignal.timeout(5000)}),d=await readJson(r);
      const previousIds=new Set(operations.map(x=>x.machineId));operations=Array.isArray(d.operations)?d.operations:[];const nextIds=new Set(operations.map(x=>x.machineId));
      previousIds.forEach(id=>{if(!nextIds.has(id))window.MachineActivityStore?.clear?.(id);});lastOperationsSync=Date.now();controllerOk=true;
      window.MachineActivityStore?.merge?.(operations);render();
    }catch(_){controllerOk=false;}
    finally{operationsSyncing=null;}
    return operations;
  })();
  return operationsSyncing;
}
async function setOperation(id,operation={}){
  if(!id)throw new Error('machineId requerido');
  window.MachineActivityStore?.set?.(id,operation);
  const r=await fetch(url('/farm/operations/'+encodeURIComponent(id)),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation),signal:AbortSignal.timeout(6000)}),d=await readJson(r);
  if(d.operation)window.MachineActivityStore?.set?.(id,d.operation);await syncOperations(true);return d.operation||operation;
}
async function clearOperation(id){
  if(!id)return false;window.MachineActivityStore?.clear?.(id);
  const r=await fetch(url('/farm/operations/'+encodeURIComponent(id)),{method:'DELETE',signal:AbortSignal.timeout(6000)}),d=await readJson(r);
  await syncOperations(true);return d.removed!==false;
}
async function durableStartNext(id){
  try{
    await syncQueue(true);
    const j=jobs.find(x=>x.machineId===id&&['queued','retry'].includes(x.state));
    if(!j){if(controllerOk===false)throw new Error('Farm Controller no disponible');return null;}
    const r=await fetch(url('/farm/queue/'+encodeURIComponent(j.id)+'/run'),{method:'POST',signal:AbortSignal.timeout(5000)});
    const d=await readJson(r);setTimeout(()=>syncQueue(true),1200);return d.job||j;
  }catch(e){
    console.warn('[FarmQueue] start durable falló',e);controllerOk=false;
    try{toast('No se inicia desde la cola local: Farm Controller no confirmó la ejecución','error');}catch(_){}
    return null;
  }
}
function durableCount(id){
  if(Object.prototype.hasOwnProperty.call(counts,id))return counts[id];
  return 0;
}

// Instalar wrappers una vez que maquinas.js ya definió sus funciones.
if(original.add)window._queueAdd=durableAdd;
if(original.start)window._queueStartNext=durableStartNext;
if(original.count)window._queueCount=durableCount;
if(original.getIp)window.getPrinterIp=durableGetPrinterIp;
if(original.saveIp)window.savePrinterIp=function(id){const out=original.saveIp.apply(this,arguments);setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};
if(original.saveConn)window.savePrinterConn=function(){const id=document.getElementById('printerConnId')?.value||'';const out=original.saveConn.apply(this,arguments);if(id)setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};

Promise.all([syncQueue(true),syncRegistry(true),syncOperations(true),authRole(true)]).then(()=>seedRegistry()).catch(()=>{});
setInterval(()=>{syncQueue(false);syncRegistry(false);syncOperations(false);},15000);
const _resumeControllerSync=()=>{syncQueue(true);syncRegistry(true);syncOperations(true);};
window.addEventListener('focus',_resumeControllerSync);
window.addEventListener('online',_resumeControllerSync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)_resumeControllerSync();});
window.addEventListener('farm-controller-health',_resumeControllerSync);

window.FarmQueue={sync:syncQueue,startExisting,confirmBedClear,status:()=>({controllerOk,lastSync:lastQueueSync,jobs:[...jobs],counts:{...counts}})};
window.FarmRegistry={sync:syncRegistry,seed:seedRegistry,discover:discoverRegistry,ipFor:durableGetPrinterIp,status:()=>({controllerOk,role:controllerRole,lastSync:lastRegistrySync,machines:[...registry]})};
window.FarmOperations={sync:syncOperations,set:setOperation,clear:clearOperation,status:()=>({controllerOk,lastSync:lastOperationsSync,operations:[...operations]})};
})();
