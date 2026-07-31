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
  en_cola:{label:'En cola',color:'#ffaa00'},
  imprimiendo:{label:'Imprimiendo',color:'#00d4aa'},
  qa:{label:'Esperando QA',color:'#38bdf8'},
  terminado:{label:'Terminado',color:'#22c55e'},
  fallido:{label:'Fallido',color:'#ff4444'},
  archivado:{label:'Archivado',color:'#64748b'},
};
const MODEL_CAPS={
  'K1':{bed:[220,220,250],materials:['PLA','PLA+','PETG','TPU'],speed:1.22},
  'K2':{bed:[350,350,350],materials:['PLA','PLA+','PETG','ABS','ASA','TPU','PA','PA-CF','PETG-CF'],speed:1.18},
  'K2 Plus':{bed:[500,500,500],materials:['PLA','PLA+','PETG','ABS','ASA','TPU','PA','PA-CF','PETG-CF'],speed:1.12},
  'Ender-5 Max':{bed:[400,400,600],materials:['PLA','PLA+','PETG','TPU'],speed:.92},
  'Giga':{bed:[800,800,800],materials:['PLA','PLA+','PETG','TPU'],speed:.72},
};
const DEFAULT_MAINT={
  'K1':{'nozzle':180,'lubrication':90,'belt':450,'extruder':250,'bed':220,'sensors':500,'general':50},
  'K2':{'nozzle':220,'lubrication':110,'belt':550,'extruder':320,'bed':280,'sensors':650,'general':60},
  'K2 Plus':{'nozzle':220,'lubrication':100,'belt':500,'extruder':300,'bed':250,'sensors':600,'general':55},
  'Ender-5 Max':{'nozzle':200,'lubrication':80,'belt':400,'extruder':260,'bed':220,'sensors':500,'general':45},
  'Giga':{'nozzle':180,'lubrication':70,'belt':350,'extruder':240,'bed':180,'sensors':450,'general':40},
};
const MAINT_KEYS=['nozzle','lubrication','belt','extruder','bed','sensors','general'];

let _data=null,_remoteTimer=null,_initialized=false,_initPromise=null,_activeView='operacion';
const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>(p||'mops')+'-'+Date.now().toString(36)+'-'+(crypto.randomUUID?crypto.randomUUID().slice(0,8):Math.random().toString(36).slice(2,10));
const nowIso=()=>new Date().toISOString();
const num=(v,d=0)=>Number.isFinite(+v)?+v:d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cssColor=v=>/^(#[0-9a-f]{3,8}|[a-z]{1,20})$/i.test(String(v||'').trim())?String(v).trim():'#888';
const fmtMin=m=>{m=Math.max(0,Math.round(num(m)));const h=Math.floor(m/60),mm=m%60;return h?`${h}h ${mm}m`:`${mm}m`;};
const fmtMoney=v=>typeof formatCLP==='function'?formatCLP(Math.round(num(v))):'$'+Math.round(num(v)).toLocaleString('es-CL');
const dateValue=v=>v?new Date(v+'T12:00:00').getTime():Infinity;
const actor=()=>{try{const u=AUTH.getUser();return u?.name||u?.username||'Sistema';}catch(_){return'Sistema';}};

function defaultData(){
  return{version:2,updatedAt:0,jobs:[],spools:[],qa:[],audit:[],maintenanceProfiles:JSON.parse(JSON.stringify(DEFAULT_MAINT))};
}
function normalizeData(raw){
  const d={...defaultData(),...(raw&&typeof raw==='object'?raw:{})};
  d.jobs=Array.isArray(d.jobs)?d.jobs:[];
  d.spools=Array.isArray(d.spools)?d.spools:[];
  d.qa=Array.isArray(d.qa)?d.qa:[];
  d.audit=Array.isArray(d.audit)?d.audit:[];
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
    audit:mergeRows(l.audit,r.audit).sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0)).slice(0,500),
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
function machineOperational(m){
  if(!m||getMaquinaEstadoGlobal(m.id)!=='disponible')return false;
  return !['offline','noip','shutdown','error'].includes(liveState(m.id));
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
  const x=num(j.sizeX),y=num(j.sizeY),z=num(j.sizeZ);
  if(x&&y&&z){
    const fits=(x<=c.bed[0]&&y<=c.bed[1]||y<=c.bed[0]&&x<=c.bed[1])&&z<=c.bed[2];
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
  return loadMinutes+eta+(jobMinutes(j)*historyCalibration/cap.speed)+oversizePenalty+materialBonus;
}
function pickMachine(j,loads){
  let best=null,bestScore=Infinity;
  (MAQUINAS||[]).forEach(m=>{
    const score=machineScore(j,m,loads.get(m.id)||0);
    if(score<bestScore){best=m;bestScore=score;}
  });
  return best?{machine:best,score:bestScore}:null;
}

function statusBadge(status){
  const m=JOB_META[status]||JOB_META.pendiente;
  return`<span class="mops-status" style="color:${m.color};background:${m.color}14">${esc(m.label)}</span>`;
}
function kpi(label,value,sub='',color='var(--text)'){
  return`<div class="mops-kpi"><div class="mops-kpi-label">${esc(label)}</div><div class="mops-kpi-value" style="color:${color}">${value}</div><div class="mops-kpi-sub">${esc(sub)}</div></div>`;
}
function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}
function showView(view,button){
  _activeView=view||'operacion';
  document.querySelectorAll('[data-maq-view]').forEach(el=>{el.style.display=el.dataset.maqView===_activeView?'':'none';});
  document.querySelectorAll('[data-maq-nav]').forEach(b=>b.classList.toggle('active',b.dataset.maqNav===_activeView));
  if(button)button.classList.add('active');
  localStorage.setItem('machine_ops_view',_activeView);
  renderAll();
}

