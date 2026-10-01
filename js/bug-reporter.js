/* js/bug-reporter.js
 * Reportes internos de problemas + historial de reparación IA.
 * Los screenshots se comprimen en el navegador antes de enviarse.
 */
(function(root){
'use strict';
const D=root.document;
const STATUS={
  nuevo:['Nuevo','var(--warning,#f0b429)'],
  analizando:['Analizando con IA','var(--accent,#00d4cc)'],
  reparando:['Reparando','var(--accent,#00d4cc)'],
  pr_creado:['PR creado','var(--info,#7ca7ff)'],
  needs_review:['Requiere revisión','var(--warning,#f0b429)'],
  resuelto:['Resuelto','var(--success,#29d17d)'],
  error:['Error de reparación','var(--danger,#ff4d5e)'],
  cerrado:['Cerrado','var(--text3,#777)']
};
const MAX_UPLOAD=12*1024*1024,MAX_DATA_URL=72000;
let selectedImage=null,history=[],opened=false;

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cfg(){
  try{
    const px=typeof root._proxyCfg==='function'?root._proxyCfg():null;
    if(!px?.url||!px?.key)return null;
    const u=new URL(px.url);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return null;
    if(u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname))return null;
    return{base:u.origin+u.pathname.replace(/\/$/,''),key:px.key};
  }catch(_){return null;}
}
async function api(method,query='',body){
  const c=cfg();if(!c)throw new Error('Proxy no configurado');
  const r=await fetch(c.base+'/shared/bug-reports'+query,{
    method,credentials:'include',redirect:'error',
    headers:{'X-App-Key':c.key,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let data={};try{data=await r.json();}catch(_){}
  if(!r.ok)throw new Error(data.error||('HTTP '+r.status));
  return data;
}
function currentContext(){
  const active=D.querySelector('.tab-content.active,[data-tab-panel].active');
  const section=(active?.id||root._currentTab||root.currentTab||'').replace(/^tab-/,'')||'desconocida';
  let build='';
  for(const script of [...D.scripts]){
    const m=String(script.src||'').match(/[?&]v=([0-9a-f]{7,40})/i);if(m){build=m[1];break;}
  }
  const user=typeof root.AUTH?.getUser==='function'?root.AUTH.getUser():null;
  return{
    section:String(section).slice(0,80),
    path:(location.pathname+location.search+location.hash).slice(0,700),
    build:String(build||'').slice(0,64),
    viewport:{width:innerWidth,height:innerHeight,dpr:Number(devicePixelRatio||1)},
    userAgent:String(navigator.userAgent||'').slice(0,500),
    reporterName:String(user?.name||user?.username||'').slice(0,160)
  };
}
function style(){
  if(D.getElementById('tlsBugReporterStyle'))return;
  const el=D.createElement('style');el.id='tlsBugReporterStyle';
  el.textContent=`
  dialog.tls-bug-dialog{width:min(980px,calc(100vw - 28px));max-height:min(880px,calc(100dvh - 28px));
    border:1px solid var(--border2);border-radius:16px;padding:0;background:var(--surface);color:var(--text);
    box-shadow:0 24px 80px rgba(0,0,0,.62);overflow:hidden}
  dialog.tls-bug-dialog::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(4px)}
  .tls-bug-shell{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(330px,.95fr);height:min(820px,calc(100dvh - 30px))}
  .tls-bug-pane{min-width:0;overflow:auto;padding:22px}.tls-bug-pane+ .tls-bug-pane{border-left:1px solid var(--border)}
  .tls-bug-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}
  .tls-bug-title{font-size:20px;font-weight:800}.tls-bug-sub{font-size:11px;color:var(--text3);margin-top:4px;line-height:1.45}
  .tls-bug-close{border:0;background:transparent;color:var(--text2);font-size:20px;cursor:pointer;padding:3px 6px}
  .tls-bug-label{display:block;font-size:11px;font-weight:700;color:var(--text2);margin:14px 0 6px}
  .tls-bug-text{width:100%;min-height:126px;resize:vertical;border:1px solid var(--border2);border-radius:10px;
    background:var(--surface2);color:var(--text);padding:11px 12px;font:13px/1.5 'DM Sans',sans-serif;outline:none}
  .tls-bug-text:focus{border-color:var(--accent)}
  .tls-bug-drop{border:1px dashed var(--border2);border-radius:12px;padding:15px;text-align:center;background:rgba(255,255,255,.018)}
  .tls-bug-drop.drag{border-color:var(--accent);background:rgba(0,212,204,.06)}
  .tls-bug-preview{display:none;position:relative;margin-top:10px}.tls-bug-preview img{display:block;width:100%;max-height:260px;object-fit:contain;border-radius:9px;border:1px solid var(--border)}
  .tls-bug-preview button{position:absolute;top:6px;right:6px;border:0;border-radius:7px;background:rgba(0,0,0,.72);color:#fff;padding:5px 8px;cursor:pointer}
  .tls-bug-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
  .tls-bug-note{font-size:10px;color:var(--text3);line-height:1.45;margin-top:8px}
  .tls-bug-history-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
  .tls-bug-list{display:flex;flex-direction:column;gap:8px}.tls-bug-row{border:1px solid var(--border);border-radius:10px;padding:10px 11px;cursor:pointer;background:var(--surface2)}
  .tls-bug-row:hover{border-color:var(--border2)}.tls-bug-row-top{display:flex;justify-content:space-between;gap:8px;align-items:center}
  .tls-bug-row-msg{font-size:12px;line-height:1.4;margin-top:6px;color:var(--text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .tls-bug-meta{font-size:9px;color:var(--text3);margin-top:6px}.tls-bug-status{font-size:9px;font-weight:800;border:1px solid currentColor;border-radius:999px;padding:3px 7px;white-space:nowrap}
  .tls-bug-empty{padding:30px 12px;text-align:center;color:var(--text3);font-size:12px}
  .tls-bug-detail{margin-top:14px;border-top:1px solid var(--border);padding-top:14px}.tls-bug-detail img{width:100%;border-radius:9px;border:1px solid var(--border);margin-top:9px}
  .tls-bug-link{color:var(--accent);text-decoration:none}.tls-bug-link:hover{text-decoration:underline}
  @media(max-width:760px){dialog.tls-bug-dialog{width:100vw;max-width:none;height:100dvh;max-height:none;border-radius:0;border:0}
    .tls-bug-shell{display:block;height:100dvh;overflow:auto}.tls-bug-pane{overflow:visible}.tls-bug-pane+.tls-bug-pane{border-left:0;border-top:1px solid var(--border)}}
  `;
  D.head.appendChild(el);
}
function ensure(){
  style();
  let dlg=D.getElementById('tlsBugDialog');if(dlg)return dlg;
  dlg=D.createElement('dialog');dlg.id='tlsBugDialog';dlg.className='tls-bug-dialog';
  dlg.innerHTML=`
    <div class="tls-bug-shell">
      <section class="tls-bug-pane">
        <div class="tls-bug-head"><div><div class="tls-bug-title">⚠ Reportar problema</div>
          <div class="tls-bug-sub">Describe qué estabas intentando hacer. El reporte queda guardado y entra automáticamente a la cola de reparación con IA.</div></div>
          <button class="tls-bug-close" type="button" data-bug-close aria-label="Cerrar">×</button></div>
        <label class="tls-bug-label" for="tlsBugMessage">¿Qué pasó?</label>
        <textarea id="tlsBugMessage" class="tls-bug-text" maxlength="5000" placeholder="Ej.: Traté de enviar un correo pero me arrojó el siguiente problema..."></textarea>
        <label class="tls-bug-label">Screenshot <span style="font-weight:400;color:var(--text3)">(opcional, recomendado)</span></label>
        <div class="tls-bug-drop" id="tlsBugDrop">
          <input id="tlsBugFile" type="file" accept="image/png,image/jpeg,image/webp" hidden>
          <button type="button" class="btn btn-ghost btn-sm" id="tlsBugPick">📷 Subir screenshot</button>
          <div class="tls-bug-note">También puedes arrastrar una imagen aquí. Se comprime localmente antes de guardarla.</div>
          <div class="tls-bug-preview" id="tlsBugPreview"><img alt="Screenshot del problema"><button type="button" id="tlsBugRemove">Quitar</button></div>
        </div>
        <div id="tlsBugContext" class="tls-bug-note"></div>
        <div class="tls-bug-actions"><button type="button" class="btn btn-ghost" data-bug-close>Cancelar</button><button type="button" class="btn btn-primary" id="tlsBugSubmit">Enviar a reparación IA</button></div>
        <div id="tlsBugSubmitState" class="tls-bug-note" aria-live="polite"></div>
      </section>
      <section class="tls-bug-pane">
        <div class="tls-bug-history-head"><div><div style="font-size:15px;font-weight:800">Historial</div><div class="tls-bug-sub">Estado de los problemas reportados</div></div>
          <button type="button" class="btn btn-ghost btn-sm" id="tlsBugRefresh">↺</button></div>
        <div id="tlsBugList" class="tls-bug-list"><div class="tls-bug-empty">Cargando…</div></div>
        <div id="tlsBugDetail" class="tls-bug-detail" style="display:none"></div>
      </section>
    </div>`;
  D.body.appendChild(dlg);
  dlg.querySelectorAll('[data-bug-close]').forEach(b=>b.addEventListener('click',close));
  D.getElementById('tlsBugPick').onclick=()=>D.getElementById('tlsBugFile').click();
  D.getElementById('tlsBugFile').addEventListener('change',e=>handleFile(e.target.files?.[0]));
  D.getElementById('tlsBugRemove').onclick=()=>setImage(null);
  D.getElementById('tlsBugSubmit').onclick=submit;
  D.getElementById('tlsBugRefresh').onclick=loadHistory;
  const drop=D.getElementById('tlsBugDrop');
  for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')});
  for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')});
  drop.addEventListener('drop',e=>handleFile(e.dataTransfer?.files?.[0]));
  dlg.addEventListener('close',()=>{opened=false;});
  return dlg;
}
function setImage(image){
  selectedImage=image;
  const p=D.getElementById('tlsBugPreview');if(!p)return;
  if(image){p.style.display='block';p.querySelector('img').src=image.dataUrl;}
  else{p.style.display='none';p.querySelector('img').removeAttribute('src');const f=D.getElementById('tlsBugFile');if(f)f.value='';}
}
async function loadImage(file){
  if('createImageBitmap' in root)return createImageBitmap(file);
  return new Promise((resolve,reject)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('No se pudo leer la imagen'))};img.src=u;});
}
async function compress(file){
  if(!file||!/^image\/(png|jpeg|webp)$/i.test(file.type||''))throw new Error('Usa una imagen PNG, JPG o WebP');
  if(file.size>MAX_UPLOAD)throw new Error('El screenshot supera 12 MB');
  const img=await loadImage(file),iw=img.width||img.naturalWidth,ih=img.height||img.naturalHeight;
  if(!iw||!ih)throw new Error('La imagen no tiene dimensiones válidas');
  let scale=Math.min(1,1280/iw,900/ih),quality=.76,dataUrl='',w=0,h=0;
  for(let pass=0;pass<8;pass++){
    w=Math.max(1,Math.round(iw*scale));h=Math.max(1,Math.round(ih*scale));
    const c=D.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{alpha:false});
    x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
    dataUrl=c.toDataURL('image/jpeg',quality);
    if(dataUrl.length<=MAX_DATA_URL)break;
    if(quality>.46)quality-=.1;else scale*=.82;
  }
  try{img.close?.();}catch(_){}
  if(dataUrl.length>MAX_DATA_URL)throw new Error('No fue posible comprimir el screenshot lo suficiente');
  return{dataUrl,mime:'image/jpeg',width:w,height:h,bytes:Math.round((dataUrl.length-dataUrl.indexOf(',')-1)*3/4)};
}
async function handleFile(file){
  if(!file)return;
  const state=D.getElementById('tlsBugSubmitState');state.textContent='Comprimiendo screenshot…';
  try{setImage(await compress(file));state.textContent='Screenshot listo.';}catch(e){setImage(null);state.textContent=e.message;}
}
function open(){
  closeUserMenu?.();const dlg=ensure();opened=true;
  D.getElementById('tlsBugContext').textContent='Contexto: '+currentContext().section+' · '+location.pathname;
  D.getElementById('tlsBugSubmitState').textContent='';
  try{dlg.showModal();}catch(_){dlg.setAttribute('open','');}
  loadHistory();
  setTimeout(()=>D.getElementById('tlsBugMessage')?.focus(),50);
}
function close(){
  const dlg=D.getElementById('tlsBugDialog');if(!dlg)return;
  try{dlg.close();}catch(_){dlg.removeAttribute('open');}opened=false;
}
function statusBadge(status){
  const [label,color]=STATUS[status]||[String(status||'Nuevo'), 'var(--text3)'];
  return '<span class="tls-bug-status" style="color:'+color+'">'+esc(label)+'</span>';
}
function when(v){try{return new Intl.DateTimeFormat('es-CL',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(_){return String(v||'');}}
function renderHistory(){
  const box=D.getElementById('tlsBugList');if(!box)return;
  if(!history.length){box.innerHTML='<div class="tls-bug-empty">Todavía no hay problemas reportados.</div>';return;}
  box.innerHTML=history.map(r=>`<div class="tls-bug-row" data-id="${esc(r.id)}"><div class="tls-bug-row-top"><strong style="font-size:11px">${esc((r.section||'Dashboard').toUpperCase())}</strong>${statusBadge(r.status)}</div>
    <div class="tls-bug-row-msg">${esc(r.message)}</div><div class="tls-bug-meta">${esc(when(r.createdAt))} · ${esc(r.reporterName||r.reporter||'usuario')}</div></div>`).join('');
  box.querySelectorAll('.tls-bug-row').forEach(el=>el.onclick=()=>showDetail(el.dataset.id));
}
async function loadHistory(){
  const box=D.getElementById('tlsBugList');if(box)box.innerHTML='<div class="tls-bug-empty">Cargando…</div>';
  try{const d=await api('GET');history=Array.isArray(d.reports)?d.reports:[];renderHistory();}
  catch(e){if(box)box.innerHTML='<div class="tls-bug-empty">No se pudo cargar el historial: '+esc(e.message)+'</div>';}
}
async function showDetail(id){
  const box=D.getElementById('tlsBugDetail');if(!box)return;
  box.style.display='block';box.innerHTML='<div class="tls-bug-empty">Cargando detalle…</div>';
  try{
    const d=await api('GET','?id='+encodeURIComponent(id)),r=d.report||{};
    const canRetry=String(root.AUTH?.getUser?.()?.role||root.AUTH?.getUser?.()?.rol||'').toLowerCase()==='admin'&&['error','needs_review'].includes(r.status);
    box.innerHTML=`<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><strong>${esc(r.section||'Dashboard')}</strong>${statusBadge(r.status)}</div>
      <p style="font-size:12px;line-height:1.5;white-space:pre-wrap">${esc(r.message||'')}</p>
      ${r.repair?.analysis?'<div class="tls-bug-note"><b>Análisis IA:</b> '+esc(r.repair.analysis)+'</div>':''}
      ${r.repair?.error?'<div class="tls-bug-note" style="color:var(--danger)"><b>Error:</b> '+esc(r.repair.error)+'</div>':''}
      ${r.repair?.prUrl?'<div style="margin-top:8px"><a class="tls-bug-link" target="_blank" rel="noopener" href="'+esc(r.repair.prUrl)+'">Ver Pull Request ↗</a></div>':''}
      ${d.screenshot?'<img alt="Screenshot reportado" src="'+esc(d.screenshot)+'">':''}
      ${canRetry?'<button class="btn btn-ghost btn-sm" id="tlsBugRetry" style="margin-top:10px">↻ Reintentar reparación IA</button>':''}`;
    D.getElementById('tlsBugRetry')?.addEventListener('click',async()=>{try{await api('PATCH','',{id,action:'retry'});await loadHistory();await showDetail(id);}catch(e){root.toast?.(e.message,'error');}});
  }catch(e){box.innerHTML='<div class="tls-bug-empty">No se pudo cargar el detalle: '+esc(e.message)+'</div>';}
}
async function submit(){
  const msg=String(D.getElementById('tlsBugMessage')?.value||'').trim(),state=D.getElementById('tlsBugSubmitState'),btn=D.getElementById('tlsBugSubmit');
  if(msg.length<10){state.textContent='Describe el problema con un poco más de detalle.';return;}
  btn.disabled=true;state.textContent='Guardando reporte…';
  try{
    const context=currentContext();
    const body={message:msg,context,screenshot:selectedImage};
    const d=await api('POST','',body);
    state.textContent='✓ Reporte '+d.id+' guardado. La reparación IA quedó en cola.';
    D.getElementById('tlsBugMessage').value='';setImage(null);await loadHistory();
    root.toast?.('Problema enviado a reparación IA','success');
  }catch(e){state.textContent='No se pudo guardar: '+e.message;root.toast?.('No se pudo reportar el problema','error');}
  finally{btn.disabled=false;}
}
root.BUG_REPORTER={open,close,loadHistory};
root.openBugReporter=open;
})(window);
