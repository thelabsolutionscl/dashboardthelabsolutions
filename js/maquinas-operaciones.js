/* js/maquinas-operaciones.js
 * Centro de producción 3D: trabajos, planificación, rollos, QA, analítica,
 * persistencia compartida y auditoría de acciones sobre impresoras.
 */
(function(){
'use strict';

const STORAGE_KEY='thelab_machine_ops_v2';
const REMOTE_NAME='MACHINE_OPS_V2';
const DB_NAME='thelab-machine-ops';
const DB_STORE='queues';
const MODELS=['K1','K2','K2 Plus','Ender-5 Max','Giga'];
const ACTIVE_JOB_STATES=['pendiente','planificado','en_cola','imprimiendo','qa'];
const JOB_META={
  pendiente:{label:'Pendiente',color:'#94a3b8'},
  planificado:{label:'Planificado',color:'#a78bfa'},
  en_cola:{label:'Lista para iniciar',color:'#ffaa00'},
  imprimiendo:{label:'Imprimiendo',color:'#00d4aa'},
  qa:{label:'Esperando QA',color:'#38bdf8'},
  terminado:{label:'Terminado',color:'#22c55e'},
  fallido:{label:'Fallido',color:'#ff4444'},
  archivado:{label:'Archivado',color:'#64748b'},
};
const MODEL_CAPS={
  'K1':{bed:[220,220,250],materials:['PLA','PLA+','PETG','TPU']},
  'K2':{bed:[350,350,350],materials:['PLA','PLA+','PETG','ABS','ASA','TPU','PA','PA-CF','PETG-CF']},
  'K2 Plus':{bed:[500,500,500],materials:['PLA','PLA+','PETG','ABS','ASA','TPU','PA','PA-CF','PETG-CF']},
  'Ender-5 Max':{bed:[400,400,600],materials:['PLA','PLA+','PETG','TPU']},
  'Giga':{bed:[800,800,800],materials:['PLA','PLA+','PETG','TPU']},
};
const DEFAULT_MAINT={
  'K1':{'nozzle':180,'lubrication':90,'belt':450,'extruder':250,'bed':220,'sensors':500,'general':50},
  'K2':{'nozzle':220,'lubrication':110,'belt':550,'extruder':320,'bed':280,'sensors':650,'general':60},
  'K2 Plus':{'nozzle':220,'lubrication':100,'belt':500,'extruder':300,'bed':250,'sensors':600,'general':55},
  'Ender-5 Max':{'nozzle':200,'lubrication':80,'belt':400,'extruder':260,'bed':220,'sensors':500,'general':45},
  'Giga':{'nozzle':180,'lubrication':70,'belt':350,'extruder':240,'bed':180,'sensors':450,'general':40},
};
const MAINT_KEYS=['nozzle','lubrication','belt','extruder','bed','sensors','general'];
const POST_STAGES=[
  {key:'lijado',label:'Lijado',icon:'🪵'},
  {key:'pintura',label:'Pintura',icon:'🎨'},
  {key:'dtf',label:'DTF / gráfica',icon:'🖼'},
  {key:'acrilico',label:'Acrílico / corte',icon:'✂️'},
  {key:'armado',label:'Armado',icon:'🧩'},
  {key:'empaque',label:'Empaque',icon:'📦'},
];
const DEFAULT_SAFETY={
  enforce:false,cameraRequired:true,ventilationRequired:true,smokeRequired:true,
  maxTemperature:38,maxHumidity:75,maxVoc:600,staleMinutes:10,
  sensorUrl:'',updatedAt:0,
};
const DEFAULT_AUTOMATION={
  enabled:true,stallMinutes:12,tempTolerance:18,offlineMinutes:2,
  autoLink:true,autoIncident:true,bridgeIntervalSeconds:60,
};
const DEFAULT_COST={
  electricityClpKwh:220,machineKw:0.35,laborClpHour:4500,
  operatorMinutes:12,wearClpHour:350,failureOverheadPct:8,
};
const INCIDENT_TYPES={
  adhesion:'Pieza despegada / adhesión',clog:'Atasco o boquilla',filament:'Filamento / CFS',
  bed:'Cama o nivelación',temperature:'Temperatura',cancelled:'Impresión cancelada',
  electrical:'Eléctrico / conexión',quality:'Calidad dimensional',other:'Otro',
};

let _data=null,_remoteTimer=null,_initialized=false,_initPromise=null,_activeView='operacion',_activeWorkshopView='taller',_ganttFilter='carga',_ganttFamily='todas';
const _techRefreshPending={};
let _techStatusListenerBound=false;
const _telemetryWatch={};
let _bridgeHealth={state:'checking',checkedAt:0,latencyMs:null,error:''},_bridgeTimer=null,_incidentPhotoData='';
const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>(p||'mops')+'-'+Date.now().toString(36)+'-'+(crypto.randomUUID?crypto.randomUUID().slice(0,8):Math.random().toString(36).slice(2,10));
const nowIso=()=>new Date().toISOString();
const num=(v,d=0)=>Number.isFinite(+v)?+v:d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cssColor=v=>/^(#[0-9a-f]{3,8}|[a-z]{1,20})$/i.test(String(v||'').trim())?String(v).trim():'#888';
const fmtMin=m=>{m=Math.max(0,Math.round(num(m)));const h=Math.floor(m/60),mm=m%60;return h?`${h}h ${mm}m`:`${mm}m`;};
const fmtMoney=v=>typeof formatCLP==='function'?formatCLP(Math.round(num(v))):'$'+Math.round(num(v)).toLocaleString('es-CL');
const fmtStamp=v=>v?new Date(v).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}):'';
const dateValue=v=>v?new Date(v+'T12:00:00').getTime():Infinity;
const actor=()=>{try{const u=AUTH.getUser();return u?.name||u?.username||'Sistema';}catch(_){return'Sistema';}};
const hashText=value=>{let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const postStageMeta=key=>POST_STAGES.find(s=>s.key===key)||{key,label:key,icon:'•'};

function defaultData(){
  return{version:5,updatedAt:0,jobs:[],spools:[],qa:[],workflows:[],profiles:[],safetyReadings:[],incidents:[],audit:[],alertAcks:{},bedClearAcks:{},
    automation:{...DEFAULT_AUTOMATION},costConfig:{...DEFAULT_COST},
    safetyConfig:{...DEFAULT_SAFETY},maintenanceProfiles:JSON.parse(JSON.stringify(DEFAULT_MAINT))};
}
function normalizeData(raw){
  const d={...defaultData(),...(raw&&typeof raw==='object'?raw:{})};
  d.jobs=Array.isArray(d.jobs)?d.jobs:[];
  d.spools=Array.isArray(d.spools)?d.spools:[];
  d.qa=Array.isArray(d.qa)?d.qa:[];
  d.workflows=Array.isArray(d.workflows)?d.workflows:[];
  d.profiles=Array.isArray(d.profiles)?d.profiles:[];
  d.safetyReadings=Array.isArray(d.safetyReadings)?d.safetyReadings.slice(0,200):[];
  d.incidents=Array.isArray(d.incidents)?d.incidents:[];
  d.audit=Array.isArray(d.audit)?d.audit:[];
  d.alertAcks=d.alertAcks&&typeof d.alertAcks==='object'&&!Array.isArray(d.alertAcks)?d.alertAcks:{};
  d.bedClearAcks=d.bedClearAcks&&typeof d.bedClearAcks==='object'&&!Array.isArray(d.bedClearAcks)?d.bedClearAcks:{};
  d.automation={...DEFAULT_AUTOMATION,...(d.automation||{})};
  d.costConfig={...DEFAULT_COST,...(d.costConfig||{})};
  d.safetyConfig={...DEFAULT_SAFETY,...(d.safetyConfig||{})};
  const saved=d.maintenanceProfiles||{};
  d.maintenanceProfiles={};
  MODELS.forEach(model=>{d.maintenanceProfiles[model]={...DEFAULT_MAINT[model],...(saved[model]||{})};});
  return d;
}
function data(){
  if(_data)return _data;
  try{_data=normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch(_){_data=defaultData();}
  return _data;
}
function mergeRows(a,b){
  const map=new Map();
  [...(a||[]),...(b||[])].forEach(row=>{
    if(!row||!row.id)return;
    const prev=map.get(row.id);
    const rv=Date.parse(row.updatedAt||row.createdAt||0)||num(row.updatedAt||row.createdAt);
    const pv=prev?(Date.parse(prev.updatedAt||prev.createdAt||0)||num(prev.updatedAt||prev.createdAt)):0;
    if(!prev||rv>=pv)map.set(row.id,row);
  });
  return [...map.values()];
}
function mergeData(local,remote){
  const l=normalizeData(local),r=normalizeData(remote);
  const remoteIsNewer=num(r.updatedAt)>num(l.updatedAt);
  return normalizeData({
    ...l,...(remoteIsNewer?r:l),
    jobs:mergeRows(l.jobs,r.jobs),
    spools:mergeRows(l.spools,r.spools),
    qa:mergeRows(l.qa,r.qa),
    workflows:mergeRows(l.workflows,r.workflows),
    profiles:mergeRows(l.profiles,r.profiles),
    safetyReadings:mergeRows(l.safetyReadings,r.safetyReadings).sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,200),
    incidents:mergeRows(l.incidents,r.incidents).sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,300),
    audit:mergeRows(l.audit,r.audit).sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,500),
    alertAcks:remoteIsNewer?r.alertAcks:l.alertAcks,
    bedClearAcks:remoteIsNewer?r.bedClearAcks:l.bedClearAcks,
    automation:remoteIsNewer?r.automation:l.automation,
    costConfig:remoteIsNewer?r.costConfig:l.costConfig,
    safetyConfig:remoteIsNewer?r.safetyConfig:l.safetyConfig,
    maintenanceProfiles:remoteIsNewer?r.maintenanceProfiles:l.maintenanceProfiles,
    updatedAt:Math.max(num(l.updatedAt),num(r.updatedAt)),
  });
}
function writeLocal(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data()));}catch(e){console.warn('[MachineOps] localStorage',e);}
}
function persist(reason,{remote=true,render=true}={}){
  data().updatedAt=Date.now();writeLocal();
  if(reason)audit(reason);
  if(render)renderAll();
  if(remote)scheduleRemote();
}
function scheduleRemote(){
  clearTimeout(_remoteTimer);
  _remoteTimer=setTimeout(saveRemote,700);
}
async function saveRemote(){
  if(window._DEMO_MODE||typeof _monitorUpsert!=='function')return;
  try{
    // Integra primero los cambios compartidos para reducir sobrescrituras entre
    // dos operadores que trabajan al mismo tiempo.
    await loadRemote();
    const payload=JSON.stringify({...data(),audit:data().audit.slice(0,250)});
    await _monitorUpsert(REMOTE_NAME,payload,'machineOpsRecordId');
  }catch(e){console.warn('[MachineOps] respaldo remoto pendiente',e);}
}
async function loadRemote(){
  if(window._DEMO_MODE||typeof airtableFetch!=='function')return;
  try{
    const res=await airtableFetch('Monitor Sistema',200);
    const rec=(res.records||[]).find(r=>r.fields?.Name===REMOTE_NAME);
    if(!rec)return;
    state.machineOpsRecordId=rec.id;
    const remote=JSON.parse(rec.fields?.Notes||'{}');
    _data=mergeData(data(),remote);writeLocal();
  }catch(e){console.warn('[MachineOps] no se pudo restaurar respaldo',e);}
}
function audit(action,machineId='',detail='',severity='info'){
  const row={id:uid('audit'),at:nowIso(),actor:actor(),action,machineId,detail:String(detail||''),severity,updatedAt:nowIso()};
  data().audit.unshift(row);if(data().audit.length>500)data().audit.length=500;
  writeLocal();
}

function getMachine(id){return (typeof MAQUINAS!=='undefined'?MAQUINAS:[]).find(m=>m.id===id);}
function machineLabel(id){const m=getMachine(id);return m?`${m.nombre} #${m.numG||m.num}`:'Sin asignar';}
function liveState(id){try{return (_printerStatus[id]||{}).state||'';}catch(_){return'';}}
function bedClearSignature(id){
  let live={};try{live=_printerStatus[id]||{};}catch(_){}
  return [fileKey(live.filename||''),Math.round(num(live.elapsed)),String(live.state||'')].join('|');
}
function bedIsCleared(id){
  if(liveState(id)!=='complete')return true;
  const ack=data().bedClearAcks?.[id];
  return !!ack&&ack.signature===bedClearSignature(id);
}
async function confirmBedCleared(id){
  const m=getMachine(id);if(!m)return false;
  if(liveState(id)!=='complete'){toast('La impresora no está esperando retiro de pieza','info');return false;}
  const signature=bedClearSignature(id);
  if(!signature){toast('No se pudo identificar la impresión finalizada','error');return false;}
  data().bedClearAcks[id]={signature,clearedAt:nowIso(),actor:actor()};
  audit('Cama liberada por operador',id,'Pieza retirada y cama disponible','control');
  writeLocal();scheduleRemote();
  try{await window.FarmQueue?.confirmBedClear?.(id,signature);}catch(e){toast('Cama marcada localmente; Controller aún no confirmó','info');}
  renderAll();try{renderMonitorGrid();}catch(_){}
  toast(`${machineLabel(id)} · cama liberada`,'success');
  try{openTech(id,{autoRefresh:false});}catch(_){}
  return true;
}
function installedNozzle(machine){
  if(!machine?.id)return'';
  let registry=null;try{registry=window.FarmRegistry?.status?.().machines?.find(x=>x.id===machine.id)||null;}catch(_){}
  const value=registry?.nozzleInstalled||machine.nozzleInstalled||localStorage.getItem('printer_nozzle_'+machine.id)||'';
  return String(value||'').trim();
}
function liveEvidence(id,now=Date.now()){
  const live=typeof _printerStatus!=='undefined'?_printerStatus[id]||{}:{};
  const state=String(live.state||''),lastSeen=num(live.lastSeenAt);
  const fresh=!!lastSeen&&now-lastSeen<60000;
  const known=fresh&&!['','connecting','unknown','startup'].includes(state);
  return{live,state,lastSeen,fresh,known};
}
function farmQueueEvidence(now=Date.now()){
  let status={};try{status=window.FarmQueue?.status?.()||{};}catch(_){}
  const lastSync=num(status.lastSync),jobs=Array.isArray(status.jobs)?status.jobs:[],counts=status.counts&&typeof status.counts==='object'?status.counts:{};
  const fresh=status.controllerOk===true&&!!lastSync&&now-lastSync<30000;
  return{controllerOk:status.controllerOk===true,lastSync,fresh,jobs,counts};
}
function farmQueueMatch(job,evidence=farmQueueEvidence()){
  if(!job?.machineId||!job?.gcodeFile)return null;
  const target=fileKey(job.gcodeFile);
  return evidence.jobs.find(row=>row.machineId===job.machineId&&target&&fileKey(row.filename)===target&&['queued','retry','checking','uploading','uploaded','started','printing','paused'].includes(String(row.state||'')))||null;
}
function machineOperational(m){
  if(!m||getMaquinaEstadoGlobal(m.id)!=='disponible')return false;
  // La planificación automática sólo usa máquinas cuyo estado técnico está
  // confirmado recientemente. "Sin datos", connecting o startup no equivalen
  // a una impresora disponible.
  const evidence=liveEvidence(m.id);
  if(!evidence.known)return false;
  if(['offline','apidown','noip','shutdown','error'].includes(evidence.state))return false;
  if(evidence.state==='complete'&&!bedIsCleared(m.id))return false;
  return true;
}
function machineCapabilities(m){return MODEL_CAPS[m?.modelo]||MODEL_CAPS.K1;}
function jobMinutes(j){return Math.max(1,num(j.cycles,1))*Math.max(1,num(j.minutesPerCycle,60));}
function jobModels(j){
  const explicit=Array.isArray(j.compatibleModels)?j.compatibleModels.filter(Boolean):[];
  return explicit.length?explicit.filter(model=>modelCanRun(model,j)):MODELS.filter(model=>modelCanRun(model,j));
}
function modelCanRun(model,j){
  const c=MODEL_CAPS[model];if(!c)return false;
  if(j.material&&!c.materials.includes(j.material))return false;
  const x=num(j.sizeX),y=num(j.sizeY),z=num(j.sizeZ),dims=[x,y,z],known=dims.every(v=>v>0),partial=dims.some(v=>v>0)&&!known;
  if(partial)return false;
  if(known){
    const fits=((x<=c.bed[0]&&y<=c.bed[1])||(y<=c.bed[0]&&x<=c.bed[1]))&&z<=c.bed[2];
    if(!fits)return false;
  }
  return true;
}
function activeJobs(){return data().jobs.filter(j=>!j.archived&&ACTIVE_JOB_STATES.includes(j.status));}
function jobsForMachine(id){return activeJobs().filter(j=>j.machineId===id);}
function reservedForSpool(id){
  return activeJobs().filter(j=>j.spoolId===id&&!j.materialConsumed).reduce((s,j)=>s+num(j.grams),0);
}
function spoolAvailable(s){return Math.max(0,num(s.remaining)-reservedForSpool(s.id));}
function compatibleSpools(j,machineId=''){
  return data().spools.filter(s=>!s.archived&&s.status!=='agotado'&&s.status!=='cuarentena'&&
    (!j.material||s.material===j.material)&&(!j.color||!s.color||s.color.toLowerCase()===j.color.toLowerCase())&&
    (!machineId||!s.machineId||s.machineId===machineId));
}
function dueUrgency(j){
  const days=(dateValue(j.dueDate)-Date.now())/86400000;
  const p={urgente:0,alta:1,normal:2,baja:3}[j.priority]??2;
  return p*100+days;
}
function machineScore(j,m,loadMinutes=0){
  if(!machineOperational(m)||!jobModels(j).includes(m.modelo)||!modelCanRun(m.modelo,j))return Infinity;
  const cap=machineCapabilities(m),st=liveState(m.id);
  const eta=st==='printing'?num(_printerStatus[m.id]?.eta)/60:st==='paused'?1440:0;
  const materialBonus=compatibleSpools(j,m.id).some(s=>spoolAvailable(s)>=num(j.grams))?-180:0;
  const jobVol=Math.max(1,num(j.sizeX)*num(j.sizeY)*num(j.sizeZ));
  const bedVol=cap.bed[0]*cap.bed[1]*cap.bed[2];
  const oversizePenalty=Math.max(0,(1-jobVol/bedVol))*80;
  const historyCalibration=num(localStorage.getItem('sl_time_cal_'+m.modelo),1);
  return loadMinutes+eta+(jobMinutes(j)*historyCalibration)+oversizePenalty+materialBonus;
}
function pickMachine(j,loads){
  let best=null,bestScore=Infinity;
  (MAQUINAS||[]).forEach(m=>{
    const score=machineScore(j,m,loads.get(m.id)||0);
    if(score<bestScore){best=m;bestScore=score;}
  });
  return best?{machine:best,score:bestScore}:null;
}

