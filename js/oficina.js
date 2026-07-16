/* js/oficina.js — módulo extraído de index.html (carga en el mismo punto). */
// ── OFICINA VIRTUAL ────────────────────────────────────────────
// Visualiza el "equipo" de agentes IA (AGENTES_CFG) + automatizaciones de backend
// como trabajadores en una oficina, con estado en vivo derivado de datos reales:
//   · Agent_Log   → última ejecución y carga de cada agente IA
//   · Agent_Queue → tareas pendientes (carga de la oficina)
//   · Automations → (opcional) estado real de los Workers/Make si creas la tabla
const AUTOMATIONS_CFG=[
  {id:'lead-worker',    label:'Lead Worker',    icon:'🧲', role:'Captura y puntúa leads entrantes',     tipo:'Cloudflare Worker', expectMins:90},
  {id:'sii-worker',     label:'SII Worker',     icon:'🧾', role:'Sincroniza documentos tributarios (SII)', tipo:'Cloudflare Worker'},
  {id:'printer-bridge', label:'Printer Bridge', icon:'🖨️', role:'Puente de impresión hacia la planta',   tipo:'Bridge local'},
  {id:'mail-api',       label:'Mail API',       icon:'✉️', role:'Envío y recepción de correo',           tipo:'API PHP'},
  {id:'airtable-proxy', label:'Airtable Proxy', icon:'🛡️', role:'Proxy seguro Airtable + Claude',         tipo:'Cloudflare Worker'},
];
let _oficinaInterval=null, _oficinaBusy=false;
const _ofActive=new Set();                 // agentes IA ejecutándose AHORA (en memoria, en vivo)
let _ofErr=false;                          // la última lectura de Airtable falló
const _OF_CACHE_MS=25000;                  // ventana de caché corta para el polling (evita refetch en cada render)
let _ofRunsCache={t:0,data:null};          // caché corta del Agent_Log remoto
let _ofQueueCache={t:0,len:null};          // caché corta de la longitud de Agent_Queue
let _ofAutoCache={t:0,data:null};          // caché corta de la telemetría de Automations
let _ofMaqCache={t:0,data:null};           // caché corta de las impresoras 3D (tabla Maquinas)
let _ofTileW=0,_ofTileH=0;                  // tamaño de baldosa actual (para dibujar el mesón de las impresoras)
let _ofComms=[];                            // comunicaciones recientes entre agentes (mueven al agente entre departamentos)
let _ofLastExec=null;                        // última ejecución registrada (para detectar handoffs/comunicación)
let _ofCommTimer=null, _ofCelebTimer=null;   // timeouts de limpieza cancelables/coalescidos (B21)
const _OF_COMM_MS=9000;
function ofLogComm(from,to){
  if(!from||!to||from===to) return;
  const now=Date.now();
  _ofComms=_ofComms.filter(c=>now-c.t<_OF_COMM_MS);
  _ofComms.push({from,to,t:now});
  if(typeof renderOficina==='function' && document.getElementById('tab-oficina')?.classList.contains('active')){
    renderOficina();
    clearTimeout(_ofCommTimer);   // coalesce: una ráfaga de handoffs comparte un solo render de limpieza
    _ofCommTimer=setTimeout(()=>{ if(document.getElementById('tab-oficina')?.classList.contains('active')) renderOficina(); }, _OF_COMM_MS+300);
  }
}
// ── Reacciones / celebraciones cuando un agente COMPLETA una ejecución ──
let _ofCelebs=[]; const _OF_CELEB_MS=5200;
function ofCelebrate(label){
  if(!label) return;
  const now=Date.now();
  _ofCelebs=_ofCelebs.filter(c=>now-c.t<_OF_CELEB_MS);
  _ofCelebs.push({label,t:now});
  if(typeof renderOficina==='function' && document.getElementById('tab-oficina')?.classList.contains('active')){
    renderOficina();
    clearTimeout(_ofCelebTimer);   // coalesce: varias celebraciones comparten un solo render de limpieza
    _ofCelebTimer=setTimeout(()=>{ if(document.getElementById('tab-oficina')?.classList.contains('active')) renderOficina(); }, _OF_CELEB_MS+250);
  }
}
// ── Cámara de la escena 3D (pan / zoom / enfocar agente) ──
let _ofCam=null;                 // {cx,cy,scale} sobre el viewBox base; null = sin tocar
let _ofCamVb=null;               // viewBox base con el que se guardó _ofCam (para reanclar si cambia — B7)
let _ofFollowId=null;            // agente a centrar tras el render
const _ofPos={};                 // id → [x,y] del puesto del agente (para enfocar)
// Estado de impresora 3D → estado de oficina
function _ofPrinterCls(estado){ const e=(estado||'').toString().toLowerCase();
  if(/imprim|ocupad|print|busy|trabaj|en uso/.test(e)) return 'of-work';
  if(/manten|repar|falla|error|offline|sin con/.test(e)) return 'of-error';
  return 'of-off';
}
// Imagen real del modelo de impresora (robusto: en Airtable nombre/modelo pueden venir invertidos)
function _ofModelImg(modelo,nombre){
  if(typeof MODELO_IMGS==='undefined') return '';
  const keys=Object.keys(MODELO_IMGS);
  for(const k of keys){ if(modelo===k||nombre===k) return MODELO_IMGS[k]; }
  const hay=((modelo||'')+' '+(nombre||'')).toLowerCase();
  for(const k of keys.slice().sort((a,b)=>b.length-a.length)){ if(hay.includes(k.toLowerCase())) return MODELO_IMGS[k]; }
  return '';
}
// Defensa en profundidad: solo deja pasar URLs de imagen seguras (bloquea javascript:/data:text/… en href/src)
function _ofSafeUrl(u){ u=String(u||'').trim(); return (/^(https?:\/\/|data:image\/)/i.test(u)||/^[\w\-\/]+\.(png|jpe?g|webp|gif|svg)$/i.test(u))?u:''; }
function _ofPrinterLbl(estado){ const e=(estado||'').toString().toLowerCase();
  if(/imprim|ocupad|print|busy|trabaj|en uso/.test(e)) return 'Imprimiendo';
  if(/manten|repar/.test(e)) return 'Mantención';
  if(/falla|error/.test(e)) return 'Con falla';
  if(/offline|sin con/.test(e)) return 'Sin conexión';
  if(/dispon|libre|idle|ready|en linea|online/.test(e)) return 'Disponible';
  return estado||'Disponible';
}
let _ofModel=null;                         // último modelo construido (para el panel de detalle de agente)
let _ofAgentRuns=null;                      // ejecuciones del agente abierto en el panel de detalle
let _ofView=(()=>{try{return localStorage.getItem('thelab_oficina_view')||'cards';}catch(e){return 'cards';}})();
let _ofPrevView=_ofView;                   // vista a restaurar al salir del modo TV/pantalla completa
let _ofCardFilter=(()=>{try{return localStorage.getItem('thelab_oficina_cardfilter')||'all';}catch(e){return 'all';}})();  // filtro por estado en la vista Tarjetas
let _ofSearch='';                          // búsqueda de trabajadores (nombre/área/rol) en la vista Tarjetas
let _ofChartRange=(()=>{try{return +localStorage.getItem('thelab_oficina_range')||14;}catch(e){return 14;}})();   // rango de la analítica (7/14/30 días)
let _ofSceneLight=(()=>{try{return localStorage.getItem('thelab_oficina_scenelight')==='1';}catch(e){return false;}})();  // tema claro para la escena 3D
let _ofCompact=(()=>{try{return localStorage.getItem('thelab_oficina_compact')==='1';}catch(e){return false;}})();       // densidad compacta de tarjetas
let _ofChartData=null;                     // {runs,ia,auto} para re-render de gráficos al cambiar el rango
let _ofPrevKpis={};                        // valores previos de KPIs (para animar count-up)
let _ofPrevAlerts='';                      // firma previa de alertas (para avisar sólo ante cambios)
let _ofClockTimer=null;                    // timer del reloj de pared (tic sin reconstruir la escena)
function _ofAgo(ts){
  if(!ts) return '—';
  const d=Date.now()-ts; if(d<0) return 'ahora';
  const s=Math.floor(d/1000);
  if(s<60) return 'hace '+s+'s';
  const m=Math.floor(s/60); if(m<60) return 'hace '+m+'m';
  const h=Math.floor(m/60); if(h<24) return 'hace '+h+'h';
  const dd=Math.floor(h/24); return 'hace '+dd+'d';
}
function _ofStatus(lastT){
  if(!lastT) return {cls:'of-off', lbl:'En reposo'};
  const d=Date.now()-lastT;
  if(d<90000)    return {cls:'of-work',   lbl:'Trabajando'};
  if(d<86400000) return {cls:'of-active', lbl:'Activo hoy'};
  return {cls:'of-off', lbl:'En reposo'};
}
function _ofSameDay(ts){
  if(!ts) return false;
  const a=new Date(ts), b=new Date();
  return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
}
// Campo Estado de Automations → clase de color (fuente de verdad para automatizaciones)
function _ofEstadoCls(estado){
  const e=(estado||'').toString().toLowerCase();
  if(e.includes('error')||e.includes('fall')) return 'of-error';
  if(e.includes('trabaj')) return 'of-work';
  if(e.includes('activ'))  return 'of-active';
  if(e.includes('paus')||e.includes('repos')) return 'of-off';
  return '';
}
// Mini-sparkline de ejecuciones de los últimos 7 días (índice 6 = hoy)
function _ofSpark(list){
  const days=[0,0,0,0,0,0,0];
  const start=new Date(); start.setHours(0,0,0,0);
  (list||[]).forEach(r=>{ if(!r.t) return; const dd=new Date(r.t); dd.setHours(0,0,0,0); const idx=6-Math.round((start-dd)/86400000); if(idx>=0&&idx<7) days[idx]++; });
  const max=Math.max(1,...days);
  const bars=days.map((v,i)=>{const h=Math.max(2,Math.round((v/max)*18)); return `<rect x="${i*9}" y="${20-h}" width="6" height="${h}" rx="1" fill="${v?'var(--accent)':'var(--border2)'}"/>`;}).join('');
  return `<svg class="of-spark" width="62" height="20" viewBox="0 0 62 20" aria-hidden="true">${bars}</svg>`;
}
function ofKey(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); const t=e.currentTarget; if(!t)return; if(typeof t.click==='function') t.click(); else if(typeof t.onclick==='function') t.onclick(e); else t.dispatchEvent(new MouseEvent('click',{bubbles:true})); } }   // a11y teclado (incluye nodos SVG sin .click() en algunos navegadores)
function ofAutoInfo(el){ const id=el?.dataset?.autoId||''; const a=AUTOMATIONS_CFG.find(x=>x.id===id); if(a){toast(a.label+' — '+a.tipo,'info');return;}
  const pm=(_ofModel&&_ofModel.printerModel)||[]; const p=pm.find(x=>x.id===id);
  if(p){
    if(p.cam && typeof openWebcamModal==='function'){ openWebcamModal(id); return; }   // webcam en vivo si está configurada
    const pr=(typeof p.progress==='number'&&p.progress>=0)?(' · '+p.progress+'%'):'';
    toast('🖨️ '+p.label+' — '+p.lbl+pr,'info'); return;
  }
  toast(id||'Elemento','info'); }
