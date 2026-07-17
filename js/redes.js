/* js/redes.js — módulo extraído de index.html (carga en el mismo punto). */
// ── REDES SOCIALES ─────────────────────────────────────────────
let _redesLoaded=false, _redesLastGen='', _redesLastAgent='', _redesLastMedia='';
let _redesView='lista', _redesCalMonth=null, _redesReportText='', _redesDateResolve=null, _redesLastPedido='';
let _redesReplyBusy=false, _redesLoadBusy=false;   // guards anti-concurrencia (carga y llamadas a Claude)
let _redesEditId=null, _redesDateRed='';           // edición inline y red del modal de fecha
const _redesLeadCreated=new Set();   // interacciones ya convertidas en lead (anti-duplicado)
const REDES_NETS=['Instagram','LinkedIn','TikTok','Facebook'];
const REDES_ICON={Instagram:'📷',LinkedIn:'in',TikTok:'♪',Facebook:'f'};
// Colores legibles sobre fondo oscuro (TikTok era #000 → invisible; azules aclarados).
const REDES_COLOR={Instagram:'#e1306c',LinkedIn:'#3b9bff',TikTok:'#fe2c55',Facebook:'#4a9bff'};
const REDES_GLYPH={Instagram:'ig-glyph',LinkedIn:'li-glyph',TikTok:'tt-glyph',Facebook:'fb-glyph'};
const REDES_BEST_HOUR={Instagram:19,LinkedIn:9,TikTok:20,Facebook:13};   // hora sugerida por red (afinable con datos)
const _redesPad=n=>String(n).padStart(2,'0');
const _redesDayKey=dt=>`${dt.getFullYear()}-${_redesPad(dt.getMonth()+1)}-${_redesPad(dt.getDate())}`;
// ¿Hay CÓMO leer/escribir Airtable? — token local O proxy (Worker). Igual que hasAirtableAccess()
// del resto de la app; antes Redes y Newsletter sólo miraban getToken() y en modo proxy no cargaban.
function _redesHasData(){ try{ return (typeof hasAirtableAccess==='function')?hasAirtableAccess():!!getToken(); }catch(e){ return !!getToken(); } }
// Modo demo: siembra datos de ejemplo en memoria para VER la sección funcionando sin conectar nada.
// _redesWrite() intercepta cualquier escritura para que el demo jamás toque Airtable.
let _redesDemo=false, _redesDemoSeq=0;
async function _redesWrite(table,method,recordId,fields,maxTries){
  if(_redesDemo){ return {id:recordId||('demo_'+(++_redesDemoSeq)), fields:Object.assign({},fields)}; }
  return airtableWriteTolerant(table,method,recordId,fields,maxTries);
}

function initRedes(){
  redesPopulatePedidos();
  if(!_redesLoaded && !_redesDemo && _redesHasData()) redesLoad();
  else { renderRedesKpis(); redesSetView(_redesView); renderRedesInbox(); renderRedesMetrics(); renderRedesBestTimes(); renderRedesRecycle(); }
}

async function redesLoad(force){
  if(_redesDemo){ toast('Estás en modo demo — sal del demo para cargar datos reales','info'); return; }
  if(!_redesHasData()){toast('Conecta Airtable (token o proxy) en Mi cuenta — o pulsa “Ver demo”','error');return;}
  if(_redesLoadBusy) return;   // evita recargas solapadas (spam del botón Actualizar)
  _redesLoadBusy=true;
  try{
    const loadingHTML='<div style="padding:16px;color:var(--text3);font-size:12px">⏳ Cargando…</div>';
    if(force){const pe=document.getElementById('redesPostsList');if(pe)pe.innerHTML=loadingHTML;const ie=document.getElementById('redesInboxList');if(ie)ie.innerHTML=loadingHTML;}
    // Lecturas tolerantes: distingue "tabla no existe" (estado guía) de un error de red (toast).
    state._socialPostsErr=false; state._socialIntErr=false;
    const isMissing=e=>/not ?found|could ?not|no such|table|404|NOT_FOUND|invalid permissions|not authorized|403/i.test(String((e&&e.message)||''));
    state.socialPosts = await airtableFetch('Social_Posts',200).then(r=>r.records).catch(e=>{if(isMissing(e))state._socialPostsErr=true;else toast('No se pudieron cargar publicaciones: '+e.message,'error');return [];});
    state.socialInteractions = await airtableFetch('Social_Interactions',200).then(r=>r.records).catch(e=>{if(isMissing(e))state._socialIntErr=true;else toast('No se pudieron cargar interacciones: '+e.message,'error');return [];});
    state.socialMetrics = await airtableFetch('Social_Metrics',365).then(r=>r.records).catch(()=>[]);
    _redesLoaded=true;
    renderRedesKpis(); redesSetView(_redesView); renderRedesInbox(); renderRedesMetrics(); renderRedesBestTimes(); renderRedesRecycle();
  }finally{ _redesLoadBusy=false; }
}

// ── Modo demo: datos de ejemplo (foco Instagram) para ver la sección viva sin conectar nada ──
function redesDemoToggle(){ if(_redesDemo) redesDemoExit(); else redesDemoSeed(); }
function redesDemoExit(){
  _redesDemo=false; _redesLoaded=false;
  state.socialPosts=[]; state.socialInteractions=[]; state.socialMetrics=[];
  state._socialPostsErr=false; state._socialIntErr=false;
  _redesDemoBanner(false);
  renderRedesKpis(); redesSetView(_redesView); renderRedesInbox(); renderRedesMetrics(); renderRedesBestTimes(); renderRedesRecycle();
  toast('Saliste del modo demo','info');
  if(_redesHasData()) redesLoad(true);   // vuelve a los datos reales si hay conexión
}
function redesDemoSeed(){
  _redesDemo=true; _redesLoaded=true;
  const now=Date.now(), DAY=86400000, iso=t=>new Date(t).toISOString();
  // whenOff = días respecto a hoy (negativo = pasado → publicado; positivo = futuro → programado)
  const P=(id,red,estado,copy,hashtags,whenOff,media,extra)=>{
    const fld=(estado==='Publicado')?'Fecha publicación':'Fecha programada';
    const at=iso(now+(whenOff||0)*DAY);
    return {id:'demo_p'+id,createdTime:iso(now-Math.abs(whenOff||0)*DAY),
      fields:Object.assign({Red:red,Estado:estado,Copy:copy,Hashtags:hashtags,Objetivo:'Captar leads',Agente:'CAPTION_AGENT',[fld]:at},media?{'Media URL':media}:{},extra||{})};
  };
  const img=s=>`https://picsum.photos/seed/${s}/640.jpg`;
  state.socialPosts=[
    P(1,'Instagram','Publicado','✨ Entregamos un letrero de neón LED personalizado para un restaurant en Vitacura. La ambientación nocturna quedó espectacular.\n\n¿Tienes un local que merece brillar? Escríbenos.','#neonled #vitacura #santiago #letrerosluminosos #diseño',-6,img('neon'),{Engagement:428}),
    P(2,'Instagram','Publicado','🏆 50 trofeos personalizados impresos en 3D para la gala corporativa de una empresa tech. Cada uno con el logo grabado.','#impresion3d #trofeos #galacorporativa #chile',-12,img('trofeo'),{Engagement:612}),
    P(3,'Instagram','Publicado','⏱️ Time-lapse del proceso de impresión 3D de medallas para un torneo. El detalle importa.','#timelapse #3dprinting #medallas #maker',-3,'',{Engagement:255}),
    P(4,'Instagram','Programado','🎨 Nuevo proyecto en camino: señalética premium para una oficina en Providencia. Pronto el antes y después.','#señaletica #diseñointerior #providencia',2,img('signage')),
    P(5,'Instagram','Programado','💡 3 razones para elegir neón LED sobre el neón tradicional: consume menos, dura más y es más seguro. Hilo 👇','#neonled #led #ahorroenergetico',5,''),
    P(6,'Instagram','En revisión','🔥 Detrás de cámaras: así fabricamos un logo corporativo iluminado de 1,2 metros. ¿Lo quieres para tu marca?','#behindthescenes #neon #branding',1,img('bts')),
    P(7,'LinkedIn','Borrador','Caso de éxito: cómo ayudamos a una cadena de restaurantes a unificar su identidad visual con señalética LED en 6 locales.','#B2B #fabricaciondigital #retail',0,''),
    P(8,'Instagram','Borrador','📸 Galería: los 10 mejores proyectos de neón que entregamos este trimestre. ¿Cuál es tu favorito?','#neon #portafolio #diseño',0,'')
  ];
  const I=(id,red,tipo,user,msg,estado,esLead,resp,dOff)=>({id:'demo_i'+id,createdTime:iso(now-dOff*DAY),
    fields:{Red:red,Tipo:tipo,Usuario:user,Mensaje:msg,Estado:estado,'Es lead':!!esLead,'Respuesta sugerida':resp||'','Fecha':iso(now-dOff*DAY)}});
  state.socialInteractions=[
    I(1,'Instagram','DM','carla.eventos','Hola! Cuánto costaría un letrero de neón con el nombre de mi cafetería? Mide como 80cm','Pendiente',true,'',0),
    I(2,'Instagram','Comentario','javiernuñez','Quedó increíble 🔥🔥 hacen envíos a regiones?','Pendiente',true,'',0),
    I(3,'Instagram','Comentario','packandgo','Pedí uno hace 3 semanas y todavía no llega, pésimo servicio','Pendiente',false,'',1),
    I(4,'Instagram','Comentario','laura_dg','Amo esto 😍 los sigo hace rato','Respondido',false,'¡Gracias Laura! 💜 Nos alegra mucho tenerte por acá.',2),
    I(5,'Instagram','DM','estudio.norte','Buenas, necesito 20 trofeos 3D para diciembre, me pueden cotizar?','Respondido',true,'¡Hola! Claro que sí. Te paso a un ejecutivo para armar tu cotización 🙌',2)
  ];
  const mets=[]; let mid=0;
  // 30 días de métricas para Instagram (engagement mayor fin de semana → alimenta "mejor momento")
  for(let d=29;d>=0;d--){ const dt=new Date(now-d*DAY), wd=dt.getDay(), wknd=(wd===0||wd===6||wd===3)?1.6:1;
    mets.push({id:'demo_m'+(++mid),createdTime:iso(dt.getTime()),fields:{Red:'Instagram',Fecha:iso(dt.getTime()),
      Alcance:Math.round((900+((d*37)%700))*wknd),Impresiones:Math.round((1400+((d*53)%900))*wknd),
      Engagement:Math.round((70+((d*11)%120))*wknd),Clics:20+((d*7)%40),'Seguidores nuevos':3+((d*3)%12),Leads:(d%5===0)?2:(d%3===0?1:0)}}); }
  // un poco de LinkedIn para la comparativa
  for(let d=20;d>=0;d-=2){ const dt=new Date(now-d*DAY);
    mets.push({id:'demo_m'+(++mid),createdTime:iso(dt.getTime()),fields:{Red:'LinkedIn',Fecha:iso(dt.getTime()),
      Alcance:300+((d*29)%400),Impresiones:500+((d*31)%600),Engagement:15+((d*5)%40),Clics:8+((d*3)%20),'Seguidores nuevos':1+((d*2)%6),Leads:(d%6===0)?1:0}}); }
  state.socialMetrics=mets;
  state._socialPostsErr=false; state._socialIntErr=false;
  _redesDemoBanner(true);
  renderRedesKpis(); redesSetView(_redesView); renderRedesInbox(); renderRedesMetrics(); renderRedesBestTimes(); renderRedesRecycle();
  toast('👁️ Modo demo activado — datos de ejemplo de Instagram (no se guardan en Airtable)','success');
}
// Banner visible mientras el modo demo está activo
function _redesDemoBanner(on){
  let b=document.getElementById('redesDemoBanner');
  if(on){
    if(!b){ const host=document.getElementById('tab-redes'); const hdr=host&&host.querySelector('.section-header');
      b=document.createElement('div'); b.id='redesDemoBanner'; b.className='redes-demo-banner';
      if(hdr&&hdr.parentNode) hdr.parentNode.insertBefore(b,hdr.nextSibling); else if(host) host.insertBefore(b,host.firstChild); }
    b.innerHTML=`👁️ <b>Modo demo</b> — estás viendo datos de ejemplo de Instagram. Nada se guarda en Airtable. <button class="btn btn-ghost btn-sm" onclick="redesDemoExit()">Salir del demo</button>`;
    b.style.display='';
  } else if(b){ b.style.display='none'; }
}

// Pobla el selector de pedidos entregados (idea: generar contenido desde tu propia producción).
function redesPopulatePedidos(){
  const sel=document.getElementById('redesGenPedido'); if(!sel) return;
  const peds=(state.pedidos||[]).filter(p=>['Despachado','Listo para despacho'].includes(p.fields['Estado pedido']||''));
  const cur=sel.value;
  sel.innerHTML='<option value="">— elegir pedido entregado —</option>'+peds.slice(0,60).map(p=>{
    const f=p.fields, n=f['N° Pedido']||p.id, cli=typeof resolveClienteName==='function'?resolveClienteName(f['Cliente']):'';
    const foto=f['Foto QA URL']?' 📷':'';
    return `<option value="${p.id}">${escapeHtml(n)}${cli?(' · '+escapeHtml(cli)):''}${foto}</option>`;
  }).join('');
  if(cur) sel.value=cur;
}

function renderRedesKpis(){
  const posts=state.socialPosts||[], inter=state.socialInteractions||[];
  const now=new Date(), m=now.getMonth(), y=now.getFullYear();
  const est=p=>p.fields['Estado']||p.fields['Estado post']||'';
  const pub=posts.filter(p=>{const e=est(p);if(e!=='Publicado')return false;const d=p.fields['Fecha publicación']||p.fields['Fecha programada']||p.createdTime;const dt=d?new Date(d):null;return dt&&dt.getMonth()===m&&dt.getFullYear()===y;}).length;
  const prog=posts.filter(p=>est(p)==='Programado').length;
  const borr=posts.filter(p=>est(p)==='Borrador').length;
  const intPend=inter.filter(i=>(i.fields['Estado']||'Pendiente')==='Pendiente').length;
  const leads=inter.filter(i=>i.fields['Es lead']===true||/^s[ií]/i.test(i.fields['Es lead']||'')).length;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('redesKpiPub',pub); set('redesKpiProg',prog); set('redesKpiBorr',borr); set('redesKpiInt',intPend); set('redesKpiLeads',leads);
  const badge=document.getElementById('badge-redes');
  if(badge){if(intPend>0){badge.textContent=intPend;badge.style.display='';}else badge.style.display='none';}
}

function _redesFmtFecha(d){
  if(!d) return 'sin fecha';
  const dt=new Date(d); if(isNaN(dt)) return escapeHtml(String(d));
  return dt.toLocaleDateString('es-CL',{day:'numeric',month:'short'})+' '+dt.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
}
function _redesChip(red){
  const c=REDES_COLOR[red];
  if(!c) return `<span class="redes-pill" style="background:var(--surface3);color:var(--text2);border-color:var(--border2)">${escapeHtml(red||'—')}</span>`;
  const g=REDES_GLYPH[red];
  return `<span class="redes-pill" style="background:${c}22;color:${c};border-color:${c}66">${g?`<svg viewBox="0 0 24 24"><use href="#${g}"/></svg>`:''}${escapeHtml(red)}</span>`;
}

