/* js/machineops-unattended-safety.js
 * Política fail-closed para trabajos largos/nocturnos.
 *
 * Se comparte entre navegador y Farm Controller: el navegador mejora el
 * preflight y sincroniza el último estado de seguridad; el controller vuelve a
 * evaluar justo antes de arrancar una cola durable.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.MachineOpsUnattendedSafety=api;api.installWhenReady(root);}
})(typeof window!=='undefined'?window:null,function(root){
'use strict';

const STORAGE_KEY='thelab_machine_ops_v2';
const DEFAULT_CONFIG={
  strict:true,unattendedMinutes:240,nightStart:19,nightEnd:9,timezone:'America/Santiago',
  cameraRequired:true,ventilationRequired:true,smokeRequired:true,
  maxTemperature:38,maxHumidity:75,maxVoc:600,staleMinutes:10,
};
let installed=false,installTimer=null,lastSyncAt=0,lastSyncOk=false,lastSyncError='',lastDecision=null;

const num=(v,d=0)=>Number.isFinite(+v)?+v:d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function normalizeConfig(raw){
  const c={...DEFAULT_CONFIG,...(raw&&typeof raw==='object'?raw:{})};
  c.strict=c.strict!==false;
  c.unattendedMinutes=clamp(num(c.unattendedMinutes,240),30,24*60);
  c.nightStart=clamp(Math.floor(num(c.nightStart,19)),0,23);
  c.nightEnd=clamp(Math.floor(num(c.nightEnd,9)),0,23);
  c.staleMinutes=clamp(num(c.staleMinutes,10),1,120);
  c.maxTemperature=clamp(num(c.maxTemperature,38),20,80);
  c.maxHumidity=clamp(num(c.maxHumidity,75),20,100);
  c.maxVoc=clamp(num(c.maxVoc,600),50,10000);
  c.timezone=String(c.timezone||'America/Santiago');
  return c;
}
function hourAt(nowMs,timeZone){
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:timeZone||'America/Santiago',hour:'2-digit',hour12:false}).formatToParts(new Date(nowMs));
    const hour=Number(parts.find(p=>p.type==='hour')?.value);
    if(Number.isFinite(hour))return hour===24?0:hour;
  }catch(_){ }
  return new Date(nowMs).getHours();
}
function isNightHour(hour,start=19,end=9){
  hour=Math.floor(num(hour));start=Math.floor(num(start,19));end=Math.floor(num(end,9));
  return start===end?true:(start<end?hour>=start&&hour<end:hour>=start||hour<end);
}
function jobMinutes(job){return Math.max(1,num(job?.cycles,1))*Math.max(1,num(job?.minutesPerCycle,num(job?.secs,3600)/60||60));}
function jobIsUnattended(job,nowMs=Date.now(),config={},hourOverride){
  const cfg=normalizeConfig(config),hour=hourOverride===undefined?hourAt(nowMs,cfg.timezone):num(hourOverride);
  return jobMinutes(job)>=cfg.unattendedMinutes||isNightHour(hour,cfg.nightStart,cfg.nightEnd);
}
function normalizeSnapshot(raw){
  const s=raw&&typeof raw==='object'?raw:{};
  return{
    version:1,updatedAt:num(s.updatedAt),
    config:normalizeConfig(s.config),
    reading:s.reading&&typeof s.reading==='object'?{...s.reading}:null,
    cameras:s.cameras&&typeof s.cameras==='object'&&!Array.isArray(s.cameras)?{...s.cameras}:{},
  };
}
function evaluateSnapshot(raw,job,nowMs=Date.now(),hourOverride){
  const snapshot=normalizeSnapshot(raw),cfg=snapshot.config;
  const unattended=jobIsUnattended(job,nowMs,cfg,hourOverride),blockers=[],warnings=[];
  if(!cfg.strict||!unattended)return{ok:true,unattended,strict:cfg.strict,blockers,warnings,fresh:true,snapshot};
  const reading=snapshot.reading,readingAt=Date.parse(reading?.at||0);
  const fresh=!!reading&&reading.online!==false&&Number.isFinite(readingAt)&&nowMs-readingAt<=cfg.staleMinutes*60000&&nowMs>=readingAt-60_000;
  const machineId=String(job?.machineId||'');
  if(cfg.cameraRequired&&snapshot.cameras[machineId]!==true)blockers.push('Trabajo desatendido sin cámara configurada.');
  if((cfg.ventilationRequired||cfg.smokeRequired)&&!fresh)blockers.push('Lectura ambiental ausente, vencida o sin conexión.');
  if(fresh){
    if(cfg.ventilationRequired&&reading.ventilation!==true)blockers.push('Ventilación no confirmada.');
    if(cfg.smokeRequired&&reading.smoke===true)blockers.push('El sensor detecta humo.');
    else if(cfg.smokeRequired&&typeof reading.smoke!=='boolean')blockers.push('Sensor de humo no confirmado.');
    if(num(reading.temperature)>cfg.maxTemperature)blockers.push(`Temperatura ambiental ${num(reading.temperature).toFixed(1)}°C sobre el máximo.`);
    if(num(reading.voc)>cfg.maxVoc)blockers.push(`VOC ${Math.round(num(reading.voc))} sobre el máximo configurado.`);
    if(num(reading.humidity)>cfg.maxHumidity)warnings.push(`Humedad ${num(reading.humidity).toFixed(0)}% sobre el máximo configurado.`);
  }
  return{ok:blockers.length===0,unattended,strict:cfg.strict,blockers,warnings,fresh,snapshot};
}

function readOpsData(target=root){
  try{return JSON.parse(target?.localStorage?.getItem(STORAGE_KEY)||'{}')||{};}catch(_){return{};}
}
function machines(){try{return typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}}
function cameraConfigured(m,target=root){
  if(!m?.id)return false;
  try{if(target?.localStorage?.getItem('printer_cam_'+m.id)||m.cam)return true;}catch(_){ }
  try{return typeof printerCamUrl==='function'&&!!printerCamUrl(m.id);}catch(_){return false;}
}
function buildSnapshot(target=root){
  const d=readOpsData(target),cfg=normalizeConfig({...d.safetyConfig,strict:d.safetyConfig?.unattendedStrict!==false,
    unattendedMinutes:d.safetyConfig?.unattendedMinutes||240,nightStart:d.safetyConfig?.nightStart??19,nightEnd:d.safetyConfig?.nightEnd??9,timezone:d.safetyConfig?.timezone||'America/Santiago'});
  const readings=Array.isArray(d.safetyReadings)?d.safetyReadings:[];
  const reading=readings.slice().sort((a,b)=>Date.parse(b?.at||0)-Date.parse(a?.at||0))[0]||null;
  const cameras={};for(const m of machines())if(m?.id)cameras[m.id]=cameraConfigured(m,target);
  return normalizeSnapshot({updatedAt:Date.now(),config:cfg,reading,cameras});
}
function jobById(id,target=root){return (readOpsData(target).jobs||[]).find(j=>j?.id===id)||null;}
function machineById(id){return machines().find(m=>m?.id===id)||null;}
function decisionForJob(id,target=root,nowMs=Date.now()){
  const job=jobById(id,target);if(!job)return{ok:true,unattended:false,blockers:[],warnings:[],missingJob:true};
  const snapshot=buildSnapshot(target);lastDecision=evaluateSnapshot(snapshot,job,nowMs);return lastDecision;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function augmentPreflight(id,target=root){
  const d=decisionForJob(id,target);if(!d.unattended||d.ok)return d;
  const body=target?.document?.getElementById('mopsPreflightBody'),btn=target?.document?.getElementById('mopsPreflightConfirm');
  if(body&&!body.querySelector('[data-unattended-strict]')){
    const box=target.document.createElement('div');box.setAttribute('data-unattended-strict','1');box.className='mops-preflight-list';
    box.innerHTML=d.blockers.map(x=>`<div class="mops-preflight-row block"><span>×</span><div><b>Seguridad desatendida</b><small>${esc(x)}</small></div></div>`).join('');
    body.prepend(box);
  }
  if(btn){btn.disabled=true;btn.textContent='Corrige seguridad desatendida';}
  return d;
}
function bridgeBase(){try{return typeof getPrinterTunnel==='function'?String(getPrinterTunnel()).replace(/\/$/,''):'';}catch(_){return'';}}
function bridgeToken(){try{return typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';}catch(_){return'';}}
function isShortSession(value){return /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value||''));}
async function syncToController(target=root){
  if(!target||target._DEMO_MODE)return false;
  try{
    const snapshot=buildSnapshot(target),options={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(7000)};
    let r;
    if(target.FarmHttpAuth?.fetch)r=await target.FarmHttpAuth.fetch('/farm/safety',options);
    else{
      const base=bridgeBase(),token=bridgeToken();if(!base||!token)return false;
      const headers=new Headers(options.headers);let url=base+'/farm/safety';
      if(isShortSession(token))headers.set('Authorization','Bearer '+token);else url+='?bt='+encodeURIComponent(token);
      r=await target.fetch(url,{...options,headers});
    }
    if(!r.ok)throw new Error('HTTP '+r.status);
    lastSyncAt=Date.now();lastSyncOk=true;lastSyncError='';return true;
  }catch(e){lastSyncAt=Date.now();lastSyncOk=false;lastSyncError=e?.message||String(e);return false;}
}
function blockStart(id,target=root){
  const d=decisionForJob(id,target);
  if(d.ok||!d.unattended)return false;
  augmentPreflight(id,target);syncToController(target).catch(()=>{});
  try{if(typeof toast==='function')toast('Inicio bloqueado: seguridad desatendida incompleta','error');}catch(_){ }
  return true;
}
function install(target=root){
  if(installed||!target?.MachineOps)return false;
  const ops=target.MachineOps;
  const original={openPreflight:ops.openPreflight?.bind(ops),confirmPreflight:ops.confirmPreflight?.bind(ops),startJob:ops.startJob?.bind(ops)};
  if(!original.openPreflight||!original.confirmPreflight||!original.startJob)return false;
  ops.openPreflight=function(id){const out=original.openPreflight(id);augmentPreflight(id,target);syncToController(target).catch(()=>{});return out;};
  ops.confirmPreflight=function(){const id=target.document?.getElementById('mopsPreflightJobId')?.value||'';if(id&&blockStart(id,target))return false;return original.confirmPreflight();};
  ops.startJob=function(id,options={}){if(!options?.preflightConfirmed)return ops.openPreflight(id);if(blockStart(id,target))return Promise.resolve(false);return original.startJob(id,options);};
  installed=true;
  syncToController(target).catch(()=>{});
  setInterval(()=>{if(!target.document?.hidden)syncToController(target).catch(()=>{});},60_000);
  target.addEventListener?.('focus',()=>syncToController(target).catch(()=>{}));
  target.addEventListener?.('farm-controller-health',()=>syncToController(target).catch(()=>{}));
  return true;
}
function installWhenReady(target=root){
  if(!target)return false;if(install(target))return true;
  if(installTimer)return false;let attempts=0;
  installTimer=setInterval(()=>{attempts++;if(install(target)||attempts>=200){clearInterval(installTimer);installTimer=null;}},50);
  return false;
}
function status(){return{installed,lastSyncAt,lastSyncOk,lastSyncError,lastDecision};}

return{DEFAULT_CONFIG,normalizeConfig,isNightHour,hourAt,jobMinutes,jobIsUnattended,normalizeSnapshot,evaluateSnapshot,buildSnapshot,decisionForJob,syncToController,install,installWhenReady,status,_test:{isShortSession}};
});
