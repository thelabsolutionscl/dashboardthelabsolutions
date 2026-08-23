/* Integración del Farm Controller con Máquinas.
 * - sesión corta obtenida mediante Cloudflare Access / Printer Access Worker
 * - registry canónico
 * - cola durable con fallback local únicamente durante migración
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
  getToken:typeof window.getPrinterTunnelToken==='function'?window.getPrinterTunnelToken:null,
  saveIp:typeof window.savePrinterIp==='function'?window.savePrinterIp:null,
  saveConn:typeof window.savePrinterConn==='function'?window.savePrinterConn:null,
};
const ACTIVE_QUEUE_STATES=new Set(['queued','retry','checking','uploading','uploaded']);
const SESSION_SKEW_MS=30_000;
const DEFAULT_SESSION_URL='https://printer-access.thelab.solutions/session';
const counts=Object.create(null);
let jobs=[],lastQueueSync=0,queueSyncing=null,controllerOk=null;
let registry=[],registryById=Object.create(null),lastRegistrySync=0,registrySyncing=null;
let controllerRole='',session={token:'',role:'',expiresAt:0,email:'',lastError:''},sessionPromise=null;

function base(){try{return typeof getPrinterTunnel==='function'?getPrinterTunnel().replace(/\/$/,''):'';}catch(_){return'';}}
function sessionUrl(){try{return(localStorage.getItem('printer_session_url')||DEFAULT_SESSION_URL).trim();}catch(_){return DEFAULT_SESSION_URL;}}
function legacyToken(){try{return original.getToken?String(original.getToken()||''):'';}catch(_){return'';}}
function sessionValid(){return!!session.token&&Date.now()+SESSION_SKEW_MS<Number(session.expiresAt||0);}
function token(){return sessionValid()?session.token:legacyToken();}
function url(path){const t=token();return base()+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
function render(){try{if(typeof renderMonitorGrid==='function')renderMonitorGrid();}catch(_){}}
function machines(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}
function parseSessionPart(t){try{const p=String(t||'').split('.');return p.length===3&&p[0]==='v1'?JSON.parse(atob(p[1].replace(/-/g,'+').replace(/_/g,'/'))):null;}catch(_){return null;}}
function looksShortSession(t){return!!parseSessionPart(t);}

async function refreshSession(force=false){
  if(!force&&sessionValid())return session.token;
  if(sessionPromise)return sessionPromise;
  const endpoint=sessionUrl();if(!endpoint)return legacyToken();
  sessionPromise=(async()=>{
    try{
      const r=await fetch(endpoint,{method:'GET',credentials:'include',cache:'no-store',signal:AbortSignal.timeout(8000)});
      const d=await r.json().catch(()=>({}));if(!r.ok||!d.session)throw new Error(d.error||('HTTP '+r.status));
      session={token:String(d.session),role:String(d.role||''),expiresAt:Number(d.expiresAt||0),email:String(d.email||''),lastError:''};
      controllerRole=session.role||controllerRole;
      try{sessionStorage.setItem('farm_session_hint',JSON.stringify({role:session.role,expiresAt:session.expiresAt,email:session.email}));}catch(_){ }
      window.dispatchEvent?.(new CustomEvent('farm-session-updated',{detail:statusSession()}));
      return session.token;
    }catch(e){session.lastError=e?.message||String(e);return legacyToken();}
    finally{sessionPromise=null;}
  })();
  return sessionPromise;
}
function statusSession(){return{mode:sessionValid()?'short-session':legacyToken()?'legacy-token':'unavailable',role:session.role||controllerRole,expiresAt:session.expiresAt,email:session.email,lastError:session.lastError,sessionUrl:sessionUrl()};}
// Todas las funciones heredadas que construyen URLs Moonraker/WebSocket reciben
// la sesión corta sin saber que cambió el mecanismo de autenticación.
window.getPrinterTunnelToken=function(){return token();};

async function readJson(r){let d=null;try{d=await r.json();}catch(_){}if(!r.ok)throw new Error((d&&d.error)||('HTTP '+r.status));return d||{};}
async function farmFetch(path,options={},retry=true){
  if(!base())throw new Error('controller no configurado');
  if(!token())await refreshSession(false);
  let t=token();if(!t)throw new Error('sesión de granja no disponible');
  const opts={cache:'no-store',...options};
  const headers=new Headers(opts.headers||{});if(looksShortSession(t))headers.set('Authorization','Bearer '+t);opts.headers=headers;
  let r=await fetch(looksShortSession(t)?base()+path:url(path),opts);
  if(retry&&(r.status===401||r.status===403)&&looksShortSession(t)){
    session.token='';await refreshSession(true);t=token();
    const h2=new Headers(options.headers||{});if(looksShortSession(t))h2.set('Authorization','Bearer '+t);
    r=await fetch(looksShortSession(t)?base()+path:url(path),{cache:'no-store',...options,headers:h2});
  }
  return r;
}
async function authRole(force=false){
  if(controllerRole&&!force&&sessionValid())return controllerRole;
  try{await refreshSession(force);const d=await readJson(await farmFetch('/authcheck',{signal:AbortSignal.timeout(5000)},false));controllerRole=String(d.role||session.role||'');controllerOk=true;return controllerRole;}
  catch(_){controllerOk=false;return'';}
}

function rebuildRegistry(){registryById=Object.create(null);for(const m of registry)if(m&&m.id)registryById[m.id]=m;}
async function syncRegistry(force=false){
  if(registrySyncing)return registrySyncing;if(!force&&Date.now()-lastRegistrySync<15000)return registry;
  registrySyncing=(async()=>{try{const d=await readJson(await farmFetch('/farm/registry',{signal:AbortSignal.timeout(6000)}));registry=Array.isArray(d.machines)?d.machines:[];rebuildRegistry();lastRegistrySync=Date.now();controllerOk=true;}catch(_){controllerOk=false;}finally{registrySyncing=null;}return registry;})();
  return registrySyncing;
}
function durableGetPrinterIp(m){if(m&&m.id){const hit=registryById[m.id];if(hit&&hit.ip)return hit.ip;}return original.getIp?original.getIp(m):(m&&m.ip)||null;}
async function patchRegistryMachine(m,forcedIp){
  if(!m||!m.id)return null;const role=await authRole();if(role!=='admin')return null;
  const fallback=forcedIp||(original.getIp?original.getIp(m):(m.ip||''));if(!fallback)return null;
  const body={id:m.id,ip:fallback,name:m.nombre||m.name||'',model:m.modelo||m.model||'',num:m.numG||m.num||'',cam:m.cam||''};
  const d=await readJson(await farmFetch('/farm/registry',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(6000)}));
  if(d.machine){const ix=registry.findIndex(x=>x.id===m.id||x.ip===fallback);if(ix>=0)registry[ix]=d.machine;else registry.push(d.machine);rebuildRegistry();lastRegistrySync=Date.now();}
  return d.machine||null;
}
async function seedRegistry(){await syncRegistry(true);if(await authRole()!=='admin')return;for(const m of machines()){if(!m||!m.id||registryById[m.id])continue;try{await patchRegistryMachine(m);}catch(e){console.warn('[FarmRegistry] seed',m.id,e.message);}}await syncRegistry(true);}
async function updateRegistryAfterManualSave(id){const m=machines().find(x=>x.id===id);if(!m)return;const ip=localStorage.getItem('printer_ip_'+id)||m.ip||'';if(!ip)return;const current=registryById[id]||{id};Object.assign(current,{ip,updatedAt:new Date().toISOString()});if(!registryById[id])registry.push(current);registryById[id]=current;try{await patchRegistryMachine(m,ip);}catch(e){console.warn('[FarmRegistry] manual update',e.message);}}

function rebuildCounts(){Object.keys(counts).forEach(k=>delete counts[k]);jobs.filter(j=>ACTIVE_QUEUE_STATES.has(j.state)).forEach(j=>{if(j.machineId)counts[j.machineId]=(counts[j.machineId]||0)+1;});}
async function syncQueue(force=false){
  if(queueSyncing)return queueSyncing;if(!force&&Date.now()-lastQueueSync<5000)return jobs;
  queueSyncing=(async()=>{try{const d=await readJson(await farmFetch('/farm/queue',{signal:AbortSignal.timeout(6000)}));jobs=Array.isArray(d.jobs)?d.jobs:[];lastQueueSync=Date.now();controllerOk=true;rebuildCounts();render();window.dispatchEvent?.(new CustomEvent('farm-queue-updated',{detail:{jobs:[...jobs]}}));}catch(_){controllerOk=false;}finally{queueSyncing=null;}return jobs;})();return queueSyncing;
}
function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary='';const CHUNK=0x8000;for(let i=0;i<bytes.length;i+=CHUNK)binary+=String.fromCharCode(...bytes.subarray(i,i+CHUNK));return btoa(binary);}
async function enqueuePayload(payload){
  const d=await readJson(await farmFetch('/farm/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)}));
  if(!d.ok)throw new Error(d.error||'cola rechazada');await syncQueue(true);return d.job;
}
async function enqueueGcode(id,gcode,filename,secs,grams,extra={}){
  const m=machines().find(x=>x.id===id);const payload={machineId:id,ip:m?durableGetPrinterIp(m):'',filename,secs:Number(secs||0),grams:Number(grams||0),source:'dashboard',...extra,gcodeBase64:bytesToBase64(await new Blob([gcode],{type:'text/plain'}).arrayBuffer())};
  return enqueuePayload(payload);
}
async function durableAdd(id,gcode,filename,secs,grams){
  try{const m=machines().find(x=>x.id===id),job=await enqueueGcode(id,gcode,filename,secs,grams);try{toast(`📋 Encolado de forma durable en ${m?.nombre||id}`,'success');}catch(_){}return job;}
  catch(e){console.warn('[FarmQueue] controller no disponible; usando cola local',e);controllerOk=false;return original.add?original.add(id,gcode,filename,secs,grams):null;}
}
async function runJob(jobId){const d=await readJson(await farmFetch('/farm/queue/'+encodeURIComponent(jobId)+'/run',{method:'POST',signal:AbortSignal.timeout(7000)}));setTimeout(()=>syncQueue(true),1000);return d.job||d;}
async function durableStartNext(id){try{await syncQueue(true);const j=jobs.find(x=>x.machineId===id&&['queued','retry'].includes(x.state));if(!j){if(controllerOk===false&&original.start)return original.start(id);return;}return await runJob(j.id);}catch(e){console.warn('[FarmQueue] start durable falló',e);if(controllerOk===false&&original.start)return original.start(id);}}
function durableCount(id){if(Object.prototype.hasOwnProperty.call(counts,id))return counts[id];return controllerOk===false&&original.count?original.count(id):0;}

if(original.add)window._queueAdd=durableAdd;
if(original.start)window._queueStartNext=durableStartNext;
if(original.count)window._queueCount=durableCount;
if(original.getIp)window.getPrinterIp=durableGetPrinterIp;
if(original.saveIp)window.savePrinterIp=function(id){const out=original.saveIp.apply(this,arguments);setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};
if(original.saveConn)window.savePrinterConn=function(){const id=document.getElementById('printerConnId')?.value||'';const out=original.saveConn.apply(this,arguments);if(id)setTimeout(()=>updateRegistryAfterManualSave(id),0);return out;};

refreshSession(false).finally(()=>Promise.all([syncQueue(true),syncRegistry(true),authRole(true)]).then(()=>seedRegistry()).catch(()=>{}));
setInterval(()=>{if(!document.hidden){refreshSession(false);syncQueue(false);syncRegistry(false);}},15000);
window.addEventListener('focus',()=>{refreshSession(true);syncQueue(true);syncRegistry(true);});
window.addEventListener('farm-controller-health',()=>{syncQueue(true);syncRegistry(true);});

window.FarmSessionAuth={refresh:refreshSession,token,status:statusSession,setSessionUrl:(v)=>{localStorage.setItem('printer_session_url',String(v||''));session.token='';return refreshSession(true);}};
window.FarmQueue={sync:syncQueue,enqueueGcode,enqueuePayload,runJob,findById:id=>jobs.find(x=>x.id===id)||null,status:()=>({controllerOk,lastSync:lastQueueSync,jobs:[...jobs],counts:{...counts}})};
window.FarmRegistry={sync:syncRegistry,seed:seedRegistry,ipFor:durableGetPrinterIp,status:()=>({controllerOk,role:controllerRole,lastSync:lastRegistrySync,machines:[...registry]})};
})();