function renderRedesPosts(){
  const el=document.getElementById('redesPostsList'); if(!el) return;
  let posts=(state.socialPosts||[]).slice();
  if(!posts.length){
    // Estado vacío enriquecido: guía de 3 pasos para empezar (idea: "no sé cómo empezar")
    el.innerHTML=`<div class="redes-onboard">
      <div class="redes-onboard-head"><span class="ico">🚀</span><div><div class="t">Empieza a gestionar tus redes</div><div class="s">Aún no hay publicaciones${state._socialPostsErr?' (falta crear la tabla <code>Social_Posts</code> en Airtable)':''}. Sigue estos pasos:</div></div></div>
      <div class="redes-onboard-steps">
        <div class="redes-step"><span class="n">1</span><div><b>👀 Míralo funcionando</b><div>Carga datos de ejemplo de Instagram para ver el calendario, la bandeja y las métricas en acción — sin conectar nada.</div><button class="btn btn-primary btn-sm" style="margin-top:7px;background:#ec4899;border-color:#ec4899;color:#fff" onclick="redesDemoSeed()">👁️ Ver demo</button></div></div>
        <div class="redes-step"><span class="n">2</span><div><b>✍️ Crea tu primer post</b><div>Usa el <b>Generador de contenido</b> de arriba: describe un proyecto o elige un pedido entregado, genera el copy con IA y pulsa <b>“Guardar borrador”</b>.</div></div></div>
        <div class="redes-step"><span class="n">3</span><div><b>🔗 Conéctalo de verdad</b><div>Con <b>Make</b> puedes traer comentarios y métricas reales de Instagram a las tablas <code>Social_Posts</code>, <code>Social_Interactions</code> y <code>Social_Metrics</code>.</div><button class="btn btn-ghost btn-sm" style="margin-top:7px" onclick="redesConnectGuide()">🔗 Ver cómo conectar</button></div></div>
      </div>
    </div>`; return;
  }
  const fRed=document.getElementById('redesFiltroRed')?.value||'';
  const fEst=document.getElementById('redesFiltroEstado')?.value||'';
  posts=posts.filter(p=>{
    const red=p.fields['Red']||'', e=p.fields['Estado']||p.fields['Estado post']||'';
    return (!fRed||red===fRed)&&(!fEst||e===fEst);
  });
  posts.sort((a,b)=>{const da=a.fields['Fecha programada']||a.createdTime||'',db=b.fields['Fecha programada']||b.createdTime||'';return new Date(db)-new Date(da);});
  if(!posts.length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">Sin publicaciones con esos filtros.</div>';return;}
  el.innerHTML=posts.map(p=>{
    const f=p.fields, red=f['Red']||'—', e=f['Estado']||f['Estado post']||'Borrador';
    const copy=(f['Copy']||f['Texto']||'').toString();
    const fecha=f['Fecha programada']||f['Fecha publicación']||'';
    const media=safeHref(f['Media URL']||'');
    const btns=[];
    if(e==='Borrador'){
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSetEstado('${p.id}','En revisión')">👀 A revisión</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSchedule('${p.id}')">📅 Programar</button>`);
    }
    if(e==='En revisión'){
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSchedule('${p.id}')">✓ Aprobar y programar</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSetEstado('${p.id}','Borrador')">↩ A borrador</button>`);
    }
    if(e==='Programado'){
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSchedule('${p.id}')">📅 Reagendar</button>`);
      btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesSetEstado('${p.id}','Publicado')">Marcar publicado ✓</button>`);
    }
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesPreviewInsta('${p.id}')" title="Ver cómo se vería en Instagram">👁 Preview</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesOpenEdit('${p.id}')">✏ Editar</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="redesCopyPost('${p.id}')">Copiar copy</button>`);
    return `<div class="redes-post" style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px">
      ${media?`<a href="${media}" target="_blank" rel="noopener" style="flex-shrink:0">${_redesIsImg(media)?`<img loading="lazy" src="${media}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">`:`<div style="width:64px;height:64px;border-radius:10px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surface3);font-size:20px">🎬</div>`}</a>`:''}
      <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        ${_redesChip(red)} ${estadoBadge(e)}
        <span style="font-size:10px;color:var(--text3)">🗓 ${_redesFmtFecha(fecha)}</span>
        ${f['Objetivo']?`<span style="font-size:10px;color:var(--text3)">· 🎯 ${escapeHtml(f['Objetivo'])}</span>`:''}
        ${f['Pedido']?`<span class="badge badge-gray" style="font-size:8px">📦 ${escapeHtml(f['Pedido'])}</span>`:''}
        ${f['Agente']?`<span class="badge badge-gray" style="font-size:8px">${escapeHtml(f['Agente'])}</span>`:''}
      </div>
      <div style="font-size:12px;color:var(--text2);white-space:pre-wrap;line-height:1.5;max-height:120px;overflow:auto">${escapeHtml(copy||'(sin copy)')}</div>
      ${f['Hashtags']?`<div style="font-size:11px;color:var(--accent);margin-top:5px">${escapeHtml(f['Hashtags'])}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${btns.join('')}</div>
      </div>
    </div>`;
  }).join('');
}
const _redesIsImg=url=>/\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(url||'');

async function redesSetEstado(id,estado){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p) return;
  try{
    const fields={'Estado':estado};
    if(estado==='Publicado'&&!p.fields['Fecha publicación']) fields['Fecha publicación']=new Date().toISOString();
    await _redesWrite('Social_Posts','PATCH',id,fields);
    p.fields['Estado']=estado; if(fields['Fecha publicación']) p.fields['Fecha publicación']=fields['Fecha publicación'];
    toast('Estado actualizado ✓','success'); renderRedesKpis(); renderRedesPosts();
  }catch(e){toast('No se pudo actualizar: '+e.message,'error');}
}
// Modal date-picker (promesa → ISO o null). Reemplaza al prompt() crudo.
function redesDatePicker(label,defaultIso){
  return new Promise(resolve=>{
    _redesDateResolve=resolve;
    const d=defaultIso?new Date(defaultIso):(()=>{const x=new Date();x.setDate(x.getDate()+1);x.setHours(18,0,0,0);return x;})();
    const inp=document.getElementById('redesDateInput');
    inp.value=`${d.getFullYear()}-${_redesPad(d.getMonth()+1)}-${_redesPad(d.getDate())}T${_redesPad(d.getHours())}:${_redesPad(d.getMinutes())}`;
    document.getElementById('redesDateLabel').textContent=label||'¿Cuándo publicar?';
    document.getElementById('redesDateModal').style.display='flex';
    setTimeout(()=>inp.focus(),30);
  });
}
function redesDateConfirm(){
  const v=document.getElementById('redesDateInput').value;
  document.getElementById('redesDateModal').style.display='none';
  const r=_redesDateResolve; _redesDateResolve=null;
  if(r){ const dt=v?new Date(v):null; r(dt&&!isNaN(dt.getTime())?dt.toISOString():null); }
}
function redesDateCancel(){
  document.getElementById('redesDateModal').style.display='none';
  const r=_redesDateResolve; _redesDateResolve=null; if(r) r(null);
}
// Programa una publicación CON fecha/hora (sin fecha, Make no sabría cuándo publicar).
async function redesSchedule(id,presetIso){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p) return;
  _redesDateRed=p.fields['Red']||'';
  const iso=presetIso||await redesDatePicker('¿Cuándo publicar este post?',p.fields['Fecha programada']||null);
  if(!iso) return;
  try{
    await _redesWrite('Social_Posts','PATCH',id,{'Estado':'Programado','Fecha programada':iso});
    p.fields['Estado']='Programado'; p.fields['Fecha programada']=iso;
    toast('Programado para '+_redesFmtFecha(iso)+' ✓','success'); renderRedesKpis(); redesApplyFilters();
  }catch(e){toast('No se pudo programar: '+e.message,'error');}
}
function redesCopyPost(id){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p) return;
  const t=[(p.fields['Copy']||p.fields['Texto']||''),p.fields['Hashtags']||''].filter(Boolean).join('\n\n');
  navigator.clipboard.writeText(t).then(()=>toast('Copiado ✓','success')).catch(()=>toast('No se pudo copiar','error'));
}
// ── Vista previa estilo Instagram (marco de teléfono) + contador de caracteres ──
const _REDES_IG_LIMIT=2200;   // límite de caracteres del caption en Instagram
// Render compartido del marco IG (lo usan el preview de un post guardado y el del generador).
function _redesIgOpen(copy,hashtags,media,opts){
  opts=opts||{};
  copy=(copy||'').toString(); hashtags=(hashtags||'').toString(); media=safeHref(media||'');
  const isImg=_redesIsImg(media);
  const total=copy.length+(hashtags?hashtags.length+2:0), over=total>_REDES_IG_LIMIT;
  const mediaHtml=media
    ? (isImg?`<img src="${media}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none';this.parentNode.classList.add('noimg')">`
            :`<div class="ig-vid">🎬<span>video / reel</span></div>`)
    : '';
  const hashHtml=hashtags?`<span class="ig-tags">${escapeHtml(hashtags)}</span>`:'';
  const likes=opts.engagement?`${(+opts.engagement).toLocaleString('es-CL')} Me gusta`:'Le gusta a <b>muchas personas</b>';
  const copyBtn=opts.copyId?`<button class="btn btn-primary btn-sm" style="background:#ec4899;border-color:#ec4899;color:#fff" onclick="redesCopyPost('${opts.copyId}')">📋 Copiar copy</button>`
    :`<button class="btn btn-primary btn-sm" style="background:#ec4899;border-color:#ec4899;color:#fff" onclick="redesIgCopy()">📋 Copiar copy</button>`;
  _redesIgClip=[copy,hashtags].filter(Boolean).join('\n\n');
  const body=document.getElementById('redesIgBody');
  if(body) body.innerHTML=`
    <div class="ig-phone">
      <div class="ig-top">
        <div class="ig-ava">TL</div>
        <div class="ig-user"><b>thelab.solutions</b><span>Santiago, Chile</span></div>
        <span class="ig-more">•••</span>
      </div>
      <div class="ig-media${media&&isImg?'':' noimg'}">${mediaHtml}<span class="ig-media-ph">📷<span>vista previa</span></span></div>
      <div class="ig-actions"><span>♡</span><span>💬</span><span>✈</span><span style="margin-left:auto">🔖</span></div>
      <div class="ig-likes">${likes}</div>
      <div class="ig-caption"><b>thelab.solutions</b> ${escapeHtml(copy)||'<span style="color:var(--text3)">(sin copy)</span>'} ${hashHtml}</div>
      <div class="ig-time">HACE 2 HORAS</div>
    </div>
    <div class="ig-meta">
      <div class="ig-count ${over?'over':''}">${total.toLocaleString('es-CL')} / ${_REDES_IG_LIMIT.toLocaleString('es-CL')} caracteres${over?' · ⚠ supera el límite de Instagram':''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${copyBtn}
        <button class="btn btn-ghost btn-sm" onclick="redesIgClose()">Cerrar</button>
      </div>
    </div>`;
  const m=document.getElementById('redesIgPreviewModal'); if(m) m.style.display='flex';
}
let _redesIgClip='';
function redesIgCopy(){ navigator.clipboard.writeText(_redesIgClip||'').then(()=>toast('Copiado ✓','success')).catch(()=>toast('No se pudo copiar','error')); }
function redesPreviewInsta(id){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p){toast('Post no encontrado','error');return;}
  const f=p.fields;
  _redesIgOpen(f['Copy']||f['Texto']||'', f['Hashtags']||'', f['Media URL']||'', {engagement:f['Engagement']||0, copyId:p.id});
}
// Preview del contenido recién generado (extrae la parte de Instagram si viene multi-red)
function redesPreviewGen(){
  if(!_redesLastGen){toast('Genera contenido primero','error');return;}
  let copy=_redesLastGen, hashtags='';
  const parts=_redesSplitByNetwork(_redesLastGen);
  if(parts){ const ig=parts.find(p=>p.red==='Instagram')||parts[0]; copy=ig.copy; hashtags=ig.hashtags||''; }
  else { const mh=_redesLastGen.match(/HASHTAGS?:\s*([^\n]+)/i); if(mh){ hashtags=mh[1].trim(); copy=_redesLastGen.replace(/HASHTAGS?:\s*[^\n]+/i,'').trim(); } }
  _redesIgOpen(copy,hashtags,_redesLastMedia||'',{});
}
function redesIgClose(){ const m=document.getElementById('redesIgPreviewModal'); if(m) m.style.display='none'; }

// ── Guía in-app: conectar Instagram de verdad vía Make + Airtable ──
function redesConnectGuide(){
  const body=document.getElementById('redesGuideBody');
  const step=(n,t,html)=>`<div class="redes-gstep"><div class="redes-gstep-h"><span class="n">${n}</span><b>${t}</b></div><div class="redes-gstep-b">${html}</div></div>`;
  const tbl=rows=>`<table class="redes-gtable"><tr><th>Campo en Airtable</th><th>De dónde sale (Make)</th></tr>${rows.map(r=>`<tr><td><code>${r[0]}</code></td><td>${r[1]}</td></tr>`).join('')}</table>`;
  if(body) body.innerHTML=`
    <p class="redes-gintro">Todo el módulo se alimenta de 3 tablas de Airtable: <code>Social_Posts</code>, <code>Social_Interactions</code> y <code>Social_Metrics</code>. Con <b>Make</b> (make.com) conectas Instagram a esas tablas. Necesitas una cuenta de Instagram <b>Business o Creator</b> vinculada a una <b>página de Facebook</b>, y conectar tu base de Airtable en Make.</p>
    ${step(1,'Traer comentarios y DMs → bandeja',`
      Crea un escenario en Make: <b>Instagram for Business → “Watch Comments / Mentions”</b> como disparador, y de salida <b>Airtable → “Create a Record”</b> en <code>Social_Interactions</code>.
      ${tbl([['Red',"texto fijo: Instagram"],['Tipo',"Comentario o DM"],['Usuario',"username de quien escribe"],['Mensaje',"texto del comentario"],['Estado',"texto fijo: Pendiente"],['Fecha',"fecha del comentario"]])}
      <div class="redes-gtip">Con eso las interacciones caen en la <b>Bandeja</b> y el COMMUNITY_AGENT sugiere respuesta y detecta leads.</div>`)}
    ${step(2,'Traer métricas → analítica',`
      Escenario <b>programado (1 vez al día)</b>: <b>Instagram → “Get Insights”</b> de tu cuenta/publicaciones → <b>Airtable “Create a Record”</b> en <code>Social_Metrics</code>.
      ${tbl([['Red',"Instagram"],['Fecha',"día de la métrica"],['Alcance',"reach"],['Impresiones',"impressions"],['Engagement',"likes+comentarios+guardados"],['Clics',"clics al perfil/enlace"],['Seguidores nuevos',"follower_count"],['Leads',"0 (o los que atribuyas)"]])}
      <div class="redes-gtip">Alimenta las <b>Métricas</b>, la tendencia de engagement y el <b>mejor momento para publicar</b>.</div>`)}
    ${step(3,'Publicar automático (avanzado, opcional)',`
      Escenario <b>cada 15 min</b>: <b>Airtable “Search Records”</b> en <code>Social_Posts</code> con <code>Estado = Programado</code> y <code>Fecha programada ≤ ahora</code> → <b>Instagram “Create a Post”</b> (usa <code>Media URL</code> + <code>Copy</code> + <code>Hashtags</code>) → <b>Airtable “Update Record”</b> poniendo <code>Estado = Publicado</code>.
      <div class="redes-gtip">⚠ Publicar por API exige permisos de <i>Instagram Content Publishing</i> aprobados por Meta. Mientras tanto, usa el flujo <b>asistido</b>: genera, pulsa <b>👁 Preview</b> y <b>Copiar copy</b>, y publica a mano.</div>`)}
    <p class="redes-gfoot">💡 ¿No tienes Make aún? Puedes trabajar 100% asistido desde hoy: genera contenido con IA, prográmalo en el calendario y publícalo manualmente. Cuando conectes Make, lo ya cargado sigue sirviendo.</p>`;
  const m=document.getElementById('redesGuideModal'); if(m) m.style.display='flex';
}
function redesGuideClose(){ const m=document.getElementById('redesGuideModal'); if(m) m.style.display='none'; }

