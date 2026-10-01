/* js/remuneraciones-personas.js
 * Remuneración mensual desde PERSONAS / EQUIPO.
 * Permite registrar jornadas con fecha, fracción de día, detalle y estado de pago.
 * Comparte almacenamiento con js/remuneraciones-dias.js.
 */
(function(root){
'use strict';
if(!root||!root.document||root.__TLS_REM_PERSONAS__)return;
root.__TLS_REM_PERSONAS__=true;

const REM_PERSONA_STORAGE_KEY='thelab_remuneraciones_dias_v1';
const REM_PERSONA_SUELDO_KEY='rem_sueldos_v1';
const REM_PERSONA_TZ='America/Santiago';
let remPersonaObserver=null;
let remPersonaDraft=null;

function remPersonaNumber(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function remPersonaClamp(v,a,b){return Math.min(b,Math.max(a,remPersonaNumber(v)));}
function remPersonaEscape(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function remPersonaMoney(v){try{return '$'+Math.round(remPersonaNumber(v)).toLocaleString('es-CL');}catch(_){return '$'+Math.round(remPersonaNumber(v));}}
function remPersonaRead(key,fallback){try{const raw=root.localStorage?.getItem(key);if(!raw)return fallback;const v=JSON.parse(raw);return v&&typeof v==='object'?v:fallback;}catch(_){return fallback;}}
function remPersonaCfg(){const x=remPersonaRead(REM_PERSONA_STORAGE_KEY,{version:1,vendedores:{}});x.vendedores=x.vendedores&&typeof x.vendedores==='object'?x.vendedores:{};return x;}
function remPersonaPeople(){try{if(typeof PERSONAS!=='undefined'&&Array.isArray(PERSONAS))return PERSONAS;}catch(_){}return Array.isArray(root.PERSONAS)?root.PERSONAS:[];}
function remPersonaMonthKey(input){
  const d=input instanceof Date?input:new Date(input==null?Date.now():input);
  try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:REM_PERSONA_TZ,year:'numeric',month:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year')?.value+'-'+p.find(x=>x.type==='month')?.value;}catch(_){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
}
function remPersonaTodayKey(){
  const d=new Date();
  try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:REM_PERSONA_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);return p.find(x=>x.type==='year')?.value+'-'+p.find(x=>x.type==='month')?.value+'-'+p.find(x=>x.type==='day')?.value;}catch(_){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
}
function remPersonaMonthLabel(k=remPersonaMonthKey()){const [y,m]=String(k).split('-').map(Number);try{return new Intl.DateTimeFormat('es-CL',{timeZone:REM_PERSONA_TZ,month:'long',year:'numeric'}).format(new Date(Date.UTC(y,m-1,15,12)));}catch(_){return String(k);}}
function remPersonaLastDate(k){const [y,m]=String(k).split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return k+'-'+String(last).padStart(2,'0');}
function remPersonaFormatDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))return String(v||'');const [y,m,d]=String(v).split('-').map(Number);try{return new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));}catch(_){return String(v);}}
function remPersonaFormatDateTime(v){if(!v)return'';try{return new Intl.DateTimeFormat('es-CL',{timeZone:REM_PERSONA_TZ,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}catch(_){return String(v);}}
function remPersonaPersonKey(p){return String(p?.id||p?.nombre||p?.name||'').trim();}
function remPersonaPersonName(p){return String(p?.nombre||p?.name||p?.id||'Sin nombre').trim();}
function remPersonaSanitizeJornadas(v,mk){
  return (Array.isArray(v)?v:[]).map((j,i)=>({
    id:String(j?.id||('legacy-'+i)),
    fecha:String(j?.fecha||''),
    fraccion:remPersonaClamp(j?.fraccion||1,0.5,1),
    detalle:String(j?.detalle||'').trim(),
    creadoEn:String(j?.creadoEn||'')
  })).filter(j=>j.fecha.startsWith(mk)&&j.detalle).sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.id.localeCompare(b.id));
}
function remPersonaJornadasDays(list){return (Array.isArray(list)?list:[]).reduce((s,j)=>s+remPersonaClamp(j?.fraccion,0,1),0);}
function remPersonaMonthState(p,mk=remPersonaMonthKey()){
  const c=remPersonaCfg(),s=remPersonaRead(REM_PERSONA_SUELDO_KEY,{}),pk=remPersonaPersonKey(p),name=remPersonaPersonName(p),e=c.vendedores?.[pk]||{},m=e.meses?.[mk]||{};
  const jornadas=remPersonaSanitizeJornadas(m.jornadas,mk),detallados=remPersonaJornadasDays(jornadas),guardados=Math.max(0,remPersonaNumber(m.dias));
  const ajusteDias=Number.isFinite(Number(m.ajusteDias))?Math.max(0,remPersonaNumber(m.ajusteDias)):Math.max(0,guardados-detallados);
  const dias=remPersonaClamp(ajusteDias+detallados,0,31),rate=Math.max(0,Math.round(remPersonaNumber(e.valorDia))),base=Math.max(0,Math.round(remPersonaNumber(s[name]))),pagado=m.pagado===true,pagadoEn=pagado?String(m.pagadoEn||''):'';
  return{base,rate,ajusteDias,jornadas,dias,pay:Math.round(rate*dias),pagado,pagadoEn};
}
function remPersonaDraftDays(){return remPersonaClamp(remPersonaNumber(remPersonaDraft?.ajusteDias)+remPersonaJornadasDays(remPersonaDraft?.jornadas),0,31);}
function remPersonaSetError(msg){const el=document.getElementById('remPersonaError');if(!el)return;el.textContent=String(msg||'');el.style.display=msg?'block':'none';}
function remPersonaToast(msg,type='success'){try{if(typeof root.toast==='function')root.toast(msg,type);}catch(_){} }
function remPersonaEnsureModal(){
  if(document.getElementById('remPersonaModal'))return;
  const el=document.createElement('div');el.id='remPersonaModal';
  el.style.cssText='display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.62);align-items:center;justify-content:center;padding:14px;overflow:auto';
  el.innerHTML='<div id="remPersonaCard" style="width:min(680px,100%);max-height:calc(100vh - 28px);overflow:auto;background:var(--surface,#15171b);border:1px solid var(--border2,#333);border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.45)"></div>';
  el.addEventListener('click',e=>{if(e.target===el)remPersonaCloseModal();});document.body.appendChild(el);
}
function remPersonaRenderDraft(){
  if(!remPersonaDraft)return;
  const list=document.getElementById('remPersonaJornadasList'),summary=document.getElementById('remPersonaPreview'),paidMeta=document.getElementById('remPersonaPaidMeta');
  const days=remPersonaDraftDays(),pay=Math.round(Math.max(0,remPersonaNumber(document.getElementById('remPersonaRate')?.value))*days),status=remPersonaDraft.pagado?'✅ Pagado':'⏳ Pendiente';
  if(summary)summary.innerHTML='<b>'+String(days).replace('.',',')+' días</b> · Pago por días: <b>'+remPersonaMoney(pay)+'</b> · <b>'+status+'</b>';
  if(paidMeta){paidMeta.textContent=remPersonaDraft.pagadoEn&&remPersonaDraft.pagado?'Pagado el '+remPersonaFormatDateTime(remPersonaDraft.pagadoEn):remPersonaDraft.pagado?'La fecha de pago se registrará al guardar.':'Aún no se ha marcado como pagado.';}
  if(!list)return;
  const items=remPersonaDraft.jornadas||[];
  list.innerHTML=items.length?items.map(j=>`<div style="display:grid;grid-template-columns:92px 58px 1fr 34px;gap:7px;align-items:start;padding:9px 0;border-bottom:1px solid var(--border2)">
    <div style="font-size:10px;font-weight:700">${remPersonaEscape(remPersonaFormatDate(j.fecha))}</div>
    <div style="font-size:10px;color:var(--accent3)">${String(j.fraccion).replace('.',',')} día</div>
    <div style="font-size:10.5px;color:var(--text2);line-height:1.35">${remPersonaEscape(j.detalle)}</div>
    <button type="button" class="btn-mini" data-rem-jornada-delete="${remPersonaEscape(j.id)}" title="Eliminar">×</button>
  </div>`).join(''):'<div style="font-size:10.5px;color:var(--text3);padding:10px 0">Aún no hay jornadas con fecha y detalle este mes.</div>';
  list.querySelectorAll('[data-rem-jornada-delete]').forEach(btn=>btn.onclick=e=>{e.preventDefault();e.stopPropagation();const id=btn.dataset.remJornadaDelete;remPersonaDraft.jornadas=remPersonaDraft.jornadas.filter(j=>j.id!==id);remPersonaSetError('');remPersonaRenderDraft();});
}
function remPersonaOpenModal(id){
  const p=remPersonaPeople().find(x=>String(remPersonaPersonKey(x))===String(id));if(!p)return;
  remPersonaEnsureModal();const mk=remPersonaMonthKey(),r=remPersonaMonthState(p,mk),card=document.getElementById('remPersonaCard');
  remPersonaDraft={personId:remPersonaPersonKey(p),personName:remPersonaPersonName(p),month:mk,base:r.base,rate:r.rate,ajusteDias:r.ajusteDias,jornadas:r.jornadas.map(j=>({...j})),pagado:r.pagado,pagadoEn:r.pagadoEn};
  const today=remPersonaTodayKey().startsWith(mk)?remPersonaTodayKey():mk+'-01';
  card.innerHTML=`<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px"><div><div style="font-size:16px;font-weight:800">${remPersonaEscape(remPersonaPersonName(p))}</div><div style="font-size:10.5px;color:var(--text3);margin-top:2px">${remPersonaEscape(p.rol||p.cargo||'Trabajador')} · ${remPersonaEscape(remPersonaMonthLabel(mk))}</div></div><button id="remPersonaClose" type="button" class="btn-mini" style="font-size:15px">✕</button></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px">
    <label style="font-size:10px;color:var(--text3)">Sueldo base mensual<input id="remPersonaBase" class="field-input" type="number" min="0" step="10000" value="${r.base||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Valor por día<input id="remPersonaRate" class="field-input" type="number" min="0" step="1000" value="${r.rate||''}" placeholder="0" style="margin-top:4px"></label>
    <label style="font-size:10px;color:var(--text3)">Días anteriores sin fecha<input id="remPersonaAjuste" class="field-input" type="number" min="0" max="31" step="0.5" value="${r.ajusteDias||''}" placeholder="0" style="margin-top:4px"><span style="display:block;font-size:9px;margin-top:3px;color:var(--text3)">Mantiene registros antiguos. Déjalo en 0 cuando reemplaces esos días por jornadas detalladas.</span></label>
    <label style="font-size:10px;color:var(--text3)">Estado de pago<select id="remPersonaEstadoPago" class="field-input" style="margin-top:4px"><option value="pendiente"${r.pagado?'':' selected'}>⏳ Pendiente</option><option value="pagado"${r.pagado?' selected':''}>✅ Pagado</option></select><span id="remPersonaPaidMeta" style="display:block;font-size:9px;margin-top:3px;color:var(--text3)"></span></label>
  </div>
  <div style="margin-top:15px;padding:12px;border:1px solid var(--border2);border-radius:10px;background:var(--surface2)">
    <div style="font-size:11px;font-weight:800;margin-bottom:9px">Registrar día trabajado</div>
    <div style="display:grid;grid-template-columns:145px 130px 1fr;gap:8px">
      <label style="font-size:10px;color:var(--text3)">Fecha<input id="remPersonaFecha" class="field-input" type="date" min="${mk}-01" max="${remPersonaLastDate(mk)}" value="${today}" style="margin-top:4px"></label>
      <label style="font-size:10px;color:var(--text3)">Jornada<select id="remPersonaFraccion" class="field-input" style="margin-top:4px"><option value="1">Día completo</option><option value="0.5">Medio día</option></select></label>
      <label style="font-size:10px;color:var(--text3)">Detalle de lo realizado<textarea id="remPersonaDetalle" class="field-input" rows="2" maxlength="300" placeholder="Ej: Visita cliente, seguimiento cotización y cierre de pedido" style="margin-top:4px;resize:vertical"></textarea></label>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px"><button id="remPersonaAddJornada" type="button" class="btn-mini btn-mini-green">＋ Agregar jornada</button></div>
  </div>
  <div style="margin-top:13px"><div style="font-size:11px;font-weight:800">Jornadas del mes</div><div id="remPersonaJornadasList"></div></div>
  <div id="remPersonaError" style="display:none;margin-top:10px;padding:9px 11px;border:1px solid #8b2d2d;border-radius:8px;color:#ff8b8b;font-size:10.5px"></div>
  <div id="remPersonaPreview" style="margin-top:12px;padding:10px 12px;border-radius:9px;background:var(--surface2);font-size:11px"></div>
  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button id="remPersonaCancel" type="button" class="btn-mini">Cancelar</button><button id="remPersonaSave" type="button" class="btn-mini btn-mini-green">Guardar remuneración</button></div>`;
  document.getElementById('remPersonaClose').onclick=remPersonaCloseModal;
  document.getElementById('remPersonaCancel').onclick=remPersonaCloseModal;
  document.getElementById('remPersonaSave').onclick=remPersonaSaveModal;
  document.getElementById('remPersonaAddJornada').onclick=remPersonaAddJornada;
  document.getElementById('remPersonaRate').addEventListener('input',()=>{remPersonaSetError('');remPersonaRenderDraft();});
  document.getElementById('remPersonaAjuste').addEventListener('input',e=>{remPersonaDraft.ajusteDias=remPersonaClamp(e.target.value,0,31);remPersonaSetError('');remPersonaRenderDraft();});
  document.getElementById('remPersonaEstadoPago').addEventListener('change',e=>{const wasPaid=remPersonaDraft.pagado;remPersonaDraft.pagado=e.target.value==='pagado';if(!remPersonaDraft.pagado)remPersonaDraft.pagadoEn='';else if(!wasPaid)remPersonaDraft.pagadoEn='';remPersonaSetError('');remPersonaRenderDraft();});
  document.getElementById('remPersonaModal').style.display='flex';
  remPersonaRenderDraft();
}
function remPersonaAddJornada(e){
  e?.preventDefault?.();e?.stopPropagation?.();if(!remPersonaDraft)return;
  const fecha=String(document.getElementById('remPersonaFecha')?.value||''),detalle=String(document.getElementById('remPersonaDetalle')?.value||'').trim(),fraccion=remPersonaNumber(document.getElementById('remPersonaFraccion')?.value||1),mk=remPersonaDraft.month;
  if(!fecha||!fecha.startsWith(mk)){remPersonaSetError('Selecciona una fecha válida dentro de '+remPersonaMonthLabel(mk)+'.');return;}
  if(!detalle){remPersonaSetError('Escribe un detalle de lo realizado durante esa jornada.');return;}
  if(![0.5,1].includes(fraccion)){remPersonaSetError('Selecciona día completo o medio día.');return;}
  const same=remPersonaDraft.jornadas.filter(j=>j.fecha===fecha).reduce((s,j)=>s+j.fraccion,0);
  if(same+fraccion>1){remPersonaSetError('En una misma fecha no puedes registrar más de 1 día en total.');return;}
  if(remPersonaDraftDays()+fraccion>31){remPersonaSetError('El total mensual no puede superar 31 días.');return;}
  remPersonaDraft.jornadas.push({id:'j-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),fecha,fraccion,detalle,creadoEn:new Date().toISOString()});
  remPersonaDraft.jornadas.sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.id.localeCompare(b.id));
  document.getElementById('remPersonaDetalle').value='';remPersonaSetError('');remPersonaRenderDraft();
}
function remPersonaCloseModal(){const el=document.getElementById('remPersonaModal');if(el)el.style.display='none';remPersonaDraft=null;}
function remPersonaUpdateButton(personId,days,paid){
  const buttons=Array.from(document.querySelectorAll('[data-rem-person-btn]'));const b=buttons.find(x=>String(x.dataset.remPersonBtn)===String(personId));if(!b)return;const dayText=days>0?String(days).replace('.',',')+' días':'Remuneración',label=paid?'✅ Pagado · '+dayText:(days>0?'⏳ '+dayText:'💰 Remuneración');if(b.textContent!==label)b.textContent=label;
}
function remPersonaSaveModal(e){
  e?.preventDefault?.();e?.stopPropagation?.();
  try{
    if(!remPersonaDraft)throw new Error('No hay una remuneración abierta para guardar.');
    const p=remPersonaPeople().find(x=>String(remPersonaPersonKey(x))===String(remPersonaDraft.personId));if(!p)throw new Error('No se encontró el trabajador. Recarga la página e inténtalo nuevamente.');
    const base=Math.max(0,Math.round(remPersonaNumber(document.getElementById('remPersonaBase')?.value))),rate=Math.max(0,Math.round(remPersonaNumber(document.getElementById('remPersonaRate')?.value))),ajuste=remPersonaClamp(document.getElementById('remPersonaAjuste')?.value,0,31),mk=remPersonaDraft.month,pagado=document.getElementById('remPersonaEstadoPago')?.value==='pagado';
    remPersonaDraft.ajusteDias=ajuste;const jornadas=remPersonaSanitizeJornadas(remPersonaDraft.jornadas,mk),dias=remPersonaClamp(ajuste+remPersonaJornadasDays(jornadas),0,31);
    const c=remPersonaCfg(),s=remPersonaRead(REM_PERSONA_SUELDO_KEY,{}),pk=remPersonaPersonKey(p),name=remPersonaPersonName(p),entry=c.vendedores[pk]||(c.vendedores[pk]={nombre:name,valorDia:0,meses:{}});
    entry.nombre=name;entry.valorDia=rate;entry.meses=entry.meses&&typeof entry.meses==='object'?entry.meses:{};
    const prev=entry.meses[mk]&&typeof entry.meses[mk]==='object'?entry.meses[mk]:{},pagadoEn=pagado?(prev.pagado===true&&prev.pagadoEn?prev.pagadoEn:new Date().toISOString()):null;
    entry.meses[mk]={...prev,dias,ajusteDias:ajuste,jornadas,pagado,pagadoEn,actualizadoEn:new Date().toISOString()};
    if(base>0)s[name]=base;else delete s[name];
    if(!root.localStorage)throw new Error('El navegador no permite guardar datos locales.');
    root.localStorage.setItem(REM_PERSONA_STORAGE_KEY,JSON.stringify(c));
    root.localStorage.setItem(REM_PERSONA_SUELDO_KEY,JSON.stringify(s));
    remPersonaUpdateButton(pk,dias,pagado);
    const modal=document.getElementById('remPersonaModal');if(modal)modal.style.display='none';
    remPersonaDraft=null;
    try{root.dispatchEvent?.(new CustomEvent('remuneraciones-dias-updated',{detail:{personId:pk,month:mk,dias,pagado,pagadoEn}}));}catch(_){}
    remPersonaToast('✓ Remuneración de '+name+' guardada como '+(pagado?'pagada':'pendiente'),'success');
  }catch(err){
    console.error('[Remuneraciones PERSONAS] no se pudo guardar',err);
    remPersonaSetError(err?.message||'No se pudo guardar la remuneración.');
  }
}
function remPersonaInjectButtons(){
  const body=document.getElementById('equipoBody'),ps=remPersonaPeople();if(!body||!ps.length)return;
  Array.from(body.querySelectorAll('tr')).forEach((tr,i)=>{
    const p=ps[i],cell=tr.querySelector('td');if(!p||!cell)return;
    const pk=remPersonaPersonKey(p),r=remPersonaMonthState(p),dayText=r.dias>0?String(r.dias).replace('.',',')+' días':'Remuneración',label=r.pagado?'✅ Pagado · '+dayText:(r.dias>0?'⏳ '+dayText:'💰 Remuneración');
    let b=cell.querySelector('[data-rem-person-btn]');
    if(!b){b=document.createElement('button');b.type='button';b.dataset.remPersonBtn=pk;b.className='btn-mini';b.style.cssText='display:block;margin-top:5px;font-size:9.5px;white-space:nowrap';b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();remPersonaOpenModal(pk);};cell.appendChild(b);}
    if(b.textContent!==label)b.textContent=label;
  });
}
function remPersonaStart(){
  remPersonaEnsureModal();remPersonaInjectButtons();const body=document.getElementById('equipoBody');
  if(body&&typeof MutationObserver!=='undefined'){remPersonaObserver=new MutationObserver(()=>remPersonaInjectButtons());remPersonaObserver.observe(body,{childList:true});return;}
  let tries=0;const t=setInterval(()=>{remPersonaInjectButtons();const b=document.getElementById('equipoBody');if(b&&typeof MutationObserver!=='undefined'){clearInterval(t);remPersonaObserver=new MutationObserver(()=>remPersonaInjectButtons());remPersonaObserver.observe(b,{childList:true});}else if(++tries>120)clearInterval(t);},500);
}
root.openRemuneracionPersona=remPersonaOpenModal;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',remPersonaStart,{once:true});else remPersonaStart();
})(typeof window!=='undefined'?window:null);