function fileKey(value){
  return String(value||'').split('/').pop().replace(/\.(gcode|gco|3mf)$/i,'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'');
}
function filenameMatchScore(job,filename){
  const live=fileKey(filename),gcode=fileKey(job?.gcodeFile),name=fileKey(job?.name),id=fileKey(job?.id),order=fileKey(orderLabel(job?.pedidoId));
  if(!live)return 0;
  if(gcode&&live===gcode)return 100;
  if(gcode&&(live.includes(gcode)||gcode.includes(live)))return 82;
  if(id&&live.includes(id))return 74;
  if(order&&order.length>=5&&live.includes(order))return 68;
  if(name&&name.length>=5&&(live.includes(name)||name.includes(live)))return 58;
  return 0;
}
function recommendationForJob(job){
  const loads=new Map((MAQUINAS||[]).map(m=>[m.id,jobsForMachine(m.id).filter(j=>j.id!==job.id).reduce((sum,j)=>sum+jobMinutes(j),0)]));
  const candidates=(MAQUINAS||[]).map(machine=>{
    const score=machineScore(job,machine,loads.get(machine.id)||0),reasons=[];
    if(!Number.isFinite(score))return{machine,score,reasons:['Sin telemetría reciente, no operativa o incompatible']};
    const live=liveState(machine.id)||'sin telemetría';reasons.push(live==='standby'||live==='idle'?'Libre ahora':live==='printing'?'Disponible al terminar':live==='unknown'?'Sin telemetría de impresión':'Estado '+live);
    const spool=compatibleSpools(job,machine.id).find(s=>spoolAvailable(s)>=num(job.grams));
    reasons.push(spool?`Material disponible: ${spool.name}`:'Sin rollo suficiente asignado');
    let maint=0;try{maint=getMaintAlerts(machine).length;}catch(_){ }
    if(maint)reasons.push(`${maint} mantención${maint!==1?'es':''} próxima${maint!==1?'s':''}`);
    return{machine,score,reasons,spool};
  }).sort((a,b)=>a.score-b.score);
  return{best:candidates.find(row=>Number.isFinite(row.score))||null,candidates};
}
function jobCostBreakdown(job){
  const cfg=data().costConfig,minutes=Math.max(0,num(job?.actualMinutes,jobMinutes(job||{}))),hours=minutes/60;
  const spool=data().spools.find(s=>s.id===job?.spoolId),grams=Math.max(0,num(job?.materialConsumed,job?.grams));
  const material=grams/1000*num(spool?.costPerKg,parseFloat(localStorage.getItem('filament_cost_kg')||'0'));
  const electricity=hours*num(cfg.machineKw)*num(cfg.electricityClpKwh),labor=num(cfg.operatorMinutes)/60*num(cfg.laborClpHour),wear=hours*num(cfg.wearClpHour);
  const base=material+electricity+labor+wear,failure=job?.status==='fallido'?base*num(cfg.failureOverheadPct)/100:0;
  return{minutes,hours,grams,material,electricity,labor,wear,failure,total:base+failure};
}
function incidentIsConfirmed(row){
  if(!row)return false;
  return row.source!=='telemetry'||!!row.confirmedAt;
}
function printerHistoryEvidence(machineId){
  let status={};try{status=window.PrinterHistory?.status?.()||{};}catch(_){}
  const odo=status.odometer?.[machineId]||{};
  let completed=Math.max(0,num(odo.prints)),notCompleted=Math.max(0,num(odo.failures));
  let source=status.mode==='durable'?'Historial central':status.mode==='local-fallback'?'Caché local':'';
  if(completed+notCompleted===0){
    const jobs=data().jobs.filter(j=>j.machineId===machineId&&(['terminado','fallido'].includes(j.status)||['terminado','fallido'].includes(j.archivedFromStatus)));
    completed=jobs.filter(j=>j.status==='terminado'||j.archivedFromStatus==='terminado').length;
    notCompleted=jobs.filter(j=>j.status==='fallido'||j.archivedFromStatus==='fallido').length;
    if(completed+notCompleted)source='Trabajos registrados';
  }
  return{completed,notCompleted,total:completed+notCompleted,source:source||'Sin historial',durable:status.mode==='durable',lastSync:num(status.lastSync)};
}
function centralHealthEvidence(machineId){
  let status={};try{status=window.FarmHealth?.status?.()||{};}catch(_){}
  const row=(status.machines||[]).find(x=>String(x.id||'')===String(machineId))||null;
  const generated=num(status.generatedAt||status.lastSync),fresh=!!generated&&Date.now()-generated<120000;
  return{row,fresh,central:status.mode==='central',generatedAt:generated};
}
function machineReliability(machineId){
  const history=printerHistoryEvidence(machineId),central=centralHealthEvidence(machineId);
  const current=liveState(machineId),cut=Date.now()-30*86400000;
  const live=typeof _printerStatus!=='undefined'?_printerStatus[machineId]||{}:{};
  const liveFresh=!!live.lastSeenAt&&Date.now()-num(live.lastSeenAt)<60000;
  const confirmed=data().incidents.filter(i=>i.machineId===machineId&&!i.resolvedAt&&incidentIsConfirmed(i)&&Date.parse(i.at||0)>=cut);
  const detected=data().incidents.filter(i=>i.machineId===machineId&&!i.resolvedAt&&!incidentIsConfirmed(i)&&Date.parse(i.at||0)>=cut);
  let maintenanceAlerts=[];try{maintenanceAlerts=getMaintAlerts(getMachine(machineId))||[];}catch(_){}
  const sample=history.total,completion=sample?history.completed/sample*100:null;
  const centralBad=central.fresh&&central.row&&(central.row.health==='offline'||['shutdown','error'].includes(String(central.row.klipperState||'')));
  const liveBad=liveFresh&&['offline','noip','shutdown','error','apidown'].includes(current);
  const currentGood=(central.fresh&&central.row?.online)||(liveFresh&&!['connecting','unknown','offline','noip','shutdown','error','apidown'].includes(current));
  let level='unknown',label='Sin datos actuales';
  if(centralBad||liveBad||confirmed.length){level='critical';label='Requiere atención';}
  else if(maintenanceAlerts.length){level='warning';label='Mantención pendiente';}
  else if(currentGood){level='ok';label='Operativa ahora';}
  const confidence=history.durable&&central.central&&central.fresh&&sample>=5?'alta':
    ((central.fresh||liveFresh)&&(history.durable||sample>=2)?'media':'baja');
  return{level,label,confidence,history,central,current,liveFresh,completion,confirmed:confirmed.length,detected:detected.length,maintenance:maintenanceAlerts.length};
}
function preflightFromFacts(facts){
  const checks=[];
  const add=(key,label,level,detail)=>checks.push({key,label,level,detail});
  add('connection','Conectividad',facts.connectionReady?'pass':'block',facts.connectionReady?'Moonraker disponible':facts.connectionDetail||'Sin telemetría');
  add('availability','Máquina lista',facts.machineFree?'pass':'block',facts.machineFree?'Sin impresión activa y cama liberada':facts.bedNeedsClear?'La impresión terminó, pero falta confirmar retiro de pieza / cama libre':'La máquina está ocupada o detenida');
  const dimLevel=facts.dimensionsPartial?'block':facts.dimensionsKnown?'pass':'warn';
  add('compatibility','Material y volumen',facts.compatible?dimLevel:'block',!facts.compatible?'Trabajo incompatible con esta impresora':facts.dimensionsPartial?'Dimensiones incompletas: registra X, Y y Z':facts.dimensionsKnown?'Material y volumen verificados':'Material compatible; dimensiones no registradas');
  if(facts.jobNozzle){
    add('nozzle','Boquilla instalada',facts.nozzleKnown?(facts.nozzleMatch?'pass':'block'):'warn',
      facts.nozzleKnown?(facts.nozzleMatch?`Boquilla ${facts.installedNozzle} confirmada`:`Trabajo requiere ${facts.jobNozzle} mm y la máquina declara ${facts.installedNozzle} mm`):`Trabajo requiere ${facts.jobNozzle} mm; boquilla física sin registrar`);
  }
  add('file','Archivo G-code',facts.hasFile?'pass':'block',facts.hasFile?'Archivo identificado':'Falta indicar el archivo G-code');
  if(facts.gramsRequired>0)add('spool','Filamento suficiente',facts.spoolAvailable>=facts.gramsRequired?'pass':facts.spoolKnown?'block':'warn',facts.spoolKnown?`${Math.round(facts.spoolAvailable)} g disponibles / ${Math.round(facts.gramsRequired)} g requeridos`:'No hay inventario de rollo vinculado');
  if(facts.filamentDetected===false)add('sensor','Sensor físico','block','La impresora no detecta filamento');
  else add('sensor','Sensor físico',facts.filamentDetected===true?'pass':'warn',facts.filamentDetected===true?'Filamento detectado':'Sensor físico sin lectura');
  add('camera','Cámara',facts.cameraConfigured?'pass':'warn',facts.cameraConfigured?'Cámara configurada':'Sin cámara configurada');
  add('maintenance','Mantención',facts.maintenanceOverdue?'block':facts.maintenanceSoon?'warn':'pass',facts.maintenanceOverdue?'Mantención vencida':facts.maintenanceSoon?'Mantención próxima':'Mantención al día');
  (facts.safetyBlockers||[]).forEach((detail,index)=>add('safety-b'+index,'Seguridad ambiental','block',detail));
  (facts.safetyWarnings||[]).forEach((detail,index)=>add('safety-w'+index,'Seguridad ambiental','warn',detail));
  const blockers=checks.filter(c=>c.level==='block'),warnings=checks.filter(c=>c.level==='warn');
  return{ok:!blockers.length,checks,blockers,warnings};
}
function evaluatePreflight(job,machine){
  const stateNow=liveState(machine.id),live=typeof _printerStatus!=='undefined'?_printerStatus[machine.id]||{}:{};
  const spool=data().spools.find(s=>s.id===job.spoolId),free=spool?spoolAvailable(spool):0;
  let maint=[];try{maint=getMaintAlerts(machine);}catch(_){ }
  const overdue=maint.some(a=>a.hours>=a.threshold),safety=safetyDecision(data().safetyConfig,latestSafetyReading(),{unattended:jobMinutes(job)>=240,cameraConfigured:!!(localStorage.getItem('printer_cam_'+machine.id)||machine.cam)});
  const x=num(job.sizeX),y=num(job.sizeY),z=num(job.sizeZ),dimensionsKnown=x>0&&y>0&&z>0,dimensionsPartial=(x>0||y>0||z>0)&&!dimensionsKnown;
  const nozzle=installedNozzle(machine),jobNozzle=String(job.nozzle||'').trim(),nozzleKnown=!!nozzle,nozzleMatch=!jobNozzle||!nozzleKnown||String(nozzle)===jobNozzle;
  return preflightFromFacts({
    connectionReady:!['','connecting','offline','noip','shutdown','error','startup'].includes(stateNow),connectionDetail:live.connectionError,
    machineFree:!['printing','paused'].includes(stateNow)&&machineOperational(machine),bedNeedsClear:stateNow==='complete'&&!bedIsCleared(machine.id),
    compatible:modelCanRun(machine.modelo,job),dimensionsKnown,dimensionsPartial,jobNozzle,installedNozzle:nozzle,nozzleKnown,nozzleMatch,hasFile:!!job.gcodeFile,
    gramsRequired:num(job.grams),spoolKnown:!!spool,spoolAvailable:free,filamentDetected:live.filament?.detected??null,
    cameraConfigured:!!(localStorage.getItem('printer_cam_'+machine.id)||machine.cam),maintenanceOverdue:overdue,maintenanceSoon:maint.length>0,
    safetyBlockers:safety.blockers,safetyWarnings:safety.warnings,
  });
}
function alertRow(key,machineId,severity,title,detail,action=''){
  return{key,machineId,severity,title,detail,action,at:Date.now()};
}
function buildSmartAlerts(now=Date.now()){
  const rows=[];
  if(_bridgeHealth.state==='down')rows.push(alertRow('bridge-down','', 'critical','Bridge de impresoras sin respuesta',_bridgeHealth.error||'No se pudo alcanzar el bridge','bridge'));
  activeJobs().filter(j=>j.dueDate&&dateValue(j.dueDate)<now).forEach(j=>rows.push(alertRow('late-'+j.id,j.machineId,'warning','Trabajo atrasado',`${j.name} · ${orderLabel(j.pedidoId)||'sin pedido'}`,'job:'+j.id)));
  (MAQUINAS||[]).forEach(machine=>{
    const live=typeof _printerStatus!=='undefined'?_printerStatus[machine.id]||{}:{},stateNow=live.state||'connecting',watch=_telemetryWatch[machine.id]||{};
    if(stateNow==='noip'||(stateNow==='offline'&&now-num(watch.offlineAt,now)>=num(data().automation.offlineMinutes,2)*60000))rows.push(alertRow('offline-'+machine.id,machine.id,'critical',stateNow==='noip'?'Máquina sin IP':'Máquina sin conexión',live.connectionError||'Sin telemetría','machine:'+machine.id));
    if(stateNow==='apidown')rows.push(alertRow('apidown-'+machine.id,machine.id,'critical','Telemetría caída, máquina viva',`Responde en el puerto ${num(live.alivePort,4408)} pero Moonraker no: puede estar imprimiendo sin que el dashboard lo vea`,'machine:'+machine.id));
    if(['error','shutdown'].includes(stateNow))rows.push(alertRow('error-'+machine.id,machine.id,'critical','Impresora detenida',live.klMsg||'Klipper requiere atención','machine:'+machine.id));
    if(stateNow==='paused')rows.push(alertRow('paused-'+machine.id,machine.id,'warning','Impresión pausada',live.filename||'Archivo sin nombre','machine:'+machine.id));
    if(stateNow==='cancelled')rows.push(alertRow('cancelled-'+machine.id,machine.id,'warning','Última impresión cancelada',live.filename||'Revisa la máquina','machine:'+machine.id));
    if(stateNow==='complete')rows.push(alertRow('pickup-'+machine.id,machine.id,'info','Impresión terminada',`${live.filename||'Trabajo'} · retirar pieza y realizar QA`,'machine:'+machine.id));
    if((stateNow==='printing'||stateNow==='paused')&&live.filament?.detected===false)rows.push(alertRow('filament-'+machine.id,machine.id,'critical','Sin filamento detectado','Sensor físico reporta vacío','machine:'+machine.id));
    if(stateNow==='printing'&&watch.unchangedAt&&now-watch.unchangedAt>num(data().automation.stallMinutes,12)*60000)rows.push(alertRow('stalled-'+machine.id,machine.id,'critical','Progreso detenido',`Sin avance por ${Math.floor((now-watch.unchangedAt)/60000)} min`,'machine:'+machine.id));
    if(stateNow==='printing'&&(num(live.elapsed)>300||num(live.progress)>0)&&((num(live.hotend?.target)>0&&Math.abs(num(live.hotend.actual)-num(live.hotend.target))>num(data().automation.tempTolerance,18))||(num(live.bed?.target)>0&&Math.abs(num(live.bed.actual)-num(live.bed.target))>num(data().automation.tempTolerance,18))))rows.push(alertRow('temperature-'+machine.id,machine.id,'warning','Temperatura fuera del objetivo',`Hotend ${num(live.hotend?.actual)}°/${num(live.hotend?.target)}° · cama ${num(live.bed?.actual)}°/${num(live.bed?.target)}°`,'machine:'+machine.id));
    if(stateNow==='printing'&&!data().jobs.some(j=>j.machineId===machine.id&&j.status==='imprimiendo'&&!j.archived))rows.push(alertRow('unlinked-'+machine.id,machine.id,'warning','Impresión sin trabajo vinculado',live.filename||'Archivo sin identificar','link:'+machine.id));
    try{getMaintAlerts(machine).forEach(a=>rows.push(alertRow('maint-'+machine.id+'-'+a.key,machine.id,a.hours>=a.threshold?'critical':'warning','Mantención '+(a.hours>=a.threshold?'vencida':'próxima'),`${a.label}: ${Math.round(a.hours)}/${a.threshold} h`,'machine:'+machine.id)));}catch(_){ }
  });
  const ttl=4*3600000;
  return rows.filter(row=>!data().alertAcks[row.key]||now-num(data().alertAcks[row.key])>ttl).sort((a,b)=>({critical:0,warning:1,info:2}[a.severity]-({critical:0,warning:1,info:2}[b.severity])));
}
function machineAlertsFor(machineId){return buildSmartAlerts().filter(a=>a.machineId===machineId);}

function acknowledgeAlert(key){data().alertAcks[key]=Date.now();persist('Alerta atendida',{render:true});}
function handleAlertAction(action){
  const [type,...rest]=String(action||'').split(':'),id=rest.join(':');
  if(type==='bridge'){checkBridgeHealth(false);return;}
  if(type==='machine'){openTech(id);return;}
  if(type==='job'){showView('planificacion');openJob(id);return;}
  if(type==='link'){createJobFromLive(id);}
}
function applyRecommendation(jobId,machineId=''){
  const job=data().jobs.find(row=>row.id===jobId);if(!job)return;
  const recommendation=recommendationForJob(job),chosen=machineId?recommendation.candidates.find(row=>row.machine.id===machineId):recommendation.best;
  if(!chosen||!Number.isFinite(chosen.score)){toast('No hay una máquina compatible y operativa','error');return;}
  job.machineId=chosen.machine.id;if(job.status==='pendiente')job.status='planificado';
  if(chosen.spool&&spoolAvailable(chosen.spool)>=num(job.grams))job.spoolId=chosen.spool.id;
  job.updatedAt=nowIso();persist('Recomendación inteligente aplicada');toast(`${job.name} → ${machineLabel(job.machineId)}`,'success');
}
function createJobFromLive(machineId){
  const m=getMachine(machineId),live=typeof _printerStatus!=='undefined'?_printerStatus[machineId]||{}:{};if(!m||live.state!=='printing'){toast('No hay una impresión activa para vincular','error');return;}
  const existing=findJobForPrint(machineId,live.filename);
  if(existing){existing.status='imprimiendo';existing.startedAt=existing.startedAt||nowIso();existing.updatedAt=nowIso();persist('Impresión vinculada automáticamente');toast(`Vinculada a ${existing.name}`,'success');return;}
  const filename=String(live.filename||'Impresión sin nombre'),job={id:uid('job'),name:filename.replace(/\.(gcode|3mf)$/i,''),pedidoId:'',qty:1,unitsPerBed:1,cycles:1,
    minutesPerCycle:Math.max(1,Math.round((num(live.elapsed)+num(live.eta))/60)||60),material:'PLA',color:'',grams:0,nozzle:'0.4',machineId,spoolId:'',profileId:'',gcodeFile:filename,
    compatibleModels:[m.modelo],postStages:[],status:'imprimiendo',priority:'normal',startedAt:new Date(Date.now()-num(live.elapsed)*1000).toISOString(),createdAt:nowIso(),updatedAt:nowIso(),archived:false};
  data().jobs.push(job);persist('Trabajo creado desde impresión en vivo');toast('Impresión incorporada al control de producción ✓','success');
}
function addIncident({machineId='',jobId='',type='other',note='',photo='',source='manual'}={}){
  const dedupeMs=source==='telemetry'?30*60000:5*60000;
  const recent=data().incidents.find(row=>row.machineId===machineId&&row.type===type&&row.source===source&&!row.resolvedAt&&
    (jobId?row.jobId===jobId:true)&&Date.now()-Date.parse(row.at||0)<dedupeMs);
  if(recent)return recent;
  const manual=source!=='telemetry';
  const incident={id:uid('incident'),machineId,jobId,type:INCIDENT_TYPES[type]?type:'other',note:String(note||''),photo:String(photo||''),source,
    confirmedAt:manual?nowIso():'',confirmedBy:manual?actor():'',at:nowIso(),actor:actor(),resolvedAt:'',resolvedBy:'',resolution:'',updatedAt:nowIso()};
  data().incidents.unshift(incident);if(data().incidents.length>300)data().incidents.length=300;return incident;
}
function confirmIncident(id){
  const row=data().incidents.find(item=>item.id===id);if(!row||row.resolvedAt)return;
  row.confirmedAt=nowIso();row.confirmedBy=actor();row.updatedAt=nowIso();
  persist('Evento automático confirmado como incidente');
}
function dismissIncident(id){
  const row=data().incidents.find(item=>item.id===id);if(!row||row.resolvedAt)return;
  row.resolvedAt=nowIso();row.resolvedBy=actor();row.resolution='dismissed';row.updatedAt=nowIso();
  persist('Evento automático descartado');
}
function openIncident(machineId='',jobId=''){
  const machine=input('mopsIncidentMachine'),job=input('mopsIncidentJob');if(!machine||!job)return;
  machine.innerHTML='<option value="">— flota / bridge —</option>'+(MAQUINAS||[]).map(m=>`<option value="${esc(m.id)}">${esc(machineLabel(m.id))}</option>`).join('');machine.value=machineId;
  fillIncidentJobs(machineId,jobId);
  setVal('mopsIncidentType','other');setVal('mopsIncidentNote','');setVal('mopsIncidentPhoto','');_incidentPhotoData='';const preview=input('mopsIncidentPreview');if(preview){preview.src='';preview.style.display='none';}input('mopsIncidentModal').style.display='flex';
}
function fillIncidentJobs(machineId='',jobId=''){const job=input('mopsIncidentJob');if(!job)return;job.innerHTML='<option value="">— sin trabajo —</option>'+data().jobs.filter(row=>!row.archived&&(!machineId||row.machineId===machineId)).map(row=>`<option value="${esc(row.id)}">${esc(row.name)} · ${esc(JOB_META[row.status]?.label||row.status)}</option>`).join('');if([...job.options].some(option=>option.value===jobId))job.value=jobId;}
function refreshIncidentJobs(){fillIncidentJobs(inputVal('mopsIncidentMachine'),inputVal('mopsIncidentJob'));}
function closeIncident(){const modal=input('mopsIncidentModal');if(modal)modal.style.display='none';_incidentPhotoData='';}
function loadIncidentPhoto(event){
  const file=event?.target?.files?.[0];if(!file)return;if(file.size>8*1024*1024){toast('La foto no puede superar 8 MB','error');event.target.value='';return;}
  const reader=new FileReader();reader.onload=()=>{const image=new Image();image.onload=()=>{const scale=Math.min(1,960/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);_incidentPhotoData=canvas.toDataURL('image/jpeg',.72);const preview=input('mopsIncidentPreview');if(preview){preview.src=_incidentPhotoData;preview.style.display='block';}};image.src=reader.result;};reader.readAsDataURL(file);
}
function saveIncident(){
  const machineId=inputVal('mopsIncidentMachine'),jobId=inputVal('mopsIncidentJob'),type=inputVal('mopsIncidentType'),note=inputVal('mopsIncidentNote').trim();
  if(!machineId&&!note){toast('Selecciona una máquina o describe el incidente','error');return;}
  addIncident({machineId,jobId,type,note,photo:_incidentPhotoData,source:'manual'});persist('Incidente técnico registrado');closeIncident();toast('Incidente registrado ✓','success');
}
function resolveIncident(id){const row=data().incidents.find(item=>item.id===id);if(!row)return;row.resolvedAt=nowIso();row.resolvedBy=actor();row.updatedAt=nowIso();persist('Incidente resuelto');}

async function checkBridgeHealth(silent=true){
  if(typeof getPrinterTunnel!=='function')return false;const started=performance.now(),previous=_bridgeHealth.state,url=getPrinterTunnel();_bridgeHealth={..._bridgeHealth,state:'checking',checkedAt:Date.now(),error:''};if(!silent)renderIntelligence();
  try{const response=await fetch(url+'/healthz',{signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error('Bridge HTTP '+response.status);const token=typeof getPrinterTunnelToken==='function'?getPrinterTunnelToken():'';if(!token)throw new Error('Bridge disponible, pero falta el token de acceso');const auth=await fetch(url+'/authcheck?bt='+encodeURIComponent(token),{signal:AbortSignal.timeout(7000)});if(auth.status===401)throw new Error('Token del bridge inválido o vencido');if(!auth.ok)throw new Error('Validación HTTP '+auth.status);_bridgeHealth={state:'up',checkedAt:Date.now(),latencyMs:Math.round(performance.now()-started),error:''};if(previous==='down')audit('Bridge de impresoras recuperado','','Conexión restablecida','info');if(!silent)toast('Bridge operativo y autenticado ✓','success');}
  catch(error){_bridgeHealth={state:'down',checkedAt:Date.now(),latencyMs:null,error:error?.message||'Sin respuesta'};if(previous!=='down')audit('Bridge de impresoras sin respuesta','',_bridgeHealth.error,'error');if(!silent)toast('El bridge no responde','error');}
  writeLocal();renderIntelligence();updateNavCounts();return _bridgeHealth.state==='up';
}
function saveIntelligenceConfig(){
  data().automation={...data().automation,enabled:!!input('mopsAutoEnabled')?.checked,autoLink:!!input('mopsAutoLink')?.checked,autoIncident:!!input('mopsAutoIncident')?.checked,
    stallMinutes:clamp(num(inputVal('mopsAutoStall'),12),3,120),offlineMinutes:clamp(num(inputVal('mopsAutoOffline'),2),1,30),tempTolerance:clamp(num(inputVal('mopsAutoTemp'),18),5,60),bridgeIntervalSeconds:clamp(num(inputVal('mopsBridgeInterval'),60),30,600)};
  data().costConfig={...data().costConfig,electricityClpKwh:Math.max(0,num(inputVal('mopsCostElectricity'))),machineKw:Math.max(0,num(inputVal('mopsCostKw'))),laborClpHour:Math.max(0,num(inputVal('mopsCostLabor'))),operatorMinutes:Math.max(0,num(inputVal('mopsCostOperator'))),wearClpHour:Math.max(0,num(inputVal('mopsCostWear'))),failureOverheadPct:clamp(num(inputVal('mopsCostFailure')),0,100)};
  restartBridgeTimer();persist('Configuración inteligente actualizada');toast('Configuración guardada ✓','success');
}
function restartBridgeTimer(){clearInterval(_bridgeTimer);_bridgeTimer=null;if(data().automation.enabled)_bridgeTimer=setInterval(()=>{if(!document.hidden)checkBridgeHealth(true);},num(data().automation.bridgeIntervalSeconds,60)*1000);}

function _parkIntelligenceEmbeddedNodes(el){
  // Inteligencia se repinta con innerHTML. Conservamos nodos con estado vivo
  // (monitor/cámaras y resumen operativo) fuera del contenedor antes de hacerlo.
  const intelligenceView=el.closest('[data-maq-view="inteligencia"]');
  const park=node=>{
    if(node&&node.parentElement===el&&intelligenceView?.parentElement)intelligenceView.insertAdjacentElement('afterend',node);
    return node;
  };
  return{monitor:park(input('maquinaMonitorView')),overview:park(input('maquinaOpsOverview'))};
}
function _mountIntelligenceEmbeddedNodes(el,nodes){
  if(!el)return;
  const monitorAnchor=input('mopsLiveMonitorAnchor');
  if(nodes?.monitor&&monitorAnchor){
    monitorAnchor.replaceWith(nodes.monitor);
    nodes.monitor.classList.add('mops-inline-monitor');
    nodes.monitor.style.marginTop='14px';nodes.monitor.style.marginBottom='14px';
    try{renderMonitorFilterTabs();renderMonitorKPIs();renderMonitorGrid();}catch(_){}
  }
  const overviewAnchor=input('mopsOpsOverviewAnchor');
  if(nodes?.overview&&overviewAnchor){
    overviewAnchor.replaceWith(nodes.overview);
    nodes.overview.classList.add('mops-inline-overview');
    nodes.overview.style.margin='12px 0 14px';
    try{renderOpsOverview();}catch(_){}
  }
}
function _statusColor(level){return level==='critical'?'var(--danger)':level==='warning'?'var(--warn)':level==='ok'?'var(--accent3)':'var(--text3)';}
function _statusIcon(level){return level==='critical'?'!':level==='warning'?'⚠':level==='ok'?'✓':'?';}
function _incidentRowsForUi(){
  const all=[...data().incidents].sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0));
  // Los eventos automáticos viejos sin confirmar no son tareas pendientes.
  // Siguen en historial, pero no ensucian la pantalla diaria.
  const pending=all.filter(row=>!row.resolvedAt).filter(row=>incidentIsConfirmed(row)||Date.now()-Date.parse(row.at||0)<24*3600000);
  const history=all.filter(row=>row.resolvedAt||(!incidentIsConfirmed(row)&&Date.now()-Date.parse(row.at||0)>=24*3600000));
  return{pending,history};
}
function machineHasCfs(machine){
  if(typeof machineHasPhysicalCfs==='function')return machineHasPhysicalCfs(machine);
  if(!machine)return false;
  const id=String(machine.id||''),globalNo=Number(machine.numG??machine.num??0);
  return machine.modelo==='K2 Plus'||id==='k1-1'||(machine.modelo==='K1'&&globalNo===1);
}
function _filamentPhysicalSummary(machine){
  const s=typeof _printerStatus!=='undefined'?_printerStatus[machine.id]||{}:{},f=s.filament||null;
  const fresh=!!s.lastSeenAt&&Date.now()-num(s.lastSeenAt)<60000;
  if(!fresh)return{level:'unknown',label:'Sin dato reciente',detail:'La telemetría física tiene más de 60 s o aún no llegó.',f:null};
  if(f?.cfsConnected)return{level:'ok',label:'CFS conectado',detail:`${f.cfsSlots?.length||0} slot${(f.cfsSlots?.length||0)===1?'':'s'} con lectura física.`,f};
  if(f?.detected===true)return{level:'unknown',label:'CFS sin confirmar',detail:'Hay filamento detectado, pero la telemetría no confirma el CFS en esta lectura.',f};
  if(f?.detected===false)return{level:'warning',label:'CFS sin confirmar',detail:'La telemetría no confirma el CFS y el sensor físico reporta que no hay filamento.',f};
  return{level:'unknown',label:'CFS sin lectura',detail:'La telemetría reciente no entregó estado del CFS.',f};
}
function _incidentCard(row){
  const confirmed=incidentIsConfirmed(row),detected=!confirmed&&!row.resolvedAt;
  const source=detected?'Evento automático':row.source==='telemetry'?'Confirmado desde telemetría':'Registrado por operador';
  const state=row.resolvedAt?(row.resolution==='dismissed'?'Descartado':'Resuelto'):confirmed?'Pendiente':'Por confirmar';
  const actions=row.resolvedAt?'':detected
    ?`<button class="btn btn-primary btn-sm" onclick="MachineOps.confirmIncident('${row.id}')">Confirmar falla</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.dismissIncident('${row.id}')">Descartar</button>`
    :`<button class="btn btn-primary btn-sm" onclick="MachineOps.resolveIncident('${row.id}')">Resolver</button>`;
  return`<article class="${row.resolvedAt?'resolved':''} ${detected?'detected':''}">
    ${row.photo?`<img src="${esc(row.photo)}" alt="Evidencia">`:''}
    <div><div class="mops-incident-title"><b>${esc(INCIDENT_TYPES[row.type]||INCIDENT_TYPES.other)}</b><span>${esc(state)}</span></div>
      <small>${row.machineId?esc(machineLabel(row.machineId))+' · ':''}${esc(fmtStamp(row.at))}</small>
      <small class="mops-incident-source">${esc(source)}</small>
      <p>${esc(row.note||'Sin observaciones')}</p>
    </div><div class="mops-incident-actions">${actions}</div>
  </article>`;
}
function renderIntelligence(){
  const el=input('mopsIntelligence');if(!el)return;
  const embedded=_parkIntelligenceEmbeddedNodes(el);
  const alerts=buildSmartAlerts(),critical=alerts.filter(row=>row.severity==='critical').length;
  const unlinked=(MAQUINAS||[]).filter(m=>liveState(m.id)==='printing'&&!data().jobs.some(j=>j.machineId===m.id&&j.status==='imprimiendo'&&!j.archived)).length;
  const healthRows=(MAQUINAS||[]).map(machine=>({machine,...machineReliability(machine.id)}));
  const monthCut=Date.now()-30*86400000,costRows=data().jobs.filter(j=>['terminado','fallido'].includes(j.status)&&Date.parse(j.completedAt||j.updatedAt||0)>=monthCut).map(jobCostBreakdown),monthCost=costRows.reduce((sum,row)=>sum+row.total,0);
  const recommend=data().jobs.filter(j=>!j.archived&&['pendiente','planificado','en_cola'].includes(j.status)).sort((a,b)=>dueUrgency(a)-dueUrgency(b)).slice(0,6).map(job=>({job,...recommendationForJob(job)}));
  const physical=(MAQUINAS||[]).filter(machineHasCfs).map(machine=>({machine,..._filamentPhysicalSummary(machine)}));
  const incidents=_incidentRowsForUi();
  const bridgeLabel={up:'Operativo',down:'Sin respuesta',checking:'Comprobando…'}[_bridgeHealth.state]||'Sin comprobar',bridgeColor=_bridgeHealth.state==='up'?'var(--accent3)':_bridgeHealth.state==='down'?'var(--danger)':'var(--warn)';
  const confidenceCounts={alta:0,media:0,baja:0};healthRows.forEach(row=>confidenceCounts[row.confidence]=(confidenceCounts[row.confidence]||0)+1);

  el.innerHTML=`<div class="mops-kpis">${kpi('Alertas activas',alerts.length,`${critical} críticas`,critical?'var(--danger)':alerts.length?'var(--warn)':'var(--accent3)')}${kpi('Impresiones sin ficha',unlinked,'requieren vinculación',unlinked?'var(--warn)':'var(--accent3)')}${kpi('Costo últimos 30 días',fmtMoney(monthCost),`${costRows.length} trabajos medidos`)}${kpi('Bridge',bridgeLabel,_bridgeHealth.latencyMs!=null?`${_bridgeHealth.latencyMs} ms`:'última revisión '+(_bridgeHealth.checkedAt?fmtStamp(_bridgeHealth.checkedAt):'pendiente'),bridgeColor)}</div>
    <div id="mopsOpsOverviewAnchor" class="mops-intelligence-overview-anchor" aria-hidden="true"></div>
    <div class="mops-intel-grid">
      <section class="card mops-intel-panel"><div class="mops-intel-head"><div><b>🚨 Alertas accionables</b><small>Solo situaciones que requieren una acción ahora.</small></div><button class="btn btn-ghost btn-sm" onclick="MachineOps.checkBridgeHealth(false)">↻ Revisar bridge</button></div><div class="mops-smart-alerts">${alerts.length?alerts.slice(0,14).map(row=>`<article class="mops-smart-alert ${row.severity}"><span class="mops-smart-severity">${row.severity==='critical'?'!':row.severity==='warning'?'⚠':'i'}</span><div><b>${esc(row.title)}</b><small>${row.machineId?esc(machineLabel(row.machineId))+' · ':''}${esc(row.detail)}</small></div><div class="mops-smart-actions">${row.action?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.handleAlertAction('${esc(row.action)}')">Revisar</button>`:''}<button class="btn btn-ghost btn-sm" onclick="MachineOps.acknowledgeAlert('${esc(row.key)}')">Atendida</button></div></article>`).join(''):'<div class="mops-intel-empty">✓ Nada requiere atención ahora.</div>'}</div></section>
      <section class="card mops-intel-panel"><div class="mops-intel-head"><div><b>🎯 Asignación recomendada</b><small>Sugerencias de carga; siempre puedes revisarlas antes de aplicar.</small></div><button class="btn btn-ghost btn-sm" onclick="MachineOps.autoPlan()">Aplicar a todas</button></div><div class="mops-recommendations">${recommend.length?recommend.map(({job,best})=>`<article><div><b>${esc(job.name)}</b><small>${esc(orderLabel(job.pedidoId)||'Sin pedido')} · ${fmtMin(jobMinutes(job))} · ${esc(job.material)}</small></div>${best?`<div class="mops-rec-target"><b>${esc(machineLabel(best.machine.id))}</b><small>${esc(best.reasons.join(' · '))}</small></div><button class="btn btn-primary btn-sm" onclick="MachineOps.applyRecommendation('${job.id}')">Asignar</button>`:'<span class="mops-status" style="color:var(--danger)">Sin opción segura</span>'}</article>`).join(''):'<div class="mops-intel-empty">No hay trabajos pendientes de asignación.</div>'}</div></section>
    </div>

    <div id="mopsLiveMonitorAnchor" aria-hidden="true"></div>

    <section class="card mops-intel-panel mops-trust-panel">
      <div class="mops-intel-head"><div><b>🛡 Estado y evidencia por impresora</b><small>No mostramos un porcentaje “mágico”: cada estado indica qué datos reales lo respaldan.</small></div><div class="mops-confidence-summary"><span>Confianza alta ${confidenceCounts.alta||0}</span><span>media ${confidenceCounts.media||0}</span><span>baja ${confidenceCounts.baja||0}</span></div></div>
      <div class="mops-reliability-grid mops-evidence-grid">${healthRows.map(row=>{
        const hist=row.history,completion=row.completion;
        const historyText=hist.total?`${hist.completed} completada${hist.completed===1?'':'s'} · ${hist.notCompleted} cierre${hist.notCompleted===1?'':'s'} no completado${hist.notCompleted===1?'':'s'}`:'Sin cierres registrados';
        const centralText=row.central.fresh&&row.central.row?`FarmHealth: ${row.central.row.online?'online':'sin respuesta'}`:'FarmHealth sin lectura reciente';
        return`<article class="mops-evidence-card ${row.level}">
          <div class="mops-reliability-title"><b>${esc(machineLabel(row.machine.id))}</b><span class="mops-health-state" style="color:${_statusColor(row.level)}">${_statusIcon(row.level)} ${esc(row.label)}</span></div>
          <div class="mops-evidence-confidence">Confianza de datos: <b>${esc(row.confidence)}</b> · ${esc(hist.source)}</div>
          <div class="mops-evidence-facts"><span>${esc(historyText)}${completion!==null&&hist.total>=3?` · ${completion.toFixed(0)}% completadas`:''}</span><span>${esc(centralText)}</span><span>${row.confirmed?'⚠ '+row.confirmed+' incidente(s) confirmado(s) abierto(s)':'✓ Sin incidentes confirmados abiertos'} · ${row.maintenance?row.maintenance+' mantención(es) pendiente(s)':'mantención sin alertas'}</span></div>
          <div><button class="btn btn-ghost btn-sm" onclick="MachineOps.openTech('${row.machine.id}')">Ficha</button><button class="btn btn-ghost btn-sm" onclick="openHistoryModal('${row.machine.id}')">Historial real</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.openIncident('${row.machine.id}')">Reportar</button></div>
        </article>`;
      }).join('')}</div>
    </section>

    <section class="card mops-intel-panel mops-pending-panel" style="margin-top:12px">
      <div class="mops-intel-head"><div><b>🧰 Pendientes por resolver</b><small>Los eventos automáticos primero se confirman o descartan; solo los confirmados afectan el diagnóstico.</small></div><button class="btn btn-primary btn-sm" onclick="MachineOps.openIncident()">+ Registrar incidente</button></div>
      <div class="mops-incidents">${incidents.pending.length?incidents.pending.slice(0,12).map(_incidentCard).join(''):'<div class="mops-intel-empty">✓ No hay incidentes ni eventos pendientes.</div>'}</div>
      ${incidents.history.length?`<details class="mops-incident-history"><summary>Ver historial · ${incidents.history.length}</summary><div class="mops-incidents">${incidents.history.slice(0,20).map(_incidentCard).join('')}</div></details>`:''}
    </section>

    <details class="card mops-intel-panel mops-physical-details" style="margin-top:12px">
      <summary><span><b>🧵 CFS físico</b><small>Solo equipos con CFS instalado: K1 #1 y K2 Plus #11.</small></span><span>${physical.filter(row=>row.level==='ok').length}/${physical.length} CFS confirmados</span></summary>
      <div class="mops-cfs-grid mops-physical-grid">${physical.length?physical.map(row=>`<article>
        <div><b>${esc(machineLabel(row.machine.id))}</b><span class="mops-cfs-state ${row.level==='ok'?'online':'offline'}" style="color:${_statusColor(row.level)}">${esc(row.label)}</span></div>
        <small>${esc(row.detail)}</small>
        ${row.f?.cfsSlots?.length?`<div class="mops-cfs-slots">${row.f.cfsSlots.map(slot=>`<span><i style="background:${cssColor(slot.color)}"></i><b>${esc(slot.slot)}</b><small>${esc(slot.material||'—')} · ${Math.round(num(slot.remain))} restante</small></span>`).join('')}</div>`:''}
      </article>`).join(''):'<div class="mops-intel-empty">No hay equipos CFS configurados.</div>'}</div>
    </details>`;

  _mountIntelligenceEmbeddedNodes(el,embedded);
}

// La configuración de automatización y costos se ajusta cada varios meses, no
// cada turno: vive en Taller, no en la pantalla diaria del operador.
function renderAutomationConfig(){
  const el=input('mopsAutomationConfig');if(!el)return;
  el.innerHTML=`<section class="card mops-intel-panel" style="margin-top:12px"><div class="mops-intel-head"><div><b>⚙ Automatización y costo real</b><small>Ajusta umbrales a la operación del taller; los cambios se sincronizan con el equipo.</small></div><button class="btn btn-primary btn-sm" onclick="MachineOps.saveIntelligenceConfig()">Guardar configuración</button></div><div class="mops-config-grid"><label><span>Automatización</span><input id="mopsAutoEnabled" type="checkbox" ${data().automation.enabled?'checked':''}> Activa</label><label><span>Vincular G-code</span><input id="mopsAutoLink" type="checkbox" ${data().automation.autoLink?'checked':''}> Automático</label><label><span>Incidente por falla</span><input id="mopsAutoIncident" type="checkbox" ${data().automation.autoIncident?'checked':''}> Automático</label><label><span>Progreso detenido (min)</span><input id="mopsAutoStall" class="field-input" type="number" min="3" value="${num(data().automation.stallMinutes)}"></label><label><span>Offline confirmado (min)</span><input id="mopsAutoOffline" class="field-input" type="number" min="1" value="${num(data().automation.offlineMinutes)}"></label><label><span>Tolerancia temperatura (°C)</span><input id="mopsAutoTemp" class="field-input" type="number" min="5" value="${num(data().automation.tempTolerance)}"></label><label><span>Revisar bridge (seg)</span><input id="mopsBridgeInterval" class="field-input" type="number" min="30" value="${num(data().automation.bridgeIntervalSeconds)}"></label><label><span>Electricidad (CLP/kWh)</span><input id="mopsCostElectricity" class="field-input" type="number" min="0" value="${num(data().costConfig.electricityClpKwh)}"></label><label><span>Consumo impresora (kW)</span><input id="mopsCostKw" class="field-input" type="number" min="0" step="0.01" value="${num(data().costConfig.machineKw)}"></label><label><span>Mano de obra (CLP/h)</span><input id="mopsCostLabor" class="field-input" type="number" min="0" value="${num(data().costConfig.laborClpHour)}"></label><label><span>Operador por trabajo (min)</span><input id="mopsCostOperator" class="field-input" type="number" min="0" value="${num(data().costConfig.operatorMinutes)}"></label><label><span>Desgaste máquina (CLP/h)</span><input id="mopsCostWear" class="field-input" type="number" min="0" value="${num(data().costConfig.wearClpHour)}"></label><label><span>Recargo falla (%)</span><input id="mopsCostFailure" class="field-input" type="number" min="0" max="100" value="${num(data().costConfig.failureOverheadPct)}"></label></div></section>`;
}

function statusBadge(status){
  const m=JOB_META[status]||JOB_META.pendiente;
  return`<span class="mops-status" style="color:${m.color};background:${m.color}14">${esc(m.label)}</span>`;
}
function kpi(label,value,sub='',color='var(--text)'){
  return`<div class="mops-kpi"><div class="mops-kpi-label">${esc(label)}</div><div class="mops-kpi-value" style="color:${color}">${value}</div><div class="mops-kpi-sub">${esc(sub)}</div></div>`;
}
function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
// Tres pantallas, una pregunta cada una: ¿qué hago ahora? ¿cómo va cada pieza?
// ¿con qué cuento? Las 12 áreas siguen existiendo como secciones apiladas; lo
// que se elimina es tener que elegir entre doce pestañas para responder una.
// El orden real de apilado lo da el DOM en index.html, no este array.
const VIEW_GROUPS={
  hoy:['inteligencia','operacion'],
  trabajos:['planificacion','calidad','postproduccion'],
  taller:['capacidad','perfiles','laminado','materiales','mantenimiento','seguridad','analitica','automatizacion'],
};
const WORKSHOP_CORE=['materiales','mantenimiento','seguridad','capacidad'];
const WORKSHOP_ADVANCED=['perfiles','laminado','analitica','automatizacion'];
const VIEW_TITLES={
  inteligencia:'🧠 Alertas',operacion:'📡 Máquinas',
  planificacion:'🗓 Planificación',calidad:'✅ Calidad',postproduccion:'🧩 Postproducción',
  capacidad:'🧮 Capacidad',perfiles:'🎛 Perfiles',laminado:'🖨 Laminado',materiales:'🧵 Materiales',
  mantenimiento:'🔧 Mantenimiento',seguridad:'🛡 Seguridad',analitica:'📊 Analítica',automatizacion:'⚙ Automatización',
};
// Los enlaces guardados, el localStorage y las llamadas internas siguen usando
// los nombres de área antiguos ('planificacion', 'materiales'…). Se resuelven a
// su pantalla para que ningún atajo ni QR existente se rompa.
function groupOf(view){
  if(VIEW_GROUPS[view])return view;
  return Object.keys(VIEW_GROUPS).find(g=>VIEW_GROUPS[g].includes(view))||'hoy';
}
function goToSection(view){
  if(!VIEW_TITLES[view])return;
  const el=document.querySelector(`[data-maq-view="${view}"]`);
  if(!el||typeof el.scrollIntoView!=='function')return;
  try{el.scrollIntoView({behavior:'smooth',block:'start'});}catch(_){el.scrollIntoView();}
}
function renderSectionIndex(group){
  const el=document.getElementById('maqSectionIndex');if(!el)return;
  if(group==='taller'){el.innerHTML='';el.style.display='none';return;}
  el.style.display='';
  const members=VIEW_GROUPS[group]||[];
  el.innerHTML=members.length<2?'':members.map(v=>`<button type="button" onclick="MachineOps.goToSection('${v}')">${esc(VIEW_TITLES[v]||v)}</button>`).join('');
}
function ensureWorkshopShell(){
  let el=document.getElementById('mopsWorkshopHome');if(el)return el;
  const anchor=document.getElementById('maquinaCapacityView');if(!anchor)return null;
  el=document.createElement('section');el.id='mopsWorkshopHome';el.className='mops-workshop-home';anchor.parentNode.insertBefore(el,anchor);
  const capSub=anchor.querySelector('.maq-view-sub');if(capSub)capSub.textContent='Simula un escenario usando tiempos técnicos ingresados, carga actual y telemetría reciente. No es una promesa automática de entrega.';
  const legacy=document.getElementById('analyticsContent');
  if(legacy&&!legacy.closest('.mops-workshop-legacy-analytics')){
    const d=document.createElement('details');d.className='mops-workshop-legacy-analytics mops-advanced-details';
    const s=document.createElement('summary');s.textContent='Historial técnico heredado · gráficos de cierres de impresión';d.appendChild(s);
    legacy.parentNode.insertBefore(d,legacy);d.appendChild(legacy);
  }
  return el;
}
function workshopHistoryEvidence(now=Date.now()){
  let s={};try{s=window.PrinterHistory?.status?.()||{};}catch(_){}
  const lastSync=num(s.lastSync),durable=s.mode==='durable',fresh=durable&&!!lastSync&&now-lastSync<120000;
  return{mode:s.mode||'unknown',durable,fresh,lastSync,lastError:String(s.lastError||''),serverHistoryCount:num(s.serverHistoryCount)};
}
function workshopSummary(now=Date.now()){
  const spools=data().spools.filter(s=>!s.archived),stockFree=spools.reduce((sum,s)=>sum+spoolAvailable(s),0),stockRegistered=spools.reduce((sum,s)=>sum+num(s.remaining),0);
  const lowStock=spools.filter(s=>s.status!=='agotado'&&spoolAvailable(s)<Math.min(250,num(s.initial)*.2)).length;
  let maintSoon=0,maintOverdue=0,maintUnknown=0;
  try{(MAQUINAS||[]).forEach(m=>{const rows=getMaintAlerts(m)||[];rows.forEach(a=>{if(a.verified===false)maintUnknown++;else if(a.hours>=a.threshold)maintOverdue++;else maintSoon++;});});}catch(_){}
  const reading=latestSafetyReading(),safety=safetyDecision(data().safetyConfig,reading,{unattended:true,cameraConfigured:true},now);
  const safetyAge=reading?Math.max(0,Math.round((now-Date.parse(reading.at||0))/60000)):null;
  const profiles=latestProfiles(),readyProfiles=profiles.filter(p=>p.status==='approved'&&profileProductionCheck(p).ok).length,invalidApproved=profiles.filter(p=>p.status==='approved'&&!profileProductionCheck(p).ok).length;
  const history=workshopHistoryEvidence(now);
  const maintRecords=(()=>{try{return getMaintLog().length;}catch(_){return 0;}})();
  return{spools:spools.length,stockFree,stockRegistered,lowStock,maintSoon,maintOverdue,maintUnknown,maintRecords,reading,safety,safetyAge,profiles:profiles.length,readyProfiles,invalidApproved,history};
}
const WORKSHOP_CARD_META={
  materiales:{icon:'spool',accent:'cyan'},
  mantenimiento:{icon:'wrench',accent:'amber'},
  seguridad:{icon:'shield',accent:'red'},
  capacidad:{icon:'capacity',accent:'violet'},
  perfiles:{icon:'sliders',accent:'cyan'},
  laminado:{icon:'printer',accent:'violet'},
  analitica:{icon:'chart',accent:'green'},
  automatizacion:{icon:'gear',accent:'slate'},
};
function workshopIcon(name){
  const paths={
    spool:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/><path d="M4 12h5m6 0h5M7 6.4l3.1 3.1m3.8 3.8L17 16.4M17 7.6l-3.1 3.1m-3.8 3.8L7 17.6"/>',
    wrench:'<path d="M14.7 6.3a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5 5l7.1 7.1a2 2 0 1 1-2.8 2.8L10 12.8"/><circle cx="17.8" cy="17.8" r=".7"/>',
    shield:'<path d="M12 2.5 19 5v5.7c0 4.6-2.9 8.5-7 10.8-4.1-2.3-7-6.2-7-10.8V5l7-2.5Z"/><path d="m8.8 12 2 2 4.4-4.4"/>',
    capacity:'<rect x="3" y="14" width="4" height="6" rx="1"/><rect x="10" y="9" width="4" height="11" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/><path d="M4 10.5 10 5l4 2.2 6-5"/>',
    sliders:'<path d="M4 6h7m4 0h5M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
    printer:'<rect x="5" y="3" width="14" height="5" rx="1.5"/><path d="M7 8v5h10V8M9 13v3h6v-3M7 21h10M12 16v5"/><path d="M9 6h6"/>',
    chart:'<path d="M4 20V10m5 10V5m5 15v-7m5 7V3"/><path d="m4 8 5-3 5 5 5-7"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2.1-.7a7.1 7.1 0 0 0-.7-1.7l1-2-2.2-2.2-2 1a7.1 7.1 0 0 0-1.7-.7L10.5 2h-3l-.7 2.1a7.1 7.1 0 0 0-1.7.7l-2-1L.9 6l1 2a7.1 7.1 0 0 0-.7 1.7L-1 10.5v3l2.1.7a7.1 7.1 0 0 0 .7 1.7l-1 2L3 20.1l2-1a7.1 7.1 0 0 0 1.7.7l.8 2.2h3l.7-2.1a7.1 7.1 0 0 0 1.7-.7l2 1 2.2-2.2-1-2a7.1 7.1 0 0 0 .7-1.7L19 13.5Z" transform="translate(3 0) scale(.75)"/>'
  };
  return`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.gear}</svg>`;
}
function workshopNavCard(view,title,subtitle,value,tone='neutral'){
  const meta=WORKSHOP_CARD_META[view]||{icon:'gear',accent:'slate'},active=_activeWorkshopView===view?' active':'';
  return`<button class="mops-workshop-tile ${tone} accent-${meta.accent}${active}" type="button" onclick="MachineOps.showView('${view}')" aria-label="${esc(title)}">
    <span class="mops-workshop-tile-icon">${workshopIcon(meta.icon)}</span>
    <span class="mops-workshop-tile-body">
      <span class="mops-workshop-tile-head"><b>${esc(title)}</b><i aria-hidden="true">→</i></span>
      <strong>${esc(String(value))}</strong>
      <small>${esc(subtitle)}</small>
    </span>
  </button>`;
}
function renderWorkshopHome(){
  const el=ensureWorkshopShell();if(!el)return;const s=workshopSummary();
  const histTone=s.history.fresh?'ok':s.history.mode==='local-fallback'?'warning':'danger';
  const histLabel=s.history.fresh?'Durable y reciente':s.history.mode==='local-fallback'?'Solo caché local':'Sin confirmar';
  const safetyState=!s.reading?'Sin lectura':!s.safety.fresh?'Lectura vencida':s.safety.blockers.length?'Bloqueado':s.safety.warnings.length?'Revisar':'OK';
  const safetyTone=s.safety.blockers.length?'danger':(!s.reading||!s.safety.fresh||s.safety.warnings.length?'warning':'ok');
  const maintActions=s.maintOverdue+s.maintSoon+s.maintUnknown;
  el.innerHTML=`<div class="mops-workshop-hero">
      <div><span class="mops-workshop-eyebrow">TALLER · FUENTES DE VERDAD</span><h3>Estado físico y configuración de la granja</h3><p>Primero ves qué requiere acción y qué datos son confirmados, registrados o estimados. Abre un módulo sólo cuando lo necesites.</p></div>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.syncNow()">☁ Sincronizar MachineOps</button>
    </div>
    <div class="mops-workshop-trust">
      <span class="${histTone}"><b>HISTORIAL DE IMPRESIÓN</b><strong>${histLabel}</strong><small>${s.history.lastSync?'sync '+esc(fmtStamp(s.history.lastSync)):'sin sincronización central'}${s.history.lastError?' · '+esc(s.history.lastError):''}</small></span>
      <span class="warning"><b>MATERIALES</b><strong>Inventario registrado</strong><small>${(s.stockRegistered/1000).toFixed(2)} kg declarados · sin balanza física</small></span>
      <span class="${safetyTone}"><b>SEGURIDAD AMBIENTAL</b><strong>${esc(safetyState)}</strong><small>${s.reading?esc(s.reading.source||'registro')+' · hace '+s.safetyAge+' min':'sin sensor/lectura manual vigente'}</small></span>
      <span class="${s.maintRecords?'ok':'warning'}"><b>MANTENCIÓN</b><strong>${s.maintRecords?s.maintRecords+' registros':'Sin historial registrado'}</strong><small>umbrales por horas · depende del historial de impresión</small></span>
    </div>
    <div class="mops-workshop-kpis">
      <article class="${s.maintOverdue?'danger':maintActions?'warning':'ok'}"><small>MANTENCIÓN</small><b>${s.maintOverdue}</b><span>vencidas verificadas · ${s.maintSoon} próximas · ${s.maintUnknown} sin base registrada</span></article>
      <article class="${s.lowStock?'warning':'ok'}"><small>MATERIAL LIBRE</small><b>${(s.stockFree/1000).toFixed(2)} kg</b><span>${s.lowStock} rollo(s) bajo mínimo registrado</span></article>
      <article class="${safetyTone}"><small>AMBIENTE</small><b>${esc(safetyState)}</b><span>cámara se valida por impresora en preflight</span></article>
      <article class="${s.invalidApproved?'warning':s.readyProfiles?'ok':'neutral'}"><small>PERFILES LISTOS</small><b>${s.readyProfiles}/${s.profiles}</b><span>${s.invalidApproved} aprobado(s) incompleto(s)</span></article>
    </div>
    <div class="mops-workshop-section-title"><div><b>Operación física</b><small>Lo que normalmente revisas en el taller.</small></div></div>
    <div class="mops-workshop-nav-grid">
      ${workshopNavCard('materiales','Materiales','Stock registrado, reservas y rollos bajos',s.lowStock?s.lowStock+' bajo stock':(s.stockFree/1000).toFixed(2)+' kg libres',s.lowStock?'warning':'ok')}
      ${workshopNavCard('mantenimiento','Mantención','Horas, registros y próximos servicios',maintActions?maintActions+' por revisar':'sin alertas',maintActions?'warning':'ok')}
      ${workshopNavCard('seguridad','Seguridad','Sensor/lectura manual y reglas de preflight',safetyState,safetyTone)}
      ${workshopNavCard('capacidad','Capacidad','Simulador de escenario; no promesa automática','Simular','neutral')}
    </div>
    <div class="mops-workshop-section-title"><div><b>Herramientas avanzadas</b><small>Configuración y análisis; no necesitas tenerlas abiertas todo el tiempo.</small></div></div>
    <div class="mops-workshop-nav-grid advanced">
      ${workshopNavCard('perfiles','Perfiles','Versiones controladas y aprobación humana',s.readyProfiles+' listos',s.invalidApproved?'warning':'neutral')}
      ${workshopNavCard('laminado','Laminador','Agente 3D, G-code y preflight','Abrir','neutral')}
      ${workshopNavCard('analitica','Analítica','QA, tiempos reales y costos modelados','Abrir','neutral')}
      ${workshopNavCard('automatizacion','Configuración','Umbrales, automatización y costos','Avanzado','neutral')}
    </div>
    <div class="mops-workshop-legend"><span><i class="ok"></i><b>Confirmado</b> sensor/controller reciente</span><span><i class="warning"></i><b>Registrado</b> dato ingresado/sincronizado</span><span><i></i><b>Estimado</b> simulación o modelo de costo</span></div>`;
}
function showView(view,button){
  const target=view||'hoy',group=groupOf(target);_activeView=group;
  if(group==='taller')_activeWorkshopView=target;else _activeWorkshopView='taller';
  const members=VIEW_GROUPS[group]||[];
  ensureWorkshopShell();
  document.querySelectorAll('[data-maq-view]').forEach(node=>{
    const v=node.dataset.maqView;
    if(group==='taller'&&members.includes(v))node.style.display=(target!=='taller'&&v===target)?'':'none';
    else node.style.display=members.includes(v)?'':'none';
  });
  const home=document.getElementById('mopsWorkshopHome');if(home)home.style.display=group==='taller'?'':'none';
  document.querySelectorAll('[data-maq-nav]').forEach(b=>b.classList.toggle('active',b.dataset.maqNav===group));
  if(button)button.classList.add('active');
  localStorage.setItem('machine_ops_view',group);renderSectionIndex(group);renderAll();
  if(group==='taller'&&target!=='taller')goToSection(target);
  else if(target!==group)goToSection(target);
}

function renderOpsOverview(){
  const el=document.getElementById('maquinaOpsOverview');if(!el)return;
  const jobs=activeJobs(),qa=jobs.filter(j=>j.status==='qa').length,unassigned=jobs.filter(j=>!j.machineId).length;
  const printingLive=(MAQUINAS||[]).filter(m=>liveState(m.id)==='printing').length;
  const trusted=(MAQUINAS||[]).filter(m=>{
    const s=typeof _printerStatus!=='undefined'?_printerStatus[m.id]||{}:{};
    return !!s.lastSeenAt&&Date.now()-num(s.lastSeenAt)<60000&&!['connecting','unknown'].includes(String(s.state||''));
  }).length;
  el.innerHTML=`<div class="mops-kpis mops-kpis-trust">
    ${kpi('Imprimiendo ahora',printingLive,'telemetría en vivo',printingLive?'var(--accent)':'var(--text)')}
    ${kpi('Trabajos abiertos',jobs.length,'planificados o en proceso')}
    ${kpi('Esperando QA',qa,'requieren revisión',qa?'var(--warn)':'var(--accent3)')}
    ${kpi('Sin máquina',unassigned,'pendientes de asignar',unassigned?'var(--danger)':'var(--accent3)')}
    ${kpi('Carga pendiente',fmtMin(jobs.reduce((s,j)=>s+jobMinutes(j),0)),'estimación de trabajos abiertos')}
    ${kpi('Telemetría reciente',trusted+'/'+(MAQUINAS||[]).length,'lectura física < 60 s',trusted===(MAQUINAS||[]).length?'var(--accent3)':'var(--warn)')}
  </div>`;
}

function planningJobState(job,now=Date.now()){
  const machine=job.machineId?getMachine(job.machineId):null,live=machine?liveEvidence(machine.id,now):{state:'',fresh:false,known:false,live:{}};
  const farm=farmQueueEvidence(now),farmJob=farmQueueMatch(job,farm);
  const late=!!job.dueDate&&dateValue(job.dueDate)<now;
  const missing=[];
  if(!job.machineId)missing.push('máquina');
  if(!job.gcodeFile)missing.push('archivo G-code');
  if(num(job.grams)>0&&!job.spoolId)missing.push('rollo reservado');
  let level='info',label='Revisar trabajo',detail='Comprueba la configuración antes de continuar.';
  if(job.status==='imprimiendo'){
    if(live.known&&live.state==='printing'){level='ok';label='Impresión confirmada';detail='Moonraker reporta este equipo imprimiendo ahora.';}
    else{level='warning';label='Verificar impresión';detail='El trabajo figura imprimiendo, pero la telemetría reciente no lo confirma.';}
  }else if(job.status==='qa'){level='warning';label='Realizar QA';detail='La impresión terminó y necesita revisión antes de cerrar.';}
  else if(job.status==='en_cola'){
    if(!job.machineId||!job.gcodeFile){level='danger';label='Completar preparación';detail=`Falta ${missing.filter(x=>x!=='rollo reservado').join(' y ')||'información crítica'} antes de iniciar.`;}
    else if(!live.known){level='warning';label='Recuperar telemetría';detail='No se iniciará automáticamente: primero confirma un estado reciente de la impresora.';}
    else if(['printing','paused'].includes(live.state)){level='info';label='Esperar máquina libre';detail=`La impresora está ${live.state==='paused'?'pausada':'ocupada'}; el trabajo permanece solo planificado.`;}
    else{level='ok';label='Revisar preflight e iniciar';detail='Máquina y archivo definidos. El preflight volverá a validar seguridad, material y mantención.';}
  }else if(['pendiente','planificado'].includes(job.status)){
    if(!job.machineId){level='warning';label='Asignar máquina';detail='La planificación automática solo usará impresoras con telemetría reciente y compatibilidad confirmada.';}
    else if(!job.gcodeFile){level='warning';label='Indicar archivo G-code';detail='El dashboard necesita saber qué archivo existente debe iniciar en Moonraker.';}
    else if(!live.known){level='warning';label='Validar telemetría';detail='La máquina está asignada, pero su estado actual no está confirmado.';}
    else{level='info';label='Preparar para iniciar';detail='La ficha está completa. Al preparar, seguirá siendo planificación del dashboard hasta iniciar o confirmar cola durable.';}
  }else if(job.status==='terminado'){level='ok';label='Trabajo terminado';detail='Cierre registrado.';}
  else if(job.status==='fallido'){level='danger';label='Revisar falla';detail='Revisa incidente, desperdicio y eventual reimpresión.';}
  return{machine,live,farm,farmJob,late,missing,next:{level,label,detail}};
}
function planningBadge(label,level='neutral'){
  return`<span class="mops-plan-badge ${level}">${esc(label)}</span>`;
}
function planningJobCard(j){
  const p=planningJobState(j),cycles=Math.max(1,num(j.cycles,1)),produced=num(j.completedCycles);
  const order=orderLabel(j.pedidoId),machine=j.machineId?machineLabel(j.machineId):'Sin máquina';
  const liveLabel=!j.machineId?'Sin máquina':p.live.known?`Telemetría: ${p.live.state}`:'Telemetría sin confirmar';
  const evidence=[
    planningBadge(order?'Pedido vinculado':'Sin pedido',order?'ok':'neutral'),
    planningBadge(liveLabel,p.live.known?'ok':j.machineId?'warning':'neutral'),
  ];
  if(j.status==='en_cola')evidence.push(p.farmJob?planningBadge('Controller confirmado','ok'):planningBadge(p.farm.fresh?'Solo plan dashboard':'Controller sin confirmar',p.farm.fresh?'warning':'neutral'));
  if(num(j.grams)>0)evidence.push(planningBadge(j.spoolId?'Rollo reservado':'Sin rollo reservado',j.spoolId?'ok':'warning'));
  const actions=[
    `<button class="btn btn-ghost btn-sm" onclick="MachineOps.openJob('${j.id}')">Editar</button>`,
    !j.machineId?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.planOne('${j.id}')">Asignar</button>`:'',
    ['pendiente','planificado'].includes(j.status)?`<button class="btn btn-primary btn-sm" onclick="MachineOps.enqueueJob('${j.id}')">Preparar</button>`:'',
    j.status==='en_cola'?`<button class="btn btn-primary btn-sm" onclick="MachineOps.startJob('${j.id}')">Revisar e iniciar</button>`:'',
    j.status==='qa'?`<button class="btn btn-primary btn-sm" onclick="MachineOps.openQA('${j.id}')">Abrir QA</button>`:'',
    `<button class="btn btn-ghost btn-sm" onclick="MachineOps.printEntityLabel('job','${j.id}')">QR</button>`,
    `<button class="btn btn-ghost btn-sm" onclick="MachineOps.archiveJob('${j.id}')">Archivar</button>`,
  ].join('');
  return`<article class="mops-job-card ${p.next.level}">
    <div class="mops-job-card-head"><div><b>${esc(j.name)}</b><small>${esc(order||'Sin pedido')}${j.dueDate?' · entrega '+esc(j.dueDate):''}${p.late?' · ATRASADO':''}</small></div>${statusBadge(j.status)}</div>
    <div class="mops-job-card-grid">
      <span><small>Máquina</small><b>${esc(machine)}</b></span>
      <span><small>Producción</small><b>${num(j.qty,1)} u · ${produced}/${cycles} ciclos</b></span>
      <span><small>Material</small><b>${esc(j.material||'—')} ${esc(j.color||'')} · ${Math.round(num(j.grams))} g</b></span>
      <span><small>Duración estimada</small><b>${fmtMin(jobMinutes(j))}</b></span>
    </div>
    <div class="mops-job-next ${p.next.level}"><span>PRÓXIMO PASO</span><b>${esc(p.next.label)}</b><small>${esc(p.next.detail)}</small></div>
    <div class="mops-job-evidence">${evidence.join('')}</div>
    <div class="mops-job-card-actions">${actions}</div>
  </article>`;
}
function renderPlanning(){
  const summary=document.getElementById('mopsPlanningSummary'),list=document.getElementById('mopsJobs');
  if(!summary||!list)return;
  const all=data().jobs.filter(j=>!j.archived),active=all.filter(j=>ACTIVE_JOB_STATES.includes(j.status));
  const farm=farmQueueEvidence(),printing=(MAQUINAS||[]).filter(m=>liveEvidence(m.id).known&&liveState(m.id)==='printing').length;
  const telemetry=(MAQUINAS||[]).filter(m=>liveEvidence(m.id).known).length;
  const prepared=active.filter(j=>j.status==='en_cola').length,qa=active.filter(j=>j.status==='qa').length;
  const needsPrep=active.filter(j=>['pendiente','planificado'].includes(j.status)&&(!j.machineId||!j.gcodeFile)).length;
  const durable=farm.fresh?farm.jobs.filter(j=>['queued','retry','checking','uploading','uploaded'].includes(String(j.state||''))).length:null;
  const dueSoon=active.filter(j=>j.dueDate&&(dateValue(j.dueDate)-Date.now())<3*86400000).length;
  const statusSelect=document.getElementById('mopsJobStatus'),queueOption=statusSelect?.querySelector('option[value="en_cola"]');if(queueOption)queueOption.textContent='Lista para iniciar';
  summary.innerHTML=`<div class="mops-planning-guide">
      <div><b>Centro de planificación confiable</b><small>Separamos lo que está guardado, lo que confirma la telemetría y lo que realmente existe en la cola de ejecución.</small></div>
      <div class="mops-planning-trust">
        <span><b>TRABAJOS</b><small>MachineOps + respaldo remoto</small></span>
        <span class="${telemetry===(MAQUINAS||[]).length?'ok':'warning'}"><b>TIEMPO REAL</b><small>${telemetry}/${(MAQUINAS||[]).length} impresoras con lectura &lt; 60 s</small></span>
        <span class="${farm.fresh?'ok':'warning'}"><b>CONTROLLER</b><small>${farm.fresh?`${durable} trabajo(s) en cola durable`:'cola durable sin confirmación reciente'}</small></span>
      </div>
      <div class="mops-planning-rule">Planificación del dashboard ≠ cola de ejecución. Solo “Controller confirmado” significa que existe un trabajo durable en el Farm Controller.</div>
    </div>
    <div class="mops-kpis mops-planning-kpis">
      ${kpi('Imprimiendo ahora',printing,'confirmado por telemetría',printing?'var(--accent)':'var(--text)')}
      ${kpi('Por preparar',needsPrep,'faltan máquina o G-code',needsPrep?'var(--warn)':'var(--accent3)')}
      ${kpi('Listos para iniciar',prepared,'requieren preflight')}
      ${kpi('Esperando QA',qa,'requieren revisión',qa?'var(--warn)':'var(--accent3)')}
      ${kpi('Entrega ≤ 3 días',dueSoon,'trabajos abiertos',dueSoon?'var(--warn)':'var(--accent3)')}
    </div>`;
  renderGantt();
  const q=(document.getElementById('mopsJobSearch')?.value||'').trim().toLowerCase(),st=statusSelect?.value||'';
  const rows=all.filter(j=>(!st||j.status===st)&&(!q||[j.name,j.material,j.color,j.gcodeFile,orderLabel(j.pedidoId),machineLabel(j.machineId)].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>dueUrgency(a)-dueUrgency(b)||Date.parse(a.createdAt||0)-Date.parse(b.createdAt||0));
  const openRows=rows.filter(j=>ACTIVE_JOB_STATES.includes(j.status)),closedRows=rows.filter(j=>!ACTIVE_JOB_STATES.includes(j.status));
  if(!rows.length){list.innerHTML='<div class="empty-state" style="padding:24px">No hay trabajos que coincidan con los filtros.</div>';return;}
  const showClosed=!!q||!!st;
  list.innerHTML=`<div class="mops-job-board-head"><div><b>Trabajos activos</b><small>Ordenados por prioridad y fecha de entrega. Cada tarjeta muestra su próximo paso y la evidencia disponible.</small></div><span>${openRows.length} activo(s)</span></div>
    <div class="mops-job-board">${openRows.length?openRows.map(planningJobCard).join(''):'<div class="mops-intel-empty">✓ No hay trabajos activos.</div>'}</div>
    ${closedRows.length?(showClosed?`<div class="mops-job-board mops-job-history-grid">${closedRows.map(planningJobCard).join('')}</div>`:`<details class="mops-job-history"><summary>Historial cerrado · ${closedRows.length}</summary><div class="mops-job-board mops-job-history-grid">${closedRows.sort((a,b)=>Date.parse(b.completedAt||b.updatedAt||0)-Date.parse(a.completedAt||a.updatedAt||0)).slice(0,20).map(planningJobCard).join('')}</div></details>`):''}`;
}
function ganttFamily(model=''){
  const m=String(model||'').toLowerCase();
  if(m.includes('ender'))return'Ender-5 Max';
  if(m.includes('k2 plus'))return'K2 Plus';
  if(m.includes('k2'))return'K2';
  if(m.includes('k1'))return'K1';
  if(m.includes('giga'))return'Giga';
  return'Otras';
}
function ganttRowData(m,farm){
  const jobs=jobsForMachine(m.id).sort((a,b)=>num(a.position)-num(b.position)||dueUrgency(a)-dueUrgency(b));
  const total=jobs.reduce((s,j)=>s+jobMinutes(j),0),live=liveEvidence(m.id),durable=farm.fresh?num(farm.counts?.[m.id]):null;
  return{m,jobs,total,live,durable,family:ganttFamily(m.modelo),loaded:jobs.length>0};
}
function setGanttFilter(value){
  _ganttFilter=['carga','todas','sin-telemetria'].includes(value)?value:'carga';
  renderGantt();
}
function setGanttFamily(value){
  _ganttFamily=value||'todas';
  renderGantt();
}
function ganttStatusChip(row){
  const tele=row.live.known
    ? `<span class="mops-plan-chip ok">● ${esc(row.live.state||'telemetría')}</span>`
    : '<span class="mops-plan-chip warning">○ Sin telemetría</span>';
  const controller=row.durable===null
    ? '<span class="mops-plan-chip muted">△ Controller sin confirmar</span>'
    : `<span class="mops-plan-chip ${row.durable?'ok':'muted'}">${row.durable?'✓':'○'} ${row.durable} durable(s)</span>`;
  const count=`<span class="mops-plan-chip neutral">${row.jobs.length} trabajo(s)</span>`;
  const time=row.total?`<span class="mops-plan-chip neutral">~ ${fmtMin(row.total)}</span>`:'';
  return tele+controller+count+time;
}
function ganttMachineCard(row){
  const {m,jobs,total,live}=row;
  const accent=cssColor(m.color||'#39d5ff');
  const blocks=jobs.map(j=>{
    const mins=Math.max(1,jobMinutes(j)),status=JOB_META[j.status]?.label||j.status||'Planificado';
    return`<button type="button" class="mops-plan-job" onclick="MachineOps.openJob('${j.id}')" title="${esc(j.name)} · ${fmtMin(mins)} · ${esc(j.material||'sin material')}" style="--job-flex:${mins};--machine-accent:${accent}">
      <span class="mops-plan-job-name">${esc(j.name)}</span>
      <span class="mops-plan-job-meta">${esc(j.material||'—')} · ${fmtMin(mins)} · ${esc(status)}</span>
    </button>`;
  }).join('');
  return`<article class="mops-plan-machine ${live.known?'trusted':'untrusted'}" style="--machine-accent:${accent}">
    <div class="mops-plan-machine-head">
      <div class="mops-plan-machine-title"><i></i><span><b>${esc(m.nombre)} #${m.numG}</b><small>${esc(m.modelo||row.family)}</small></span></div>
      <div class="mops-plan-machine-total"><b>${fmtMin(total)}</b><small>carga estimada</small></div>
    </div>
    <div class="mops-plan-chips">${ganttStatusChip(row)}</div>
    <div class="mops-plan-track">${blocks}</div>
  </article>`;
}
function ganttIdleChip(row){
  const m=row.m,accent=cssColor(m.color||'#64748b');
  return`<div class="mops-plan-idle-chip" style="--machine-accent:${accent}">
    <i></i><span><b>${esc(m.nombre)} #${m.numG}</b><small>${esc(m.modelo||row.family)} · ${row.live.known?esc(row.live.state):'sin telemetría'}</small></span>
  </div>`;
}
function renderGantt(){
  const el=document.getElementById('mopsGantt');if(!el)return;
  const farm=farmQueueEvidence(),all=(MAQUINAS||[]).map(m=>ganttRowData(m,farm));
  const loaded=all.filter(r=>r.loaded),idle=all.filter(r=>!r.loaded),telemetry=all.filter(r=>r.live.known).length;
  const totalMinutes=loaded.reduce((s,r)=>s+r.total,0),durable=farm.fresh?all.reduce((s,r)=>s+num(r.durable),0):null;
  const families=['todas',...MODELS.filter(x=>all.some(r=>r.family===x)),...(all.some(r=>r.family==='Otras')?['Otras']:[])];
  const familyFiltered=all.filter(r=>_ganttFamily==='todas'||r.family===_ganttFamily);
  let visible=familyFiltered;
  if(_ganttFilter==='carga')visible=familyFiltered.filter(r=>r.loaded);
  else if(_ganttFilter==='sin-telemetria')visible=familyFiltered.filter(r=>!r.live.known);
  const visibleLoaded=visible.filter(r=>r.loaded),visibleIdle=visible.filter(r=>!r.loaded);
  const grouped=MODELS.concat('Otras').filter(f=>visibleLoaded.some(r=>r.family===f)).map(f=>{
    const rows=visibleLoaded.filter(r=>r.family===f);
    return`<section class="mops-plan-family"><div class="mops-plan-family-head"><b>${esc(f)}</b><span>${rows.length} con carga</span></div><div class="mops-plan-machine-grid">${rows.map(ganttMachineCard).join('')}</div></section>`;
  }).join('');
  const familyOptions=families.map(f=>`<option value="${esc(f)}"${_ganttFamily===f?' selected':''}>${f==='todas'?'Todas las familias':esc(f)}</option>`).join('');
  const idleBlock=visibleIdle.length?`<details class="mops-plan-idle"${_ganttFilter==='todas'?' open':''}><summary>Ver ${visibleIdle.length} impresora(s) sin trabajos planificados</summary><div class="mops-plan-idle-grid">${visibleIdle.map(ganttIdleChip).join('')}</div></details>`:'';
  el.innerHTML=`<div class="mops-gantt-head mops-plan-head">
      <div><b>Plan estimado por impresora</b><small>Primero mostramos las impresoras con carga. Las vacías quedan plegadas. Esto es planificación; sólo el Controller confirma una cola durable real.</small></div>
      <div class="mops-plan-head-actions">
        <div class="mops-plan-filters" role="group" aria-label="Filtro de planificación">
          <button type="button" class="${_ganttFilter==='carga'?'active':''}" onclick="MachineOps.setGanttFilter('carga')">Con carga <span>${loaded.length}</span></button>
          <button type="button" class="${_ganttFilter==='todas'?'active':''}" onclick="MachineOps.setGanttFilter('todas')">Todas <span>${all.length}</span></button>
          <button type="button" class="${_ganttFilter==='sin-telemetria'?'active':''}" onclick="MachineOps.setGanttFilter('sin-telemetria')">Sin telemetría <span>${all.length-telemetry}</span></button>
        </div>
        <select class="mops-plan-family-select" onchange="MachineOps.setGanttFamily(this.value)">${familyOptions}</select>
      </div>
    </div>
    <div class="mops-plan-summary">
      <span><small>CON CARGA</small><b>${loaded.length}</b><em>de ${all.length}</em></span>
      <span><small>HORAS PLANIFICADAS</small><b>${fmtMin(totalMinutes)}</b><em>estimación acumulada</em></span>
      <span class="${telemetry===all.length?'ok':'warning'}"><small>TELEMETRÍA RECIENTE</small><b>${telemetry}/${all.length}</b><em>lectura &lt; 60 s</em></span>
      <span class="${farm.fresh?'ok':'warning'}"><small>CONTROLLER</small><b>${durable===null?'—':durable}</b><em>${farm.fresh?'trabajos durables':'sin confirmación reciente'}</em></span>
    </div>
    <div class="mops-plan-legend"><span><i class="ok"></i>telemetría reciente</span><span><i class="warning"></i>dato sin confirmar</span><span><i></i>duración estimada de MachineOps</span></div>
    ${visibleLoaded.length?grouped:'<div class="mops-intel-empty">No hay impresoras con trabajos para este filtro.</div>'}
    ${idleBlock}`;
}

function orderLabel(id){
  if(!id)return'';
  try{const p=state.pedidosById?.[id];return p?.fields?.['N° Pedido']||p?.fields?.['Descripción del pedido']||id;}catch(_){return id;}
}
function activeOrders(){
  try{return (state.pedidos||[]).filter(p=>!['Despachado','Completado','Cancelado','Listo para despacho'].includes(p.fields?.['Estado pedido']||''));}catch(_){return[];}
}
function fillJobSelects(job={}){
  const ped=document.getElementById('mopsJobPedido');
  if(ped)ped.innerHTML='<option value="">— sin pedido —</option>'+activeOrders().map(p=>`<option value="${p.id}"${job.pedidoId===p.id?' selected':''}>${esc(p.fields['N° Pedido']||'—')} · ${esc(resolveClienteName(p.fields['Cliente']))}</option>`).join('');
  const machine=document.getElementById('mopsJobMachine');
  if(machine)machine.innerHTML='<option value="">— planificar automáticamente —</option>'+(MAQUINAS||[]).map(m=>`<option value="${m.id}"${job.machineId===m.id?' selected':''}>${esc(m.nombre)} #${m.numG} · ${esc(liveState(m.id)||'sin datos')}</option>`).join('');
  const spool=document.getElementById('mopsJobSpool');
  if(spool)spool.innerHTML='<option value="">— sin rollo reservado —</option>'+data().spools.filter(s=>!s.archived&&s.status!=='agotado').map(s=>`<option value="${s.id}"${job.spoolId===s.id?' selected':''}>${esc(s.name)} · ${esc(s.material)} ${esc(s.color)} · ${Math.round(spoolAvailable(s))}g libres</option>`).join('');
  const profile=document.getElementById('mopsJobProfile');
  if(profile){const choices=latestProfiles().filter(p=>!p.archived&&p.status!=='deprecated'),current=data().profiles.find(p=>p.id===job.profileId);if(current&&!choices.some(p=>p.id===current.id))choices.unshift(current);profile.innerHTML='<option value="">— sin perfil controlado —</option>'+choices.map(p=>`<option value="${p.id}"${job.profileId===p.id?' selected':''}>${esc(p.name)} v${num(p.version,1)} · ${esc(p.model)} ${esc(p.material)} ${esc(p.nozzle)}mm · ${esc(p.status)}</option>`).join('');}
  const models=document.getElementById('mopsJobModels');
  const selected=new Set(job.compatibleModels||[]);
  if(models)models.innerHTML=MODELS.map(m=>`<label><input type="checkbox" value="${esc(m)}"${selected.has(m)?' checked':''}> ${esc(m)} <span style="color:var(--text3);font-size:10px">${esc(MODEL_CAPS[m].bed.join('×'))}</span></label>`).join('');
  const post=document.getElementById('mopsJobPostStages'),postSelected=new Set(job.postStages||[]);
  if(post)post.innerHTML=POST_STAGES.map(s=>`<label><input type="checkbox" value="${s.key}"${postSelected.has(s.key)?' checked':''}> ${s.icon} ${esc(s.label)}</label>`).join('');
}
function input(id){return document.getElementById(id);}
function inputVal(id){return input(id)?.value??'';}
function setVal(id,v){const el=input(id);if(el)el.value=v??'';}
function openJob(id=''){
  const j=id?data().jobs.find(x=>x.id===id):null;
  const base=j||{id:'',qty:1,unitsPerBed:1,cycles:1,minutesPerCycle:60,material:'PLA',nozzle:'0.4',priority:'normal',status:'pendiente',compatibleModels:[]};
  setText('mopsJobModalTitle',j?'Editar trabajo':'Nuevo trabajo de impresión');
  setVal('mopsJobId',base.id);setVal('mopsJobName',base.name);setVal('mopsJobQty',base.qty);setVal('mopsJobBedQty',base.unitsPerBed);setVal('mopsJobCycles',base.cycles);
  setVal('mopsJobMinutes',base.minutesPerCycle);setVal('mopsJobMaterial',base.material);setVal('mopsJobColor',base.color);setVal('mopsJobGrams',base.grams);
  setVal('mopsJobNozzle',base.nozzle);setVal('mopsJobX',base.sizeX);setVal('mopsJobY',base.sizeY);setVal('mopsJobZ',base.sizeZ);setVal('mopsJobDue',base.dueDate);
  setVal('mopsJobPriority',base.priority);setVal('mopsJobFile',base.gcodeFile);setVal('mopsJobNotes',base.notes);fillJobSelects(base);
  input('mopsJobValidation').style.display='none';input('mopsJobModal').style.display='flex';
}
function closeJob(){input('mopsJobModal').style.display='none';}
function updateJobCycles(){
  const qty=Math.max(1,num(inputVal('mopsJobQty'),1)),per=Math.max(1,num(inputVal('mopsJobBedQty'),1));
  setVal('mopsJobCycles',Math.ceil(qty/per));
}
function collectJob(){
  const id=inputVal('mopsJobId'),existing=id?data().jobs.find(j=>j.id===id):null;
  const qty=Math.max(1,num(inputVal('mopsJobQty'),1)),unitsPerBed=Math.max(1,num(inputVal('mopsJobBedQty'),1));
  const models=[...document.querySelectorAll('#mopsJobModels input:checked')].map(x=>x.value);
  const postStages=[...document.querySelectorAll('#mopsJobPostStages input:checked')].map(x=>x.value);
  return{
    ...(existing||{}),id:id||uid('job'),name:inputVal('mopsJobName').trim(),pedidoId:inputVal('mopsJobPedido'),
    qty,unitsPerBed,cycles:Math.max(1,num(inputVal('mopsJobCycles'),Math.ceil(qty/unitsPerBed))),
    minutesPerCycle:Math.max(1,num(inputVal('mopsJobMinutes'),60)),material:inputVal('mopsJobMaterial'),color:inputVal('mopsJobColor').trim(),
    grams:Math.max(0,num(inputVal('mopsJobGrams'))),nozzle:inputVal('mopsJobNozzle'),sizeX:Math.max(0,num(inputVal('mopsJobX'))),
    sizeY:Math.max(0,num(inputVal('mopsJobY'))),sizeZ:Math.max(0,num(inputVal('mopsJobZ'))),dueDate:inputVal('mopsJobDue'),
    priority:inputVal('mopsJobPriority'),machineId:inputVal('mopsJobMachine'),spoolId:inputVal('mopsJobSpool'),profileId:inputVal('mopsJobProfile'),
    gcodeFile:inputVal('mopsJobFile').trim(),notes:inputVal('mopsJobNotes').trim(),compatibleModels:models,
    postStages,
    status:existing?.status||'pendiente',createdAt:existing?.createdAt||nowIso(),updatedAt:nowIso(),archived:false,
  };
}
function validateJob(j){
  const errors=[];if(!j.name)errors.push('Falta el nombre del trabajo.');
  if(j.machineId){const m=getMachine(j.machineId);if(!m||!modelCanRun(m.modelo,j))errors.push('La máquina elegida no es compatible con material o dimensiones.');}
  if(j.spoolId){const s=data().spools.find(x=>x.id===j.spoolId);if(!s)errors.push('El rollo reservado no existe.');else{const previous=data().jobs.find(x=>x.id===j.id);const ownReservation=previous?.spoolId===s.id&&!previous.materialConsumed?num(previous.grams):0;const available=spoolAvailable(s)+ownReservation;if(available<j.grams)errors.push(`El rollo solo tiene ${Math.round(available)} g libres y el trabajo necesita ${j.grams} g.`);}}
  if(j.profileId){const p=data().profiles.find(x=>x.id===j.profileId);if(!p||p.archived)errors.push('El perfil de laminado seleccionado ya no está disponible.');else if((p.model&&j.machineId&&p.model!==getMachine(j.machineId)?.modelo)||(p.material&&p.material!==j.material)||(p.nozzle&&String(p.nozzle)!==String(j.nozzle)))errors.push('El perfil no coincide con la máquina, material o boquilla del trabajo.');}
  if(!jobModels(j).length)errors.push('Ningún modelo de la flota admite este trabajo.');
  return errors;
}
function saveJob(){
  const j=collectJob(),errors=validateJob(j),box=input('mopsJobValidation');
  if(errors.length){box.style.display='block';box.innerHTML=`<div class="mops-alert danger">⚠ <span>${errors.map(esc).join('<br>')}</span></div>`;return;}
  const idx=data().jobs.findIndex(x=>x.id===j.id);if(idx>=0)data().jobs[idx]=j;else data().jobs.push(j);
  audit(idx>=0?'Trabajo actualizado':'Trabajo creado',j.machineId,`${j.name} · ${orderLabel(j.pedidoId)}`);
  writeLocal();scheduleRemote();closeJob();renderAll();toast(idx>=0?'Trabajo actualizado ✓':'Trabajo creado ✓','success');
}
function planOne(id,silent=false,loads=null){
  const j=data().jobs.find(x=>x.id===id);if(!j)return null;
  const loadMap=loads||new Map((MAQUINAS||[]).map(m=>[m.id,jobsForMachine(m.id).filter(x=>x.id!==j.id).reduce((s,x)=>s+jobMinutes(x),0)]));
  const pick=pickMachine(j,loadMap);
  if(!pick){if(!silent)toast('No hay una máquina operativa y compatible para este trabajo','error');return null;}
  j.machineId=pick.machine.id;j.status=j.status==='pendiente'?'planificado':j.status;j.updatedAt=nowIso();
  const spool=compatibleSpools(j,j.machineId).sort((a,b)=>spoolAvailable(b)-spoolAvailable(a))[0];
  if(spool&&spoolAvailable(spool)>=j.grams)j.spoolId=spool.id;
  j.position=jobsForMachine(j.machineId).filter(x=>x.id!==j.id).length+1;
  loadMap.set(j.machineId,(loadMap.get(j.machineId)||0)+jobMinutes(j));
  if(!silent){persist('Trabajo planificado');toast(`${j.name} → ${machineLabel(j.machineId)}`,'success');}
  return pick.machine;
}
function autoPlan(){
  const loads=new Map((MAQUINAS||[]).map(m=>[m.id,jobsForMachine(m.id).filter(j=>j.status!=='pendiente').reduce((s,j)=>s+jobMinutes(j),0)]));
  const targets=activeJobs().filter(j=>!j.machineId||j.status==='pendiente').sort((a,b)=>dueUrgency(a)-dueUrgency(b));
  let ok=0,fail=0;targets.forEach(j=>planOne(j.id,true,loads)?ok++:fail++);
  persist('Planificación automática', {render:true});
  toast(`Planificación lista: ${ok} asignados${fail?` · ${fail} sin compatibilidad`:''}`,fail?'info':'success');
}
function enqueueJob(id){
  const j=data().jobs.find(x=>x.id===id);if(!j)return;
  if(!j.machineId&&!planOne(id,true)){toast('Asigna una máquina con telemetría reciente antes de preparar','error');return;}
  const errors=validateJob(j);if(errors.length){toast(errors[0],'error');return;}
  j.status='en_cola';j.queuedAt=nowIso();j.updatedAt=nowIso();persist('Trabajo preparado para iniciar');
  toast(`${j.name} preparado en ${machineLabel(j.machineId)} · esto aún no crea una cola durable`,'success');
}
function openPreflight(id){
  const j=data().jobs.find(x=>x.id===id);if(!j||!j.machineId){toast('Asigna una máquina antes de iniciar','error');return;}
  const m=getMachine(j.machineId),result=evaluatePreflight(j,m),modal=input('mopsPreflightModal'),body=input('mopsPreflightBody'),confirmBtn=input('mopsPreflightConfirm');
  if(!modal||!body||!confirmBtn)return;
  setVal('mopsPreflightJobId',id);setText('mopsPreflightTitle',`${j.name} · ${machineLabel(j.machineId)}`);
  body.innerHTML=`<div class="mops-preflight-summary ${result.ok?'ok':'blocked'}"><b>${result.ok?'✓ Lista para iniciar':'⛔ Inicio bloqueado'}</b><span>${result.blockers.length?result.blockers.length+' condición(es) críticas':result.warnings.length?result.warnings.length+' advertencia(s) para confirmar':'Todos los controles aprobaron'}</span></div><div class="mops-preflight-list">${result.checks.map(check=>`<div class="mops-preflight-row ${check.level}"><span>${check.level==='pass'?'✓':check.level==='warn'?'!':'×'}</span><div><b>${esc(check.label)}</b><small>${esc(check.detail)}</small></div></div>`).join('')}</div>`;
  confirmBtn.disabled=!result.ok;confirmBtn.textContent=result.ok?'Confirmar e iniciar':'Corrige los bloqueos';modal.style.display='flex';
}
function closePreflight(){const modal=input('mopsPreflightModal');if(modal)modal.style.display='none';}
function confirmPreflight(){const id=inputVal('mopsPreflightJobId');if(!id)return;closePreflight();startJob(id,{preflightConfirmed:true});}
async function startJob(id,options={}){
  const j=data().jobs.find(x=>x.id===id);if(!j||!j.machineId)return false;
  const m=getMachine(j.machineId),st=liveState(j.machineId);
  if(!options.preflightConfirmed){openPreflight(id);return false;}
  // El modal puede quedar abierto mientras cambia filamento, mantención o estado.
  // Por eso el preflight se repite justo antes del comando físico.
  const fresh=evaluatePreflight(j,m);
  if(!fresh.ok){
    audit('Inicio detenido por preflight revalidado',m.id,fresh.blockers.map(x=>x.detail).join(' · '),'warn');
    toast(fresh.blockers[0]?.detail||'Las condiciones cambiaron; revisa el preflight','error');
    openPreflight(id);return false;
  }
  if(!machineOperational(m)){toast('La máquina no está operativa o la cama no fue liberada','error');return false;}
  if(st==='printing'||st==='paused'){j.status='en_cola';persist('Trabajo conservado en cola');toast('La impresora está ocupada; el trabajo permanece en cola','info');return false;}
  if(!j.gcodeFile){toast('Configura el nombre del archivo G-code que ya está en la impresora','error');return false;}
  if(!checkSafetyBeforeStart(j,m,true))return false;
  if(!window.FarmQueue?.startExisting){
    audit('Inicio detenido: Controller no disponible',m.id,j.gcodeFile,'error');
    toast('No se inicia sin Farm Controller: evita ejecuciones fuera del registro central','error');return false;
  }
  try{
    const execution=await window.FarmQueue.startExisting(j.machineId,j.gcodeFile,{jobId:j.id,name:j.name,material:j.material,nozzle:j.nozzle,source:'machineops'});
    if(!execution)throw new Error('Controller no confirmó la ejecución');
    j.farmJobId=execution.id||j.farmJobId;j.executionId=execution.idempotencyKey||j.executionId;
    j.status='en_cola';j.startRequestedAt=nowIso();j.updatedAt=nowIso();persist('Inicio solicitado al Controller');
    audit('Ejecución Controller',m.id,`START solicitado ${j.gcodeFile} · ${j.farmJobId||''}`,'control');
    toast('Controller aceptó el inicio; esperando confirmación de telemetría ✓','success');setTimeout(pollPrinters,1200);return true;
  }catch(e){audit('Fallo Controller',m.id,e.message,'error');toast('No se pudo iniciar: '+e.message,'error');return false;}
}
function startExistingFile(machineId,filename){
  const m=getMachine(machineId);if(!m||!filename)return false;
  const j={id:uid('job'),name:'Reimpresión · '+String(filename).replace(/\.gcode$/i,''),pedidoId:'',qty:1,unitsPerBed:1,cycles:1,minutesPerCycle:60,
    material:'',color:'',grams:0,nozzle:'',sizeX:0,sizeY:0,sizeZ:0,dueDate:'',priority:'normal',machineId,spoolId:'',profileId:'',
    gcodeFile:String(filename),notes:'Creado desde Archivos de la impresora; requiere preflight antes de iniciar.',compatibleModels:[m.modelo],postStages:[],
    status:'en_cola',source:'existing-file',createdAt:nowIso(),updatedAt:nowIso(),archived:false};
  data().jobs.push(j);audit('Reimpresión preparada',machineId,j.gcodeFile,'control');writeLocal();scheduleRemote();renderAll();
  toast('Reimpresión preparada: revisa el preflight','info');openPreflight(j.id);return j.id;
}
function archiveJob(id){
  const j=data().jobs.find(x=>x.id===id);if(!j)return;
  if(['imprimiendo','en_cola'].includes(j.status)){toast('No se puede archivar un trabajo activo o en cola','error');return;}
  j.archivedFromStatus=j.status;j.archived=true;j.status='archivado';j.updatedAt=nowIso();persist('Trabajo archivado');
}

function renderMaterials(){
  const sum=document.getElementById('mopsMaterialSummary'),el=document.getElementById('mopsSpools');if(!sum||!el)return;
  const rows=data().spools.filter(s=>!s.archived),registered=rows.reduce((s,x)=>s+num(x.remaining),0),reserved=rows.reduce((s,x)=>s+reservedForSpool(x.id),0);
  const free=rows.reduce((s,x)=>s+spoolAvailable(x),0),low=rows.filter(s=>spoolAvailable(s)<Math.min(250,num(s.initial)*.2)&&s.status!=='agotado').length;
  const value=rows.reduce((s,x)=>s+num(x.remaining)/1000*num(x.costPerKg),0);
  sum.innerHTML=`<div class="mops-kpis">${kpi('Rollos activos',rows.length,'registrados')}${kpi('Stock registrado',(registered/1000).toFixed(2)+' kg','inventario declarado')}${kpi('Reservado',(reserved/1000).toFixed(2)+' kg','trabajos abiertos')}${kpi('Libre',(free/1000).toFixed(2)+' kg','registrado − reservado',low?'var(--warn)':'var(--accent3)')}${kpi('Stock bajo',low,'requieren reposición',low?'var(--warn)':'var(--accent3)')}${kpi('Valor registrado',fmtMoney(value),'estimado según costo/kg')}</div>
    <div class="mops-source-note warning"><b>Fuente: inventario registrado.</b><span>No existe una balanza física conectada. El stock baja al cerrar trabajos/QA o al editar un rollo; “Libre” descuenta reservas de trabajos abiertos.</span></div>`;
  el.innerHTML=rows.length?`<div class="mops-spool-grid">${rows.map(s=>{
    const available=spoolAvailable(s),pct=clamp(num(s.remaining)/Math.max(1,num(s.initial))*100,0,100),res=reservedForSpool(s.id);
    const color=pct<15?'var(--danger)':pct<30?'var(--warn)':'var(--accent3)';
    return`<div class="mops-spool">
      <div style="display:flex;align-items:center;gap:8px"><span style="width:13px;height:13px;border-radius:50%;background:${cssColor(s.colorCss||s.color)};border:1px solid var(--border2)"></span><b style="font-size:12px;color:var(--text);flex:1">${esc(s.name)}</b><span class="mops-status" style="color:${color}">${esc(s.status||'activo')}</span></div>
      <div style="font-size:10.5px;color:var(--text3);margin-top:5px">${esc(s.material)} · ${esc(s.color||'sin color')} · ${esc(s.brand||'sin marca')}</div>
      <div class="mops-spool-meter"><i style="width:${pct}%;background:${color}"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text2)"><span><b>${Math.round(available)} g</b> libres</span><span>${Math.round(res)} g reservados</span></div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px">${esc(machineLabel(s.machineId))}${s.slot?' · slot '+esc(s.slot):''} · ${fmtMoney(num(s.costPerKg))}/kg</div>
      <div style="display:flex;gap:5px;margin-top:9px"><button class="btn btn-ghost btn-sm" onclick="MachineOps.openSpool('${s.id}')">Editar</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.printEntityLabel('spool','${s.id}')">▦ QR</button>${s.status!=='agotado'?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.markSpoolEmpty('${s.id}')">Agotar</button>`:''}</div>
    </div>`;
  }).join('')}</div>`:'<div class="empty-state">No hay rollos registrados. Agrega el primero para reservar material por trabajo.</div>';
}
function fillMachineSelect(id,selected){
  const el=input(id);if(!el)return;
  el.innerHTML='<option value="">Bodega / sin cargar</option>'+(MAQUINAS||[]).map(m=>`<option value="${m.id}"${selected===m.id?' selected':''}>${esc(m.nombre)} #${m.numG}</option>`).join('');
}
function openSpool(id=''){
  const s=id?data().spools.find(x=>x.id===id):null,base=s||{initial:1000,remaining:1000,material:'PLA',status:'activo',costPerKg:0};
  setText('mopsSpoolModalTitle',s?'Editar rollo':'Registrar rollo');setVal('mopsSpoolId',base.id);setVal('mopsSpoolName',base.name);setVal('mopsSpoolMaterial',base.material);
  setVal('mopsSpoolColor',base.color);setVal('mopsSpoolBrand',base.brand);setVal('mopsSpoolInitial',base.initial);setVal('mopsSpoolRemaining',base.remaining);
  setVal('mopsSpoolCost',base.costPerKg);setVal('mopsSpoolSlot',base.slot);setVal('mopsSpoolStatus',base.status);fillMachineSelect('mopsSpoolMachine',base.machineId);
  input('mopsSpoolModal').style.display='flex';
}
function closeSpool(){input('mopsSpoolModal').style.display='none';}
function saveSpool(){
  const id=inputVal('mopsSpoolId'),old=id?data().spools.find(s=>s.id===id):null;
  const s={...(old||{}),id:id||uid('spool'),name:inputVal('mopsSpoolName').trim(),material:inputVal('mopsSpoolMaterial'),color:inputVal('mopsSpoolColor').trim(),
    brand:inputVal('mopsSpoolBrand').trim(),initial:Math.max(1,num(inputVal('mopsSpoolInitial'),1000)),remaining:Math.max(0,num(inputVal('mopsSpoolRemaining'))),
    costPerKg:Math.max(0,num(inputVal('mopsSpoolCost'))),machineId:inputVal('mopsSpoolMachine'),slot:inputVal('mopsSpoolSlot').trim(),status:inputVal('mopsSpoolStatus'),
    createdAt:old?.createdAt||nowIso(),updatedAt:nowIso(),archived:false};
  if(!s.name){toast('Ingresa un código o nombre para el rollo','error');return;}
  const idx=data().spools.findIndex(x=>x.id===s.id);if(idx>=0)data().spools[idx]=s;else data().spools.push(s);
  closeSpool();persist(idx>=0?'Rollo actualizado':'Rollo registrado');toast('Rollo guardado ✓','success');
}
function markSpoolEmpty(id){const s=data().spools.find(x=>x.id===id);if(!s)return;s.remaining=0;s.status='agotado';s.updatedAt=nowIso();persist('Rollo agotado');}
function reconcileSpools(){renderMaterials();toast('Reservas recalculadas desde los trabajos activos','success');}

