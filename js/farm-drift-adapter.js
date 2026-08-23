/* js/farm-drift-adapter.js
 * Cliente + panel de baseline/config drift para MÁQUINAS.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.FarmDrift=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';
let target=null,installed=false,snapshot=null,lastSync=0,lastError='',syncing=null,timer=null;
async function request(path,options={}){if(!target?.FarmHttpAuth?.request)throw new Error('cliente autenticado de granja no disponible');return target.FarmHttpAuth.request(path,{timeout:options.timeout||12000,...options});}
function emit(){try{target?.dispatchEvent?.(new target.CustomEvent('farm-drift-updated',{detail:status()}));}catch(_){}try{render();}catch(_){}}
function setSnapshot(d){snapshot=d||null;lastSync=Date.now();lastError='';emit();return snapshot;}
async function refresh(force=false){if(!target||target._DEMO_MODE)return null;if(syncing)return syncing;if(!force&&Date.now()-lastSync<30000)return snapshot;syncing=(async()=>{try{const d=await request('/farm/drift');return setSnapshot(d.drift);}catch(e){lastError=e.message;emit();return null;}finally{syncing=null;}})();return syncing;}
async function probe(machineId=''){try{const d=await request('/farm/drift/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(machineId?{machineId}:{}),timeout:60000});return setSnapshot(d.drift);}catch(e){lastError=e.message;emit();throw e;}}
async function approve(machineId){if(!machineId)return false;try{const d=await request('/farm/drift/baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({machineId}),timeout:60000});setSnapshot(d.drift);return true;}catch(e){lastError=e.message;emit();throw e;}}
async function clear(machineId){if(!machineId)return false;try{const d=await request('/farm/drift/baseline/'+encodeURIComponent(machineId),{method:'DELETE'});setSnapshot(d.drift);return true;}catch(e){lastError=e.message;emit();throw e;}}
function driftAlerts(){return(snapshot?.machines||[]).filter(m=>m?.state==='drift').map(m=>({id:'drift:'+m.machineId,severity:'warning',machineId:m.machineId,message:(m.name||m.machineId)+': configuración/firmware cambió'}));}
function status(){return{installed,lastSync,lastError,summary:snapshot?.summary||null,machines:snapshot?.machines||[],alerts:driftAlerts(),updatedAt:snapshot?.updatedAt||0};}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtTs(ts){if(!ts)return'—';try{return new Date(ts).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(_){return'—';}}
function changeText(m){const c=m?.changes||{},parts=[];if(c.changed?.length)parts.push('Δ '+c.changed.join(', '));if(c.added?.length)parts.push('+ '+c.added.join(', '));if(c.removed?.length)parts.push('− '+c.removed.join(', '));return parts.join(' · ')||'Hash/versiones distintos';}
function severityColor(state){return state==='drift'?'var(--warn,#ffaa00)':state==='clean'?'var(--success,#00d4aa)':state==='unknown'?'var(--danger,#ff4444)':'var(--text3,#777)';}
function rowHtml(m){
  const cur=m.current||{},base=m.baseline||{},state=m.state||'unknown';
  const label=state==='clean'?'✓ Coincide':state==='drift'?'⚠ Drift':state==='unbaselined'?'Sin baseline':'Sin lectura válida';
  let detail='';
  if(state==='drift'){
    const versions=[];
    if(base.klipperVersion!==cur.klipperVersion)versions.push(`Klipper ${esc(base.klipperVersion||'—')} → ${esc(cur.klipperVersion||'—')}`);
    if(base.moonrakerVersion!==cur.moonrakerVersion)versions.push(`Moonraker ${esc(base.moonrakerVersion||'—')} → ${esc(cur.moonrakerVersion||'—')}`);
    detail=`<div class="farm-drift-detail">${esc(changeText(m))}${versions.length?'<br>'+versions.join(' · '):''}</div>`;
  }else if(state==='unbaselined') detail=`<div class="farm-drift-detail">Escaneado ${fmtTs(cur.scannedAt)} · ${Number(cur.fileCount||0)} archivos de configuración</div>`;
  else if(state==='unknown') detail=`<div class="farm-drift-detail">${esc(cur.error||'No hay un escaneo válido')}</div>`;
  const action=(state==='drift'||state==='unbaselined')?`<button class="farm-drift-approve" data-machine-id="${esc(m.machineId)}">${state==='drift'?'Aprobar nuevo baseline':'Aprobar baseline'}</button>`:'';
  return`<div class="farm-drift-row" data-state="${esc(state)}"><div class="farm-drift-main"><span class="farm-drift-dot" style="background:${severityColor(state)}"></span><div class="farm-drift-name">${esc(m.name||m.machineId)}</div><div class="farm-drift-state" style="color:${severityColor(state)}">${label}</div>${action}</div>${detail}</div>`;
}
function ensureStyle(){const d=target?.document;if(!d||d.getElementById('farmDriftStyle'))return;const s=d.createElement('style');s.id='farmDriftStyle';s.textContent=`
#farmDriftPanel{margin:0 0 12px;padding:12px 14px;border:1px solid var(--border2);border-radius:10px;background:rgba(17,17,17,.82)}
.farm-drift-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.farm-drift-title{font-size:12px;font-weight:800}.farm-drift-summary{font-size:10.5px;color:var(--text3);flex:1}.farm-drift-actions{display:flex;gap:6px}
.farm-drift-actions button,.farm-drift-approve{background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:5px 8px;font-size:10.5px;font-weight:700;cursor:pointer}.farm-drift-actions button:hover,.farm-drift-approve:hover{border-color:var(--accent);color:var(--accent)}
.farm-drift-list{margin-top:8px;border-top:1px solid var(--border)}.farm-drift-row{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.045)}.farm-drift-main{display:flex;align-items:center;gap:7px}.farm-drift-dot{width:7px;height:7px;border-radius:50%;flex:none}.farm-drift-name{font-size:11px;font-weight:700;min-width:120px}.farm-drift-state{font-size:10.5px;font-weight:800;flex:1}.farm-drift-detail{font-size:9.8px;color:var(--text3);margin:4px 0 0 14px;line-height:1.45;word-break:break-word}.farm-drift-error{color:var(--danger);font-size:10px;margin-top:6px}
@media(max-width:700px){.farm-drift-name{min-width:0;flex:1}.farm-drift-main{flex-wrap:wrap}.farm-drift-state{flex:none}.farm-drift-approve{width:100%;margin-left:14px}.farm-drift-detail{margin-left:14px}}
`;d.head.appendChild(s);}
function ensurePanel(){const d=target?.document;if(!d)return null;let p=d.getElementById('farmDriftPanel');if(p)return p;const anchor=d.getElementById('maqOcupacion')||d.getElementById('maquinaMonGrid');if(!anchor)return null;p=d.createElement('div');p.id='farmDriftPanel';anchor.parentNode.insertBefore(p,anchor);p.addEventListener('click',async e=>{const btn=e.target.closest('button');if(!btn)return;if(btn.id==='farmDriftProbe'){btn.disabled=true;try{await probe();}catch(err){alert('No se pudo escanear: '+err.message);}finally{btn.disabled=false;}return;}if(btn.classList.contains('farm-drift-approve')){const id=btn.dataset.machineId;if(!id)return;if(!confirm('¿Aprobar el estado actual como nuevo baseline para esta impresora?\n\nHazlo sólo si verificaste que la configuración/firmware actual es correcto.'))return;btn.disabled=true;try{await approve(id);}catch(err){alert('No se pudo aprobar: '+err.message);}finally{btn.disabled=false;}}});return p;}
function render(){const p=ensurePanel();if(!p)return;ensureStyle();const s=snapshot?.summary||{},machines=snapshot?.machines||[],attention=machines.filter(m=>m.state!=='clean');const err=lastError?`<div class="farm-drift-error">${esc(lastError)}</div>`:'';p.innerHTML=`<div class="farm-drift-head"><span class="farm-drift-title">🛡️ Integridad de configuración</span><span class="farm-drift-summary">${Number(s.clean||0)} OK · ${Number(s.drift||0)} con cambios · ${Number(s.unbaselined||0)} sin baseline · ${Number(s.unknown||0)} sin lectura</span><span class="farm-drift-actions"><button id="farmDriftProbe">Escanear ahora</button></span></div>${err}${attention.length?`<div class="farm-drift-list">${attention.map(rowHtml).join('')}</div>`:`<div class="farm-drift-detail" style="margin-left:0">Todo coincide con los baselines aprobados.</div>`}`;}
function install(root){if(installed||!root)return false;target=root;installed=true;const start=()=>{ensureStyle();ensurePanel();refresh(true);};if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else setTimeout(start,0);root.addEventListener?.('focus',()=>refresh(true));timer=root.setInterval?.(()=>{if(!root.document?.hidden)refresh(false);},60000)||null;return true;}
return{install,refresh,probe,approve,clear,status,render,_test:{changeText,driftAlerts}};
});
