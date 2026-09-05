/* js/remuneraciones-dias.js
 * Remuneración mensual por días trabajados, separada de las comisiones.
 * Extiende el módulo REMUNERACIONES sin tocar el index.html monolítico.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.RemuneracionesDias=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const STORAGE_KEY='thelab_remuneraciones_dias_v1';
const LEGACY_SUELDO_KEY='rem_sueldos_v1';
const TZ='America/Santiago';
let target=null,installed=false,patched=false,pollTimer=null;

function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function number(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function clamp(v,min,max){return Math.min(max,Math.max(min,number(v)));}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){
  try{return '$'+Math.round(number(v)).toLocaleString('es-CL');}catch(_){return '$'+Math.round(number(v));}
}
function monthKey(input){
  const d=input instanceof Date?input:new Date(input==null?Date.now():input);
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit'}).formatToParts(d);
    const y=parts.find(p=>p.type==='year')?.value,m=parts.find(p=>p.type==='month')?.value;
    if(y&&m)return y+'-'+m;
  }catch(_){}
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function monthLabel(key=monthKey()){
  const [y,m]=String(key).split('-').map(Number);
  try{return new Intl.DateTimeFormat('es-CL',{timeZone:TZ,month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,15,12)));}
  catch(_){return String(key);}
}
function personKey(p){return String(p?.id||p?.nombre||p?.name||'').trim();}
function personName(p){return String(p?.nombre||p?.name||p?.id||'Sin nombre').trim();}
function calcRow({base=0,rate=0,days=0}={}){
  const sueldoBase=Math.max(0,Math.round(number(base)));
  const valorDia=Math.max(0,Math.round(number(rate)));
  const dias=clamp(days,0,31);
  const pagoDias=Math.round(valorDia*dias);
  return{sueldoBase,valorDia,dias,pagoDias,subtotal:sueldoBase+pagoDias};
}
function totalSummary(rows,commission=0){
  const list=Array.isArray(rows)?rows:[];
  const sueldoBase=list.reduce((s,r)=>s+number(r?.sueldoBase),0);
  const pagoDias=list.reduce((s,r)=>s+number(r?.pagoDias),0);
  const fijo=sueldoBase+pagoDias;
  const comision=Math.round(number(commission));
  return{sueldoBase,pagoDias,fijo,comision,total:fijo+comision,dias:list.reduce((s,r)=>s+number(r?.dias),0)};
}
function readJson(key,fallback){
  try{const raw=target?.localStorage?.getItem(key);if(!raw)return fallback;const v=JSON.parse(raw);return v&&typeof v==='object'?v:fallback;}catch(_){return fallback;}
}
function readCfg(){
  const cfg=readJson(STORAGE_KEY,{version:1,vendedores:{}});
  if(!cfg.vendedores||typeof cfg.vendedores!=='object')cfg.vendedores={};
  cfg.version=1;return cfg;
}
function writeCfg(cfg){target?.localStorage?.setItem(STORAGE_KEY,JSON.stringify(cfg));}
function legacySueldos(){return readJson(LEGACY_SUELDO_KEY,{});}
function people(){
  try{if(typeof PERSONAS!=='undefined'&&Array.isArray(PERSONAS))return PERSONAS;}catch(_){}
  return Array.isArray(target?.PERSONAS)?target.PERSONAS:[];
}
function appState(){
  try{if(typeof state!=='undefined'&&state)return state;}catch(_){}
  return target?.state||{};
}
function vendorTokens(){
  const out=new Set(),s=appState();
  const add=v=>{
    if(Array.isArray(v)){v.forEach(add);return;}
    if(v&&typeof v==='object'){add(v.name||v.nombre||v.id);return;}
    const n=norm(v);if(n)out.add(n);
  };
  [...(s.pedidos||[]),...(s.cotizaciones||[])].forEach(r=>add(r?.fields?.['Vendedor']));
  return out;
}
function isSellerRole(p){return /vendedor|comercial|ventas/.test(norm([p?.rol,p?.role,p?.cargo,p?.tipo,p?.area].filter(Boolean).join(' ')));}
function sellerPeople(){
  const all=people();if(!all.length)return[];
  const byRole=all.filter(isSellerRole);if(byRole.length)return byRole;
  const tokens=vendorTokens();
  if(tokens.size){
    const byCrm=all.filter(p=>{const vals=[p?.id,p?.nombre,p?.name,p?.username,p?.email].map(norm).filter(Boolean);return vals.some(v=>tokens.has(v)||[...tokens].some(t=>t.includes(v)||v.includes(t)));});
    if(byCrm.length)return byCrm;
  }
  return all;
}
function currentMonthData(cfg,p,key=monthKey()){
  const pk=personKey(p),entry=cfg.vendedores?.[pk]||{};
  return{rate:number(entry.valorDia),days:number(entry.meses?.[key]?.dias),entry};
}
function toastMsg(msg,type='success'){
  try{if(typeof toast==='function'){toast(msg,type);return;}}catch(_){}
  try{if(typeof target?.toast==='function')target.toast(msg,type);}catch(_){}
}
function renderGrid(){
  const grid=target?.document?.getElementById('remSueldoGrid');if(!grid)return;
  const vendedores=sellerPeople(),cfg=readCfg(),sueldos=legacySueldos(),mk=monthKey();
  if(!vendedores.length){grid.innerHTML='<div style="font-size:11px;color:var(--text3)">No hay vendedores o integrantes configurados.</div>';return;}
  grid.innerHTML=`<div style="grid-column:1/-1;font-size:11px;color:var(--text3);margin-bottom:2px">Remuneración de <b>${escapeHtml(monthLabel(mk))}</b>. El pago por días se calcula aparte de las comisiones.</div>`+
    vendedores.map((p,i)=>{
      const pk=personKey(p),name=personName(p),m=currentMonthData(cfg,p,mk),base=number(sueldos[name]);
      const row=calcRow({base,rate:m.rate,days:m.days});
      return `<div class="rem-dia-person" data-rem-index="${i}" data-rem-key="${encodeURIComponent(pk)}" data-rem-name="${encodeURIComponent(name)}" style="border:1px solid var(--border2);border-radius:9px;padding:10px;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;margin-bottom:8px"><span>${escapeHtml(p?.avatar||'👤')}</span><span>${escapeHtml(name)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:7px">
          <label style="font-size:9.5px;color:var(--text3)">Sueldo base mensual
            <input class="field-input" data-rem-field="base" type="number" min="0" step="10000" value="${row.sueldoBase||''}" placeholder="0" style="margin-top:3px">
          </label>
          <label style="font-size:9.5px;color:var(--text3)">Valor por día
            <input class="field-input" data-rem-field="rate" type="number" min="0" step="1000" value="${row.valorDia||''}" placeholder="0" style="margin-top:3px">
          </label>
          <label style="font-size:9.5px;color:var(--text3)">Días trabajados
            <input class="field-input" data-rem-field="days" type="number" min="0" max="31" step="0.5" value="${row.dias||''}" placeholder="0" style="margin-top:3px">
          </label>
        </div>
        <div data-rem-preview style="font-size:10.5px;color:var(--text2);margin-top:8px">Pago por días: <b>${money(row.pagoDias)}</b>${row.sueldoBase?` · Base: <b>${money(row.sueldoBase)}</b>`:''}</div>
      </div>`;
    }).join('');
  grid.querySelectorAll('.rem-dia-person').forEach(card=>{
    const update=()=>{
      const row=calcRow({
        base:card.querySelector('[data-rem-field="base"]')?.value,
        rate:card.querySelector('[data-rem-field="rate"]')?.value,
        days:card.querySelector('[data-rem-field="days"]')?.value,
      });
      const prev=card.querySelector('[data-rem-preview]');if(prev)prev.innerHTML=`Pago por días: <b>${money(row.pagoDias)}</b>${row.sueldoBase?` · Base: <b>${money(row.sueldoBase)}</b>`:''}`;
    };
    card.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',update));
  });
}
function saveGrid(){
  const grid=target?.document?.getElementById('remSueldoGrid');if(!grid)return;
  const cfg=readCfg(),sueldos=legacySueldos(),mk=monthKey();
  grid.querySelectorAll('.rem-dia-person').forEach(card=>{
    const pk=decodeURIComponent(card.dataset.remKey||''),name=decodeURIComponent(card.dataset.remName||'');if(!pk)return;
    const row=calcRow({
      base:card.querySelector('[data-rem-field="base"]')?.value,
      rate:card.querySelector('[data-rem-field="rate"]')?.value,
      days:card.querySelector('[data-rem-field="days"]')?.value,
    });
    if(row.sueldoBase>0)sueldos[name]=row.sueldoBase;else delete sueldos[name];
    const entry=cfg.vendedores[pk]||(cfg.vendedores[pk]={nombre:name,valorDia:0,meses:{}});
    entry.nombre=name;entry.valorDia=row.valorDia;entry.meses=entry.meses||{};entry.meses[mk]={dias:row.dias,actualizadoEn:new Date().toISOString()};
  });
  try{
    target.localStorage.setItem(LEGACY_SUELDO_KEY,JSON.stringify(sueldos));writeCfg(cfg);
    toastMsg('✓ Remuneraciones por días guardadas','success');
  }catch(_){toastMsg('No se pudo guardar la remuneración','error');return;}
  try{if(typeof renderRemuneraciones==='function')renderRemuneraciones();else if(typeof target?.renderRemuneraciones==='function')target.renderRemuneraciones();}catch(_){}
}
function renderKpi(summary){
  const box=target?.document?.getElementById('remKpis');if(!box)return;
  box.querySelectorAll('.rem-dias-kpi').forEach(el=>el.remove());
  const el=target.document.createElement('div');el.className='rem-dias-kpi';
  el.style.cssText='background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:11px 13px;min-width:145px;flex:1';
  el.innerHTML=`<div style="font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);font-weight:700">Pago por días</div><div style="font-size:18px;font-weight:800;color:var(--accent3);margin-top:2px">${money(summary.pagoDias)}</div><div style="font-size:9.5px;color:var(--text3);margin-top:2px">${summary.dias.toLocaleString('es-CL')} día${summary.dias===1?'':'s'} · ${escapeHtml(monthLabel())}</div>`;
  box.appendChild(el);
}
function renderLiquidacion(_totalNeto,totalComision){
  const liqBody=target?.document?.getElementById('remLiqBody');if(!liqBody)return;
  const cfg=readCfg(),sueldos=legacySueldos(),mk=monthKey();
  const rows=sellerPeople().map(p=>{
    const name=personName(p),m=currentMonthData(cfg,p,mk),calc=calcRow({base:number(sueldos[name]),rate:m.rate,days:m.days});
    return{...calc,nombre:name,avatar:p?.avatar||'👤'};
  }).filter(r=>r.sueldoBase>0||r.valorDia>0||r.dias>0||r.pagoDias>0);
  const summary=totalSummary(rows,totalComision);renderKpi(summary);
  if(!rows.length&&summary.comision===0){liqBody.innerHTML='<div style="font-size:11px;color:var(--text3)">Configura un vendedor con valor por día y días trabajados para ver su remuneración.</div>';return;}
  const cards=rows.map(r=>`<div style="background:var(--surface2);border-radius:8px;padding:10px 14px;font-size:11px;border:1px solid var(--border2)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;font-weight:700">${escapeHtml(r.avatar)} ${escapeHtml(r.nombre)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:5px">
      ${r.sueldoBase?`<div><span style="color:var(--text3)">Sueldo base:</span> <b>${money(r.sueldoBase)}</b></div>`:''}
      <div><span style="color:var(--text3)">Valor día:</span> <b>${money(r.valorDia)}</b></div>
      <div><span style="color:var(--text3)">Días trabajados:</span> <b>${r.dias.toLocaleString('es-CL')}</b></div>
      <div><span style="color:var(--text3)">Pago por días:</span> <b style="color:var(--accent3)">${money(r.pagoDias)}</b></div>
      <div><span style="color:var(--text3)">Subtotal fijo:</span> <b>${money(r.subtotal)}</b></div>
    </div>
  </div>`).join('');
  liqBody.innerHTML=cards+`<div style="margin-top:8px;border:1px solid var(--border2);border-radius:9px;padding:11px 14px;background:var(--surface);font-size:11px">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px">
      <div><span style="color:var(--text3)">Sueldo base total</span><div style="font-weight:700;margin-top:2px">${money(summary.sueldoBase)}</div></div>
      <div><span style="color:var(--text3)">Pago por días</span><div style="font-weight:700;color:var(--accent3);margin-top:2px">${money(summary.pagoDias)}</div></div>
      <div><span style="color:var(--text3)">Comisiones del período</span><div style="font-weight:700;color:var(--warn);margin-top:2px">${money(summary.comision)}</div></div>
      <div><span style="color:var(--text3)">Total remuneraciones</span><div style="font-size:15px;font-weight:800;margin-top:1px">${money(summary.total)}</div></div>
    </div>
    <div style="font-size:9.5px;color:var(--text3);margin-top:7px">El pago por días y las comisiones se mantienen como conceptos separados.</div>
  </div>`;
}
function togglePanel(){
  const p=target?.document?.getElementById('remSueldoPanel');if(!p)return;
  const vis=p.style.display==='none'||target?.getComputedStyle?.(p)?.display==='none';p.style.display=vis?'':'none';if(vis)renderGrid();
}
function patch(){
  if(patched||!target)return patched;
  if(typeof target.remRenderLiquidacion!=='function'||typeof target.remRenderSueldoGrid!=='function'||typeof target.remSaveSueldos!=='function')return false;
  target.remRenderLiquidacion=renderLiquidacion;
  target.remRenderSueldoGrid=renderGrid;
  target.remSaveSueldos=saveGrid;
  target.remToggleSueldos=togglePanel;
  patched=true;
  try{const tab=target.document?.getElementById('tab-remuneraciones');if(tab?.classList?.contains('active')&&typeof target.renderRemuneraciones==='function')target.renderRemuneraciones();}catch(_){}
  return true;
}
function install(root){
  if(installed||!root||!root.document)return false;target=root;installed=true;
  let tries=0;const tick=()=>{if(patch()||++tries>=120){if(pollTimer)root.clearInterval(pollTimer);pollTimer=null;}};
  tick();if(!patched&&typeof root.setInterval==='function')pollTimer=root.setInterval(tick,250);
  return true;
}
function status(){return{installed,patched,storageKey:STORAGE_KEY,month:monthKey()};}
return{install,status,_test:{norm,monthKey,calcRow,totalSummary,isSellerRole}};
});