// ── Biblioteca compartida y versionada de perfiles Orca/Slicer ──────
function profileKey(p){return[p.name,p.model,p.material,p.nozzle].map(x=>String(x||'').trim().toLowerCase()).join('|');}
function latestProfiles(){
  const map=new Map();data().profiles.filter(p=>!p.archived).forEach(p=>{const k=profileKey(p),old=map.get(k);if(!old||num(p.version)>num(old.version)||(num(p.version)===num(old.version)&&Date.parse(p.updatedAt||0)>Date.parse(old.updatedAt||0)))map.set(k,p);});
  return[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')||a.model.localeCompare(b.model,'es'));
}
function profileLabel(id){const p=data().profiles.find(x=>x.id===id);return p?`${p.name} v${num(p.version,1)}`:'perfil eliminado';}
function profileProductionCheck(p){
  const missing=[];
  if(!String(p?.model||'').trim())missing.push('modelo');
  if(!String(p?.material||'').trim())missing.push('material');
  if(!String(p?.nozzle||'').trim())missing.push('boquilla');
  if(!(p?.params&&typeof p.params==='object'&&Object.keys(p.params).length))missing.push('parámetros');
  const layer=num(p?.layerHeight||p?.params?.layerHeight);
  if(!(layer>0))missing.push('altura de capa');
  return{ok:missing.length===0,missing};
}
function addProfileVersion(meta,params){
  const normalized={...(params||{})},fingerprint=hashText(JSON.stringify(normalized));
  const siblings=data().profiles.filter(p=>profileKey(p)===profileKey(meta));
  const duplicate=siblings.find(p=>p.fingerprint===fingerprint&&!p.archived);
  if(duplicate)return{profile:duplicate,created:false};
  const version=Math.max(0,...siblings.map(p=>num(p.version)))+1;
  const p={id:uid('profile'),name:String(meta.name||'').trim(),model:meta.model||'',material:meta.material||'',nozzle:String(meta.nozzle||'0.4'),
    layerHeight:num(meta.layerHeight||normalized.layerHeight),status:meta.status||'experimental',version,parentId:siblings[0]?.id||'',fingerprint,
    params:normalized,notes:String(meta.notes||''),approvedBy:meta.status==='approved'?actor():'',approvedAt:meta.status==='approved'?nowIso():'',
    createdAt:nowIso(),updatedAt:nowIso(),archived:false};
  data().profiles.push(p);return{profile:p,created:true};
}
function importLegacyProfiles(){
  let legacy={};try{legacy=JSON.parse(localStorage.getItem('sl_profiles')||'{}');}catch(_){}
  let added=0;Object.entries(legacy).forEach(([name,params])=>{const r=addProfileVersion({name,model:'',material:'',nozzle:'0.4',status:'experimental',notes:'Importado desde perfil local'},params);if(r.created)added++;});
  if(added){writeLocal();scheduleRemote();audit('Perfiles locales importados','',`${added} perfil(es)`);}
}
function captureSlicerProfile(name,params,meta={}){
  const r=addProfileVersion({name,model:meta.model||'',material:meta.material||'',nozzle:meta.nozzle||'0.4',status:'experimental',notes:'Capturado desde el laminador'},params);
  if(r.created){persist('Nueva versión de perfil capturada');toast(`Perfil compartido ${name} v${r.profile.version} ✓`,'success');}
  else toast('Ese perfil ya está respaldado con la misma versión','info');
  return r.profile;
}
function openProfile(id=''){
  const p=id?data().profiles.find(x=>x.id===id):null,base=p||{model:'K1',material:'PLA',nozzle:'0.4',status:'experimental',params:{}};
  setText('mopsProfileModalTitle',p?'Nueva versión del perfil':'Nuevo perfil controlado');setVal('mopsProfileSourceId',p?.id||'');setVal('mopsProfileName',base.name);setVal('mopsProfileModel',base.model);
  setVal('mopsProfileMaterial',base.material);setVal('mopsProfileNozzle',base.nozzle);setVal('mopsProfileLayer',base.layerHeight||base.params?.layerHeight);setVal('mopsProfileStatus',base.status);
  setVal('mopsProfileNotes',base.notes);setVal('mopsProfileParams',JSON.stringify(base.params||{},null,2));input('mopsProfileModal').style.display='flex';
}
function closeProfile(){input('mopsProfileModal').style.display='none';}
function saveProfile(){
  const name=inputVal('mopsProfileName').trim();if(!name){toast('Ingresa un nombre para el perfil','error');return;}
  let params={};try{params=JSON.parse(inputVal('mopsProfileParams')||'{}');}catch(_){toast('Los parámetros JSON no son válidos','error');return;}
  if(inputVal('mopsProfileLayer'))params.layerHeight=inputVal('mopsProfileLayer');
  const r=addProfileVersion({name,model:inputVal('mopsProfileModel'),material:inputVal('mopsProfileMaterial'),nozzle:inputVal('mopsProfileNozzle'),
    layerHeight:inputVal('mopsProfileLayer'),status:inputVal('mopsProfileStatus'),notes:inputVal('mopsProfileNotes')},params);
  closeProfile();if(r.created){persist('Versión de perfil creada');toast(`${name} v${r.profile.version} guardado ✓`,'success');}else toast('No hay cambios respecto de la versión existente','info');
}
function setProfileStatus(id,status){
  const p=data().profiles.find(x=>x.id===id);if(!p||!['experimental','approved','deprecated'].includes(status))return;
  if(status==='approved'){
    const check=profileProductionCheck(p);
    if(!check.ok){toast('No se puede aprobar: falta '+check.missing.join(', '),'error');return;}
    if(!confirm('Aprobar este perfil certifica una REVISIÓN HUMANA para producción. No reemplaza una pieza piloto ni una validación dimensional.\n\n¿Confirmas la aprobación?'))return;
    p.approvedBy=actor();p.approvedAt=nowIso();
  }
  p.status=status;p.updatedAt=nowIso();persist('Estado de perfil actualizado');
}
function archiveProfile(id){const p=data().profiles.find(x=>x.id===id);if(!p)return;p.archived=true;p.updatedAt=nowIso();persist('Perfil archivado');}
function useProfile(id){
  const p=data().profiles.find(x=>x.id===id);if(!p)return;
  const check=profileProductionCheck(p);
  if(p.status==='deprecated'){toast('Este perfil está deprecado. Crea o selecciona una versión vigente.','error');return;}
  if(!check.ok){toast('Perfil incompleto: '+check.missing.join(', '),'error');return;}
  if(p.status!=='approved'&&!confirm('Este perfil todavía es EXPERIMENTAL. Úsalo solo para prueba/pieza piloto.\n\n¿Continuar?'))return;
  let legacy={};try{legacy=JSON.parse(localStorage.getItem('sl_profiles')||'{}');}catch(_){}
  legacy[p.name]=p.params||{};localStorage.setItem('sl_profiles',JSON.stringify(legacy));showView('laminado');
  setTimeout(()=>{setVal('slPrinter',p.model);setVal('slMaterial',p.material);setVal('slNozzle',p.nozzle);try{SL3D.loadProfile(p.name);}catch(_){toast('Perfil copiado al laminador; genera parámetros para aplicarlo','info');}},120);
  audit('Perfil enviado al laminador','',profileLabel(id));writeLocal();scheduleRemote();
}
function exportProfile(id){
  const p=data().profiles.find(x=>x.id===id);if(!p)return;const payload={schema:'thelab-orca-profile-v1',name:p.name,version:p.version,model:p.model,material:p.material,nozzle:p.nozzle,status:p.status,fingerprint:p.fingerprint,params:p.params,notes:p.notes};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download=`${p.name.replace(/[^a-z0-9_-]+/gi,'_')}_v${p.version}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);
}
async function importProfileFile(event){
  const file=event?.target?.files?.[0];if(!file)return;try{const doc=JSON.parse(await file.text()),params=doc.params||doc.config||doc;const name=doc.name||doc.profile_name||file.name.replace(/\.json$/i,'');
    const r=addProfileVersion({name,model:doc.model||doc.printer_model||'',material:doc.material||doc.filament_type||'',nozzle:doc.nozzle||doc.nozzle_diameter||'0.4',status:'experimental',notes:`Importado desde ${file.name}`},params);
    if(r.created){persist('Perfil Orca importado');toast(`${name} v${r.profile.version} importado ✓`,'success');}else toast('Ese archivo coincide con una versión existente','info');
  }catch(e){toast('No se pudo importar el perfil JSON: '+e.message,'error');}finally{event.target.value='';}
}
function renderProfiles(){
  const el=input('mopsProfiles');if(!el)return;const rows=latestProfiles(),versions=data().profiles.filter(p=>!p.archived).length;
  const ready=rows.filter(p=>p.status==='approved'&&profileProductionCheck(p).ok).length;
  const invalidApproved=rows.filter(p=>p.status==='approved'&&!profileProductionCheck(p).ok).length;
  el.innerHTML=`<div class="mops-kpis">${kpi('Perfiles vigentes',rows.length,'combinaciones')}${kpi('Listos producción',ready,'aprobados + completos',ready===rows.length&&rows.length?'var(--accent3)':'var(--warn)')}${kpi('Aprobados incompletos',invalidApproved,'requieren corregir metadata',invalidApproved?'var(--danger)':'var(--accent3)')}${kpi('Versiones',versions,'histórico trazable')}</div>
  <div class="mops-source-note"><b>Qué significa “Aprobado”.</b><span>Es una aprobación humana registrada con usuario y fecha. Para series críticas conviene validar una pieza piloto; el dashboard no puede certificar por sí solo acabado o tolerancias físicas.</span></div>
  ${rows.length?`<div class="mops-profile-grid">${rows.map(p=>{const count=data().profiles.filter(x=>profileKey(x)===profileKey(p)&&!x.archived).length,check=profileProductionCheck(p),readyNow=p.status==='approved'&&check.ok,col=readyNow?'var(--accent3)':p.status==='deprecated'?'var(--danger)':'var(--warn)',statusText=p.status==='approved'&&!check.ok?'aprobado incompleto':p.status;return`<div class="mops-profile-card"><div style="display:flex;gap:8px;align-items:center"><b style="color:var(--text);flex:1">${esc(p.name)}</b><span class="mops-status" style="color:${col}">${esc(statusText)}</span></div><div style="font-size:10.5px;color:var(--text3);margin-top:5px">${esc(p.model||'sin modelo')} · ${esc(p.material||'sin material')} · ${esc(p.nozzle||'—')} mm · capa ${num(p.layerHeight||p.params?.layerHeight).toFixed(2)} mm</div><div style="font-size:10px;color:var(--text3);margin-top:5px">v${p.version} · ${count} versión${count!==1?'es':''} · huella ${esc(p.fingerprint)}${p.approvedAt?` · aprobado ${esc(fmtStamp(p.approvedAt))}`:''}</div>${!check.ok?`<div class="mops-profile-missing">Falta: ${esc(check.missing.join(', '))}</div>`:''}<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:9px"><button class="btn btn-primary btn-sm" onclick="MachineOps.useProfile('${p.id}')">Usar</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.openProfile('${p.id}')">Nueva versión</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.exportProfile('${p.id}')">Exportar</button>${p.status!=='approved'?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.setProfileStatus('${p.id}','approved')">✓ Aprobar</button>`:''}<button class="btn btn-ghost btn-sm" onclick="MachineOps.archiveProfile('${p.id}')">Archivar</button></div></div>`;}).join('')}</div>`:'<div class="empty-state">Aún no hay perfiles compartidos. Guarda uno desde el laminador o créalo manualmente.</div>'}`;
}

