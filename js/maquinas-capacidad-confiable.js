/* js/maquinas-capacidad-confiable.js
 * Reemplaza las dos vistas históricas que mezclaban datos manuales, heurísticas
 * comerciales y telemetría:
 *   - Carga de producción
 *   - Disponibilidad semanal
 *
 * Principio: no llamar "libre", "en cola" ni "horas de trabajo" a algo que no
 * esté respaldado por una fuente operacional identificable.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&root.document)api.install(root);
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const OPS_KEY='thelab_machine_ops_v2';
const OPS_ACTIVE=new Set(['pendiente','planificado','en_cola','imprimiendo','qa']);
const FARM_ACTIVE=new Set(['queued','retry','checking','uploading','uploaded']);
const LIVE_FREE=new Set(['idle','standby','ready']);
const LIVE_BAD=new Set(['offline','noip','shutdown','error','apidown']);
const LIVE_UNKNOWN=new Set(['','connecting','unknown','startup']);

function esc(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function jobMinutes(job){
  return Math.max(1,num(job?.cycles,1))*Math.max(1,num(job?.minutesPerCycle,60));
}
function parseOpsSnapshot(storage){
  try{
    const raw=storage?.getItem?.(OPS_KEY)||'{}',data=JSON.parse(raw);
    return data&&typeof data==='object'?data:{};
  }catch(_){return{};}
}
function activeOpsJobs(snapshot){
  return (Array.isArray(snapshot?.jobs)?snapshot.jobs:[]).filter(j=>j&&!j.archived&&OPS_ACTIVE.has(String(j.status||'')));
}
function liveEvidence(status,now=Date.now()){
  const state=String(status?.state||'');
  const lastSeen=num(status?.lastSeenAt);
  const fresh=!!lastSeen&&now-lastSeen<60000;
  return{state,lastSeen,fresh,known:fresh&&!LIVE_UNKNOWN.has(state)};
}
function farmEvidence(status,now=Date.now()){
  const lastSync=num(status?.lastSync);
  const jobs=Array.isArray(status?.jobs)?status.jobs:[];
  const fresh=status?.controllerOk===true&&!!lastSync&&now-lastSync<30000;
  return{fresh,lastSync,jobs,counts:status?.counts&&typeof status.counts==='object'?status.counts:{}};
}
function classifyDay({isToday=false,isPast=false,adminState='disponible',event=null,live=null}={}){
  if(adminState!=='disponible'){
    return{kind:'blocked',tone:'danger',label:'No operativa',detail:'Estado administrativo'};
  }
  if(event?.tipo==='mantencion'){
    return{kind:'maintenance',tone:'danger',label:'Mantención',detail:event.desc||'Reserva de mantención'};
  }
  if(isToday){
    const ev=liveEvidence(live||{});
    if(!ev.known)return{kind:'unknown',tone:'neutral',label:'Sin dato actual',detail:'Telemetría > 60 s o sin lectura'};
    if(ev.state==='printing')return{kind:'printing',tone:'ok',label:'Imprimiendo',detail:'Confirmado por telemetría'};
    if(ev.state==='paused')return{kind:'paused',tone:'warning',label:'Pausada',detail:'Confirmado por telemetría'};
    if(LIVE_BAD.has(ev.state))return{kind:'issue',tone:'danger',label:'No disponible',detail:'Estado técnico '+ev.state};
    if(ev.state==='complete')return{kind:'complete',tone:'warning',label:'Terminó impresión',detail:'Retirar pieza / QA antes de reutilizar'};
    if(event?.tipo==='uso')return{kind:'reserved',tone:'info',label:'Reservada',detail:'Agenda manual registrada'};
    if(LIVE_FREE.has(ev.state))return{kind:'free',tone:'ok',label:'Libre ahora',detail:'Telemetría reciente'};
    return{kind:'unknown',tone:'neutral',label:'Estado no confirmado',detail:'Telemetría reciente sin estado utilizable'};
  }
  if(event?.tipo==='uso')return{kind:'reserved',tone:'info',label:'Reservada',detail:'Agenda manual registrada'};
  if(isPast)return{kind:'no_record',tone:'neutral',label:'Sin registro',detail:'No existe evento guardado'};
  return{kind:'unplanned',tone:'neutral',label:'Sin reserva',detail:'No equivale a disponibilidad confirmada'};
}
function legacyConflict(order,jobs){
  const legacy=String(order?.fields?.['Máquina asignada']||'');
  const machines=[...new Set((jobs||[]).map(j=>j.machineId).filter(Boolean))];
  if(!legacy)return machines.length>1?{level:'info',reason:'Pedido distribuido en varias impresoras'}:null;
  if(machines.length>1)return{level:'warning',reason:'El campo antiguo de una sola máquina no representa la distribución real'};
  if(machines.length===1&&machines[0]!==legacy)return{level:'warning',reason:'La referencia antigua no coincide con MachineOps'};
  return null;
}
function weekEvidence(events,machines,days){
  let reservations=0,maintenance=0,hours=0;
  for(const m of machines||[]){
    for(const d of days||[]){
      const ds=typeof d==='string'?d:formatDateLocal(d);
      const ev=events?.[m.id+'_'+ds];
      if(ev?.tipo==='uso'){reservations++;hours+=Math.max(0,num(ev.tiempo));}
      else if(ev?.tipo==='mantencion')maintenance++;
    }
  }
  return{reservations,maintenance,hours};
}
function formatDateLocal(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function install(root){
  if(root.__TLS_MACHINE_CAPACITY_TRUST__)return false;
  root.__TLS_MACHINE_CAPACITY_TRUST__=true;

  const rawLive=id=>{try{return typeof _printerStatus!=='undefined'?(_printerStatus[id]||{}):{};}catch(_){return{};}};
  const machines=()=>{try{return Array.isArray(MAQUINAS)?MAQUINAS:[];}catch(_){return[];}};
  const opsSnapshot=()=>parseOpsSnapshot(root.localStorage);
  const opsJobs=()=>activeOpsJobs(opsSnapshot());
  const activeOrders=()=>{
    try{
      if(typeof _pedidosActivosProd==='function')return _pedidosActivosProd();
      return (state?.pedidos||[]).filter(p=>['Confirmado','En producción','En cola'].includes(p.fields?.['Estado pedido']||''));
    }catch(_){return[];}
  };
  const orderName=p=>esc(p?.fields?.['N° Pedido']||'—');
  const clientName=p=>{try{return esc(resolveClienteName(p?.fields?.Cliente)||'Sin cliente');}catch(_){return'Sin cliente';}};
  const machineLabel=id=>{
    const m=machines().find(x=>x.id===id);
    return m?esc((m.nombre||m.modelo||'Máquina')+' #'+(m.numG||m.num||'')):'Sin máquina';
  };
  const farm=()=>{
    let status={};try{status=root.FarmQueue?.status?.()||{};}catch(_){}
    return farmEvidence(status);
  };
  const adminState=id=>{try{return getMaquinaEstadoGlobal(id);}catch(_){return'disponible';}};
  const liveView=id=>{
    const e=liveEvidence(rawLive(id));
    const admin=adminState(id);
    if(admin!=='disponible')return{...e,tone:'danger',label:'NO OPERATIVA',free:false,admin};
    if(!e.known)return{...e,tone:'neutral',label:'SIN TELEMETRÍA',free:false,admin};
    if(e.state==='printing')return{...e,tone:'ok',label:'IMPRIMIENDO',free:false,admin};
    if(e.state==='paused')return{...e,tone:'warning',label:'PAUSADA',free:false,admin};
    if(e.state==='complete')return{...e,tone:'warning',label:'TERMINÓ · RETIRAR/QA',free:false,admin};
    if(LIVE_BAD.has(e.state))return{...e,tone:'danger',label:'REVISAR · '+e.state.toUpperCase(),free:false,admin};
    if(LIVE_FREE.has(e.state))return{...e,tone:'ok',label:'LIBRE AHORA',free:true,admin};
    return{...e,tone:'neutral',label:'ESTADO NO CONFIRMADO',free:false,admin};
  };
  const jobsByOrder=()=>{
    const map=new Map();
    opsJobs().forEach(j=>{if(!j.pedidoId)return;const arr=map.get(j.pedidoId)||[];arr.push(j);map.set(j.pedidoId,arr);});
    return map;
  };
  const jobsByMachine=()=>{
    const map=new Map();
    machines().forEach(m=>map.set(m.id,[]));
    opsJobs().forEach(j=>{if(j.machineId&&map.has(j.machineId))map.get(j.machineId).push(j);});
    return map;
  };

  root.planificarPedidoEnMachineOps=function planificarPedidoEnMachineOps(pedidoId){
    if(!root.MachineOps?.showView||!root.MachineOps?.openJob){try{toast('Centro de planificación aún no está disponible','error');}catch(_){}return;}
    root.MachineOps.showView('planificacion');
    setTimeout(()=>{
      root.MachineOps.openJob();
      setTimeout(()=>{
        const select=document.getElementById('mopsJobPedido');
        if(select&&[...select.options].some(o=>o.value===pedidoId)){
          select.value=pedidoId;
          select.dispatchEvent(new Event('change',{bubbles:true}));
        }
      },0);
    },40);
  };

  root.sugerirMaquina=function sugerirMaquinaConEvidencia(pedidoId){
    const linked=(jobsByOrder().get(pedidoId)||[]).filter(j=>j.machineId);
    const ids=[...new Set(linked.map(j=>j.machineId))];
    if(ids.length===1){
      if(typeof asignarMaquina==='function')return asignarMaquina(pedidoId,ids[0]);
      return;
    }
    if(ids.length>1){
      try{toast('Este pedido ya está distribuido en varias impresoras en MachineOps; no corresponde reducirlo a una sola.','info');}catch(_){}
      return;
    }
    try{toast('Primero crea los trabajos de impresión. Sin volumen/material/tiempo no hay una sugerencia segura de máquina.','info');}catch(_){}
    root.planificarPedidoEnMachineOps(pedidoId);
  };

  root.renderCargaMaquinas=function renderCargaMaquinasConfiable(){
    const el=document.getElementById('cargaMaquinas');if(!el)return;
    const allMachines=machines(),orders=activeOrders(),byOrder=jobsByOrder(),byMachine=jobsByMachine(),farmState=farm();
    const activeJobs=opsJobs(),freshCount=allMachines.filter(m=>liveEvidence(rawLive(m.id)).known).length;
    const printingCount=allMachines.filter(m=>{const v=liveView(m.id);return v.known&&v.state==='printing';}).length;
    const durableJobs=farmState.fresh?farmState.jobs.filter(j=>FARM_ACTIVE.has(String(j.state||''))):[];
    const plannedMinutes=activeJobs.reduce((s,j)=>s+jobMinutes(j),0);
    const noJobs=orders.filter(p=>!(byOrder.get(p.id)||[]).length);
    const conflictRows=orders.map(p=>({p,issue:legacyConflict(p,byOrder.get(p.id)||[])})).filter(x=>x.issue?.level==='warning');

    const title=document.querySelector('#maquinaCargaLegacyView .maq-view-title');
    if(title)title.textContent='🗂️ Carga de producción · evidencia real';
    const sub=document.querySelector('#maquinaCargaLegacyView .maq-view-title')?.parentElement?.querySelector('span:last-child');
    if(sub&&sub!==title)sub.textContent='MachineOps = planificación · Moonraker = estado actual · Farm Controller = cola durable';

    const trust='<div class="mcap-trust">'
      +'<span><b>PLANIFICACIÓN</b><small>'+activeJobs.length+' trabajo(s) MachineOps</small></span>'
      +'<span class="'+(freshCount===allMachines.length?'ok':'warning')+'"><b>TIEMPO REAL</b><small>'+freshCount+'/'+allMachines.length+' impresoras con lectura < 60 s</small></span>'
      +'<span class="'+(farmState.fresh?'ok':'warning')+'"><b>CONTROLLER</b><small>'+(farmState.fresh?durableJobs.length+' trabajo(s) en cola durable':'sin confirmación reciente')+'</small></span>'
      +'</div>'
      +'<div class="mcap-rule">Un pedido asignado a una impresora no significa que esté en cola ni imprimiendo. La carga se calcula desde trabajos MachineOps; la ejecución se confirma por telemetría/Controller.</div>';

    const kpis='<div class="mcap-kpis">'
      +'<article><small>TRABAJOS ACTIVOS</small><b>'+activeJobs.length+'</b><span>fichas de impresión abiertas</span></article>'
      +'<article><small>HORAS PLANIFICADAS</small><b>'+(plannedMinutes? (plannedMinutes/60).toFixed(1)+' h':'—')+'</b><span>ciclos × min/ciclo, no venta en $</span></article>'
      +'<article class="'+(noJobs.length?'warning':'ok')+'"><small>PEDIDOS SIN TRABAJO</small><b>'+noJobs.length+'</b><span>requieren planificación</span></article>'
      +'<article><small>IMPRIMIENDO AHORA</small><b>'+printingCount+'</b><span>telemetría reciente</span></article>'
      +'<article class="'+(farmState.fresh?'ok':'warning')+'"><small>COLA DURABLE</small><b>'+(farmState.fresh?durableJobs.length:'—')+'</b><span>'+(farmState.fresh?'confirmada por Controller':'sin dato reciente')+'</span></article>'
      +'<article class="'+(conflictRows.length?'danger':'ok')+'"><small>CONFLICTOS</small><b>'+conflictRows.length+'</b><span>referencia antigua vs MachineOps</span></article>'
      +'</div>';

    const cards=allMachines.map(m=>{
      const jobs=byMachine.get(m.id)||[],live=liveView(m.id);
      const durable=farmState.fresh?durableJobs.filter(j=>j.machineId===m.id).length:null;
      const mins=jobs.reduce((s,j)=>s+jobMinutes(j),0);
      const orderIds=[...new Set(jobs.map(j=>j.pedidoId).filter(Boolean))];
      const rows=jobs.slice(0,5).map(j=>{
        let order='Sin pedido';try{order=state?.pedidosById?.[j.pedidoId]?.fields?.['N° Pedido']||order;}catch(_){}
        return '<div class="mcap-job"><div><b>'+esc(j.name||'Trabajo')+'</b><small>'+esc(order)+' · '+esc(j.status||'')+'</small></div><span>'+Math.round(jobMinutes(j)/60*10)/10+' h</span></div>';
      }).join('');
      const active=jobs.length||live.state==='printing'||live.state==='paused'||(durable||0)>0;
      return{active,html:'<article class="mcap-machine '+live.tone+'">'
        +'<div class="mcap-machine-head"><div><b>'+esc((m.nombre||m.modelo)+' #'+(m.numG||m.num||''))+'</b><small>'+esc(m.modelo||'')+'</small></div><span class="mcap-live '+live.tone+'">'+esc(live.label)+'</span></div>'
        +'<div class="mcap-machine-stats"><span><small>Trabajos</small><b>'+jobs.length+'</b></span><span><small>Plan</small><b>'+(mins?(mins/60).toFixed(1)+' h':'—')+'</b></span><span><small>Controller</small><b>'+(durable===null?'—':durable)+'</b></span><span><small>Pedidos</small><b>'+orderIds.length+'</b></span></div>'
        +(rows?'<div class="mcap-jobs">'+rows+(jobs.length>5?'<small>…y '+(jobs.length-5)+' más</small>':'')+'</div>':'<div class="mcap-empty">Sin trabajos MachineOps asignados.</div>')
        +'</article>'};
    });
    const activeCards=cards.filter(x=>x.active),idleCards=cards.filter(x=>!x.active);

    const noJobRows=noJobs.map(p=>{
      const legacy=String(p.fields?.['Máquina asignada']||'');
      return '<div class="mcap-order"><div class="mcap-order-main"><b>'+orderName(p)+'</b><span>'+clientName(p)+'</span><small>'+esc(p.fields?.['Estado pedido']||'')+(p.fields?.['Fecha entrega']?' · entrega '+esc(p.fields['Fecha entrega']):'')+'</small></div>'
        +'<div class="mcap-order-evidence"><span class="warning">SIN TRABAJO DE IMPRESIÓN</span>'+(legacy?'<small>Referencia antigua: '+machineLabel(legacy)+'</small>':'<small>Sin distribución técnica todavía</small>')+'</div>'
        +'<button class="btn btn-primary btn-sm" data-id="'+esc(p.id)+'" onclick="planificarPedidoEnMachineOps(this.dataset.id)">Crear trabajo</button></div>';
    }).join('');

    const conflicts=conflictRows.length?'<details class="mcap-conflicts"><summary>Revisar referencias antiguas · '+conflictRows.length+'</summary>'
      +conflictRows.map(({p,issue})=>'<div><b>'+orderName(p)+'</b><span>'+esc(issue.reason)+'</span></div>').join('')+'</details>':'';

    el.innerHTML='<div class="mcap-guide"><div><b>Qué puedes confiar aquí</b><small>La pantalla deja de estimar horas según el valor del pedido y deja de tratar una asignación administrativa como ejecución.</small></div>'+trust+'</div>'
      +kpis
      +'<div class="mcap-section-head"><div><b>Carga por impresora</b><small>Solo trabajos creados en Centro de planificación; las horas son estimaciones técnicas del trabajo.</small></div><span>'+activeCards.length+' con actividad</span></div>'
      +(activeCards.length?'<div class="mcap-machine-grid">'+activeCards.map(x=>x.html).join('')+'</div>':'<div class="mcap-empty big">No hay trabajos MachineOps asignados a impresoras.</div>')
      +(idleCards.length?'<details class="mcap-idle"><summary>Ver '+idleCards.length+' impresora(s) sin carga planificada</summary><div class="mcap-machine-grid">'+idleCards.map(x=>x.html).join('')+'</div></details>':'')
      +'<div class="mcap-section-head"><div><b>Pedidos por preparar</b><small>Pedidos productivos que todavía no tienen ningún trabajo de impresión vinculado.</small></div><span>'+noJobs.length+'</span></div>'
      +(noJobRows?'<div class="mcap-orders">'+noJobRows+'</div>':'<div class="mcap-empty big">✓ Todos los pedidos productivos tienen al menos un trabajo de impresión.</div>')
      +conflicts;
  };

  root.renderHeatmapSemanas=function renderHeatmapSemanasConfiable(){
    const el=document.getElementById('heatmapSemanas');if(!el)return;
    const today=new Date();today.setHours(0,0,0,0);
    const dow=today.getDay(),thisMon=new Date(today);thisMon.setDate(today.getDate()-(dow===0?6:dow-1));
    const chips=[];
    let maxRes=1;const rows=[];
    for(let w=-2;w<=9;w++){
      const lun=new Date(thisMon);lun.setDate(thisMon.getDate()+w*7);
      const days=[];for(let i=0;i<7;i++){const d=new Date(lun);d.setDate(lun.getDate()+i);days.push(d);}
      const ev=weekEvidence(maquinaState?.eventos||{},machines(),days);maxRes=Math.max(maxRes,ev.reservations+ev.maintenance);
      rows.push({w,lun,ev});
    }
    rows.forEach(({w,lun,ev})=>{
      const selected=w===maquinaState.semanaOffset,now=w===0,total=ev.reservations+ev.maintenance;
      chips.push('<button class="mcap-week '+(selected?'active':'')+'" onclick="jumpToSemana('+w+')">'
        +'<small>'+(now?'HOY':lun.toLocaleDateString('es-CL',{day:'numeric',month:'short'}))+'</small>'
        +'<b>'+(total?total+' reserva'+(total===1?'':'s'):'sin reservas')+'</b>'
        +'<span>'+(ev.hours?ev.hours.toFixed(1)+' h registradas':'sin horas registradas')+'</span>'
        +'</button>');
    });
    el.innerHTML='<div class="mcap-week-guide"><b>Agenda registrada por semana</b><small>“Sin reservas” significa que no hay una reserva guardada; no garantiza que la impresora esté libre.</small></div><div class="mcap-weeks">'+chips.join('')+'</div>';
  };

  root.renderMaquinasKPIs=function renderMaquinasKPIsConfiable(dias,todayStr){
    const all=machines(),today=todayStr||formatDateLocal(new Date());
    let free=0,printing=0,unknown=0,nonop=0;
    all.forEach(m=>{
      const admin=adminState(m.id),ev=maquinaState?.eventos?.[m.id+'_'+today]||null;
      const c=classifyDay({isToday:true,adminState:admin,event:ev,live:rawLive(m.id)});
      if(c.kind==='free')free++;else if(c.kind==='printing')printing++;
      if(c.kind==='unknown')unknown++;if(c.kind==='blocked'||c.kind==='issue')nonop++;
    });
    const week=weekEvidence(maquinaState?.eventos||{},all,dias||[]);
    const el=document.getElementById('maquinasKPIs');if(!el)return;
    el.innerHTML='<div class="mcap-kpis calendar">'
      +'<article class="ok"><small>LIBRES AHORA</small><b>'+free+'</b><span>telemetría < 60 s</span></article>'
      +'<article><small>IMPRIMIENDO</small><b>'+printing+'</b><span>confirmado ahora</span></article>'
      +'<article class="'+(unknown?'warning':'ok')+'"><small>SIN TELEMETRÍA</small><b>'+unknown+'</b><span>no se asumen libres</span></article>'
      +'<article><small>RESERVAS SEMANA</small><b>'+week.reservations+'</b><span>días de uso registrados</span></article>'
      +'<article><small>HORAS REGISTRADAS</small><b>'+(week.hours?week.hours.toFixed(1)+' h':'—')+'</b><span>solo horas ingresadas</span></article>'
      +'<article class="'+(nonop?'danger':'ok')+'"><small>NO OPERATIVAS</small><b>'+nonop+'</b><span>administración / falla técnica</span></article>'
      +'</div>';
  };

  root.renderMaquinasCalendar=function renderMaquinasCalendarConfiable(){
    const lunes=getMaquinaSemanaLunes(),dias=[];for(let i=0;i<7;i++){const d=new Date(lunes);d.setDate(lunes.getDate()+i);dias.push(d);}
    const today=formatDateLocal(new Date()),todayDate=new Date(today+'T00:00:00'),opts={day:'numeric',month:'short'};
    const label=document.getElementById('semanaLabel');if(label)label.textContent=dias[0].toLocaleDateString('es-CL',opts)+' — '+dias[6].toLocaleDateString('es-CL',opts)+' '+dias[0].getFullYear();
    const title=document.querySelector('#maquinaCalView .maq-view-title');if(title)title.textContent='📅 Agenda semanal de máquinas';
    root.renderHeatmapSemanas();root.renderMaquinasKPIs(dias,today);

    const head=document.getElementById('maquinasHeader'),body=document.getElementById('maquinasBody');if(!head||!body)return;
    head.innerHTML='<tr><th class="mcap-sticky machine">Máquina</th><th class="mcap-sticky state">Estado</th>'
      +dias.map(d=>{const ds=formatDateLocal(d),isToday=ds===today;return'<th class="mcap-day-head '+(isToday?'today':'')+'">'+esc((typeof fmtDayLabel==='function'?fmtDayLabel(d):d.toLocaleDateString('es-CL',{weekday:'short',day:'numeric'})))+'</th>';}).join('')+'</tr>';

    const groups=[];for(const m of machines()){let g=groups.find(x=>x.model===m.modelo);if(!g){g={model:m.modelo,rows:[]};groups.push(g);}g.rows.push(m);}
    body.innerHTML=groups.map(group=>{
      const current=group.rows.map(m=>({m,view:liveView(m.id)}));
      const free=current.filter(x=>x.view.free).length,printing=current.filter(x=>x.view.state==='printing'&&x.view.known).length,unknown=current.filter(x=>!x.view.known).length;
      const groupRow='<tr class="mcap-model-row"><td colspan="'+(dias.length+2)+'"><div><b>'+esc(group.model)+'</b><span>'+free+' libre'+(free===1?'':'s')+' ahora · '+printing+' imprimiendo · '+unknown+' sin dato reciente</span></div></td></tr>';
      const rows=group.rows.map(m=>{
        const admin=adminState(m.id),meta=typeof maquinaEstadoMeta==='function'?maquinaEstadoMeta(admin):{short:admin,color:'green',label:admin};
        const stateBtn='<button class="btn-mini btn-mini-'+esc(meta.color||'green')+'" onclick="toggleMaquinaEstado(\''+esc(m.id)+'\')" title="'+esc(meta.label||admin)+'">'+esc(meta.short||admin)+'</button>';
        const cells=dias.map(d=>{
          const ds=formatDateLocal(d),event=maquinaState?.eventos?.[m.id+'_'+ds]||null,isToday=ds===today,isPast=new Date(ds+'T00:00:00')<todayDate;
          const c=classifyDay({isToday,isPast,adminState:admin,event,live:rawLive(m.id)});
          let detail=c.detail;
          if(event?.tipo==='uso'){
            let ped='';try{ped=event.pedidoId?state?.pedidosById?.[event.pedidoId]?.fields?.['N° Pedido']||'':'';}catch(_){}
            detail=ped||event.desc||detail;
          }
          const hours=event?.tiempo?'<small>'+esc(event.tiempo)+' h registradas</small>':'';
          return'<td class="mcap-day '+c.tone+' '+(isToday?'today':'')+'" onclick="openMaquinaModal(\''+esc(m.id)+'\',\''+esc((m.nombre||m.modelo)+' #'+(m.num||m.numG||''))+'\',\''+ds+'\')">'
            +'<div><b>'+esc(c.label)+'</b><span>'+esc(detail)+'</span>'+hours+'</div>'
            +(event?'<button onclick="event.stopPropagation();deleteMaquinaEvento(\''+esc(m.id)+'\',\''+ds+'\')" title="Eliminar reserva">×</button>':'')
            +'</td>';
        }).join('');
        return'<tr><td class="mcap-sticky machine"><b><i style="background:'+esc(m.color||'var(--text3)')+'"></i>'+esc(m.nombre||m.modelo)+'</b><small>#'+esc(m.numG||m.num||'')+'</small></td><td class="mcap-sticky state">'+stateBtn+'</td>'+cells+'</tr>';
      }).join('');
      return groupRow+rows;
    }).join('');

    const views=machines().map(m=>liveView(m.id));
    const free=views.filter(v=>v.free).length,printing=views.filter(v=>v.known&&v.state==='printing').length,unknown=views.filter(v=>!v.known).length,nonop=views.filter(v=>v.admin!=='disponible'||LIVE_BAD.has(v.state)).length;
    const sub=document.getElementById('maquinasSubtitle');if(sub)sub.textContent=free+' libres confirmadas ahora · '+printing+' imprimiendo · '+unknown+' sin telemetría · '+nonop+' no operativas';
  };

  root.onMaquinaModalPedidoChange=function onMaquinaModalPedidoChangeConfiable(){
    const sel=document.getElementById('maquinaModalPedido'),pid=sel?.value;if(!pid)return;
    let p=null;try{p=state?.pedidosById?.[pid]||null;}catch(_){}
    if(!p)return;
    const f=p.fields||{},n=f['N° Pedido']||'—';
    let client='';try{client=resolveClienteName(f.Cliente)||'';}catch(_){}
    const desc=document.getElementById('maquinaModalDesc');if(desc)desc.value=n+(client?' · '+client:'');
    const time=document.getElementById('maquinaModalTiempo');
    if(time&&!time.value){
      const machineId=document.getElementById('maquinaModalId')?.value||'';
      const linked=(jobsByOrder().get(pid)||[]).filter(j=>!machineId||j.machineId===machineId);
      const minutes=linked.reduce((s,j)=>s+jobMinutes(j),0);
      if(minutes>0){
        time.value=Math.round(minutes/6)/10;
        time.title='Estimado desde trabajos MachineOps (ciclos × min/ciclo)';
      }else{
        time.placeholder='Sin estimación técnica · ingresa horas si las conoces';
        time.title='No se calcula desde el valor en pesos del pedido';
      }
    }
  };

  const refresh=()=>{
    clearTimeout(root.__TLS_MCAP_REFRESH_TIMER__);
    root.__TLS_MCAP_REFRESH_TIMER__=setTimeout(()=>{
      try{root.renderCargaMaquinas();}catch(_){}
      try{root.renderMaquinasCalendar();}catch(_){}
    },180);
  };
  root.addEventListener?.('printerstatus',refresh);
  root.addEventListener?.('farm-controller-health',refresh);
  root.addEventListener?.('focus',refresh);

  try{root.renderCargaMaquinas();}catch(_){}
  try{root.renderMaquinasCalendar();}catch(_){}
  return true;
}

return{install,jobMinutes,parseOpsSnapshot,activeOpsJobs,liveEvidence,farmEvidence,classifyDay,legacyConflict,weekEvidence,formatDateLocal};
});