// Refresca la Oficina forzando datos frescos (el polling usa caché corta; el botón manual la invalida)
function refreshOficina(){ _ofRunsCache={t:0,data:null}; _ofQueueCache={t:0,len:null}; _ofAutoCache={t:0,data:null}; _ofMaqCache={t:0,data:null};
  const _iso=document.getElementById('oficinaIso'); if(_iso) _iso.dataset.sig='';   // fuerza reconstruir la escena 3D aunque los datos coincidan
  renderOficina(); try{toast('Oficina actualizada','success');}catch(e){}
}
// Nombre de área/departamento visible de un trabajador (IA/automatización/impresora)
function _ofAreaName(m){ return m.isPrinter?'Impresora 3D':(m.clickIA?_ofCat(m).name:'Automatización'); }
// ── Preferencias visuales (tema de escena 3D + densidad de tarjetas), persistidas ──
function _ofApplyPrefs(){
  const el=document.getElementById('tab-oficina'); if(!el) return;
  el.classList.toggle('of-scene-light',_ofSceneLight);
  el.classList.toggle('of-compact',_ofCompact);
  const tb=document.getElementById('ofSceneThemeBtn'); if(tb) tb.textContent=_ofSceneLight?'☀️ Escena':'🌙 Escena';
  const db=document.getElementById('ofDensityBtn'); if(db) db.textContent=_ofCompact?'⤡ Compacta':'⤢ Cómoda';
}
function ofToggleSceneTheme(){ _ofSceneLight=!_ofSceneLight; try{localStorage.setItem('thelab_oficina_scenelight',_ofSceneLight?'1':'0');}catch(e){} _ofApplyPrefs(); }
function ofToggleDensity(){ _ofCompact=!_ofCompact; try{localStorage.setItem('thelab_oficina_compact',_ofCompact?'1':'0');}catch(e){} _ofApplyPrefs(); }
// ── Buscador de trabajadores (nombre/área/rol) en la vista Tarjetas ──
function ofSearchInput(v){ _ofSearch=(v||'').trim().toLowerCase(); _ofReRenderCards(); }
function _ofReRenderCards(){ if(!_ofModel) return; const extras=(_ofModel.printerModel&&_ofModel.printerModel.length)?[{name:'Impresoras 3D',color:'#3aa0ff',members:_ofModel.printerModel}]:[]; _ofRenderCards(_ofModel.iaModel,_ofModel.autoModel,extras); }
// ── Rango de la analítica (7/14/30 días) ──
function ofSetChartRange(n){ _ofChartRange=+n||14; try{localStorage.setItem('thelab_oficina_range',String(_ofChartRange));}catch(e){}
  document.querySelectorAll('#oficinaRangeSel .of-vbtn').forEach(b=>b.classList.toggle('active',+b.dataset.r===_ofChartRange));
  if(_ofChartData) _ofRenderCharts(_ofChartData.runs,_ofChartData.ia,_ofChartData.auto);
}
// ── Exportar: descarga la escena 3D (SVG, sin taint) o copia el resumen de KPIs ──
function ofExport(){
  const svg=_ofSvg();
  if(_ofView==='iso' && svg){
    try{
      const clone=svg.cloneNode(true);
      if(svg.dataset.vb) clone.setAttribute('viewBox',svg.dataset.vb);   // B14: exporta la escena COMPLETA, no el encuadre con zoom
      clone.querySelectorAll('image').forEach(im=>{                       // B10: hrefs relativos → absolutos (sprites/modelos no salen rotos)
        const h=im.getAttribute('href')||im.getAttribute('xlink:href'); if(!h) return;
        try{ im.setAttribute('href',new URL(h,location.href).href); im.removeAttribute('xlink:href'); }catch(e){}
      });
      const src='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
      const blob=new Blob([src],{type:'image/svg+xml'}), url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download='oficina-thelab.svg'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      try{toast('Escena 3D exportada (SVG)','success');}catch(e){}
    }catch(e){ try{toast('No se pudo exportar la escena','error');}catch(x){} }
    return;
  }
  // Fuera de la vista 3D: copia un resumen de KPIs al portapapeles
  const grab=id=>{const el=document.querySelector(`#oficinaKpis .of-kpi:nth-child(${id}) .of-kpi-val`);return el?el.textContent.trim():'—';};
  const txt=`Oficina Virtual — The Lab Solutions\nTrabajadores: ${grab(1)}\nTrabajando ahora: ${grab(2)}\nEjecuciones hoy: ${grab(3)}\nEn cola: ${grab(4)}`;
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(()=>{try{toast('Resumen copiado al portapapeles','success');}catch(e){}}).catch(()=>{try{toast('No se pudo copiar','error');}catch(e){}}); }
  else { try{toast('Portapapeles no disponible','error');}catch(e){} }
}
// ── Panel de detalle de un agente IA (clic en un trabajador de la Oficina) ──
function ofAgentDetail(id){
  if(!_ofModel||!_ofModel.iaModel){ switchTab('agentes'); return; }
  const m=_ofModel.iaModel.find(x=>x.id===id);
  if(!m){ switchTab('agentes'); return; }
  const runs=_ofModel.byAgent[m.label]||[];
  _ofAgentRuns=runs;
  const col=_OF_STATUS[m.cls]||'#7c8590';
  const total=runs.length, today=runs.filter(r=>_ofSameDay(r.t)).length, last=runs[0];
  const cfg=AGENTES_CFG.find(a=>a.id===id);
  const rowsHtml=runs.length?runs.slice(0,10).map((r,i)=>`
      <div class="ofd-run" onclick="ofAgentViewRun(${i})" role="button" tabindex="0" onkeydown="ofKey(event)">
        <div class="ofd-run-top">
          <span class="ofd-run-q">${escapeHtml((r.input||r.output||'—').substring(0,70))}</span>
          <span class="ofd-run-t">${_ofAgo(r.t)}</span>
        </div>
      </div>`).join('')
    :'<div style="color:var(--text3);font-size:12px;padding:10px 2px">Sin ejecuciones registradas todavía.</div>';
  document.getElementById('ofAgentTitle').textContent=_ofAgentEmoji(m.label)+' '+_ofPretty(m.label);
  document.getElementById('ofAgentBody').innerHTML=`
    <div class="ofd-head">
      <div class="ofd-ava">${m.icon||'🤖'}</div>
      <div style="flex:1;min-width:0">
        <div class="ofd-role">${escapeHtml(m.role||'')}</div>
        <div class="ofd-status" style="color:${col}"><i style="background:${col}"></i>${escapeHtml(m.lbl||'')}</div>
      </div>
      ${m.spark?`<div class="ofd-spark" title="Ejecuciones últimos 7 días">${m.spark}</div>`:''}
    </div>
    <div class="ofd-stats">
      <div class="ofd-stat"><div class="ofd-stat-v">${today}</div><div class="ofd-stat-l">Hoy</div></div>
      <div class="ofd-stat"><div class="ofd-stat-v">${total}</div><div class="ofd-stat-l">Registradas</div></div>
      <div class="ofd-stat"><div class="ofd-stat-v mono">${last?escapeHtml(_ofAgo(last.t)):'—'}</div><div class="ofd-stat-l">Última</div></div>
    </div>
    ${_ofDetailHours(runs)}
    ${cfg?`<button class="btn btn-primary btn-sm" style="width:100%;margin-bottom:8px" onclick="ofAgentRun('${id}')">▶ Ejecutar este agente</button>`:''}
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:16px" onclick="closeOfAgent();ofFocusAgent('${escapeHtml(id)}')">📍 Ver en la oficina 3D</button>
    <div class="ofd-seclbl">Últimas ejecuciones</div>
    ${rowsHtml}`;
  const mo=document.getElementById('ofAgentModal'); if(mo) mo.style.display='flex';
}
// Mini-gráfico de carga de HOY por hora para el detalle de un agente (idea 8)
function _ofDetailHours(runs){
  const h=new Array(24).fill(0), t0=new Date(); t0.setHours(0,0,0,0); const a=t0.getTime(), b=a+864e5, nowH=new Date().getHours();
  (runs||[]).forEach(r=>{ if(r.t&&r.t>=a&&r.t<b) h[new Date(r.t).getHours()]++; });
  const max=Math.max(1,...h), total=h.reduce((s,v)=>s+v,0);
  if(!total) return '';
  const bars=h.map((v,i)=>`<i class="${i===nowH?'now':(v?'has':'')}" style="height:${Math.max(6,Math.round(v/max*100))}%" title="${i}:00 · ${v} ejec."></i>`).join('');
  return `<div class="ofd-seclbl">Carga de hoy por hora · ${total} ejec.</div><div class="ofd-hours" aria-hidden="true">${bars}</div>`;
}
function closeOfAgent(){ const e=document.getElementById('ofAgentModal'); if(e) e.style.display='none'; }
function ofAgentRun(id){ closeOfAgent(); switchTab('agentes'); setTimeout(()=>{const i=document.getElementById('input_'+id); if(i){ i.scrollIntoView({behavior:'smooth',block:'center'}); i.focus(); }},140); }
function ofAgentViewRun(idx){
  const r=_ofAgentRuns&&_ofAgentRuns[idx]; if(!r) return;
  closeOfAgent();
  document.getElementById('agentInlineTitle').textContent='📜 '+(r.agent||'Agente')+' — '+NOTIFY._fmtFull(r.time);
  const resultEl=document.getElementById('agentInlineResult');
  resultEl.className='agent-modal-result'; resultEl.style.whiteSpace='normal';
  // Consulta como cabecera ligera + salida procesada (suave y estructurada, igual que en Agentes).
  const consultaHtml=r.input?`<div style="font-size:11px;color:var(--text2);background:var(--surface3);border:1px solid var(--border);border-radius:8px;padding:8px 11px;margin-bottom:12px;line-height:1.5"><div style="font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;font-size:9.5px;margin-bottom:3px">▸ Consulta</div>${escapeHtml(String(r.input)).replace(/\n/g,'<br>')}</div>`:'';
  resultEl.innerHTML=consultaHtml+(r.output?formatAgentReport(r.output):'<span style="color:var(--text3)">(sin resultado guardado)</span>');
  _agentInlineText=r.output||'';
  document.getElementById('agentInlineActions').innerHTML=agentCtaButtonsHtml('',r.output||'')+'<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>';
  document.getElementById('agentInlineModal').style.display='flex';
}
function ofSetView(v){
  _ofView=v;
  try{localStorage.setItem('thelab_oficina_view',v);}catch(e){}
  document.querySelectorAll('#oficinaViewToggle .of-vbtn').forEach(b=>b.classList.toggle('active',b.dataset.v===v));
  const c=document.getElementById('oficinaCards'), f=document.getElementById('oficinaFloor'), i=document.getElementById('oficinaIso');
  if(c) c.style.display=v==='cards'?'':'none';
  if(f) f.style.display=v==='floor'?'':'none';
  if(i) i.style.display=v==='iso'?'':'none';
  document.querySelectorAll('#tab-oficina .of-cam-btn').forEach(b=>b.style.display=(v==='iso')?'':'none');   // B13: controles de cámara sólo en la vista 3D
  renderOficina();
}
function startOficinaPolling(){ clearInterval(_oficinaInterval); _oficinaInterval=setInterval(()=>{ if(!document.hidden) renderOficina(); },45000);
  clearInterval(_ofClockTimer); _ofClockTimer=setInterval(()=>{ if(!document.hidden && _ofView==='iso'){ _ofTickClock(); _ofTickLive(); } },20000);   // reloj + progreso de impresión: tic por mutación, sin reconstruir la escena
}
function stopOficinaPolling(){ clearInterval(_oficinaInterval); _oficinaInterval=null; clearInterval(_ofClockTimer); _ofClockTimer=null; clearTimeout(_ofCommTimer); clearTimeout(_ofCelebTimer); }
// Progreso de impresión EN VIVO por mutación (sin reconstruir): actualiza la barra y el rótulo
// de cada impresora desde la telemetría del bridge (_printerStatus). Complementa el tic del reloj.
function _ofTickLive(){
  const host=document.getElementById('oficinaIso'); if(!host) return;
  const live=(typeof _printerStatus!=='undefined')?_printerStatus:{};
  host.querySelectorAll('[data-pid]').forEach(g=>{
    const pid=g.getAttribute('data-pid'), lv=live[pid]; if(!lv||lv.state!=='printing') return;
    const prog=(typeof lv.progress==='number')?lv.progress:-1;
    const fill=g.querySelector('.of-pfill');
    if(fill && prog>=0){ const pw=parseFloat(fill.getAttribute('data-pw'))||0; fill.setAttribute('width',(pw*Math.max(0,Math.min(100,prog))/100).toFixed(1)); }
    const lbl=g.querySelector('.of-plabel');
    if(lbl){ const t=_ofPrinterLabelTxt(prog,lv.eta||0); if(lbl.textContent!==t) lbl.textContent=t; }
  });
}
// Actualiza sólo las manecillas del reloj de pared en la escena 3D (idea 5)
function _ofTickClock(){
  const g=document.getElementById('ofWallClock'); if(!g) return;
  const cx=parseFloat(g.dataset.cx), cy=parseFloat(g.dataset.cy); if(isNaN(cx)||isNaN(cy)) return;
  const now=new Date(), hr=now.getHours()%12, mn=now.getMinutes();
  const ha=(hr+mn/60)/12*2*Math.PI-Math.PI/2, ma=mn/60*2*Math.PI-Math.PI/2;
  const h=g.querySelector('.of-clock-h'), m=g.querySelector('.of-clock-m');
  if(h){ h.setAttribute('x2',(cx+6.5*Math.cos(ha)).toFixed(1)); h.setAttribute('y2',(cy+6.5*Math.sin(ha)).toFixed(1)); }
  if(m){ m.setAttribute('x2',(cx+10*Math.cos(ma)).toFixed(1)); m.setAttribute('y2',(cy+10*Math.sin(ma)).toFixed(1)); }
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden && document.getElementById('tab-oficina')?.classList.contains('active')) renderOficina();
});
// ── Pantalla completa (modo TV / kiosko 1080p) ─────────────────────────
function ofFullscreen(){
  const el=document.getElementById('tab-oficina'); if(!el) return;
  const req=el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen;
  const active=document.fullscreenElement||document.webkitFullscreenElement;
  if(req){
    if(!active){ try{ const p=req.call(el); if(p&&p.catch) p.catch(()=>_ofToggleFsCss(el)); }catch(e){ _ofToggleFsCss(el); } }   // requestFullscreen rechaza por promesa (no lanza): capturar ambos
    else { (document.exitFullscreen||document.webkitExitFullscreen||(()=>{})).call(document); }
  } else { _ofToggleFsCss(el); }   // navegador sin Fullscreen API → fallback CSS
}
let _ofWasFs=false;   // ¿la Oficina fue la que entró a pantalla completa? (evita reaccionar a fullscreen de otros módulos)
function _ofToggleFsCss(el){
  const on=el.classList.toggle('of-fs');
  const b=document.getElementById('ofFsBtn'); if(b) b.textContent=on?'✕ Salir':'📺 Pantalla completa';
  if(on){ if(_ofView!=='iso') _ofPrevView=_ofView; ofSetView('iso'); }   // TV → 3D, recordando la vista previa
  else ofSetView(_ofPrevView||'cards');                                  // al salir, restaura la vista del usuario
}
function _ofOnFsChange(){
  const el=document.getElementById('tab-oficina'); if(!el) return;
  const fe=document.fullscreenElement||document.webkitFullscreenElement;
  const fs=(fe===el);
  // Ignorar fullscreen de OTROS módulos (p. ej. el kiosko de Máquinas): sólo reaccionar
  // cuando la Oficina entra, o cuando salimos de un fullscreen que era de la Oficina.
  if(fs){ _ofWasFs=true; }
  else { if(!_ofWasFs) return; _ofWasFs=false; }
  el.classList.toggle('of-fs',fs);
  const b=document.getElementById('ofFsBtn'); if(b) b.textContent=fs?'✕ Salir':'📺 Pantalla completa';
  if(fs){ if(_ofView!=='iso') _ofPrevView=_ofView; ofSetView('iso'); }   // TV → 3D, recordando la vista previa
  else ofSetView(_ofPrevView||'cards');                                  // al salir, restaura la vista del usuario
}
document.addEventListener('fullscreenchange',_ofOnFsChange);
document.addEventListener('webkitfullscreenchange',_ofOnFsChange);
// ── Cámara de la escena 3D: pan (arrastrar), zoom (rueda/botones) y enfocar agente ──
function _ofSvg(){ const h=document.getElementById('oficinaIso'); return h&&h.querySelector('svg.of-iso-svg'); }
function _ofCamBase(svg){ const b=(svg.dataset.vb||'').split(' ').map(Number); return b.length===4?b:null; }
// Convierte coords de pantalla (clientX/Y) a coords de USUARIO del SVG usando la matriz real
// (getScreenCTM). Elimina la dependencia de r.width/r.height, que fallaba con el "letterbox"
// de preserveAspectRatio=…meet + max-height (B6). Devuelve null si la API no está disponible.
function _ofClientToUser(svg,cx,cy){
  try{ const ctm=svg.getScreenCTM(); if(!ctm) return null; const pt=svg.createSVGPoint(); pt.x=cx; pt.y=cy; const u=pt.matrixTransform(ctm.inverse()); return {x:u.x,y:u.y}; }catch(e){ return null; }
}
function _ofApplyCam(svg){
  if(!svg) return; const b=_ofCamBase(svg); if(!b) return; const [bx,by,bw,bh]=b;
  if(!_ofCam){ svg.setAttribute('viewBox',`${bx} ${by} ${bw} ${bh}`); return; }
  const s=Math.max(1,Math.min(6,_ofCam.scale||1)), w=bw/s, h=bh/s;
  const cx=Math.max(bx+w/2,Math.min(bx+bw-w/2,_ofCam.cx)), cy=Math.max(by+h/2,Math.min(by+bh-h/2,_ofCam.cy));
  _ofCam.cx=cx; _ofCam.cy=cy; _ofCam.scale=s;
  svg.setAttribute('viewBox',`${(cx-w/2).toFixed(1)} ${(cy-h/2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
}
function ofZoom(dir){ const svg=_ofSvg(); if(!svg)return; const b=_ofCamBase(svg); if(!b)return; if(!_ofCam)_ofCam={cx:b[0]+b[2]/2,cy:b[1]+b[3]/2,scale:1}; _ofCam.scale=Math.max(1,Math.min(6,_ofCam.scale*(dir>0?1.25:0.8))); _ofApplyCam(svg); }
function ofCamReset(){ _ofCam=null; _ofFollowId=null; const svg=_ofSvg(); if(svg)_ofApplyCam(svg); }
function ofFocusAgent(id){ _ofFollowId=id; if(_ofView!=='iso'){ ofSetView('iso'); return; } const svg=_ofSvg(); if(svg && _ofPos[id]){ const p=_ofPos[id]; _ofCam={cx:p[0],cy:p[1]-30,scale:2.4}; _ofFollowId=null; _ofApplyCam(svg); } else renderOficina(); }
function _ofInitCamControls(host){
  if(host._ofCamInit) return; host._ofCamInit=true;
  const scene=()=>host.querySelector('.of-iso-scene');
  // B22: pausa las animaciones de la escena cuando queda fuera del viewport (scroll al feed/analítica) → ahorra CPU/GPU
  if('IntersectionObserver' in window){
    try{ const io=new IntersectionObserver(es=>{ const en=es[es.length-1]; host.classList.toggle('of-paused', en.intersectionRatio<0.04); }, {threshold:[0,0.04,0.25]}); io.observe(host); }catch(e){}
  }
  // Zoom con rueda anclado al cursor (coords reales por CTM: el punto bajo el cursor queda fijo, B6)
  host.addEventListener('wheel',e=>{ if(!(e.ctrlKey||e.metaKey)) return; const svg=_ofSvg(); if(!svg)return; const b=_ofCamBase(svg); if(!b)return; e.preventDefault();
    if(!_ofCam)_ofCam={cx:b[0]+b[2]/2,cy:b[1]+b[3]/2,scale:1};
    const u=_ofClientToUser(svg,e.clientX,e.clientY);
    _ofCam.scale=Math.max(1,Math.min(6,_ofCam.scale*(e.deltaY<0?1.15:0.87))); _ofApplyCam(svg);
    if(u){ const u2=_ofClientToUser(svg,e.clientX,e.clientY); if(u2){ _ofCam.cx+=u.x-u2.x; _ofCam.cy+=u.y-u2.y; _ofApplyCam(svg); } }
  }, {passive:false});
  let drag=false,lx=0,ly=0,moved=false;
  host.addEventListener('pointerdown',e=>{ if(e.button!==0||e.pointerType==='touch')return; if(!_ofSvg())return; drag=true; moved=false; host._ofDragged=false; lx=e.clientX; ly=e.clientY; const sc=scene(); if(sc)sc.classList.add('of-grabbing'); });
  window.addEventListener('pointermove',e=>{ if(!drag)return; const svg=_ofSvg(); if(!svg)return; const b=_ofCamBase(svg); if(!b)return; if(!_ofCam)_ofCam={cx:b[0]+b[2]/2,cy:b[1]+b[3]/2,scale:1};
    if(Math.abs(e.clientX-lx)+Math.abs(e.clientY-ly)>4)moved=true;
    const u1=_ofClientToUser(svg,lx,ly), u2=_ofClientToUser(svg,e.clientX,e.clientY);
    if(u1&&u2){ _ofCam.cx-=(u2.x-u1.x); _ofCam.cy-=(u2.y-u1.y); }
    lx=e.clientX; ly=e.clientY; _ofApplyCam(svg); });
  const end=()=>{ if(!drag)return; drag=false; const sc=scene(); if(sc)sc.classList.remove('of-grabbing'); host._ofDragged=moved; };
  window.addEventListener('pointerup',end); window.addEventListener('pointercancel',end);
  // ── Táctil (móvil/tablet): pellizco para zoom + arrastre de un dedo para desplazar cuando hay zoom ──
  // (el pan por puntero ignora 'touch' para no pelear con el scroll; aquí damos gestos naturales)
  let _pt=null;
  const _dist=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  const _mid=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});
  host.addEventListener('touchstart',e=>{
    const svg=_ofSvg(); if(!svg)return; const b=_ofCamBase(svg); if(!b)return;
    if(e.touches.length===2){
      if(!_ofCam)_ofCam={cx:b[0]+b[2]/2,cy:b[1]+b[3]/2,scale:1};
      _pt={mode:'pinch',d0:_dist(e.touches[0],e.touches[1])||1,s0:_ofCam.scale,m:_mid(e.touches[0],e.touches[1])};
      e.preventDefault();
    } else if(e.touches.length===1 && _ofCam && _ofCam.scale>1.02){
      _pt={mode:'pan',x:e.touches[0].clientX,y:e.touches[0].clientY};
    } else { _pt=null; }
  },{passive:false});
  host.addEventListener('touchmove',e=>{
    if(!_pt)return; const svg=_ofSvg(); if(!svg)return; const b=_ofCamBase(svg); if(!b)return; const r=svg.getBoundingClientRect();
    if(_pt.mode==='pinch' && e.touches.length===2){
      e.preventDefault(); host._ofDragged=true;   // B8: un gesto no debe abrir el detalle al soltar
      const d=_dist(e.touches[0],e.touches[1]), mid=_mid(e.touches[0],e.touches[1]);
      const u=_ofClientToUser(svg,mid.x,mid.y);
      _ofCam.scale=Math.max(1,Math.min(6,_pt.s0*(d/_pt.d0))); _ofApplyCam(svg);
      if(u){ const u2=_ofClientToUser(svg,mid.x,mid.y); if(u2){ _ofCam.cx+=u.x-u2.x; _ofCam.cy+=u.y-u2.y; _ofApplyCam(svg); } }
    } else if(_pt.mode==='pan' && e.touches.length===1){
      e.preventDefault(); host._ofDragged=true;
      const u1=_ofClientToUser(svg,_pt.x,_pt.y), u2=_ofClientToUser(svg,e.touches[0].clientX,e.touches[0].clientY);
      if(u1&&u2){ _ofCam.cx-=(u2.x-u1.x); _ofCam.cy-=(u2.y-u1.y); _ofApplyCam(svg); }
      _pt.x=e.touches[0].clientX; _pt.y=e.touches[0].clientY;
    }
  },{passive:false});
  const _tend=()=>{ _pt=null; };
  host.addEventListener('touchend',_tend); host.addEventListener('touchcancel',_tend);
  host.addEventListener('click',e=>{ if(host._ofDragged){ e.stopPropagation(); e.preventDefault(); host._ofDragged=false; } }, true);   // un arrastre no abre el detalle
}
async function renderOficina(){
  if(!document.getElementById('tab-oficina')) return;
  if(_oficinaBusy) return;          // B4: evita ejecuciones solapadas
  _oficinaBusy=true;
  try{ await _renderOficina(); }
  catch(e){ /* nunca romper la UI */ }
  finally{ _oficinaBusy=false; }
}

async function _renderOficina(){
  _ofErr=false;
  // 1) Ejecuciones: historial local + Airtable (con caché corta de 25s)
  let runs=[];
  try{AGENT_LOG._load();runs=(AGENT_LOG._runs||[]).map(r=>({agent:r.agent,input:r.input,output:r.output,time:r.time}));}catch(e){}
  if(getToken()){
    if(_ofRunsCache.data && Date.now()-_ofRunsCache.t<_OF_CACHE_MS){
      runs=[...runs,..._ofRunsCache.data];
    }else{
      try{
        const res=await airtableFetch('Agent_Log',100);
        const remote=(res.records||[]).map(r=>({agent:r.fields['Agente']||'',input:r.fields['Consulta']||'',output:r.fields['Resultado']||'',time:r.fields['Fecha']||r.createdTime||''}));
        _ofRunsCache={t:Date.now(),data:remote};
        runs=[...runs,...remote];
      }catch(e){ _ofErr=true; if(_ofRunsCache.data) runs=[...runs,..._ofRunsCache.data]; }
    }
  }
  // Normalizar tiempo y deduplicar
  const seen=new Set();
  runs=runs.map(r=>({...r,t:Date.parse(r.time||'')||0}))
           .filter(r=>{const k=r.agent+'|'+(r.t||(r.input||'').slice(0,12))+'|'+(r.input||'').slice(0,30);if(seen.has(k))return false;seen.add(k);return true;})
           .sort((a,b)=>b.t-a.t);
  const byAgent={};
  runs.forEach(r=>{(byAgent[r.agent]=byAgent[r.agent]||[]).push(r);});

  // 2) Cola pendiente (con caché corta para no refetch en cada render/cambio de vista)
  let queueLen=_agentQueue.length;
  if(getToken()&&!queueLen){
    if(_ofQueueCache.len!=null && Date.now()-_ofQueueCache.t<_OF_CACHE_MS){ queueLen=_ofQueueCache.len; }
    else { try{const q=await airtableFetch(AGENT_QUEUE_TABLE,200);queueLen=(q.records||[]).length;_ofQueueCache={t:Date.now(),len:queueLen};}catch(e){_ofErr=true;if(_ofQueueCache.len!=null)queueLen=_ofQueueCache.len;} }
  }

  // 3) Telemetría de automatizaciones (tabla Automations) — con caché corta
  const autoState={};
  if(getToken()){
    if(_ofAutoCache.data && Date.now()-_ofAutoCache.t<_OF_CACHE_MS){ Object.assign(autoState,_ofAutoCache.data); }
    else {
      try{ const a=await airtableFetch('Automations',50); const fresh={}; (a.records||[]).forEach(r=>{const k=(r.fields['ID']||r.fields['Nombre']||'').toString().toLowerCase();if(k)fresh[k]=r.fields;}); Object.assign(autoState,fresh); _ofAutoCache={t:Date.now(),data:fresh}; }
      catch(e){_ofErr=true; if(_ofAutoCache.data) Object.assign(autoState,_ofAutoCache.data);}
    }
  }

  // ── Modelo: agentes IA (incluye agentes presentes en logs aunque no estén en CFG — B7) ──
  let working=0;
  const cfgLabels=new Set(AGENTES_CFG.map(a=>a.label));
  const extraIA=Object.keys(byAgent).filter(l=>l && !cfgLabels.has(l)).map(l=>({id:l,label:l,icon:'🤖'}));
  const iaModel=[...AGENTES_CFG,...extraIA].map(a=>{
    const list=byAgent[a.label]||[];
    const last=list[0], lastT=last?last.t:0;
    let cls,lbl;
    if(_ofActive.has(a.label)){ cls='of-work'; lbl='Trabajando'; }      // B5: en vivo, mientras ejecuta
    else { const st=_ofStatus(lastT); cls=st.cls; lbl=st.lbl; }
    if(cls==='of-work') working++;
    const today=list.filter(r=>_ofSameDay(r.t)).length;
    const count30=list.filter(r=>r.t && Date.now()-r.t<2592e6).length;   // ejecuciones últimos 30 días
    return {clickIA:true, id:a.id, label:a.label, icon:a.icon||'🤖', role:'Agente IA · '+_ofCat(a).name,
      cls, lbl, task:last?(last.input||last.output||''):'Sin tareas recientes',
      count30, stats:today+' hoy · '+_ofAgo(lastT), spark:_ofSpark(list)};
  });
  // 👑 Empleado del mes: el agente con MÁS ejecuciones en los últimos 30 días (si hay actividad)
  { let _bi=-1,_bv=0; iaModel.forEach((m,i)=>{ if((m.count30||0)>_bv){_bv=m.count30;_bi=i;} }); if(_bi>=0&&_bv>0) iaModel[_bi].top=true; }

  // ── Modelo: automatizaciones (data-driven: CFG + filas extra de la tabla) ──
  const cfgIds=new Set(AUTOMATIONS_CFG.map(a=>a.id.toLowerCase()));
  const extraAuto=Object.keys(autoState).filter(k=>!cfgIds.has(k)).map(k=>({id:k,label:autoState[k]['Nombre']||k,icon:'⚙️',tipo:autoState[k]['Tipo']||'Automatización',role:autoState[k]['Tipo']||'Automatización'}));
  let autoToday=0;
  const autoModel=[...AUTOMATIONS_CFG,...extraAuto].map(a=>{
    const f=autoState[a.id.toLowerCase()]||autoState[(a.label||'').toLowerCase()]||null;
    let cls='of-off', lbl='Sin telemetría', task=a.role, stats=a.tipo;
    if(f){
      const lastT=Date.parse(f['UltimaEjecucion']||f['Ultima Ejecucion']||f['Fecha']||'')||0;
      cls=_ofEstadoCls(f['Estado']) || _ofStatus(lastT).cls;            // B1: el campo Estado manda
      lbl=f['Estado']||_ofStatus(lastT).lbl;
      if(a.expectMins && lastT && (Date.now()-lastT)>a.expectMins*60000 && cls!=='of-error'){ cls='of-off'; lbl='Atrasado'; }  // atraso auto
      if(cls==='of-work') working++;
      task=(f['TareaActual']||f['Tarea Actual']||a.role).toString();
      const ej=Number(f['EjecucionesHoy']||f['Ejecuciones Hoy']||0); autoToday+=ej;   // B2
      stats=(ej?ej+' hoy · ':'')+_ofAgo(lastT);
    }
    if(a.id==='lead-worker'&&queueLen){ if(cls==='of-off'){cls='of-active';lbl='En cola';} task=queueLen+' tarea(s) en Agent_Queue'; stats=queueLen+' pendientes'; }
    return {clickIA:false, id:a.id, label:a.label, icon:a.icon||'⚙️', role:a.tipo||a.role, cls, lbl, task, stats};
  });

  // ── Impresoras 3D (tabla Maquinas) — con caché corta ──
  let printersRaw=[];
  if(getToken()){
    if(_ofMaqCache.data && Date.now()-_ofMaqCache.t<_OF_CACHE_MS){ printersRaw=_ofMaqCache.data; }
    else { try{ const mq=await airtableFetch('Maquinas',200); printersRaw=(mq.records||[]).map(r=>({id:r.fields.id||r.id,nombre:r.fields.nombre||'',num:r.fields.num||0,numG:r.fields.numG||r.fields.num||0,modelo:r.fields.modelo||'',color:r.fields.color||'#3aa0ff',estado:r.fields.estado||'disponible'})); _ofMaqCache={t:Date.now(),data:printersRaw}; }
      catch(e){ _ofErr=true; if(_ofMaqCache.data)printersRaw=_ofMaqCache.data; else if(typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS))printersRaw=MAQUINAS; } }
  } else if(typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)){ printersRaw=MAQUINAS; }
  const _liveP=(typeof _printerStatus!=='undefined')?_printerStatus:{};
  const printerModel=printersRaw.map(p=>{
    // Telemetría EN VIVO del bridge (si la pestaña Impresoras la ha poblado): manda sobre el estado de Airtable
    const lv=_liveP[String(p.id)]||null;
    let cls,lbl,progress=null,eta=0;
    if(lv && lv.state){ const ls=lv.state;
      if(ls==='printing'){ cls='of-work'; lbl='Imprimiendo'; progress=(typeof lv.progress==='number'?lv.progress:-1); eta=lv.eta||0; }
      else if(ls==='paused'){ cls='of-active'; lbl='En pausa'; progress=(typeof lv.progress==='number'?lv.progress:null); }
      else if(ls==='error'||ls==='shutdown'){ cls='of-error'; lbl='Con falla'; }
      else if(ls==='offline'||ls==='noip'){ cls='of-off'; lbl='Sin conexión'; }
      else { cls='of-off'; lbl='Disponible'; }
    } else { cls=_ofPrinterCls(p.estado); lbl=_ofPrinterLbl(p.estado); if(cls==='of-work') progress=-1; }   // sin bridge: barra indeterminada si "imprimiendo"
    if(cls==='of-work')working++;
    const pct=(progress!=null&&progress>=0)?(' · '+progress+'%'):'';
    return {clickIA:false, isPrinter:true, id:String(p.id), label:(p.nombre||('Impresora '+(p.num||''))).toString(), icon:'🖨️', img:_ofSafeUrl(_ofModelImg(p.modelo,p.nombre)), cam:!!(typeof printerCamUrl==='function'&&printerCamUrl(p.id)), role:'Impresora 3D · '+(p.modelo||p.nombre||''), cls, lbl, progress, eta, task:(p.modelo||'Impresora 3D')+' · '+lbl+pct, stats:''+(p.modelo||''), num:p.numG||p.num||0};
  }).sort((a,b)=>{ const rk=m=>{const s=((m.label||'')+' '+(m.role||'')).toLowerCase(); if(/k2\s*plus/.test(s))return 3; if(/giga|orangestorm/.test(s))return 4; if(/ender/.test(s))return 2; if(/k2/.test(s))return 1; if(/k1/.test(s))return 0; return 5;}; return rk(a)-rk(b)||(a.num-b.num); });
  const extraDepts=printerModel.length?[{name:'Impresoras 3D',color:'#3aa0ff',members:printerModel}]:[];

  // Guardar el modelo para el panel de detalle de agente (clic en un trabajador)
  _ofModel={byAgent, iaModel, autoModel, printerModel};

  // ── KPIs ── (ejecuciones hoy = todas las del log + las de automatizaciones — B2/B7)
  const runsToday=runs.filter(r=>_ofSameDay(r.t)).length + autoToday;
  const totalWorkers=iaModel.length+autoModel.length+printerModel.length;
  const kpis=document.getElementById('oficinaKpis');
  if(kpis) kpis.innerHTML=`
    <div class="of-kpi"><div class="of-kpi-val" data-k="workers">${totalWorkers}</div><div class="of-kpi-lbl">Trabajadores</div></div>
    <div class="of-kpi ${working?'live':''}"><div class="of-kpi-val" data-k="working">${working}</div><div class="of-kpi-lbl">Trabajando ahora</div></div>
    <div class="of-kpi ${runsToday?'live':''}"><div class="of-kpi-val" data-k="runsToday">${runsToday}</div><div class="of-kpi-lbl">Ejecuciones hoy</div></div>
    <div class="of-kpi ${queueLen?'live':''}"><div class="of-kpi-val" data-k="queue">${queueLen}</div><div class="of-kpi-lbl">En cola</div></div>`;
  _ofAnimateKpis({workers:totalWorkers,working,runsToday,queue:queueLen});   // count-up al cambiar (idea 4)

  const errEl=document.getElementById('oficinaErr'); if(errEl) errEl.style.display=_ofErr?'':'none';
  _ofApplyPrefs();                                                            // tema de escena + densidad persistidos
  _ofRenderAlerts(iaModel,autoModel,printerModel);                           // alertas accionables (idea 6)
  { const badge=document.getElementById('badge-oficina'); if(badge){ if(working>0){badge.textContent=working;badge.style.display='flex';} else badge.style.display='none'; } }  // badge del dock (idea 11)

  if(_ofView==='iso') _ofRenderIso(iaModel,autoModel,extraDepts);
  else if(_ofView==='floor') _ofRenderFloor(iaModel,autoModel,extraDepts);
  else _ofRenderCards(iaModel,autoModel,extraDepts);
  _ofRenderFeed(runs);
  _ofRenderCharts(runs,iaModel,[...autoModel,...printerModel]);
}
// Count-up de KPIs (sólo anima cuando el valor cambia; respeta reduce-motion)
function _ofAnimateKpis(vals){
  const host=document.getElementById('oficinaKpis'); if(!host) return;
  const red=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  Object.keys(vals).forEach(k=>{
    const el=host.querySelector(`.of-kpi-val[data-k="${k}"]`); if(!el) return;
    const to=vals[k]||0, from=(_ofPrevKpis[k]!=null?_ofPrevKpis[k]:0);
    if(red || from===to){ el.textContent=to; return; }
    _ofCountUp(el,from,to,520);
  });
  _ofPrevKpis=Object.assign({},vals);
}
function _ofCountUp(el,from,to,ms){
  let t0=null; const d=to-from;
  const step=now=>{ if(t0==null)t0=now; const p=Math.min(1,(now-t0)/ms), e=1-Math.pow(1-p,3); el.textContent=Math.round(from+d*e); if(p<1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// A qué pestaña salta el botón "Ver →" de una alerta según el id de la automatización
function _ofAutoTab(id){ id=(id||'').toLowerCase(); if(id.includes('mail'))return 'correo'; if(id.includes('printer')||id.includes('bridge'))return 'maquinas'; if(id.includes('lead'))return 'agentes'; if(id.includes('sii'))return 'finanzas'; return null; }
// ── Alertas accionables: automatizaciones con falla/atraso + agentes/impresoras en error (idea 6) ──
function _ofRenderAlerts(ia,auto,printers){
  const host=document.getElementById('oficinaAlerts'); if(!host) return;
  const items=[];
  (auto||[]).forEach(m=>{ if(m.cls==='of-error') items.push({t:'error',msg:`Automatización <b>${escapeHtml(_ofPretty(m.label))}</b> con falla`,tab:_ofAutoTab(m.id)});
    else if(/atras/i.test(m.lbl||'')) items.push({t:'warn',msg:`<b>${escapeHtml(_ofPretty(m.label))}</b> está atrasada`,tab:_ofAutoTab(m.id)}); });
  (ia||[]).forEach(m=>{ if(m.cls==='of-error') items.push({t:'error',msg:`Agente <b>${escapeHtml(_ofPretty(m.label))}</b> con error`,tab:'agentes'}); });
  (printers||[]).forEach(m=>{ if(m.cls==='of-error') items.push({t:'error',msg:`Impresora <b>${escapeHtml(_ofPretty(m.label))}</b> con falla`,tab:'maquinas'}); });
  if(!items.length){ host.style.display='none'; host.innerHTML=''; _ofPrevAlerts=''; return; }
  host.style.display='';
  host.innerHTML=items.slice(0,6).map(it=>`<div class="of-alert of-alert-${it.t}"><span class="of-alert-ic">${it.t==='error'?'🔴':'🟠'}</span><span class="of-alert-msg">${it.msg}</span>${it.tab?`<button class="btn btn-ghost btn-sm" onclick="switchTab('${it.tab}')">Ver →</button>`:''}</div>`).join('');
  const sig=items.map(i=>i.t+i.msg).join('|');
  if(_ofPrevAlerts && sig!==_ofPrevAlerts){ const n=items.filter(i=>i.t==='error').length; if(n){ try{toast('⚠ '+n+' incidencia(s) en la oficina','error');}catch(e){} } }
  _ofPrevAlerts=sig;
}

function _ofWorkerCard(m){
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
  const spark=m.spark?`<div class="of-spark-wrap" title="Ejecuciones últimos 7 días">${m.spark}</div>`:'';
  const cat=m.isPrinter?{name:'Impresora 3D',color:'#3aa0ff'}:(m.clickIA?_ofCat(m):{name:'Automatización',color:'#a78bfa'});
  const ac=cat.color;
  const avStyle=`background:radial-gradient(circle at 35% 28%,${ac}33,${ac}12);border-color:${ac}59;color:${ac}`;
  const _wspr=m.clickIA?_ofSprite(m):null;
  const avInner=_wspr?`<img src="${_wspr.front}" alt="" style="width:100%;height:100%;object-fit:contain;padding:2px">`
    :m.img?`<img src="${m.img}" alt="" style="width:100%;height:100%;object-fit:contain;padding:5px" onerror="this.replaceWith(document.createTextNode('🖨️'))">`:m.icon;
  const areaChip=`<span class="of-area-chip" style="color:${ac};background:${ac}1f;border-color:${ac}55">${escapeHtml(cat.name)}</span>`;
  // Acciones directas en tarjetas de impresora: webcam (si hay) + ir a Máquinas (idea 9)
  const printerActions=m.isPrinter?`<div class="of-card-actions">${m.cam?`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openWebcamModal('${escapeHtml(m.id)}')" title="Ver cámara en vivo">📷 Cámara</button>`:''}<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();switchTab('maquinas')" title="Abrir Máquinas">🔧 Controlar</button></div>`:'';
  return `<div class="of-worker ${m.cls}" role="button" tabindex="0" onkeydown="ofKey(event)" ${click} aria-label="${escapeHtml(m.label+' — '+m.lbl)}" title="${escapeHtml(_ofPretty(m.label))} · ${escapeHtml(cat.name)}">
    <div class="of-avatar" style="${avStyle}">${avInner}</div>
    <div class="of-body">
      <div class="of-name-row"><span class="of-dot"></span><span class="of-name">${escapeHtml(_ofPretty(m.label))}</span>${areaChip}${m.top?'<span title="Más ejecuciones en 30 días" style="margin-left:4px">👑</span>':''}</div>
      <div class="of-role">${escapeHtml(m.role)}</div>
      <div class="of-task">${escapeHtml((m.task||'').substring(0,90))}</div>
      <div class="of-foot"><span class="of-state-lbl">${escapeHtml(m.lbl)}</span><span class="of-stats">${escapeHtml(m.stats||'')}</span></div>
      ${printerActions}
      ${spark}
    </div>
  </div>`;
}
// Filtro por estado en la vista Tarjetas (Todos / Trabajando / Activo / Reposo / Error)
function ofSetCardFilter(f){
  _ofCardFilter=f||'all';
  try{localStorage.setItem('thelab_oficina_cardfilter',_ofCardFilter);}catch(e){}
  if(_ofModel){ const extras=(_ofModel.printerModel&&_ofModel.printerModel.length)?[{name:'Impresoras 3D',color:'#3aa0ff',members:_ofModel.printerModel}]:[]; _ofRenderCards(_ofModel.iaModel,_ofModel.autoModel,extras); }
}
function _ofRenderCards(ia,auto,extras){
  const printers=(extras&&extras[0]&&extras[0].members)||[];
  const allW=[...ia,...auto,...printers];
  // Barra de filtro por estado (se auto-resetea a Todos si el estado activo se queda sin trabajadores)
  const cnt=cls=>cls==='all'?allW.length:allW.filter(m=>m.cls===cls).length;
  if(_ofCardFilter!=='all' && !cnt(_ofCardFilter)) _ofCardFilter='all';
  let flt=_ofCardFilter;
  const bar=document.getElementById('oficinaCardFilter');
  if(bar){
    const states=[['all','Todos','var(--accent)'],['of-work','Trabajando',_OF_STATUS['of-work']],['of-active','Activo',_OF_STATUS['of-active']],['of-off','Reposo',_OF_STATUS['of-off']],['of-error','Con falla',_OF_STATUS['of-error']]];
    bar.innerHTML=states.filter(s=>s[0]==='all'||cnt(s[0])>0).map(([k,lbl,col])=>`<button class="of-feed-chip${flt===k?' active':''}" style="--cc:${col}" onclick="ofSetCardFilter('${k}')" aria-pressed="${flt===k}">${lbl} <b>${cnt(k)}</b></button>`).join('');
  }
  const q=_ofSearch;
  const match=m=>!q||((_ofPretty(m.label)+' '+(m.role||'')+' '+_ofAreaName(m)).toLowerCase().includes(q));
  const keep=m=>(flt==='all'||m.cls===flt)&&match(m);
  const fIA=ia.filter(keep), fAuto=auto.filter(keep), fPr=printers.filter(keep);
  const g1=document.getElementById('oficinaGridIA'), g2=document.getElementById('oficinaGridAuto');
  const z1=document.getElementById('oficinaZoneIA'), z2=document.getElementById('oficinaZoneAuto');
  if(g1) g1.innerHTML=fIA.map(_ofWorkerCard).join('');
  if(g2) g2.innerHTML=fAuto.map(_ofWorkerCard).join('');
  if(z1) z1.style.display=fIA.length?'':'none';
  if(g1) g1.style.display=fIA.length?'':'none';
  if(z2) z2.style.display=fAuto.length?'':'none';
  if(g2) g2.style.display=fAuto.length?'':'none';
  const g3=document.getElementById('oficinaGridPrinters'), z3=document.getElementById('oficinaZonePrinters');
  if(g3){ g3.innerHTML=fPr.map(_ofWorkerCard).join(''); g3.style.display=fPr.length?'':'none'; }
  if(z3) z3.style.display=fPr.length?'':'none';
  // Mensaje si el filtro/búsqueda no deja ningún trabajador visible
  const empty=document.getElementById('oficinaCardsEmpty');
  if(empty){ const none=!(fIA.length+fAuto.length+fPr.length); empty.style.display=none?'':'none'; if(none) empty.textContent=q?`Sin resultados para “${_ofSearch}”.`:'Sin trabajadores en este estado.'; }
}
function _ofDesk(m){
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
  const cat=m.isPrinter?{name:'Impresora 3D',color:'#3aa0ff'}:(m.clickIA?_ofCat(m):{name:'Automatización',color:'#a78bfa'});
  const ac=cat.color;
  const em=m.clickIA?_ofAgentEmoji(m.label):((m.icon&&!m.icon.startsWith('<'))?m.icon:'⚙️');
  const seatStyle=`background:radial-gradient(circle at 35% 28%,${ac}2e,${ac}10);border-color:${ac}55`;
  const _dspr=m.clickIA?_ofSprite(m):null;
  const seatInner=_dspr?`<img src="${_dspr.front}" alt="" style="width:100%;height:100%;object-fit:contain;padding:3px">`
    :m.img?`<img src="${m.img}" alt="" style="width:100%;height:100%;object-fit:contain;padding:6px" onerror="this.replaceWith(document.createTextNode('🖨️'))">`:em;
  return `<div class="of-desk ${m.cls}" role="button" tabindex="0" onkeydown="ofKey(event)" ${click} aria-label="${escapeHtml(m.label+' — '+m.lbl)}" title="${escapeHtml(_ofPretty(m.label)+' · '+cat.name+' — '+m.lbl)}">
    <div class="of-seat" style="${seatStyle}"><span class="of-seat-light"></span>${seatInner}</div>
    <div class="of-desk-name">${escapeHtml(_ofPretty(m.label))}</div>
    <div class="of-desk-state">${escapeHtml(m.lbl)}</div>
  </div>`;
}
function _ofRenderFloor(ia,auto,extras){
  const f=document.getElementById('oficinaFloor'); if(!f) return;
  const groups=_OF_CAT.map(c=>({c,items:ia.filter(m=>_ofCat(m).name===c.name)})).filter(g=>g.items.length);
  const otros=ia.filter(m=>_ofCat(m).name==='Otros'); if(otros.length) groups.push({c:{name:'Otros',color:'#7a7a7a'},items:otros});
  const sect=g=>`<div class="of-floor-grouplabel" style="color:${g.c.color}"><i style="background:${g.c.color}"></i>${g.c.name} · ${g.items.length}</div><div class="of-desks">${g.items.map(_ofDesk).join('')}</div>`;
  const extraSects=(extras||[]).filter(d=>d.members&&d.members.length).map(d=>`<div class="of-floor-label" style="margin-top:20px">🖨️ ${escapeHtml(d.name)}</div><div class="of-desks">${d.members.map(_ofDesk).join('')}</div>`).join('');
  f.innerHTML=`<div class="of-floorroom">
    <div class="of-floor-label">🤖 Agentes IA</div>
    ${groups.map(sect).join('')}
    ${auto.length?`<div class="of-floor-label" style="margin-top:20px">⚙️ Automatizaciones</div><div class="of-desks">${auto.map(_ofDesk).join('')}</div>`:''}
    ${extraSects}
  </div>`;
}

// ── Vista isométrica 2.5D (estilo Habbo Hotel) ─────────────────────────
const _OF_EMOJI={SALES:'💬',QUOTE:'📝',PRODUCTION:'🔧',QA:'✅',FOLLOWUP:'🔁',CEO:'📊',LEADGEN:'🎯',ONBOARDING:'🚀',FINANCE:'💰',ADS:'📣',COMMUNITY:'📷',NEWSLETTER:'📰',REPORT:'📈',SUPPLIER:'🔍'};
// ── Sprites pixel-art de agentes (personajes con arte propio en la Oficina) ──
// Cada set: front (parado, de cara), frontWalk, back, backWalk. El lookup es por
// id/label (contains), así cubre LEADGEN, LEAD_GEN_AGENT y LEAD_AGENT por igual.
const _OF_SPRITES=[
  {re:/LEAD/i, set:{front:'avatars/leads-front.png',frontWalk:'avatars/leads-front-walk.png',back:'avatars/leads-back.png',backWalk:'avatars/leads-back-walk.png'}},
];
function _ofSprite(m){
  const s=(((m&&m.id)||'')+' '+((m&&m.label)||'')).toUpperCase();
  for(const e of _OF_SPRITES){ if(e.re.test(s)) return e.set; }
  return null;
}
function _ofEmoji(m){
  if(!m.clickIA) return (m.icon && !m.icon.startsWith('<')) ? m.icon : '⚙️';
  const id=(m.id||'').toUpperCase();
  for(const k in _OF_EMOJI){ if(id.includes(k)) return _OF_EMOJI[k]; }
  return '🤖';
}
// Emoji por etiqueta de agente (p. ej. "SALES_AGENT") — cubre todas las áreas
// para que el feed y los avatares no caigan en el 🤖 genérico. Orden = específico→general.
const _OF_EMOJI_BYLABEL=[['SALES','💬'],['QUOTE','📝'],['PRODUCTION','🔧'],['QA','✅'],['FOLLOWUP','🔁'],['CEO','📊'],['CLIENTE','📋'],['NEWSLETTER','📰'],['REPORT','📈'],['CAPTION','✍️'],['COMMUNITY','📷'],['STRATEG','♟️'],['SOCIAL','📱'],['TREND','🔥'],['LINKEDIN','💼'],['CONTENT','🎨'],['ADS','📣'],['LEAD','🎯'],['ONBOARD','🚀'],['FINANCE','💰'],['SUPPLIER','🔍']];
function _ofAgentEmoji(label){
  const s=(label||'').toUpperCase();
  for(const [k,e] of _OF_EMOJI_BYLABEL){ if(s.includes(k)) return e; }
  return '🤖';
}
// Nombre de agente para MOSTRAR en español (solo visual; la etiqueta real no cambia).
const _OF_NAME_ES={
  'SALES_AGENT':'Ventas','QUOTE_AGENT':'Cotizador','PRODUCTION_AGENT':'Producción','QA_AGENT':'Calidad',
  'FOLLOWUP_AGENT':'Seguimiento','CEO_AGENT':'CEO','LEAD_GEN_AGENT':'Prospección','ONBOARDING_AGENT':'Bienvenida',
  'FINANCE_AGENT':'Finanzas','REPORTE_CLIENTE':'Reporte Cliente','CONTENT_AGENT':'Contenido','ADS_AGENT':'Publicidad',
  'AUDITOR_3D':'Mantención 3D',
  'LINKEDIN_AGENT':'LinkedIn','SOCIAL_STRATEGIST':'Estratega Social','CAPTION_AGENT':'Copys','COMMUNITY_AGENT':'Community',
  'SOCIAL_ADS_AGENT':'Ads Sociales','TREND_AGENT':'Tendencias','REPORT_SOCIAL_AGENT':'Reporte Social','NEWSLETTER_AGENT':'Newsletter',
  'LEAD_AGENT':'Gerente de Ventas'
};
function _ofPretty(label){
  if(_OF_NAME_ES[label]) return _OF_NAME_ES[label];
  return String(label||'').replace(/_AGENT$/i,'').replace(/_/g,' ').trim()||String(label||'');
}
// Categorías funcionales de los agentes IA (para agrupar dentro de la zona)
// Nota: _ofCat se usa con m.id en las vistas de oficina y con el LABEL (r.agent) en
// el feed/gráficos. Por eso las claves usan raíces que casan con AMBOS: p.ej. 'LEAD'
// cubre LEADGEN (id) y LEAD_GEN_AGENT/LEAD_AGENT (label); 'AUDITOR'/'MANTEN' cubren
// MANTENCION3D (id) y AUDITOR_3D (label) → así el área es idéntica en todas las vistas.
const _OF_CAT=[
  {name:'Dirección', color:'#a78bfa', ids:['CEO']},
  {name:'Comercial', color:'#00d4cc', ids:['SALES','QUOTE','FOLLOWUP','LEAD','ONBOARDING','REPCLIENTE','REPORTE_CLIENTE']},
  {name:'Producción',color:'#ffaa00', ids:['PRODUCTION','QA','SUPPLIER','AUDITOR','MANTEN']},
  {name:'Marketing', color:'#ff6b35', ids:['ADS','COMMUNITY','NEWSLETTER','REPORT','SOCIAL','CONTENT','CAPTION','LINKEDIN','TREND']},
  {name:'Finanzas',  color:'#00d4aa', ids:['FINANCE']},
];
function _ofCat(m){
  const id=(m.id||'').toUpperCase();
  for(const c of _OF_CAT){ if(c.ids.some(k=>id.includes(k))) return c; }
  return {name:'Otros', color:'#7a7a7a'};
}
function _ofShade(hex,f){
  const n=parseInt((hex||'#5e5e5e').replace('#',''),16);
  let r=Math.round(((n>>16)&255)*f), g=Math.round(((n>>8)&255)*f), b=Math.round((n&255)*f);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
// Paleta única de estado (avatares 3D, dona y leyendas — coherencia total)
const _OF_STATUS={'of-work':'#00d4aa','of-active':'#00d4cc','of-error':'#ff4444','of-off':'#7c8590'};
// Texto del rótulo de progreso de impresión (reutilizado por el render y por la mutación en vivo)
function _ofPrinterLabelTxt(progress,eta){
  const _eta=s=>{ s=Math.max(0,Math.round(s||0)); const h=Math.floor(s/3600), mi=Math.floor((s%3600)/60); return h?h+'h'+(mi<10?'0':'')+mi:mi+'m'; };
  const det=progress>=0;
  return '🖨️ '+(det?progress+'%':'···')+((det&&eta&&progress<100)?' · '+_eta(eta):'');
}
function _ofIsoStation(m,x,y){
  const col=_OF_STATUS[m.cls]||'#7c8590';
  if(m.isPrinter){
    const working=m.cls==='of-work';
    const s=((m.label||'')+' '+(m.role||'')).toLowerCase();
    const big=/giga|orangestorm/.test(s)?1.5:(/k2\s*plus/.test(s)?1.18:1);
    const Wp=44*big, Hp=50*big, th=_ofTileH||62;
    const f=n=>n.toFixed(1);
    const pclick=`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
    const baseY=th*0.14;   // la impresora se apoya sobre el mesón común (elevación dada por el translate)
    const halo=working?`<ellipse cx="0" cy="${f(baseY-Hp*0.5)}" rx="${(24*big).toFixed(0)}" ry="${(28*big).toFixed(0)}" fill="${col}" opacity="0.3" filter="url(#ofHalo)"/>`:'';
    const body=m.img?`<image href="${m.img}" x="${f(-Wp/2)}" y="${f(baseY-Hp)}" width="${f(Wp)}" height="${f(Hp)}" preserveAspectRatio="xMidYMid meet"/>`:`<text x="0" y="${f(baseY-Hp*0.28)}" text-anchor="middle" font-size="${(36*big).toFixed(0)}">🖨️</text>`;
    const light=`<circle cx="${f(Wp*0.36)}" cy="${f(baseY-Hp*0.82)}" r="4.6" fill="${col}" stroke="#fff" stroke-width="1.3"${working?' class="of-iso-blink"':''}/>`;
    const camb=m.cam?`<g transform="translate(${f(-Wp*0.34)},${f(baseY-Hp*0.9)})"><circle r="6.5" fill="#0e1116" opacity="0.82"/><text x="0" y="3.2" text-anchor="middle" font-size="8">📷</text></g>`:'';   // tiene webcam → clic para verla
    const shadow=`<ellipse cx="0" cy="${f(baseY+2)}" rx="${(Wp*0.46).toFixed(0)}" ry="${(6*big).toFixed(0)}" fill="url(#ofShadow)"/>`;
    // Barra de PROGRESO de impresión (real si el bridge la reporta; indeterminada si solo se sabe que imprime)
    let prog='';
    if(working && m.progress!=null){
      const pw=Wp*0.78, px=-pw/2, py=baseY-Hp*0.16, ph=4.4, det=m.progress>=0;
      const fillW=det?pw*Math.max(0,Math.min(100,m.progress))/100:pw;
      const lblT=_ofPrinterLabelTxt(m.progress,m.eta);
      const lw=Math.max(48, lblT.length*4.9+14);   // ancho del rótulo según el texto (evita desborde, B19)
      prog=`<rect x="${f(px)}" y="${f(py)}" width="${f(pw)}" height="${ph}" rx="${ph/2}" fill="#0f1114" opacity="0.85"/>`
        +(det?`<rect class="of-pfill" data-pw="${f(pw)}" x="${f(px)}" y="${f(py)}" width="${f(fillW)}" height="${ph}" rx="${ph/2}" fill="${col}"/>`
             :`<rect class="of-prog-ind" x="${f(px)}" y="${f(py)}" width="${f(pw*0.4)}" height="${ph}" rx="${ph/2}" fill="${col}" style="--pw:${f(pw)}px"/>`)
        +`<g transform="translate(0,${f(baseY-Hp-7)})"><rect x="${f(-lw/2)}" y="-8.5" width="${f(lw)}" height="13" rx="6.5" fill="#0e1116" opacity="0.9"/><text class="of-plabel" x="0" y="1.5" text-anchor="middle" font-size="8" fill="#fff" font-family="DM Sans" font-weight="700">${lblT}</text></g>`;
    }
    return `<g class="of-iso-char" data-pid="${escapeHtml(m.id)}" ${pclick} role="button" tabindex="0" onkeydown="ofKey(event)" transform="translate(${x},${y})">
      <title>${escapeHtml(m.label+' — '+m.lbl)}</title>
      ${shadow}${halo}
      <g class="of-iso-body">${body}${light}${camb}</g>
      ${prog}
    </g>`;
  }
  // ⚠️ CÓDIGO OBSOLETO (B20): _ofIsoStation SÓLO se invoca para impresoras (rama isPrinter de
  // _ofRenderIso). Los agentes se dibujan con _ofRingAgent alrededor del mesón. Todo lo que sigue
  // (personaje "sentado con piernas" + burbuja a y=-120) NUNCA se renderiza; se conserva sólo por
  // seguridad/histórico y no debe usarse. No añadir features aquí.
  const dark=_ofShade(col,0.72);
  const cat=m.clickIA?_ofCat(m):null;
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
  const em=_ofEmoji(m), working=m.cls==='of-work', bob=working?' of-iso-bob':'';
  let bubble='';
  if(working){
    const t=escapeHtml(((m.task||'').trim().slice(0,22))||'trabajando…');
    const bw=Math.max(54,Math.min(138,t.length*5.6+16));
    bubble=`<g transform="translate(0,-120)"><rect x="${-bw/2}" y="-11" width="${bw}" height="19" rx="8" fill="#ffffff" stroke="${col}" stroke-width="1.4"/><polygon points="-4.5,6 4.5,6 0,13" fill="#ffffff"/><line x1="-4.5" y1="6" x2="0" y2="13" stroke="${col}" stroke-width="1.4"/><line x1="4.5" y1="6" x2="0" y2="13" stroke="${col}" stroke-width="1.4"/><text x="0" y="2.5" text-anchor="middle" font-size="8.5" fill="#222831" font-family="DM Sans" font-weight="600">${t}</text></g>`;
  }
  const ring=cat?`<ellipse cx="0" cy="5" rx="19" ry="9.5" fill="none" stroke="${cat.color}" stroke-width="2.5" opacity="0.6"/>`:'';
  const halo=working?`<ellipse cx="0" cy="-40" rx="27" ry="32" fill="${col}" opacity="0.3" filter="url(#ofHalo)"/>`:'';
  // MESÓN COMÚN: las caras de baldosas contiguas se unen en una sola barra por fila; el agente va SENTADO detrás
  const _th=_ofTileH||62, _f=n=>n.toFixed(1);
  // Computador GRANDE (monitor) sobre el mesón, delante del agente sentado
  const _my=_th*0.20, _scr=working?col:'#5b7184';
  const monitor=`<rect x="-13" y="${_f(_my-20)}" width="26" height="16.5" rx="1.8" fill="#0f1114"/><rect x="-11.1" y="${_f(_my-18.1)}" width="22.2" height="12.7" rx="1" fill="${_scr}" opacity="${working?'0.96':'0.5'}"/>`
    +(working?`<polyline points="-8,${_f(_my-10)} -3,${_f(_my-14)} 1,${_f(_my-9)} 5,${_f(_my-15)} 8,${_f(_my-11)}" fill="none" stroke="#0c100e" stroke-width="1.1" opacity="0.5"/>`:'')
    +`<rect x="-2.4" y="${_f(_my-3.5)}" width="4.8" height="3.4" fill="#0f1114"/><rect x="-8" y="${_f(_my)}" width="16" height="3" rx="1.4" fill="#1a1d22"/>`
    +`<rect x="-11" y="${_f(_my+4)}" width="22" height="3.6" rx="1.6" fill="#d3dae2"/>`;
  // Agente SENTADO en el mesón común (sin piernas; asoma torso y cabeza)
  // Si el agente tiene sprite pixel-art propio (p.ej. Gerente de Ventas), el
  // personaje completo reemplaza al genérico: de pie tras el mesón, mismo
  // halo/luz/burbuja y mismas animaciones (bob/breathe sobre .of-iso-body).
  const spr=m.clickIA?_ofSprite(m):null;
  const seat=spr?`<g class="of-iso-body">
      <image href="${spr.front}" x="-14" y="-58" width="28" height="70" preserveAspectRatio="xMidYMid meet"/>
      <circle cx="13" cy="-52" r="3.8" fill="${col}" stroke="#fff" stroke-width="1.1"${working?' class="of-iso-blink"':''}/>
    </g>`:`<g class="of-iso-body">
      <rect ${working?'class="of-type-l"':''} x="-16" y="-15" width="6.5" height="16" rx="3.2" fill="${dark}"/>
      <rect ${working?'class="of-type-r"':''} x="9.5" y="-15" width="6.5" height="16" rx="3.2" fill="${dark}"/>
      <rect x="-13" y="-23" width="26" height="26" rx="12" fill="${col}"/>
      <rect x="-13" y="-23" width="26" height="26" rx="12" fill="url(#ofShine)"/>
      <circle cx="0" cy="-35" r="15" fill="#fff7ec" stroke="${col}" stroke-width="3"/>
      <ellipse cx="-5" cy="-40" rx="4.2" ry="2.8" fill="#fff" opacity="0.6"/>
      ${m.img?`<image href="${m.img}" x="-12.5" y="-47.5" width="25" height="25" preserveAspectRatio="xMidYMid meet"/>`:`<text x="0" y="-30" text-anchor="middle" font-size="16">${em}</text>`}
      <circle cx="12" cy="-46" r="3.8" fill="${col}" stroke="#fff" stroke-width="1.1"${working?' class="of-iso-blink"':''}/>
    </g>`;
  return `<g class="of-iso-char${bob}" ${click} role="button" tabindex="0" onkeydown="ofKey(event)" transform="translate(${x},${y})">
    <title>${escapeHtml(m.label+' — '+m.lbl+(cat?' · '+cat.name:''))}</title>
    <ellipse cx="0" cy="2" rx="15" ry="6.5" fill="url(#ofShadow)"/>
    ${halo}
    <g transform="scale(1.04)">${seat}</g>
    ${monitor}
    ${bubble}
  </g>`;
}
// Placa de nombre dibujada en una capa SUPERIOR (para que ninguna estación tape el nombre de otra)
function _ofIsoTag(m,x,y){
  const pretty=_ofPretty(m.label);
  const raw=pretty.length>16?pretty.slice(0,15)+'…':pretty;
  const nm=escapeHtml(raw);
  const w=Math.max(38,raw.length*5.4+12);
  const ty=(_ofTileH||62)/2+7;   // debajo del frente del mesón
  return `<g transform="translate(${x},${y})" pointer-events="none"><rect x="${-w/2}" y="${ty.toFixed(1)}" width="${w}" height="14" rx="7" fill="#0e1116" opacity="0.85"/><text x="0" y="${(ty+9.5).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="#ffffff" font-family="DM Sans" font-weight="600">${nm}</text></g>`;
}
function _ofWalker(p1,p2,dur,delay,em){
  return `<g class="of-iso-walker" style="--x1:${p1[0]}px;--y1:${p1[1]}px;--x2:${p2[0]}px;--y2:${p2[1]}px;--dur:${dur}s;animation-delay:${delay}s">
    <ellipse cx="0" cy="2" rx="12" ry="6" fill="url(#ofShadow)"/>
    <g class="of-iso-body">
      <rect x="-6.5" y="-9" width="5" height="9" rx="2.5" fill="#5a6470"/>
      <rect x="1.5" y="-9" width="5" height="9" rx="2.5" fill="#5a6470"/>
      <rect x="-8.5" y="-27" width="17" height="20" rx="8" fill="#7e8a96"/>
      <rect x="-8.5" y="-27" width="17" height="20" rx="8" fill="url(#ofShine)"/>
      <circle cx="0" cy="-35" r="10.5" fill="#fff7ec" stroke="#8a96a2" stroke-width="2.5"/>
      <text x="0" y="-31" text-anchor="middle" font-size="12">${em}</text>
    </g>
  </g>`;
}
// Agente que CAMINA a otro departamento porque se está comunicando (lleva su color y su emoji + 💬)
function _ofCommWalker(m,p1,p2,dur,delay){
  const col=_OF_STATUS[m.cls]||_OF_STATUS['of-work'];
  const dark=_ofShade(col,0.72), em=_ofEmoji(m);
  const spr=_ofSprite(m);
  const body=spr?`<image href="${p2[1]<p1[1]?spr.backWalk:spr.frontWalk}" x="-11" y="-48" width="22" height="50" preserveAspectRatio="xMidYMid meet"/>`
    :`<rect x="-6.5" y="-9" width="5" height="9" rx="2.5" fill="${dark}"/>
      <rect x="1.5" y="-9" width="5" height="9" rx="2.5" fill="${dark}"/>
      <rect x="-8.5" y="-28" width="17" height="21" rx="8" fill="${col}"/>
      <rect x="-8.5" y="-28" width="17" height="21" rx="8" fill="url(#ofShine)"/>
      <circle cx="0" cy="-36" r="10.5" fill="#fff7ec" stroke="${col}" stroke-width="2.6"/>
      <text x="0" y="-32" text-anchor="middle" font-size="12">${em}</text>`;
  // Interactivo como el resto: el agente en tránsito se puede abrir/enfocar (B23)
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:(m.id?`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`:'');
  return `<g class="of-iso-walker of-iso-char"${click?' role="button" tabindex="0" onkeydown="ofKey(event)" '+click:''} style="--x1:${p1[0].toFixed(1)}px;--y1:${p1[1].toFixed(1)}px;--x2:${p2[0].toFixed(1)}px;--y2:${p2[1].toFixed(1)}px;--dur:${(dur||4.6)}s;animation-delay:${delay||0}s">
    <title>${escapeHtml(_ofPretty(m.label)+' — comunicándose')}</title>
    <ellipse cx="0" cy="2" rx="12" ry="6" fill="url(#ofShadow)"/>
    <g class="of-iso-body">${body}</g>
    <g transform="translate(0,-56)"><rect x="-11" y="-9" width="22" height="16" rx="8" fill="#ffffff" stroke="${col}" stroke-width="1.3"/><polygon points="-4,6 4,6 0,12" fill="#fff"/><text x="0" y="3" text-anchor="middle" font-size="10">💬</text></g>
  </g>`;
}
// Hash determinista (estable entre renders → las pausas no "saltan" al re-renderizar)
function _ofHash(s){ let h=2166136261; s=String(s); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
// Agente en STAND BY que sale a una pausa: camina de su puesto a la cafetería/baño y vuelve.
// La burbuja (☕/🚻) sólo aparece mientras está en la amenidad (sincronizada por --dur).
function _ofBreakWalker(m,home,dest,kind,dur,delay){
  const col=_OF_STATUS[m.cls]||'#7c8590', dark=_ofShade(col,0.72), em=_ofEmoji(m), f=n=>n.toFixed(1);
  const bub=kind==='wc'?'🚻':'☕', lbl=kind==='wc'?'en una pausa':'por un café';
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
  const spr=m.clickIA?_ofSprite(m):null;
  const body=spr?`<image href="${dest[1]<home[1]?spr.backWalk:spr.frontWalk}" x="-11" y="-48" width="22" height="50" preserveAspectRatio="xMidYMid meet"/>`
    :`<rect x="-6.5" y="-9" width="5" height="9" rx="2.5" fill="${dark}"/>
      <rect x="1.5" y="-9" width="5" height="9" rx="2.5" fill="${dark}"/>
      <rect x="-8.5" y="-28" width="17" height="21" rx="8" fill="${col}"/>
      <rect x="-8.5" y="-28" width="17" height="21" rx="8" fill="url(#ofShine)"/>
      <circle cx="0" cy="-36" r="10.5" fill="#fff7ec" stroke="${col}" stroke-width="2.6"/>
      ${m.img?`<image href="${m.img}" x="-9" y="-45.5" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>`:`<text x="0" y="-32" text-anchor="middle" font-size="12">${em}</text>`}`;
  return `<g class="of-iso-errand" ${click} role="button" tabindex="0" onkeydown="ofKey(event)" style="--hx:${f(home[0])}px;--hy:${f(home[1])}px;--ax:${f(dest[0])}px;--ay:${f(dest[1])}px;--dur:${dur}s;--dl:${delay}s">
    <title>${escapeHtml(m.label+' — '+lbl)}</title>
    <ellipse cx="0" cy="2" rx="12" ry="6" fill="url(#ofShadow)"/>
    <g class="of-iso-body">${body}</g>
    <g class="of-iso-errand-bubble" transform="translate(0,-52)"><rect x="-11" y="-9" width="22" height="16" rx="8" fill="#ffffff" stroke="${col}" stroke-width="1.3"/><polygon points="-4,6 4,6 0,12" fill="#fff"/><text x="0" y="3" text-anchor="middle" font-size="10">${bub}</text></g>
  </g>`;
}
// Cafetería (destino de las pausas de café), con vapor que sube de la taza
function _ofCoffee(cx,cy){ const f=n=>n.toFixed(1);
  return `<g transform="translate(${f(cx)},${f(cy)})">
    <ellipse cx="0" cy="8" rx="20" ry="6.5" fill="url(#ofShadow)" opacity="0.5"/>
    <rect x="-17" y="-6" width="34" height="14" rx="3" fill="#aeb8c4"/><rect x="-17" y="-6" width="34" height="4" rx="2" fill="#cdd6df"/>
    <rect x="-11" y="-25" width="22" height="19" rx="3" fill="#23282f"/><rect x="-8" y="-21" width="16" height="7" rx="1.4" fill="#39414c"/>
    <circle cx="7.5" cy="-9.5" r="1.5" fill="#3ad07a"/>
    <path class="of-steam" d="M-3,-29 q-2,-3 0,-6" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
    <path class="of-steam" d="M3,-29 q2,-3 0,-6" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.7" style="animation-delay:-1.3s"/>
    <text x="0" y="3.5" text-anchor="middle" font-size="13">☕</text>
    <g transform="translate(0,-37)"><rect x="-17" y="-8" width="34" height="13" rx="6.5" fill="#0e1116" opacity="0.9"/><text x="0" y="1.5" text-anchor="middle" font-size="8" fill="#fff" font-family="DM Sans" font-weight="700">CAFÉ</text></g>
  </g>`;
}
// Baño (destino de las pausas) — marco abierto con señalética, coherente con el resto
function _ofRestroom(cx,cy){ const f=n=>n.toFixed(1);
  return `<g transform="translate(${f(cx)},${f(cy)})">
    <ellipse cx="0" cy="7" rx="18" ry="6" fill="url(#ofShadow)" opacity="0.5"/>
    <rect x="-15" y="-2" width="30" height="9" rx="2" fill="#9aa6b3"/>
    <rect x="-15" y="-32" width="7.5" height="30" rx="2" fill="#c4cdd7"/><rect x="7.5" y="-32" width="7.5" height="30" rx="2" fill="#b6c0cb"/>
    <rect x="-15" y="-37" width="30" height="6.5" rx="2" fill="#aeb8c4"/>
    <rect x="-7.5" y="-30" width="15" height="28" fill="url(#ofDoorway)"/>
    <text x="0" y="-12" text-anchor="middle" font-size="13">🚻</text>
    <g transform="translate(0,-45)"><rect x="-13" y="-8" width="26" height="13" rx="6.5" fill="#0e1116" opacity="0.9"/><text x="0" y="1.5" text-anchor="middle" font-size="8" fill="#fff" font-family="DM Sans" font-weight="700">WC</text></g>
  </g>`;
}
// Mesa de reunión central (mesón) — elipse isométrica elevada con el color del depto
function _ofMeetingTable(cx,cy,rx,ry,color,h){
  h=h||16; const f=n=>n.toFixed(1);
  const sh=`<ellipse cx="${f(cx)}" cy="${f(cy+4)}" rx="${f(rx*1.04)}" ry="${f(ry)}" fill="url(#ofShadow)" opacity="0.55"/>`;
  const band=`<path d="M${f(cx-rx)},${f(cy-h)} A${f(rx)},${f(ry)} 0 0 0 ${f(cx+rx)},${f(cy-h)} L${f(cx+rx)},${f(cy)} A${f(rx)},${f(ry)} 0 0 1 ${f(cx-rx)},${f(cy)} Z" fill="#aab4c0"/>`;
  const top=`<ellipse cx="${f(cx)}" cy="${f(cy-h)}" rx="${f(rx)}" ry="${f(ry)}" fill="#e8edf2"/>`;
  const tint=`<ellipse cx="${f(cx)}" cy="${f(cy-h)}" rx="${f(rx)}" ry="${f(ry)}" fill="${color}" opacity="0.16" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5"/>`;
  return sh+band+top+tint;
}
// Laptop sobre la mesa (se dibuja después de la mesa, por profundidad)
function _ofDeskLaptop(x,y,working,col){
  const f=n=>n.toFixed(1), scr=working?col:'#5b7184';
  const glow=working?`<rect x="-7.2" y="-13" width="14.4" height="9" rx="2" fill="${col}" opacity="0.5" filter="url(#ofHalo)"/>`:'';
  return `<g transform="translate(${f(x)},${f(y)})">${glow}<polygon points="-11,0 0,5 11,0 0,-5" fill="#cfd6de"/><polygon points="-11,0 0,5 0,-5" fill="#bcc5cf"/><rect x="-9" y="-13.5" width="18" height="12" rx="1.6" fill="#15171a"/><rect x="-7.4" y="-11.9" width="14.8" height="8.8" rx="1" fill="${scr}" opacity="${working?'0.97':'0.5'}"/><rect x="-7.4" y="-11.9" width="14.8" height="3.4" rx="1" fill="#ffffff" opacity="0.18"/></g>`;
}
// Agente SENTADO alrededor de la mesa (mira a cámara)
function _ofRingAgent(m,x,y,facing){
  const col=_OF_STATUS[m.cls]||'#7c8590', dark=_ofShade(col,0.72), working=m.cls==='of-work', em=_ofEmoji(m);
  const click=m.clickIA?`data-ia-id="${escapeHtml(m.id)}" onclick="ofAgentDetail(this.dataset.iaId)"`:`data-auto-id="${escapeHtml(m.id)}" onclick="ofAutoInfo(this)"`;
  const f=n=>n.toFixed(1), bob=working?' of-iso-bob':' of-iso-breathe';
  const bd=working?'':` style="--bd:-${(_ofHash(m.id)%48)/10}s"`;   // respiración escalonada por agente
  const halo=working?`<ellipse cx="0" cy="-28" rx="22" ry="25" fill="${col}" opacity="0.28" filter="url(#ofHalo)"/>`:'';
  const celebrating=_ofCelebs.some(c=>c.label===m.label && Date.now()-c.t<_OF_CELEB_MS);
  // 👑 empleado del mes
  const crown=m.top?`<g class="of-crown" transform="translate(0,-52)"><text x="0" y="0" text-anchor="middle" font-size="15">👑</text></g>`:'';
  // Reacción sobre la cabeza: 🎉 al completar · ⛈️ si hay error · 💤 en reposo
  const reaction=celebrating
    ? `<g class="of-celeb" transform="translate(0,-62)"><text class="of-spark1" x="-15" y="-3" font-size="10">✨</text><text x="0" y="0" text-anchor="middle" font-size="18">🎉</text><text class="of-spark2" x="13" y="-1" font-size="10">✨</text></g>`
    : (m.cls==='of-error'
      ? `<g class="of-mood of-mood-storm" transform="translate(0,-60)"><ellipse cx="0" cy="0" rx="11" ry="6" fill="#7a828d"/><ellipse cx="-5.5" cy="-2.5" rx="6" ry="4.5" fill="#9aa3ad"/><ellipse cx="5.5" cy="-2.5" rx="6" ry="4.5" fill="#9aa3ad"/><polygon points="-1,4 3,4 0,10 4,10 -2,18 0,9 -3,9" fill="#ffd23f"/></g>`
      : ((!working&&!m.top) ? `<g class="of-mood of-mood-sleep" transform="translate(11,-54)"><text x="0" y="0" font-size="10" fill="#aeb8c4" font-weight="700">z</text><text x="4" y="-6" font-size="7" fill="#9aa6b3" font-weight="700">z</text></g>` : ''));
  return `<g class="of-iso-char${bob}"${bd} ${click} role="button" tabindex="0" onkeydown="ofKey(event)" transform="translate(${f(x)},${f(y)})">
    <title>${escapeHtml(m.label+' — '+m.lbl)}</title>
    <ellipse cx="0" cy="3" rx="13" ry="5.5" fill="url(#ofShadow)"/>
    ${halo}
    ${(()=>{
      // Sprite pixel-art propio: reemplaza al personaje genérico. Los agentes del
      // lado frontal de la mesa miran hacia ella (de espaldas al espectador).
      const spr=m.clickIA?_ofSprite(m):null;
      if(spr) return `<g class="of-iso-body">
      <image href="${facing==='back'?spr.back:spr.front}" x="-13" y="-55" width="26" height="64" preserveAspectRatio="xMidYMid meet"/>
      <circle cx="12" cy="-50" r="3.6" fill="${col}" stroke="#fff" stroke-width="1.1"${working?' class="of-iso-blink"':''}/>
    </g>`;
      return `<g class="of-iso-body">
      <rect ${working?'class="of-type-l"':''} x="-14" y="-13" width="6" height="15" rx="3" fill="${dark}"/>
      <rect ${working?'class="of-type-r"':''} x="8" y="-13" width="6" height="15" rx="3" fill="${dark}"/>
      <rect x="-12" y="-22" width="24" height="25" rx="11" fill="${col}"/>
      <rect x="-12" y="-22" width="24" height="25" rx="11" fill="url(#ofShine)"/>
      <circle cx="0" cy="-34" r="14" fill="#fff7ec" stroke="${col}" stroke-width="3"/>
      <ellipse cx="-5" cy="-39" rx="4" ry="2.6" fill="#fff" opacity="0.6"/>
      ${m.img?`<image href="${m.img}" x="-12" y="-46" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>`:`<text x="0" y="-29" text-anchor="middle" font-size="16">${em}</text>`}
      <circle cx="11" cy="-45" r="3.6" fill="${col}" stroke="#fff" stroke-width="1.1"${working?' class="of-iso-blink"':''}/>
    </g>`;})()}`+(working?`<g transform="translate(0,-58)"><rect x="-13" y="-9" width="26" height="15" rx="7" fill="#fff" stroke="${col}" stroke-width="1.2"/><polygon points="-4,5 4,5 0,11" fill="#fff"/><text x="0" y="2.5" text-anchor="middle" font-size="9">⌨️</text></g>`:'')+crown+reaction+`
  </g>`;
}
// MARCO de puerta (vano ABIERTO, SIN HOJA): va sobre el MURO frontal-derecho (borde R→F),
// en su plano isométrico (paralelo al muro). Por este vano cruzan los agentes que se
// comunican con otra área. Solo jambas + dintel y muretes laterales en el color del depto.
// g = geometría del muro {P,Q,C,ux,uy,nx,ny,mx,my,len} calculada en _ofRenderIso.
function _ofDoor(g,color){
  const f=n=>n.toFixed(1), tw=_ofTileW||160;
  const hw=Math.min(g.len*0.2, tw*0.21), H=44, jt=Math.max(3,tw*0.022), hs=32, sc='#e3e9ef';
  const mx=g.mx,my=g.my,ux=g.ux,uy=g.uy;
  const bl=[mx-ux*hw,my-uy*hw], br=[mx+ux*hw,my+uy*hw];
  const tl=[bl[0],bl[1]-H], tr=[br[0],br[1]-H];
  const obl=[bl[0]-ux*jt,bl[1]-uy*jt], obr=[br[0]+ux*jt,br[1]+uy*jt];
  const otl=[obl[0],obl[1]-H-jt], otr=[obr[0],obr[1]-H-jt];
  const PT=a=>a.map(p=>f(p[0])+','+f(p[1])).join(' ');
  const seg=(A,B)=>`<polygon points="${PT([A,B,[B[0],B[1]-hs],[A[0],A[1]-hs]])}" fill="${sc}"/><line x1="${f(A[0])}" y1="${f(A[1]-hs)}" x2="${f(B[0])}" y2="${f(B[1]-hs)}" stroke="${color}" stroke-width="2.2" opacity="0.85"/>`;
  let s='';
  s+=`<ellipse cx="${f(mx)}" cy="${f(my+3)}" rx="${f(hw+jt+8)}" ry="6.5" fill="url(#ofShadow)" opacity="0.45"/>`;
  s+=seg(g.P,obl)+seg(obr,g.Q);                                          // murete a cada lado del vano
  s+=`<polygon points="${PT([obl,obr,otr,otl])}" fill="${color}"/>`;     // marco (jambas + dintel)
  s+=`<polygon points="${PT([bl,br,tr,tl])}" fill="url(#ofDoorway)"/>`;  // vano ABIERTO (paso visible, sin hoja)
  s+=`<polygon points="${PT([bl,br,tr,tl])}" fill="#ffd9a0" opacity="0.07"/>`;   // luz cálida del interior
  s+=`<line x1="${f(otl[0])}" y1="${f(otl[1])}" x2="${f(otr[0])}" y2="${f(otr[1])}" stroke="#fff" stroke-opacity="0.3" stroke-width="1.5"/>`;   // brillo del dintel
  return s;
}
// Posiciones exactas de las impresoras dentro de su sala (calca los planos del taller)
// Grilla local 7×4 (fila 0 = fondo, fila 3 = frente/borde inferior).
// Bloque Ender/K2Plus original (2 cols × 3 filas, K2 Plus al centro) BAJADO UNA FILA:
// ahora ocupa filas 1-3 (cols 3-4) y toca el borde inferior del departamento.
// K1/K2 quedan en la fila frontal flanqueando el bloque; Giga a la izquierda.
function _ofPrinterSlots(members){
  const enders=[[3,1],[4,1],[4,2],[3,3],[4,3]];   // 5 Ender-5 Max rodeando la K2 Plus, tocando abajo
  const k1=[[2,3],[5,3],[6,3],[3,0],[4,0]];        // K1: fila frontal a los lados + 2 detrás del bloque
  const k2=[[0,3],[1,3]];                          // K2 en la fila frontal (izquierda)
  const giga=[[0,1]], k2plus=[[3,2]];              // Giga y K2 Plus (grandes)
  // B3: si hay MÁS unidades de un tipo que slots canónicos (o duplicados de Giga/K2 Plus),
  // el excedente toma la siguiente CELDA LIBRE de la grilla 7×4 en vez de apilarse encima.
  const used=new Set(), map=new Map(), key=p=>p[0]+','+p[1];
  const freeCell=()=>{ for(let r=0;r<4;r++) for(let c=0;c<7;c++){ if(!used.has(c+','+r)) return [c,r]; } return [6,3]; };
  const take=(arr,i)=>{ let p=arr[i]; if(!p||used.has(key(p))) p=freeCell(); used.add(key(p)); return p; };
  let ei=0,ki=0,k2i=0,gi=0,kpi=0;
  members.forEach(m=>{ const s=((m.label||'')+' '+(m.role||'')).toLowerCase(); let pos;
    if(/giga|orangestorm/.test(s)) pos=take(giga,gi++);
    else if(/k2\s*plus/.test(s)) pos=take(k2plus,kpi++);
    else if(/ender/.test(s)) pos=take(enders,ei++);
    else if(/k2/.test(s)) pos=take(k2,k2i++);
    else pos=take(k1,ki++);
    map.set(m,pos);
  });
  return map;
}
function _ofRenderIso(ia,auto,extras){
  const host=document.getElementById('oficinaIso'); if(!host) return;
  extras=extras||[];
  const extraMembers=extras.reduce((a,d)=>a.concat(d.members||[]),[]);
  const total=ia.length+auto.length+extraMembers.length;
  if(!total){ host.innerHTML='<div class="of-iso-scene" style="padding:24px;color:var(--text3);font-size:12px">Sin trabajadores que mostrar.</div>'; host.dataset.sig=''; return; }
  // Comunicaciones activas (agentes caminando entre departamentos)
  const _comms=_ofComms.filter(c=>Date.now()-c.t<_OF_COMM_MS);
  // No re-renderizar si nada cambió → preserva las animaciones (sin "saltos" en la TV)
  const _cz=_ofCelebs.filter(c=>Date.now()-c.t<_OF_CELEB_MS).map(c=>c.label).join(',');
  // Firma SÓLO estructural (id+estado+empleado-del-mes) + transitorios + hora. El texto de
  // tarea y el progreso/eta de impresora se ACTUALIZAN POR MUTACIÓN (_ofTickLive) sin reconstruir
  // la escena → evita reiniciar todas las animaciones en cada poll / actualización de telemetría.
  const sig=_ofView+'|'+[...ia,...auto,...extraMembers].map(m=>m.id+m.cls+(m.top?'*':'')).join(';')+'|c:'+_comms.map(c=>c.from+'>'+c.to).join(',')+'|z:'+_cz+'|h:'+new Date().getHours();
  if(host.dataset.sig===sig && host.querySelector('svg')){
    // misma escena: solo aplica un enfoque pendiente (sin reconstruir → preserva las animaciones)
    if(_ofFollowId && _ofPos[_ofFollowId]){ const _p=_ofPos[_ofFollowId]; _ofCam={cx:_p[0],cy:_p[1]-30,scale:2.4}; _ofFollowId=null; _ofApplyCam(host.querySelector('svg.of-iso-svg')); }
    return;
  }
  host.dataset.sig=sig;
  for(const _k in _ofPos) delete _ofPos[_k];   // recalcular posiciones de los puestos en este render
  // ── Departamentos como SALAS (cada una con su tamaño, empacadas en estantes) ──
  const _depts=[];
  _OF_CAT.forEach(c=>{ const mem=ia.filter(m=>_ofCat(m).name===c.name); if(mem.length) _depts.push({name:c.name,color:c.color,members:mem}); });
  { const ot=ia.filter(m=>_ofCat(m).name==='Otros'); if(ot.length) _depts.push({name:'Otros',color:'#7a7a7a',members:ot}); }
  if(auto.length) _depts.push({name:'Automatizaciones',color:'#a78bfa',members:auto});
  extras.forEach(d=>{ if(d.members&&d.members.length) _depts.push({name:d.name,color:d.color,members:d.members}); });
  _depts.forEach(d=>{ const n=d.members.length;
    if(/impresora/i.test(d.name)){ d.dc=7; d.dr=4; }
    else { const s=Math.max(2,Math.ceil(Math.sqrt(n))+1); d.dc=s; d.dr=s; } });   // sala cuadrada → mesa al centro y agentes alrededor
  const gap=1;
  const perShelf=Math.max(1,Math.min(3,Math.ceil(Math.sqrt(_depts.length))));
  const _rooms=[]; let _rt=0, _maxc=0, _corrR=0;
  for(let s=0;s<_depts.length;s+=perShelf){
    const shelf=_depts.slice(s,s+perShelf); const shelfH=Math.max(...shelf.map(d=>d.dr)); let ct=0;
    shelf.forEach(d=>{ _rooms.push({name:d.name,color:d.color,members:d.members,dc:d.dc,dr:d.dr,c0:ct,r0:_rt,c1:ct+d.dc-1,r1:_rt+d.dr-1,cc:ct+(d.dc-1)/2,rc:_rt+(d.dr-1)/2}); ct+=d.dc+gap; });
    _maxc=Math.max(_maxc,ct-gap); if(s===0)_corrR=_rt+shelfH; _rt+=shelfH+gap;
  }
  const cols=_maxc, rows=_rt-gap;
  const _roomOf=(c,r)=>_rooms.find(R=>c>=R.c0&&c<=R.c1&&r>=R.r0&&r<=R.r1)||null;
  const tw=cols>=14?140:(cols>=11?162:186), th=Math.round(tw*0.52), wallH=64;
  _ofTileW=tw; _ofTileH=th;
  const originX=(rows-1)*tw/2 + 56;
  const iso=(c,r)=>[ (c-r)*tw/2 + originX, (c+r)*th/2 ];

  // Esquinas del piso (vértices exteriores)
  const A=iso(0,0), B=iso(cols-1,0), C=iso(cols-1,rows-1), D=iso(0,rows-1);
  const At=[A[0],A[1]-th/2], Br=[B[0]+tw/2,B[1]], Cb=[C[0],C[1]+th/2], Dl=[D[0]-tw/2,D[1]];

  const now0=new Date(), H=now0.getHours();
  // Cielo de la ventana según hora (día / atardecer / noche)
  let skyT,skyB,orbC,orbMoon;
  if(H>=7&&H<17){ skyT='#7cc0ff'; skyB='#e8f5ff'; orbC='#ffd96b'; orbMoon=false; }
  else if(H>=17&&H<20){ skyT='#ff9a5a'; skyB='#ffe2c0'; orbC='#ff8a3d'; orbMoon=false; }
  else { skyT='#1a2540'; skyB='#384469'; orbC='#e8ecf5'; orbMoon=true; }

  // Paredes con degradado (claras, sensación de oficina iluminada)
  const wallR=`<polygon points="${At[0]},${At[1]} ${Br[0]},${Br[1]} ${Br[0]},${Br[1]-wallH} ${At[0]},${At[1]-wallH}" fill="url(#ofWallR)"/>`;
  const wallL=`<polygon points="${At[0]},${At[1]} ${Dl[0]},${Dl[1]} ${Dl[0]},${Dl[1]-wallH} ${At[0]},${At[1]-wallH}" fill="url(#ofWallL)"/>`;
  const trimR=`<line x1="${At[0]}" y1="${At[1]-wallH}" x2="${Br[0]}" y2="${Br[1]-wallH}" stroke="#aeb8c4" stroke-width="2.5"/>`;
  const trimL=`<line x1="${At[0]}" y1="${At[1]-wallH}" x2="${Dl[0]}" y2="${Dl[1]-wallH}" stroke="#9aa6b3" stroke-width="2.5"/>`;
  // Ventana en la pared derecha con cielo
  const wd=[Br[0]-At[0],Br[1]-At[1]], wp=(f,h)=>[At[0]+f*wd[0],At[1]+f*wd[1]-h];
  const orb=wp(0.7,54);
  const orbSvg=orbMoon
    ? `<circle cx="${orb[0].toFixed(1)}" cy="${orb[1].toFixed(1)}" r="6" fill="${orbC}"/><circle cx="${(orb[0]+2.6).toFixed(1)}" cy="${(orb[1]-1.4).toFixed(1)}" r="5" fill="url(#ofSky)"/>`
    : `<circle cx="${orb[0].toFixed(1)}" cy="${orb[1].toFixed(1)}" r="6" fill="${orbC}" opacity="0.95"/>`;
  const win=`<polygon points="${wp(0.40,22)} ${wp(0.80,22)} ${wp(0.80,64)} ${wp(0.40,64)}" fill="url(#ofSky)" stroke="#ffffff" stroke-width="3.5"/>`+
    orbSvg+
    `<line x1="${wp(0.6,22)[0]}" y1="${wp(0.6,22)[1]}" x2="${wp(0.6,64)[0]}" y2="${wp(0.6,64)[1]}" stroke="#ffffff" stroke-width="2"/>`+
    `<line x1="${wp(0.40,43)[0]}" y1="${wp(0.40,43)[1]}" x2="${wp(0.80,43)[0]}" y2="${wp(0.80,43)[1]}" stroke="#ffffff" stroke-width="2"/>`;
  // Cuadros decorativos en la pared derecha
  const frame=(f1,f2,h1,h2,c)=>`<polygon points="${wp(f1,h1)} ${wp(f2,h1)} ${wp(f2,h2)} ${wp(f1,h2)}" fill="#fff" stroke="#c9b48f" stroke-width="2"/><polygon points="${wp(f1+0.012,h1-3)} ${wp(f2-0.012,h1-3)} ${wp(f2-0.012,h2+3)} ${wp(f1+0.012,h2+3)}" fill="${c}" opacity="0.8"/>`;
  const frames=frame(0.10,0.20,34,54,'#7fd1c4')+frame(0.23,0.33,34,54,'#f6b8a0');

  // Piso: baldosas claras dentro de las salas, pasillos más oscuros entre salas
  let tiles='';
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const [x,y]=iso(c,r), inRoom=_roomOf(c,r);
    let fill=inRoom?(((c+r)%2)?'#c9d2dc':'#bdc8d3'):(((c+r)%2)?'#9aa6b3':'#929fac');
    tiles+=`<polygon points="${x},${y-th/2} ${x+tw/2},${y} ${x},${y+th/2} ${x-tw/2},${y}" fill="${fill}" stroke="#aab4bf" stroke-width="0.8"/>`;
  }
  // Alfombra de color por SALA + muros divisorios bajos en las dos caras traseras
  const _rC=R=>({T:[iso(R.c0,R.r0)[0],iso(R.c0,R.r0)[1]-th/2], R:[iso(R.c1,R.r0)[0]+tw/2,iso(R.c1,R.r0)[1]], F:[iso(R.c1,R.r1)[0],iso(R.c1,R.r1)[1]+th/2], L:[iso(R.c0,R.r1)[0]-tw/2,iso(R.c0,R.r1)[1]]});
  let rugs='';
  _rooms.forEach(R=>{ const k=_rC(R), cs=[k.T,k.R,k.F,k.L], mx=cs.reduce((s,p)=>s+p[0],0)/4, my=cs.reduce((s,p)=>s+p[1],0)/4;
    const ins=cs.map(p=>[(mx+(p[0]-mx)*0.93).toFixed(1),(my+(p[1]-my)*0.9).toFixed(1)]);
    rugs+=`<polygon points="${ins.map(p=>p.join(',')).join(' ')}" fill="${R.color}" opacity="0.17" stroke="${R.color}" stroke-opacity="0.45" stroke-width="2.5"/>`;
  });
  const dw=36;
  const wallQuad=(P,Q,col)=>`<polygon points="${P[0].toFixed(1)},${P[1].toFixed(1)} ${Q[0].toFixed(1)},${Q[1].toFixed(1)} ${Q[0].toFixed(1)},${(Q[1]-dw).toFixed(1)} ${P[0].toFixed(1)},${(P[1]-dw).toFixed(1)}" fill="${col}"/>`;
  let dividers='';
  _rooms.forEach(R=>{ const k=_rC(R);
    dividers+=wallQuad(k.T,k.R,'#dfe6ec')+wallQuad(k.L,k.T,'#cfd8e1');
    dividers+=`<line x1="${k.T[0].toFixed(1)}" y1="${(k.T[1]-dw).toFixed(1)}" x2="${k.R[0].toFixed(1)}" y2="${(k.R[1]-dw).toFixed(1)}" stroke="${R.color}" stroke-width="2.6" opacity="0.85"/>`;
    dividers+=`<line x1="${k.L[0].toFixed(1)}" y1="${(k.L[1]-dw).toFixed(1)}" x2="${k.T[0].toFixed(1)}" y2="${(k.T[1]-dw).toFixed(1)}" stroke="${R.color}" stroke-width="2.6" opacity="0.85"/>`;
  });

  // Puerta de cada departamento mirando a un pasillo. Por defecto va en el muro
  // frontal-derecho (R→F); la sala de impresoras la lleva en el muro derecho-superior (T→R).
  const _doorGeo=R=>{ const k=_rC(R), C=iso(R.cc,R.rc);
    const isPr=/impresora/i.test(R.name), P=isPr?k.T:k.R, Q=isPr?k.R:k.F;
    const ex=Q[0]-P[0], ey=Q[1]-P[1], len=Math.hypot(ex,ey)||1, ux=ex/len, uy=ey/len;
    const mx=P[0]+ux*len*0.52, my=P[1]+uy*len*0.52;
    let nx=-uy, ny=ux; if((mx+nx-C[0])**2+(my+ny-C[1])**2 < (mx-C[0])**2+(my-C[1])**2){ nx=-nx; ny=-ny; }
    return {P,Q,C,ux,uy,nx,ny,mx,my,len}; };
  const _roomDoorPt=R=>{ const g=_doorGeo(R); return [g.mx+g.nx*16, g.my+g.ny*16]; };
  let doors='';
  _rooms.forEach(R=>{ doors+=_ofDoor(_doorGeo(R), R.color); });

  // Plataforma sólo para la sala de impresoras (las máquinas van encima)
  const _ch=24;
  let counters='';
  _rooms.forEach(R=>{ if(!/impresora/i.test(R.name)) return; const k=_rC(R);
    const U=p=>`${p[0].toFixed(1)},${(p[1]-_ch).toFixed(1)}`, P=p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    counters+=`<polygon points="${U(k.L)} ${P(k.L)} ${P(k.F)} ${U(k.F)}" fill="#9aa6b3"/>`
            +`<polygon points="${U(k.F)} ${P(k.F)} ${P(k.R)} ${U(k.R)}" fill="#b1bcc8"/>`
            +`<polygon points="${U(k.T)} ${U(k.R)} ${U(k.F)} ${U(k.L)}" fill="#e8edf2"/>`
            +`<polygon points="${U(k.T)} ${U(k.R)} ${U(k.F)} ${U(k.L)}" fill="${R.color}" opacity="0.14"/>`;
  });

  // Mapa etiqueta→sala y ancla (la PUERTA del depto) para mover a los agentes que se comunican
  const _roomByLabel={}, _roomAnchor=R=>_roomDoorPt(R);
  _rooms.forEach(R=>R.members.forEach(mm=>{ if(mm&&mm.label) _roomByLabel[mm.label]=R; }));
  const _transit={};   // label → {m, from:[x,y], to:[x,y]}
  _comms.forEach(c=>{ const fr=_roomByLabel[c.from], to=_roomByLabel[c.to]; if(fr&&to&&fr!==to){ const fm=fr.members.find(mm=>mm.label===c.from); if(fm) _transit[c.from]={m:fm, from:_roomAnchor(fr), to:_roomAnchor(to)}; } });

  // Estaciones por sala: el MESÓN va al MEDIO del depto y los agentes trabajan ALREDEDOR
  let chars='', tags='', _errands='';
  // Zona de descanso: cafetería (frente-izq) y baño (frente-der) — destinos de las pausas
  const coffeePt=[Dl[0]+(Cb[0]-Dl[0])*0.36, Dl[1]+(Cb[1]-Dl[1])*0.36];
  const wcPt=[Cb[0]+(Br[0]-Cb[0])*0.64, Cb[1]+(Br[1]-Cb[1])*0.64];
  const _rtag=(m,x,y)=>{ const f=n=>n.toFixed(1), pretty=_ofPretty(m.label); const raw=pretty.length>14?pretty.slice(0,13)+'…':pretty; const nm=escapeHtml(raw), w=Math.max(34,raw.length*5.2+10);
    return `<g transform="translate(${f(x)},${f(y)})" pointer-events="none"><rect x="${f(-w/2)}" y="6" width="${f(w)}" height="13" rx="6.5" fill="#0e1116" opacity="0.85"/><text x="0" y="15.5" text-anchor="middle" font-size="8" fill="#fff" font-family="DM Sans" font-weight="600">${nm}</text></g>`; };
  // Salas de atrás hacia adelante (orden de pintor entre salas)
  const _sorted=[..._rooms].sort((a,b)=>(a.r0-b.r0)||(a.c0-b.c0));
  _sorted.forEach(R=>{
    if(/impresora/i.test(R.name)){
      // Impresoras: grilla del taller sobre la plataforma
      const slots=_ofPrinterSlots(R.members);
      const ps=R.members.map(m=>{ const pos=slots.get(m)||[0,0]; const [x,y]=iso(R.c0+pos[0],R.r0+pos[1]); return {m,x,y}; });
      ps.sort((a,b)=>a.y-b.y);
      ps.forEach(({m,x,y})=>{ _ofPos[m.id]=[x,y-_ch]; chars+=_ofIsoStation(m,x,y-_ch); tags+=_ofIsoTag(m,x,y); });
      return;
    }
    // Agentes: mesón central + anillo alrededor; los que están en STAND BY pueden salir a una pausa
    const ctr=iso(R.cc,R.rc);
    const seats=R.members.filter(m=>!_transit[m.label]);
    const N=seats.length;
    const span=((R.dc-1)+(R.dr-1))/2;                 // semidiámetro de la sala (en tiles)
    const Wx=span*tw/2, Hy=span*th/2;                 // semiejes de la sala en pantalla
    const minChord=(N>=5?56:42);                      // B5: en salas grandes, más separación para que las placas de nombre no se solapen
    const need=N>=2? minChord/(2*Math.sin(Math.PI/N)) : 0;  // radio mínimo para que no se solapen
    const ringRx=Math.min(Wx*0.7, Math.max(need, Wx*0.45, tw*0.5));
    const ringRy=Math.min(Hy*0.7, ringRx*(th/tw));
    // B17: la mesa nunca debe superar el anillo (si no, el agente frontal queda "incrustado" en la mesa)
    const tableH=16, tRx=Math.min(ringRx*0.8, Math.max(tw*0.38, ringRx*0.66)), tRy=Math.min(ringRy*0.8, Math.max(th*0.38, ringRy*0.66));
    const ang=i=>-Math.PI/2 + 2*Math.PI*(i+0.5)/Math.max(N,1);
    const pos=seats.map((m,i)=>{ const a=ang(i); return {m,a,sx:ctr[0]+ringRx*Math.cos(a),sy:ctr[1]+ringRy*Math.sin(a)}; });
    pos.forEach(p=>{ _ofPos[p.m.id]=[p.sx,p.sy]; });   // puesto del agente (para enfocar/ubicar)
    // ¿quién sale a una pausa? sólo agentes en reposo (no trabajando); a lo más ~40% de la sala.
    // Los agentes con sprite pixel-art propio (p.ej. Gerente de Ventas) SIEMPRE salen a
    // recorrer la oficina cuando están libres — así su personaje se ve caminando en vivo.
    const _sprC=pos.filter(p=>p.m.cls!=='of-work' && _ofSprite(p.m));
    const _cand=pos.filter(p=>p.m.cls!=='of-work' && !_ofSprite(p.m) && _ofHash(p.m.id+'brk')%3===0);
    const _away=new Set([..._sprC,..._cand].slice(0,Math.max(_sprC.length,Math.round(N*0.4))).map(p=>p.m.id));
    pos.forEach(p=>{ p.brk=_away.has(p.m.id); if(p.brk) p.kind=(_ofHash(p.m.id+'k')%2)?'wc':'coffee'; });
    const _seated=pos.filter(p=>!p.brk);
    const back=_seated.filter(p=>p.sy<ctr[1]).sort((a,b)=>a.sy-b.sy);
    const front=_seated.filter(p=>p.sy>=ctr[1]).sort((a,b)=>a.sy-b.sy);
    // 1) agentes del fondo · 2) mesón al centro · 3) laptops sobre el mesón · 4) agentes del frente
    back.forEach(p=>{ chars+=_ofRingAgent(p.m,p.sx,p.sy,'front'); tags+=_rtag(p.m,p.sx,p.sy); });
    chars+=_ofMeetingTable(ctr[0],ctr[1],tRx,tRy,R.color,tableH);
    pos.forEach(p=>{ const lx=ctr[0]+tRx*0.74*Math.cos(p.a), ly=(ctr[1]-tableH)+tRy*0.74*Math.sin(p.a); chars+=_ofDeskLaptop(lx,ly,p.m.cls==='of-work',_OF_STATUS[p.m.cls]||'#7c8590'); });
    front.forEach(p=>{ chars+=_ofRingAgent(p.m,p.sx,p.sy,'back'); tags+=_rtag(p.m,p.sx,p.sy); });
    // 5) agentes en pausa → cruzan al frente (cafetería/baño) y vuelven; se dibujan al final (primer plano)
    pos.forEach(p=>{ if(!p.brk) return; const dest=p.kind==='wc'?wcPt:coffeePt, dur=20+_ofHash(p.m.id)%9, dl=-(_ofHash(p.m.id+'d')%Math.round(dur)); _errands+=_ofBreakWalker(p.m,[p.sx,p.sy],dest,p.kind,dur,dl); });
  });
  chars+=_errands;   // pausas en primer plano (pasan por delante de las salas)
  // Agentes que se comunican: caminan de su departamento al de destino (y vuelven)
  Object.values(_transit).forEach((tr,i)=>{ chars+=_ofCommWalker(tr.m, tr.from, tr.to, 4.6, i*0.4); });
  // Mensajeros ambientales: cruzan de un departamento a otro por el pasillo (movimiento continuo).
  // B16: sólo si existe un pasillo REAL entre estanterías (con una sola estantería, _corrR cae en la
  // fila frontal de las salas y los peatones cruzarían por dentro de las mesas → se omiten).
  if(_rooms.length>1 && _corrR<rows-1){
    const midR=Math.min(_corrR,rows-1);
    const ems=['🚶','🧍','📄','☕','📬'];
    const n=_rooms.length;
    const pairs=[[0,Math.min(2,n-1)],[Math.min(1,n-1),0],[n-1,Math.max(0,n-3)],[Math.min(2,n-1),n-1]];
    pairs.forEach((pr,k)=>{ if(pr[0]===pr[1])return; const a=iso(_rooms[pr[0]].cc,midR), b=iso(_rooms[pr[1]].cc,midR); chars+=_ofWalker(a,b,9+k*1.7,k*1.4,ems[k%ems.length]); });
  }

  // Rótulo colgante de cada departamento sobre su sala
  let signs='';
  _rooms.forEach(R=>{
    const cx=iso(R.cc,R.r0)[0], cy=iso(R.cc,R.r0)[1]-th/2-dw-15;
    const label=R.name.toUpperCase()+' · '+R.members.length;
    const w=Math.max(72,label.length*6.1+24);
    signs+=`<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><rect x="${-w/2}" y="-11" width="${w}" height="21" rx="10.5" fill="#0e1116" opacity="0.92"/><circle cx="${(-w/2+13).toFixed(1)}" cy="0" r="4" fill="${R.color}"/><text x="7" y="3.5" text-anchor="middle" font-size="10" fill="#ffffff" font-family="DM Sans" font-weight="700" letter-spacing="0.3">${escapeHtml(label)}</text></g>`;
  });

  // Plantas decorativas en las esquinas frontales
  const plant=(x,y)=>`<g transform="translate(${x},${y})"><ellipse cx="0" cy="2" rx="12" ry="6" fill="rgba(0,0,0,0.4)"/><text x="0" y="3" text-anchor="middle" font-size="22">🪴</text></g>`;
  const decor=plant(Dl[0]+10,Dl[1]-4)+plant(Cb[0]+2,Cb[1]-4);
  const amenities=_ofCoffee(coffeePt[0],coffeePt[1])+_ofRestroom(wcPt[0],wcPt[1]);   // zona de descanso (café + baño)
  // Jornada NOCHE: lámparas encendidas (pozo de luz cálido + bombillo colgante por sala)
  const isNight = H>=20 || H<7;   // B18: alineado con el cielo de la ventana (noche = luna, ≥20h) para no encender lámparas con sol
  let lamps='';
  if(isNight){
    _rooms.forEach(R=>{
      const c=iso(R.cc,R.rc), gx=Math.max(tw*0.55, R.dc*tw*0.3), gy=gx*0.5, by=c[1]-58;
      lamps+=`<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${gx.toFixed(1)}" ry="${gy.toFixed(1)}" fill="url(#ofLampGlow)" pointer-events="none"/>`
        +`<g pointer-events="none"><line x1="${c[0].toFixed(1)}" y1="${(by-24).toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${(by-3).toFixed(1)}" stroke="#3a4150" stroke-width="1.3"/>`
        +`<path d="M${(c[0]-9).toFixed(1)},${by.toFixed(1)} Q${c[0].toFixed(1)},${(by-9).toFixed(1)} ${(c[0]+9).toFixed(1)},${by.toFixed(1)} Z" fill="#2a2f36"/>`
        +`<circle cx="${c[0].toFixed(1)}" cy="${(by+1).toFixed(1)}" r="5.5" fill="#ffe08a" filter="url(#ofHalo)"/>`
        +`<circle cx="${c[0].toFixed(1)}" cy="${(by+1).toFixed(1)}" r="3" fill="#fff6d8"/></g>`;
    });
  }

  // MARCO de acceso en la pared izquierda (vano ABIERTO, sin hoja ni manilla)
  const lp=(f,h)=>[At[0]+f*(Dl[0]-At[0]), At[1]+f*(Dl[1]-At[1])-h];
  const door=`<polygon points="${lp(0.70,0)} ${lp(0.90,0)} ${lp(0.90,54)} ${lp(0.70,54)}" fill="#c4cdd7" stroke="#aab4bf" stroke-width="2"/>`
    +`<polygon points="${lp(0.715,0)} ${lp(0.885,0)} ${lp(0.885,47)} ${lp(0.715,47)}" fill="url(#ofDoorway)"/>`
    +`<polygon points="${lp(0.715,0)} ${lp(0.885,0)} ${lp(0.885,47)} ${lp(0.715,47)}" fill="#ffd9a0" opacity="0.06"/>`;
  // Logo de marca (mismo logo del dashboard) proyectado en DIAGONAL sobre la pared izquierda
  const _lvx=At[0]-Dl[0], _lvy=At[1]-Dl[1], _lvl=Math.hypot(_lvx,_lvy)||1, _lux=_lvx/_lvl, _luy=_lvy/_lvl;
  const _lorg=[At[0]+0.58*(Dl[0]-At[0]), At[1]+0.58*(Dl[1]-At[1])-wallH*0.80];
  const _lW=132,_lH=30;
  const logo=`<g transform="matrix(${_lux.toFixed(4)},${_luy.toFixed(4)},0,1,${_lorg[0].toFixed(1)},${_lorg[1].toFixed(1)})">`
    +`<rect x="-9" y="-8" width="${_lW+18}" height="${_lH+16}" rx="9" fill="#0e1116" opacity="0.9"/>`
    +`<image href="https://dashboard.thelab.solutions/logo-thelab.png" x="0" y="0" width="${_lW}" height="${_lH}" preserveAspectRatio="xMidYMid meet"/>`
    +`</g>`;
  // Reloj de pared con hora real
  const clk=lp(0.3,wallH*0.55), now=new Date(), hr=now.getHours()%12, mn=now.getMinutes();
  const ha=(hr+mn/60)/12*2*Math.PI-Math.PI/2, ma=mn/60*2*Math.PI-Math.PI/2;
  const clock=`<g id="ofWallClock" data-cx="${clk[0].toFixed(1)}" data-cy="${clk[1].toFixed(1)}"><circle cx="${clk[0].toFixed(1)}" cy="${clk[1].toFixed(1)}" r="13" fill="#0f1114" stroke="#2a2f36" stroke-width="2"/>`+
    `<line class="of-clock-h" x1="${clk[0].toFixed(1)}" y1="${clk[1].toFixed(1)}" x2="${(clk[0]+6.5*Math.cos(ha)).toFixed(1)}" y2="${(clk[1]+6.5*Math.sin(ha)).toFixed(1)}" stroke="#dadada" stroke-width="2"/>`+
    `<line class="of-clock-m" x1="${clk[0].toFixed(1)}" y1="${clk[1].toFixed(1)}" x2="${(clk[0]+10*Math.cos(ma)).toFixed(1)}" y2="${(clk[1]+10*Math.sin(ma)).toFixed(1)}" stroke="#9a9a9a" stroke-width="1.4"/>`+
    `<circle cx="${clk[0].toFixed(1)}" cy="${clk[1].toFixed(1)}" r="1.6" fill="#dadada"/></g>`;

  // Límites del viewBox — ajuste ceñido al contenido (sin relleno artificial)
  const right=originX+(cols-1)*tw/2+tw/2, left=originX-(rows-1)*tw/2-tw/2;
  const bottomY=(cols-1+rows-1)*th/2+th/2+46, topY=-(wallH+th/2+78);
  const vbX=left-66, vbW=(right-left)+132, vbH=(bottomY-topY)+12;

  // Ambiente día/noche según la hora local
  const hh=now.getHours(); let ambC='', ambO=0;
  if(hh>=6&&hh<11){ ambC='#ffd9a0'; ambO=0.06; }
  else if(hh>=11&&hh<17){ ambO=0; }
  else if(hh>=17&&hh<20){ ambC='#ff8a4d'; ambO=0.09; }
  else { ambC='#3a4d8a'; ambO=0.13; }
  const ambient = ambO? `<rect x="${vbX}" y="${topY}" width="${vbW}" height="${vbH}" fill="${ambC}" opacity="${ambO}" pointer-events="none"/>`:'';

  const legend=`<div class="of-iso-legend">
    <span><i style="background:${_OF_STATUS['of-work']}"></i>Trabajando</span>
    <span><i style="background:${_OF_STATUS['of-active']}"></i>Activo</span>
    <span><i style="background:${_OF_STATUS['of-off']}"></i>Reposo</span>
    <span><i style="background:${_OF_STATUS['of-error']}"></i>Error</span>
  </div>`;
  const presentCats=_OF_CAT.filter(c=>ia.some(m=>_ofCat(m).name===c.name));
  if(ia.some(m=>_ofCat(m).name==='Otros')) presentCats.push({name:'Otros',color:'#7a7a7a'});
  const catLegend=presentCats.length?`<div class="of-iso-legend of-iso-cats"><span style="color:var(--text3)">Áreas:</span>${presentCats.map(c=>`<span><i style="background:${c.color}"></i>${c.name}</span>`).join('')}</div>`:'';
  host.innerHTML=`${legend}${catLegend}<div class="of-iso-scene"><svg class="of-iso-svg" role="img" aria-label="Oficina virtual en 3D — ${total} trabajadores" viewBox="${vbX} ${topY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="ofShine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <radialGradient id="ofShadow"><stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <linearGradient id="ofWallL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef3f8"/><stop offset="1" stop-color="#d5dde6"/></linearGradient>
      <linearGradient id="ofWallR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4ebf1"/><stop offset="1" stop-color="#c8d2dc"/></linearGradient>
      <linearGradient id="ofSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyT}"/><stop offset="1" stop-color="${skyB}"/></linearGradient>
      <linearGradient id="ofDoorway" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11151b"/><stop offset="0.55" stop-color="#2c343d"/><stop offset="1" stop-color="#5c6775"/></linearGradient>
      <radialGradient id="ofLampGlow"><stop offset="0" stop-color="#ffe1a3" stop-opacity="0.6"/><stop offset="55%" stop-color="#ffcf86" stop-opacity="0.22"/><stop offset="100%" stop-color="#ffcf86" stop-opacity="0"/></radialGradient>
      <filter id="ofHalo" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="7"/></filter>
      <radialGradient id="ofVig" cx="50%" cy="42%" r="72%"><stop offset="58%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.42"/></radialGradient>
    </defs>
    ${wallL}${wallR}${logo}${door}${trimL}${trimR}${frames}${win}${clock}
    <g>${tiles}</g>
    ${rugs}
    ${counters}
    ${dividers}
    ${doors}
    ${amenities}
    ${lamps}
    ${signs}
    <g>${chars}</g>
    <g>${tags}</g>
    ${decor}
    ${ambient}
    <rect x="${vbX}" y="${topY}" width="${vbW}" height="${vbH}" fill="url(#ofVig)" pointer-events="none"/>
  </svg></div>`;
  // Cámara: guardar el viewBox base, aplicar pan/zoom/enfoque vigente y activar los controles
  const _svg=host.querySelector('svg.of-iso-svg');
  if(_svg){
    const nb=[vbX,topY,vbW,vbH];
    // B7: si el viewBox base cambió respecto al último render (nuevo agente, umbral de tw…),
    // reanclar la cámara proporcionalmente para que el encuadre con zoom no "salte" de zona.
    if(_ofCam && _ofCamVb && (_ofCamVb[0]!==nb[0]||_ofCamVb[1]!==nb[1]||_ofCamVb[2]!==nb[2]||_ofCamVb[3]!==nb[3]) && _ofCamVb[2] && _ofCamVb[3]){
      const fx=(_ofCam.cx-_ofCamVb[0])/_ofCamVb[2], fy=(_ofCam.cy-_ofCamVb[1])/_ofCamVb[3];
      _ofCam.cx=nb[0]+fx*nb[2]; _ofCam.cy=nb[1]+fy*nb[3];
    }
    _ofCamVb=nb;
    _svg.dataset.vb=`${vbX} ${topY} ${vbW} ${vbH}`;
    if(_ofFollowId && _ofPos[_ofFollowId]){ const _p=_ofPos[_ofFollowId]; _ofCam={cx:_p[0],cy:_p[1]-30,scale:2.4}; _ofFollowId=null; }
    _ofApplyCam(_svg);
    _ofInitCamControls(host);
  }
}
let _ofFeedRuns=[];            // últimos runs (para re-filtrar el feed sin volver a Airtable)
let _ofFeedFilter='all';       // 'all' o nombre de departamento/área
function ofSetFeedFilter(cat){ _ofFeedFilter=cat||'all'; _ofRenderFeed(_ofFeedRuns); }
function _ofFeedCat(r){ return _ofCat({id:r.agent}).name; }   // área del run según su agente
function _ofRenderFeed(runs){
  const feed=document.getElementById('oficinaFeed'); if(!feed) return;
  _ofFeedRuns=runs||[];
  const fc=document.getElementById('oficinaFeedCount');
  const fbar=document.getElementById('oficinaFeedFilters');
  // Chips de filtro: áreas presentes en la actividad (ordenadas como _OF_CAT)
  if(fbar){
    const present=[], seen=new Set();
    runs.forEach(r=>{ const n=_ofFeedCat(r); if(!seen.has(n)){ seen.add(n); present.push(n); } });
    const order=[..._OF_CAT.map(c=>c.name),'Otros'];
    present.sort((a,b)=>{ const ia=order.indexOf(a), ib=order.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); });
    if(_ofFeedFilter!=='all' && !present.includes(_ofFeedFilter)) _ofFeedFilter='all';   // el área filtrada ya no tiene actividad
    const colOf=n=>{ const c=_OF_CAT.find(x=>x.name===n); return c?c.color:'#7a7a7a'; };
    const chip=(key,label,color,n)=>`<button class="of-feed-chip${_ofFeedFilter===key?' active':''}" style="--cc:${color}" onclick="ofSetFeedFilter('${escapeHtml(key)}')">${escapeHtml(label)}${n!=null?` <b>${n}</b>`:''}</button>`;
    fbar.innerHTML=chip('all','Todos','var(--accent)',runs.length)+present.map(n=>chip(n,n,colOf(n),runs.filter(r=>_ofFeedCat(r)===n).length)).join('');
    fbar.style.display=present.length>1?'flex':'none';
  }
  const shown=_ofFeedFilter==='all'?runs:runs.filter(r=>_ofFeedCat(r)===_ofFeedFilter);
  if(fc) fc.textContent=String(shown.length);
  if(!shown.length){
    feed.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">'+(runs.length?'Sin actividad en esta área por ahora.':'Aún no hay ejecuciones registradas. Cuando tus agentes trabajen aparecerán aquí en vivo.')+'</div>';
    return;
  }
  feed.innerHTML=shown.slice(0,15).map(r=>{
    const col=_OF_STATUS[_ofStatus(r.t).cls]||'#7c8590';
    const em=_ofAgentEmoji(r.agent);
    return `<div class="of-feed-item" style="border-left:2px solid ${col};padding-left:11px">
      <div class="of-feed-ic" style="background:${col}1f;box-shadow:inset 0 0 0 1px ${col}40">${em}</div>
      <div class="of-feed-main">
        <div class="of-feed-agent">${escapeHtml(_ofPretty(r.agent)||'—')}</div>
        <div class="of-feed-txt">${escapeHtml((r.input||r.output||'').substring(0,120))}</div>
      </div>
      <div class="of-feed-time">${_ofAgo(r.t)}</div>
    </div>`;}).join('');
}

// ── Analítica de la oficina (gráficos SVG, sin librerías) ──────────────
function _ofBarsDays(runs){
  const N=Math.max(7,Math.min(30,_ofChartRange||14)), arr=new Array(N).fill(0), lab=[];
  const start=new Date(); start.setHours(0,0,0,0);
  for(let i=0;i<N;i++){ const d=new Date(start); d.setDate(start.getDate()-(N-1-i)); lab.push(d.getDate()); }
  runs.forEach(r=>{ if(!r.t)return; const d=new Date(r.t); d.setHours(0,0,0,0); const idx=N-1-Math.round((start-d)/864e5); if(idx>=0&&idx<N) arr[idx]++; });
  const max=Math.max(1,...arr), W=320,H=120,pad=16,bw=(W-pad*2)/N, step=Math.ceil(N/8);
  let bars='',lbls='';
  arr.forEach((v,i)=>{ const x=pad+i*bw, bh=(v/max)*(H-pad-22), y=H-22-bh;
    bars+=`<rect x="${(x+2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw-4).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${i===N-1?'var(--accent)':'var(--accent3)'}" opacity="${i===N-1?1:0.6}"><title>${lab[i]}: ${v}</title></rect>`;
    if(i%step===0||i===N-1) lbls+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-7}" text-anchor="middle" font-size="8" fill="var(--text3)">${lab[i]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="of-chart-svg"><line x1="${pad}" y1="${H-22}" x2="${W-pad}" y2="${H-22}" stroke="var(--border)"/>${bars}${lbls}</svg>`;
}
function _ofBarsTop(runs){
  const _rd=Math.max(7,Math.min(30,_ofChartRange||14)), since=Date.now()-_rd*864e5, cnt={};
  runs.forEach(r=>{ if(r.t&&r.t>=since&&r.agent) cnt[r.agent]=(cnt[r.agent]||0)+1; });
  const arr=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(!arr.length) return `<div class="of-chart-empty">Sin ejecuciones en ${_rd} días.</div>`;
  const max=Math.max(...arr.map(a=>a[1])), W=320, rowH=21, H=arr.length*rowH+6;
  let rows='';
  arr.forEach((a,i)=>{ const y=i*rowH+4, bw=(a[1]/max)*(W-150);
    rows+=`<text x="0" y="${y+12}" font-size="9" fill="var(--text2)">${escapeHtml((p=>p.length>17?p.slice(0,16)+'…':p)(_ofPretty(a[0])))}</text>`;
    rows+=`<rect x="132" y="${y+3}" width="${Math.max(2,bw).toFixed(1)}" height="12" rx="3" fill="var(--accent)"><title>${a[1]}</title></rect>`;
    rows+=`<text x="${(132+Math.max(2,bw)+6).toFixed(1)}" y="${y+13}" font-size="9" fill="var(--text3)">${a[1]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="of-chart-svg">${rows}</svg>`;
}
function _ofDonut(parts,total){
  const R=42,r=26,cx=52,cy=52, nz=parts.filter(p=>p.v>0);
  let inner='';
  if(nz.length===1){ inner=`<circle cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none" stroke="${nz[0].color}" stroke-width="${R-r}"/>`; }
  else { let a=-Math.PI/2;
    parts.forEach(p=>{ if(!p.v)return; const a2=a+(p.v/(total||1))*2*Math.PI, large=(a2-a)>Math.PI?1:0;
      const x1=cx+R*Math.cos(a),y1=cy+R*Math.sin(a),x2=cx+R*Math.cos(a2),y2=cy+R*Math.sin(a2);
      const xi1=cx+r*Math.cos(a),yi1=cy+r*Math.sin(a),xi2=cx+r*Math.cos(a2),yi2=cy+r*Math.sin(a2);
      inner+=`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi2.toFixed(1)},${yi2.toFixed(1)} A${r},${r} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z" fill="${p.color}"><title>${p.label}: ${p.v}</title></path>`;
      a=a2; });
  }
  return `<svg viewBox="0 0 104 104" class="of-donut-svg">${inner}<text x="${cx}" y="${cy-1}" text-anchor="middle" font-size="18" font-family="Bebas Neue" fill="var(--text)">${total}</text><text x="${cx}" y="${cy+12}" text-anchor="middle" font-size="7" fill="var(--text3)">TOTAL</text></svg>`;
}
function _ofDonutStatus(ia,auto){
  const all=[...ia,...auto], c={work:0,active:0,off:0,error:0};
  all.forEach(m=>{ if(m.cls==='of-work')c.work++; else if(m.cls==='of-active')c.active++; else if(m.cls==='of-error')c.error++; else c.off++; });
  const parts=[{v:c.work,color:_OF_STATUS['of-work'],label:'Trabajando'},{v:c.active,color:_OF_STATUS['of-active'],label:'Activo'},{v:c.off,color:_OF_STATUS['of-off'],label:'Reposo'},{v:c.error,color:_OF_STATUS['of-error'],label:'Error'}];
  const legend=parts.map(p=>`<span><i style="background:${p.color}"></i>${p.label} · ${p.v}</span>`).join('');
  return `<div class="of-donut-wrap">${_ofDonut(parts,all.length)}<div class="of-donut-legend">${legend}</div></div>`;
}
function _ofBarsArea(runs){
  const _rd=Math.max(7,Math.min(30,_ofChartRange||14)), since=Date.now()-_rd*864e5, cnt={};
  runs.forEach(r=>{ if(!(r.t&&r.t>=since&&r.agent))return; const n=_ofCat({id:r.agent}).name; cnt[n]=(cnt[n]||0)+1; });
  const order=[..._OF_CAT,{name:'Otros',color:'#7a7a7a'}];
  const arr=order.map(c=>[c.name,cnt[c.name]||0,c.color]).filter(a=>a[1]>0);
  if(!arr.length) return `<div class="of-chart-empty">Sin ejecuciones en ${_rd} días.</div>`;
  const max=Math.max(...arr.map(a=>a[1])), W=320, rowH=22, H=arr.length*rowH+6;
  let rows='';
  arr.forEach((a,i)=>{ const y=i*rowH+4, bw=(a[1]/max)*(W-150);
    rows+=`<text x="0" y="${y+13}" font-size="9.5" fill="var(--text2)">${escapeHtml(a[0])}</text>`;
    rows+=`<rect x="110" y="${y+3}" width="${Math.max(2,bw).toFixed(1)}" height="13" rx="3" fill="${a[2]}"><title>${a[1]}</title></rect>`;
    rows+=`<text x="${(110+Math.max(2,bw)+6).toFixed(1)}" y="${y+13}" font-size="9" fill="var(--text3)">${a[1]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="of-chart-svg">${rows}</svg>`;
}
// Línea de tiempo del DÍA: ejecuciones por hora (0–23), con la hora actual marcada y el pico
function _ofTimeline(runs){
  const hours=new Array(24).fill(0);
  const t0=new Date(); t0.setHours(0,0,0,0); const a=t0.getTime(), b=a+864e5;
  runs.forEach(r=>{ if(r.t&&r.t>=a&&r.t<b) hours[new Date(r.t).getHours()]++; });
  const total=hours.reduce((s,v)=>s+v,0);
  if(!total) return '<div class="of-chart-empty">Sin ejecuciones hoy todavía.</div>';
  const max=Math.max(1,...hours), W=320,H=120,pad=16,bw=(W-pad*2)/24, nowH=new Date().getHours(), peak=hours.indexOf(max);
  let bars='',lbls='';
  hours.forEach((v,i)=>{ const x=pad+i*bw, bh=(v/max)*(H-pad-26), y=H-26-bh, cur=i===nowH;
    bars+=`<rect x="${(x+1).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${Math.max(0,bh).toFixed(1)}" rx="1.5" fill="${cur?'var(--accent)':'var(--accent3)'}" opacity="${v?(cur?1:0.62):0.16}"><title>${i}:00 · ${v}</title></rect>`;
    if(i%6===0) lbls+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-10}" text-anchor="middle" font-size="8" fill="var(--text3)">${i}h</text>`;
  });
  const nx=pad+(nowH+0.5)*bw;
  const mark=`<line x1="${nx.toFixed(1)}" y1="20" x2="${nx.toFixed(1)}" y2="${H-26}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2 2" opacity="0.55"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="of-chart-svg"><text x="${W-pad}" y="13" text-anchor="end" font-size="8.5" fill="var(--text3)">pico ${peak}:00 · ${total} hoy</text><line x1="${pad}" y1="${H-26}" x2="${W-pad}" y2="${H-26}" stroke="var(--border)"/>${bars}${mark}${lbls}</svg>`;
}
function _ofRenderCharts(runs,ia,auto){
  const host=document.getElementById('oficinaCharts'); if(!host) return;
  _ofChartData={runs,ia,auto};   // recordar para re-render al cambiar el rango
  const R=_ofChartRange||14;
  document.querySelectorAll('#oficinaRangeSel .of-vbtn').forEach(b=>b.classList.toggle('active',+b.dataset.r===R));
  host.innerHTML=`<div class="of-charts-grid">
    <div class="of-chart"><div class="of-chart-t">📈 Ejecuciones · últimos ${R} días</div>${_ofBarsDays(runs)}</div>
    <div class="of-chart"><div class="of-chart-t">🕐 Hoy por hora</div>${_ofTimeline(runs)}</div>
    <div class="of-chart"><div class="of-chart-t">🏆 Top agentes · ${R} días</div>${_ofBarsTop(runs)}</div>
    <div class="of-chart"><div class="of-chart-t">🟢 Estado del equipo · ahora</div>${_ofDonutStatus(ia,auto)}</div>
    <div class="of-chart"><div class="of-chart-t">🗂️ Ejecuciones por área · ${R} días</div>${_ofBarsArea(runs)}</div>
  </div>`;
}