function renderOpsOverview(){
  const el=document.getElementById('maquinaOpsOverview');if(!el)return;
  const jobs=activeJobs(),printing=jobs.filter(j=>j.status==='imprimiendo').length;
  const qa=jobs.filter(j=>j.status==='qa').length,unassigned=jobs.filter(j=>!j.machineId).length;
  const grams=jobs.reduce((s,j)=>s+num(j.grams),0);
  const availableSpools=data().spools.filter(s=>!s.archived&&spoolAvailable(s)>0).length;
  const late=jobs.filter(j=>j.dueDate&&dateValue(j.dueDate)<Date.now()&&!['terminado','archivado'].includes(j.status)).length;
  const notReady=(MAQUINAS||[]).filter(m=>!machineOperational(m)).length;
  const alerts=[];
  if(late)alerts.push(`<div class="mops-alert danger">🚨 <span><b>${late} trabajo${late!==1?'s':''} atrasado${late!==1?'s':''}</b> — replanifica la carga o cambia la fecha comprometida.</span></div>`);
  if(unassigned)alerts.push(`<div class="mops-alert warn">🎯 <span><b>${unassigned} trabajo${unassigned!==1?'s':''} sin máquina</b> — usa Planificar automáticamente.</span></div>`);
  if(qa)alerts.push(`<div class="mops-alert warn">✅ <span><b>${qa} trabajo${qa!==1?'s':''} esperando QA</b> antes de liberar el pedido.</span></div>`);
  el.innerHTML=`<div class="mops-kpis">
    ${kpi('Trabajos activos',jobs.length,`${printing} imprimiendo`,'var(--accent)')}
    ${kpi('Esperando QA',qa,'requieren revisión',qa?'var(--warn)':'var(--accent3)')}
    ${kpi('Sin asignar',unassigned,'pendientes de planificar',unassigned?'var(--danger)':'var(--accent3)')}
    ${kpi('Carga estimada',fmtMin(jobs.reduce((s,j)=>s+jobMinutes(j),0)),`${(grams/1000).toFixed(2)} kg reservados`)}
    ${kpi('Máquinas no listas',notReady,`de ${(MAQUINAS||[]).length}`,notReady?'var(--warn)':'var(--accent3)')}
    ${kpi('Rollos disponibles',availableSpools,'con saldo utilizable')}
  </div>${alerts.length?`<div style="display:grid;gap:7px;margin-bottom:16px">${alerts.join('')}</div>`:''}`;
}