// ── Vista calendario (grilla mensual + drag&drop para reprogramar) ──
function redesSetView(mode){
  _redesView=mode;
  const list=document.getElementById('redesPostsList'), cal=document.getElementById('redesPostsCal');
  const showCal=(mode==='cal'||mode==='semana');
  if(list) list.style.display=mode==='lista'?'':'none';
  if(cal) cal.style.display=showCal?'':'none';
  document.getElementById('redesBtnLista')?.classList.toggle('active-filter',mode==='lista');
  document.getElementById('redesBtnSem')?.classList.toggle('active-filter',mode==='semana');
  document.getElementById('redesBtnCal')?.classList.toggle('active-filter',mode==='cal');
  if(mode==='semana') renderRedesWeekGrid();
  else if(mode==='cal') renderRedesCalendarGrid();
  else renderRedesPosts();
}
function redesCalNav(delta){
  const b=_redesCalMonth||new Date(); _redesCalMonth=new Date(b.getFullYear(),b.getMonth()+delta,1); renderRedesCalendarGrid();
}
// Refresca la vista activa al cambiar los filtros (lista / semana / calendario).
function redesApplyFilters(){ if(_redesView==='cal') renderRedesCalendarGrid(); else if(_redesView==='semana') renderRedesWeekGrid(); else renderRedesPosts(); }
// ── Feriados, festividades y fechas comerciales de Chile (precargados en el calendario de contenido) ──
let _redesFechasCache={};
function _redesEaster(y){ // computus (Meeus/Jones/Butcher) → Domingo de Pascua
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;
  return new Date(y,mo-1,da);
}
function _redesNthDow(y,m,dow,n){const first=new Date(y,m,1).getDay();const day=1+((dow-first+7)%7)+(n-1)*7;return new Date(y,m,day);} // n-ésimo (1..) día de semana dow (0=dom) del mes m (0-base)
function _redesFechas(year){
  if(_redesFechasCache[year])return _redesFechasCache[year];
  const map={};const add=(dt,label,type,emoji)=>{const k=_redesDayKey(dt);(map[k]=map[k]||[]).push({label,type,emoji});};
  const F='feriado',C='comercial',V='festividad';
  // Feriados legales fijos
  add(new Date(year,0,1),'Año Nuevo',F,'🎉');
  add(new Date(year,4,1),'Día del Trabajo',F,'🛠️');
  add(new Date(year,4,21),'Glorias Navales',F,'⚓');
  add(new Date(year,5,20),'Día de los Pueblos Indígenas',F,'🌅');
  add(new Date(year,5,29),'San Pedro y San Pablo',F,'⛪');
  add(new Date(year,6,16),'Virgen del Carmen',F,'🙏');
  add(new Date(year,7,15),'Asunción de la Virgen',F,'⛪');
  add(new Date(year,8,18),'Independencia Nacional',F,'🇨🇱');
  add(new Date(year,8,19),'Glorias del Ejército',F,'🎖️');
  add(new Date(year,9,12),'Encuentro de Dos Mundos',F,'🌎');
  add(new Date(year,9,31),'Iglesias Evangélicas',F,'⛪');
  add(new Date(year,10,1),'Día de Todos los Santos',F,'🕯️');
  add(new Date(year,11,8),'Inmaculada Concepción',F,'⛪');
  add(new Date(year,11,25),'Navidad',F,'🎄');
  // Semana Santa (calculada)
  const e=_redesEaster(year);
  add(new Date(year,e.getMonth(),e.getDate()-2),'Viernes Santo',F,'✝️');
  add(new Date(year,e.getMonth(),e.getDate()-1),'Sábado Santo',F,'✝️');
  // Festividades / efemérides
  add(new Date(year,2,8),'Día de la Mujer',V,'♀️');
  add(new Date(year,9,16),'Día del Profesor',V,'🍎');
  // Fechas COMERCIALES (las clave para vender)
  add(new Date(year,1,14),'San Valentín',C,'💝');
  add(_redesNthDow(year,4,0,2),'Día de la Madre',C,'🌷');   // 2° domingo de mayo
  add(_redesNthDow(year,5,0,3),'Día del Padre',C,'👔');      // 3er domingo de junio
  add(_redesNthDow(year,7,0,2),'Día del Niño',C,'🧸');       // 2° domingo de agosto (Chile)
  add(new Date(year,8,18),'Fiestas Patrias 🎉',C,'🇨🇱');     // se solapa con feriado, refuerza lo comercial
  add(new Date(year,9,31),'Halloween',C,'🎃');
  const thx=_redesNthDow(year,10,4,4);                        // 4° jueves de noviembre
  const bf=new Date(year,10,thx.getDate()+1); add(bf,'Black Friday',C,'🛍️');
  add(new Date(year,10,bf.getDate()+3),'Cyber Monday',C,'💻');
  add(new Date(year,11,15),'Temporada de graduaciones',C,'🎓'); // medallas/trofeos fin de año
  _redesFechasCache[year]=map;return map;
}
// Clic en una fecha del calendario → pre-llena el generador con una idea para esa ocasión
function redesPlanFecha(label){
  const inp=document.getElementById('redesGenInput');
  if(inp){inp.value=`Contenido para ${label}: idea que conecte un producto de The Lab Solutions (trofeos, medallas, neón, impresión 3D, señalética) con esta fecha, con gancho y llamado a la acción`;inp.focus();inp.scrollIntoView({behavior:'smooth',block:'center'});}
  toast('💡 Idea cargada para '+label+' — ajústala y genera el contenido','info');
}
// ── Detección de huecos: días de los próximos N sin ninguna publicación (ni programada ni publicada) ──
function _redesGaps(days){
  days=days||7; const DAY=86400000, out=[], filled=new Set();
  (state.socialPosts||[]).forEach(p=>{ const e=p.fields['Estado']||p.fields['Estado post']||''; if(e==='Borrador'||e==='En revisión') return;
    const d=p.fields['Fecha programada']||p.fields['Fecha publicación']; if(!d) return; const dt=new Date(d); if(!isNaN(dt)) filled.add(_redesDayKey(dt)); });
  const t0=new Date(); t0.setHours(0,0,0,0);
  for(let i=0;i<days;i++){ const dt=new Date(t0.getTime()+i*DAY); const k=_redesDayKey(dt); if(!filled.has(k)) out.push({key:k,date:dt}); }
  return out;
}
function _redesGapsHtml(){
  const gaps=_redesGaps(7); if(!gaps.length) return '<div class="redes-gaps ok">✅ Tienes contenido programado para los próximos 7 días. ¡Bien ahí!</div>';
  const dias=['dom','lun','mar','mié','jue','vie','sáb'];
  const chips=gaps.map(g=>`<span class="redes-gap-chip" onclick="redesPlanDay('${g.key}')" title="Planificar contenido para este día">${dias[g.date.getDay()]} ${g.date.getDate()}</span>`).join('');
  return `<div class="redes-gaps"><span>📭 <b>${gaps.length}</b> día${gaps.length>1?'s':''} sin publicar en los próximos 7:</span>${chips}</div>`;
}
// Clic en un hueco → pre-llena el generador para ese día (queda listo para generar y programar)
function redesPlanDay(key){
  const dt=new Date(key+'T12:00:00');
  const txt=isNaN(dt)?key:dt.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'});
  const inp=document.getElementById('redesGenInput');
  if(inp){ inp.value=`Post para publicar el ${txt}: destaca un producto o proyecto de The Lab Solutions (neón, impresión 3D, trofeos, señalética) con gancho y llamado a la acción`; inp.focus(); inp.scrollIntoView({behavior:'smooth',block:'center'}); }
  toast('💡 Idea cargada para el '+txt+' — genera el contenido y prográmalo','info');
}
function renderRedesCalendarGrid(){
  const el=document.getElementById('redesPostsCal'); if(!el) return;
  if(!_redesCalMonth){const n=new Date();_redesCalMonth=new Date(n.getFullYear(),n.getMonth(),1);}
  const base=_redesCalMonth, year=base.getFullYear(), month=base.getMonth();
  const fRed=document.getElementById('redesFiltroRed')?.value||'';
  const fEst=document.getElementById('redesFiltroEstado')?.value||'';
  const byDay={};
  (state.socialPosts||[]).forEach(p=>{
    const e=p.fields['Estado']||p.fields['Estado post']||'';
    if((fRed&&p.fields['Red']!==fRed)||(fEst&&e!==fEst)) return;
    const d=p.fields['Fecha programada']||p.fields['Fecha publicación'];if(!d)return;const dt=new Date(d);if(isNaN(dt))return;const k=_redesDayKey(dt);(byDay[k]=byDay[k]||[]).push(p);
  });
  const startDow=(new Date(year,month,1).getDay()+6)%7; // lunes=0
  const dim=new Date(year,month+1,0).getDate();
  const monthName=base.toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  const todayKey=_redesDayKey(new Date());
  const fechas=_redesFechas(year); // feriados/festividades/fechas comerciales
  const _fxCol={feriado:'#ff6b6b',festividad:'#a78bfa',comercial:'#ec4899'};
  let cells='';
  ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>cells+=`<div style="font-size:10px;color:var(--text3);text-align:center;padding:4px 0;font-weight:600">${d}</div>`);
  for(let i=0;i<startDow;i++) cells+='<div></div>';
  for(let day=1;day<=dim;day++){
    const dt=new Date(year,month,day), key=_redesDayKey(dt), lst=byDay[key]||[];
    const fx=fechas[key]||[];
    const fxHtml=fx.map(o=>{const c=_fxCol[o.type]||'#888';return `<div onclick="event.stopPropagation();redesPlanFecha('${(o.label||'').replace(/'/g,'')}')" title="${escapeHtml(o.type.charAt(0).toUpperCase()+o.type.slice(1)+': '+o.label+' — clic para planificar contenido')}" style="font-size:8.5px;font-weight:600;background:${c}1f;color:${c};border-radius:4px;padding:1px 4px;margin-bottom:2px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.emoji} ${escapeHtml(o.label)}</div>`;}).join('');
    const hasFer=fx.some(o=>o.type==='feriado');
    const chips=lst.map(p=>{const f=p.fields,red=f['Red']||'',c=REDES_COLOR[red]||'#888',txt=(f['Copy']||red||'').slice(0,22);
      return `<div class="redes-cal-chip" draggable="true" ondragstart="redesDragStart(event,'${p.id}')" onclick="redesOpenEdit('${p.id}')" title="${escapeHtml((red||'—')+' · '+(f['Estado']||'')+' — clic para editar, arrastra para reprogramar')}" style="font-size:9px;background:${c}22;color:${c};border-left:3px solid ${c};border-radius:5px;padding:2px 5px;margin:2px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(txt)}</div>`;}).join('');
    cells+=`<div class="redes-cal-cell" ondragover="redesAllowDrop(event)" ondrop="redesDropOnDay(event,'${key}')" style="min-height:64px;border:1px solid ${key===todayKey?'var(--accent)':hasFer?'rgba(255,107,107,0.4)':'var(--border)'};border-radius:9px;padding:4px;background:var(--surface2)"><div style="font-size:10px;color:${key===todayKey?'var(--accent)':'var(--text3)'};text-align:right;font-weight:${key===todayKey?'700':'400'}">${day}</div>${fxHtml}${chips}</div>`;
  }
  el.innerHTML=_redesGapsHtml()+`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <button class="btn btn-ghost btn-sm" onclick="redesCalNav(-1)">‹</button>
    <span style="font-size:13px;font-weight:600;text-transform:capitalize">${escapeHtml(monthName)}</span>
    <button class="btn btn-ghost btn-sm" onclick="redesCalNav(1)">›</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">${cells}</div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:10px;color:var(--text3);margin-top:8px">
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#ff6b6b;margin-right:4px"></span>Feriado</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#ec4899;margin-right:4px"></span>Fecha comercial</span>
    <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#a78bfa;margin-right:4px"></span>Festividad</span>
    <span style="margin-left:auto">↔ Arrastra una publicación a otro día · clic en una fecha para planificar contenido</span>
  </div>`;
}
// ── Vista semana: 7 días grandes con las publicaciones de la semana + mejores horas ──
let _redesWeekStart=null;
function redesWeekNav(delta){ const b=_redesWeekStart||_redesMonday(new Date()); _redesWeekStart=new Date(b.getTime()+delta*7*86400000); renderRedesWeekGrid(); }
function _redesMonday(d){ const x=new Date(d); x.setHours(0,0,0,0); const dow=(x.getDay()+6)%7; x.setDate(x.getDate()-dow); return x; }
function renderRedesWeekGrid(){
  const el=document.getElementById('redesPostsCal'); if(!el) return;
  if(!_redesWeekStart) _redesWeekStart=_redesMonday(new Date());
  const start=_redesWeekStart, DAY=86400000;
  const fRed=document.getElementById('redesFiltroRed')?.value||'';
  const fEst=document.getElementById('redesFiltroEstado')?.value||'';
  const byDay={};
  (state.socialPosts||[]).forEach(p=>{ const e=p.fields['Estado']||p.fields['Estado post']||'';
    if((fRed&&p.fields['Red']!==fRed)||(fEst&&e!==fEst)) return;
    const d=p.fields['Fecha programada']||p.fields['Fecha publicación']; if(!d) return; const dt=new Date(d); if(isNaN(dt)) return;
    (byDay[_redesDayKey(dt)]=byDay[_redesDayKey(dt)]||[]).push(p); });
  const todayKey=_redesDayKey(new Date()), year=start.getFullYear(), fechas=_redesFechas(year);
  const dias=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const _fxCol={feriado:'#ff6b6b',festividad:'#a78bfa',comercial:'#ec4899'};
  let cols='';
  for(let i=0;i<7;i++){
    const dt=new Date(start.getTime()+i*DAY), key=_redesDayKey(dt), lst=byDay[key]||[], isToday=key===todayKey;
    const fx=fechas[key]||[];
    const fxHtml=fx.map(o=>{const c=_fxCol[o.type]||'#888';return `<div title="${escapeHtml(o.label)}" style="font-size:8.5px;font-weight:600;background:${c}1f;color:${c};border-radius:4px;padding:1px 5px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.emoji} ${escapeHtml(o.label)}</div>`;}).join('');
    const chips=lst.map(p=>{const f=p.fields,red=f['Red']||'',c=REDES_COLOR[red]||'#888',hh=(()=>{const d=f['Fecha programada']||f['Fecha publicación'];const t=d?new Date(d):null;return t&&!isNaN(t)?_redesPad(t.getHours())+':'+_redesPad(t.getMinutes())+' ':'';})();
      return `<div class="redes-cal-chip" draggable="true" ondragstart="redesDragStart(event,'${p.id}')" onclick="redesOpenEdit('${p.id}')" title="${escapeHtml((red||'—')+' · '+(f['Estado']||'')+' — clic para editar, arrastra para mover')}" style="font-size:10px;background:${c}22;color:${c};border-left:3px solid ${c};border-radius:5px;padding:3px 6px;margin:3px 0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${hh}</b>${escapeHtml((f['Copy']||red||'').slice(0,26))}</div>`;}).join('');
    const empty=lst.length?'':`<div class="redes-week-add" onclick="redesPlanDay('${key}')" title="Planificar contenido para este día">＋ planificar</div>`;
    cols+=`<div class="redes-week-col" ondragover="redesAllowDrop(event)" ondrop="redesDropOnDay(event,'${key}')" style="border:1px solid ${isToday?'var(--accent)':'var(--border)'}">
      <div class="redes-week-hd" style="color:${isToday?'var(--accent)':'var(--text2)'}"><b>${dias[i]}</b> ${dt.getDate()}/${dt.getMonth()+1}</div>
      ${fxHtml}${chips}${empty}</div>`;
  }
  const end=new Date(start.getTime()+6*DAY);
  const rango=`${start.getDate()} ${start.toLocaleDateString('es-CL',{month:'short'})} – ${end.getDate()} ${end.toLocaleDateString('es-CL',{month:'short'})}`;
  el.innerHTML=_redesGapsHtml()+`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <button class="btn btn-ghost btn-sm" onclick="redesWeekNav(-1)">‹</button>
    <span style="font-size:13px;font-weight:600">Semana · ${escapeHtml(rango)}</span>
    <button class="btn btn-ghost btn-sm" onclick="redesWeekNav(1)">›</button>
  </div>
  <div class="redes-week-grid">${cols}</div>
  <div style="font-size:10px;color:var(--text3);margin-top:8px">🕐 Mejor hora sugerida — Instagram ${_redesPad(REDES_BEST_HOUR.Instagram)}:00 · LinkedIn ${_redesPad(REDES_BEST_HOUR.LinkedIn)}:00 · TikTok ${_redesPad(REDES_BEST_HOUR.TikTok)}:00 · ↔ arrastra para mover</div>`;
}
let _redesDragId=null;
function redesDragStart(ev,id){_redesDragId=id;try{ev.dataTransfer.setData('text/plain',id);ev.dataTransfer.effectAllowed='move';}catch(_){}}
function redesAllowDrop(ev){ev.preventDefault();try{ev.dataTransfer.dropEffect='move';}catch(_){}}
async function redesDropOnDay(ev,dayKey){
  ev.preventDefault();
  let id; try{id=ev.dataTransfer.getData('text/plain');}catch(_){}
  id=id||_redesDragId; _redesDragId=null;
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p||!dayKey) return;
  const prev=p.fields['Fecha programada']?new Date(p.fields['Fecha programada']):null;
  const [Y,M,D]=dayKey.split('-').map(Number);
  const dt=new Date(Y,M-1,D,prev?prev.getHours():18,prev?prev.getMinutes():0,0,0);
  await redesSchedule(id,dt.toISOString());
}

