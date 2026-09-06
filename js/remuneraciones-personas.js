/* js/remuneraciones-personas.js
 * Permite editar la remuneración mensual desde PERSONAS / EQUIPO.
 * Usa las mismas claves que js/remuneraciones-dias.js.
 */
(function(root){
'use strict';
if(!root||!root.document||root.__TLS_REM_PERSONAS__)return;
root.__TLS_REM_PERSONAS__=true;
const REM_PERSONA_STORAGE_KEY='thelab_remuneraciones_dias_v1';
const REM_PERSONA_SUELDO_KEY='rem_sueldos_v1';
const REM_PERSONA_TZ='America/Santiago';
let remPersonaObserver=null;
function remPersonaNumber(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function remPersonaClamp(v,a,b){return Math.min(b,Math.max(a,remPersonaNumber(v)));}
function remPersonaEscape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function remPersonaMoney(v){try{return '$'+Math.round(remPersonaNumber(v)).toLocaleString('es-CL');}catch(_){return '$'+Math.round(remPersonaNumber(v));}}
function remPersonaMonthKey(){
  const d=new Date();
  try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:REM_PERSONA_TZ,year:'numeric',month:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}catch(_){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
}
function remPersonaMonthLabel(k=remPersonaMonthKey()){const [y,m]=k.split('-').map(Number);try{return new Intl.DateTimeFormat('es-CL',{timeZone:REM_PERSONA_TZ,month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,15,12)));}catch(_){return k;}}
function remPersonaPeople(){try{if(typeof PERSONAS!=='undefined'&&Array.isArray(PERSONAS))return PERSONAS;}catch(_){}return Array.isArray(root.PERSONAS)?root.PERSONAS:[];}
function remPersonaRead(key,fallback){try{return JSON.parse(root.localStorage.getItem(key)||'')||fallback;}catch(_){return fallback;}}
function remPersonaCfg(){const x=remPersonaRead(REM_PERSONA_STORAGE_KEY,{version:1,vendedores:{}});x.vendedores=x.vendedores&&typeof x.vendedores==='object'?x.vendedores:{};return x;}
function remPersonaRow(p){const c=remPersonaCfg(),s=remPersonaRead(REM_PERSONA_SUELDO_KEY,{}),mk=remPersonaMonthKey(),e=c.vendedores[p.id]||{},days=remPersonaNumber(e.meses?.[mk]?.dias),rate=remPersonaNumber(e.valorDia),base=remPersonaNumber(s[p.nombre]);return{base,rate,days,pay:Math.round(rate*days)};}
function remPersonaEnsureModal(){
  if(document.getElementById('remPersonaModal'))return;
  const el=document.createElement('div');el.id='remPersonaModal';
  el.style.cssText='display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.58);align-items:center;justify-content:center;padding:18px';
  el.innerHTML='<div id="remPersonaCard" style="width:min(520px,100%);background:var(--surface,#15171b);border:1px solid var(--border2,#333);border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>';
  el.addEventListener('click',e=>{if(e.target===el)remPersonaCloseModal();});document.body.appendChild(el);
}
function remPersonaOpenModal(id){
  const p=remPersonaPeople().find(x=>String(x.id)===String(id));if(!p)return;
  remPersonaEnsureModal();const mk=remPersonaMonthKey(),r=remPersonaRow(p),card=document.getElementById('remPersonaCard');
  card.dataset.personId=p.id;
  card.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px"><div><div style="font-size:16px;font-weight:800">${remPersonaEscape(p.nombre)}</div><div style="font-size:10.5px;color:var(--text3);margin-top:2px">${remPersonaEscape(p.rol||p.cargo||'Trabajador')} · ${remPersonaEscape(remPersonaMonthLabel(mk))}</div></div><button id="remPersonaClose" class="btn-mini" style="font-size:15px">✕</button></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:9px">
    <label style="font-size:10px;color:var(--text3)">Sueldo base mensual<input id="remPersonaBase" class="field-input" type="number" min="0" step="10000" value="${r.base||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Valor por día<input id="remPersonaRate" class="field-input" type="number" min="0" step="1000" value="${r.rate||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Días trabajados<input id="remPersonaDays" class="field-input" type="number" min="0" max="31" step="0.5" value="${r.days||''}" placeholder="0" style="margin-top:4px"></label>
  </div>
  <div id="remPersonaPreview" style="margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--surface2);font-size:11px">Pago por días: <b>${remPersonaMoney(r.pay)}</b></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button id="remPersonaCancel" class="btn-mini">Cancelar</button><button id="remPersonaSave" class="btn-mini btn-mini-green">Guardar remuneración</button></div>`;
  const remPersonaPreview=()=>{const rate=Math.max(0,remPersonaNumber(document.getElementById('remPersonaRate').value)),days=remPersonaClamp(document.getElementById('remPersonaDays').value,0,31);document.getElementById('remPersonaPreview').innerHTML='Pago por días: <b>'+remPersonaMoney(rate*days)+'</b>';};
  ['remPersonaBase','remPersonaRate','remPersonaDays'].forEach(x=>document.getElementById(x).addEventListener('input',remPersonaPreview));
  document.getElementById('remPersonaClose').onclick=remPersonaCloseModal;document.getElementById('remPersonaCancel').onclick=remPersonaCloseModal;document.getElementById('remPersonaSave').onclick=remPersonaSaveModal;
  document.getElementById('remPersonaModal').style.display='flex';
}
function remPersonaCloseModal(){const el=document.getElementById('remPersonaModal');if(el)el.style.display='none';}
function remPersonaSaveModal(){
  const card=document.getElementById('remPersonaCard'),p=remPersonaPeople().find(x=>String(x.id)===String(card?.dataset.personId));if(!p)return;
  const base=Math.max(0,Math.round(remPersonaNumber(document.getElementById('remPersonaBase').value))),rate=Math.max(0,Math.round(remPersonaNumber(document.getElementById('remPersonaRate').value))),days=remPersonaClamp(document.getElementById('remPersonaDays').value,0,31),mk=remPersonaMonthKey();
  const c=remPersonaCfg(),s=remPersonaRead(REM_PERSONA_SUELDO_KEY,{}),e=c.vendedores[p.id]||(c.vendedores[p.id]={nombre:p.nombre,valorDia:0,meses:{}});
  e.nombre=p.nombre;e.valorDia=rate;e.meses=e.meses||{};e.meses[mk]={dias,actualizadoEn:new Date().toISOString()};if(base>0)s[p.nombre]=base;else delete s[p.nombre];
  try{root.localStorage.setItem(REM_PERSONA_STORAGE_KEY,JSON.stringify(c));root.localStorage.setItem(REM_PERSONA_SUELDO_KEY,JSON.stringify(s));}catch(_){return;}
  try{if(typeof root.renderRemuneraciones==='function')root.renderRemuneraciones();}catch(_){}
  remPersonaInjectButtons();remPersonaCloseModal();try{if(typeof root.toast==='function')root.toast('✓ Remuneración de '+p.nombre+' guardada','success');}catch(_){}
}
function remPersonaInjectButtons(){
  const body=document.getElementById('equipoBody'),ps=remPersonaPeople();if(!body||!ps.length)return;
  Array.from(body.querySelectorAll('tr')).forEach((tr,i)=>{
    const p=ps[i],cell=tr.querySelector('td');if(!p||!cell)return;
    const r=remPersonaRow(p),label=r.days>0?'💰 '+String(r.days).replace('.',',')+' días':'💰 Remuneración';
    let b=cell.querySelector('[data-rem-person-btn]');
    if(!b){b=document.createElement('button');b.type='button';b.dataset.remPersonBtn=p.id;b.className='btn-mini';b.style.cssText='display:block;margin-top:5px;font-size:9.5px;white-space:nowrap';b.onclick=e=>{e.stopPropagation();remPersonaOpenModal(p.id);};cell.appendChild(b);}
    b.textContent=label;
  });
}
function remPersonaStart(){remPersonaEnsureModal();remPersonaInjectButtons();const body=document.getElementById('equipoBody');if(body&&typeof MutationObserver!=='undefined'){remPersonaObserver=new MutationObserver(()=>remPersonaInjectButtons());remPersonaObserver.observe(body,{childList:true,subtree:true});return;}let tries=0;const t=setInterval(()=>{remPersonaInjectButtons();const b=document.getElementById('equipoBody');if(b&&typeof MutationObserver!=='undefined'){clearInterval(t);remPersonaObserver=new MutationObserver(()=>remPersonaInjectButtons());remPersonaObserver.observe(b,{childList:true,subtree:true});}else if(++tries>120)clearInterval(t);},500);}
root.openRemuneracionPersona=remPersonaOpenModal;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',remPersonaStart,{once:true});else remPersonaStart();
})(typeof window!=='undefined'?window:null);