function renderPlanning(){
  const summary=document.getElementById('mopsPlanningSummary'),list=document.getElementById('mopsJobs');
  if(!summary||!list)return;
  const all=data().jobs.filter(j=>!j.archived);
  const active=all.filter(j=>ACTIVE_JOB_STATES.includes(j.status));
  const assigned=active.filter(j=>j.machineId),hours=active.reduce((s,j)=>s+jobMinutes(j),0)/60;
  const dueSoon=active.filter(j=>j.dueDate&&(dateValue(j.dueDate)-Date.now())<3*86400000).length;
  summary.innerHTML=`<div class="mops-kpis">${kpi('Activos',active.length,'trabajos abiertos')}${kpi('Planificados',assigned.length,`${active.length-assigned.length} sin asignar`)}${kpi('Horas pendientes',hours.toFixed(1)+' h','estimación total')}${kpi('Entrega ≤ 3 días',dueSoon,'trabajos próximos',dueSoon?'var(--warn)':'var(--accent3)')}</div>`;
  renderGantt();
  const q=(document.getElementById('mopsJobSearch')?.value||'').trim().toLowerCase();
  const st=document.getElementById('mopsJobStatus')?.value||'';
  const rows=all.filter(j=>(!st||j.status===st)&&(!q||[j.name,j.material,j.color,j.gcodeFile,orderLabel(j.pedidoId),machineLabel(j.machineId)].join(' ').toLowerCase().includes(q)))
    .sort((a,b)=>dueUrgency(a)-dueUrgency(b)||Date.parse(a.createdAt||0)-Date.parse(b.createdAt||0));
  list.innerHTML=rows.length?`<div style="overflow-x:auto"><table class="mops-job-table"><thead><tr><th>Trabajo</th><th>Pedido</th><th>Producción</th><th>Material</th><th>Máquina</th><th>Entrega</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(j=>{
    const produced=num(j.completedCycles),cycles=Math.max(1,num(j.cycles,1));
    const actions=[
      `<button class="btn btn-ghost btn-sm" onclick="MachineOps.openJob('${j.id}')" title="Editar">✎</button>`,
      !j.machineId?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.planOne('${j.id}')" title="Asignar automáticamente">🎯</button>`:'',
      ['pendiente','planificado'].includes(j.status)?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.enqueueJob('${j.id}')" title="Enviar a cola">＋ Cola</button>`:'',
      j.status==='en_cola'?`<button class="btn btn-primary btn-sm" onclick="MachineOps.startJob('${j.id}')" title="Iniciar archivo en Moonraker">▶</button>`:'',
      j.status==='qa'?`<button class="btn btn-primary btn-sm" onclick="MachineOps.openQA('${j.id}')">QA</button>`:'',
      `<button class="btn btn-ghost btn-sm" onclick="MachineOps.archiveJob('${j.id}')" title="Archivar">🗄</button>`,
    ].join('');
    return`<tr>
      <td><b style="color:var(--text)">${esc(j.name)}</b><div style="font-size:9px;color:var(--text3);margin-top:2px">${esc(j.gcodeFile||'sin archivo')}</div></td>
      <td>${esc(orderLabel(j.pedidoId)||'—')}</td>
      <td>${num(j.qty,1)} u · ${cycles} ciclos<div style="font-size:9px;color:var(--text3)">${produced}/${cycles} completados · ${fmtMin(jobMinutes(j))}</div></td>
      <td>${esc(j.material||'—')} · ${esc(j.color||'—')}<div style="font-size:9px;color:var(--text3)">${num(j.grams)} g</div></td>
      <td>${esc(machineLabel(j.machineId))}</td>
      <td style="color:${j.dueDate&&dateValue(j.dueDate)<Date.now()?'var(--danger)':'var(--text2)'}">${esc(j.dueDate||'—')}<div style="font-size:9px;color:var(--text3)">${esc(j.priority||'normal')}</div></td>
      <td>${statusBadge(j.status)}</td>
      <td><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${actions}</div></td>
    </tr>`;
  }).join('')}</tbody></table></div>`:'<div class="empty-state" style="padding:24px">No hay trabajos que coincidan con los filtros.</div>';
}
function renderGantt(){
  const el=document.getElementById('mopsGantt');if(!el)return;
  const rows=(MAQUINAS||[]).map(m=>{
    const jobs=jobsForMachine(m.id).sort((a,b)=>num(a.position)-num(b.position)||dueUrgency(a)-dueUrgency(b));
    const total=Math.max(1,jobs.reduce((s,j)=>s+jobMinutes(j),0));
    const blocks=jobs.map(j=>{
      const width=clamp(jobMinutes(j)/total*100,10,100);
      const col=JOB_META[j.status]?.color||m.color;
      return`<div class="mops-gantt-job" onclick="MachineOps.openJob('${j.id}')" title="${esc(j.name)} · ${fmtMin(jobMinutes(j))}" style="width:${width}%;background:${col}">${esc(j.name)}</div>`;
    }).join('');
    const st=liveState(m.id)||'sin datos';
    return`<div class="mops-gantt-row"><div class="mops-gantt-machine"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${m.color};margin-right:6px"></span>${esc(m.nombre)} #${m.numG}<span style="display:block;font-size:8.5px;color:var(--text3);margin-left:13px">${esc(st)} · ${fmtMin(total)} en cola</span></div><div class="mops-gantt-track">${blocks||'<span style="padding:8px;color:var(--text3);font-size:9px">Sin trabajos planificados</span>'}</div></div>`;
  }).join('');
  el.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:11px">Carga secuencial por máquina</div><div class="mops-gantt">${rows}</div>`;
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
  const models=document.getElementById('mopsJobModels');
  const selected=new Set(job.compatibleModels||[]);
  if(models)models.innerHTML=MODELS.map(m=>`<label><input type="checkbox" value="${esc(m)}"${selected.has(m)?' checked':''}> ${esc(m)} <span style="color:var(--text3);font-size:9px">${esc(MODEL_CAPS[m].bed.join('×'))}</span></label>`).join('');
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
  return{
    ...(existing||{}),id:id||uid('job'),name:inputVal('mopsJobName').trim(),pedidoId:inputVal('mopsJobPedido'),
    qty,unitsPerBed,cycles:Math.max(1,num(inputVal('mopsJobCycles'),Math.ceil(qty/unitsPerBed))),
    minutesPerCycle:Math.max(1,num(inputVal('mopsJobMinutes'),60)),material:inputVal('mopsJobMaterial'),color:inputVal('mopsJobColor').trim(),
    grams:Math.max(0,num(inputVal('mopsJobGrams'))),nozzle:inputVal('mopsJobNozzle'),sizeX:Math.max(0,num(inputVal('mopsJobX'))),
    sizeY:Math.max(0,num(inputVal('mopsJobY'))),sizeZ:Math.max(0,num(inputVal('mopsJobZ'))),dueDate:inputVal('mopsJobDue'),
    priority:inputVal('mopsJobPriority'),machineId:inputVal('mopsJobMachine'),spoolId:inputVal('mopsJobSpool'),
    gcodeFile:inputVal('mopsJobFile').trim(),notes:inputVal('mopsJobNotes').trim(),compatibleModels:models,
    status:existing?.status||'pendiente',createdAt:existing?.createdAt||nowIso(),updatedAt:nowIso(),archived:false,
  };
}
function validateJob(j){
  const errors=[];if(!j.name)errors.push('Falta el nombre del trabajo.');
  if(j.machineId){const m=getMachine(j.machineId);if(!m||!modelCanRun(m.modelo,j))errors.push('La máquina elegida no es compatible con material o dimensiones.');}
  if(j.spoolId){const s=data().spools.find(x=>x.id===j.spoolId);if(!s)errors.push('El rollo reservado no existe.');else{const previous=data().jobs.find(x=>x.id===j.id);const ownReservation=previous?.spoolId===s.id&&!previous.materialConsumed?num(previous.grams):0;const available=spoolAvailable(s)+ownReservation;if(available<j.grams)errors.push(`El rollo solo tiene ${Math.round(available)} g libres y el trabajo necesita ${j.grams} g.`);}}
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
  if(!j.machineId&&!planOne(id,true)){toast('Asigna una máquina antes de encolar','error');return;}
  const errors=validateJob(j);if(errors.length){toast(errors[0],'error');return;}
  j.status='en_cola';j.queuedAt=nowIso();j.updatedAt=nowIso();persist('Trabajo encolado');
  toast(`${j.name} agregado a la cola de ${machineLabel(j.machineId)}`,'success');
}
async function startJob(id){
  const j=data().jobs.find(x=>x.id===id);if(!j||!j.machineId)return;
  const m=getMachine(j.machineId),st=liveState(j.machineId);
  if(!machineOperational(m)){toast('La máquina no está operativa','error');return;}
  if(st==='printing'||st==='paused'){j.status='en_cola';persist('Trabajo conservado en cola');toast('La impresora está ocupada; el trabajo permanece en cola','info');return;}
  if(!j.gcodeFile){toast('Configura el nombre del archivo G-code que ya está en la impresora','error');return;}
  if(!confirm(`Iniciar ${j.gcodeFile} en ${machineLabel(j.machineId)}?`))return;
  try{
    const ip=getPrinterIp(m);const r=await fetch(printerUrl(ip,`/printer/print/start?filename=${encodeURIComponent(j.gcodeFile)}`),{method:'POST',signal:AbortSignal.timeout(9000),headers:getPrinterAuthHeaders(j.machineId)});
    if(!r.ok)throw new Error('Moonraker '+r.status);
    j.status='imprimiendo';j.startedAt=nowIso();j.updatedAt=nowIso();persist('Impresión iniciada');
    audit('Comando Moonraker',m.id,`START ${j.gcodeFile}`,'control');toast('Impresión iniciada ✓','success');setTimeout(pollPrinters,1200);
  }catch(e){audit('Fallo comando Moonraker',m.id,e.message,'error');toast('No se pudo iniciar: '+e.message,'error');}
}
function archiveJob(id){
  const j=data().jobs.find(x=>x.id===id);if(!j)return;
  if(['imprimiendo','en_cola'].includes(j.status)){toast('No se puede archivar un trabajo activo o en cola','error');return;}
  j.archived=true;j.status='archivado';j.updatedAt=nowIso();persist('Trabajo archivado');
}

