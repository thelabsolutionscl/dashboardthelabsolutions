/* js/machineops-farm-queue-adapter.js
 * Une el estado lógico de MachineOps con la cola durable del Farm Controller.
 * Un trabajo sólo pasa a `en_cola` después de recibir un farmJobId central.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)api.installWhenReady(root);
})(typeof window!=='undefined'?window:null,function(root){
'use strict';
const STORAGE_KEY='thelab_machine_ops_v2';
const LINK_KEY='machineops_farm_links_v1';
let installed=false,timer=null,lastError='',lastLinkedAt=0;
const inflight=new Map();

function parse(raw,fallback){try{return JSON.parse(raw)||fallback;}catch(_){return fallback;}}
function opsData(target=root){return parse(target?.localStorage?.getItem(STORAGE_KEY)||'{}',{});}
function jobById(id,target=root){return(Array.isArray(opsData(target).jobs)?opsData(target).jobs:[]).find(j=>j?.id===id)||null;}
function links(target=root){return parse(target?.localStorage?.getItem(LINK_KEY)||'{}',{});}
function saveLinks(value,target=root){try{target.localStorage.setItem(LINK_KEY,JSON.stringify(value));}catch(_){}return value;}
function getLink(id,target=root){return links(target)[id]||null;}
function setLink(id,farmJob,target=root){const all=links(target);all[id]={farmJobId:farmJob.id,machineId:farmJob.machineId||'',filename:farmJob.filename||'',state:farmJob.state||'queued',linkedAt:Date.now(),updatedAt:Date.now()};saveLinks(all,target);lastLinkedAt=Date.now();return all[id];}
function updateLinksFromQueue(target=root){
  const fq=target?.FarmQueue?.status?.();if(!fq?.jobs)return;
  const all=links(target),by=new Map(fq.jobs.map(j=>[j.id,j]));let changed=false;
  for(const [id,link]of Object.entries(all)){const row=by.get(link.farmJobId);if(!row)continue;const state=String(row.state||'');if(state!==link.state){link.state=state;link.updatedAt=Date.now();changed=true;}}
  if(changed)saveLinks(all,target);
}
function priorityValue(p){return({urgente:90,alta:75,normal:50,baja:30})[String(p||'').toLowerCase()]||50;}
function machineById(id,target=root){try{return(Array.isArray(target.MAQUINAS)?target.MAQUINAS:[]).find(m=>m.id===id)||null;}catch(_){return null;}}
function encodeFilePath(filename){return String(filename||'').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');}
async function fetchGcode(job,target=root){
  const m=machineById(job.machineId,target);if(!m)throw new Error('Máquina no encontrada');
  const ip=typeof target.getPrinterIp==='function'?target.getPrinterIp(m):(m.ip||'');if(!ip)throw new Error('Máquina sin IP');
  const file=String(job.gcodeFile||'').trim();if(!file)throw new Error('El trabajo no tiene archivo G-code');
  if(typeof target.printerUrl!=='function')throw new Error('printerUrl no disponible');
  const headers=typeof target.getPrinterAuthHeaders==='function'?target.getPrinterAuthHeaders(job.machineId):{};
  const path='/server/files/gcodes/'+encodeFilePath(file);
  const r=await target.fetch(target.printerUrl(ip,path),{headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error(`No se pudo leer ${file} desde Moonraker (HTTP ${r.status})`);
  const buf=await r.arrayBuffer();if(!buf.byteLength)throw new Error('El G-code está vacío');
  return new Uint8Array(buf);
}
async function ensureMachine(job,id,ops,target=root){
  if(job?.machineId)return job;
  if(typeof ops.planOne!=='function')return job;
  const planned=ops.planOne(id,false);if(planned&&typeof planned.then==='function')await planned;
  return jobById(id,target);
}
async function enqueueMachineOps(id,original,ops,target=root){
  if(inflight.has(id))return inflight.get(id);
  const work=(async()=>{
    let job=jobById(id,target);if(!job)throw new Error('Trabajo MachineOps no encontrado');
    job=await ensureMachine(job,id,ops,target);if(!job?.machineId)throw new Error('Asigna una máquina antes de encolar');
    if(!job.gcodeFile)throw new Error('Configura el archivo G-code antes de encolar');
    await target.FarmQueue.sync(true);
    const old=getLink(id,target),existing=old&&target.FarmQueue.findById(old.farmJobId);
    if(existing&&['queued','retry','checking','uploading','uploaded','started'].includes(existing.state)){
      if(job.status!=='en_cola')original(id);return existing;
    }
    const gcode=await fetchGcode(job,target);
    const farmJob=await target.FarmQueue.enqueueGcode(job.machineId,gcode,job.gcodeFile,Number(job.minutesPerCycle||60)*60,Number(job.grams||0),{
      source:'machineops',machineOpsJobId:id,priority:priorityValue(job.priority),pedidoId:job.pedidoId||''
    });
    setLink(id,farmJob,target);
    original(id); // recién ahora MachineOps muestra `En cola`
    try{target.toast?.(`${job.name||'Trabajo'} vinculado a cola central ✓`,'success');}catch(_){}
    return farmJob;
  })().catch(e=>{lastError=e?.message||String(e);try{target.toast?.('No se encoló: '+lastError,'error');}catch(_){}throw e;}).finally(()=>inflight.delete(id));
  inflight.set(id,work);return work;
}
async function confirmCentralPreflight(originalConfirm,ops,target=root){
  const id=target.document?.getElementById('mopsPreflightJobId')?.value||'';
  const link=id?getLink(id,target):null;
  if(!link)return originalConfirm();
  const btn=target.document?.getElementById('mopsPreflightConfirm');if(btn?.disabled)return false;
  await target.FarmQueue.sync(true);const farmJob=target.FarmQueue.findById(link.farmJobId);
  if(!farmJob){lastError='farmJobId ya no existe en la cola central';try{target.toast?.(lastError,'error');}catch(_){}return false;}
  if(['checking','uploading','uploaded','started'].includes(farmJob.state)){ops.closePreflight?.();try{target.toast?.('El trabajo ya está siendo procesado por la cola central','info');}catch(_){}return true;}
  if(!['queued','retry'].includes(farmJob.state)){try{target.toast?.(`Cola central: ${farmJob.state}${farmJob.lastError?' · '+farmJob.lastError:''}`,'error');}catch(_){}return false;}
  ops.closePreflight?.();await target.FarmQueue.runJob(farmJob.id);return true;
}
function install(target=root){
  if(installed||!target?.MachineOps||!target?.FarmQueue)return false;
  const ops=target.MachineOps;
  if(typeof ops.enqueueJob!=='function'||typeof ops.confirmPreflight!=='function')return false;
  const originalEnqueue=ops.enqueueJob.bind(ops),originalConfirm=ops.confirmPreflight.bind(ops);
  ops.enqueueJob=function(id){return enqueueMachineOps(id,originalEnqueue,ops,target);};
  ops.confirmPreflight=function(){return confirmCentralPreflight(originalConfirm,ops,target);};
  target.addEventListener?.('farm-queue-updated',()=>updateLinksFromQueue(target));
  updateLinksFromQueue(target);installed=true;return true;
}
function installWhenReady(target=root){
  if(!target)return false;if(install(target))return true;if(timer)return false;let tries=0;
  timer=target.setInterval?.(()=>{tries++;if(install(target)||tries>240){target.clearInterval?.(timer);timer=null;}},50)||null;return false;
}
function status(target=root){return{installed,lastError,lastLinkedAt,links:links(target)};}
return{install,installWhenReady,status,_test:{priorityValue,encodeFilePath,parse}};
});