// Sentimiento heurístico: prioriza quejas (negativo) en la bandeja.
function _redesSentiment(i){
  const f=i.fields, intent=(f['Intención']||'').toLowerCase();
  if(/soporte|queja|reclamo/.test(intent)) return 'neg';
  const msg=(f['Mensaje']||'').toLowerCase();
  if(/problema|reclamo|p[eé]simo|pesimo|terrible|malo|mala|horrible|estafa|fraude|no lleg|no me lleg|roto|rota|da[ñn]ad|atras|tarde|nunca lleg|enojad|molest|deficiente|denunci|devoluci|no funciona|no sirve/.test(msg)) return 'neg';
  if(/graci|incre[ií]ble|excelente|genial|hermos|encant|🔥|❤|😍|perfect|maravillos|lo mejor|felicit|amo esto|qued[oó] hermos/.test(msg)) return 'pos';
  return 'neu';
}
function renderRedesInbox(){
  const el=document.getElementById('redesInboxList'), cnt=document.getElementById('redesInbCount'); if(!el) return;
  let inter=(state.socialInteractions||[]).slice();
  const pend=inter.filter(i=>(i.fields['Estado']||'Pendiente')==='Pendiente');
  const quejas=pend.filter(i=>_redesSentiment(i)==='neg').length;
  if(cnt) cnt.textContent=pend.length?`${pend.length} pendientes${quejas?` · ⚠ ${quejas} queja${quejas>1?'s':''}`:''}`:'al día';
  if(!inter.length){
    el.innerHTML=`<div class="redes-empty"><span class="ico">💬</span>
      <div>Sin comentarios ni DMs por ahora${state._socialIntErr?' (o falta crear la tabla <code>Social_Interactions</code>)':''}.</div>
      <div>Conecta tus redes vía <b>Make</b> y las interacciones llegarán aquí para responderlas con IA.</div>
    </div>`; return;
  }
  const sv=x=>_redesSentiment(x)==='neg'?0:1;
  inter.sort((a,b)=>{const pa=(a.fields['Estado']||'Pendiente')==='Pendiente'?0:1,pb=(b.fields['Estado']||'Pendiente')==='Pendiente'?0:1;if(pa!==pb)return pa-pb;const sa=sv(a),sb=sv(b);if(sa!==sb)return sa-sb;return new Date(b.fields['Fecha']||b.createdTime||0)-new Date(a.fields['Fecha']||a.createdTime||0);});
  el.innerHTML=inter.map(i=>{
    const f=i.fields, red=f['Red']||'—', estado=f['Estado']||'Pendiente';
    const esLead=f['Es lead']===true||/^s[ií]/i.test(f['Es lead']||'');
    const leadDone=_redesLeadCreated.has(i.id)||f['Lead creado']===true;
    const sent=_redesSentiment(i);
    const sentBadge=sent==='neg'?'<span class="badge badge-red" style="font-size:8px">⚠ queja</span>':sent==='pos'?'<span class="badge badge-green" style="font-size:8px">💚 positivo</span>':'';
    const resp=f['Respuesta sugerida']||'';
    const user=f['Usuario']||'usuario';
    const av=REDES_COLOR[red]||'#888';
    return `<div class="redes-post" style="padding:12px 16px;border-bottom:1px solid var(--border)${sent==='neg'?';border-left:3px solid var(--danger)':''};display:flex;gap:11px">
      <div class="redes-avatar" style="background:linear-gradient(135deg,${av},${av}99)">${escapeHtml((user[0]||'?').toUpperCase())}</div>
      <div style="flex:1;min-width:0">
      <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
        ${_redesChip(red)} <span class="badge badge-gray" style="font-size:8px">${escapeHtml(f['Tipo']||'Comentario')}</span>
        ${estadoBadge(estado)} ${sentBadge} ${esLead?'<span class="badge badge-green" style="font-size:8px">LEAD</span>':''}
        <span style="font-size:11px;color:var(--text2)">@${escapeHtml(user)}</span>
      </div>
      <div style="font-size:12px;color:var(--text);margin-bottom:6px">${escapeHtml(f['Mensaje']||'')}</div>
      ${resp?`<div style="font-size:11px;color:var(--text2);background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:7px 10px;white-space:pre-wrap"><b style="color:var(--accent)">Respuesta sugerida:</b>\n${escapeHtml(resp)}</div>`:''}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="redesReply('${i.id}')">🤖 ${resp?'Regenerar':'Sugerir'} respuesta</button>
        ${resp?`<button class="btn btn-ghost btn-sm" onclick="redesCopyReply('${i.id}')">Copiar</button>`:''}
        ${estado==='Pendiente'?`<button class="btn btn-ghost btn-sm" onclick="redesMarkInteraction('${i.id}','Respondido')">Marcar respondido ✓</button>`:''}
        ${esLead&&!leadDone?`<button class="btn btn-ghost btn-sm" onclick="redesInteractionToLead('${i.id}')">→ Crear lead</button>`:''}
        ${leadDone?'<span class="badge badge-green" style="font-size:8px;align-self:center">✓ Lead creado</span>':''}
      </div>
      </div>
    </div>`;
  }).join('');
}

// Core: pide a COMMUNITY_AGENT la respuesta para una interacción y la persiste. Devuelve true si ok.
async function _redesSuggestReply(i){
  const f=i.fields;
  const cfg=AGENTES_CFG.find(a=>a.id==='COMMUNITY_AGENT'); if(!cfg) throw new Error('Falta COMMUNITY_AGENT');
  const ctx=`Red: ${f['Red']||'—'} · Tipo: ${f['Tipo']||'Comentario'} · Usuario: @${f['Usuario']||'usuario'}\nMensaje recibido: ${f['Mensaje']||''}`;
  const out=await callClaude(cfg.sys,ctx);
  const mResp=out.match(/RESPUESTA_PUBLICA:\s*([\s\S]*?)(?=\n\s*ES_LEAD:|$)/i);
  const mLead=out.match(/ES_LEAD:\s*(s[ií]|no)/i);
  const mInt=out.match(/INTENCION:\s*([^\n]+)/i);
  const resp=(mResp?mResp[1]:out).trim();
  const esLead=mLead?/^s/i.test(mLead[1]):false;
  const fields={'Respuesta sugerida':resp.slice(0,5000),'Es lead':esLead};
  if(mInt) fields['Intención']=mInt[1].trim().slice(0,100);
  await _redesWrite('Social_Interactions','PATCH',i.id,fields);
  Object.assign(i.fields,fields);
  try{AGENT_LOG.add('COMMUNITY_AGENT',ctx,out);}catch(_){}
  return true;
}
async function redesReply(id){
  if(_redesReplyBusy){toast('Espera a que termine la operación en curso','info');return;}
  const i=(state.socialInteractions||[]).find(x=>x.id===id); if(!i) return;
  _redesReplyBusy=true; toast('Generando respuesta…','info');
  try{showAgentWorking('COMMUNITY_AGENT',{verb:'está redactando la respuesta…',messages:['Leyendo el mensaje…','Detectando la intención…','Redactando una respuesta cercana…']});}catch(e){}
  try{ await _redesSuggestReply(i); toast('Respuesta lista ✓','success'); renderRedesKpis(); renderRedesInbox(); }
  catch(e){ toast('Error: '+e.message,'error'); }
  finally{ try{hideAgentWorking();}catch(e){} _redesReplyBusy=false; }
}
// Sugiere respuesta para TODAS las interacciones pendientes sin respuesta (secuencial, para no saturar la API).
async function redesReplyAllPending(){
  if(_redesReplyBusy){toast('Espera a que termine la operación en curso','info');return;}
  const pend=(state.socialInteractions||[]).filter(i=>(i.fields['Estado']||'Pendiente')==='Pendiente' && !((i.fields['Respuesta sugerida']||'').trim()));
  if(!pend.length){toast('No hay pendientes sin respuesta','info');return;}
  _redesReplyBusy=true;
  const btn=document.getElementById('redesInbBulkBtn'); const prev=btn?btn.textContent:'';
  if(btn){btn.disabled=true;}
  try{showAgentWorking('COMMUNITY_AGENT',{verb:`está respondiendo ${pend.length} mensajes…`,messages:['Revisando la bandeja…','Redactando respuestas cercanas…','Detectando posibles leads…']});}catch(e){}
  let ok=0,fail=0;
  for(let k=0;k<pend.length;k++){
    if(btn) btn.textContent=`⏳ ${k+1}/${pend.length}…`;
    try{ await _redesSuggestReply(pend[k]); ok++; }catch(e){ fail++; }
  }
  try{hideAgentWorking();}catch(e){}
  _redesReplyBusy=false;
  if(btn){btn.disabled=false;btn.textContent=prev;}
  renderRedesKpis(); renderRedesInbox();   // un solo re-render al final (antes O(N²) en DOM)
  toast(`Sugeridas ${ok} respuesta${ok!==1?'s':''}${fail?` · ${fail} con error`:''}`, fail?'error':'success');
}
function redesCopyReply(id){
  const i=(state.socialInteractions||[]).find(x=>x.id===id); if(!i) return;
  navigator.clipboard.writeText(i.fields['Respuesta sugerida']||'').then(()=>toast('Copiado ✓','success')).catch(()=>toast('No se pudo copiar','error'));
}
async function redesMarkInteraction(id,estado){
  try{ await _redesWrite('Social_Interactions','PATCH',id,{'Estado':estado});
    const i=(state.socialInteractions||[]).find(x=>x.id===id); if(i) i.fields['Estado']=estado;
    toast('Actualizado ✓','success'); renderRedesKpis(); renderRedesInbox();
  }catch(e){toast('No se pudo actualizar: '+e.message,'error');}
}
async function redesInteractionToLead(id){
  if(_redesLeadCreated.has(id)){toast('Ya creaste el lead para esta interacción','info');return;}
  const i=(state.socialInteractions||[]).find(x=>x.id===id); if(!i) return;
  const f=i.fields;
  try{
    const cli=await _redesWrite('Clientes','POST',null,{
      'Contacto':f['Usuario']||'Lead redes','Empresa':f['Usuario']?('@'+f['Usuario']):'Lead redes sociales',
      'Validado':false,'Origen lead':'Redes sociales',
      'Notas internas':`Lead desde ${f['Red']||'redes'} (${f['Tipo']||'interacción'}):\n"${f['Mensaje']||''}"`
    });
    _redesLeadCreated.add(id);
    // Encola para que LEAD_AGENT lo califique (mismo pipeline desacoplado que web/LinkedIn/Google Ads).
    let encolado=false;
    if(cli&&cli.id){
      try{
        await _redesWrite('Agent_Queue','POST',null,{
          'Evento':'social.lead_received','Entidad':'Cliente','ID entidad':cli.id,
          'Agente':'LEAD_AGENT','Estado':'Pendiente','Prioridad':'Alta',
          'Source':(f['Red']||'redes').toLowerCase(),
          'Input JSON':JSON.stringify({source:'redes',red:f['Red']||'',usuario:f['Usuario']||'',mensaje:f['Mensaje']||'',intencion:f['Intención']||''}),
          'Fecha creación':new Date().toISOString()
        });
        encolado=true;
      }catch(_){}
    }
    await _redesWrite('Social_Interactions','PATCH',id,{'Estado':'Respondido','Lead creado':true});
    if(i){ i.fields['Estado']='Respondido'; i.fields['Lead creado']=true; }
    toast(encolado?'Lead creado y encolado para scoring ✓':'Lead creado en Clientes ✓','success'); renderRedesKpis(); renderRedesInbox();
  }catch(e){toast('No se pudo crear el lead: '+e.message,'error');}
}

