/* Cola durable para Máquinas. Se carga después de maquinas.js. */
(function(){
'use strict';
if (window.__TLS_DURABLE_QUEUE__) return;
window.__TLS_DURABLE_QUEUE__ = true;
const original={
  add:typeof window._queueAdd==='function'?window._queueAdd:null,
  start:typeof window._queueStartNext==='function'?window._queueStartNext:null,
  count:typeof window._queueCount==='function'?window._queueCount:null,
};
const counts=Object.create(null); let jobs=[],lastSync=0,syncing=null,controllerOk=null;
function token(){try{return typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';}catch(_){return'';}}
function base(){try{return typeof getPrinterTunnel==='function'?getPrinterTunnel().replace(/\/$/,''):'';}catch(_){return'';}}
function url(path){const t=token();return base()+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
function rebuildCounts(){Object.keys(counts).forEach(k=>delete counts[k]);jobs.filter(j=>['queued','retry','uploading','uploaded'].includes(j.state)).forEach(j=>{if(j.machineId)counts[j.machineId]=(counts[j.machineId]||0)+1;});}
async function sync(force=false){
  if(syncing)return syncing; if(!force&&Date.now()-lastSync<5000)return jobs;
  const b=base(),t=token(); if(!b||!t)return jobs;
  syncing=(async()=>{try{const r=await fetch(url('/farm/queue'),{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();jobs=Array.isArray(d.jobs)?d.jobs:[];lastSync=Date.now();controllerOk=true;rebuildCounts();try{if(typeof renderMonitorGrid==='function')renderMonitorGrid();}catch(_){}}catch(e){controllerOk=false;}finally{syncing=null;}return jobs;})();
  return syncing;
}
function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary='';const CHUNK=0x8000;for(let i=0;i<bytes.length;i+=CHUNK)binary+=String.fromCharCode(...bytes.subarray(i,i+CHUNK));return btoa(binary);}
async function durableAdd(id,gcode,filename,secs,grams){
  try{
    const m=(typeof MAQUINAS!=='undefined'?MAQUINAS:[]).find(x=>x.id===id);
    const payload={machineId:id,ip:m&&typeof getPrinterIp==='function'?getPrinterIp(m):(m?.ip||''),filename,secs:Number(secs||0),grams:Number(grams||0),source:'dashboard',gcodeBase64:bytesToBase64(await new Blob([gcode],{type:'text/plain'}).arrayBuffer())};
    const r=await fetch(url('/farm/queue'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();if(!d.ok)throw new Error(d.error||'cola rechazada');counts[id]=(counts[id]||0)+1;
    try{toast(`📋 Encolado de forma durable en ${m?.nombre||id} (#${counts[id]} en cola)`,'success');}catch(_){}
    sync(true);try{if(typeof renderMonitorGrid==='function')renderMonitorGrid();}catch(_){}return d.job;
  }catch(e){console.warn('[FarmQueue] controller no disponible; usando cola local',e);controllerOk=false;return original.add?original.add(id,gcode,filename,secs,grams):null;}
}
async function durableStartNext(id){
  try{await sync(true);const j=jobs.find(x=>x.machineId===id&&['queued','retry'].includes(x.state));if(!j){if(controllerOk===false&&original.start)return original.start(id);return;}const r=await fetch(url('/farm/queue/'+encodeURIComponent(j.id)+'/run'),{method:'POST',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('HTTP '+r.status);setTimeout(()=>sync(true),1200);}catch(e){if(original.start)return original.start(id);}
}
function durableCount(id){if(Object.prototype.hasOwnProperty.call(counts,id))return counts[id];return controllerOk===false&&original.count?original.count(id):0;}
if(original.add)window._queueAdd=durableAdd;if(original.start)window._queueStartNext=durableStartNext;if(original.count)window._queueCount=durableCount;
sync(true);setInterval(()=>{if(!document.hidden)sync(false);},15000);window.addEventListener('focus',()=>sync(true));
window.FarmQueue={sync,status:()=>({controllerOk,lastSync,jobs:[...jobs],counts:{...counts}})};
})();