function renderMaterials(){
  const sum=document.getElementById('mopsMaterialSummary'),el=document.getElementById('mopsSpools');if(!sum||!el)return;
  const rows=data().spools.filter(s=>!s.archived),remaining=rows.reduce((s,x)=>s+num(x.remaining),0),reserved=rows.reduce((s,x)=>s+reservedForSpool(x.id),0);
  const low=rows.filter(s=>spoolAvailable(s)<Math.min(250,num(s.initial)*.2)&&s.status!=='agotado').length;
  const value=rows.reduce((s,x)=>s+num(x.remaining)/1000*num(x.costPerKg),0);
  sum.innerHTML=`<div class="mops-kpis">${kpi('Rollos activos',rows.length,'registrados')}${kpi('Disponible',(remaining/1000).toFixed(2)+' kg',`${(reserved/1000).toFixed(2)} kg reservados`)}${kpi('Stock bajo',low,'requieren reposición',low?'var(--warn)':'var(--accent3)')}${kpi('Valor remanente',fmtMoney(value),'costo estimado')}</div>`;
  el.innerHTML=rows.length?`<div class="mops-spool-grid">${rows.map(s=>{
    const free=spoolAvailable(s),pct=clamp(num(s.remaining)/Math.max(1,num(s.initial))*100,0,100),res=reservedForSpool(s.id);
    const color=pct<15?'var(--danger)':pct<30?'var(--warn)':'var(--accent3)';
    return`<div class="mops-spool">
      <div style="display:flex;align-items:center;gap:8px"><span style="width:13px;height:13px;border-radius:50%;background:${cssColor(s.colorCss||s.color)};border:1px solid var(--border2)"></span><b style="font-size:12px;color:var(--text);flex:1">${esc(s.name)}</b><span class="mops-status" style="color:${color}">${esc(s.status||'activo')}</span></div>
      <div style="font-size:10px;color:var(--text3);margin-top:5px">${esc(s.material)} · ${esc(s.color||'sin color')} · ${esc(s.brand||'sin marca')}</div>
      <div class="mops-spool-meter"><i style="width:${pct}%;background:${color}"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text2)"><span><b>${Math.round(free)} g</b> libres</span><span>${Math.round(res)} g reservados</span></div>
      <div style="font-size:9px;color:var(--text3);margin-top:6px">${esc(machineLabel(s.machineId))}${s.slot?' · slot '+esc(s.slot):''} · ${fmtMoney(num(s.costPerKg))}/kg</div>
      <div style="display:flex;gap:5px;margin-top:9px"><button class="btn btn-ghost btn-sm" onclick="MachineOps.openSpool('${s.id}')">Editar</button>${s.status!=='agotado'?`<button class="btn btn-ghost btn-sm" onclick="MachineOps.markSpoolEmpty('${s.id}')">Agotar</button>`:''}</div>
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