function redesQuick(text){
  const inp=document.getElementById('redesGenInput'); if(inp){inp.value=text; inp.focus();}
}
async function redesGenerate(){
  const inp=document.getElementById('redesGenInput'), input=inp?.value.trim();
  if(!input){toast('Escribe un proyecto o idea primero','error');inp?.focus();return;}
  const agentId=document.getElementById('redesGenAgent').value;
  const media=(document.getElementById('redesGenMedia')?.value||'').trim();
  await _redesRunGenerate(agentId,input,media,'');
}
// Genera el post a partir de un pedido entregado real (usa su foto QA como media).
async function redesGenerateFromPedido(){
  const sel=document.getElementById('redesGenPedido'), pid=sel&&sel.value;
  if(!pid){toast('Elige un pedido entregado','error');return;}
  const p=(state.pedidos||[]).find(x=>x.id===pid); if(!p){toast('Pedido no encontrado','error');return;}
  const f=p.fields;
  const cli=typeof resolveClienteName==='function'?resolveClienteName(f['Cliente']):'';
  const detalle=f['Detalle productos']||f['Notas pedido']||f['Material']||'producto personalizado';
  const num=f['N° Pedido']||pid;
  const input=`Pedido entregado ${num}${cli?(' para '+cli):''}: ${detalle}. Crea un post celebrando esta entrega real, mostrando el resultado.`;
  const media=safeHref(f['Foto QA URL']||'')||'';
  const it=document.getElementById('redesGenInput'); if(it) it.value=input;
  const mt=document.getElementById('redesGenMedia'); if(mt) mt.value=media;
  const at=document.getElementById('redesGenAgent'); if(at) at.value='CAPTION_AGENT';
  await _redesRunGenerate('CAPTION_AGENT',input,media,String(num));
}
async function _redesRunGenerate(agentId,input,media,pedidoNum){
  const cfg=AGENTES_CFG.find(a=>a.id===agentId); if(!cfg){toast('Agente no encontrado','error');return;}
  const btn=document.getElementById('redesGenBtn'); if(btn) btn.disabled=true;
  const res=document.getElementById('redesGenResult');
  res.innerHTML='<div style="color:var(--text3);font-size:12px">⏳ Generando contenido…</div>';
  try{showAgentWorking(cfg,{verb:'está creando tu contenido…',messages:['Pensando el ángulo…','Escribiendo el copy…','Sumando hashtags y CTA…','Puliendo el tono…']});}catch(e){}
  try{
    const ctx=state.loaded?buildAgentContext(agentId):'';
    const full=ctx?`${ctx}\n\nCONSULTA: ${cfg.pre}${input}`:`${cfg.pre}${input}`;
    const out=await callClaude(cfg.sys,full);
    _redesLastGen=out; _redesLastAgent=agentId; _redesLastMedia=media||''; _redesLastPedido=pedidoNum||'';
    try{AGENT_LOG.add(cfg.label,input,out);}catch(_){}
    // CAPTION/CONTENT producen contenido por red → guardable (single o split). Estratega/Tendencias = planes.
    const multiNet=['CAPTION_AGENT','CONTENT'].includes(agentId);
    res.innerHTML=`<div class="ai-response" style="white-space:normal">${formatAgentReport(out)}</div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${multiNet?`<button class="btn btn-primary btn-sm" onclick="redesSaveDraft()">💾 Guardar borrador</button>`:''}
        ${multiNet?`<button class="btn btn-ghost btn-sm" onclick="redesSaveSplit()">🗂️ Guardar 1 por red</button>`:''}
        ${multiNet?`<button class="btn btn-ghost btn-sm" onclick="redesPreviewGen()" title="Ver cómo se vería en Instagram">👁 Preview IG</button>`:''}
        <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(_redesLastGen).then(()=>toast('Copiado ✓','success'))">Copiar todo</button>
        ${multiNet?'':'<span style="font-size:10px;color:var(--text3);align-self:center">El Estratega y Tendencias generan planes/ideas — usa Caption o Content para crear posts guardables.</span>'}
      </div>`;
  }catch(e){res.innerHTML=`<div style="color:var(--danger);font-size:12px">❌ ${escapeHtml(e.message)}</div>`;toast('Error: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}}
  if(btn) btn.disabled=false;
}
function _redesBaseFields(agentId){
  const cfg=AGENTES_CFG.find(a=>a.id===agentId);
  const f={'Estado':'Borrador','Agente':cfg?cfg.label:agentId,'Objetivo':'Captar leads'};
  if(_redesLastMedia) f['Media URL']=_redesLastMedia;
  if(_redesLastPedido) f['Pedido']=_redesLastPedido;
  return f;
}
function _redesAfterSave(msg){
  toast(msg,'success'); renderRedesKpis(); redesApplyFilters();
  document.getElementById('redesPostsList')?.scrollIntoView({behavior:'smooth',block:'center'});
}
async function redesSaveDraft(){
  if(!_redesLastGen){toast('Genera contenido primero','error');return;}
  const red=document.getElementById('redesGenRed').value;
  const agentId=_redesLastAgent||document.getElementById('redesGenAgent').value;
  let copy=_redesLastGen, hashtags='';
  const mh=_redesLastGen.match(/HASHTAGS?:\s*([^\n]+)/i);
  if(mh){hashtags=mh[1].trim(); copy=_redesLastGen.replace(/HASHTAGS?:\s*[^\n]+/i,'').trim();}
  try{
    const rec=await _redesWrite('Social_Posts','POST',null,Object.assign(_redesBaseFields(agentId),{'Red':red,'Copy':copy.slice(0,9000),'Hashtags':hashtags.slice(0,1000)}));
    if(rec&&rec.id){ state.socialPosts=state.socialPosts||[]; state.socialPosts.unshift(rec); } else { await redesLoad(); }
    _redesAfterSave('Borrador guardado ✓');
  }catch(e){toast('No se pudo guardar (¿existe la tabla Social_Posts?): '+e.message,'error');}
}
// Separa la salida de CAPTION/CONTENT (varias redes en un bloque) en secciones por red.
function _redesSplitByNetwork(text){
  // Encabezados anclados al inicio de la línea (tras limpiar markdown/viñetas) → evita falsos positivos.
  const nets=[{key:'Instagram',re:/^instagram\b/i},{key:'LinkedIn',re:/^linked\s?in\b/i},{key:'TikTok',re:/^(tik\s?tok|reels?)\b/i},{key:'Facebook',re:/^facebook\b/i}];
  const lines=String(text).split('\n'); const marks=[];
  lines.forEach((ln,idx)=>{const t=ln.replace(/[*_#>]/g,'').replace(/^[\s\-•·\d.\)]+/,'').trim();if(!t||t.length>40)return;for(const n of nets){if(n.re.test(t)){marks.push({idx,key:n.key});break;}}});
  if(marks.length<2) return null;
  const seen={}, out=[];
  for(let i=0;i<marks.length;i++){
    if(seen[marks[i].key]) continue;
    const start=marks[i].idx+1, end=i+1<marks.length?marks[i+1].idx:lines.length;
    let body=lines.slice(start,end).join('\n').trim(); let hashtags='';
    const mh=body.match(/HASHTAGS?:\s*([^\n]+)/i);
    if(mh){hashtags=mh[1].trim(); body=body.replace(/HASHTAGS?:\s*[^\n]+/i,'').trim();}
    if(body){ seen[marks[i].key]=true; out.push({red:marks[i].key,copy:body,hashtags}); }
  }
  return out.length?out:null;
}
async function redesSaveSplit(){
  if(!_redesLastGen){toast('Genera contenido primero','error');return;}
  const parts=_redesSplitByNetwork(_redesLastGen);
  if(!parts){toast('No pude separar por red — usa “Guardar borrador”','info');return;}
  const agentId=_redesLastAgent||'CAPTION_AGENT';
  let ok=0;
  for(const part of parts){
    try{
      const rec=await _redesWrite('Social_Posts','POST',null,Object.assign(_redesBaseFields(agentId),{'Red':part.red,'Copy':part.copy.slice(0,9000),'Hashtags':(part.hashtags||'').slice(0,1000)}));
      if(rec&&rec.id){ state.socialPosts=state.socialPosts||[]; state.socialPosts.unshift(rec); ok++; }
    }catch(e){}
  }
  if(ok) _redesAfterSave(`Guardados ${ok} borradores (1 por red) ✓`);
  else toast('No se pudo guardar','error');
}

// ── Métricas de redes + reporte semanal ──
function renderRedesMetrics(){
  const el=document.getElementById('redesMetrics'); if(!el) return;
  const mets=(state.socialMetrics||[]);
  if(!mets.length){ el.innerHTML='<div class="redes-empty"><span class="ico">📊</span><div>Sin métricas todavía.</div><div>Conecta cada red vía <b>Make</b> para ver alcance, engagement, clics y leads por plataforma.</div></div>'; return; }
  const since=new Date(Date.now()-30*86400000);
  const recent=mets.filter(m=>{const d=m.fields['Fecha'];return d&&new Date(d)>=since;});
  const use=recent.length?recent:mets;
  const agg={};
  use.forEach(m=>{const r=m.fields['Red']||'—';const a=agg[r]=agg[r]||{Alcance:0,Engagement:0,Clics:0,Leads:0};a.Alcance+=m.fields['Alcance']||0;a.Engagement+=m.fields['Engagement']||0;a.Clics+=m.fields['Clics']||0;a.Leads+=m.fields['Leads']||0;});
  const nets=Object.keys(agg);
  const maxAlc=Math.max(1,...nets.map(n=>agg[n].Alcance));
  const fmt=n=>n>=1000?(n/1000).toFixed(1).replace(/\.0$/,'')+'k':String(n||0);
  el.innerHTML=`<div style="font-size:10px;color:var(--text3);margin-bottom:10px">${recent.length?'Últimos 30 días':'Histórico'} · ${use.length} registros</div>`+
    _redesEngTrend(use)+
    nets.map(n=>{const a=agg[n],c=REDES_COLOR[n]||'#888';
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;gap:8px;flex-wrap:wrap"><span style="color:${c};font-weight:600">${escapeHtml(n)}</span><span style="color:var(--text3)">${fmt(a.Alcance)} alcance · ${fmt(a.Engagement)} eng · ${fmt(a.Clics)} clics · <b style="color:var(--text)">${a.Leads} leads</b></span></div>
        <div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.round(a.Alcance/maxAlc*100)}%;background:${c}"></div></div>
      </div>`;}).join('');
}
// Tendencia diaria de engagement (área SVG, sin librerías) — de un vistazo se ve si sube o baja.
function _redesEngTrend(mets){
  const N=30, DAY=86400000, arr=new Array(N).fill(0);
  const start=new Date(); start.setHours(0,0,0,0); const s0=start.getTime()-(N-1)*DAY;
  (mets||[]).forEach(m=>{ const d=m.fields['Fecha']; if(!d) return; const t=new Date(d); if(isNaN(t)) return;
    t.setHours(0,0,0,0); const idx=Math.round((t.getTime()-s0)/DAY); if(idx>=0&&idx<N) arr[idx]+=+m.fields['Engagement']||0; });
  const tot=arr.reduce((a,b)=>a+b,0); if(!tot) return '';
  const max=Math.max(1,...arr), W=320,H=64,pad=4, bw=(W-pad*2)/(N-1);
  const pts=arr.map((v,i)=>[pad+i*bw, H-4-(v/max)*(H-14)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area=`M${pad} ${H-4} `+pts.map(p=>'L'+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+` L${(pad+(N-1)*bw).toFixed(1)} ${H-4} Z`;
  const last7=arr.slice(-7).reduce((a,b)=>a+b,0), prev7=arr.slice(-14,-7).reduce((a,b)=>a+b,0);
  const delta=prev7>0?Math.round((last7-prev7)/prev7*100):null;
  const trend=delta!=null?`<span style="color:${delta>=0?'var(--success)':'var(--danger)'};font-weight:700">${delta>=0?'▲':'▼'} ${Math.abs(delta)}%</span> vs semana previa`:'';
  return `<div style="margin:2px 0 14px">
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:4px"><span>📈 Engagement diario (30 días)</span><span>${trend}</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:64px;display:block">
      <defs><linearGradient id="redesEngGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ec4899" stop-opacity="0.35"/><stop offset="1" stop-color="#ec4899" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#redesEngGrad)"/>
      <path d="${line}" fill="none" stroke="#ec4899" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg></div>`;
}
function _redesBuildMetricsContext(){
  const mets=(state.socialMetrics||[]), posts=(state.socialPosts||[]), inter=(state.socialInteractions||[]);
  const since=new Date(Date.now()-7*86400000);
  const lines=['=== DATOS DE REDES (últimos 7 días) ==='];
  const agg={};
  mets.filter(m=>{const d=m.fields['Fecha'];return d&&new Date(d)>=since;}).forEach(m=>{const r=m.fields['Red']||'—';const a=agg[r]=agg[r]||{Alcance:0,Impresiones:0,Engagement:0,Clics:0,Seg:0,Leads:0};a.Alcance+=m.fields['Alcance']||0;a.Impresiones+=m.fields['Impresiones']||0;a.Engagement+=m.fields['Engagement']||0;a.Clics+=m.fields['Clics']||0;a.Seg+=m.fields['Seguidores nuevos']||0;a.Leads+=m.fields['Leads']||0;});
  if(Object.keys(agg).length) Object.entries(agg).forEach(([r,a])=>lines.push(`${r}: alcance ${a.Alcance}, impresiones ${a.Impresiones}, engagement ${a.Engagement}, clics ${a.Clics}, seguidores nuevos ${a.Seg}, leads ${a.Leads}`));
  else lines.push('(sin métricas en Social_Metrics esta semana — dilo y propón qué medir y cómo conectarlo)');
  const pubWeek=posts.filter(p=>{const d=p.fields['Fecha publicación']||p.fields['Fecha programada'];return d&&new Date(d)>=since;});
  lines.push(`\nPublicaciones (últimos 7 días): ${pubWeek.length}`);
  pubWeek.slice(0,15).forEach(p=>lines.push(`- [${p.fields['Red']||'—'}] ${(p.fields['Estado']||'')} · ${String(p.fields['Copy']||'').replace(/\n/g,' ').slice(0,70)}`));
  lines.push(`\nInteracciones cargadas: ${inter.length} · Leads detectados: ${inter.filter(i=>i.fields['Es lead']===true).length}`);
  return lines.join('\n');
}
async function redesWeeklyReport(){
  const cfg=AGENTES_CFG.find(a=>a.id==='REPORT_SOCIAL_AGENT'); if(!cfg){toast('Falta REPORT_SOCIAL_AGENT','error');return;}
  const btn=document.getElementById('redesReportBtn'); if(btn) btn.disabled=true;
  const modal=document.getElementById('redesReportModal'), body=document.getElementById('redesReportBody');
  body.innerHTML='<div style="color:var(--text3)">⏳ Generando reporte…</div>'; modal.style.display='flex';
  try{showAgentWorking(cfg,{verb:'está preparando el reporte de redes…',messages:['Revisando métricas de la semana…','Detectando qué funcionó mejor…','Redactando el reporte…']});}catch(e){}
  try{
    const out=await callClaude(cfg.sys,_redesBuildMetricsContext());
    _redesReportText=out;
    body.innerHTML=`<div class="ai-response" style="white-space:normal">${formatAgentReport(out)}</div>`;
    try{AGENT_LOG.add('REPORT_SOCIAL_AGENT','Reporte semanal de redes',out);}catch(_){}
  }catch(e){ body.innerHTML=`<div style="color:var(--danger)">❌ ${escapeHtml(e.message)}</div>`; toast('Error: '+e.message,'error'); }
  finally{try{hideAgentWorking();}catch(e){}}
  if(btn) btn.disabled=false;
}
async function redesEmailReport(){
  if(!_redesReportText){toast('Genera el reporte primero','error');return;}
  if(typeof MAIL==='undefined'||!MAIL.post){toast('Correo no disponible','error');return;}
  const u=(typeof AUTH!=='undefined'&&AUTH.getUser)?AUTH.getUser():null;
  const to=prompt('Enviar reporte a:',(u&&u.email)||'hola@thelab.solutions');
  if(!to) return;
  const btn=document.getElementById('redesReportEmailBtn'); if(btn) btn.disabled=true;
  try{
    const wk=new Date().toLocaleDateString('es-CL');
    const r=await MAIL.post({action:'send',to,subject:`Reporte semanal de redes — ${wk}`,body:escapeHtml(_redesReportText).replace(/\n/g,'<br>'),from_name:'The Lab Solutions'});
    if(r&&!r.error) toast('✓ Reporte enviado','success'); else throw new Error(r&&r.error||'Error desconocido');
  }catch(e){toast('No se pudo enviar: '+e.message,'error');}
  if(btn) btn.disabled=false;
}

// ── NEWSLETTER ─────────────────────────────────────────────────
let _nlLoaded=false, _nlLastGen='', _nlLastParsed=null, _nlLastSegment='', _nlLastInput='', _nlDateResolve=null, _nlEditId=null;
const NL_ESTADO_BADGE={'Borrador':'badge-gray','En revisión':'badge-yellow','Programada':'badge-purple','Enviada':'badge-green'};
const _nlHotTasked=new Set();   // envíos ya convertidos en tarea (anti-duplicado en sesión)
const _nlPad=n=>String(n).padStart(2,'0');
const _nlSet=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
const _nlPct=v=>{if(v==null||v==='')return '';const n=v<=1?v*100:v;return Math.round(n)+'%';};
const _nlMesActual=()=>{const m=new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'});return m.charAt(0).toUpperCase()+m.slice(1);};

function initNewsletter(){
  const mes=document.getElementById('nlGenMes'); if(mes&&!mes.value) mes.value=_nlMesActual();
  nlPopulateSegments();
  if(!_nlLoaded && _redesHasData()) nlLoad();
  else { renderNlKpis(); renderNlCampaigns(); renderNlLeads(); renderNlAudience(); renderNlSubscribers(); }
}

async function nlLoad(force){
  if(!_redesHasData()){toast('Conecta Airtable (token o proxy) en Mi cuenta','error');return;}
  const loadingHTML='<div style="padding:16px;color:var(--text3);font-size:12px">⏳ Cargando…</div>';
  if(force){const ce=document.getElementById('nlCampaignsList');if(ce)ce.innerHTML=loadingHTML;const le=document.getElementById('nlLeadsList');if(le)le.innerHTML=loadingHTML;}
  // Lecturas tolerantes: distingue "tabla no existe" (estado guía) de un error de red (toast).
  state._nlCampErr=false; state._nlEnvErr=false;
  const isMissing=e=>/not ?found|could ?not|no such|table|404|NOT_FOUND|invalid permissions|not authorized|403/i.test(String((e&&e.message)||''));
  state.nlCampaigns = await airtableFetch('Newsletter_Campañas',200).then(r=>r.records).catch(e=>{if(isMissing(e))state._nlCampErr=true;else toast('No se pudieron cargar campañas: '+e.message,'error');return [];});
  state.nlEnvios    = await airtableFetch('Newsletter_Envios',1000).then(r=>r.records).catch(e=>{if(isMissing(e))state._nlEnvErr=true;else toast('No se pudieron cargar envíos: '+e.message,'error');return [];});
  _nlLoaded=true;
  nlPopulateSegments(); renderNlKpis(); renderNlCampaigns(); renderNlLeads(); renderNlAudience(); renderNlSubscribers();
}

// Audiencia = clientes del CRM con email y sin baja. "Suscritos" = opt-in explícito.
function _nlAudience(){
  const cli=state.clientes||[];
  const hasEmail=c=>/@/.test(String(c.fields['Email']||''));
  const baja=c=>c.fields['Baja newsletter']===true;
  const reachable=cli.filter(c=>hasEmail(c)&&!baja(c));
  const subs=reachable.filter(c=>c.fields['Suscrito newsletter']===true);
  const byRubro={};
  reachable.forEach(c=>{const r=c.fields['Industria / Rubro']||'Sin rubro';byRubro[r]=(byRubro[r]||0)+1;});
  return {total:cli.length, reachable, subs, byRubro, bajas:cli.filter(baja).length, sinEmail:cli.filter(c=>!hasEmail(c)).length};
}

function nlPopulateSegments(){
  const sel=document.getElementById('nlGenSegment'); if(!sel) return;
  const a=_nlAudience(); const cur=sel.value;
  const rubros=Object.keys(a.byRubro).sort((x,y)=>a.byRubro[y]-a.byRubro[x]);
  sel.innerHTML=`<option value="">Toda la audiencia (${a.reachable.length})</option>`+rubros.map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)} (${a.byRubro[r]})</option>`).join('');
  if(cur) sel.value=cur;
}

function renderNlKpis(){
  const a=_nlAudience();
  const camps=state.nlCampaigns||[], env=state.nlEnvios||[];
  const now=new Date(),m=now.getMonth(),y=now.getFullYear();
  const enviadasMes=camps.filter(c=>{if((c.fields['Estado']||'')!=='Enviada')return false;const d=c.fields['Fecha envío']||c.createdTime;const dt=d?new Date(d):null;return dt&&dt.getMonth()===m&&dt.getFullYear()===y;}).length;
  const borr=camps.filter(c=>(c.fields['Estado']||'Borrador')==='Borrador').length;
  const hot=env.filter(e=>e.fields['Lead caliente']===true);
  const hotPend=hot.filter(e=>e.fields['Tarea creada']!==true&&!_nlHotTasked.has(e.id));
  _nlSet('nlKpiAud',a.reachable.length); _nlSet('nlKpiSub',a.subs.length); _nlSet('nlKpiBorr',borr); _nlSet('nlKpiEnv',enviadasMes); _nlSet('nlKpiHot',hot.length);
  const badge=document.getElementById('badge-newsletter');
  if(badge){if(hotPend.length>0){badge.textContent=hotPend.length;badge.style.display='';}else badge.style.display='none';}
}

// ── Destinatarios del newsletter (suscriptores del CRM: clientes con email + Suscrito newsletter) ──
function _nlSubList(){
  return (state.clientes||[]).filter(c=>/@/.test(String(c.fields['Email']||''))&&c.fields['Suscrito newsletter']===true&&c.fields['Baja newsletter']!==true);
}
function renderNlSubscribers(){
  const el=document.getElementById('nlSubsList'); if(!el) return;
  let subs=_nlSubList();
  const cnt=document.getElementById('nlSubCount'); if(cnt) cnt.textContent=subs.length+' suscrito'+(subs.length!==1?'s':'');
  const q=(document.getElementById('nlSubSearch')?.value||'').trim().toLowerCase();
  if(q) subs=subs.filter(c=>{const f=c.fields;return (String(f['Empresa']||'')+' '+String(f['Contacto']||'')+' '+String(f['Email']||'')).toLowerCase().includes(q);});
  if(!(state.clientes||[]).length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">Carga los clientes (botón ↻ del Overview) para gestionar destinatarios.</div>';return;}
  if(!subs.length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">'+(q?'Ningún destinatario coincide con la búsqueda.':'Aún no hay destinatarios suscritos. Usa “+ Agregar” o suscribe clientes desde su ficha.')+'</div>';return;}
  subs.sort((a,b)=>String(a.fields['Empresa']||a.fields['Contacto']||'').localeCompare(String(b.fields['Empresa']||b.fields['Contacto']||'')));
  el.innerHTML=subs.map(c=>{const f=c.fields;const nom=escapeHtml(f['Empresa']||f['Contacto']||'(sin nombre)');const em=escapeHtml(f['Email']||'');const ru=f['Industria / Rubro']?`<span class="badge badge-gray" style="font-size:8px;margin-left:6px">${escapeHtml(f['Industria / Rubro'])}</span>`:'';
    return `<div style="display:flex;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nom}${ru}</div><div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${em}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="nlSubEditOpen('${c.id}')" title="Editar destinatario">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="nlSubRemove('${c.id}')" title="Quitar de la lista (dar de baja)" style="color:var(--danger)">🚫</button>
    </div>`;}).join('');
}
function nlSubAddOpen(){['nlSubId','nlSubNombre','nlSubEmail','nlSubRubro'].forEach(i=>{const e=document.getElementById(i);if(e)e.value='';});const t=document.getElementById('nlSubModalTitle');if(t)t.textContent='Agregar destinatario';document.getElementById('nlSubModal').style.display='flex';setTimeout(()=>document.getElementById('nlSubEmail')?.focus(),50);}
function nlSubEditOpen(id){const c=(state.clientes||[]).find(x=>x.id===id);if(!c)return;const f=c.fields;document.getElementById('nlSubId').value=id;document.getElementById('nlSubNombre').value=f['Empresa']||f['Contacto']||'';document.getElementById('nlSubEmail').value=f['Email']||'';document.getElementById('nlSubRubro').value=f['Industria / Rubro']||'';document.getElementById('nlSubModalTitle').textContent='Editar destinatario';document.getElementById('nlSubModal').style.display='flex';}
async function nlSubSave(){
  const id=document.getElementById('nlSubId').value;
  const nombre=(document.getElementById('nlSubNombre').value||'').trim();
  const email=(document.getElementById('nlSubEmail').value||'').trim();
  const rubro=(document.getElementById('nlSubRubro').value||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast('Email inválido','error');return;}
  const btn=document.getElementById('nlSubSaveBtn');const prev=btn.textContent;btn.disabled=true;btn.textContent='Guardando…';
  try{
    if(id){
      const fields={'Email':email,'Suscrito newsletter':true,'Baja newsletter':false};
      if(nombre)fields['Empresa']=nombre; if(rubro)fields['Industria / Rubro']=rubro;
      const res=await airtableWrite('Clientes','PATCH',id,fields);
      const c=(state.clientes||[]).find(x=>x.id===id);if(c)Object.assign(c.fields,res.fields||fields);
      toast('Destinatario actualizado ✓','success');
    } else {
      const exist=(state.clientes||[]).find(x=>String(x.fields['Email']||'').toLowerCase()===email.toLowerCase());
      if(exist){
        const fields={'Suscrito newsletter':true,'Baja newsletter':false};if(rubro&&!exist.fields['Industria / Rubro'])fields['Industria / Rubro']=rubro;
        const res=await airtableWrite('Clientes','PATCH',exist.id,fields);Object.assign(exist.fields,res.fields||fields);
        toast('Cliente existente suscrito al newsletter ✓','success');
      } else {
        const fields={'Empresa':nombre||email,'Email':email,'Suscrito newsletter':true,'Validado':false};if(rubro)fields['Industria / Rubro']=rubro;
        const res=await airtableWrite('Clientes','POST',null,fields);
        state.clientes=state.clientes||[];state.clientes.unshift(res);if(state.clientesByIdRec)state.clientesByIdRec[res.id]=res;
        toast('Destinatario agregado ✓','success');
      }
    }
    document.getElementById('nlSubModal').style.display='none';
    renderNlSubscribers();renderNlKpis();nlPopulateSegments();renderNlAudience();
  }catch(e){toast('No se pudo guardar: '+e.message,'error');}
  finally{btn.disabled=false;btn.textContent=prev;}
}
async function nlSubRemove(id){
  const c=(state.clientes||[]).find(x=>x.id===id);if(!c)return;
  const nom=c.fields['Empresa']||c.fields['Contacto']||c.fields['Email']||'este destinatario';
  if(!confirm('¿Quitar a "'+nom+'" de la lista del newsletter?\n\nSe da de baja (no recibirá más campañas), pero el cliente sigue en tu CRM.'))return;
  try{
    const fields={'Suscrito newsletter':false,'Baja newsletter':true};
    const res=await airtableWrite('Clientes','PATCH',id,fields);Object.assign(c.fields,res.fields||fields);
    toast('Quitado de la lista ✓','info');
    renderNlSubscribers();renderNlKpis();nlPopulateSegments();renderNlAudience();
  }catch(e){toast('No se pudo quitar: '+e.message,'error');}
}
// ── Destinatarios POR CAMPAÑA: segmento + incluir/excluir + emails puntuales (guardado local) ──
let _nlDest=null; // estado del modal: {campId, seg, exclude:Set<clientId>, extra:[{nombre,email}]}
function _nlDestKey(id){return 'nl_dest_'+id;}
function _nlGetDest(id){
  try{const j=JSON.parse(localStorage.getItem(_nlDestKey(id))||'null');if(j)return j;}catch(_){}
  const c=(state.nlCampaigns||[]).find(x=>x.id===id);
  return {seg:(c&&c.fields['Segmento objetivo'])?String(c.fields['Segmento objetivo']):'',exclude:[],extra:[]};
}
function _nlBaseDest(seg){let base=_nlSubList();if(seg)base=base.filter(c=>String(c.fields['Industria / Rubro']||'')===seg);return base;}
function _nlDestResolve(seg,exclude,extra){
  const ex=exclude instanceof Set?exclude:new Set(exclude||[]);const out=[],seen=new Set();
  _nlBaseDest(seg).forEach(c=>{if(ex.has(c.id))return;const em=String(c.fields['Email']||'').toLowerCase();if(seen.has(em))return;seen.add(em);out.push({id:c.id,nombre:c.fields['Empresa']||c.fields['Contacto']||em,email:c.fields['Email']});});
  (extra||[]).forEach(e=>{const em=String(e.email||'').toLowerCase();if(!em||seen.has(em))return;seen.add(em);out.push({id:null,nombre:e.nombre||e.email,email:e.email});});
  return out;
}
function nlDestCount(id){const d=_nlGetDest(id);return _nlDestResolve(d.seg,d.exclude,d.extra).length;}
function nlDestOpen(id){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id);if(!c){toast('Campaña no encontrada','error');return;}
  if(!(state.clientes||[]).length){toast('Carga los clientes (↻ del Overview) para gestionar destinatarios','info');return;}
  const d=_nlGetDest(id);
  _nlDest={campId:id,seg:d.seg||'',exclude:new Set(d.exclude||[]),extra:(d.extra||[]).slice()};
  document.getElementById('nlDestCamp').textContent='Asunto: '+(c.fields['Asunto']||c.fields['Campaña']||'(sin asunto)');
  const a=_nlAudience();const rubros=Object.keys(a.byRubro||{}).sort();
  const seg=document.getElementById('nlDestSeg');
  seg.innerHTML='<option value="">Toda la audiencia</option>'+rubros.map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  seg.value=_nlDest.seg;
  document.getElementById('nlDestSearch').value='';document.getElementById('nlDestExtraEmail').value='';
  nlDestRenderList();
  document.getElementById('nlDestModal').style.display='flex';
}
function nlDestSetSeg(v){if(_nlDest){_nlDest.seg=v;nlDestRenderList();}}
function _nlDestWorking(){return _nlDest?_nlDestResolve(_nlDest.seg,_nlDest.exclude,_nlDest.extra):[];}
function _nlDestUpdCount(){const n=_nlDestWorking().length;const el=document.getElementById('nlDestCount');if(el)el.textContent=n+' destinatario'+(n!==1?'s':'')+' seleccionado'+(n!==1?'s':'');}
function nlDestRenderList(){
  if(!_nlDest)return;const el=document.getElementById('nlDestList');if(!el)return;
  const q=(document.getElementById('nlDestSearch')?.value||'').trim().toLowerCase();
  let base=_nlBaseDest(_nlDest.seg);
  if(q)base=base.filter(c=>(String(c.fields['Empresa']||'')+' '+String(c.fields['Contacto']||'')+' '+String(c.fields['Email']||'')).toLowerCase().includes(q));
  base.sort((a,b)=>String(a.fields['Empresa']||a.fields['Contacto']||'').localeCompare(String(b.fields['Empresa']||b.fields['Contacto']||'')));
  let html=base.map(c=>{const inc=!_nlDest.exclude.has(c.id);const nom=escapeHtml(c.fields['Empresa']||c.fields['Contacto']||'(sin nombre)');const em=escapeHtml(c.fields['Email']||'');
    return `<label style="display:flex;align-items:center;gap:9px;padding:7px 18px;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" ${inc?'checked':''} onchange="nlDestToggle('${c.id}',this.checked)">
      <div style="flex:1;min-width:0"><div style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nom}</div><div style="font-size:10px;color:var(--text3)">${em}</div></div>
    </label>`;}).join('');
  if(_nlDest.extra.length)html+='<div style="padding:6px 18px;font-size:10px;color:var(--text3);font-weight:600;margin-top:4px">Emails puntuales</div>'+
    _nlDest.extra.map((e,i)=>`<div style="display:flex;align-items:center;gap:9px;padding:7px 18px;border-bottom:1px solid var(--border)"><span style="flex:1;font-size:12px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">✚ ${escapeHtml(e.email)}</span><button class="btn btn-ghost btn-sm" onclick="nlDestRemoveExtra(${i})" style="color:var(--danger)">✕</button></div>`).join('');
  if(!html)html='<div style="padding:16px;color:var(--text3);font-size:12px">Sin destinatarios en este segmento. Agrega emails puntuales o cambia el segmento.</div>';
  el.innerHTML=html;_nlDestUpdCount();
}
function nlDestToggle(id,checked){if(!_nlDest)return;if(checked)_nlDest.exclude.delete(id);else _nlDest.exclude.add(id);_nlDestUpdCount();}
function nlDestAddExtra(){if(!_nlDest)return;const inp=document.getElementById('nlDestExtraEmail');const em=(inp.value||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){toast('Email inválido','error');return;}if(_nlDest.extra.some(e=>e.email.toLowerCase()===em.toLowerCase())){toast('Ya está en la lista','info');inp.value='';return;}_nlDest.extra.push({nombre:em,email:em});inp.value='';nlDestRenderList();}
function nlDestRemoveExtra(i){if(!_nlDest)return;_nlDest.extra.splice(i,1);nlDestRenderList();}
function nlDestSave(close){if(!_nlDest)return;try{localStorage.setItem(_nlDestKey(_nlDest.campId),JSON.stringify({seg:_nlDest.seg,exclude:[..._nlDest.exclude],extra:_nlDest.extra}));}catch(_){}
  toast('Selección de destinatarios guardada ✓','success');renderNlCampaigns();if(close)document.getElementById('nlDestModal').style.display='none';}
async function nlDestSend(){
  if(!_nlDest)return;const list=_nlDestWorking();
  if(!list.length){toast('No hay destinatarios seleccionados','error');return;}
  if(typeof MAIL==='undefined'||!MAIL.post){toast('Correo no disponible','error');return;}
  const c=(state.nlCampaigns||[]).find(x=>x.id===_nlDest.campId);if(!c)return;const f=c.fields;
  if(!confirm(`¿Enviar esta campaña a ${list.length} destinatario(s) REALES ahora?\n\nAsunto: ${f['Asunto']||f['Campaña']||'(sin asunto)'}\n\nCada uno recibe el correo por separado.`))return;
  nlDestSave(false);
  const btn=document.getElementById('nlDestSendBtn');const prev=btn.textContent;btn.disabled=true;
  const body=_nlEmailHtml(f),subject=f['Asunto']||f['Campaña']||'Newsletter';
  let ok=0,fail=0;
  for(let i=0;i<list.length;i++){
    btn.textContent=`Enviando ${i+1}/${list.length}…`;
    try{const r=await MAIL.post({action:'send',to:list[i].email,subject,body,from_name:'The Lab Solutions'});if(r&&!r.error)ok++;else fail++;}catch(_){fail++;}
    await new Promise(r=>setTimeout(r,120));
  }
  btn.disabled=false;btn.textContent=prev;
  try{await _redesWrite('Newsletter_Campañas','PATCH',c.id,{'Estado':'Enviada','Enviados':ok,'Fecha envío':c.fields['Fecha envío']||new Date().toISOString().slice(0,10)});Object.assign(c.fields,{'Estado':'Enviada','Enviados':ok});}catch(_){}
  toast(`✓ Enviado a ${ok}${fail?` · ${fail} con error`:''}`,fail?'info':'success');
  document.getElementById('nlDestModal').style.display='none';renderNlKpis();renderNlCampaigns();
}
function _nlEstBadge(e){return `<span class="badge ${NL_ESTADO_BADGE[e]||'badge-gray'}">${escapeHtml(e||'Borrador')}</span>`;}
function _nlFmtFecha(d){if(!d)return '—';const dt=new Date(d);if(isNaN(dt))return escapeHtml(String(d));return dt.toLocaleDateString('es-CL',{day:'numeric',month:'short',year:'numeric'});}

function renderNlCampaigns(){
  const el=document.getElementById('nlCampaignsList'); if(!el) return;
  let camps=(state.nlCampaigns||[]).slice();
  if(!camps.length){
    el.innerHTML=`<div style="padding:18px;color:var(--text3);font-size:12px;line-height:1.7">
      No hay campañas aún${state._nlCampErr?' (o falta crear la tabla <code>Newsletter_Campañas</code> en Airtable)':''}.
      <br>Redacta una arriba con la IA y pulsa <b>“Guardar borrador”</b> para que aparezca aquí.</div>`; return;
  }
  const fEst=document.getElementById('nlFiltroEstado')?.value||'';
  camps=camps.filter(c=>!fEst||(c.fields['Estado']||'Borrador')===fEst);
  camps.sort((a,b)=>{const da=a.fields['Fecha envío']||a.createdTime||'',db=b.fields['Fecha envío']||b.createdTime||'';return new Date(db)-new Date(da);});
  if(!camps.length){el.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px">Sin campañas con ese filtro.</div>';return;}
  el.innerHTML=camps.map(c=>{
    const f=c.fields, est=f['Estado']||'Borrador';
    const asunto=f['Asunto']||f['Campaña']||'(sin asunto)';
    const cuerpo=(f['Cuerpo (Markdown)']||'').toString();
    const btns=[`<button class="btn btn-ghost btn-sm" onclick="nlPreview('${c.id}')">👁 Vista previa</button>`,`<button class="btn btn-ghost btn-sm" onclick="nlEditOpen('${c.id}')">✏️ Ver/editar</button>`,`<button class="btn btn-ghost btn-sm" onclick="nlDestOpen('${c.id}')">👥 Destinatarios${(state.clientes||[]).length?' ('+nlDestCount(c.id)+')':''}</button>`];
    if(est==='Borrador') btns.push(`<button class="btn btn-ghost btn-sm" onclick="nlSetEstado('${c.id}','En revisión')">Pasar a revisión</button>`);
    if(est==='Borrador'||est==='En revisión') btns.push(`<button class="btn btn-ghost btn-sm" onclick="nlSchedule('${c.id}')">📅 Programar</button>`);
    if(est==='Programada') btns.push(`<button class="btn btn-ghost btn-sm" onclick="nlSchedule('${c.id}')">📅 Reprogramar</button>`);
    if(est!=='Enviada') btns.push(`<button class="btn btn-ghost btn-sm" onclick="nlSetEstado('${c.id}','Enviada')">Marcar enviada ✓</button>`);
    btns.push(`<button class="btn btn-ghost btn-sm" onclick="nlSendTest('${c.id}')">✉ Enviar prueba</button>`);
    const ta=_nlPct(f['Tasa apertura (%)']), tc=_nlPct(f['Tasa click (%)']);
    const metrics = est==='Enviada' ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:var(--text3)">
        <span>📨 ${f['Enviados']||0} enviados</span>
        <span>👁 ${f['Aperturas']||0} aperturas${ta?` (${ta})`:''}</span>
        <span>🔗 ${f['Clicks']||0} clics${tc?` (${tc})`:''}</span>
        ${f['Bajas']?`<span>🚫 ${f['Bajas']} bajas</span>`:''}
      </div>` : '';
    return `<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
        ${_nlEstBadge(est)}
        ${f['Generada por NEWSLETTER_AGENT']?'<span class="badge badge-purple" style="font-size:8px">IA</span>':''}
        ${f['Mes']?`<span style="font-size:10px;color:var(--text3)">🗓 ${escapeHtml(f['Mes'])}</span>`:''}
        ${f['Fecha envío']?`<span style="font-size:10px;color:var(--text3)">· envío ${_nlFmtFecha(f['Fecha envío'])}</span>`:''}
        ${f['Segmento objetivo']?`<span class="badge badge-gray" style="font-size:8px">🎯 ${escapeHtml(String(f['Segmento objetivo']).slice(0,40))}</span>`:''}
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(asunto)}</div>
      ${f['Preheader']?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${escapeHtml(f['Preheader'])}</div>`:''}
      <div style="font-size:12px;color:var(--text2);white-space:pre-wrap;line-height:1.5;max-height:80px;overflow:auto;margin-top:6px">${escapeHtml(cuerpo.slice(0,400))}${cuerpo.length>400?'…':''}</div>
      ${metrics}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${btns.join('')}</div>
    </div>`;
  }).join('');
}

async function nlSetEstado(id,estado){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id); if(!c) return;
  try{
    const fields={'Estado':estado};
    if(estado==='Enviada'&&!c.fields['Fecha envío']) fields['Fecha envío']=new Date().toISOString().slice(0,10);
    await _redesWrite('Newsletter_Campañas','PATCH',id,fields);
    Object.assign(c.fields,fields);
    toast('Estado: '+estado+' ✓','success'); renderNlKpis(); renderNlCampaigns();
  }catch(e){toast('No se pudo actualizar: '+e.message,'error');}
}

// Modal date-picker (promesa → 'YYYY-MM-DD' o null). 'Fecha envío' es tipo date.
function nlDatePicker(defaultDay){
  return new Promise(resolve=>{
    _nlDateResolve=resolve;
    const d=defaultDay?new Date(defaultDay):(()=>{const x=new Date();x.setDate(x.getDate()+1);return x;})();
    document.getElementById('nlDateInput').value=`${d.getFullYear()}-${_nlPad(d.getMonth()+1)}-${_nlPad(d.getDate())}`;
    document.getElementById('nlDateModal').style.display='flex';
  });
}
function nlDateConfirm(){const v=document.getElementById('nlDateInput').value;document.getElementById('nlDateModal').style.display='none';const r=_nlDateResolve;_nlDateResolve=null;if(r)r(v||null);}
function nlDateCancel(){document.getElementById('nlDateModal').style.display='none';const r=_nlDateResolve;_nlDateResolve=null;if(r)r(null);}

async function nlSchedule(id){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id); if(!c) return;
  const day=await nlDatePicker(c.fields['Fecha envío']||null); if(!day) return;
  try{
    await _redesWrite('Newsletter_Campañas','PATCH',id,{'Estado':'Programada','Fecha envío':day});
    c.fields['Estado']='Programada'; c.fields['Fecha envío']=day;
    toast('Programada para el '+_nlFmtFecha(day)+' ✓','success'); renderNlKpis(); renderNlCampaigns();
  }catch(e){toast('No se pudo programar: '+e.message,'error');}
}

// Markdown → HTML (títulos, negritas, listas, links, párrafos). Base para preview, prueba y el "Cuerpo HTML" que envía Make.
function _nlMdToHtml(md){
  const inline=s=>escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" style="color:#00a99d">$1</a>');
  const lines=String(md||'').replace(/\r/g,'').split('\n');
  let html='',inList=false;
  const closeList=()=>{if(inList){html+='</ul>';inList=false;}};
  for(const raw of lines){
    const line=raw.trim();
    if(!line){closeList();continue;}
    let m;
    if(m=line.match(/^###\s+(.+)/)){closeList();html+=`<h3 style="margin:18px 0 6px;font-size:16px">${inline(m[1])}</h3>`;}
    else if(m=line.match(/^##\s+(.+)/)){closeList();html+=`<h2 style="margin:20px 0 8px;font-size:19px">${inline(m[1])}</h2>`;}
    else if(m=line.match(/^#\s+(.+)/)){closeList();html+=`<h2 style="margin:20px 0 8px;font-size:21px">${inline(m[1])}</h2>`;}
    else if(m=line.match(/^[-*•]\s+(.+)/)){if(!inList){html+='<ul style="margin:8px 0;padding-left:20px">';inList=true;}html+=`<li style="margin:3px 0">${inline(m[1])}</li>`;}
    else{closeList();html+=`<p style="margin:0 0 12px">${inline(line)}</p>`;}
  }
  closeList();
  return html||'<p style="color:#999">(sin contenido)</p>';
}
// Envuelve el cuerpo en la plantilla de correo con la marca + pie con baja. Es lo que se guarda en "Cuerpo HTML" y envía Make.
function _nlEmailHtml(f){
  const pre=escapeHtml(f['Preheader']||'');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`+
  `<body style="margin:0;background:#f4f4f5;padding:0">`+
  (pre?`<span style="display:none;max-height:0;overflow:hidden;opacity:0">${pre}</span>`:'')+
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">`+
  `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6e9">`+
  `<tr><td style="background:#0b0b0c;padding:18px 28px"><img src="https://dashboard.thelab.solutions/logo-thelab.png" alt="The Lab Solutions" height="28" style="height:28px;width:auto;max-width:220px;display:block;border:0;outline:none;text-decoration:none" onerror="this.style.display='none';var t=this.parentNode.querySelector('.nl-brand-txt');if(t)t.style.display='inline'"><span class="nl-brand-txt" style="display:none;color:#fff;font-weight:800;font-size:16px;letter-spacing:.04em">THE LAB <span style="color:#00d4cc">SOLUTIONS</span></span></td></tr>`+
  `<tr><td style="padding:28px;font-family:system-ui,Arial,sans-serif;color:#18181b;font-size:15px;line-height:1.65">${_nlMdToHtml(f['Cuerpo (Markdown)']||'')}</td></tr>`+
  `<tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #eee;font-family:system-ui,Arial,sans-serif;color:#9a9aa2;font-size:11px;line-height:1.6">`+
  `The Lab Solutions · Fabricación digital · Las Condes, Santiago, Chile<br>`+
  `Recibes este correo porque te suscribiste en thelab.solutions. <a href="mailto:hola@thelab.solutions?subject=BAJA%20newsletter" style="color:#9a9aa2">Darme de baja</a>.`+
  `</td></tr></table></td></tr></table></body></html>`;
}
function _nlShowPreview(html){
  const m=document.getElementById('nlPreviewModal'), fr=document.getElementById('nlPreviewFrame');
  if(!m||!fr) return;
  fr.srcdoc=html; m.style.display='flex';
}
function nlPreview(id){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id); if(!c){toast('Campaña no encontrada','error');return;}
  _nlShowPreview(_nlEmailHtml(c.fields));
}
function nlPreviewGenerated(){
  if(!_nlLastParsed){toast('Genera contenido primero','error');return;}
  _nlShowPreview(_nlEmailHtml({'Asunto':_nlLastParsed.asunto,'Preheader':_nlLastParsed.preheader,'Cuerpo (Markdown)':_nlLastParsed.cuerpo}));
}
function nlPreviewEdit(){
  _nlShowPreview(_nlEmailHtml({'Asunto':document.getElementById('nlEditAsunto').value,'Preheader':document.getElementById('nlEditPreheader').value,'Cuerpo (Markdown)':document.getElementById('nlEditCuerpo').value}));
}
async function nlSendTest(id){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id); if(!c) return;
  if(typeof MAIL==='undefined'||!MAIL.post){toast('Correo no disponible','error');return;}
  const u=(typeof AUTH!=='undefined'&&AUTH.getUser)?AUTH.getUser():null;
  const to=prompt('Enviar PRUEBA del newsletter a:',(u&&u.email)||'hola@thelab.solutions');
  if(!to) return;
  const f=c.fields;
  try{
    const body=_nlEmailHtml(f);
    const r=await MAIL.post({action:'send',to,subject:'[PRUEBA] '+(f['Asunto']||f['Campaña']||'Newsletter'),body,from_name:'The Lab Solutions'});
    if(r&&!r.error) toast('✓ Prueba enviada a '+to,'success'); else throw new Error(r&&r.error||'Error desconocido');
  }catch(e){toast('No se pudo enviar la prueba: '+e.message,'error');}
}

function nlEditOpen(id){
  const c=(state.nlCampaigns||[]).find(x=>x.id===id); if(!c) return;
  _nlEditId=id;
  document.getElementById('nlEditAsunto').value=c.fields['Asunto']||'';
  document.getElementById('nlEditPreheader').value=c.fields['Preheader']||'';
  document.getElementById('nlEditCuerpo').value=c.fields['Cuerpo (Markdown)']||'';
  document.getElementById('nlEditModal').style.display='flex';
}
async function nlEditSave(){
  if(!_nlEditId) return;
  const c=(state.nlCampaigns||[]).find(x=>x.id===_nlEditId); if(!c) return;
  const fields={'Asunto':document.getElementById('nlEditAsunto').value.slice(0,200),'Preheader':document.getElementById('nlEditPreheader').value.slice(0,200),'Cuerpo (Markdown)':document.getElementById('nlEditCuerpo').value.slice(0,90000)};
  fields['Cuerpo HTML']=_nlEmailHtml(fields).slice(0,99000);
  const btn=document.getElementById('nlEditSaveBtn'); if(btn) btn.disabled=true;
  try{
    await _redesWrite('Newsletter_Campañas','PATCH',_nlEditId,fields);
    Object.assign(c.fields,fields);
    document.getElementById('nlEditModal').style.display='none';
    toast('Cambios guardados ✓','success'); renderNlCampaigns();
  }catch(e){toast('No se pudo guardar: '+e.message,'error');}
  if(btn) btn.disabled=false;
}

function _nlCampName(recId){const c=(state.nlCampaigns||[]).find(x=>x.id===recId);return c?(c.fields['Asunto']||c.fields['Campaña']||''):'';}
function renderNlLeads(){
  const el=document.getElementById('nlLeadsList'), cnt=document.getElementById('nlHotCount'); if(!el) return;
  const hot=(state.nlEnvios||[]).filter(e=>e.fields['Lead caliente']===true);
  if(cnt) cnt.textContent=hot.length?`${hot.length} leads`:'sin leads';
  if(!hot.length){
    el.innerHTML=`<div style="padding:18px;color:var(--text3);font-size:12px;line-height:1.7">
      Aún no hay leads calientes${state._nlEnvErr?' (o falta crear la tabla <code>Newsletter_Envios</code> en Airtable)':''}.
      <br>Cuando un destinatario abra o haga clic, Make lo marca como lead caliente y aquí lo conviertes en tarea para el vendedor.</div>`; return;
  }
  hot.sort((a,b)=>{const pa=(a.fields['Tarea creada']||_nlHotTasked.has(a.id))?1:0,pb=(b.fields['Tarea creada']||_nlHotTasked.has(b.id))?1:0;if(pa!==pb)return pa-pb;return new Date(b.fields['Fecha click']||b.fields['Fecha apertura']||b.createdTime||0)-new Date(a.fields['Fecha click']||a.fields['Fecha apertura']||a.createdTime||0);});
  el.innerHTML=hot.map(e=>{
    const f=e.fields, tasked=f['Tarea creada']===true||_nlHotTasked.has(e.id);
    const camp=Array.isArray(f['Campaña'])&&f['Campaña'].length?_nlCampName(f['Campaña'][0]):'';
    const cliName=Array.isArray(f['Cliente'])&&f['Cliente'].length&&typeof resolveClienteName==='function'?resolveClienteName(f['Cliente']):'';
    return `<div style="padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:5px">
        <span class="badge badge-red" style="font-size:8px">🔥 LEAD CALIENTE</span>
        ${f['Estado']?estadoBadge(f['Estado']):''}
        <span style="font-size:11px;color:var(--text2)">${escapeHtml(f['Email']||'')}</span>
        ${cliName?`<span class="badge badge-gray" style="font-size:8px">${escapeHtml(cliName)}</span>`:''}
        ${f['Rubro']?`<span class="badge badge-gray" style="font-size:8px">${escapeHtml(f['Rubro'])}</span>`:''}
      </div>
      <div style="font-size:11px;color:var(--text3)">${camp?('Campaña: '+escapeHtml(camp)+' · '):''}${f['Fecha click']?('clic '+_nlFmtFecha(f['Fecha click'])):(f['Fecha apertura']?('abrió '+_nlFmtFecha(f['Fecha apertura'])):'')}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${tasked?'<span class="badge badge-green" style="font-size:8px;align-self:center">✓ Tarea creada</span>':`<button class="btn btn-primary btn-sm" onclick="nlLeadToTask('${e.id}')">→ Crear tarea de seguimiento</button>`}
      </div>
    </div>`;
  }).join('');
}

async function nlLeadToTask(id){
  const e=(state.nlEnvios||[]).find(x=>x.id===id); if(!e) return;
  if(e.fields['Tarea creada']===true||_nlHotTasked.has(id)){toast('Ya hay una tarea para este lead','info');return;}
  const f=e.fields;
  const cliId=Array.isArray(f['Cliente'])&&f['Cliente'].length?f['Cliente'][0]:'';
  try{
    await createAgentQueueItem({
      evento:'newsletter.hot_lead', entidad:'Cliente', entidadId:cliId, agente:'FOLLOWUP_AGENT', prioridad:'Alta',
      source:'newsletter',
      input:{source:'newsletter',email:f['Email']||'',campana:_nlCampName((f['Campaña']||[])[0])||'',estado:f['Estado']||'',rubro:f['Rubro']||''}
    });
    try{ await _redesWrite('Newsletter_Envios','PATCH',id,{'Tarea creada':true}); e.fields['Tarea creada']=true; }catch(_){}
    _nlHotTasked.add(id);
    toast('Tarea de seguimiento encolada ✓','success'); renderNlKpis(); renderNlLeads();
  }catch(err){toast('No se pudo crear la tarea: '+err.message,'error');}
}

function renderNlAudience(){
  const el=document.getElementById('nlAudience'); if(!el) return;
  const a=_nlAudience();
  if(!a.reachable.length){
    el.innerHTML='<div style="padding:8px;color:var(--text3);font-size:12px">Sin audiencia cargada. Carga los clientes (botón ↻ del Overview) — tu audiencia son los clientes con email y sin baja.</div>'; return;
  }
  const rubros=Object.keys(a.byRubro).sort((x,y)=>a.byRubro[y]-a.byRubro[x]);
  const max=Math.max(1,...rubros.map(r=>a.byRubro[r]));
  const COLORS=['#7c4dff','#00d4cc','#ec4899','#f59e0b','#22c55e','#3b82f6','#ef4444','#a855f7'];
  el.innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:var(--text3)">
      <span><b style="color:var(--text)">${a.reachable.length}</b> con email</span>
      <span><b style="color:var(--text)">${a.subs.length}</b> suscritos</span>
      <span><b style="color:var(--text)">${a.bajas}</b> bajas</span>
      <span><b style="color:var(--text)">${a.sinEmail}</b> sin email</span>
    </div>`+
    rubros.map((r,i)=>{const c=COLORS[i%COLORS.length],n=a.byRubro[r];
      return `<div style="margin-bottom:9px">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--text2)">${escapeHtml(r)}</span><span style="color:var(--text3)">${n}</span></div>
        <div style="height:6px;background:var(--surface3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.round(n/max*100)}%;background:${c}"></div></div>
      </div>`;}).join('')+
    `<div style="font-size:10px;color:var(--text3);margin-top:10px">El alta de suscriptores desde la web llega vía el Worker (<code>/newsletter</code>) y marca <code>Suscrito newsletter</code> en el cliente.</div>`;
}

function nlQuick(text){const inp=document.getElementById('nlGenInput');if(inp){inp.value=text;inp.focus();}}

function _nlParse(text){
  const mA=text.match(/ASUNTO:\s*([^\n]+)/i);
  const mP=text.match(/PREHEADER:\s*([^\n]+)/i);
  const mC=text.match(/CUERPO:\s*\n?([\s\S]+)$/i);
  return {asunto:(mA?mA[1]:'').trim(), preheader:(mP?mP[1]:'').trim(), cuerpo:(mC?mC[1]:text).trim()};
}
function _nlBuildContext(seg){
  const a=_nlAudience();
  const lines=['=== CONTEXTO NEWSLETTER — THE LAB SOLUTIONS ===',`Fecha: ${new Date().toLocaleDateString('es-CL')}`];
  lines.push(`Audiencia alcanzable (clientes con email): ${a.reachable.length} · suscritos explícitos: ${a.subs.length}`);
  const rubros=Object.keys(a.byRubro).sort((x,y)=>a.byRubro[y]-a.byRubro[x]).slice(0,6);
  if(rubros.length) lines.push('Top rubros de la audiencia: '+rubros.map(r=>`${r} (${a.byRubro[r]})`).join(', '));
  if(seg) lines.push(`SEGMENTO OBJETIVO de esta edición: ${seg} (personaliza para este rubro)`);
  const peds=(state.pedidos||[]).filter(p=>['Despachado','Listo para despacho'].includes(p.fields['Estado pedido']||'')).slice(0,6);
  if(peds.length){
    lines.push('\nTrabajos reales recientes (úsalos como prueba social, sin inventar datos):');
    peds.forEach(p=>{const f=p.fields;const cli=typeof resolveClienteName==='function'?resolveClienteName(f['Cliente']):'';const det=f['Detalle productos']||f['Material']||'';lines.push(`- ${f['N° Pedido']||''}${cli?(' · '+cli):''}${det?(' · '+String(det).slice(0,60)):''}`);});
  }
  return lines.join('\n');
}
async function nlGenerate(){
  const inp=document.getElementById('nlGenInput'),input=inp?.value.trim();
  if(!input){toast('Escribe el tema/objetivo de la edición','error');inp?.focus();return;}
  const cfg=AGENTES_CFG.find(a=>a.id==='NEWSLETTER_AGENT'); if(!cfg){toast('Falta NEWSLETTER_AGENT','error');return;}
  const seg=document.getElementById('nlGenSegment')?.value||'';
  const btn=document.getElementById('nlGenBtn'); if(btn) btn.disabled=true;
  const res=document.getElementById('nlGenResult'); res.innerHTML='<div style="color:var(--text3);font-size:12px">⏳ Redactando newsletter…</div>';
  try{showAgentWorking(cfg,{verb:'está redactando el newsletter…',messages:['Pensando el asunto…','Escribiendo el cuerpo…','Ajustando el tono al segmento…']});}catch(e){}
  try{
    const ctx=_nlBuildContext(seg);
    const full=`${ctx}\n\nCONSULTA: ${cfg.pre}${input}${seg?(' | Segmento: '+seg):''}`;
    const out=await callClaude(cfg.sys,full);
    _nlLastGen=out; _nlLastParsed=_nlParse(out); _nlLastSegment=seg; _nlLastInput=input;
    try{AGENT_LOG.add(cfg.label,input,out);}catch(_){}
    const p=_nlLastParsed;
    res.innerHTML=`<div style="background:var(--surface3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:10px;color:var(--text3)">ASUNTO</div><div style="font-size:13px;font-weight:600;color:var(--text)">${escapeHtml(p.asunto||'—')}</div>
        ${p.preheader?`<div style="font-size:10px;color:var(--text3);margin-top:6px">PREHEADER</div><div style="font-size:12px;color:var(--text2)">${escapeHtml(p.preheader)}</div>`:''}
      </div>
      <div class="ai-response" style="white-space:normal">${formatAgentReport(p.cuerpo||out)}</div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="nlSaveDraft()">💾 Guardar borrador</button>
        <button class="btn btn-ghost btn-sm" onclick="nlPreviewGenerated()">👁 Vista previa</button>
        <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(_nlLastGen).then(()=>toast('Copiado ✓','success'))">Copiar todo</button>
      </div>`;
  }catch(e){res.innerHTML=`<div style="color:var(--danger);font-size:12px">❌ ${escapeHtml(e.message)}</div>`;toast('Error: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}}
  if(btn) btn.disabled=false;
}
async function nlSaveDraft(){
  if(!_nlLastParsed){toast('Genera contenido primero','error');return;}
  const p=_nlLastParsed;
  const mes=(document.getElementById('nlGenMes')?.value||'').trim()||_nlMesActual();
  const fields={'Campaña':`Newsletter ${mes}`,'Mes':mes,'Asunto':(p.asunto||'').slice(0,200),'Preheader':(p.preheader||'').slice(0,200),'Cuerpo (Markdown)':(p.cuerpo||'').slice(0,90000),'Estado':'Borrador','Generada por NEWSLETTER_AGENT':true};
  if(_nlLastSegment) fields['Segmento objetivo']=_nlLastSegment;
  if(_nlLastInput) fields['Notas']='Brief: '+_nlLastInput.slice(0,500);
  fields['Cuerpo HTML']=_nlEmailHtml(fields).slice(0,99000);
  try{
    const rec=await _redesWrite('Newsletter_Campañas','POST',null,fields);
    if(rec&&rec.id){ state.nlCampaigns=state.nlCampaigns||[]; state.nlCampaigns.unshift(rec); } else { await nlLoad(); }
    toast('Borrador guardado ✓','success'); renderNlKpis(); renderNlCampaigns();
    document.getElementById('nlCampaignsList')?.scrollIntoView({behavior:'smooth',block:'center'});
  }catch(e){toast('No se pudo guardar (¿existe la tabla Newsletter_Campañas?): '+e.message,'error');}
}

// ── Mejor momento para publicar (día desde Social_Metrics + hora sugerida por red) ──
function _redesBestByWeekday(){
  const acc={};
  (state.socialMetrics||[]).forEach(m=>{const r=m.fields['Red'],d=m.fields['Fecha'];if(!r||!d)return;const wd=new Date(d).getDay();(acc[r]=acc[r]||[0,0,0,0,0,0,0])[wd]+=m.fields['Engagement']||0;});
  const best={};
  Object.entries(acc).forEach(([r,arr])=>{let bi=-1,bv=-1;arr.forEach((v,i)=>{if(v>bv){bv=v;bi=i;}});if(bv>0)best[r]=bi;});
  return best;
}
function renderRedesBestTimes(){
  const el=document.getElementById('redesBestTimes'); if(!el) return;
  const best=_redesBestByWeekday(), dias=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  el.innerHTML=REDES_NETS.map(n=>{const wd=best[n],hr=REDES_BEST_HOUR[n],c=REDES_COLOR[n];
    const dayTxt=wd!=null?dias[wd]:'<span style="color:var(--text3)">sugerido</span>';
    return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0"><span style="color:${c};font-weight:600">${n}</span><span style="color:var(--text2)">${dayTxt} · ${_redesPad(hr)}:00</span></div>`;
  }).join('')+`<div style="font-size:9px;color:var(--text3);margin-top:6px">Día = mayor engagement en Social_Metrics · Hora = sugerencia por red.</div>`;
}
function _redesNextBestSlot(red){
  const best=_redesBestByWeekday(), hr=REDES_BEST_HOUR[red]||18, targetWd=best[red];
  const now=new Date(), d=new Date(); d.setHours(hr,0,0,0);
  if(targetWd==null){ if(d<=now) d.setDate(d.getDate()+1); }
  else { let add=(targetWd-now.getDay()+7)%7; if(add===0 && d<=now) add=7; d.setDate(d.getDate()+add); }
  return d.toISOString();
}
function redesDateUseBest(){
  const dt=new Date(_redesNextBestSlot(_redesDateRed||'Instagram'));
  const el=document.getElementById('redesDateInput'); if(el) el.value=`${dt.getFullYear()}-${_redesPad(dt.getMonth()+1)}-${_redesPad(dt.getDate())}T${_redesPad(dt.getHours())}:${_redesPad(dt.getMinutes())}`;
}

// ── Programación masiva de borradores ──
async function redesAutoSchedule(){
  const fRed=document.getElementById('redesFiltroRed')?.value||'';
  const drafts=(state.socialPosts||[]).filter(p=>(p.fields['Estado']||'')==='Borrador'&&(!fRed||p.fields['Red']===fRed));
  if(!drafts.length){toast('No hay borradores para programar','info');return;}
  if(!confirm(`¿Auto-programar ${drafts.length} borrador(es), 1 por día desde mañana a la mejor hora por red?`)) return;
  const start=new Date(); start.setHours(0,0,0,0);
  let ok=0;
  for(let i=0;i<drafts.length;i++){
    const p=drafts[i], red=p.fields['Red']||'Instagram', hr=REDES_BEST_HOUR[red]||18;
    const d=new Date(start); d.setDate(d.getDate()+1+i); d.setHours(hr,0,0,0);
    try{ await _redesWrite('Social_Posts','PATCH',p.id,{'Estado':'Programado','Fecha programada':d.toISOString()}); p.fields['Estado']='Programado'; p.fields['Fecha programada']=d.toISOString(); ok++; }catch(e){}
  }
  if(ok){ toast(`Programados ${ok} borradores ✓`,'success'); renderRedesKpis(); redesApplyFilters(); }
  else toast('No se pudo programar','error');
}

// ── Edición inline de una publicación (modal) ──
function redesOpenEdit(id){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p) return;
  _redesEditId=id; const f=p.fields;
  const set=(eid,v)=>{const el=document.getElementById(eid);if(el)el.value=v||'';};
  set('redesEditRed',f['Red']||'Instagram'); set('redesEditEstado',f['Estado']||'Borrador');
  set('redesEditObjetivo',f['Objetivo']); set('redesEditCopy',f['Copy']); set('redesEditHashtags',f['Hashtags']);
  set('redesEditMedia',f['Media URL']); set('redesEditLink',f['Link']);
  const fe=document.getElementById('redesEditFecha');
  if(fe){ if(f['Fecha programada']){const d=new Date(f['Fecha programada']);fe.value=`${d.getFullYear()}-${_redesPad(d.getMonth()+1)}-${_redesPad(d.getDate())}T${_redesPad(d.getHours())}:${_redesPad(d.getMinutes())}`;} else fe.value=''; }
  redesHashPopulate(f['Red']||'Instagram');
  document.getElementById('redesEditModal').style.display='flex';
}
function redesCloseEdit(){ _redesEditId=null; const m=document.getElementById('redesEditModal'); if(m) m.style.display='none'; }
async function redesSaveEdit(){
  if(!_redesEditId) return;
  const p=(state.socialPosts||[]).find(x=>x.id===_redesEditId); if(!p) return;
  const g=eid=>document.getElementById(eid)?.value||'';
  const fields={'Red':g('redesEditRed'),'Estado':g('redesEditEstado'),'Objetivo':g('redesEditObjetivo'),'Copy':g('redesEditCopy').slice(0,9000),'Hashtags':g('redesEditHashtags').slice(0,1000),'Media URL':g('redesEditMedia'),'Link':g('redesEditLink')};
  const feRaw=g('redesEditFecha'); if(feRaw){const d=new Date(feRaw);if(!isNaN(d.getTime()))fields['Fecha programada']=d.toISOString();}
  try{
    await _redesWrite('Social_Posts','PATCH',_redesEditId,fields);
    Object.assign(p.fields,fields);
    toast('Publicación guardada ✓','success'); redesCloseEdit(); renderRedesKpis(); redesApplyFilters(); renderRedesRecycle();
  }catch(e){toast('No se pudo guardar: '+e.message,'error');}
}
async function redesDeletePost(){
  if(!_redesEditId) return;
  if(!confirm('¿Eliminar esta publicación? No se puede deshacer.')) return;
  const id=_redesEditId;
  try{
    await airtableWrite('Social_Posts','DELETE',id,{});
    state.socialPosts=(state.socialPosts||[]).filter(x=>x.id!==id);
    toast('Publicación eliminada','success'); redesCloseEdit(); renderRedesKpis(); redesApplyFilters(); renderRedesRecycle();
  }catch(e){toast('No se pudo eliminar: '+e.message,'error');}
}
function redesBuildUtm(){
  let base=(document.getElementById('redesUtmBase')?.value||'').trim();
  if(!base){toast('Escribe la URL base','error');return;}
  if(!/^https?:\/\//i.test(base)) base='https://'+base;
  const red=(document.getElementById('redesEditRed')?.value||'social').toLowerCase();
  const camp=(document.getElementById('redesEditObjetivo')?.value||'redes').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')||'redes';
  const sep=base.includes('?')?'&':'?';
  const url=`${base}${sep}utm_source=${encodeURIComponent(red)}&utm_medium=social&utm_campaign=${encodeURIComponent(camp)}`;
  const link=document.getElementById('redesEditLink'); if(link) link.value=url;
  toast('Link con UTM generado ✓','success');
}

// ── Biblioteca de hashtags (localStorage, por red) ──
function _redesHashStore(){
  let s; try{ s=JSON.parse(localStorage.getItem('redes_hashtags')||'null'); }catch(_){}
  if(!s) s={Instagram:['#fabricaciondigital #santiago #impresion3d #neonled #disenochile #emprendimiento'],LinkedIn:['#fabricacióndigital #manufactura #b2b #chile'],TikTok:['#fyp #satisfying #impresion3d #neon #diy'],Facebook:['#santiago #pymeschile #regaloscorporativos']};
  return s;
}
function redesHashPopulate(red){
  const sel=document.getElementById('redesEditHashSet'); if(!sel) return;
  const sets=_redesHashStore()[red]||[];
  sel.innerHTML='<option value="">Sets guardados…</option>'+sets.map((h,i)=>`<option value="${i}">${escapeHtml(h.slice(0,40))}${h.length>40?'…':''}</option>`).join('');
}
function redesHashtagInsert(){
  const sel=document.getElementById('redesEditHashSet'); if(!sel||sel.value==='') return;
  const red=document.getElementById('redesEditRed')?.value||'Instagram';
  const h=(_redesHashStore()[red]||[])[+sel.value];
  if(h){ const inp=document.getElementById('redesEditHashtags'); if(inp) inp.value=h; }
  sel.value='';
}
function redesHashtagSave(){
  const red=document.getElementById('redesEditRed')?.value||'Instagram';
  const val=(document.getElementById('redesEditHashtags')?.value||'').trim();
  if(!val){toast('No hay hashtags que guardar','info');return;}
  const store=_redesHashStore(); store[red]=store[red]||[];
  if(!store[red].includes(val)) store[red].unshift(val);
  store[red]=store[red].slice(0,10);
  try{ localStorage.setItem('redes_hashtags',JSON.stringify(store)); }catch(_){}
  redesHashPopulate(red); toast('Set de hashtags guardado ✓','success');
}

// ── Reciclar contenido (top performers publicados) ──
function renderRedesRecycle(){
  const el=document.getElementById('redesRecycle'); if(!el) return;
  const pubs=(state.socialPosts||[]).filter(p=>(p.fields['Estado']||'')==='Publicado');
  if(!pubs.length){ el.innerHTML='<div class="redes-empty"><span class="ico">♻️</span><div>Aún no hay publicaciones <b>Publicadas</b>.</div><div>Cuando las tengas (con engagement desde Make), aquí podrás re-publicar las que mejor rindieron.</div></div>'; return; }
  pubs.sort((a,b)=>(b.fields['Engagement']||0)-(a.fields['Engagement']||0)||new Date(b.fields['Fecha publicación']||b.createdTime||0)-new Date(a.fields['Fecha publicación']||a.createdTime||0));
  el.innerHTML=pubs.slice(0,8).map(p=>{const f=p.fields,red=f['Red']||'—',eng=f['Engagement']||0;
    return `<div class="redes-post" style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:3px">${_redesChip(red)}<span style="font-size:10px;color:var(--text3)">${eng?('💬 '+eng+' interacciones'):'sin métrica'}</span></div>
        <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml((f['Copy']||'').slice(0,80))}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="redesRecycle('${p.id}')" style="white-space:nowrap">♻ Re-publicar</button>
    </div>`;
  }).join('');
}
async function redesRecycle(id){
  const p=(state.socialPosts||[]).find(x=>x.id===id); if(!p) return;
  const f=p.fields;
  try{
    const base={'Red':f['Red']||'Instagram','Copy':(f['Copy']||'').slice(0,9000),'Hashtags':(f['Hashtags']||'').slice(0,1000),'Estado':'Borrador','Agente':'Reciclado','Objetivo':f['Objetivo']||'Captar leads'};
    if(f['Media URL']) base['Media URL']=f['Media URL'];
    if(f['Link']) base['Link']=f['Link'];
    const rec=await _redesWrite('Social_Posts','POST',null,base);
    if(rec&&rec.id){ state.socialPosts.unshift(rec); }
    toast('Copia creada como borrador ✓','success'); renderRedesKpis(); redesApplyFilters();
    document.getElementById('redesPostsList')?.scrollIntoView({behavior:'smooth',block:'center'});
  }catch(e){toast('No se pudo reciclar: '+e.message,'error');}
}
