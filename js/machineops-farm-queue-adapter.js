/* js/machineops-farm-queue-adapter.js
 * Une MachineOps con la cola durable del Farm Controller.
 * El farmJobId es determinista a partir del ID MachineOps, por lo que puede
 * reconstruirse en otro navegador sin depender de localStorage.
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
function farmJobIdForMachineOps(id){const clean=String(id||'').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(0,120);return clean?'mops-'+clean:'';}
function getLink(id,target=root){const saved=links(target)[id];return saved||{farmJobId:farmJobIdForMachineOps(id),derived:true,state:''};}
function setLink(id,farmJob,target=root){const all=links(target);all[id]={farmJobId:farmJob.id,machineId:farmJob.machineId||'',filename:farmJob.filename||'',state:farmJob.state||'queued',linkedAt:all[id]?.linkedAt||Date.now(),updatedAt:Date.now()};saveLinks(all,target);lastLinkedAt=Date.now();return all[id];}
function priorityValue(p){return({urgente:90,alta:75,normal:50,baja:30})[String(p||'').toLowerCase()]||50;}
function reconcileAction(job,farm){
  const js=String(job?.status||''),fs=String(farm?.state||'');
  if(fs==='started'&&['pendiente','planificado','en_cola'].includes(js))return'printing';
  if(fs==='completed'&&['en_cola','imprimiendo'].includes(js))return'complete';
  if(fs==='cancelled'&&farm?.startedAt&&['en_cola','imprimiendo'].includes(js))return'cancelled';
  if(fs==='failed'&&farm?.startedAt&&['en_cola','imprimiendo'].includes(js))return'failed-review';
  if(fs==='failed'&&!farm?.startedAt&&['en_cola','planificado'].includes(js))return'queue-failed';
  return'';
}
function machineFor(id,target=root){try{return(Array.isArray(target?.MAQUINAS)?target.MAQUINAS:[]).find(m=>m.id===id)||null;}catch(_){return null;}}
function syntheticLive(farm,state){return{state,filename:farm?.filename||'',elapsed:farm?.startedAt?Math.max(0,(Date.now()-Date.parse(farm.startedAt))/1000):0,progress:state==='complete'?100:0,klMsg:farm?.lastError||''};}
function ensurePrinting(id,job,farm,ops,target=root){
  if(job?.status==='imprimiendo')return true;
  const machine=machineFor(farm?.machineId||job?.machineId,target);if(!machine||typeof ops?.handlePrinterTransition!=='function')return false;
  ops.handlePrinterTransition(machine,syntheticLive(farm,'printing'),'standby');
  return jobById(id,target)?.status==='imprimiendo';
}
function reconcileFarmState(id,farm,ops,target=root){
  const job=jobById(id,target);if(!job||!farm)return false;const action=reconcileAction(job,farm);if(!action)return false;
  if(action==='queue-failed'){
    lastError=`${job.name||'Trabajo'}: FarmQueue falló antes de iniciar${farm.lastError?' · '+farm.lastError:''}`;
    try{target.toast?.(lastError,'error');}catch(_){}
    return false;
  }
  const machine=machineFor(farm.machineId||job.machineId,target);if(!machine||typeof ops?.handlePrinterTransition!=='function')return false;
  if(action==='printing'){
    ops.handlePrinterTransition(machine,syntheticLive(farm,'printing'),'standby');
    return jobById(id,target)?.status==='imprimiendo';
  }
  if(!ensurePrinting(id,job,farm,ops,target)){
    lastError=`${job.name||'Trabajo'}: no se pudo reconciliar con FarmQueue; revisa que el auto-vínculo MachineOps esté habilitado`;
    return false;
  }
  if(action==='complete')ops.handlePrinterTransition(machine,syntheticLive(farm,'complete'),'printing');
  else if(action==='cancelled')ops.handlePrinterTransition(machine,syntheticLive(farm,'cancelled'),'printing');
  else if(action==='failed-review'){
    ops.handlePrinterTransition(machine,syntheticLive(farm,'error'),'printing');
    ops.handlePrinterTransition(machine,syntheticLive(farm,'complete'),'printing');
    try{target.toast?.(`${job.name||'Trabajo'} terminó con falla técnica · revisar en QA`,'error');}catch(_){}
  }
  return true;
}
function updateLinksFromQueue(target=root,ops=target?.MachineOps){
  const fq=target?.FarmQueue?.status?.();if(!fq?.jobs)return;
  const all=links(target),by=new Map(fq.jobs.map(j=>[j.id,j]));let changed=false;
  const ids=new Set([...Object.keys(all),...(Array.isArray(opsData(target).jobs)?opsData(target).jobs:[]).map(j=>j.id)]);
  for(const id of ids){
    const farmId=all[id]?.farmJobId||farmJobIdForMachineOps(id),row=by.get(farmId);if(!row)continue;
    const link=all[id]||(all[id]={farmJobId:farmId,linkedAt:Date.now()}),previous=String(link.state||'');
    if(previous!==String(row.state||''))reconcileFarmState(id,row,ops,target);
    const state=String(row.state||'');if(state!==link.state||link.filename!==row.filename){link.state=state;link.filename=row.filename||link.filename||'';link.machineId=row.machineId||link.machineId||'';link.updatedAt=Date.now();changed=true;}
  }
  if(changed)saveLinks(all,target);
}
async function ensureMachine(job,id,ops,target=root){if(job?.machineId)return job;if(typeof ops.planOne!=='function')return job;const planned=ops.planOne(id,false);if(planned&&typeof planned.then==='function')await planned;return jobById(id,target);}

async function enqueueMachineOps(id,original,ops,target=root){
  if(inflight.has(id))return inflight.get(id);
  const work=(async()=>{
    let job=jobById(id,target);if(!job)throw new Error('Trabajo MachineOps no encontrado');
    job=await ensureMachine(job,id,ops,target);if(!job?.machineId)throw new Error('Asigna una máquina antes de encolar');
    if(!job.gcodeFile)throw new Error('Configura el archivo G-code antes de encolar');
    await target.FarmQueue.sync(true);
    const farmId=farmJobIdForMachineOps(id),existing=target.FarmQueue.findById(farmId);
    if(existing&&['queued','retry','checking','uploading','uploaded','started','completed','cancelled','failed'].includes(existing.state)){
      setLink(id,existing,target);if(job.status!=='en_cola'&&!['completed','cancelled','failed'].includes(existing.state))original(id);reconcileFarmState(id,existing,ops,target);return existing;
    }
    const farmJob=await target.FarmQueue.importGcode(job.machineId,job.gcodeFile,Number(job.minutesPerCycle||60)*60,Number(job.grams||0),{
      id:farmId,source:'machineops',priority:priorityValue(job.priority)
    });
    setLink(id,farmJob,target);
    original(id);
    try{target.toast?.(`${job.name||'Trabajo'} vinculado a cola central ✓`,'success');}catch(_){}
    return farmJob;
  })().catch(e=>{lastError=e?.message||String(e);try{target.toast?.('No se encoló: '+lastError,'error');}catch(_){}throw e;}).finally(()=>inflight.delete(id));
  inflight.set(id,work);return work;
}
async function confirmCentralPreflight(originalConfirm,ops,target=root){
  const id=target.document?.getElementById('mopsPreflightJobId')?.value||'';if(!id)return originalConfirm();
  const job=jobById(id,target),link=getLink(id,target);
  await target.FarmQueue.sync(true);const farmJob=link?.farmJobId?target.FarmQueue.findById(link.farmJobId):null;
  if(!farmJob){
    if(job?.status==='en_cola'){lastError='El trabajo figura en cola pero no existe su farmJobId central. Reencólalo antes de iniciar.';try{target.toast?.(lastError,'error');}catch(_){}return false;}
    return originalConfirm();
  }
  setLink(id,farmJob,target);reconcileFarmState(id,farmJob,ops,target);
  const btn=target.document?.getElementById('mopsPreflightConfirm');if(btn?.disabled)return false;
  if(['checking','uploading','uploaded','started'].includes(farmJob.state)){ops.closePreflight?.();try{target.toast?.('El trabajo ya está siendo procesado por la cola central','info');}catch(_){}return true;}
  if(!['queued','retry'].includes(farmJob.state)){try{target.toast?.(`Cola central: ${farmJob.state}${farmJob.lastError?' · '+farmJob.lastError:''}`,'error');}catch(_){}return false;}
  ops.closePreflight?.();await target.FarmQueue.runJob(farmJob.id);return true;
}
function install(target=root){
  if(installed||!target?.MachineOps||!target?.FarmQueue)return false;
  const ops=target.MachineOps;if(typeof ops.enqueueJob!=='function'||typeof ops.confirmPreflight!=='function'||typeof target.FarmQueue.importGcode!=='function')return false;
  const originalEnqueue=ops.enqueueJob.bind(ops),originalConfirm=ops.confirmPreflight.bind(ops);
  ops.enqueueJob=function(id){return enqueueMachineOps(id,originalEnqueue,ops,target);};
  ops.confirmPreflight=function(){return confirmCentralPreflight(originalConfirm,ops,target);};
  target.addEventListener?.('farm-queue-updated',()=>updateLinksFromQueue(target,ops));
  updateLinksFromQueue(target,ops);installed=true;return true;
}
function installWhenReady(target=root){if(!target)return false;if(install(target))return true;if(timer)return false;let tries=0;timer=target.setInterval?.(()=>{tries++;if(install(target)||tries>240){target.clearInterval?.(timer);timer=null;}},50)||null;return false;}
function status(target=root){return{installed,lastError,lastLinkedAt,links:links(target)};}
return{install,installWhenReady,status,_test:{priorityValue,parse,farmJobIdForMachineOps,reconcileAction}};
});
