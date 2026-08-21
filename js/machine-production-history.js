/* js/machine-production-history.js
 * Historial y odómetro centralizados en el registry del Farm Controller.
 * Conserva localStorage como fallback, pero cuando el controller está disponible
 * usa machine.production como fuente compartida por todos los navegadores.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)api.install(root);
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const VERSION=1;
const MAX_PER_MACHINE=250;
const MAX_GLOBAL=2500;
let installed=false,centralReady=false,writable=null,lastSync=0,lastWrite=0,lastError='';
let byMachine=Object.create(null);
let originalSave=null,originalGetHist=null,originalGetOdometer=null;
let syncPromise=null;

function num(v,d=0){return Number.isFinite(+v)?+v:d;}
function cleanText(v,max=200){return String(v??'').slice(0,max);}
function hashText(value){let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
function eventKey(row){
  const id=cleanText(row?.id||row?.machineId,80),start=num(row?.start),file=cleanText(row?.file,240);
  return hashText(id+'|'+start+'|'+file);
}
function normalizeHistoryRow(row,machineId=''){
  const id=cleanText(row?.id||row?.machineId||machineId,80);
  return{
    eventKey:cleanText(row?.eventKey||eventKey({...row,id}),32),id,
    nombre:cleanText(row?.nombre,120),numG:row?.numG??'',file:cleanText(row?.file,240),
    start:num(row?.start),end:num(row?.end),dur:Math.max(0,num(row?.dur)),
    result:cleanText(row?.result||'Desconocido',40),filamentMm:Math.max(0,num(row?.filamentMm)),
    ts:num(row?.ts,row?.end||Date.now()),
  };
}
function emptyOdo(){return{hours:0,filamentMm:0,prints:0,failures:0,attempts:0};}
function normalizeOdo(raw){const o={...emptyOdo(),...(raw||{})};for(const k of Object.keys(emptyOdo()))o[k]=Math.max(0,num(o[k]));return o;}
function normalizeProduction(raw,machineId=''){
  const p=raw&&typeof raw==='object'?raw:{};
  const seen=new Set(),history=[];
  for(const rawRow of Array.isArray(p.history)?p.history:[]){
    const row=normalizeHistoryRow(rawRow,machineId);if(!row.id||seen.has(row.eventKey))continue;seen.add(row.eventKey);history.push(row);
  }
  history.sort((a,b)=>num(b.ts,b.end)-num(a.ts,a.end));
  return{version:VERSION,seededAt:num(p.seededAt),updatedAt:num(p.updatedAt),history:history.slice(0,MAX_PER_MACHINE),odometer:normalizeOdo(p.odometer)};
}
function isCompleted(result){return /complet/i.test(String(result||''));}
function applyEvent(raw,event){
  const row=normalizeHistoryRow(event,event?.id||event?.machineId||'');
  const p=normalizeProduction(raw,row.id);
  if(!row.id)return{production:p,added:false};
  if(p.history.some(x=>x.eventKey===row.eventKey))return{production:p,added:false};
  p.history.unshift(row);p.history=p.history.slice(0,MAX_PER_MACHINE);
  const o=p.odometer;o.attempts+=1;o.filamentMm+=row.filamentMm;
  if(isCompleted(row.result)){o.hours+=row.dur/60;o.prints+=1;}else{o.failures+=1;}
  p.updatedAt=Date.now();if(!p.seededAt)p.seededAt=p.updatedAt;
  return{production:p,added:true};
}
function seedProduction(machineId,history,legacyOdo){
  const rows=(Array.isArray(history)?history:[]).filter(x=>(x?.id||x?.machineId)===machineId).map(x=>normalizeHistoryRow(x,machineId));
  const seen=new Set(),unique=[];for(const row of rows.sort((a,b)=>b.ts-a.ts)){if(seen.has(row.eventKey))continue;seen.add(row.eventKey);unique.push(row);}
  const derived=emptyOdo();for(const row of unique){derived.attempts++;derived.filamentMm+=row.filamentMm;if(isCompleted(row.result)){derived.hours+=row.dur/60;derived.prints++;}else derived.failures++;}
  const legacy=normalizeOdo(legacyOdo);
  const odometer={};for(const k of Object.keys(derived))odometer[k]=Math.max(derived[k],legacy[k]||0);
  const now=Date.now();return{version:VERSION,seededAt:now,updatedAt:now,history:unique.slice(0,MAX_PER_MACHINE),odometer};
}
function mergeProduction(a,b,machineId=''){
  const pa=normalizeProduction(a,machineId),pb=normalizeProduction(b,machineId),seen=new Set(),history=[];
  for(const row of [...pa.history,...pb.history].sort((x,y)=>y.ts-x.ts)){if(seen.has(row.eventKey))continue;seen.add(row.eventKey);history.push(row);}
  const odometer={};for(const k of Object.keys(emptyOdo()))odometer[k]=Math.max(pa.odometer[k]||0,pb.odometer[k]||0);
  return{version:VERSION,seededAt:Math.min(pa.seededAt||Infinity,pb.seededAt||Infinity)===Infinity?0:Math.min(pa.seededAt||Infinity,pb.seededAt||Infinity),updatedAt:Math.max(pa.updatedAt,pb.updatedAt),history:history.slice(0,MAX_PER_MACHINE),odometer};
}
function centralHistory(){
  return Object.values(byMachine).flatMap(p=>p.history||[]).sort((a,b)=>num(b.ts,b.end)-num(a.ts,a.end)).slice(0,MAX_GLOBAL);
}
function centralOdometer(){const out={};for(const [id,p] of Object.entries(byMachine))out[id]={...normalizeOdo(p.odometer)};return out;}
function machineList(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}
function tunnel(){try{return typeof getPrinterTunnel==='function'?getPrinterTunnel().replace(/\/$/,''):'';}catch(_){return'';}}
function token(){try{return typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';}catch(_){return'';}}
function url(path){const t=token();return tunnel()+path+(t?(path.includes('?')?'&':'?')+'bt='+encodeURIComponent(t):'');}
async function patchMachine(machine,production){
  const r=await fetch(url('/farm/registry'),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:machine.id,production}),signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error('registry HTTP '+r.status);
  writable=true;lastWrite=Date.now();byMachine[machine.id]=normalizeProduction(production,machine.id);return byMachine[machine.id];
}
function registryMachines(){try{return window.FarmRegistry?.status?.().machines||[];}catch(_){return[];}}
function localHist(){try{return originalGetHist?originalGetHist():[];}catch(_){return[];}}
function localOdo(){try{return originalGetOdometer?originalGetOdometer():{};}catch(_){return{};}}
async function ensureSeed(machine){
  const remote=registryMachines().find(x=>x.id===machine.id)?.production;
  const localSeed=seedProduction(machine.id,localHist(),localOdo()[machine.id]);
  if(remote){
    const merged=mergeProduction(remote,localSeed,machine.id);byMachine[machine.id]=merged;
    const r=normalizeProduction(remote,machine.id),needsRepair=JSON.stringify(merged.odometer)!==JSON.stringify(r.odometer)||merged.history.length>r.history.length;
    if(needsRepair)try{await patchMachine(machine,merged);}catch(e){writable=false;lastError=e.message;}
    return;
  }
  if(!localSeed.history.length&&!Object.values(localSeed.odometer).some(Boolean)){byMachine[machine.id]=localSeed;return;}
  try{await patchMachine(machine,localSeed);}catch(e){writable=false;lastError=e.message;}
}
async function sync(force=false){
  if(syncPromise)return syncPromise;
  if(!force&&Date.now()-lastSync<15000)return centralHistory();
  syncPromise=(async()=>{
    try{
      if(!window.FarmRegistry?.sync)throw new Error('FarmRegistry no disponible');
      await window.FarmRegistry.sync(true);
      const regs=registryMachines();
      for(const m of machineList()){
        const remote=regs.find(x=>x.id===m.id)?.production;
        if(remote)byMachine[m.id]=normalizeProduction(remote,m.id);
      }
      for(const m of machineList())if(!regs.find(x=>x.id===m.id)?.production)await ensureSeed(m);
      centralReady=Object.keys(byMachine).length>0;lastSync=Date.now();lastError='';
      if(centralReady)try{localStorage.setItem('printer_odometer_seeded','1');}catch(_){}
    }catch(e){lastError=e.message;centralReady=false;}
    finally{syncPromise=null;}
    return centralHistory();
  })();
  return syncPromise;
}
async function recordEvent(event){
  const machine=machineList().find(m=>m.id===(event?.id||event?.machineId));if(!machine)return;
  try{
    await window.FarmRegistry?.sync?.(true);
    const remote=registryMachines().find(x=>x.id===machine.id)?.production||byMachine[machine.id]||seedProduction(machine.id,localHist(),localOdo()[machine.id]);
    const result=applyEvent(remote,event);byMachine[machine.id]=result.production;centralReady=true;
    if(result.added)await patchMachine(machine,result.production);
  }catch(e){writable=false;lastError=e.message;}
}
function install(target){
  if(installed||!target)return false;
  if(typeof target.saveHistoryEntry!=='function'||typeof target.getHist!=='function'||typeof target.getOdometer!=='function')return false;
  installed=true;originalSave=target.saveHistoryEntry;originalGetHist=target.getHist;originalGetOdometer=target.getOdometer;
  target.getHist=function(){return centralReady?centralHistory():originalGetHist.apply(this,arguments);};
  target.getOdometer=function(){return centralReady?centralOdometer():originalGetOdometer.apply(this,arguments);};
  target.saveHistoryEntry=function(m,file,start,end,dur,result,filamentMm=0){
    const out=originalSave.apply(this,arguments);
    const row={id:m?.id,nombre:m?.nombre,numG:m?.numG,file,start,end,dur,result,filamentMm,ts:Date.now()};
    recordEvent(row);return out;
  };
  setTimeout(()=>sync(true),2200);
  setInterval(()=>{if(!document.hidden)sync(false);},30000);
  window.addEventListener('focus',()=>sync(true));
  target.FarmProduction={sync,status:()=>({installed,centralReady,writable,lastSync,lastWrite,lastError,machines:Object.keys(byMachine).length,history:centralHistory().length,odometer:centralOdometer()})};
  return true;
}

return{install,_test:{eventKey,normalizeHistoryRow,normalizeOdo,normalizeProduction,applyEvent,seedProduction,mergeProduction,isCompleted,MAX_PER_MACHINE}};
});
