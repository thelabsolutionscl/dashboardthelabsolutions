/* js/problem-reports.js
 * Reporte interno de problemas del dashboard.
 * Persiste texto/contexto/screenshot vía /shared/problems y expone historial.
 * Los reportes con Auto reparar=true quedan disponibles para el agente externo
 * que crea ramas/PR y actualiza el mismo registro.
 */
(function(root){
'use strict';
if(!root||!root.document||root.__TLS_PROBLEM_REPORTS__)return;
root.__TLS_PROBLEM_REPORTS__=true;
const D=root.document;
let reports=[],shot=null,busy=false,open=false;
const repairBusy=new Set();

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cfg(){
  try{
    const px=typeof root._proxyCfg==='function'?root._proxyCfg():null;
    if(!px?.url||!px?.key)return null;
    const u=new URL(px.url);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return null;
    return{base:u.href.replace(/\/$/,''),key:px.key};
  }catch(_){return null;}
}
function user(){
  try{return root.AUTH?.getUser?.()||{};}catch(_){return{};}
}
function reporter(){
  const u=user(),v=String(u.email||u.username||'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:'dashboard@thelab.solutions';
}
function section(){
  const active=D.querySelector('.tab-content.active,.tab-pane.active,[data-tab-panel].active');
  if(active?.id)return active.id.replace(/^tab-/,'');
  const nav=D.querySelector('[data-tab].active');return nav?.dataset?.tab||'';
}
function build(){
  for(const s of [...D.scripts].reverse()){
    try{const u=new URL(s.src);const v=u.searchParams.get('v');if(v)return v;}catch(_){}
  }
  return '';
}
function fmtDate(v){
  try{return new Date(v).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'});}catch(_){return String(v||'');}
}
function statusClass(s){
  if(s==='Reparado')return'ok';if(s==='Error')return'bad';if(s==='PR abierto'||s==='Reparación preparada')return'work';return'new';
}
function currentPayload(){
  return{
    message:(D.getElementById('problemMessage')?.value||'').trim(),
    section:section(),url:location.origin+location.pathname,build:build(),
    navigator:String(navigator.userAgent||'').slice(0,1200),
    autoRepair:D.getElementById('problemAutoRepair')?.checked!==false,
    reporter:reporter(),...(shot?{screenshot:shot}:{})
  };
}
async function api(method,body){
  const c=cfg();if(!c)throw new Error('Centro de conexiones: Proxy Worker no configurado');
  const r=await fetch(c.base+'/shared/problems',{
    method,credentials:'include',redirect:'error',cache:'no-store',
    headers:{'X-App-Key':c.key,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let data={};try{data=await r.json();}catch(_){}
  if(!r.ok)throw new Error(data.error||('HTTP '+r.status));
  return data;
}
function style(){
  if(D.getElementById('problemReportStyle'))return;
  const s=D.createElement('style');s.id='problemReportStyle';s.textContent=`
  #problemReportDialog{position:fixed;inset:0;z-index:10050;background:#090b0cf2;display:none;overflow:auto;color:var(--text,#f0f0f0)}
  #problemReportDialog.open{display:block}.pr-shell{max-width:1180px;margin:0 auto;padding:28px 24px 70px}
  .pr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
  .pr-title{font-size:26px;font-weight:800;letter-spacing:-.02em}.pr-sub{color:var(--text2,#999);font-size:12px;margin-top:4px}
  .pr-close{border:1px solid var(--border2,#333);background:var(--surface,#111);color:var(--text);border-radius:10px;padding:9px 12px;cursor:pointer}
  .pr-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:18px}
  .pr-card{background:var(--surface,#111);border:1px solid var(--border,#2a2a2a);border-radius:14px;padding:18px}
  .pr-card h3{margin:0 0 12px;font-size:14px}.pr-label{display:block;color:var(--text2,#aaa);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:12px 0 6px}
  #problemMessage{width:100%;min-height:150px;resize:vertical;background:#0b0d0e;color:var(--text);border:1px solid var(--border2);border-radius:10px;padding:12px;font:13px/1.5 inherit;box-sizing:border-box}
  #problemMessage:focus{outline:none;border-color:var(--accent,#00d4cc)}
  .pr-drop{border:1px dashed #3a4247;border-radius:10px;padding:14px;text-align:center;color:var(--text2);font-size:11px;cursor:pointer;background:#0b0d0e}
  .pr-drop.drag{border-color:var(--accent);background:rgba(0,212,204,.05)}
  #problemShotPreview{display:none;margin-top:10px;max-width:100%;max-height:260px;border-radius:9px;border:1px solid var(--border2);object-fit:contain;background:#050606}
  .pr-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pr-meta{font-size:10px;color:var(--text3,#777);line-height:1.55;margin-top:10px}
  .pr-submit{margin-top:14px;border:0;border-radius:10px;background:var(--accent,#00d4cc);color:#001211;font-weight:800;padding:10px 16px;cursor:pointer}.pr-submit:disabled{opacity:.45;cursor:not-allowed}
  .pr-auto{display:flex;gap:8px;align-items:flex-start;margin-top:12px;padding:10px;border-radius:9px;background:rgba(0,212,204,.06);font-size:11px;color:var(--text2)}
  .pr-history-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.pr-list{display:flex;flex-direction:column;gap:10px;max-height:72vh;overflow:auto;padding-right:4px}
  .pr-item{border:1px solid var(--border,#2a2a2a);border-radius:11px;padding:12px;background:#0b0d0e}.pr-item-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .pr-id{font:600 10px ui-monospace,monospace;color:var(--text3)}.pr-status{font-size:9px;font-weight:800;padding:3px 7px;border-radius:99px;border:1px solid #333}
  .pr-status.ok{color:#43d6a5;border-color:#236b55}.pr-status.bad{color:#ff7373;border-color:#743838}.pr-status.work{color:#c6a7ff;border-color:#5a477a}.pr-status.new{color:#74e6df;border-color:#296966}
  .pr-msg{font-size:12px;line-height:1.45;margin:8px 0;color:var(--text)}.pr-small{font-size:9px;color:var(--text3)}
  .pr-thumb{width:150px;max-height:92px;object-fit:cover;border-radius:7px;border:1px solid #333;margin-top:8px;cursor:pointer}
  .pr-ai{margin-top:9px;padding:9px;border-left:2px solid var(--accent4,#a78bfa);background:rgba(167,139,250,.06);font-size:10px;line-height:1.5;color:var(--text2);white-space:pre-wrap}
  .pr-link{display:inline-block;margin-top:7px;font-size:10px;color:var(--accent);text-decoration:none}.pr-actions{display:flex;gap:8px;align-items:center;margin-top:10px}.pr-repair{border:1px solid color-mix(in srgb,var(--accent,#00d4cc) 55%,#2a2a2a);background:rgba(0,212,204,.08);color:var(--accent,#74e6df);border-radius:8px;padding:7px 10px;font:700 10px/1 inherit;cursor:pointer}.pr-repair:hover:not(:disabled){background:rgba(0,212,204,.15)}.pr-repair:disabled{opacity:.55;cursor:default}.pr-empty{padding:28px;text-align:center;color:var(--text3);font-size:11px}
  @media(max-width:820px){.pr-shell{padding:18px 12px 50px}.pr-grid{grid-template-columns:1fr}.pr-list{max-height:none}.pr-title{font-size:22px}}
  `;
  D.head.appendChild(s);
}
function render(){
  const list=D.getElementById('problemHistory');if(!list)return;
  if(!reports.length){list.innerHTML='<div class="pr-empty">Todavía no hay reportes guardados.</div>';return;}
  list.innerHTML=reports.map(r=>{
    const queued=r.estado==='Nuevo'&&/^Solicitud manual de reparación recibida\./.test(r.diagnostico||'');
    const canRepair=r.estado==='Nuevo'||r.estado==='Error';
    const repairLabel=queued?'✓ En cola':r.estado==='Error'?'↻ Reintentar reparación':'⚡ Reparar';
    return `<article class="pr-item">
    <div class="pr-item-top"><span class="pr-status ${statusClass(r.estado)}">${esc(r.estado)}</span><span class="pr-id">${esc(r.reportId)}</span><span class="pr-small" style="margin-left:auto">${esc(fmtDate(r.fecha))}</span></div>
    <div class="pr-msg">${esc(r.mensaje)}</div>
    <div class="pr-small">${esc(r.seccion||'sin sección')} · ${esc(r.usuario||'')} ${r.build?'· build '+esc(r.build):''}</div>
    ${r.screenshot?.thumb||r.screenshot?.url?`<img class="pr-thumb" src="${esc(r.screenshot.thumb||r.screenshot.url)}" alt="Screenshot del problema" onclick="window.open('${esc(r.screenshot.url||r.screenshot.thumb)}','_blank','noopener,noreferrer')">`:''}
    ${r.diagnostico?`<div class="pr-ai"><b>Diagnóstico IA</b><br>${esc(r.diagnostico)}</div>`:''}
    ${r.plan?`<div class="pr-ai"><b>Plan de reparación</b><br>${esc(r.plan)}</div>`:''}
    ${r.error?`<div class="pr-ai" style="border-color:var(--danger,#f44)"><b>Error</b><br>${esc(r.error)}</div>`:''}
    ${r.prUrl?`<a class="pr-link" href="${esc(r.prUrl)}" target="_blank" rel="noopener noreferrer">Ver reparación en GitHub ↗</a>`:''}
    ${canRepair?`<div class="pr-actions"><button type="button" class="pr-repair" data-pr-repair="${esc(r.id)}"${queued?' disabled aria-disabled="true"':''}>${repairLabel}</button></div>`:''}
  </article>`;}).join('');
}
async function refresh(){
  const list=D.getElementById('problemHistory');if(list)list.innerHTML='<div class="pr-empty">Cargando historial…</div>';
  try{const d=await api('GET');reports=Array.isArray(d.reports)?d.reports:[];render();}
  catch(e){if(list)list.innerHTML='<div class="pr-empty">No se pudo cargar el historial: '+esc(e.message)+'</div>';}
}
async function repairReport(id,btn){
  if(!/^rec[A-Za-z0-9]{14}$/.test(String(id||''))||repairBusy.has(id))return;
  repairBusy.add(id);
  const original=btn?.textContent||'⚡ Reparar';
  if(btn){btn.disabled=true;btn.textContent='Enviando…';}
  try{
    const d=await api('POST',{action:'repair',recordId:id,reporter:reporter()});
    if(d.report)reports=reports.map(r=>r.id===d.report.id?d.report:r);
    render();
    root.toast?.('Reporte enviado a reparación · el agente lo tomará en el próximo ciclo','success');
  }catch(e){
    root.toast?.('No se pudo enviar a reparación: '+e.message,'error');
    if(btn){btn.disabled=false;btn.textContent=original;}
  }finally{repairBusy.delete(id);}
}
function preview(){
  const img=D.getElementById('problemShotPreview'),txt=D.getElementById('problemShotName');
  if(!img||!txt)return;
  if(!shot){img.style.display='none';img.removeAttribute('src');txt.textContent='PNG, JPG o WebP · máximo 5 MB después de comprimir';return;}
  img.src='data:'+shot.contentType+';base64,'+shot.base64;img.style.display='block';
  txt.textContent=shot.filename+' · '+Math.round(shot.base64.length*3/4/1024)+' KB';
}
async function fileToShot(file){
  if(!file||!/^image\/(png|jpeg|webp)$/i.test(file.type))throw new Error('Usa un screenshot PNG, JPG o WebP');
  if(file.size>12*1024*1024)throw new Error('El archivo original supera 12 MB');
  const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('No se pudo leer la imagen'));r.readAsDataURL(file);});
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Imagen inválida'));i.src=data;});
  let max=1600,quality=.82,out='';
  for(let tries=0;tries<4;tries++){
    const scale=Math.min(1,max/img.width,1100/img.height),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
    const c=D.createElement('canvas');c.width=w;c.height=h;c.getContext('2d',{alpha:false}).drawImage(img,0,0,w,h);
    out=c.toDataURL('image/webp',quality);
    const b64=out.split(',')[1]||'';
    if(b64.length<5.6e6)return{filename:(file.name||'screenshot').replace(/\.[^.]+$/,'')+'.webp',contentType:'image/webp',base64:b64};
    max=Math.round(max*.78);quality=Math.max(.55,quality-.09);
  }
  throw new Error('No se pudo reducir el screenshot bajo el límite de carga');
}
async function pickFile(file){
  try{shot=await fileToShot(file);preview();}
  catch(e){shot=null;preview();root.toast?.(e.message,'error');}
}
async function submit(){
  if(busy)return;const p=currentPayload();
  if(p.message.length<5){root.toast?.('Describe el problema antes de enviarlo','error');D.getElementById('problemMessage')?.focus();return;}
  busy=true;const btn=D.getElementById('problemSubmit');if(btn){btn.disabled=true;btn.textContent='Guardando…';}
  try{
    const d=await api('POST',p);
    root.toast?.('Problema reportado · quedó en la cola de reparación','success');
    D.getElementById('problemMessage').value='';shot=null;preview();
    if(d.report)reports=[d.report,...reports.filter(x=>x.id!==d.report.id)];
    await refresh();
  }catch(e){root.toast?.('No se pudo reportar: '+e.message,'error');}
  finally{busy=false;if(btn){btn.disabled=false;btn.textContent='Reportar problema';}}
}
function ensure(){
  style();
  if(!D.getElementById('problemReportDialog')){
    const el=D.createElement('div');el.id='problemReportDialog';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Reportar problema');
    el.innerHTML=`<div class="pr-shell">
      <header class="pr-head"><div><div class="pr-title">Reportar problema</div><div class="pr-sub">Describe lo que pasó. El reporte queda guardado con contexto y puede entrar automáticamente a reparación con IA.</div></div><button class="pr-close" id="problemClose">✕ Cerrar</button></header>
      <div class="pr-grid">
        <section class="pr-card"><h3>Nuevo reporte</h3><label class="pr-label" for="problemMessage">¿Qué ocurrió?</label>
          <textarea id="problemMessage" maxlength="6000" placeholder="Ej.: Traté de enviar un correo, pero al presionar Enviar apareció un error y el mensaje no salió."></textarea>
          <span class="pr-label">Screenshot</span><div class="pr-drop" id="problemDrop" tabindex="0">Arrastra una captura aquí o haz clic para seleccionarla<br><small id="problemShotName">PNG, JPG o WebP · máximo 5 MB después de comprimir</small></div>
          <input id="problemFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><img id="problemShotPreview" alt="Vista previa del screenshot">
          <label class="pr-auto"><input id="problemAutoRepair" type="checkbox" checked><span><b>Reparar automáticamente con IA</b><br>El reporte quedará disponible para el agente de reparación. Las correcciones se hacen mediante rama/PR y pruebas, no directamente sobre producción.</span></label>
          <div class="pr-meta">Se adjunta automáticamente: sección actual, URL, versión del dashboard, navegador y usuario. No incluyas contraseñas, tokens ni datos sensibles en la captura.</div>
          <button class="pr-submit" id="problemSubmit">Reportar problema</button>
        </section>
        <section class="pr-card"><div class="pr-history-head"><h3 style="margin:0">Historial</h3><button class="pr-close" id="problemRefresh" style="padding:6px 9px">↻ Actualizar</button></div><div id="problemHistory" class="pr-list"></div></section>
      </div></div>`;
    D.body.appendChild(el);
    D.getElementById('problemClose').onclick=closeReporter;
    D.getElementById('problemRefresh').onclick=refresh;
    D.getElementById('problemSubmit').onclick=submit;
    D.getElementById('problemHistory').onclick=e=>{
      const btn=e.target?.closest?.('[data-pr-repair]');if(!btn)return;
      repairReport(btn.dataset.prRepair,btn);
    };
    const input=D.getElementById('problemFile'),drop=D.getElementById('problemDrop');
    drop.onclick=()=>input.click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}};
    input.onchange=()=>pickFile(input.files?.[0]);
    drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');
    drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');pickFile(e.dataTransfer?.files?.[0]);};
    D.addEventListener('paste',e=>{if(!open)return;const file=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(file)pickFile(file);});
  }
  const menu=D.getElementById('userMenu');
  if(menu&&!D.getElementById('problemReportMenuItem')){
    const item=D.createElement('div');item.className='user-menu-item';item.id='problemReportMenuItem';
    item.innerHTML='<span aria-hidden="true" style="width:14px;text-align:center;font-weight:800">!</span> REPORTAR PROBLEMA';
    item.onclick=()=>{try{root.closeUserMenu?.();}catch(_){}openReporter();};
    const manual=[...menu.querySelectorAll('.user-menu-item')].find(x=>/Manual de usuario/i.test(x.textContent||''));
    if(manual)manual.insertAdjacentElement('afterend',item);else menu.prepend(item);
  }
}
function openReporter(){ensure();open=true;D.getElementById('problemReportDialog').classList.add('open');D.body.style.overflow='hidden';refresh();setTimeout(()=>D.getElementById('problemMessage')?.focus(),30);}
function closeReporter(){open=false;D.getElementById('problemReportDialog')?.classList.remove('open');D.body.style.overflow='';}
root.openProblemReporter=openReporter;
root.closeProblemReporter=closeReporter;
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',ensure,{once:true});else ensure();
})(window);
