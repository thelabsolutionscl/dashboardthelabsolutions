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

const ACTIVE_QUEUE_STATES=new Set(['queued','retry','checking','uploading','uploaded']);
const counts=Object.create(null);
let jobs=[],lastQueueSync=0,queueSyncing=null,controllerOk=null;
let registry=[],registryById=Object.create(null),lastRegistrySync=0,registrySyncing=null;
let controllerRole='';

function token(){try{return typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';}catch(_){return'';}}
function base(){try{return typeof getPrinterTunnel==='function'?getPrinterTunnel().replace(/\/$/,''):'';}catch(_){return'';}}
function url(path){const t=token();return base()+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
function render(){try{if(typeof renderMonitorGrid==='function')renderMonitorGrid();}catch(_){}}
function machines(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}

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
function durableGetPrinterIp(m){
  if(m&&m.id){const hit=registryById[m.id];if(hit&&hit.ip)return hit.ip;}
  return original.getIp?original.getIp(m):(m&&m.ip)||null;
}
async function patchRegistryMachine(m,forcedIp){
  if(!m||!m.id)return null;
  const role=await authRole();if(role!=='admin')return null;
  const fallback=forcedIp||(original.getIp?original.getIp(m):(m.ip||''));
  if(!fallback)return null;
  const body={id:m.id,ip:fallback,name:m.nombre||m.name||'',model:m.modelo||m.model||'',num:m.numG||m.num||''};
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
    if(!m||!m.id||registryById[m.id])continue;
    try{await patchRegistryMachine(m);}catch(e){console.warn('[FarmRegistry] seed',m.id,e.message);}
  }
  await syncRegistry(true);
}
async function updateRegistryAfterManualSave(id){
  const m=machines().find(x=>x.id===id);if(!m)return;
  const ip=localStorage.getItem('printer_ip_'+id)||m.ip||'';
  if(!ip)return;
  // Reflejo inmediato para que polling/WebSocket usen la IP que el operador
  // acaba de guardar, incluso antes de que termine el PATCH remoto.
  const current=registryById[id]||{id};Object.assign(current,{ip,updatedAt:new Date().toISOString()});
  if(!registryById[id])registry.push(current);registryById[id]=current;
  try{await patchRegistryMachine(m,ip);}catch(e){console.warn('[FarmRegistry] manual update',e.message);}
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
      jobs=Array.isArray(d.jobs)?d.jobs:[];lastQueueSync=Date.now();controllerOk=true;rebuildCounts();render();
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
async function durableAdd(id,gcode,filename,secs,grams){
  try{
    const m=machines().find(x=>x.id===id);
    const payload={machineId:id,ip:m?durableGetPrinterIp(m):'',filename,secs:Number(secs||0),grams:Number(grams||0),source:'dashboard',gcodeBase64:bytesToBase64(await new Blob([gcode],{type:'text/plain'}).arrayBuffer())};
    const r=await fetch(url('/farm/queue'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const d=await readJson(r);if(!d.ok)throw new Error(d.error||'cola rechazada');
    counts[id]=(counts[id]||0)+1;
    try{toast(`📋 Encolado de forma durable en ${m?.nombre||id} (#${counts[id]} en cola)`,'success');}catch(_){}
    await syncQueue(true);render();return d.job;
  }catch(e){
    console.warn('[FarmQueue] controller no disponible; usando cola local',e);
    controllerOk=false;
    return original.add?original.add(id,gcode,filename,secs,grams):null;
  }
}
async function durableStartNext(id){
  try{
    await syncQueue(true);
    const j=jobs.find(x=>x.machineId===id&&['queued','retry'].includes(x.state));
    if(!j){if(controllerOk===false&&original.start)return original.start(id);return;}
    const r=await fetch(url('/farm/queue/'+encodeURIComponent(j.id)+'/run'),{method:'POST',signal:AbortSignal.timeout(5000)});
    await readJson(r);setTimeout(()=>syncQueue(true),1200);
  }catch(e){
    console.warn('[FarmQueue] start durable falló',e);
    if(controllerOk===false&&original.start)return original.start(id);
  }
}
function durableCount(id){
  if(Object.prototype.hasOwnProperty.call(counts,id))return counts[id];
  return controllerOk===false&&original.count?original.count(id):0;
}

// Instalar wrappers una vez que maquinas.js ya definió sus funciones.
if(original.add)window._queueAdd=durableAdd;
if(original.start)window._queueStartNext=durableStartNext;
if(original.count)window._queueCount=durableCount;
if(original.getIp)window.getPrinterIp=durableGetPrinterIp;
if(original.saveIp)window.savePrinterIp=function(id){const out=original.saveIp.apply(this,arguments);setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};
if(original.saveConn)window.savePrinterConn=function(){const id=document.getElementById('printerConnId')?.value||'';const out=original.saveConn.apply(this,arguments);if(id)setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};

Promise.all([syncQueue(true),syncRegistry(true),authRole(true)]).then(()=>seedRegistry()).catch(()=>{});
setInterval(()=>{if(!document.hidden){syncQueue(false);syncRegistry(false);}},15000);
window.addEventListener('focus',()=>{syncQueue(true);syncRegistry(true);});
window.addEventListener('farm-controller-health',()=>{syncQueue(true);syncRegistry(true);});

window.FarmQueue={sync:syncQueue,status:()=>({controllerOk,lastSync:lastQueueSync,jobs:[...jobs],counts:{...counts}})};
window.FarmRegistry={sync:syncRegistry,seed:seedRegistry,ipFor:durableGetPrinterIp,status:()=>({controllerOk,role:controllerRole,lastSync:lastRegistrySync,machines:[...registry]})};
})();