function qaJobOptions(selected=''){
  const jobs=data().jobs.filter(j=>!j.archived&&['qa','imprimiendo','terminado','fallido'].includes(j.status));
  const el=input('mopsQAJob');if(el)el.innerHTML='<option value="">— seleccionar trabajo —</option>'+jobs.map(j=>`<option value="${j.id}"${selected===j.id?' selected':''}>${esc(j.name)} · ${esc(orderLabel(j.pedidoId)||'sin pedido')}</option>`).join('');
}
function openQA(jobId=''){
  const pre=jobId?data().jobs.find(x=>x.id===jobId):null;
  qaJobOptions(jobId);setVal('mopsQAId','');setVal('mopsQAResult','aprobado');setVal('mopsQAReason','Warping');setVal('mopsQAWaste',pre?num(pre.grams):'');setVal('mopsQANotes','');setVal('mopsQAPhoto','');
  toggleQAFailure();input('mopsQAModal').style.display='flex';
}
function closeQA(){input('mopsQAModal').style.display='none';}
function toggleQAFailure(){const el=input('mopsQAFailureFields');if(el)el.style.display=inputVal('mopsQAResult')==='fallido'?'grid':'none';}
function prefillQA(){const j=data().jobs.find(x=>x.id===inputVal('mopsQAJob'));if(j){if(j.failureReason)setVal('mopsQAReason',j.failureReason);setVal('mopsQAWaste',num(j.grams));}}
function consumeJobMaterial(j,actualGrams){
  if(j.materialConsumed)return;
  const grams=Math.max(0,num(actualGrams,j.grams)),s=data().spools.find(x=>x.id===j.spoolId);
  // El material YA se gastó: la impresión ocurrió. Así que aquí no se bloquea
  // nada (a diferencia del consumo desde Pedidos, donde todavía se puede
  // frenar). Pero los dos descuadres posibles se avisan, porque si no el
  // registro queda mintiendo y nadie se entera:
  //  · Sin bobina asignada, los gramos no se descontaban de ningún lado.
  //  · Si la bobina no alcanzaba, el sobrante se recortaba a 0 en silencio.
  if(!s){
    if(grams>0) try{toast(`${j.name||'Trabajo'}: ${Math.round(grams)} g impresos sin bobina asignada — no se descontaron de ninguna`,'error');}catch(e){}
  }else{
    const habia=num(s.remaining);
    if(grams>habia){
      const falta=Math.round(grams-habia);
      try{toast(`${s.name||'Bobina'}: se gastaron ${Math.round(grams)} g pero quedaban ${Math.round(habia)} — faltan ${falta} g por cuadrar`,'error');}catch(e){}
    }
    s.remaining=Math.max(0,habia-grams);
    if(s.remaining<=0)s.status='agotado';
    s.updatedAt=nowIso();
  }
  j.materialConsumed=grams;
}
function requiredPostStages(pedidoId){return[...new Set(data().jobs.filter(j=>j.pedidoId===pedidoId&&!j.archived).flatMap(j=>j.postStages||[]))].filter(k=>POST_STAGES.some(s=>s.key===k));}
function ensureWorkflow(pedidoId,stageKeys){
  let w=data().workflows.find(x=>x.pedidoId===pedidoId&&!x.archived);
  if(!w){w={id:uid('workflow'),pedidoId,status:'active',stages:[],createdAt:nowIso(),updatedAt:nowIso(),archived:false};data().workflows.push(w);}
  const existing=new Set(w.stages.map(s=>s.key));stageKeys.forEach(key=>{if(!existing.has(key))w.stages.push({key,status:'pending',updatedAt:nowIso()});});
  if(w.stages.some(s=>s.status!=='done'))w.status='active';w.updatedAt=nowIso();return w;
}
async function markOrderReady(pedidoId){
  const p=state.pedidosById?.[pedidoId];if(!p)return;
  p.fields['Estado pedido']='Listo para despacho';p.fields['Resultado QA']='QA aprobado';
  try{await airtableWrite('Pedidos','PATCH',pedidoId,{'Estado pedido':'Listo para despacho','Resultado QA':'QA aprobado'});toast(`${p.fields['N° Pedido']||'Pedido'} listo para despacho ✓`,'success');}
  catch(e){console.warn('[MachineOps] no se pudo avanzar pedido',e);toast('Producción terminada; Airtable no pudo actualizar el pedido','info');}
}
// ¿Están listos TODOS los trabajos efectivos del pedido? Ignora los originales ya
// REEMPLAZADOS por una reimpresión (otro job con reprintOf===su id): un fallo de QA
// deja el original 'fallido' sin archivar, y sin esta exclusión bloquearía el
// cierre del pedido para siempre aunque la reimpresión pase QA (nada lo reevalúa
// después). Devuelve true solo si hay trabajos efectivos y todos están 'terminado'.
function _pedidoTrabajosListos(activos){
  const reemplazados=new Set((activos||[]).map(j=>j.reprintOf).filter(Boolean));
  const efectivos=(activos||[]).filter(j=>!reemplazados.has(j.id));
  return efectivos.length>0&&efectivos.every(j=>j.status==='terminado');
}
async function maybeCompleteOrder(pedidoId){
  if(!pedidoId)return;
  const jobs=data().jobs.filter(j=>j.pedidoId===pedidoId&&!j.archived);
  if(!_pedidoTrabajosListos(jobs))return;
  const keys=requiredPostStages(pedidoId),existing=data().workflows.find(w=>w.pedidoId===pedidoId&&!w.archived);
  if(keys.length||existing){
    const w=ensureWorkflow(pedidoId,keys);persist('Pedido enviado a postproducción');
    if(w.stages.length&&w.stages.every(s=>s.status==='done')){w.status='done';w.completedAt=w.completedAt||nowIso();await markOrderReady(pedidoId);}
    else{const p=state.pedidosById?.[pedidoId];if(p){p.fields['Estado pedido']='En producción';p.fields['Resultado QA']='QA aprobado';
      // Igual que markOrderReady: si Airtable no acepta el cambio hay que
      // decirlo, o el pedido queda en un estado en pantalla que no existe.
      let ok=true;
      try{await airtableWrite('Pedidos','PATCH',pedidoId,{'Estado pedido':'En producción','Resultado QA':'QA aprobado'});}
      catch(e){ok=false;console.warn('[MachineOps] no se pudo pasar el pedido a postproducción',e);}
      if(ok) toast(`${p.fields['N° Pedido']||'Pedido'} pasó a postproducción`,'success');
      else toast('Pasó a postproducción; Airtable no pudo actualizar el pedido','error');}}
    return;
  }
  await markOrderReady(pedidoId);
}
// Desperdicio efectivo de un fallido: un 0 explícito significa 0 (falló antes de
// extruir); solo un campo EN BLANCO asume el total planificado del trabajo. Antes
// `waste||job.grams` descontaba el total aun con un 0 escrito a mano, sobre-
// consumiendo la bobina y distorsionando el costo.
function _qaFailWaste(wasteRaw,jobGrams){
  const t=String(wasteRaw==null?'':wasteRaw).trim();
  return t===''?Math.max(0,num(jobGrams)):Math.max(0,num(t));
}
function saveQA(){
  const job=data().jobs.find(j=>j.id===inputVal('mopsQAJob'));if(!job){toast('Selecciona un trabajo','error');return;}
  const result=inputVal('mopsQAResult'),photo=inputVal('mopsQAPhoto').trim();
  const failWaste=_qaFailWaste(inputVal('mopsQAWaste'),job.grams);
  const waste=result==='fallido'?failWaste:0;
  if(photo&&!/^https?:\/\//i.test(photo)){toast('La evidencia debe ser una URL http o https','error');return;}
  const q={id:uid('qa'),jobId:job.id,pedidoId:job.pedidoId,machineId:job.machineId,result,reason:result==='fallido'?inputVal('mopsQAReason'):'',
    wasteGrams:waste,notes:inputVal('mopsQANotes').trim(),photo,actor:actor(),createdAt:nowIso(),updatedAt:nowIso()};
  data().qa.unshift(q);consumeJobMaterial(job,result==='fallido'?failWaste:job.grams);
  if(result==='fallido'){
    job.status='fallido';job.failureReason=q.reason;job.wasteGrams=waste;
    const reprint={...job,id:uid('job'),name:job.name+' · reimpresión',status:'pendiente',machineId:'',spoolId:'',archived:false,reprintOf:job.id,
      materialConsumed:0,completedCycles:0,actualMinutes:0,failureReason:'',qaStatus:'',startedAt:'',completedAt:'',createdAt:nowIso(),updatedAt:nowIso()};
    data().jobs.push(reprint);toast('Falla registrada y reimpresión creada','info');
  }else{
    job.status='terminado';job.qaStatus=result;job.completedAt=job.completedAt||nowIso();toast('Control de calidad aprobado ✓','success');
  }
  job.updatedAt=nowIso();closeQA();persist('Control de calidad registrado');
  if(result!=='fallido')maybeCompleteOrder(job.pedidoId);
}
function renderQuality(){
  const el=document.getElementById('mopsQuality');if(!el)return;
  const pending=data().jobs.filter(j=>!j.archived&&j.status==='qa');
  const recent=data().qa.slice(0,6);
  const fail30=data().qa.filter(q=>q.result==='fallido'&&Date.parse(q.createdAt)>Date.now()-30*86400000);
  el.innerHTML=`<div class="mops-kpis">${kpi('Esperando revisión',pending.length,'trabajos')}${kpi('Fallos 30 días',fail30.length,`${fail30.reduce((s,q)=>s+num(q.wasteGrams),0)} g desperdicio`,fail30.length?'var(--danger)':'var(--accent3)')}${kpi('Controles registrados',data().qa.length,'histórico compartido')}</div>
    ${pending.length?`<div class="mops-qa-grid" style="margin-bottom:12px">${pending.map(j=>`<div class="mops-qa-card"><div style="display:flex;gap:8px;align-items:center"><b style="color:var(--text);flex:1">${esc(j.name)}</b>${statusBadge(j.status)}</div><div style="font-size:10.5px;color:var(--text3);margin:5px 0">${esc(machineLabel(j.machineId))} · ${esc(orderLabel(j.pedidoId)||'sin pedido')}</div><button class="btn btn-primary btn-sm" onclick="MachineOps.openQA('${j.id}')">Revisar QA</button></div>`).join('')}</div>`:''}
    ${recent.length?`<div class="card" style="padding:12px"><div style="font-size:10.5px;font-weight:700;color:var(--text3);margin-bottom:8px">ÚLTIMOS CONTROLES</div>${recent.map(q=>{const j=data().jobs.find(x=>x.id===q.jobId);const col=q.result==='fallido'?'var(--danger)':q.result==='observaciones'?'var(--warn)':'var(--accent3)';return`<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border2);font-size:10.5px"><span style="color:${col};font-weight:800">${esc(q.result)}</span><span style="color:var(--text2);flex:1">${esc(j?.name||'Trabajo')} ${q.reason?'· '+esc(q.reason):''}</span><span style="color:var(--text3)">${new Date(q.createdAt).toLocaleDateString('es-CL')}</span></div>`;}).join('')}</div>`:''}`;
}

function postProgress(w){return w.stages.length?w.stages.filter(s=>s.status==='done').length/w.stages.length*100:100;}
function renderPostProduction(){
  const el=input('mopsPostProduction');if(!el)return;const all=data().workflows.filter(w=>!w.archived),active=all.filter(w=>w.status!=='done'),blocked=all.filter(w=>w.stages.some(s=>s.status==='blocked'));
  const rows=[...active,...all.filter(w=>w.status==='done').sort((a,b)=>Date.parse(b.completedAt||0)-Date.parse(a.completedAt||0)).slice(0,6)];
  el.innerHTML=`<div class="mops-kpis">${kpi('En postproducción',active.length,'pedidos activos')}${kpi('Bloqueados',blocked.length,'requieren atención',blocked.length?'var(--danger)':'var(--accent3)')}${kpi('Terminados',all.filter(w=>w.status==='done').length,'histórico')}</div>
  ${rows.length?`<div class="mops-post-grid">${rows.map(w=>{const pct=postProgress(w),p=state.pedidosById?.[w.pedidoId],due=p?.fields?.['Fecha entrega']||'';return`<div class="mops-post-card"><div style="display:flex;gap:8px;align-items:start"><div style="flex:1"><b style="font-size:12px;color:var(--text)">${esc(orderLabel(w.pedidoId)||'Pedido sin nombre')}</b><div style="font-size:10px;color:var(--text3);margin-top:3px">${esc(resolveClienteName(p?.fields?.Cliente)||'')} ${due?'· entrega '+esc(due):''}</div></div><span class="mops-status" style="color:${w.status==='done'?'var(--accent3)':'var(--accent4)'}">${w.status==='done'?'terminado':'en proceso'}</span></div><div class="mops-spool-meter" style="margin:10px 0 9px"><i style="width:${pct}%;background:${pct===100?'var(--accent3)':'var(--accent4)'}"></i></div><div class="mops-stage-list">${w.stages.map((s,i)=>{const meta=postStageMeta(s.key),prevOk=i===0||w.stages.slice(0,i).every(x=>x.status==='done'),col=s.status==='done'?'var(--accent3)':s.status==='blocked'?'var(--danger)':s.status==='doing'?'var(--warn)':'var(--text3)',stamp=s.completedAt||s.startedAt;return`<div class="mops-stage ${s.status}"><span>${meta.icon}</span><span style="flex:1;color:${col}">${esc(meta.label)}<small>${s.operator?esc(s.operator):''}${stamp?' · '+esc(fmtStamp(stamp)):''}${s.blockReason?' · '+esc(s.blockReason):''}</small></span>${w.status!=='done'?`<button class="btn btn-ghost btn-sm" ${!prevOk&&s.status==='pending'?'disabled':''} onclick="MachineOps.advancePost('${w.id}','${s.key}')">${s.status==='pending'?'Iniciar':s.status==='doing'?'Completar':s.status==='blocked'?'Retomar':'✓'}</button>${s.status!=='done'?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.blockPost('${w.id}','${s.key}')" title="Bloquear">!</button>`:''}`:'<span style="color:var(--accent3)">✓</span>'}</div>`;}).join('')}</div></div>`;}).join('')}</div>`:'<div class="empty-state">Los pedidos aprobados en QA aparecerán aquí cuando tengan procesos posteriores configurados.</div>'}`;
}
function advancePost(id,key){
  const w=data().workflows.find(x=>x.id===id),s=w?.stages.find(x=>x.key===key);if(!w||!s||s.status==='done')return;const i=w.stages.indexOf(s);
  if(i>0&&!w.stages.slice(0,i).every(x=>x.status==='done')){toast('Completa las etapas anteriores primero','error');return;}
  if(s.status==='pending'||s.status==='blocked'){s.status='doing';s.startedAt=s.startedAt||nowIso();s.blockReason='';}
  else{s.status='done';s.completedAt=nowIso();}
  s.operator=actor();s.updatedAt=nowIso();w.updatedAt=nowIso();
  if(w.stages.every(x=>x.status==='done')){w.status='done';w.completedAt=nowIso();persist('Postproducción terminada');markOrderReady(w.pedidoId);}
  else persist('Etapa de postproducción actualizada');
}
function blockPost(id,key){
  const w=data().workflows.find(x=>x.id===id),s=w?.stages.find(x=>x.key===key);if(!w||!s||s.status==='done')return;const reason=(prompt('Motivo del bloqueo:','')||'').trim();if(!reason)return;
  s.status='blocked';s.blockReason=reason;s.operator=actor();s.updatedAt=nowIso();w.updatedAt=nowIso();persist('Etapa de postproducción bloqueada');
}

// ── Simulador de capacidad y promesa de entrega ──────────────
let _lastCapacity=null;
function simulateCapacity(inputData,fleet,loads={},nowMs=Date.now()){
  const q=Math.max(1,Math.ceil(num(inputData.qty,1))),perBed=Math.max(1,Math.ceil(num(inputData.unitsPerBed,1))),cycles=Math.ceil(q/perBed);
  const cycleMinutes=Math.max(1,num(inputData.minutesPerCycle,60)),handling=Math.max(0,num(inputData.handlingMinutes,8)),buffer=clamp(num(inputData.bufferPct,15),0,100)/100;
  const probe={material:inputData.material||'PLA',sizeX:num(inputData.sizeX),sizeY:num(inputData.sizeY),sizeZ:num(inputData.sizeZ)};
  if(!(probe.sizeX>0&&probe.sizeY>0&&probe.sizeZ>0))return{ok:false,reason:'Ingresa dimensiones X, Y y Z para comprobar compatibilidad física',cycles,qty:q,assignments:[]};
  const machines=(fleet||[]).filter(m=>m.operational!==false&&modelCanRun(m.modelo||m.model,probe)).map(m=>({id:m.id,model:m.modelo||m.model,label:m.label||m.nombre||m.id,
    available:Math.max(0,num(loads[m.id])),cycles:0,minutes:0,qty:0}));
  if(!machines.length)return{ok:false,reason:'No hay máquinas operativas compatibles con material y dimensiones',cycles,qty:q,assignments:[]};
  let remaining=q,totalPrinterMinutes=0;
  for(let i=0;i<cycles;i++){
    const slot=machines.slice().sort((a,b)=>(a.available+cycleMinutes+handling)-(b.available+cycleMinutes+handling))[0];
    // “Minutos por ciclo” se respeta literalmente. No se aplican multiplicadores
    // de velocidad inventados por modelo: si un modelo demora distinto, usa el
    // tiempo de slicer/medición correspondiente al escenario que estás simulando.
    const duration=cycleMinutes+handling;slot.available+=duration;slot.minutes+=duration;slot.cycles++;const units=Math.min(perBed,remaining);slot.qty+=units;remaining-=units;totalPrinterMinutes+=duration;
  }
  const used=machines.filter(m=>m.cycles),finishMinutes=Math.max(...used.map(m=>m.available)),promisedMinutes=Math.ceil(finishMinutes*(1+buffer));
  const promisedAt=new Date(nowMs+promisedMinutes*60000),dueMs=inputData.dueDate?dateValue(inputData.dueDate):Infinity;
  const grams=Math.max(0,num(inputData.grams)),materialCost=grams/1000*Math.max(0,num(inputData.costPerKg)),machineCost=totalPrinterMinutes/60*Math.max(0,num(inputData.hourlyRate,1500));
  return{ok:true,qty:q,cycles,machinesUsed:used.length,finishMinutes,promisedMinutes,promisedAt:promisedAt.toISOString(),dueDate:inputData.dueDate||'',
    feasible:dueMs===Infinity||promisedAt.getTime()<=dueMs,totalPrinterMinutes,grams,materialCost,machineCost,totalCost:materialCost+machineCost,
    confidence:'scenario',assumptions:['tiempo por ciclo ingresado','carga MachineOps','telemetría reciente','margen configurado'],
    assignments:used.map(m=>({machineId:m.id,model:m.model,label:m.label,cycles:m.cycles,qty:m.qty,minutes:Math.round(m.minutes)}))};
}
function capacityLoadMinutes(machineId){
  const jobs=jobsForMachine(machineId),queued=jobs.filter(j=>['pendiente','planificado','en_cola'].includes(j.status)).reduce((s,j)=>s+jobMinutes(j),0);
  const printing=jobs.find(j=>j.status==='imprimiendo'),live=liveEvidence(machineId);
  let running=0;
  if(printing){
    const eta=num(live.live?.eta);
    running=live.known&&live.state==='printing'&&eta>0?eta/60:jobMinutes(printing);
  }
  // QA no ocupa capacidad de impresora. Antes se sumaba junto con el trabajo
  // imprimiendo completo y, además, el ETA vivo: podía duplicar la carga.
  return Math.max(0,queued+running);
}
function capacityInput(){return{pedidoId:inputVal('mopsCapPedido'),name:inputVal('mopsCapName').trim(),qty:inputVal('mopsCapQty'),unitsPerBed:inputVal('mopsCapPerBed'),minutesPerCycle:inputVal('mopsCapMinutes'),
  handlingMinutes:inputVal('mopsCapHandling'),material:inputVal('mopsCapMaterial'),grams:inputVal('mopsCapGrams'),costPerKg:inputVal('mopsCapCostKg'),hourlyRate:inputVal('mopsCapRate'),
  sizeX:inputVal('mopsCapX'),sizeY:inputVal('mopsCapY'),sizeZ:inputVal('mopsCapZ'),dueDate:inputVal('mopsCapDue'),bufferPct:inputVal('mopsCapBuffer')};}
function fillCapacityOrders(){const el=input('mopsCapPedido');if(!el)return;const selected=el.value,orders=activeOrders();el.innerHTML='<option value="">— simulación sin pedido —</option>'+orders.map(p=>`<option value="${p.id}">${esc(p.fields['N° Pedido']||'—')} · ${esc(resolveClienteName(p.fields.Cliente))}</option>`).join('');if(orders.some(p=>p.id===selected))el.value=selected;}
function runCapacitySimulation(){
  fillCapacityOrders();const request=capacityInput(),loads={};(MAQUINAS||[]).forEach(m=>loads[m.id]=capacityLoadMinutes(m.id));
  const fleet=(MAQUINAS||[]).map(m=>({...m,operational:machineOperational(m)}));_lastCapacity=simulateCapacity(request,fleet,loads);
  const el=input('mopsCapacityResult');if(!el)return;if(!_lastCapacity.ok){el.innerHTML=`<div class="mops-alert danger">⚠ <span>${esc(_lastCapacity.reason)}</span></div>`;return;}
  const r=_lastCapacity,finish=new Date(r.promisedAt).toLocaleString('es-CL',{dateStyle:'medium',timeStyle:'short'}),col=r.feasible?'var(--accent3)':'var(--danger)';
  el.innerHTML=`<div class="mops-source-note warning"><b>Escenario, no promesa contractual.</b><span>Usa el tiempo por ciclo que ingresaste, la carga MachineOps y telemetría reciente. No inventa una “velocidad” distinta por modelo. QA no ocupa impresora y una impresión activa usa ETA restante cuando está disponible.</span></div>
    <div class="mops-kpis">${kpi('Ciclos',r.cycles,`${r.qty} unidades`)}${kpi('Máquinas',r.machinesUsed,'operativas + compatibles')}${kpi('Horas impresora',(r.totalPrinterMinutes/60).toFixed(1)+' h','tiempo ingresado + manipulación')}${kpi('Fin estimado',finish,r.feasible?'dentro del escenario':'excede fecha del escenario',col)}${kpi('Costo modelado',fmtMoney(r.totalCost),`${fmtMoney(r.materialCost)} material · ${fmtMoney(r.machineCost)} máquina`)}</div><div class="card" style="overflow-x:auto"><table class="mops-job-table" style="min-width:620px"><thead><tr><th>Máquina</th><th>Modelo</th><th>Ciclos</th><th>Unidades</th><th>Carga agregada</th></tr></thead><tbody>${r.assignments.map(a=>`<tr><td>${esc(machineLabel(a.machineId))}</td><td>${esc(a.model)}</td><td>${a.cycles}</td><td>${a.qty}</td><td>${fmtMin(a.minutes)}</td></tr>`).join('')}</tbody></table></div><div class="mops-alert ${r.feasible?'':'danger'}" style="margin-top:10px">${r.feasible?'✓':'🚨'} <span>${r.feasible?'El escenario entra antes de la fecha con el margen indicado. Valida G-code/tiempo real antes de comprometer entrega.':'El escenario excede la fecha límite. Ajusta carga, tiempo por ciclo o entrega.'}</span></div>`;
}
// Resumen compacto para el Calendario. Usa los trabajos planificados reales del
// pedido y la carga/ETA viva de la flota; si aún no hay trabajos, devuelve
// "unknown" en vez de inventar una promesa.
function deadlineCapacityRisk(pedidoId,dueDate){
  if(!dueDate)return{status:'unknown',feasible:null,message:'Sin fecha de entrega comprometida.'};
  const target=data().jobs.filter(j=>j.pedidoId===pedidoId&&!j.archived&&!['terminado','cancelado','fallido'].includes(j.status));
  if(!target.length)return{status:'unknown',feasible:null,message:'Capacidad sin calcular: el pedido todavía no tiene trabajos planificados en Máquinas.'};
  const loads=new Map();(MAQUINAS||[]).forEach(m=>{const queue=activeJobs().filter(j=>j.pedidoId!==pedidoId&&j.machineId===m.id).reduce((s,j)=>s+jobMinutes(j),0),eta=liveState(m.id)==='printing'?num(_printerStatus[m.id]?.eta)/60:0;loads.set(m.id,queue+eta);});
  let blocked='';const targetMachines=new Set();for(const job of target.slice().sort((a,b)=>dueUrgency(a)-dueUrgency(b))){
    const remaining=Math.max(1,Math.max(0,num(job.cycles,1)-num(job.completedCycles))*Math.max(1,num(job.minutesPerCycle,60)));
    let machine=job.machineId?getMachine(job.machineId):null;if(!machine||!machineOperational(machine)||!modelCanRun(machine.modelo,job)){const pick=pickMachine(job,loads);machine=pick?.machine||null;}
    if(!machine){blocked=`Sin impresora operativa compatible para ${job.name||'un trabajo'}.`;break;}
    loads.set(machine.id,(loads.get(machine.id)||0)+remaining);targetMachines.add(machine.id);
  }
  if(blocked)return{status:'risk',feasible:false,message:'🚨 '+blocked};
  const used=[...targetMachines].map(id=>loads.get(id)||0),finishMinutes=used.length?Math.max(...used):0,promised=new Date(Date.now()+finishMinutes*1.15*60000),due=new Date(String(dueDate).slice(0,10)+'T18:00:00'),feasible=promised<=due;
  return{status:feasible?'ok':'risk',feasible,promisedAt:promised.toISOString(),finishMinutes,message:feasible?`✅ La planificación actual termina aprox. ${promised.toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}, antes de la entrega.`:`🚨 La planificación actual termina aprox. ${promised.toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}, después de la fecha comprometida.`};
}
function createCapacityJobs(){
  if(!_lastCapacity?.ok){toast('Ejecuta primero la simulación','error');return;}const req=capacityInput();if(!req.name){toast('Escribe un nombre para el lote','error');return;}
  if(!confirm(`Crear ${_lastCapacity.assignments.length} trabajo(s) planificados desde esta simulación?`))return;
  _lastCapacity.assignments.forEach((a,i)=>data().jobs.push({id:uid('job'),name:`${req.name} · lote ${i+1}`,pedidoId:req.pedidoId||'',qty:a.qty,unitsPerBed:Math.max(1,num(req.unitsPerBed,1)),cycles:a.cycles,
    minutesPerCycle:Math.max(1,num(req.minutesPerCycle,60)),material:req.material,color:'',grams:Math.round(num(req.grams)*a.qty/Math.max(1,num(req.qty))),nozzle:'0.4',sizeX:num(req.sizeX),sizeY:num(req.sizeY),sizeZ:num(req.sizeZ),
    dueDate:req.dueDate,priority:'normal',machineId:a.machineId,spoolId:'',profileId:'',gcodeFile:'',notes:'Creado desde simulador de capacidad',compatibleModels:[a.model],postStages:[],status:'planificado',createdAt:nowIso(),updatedAt:nowIso(),archived:false}));
  persist('Lote creado desde simulador de capacidad');toast('Trabajos creados y planificados ✓','success');showView('planificacion');
}

// ── Seguridad ambiental y compuerta de inicio ────────────────
function latestSafetyReading(){return data().safetyReadings.slice().sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0))[0]||null;}
function optionalMeasure(v){if(v===undefined||v===null||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function safetyDecision(config,reading,context={},nowMs=Date.now()){
  // "Fresco" = hay lectura, es reciente Y el sensor está EN LÍNEA. Un sensor
  // caído (online:false) no es dato confiable aunque su marca de tiempo sea
  // reciente. Antes `fresh` miraba solo el timestamp: una lectura caída se
  // trataba como fresca, así que se saltaban los chequeos de humo/temp/VOC (por
  // el `online!==false`) PERO también la red "lectura ausente o vencida" (que
  // depende de !fresh). Una lectura {online:false, smoke:true} no levantaba ni
  // el bloqueo de humo ni el aviso: el peligro se perdía. Tratando el sensor
  // caído como NO fresco, cae en la red de "ausente o vencida".
  const cfg={...DEFAULT_SAFETY,...(config||{})},blockers=[],warnings=[],fresh=!!reading&&reading.online!==false&&nowMs-Date.parse(reading.at||0)<=num(cfg.staleMinutes,10)*60000;
  if(fresh){
    if(reading.smoke===true)blockers.push('El sensor detecta humo.');
    if(reading.temperature==null)(cfg.enforce?blockers:warnings).push('Temperatura ambiental sin lectura.');
    else if(num(reading.temperature)>num(cfg.maxTemperature))blockers.push(`Temperatura ambiental ${num(reading.temperature).toFixed(1)}°C sobre el máximo.`);
    if(reading.voc==null)(cfg.enforce?blockers:warnings).push('VOC sin lectura.');
    else if(num(reading.voc)>num(cfg.maxVoc))blockers.push(`VOC ${Math.round(num(reading.voc))} sobre el máximo configurado.`);
    if(reading.humidity==null)warnings.push('Humedad sin lectura.');
    else if(num(reading.humidity)>num(cfg.maxHumidity))warnings.push(`Humedad ${num(reading.humidity).toFixed(0)}%: aumenta el riesgo de filamento húmedo.`);
  }
  const unattended=!!context.unattended;
  if(unattended){
    if(cfg.cameraRequired&&!context.cameraConfigured)(cfg.enforce?blockers:warnings).push('Impresión larga/nocturna sin cámara configurada.');
    if((cfg.ventilationRequired||cfg.smokeRequired)&&!fresh)(cfg.enforce?blockers:warnings).push('Lectura ambiental ausente o vencida.');
    if(fresh&&cfg.ventilationRequired&&reading.ventilation!==true)(cfg.enforce?blockers:warnings).push('Ventilación no confirmada.');
    if(fresh&&cfg.smokeRequired&&typeof reading.smoke!=='boolean')(cfg.enforce?blockers:warnings).push('Sensor de humo no confirmado.');
  }
  return{ok:blockers.length===0,blockers,warnings,fresh,unattended};
}
function safetyContext(job,m){const hour=new Date().getHours(),long=jobMinutes(job)>=240,night=hour>=19||hour<9;let camera=false;try{camera=!!printerCamUrl(m.id);}catch(_){}return{unattended:long||night,long,night,cameraConfigured:camera};}
function checkSafetyBeforeStart(job,m,warningsConfirmed=false){
  const d=safetyDecision(data().safetyConfig,latestSafetyReading(),safetyContext(job,m));
  if(d.blockers.length){audit('Inicio bloqueado por seguridad',m.id,d.blockers.join(' '),'error');writeLocal();scheduleRemote();toast(d.blockers[0],'error');renderSafety();return false;}
  if(d.warnings.length&&!warningsConfirmed&&!confirm(`⚠ Revisión de seguridad\n\n${d.warnings.join('\n')}\n\n¿Confirmas que un operador revisó físicamente la máquina y desea continuar?`)){audit('Inicio cancelado por advertencia de seguridad',m.id,d.warnings.join(' '),'warn');writeLocal();scheduleRemote();return false;}
  if(d.warnings.length){audit('Excepción de seguridad confirmada',m.id,d.warnings.join(' '),'control');writeLocal();scheduleRemote();}return true;
}
function canAutoStart(id,secs=0){
  const m=getMachine(id),live=typeof _printerStatus!=='undefined'?_printerStatus[id]||{}:{},stateNow=live.state||'connecting';
  if(!machineOperational(m)||['connecting','offline','noip','shutdown','error','startup'].includes(stateNow)){audit('Auto-inicio detenido por conexión',id,live.connectionError||stateNow,'warn');writeLocal();scheduleRemote();toast('Cola detenida: no hay telemetría confiable','error');return false;}
  if(live.filament?.detected===false){audit('Auto-inicio detenido por filamento',id,'Sensor físico vacío','warn');writeLocal();scheduleRemote();toast('Cola detenida: la impresora no detecta filamento','error');return false;}
  try{if(getMaintAlerts(m).some(row=>row.hours>=row.threshold)){audit('Auto-inicio detenido por mantención',id,'Umbral vencido','warn');writeLocal();scheduleRemote();toast('Cola detenida: hay una mantención vencida','error');return false;}}catch(_){ }
  const dummy={cycles:1,minutesPerCycle:Math.max(1,num(secs)/60||300)},d=safetyDecision(data().safetyConfig,latestSafetyReading(),safetyContext(dummy,m));
  if(d.blockers.length||d.warnings.length){audit('Auto-inicio detenido por seguridad',id,[...d.blockers,...d.warnings].join(' '),'warn');writeLocal();scheduleRemote();toast('Cola detenida: requiere revisión de seguridad','error');renderSafety();return false;}return true;
}
function saveSafetyConfig(){
  const cfg=data().safetyConfig;cfg.enforce=!!input('mopsSafetyEnforce')?.checked;cfg.cameraRequired=!!input('mopsSafetyCamera')?.checked;cfg.ventilationRequired=!!input('mopsSafetyVent')?.checked;cfg.smokeRequired=!!input('mopsSafetySmoke')?.checked;
  cfg.maxTemperature=clamp(num(inputVal('mopsSafetyMaxTemp'),38),20,60);cfg.maxHumidity=clamp(num(inputVal('mopsSafetyMaxHumidity'),75),20,100);cfg.maxVoc=clamp(num(inputVal('mopsSafetyMaxVoc'),600),50,5000);
  const url=inputVal('mopsSafetyUrl').trim();if(url&&!/^https?:\/\//i.test(url)){toast('La URL del sensor debe comenzar con http:// o https://','error');return;}cfg.sensorUrl=url;cfg.updatedAt=Date.now();
  const token=inputVal('mopsSafetyToken').trim();if(token)sessionStorage.setItem('machine_ops_sensor_token',token);else sessionStorage.removeItem('machine_ops_sensor_token');persist('Configuración de seguridad actualizada');toast('Seguridad guardada ✓','success');
}
function recordSafetyReading(values,source='manual'){
  const bool=v=>v===undefined||v===null?undefined:v===true||v==='true'||v===1;
  const r={id:uid('safety'),at:nowIso(),temperature:optionalMeasure(values.temperature),humidity:optionalMeasure(values.humidity),voc:optionalMeasure(values.voc),smoke:bool(values.smoke),
    ventilation:bool(values.ventilation),online:values.online!==false,source,updatedAt:nowIso()};
  data().safetyReadings.unshift(r);if(data().safetyReadings.length>200)data().safetyReadings.length=200;persist('Lectura ambiental registrada');return r;
}
function recordSafetyManual(){
  const temp=optionalMeasure(inputVal('mopsSafetyTemp')),hum=optionalMeasure(inputVal('mopsSafetyHumidity')),voc=optionalMeasure(inputVal('mopsSafetyVoc'));
  if(temp==null||hum==null||voc==null){toast('Completa temperatura, humedad y VOC antes de registrar una lectura manual','error');return;}
  if(temp<0||temp>60||hum<0||hum>100||voc<0||voc>10000){toast('Lectura manual fuera de rango razonable; revísala antes de guardar','error');return;}
  recordSafetyReading({temperature:temp,humidity:hum,voc,smoke:input('mopsSafetySmokeNow')?.checked,ventilation:input('mopsSafetyVentNow')?.checked},'manual');
  toast('Lectura manual guardada como declaración del operador ✓','success');
}
async function refreshSafety(){
  const url=data().safetyConfig.sensorUrl;if(!url){toast('Configura la URL del sensor o registra una lectura manual','info');return;}
  try{const token=sessionStorage.getItem('machine_ops_sensor_token')||'',r=await fetch(url,{headers:token?{'Authorization':'Bearer '+token}:{},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();recordSafetyReading(d,'sensor');toast('Sensores actualizados ✓','success');}
  catch(e){audit('Sensor ambiental sin respuesta','',e.message,'error');writeLocal();scheduleRemote();toast('No se pudo leer el sensor: '+e.message,'error');renderSafety();}
}
function renderSafety(){
  const el=input('mopsSafety');if(!el)return;const cfg=data().safetyConfig,r=latestSafetyReading();
  // La cámara se valida por IMPRESORA en el preflight. Aquí se evalúa sólo el
  // ambiente del taller; antes “alguna cámara configurada” podía hacer parecer
  // satisfecha una condición que no correspondía a todas las máquinas.
  const decision=safetyDecision(cfg,r,{unattended:true,cameraConfigured:true});
  if(input('mopsSafetyEnforce'))input('mopsSafetyEnforce').checked=!!cfg.enforce;if(input('mopsSafetyCamera'))input('mopsSafetyCamera').checked=!!cfg.cameraRequired;if(input('mopsSafetyVent'))input('mopsSafetyVent').checked=!!cfg.ventilationRequired;if(input('mopsSafetySmoke'))input('mopsSafetySmoke').checked=!!cfg.smokeRequired;
  setVal('mopsSafetyMaxTemp',cfg.maxTemperature);setVal('mopsSafetyMaxHumidity',cfg.maxHumidity);setVal('mopsSafetyMaxVoc',cfg.maxVoc);setVal('mopsSafetyUrl',cfg.sensorUrl);setVal('mopsSafetyToken',sessionStorage.getItem('machine_ops_sensor_token')||'');
  const age=r?Math.max(0,Math.round((Date.now()-Date.parse(r.at))/60000)):null;
  const state=!r?'SIN DATOS':!decision.fresh?'LECTURA VENCIDA':decision.blockers.length?'BLOQUEADO':decision.warnings.length?'REVISAR':'SEGURO';
  const col=!r||!decision.fresh?'var(--warn)':decision.blockers.length?'var(--danger)':decision.warnings.length?'var(--warn)':'var(--accent3)';
  const measure=(v,suffix='')=>v==null?'—':num(v).toFixed(suffix===' °C'?1:0)+suffix;
  el.innerHTML=`<div class="mops-kpis">${kpi('Ambiente',state,r?`${esc(r.source||'registro')} · hace ${age} min`:'sin lectura',col)}${kpi('Temperatura',measure(r?.temperature,' °C'),`máx. ${cfg.maxTemperature} °C`)}${kpi('Humedad',measure(r?.humidity,' %'),`máx. ${cfg.maxHumidity}%`)}${kpi('VOC',r?.voc==null?'—':Math.round(num(r.voc)),`máx. ${cfg.maxVoc}`)}${kpi('Ventilación',r?(r.ventilation===true?'ACTIVA':r.ventilation===false?'NO CONFIRMADA':'—'):'—','lectura ambiental',r?.ventilation===true?'var(--accent3)':'var(--warn)')}${kpi('Humo',r?(r.smoke===true?'DETECTADO':r.smoke===false?'normal':'—'):'—','lectura ambiental',r?.smoke===true?'var(--danger)':'var(--accent3)')}</div>
  <div class="mops-source-note ${r?.source==='manual'?'warning':''}"><b>Fuente: ${r?esc(r.source||'desconocida'):'sin lectura'}.</b><span>${r?.source==='manual'?'Es una declaración del operador, no una medición automática. ':''}La cámara se comprueba por impresora durante el preflight; este bloque sólo representa el ambiente del taller.</span></div>
  ${[...decision.blockers,...decision.warnings].length?`<div style="display:grid;gap:7px;margin-bottom:12px">${decision.blockers.map(x=>`<div class="mops-alert danger">🚨 <span>${esc(x)}</span></div>`).join('')}${decision.warnings.map(x=>`<div class="mops-alert warn">⚠ <span>${esc(x)}</span></div>`).join('')}</div>`:''}`;
}
function maintenanceThreshold(machineId,type){
  const m=getMachine(machineId),model=m?.modelo||'K1';
  return num(data().maintenanceProfiles?.[model]?.[type],DEFAULT_MAINT[model]?.[type]||100);
}
function updateMaintProfile(model,type,value){
  if(!MODELS.includes(model)||!MAINT_KEYS.includes(type))return;
  if(!data().maintenanceProfiles[model])data().maintenanceProfiles[model]={...DEFAULT_MAINT[model]};
  data().maintenanceProfiles[model][type]=clamp(num(value,DEFAULT_MAINT[model][type]),10,5000);
  persist('Perfil de mantención actualizado');try{renderMaintenanceTable();}catch(_){}
}
function renderMaintenanceProfiles(){
  const el=document.getElementById('mopsMaintenanceProfiles');if(!el)return;
  const labels={nozzle:'Nozzle',lubrication:'Lubricación',belt:'Correas',extruder:'Extrusor',bed:'Cama',sensors:'Sensores',general:'General'};
  el.innerHTML=`<div class="card" style="overflow-x:auto"><div style="padding:11px 13px 5px;font-size:10.5px;font-weight:700;color:var(--text3)">UMBRALES POR MODELO · HORAS DE IMPRESIÓN</div><table class="mops-job-table" style="min-width:900px"><thead><tr><th>Modelo</th>${MAINT_KEYS.map(t=>`<th>${labels[t]}</th>`).join('')}</tr></thead><tbody>${MODELS.map(model=>{
    const p=data().maintenanceProfiles[model]||DEFAULT_MAINT[model];
    return`<tr><td><b style="color:${MODELO_COLORES?.[model]||'var(--text)'}">${esc(model)}</b></td>${MAINT_KEYS.map(t=>`<td><input type="number" min="10" max="5000" value="${num(p[t])}" onchange="MachineOps.updateMaintProfile('${esc(model)}','${t}',this.value)" style="width:72px;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;padding:4px 6px;color:var(--text);font-size:10.5px"> h</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderAnalytics(){
  const el=document.getElementById('mopsAnalytics');if(!el)return;
  const qa=data().qa,approved=qa.filter(q=>q.result!=='fallido').length,failed=qa.filter(q=>q.result==='fallido').length;
  const success=qa.length?approved/qa.length*100:null,waste=qa.reduce((s,q)=>s+num(q.wasteGrams),0);
  const completed=data().jobs.filter(j=>j.status==='terminado'||j.status==='fallido');
  const measured=completed.filter(j=>num(j.actualMinutes)>0),est=measured.reduce((s,j)=>s+jobMinutes(j),0),actual=measured.reduce((s,j)=>s+num(j.actualMinutes),0);
  const accuracy=est&&actual?Math.max(0,100-Math.abs(actual-est)/est*100):null;
  const jobProdCost=j=>['terminado','fallido'].includes(j.status)?jobCostBreakdown(j).total:0;
  const allocatedRevenue=j=>{
    const p=state.pedidosById?.[j.pedidoId],net=num(p?.fields?.['Monto total (CLP)'])/1.19;if(!net)return 0;
    const siblings=data().jobs.filter(x=>x.pedidoId===j.pedidoId&&!x.archived),total=Math.max(1,siblings.reduce((s,x)=>s+jobMinutes(x),0));
    return net*jobMinutes(j)/total;
  };
  const cost=completed.reduce((s,j)=>s+jobProdCost(j),0);
  const contribution=completed.reduce((s,j)=>s+allocatedRevenue(j)-jobProdCost(j),0);
  const linkedRevenueJobs=completed.filter(j=>num(state.pedidosById?.[j.pedidoId]?.fields?.['Monto total (CLP)'])>0).length;
  const machineRows=(MAQUINAS||[]).map(m=>{
    const mj=data().jobs.filter(j=>j.machineId===m.id),done=mj.filter(j=>j.status==='terminado').length,fail=mj.filter(j=>j.status==='fallido').length;
    const actualRows=mj.filter(j=>num(j.actualMinutes)>0),hours=actualRows.reduce((s,j)=>s+num(j.actualMinutes),0)/60;
    const grams=mj.reduce((s,j)=>s+num(j.materialConsumed),0);
    const prodCost=mj.reduce((s,j)=>s+jobProdCost(j),0),contrib=mj.reduce((s,j)=>s+allocatedRevenue(j)-jobProdCost(j),0);
    return{m,done,fail,hours,grams,prodCost,contrib,rate:(done+fail)?done/(done+fail)*100:null,actualCount:actualRows.length};
  }).sort((a,b)=>b.hours-a.hours);
  const pct=v=>v==null?'—':v.toFixed(1)+'%';
  el.innerHTML=`<div class="mops-source-note warning"><b>Analítica registrada, no contabilidad oficial.</b><span>Éxito QA sólo usa QA registrados; precisión ETA sólo trabajos con tiempo real medido. La contribución reparte la venta neta del pedido entre trabajos 3D según minutos, por lo que es una asignación estimada y puede incluir valor de diseño/postproducción.</span></div>
    <div class="mops-kpis">${kpi('Éxito QA',pct(success),qa.length?`${approved} aprobados · ${failed} fallidos`:'sin QA registrados',success==null?'var(--text3)':success<90?'var(--danger)':'var(--accent3)')}${kpi('Desperdicio',waste+' g',qa.length?'registrado en QA/fallas':'sin QA registrados',waste?'var(--warn)':'var(--text3)')}${kpi('Precisión ETA',accuracy==null?'—':accuracy.toFixed(0)+'%',measured.length?`${measured.length} trabajos con tiempo real`:'sin tiempos reales medidos',accuracy==null?'var(--text3)':'var(--text)')}${kpi('Costo modelado 3D',fmtMoney(cost),`${completed.length} trabajos cerrados`)}${kpi('Contribución asignada*',linkedRevenueJobs?fmtMoney(contribution):'—',linkedRevenueJobs?`${linkedRevenueJobs} trabajos con pedido valorizado`:'sin base de venta enlazada',linkedRevenueJobs&&contribution<0?'var(--danger)':'var(--text)')}</div>
    <div class="card" style="overflow-x:auto"><div style="padding:11px 13px 4px;font-size:10.5px;font-weight:700;color:var(--text3)">RENDIMIENTO POR IMPRESORA · SOLO DATOS REGISTRADOS</div><table class="mops-job-table" style="min-width:850px"><thead><tr><th>Máquina</th><th>Terminados</th><th>Fallidos</th><th>Tasa éxito</th><th>Horas reales</th><th>Material</th><th>Costo modelado</th><th>Contribución*</th></tr></thead><tbody>${machineRows.map(r=>`<tr><td><b style="color:var(--text)">${esc(r.m.nombre)} #${r.m.numG}</b><div style="font-size:10px;color:var(--text3)">${esc(r.m.modelo)}</div></td><td>${r.done}</td><td style="color:${r.fail?'var(--danger)':'var(--text2)'}">${r.fail}</td><td style="color:${r.rate==null?'var(--text3)':r.rate<90?'var(--danger)':'var(--accent3)'}">${r.rate==null?'—':r.rate.toFixed(0)+'%'}</td><td>${r.actualCount?r.hours.toFixed(1)+'h':'—'}</td><td>${Math.round(r.grams)}g</td><td>${fmtMoney(r.prodCost)}</td><td style="color:${r.contrib<0?'var(--danger)':'var(--text2)'}">${fmtMoney(r.contrib)}</td></tr>`).join('')}</tbody></table></div>
    <details class="mops-advanced-details"><summary>Auditoría operacional · ${data().audit.length} evento(s)</summary><div class="mops-audit-list">${data().audit.slice(0,40).map(a=>`<div class="mops-audit-row"><span>${new Date(a.at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}</span><b style="color:var(--text2)">${esc(a.actor)}</b><span>${esc(a.action)}${a.machineId?' · '+esc(machineLabel(a.machineId)):''}${a.detail?' · '+esc(a.detail):''}</span></div>`).join('')||'<div style="color:var(--text3);font-size:10.5px">Sin acciones registradas</div>'}</div></details>`;
}
// Con tres pantallas, cada contador suma lo que hay pendiente dentro de ella.
// Los identificadores de las áreas viejas se conservan: setText ignora los que
// ya no existen en el DOM, y así los contadores antiguos no dejan huecos.
function updateNavCounts(){
  setText('mopsNavPending',activeJobs().length);
  setText('mopsNavSpools',data().spools.filter(s=>!s.archived&&spoolAvailable(s)>0).length);
  setText('mopsNavQa',data().jobs.filter(j=>!j.archived&&j.status==='qa').length);
  setText('mopsNavPost',data().workflows.filter(w=>!w.archived&&w.status!=='done').length);
  const sd=safetyDecision(data().safetyConfig,latestSafetyReading(),{unattended:true,cameraConfigured:true});
  const safety=sd.blockers.length+sd.warnings.length;
  setText('mopsNavSafety',safety);
  let alerts=0;try{(MAQUINAS||[]).forEach(m=>alerts+=getMaintAlerts(m).length);}catch(_){}
  setText('mopsNavMaint',alerts);
  const smart=buildSmartAlerts();setText('mopsNavIntel',smart.length);
  const workshop=workshopSummary();
  setText('mopsNavTaller',alerts+safety+workshop.lowStock+workshop.invalidApproved);
}
function renderAll(){
  renderOpsOverview();renderIntelligence();renderAutomationConfig();renderPlanning();renderMaterials();renderQuality();renderPostProduction();renderProfiles();renderMaintenanceProfiles();renderAnalytics();renderSafety();fillCapacityOrders();renderWorkshopHome();updateNavCounts();
}

async function syncNow(){
  await loadRemote();await saveRemote();renderAll();toast('Centro de producción sincronizado ✓','success');
}

function findJobForPrint(machineId,filename){
  const candidates=data().jobs.filter(j=>j.machineId===machineId&&!j.archived&&['en_cola','planificado','pendiente','imprimiendo'].includes(j.status));
  const ranked=candidates.map(job=>({job,score:filenameMatchScore(job,filename)})).sort((a,b)=>b.score-a.score);
  if(ranked[0]?.score>=50)return ranked[0].job;
  const queued=candidates.filter(job=>job.status==='en_cola');return queued.length===1?queued[0]:null;
}
function handlePrinterTransition(m,s,previous){
  const progressInput=s.progressRaw??s.progress,progress=clamp(num(progressInput)*(num(progressInput)<=1?100:1),0,100),watch=_telemetryWatch[m.id]||{progress:null,unchangedAt:Date.now(),lastSeenAt:0};
  if(s.state==='offline'){if(!watch.offlineAt)watch.offlineAt=Date.now();}else watch.offlineAt=0;
  if(s.state==='printing'){
    if(watch.progress===null||Math.abs(progress-watch.progress)>=.2)watch.unchangedAt=Date.now();
    watch.progress=progress;watch.lastSeenAt=Date.now();
  }else{watch.progress=null;watch.unchangedAt=Date.now();}
  watch.state=s.state;_telemetryWatch[m.id]=watch;
  if(s.state==='printing'&&previous!=='printing'&&data().bedClearAcks?.[m.id]){
    delete data().bedClearAcks[m.id];writeLocal();scheduleRemote();
  }
  if(s.state==='printing'&&data().automation.enabled&&data().automation.autoLink){
    const active=data().jobs.find(x=>x.machineId===m.id&&!x.archived&&x.status==='imprimiendo'),j=active||findJobForPrint(m.id,s.filename);
    if(j&&j.status!=='imprimiendo'){j.status='imprimiendo';j.startedAt=j.startedAt||new Date(Date.now()-num(s.elapsed)*1000).toISOString();j.updatedAt=nowIso();persist('Trabajo detectado y vinculado por G-code',{render:true});}
  }
  if(['printing','paused'].includes(previous)&&s.state==='complete'){
    const j=data().jobs.find(x=>x.machineId===m.id&&!x.archived&&x.status==='imprimiendo');
    if(j){j.status='qa';j.completedAt=nowIso();j.actualMinutes=j.startedAt?Math.max(1,Math.round((Date.now()-Date.parse(j.startedAt))/60000)):jobMinutes(j);j.completedCycles=num(j.cycles,1);j.updatedAt=nowIso();persist('Impresión terminada; QA pendiente');}
  }
  if(['printing','paused'].includes(previous)&&s.state==='cancelled'){
    const j=data().jobs.find(x=>x.machineId===m.id&&!x.archived&&x.status==='imprimiendo');if(j){j.status='fallido';j.completedAt=nowIso();j.actualMinutes=j.startedAt?Math.max(1,Math.round((Date.now()-Date.parse(j.startedAt))/60000)):jobMinutes(j);j.updatedAt=nowIso();}
    if(data().automation.autoIncident)addIncident({machineId:m.id,jobId:j?.id||'',type:'cancelled',note:`Cancelación detectada${s.filename?' · '+s.filename:''}`,source:'telemetry'});
    persist('Cancelación detectada por telemetría');
  }
  if(['printing','paused'].includes(previous)&&['error','shutdown'].includes(s.state)&&data().automation.autoIncident){
    const j=data().jobs.find(x=>x.machineId===m.id&&!x.archived&&x.status==='imprimiendo');addIncident({machineId:m.id,jobId:j?.id||'',type:'electrical',note:s.klMsg||'Firmware o impresora detenida durante la producción',source:'telemetry'});persist('Falla de impresora detectada por telemetría');
  }
  if(_activeView==='inteligencia')renderIntelligence();
}
function reconcileFarmQueueJobs(rows=[]){
  let changed=false;
  for(const remote of (Array.isArray(rows)?rows:[])){
    const job=data().jobs.find(j=>!j.archived&&(j.farmJobId===remote.id||(j.executionId&&j.executionId===remote.idempotencyKey)))||null;
    if(!job)continue;
    const state=String(remote.state||'');
    const touch=(status)=>{
      if(job.status!==status){job.status=status;changed=true;}
      if(remote.startedAt&&!job.startedAt){job.startedAt=remote.startedAt;changed=true;}
      if(remote.id&&!job.farmJobId){job.farmJobId=remote.id;changed=true;}
      if(remote.idempotencyKey&&!job.executionId){job.executionId=remote.idempotencyKey;changed=true;}
      job.controllerState=state;job.controllerError=remote.lastError||'';job.updatedAt=nowIso();
    };
    if(['queued','retry','checking','uploading','uploaded','started','blocked'].includes(state))touch(job.status==='imprimiendo'?'imprimiendo':'en_cola');
    else if(['printing','paused'].includes(state))touch('imprimiendo');
    else if(state==='completed'){
      touch(job.status==='terminado'?'terminado':'qa');
      if(remote.completedAt&&!job.completedAt){job.completedAt=remote.completedAt;changed=true;}
      if(job.startedAt&&job.completedAt&&!job.actualMinutes){job.actualMinutes=Math.max(1,Math.round((Date.parse(job.completedAt)-Date.parse(job.startedAt))/60000));changed=true;}
    }else if(['cancelled','failed'].includes(state)){
      touch('fallido');if(remote.completedAt&&!job.completedAt){job.completedAt=remote.completedAt;changed=true;}
    }
  }
  if(changed){writeLocal();scheduleRemote();renderAll();}
  return changed;
}
function onLegacyQueueAdd(machineId,filename,secs,grams,meta={}){
  meta=meta&&typeof meta==='object'?meta:{};
  const existing=data().jobs.find(j=>!j.archived&&j.machineId===machineId&&j.gcodeFile===filename&&ACTIVE_JOB_STATES.includes(j.status));
  const machine=getMachine(machineId),material=String(meta.material||existing?.material||'PLA'),nozzle=String(meta.nozzle||existing?.nozzle||'0.4');
  const profileName=String(meta.profileName||'').trim();
  const profile=profileName?latestProfiles().find(p=>p.name===profileName&&(!p.model||p.model===(meta.model||machine?.modelo))&&(!p.material||p.material===material)&&(!p.nozzle||String(p.nozzle)===nozzle)):null;
  const patch={
    name:String(meta.name||existing?.name||filename||'Trabajo de slicer').replace(/\.(gcode|3mf)$/i,''),machineId,
    minutesPerCycle:Math.max(1,Math.round(num(meta.secs,secs||3600)/60)),material,color:String(meta.color||existing?.color||''),
    grams:Math.max(0,num(meta.grams,grams)),nozzle,sizeX:Math.max(0,num(meta.sizeX)),sizeY:Math.max(0,num(meta.sizeY)),sizeZ:Math.max(0,num(meta.sizeZ)),
    profileId:profile?.id||existing?.profileId||'',gcodeFile:filename||existing?.gcodeFile||'',
    compatibleModels:[meta.model||machine?.modelo].filter(Boolean),slicerMeta:{source:meta.source||'slicer3d',params:meta.params||{},mesh:meta.mesh||{}},
    updatedAt:nowIso()
  };
  if(existing){Object.assign(existing,patch);persist('Metadata de trabajo actualizada desde laminador');return existing;}
  const job={id:uid('job'),pedidoId:'',qty:1,unitsPerBed:1,cycles:1,spoolId:'',status:'en_cola',priority:'normal',
    createdAt:nowIso(),updatedAt:nowIso(),archived:false,...patch};
  data().jobs.push(job);persist('Trabajo importado desde cola de laminado');return job;
}
function startUploadedSlicerJob(meta={}){
  const machineId=String(meta.machineId||''),filename=String(meta.gcodeFile||meta.filename||'');
  if(!machineId||!filename){toast('No se puede abrir preflight: falta impresora o archivo G-code','error');return false;}
  const job=onLegacyQueueAdd(machineId,filename,meta.secs,meta.grams,meta);
  if(!job)return false;
  job.status='en_cola';job.queuedAt=job.queuedAt||nowIso();job.updatedAt=nowIso();
  persist('G-code del laminador listo para preflight');
  openPreflight(job.id);
  return true;
}

function openQueueDb(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB)return reject(new Error('IndexedDB no disponible'));
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function persistLegacyQueue(id){
  try{const db=await openQueueDb();const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put({id,jobs:_printQueue[id]||[],updatedAt:Date.now()});await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}catch(e){console.warn('[MachineOps] cola local',e);}
}
async function restoreLegacyQueues(){
  try{
    const db=await openQueueDb();const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).getAll();
    const rows=await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result||[]);req.onerror=()=>rej(req.error);});
    rows.forEach(r=>{if(Array.isArray(r.jobs)&&r.jobs.length)_printQueue[r.id]=r.jobs;});db.close();
  }catch(e){console.warn('[MachineOps] restauración de cola',e);}
}

async function imageDataFromCamera(){
  const img=input('webcamModalImg');if(!img||!img.src)throw new Error('La cámara no tiene una imagen disponible');
  try{
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth||640;canvas.height=img.naturalHeight||480;
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.82);
  }catch(_){}
  const url=img.getAttribute('data-snap')||img.src;
  const r=await fetch(url,{signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error('No se pudo capturar el snapshot');
  const blob=await r.blob();return await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(blob);});
}
async function analyzeCamera(){
  const out=input('mopsCameraAiResult'),btn=input('mopsCameraAiBtn'),id=inputVal('webcamModalId'),m=getMachine(id);
  if(!out||!m)return;
  if(typeof _openaiFetch!=='function'||(typeof _openaiAvailable==='function'&&!_openaiAvailable())){toast('Configura OpenAI para analizar la cámara','error');return;}
  btn.disabled=true;btn.textContent='Analizando imagen…';out.style.display='block';out.textContent='Capturando un fotograma de la impresora…';
  try{
    const dataUrl=await imageDataFromCamera();
    const prompt=`Eres inspector de impresión 3D FDM. Analiza SOLO lo visible. Detecta spaghetti, warping, pieza desprendida, mala primera capa, acumulación en nozzle o impresión normal. Devuelve JSON estricto: {"risk":"low|medium|high","finding":"máximo 25 palabras","confidence":0-100,"recommendation":"máximo 25 palabras"}. No inventes si la imagen no permite evaluar.`;
    const r=await _openaiFetch('/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini',temperature:0,max_tokens:180,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:dataUrl,detail:'low'}}]}]})});
    if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error?.message||'OpenAI '+r.status);
    const d=await r.json();let raw=d.choices?.[0]?.message?.content||'{}';raw=raw.replace(/^```json\s*|```$/g,'').trim();const result=JSON.parse(raw);
    const risk=['low','medium','high'].includes(result.risk)?result.risk:'medium',col=risk==='high'?'var(--danger)':risk==='medium'?'var(--warn)':'var(--accent3)';
    out.innerHTML=`<div style="font-weight:800;color:${col};margin-bottom:5px">${risk==='high'?'🚨 Riesgo alto':risk==='medium'?'⚠ Revisar':'✅ Sin falla evidente'} · ${clamp(num(result.confidence),0,100)}%</div><div>${esc(result.finding)}</div><div style="color:var(--text3);margin-top:5px">${esc(result.recommendation)}</div>${risk==='high'&&liveState(id)==='printing'?`<button class="btn btn-ghost btn-sm" style="margin-top:9px;color:var(--warn)" onclick="MachineOps.pauseFromVision('${id}')">⏸ Pausar para inspección humana</button>`:''}`;
    audit('Análisis visual IA',id,`${risk} · ${result.finding}`,risk==='high'?'warn':'info');writeLocal();scheduleRemote();
  }catch(e){
    out.innerHTML=`<span style="color:var(--danger)">No se pudo analizar: ${esc(e.message)}</span><div style="color:var(--text3);margin-top:5px">Para streams MJPEG configura también una URL de snapshot con CORS o usa el bridge remoto.</div>`;
  }finally{btn.disabled=false;btn.textContent='✨ Analizar impresión con IA';}
}
function pauseFromVision(id){
  if(!confirm(`Pausar ${machineLabel(id)} para inspección humana? La IA no cancelará la impresión.`))return;
  audit('Pausa solicitada tras visión IA',id,'Confirmada por operador','control');writeLocal();scheduleRemote();printerControl(id,'pause');
}

// ── QR operacional: máquina → trabajo/rollo desde el móvil ───
let _scanStream=null,_scanTimer=null;
function directRoute(search){
  const qp=new URLSearchParams(search===undefined?location.search:search),legacyId=String(qp.get('machine')||'').trim();
  const type=String(qp.get('ops')||'').trim().toLowerCase(),id=String(qp.get('id')||'').trim();
  if(['machine','job','spool'].includes(type)&&id)return{tab:'maquinas',type,id};
  if(legacyId)return{tab:'maquinas',type:'machine',id:legacyId};
  return null;
}
function opsLink(type,id){
  const u=new URL(location.href);
  u.search='';u.hash='';
  u.searchParams.set('ops',String(type||'').toLowerCase());u.searchParams.set('id',id);u.hash='maquinas';
  return u.toString();
}
function techLink(id){return opsLink('machine',id);}
function entityInfo(type,id){
  if(type==='machine'){const m=getMachine(id);return m?{title:machineLabel(id),subtitle:m.modelo,link:opsLink(type,id)}:null;}
  if(type==='job'){const j=data().jobs.find(x=>x.id===id);return j?{title:j.name,subtitle:`${orderLabel(j.pedidoId)||'sin pedido'} · ${j.material||''} · ${j.qty||1} u`,link:opsLink(type,id)}:null;}
  if(type==='spool'){const s=data().spools.find(x=>x.id===id);return s?{title:s.name,subtitle:`${s.material} ${s.color||''} · ${Math.round(spoolAvailable(s))} g`,link:opsLink(type,id)}:null;}return null;
}
function printEntityLabel(type,id){
  const info=entityInfo(type,id);if(!info)return;const qr=`https://quickchart.io/qr?size=320&margin=1&text=${encodeURIComponent(info.link)}`;
  const w=window.open('','_blank','width=520,height=680');if(!w){toast('El navegador bloqueó la ventana de impresión','error');return;}
  w.document.write(`<!doctype html><html><head><title>Etiqueta ${esc(info.title)}</title><style>body{font-family:Arial;text-align:center;padding:28px;color:#111}.box{border:3px solid #111;border-radius:18px;padding:22px;display:inline-block}img{width:300px;height:300px}.name{font-size:26px;font-weight:800;margin:12px}.meta{font-size:16px;color:#444}.url{font-size:10px;max-width:330px;word-break:break-all;margin:10px auto}</style></head><body><div class="box"><img src="${qr}" onload="setTimeout(()=>window.print(),400)"><div class="name">${esc(info.title)}</div><div class="meta">${esc(info.subtitle)}</div><div class="url">${esc(info.link)}</div></div></body></html>`);w.document.close();audit('Etiqueta QR generada',type==='machine'?id:'',`${type} · ${info.title}`);writeLocal();scheduleRemote();
}
function parseScan(raw){
  const value=String(raw||'').trim();if(!value)return null;const compact=value.match(/^TLS:(MACHINE|JOB|SPOOL):(.+)$/i);if(compact)return{type:compact[1].toLowerCase(),id:compact[2]};
  try{const u=new URL(value,location.href),route=directRoute(u.search);if(route)return{type:route.type,id:route.id};}catch(_){}return null;
}
function handleScan(raw){
  const parsed=parseScan(raw);if(!parsed){toast('Código QR no reconocido','error');return false;}closeScanner();const machineId=sessionStorage.getItem('mops_scan_machine')||'';
  if(parsed.type==='machine'){if(!getMachine(parsed.id)){toast('Máquina no encontrada','error');return false;}sessionStorage.setItem('mops_scan_machine',parsed.id);audit('Máquina escaneada',parsed.id,'Contexto móvil');writeLocal();openTech(parsed.id);return true;}
  if(parsed.type==='job'){const j=data().jobs.find(x=>x.id===parsed.id);if(!j){toast('Trabajo no encontrado','error');return false;}if(machineId&&getMachine(machineId)&&confirm(`Asignar ${j.name} a ${machineLabel(machineId)}?`)){const m=getMachine(machineId);if(!modelCanRun(m.modelo,j)){toast('La máquina escaneada no es compatible','error');return false;}j.machineId=machineId;if(j.status==='pendiente')j.status='planificado';j.updatedAt=nowIso();persist('Trabajo asignado por QR');toast('Trabajo asignado ✓','success');showView('planificacion');return true;}openJob(j.id);return true;}
  const s=data().spools.find(x=>x.id===parsed.id);if(!s){toast('Rollo no encontrado','error');return false;}if(machineId&&getMachine(machineId)&&confirm(`Cargar ${s.name} en ${machineLabel(machineId)}?`)){data().spools.filter(x=>x.machineId===machineId&&x.id!==s.id).forEach(x=>{x.machineId='';x.updatedAt=nowIso();});s.machineId=machineId;s.updatedAt=nowIso();persist('Rollo cargado por QR');toast('Rollo cargado ✓','success');showView('materiales');return true;}openSpool(s.id);return true;
}
async function openScanner(){
  input('mopsScannerModal').style.display='flex';setVal('mopsScanInput','');setText('mopsScanStatus','Apunta la cámara al QR o pega el código manualmente.');
  const video=input('mopsScanVideo');if(!navigator.mediaDevices?.getUserMedia||typeof BarcodeDetector==='undefined'){video.style.display='none';setText('mopsScanStatus','Este navegador no ofrece lector QR directo. Usa el campo manual.');return;}
  try{_scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});video.srcObject=_scanStream;video.style.display='block';await video.play();const detector=new BarcodeDetector({formats:['qr_code']});
    _scanTimer=setInterval(async()=>{try{const codes=await detector.detect(video);if(codes[0]?.rawValue)handleScan(codes[0].rawValue);}catch(_){}},500);
  }catch(e){video.style.display='none';setText('mopsScanStatus','No se pudo abrir la cámara. Puedes pegar el código manualmente.');}
}
function closeScanner(){if(_scanTimer){clearInterval(_scanTimer);_scanTimer=null;}if(_scanStream){_scanStream.getTracks().forEach(t=>t.stop());_scanStream=null;}const modal=input('mopsScannerModal');if(modal)modal.style.display='none';}
function submitScan(){handleScan(inputVal('mopsScanInput'));}
function clearScanMachine(){sessionStorage.removeItem('mops_scan_machine');toast('Contexto de máquina limpiado','info');}

function techLiveFacts(live,now=Date.now()){
  const row=live&&typeof live==='object'?live:{},state=row.state||'connecting';
  const connecting=state==='connecting',disconnected=state==='offline'||state==='noip';
  const active=state==='printing'||state==='paused',stale=!!row.stale;
  const hasTelemetry=!connecting&&!disconnected;
  const canClaimIdle=hasTelemetry&&!active&&!['error','shutdown','startup'].includes(state);
  const seenAt=num(row.lastSeenAt||row.updatedAt||0),ageMs=seenAt?Math.max(0,now-seenAt):null;
  return{state,connecting,disconnected,active,stale,hasTelemetry,canClaimIdle,seenAt,ageMs};
}
function techSeenText(live){
  const ts=num(live?.lastSeenAt||live?.updatedAt||0);
  if(typeof fmtPrinterSeen==='function')return fmtPrinterSeen(ts);
  if(!ts)return'Sin lectura previa';const min=Math.max(0,Math.floor((Date.now()-ts)/60000));return min<1?'Actualizado ahora':`Última lectura hace ${min} min`;
}
function techFilamentSummary(live,spool){
  const ft=live?.filament;
  if(ft&&ft.detected!==null){
    const source=ft.cfsConnected?`CFS${ft.cfsSlots?.length?' · '+ft.cfsSlots.length+' slots':''}`:ft.source==='rack'?'Portarrollos externo':'Sensor de filamento';
    return{value:ft.detected?'Detectado':'Vacío',sub:`${source}${Number.isFinite(ft.chamber)?' · cámara '+ft.chamber+'°':''}`,color:ft.detected?'var(--accent3)':'var(--warn)',telemetry:true};
  }
  if(spool){const free=Math.round(spoolAvailable(spool));return{value:free+' g',sub:`Inventario asignado · ${spool.material} ${spool.color||''}`.trim(),color:free<150?'var(--warn)':'var(--accent3)',telemetry:false};}
  return{value:'Sin datos',sub:'sin sensor ni inventario asignado',color:'var(--text3)',telemetry:false};
}
function bindTechStatusListener(){
  if(_techStatusListenerBound||typeof window.addEventListener!=='function')return;
  _techStatusListenerBound=true;
  window.addEventListener('printerstatus',event=>{
    const id=String(event?.detail?.id||''),modal=input('mopsTechModal');
    if(!id||!modal||modal.style.display==='none'||inputVal('mopsTechId')!==id)return;
    const card=modal.querySelector?.('.modal-card'),scrollTop=card?.scrollTop||0;
    openTech(id,{autoRefresh:false});
    if(card){const restore=()=>{card.scrollTop=scrollTop;};if(typeof requestAnimationFrame==='function')requestAnimationFrame(restore);else setTimeout(restore,0);}
  });
}
async function refreshTechStatus(id,button,auto=false){
  const m=getMachine(id);if(!m||_techRefreshPending[id])return false;
  if(typeof fetchPrinterStatus!=='function'||typeof _applyStatus!=='function')return false;
  _techRefreshPending[id]=true;if(button){button.disabled=true;button.textContent='…';}
  try{
    const status=await fetchPrinterStatus(m);_applyStatus(m,status);
    if(!auto)toast(status?._fetchFail?'No se recibió telemetría · '+(status.connectionError||'revisa la conexión'):'Telemetría actualizada',status?._fetchFail?'info':'success');
    return !status?._fetchFail;
  }finally{
    delete _techRefreshPending[id];
    if(button){button.disabled=false;button.textContent='↻';}
  }
}

function openTech(id,{autoRefresh=true}={}){
  sessionStorage.setItem('mops_scan_machine',id);
  const m=getMachine(id);if(!m)return;
  setVal('mopsTechId',id);setText('mopsTechTitle',`${m.nombre} #${m.numG}`);
  const cap=machineCapabilities(m),jobs=jobsForMachine(id).sort((a,b)=>dueUrgency(a)-dueUrgency(b)),spool=data().spools.find(s=>s.machineId===id&&!s.archived&&s.status!=='agotado');
  let live=null,hasLiveStatus=false;try{hasLiveStatus=Object.prototype.hasOwnProperty.call(_printerStatus,id);live=hasLiveStatus?_printerStatus[id]:null;}catch(_){ }
  const ip=typeof getPrinterIp==='function'?(getPrinterIp(m)||'Sin IP'):(m.ip||'Sin IP');
  if(!live)live={state:ip==='Sin IP'?'noip':'connecting',lastSeenAt:0};
  const facts=techLiveFacts(live),filamentSummary=techFilamentSummary(live,spool);
  const reliability=machineReliability(id),smartAlerts=machineAlertsFor(id);
  let maint=[];try{maint=getMaintAlerts(m);}catch(_){}
  let forecast=null;try{forecast=getMaintForecast(m);}catch(_){ }
  const link=techLink(id),qr=`https://quickchart.io/qr?size=180&margin=1&text=${encodeURIComponent(link)}`;
  let liveMeta=typeof printerStateMeta==='function'?printerStateMeta(live.state||'connecting'):{label:live.state||'Conectando…',color:'var(--text3)',bg:'var(--surface2)'};
  if(facts.stale)liveMeta={label:'Reconectando…',color:'var(--warn)',bg:'rgba(255,170,0,.08)'};
  const opMeta=typeof maquinaEstadoMeta==='function'?maquinaEstadoMeta(getMaquinaEstadoGlobal(id)):{label:getMaquinaEstadoGlobal(id),icon:'•'};
  const queueMinutes=jobs.reduce((sum,j)=>sum+jobMinutes(j),0),isPrinting=facts.active;
  const spoolFree=spool?Math.round(spoolAvailable(spool)):0,spoolPct=spool?clamp(spoolFree/Math.max(1,num(spool.initial,1000))*100,0,100):0;
  const lastAction=data().audit.find(row=>row.machineId===id&&row.action!=='Máquina escaneada');
  const queueHtml=jobs.length?jobs.slice(0,4).map((j,index)=>`<button class="mops-tech-job" onclick="MachineOps.closeTech();MachineOps.openJob('${j.id}')">
      <span class="mops-tech-job-order">${index===0?'SIGUIENTE':'#'+(index+1)}</span>
      <span class="mops-tech-job-main"><b>${esc(j.name)}</b><small>${esc(orderLabel(j.pedidoId)||'Sin pedido')} · ${esc(j.material||'Sin material')} · ${num(j.qty,1)} u</small></span>
      <span class="mops-tech-job-due">${esc(j.dueDate||'Sin fecha')}</span>
    </button>`).join(''):'<div class="mops-tech-empty">No hay trabajos asignados a esta máquina.</div>';
  const stateOptions=Object.entries(typeof MAQUINA_ESTADOS!=='undefined'?MAQUINA_ESTADOS:{disponible:{label:'Disponible'},mantencion:{label:'Mantención'}})
    .map(([k,v])=>`<option value="${esc(k)}"${getMaquinaEstadoGlobal(id)===k?' selected':''}>${esc(v.icon||'')} ${esc(v.label)}</option>`).join('');
  const progressValue=isPrinting?num(live.progress)+'%':facts.connecting?'…':facts.disconnected?'?':'—';
  const progressSub=isPrinting?(live.state==='paused'?'impresión pausada':'trabajo actual'):facts.connecting?'consultando impresora':facts.disconnected?'sin telemetría':live.state==='cancelled'?'última impresión cancelada':'sin impresión activa';
  const etaValue=isPrinting&&typeof fmtSecs==='function'?fmtSecs(live.eta):facts.connecting?'…':facts.disconnected?'?':'—';
  const etaSub=isPrinting?(live.filename||'archivo sin nombre'):facts.connecting?'esperando primera lectura':facts.disconnected?'no se puede confirmar':facts.canClaimIdle?'sin trabajo activo':'estado no disponible';
  const seenText=techSeenText(live);
  const connectionDetail=facts.connecting?(live.connectionError?`${live.connectionError} · reintento ${num(live.attempt,1)}/${typeof _OFFLINE_AFTER_FAILS==='number'?_OFFLINE_AFTER_FAILS:3}`:'Esperando la primera respuesta de Moonraker'):facts.stale?`Mostrando el último estado conocido · ${seenText}`:facts.disconnected?`${live.connectionError||'Moonraker no respondió'} · ${seenText}`:seenText;
  const tempHint=(num(live.hotend?.actual)>45||num(live.bed?.actual)>45)?` · Hotend ${num(live.hotend?.actual)}° / cama ${num(live.bed?.actual)}°`:'';
  let printStateHtml='';
  if(isPrinting)printStateHtml=`<section class="mops-tech-section mops-tech-print">
      <div class="mops-tech-section-title"><span>🖨 Impresión actual</span><b>${num(live.progress)}%</b></div>
      <div class="mops-tech-file">${esc(live.filename||'Archivo sin nombre')}</div>
      <div class="mops-tech-progress"><i style="width:${clamp(num(live.progress),0,100)}%;background:${liveMeta.color}"></i></div>
      <div class="mops-tech-live-values"><span>🔥 Hotend <b>${num(live.hotend?.actual)}°${num(live.hotend?.target)?' → '+num(live.hotend.target)+'°':''}</b></span><span>▦ Cama <b>${num(live.bed?.actual)}°${num(live.bed?.target)?' → '+num(live.bed.target)+'°':''}</b></span><span>⏱ Restante <b>${typeof fmtSecs==='function'?fmtSecs(live.eta):'—'}</b></span></div>
    </section>`;
  else if(facts.connecting)printStateHtml='<div class="mops-alert mops-tech-unknown" style="margin-top:12px">◌ <span><b>Consultando la impresora.</b> Aún no se puede confirmar si está libre o imprimiendo.</span></div>';
  else if(facts.disconnected)printStateHtml=`<div class="mops-alert warn" style="margin-top:12px">⚠ <span><b>Estado de impresión desconocido.</b> Sin telemetría no se asumirá que la máquina está libre.</span></div>`;
  else if(live.state==='shutdown'||live.state==='error')printStateHtml=`<div class="mops-alert danger" style="margin-top:12px">🚨 <span><b>La impresora requiere atención.</b> ${esc(live.klMsg||'Klipper reportó una detención.')}</span></div>`;
  else if(live.state==='cancelled')printStateHtml=`<div class="mops-alert warn" style="margin-top:12px">⏹ <span><b>La última impresión fue cancelada.</b> La máquina sigue en línea${esc(tempHint)}.</span></div>`;
  else if(live.state==='complete'){
    const cleared=bedIsCleared(id);
    printStateHtml=`<div class="mops-alert ${cleared?'':'warn'}" style="margin-top:12px">${cleared?'✅':'⚠'} <span><b>${cleared?'Cama liberada.':'Impresión finalizada · falta retirar la pieza.'}</b> ${cleared?'La máquina puede recibir el siguiente trabajo.':'No se considerará disponible hasta confirmarlo físicamente.'}${esc(tempHint)}.</span>${cleared?'':`<button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="MachineOps.confirmBedCleared('${id}')">✓ Confirmar cama libre</button>`}</div>`;
  }
  else printStateHtml='<div class="mops-alert" style="margin-top:12px">✅ <span><b>En línea y sin impresión activa.</b> Puedes asignar el siguiente trabajo.</span></div>';
  const ft=live.filament;
  const cfsSlots=ft?.cfsSlots?.length?`<div class="mops-tech-slots">${ft.cfsSlots.map(slot=>`<span>${slot.color?`<i style="background:${cssColor(slot.color)}"></i>`:''}<b>${esc(slot.slot)}</b>${slot.material?' · '+esc(slot.material):''}${Number.isFinite(slot.remain)?' · '+Math.round(slot.remain)+' restante':''}</span>`).join('')}</div>`:'';
  const liveMaterial=ft?`<div class="mops-tech-sensor ${ft.detected===false?'warn':''}"><b>${ft.detected===true?'✅ Filamento detectado':ft.detected===false?'⚠ Sin filamento detectado':'◌ Sensor sin lectura'}</b><span>${ft.cfsConnected?'CFS conectado':ft.source==='rack'?'Portarrollos externo':'Sensor de la impresora'}${Number.isFinite(ft.chamber)?' · cámara '+ft.chamber+'°':''}</span>${cfsSlots}</div>`:'<div class="mops-tech-empty">Esta impresora no entregó sensores de filamento en la última lectura.</div>';
  const smartAlertsHtml=smartAlerts.length?`<section class="mops-tech-section"><div class="mops-tech-section-title"><span>🚨 Atención requerida</span><b style="color:${smartAlerts.some(row=>row.severity==='critical')?'var(--danger)':'var(--warn)'}">${smartAlerts.length}</b></div>${smartAlerts.slice(0,4).map(row=>`<div class="mops-alert ${row.severity==='critical'?'danger':'warn'}" style="margin-top:5px"><span>${row.severity==='critical'?'🚨':'⚠'}</span><span><b>${esc(row.title)}</b><br>${esc(row.detail)}</span></div>`).join('')}</section>`:'';
  input('mopsTechBody').innerHTML=`<div class="mops-tech-status" style="--tech-color:${liveMeta.color};--tech-bg:${liveMeta.bg}">
      <span class="pdot${isPrinting?' live':''}"></span>
      <span class="mops-tech-status-block"><small>Conectividad</small><b>${esc(liveMeta.label)}</b></span>
      <span class="mops-tech-network">${esc(ip)}<small>${esc(connectionDetail)}</small></span>
      <span class="mops-tech-op"><small>Estado operacional</small>${esc(opMeta.icon||'')} ${esc(opMeta.label||'')}</span>
      <button class="mops-tech-refresh" onclick="MachineOps.refreshTechStatus('${id}',this)" aria-label="Actualizar telemetría" title="Actualizar telemetría">↻</button>
    </div>
    <div class="mops-tech-layout">
      <aside class="mops-tech-qr-panel">
        <img src="${qr}" alt="QR ficha ${esc(m.nombre)}" width="160" height="160">
        <b>${esc(machineLabel(id))}</b>
        <span>${esc(m.modelo)} · ID ${esc(id)}</span>
        <button class="btn btn-primary btn-sm" onclick="MachineOps.copyTechLink(this)">📡 Copiar enlace NFC</button>
        <small>Graba este enlace en un NFC o usa el QR como respaldo.</small>
      </aside>
      <div class="mops-tech-main">
        <div class="mops-kpis mops-tech-kpis">
          ${kpi('Progreso',progressValue,progressSub,isPrinting?liveMeta.color:'var(--text3)')}
          ${kpi('Tiempo restante',etaValue,etaSub)}
          ${kpi('Trabajos planificados',jobs.length,fmtMin(queueMinutes),jobs.length?'var(--accent4)':'var(--accent3)')}
          ${kpi('Filamento',filamentSummary.value,filamentSummary.sub,filamentSummary.color)}
          ${kpi('Fiabilidad',reliability.completion==null?reliability.label:reliability.completion.toFixed(0)+'%',reliability.history.total?`${reliability.history.completed} correctos · ${reliability.history.notCompleted} fallidos · confianza ${reliability.confidence}`:`${reliability.label} · confianza ${reliability.confidence}`,reliability.level==='critical'?'var(--danger)':reliability.level==='warning'?'var(--warn)':reliability.level==='ok'?'var(--accent3)':'var(--text3)')}
        </div>
        <div class="field-group"><label class="field-label">Estado operacional</label><select class="field-select" onchange="MachineOps.setMachineStatus('${id}',this.value)">${stateOptions}</select></div>
        <div class="mops-tech-spec">${esc(m.modelo)} · cama ${esc(cap.bed.join('×'))} mm · materiales: ${esc(cap.materials.join(', '))}</div>
      </div>
    </div>
    ${printStateHtml}
    ${smartAlertsHtml}
    <section class="mops-tech-section">
      <div class="mops-tech-section-title"><span>🗓 Trabajos asignados</span><b>${jobs.length}</b></div>
      <div class="mops-tech-jobs">${queueHtml}</div>
    </section>
    <section class="mops-tech-section mops-tech-two-col">
      <div>
        <div class="mops-tech-section-title"><span>🧵 Material y sensores</span></div>
        ${liveMaterial}
        ${spool?`<div class="mops-tech-material mops-tech-inventory"><b>Inventario · ${esc(spool.name)}</b><span>${esc(spool.material)} · ${esc(spool.color||'Sin color')}${spool.slot?' · slot '+esc(spool.slot):''}</span><div class="mops-spool-meter"><i style="width:${spoolPct}%;background:${spoolFree<150?'var(--warn)':'var(--accent3)'}"></i></div><small>${spoolFree} g disponibles · ${Math.round(num(spool.remaining))} g físicos</small></div>`:'<div class="mops-tech-empty mops-tech-inventory-empty">Sin rollo vinculado al inventario. Escanéalo para asociarlo.</div>'}
      </div>
      <div>
        <div class="mops-tech-section-title"><span>🔧 Mantención</span><b style="color:${maint.length?'var(--warn)':'var(--accent3)'}">${maint.length?maint.length+' alerta'+(maint.length!==1?'s':''):'Al día'}</b></div>
        ${maint.length?`<div class="mops-alert warn">⚠ <span>${maint.map(a=>`<b>${esc(a.label)}</b> · ${Math.round(a.hours)}/${a.threshold} h`).join('<br>')}</span></div>`:`<div class="mops-tech-empty">${forecast&&isFinite(forecast.weeks)?`Próxima: ${esc(forecast.tipo)} en aproximadamente ${Math.max(0,forecast.weeks).toFixed(1)} semanas.`:'Sin alertas de mantenimiento.'}</div>`}
      </div>
    </section>
    <div class="mops-tech-meta">${lastAction?`Última actividad: <b>${esc(lastAction.action)}</b> · ${esc(fmtStamp(lastAction.at))} · ${esc(lastAction.actor)}`:'Sin actividad registrada todavía.'}</div>
    <div class="mops-tech-actions">
      <button class="btn btn-primary btn-sm" onclick="MachineOps.closeTech();MachineOps.openScanner()">▦ Escanear trabajo/rollo</button>
      ${typeof togglePrinterLight==='function'?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.toggleTechLight('${id}',this)">💡 Luz LED</button>`:''}
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();openWebcamModal('${id}')">📷 Cámara</button>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();openHistoryModal('${id}')">📋 Historial</button>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();openMaintModal('${id}')">🔧 Mantención</button>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();MachineOps.openIncident('${id}')">🧰 Incidente</button>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();openPrinterConnModal('${id}')">⚙ Conexión</button>
      <button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();MachineOps.showView('planificacion')">🗓 Planificación</button>
    </div>`;
  input('mopsTechModal').style.display='flex';
  bindTechStatusListener();
  if(autoRefresh&&!_techRefreshPending[id])refreshTechStatus(id,null,true);
}
function closeTech(){input('mopsTechModal').style.display='none';}
async function setMachineStatus(id,status){
  const m=getMachine(id);if(!m||!(status in MAQUINA_ESTADOS))return;
  const previous=getMaquinaEstadoGlobal(id);
  if(status==='disponible'&&previous!=='disponible'&&!confirm(`¿Marcar ${machineLabel(id)} como DISPONIBLE?\n\nConfirma que fue revisada físicamente y no está esperando repuesto, calibración ni mantención.`)){openTech(id,{autoRefresh:false});return;}
  m.estado=status;audit('Estado operacional actualizado',id,maquinaEstadoMeta(status).label,'control');writeLocal();scheduleRemote();
  const synced=typeof _saveMachineStateReliable==='function'?await _saveMachineStateReliable(id,status):await saveMaquinaEstadoAirtable(id,status).then(()=>true).catch(()=>false);
  renderAll();try{renderMaquinasCalendar();renderMonitorGrid();}catch(_){}
  toast(`${machineLabel(id)} · ${maquinaEstadoMeta(status).label}${synced?'':' · pendiente de sincronizar'}`,synced?'success':'info');openTech(id,{autoRefresh:false});
}
async function copyTextSafe(value){
  const text=String(value||'');if(!text)return false;
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true;}catch(_){ }}
  let area=null;
  try{
    area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(area);area.select();area.setSelectionRange(0,text.length);
    if(document.execCommand?.('copy'))return true;
  }catch(_){
  }finally{if(area?.parentNode)area.parentNode.removeChild(area);}
  return false;
}
async function copyTechLinkFor(id,button){
  const m=getMachine(id);if(!m)return false;
  const link=techLink(id),copied=await copyTextSafe(link);
  if(!copied){window.prompt('Copia este enlace para grabarlo en el NFC:',link);toast('El navegador bloqueó el portapapeles; mantén presionado para copiar','info');return false;}
  audit('Enlace NFC/QR copiado',id,link);writeLocal();scheduleRemote();toast(`Enlace copiado · ${machineLabel(id)}`,'success');
  if(button){const old=button.textContent;button.textContent='✓ Copiado';button.disabled=true;setTimeout(()=>{button.textContent=old;button.disabled=false;},1400);}
  return true;
}
function copyTechLink(button){
  const id=inputVal('mopsTechId');if(!id)return false;
  return copyTechLinkFor(id,button);
}
async function toggleTechLight(id,button){
  if(typeof togglePrinterLight!=='function')return;
  try{await togglePrinterLight(id,button);}finally{if(button)button.disabled=false;openTech(id);}
}
function printTechLabel(){
  const id=inputVal('mopsTechId');if(id)printEntityLabel('machine',id);
}

async function init(){
  if(_initPromise)return _initPromise;
  _initPromise=(async()=>{
    data();await loadRemote();await restoreLegacyQueues();importLegacyProfiles();_initialized=true;
    // Un valor guardado del esquema anterior ('materiales', 'calidad'…) se
    // resuelve solo a su pantalla dentro de showView.
    _activeView=localStorage.getItem('machine_ops_view')||'hoy';showView(_activeView);renderAll();bindTechStatusListener();restartBridgeTimer();setTimeout(()=>checkBridgeHealth(true),600);
    const route=directRoute();
    if(route)setTimeout(()=>handleScan(opsLink(route.type,route.id)),120);
    if(data().safetyConfig.sensorUrl){setTimeout(refreshSafety,900);setInterval(()=>{if(!document.hidden)refreshSafety();},60000);}
  })();
  return _initPromise;
}

const api={
  init,showView,goToSection,renderAll,renderPlanning,setGanttFilter,setGanttFamily,openJob,closeJob,updateJobCycles,saveJob,planOne,autoPlan,enqueueJob,startJob,startExistingFile,archiveJob,
  openPreflight,closePreflight,confirmPreflight,
  openSpool,closeSpool,saveSpool,markSpoolEmpty,reconcileSpools,openQA,closeQA,toggleQAFailure,prefillQA,saveQA,
  renderPostProduction,advancePost,blockPost,
  renderProfiles,openProfile,closeProfile,saveProfile,setProfileStatus,archiveProfile,useProfile,captureSlicerProfile,exportProfile,importProfileFile,
  runCapacitySimulation,createCapacityJobs,deadlineCapacityRisk,
  saveSafetyConfig,recordSafetyManual,refreshSafety,renderSafety,canAutoStart,
  openScanner,closeScanner,submitScan,handleScan,clearScanMachine,printEntityLabel,
  updateMaintProfile,maintenanceThreshold,syncNow,analyzeCamera,pauseFromVision,
  renderIntelligence,machineAlertsFor,acknowledgeAlert,handleAlertAction,applyRecommendation,createJobFromLive,checkBridgeHealth,saveIntelligenceConfig,
  openIncident,refreshIncidentJobs,closeIncident,loadIncidentPhoto,saveIncident,resolveIncident,confirmIncident,dismissIncident,
  openTech,closeTech,refreshTechStatus,setMachineStatus,confirmBedCleared,copyTechLink,copyTechLinkFor,toggleTechLight,printTechLabel,
  directRoute,
  handlePrinterTransition,reconcileFarmQueueJobs,onLegacyQueueAdd,startUploadedSlicerJob,persistLegacyQueue,restoreLegacyQueues,
  _test:{defaultData,normalizeData,mergeData,modelCanRun,jobModels,jobMinutes,simulateCapacity,capacityLoadMinutes,safetyDecision,optionalMeasure,profileProductionCheck,workshopHistoryEvidence,parseScan,directRoute,opsLink,techLiveFacts,techFilamentSummary,fileKey,filenameMatchScore,preflightFromFacts,incidentIsConfirmed,printerHistoryEvidence,centralHealthEvidence,machineReliability,_incidentRowsForUi,machineHasCfs,_filamentPhysicalSummary,liveEvidence,farmQueueEvidence,farmQueueMatch,planningJobState,bedClearSignature,bedIsCleared,installedNozzle},
};
window.MachineOps=api;

// Integraciones con el monitor existente sin duplicar la lógica Moonraker.
if(typeof initMaquinas==='function'){
  const baseInit=initMaquinas;
  initMaquinas=async function(){await baseInit();await api.init();api.renderAll();};
}
if(typeof checkTransitions==='function'){
  const baseTransitions=checkTransitions;
  checkTransitions=function(m,s){const previous=_prevState[m.id];baseTransitions(m,s);api.handlePrinterTransition(m,s,previous);};
}
if(typeof printerControl==='function'){
  const baseControl=printerControl;
  printerControl=async function(id,action){audit('Control de impresora',id,action,'control');writeLocal();scheduleRemote();return baseControl(id,action);};
}
if(typeof printerFirmwareRestart==='function'){
  const baseRestart=printerFirmwareRestart;
  printerFirmwareRestart=async function(id){audit('Reinicio de firmware solicitado',id,'Klipper firmware_restart','control');writeLocal();scheduleRemote();return baseRestart(id);};
}
if(typeof _queueAdd==='function'){
  const baseQueueAdd=_queueAdd;
  _queueAdd=function(id,gcode,filename,secs,grams,meta={}){const r=baseQueueAdd(id,gcode,filename,secs,grams,meta);api.onLegacyQueueAdd(id,filename,secs,grams,meta);api.persistLegacyQueue(id);return r;};
}
if(typeof _queueRemove==='function'){
  const baseQueueRemove=_queueRemove;
  _queueRemove=function(id,idx){const r=baseQueueRemove(id,idx);api.persistLegacyQueue(id);return r;};
}
if(typeof _queueStartNext==='function'){
  const baseQueueStartNext=_queueStartNext;
  _queueStartNext=async function(id){const next=(_printQueue[id]||[])[0];if(!api.canAutoStart(id,next?.secs))return false;const r=await baseQueueStartNext(id);api.persistLegacyQueue(id);return r;};
}

})();
