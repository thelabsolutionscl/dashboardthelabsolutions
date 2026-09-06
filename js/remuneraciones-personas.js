/* js/remuneraciones-personas.js
 * Permite editar la remuneración mensual desde PERSONAS / EQUIPO.
 * Usa las mismas claves que js/remuneraciones-dias.js.
 */
(function(root){
'use strict';
if(!root||!root.document||root.__TLS_REM_PERSONAS__)return;
root.__TLS_REM_PERSONAS__=true;
const STORAGE_KEY='thelab_remuneraciones_dias_v1';
const LEGACY_SUELDO_KEY='rem_sueldos_v1';
const TZ='America/Santiago';
let observer=null;
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function clamp(v,a,b){return Math.min(b,Math.max(a,n(v)));}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){try{return '$'+Math.round(n(v)).toLocaleString('es-CL');}catch(_){return '$'+Math.round(n(v));}}
function monthKey(){
  const d=new Date();
  try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}catch(_){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
}
function monthLabel(k=monthKey()){const [y,m]=k.split('-').map(Number);try{return new Intl.DateTimeFormat('es-CL',{timeZone:TZ,month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,15,12)));}catch(_){return k;}}
function people(){try{if(typeof PERSONAS!=='undefined'&&Array.isArray(PERSONAS))return PERSONAS;}catch(_){}return Array.isArray(root.PERSONAS)?root.PERSONAS:[];}
function read(key,fallback){try{return JSON.parse(root.localStorage.getItem(key)||'')||fallback;}catch(_){return fallback;}}
function cfg(){const x=read(STORAGE_KEY,{version:1,vendedores:{}});x.vendedores=x.vendedores&&typeof x.vendedores==='object'?x.vendedores:{};return x;}
function rowFor(p){const c=cfg(),s=read(LEGACY_SUELDO_KEY,{}),mk=monthKey(),e=c.vendedores[p.id]||{},days=n(e.meses?.[mk]?.dias),rate=n(e.valorDia),base=n(s[p.nombre]);return{base,rate,days,pay:Math.round(rate*days)};}
function ensureModal(){
  if(document.getElementById('remPersonaModal'))return;
  const el=document.createElement('div');el.id='remPersonaModal';
  el.style.cssText='display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.58);align-items:center;justify-content:center;padding:18px';
  el.innerHTML='<div id="remPersonaCard" style="width:min(520px,100%);background:var(--surface,#15171b);border:1px solid var(--border2,#333);border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>';
  el.addEventListener('click',e=>{if(e.target===el)closeModal();});document.body.appendChild(el);
}
function openModal(id){
  const p=people().find(x=>String(x.id)===String(id));if(!p)return;
  ensureModal();const mk=monthKey(),r=rowFor(p),card=document.getElementById('remPersonaCard');
  card.dataset.personId=p.id;
  card.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px"><div><div style="font-size:16px;font-weight:800">${esc(p.nombre)}</div><div style="font-size:10.5px;color:var(--text3);margin-top:2px">${esc(p.rol||p.cargo||'Trabajador')} · ${esc(monthLabel(mk))}</div></div><button id="remPersonaClose" class="btn-mini" style="font-size:15px">✕</button></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px">
    <label style="font-size:10px;color:var(--text3)">Sueldo base mensual<input id="remPersonaBase" class="field-input" type="number" min="0" step="10000" value="${r.base||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Valor por día<input id="remPersonaRate" class="field-input" type="number" min="0" step="1000" value="${r.rate||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Días trabajados<input id="remPersonaDays" class="field-input" type="number" min="0" max="31" step="0.5" value="${r.days||''}" placeholder="0" style="margin-top:4px"></label>
  </div>
  <div id="remPersonaPreview" style="margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--surface2);font-size:11px">Pago por días: <b>${money(r.pay)}</b></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button id="remPersonaCancel" class="btn-mini">Cancelar</button><button id="remPersonaSave" class="btn-mini btn-mini-green">Guardar remuneración</button></div>`;
  const preview=()=>{const rate=Math.max(0,n(document.getElementById('remPersonaRate').value)),days=clamp(document.getElementById('remPersonaDays').value,0,31);document.getElementById('remPersonaPreview').innerHTML='Pago por días: <b>'+money(rate*days)+'</b>';};
  ['remPersonaBase','remPersonaRate','remPersonaDays'].forEach(x=>document.getElementById(x).addEventListener('input',preview));
  document.getElementById('remPersonaClose').onclick=closeModal;document.getElementById('remPersonaCancel').onclick=closeModal;document.getElementById('remPersonaSave').onclick=saveModal;
  document.getElementById('remPersonaModal').style.display='flex';
}
function closeModal(){const el=document.getElementById('remPersonaModal');if(el)el.style.display='none';}
function saveModal(){
  const card=document.getElementById('remPersonaCard'),p=people().find(x=>String(x.id)===String(card?.dataset.personId));if(!p)return;
  const base=Math.max(0,Math.round(n(document.getElementById('remPersonaBase').value))),rate=Math.max(0,Math.round(n(document.getElementById('remPersonaRate').value))),days=clamp(document.getElementById('remPersonaDays').value,0,31),mk=monthKey();
  const c=cfg(),s=read(LEGACY_SUELDO_KEY,{}),e=c.vendedores[p.id]||(c.vendedores[p.id]={nombre:p.nombre,valorDia:0,meses:{}});
  e.nombre=p.nombre;e.valorDia=rate;e.meses=e.meses||{};e.meses[mk]={dias,actualizadoEn:new Date().toISOString()};if(base>0)s[p.nombre]=base;else delete s[p.nombre];
  try{root.localStorage.setItem(STORAGE_KEY,JSON.stringify(c));root.localStorage.setItem(LEGACY_SUELDO_KEY,JSON.stringify(s));}catch(_){return;}
  try{if(typeof root.renderRemuneraciones==='function')root.renderRemuneraciones();}catch(_){}
  injectButtons();closeModal();try{if(typeof root.toast==='function')root.toast('✓ Remuneración de '+p.nombre+' guardada','success');}catch(_){}
}
function injectButtons(){
  const body=document.getElementById('equipoBody'),ps=people();if(!body||!ps.length)return;
  Array.from(body.querySelectorAll('tr')).forEach((tr,i)=>{
    const p=ps[i],cell=tr.querySelector('td');if(!p||!cell)return;
    const r=rowFor(p),label=r.days>0?'💰 '+String(r.days).replace('.',',')+' días':'💰 Remuneración';
    let b=cell.querySelector('[data-rem-person-btn]');
    if(!b){b=document.createElement('button');b.type='button';b.dataset.remPersonBtn=p.id;b.className='btn-mini';b.style.cssText='display:block;margin-top:5px;font-size:9.5px;white-space:nowrap';b.onclick=e=>{e.stopPropagation();openModal(p.id);};cell.appendChild(b);}
    b.textContent=label;
  });
}
function start(){ensureModal();injectButtons();const body=document.getElementById('equipoBody');if(body&&typeof MutationObserver!=='undefined'){observer=new MutationObserver(()=>injectButtons());observer.observe(body,{childList:true,subtree:true});return;}let tries=0;const t=setInterval(()=>{injectButtons();const b=document.getElementById('equipoBody');if(b&&typeof MutationObserver!=='undefined'){clearInterval(t);observer=new MutationObserver(()=>injectButtons());observer.observe(b,{childList:true,subtree:true});}else if(++tries>120)clearInterval(t);},500);}
root.openRemuneracionPersona=openModal;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window!=='undefined'?window:null);