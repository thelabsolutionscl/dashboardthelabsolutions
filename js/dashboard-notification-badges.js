/* js/dashboard-notification-badges.js
 * Globos de notificación contextuales para el dock y corrección de anclaje
 * del badge de la campana. No duplica el panel de NOTIFY: solo resume pendientes
 * relevantes por módulo y añade salud/config drift activo de la granja a Máquinas.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.DashboardNotificationBadges=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const MODULES=new Set(['correo','pedidos','cotizaciones','clientes','proveedores','maquinas','finanzas','equipo','agentes','oficina','web','reporte','visual','remuneraciones']);
let target=null,installed=false,timer=null,lastState=null;

function moduleForItem(item){
  if(!item||item.read)return'';
  const type=String(item.type||'').toLowerCase();
  // Confirmaciones de envío/éxito no son pendientes que requieran atención.
  if(type==='sent'||type==='success')return'';
  if(type==='mail')return'correo';
  const action=String(item.action||'').trim().toLowerCase();
  if(!action||action.startsWith('@'))return'';
  return MODULES.has(action)?action:'';
}
function rank(sev){return sev==='critical'?3:sev==='warning'?2:1;}
function severityForItem(item){
  const type=String(item?.type||'').toLowerCase();
  return type==='warning'?'warning':type==='mail'?'info':'info';
}
function buildState(items,farmAlerts,driftAlerts){
  const out={};
  const add=(module,severity,id)=>{
    if(!module)return;
    const cur=out[module]||(out[module]={count:0,severity:'info',ids:new Set()});
    const key=String(id||module+':'+cur.count);
    if(cur.ids.has(key))return;
    cur.ids.add(key);cur.count++;
    if(rank(severity)>rank(cur.severity))cur.severity=severity;
  };
  (Array.isArray(items)?items:[]).forEach(item=>{
    const module=moduleForItem(item);if(!module)return;
    add(module,severityForItem(item),'notify:'+String(item.id||item.key||''));
  });
  (Array.isArray(farmAlerts)?farmAlerts:[]).forEach(a=>{
    if(!a||a.acked)return;
    add('maquinas',String(a.severity||'warning').toLowerCase(),'farm:'+String(a.id||a.message||''));
  });
  // FarmDrift sólo expone drift real. Las máquinas sin baseline NO se convierten
  // en notificación para evitar una avalancha de badges durante la instalación.
  (Array.isArray(driftAlerts)?driftAlerts:[]).forEach(a=>{
    if(!a)return;
    add('maquinas',String(a.severity||'warning').toLowerCase(),'drift:'+String(a.id||a.machineId||a.message||''));
  });
  const plain={};
  Object.entries(out).forEach(([k,v])=>plain[k]={count:v.count,severity:v.severity});
  return plain;
}
function farmAlerts(){try{return target?.FarmHealth?.status?.().alerts||[];}catch(_){return[];}}
function driftAlerts(){try{return target?.FarmDrift?.status?.().alerts||[];}catch(_){return[];}}
function notifyItems(){try{return Array.isArray(target?.NOTIFY?.items)?target.NOTIFY.items:[];}catch(_){return[];}}
function bellHost(){
  const b=target?.document?.getElementById('notifBadge');if(!b)return null;
  const host=b.closest('button,a,[role="button"],.topbar-action,.topbar-icon-btn')||b.parentElement;
  if(host){host.setAttribute('data-notif-bell-host','1');host.style.position='relative';}
  return host;
}
function navTargets(module){
  const d=target?.document;if(!d)return[];
  const sels=[
    `.dock-btn[data-tab="${module}"]`,`.mbd-btn[data-tab="${module}"]`,`.mg-item[data-tab="${module}"]`,
    `.dock-btn[onclick*="switchTab('${module}')"]`,`.mbd-btn[onclick*="switchTab('${module}')"]`,`.mg-item[onclick*="switchTab('${module}')"]`,
    `.dock-btn[onclick*='switchTab("${module}")']`,`.mbd-btn[onclick*='switchTab("${module}")']`,`.mg-item[onclick*='switchTab("${module}")']`
  ];
  const set=new Set();
  for(const sel of sels){try{d.querySelectorAll(sel).forEach(el=>set.add(el));}catch(_){}}
  return[...set];
}
function ensureStyle(){
  const d=target?.document;if(!d||d.getElementById('dashboardNotifBadgeStyle'))return;
  const s=d.createElement('style');s.id='dashboardNotifBadgeStyle';
  s.textContent=`
    [data-notif-bell-host]{position:relative!important;overflow:visible!important}
    .dashboard-context-badge{position:absolute;top:-2px;right:-2px;z-index:12;pointer-events:none;box-shadow:0 0 0 2px rgba(10,10,10,.92),0 2px 7px rgba(0,0,0,.35)}
    .dashboard-context-badge.sev-critical{background:var(--danger,#ff4444)!important;color:#fff!important}
    .dashboard-context-badge.sev-warning{background:var(--warn,#ffaa00)!important;color:#111!important}
    .dashboard-context-badge.sev-info{background:var(--accent,#00d4cc)!important;color:#061716!important}
    @media(max-width:900px){.dashboard-context-badge{top:0;right:2px}}
  `;
  (d.head||d.documentElement).appendChild(s);
}
function render(){
  if(!target?.document)return{};
  ensureStyle();bellHost();
  const state=buildState(notifyItems(),farmAlerts(),driftAlerts());
  target.document.querySelectorAll('.dashboard-context-badge[data-module]').forEach(b=>{
    const module=b.dataset.module;if(!state[module]||state[module].count<1)b.remove();
  });
  for(const[module,meta]of Object.entries(state)){
    if(!meta.count)continue;
    for(const host of navTargets(module)){
      host.style.position='relative';host.style.overflow='visible';
      let b=host.querySelector(`:scope > .dashboard-context-badge[data-module="${module}"]`);
      if(!b){b=target.document.createElement('span');b.className='dock-badge dashboard-context-badge';b.dataset.module=module;host.appendChild(b);}
      b.classList.remove('sev-critical','sev-warning','sev-info');b.classList.add('sev-'+(meta.severity||'info'));
      b.textContent=meta.count>99?'99+':String(meta.count);
      b.title=`${meta.count} notificación${meta.count===1?'':'es'} pendiente${meta.count===1?'':'s'} en ${module}`;b.setAttribute('aria-label',b.title);
    }
  }
  lastState=state;return state;
}
function wireNotify(){
  const n=target?.NOTIFY;if(!n||typeof n.updateBadge!=='function')return false;
  if(n.__dashboardContextBadges)return true;
  const original=n.updateBadge;n.updateBadge=function(){const r=original.apply(this,arguments);try{render();}catch(_){}return r;};n.__dashboardContextBadges=true;return true;
}
function install(root){
  if(installed||!root||!root.document)return false;target=root;installed=true;
  const tick=()=>{wireNotify();render();};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',tick,{once:true});else setTimeout(tick,0);
  root.addEventListener?.('farm-health-updated',tick);root.addEventListener?.('farm-drift-updated',tick);
  root.addEventListener?.('storage',e=>{if(!e||String(e.key||'').startsWith('thelab_'))tick();});root.addEventListener?.('focus',tick);
  timer=root.setInterval?.(()=>{if(!root.document.hidden)tick();},5000)||null;return true;
}
function status(){return{installed,lastState:lastState||{},hasNotify:!!target?.NOTIFY,hasFarmHealth:!!target?.FarmHealth,hasFarmDrift:!!target?.FarmDrift};}
return{install,render,status,_test:{moduleForItem,buildState,rank}};
});