function qaJobOptions(selected=''){
  const jobs=data().jobs.filter(j=>!j.archived&&['qa','imprimiendo','terminado','fallido'].includes(j.status));
  const el=input('mopsQAJob');if(el)el.innerHTML='<option value="">— seleccionar trabajo —</option>'+jobs.map(j=>`<option value="${j.id}"${selected===j.id?' selected':''}>${esc(j.name)} · ${esc(orderLabel(j.pedidoId)||'sin pedido')}</option>`).join('');
}
function openQA(jobId=''){
  qaJobOptions(jobId);setVal('mopsQAId','');setVal('mopsQAResult','aprobado');setVal('mopsQAReason','Warping');setVal('mopsQAWaste',0);setVal('mopsQANotes','');setVal('mopsQAPhoto','');
  toggleQAFailure();input('mopsQAModal').style.display='flex';
}
function closeQA(){input('mopsQAModal').style.display='none';}
function toggleQAFailure(){const el=input('mopsQAFailureFields');if(el)el.style.display=inputVal('mopsQAResult')==='fallido'?'grid':'none';}
function prefillQA(){const j=data().jobs.find(x=>x.id===inputVal('mopsQAJob'));if(j&&j.failureReason)setVal('mopsQAReason',j.failureReason);}
function consumeJobMaterial(j,actualGrams){
  if(j.materialConsumed)return;
  const grams=Math.max(0,num(actualGrams,j.grams)),s=data().spools.find(x=>x.id===j.spoolId);
  if(s){s.remaining=Math.max(0,num(s.remaining)-grams);if(s.remaining<=0)s.status='agotado';s.updatedAt=nowIso();}
  j.materialConsumed=grams;
}
async function maybeCompleteOrder(pedidoId){
  if(!pedidoId)return;
  const jobs=data().jobs.filter(j=>j.pedidoId===pedidoId&&!j.archived);
  if(!jobs.length||jobs.some(j=>j.status!=='terminado'))return;
  try{
    const p=state.pedidosById?.[pedidoId];if(!p)return;
    p.fields['Estado pedido']='Listo para despacho';p.fields['Resultado QA']='QA aprobado';
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Estado pedido':'Listo para despacho','Resultado QA':'QA aprobado'});
    toast(`${p.fields['N° Pedido']||'Pedido'} listo para despacho ✓`,'success');
  }catch(e){console.warn('[MachineOps] no se pudo avanzar pedido',e);}
}
function saveQA(){
  const job=data().jobs.find(j=>j.id===inputVal('mopsQAJob'));if(!job){toast('Selecciona un trabajo','error');return;}
  const result=inputVal('mopsQAResult'),waste=Math.max(0,num(inputVal('mopsQAWaste'))),photo=inputVal('mopsQAPhoto').trim();
  if(photo&&!/^https?:\/\//i.test(photo)){toast('La evidencia debe ser una URL http o https','error');return;}
  const q={id:uid('qa'),jobId:job.id,pedidoId:job.pedidoId,machineId:job.machineId,result,reason:result==='fallido'?inputVal('mopsQAReason'):'',
    wasteGrams:waste,notes:inputVal('mopsQANotes').trim(),photo,actor:actor(),createdAt:nowIso(),updatedAt:nowIso()};
  data().qa.unshift(q);consumeJobMaterial(job,result==='fallido'?(waste||job.grams):job.grams);
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
    ${pending.length?`<div class="mops-qa-grid" style="margin-bottom:12px">${pending.map(j=>`<div class="mops-qa-card"><div style="display:flex;gap:8px;align-items:center"><b style="color:var(--text);flex:1">${esc(j.name)}</b>${statusBadge(j.status)}</div><div style="font-size:9.5px;color:var(--text3);margin:5px 0">${esc(machineLabel(j.machineId))} · ${esc(orderLabel(j.pedidoId)||'sin pedido')}</div><button class="btn btn-primary btn-sm" onclick="MachineOps.openQA('${j.id}')">Revisar QA</button></div>`).join('')}</div>`:''}
    ${recent.length?`<div class="card" style="padding:12px"><div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:8px">ÚLTIMOS CONTROLES</div>${recent.map(q=>{const j=data().jobs.find(x=>x.id===q.jobId);const col=q.result==='fallido'?'var(--danger)':q.result==='observaciones'?'var(--warn)':'var(--accent3)';return`<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border2);font-size:10px"><span style="color:${col};font-weight:800">${esc(q.result)}</span><span style="color:var(--text2);flex:1">${esc(j?.name||'Trabajo')} ${q.reason?'· '+esc(q.reason):''}</span><span style="color:var(--text3)">${new Date(q.createdAt).toLocaleDateString('es-CL')}</span></div>`;}).join('')}</div>`:''}`;
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
  el.innerHTML=`<div class="card" style="overflow-x:auto"><div style="padding:11px 13px 5px;font-size:10px;font-weight:700;color:var(--text3)">UMBRALES POR MODELO · HORAS DE IMPRESIÓN</div><table class="mops-job-table" style="min-width:900px"><thead><tr><th>Modelo</th>${MAINT_KEYS.map(t=>`<th>${labels[t]}</th>`).join('')}</tr></thead><tbody>${MODELS.map(model=>{
    const p=data().maintenanceProfiles[model]||DEFAULT_MAINT[model];
    return`<tr><td><b style="color:${MODELO_COLORES?.[model]||'var(--text)'}">${esc(model)}</b></td>${MAINT_KEYS.map(t=>`<td><input type="number" min="10" max="5000" value="${num(p[t])}" onchange="MachineOps.updateMaintProfile('${esc(model)}','${t}',this.value)" style="width:72px;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;padding:4px 6px;color:var(--text);font-size:10px"> h</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderAnalytics(){
  const el=document.getElementById('mopsAnalytics');if(!el)return;
  const qa=data().qa,approved=qa.filter(q=>q.result!=='fallido').length,failed=qa.filter(q=>q.result==='fallido').length;
  const success=qa.length?approved/qa.length*100:100,waste=qa.reduce((s,q)=>s+num(q.wasteGrams),0);
  const completed=data().jobs.filter(j=>j.status==='terminado'||j.status==='fallido');
  const est=completed.reduce((s,j)=>s+jobMinutes(j),0),actual=completed.reduce((s,j)=>s+num(j.actualMinutes,jobMinutes(j)),0);
  const accuracy=est&&actual?Math.max(0,100-Math.abs(actual-est)/est*100):100;
  const hourlyRate=typeof TARIFA_HORA_MAQUINA!=='undefined'?num(TARIFA_HORA_MAQUINA,1500):1500;
  const jobProdCost=j=>{
    const mins=num(j.actualMinutes,j.status==='terminado'||j.status==='fallido'?jobMinutes(j):0);
    const spool=data().spools.find(s=>s.id===j.spoolId);
    const materialKg=num(j.materialConsumed)/1000;
    const materialCost=materialKg*num(spool?.costPerKg,parseFloat(localStorage.getItem('filament_cost_kg')||'0'));
    return mins/60*hourlyRate+materialCost;
  };
  const allocatedRevenue=j=>{
    const p=state.pedidosById?.[j.pedidoId],net=num(p?.fields?.['Monto total (CLP)'])/1.19;if(!net)return 0;
    const siblings=data().jobs.filter(x=>x.pedidoId===j.pedidoId&&!x.archived),total=Math.max(1,siblings.reduce((s,x)=>s+jobMinutes(x),0));
    return net*jobMinutes(j)/total;
  };
  const cost=completed.reduce((s,j)=>s+jobProdCost(j),0);
  const contribution=completed.reduce((s,j)=>s+allocatedRevenue(j)-jobProdCost(j),0);
  const machineRows=(MAQUINAS||[]).map(m=>{
    const mj=data().jobs.filter(j=>j.machineId===m.id),done=mj.filter(j=>j.status==='terminado').length,fail=mj.filter(j=>j.status==='fallido').length;
    const hours=mj.reduce((s,j)=>s+num(j.actualMinutes,j.status==='terminado'?jobMinutes(j):0),0)/60;
    const grams=mj.reduce((s,j)=>s+num(j.materialConsumed),0);
    const prodCost=mj.reduce((s,j)=>s+jobProdCost(j),0),contrib=mj.reduce((s,j)=>s+allocatedRevenue(j)-jobProdCost(j),0);
    return{m,done,fail,hours,grams,prodCost,contrib,rate:(done+fail)?done/(done+fail)*100:100};
  }).sort((a,b)=>b.hours-a.hours);
  el.innerHTML=`<div class="mops-kpis">${kpi('Éxito QA',success.toFixed(1)+'%',`${approved} aprobados · ${failed} fallidos`,success<90?'var(--danger)':'var(--accent3)')}${kpi('Desperdicio',waste+' g','registrado en fallas',waste?'var(--warn)':'var(--accent3)')}${kpi('Precisión ETA',accuracy.toFixed(0)+'%','estimado versus real')}${kpi('Costo producción 3D',fmtMoney(cost),`${fmtMoney(hourlyRate)}/hora + material`)}${kpi('Contribución 3D',fmtMoney(contribution),'venta neta asignada − costo 3D',contribution<0?'var(--danger)':'var(--accent3)')}</div>
    <div class="card" style="overflow-x:auto"><div style="padding:11px 13px 4px;font-size:10px;font-weight:700;color:var(--text3)">RENDIMIENTO POR IMPRESORA</div><table class="mops-job-table" style="min-width:850px"><thead><tr><th>Máquina</th><th>Terminados</th><th>Fallidos</th><th>Tasa éxito</th><th>Horas</th><th>Material</th><th>Costo 3D</th><th>Contribución</th></tr></thead><tbody>${machineRows.map(r=>`<tr><td><b style="color:var(--text)">${esc(r.m.nombre)} #${r.m.numG}</b><div style="font-size:9px;color:var(--text3)">${esc(r.m.modelo)}</div></td><td>${r.done}</td><td style="color:${r.fail?'var(--danger)':'var(--text2)'}">${r.fail}</td><td style="color:${r.rate<90?'var(--danger)':'var(--accent3)'}">${r.rate.toFixed(0)}%</td><td>${r.hours.toFixed(1)}h</td><td>${Math.round(r.grams)}g</td><td>${fmtMoney(r.prodCost)}</td><td style="color:${r.contrib<0?'var(--danger)':'var(--accent3)'}">${fmtMoney(r.contrib)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="padding:12px;margin-top:12px"><div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:8px">AUDITORÍA OPERACIONAL</div><div class="mops-audit-list">${data().audit.slice(0,40).map(a=>`<div class="mops-audit-row"><span>${new Date(a.at).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}</span><b style="color:var(--text2)">${esc(a.actor)}</b><span>${esc(a.action)}${a.machineId?' · '+esc(machineLabel(a.machineId)):''}${a.detail?' · '+esc(a.detail):''}</span></div>`).join('')||'<div style="color:var(--text3);font-size:10px">Sin acciones registradas</div>'}</div></div>`;
}
function updateNavCounts(){
  setText('mopsNavPending',activeJobs().length);
  setText('mopsNavSpools',data().spools.filter(s=>!s.archived&&spoolAvailable(s)>0).length);
  let alerts=0;try{(MAQUINAS||[]).forEach(m=>alerts+=getMaintAlerts(m).length);}catch(_){}
  setText('mopsNavMaint',alerts);
}
function renderAll(){
  renderOpsOverview();renderPlanning();renderMaterials();renderQuality();renderMaintenanceProfiles();renderAnalytics();updateNavCounts();
}

async function syncNow(){
  await loadRemote();await saveRemote();renderAll();toast('Centro de producción sincronizado ✓','success');
}

function findJobForPrint(machineId,filename){
  const clean=String(filename||'').split('/').pop().toLowerCase();
  return data().jobs.find(j=>j.machineId===machineId&&!j.archived&&['en_cola','planificado','pendiente'].includes(j.status)&&
    (j.gcodeFile&&String(j.gcodeFile).split('/').pop().toLowerCase()===clean))||
    data().jobs.find(j=>j.machineId===machineId&&!j.archived&&j.status==='en_cola');
}
function handlePrinterTransition(m,s,previous){
  if(s.state==='printing'&&previous!=='printing'){
    const j=findJobForPrint(m.id,s.filename);if(j){j.status='imprimiendo';j.startedAt=nowIso();j.updatedAt=nowIso();persist('Trabajo detectado en impresión',{render:true});}
  }
  if(previous==='printing'&&s.state==='complete'){
    const j=data().jobs.find(x=>x.machineId===m.id&&!x.archived&&x.status==='imprimiendo');
    if(j){j.status='qa';j.completedAt=nowIso();j.actualMinutes=j.startedAt?Math.max(1,Math.round((Date.now()-Date.parse(j.startedAt))/60000)):jobMinutes(j);j.completedCycles=num(j.cycles,1);j.updatedAt=nowIso();persist('Impresión terminada; QA pendiente');}
  }
}
function onLegacyQueueAdd(machineId,filename,secs,grams){
  const exists=data().jobs.some(j=>!j.archived&&j.machineId===machineId&&j.gcodeFile===filename&&ACTIVE_JOB_STATES.includes(j.status));
  if(exists)return;
  data().jobs.push({id:uid('job'),name:String(filename||'Trabajo de slicer').replace(/\.(gcode|3mf)$/i,''),pedidoId:'',qty:1,unitsPerBed:1,cycles:1,
    minutesPerCycle:Math.max(1,Math.round(num(secs,3600)/60)),material:'PLA',color:'',grams:Math.max(0,num(grams)),nozzle:'0.4',
    machineId,spoolId:'',gcodeFile:filename||'',compatibleModels:[getMachine(machineId)?.modelo].filter(Boolean),status:'en_cola',priority:'normal',
    createdAt:nowIso(),updatedAt:nowIso(),archived:false});
  persist('Trabajo importado desde cola de laminado');
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

function techLink(id){
  const u=new URL(location.href);u.searchParams.set('machine',id);u.hash='maquinas';return u.toString();
}
function openTech(id){
  const m=getMachine(id);if(!m)return;
  setVal('mopsTechId',id);setText('mopsTechTitle',`${m.nombre} #${m.numG}`);
  const cap=machineCapabilities(m),jobs=jobsForMachine(id),spool=data().spools.find(s=>s.machineId===id&&!s.archived&&s.status!=='agotado');
  let maint=[];try{maint=getMaintAlerts(m);}catch(_){}
  const link=techLink(id),qr=`https://quickchart.io/qr?size=180&margin=1&text=${encodeURIComponent(link)}`;
  const stateOptions=Object.entries(typeof MAQUINA_ESTADOS!=='undefined'?MAQUINA_ESTADOS:{disponible:{label:'Disponible'},mantencion:{label:'Mantención'}})
    .map(([k,v])=>`<option value="${esc(k)}"${getMaquinaEstadoGlobal(id)===k?' selected':''}>${esc(v.icon||'')} ${esc(v.label)}</option>`).join('');
  input('mopsTechBody').innerHTML=`<div style="display:grid;grid-template-columns:180px 1fr;gap:15px;align-items:start">
    <div style="text-align:center"><img src="${qr}" alt="QR ficha ${esc(m.nombre)}" width="180" height="180" style="display:block;background:#fff;border-radius:8px"><div style="font-size:8.5px;color:var(--text3);word-break:break-all;margin-top:5px">${esc(link)}</div></div>
    <div>
      <div class="mops-kpis" style="grid-template-columns:repeat(2,1fr)">${kpi('Estado en vivo',liveState(id)||'sin datos','Moonraker')}${kpi('Cola',jobs.length,fmtMin(jobs.reduce((s,j)=>s+jobMinutes(j),0)))}${kpi('Mantenciones',maint.length,'alertas',maint.length?'var(--warn)':'var(--accent3)')}${kpi('Rollo',spool?Math.round(spoolAvailable(spool))+' g':'—',spool?`${spool.material} ${spool.color}`:'sin rollo cargado')}</div>
      <div class="field-group"><label class="field-label">Estado operacional</label><select class="field-select" onchange="MachineOps.setMachineStatus('${id}',this.value)">${stateOptions}</select></div>
      <div style="font-size:10px;color:var(--text3);margin-top:9px">${esc(m.modelo)} · cama ${esc(cap.bed.join('×'))} mm · ${esc(cap.materials.join(', '))}</div>
      ${maint.length?`<div class="mops-alert warn" style="margin-top:9px">🔧 <span>${maint.map(a=>`${esc(a.label)} ${Math.round(a.hours)}/${a.threshold}h`).join('<br>')}</span></div>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="openWebcamModal('${id}')">📷 Cámara</button><button class="btn btn-ghost btn-sm" onclick="openMaintModal('${id}')">🔧 Mantención</button><button class="btn btn-ghost btn-sm" onclick="MachineOps.closeTech();MachineOps.showView('planificacion')">🗓 Planificación</button></div>
    </div>
  </div>`;
  input('mopsTechModal').style.display='flex';
}
function closeTech(){input('mopsTechModal').style.display='none';}
async function setMachineStatus(id,status){
  const m=getMachine(id);if(!m||!(status in MAQUINA_ESTADOS))return;
  m.estado=status;localStorage.setItem('estado_maq_'+id,status);audit('Estado operacional actualizado',id,maquinaEstadoMeta(status).label,'control');writeLocal();scheduleRemote();
  try{await saveMaquinaEstadoAirtable(id,status);}catch(e){toast('Estado local guardado; Airtable no respondió','info');}
  renderAll();try{renderMaquinasCalendar();renderMonitorGrid();}catch(_){}
  toast(`${machineLabel(id)} · ${maquinaEstadoMeta(status).label}`,'success');openTech(id);
}
function copyTechLink(){
  const id=inputVal('mopsTechId');if(!id)return;
  navigator.clipboard.writeText(techLink(id)).then(()=>toast('Enlace de técnico copiado ✓','success')).catch(()=>toast('No se pudo copiar el enlace','error'));
}
function printTechLabel(){
  const id=inputVal('mopsTechId'),m=getMachine(id);if(!m)return;
  const link=techLink(id),qr=`https://quickchart.io/qr?size=320&margin=1&text=${encodeURIComponent(link)}`;
  const w=window.open('','_blank','width=520,height=680');if(!w){toast('El navegador bloqueó la ventana de impresión','error');return;}
  w.document.write(`<!doctype html><html><head><title>Etiqueta ${esc(machineLabel(id))}</title><style>body{font-family:Arial;text-align:center;padding:28px;color:#111}.box{border:3px solid #111;border-radius:18px;padding:22px;display:inline-block}img{width:300px;height:300px}.name{font-size:26px;font-weight:800;margin:12px}.meta{font-size:16px;color:#444}.url{font-size:9px;max-width:330px;word-break:break-all;margin:10px auto}</style></head><body><div class="box"><img src="${qr}" onload="setTimeout(()=>window.print(),400)"><div class="name">${esc(m.nombre)} #${m.numG}</div><div class="meta">${esc(m.modelo)} · Máquina #${m.numG}</div><div class="url">${esc(link)}</div></div></body></html>`);
  w.document.close();audit('Etiqueta QR generada',id,'Ficha móvil de técnico');writeLocal();scheduleRemote();
}

async function init(){
  if(_initPromise)return _initPromise;
  _initPromise=(async()=>{
    data();await loadRemote();await restoreLegacyQueues();_initialized=true;
    _activeView=localStorage.getItem('machine_ops_view')||'operacion';showView(_activeView);renderAll();
    const machineParam=new URLSearchParams(location.search).get('machine');
    if(machineParam&&getMachine(machineParam))setTimeout(()=>openTech(machineParam),120);
  })();
  return _initPromise;
}

const api={
  init,showView,renderAll,renderPlanning,openJob,closeJob,updateJobCycles,saveJob,planOne,autoPlan,enqueueJob,startJob,archiveJob,
  openSpool,closeSpool,saveSpool,markSpoolEmpty,reconcileSpools,openQA,closeQA,toggleQAFailure,prefillQA,saveQA,
  updateMaintProfile,maintenanceThreshold,syncNow,analyzeCamera,pauseFromVision,
  openTech,closeTech,setMachineStatus,copyTechLink,printTechLabel,
  handlePrinterTransition,onLegacyQueueAdd,persistLegacyQueue,restoreLegacyQueues,
  _test:{defaultData,normalizeData,mergeData,modelCanRun,jobModels,jobMinutes},
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
  _queueAdd=function(id,gcode,filename,secs,grams){const r=baseQueueAdd(id,gcode,filename,secs,grams);api.onLegacyQueueAdd(id,filename,secs,grams);api.persistLegacyQueue(id);return r;};
}
if(typeof _queueRemove==='function'){
  const baseQueueRemove=_queueRemove;
  _queueRemove=function(id,idx){const r=baseQueueRemove(id,idx);api.persistLegacyQueue(id);return r;};
}
if(typeof _queueStartNext==='function'){
  const baseQueueStartNext=_queueStartNext;
  _queueStartNext=async function(id){const r=await baseQueueStartNext(id);api.persistLegacyQueue(id);return r;};
}

})();
