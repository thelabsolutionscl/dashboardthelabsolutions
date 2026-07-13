/* js/seo-ads.js — módulo extraído de index.html (carga en el mismo punto). */
// ── SEO WORDPRESS ─────────────────────────────────────────────
function getWPConfig(){try{const s=localStorage.getItem('wp_config');if(s) return JSON.parse(s);}catch(e){}return{url:'https://thelab.solutions',user:'',pass:''};}
function saveWPConfig(){
  const url=(document.getElementById('wp-url')?.value||'').trim().replace(/\/$/,'');
  const user=(document.getElementById('wp-user')?.value||'').trim();
  const pass=(document.getElementById('wp-pass')?.value||'').trim();
  if(!url||!user||!pass){toast('Completa todos los campos','error');return;}
  localStorage.setItem('wp_config',JSON.stringify({url,user,pass}));
  toast('✓ Credenciales guardadas','success');
  document.getElementById('wpConfigPanel').style.display='none';
}
function loadWPConfigForm(){
  const cfg=getWPConfig();
  if(cfg.url) document.getElementById('wp-url').value=cfg.url;
  if(cfg.user) document.getElementById('wp-user').value=cfg.user;
  if(cfg.pass) document.getElementById('wp-pass').value=cfg.pass;
}
// ══════════════════════════════════════════════════════════════
// AUDITOR SEO ON-PAGE — analiza las páginas del sitio (Next.js, sin WordPress)
// vía el proxy /seo-fetch (evita CORS; el Worker restringe a thelab.solutions).
// ══════════════════════════════════════════════════════════════
function _seoProxy(){
  const u=localStorage.getItem('proxy_url')||(_DEFAULTS.PROXY_URL.startsWith('%%')?'':_DEFAULTS.PROXY_URL);
  const k=localStorage.getItem('proxy_key')||(_DEFAULTS.PROXY_KEY.startsWith('%%')?'':_DEFAULTS.PROXY_KEY);
  return u&&k?{base:u.replace(/\/$/,''),key:k}:null;
}
async function _seoFetch(pageUrl){
  const p=_seoProxy();
  if(!p) throw new Error('Configura el proxy (Mi cuenta → Proxy) para usar el auditor.');
  const r=await fetch(p.base+'/seo-fetch?url='+encodeURIComponent(pageUrl),{headers:{'X-App-Key':p.key}});
  const d=await r.json().catch(function(){return{};});
  if(!r.ok||!d.ok) throw new Error(d.error||('HTTP '+r.status));
  return d.html||'';
}
async function _seoSitemap(){
  try{
    const xml=await _seoFetch('https://thelab.solutions/sitemap.xml');
    const urls=[].slice.call(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(function(m){return m[1].trim();});
    return Array.from(new Set(urls));
  }catch(e){ return []; }
}
function _seoChip(c){
  const bg=c.level==='ok'?'rgba(46,160,67,0.15)':c.level==='warn'?'rgba(255,193,7,0.15)':'rgba(248,81,73,0.15)';
  const fg=c.level==='ok'?'#2ea043':c.level==='warn'?'#ffc107':'#f85149';
  const ic=c.level==='ok'?'✓':c.level==='warn'?'!':'✕';
  return '<span title="'+String(c.detail||'').replace(/["<>]/g,'')+'" style="display:inline-block;font-size:9.5px;padding:2px 6px;border-radius:5px;margin:2px 3px 2px 0;background:'+bg+';color:'+fg+'">'+ic+' '+c.label+'</span>';
}
function _seoAnalyze(html,pageUrl){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const q=function(s){return doc.querySelector(s);};
  const title=((q('title')&&q('title').textContent)||'').trim();
  const dEl=q('meta[name="description"]'); const desc=((dEl&&dEl.getAttribute('content'))||'').trim();
  const h1s=doc.querySelectorAll('h1');
  const cEl=q('link[rel="canonical"]'); const canonical=(cEl&&cEl.getAttribute('href'))||'';
  const rEl=q('meta[name="robots"]'); const robots=((rEl&&rEl.getAttribute('content'))||'').toLowerCase();
  const ogT=q('meta[property="og:title"]'),ogD=q('meta[property="og:description"]'),ogI=q('meta[property="og:image"]');
  const viewport=q('meta[name="viewport"]');
  const lang=doc.documentElement.getAttribute('lang')||'';
  const imgs=[].slice.call(doc.querySelectorAll('img'));
  const noAlt=imgs.filter(function(i){return !((i.getAttribute('alt')||'').trim());}).length;
  const txt=((doc.body&&doc.body.textContent)||'').replace(/\s+/g,' ').trim();
  const words=txt?txt.split(' ').length:0;
  const checks=[];
  const add=function(ok,warn,label,detail){checks.push({level:ok?'ok':(warn?'warn':'bad'),label:label,detail:detail});};
  add(title.length>=30&&title.length<=65, title.length>0, 'Título', title?(title.length+' car — '+title.slice(0,60)):'FALTA');
  add(desc.length>=110&&desc.length<=165, desc.length>0, 'Meta desc', desc?(desc.length+' car'):'FALTA');
  add(h1s.length===1, h1s.length>1, 'H1', h1s.length+' H1');
  add(!!canonical, false, 'Canonical', canonical?'sí':'FALTA');
  add(!robots.includes('noindex'), false, 'Indexable', robots.includes('noindex')?'NOINDEX':'sí');
  add(!!(ogT&&ogD&&ogI), !!(ogT||ogD||ogI), 'Open Graph', ((ogT?'T':'')+(ogD?'D':'')+(ogI?'I':''))||'FALTA');
  add(!!viewport, false, 'Viewport', viewport?'sí':'FALTA');
  add(!!lang, false, 'Lang', lang||'FALTA');
  add(noAlt===0, noAlt<=2, 'Alt imágenes', noAlt===0?'todas':(noAlt+' sin alt'));
  add(words>=250, words>=120, 'Contenido', words+' palabras');
  const bad=checks.filter(function(c){return c.level==='bad';}).length;
  const warn=checks.filter(function(c){return c.level==='warn';}).length;
  const score=Math.max(0,Math.round(100-(bad*12)-(warn*5)));
  return {url:pageUrl,score:score,checks:checks,bad:bad,warn:warn};
}
async function runSeoAudit(){
  const btn=document.getElementById('seoAuditBtn'),body=document.getElementById('seoAuditBody'),scoreEl=document.getElementById('seoAuditScore');
  if(!_seoProxy()){ toast('Configura el proxy primero (Mi cuenta → Proxy)','error'); return; }
  btn.disabled=true; btn.textContent='Analizando…'; scoreEl.textContent='';
  body.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Leyendo sitemap…</div>';
  let urls=await _seoSitemap();
  if(!urls.length){ urls=['https://thelab.solutions/','https://thelab.solutions/nosotros','https://thelab.solutions/contacto','https://thelab.solutions/servicios','https://thelab.solutions/blog']; }
  urls=urls.slice(0,25);
  const rows=[];
  for(let i=0;i<urls.length;i++){
    body.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Analizando '+(i+1)+'/'+urls.length+'…</div>';
    try{ const html=await _seoFetch(urls[i]); rows.push(_seoAnalyze(html,urls[i])); }
    catch(e){ rows.push({url:urls[i],score:0,checks:[{level:'bad',label:'Error',detail:String(e&&e.message||e)}],bad:1,warn:0}); }
  }
  rows.sort(function(a,b){return a.score-b.score;});
  window._seoLastRows=rows;
  const avg=Math.round(rows.reduce(function(s,r){return s+r.score;},0)/(rows.length||1));
  const withIssues=rows.filter(function(r){return r.bad>0;}).length;
  const col=avg>=80?'#2ea043':avg>=60?'#ffc107':'#f85149';
  scoreEl.innerHTML='Promedio: <strong style="color:'+col+'">'+avg+'/100</strong> · '+withIssues+' con problemas';
  body.innerHTML=rows.map(function(r){
    const path=r.url.replace('https://thelab.solutions','')||'/';
    const c=r.score>=80?'#2ea043':r.score>=60?'#ffc107':'#f85149';
    return '<div style="padding:10px 0;border-bottom:1px solid var(--border2)">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'
      +'<a href="'+r.url+'" target="_blank" style="font-size:12px;color:var(--text);text-decoration:none;font-weight:600">'+path+'</a>'
      +'<span style="font-size:12px;font-weight:700;color:'+c+'">'+r.score+'</span></div>'
      +'<div style="margin-top:5px">'+r.checks.map(_seoChip).join('')+'</div></div>';
  }).join('');
  btn.disabled=false; btn.textContent='Analizar sitio';
  toast('✓ Auditoría SEO completa','success');
}

// ── ✨ Optimizar SEO con IA ──────────────────────────────────────────
// Audita (si hace falta), manda las páginas con problemas a Claude y
// devuelve los textos exactos (título 30-65c, meta 120-158c, alt, OG…).
const SEO_IA_SYS='Eres el SEO senior de The Lab Solutions, estudio B2B de fabricación digital en Santiago de Chile (impresión 3D, letras volumétricas, cartelería y neones, premiaciones y galvanos, merchandising corporativo, activaciones y stands, papelería, cajas personalizadas). Recibes un JSON de páginas con sus problemas SEO. Propón la corrección EXACTA de cada problema. REGLAS DURAS: campo title debe quedar de 30 a 65 caracteres INCLUYENDO el sufijo " · The Lab Solutions" cuando corresponda (todas las páginas menos la home lo llevan — inclúyelo tú en el texto propuesto); campo metaDescription de 120 a 158 caracteres, con la keyword principal de la página y un llamado a la acción; español de Chile, tono profesional B2B, sin emojis. Para problemas de altImagenes, h1, openGraph o contenido, escribe en "propuesto" la corrección concreta (ej: el texto alt sugerido, o qué H1 eliminar). Responde SOLO un JSON válido sin markdown ni texto extra: {"paginas":[{"url":"...","cambios":[{"campo":"title|metaDescription|openGraph|altImagenes|h1|contenido","propuesto":"...","nota":"..."}]}]}';
async function seoOptimizeIA(){
  const btn=document.getElementById('seoIABtn'),out=document.getElementById('seoIAResults');
  btn.disabled=true;btn.textContent='✨ Optimizando…';
  try{showAgentWorking('SEO',{name:'SEO',emoji:'🧭',color:'#ff6b35',verb:'está optimizando tu sitio…',messages:['Auditando las páginas…','Reescribiendo títulos y metas…','Sugiriendo alt y Open Graph…','Puliendo cada propuesta…']});}catch(e){}
  try{
    if(!window._seoLastRows) await runSeoAudit();
    const rows=(window._seoLastRows||[]).filter(function(r){return r.checks&&r.checks.some(function(c){return c.level!=='ok';});});
    if(!rows.length){ toast('✓ El sitio ya está al 100% — nada que optimizar','success'); btn.disabled=false;btn.textContent='✨ Optimizar con IA'; return; }
    out.style.display='block';
    const props=[];
    for(let i=0;i<rows.length;i+=3){
      out.innerHTML='<div class="loading-state" style="padding:14px 0"><div class="spinner"></div> La IA está redactando propuestas… '+Math.min(i+3,rows.length)+'/'+rows.length+' páginas</div>';
      const batch=rows.slice(i,i+3).map(function(r){return {url:r.url,score:r.score,problemas:r.checks.filter(function(c){return c.level!=='ok';}).map(function(c){return c.label+': '+(c.detail||'');})};});
      const raw=await callClaude(SEO_IA_SYS,JSON.stringify(batch));
      const start=raw.indexOf('{');
      if(start<0) throw new Error('la IA no devolvió JSON');
      const j=JSON.parse(raw.slice(start,raw.lastIndexOf('}')+1));
      (j.paginas||[]).forEach(function(p){props.push(p);});
    }
    window._seoIAProps=props;
    renderSeoIAProps(props);
    toast('✓ Propuestas listas — cópialas o baja el informe','success');
  }catch(e){
    out.style.display='block';
    out.innerHTML='<div style="font-size:12px;color:var(--danger)">Error generando propuestas: '+escapeHtml(e.message)+'</div>';
  }
  try{hideAgentWorking();}catch(e){}
  btn.disabled=false;btn.textContent='✨ Optimizar con IA';
}
function renderSeoIAProps(props){
  const out=document.getElementById('seoIAResults');
  const CAMPOS={title:'Título',metaDescription:'Meta description',openGraph:'Open Graph',altImagenes:'Alt de imágenes',h1:'H1',contenido:'Contenido'};
  out.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">'
    +'<div style="font-size:12px;font-weight:700;color:var(--accent)">✨ Propuestas de la IA ('+props.length+' páginas)</div>'
    +'<button class="btn btn-ghost btn-sm" onclick="seoCopyIAReport()" style="font-size:10px">📋 Copiar informe para aplicar</button></div>'
    +'<div style="font-size:10px;color:var(--text3);margin-bottom:8px">Copia el informe y pégaselo a Claude Code con: «aplica este informe SEO al repo de la web» — o copia cada texto y aplícalo a mano.</div>'
    +props.map(function(p,i){
      const path=(p.url||'').replace('https://thelab.solutions','')||'/';
      return '<div style="padding:8px 0;border-top:1px solid var(--border2)"><div style="font-size:12px;font-weight:600;margin-bottom:2px">'+escapeHtml(path)+'</div>'
        +(p.cambios||[]).map(function(c,j){
          const len=(c.propuesto||'').length;
          const esTexto=c.campo==='title'||c.campo==='metaDescription';
          const okLen=c.campo==='title'?(len>=30&&len<=65):(len>=110&&len<=165);
          return '<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:11.5px">'
            +'<span style="flex-shrink:0;min-width:118px;color:var(--text3)">'+(CAMPOS[c.campo]||escapeHtml(c.campo||''))+(esTexto?' <span style="color:'+(okLen?'var(--success)':'var(--warn)')+'">('+len+'c)</span>':'')+'</span>'
            +'<span style="flex:1;color:var(--text);word-break:break-word">'+escapeHtml(c.propuesto||'')+(c.nota?' <span style="color:var(--text3)">— '+escapeHtml(c.nota)+'</span>':'')+'</span>'
            +'<button class="btn btn-ghost btn-sm" style="font-size:9px;padding:1px 7px;flex-shrink:0" onclick="seoCopyProp('+i+','+j+')">Copiar</button></div>';
        }).join('')+'</div>';
    }).join('');
}
function seoCopyProp(i,j){
  const p=(window._seoIAProps||[])[i];const c=p&&p.cambios&&p.cambios[j];
  if(!c)return;
  navigator.clipboard.writeText(c.propuesto||'').then(function(){toast('✓ Copiado','success');}).catch(function(){toast('No se pudo copiar','error');});
}
function seoCopyIAReport(){
  const props=window._seoIAProps||[];
  let md='# Informe SEO — thelab.solutions ('+new Date().toLocaleDateString('es-CL')+')\n\nAplica estos cambios en el repo `thelabsolutionscl/web-thelab-solutions` (metadata/contenido de cada página). Reglas: título 30-65 caracteres, meta description 110-165, OG completo con imagen, todas las imágenes con alt, un solo H1 por página.\n\n';
  props.forEach(function(p){
    md+='## '+p.url+'\n';
    (p.cambios||[]).forEach(function(c){ md+='- **'+c.campo+'**: '+(c.propuesto||'')+(c.nota?'  _('+c.nota+')_':'')+'\n'; });
    md+='\n';
  });
  navigator.clipboard.writeText(md).then(function(){toast('✓ Informe copiado — pégaselo a Claude Code para aplicarlo','success');}).catch(function(){toast('No se pudo copiar','error');});
}

function toggleWPConfig(){
  const p=document.getElementById('wpConfigPanel');
  const visible=p.style.display!=='none';
  p.style.display=visible?'none':'block';
  if(!visible) loadWPConfigForm();
}
function wpAuthHeader(){
  const cfg=getWPConfig();if(!cfg.url) return null;
  return{Authorization:'Basic '+btoa(cfg.user+':'+cfg.pass.replace(/\s/g,'')),'Content-Type':'application/json'};
}
async function testWPConnection(){
  const cfg=getWPConfig();if(!cfg.url){toast('Guarda las credenciales primero','error');return;}
  try{
    const r=await fetch(cfg.url+'/wp-json/wp/v2/users/me',{headers:wpAuthHeader()});
    if(r.ok){const d=await r.json();toast(`✓ Conectado como ${d.name||d.slug}`,'success');}
    else toast(`Error ${r.status}: verifica credenciales`,'error');
  }catch(e){toast('Error de conexión: '+e.message,'error');}
}
async function loadWPPages(){
  const cfg=getWPConfig();
  if(!cfg.url){document.getElementById('wpConfigPanel').style.display='block';loadWPConfigForm();toast('Configura las credenciales primero','info');return;}
  const list=document.getElementById('seoPagesList');
  list.innerHTML='<div style="padding:30px;text-align:center;color:var(--text3)">Cargando páginas...</div>';
  try{
    const h=wpAuthHeader();
    const [pagesRes,postsRes]=await Promise.all([
      fetch(cfg.url+'/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,link,yoast_head_json,meta&status=publish',{headers:h}),
      fetch(cfg.url+'/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,title,link,yoast_head_json,meta&status=publish',{headers:h})
    ]);
    const pages=pagesRes.ok?await pagesRes.json():[];
    const posts=postsRes.ok?await postsRes.json():[];
    if(!pagesRes.ok) toast(`WP páginas: HTTP ${pagesRes.status}`,'error');
    if(!postsRes.ok) toast(`WP posts: HTTP ${postsRes.status}`,'error');
    const all=[...pages.map(p=>({...p,_type:'page'})),...posts.map(p=>({...p,_type:'post'}))];
    if(!all.length){list.innerHTML=`<div class="empty-state">${(!pagesRes.ok||!postsRes.ok)?`Error HTTP ${pagesRes.status} — verifica URL y credenciales WordPress`:'No se encontraron páginas'}</div>`;return;}
    wpPagesCache=all;
    renderSEOList(all);renderWebKPIs(all);
  }catch(e){list.innerHTML=`<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;}
}
function renderSEOList(pages){
  const list=document.getElementById('seoPagesList');
  list.innerHTML=`<div class="card"><div class="card-header"><span class="card-title">Páginas y Posts (${pages.length})</span></div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
  <thead><tr style="border-bottom:2px solid var(--border2)">
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase;white-space:nowrap">Página</th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase">SEO Title <span style="color:var(--text3);font-weight:400">(60 car.)</span></th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase">Meta Description <span style="color:var(--text3);font-weight:400">(155 car.)</span></th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase;white-space:nowrap">Acciones</th>
  </tr></thead><tbody>
  ${pages.map(p=>{
    const yoast=p.yoast_head_json||{};
    const curTitle=yoast.title||p.title?.rendered||'';
    const curDesc=yoast.description||'';
    const pageTitle=p.title?.rendered||p.slug||'—';
    const tid=`seo-title-${p.id}`;const did=`seo-desc-${p.id}`;
    return`<tr data-wpid="${p.id}" data-wptype="${p._type}" style="border-bottom:1px solid var(--border2)">
      <td style="padding:10px;min-width:140px;max-width:200px">
        <div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.3">${escapeHtml(pageTitle)}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px">${p._type==='post'?'Post':'Página'}</div>
        <a href="${escapeHtml(p.link||'#')}" target="_blank" style="font-size:9px;color:var(--accent);text-decoration:none">↗ ver</a>
      </td>
      <td style="padding:10px;min-width:220px">
        <input id="${tid}" value="${escapeHtml(curTitle)}" oninput="seoCounter(this,60,'${tid}-cnt')" style="width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-size:11px;padding:5px 8px;outline:none;font-family:'DM Sans',sans-serif">
        <div id="${tid}-cnt" style="font-size:9px;margin-top:2px;color:${curTitle.length>60?'var(--danger)':'var(--text3)'}">${curTitle.length}/60</div>
      </td>
      <td style="padding:10px;min-width:280px">
        <textarea id="${did}" oninput="seoCounter(this,155,'${did}-cnt')" style="width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:5px;color:var(--text);font-size:11px;padding:5px 8px;outline:none;font-family:'DM Sans',sans-serif;resize:vertical;min-height:52px">${escapeHtml(curDesc)}</textarea>
        <div id="${did}-cnt" style="font-size:9px;margin-top:2px;color:${curDesc.length>155?'var(--danger)':'var(--text3)'}">${curDesc.length}/155</div>
      </td>
      <td style="padding:10px;white-space:nowrap;vertical-align:top">
        <div style="display:flex;flex-direction:column;gap:5px">
          <button onclick="optimizarSEOPage('${p.id}','${escapeHtml(pageTitle)}','${p._type}')" class="btn btn-ghost btn-sm" style="font-size:10px;white-space:nowrap">✨ Optimizar IA</button>
          <button onclick="saveYoastFields('${p.id}','${p._type}','${escapeHtml(p.link||'')}')" class="btn btn-primary btn-sm" style="font-size:10px">💾 Guardar</button>
          <button id="idx-btn-${p.id}" onclick="solicitarIndexacion('${escapeHtml(p.link||'')}')" class="btn btn-ghost btn-sm" style="font-size:10px;display:none;border-color:rgba(0,212,204,0.5);color:var(--accent)"><svg class="dashboard-icon" width="14" height="14" stroke-width="1.5"><use href="#icon-search"/></svg> Indexar en Google</button>
        </div>
      </td>
    </tr>`;
  }).join('')}
  </tbody></table></div></div>`;
}
function seoCounter(el,max,cntId){
  const cnt=document.getElementById(cntId);if(!cnt) return;
  cnt.textContent=el.value.length+'/'+max;
  cnt.style.color=el.value.length>max?'var(--danger)':'var(--text3)';
}
async function optimizarSEOPage(wpId,pageTitle,wpType){
  const tid=`seo-title-${wpId}`;const did=`seo-desc-${wpId}`;
  const curTitle=document.getElementById(tid)?.value||'';
  const curDesc=document.getElementById(did)?.value||'';
  const btn=document.querySelector(`tr[data-wpid="${wpId}"] button`);
  if(btn){btn.disabled=true;btn.textContent='Analizando...';}
  try{showAgentWorking('SEO',{name:'SEO',emoji:'🧭',color:'#ff6b35',verb:'está optimizando la página…',messages:['Analizando el título y la meta…','Reescribiendo con la keyword…','Ajustando a los límites de Google…']});}catch(e){}
  try{
    const system=`Eres un experto en SEO para The Lab Solutions, empresa chilena de impresión 3D, neones y trofeos personalizados ubicada en Santiago de Chile. Tu tarea es optimizar títulos y meta descripciones para Google, enfocados en búsquedas locales chilenas. Siempre responde SOLO con JSON válido, sin markdown.`;
    const user=`Optimiza el SEO de esta página:
Nombre: ${pageTitle}
Tipo: ${wpType==='post'?'blog post':'página web'}
SEO Title actual: ${curTitle||'(vacío)'}
Meta Description actual: ${curDesc||'(vacío)'}

Genera:
- SEO title: máximo 60 caracteres, incluye keyword principal y marca "The Lab Solutions" si cabe
- Meta description: máximo 155 caracteres, persuasiva con beneficio claro y CTA

Responde SOLO en JSON: {"title":"...","description":"..."}`;
    const raw=await callClaude(system,user);
    const json=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(json.title){document.getElementById(tid).value=json.title;seoCounter(document.getElementById(tid),60,tid+'-cnt');}
    if(json.description){document.getElementById(did).value=json.description;seoCounter(document.getElementById(did),155,did+'-cnt');}
    toast('✓ SEO optimizado con IA — revisa y guarda','success');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}}
  if(btn){btn.disabled=false;btn.textContent='✨ Optimizar IA';}
}
async function saveYoastFields(wpId,wpType,pageUrl){
  const cfg=getWPConfig();if(!cfg.url){toast('Configura credenciales primero','error');return;}
  const tid=`seo-title-${wpId}`;const did=`seo-desc-${wpId}`;
  const newTitle=document.getElementById(tid)?.value||'';
  const newDesc=document.getElementById(did)?.value||'';
  const endpoint=cfg.url+`/wp-json/wp/v2/${wpType==='post'?'posts':'pages'}/${wpId}`;
  const btn=document.querySelector(`tr[data-wpid="${wpId}"] .btn-primary`);
  if(btn){btn.disabled=true;btn.textContent='Guardando...';}
  try{
    const r=await fetch(endpoint,{method:'POST',headers:wpAuthHeader(),body:JSON.stringify({meta:{_yoast_wpseo_title:newTitle,_yoast_wpseo_metadesc:newDesc}})});
    if(r.ok){
      // verify the save actually persisted by reading back meta fields
      const vr=await fetch(endpoint+'?_fields=meta',{headers:wpAuthHeader()}).catch(()=>null);
      const vd=vr&&vr.ok?await vr.json().catch(()=>null):null;
      const savedOk=vd&&vd.meta&&(vd.meta._yoast_wpseo_title!==undefined||vd.meta._yoast_wpseo_metadesc!==undefined);
      if(!savedOk){
        // fields not registered — open diagnostic modal
        openSEODiag();
        document.getElementById('seoDiagPhpBox').style.display='block';
        document.getElementById('seoDiagSteps').innerHTML='<div style="color:var(--warn);font-size:12px;font-weight:600">⚠ El SEO no se guardó — los campos Yoast no están registrados en la REST API. Agrega el snippet PHP indicado abajo y luego ejecuta el diagnóstico para verificar.</div>';
        toast('⚠ SEO no guardado — revisa el Diagnóstico SEO','warn');
      } else {
        toast('✓ SEO guardado en WordPress','success');
        const idxBtn=document.getElementById(`idx-btn-${wpId}`);
        if(idxBtn) idxBtn.style.display='block';
      }
    }
    else{const j=await r.json().catch(()=>({}));toast(`Error ${r.status}: ${j.message||'verifica permisos'}`,'error');}
  }catch(e){toast('Error: '+e.message,'error');}
  if(btn){btn.disabled=false;btn.textContent='💾 Guardar';}
}
function openSEODiag(){
  const el=document.getElementById('seoDiagOverlay');
  el.style.display='flex';
  document.getElementById('seoDiagSteps').innerHTML='<div style="color:var(--text3);font-size:12px">Haz clic en "Ejecutar diagnóstico" para comenzar.</div>';
  document.getElementById('seoDiagPhpBox').style.display='none';
}
function closeSEODiag(){document.getElementById('seoDiagOverlay').style.display='none';}
function seoDiagStep(id,icon,label,detail,color){
  const c=document.getElementById('seoDiagSteps');
  let el=document.getElementById('diag-step-'+id);
  if(!el){el=document.createElement('div');el.id='diag-step-'+id;el.style.cssText='display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)';c.appendChild(el);}
  el.innerHTML=`<span style="font-size:16px;min-width:22px;text-align:center">${icon}</span><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:600;color:${color||'var(--text)'}">${label}</div>${detail?`<div style="font-size:11px;color:var(--text3);margin-top:3px;word-break:break-all">${detail}</div>`:''}</div>`;
}
async function runSEODiag(){
  const cfg=getWPConfig();
  const c=document.getElementById('seoDiagSteps');
  c.innerHTML='';
  document.getElementById('seoDiagPhpBox').style.display='none';
  const btn=document.getElementById('seoDiagRunBtn');
  if(btn){btn.disabled=true;btn.textContent='Ejecutando...';}

  // Step 1: check config
  if(!cfg.url||!cfg.user||!cfg.pass){
    seoDiagStep('cfg','❌','Sin credenciales configuradas','Abre "⚙ Configurar WP" y guarda las credenciales.','var(--danger)');
    if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
    return;
  }
  seoDiagStep('cfg','✓',`Credenciales cargadas`,`${cfg.user} @ ${cfg.url}`,'var(--success)');

  // Step 2: connectivity
  seoDiagStep('conn','⏳','Comprobando conexión…','','var(--text3)');
  try{
    const r=await fetch(cfg.url+'/wp-json/wp/v2/users/me',{headers:wpAuthHeader()});
    if(!r.ok){
      const j=await r.json().catch(()=>({}));
      seoDiagStep('conn','❌',`Error de autenticación (HTTP ${r.status})`,j.message||'Verifica usuario y Application Password.','var(--danger)');
      if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
      return;
    }
    const me=await r.json();
    seoDiagStep('conn','✓',`Conectado como: ${me.name||me.slug}`,`Roles: ${(me.roles||[]).join(', ')}`,'var(--success)');
  }catch(e){
    seoDiagStep('conn','❌','Error de red / CORS',`${e.message} — WordPress puede estar bloqueando peticiones externas. Verifica que REST API esté habilitada y no haya plugins de seguridad bloqueando.`,'var(--danger)');
    if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
    return;
  }

  // Step 3a: schema check via OPTIONS
  seoDiagStep('schema','⏳','Verificando esquema REST API (OPTIONS)…','','var(--text3)');
  let schemaHasFields=false;
  try{
    const sr=await fetch(cfg.url+'/wp-json/wp/v2/pages',{method:'OPTIONS',headers:wpAuthHeader()});
    if(sr.ok){
      const sd=await sr.json();
      const metaProps=sd?.schema?.properties?.meta?.properties||sd?.endpoints?.[0]?.args?.meta?.properties||null;
      schemaHasFields=!!(metaProps&&metaProps._yoast_wpseo_title&&metaProps._yoast_wpseo_metadesc);
      if(schemaHasFields){
        seoDiagStep('schema','✓','Esquema registra campos Yoast','_yoast_wpseo_title y _yoast_wpseo_metadesc presentes en el schema','var(--success)');
      } else {
        const schemaKeys=metaProps?Object.keys(metaProps).slice(0,6).join(', '):'(sin propiedades meta en schema)';
        seoDiagStep('schema','❌','Campos Yoast ausentes en el schema REST',`El schema no incluye los campos. Claves meta en schema: ${schemaKeys}. El snippet PHP aún no está activo.`,'var(--danger)');
      }
    } else {
      seoDiagStep('schema','⚠','No se pudo leer el schema (OPTIONS)',`HTTP ${sr.status} — continuando con verificación de datos.`,'var(--warn)');
    }
  }catch(e){
    seoDiagStep('schema','⚠','OPTIONS bloqueado por CORS','El servidor no permite OPTIONS — continuando.','var(--warn)');
  }

  // Step 3b: read meta fields — use cached pages from loadWPPages if available
  seoDiagStep('meta','⏳','Leyendo meta de página real…','','var(--text3)');
  let testPageId=null;
  let diagMeta=null;
  if(wpPagesCache.length>0){
    seoDiagStep('meta-src','ℹ','Usando datos ya cargados',`Cache tiene ${wpPagesCache.length} páginas/posts — sin fetch adicional.`,'var(--text3)');
    // reuse data already fetched by loadWPPages (avoids second CORS request)
    const p=wpPagesCache[0];
    testPageId=p.id;
    diagMeta=p.meta;
  } else {
    try{
      const r=await fetch(cfg.url+'/wp-json/wp/v2/pages?per_page=1&status=publish&_fields=id,slug,meta',{headers:wpAuthHeader()});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const items=await r.json();
      if(!items.length) throw new Error('No hay páginas publicadas en WordPress');
      testPageId=items[0].id;
      diagMeta=items[0].meta;
    }catch(e){
      seoDiagStep('meta','❌','Error al leer meta',`${e.message} — Abre primero la pestaña Web para que el listado de páginas cargue, luego vuelve a ejecutar el diagnóstico.`,'var(--danger)');
      if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
      return;
    }
  }
  {
    const meta=diagMeta;
    const hasTitle=meta&&meta._yoast_wpseo_title!==undefined;
    const hasDesc=meta&&meta._yoast_wpseo_metadesc!==undefined;
    if(hasTitle&&hasDesc){
      seoDiagStep('meta','✓','Campos Yoast registrados correctamente',`_yoast_wpseo_title = "${meta._yoast_wpseo_title||'(vacío)'}" | _yoast_wpseo_metadesc = "${(meta._yoast_wpseo_metadesc||'').slice(0,60)||'(vacío)'}"`,'var(--success)');
    } else {
      const metaKeys=meta?Object.keys(meta):[];
      const rawSnippet=JSON.stringify(meta).slice(0,120);
      const metaDebug=meta
        ?(metaKeys.length?`Claves en meta: ${metaKeys.slice(0,8).join(', ')} | raw: ${rawSnippet}`:'meta existe pero es {} vacío')
        :'meta es null/undefined — WordPress no expone meta en este endpoint';
      seoDiagStep('meta','❌','Campos Yoast NO están en la respuesta',metaDebug,'var(--danger)');
      document.getElementById('seoDiagPhpBox').style.display='block';
      if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
      return;
    }
  }

  // Step 4: write test
  seoDiagStep('write','⏳','Probando escritura de campo SEO…','','var(--text3)');
  try{
    const testVal='__diag_test__';
    const wr=await fetch(cfg.url+`/wp-json/wp/v2/pages/${testPageId}`,{
      method:'POST',headers:wpAuthHeader(),
      body:JSON.stringify({meta:{_yoast_wpseo_title:testVal}})
    });
    if(!wr.ok){const j=await wr.json().catch(()=>({}));throw new Error(`HTTP ${wr.status}: ${j.message||'sin detalle'}`);}
    // verify write persisted
    const vr=await fetch(cfg.url+`/wp-json/wp/v2/pages/${testPageId}`,{headers:wpAuthHeader()});
    const vd=vr.ok?await vr.json():{};
    const written=vd.meta&&vd.meta._yoast_wpseo_title===testVal;
    if(written){
      seoDiagStep('write','✓','Escritura verificada — el guardado SEO funciona','El campo _yoast_wpseo_title se guardó y se leyó correctamente.','var(--success)');
      // restore (optional — leave test value, Yoast will overwrite on next save from WP admin)
      seoDiagStep('done','🎉','Todo listo','Puedes guardar SEO desde el dashboard sin problemas.','var(--accent)');
    } else {
      seoDiagStep('write','⚠','Escritura aceptada pero valor no persistió',`WordPress aceptó el POST (HTTP ${wr.status}) pero el valor leído de vuelta no coincide. Puede ser un cache o un plugin de seguridad.`,'var(--warn)');
    }
  }catch(e){
    seoDiagStep('write','❌','Error al escribir campo SEO',e.message,'var(--danger)');
  }
  if(btn){btn.disabled=false;btn.textContent='▶ Ejecutar diagnóstico';}
}
function copySEODiagSnippet(){
  const code=document.getElementById('seoDiagPhpCode')?.textContent||'';
  navigator.clipboard.writeText(code).then(()=>toast('✓ Código PHP copiado','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=code;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('✓ Código PHP copiado','success');
  });
}
async function testYoastWrite(){openSEODiag();await runSEODiag();}
// ── GOOGLE ADS AGENT ─────────────────────────────────────
// ── Snapshot histórico ──────────────────────────────────
function adsSaveSnapshot(data,days){
  let snaps;try{snaps=JSON.parse(localStorage.getItem('ads_snapshots')||'[]');}catch(e){snaps=[];}
  const today=new Date().toISOString().slice(0,10);
  const imp=data.impresiones||0,clics=data.clics||0,gasto=data.gasto||0;
  const conv=data.conversiones||0;
  const ctr=imp>0?(clics/imp*100):0;
  const roas=gasto>0&&(data.valor_conversion||0)>0?data.valor_conversion/gasto:0;
  // Verdad CRM: ingresos netos + leads del mismo período, para que el agente vea la dirección REAL
  let ingresoCRM=0,leads=0;
  try{
    const cutoff=new Date(Date.now()-days*86400000);
    ingresoCRM=(state.pedidos||[]).filter(p=>{const f=p.fields;if((f['Estado pedido']||'')==='Cancelado')return false;const dd=p.createdTime?new Date(p.createdTime):null;return dd&&dd>=cutoff;}).reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
    leads=(state.clientes||[]).filter(c=>{const dd=c.createdTime?new Date(c.createdTime):null;return dd&&dd>=cutoff;}).length;
  }catch(e){}
  const roasReal=gasto>0?ingresoCRM/gasto:0;
  // Huella por campaña (id→gasto/conv) para detectar anomalías a nivel campaña
  const camps={};(data.campanas||[]).forEach(c=>{if(c&&c.id!=null)camps[c.id]={gasto:c.gasto||0,conv:c.conversiones||0};});
  const snap={date:today,ts:new Date().toISOString(),gasto,clics,conv,roas,imp,ctr,days,ingresoCRM,leads,roasReal,camps};
  const idx=snaps.findIndex(s=>s.date===today);
  if(idx>=0) snaps[idx]=snap; else snaps.push(snap);
  snaps.sort((a,b)=>a.date.localeCompare(b.date));
  if(snaps.length>30) snaps.splice(0,snaps.length-30);
  localStorage.setItem('ads_snapshots',JSON.stringify(snaps));
  localStorage.setItem('ads_last_sync',new Date().toISOString());
}
function adsGetPrevSnapshot(){
  let snaps;try{snaps=JSON.parse(localStorage.getItem('ads_snapshots')||'[]');}catch(e){snaps=[];}
  if(snaps.length<2) return null;
  return snaps[snaps.length-2];
}
function adsLastSyncStr(){
  const ts=localStorage.getItem('ads_last_sync');
  if(!ts) return '';
  const diff=Date.now()-new Date(ts).getTime();
  const mins=Math.floor(diff/60000);
  if(mins<1) return 'actualizado ahora';
  if(mins<60) return 'hace '+mins+' min';
  const hrs=Math.floor(diff/3600000);
  if(hrs<24) return 'hace '+hrs+'h';
  return 'hace '+Math.floor(diff/86400000)+'d';
}
// ── Líneas de producción ↔ campañas Google Ads ───────────
const ADS_DEFAULT_URL='https://thelab.solutions';
// Webhook de Make que crea el "cascarón" de campaña vía la API real de Google
// Ads (con la declaración de anuncios políticos UE que el CSV no puede setear).
// El Script 2 completa la campaña (keywords/RSA/negativas) en su próxima corrida.
const ADS_MAKE_SHELL={url:'https://hook.us2.make.com/4lvyro1ddp3nkqbiwteb1wmg5442dspk',clave:'tl-cascaron-9f27c4a1'};
// id === slug de la landing /servicios/<slug>. finalUrl se arma en openCreateCampaignByLineaId.
const ADS_LINEAS=[
  {id:'activaciones',slug:'activaciones',label:'Activaciones',campañaSugerida:'Búsqueda - Activaciones de Marca',tipo:'SEARCH',presupuesto:6000,
   palabrasClave:['activaciones de marca','activaciones btl','activacion de marca empresa','stands para activacion','activaciones publicitarias','produccion de eventos btl','activacion marca santiago','montaje de activaciones'],
   titulos:['Activaciones de Marca','Activaciones BTL a Medida','Stands y Montajes de Marca','Producción de Activaciones','The Lab Solutions'],
   descripciones:['Activaciones de marca y BTL producidas end-to-end para tu campaña o evento.','Diseño, fabricación y montaje. Cotiza tu activación en Santiago.']},
  {id:'premiaciones',slug:'premiaciones',label:'Premiaciones',campañaSugerida:'Búsqueda - Premiaciones y Galvanos',tipo:'SEARCH',presupuesto:6000,
   palabrasClave:['galvanos personalizados','trofeos personalizados','trofeos corporativos','medallas personalizadas','galvano de reconocimiento','premios para empresa','reconocimientos corporativos','trofeos para premiacion','placa de reconocimiento'],
   titulos:['Galvanos y Trofeos','Premiaciones Corporativas','Trofeos Personalizados','Medallas y Reconocimientos','The Lab Solutions'],
   descripciones:['Galvanos, trofeos y medallas personalizados para premiar a tu equipo.','Fabricación a medida para tu premiación de fin de año. Cotiza online.']},
  {id:'merchandising',slug:'merchandising',label:'Merchandising',campañaSugerida:'Búsqueda - Merchandising Corporativo',tipo:'SEARCH',presupuesto:6000,
   palabrasClave:['merchandising corporativo','regalos corporativos','articulos promocionales','regalos corporativos por mayor','merchandising personalizado','productos promocionales empresa','kit de bienvenida corporativo','regalos para empresas'],
   titulos:['Merchandising Corporativo','Regalos Corporativos','Artículos Promocionales','Kits para Empresas','The Lab Solutions'],
   descripciones:['Merchandising y regalos corporativos personalizados para tu marca.','Kits, artículos promocionales y packs por mayor. Cotiza para tu empresa.']},
  {id:'cajas-personalizadas',slug:'cajas-personalizadas',label:'Cajas Personalizadas',campañaSugerida:'Búsqueda - Cajas y Packaging',tipo:'SEARCH',presupuesto:4000,
   palabrasClave:['cajas personalizadas','packaging personalizado','cajas para packaging','cajas de regalo personalizadas','packaging corporativo','cajas con logo empresa','cajas rigidas personalizadas','packaging a medida'],
   titulos:['Cajas Personalizadas','Packaging a Medida','Cajas con tu Logo','Packaging Corporativo','The Lab Solutions'],
   descripciones:['Cajas y packaging personalizados para regalo o producto corporativo.','Diseño y fabricación de cajas a medida con tu marca. Cotiza online.']},
  {id:'impresion-3d',slug:'impresion-3d',label:'Impresión 3D',campañaSugerida:'Búsqueda - Impresión 3D Santiago',tipo:'SEARCH',presupuesto:8000,
   palabrasClave:['impresión 3d santiago','impresión 3d','servicio de impresion 3d','piezas 3d a medida','prototipo 3d','fabricacion 3d','impresion 3d para empresas','modelos y maquetas 3d','repuestos impresos 3d'],
   titulos:['Impresión 3D en Santiago','Piezas y Prototipos 3D','Impresión 3D a Medida','Fabricación 3D Empresas','The Lab Solutions'],
   descripciones:['Impresión 3D profesional: piezas, prototipos y repuestos a medida.','Llevamos tu idea a una pieza real. Cotiza tu proyecto 3D en Santiago.']},
  {id:'volumetricos',slug:'volumetricos',label:'Volumétricos',campañaSugerida:'Búsqueda - Volumétricos y Neón LED',tipo:'SEARCH',presupuesto:5000,
   palabrasClave:['letras corporeas','letras volumetricas','logo corporeo','letrero neon led','letras 3d para empresa','letreros luminosos led','estructuras para eventos','letras corporeas acrilico','neon personalizado'],
   titulos:['Letras Corpóreas y Neón','Volumétricos a Medida','Letreros Neón LED','Logos Corpóreos 3D','The Lab Solutions'],
   descripciones:['Letras corpóreas, logos 3D y neón LED personalizados para tu marca.','Volumétricos y estructuras para oficina o evento. Cotiza a medida.']},
  {id:'carteleria',slug:'carteleria',label:'Cartelería',campañaSugerida:'Búsqueda - Cartelería y Señalética',tipo:'SEARCH',presupuesto:6000,
   palabrasClave:['señaletica corporativa','señaletica acrilico','letrero acrilico','carteleria empresa','señalizacion empresa','rotulos corporativos','corte y grabado laser','placas acrilico','letreros para oficina'],
   titulos:['Cartelería y Señalética','Señalética en Acrílico','Letreros para Empresas','Rótulos y Placas a Medida','The Lab Solutions'],
   descripciones:['Cartelería y señalética corporativa en acrílico con corte láser.','Letreros, rótulos y placas a medida para tu empresa. Cotiza online.']},
  {id:'papeleria',slug:'papeleria',label:'Papelería',campañaSugerida:'Búsqueda - Papelería Corporativa',tipo:'SEARCH',presupuesto:3000,
   palabrasClave:['papeleria corporativa','tarjetas de presentacion','imprenta corporativa','membrete personalizado','carpetas corporativas','sellos para empresa','impresion corporativa santiago','tarjetas de presentacion empresa'],
   titulos:['Papelería Corporativa','Tarjetas y Membretes','Imprenta para Empresas','Sellos y Carpetas','The Lab Solutions'],
   descripciones:['Papelería corporativa: tarjetas, membretes, sellos y carpetas.','Imagen profesional para tu empresa. Cotiza tu papelería online.']},
  {id:'chip-the-lab',slug:'chip-the-lab',label:'Chip The Lab (NFC)',campañaSugerida:'Búsqueda - Tarjetas NFC',tipo:'SEARCH',presupuesto:3000,
   palabrasClave:['tarjetas nfc','tarjeta de presentacion nfc','tarjeta digital nfc','tarjetas nfc empresa','tarjeta nfc personalizada','tarjeta de contacto nfc','tarjetas inteligentes nfc','nfc chile'],
   titulos:['Tarjetas NFC','Tarjeta Digital NFC','Tarjetas NFC a Medida','NFC para Empresas','The Lab Solutions'],
   descripciones:['Tarjetas de presentación NFC personalizadas: comparte tu contacto al tocar.','Tarjetas inteligentes NFC para tu equipo. Cotiza las tuyas online.']},
];
function _adsMatchCampaign(campanas,linea){
  if(!campanas||!campanas.length) return null;
  const kws=[
    ...linea.campañaSugerida.toLowerCase().replace(/[–\-]/g,' ').split(/\s+/).filter(w=>w.length>3),
    ...(linea.palabrasClave||[]).flatMap(k=>k.toLowerCase().split(/\s+/).filter(w=>w.length>3))
  ];
  return campanas.find(c=>kws.some(k=>(c.nombre||'').toLowerCase().includes(k)))||null;
}
function adsCopyKw(encoded){
  const kw=decodeURIComponent(encoded);
  navigator.clipboard.writeText(kw).then(()=>toast('✓ "'+kw+'" copiado','success')).catch(()=>{});
}
function adsCopyAllKw(lineaId){
  const l=ADS_LINEAS.find(x=>x.id===lineaId);
  if(!l||!l.palabrasClave) return;
  navigator.clipboard.writeText(l.palabrasClave.join('\n')).then(()=>toast('✓ '+l.palabrasClave.length+' palabras clave copiadas','success')).catch(()=>{});
}
function getCapacidadLineas(){
  const today=new Date();today.setHours(0,0,0,0);
  const dow=today.getDay();
  const lunes=new Date(today);lunes.setDate(today.getDate()-(dow===0?6:dow-1));
  const dias=Array.from({length:5},(_,i)=>{const d=new Date(lunes);d.setDate(lunes.getDate()+i);return d.toISOString().slice(0,10);});
  const calcSlots=ids=>{
    let total=0,enUso=0,enMant=0;
    ids.forEach(id=>{
      const gMant=getMaquinaEstadoGlobal(id)==='mantencion';
      dias.forEach(ds=>{
        total++;
        const ev=(maquinaState.eventos||{})[`${id}_${ds}`];
        if(gMant||ev?.tipo==='mantencion') enMant++;
        else if(ev?.tipo==='uso') enUso++;
      });
    });
    const disp=Math.max(total-enMant,1);
    return{enUso,disp,pct:Math.min(Math.round(enUso/disp*100),100)};
  };
  let fdmSmallIds=[],fdmLargeIds=[];
  try{
    fdmSmallIds=MAQUINAS.filter(m=>['K1','K2','K2 Plus','Ender-5 Max'].includes(m.modelo)).map(m=>m.id);
    fdmLargeIds=MAQUINAS.filter(m=>m.modelo==='Giga').map(m=>m.id);
  }catch(e){}
  const fdmS=calcSlots(fdmSmallIds);
  const fdmL=calcSlots(fdmLargeIds);
  const activos=(state.pedidos||[]).filter(p=>{const e=(p.fields||{})['Estado pedido']||'';return e!=='Despachado'&&e!=='Cancelado';}).length;
  const pedPct=Math.min(Math.round(activos/20*100),100);
  const sem=pct=>{
    if(pct>=85) return{s:'🔴',a:'PAUSAR',m:'Línea saturada — considera pausar campañas para no colapsar producción',c:'var(--danger)'};
    if(pct>=65) return{s:'🟡',a:'REDUCIR',m:'Carga alta — reduce el presupuesto ~30% para controlar el flujo de pedidos',c:'var(--warn)'};
    if(pct<40)  return{s:'🟢',a:'ACTIVAR',m:'Capacidad disponible — activa o aumenta el presupuesto para captar más demanda',c:'var(--success)'};
    return{s:'⚪',a:'MANTENER',m:'Carga moderada — mantén el presupuesto actual',c:'var(--accent)'};
  };
  const mkRow=(id,label,pct,info,lids)=>({id,label,pct,info,lineasIds:lids,...sem(pct)});
  return[
    mkRow('3d_small','FDM Small (K1/K2/Ender)',fdmS.pct,fdmS.enUso+'/'+fdmS.disp+' slots esta semana',['impresion-3d']),
    mkRow('3d_large','FDM Large (Giga)',fdmL.pct,fdmL.enUso+'/'+fdmL.disp+' slots esta semana',['impresion-3d']),
    mkRow('laser','Láser / Cartelería',pedPct,activos+' pedidos activos en cola',['carteleria']),
    mkRow('manual','Manual (Premiaciones · Merch · Papelería · otros)',pedPct,activos+' pedidos activos en cola',['premiaciones','merchandising','papeleria','activaciones','cajas-personalizadas','volumetricos','chip-the-lab']),
  ];
}
function renderAdsCapacidad(data){
  const box=document.getElementById('adsCapacidadBox');
  const list=document.getElementById('adsCapacidadList');
  if(!box||!list) return;
  let filas;
  try{ filas=getCapacidadLineas(); }
  catch(e){ box.style.display='none'; return; }
  const camps=data.campanas||[];
  _adsCapBtnStore=[];
  list.innerHTML=filas.map((f,fi)=>{
    const matchedCamps=f.lineasIds.flatMap(lid=>{
      const linea=ADS_LINEAS.find(l=>l.id===lid);
      return linea?[_adsMatchCampaign(camps,linea)].filter(Boolean):[];
    });
    const unique=[...new Map(matchedCamps.map(c=>[c.id,c])).values()];
    const firstActive=unique.find(c=>c.estado==='ENABLED');
    const firstAny=unique[0]||null;
    let btnHtml='';
    const mkBtn=(label,style)=>{const idx=_adsCapBtnStore.length-1;return`<button onclick="_adsCapBtn(${idx})" style="${style}">${label}</button>`;};
    if(f.a==='PAUSAR'&&firstActive){
      _adsCapBtnStore.push({type:'edit',id:firstActive.id,nombre:firstActive.nombre,estado:'PAUSED',presupuesto:firstActive.presupuesto||0});
      btnHtml=mkBtn('⏸ Pausar','background:rgba(220,53,69,0.1);border:1px solid rgba(220,53,69,0.3);color:var(--danger);border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;white-space:nowrap;flex-shrink:0');
    } else if(f.a==='REDUCIR'&&firstActive){
      const nb=Math.round((firstActive.presupuesto||0)*0.7);
      _adsCapBtnStore.push({type:'edit',id:firstActive.id,nombre:firstActive.nombre,estado:'ENABLED',presupuesto:nb});
      btnHtml=mkBtn('↓ -30%','background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);color:var(--warn);border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;white-space:nowrap;flex-shrink:0');
    } else if(f.a==='ACTIVAR'){
      if(firstAny&&firstAny.estado==='PAUSED'){
        _adsCapBtnStore.push({type:'edit',id:firstAny.id,nombre:firstAny.nombre,estado:'ENABLED',presupuesto:firstAny.presupuesto||0});
        btnHtml=mkBtn('▶ Reactivar','background:rgba(40,199,111,0.1);border:1px solid rgba(40,199,111,0.3);color:var(--success);border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;white-space:nowrap;flex-shrink:0');
      } else if(!firstAny){
        const pl=ADS_LINEAS.find(l=>f.lineasIds.includes(l.id));
        if(pl){_adsCapBtnStore.push({type:'create',lineaId:pl.id});btnHtml=mkBtn('+ Crear','background:rgba(0,212,204,0.1);border:1px solid rgba(0,212,204,0.3);color:var(--accent);border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;white-space:nowrap;flex-shrink:0');}
      }
    }
    const pctBar=Math.max(f.pct,2);
    return `${fi>0?'<hr style="border:none;border-top:1px solid var(--border2);margin:2px 0">':''}<div style="display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
          <span style="font-size:14px">${f.s}</span>
          <span style="font-size:11px;font-weight:600;color:var(--text)">${f.label}</span>
          ${f.info?`<span style="font-size:9px;color:var(--text3);background:var(--surface3);border-radius:3px;padding:1px 5px;white-space:nowrap">${f.info}</span>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:11px;font-weight:700;color:${f.c}">${f.pct}%</span>
          ${btnHtml}
        </div>
      </div>
      <div style="height:5px;background:var(--surface3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pctBar}%;background:${f.c};border-radius:3px;transition:width 0.6s ease"></div>
      </div>
      <div style="font-size:10px;color:var(--text3)">${f.m}</div>
    </div>`;
  }).join('');
  box.style.display='block';
}
function renderAdsSugerencias(data){
  const box=document.getElementById('adsSuggestBox');
  const list=document.getElementById('adsSuggestList');
  const badge=document.getElementById('adsSuggestBadge');
  if(!box||!list) return;
  const camps=data.campanas||[];
  const faltantes=ADS_LINEAS.filter(l=>!_adsMatchCampaign(camps,l));
  if(badge) badge.textContent=faltantes.length+' sugerida'+(faltantes.length!==1?'s':'');
  if(!faltantes.length){
    list.innerHTML='<div style="font-size:11px;color:var(--success);padding:4px 0">✓ Ya tienes campañas para todas las líneas de producción activas.</div>';
    box.style.display='block';return;
  }
  list.innerHTML=faltantes.map(l=>{
    const kws=(l.palabrasClave||[]).slice(0,6);
    const kwChips=kws.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${kws.map(k=>`<span onclick="adsCopyKw('${encodeURIComponent(k)}')" title="Clic para copiar" style="font-size:9px;color:var(--text2);background:var(--surface3);border:1px solid var(--border2);border-radius:10px;padding:1px 7px;cursor:pointer;white-space:nowrap">${escapeHtml(k)}</span>`).join('')}${(l.palabrasClave||[]).length>6?`<span onclick="adsCopyAllKw('${l.id}')" title="Copiar todas las palabras clave" style="font-size:9px;color:var(--accent);background:rgba(0,212,204,0.08);border:1px solid rgba(0,212,204,0.25);border-radius:10px;padding:1px 7px;cursor:pointer;white-space:nowrap">+${(l.palabrasClave||[]).length-6} · copiar todas</span>`:''}</div>`:'';
    return `
    <div style="padding:8px 10px;background:var(--surface2);border-radius:7px;border-left:3px solid rgba(0,212,204,0.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:2px">${escapeHtml(l.campañaSugerida)}</div>
          <div style="font-size:10px;color:var(--text3)">${escapeHtml(l.label)} · ${l.tipo} · Presupuesto sugerido: $${l.presupuesto.toLocaleString('es-CL')}/día</div>
        </div>
        <button onclick="openCreateCampaignByLineaId('${l.id}')" style="background:rgba(0,212,204,0.1);border:1px solid rgba(0,212,204,0.3);color:var(--accent);border-radius:5px;padding:4px 10px;font-size:10px;cursor:pointer;white-space:nowrap;font-weight:600;flex-shrink:0">+ Crear</button>
      </div>
      ${kwChips}
    </div>`;}).join('');
  box.style.display='block';
}
// Palabras clave a incluir en la próxima campaña creada (Script 2 las usará para armar el grupo de anuncios)
let _adsCreateKeywords=[];
function openCreateCampaignTemplate(nombre,presupuesto,tipo,palabrasClave,titulos,descripciones,finalUrl){
  openCreateCampaign();
  _adsCreateKeywords=Array.isArray(palabrasClave)?palabrasClave.slice():[];
  setTimeout(()=>{
    const nm=document.getElementById('adsCampaignModalNombre');if(nm) nm.value=nombre;
    const bd=document.getElementById('adsCampaignModalPresupuesto');if(bd) bd.value=presupuesto;
    const st=document.getElementById('adsCampaignModalEstado');if(st) st.value='ENABLED';
    const tp=document.getElementById('adsCampaignModalTipo');if(tp) tp.value=tipo||'SEARCH';
    const fu=document.getElementById('adsCampaignModalFinalUrl');if(fu&&finalUrl) fu.value=finalUrl;
    const tt=document.getElementById('adsCampaignModalTitulos');if(tt&&Array.isArray(titulos)&&titulos.length) tt.value=titulos.join('\n');
    const ds=document.getElementById('adsCampaignModalDescripciones');if(ds&&Array.isArray(descripciones)&&descripciones.length) ds.value=descripciones.join('\n');
    const kw=document.getElementById('adsCampaignModalKeywords');if(kw&&_adsCreateKeywords.length) kw.value=_adsCreateKeywords.join('\n');
    const hint=document.getElementById('adsCampaignModalKwHint');
    if(hint){
      if(_adsCreateKeywords.length){hint.style.display='block';hint.textContent='✓ Se incluirán '+_adsCreateKeywords.length+' palabras clave y un anuncio responsivo en el grupo de anuncios al crear la campaña. Revisa o edita el anuncio abajo.';}
      else hint.style.display='none';
    }
  },80);
}
function openCreateCampaignByLineaId(lineaId){
  const l=ADS_LINEAS.find(x=>x.id===lineaId);
  if(l){
    const finalUrl=l.slug?(ADS_DEFAULT_URL+'/servicios/'+l.slug):ADS_DEFAULT_URL;
    openCreateCampaignTemplate(l.campañaSugerida,l.presupuesto,l.tipo,l.palabrasClave,l.titulos,l.descripciones,finalUrl);
  }
}
let _adsCapBtnStore=[];
function _adsCapBtn(idx){
  const d=_adsCapBtnStore[idx];if(!d) return;
  if(d.type==='edit') openEditCampaign(d.id,d.nombre,d.estado,d.presupuesto);
  else openCreateCampaignByLineaId(d.lineaId);
}
// Acciones de la tabla de campañas (editar/eliminar) por índice — evita escapes en onclick
let _adsCampActions=[];
function _adsCampAction(idx){
  const d=_adsCampActions[idx];if(!d) return;
  if(d.type==='edit') openEditCampaign(d.id,d.nombre,d.estado,d.presupuesto);
  else if(d.type==='delete') openDeleteCampaign(d.id,d.nombre);
  else if(d.type==='copy') runAdsCopyAgent(d);
  else if(d.type==='analyze') runAdsCampaignAgent(d.id);
}
// Análisis profundo de UNA campaña (con sus acciones de 1 clic)
function runAdsCampaignAgent(id){
  const camp=(window._adsLastData?.campanas||[]).find(c=>String(c.id)===String(id));
  if(!camp){toast('Carga primero los datos de Google Ads','error');return;}
  const days=parseInt(document.getElementById('adsPeriodSelect')?.value||'30');
  const ctr=camp.impresiones>0?(camp.clics/camp.impresiones*100).toFixed(2):0;
  const cpc=camp.clics>0?Math.round(camp.gasto/camp.clics):0;
  const cpa=camp.conversiones>0?Math.round(camp.gasto/camp.conversiones):0;
  const ro=camp.gasto>0&&(camp.valor_conversion||0)>0?(camp.valor_conversion/camp.gasto).toFixed(2):0;
  const util=camp.presupuesto>0?Math.round(camp.gasto/days/camp.presupuesto*100):0;
  const ctx=buildAgentContext('ADS')+`\n\nANALIZA EN PROFUNDIDAD SÓLO ESTA CAMPAÑA:\nid=${camp.id} "${camp.nombre}" [${camp.estado}] · ${days} días\nPpto ${fmtMoney(camp.presupuesto||0)}/día (${util}% uso) · Gasto ${fmtMoney(camp.gasto||0)} · CTR ${ctr}% · CPC ${fmtMoney(cpc)} · Conv ${camp.conversiones||0} · CPA ${camp.conversiones>0?fmtMoney(cpa):'—'} · ROAS-Google ${(camp.valor_conversion||0)>0?ro+'x':'—'}\nDa un diagnóstico específico y las acciones concretas (con [ACTIONS]) para esta campaña. Si la muestra es chica, dilo.`;
  runAgentInline('ADS',ctx,(result)=>{
    const actions=_parseAdsActions(result);window._adsAgentActions=actions;
    const rEl=document.getElementById('agentInlineResult');if(rEl){rEl.style.whiteSpace='normal';rEl.innerHTML=formatAgentReport(result);}
    const btns=_adsRenderActionBtns(actions);
    return btns+`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}
// ── Health Score por campaña (0–100) ────────────────────
function adsHealthScore(c){
  if(!c.impresiones||c.impresiones===0) return{score:0,color:'var(--text3)',label:'Sin datos'};
  const ctr=c.clics/c.impresiones*100;
  const convRate=c.clics>0?c.conversiones/c.clics*100:0;
  const roas=c.gasto>0&&(c.valor_conversion||0)>0?c.valor_conversion/c.gasto:0;
  const s=Math.round(Math.min(ctr/5,1)*35+Math.min(convRate/3,1)*35+(roas>0?Math.min(roas/4,1)*30:0));
  const color=s>=70?'var(--success)':s>=40?'var(--warn)':'var(--danger)';
  return{score:s,color,label:s>=70?'Bueno':s>=40?'Regular':'Bajo'};
}
// ── Airtable sync ────────────────────────────────────────
async function syncAdsToAirtable(data,days){
  let cfg;try{cfg=_airtableConfig();}catch(e){return;}
  const today=new Date().toISOString().slice(0,10);
  const gasto=data.gasto||0,imp=data.impresiones||0,clics=data.clics||0;
  const conv=data.conversiones||0,valConv=data.valor_conversion||0;
  const ctr=imp>0?clics/imp:0;
  const cpc=clics>0?Math.round(gasto/clics):0;
  const cpa=conv>0?Math.round(gasto/conv):0;
  const roas=gasto>0?Math.round(valConv/gasto*100)/100:0;
  const adsCfg=getAdsConfig();
  const base=cfg.base+'/'+BASE_ID;
  const headers={...cfg.headers,'Content-Type':'application/json'};
  // KPI record
  await airtableHttp(base+'/Google_Ads_KPIs',{method:'POST',headers,body:JSON.stringify({records:[{fields:{
    'Período':today+' · '+days+'d',
    'Fecha':today,'Días período':days,
    'Gasto (CLP)':gasto,'Impresiones':imp,'Clics':clics,
    'CTR (%)':ctr,'CPC Promedio (CLP)':cpc,
    'Conversiones':conv,'Valor Conversiones (CLP)':valConv,
    'CPA (CLP)':cpa,'ROAS':roas,
    'Customer ID':adsCfg.customerId||'','Fuente':'real'
  }}],typecast:true})});
  // Campaign records (batch 10)
  const camps=data.campanas||[];
  if(camps.length){
    const recs=camps.map(c=>{
      const ct=c.impresiones>0?c.clics/c.impresiones:0;
      const cp=c.clics>0?Math.round(c.gasto/c.clics):0;
      const ca=c.conversiones>0?Math.round(c.gasto/c.conversiones):0;
      const ro=c.gasto>0&&(c.valor_conversion||0)>0?Math.round(c.valor_conversion/c.gasto*100)/100:0;
      return{fields:{
        'Campaña':c.nombre||String(c.id),
        'Campaign ID':String(c.id||''),
        'Fecha snapshot':today,'Estado':c.estado||'ENABLED',
        'Presupuesto diario (CLP)':c.presupuesto||0,'Gasto (CLP)':c.gasto||0,
        'Impresiones':c.impresiones||0,'Clics':c.clics||0,
        'CTR (%)':ct,'CPC (CLP)':cp,
        'Conversiones':c.conversiones||0,'CPA (CLP)':ca,'ROAS':ro,
        'Score salud':adsHealthScore(c).score,'Período (días)':days
      }};
    });
    for(let i=0;i<recs.length;i+=10){
      await airtableHttp(base+'/Google_Ads_Campanas',{method:'POST',headers,body:JSON.stringify({records:recs.slice(i,i+10),typecast:true})});
    }
  }
}
async function loadAdsSnapshotsFromAirtable(){
  let cfg;try{cfg=_airtableConfig();}catch(e){return;}
  const res=await airtableFetch('Google_Ads_KPIs',60);
  const records=res.records||[];if(!records.length) return;
  records.sort((a,b)=>(b.fields['Fecha']||'').localeCompare(a.fields['Fecha']||''));
  const seen=new Set();
  const deduped=records.filter(r=>{const d=r.fields['Fecha']||'';if(seen.has(d)) return false;seen.add(d);return true;});
  const snaps=deduped.reverse().map(r=>{const f=r.fields;return{
    date:f['Fecha']||'',ts:f['Fecha']||'',
    gasto:f['Gasto (CLP)']||0,clics:f['Clics']||0,conv:f['Conversiones']||0,
    roas:f['ROAS']||0,imp:f['Impresiones']||0,ctr:f['CTR (%)']||0,days:f['Días período']||30
  };});
  localStorage.setItem('ads_snapshots',JSON.stringify(snaps));
}
// ── Export CSV ───────────────────────────────────────────
function adsExportCSV(){
  const rows=document.querySelectorAll('#adsCampaignsArea table tr');
  if(!rows.length){toast('No hay datos para exportar','error');return;}
  const csv=[...rows].map(row=>{
    const cells=[...row.querySelectorAll('th,td')].map(cell=>{
      const clone=cell.cloneNode(true);
      clone.querySelectorAll('button,span[style*="inline-flex"]').forEach(el=>el.remove());
      return'"'+clone.textContent.trim().replace(/"/g,'""')+'"';
    });
    return cells.join(',');
  }).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='campanas_google_ads_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  toast('✓ CSV descargado','success');
}
function adsExportKeywordsCSV(){
  const kws=(window._adsLastData&&window._adsLastData.keywords)||[];
  if(!kws.length){toast('No hay palabras clave para exportar','error');return;}
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const head=['Palabra clave','Concordancia','Quality Score','Anuncio','Landing','CTR esperado','Campaña','Grupo','Impresiones','Clics','Gasto','Conversiones','CPA'];
  const lines=[head.map(q).join(',')];
  [...kws].sort((a,b)=>(b.gasto||0)-(a.gasto||0)).forEach(k=>{
    const cpa=(k.conversiones||0)>0?Math.round(k.gasto/k.conversiones):'';
    lines.push([k.kw,k.match,k.qs||'',k.qs_anuncio,k.qs_landing,k.qs_ctr,k.campana,k.grupo,k.impresiones||0,k.clics||0,k.gasto||0,k.conversiones||0,cpa].map(q).join(','));
  });
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='palabras_clave_google_ads_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  toast('✓ CSV de palabras clave descargado','success');
}
function getAdsConfig(){try{const s=localStorage.getItem('ads_config');if(s) return JSON.parse(s);}catch(e){}const _dw=_DEFAULTS.ADS_WEBAPP,_dc=_DEFAULTS.ADS_CUSTOMER;return{endpoint:(_dw&&!_dw.startsWith('%%'))?_dw:'https://script.google.com/macros/s/AKfycbzepd4w_8meCRmOCsx-pngGHyQ_BqUXAaWAFE8WpIFtTO6zRmFPDukNarCXUNzmfLdt/exec',customerId:(_dc&&!_dc.startsWith('%%'))?_dc:'757-781-2099'};}
function saveAdsConfig(){
  const endpoint=(document.getElementById('ads-endpoint')?.value||'').trim();
  const customerId=(document.getElementById('ads-customer-id')?.value||'').trim();
  if(!endpoint){toast('Ingresa la URL del endpoint','error');return;}
  localStorage.setItem('ads_config',JSON.stringify({endpoint,customerId}));
  document.getElementById('adsConfigPanel').style.display='none';
  toast('✓ Configuración Google Ads guardada','success');
  loadAdsData();
}
function toggleAdsConfig(){
  const p=document.getElementById('adsConfigPanel');
  const visible=p.style.display!=='none';
  p.style.display=visible?'none':'block';
  if(!visible){
    const cfg=getAdsConfig();
    if(cfg.endpoint) document.getElementById('ads-endpoint').value=cfg.endpoint;
    if(cfg.customerId) document.getElementById('ads-customer-id').value=cfg.customerId;
  }
}
function copyAdsScript(id){
  let code=document.getElementById(id||'adsScriptCode')?.textContent||'';
  const cfg=getAdsConfig();
  if(cfg.endpoint) code=code.replace('PEGA_AQUI_LA_URL_DEL_SCRIPT_1',cfg.endpoint);
  if(cfg.customerId) code=code.replace('PEGA_AQUI_EL_CUSTOMER_ID',cfg.customerId.replace(/-/g,''));
  navigator.clipboard.writeText(code).then(()=>toast('✓ Script copiado (endpoint y customer ID pre-rellenados)','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=code;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('✓ Script copiado','success');
  });
}
function fmtMoney(n){if(!n&&n!==0)return'—';if(n>=1000000)return'$'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'$'+(n/1000).toFixed(0)+'K';return'$'+Math.round(n).toLocaleString('es-CL');}
function fmtNum(n){if(!n&&n!==0)return'—';if(n>=1000000)return(n/1000000).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(0)+'K';return Math.round(n).toLocaleString('es-CL');}
function fmtPct(n){return(n||0).toFixed(2)+'%';}
function getAdsDemoData(days){
  const f=days<=7?0.23:days<=30?1:3;
  return{ok:true,periodo:'Demo · '+days+' días',demo:true,
    gasto:Math.round(187400*f),impresiones:Math.round(94200*f),clics:Math.round(2310*f),
    conversiones:Math.round(38*f),valor_conversion:Math.round(1140000*f),
    campanas:[
      {id:'1',nombre:'Búsqueda - Impresión 3D General',estado:'ENABLED',presupuesto:8000,
        gasto:Math.round(74200*f),impresiones:Math.round(38400*f),clics:Math.round(980*f),conversiones:Math.round(18*f),valor_conversion:Math.round(540000*f),
        is:0.42,is_lost_budget:0.31,is_lost_rank:0.27},
      {id:'2',nombre:'Búsqueda - Arquitectura & Diseño',estado:'ENABLED',presupuesto:6000,
        gasto:Math.round(58900*f),impresiones:Math.round(29100*f),clics:Math.round(820*f),conversiones:Math.round(12*f),valor_conversion:Math.round(360000*f),
        is:0.55,is_lost_budget:0.08,is_lost_rank:0.37},
      {id:'3',nombre:'Display Remarketing',estado:'ENABLED',presupuesto:3000,
        gasto:Math.round(31400*f),impresiones:Math.round(22700*f),clics:Math.round(310*f),conversiones:Math.round(6*f),valor_conversion:Math.round(180000*f)},
      {id:'4',nombre:'Búsqueda - Papelería Corporativa',estado:'PAUSED',presupuesto:4000,
        gasto:Math.round(18200*f),impresiones:Math.round(3900*f),clics:Math.round(180*f),conversiones:Math.round(2*f),valor_conversion:Math.round(60000*f)},
      {id:'5',nombre:'YouTube - Branding Lab',estado:'ENABLED',presupuesto:2000,
        gasto:Math.round(4700*f),impresiones:Math.round(102*f*100),clics:Math.round(20*f),conversiones:0,valor_conversion:0},
    ],
    terminos:[
      {termino:'impresora 3d barata',campana:'Búsqueda - Impresión 3D General',clics:Math.round(64*f),gasto:Math.round(11800*f),conversiones:0},
      {termino:'reparar impresora 3d',campana:'Búsqueda - Impresión 3D General',clics:Math.round(38*f),gasto:Math.round(7200*f),conversiones:0},
      {termino:'impresión 3d santiago',campana:'Búsqueda - Impresión 3D General',clics:Math.round(120*f),gasto:Math.round(22400*f),conversiones:Math.round(9*f)},
      {termino:'maqueta arquitectura',campana:'Búsqueda - Arquitectura & Diseño',clics:Math.round(72*f),gasto:Math.round(15100*f),conversiones:Math.round(7*f)},
    ],
    keywords:[
      {kw:'impresora 3d',match:'BROAD',qs:4,qs_anuncio:'BELOW_AVERAGE',qs_landing:'AVERAGE',qs_ctr:'BELOW_AVERAGE',campana:'Búsqueda - Impresión 3D General',grupo:'3D General',impresiones:Math.round(14200*f),clics:Math.round(280*f),gasto:Math.round(28400*f),conversiones:Math.round(2*f)},
      {kw:'impresión 3d santiago',match:'PHRASE',qs:8,qs_anuncio:'ABOVE_AVERAGE',qs_landing:'ABOVE_AVERAGE',qs_ctr:'AVERAGE',campana:'Búsqueda - Impresión 3D General',grupo:'3D Local',impresiones:Math.round(9800*f),clics:Math.round(310*f),gasto:Math.round(21600*f),conversiones:Math.round(11*f)},
      {kw:'prototipo 3d',match:'PHRASE',qs:5,qs_anuncio:'AVERAGE',qs_landing:'BELOW_AVERAGE',qs_ctr:'AVERAGE',campana:'Búsqueda - Arquitectura & Diseño',grupo:'Prototipos',impresiones:Math.round(6100*f),clics:Math.round(150*f),gasto:Math.round(13900*f),conversiones:0},
      {kw:'maqueta arquitectura',match:'EXACT',qs:9,qs_anuncio:'ABOVE_AVERAGE',qs_landing:'ABOVE_AVERAGE',qs_ctr:'ABOVE_AVERAGE',campana:'Búsqueda - Arquitectura & Diseño',grupo:'Maquetas',impresiones:Math.round(4200*f),clics:Math.round(190*f),gasto:Math.round(16800*f),conversiones:Math.round(7*f)},
    ]
  };
}
function testAdsEndpoint(){
  const url=document.getElementById('ads-endpoint').value.trim();
  if(!url){alert('Primero pega la URL del endpoint en el campo de arriba.');return;}
  const testUrl=url+(url.includes('?')?'&':'?')+'days=30';
  window.open(testUrl,'_blank');
}
// ─── Ads Campaign Management ────────────────────────────────
var _adsPendingMutations;try{_adsPendingMutations=JSON.parse(localStorage.getItem('ads_pending_mutations')||'[]');}catch(e){_adsPendingMutations=[];}

function savePendingToStorage(){
  localStorage.setItem('ads_pending_mutations', JSON.stringify(_adsPendingMutations));
}

function openCreateCampaign(){
  _adsCreateKeywords=[];
  document.getElementById('adsCampaignModalId').value='';
  document.getElementById('adsCampaignModalOp').value='create';
  document.getElementById('adsCampaignModalTitle').textContent='Nueva Campaña';
  document.getElementById('adsCampaignModalDesc').textContent='La campaña se creará en Google Ads en la próxima ejecución del Script 2.';
  document.getElementById('adsCampaignModalNombre').value='';
  document.getElementById('adsCampaignModalPresupuesto').value='';
  document.getElementById('adsCampaignModalEstado').value='ENABLED';
  document.getElementById('adsCampaignModalTipoGroup').style.display='';
  document.getElementById('adsCampaignModalAnuncioGroup').style.display='';
  document.getElementById('adsCampaignModalCreateOpts').style.display='';
  document.getElementById('adsCampaignModalConcordancia').value='FRASE';
  document.getElementById('adsCampaignModalMaxCpc').value='800';
  document.getElementById('adsCampaignModalPuja').value='MAXIMIZE_CLICKS';
  document.getElementById('adsCampaignModalPujaObjetivo').value='';
  document.getElementById('adsCampaignModalUbicaciones').value='Región Metropolitana, Chile';
  document.getElementById('adsCampaignModalUbicModo').value='PRESENCE';
  document.getElementById('adsCampaignModalRedSocios').checked=false;
  document.getElementById('adsCampaignModalRedDisplay').checked=false;
  document.getElementById('adsCampaignModalKeywords').value='';
  document.getElementById('adsCampaignModalNegativas').value='';
  _adsTogglePujaObjetivo();
  const _iaInfo=document.getElementById('adsCampaignModalIAInfo');if(_iaInfo){_iaInfo.style.display='none';_iaInfo.innerHTML='';}
  const _iaBtn=document.getElementById('adsCampaignModalCreateAI');if(_iaBtn) _iaBtn.style.display='';
  document.getElementById('adsCampaignModalFinalUrl').value=ADS_DEFAULT_URL;
  document.getElementById('adsCampaignModalPath1').value='';
  document.getElementById('adsCampaignModalPath2').value='';
  document.getElementById('adsCampaignModalTitulos').value='';
  document.getElementById('adsCampaignModalDescripciones').value='';
  const hint=document.getElementById('adsCampaignModalKwHint');if(hint) hint.style.display='none';
  document.getElementById('adsCampaignModal').style.display='flex';
}

function openEditCampaign(id, nombre, estado, presupuesto){
  document.getElementById('adsCampaignModalId').value=id;
  document.getElementById('adsCampaignModalOp').value='edit';
  document.getElementById('adsCampaignModalTitle').textContent='Editar Campaña';
  document.getElementById('adsCampaignModalDesc').textContent='Los cambios se aplicarán en Google Ads en la próxima ejecución del Script 2.';
  document.getElementById('adsCampaignModalNombre').value=nombre||'';
  document.getElementById('adsCampaignModalPresupuesto').value=presupuesto||'';
  document.getElementById('adsCampaignModalEstado').value=estado||'ENABLED';
  document.getElementById('adsCampaignModalTipoGroup').style.display='none';
  document.getElementById('adsCampaignModalAnuncioGroup').style.display='none';
  document.getElementById('adsCampaignModalCreateOpts').style.display='none';
  const _iaInfoE=document.getElementById('adsCampaignModalIAInfo');if(_iaInfoE){_iaInfoE.style.display='none';_iaInfoE.innerHTML='';}
  const _iaBtnE=document.getElementById('adsCampaignModalCreateAI');if(_iaBtnE) _iaBtnE.style.display='none';
  document.getElementById('adsCampaignModal').style.display='flex';
}

function closeAdsCampaignModal(){
  document.getElementById('adsCampaignModal').style.display='none';
}

function openDeleteCampaign(id, nombre){
  document.getElementById('adsDeleteModalId').value=id;
  document.getElementById('adsDeleteModalNombre').textContent='Campaña: '+nombre;
  document.getElementById('adsDeleteModal').style.display='flex';
}

function closeAdsDeleteModal(){
  document.getElementById('adsDeleteModal').style.display='none';
}

// Encola una mutación reemplazando cualquier mutación pendiente equivalente (evita duplicados)
function _adsQueueMutation(mutation){
  const keyOf=m=>m.op+'|'+(m.id||'')+'|'+(m.op==='create'?((m.data&&m.data.nombre)||''):(m.op==='negative'||m.op==='pause_keyword')?((m.data&&m.data.termino)||'')+'|'+((m.data&&m.data.campana)||''):'');
  const k=keyOf(mutation);
  // Conserva las ya aplicadas; descarta una pendiente/enviada/errónea equivalente
  _adsPendingMutations=_adsPendingMutations.filter(m=>m.status==='aplicado'||keyOf(m)!==k);
  _adsPendingMutations.push(mutation);
  savePendingToStorage();
  sendAdsMutation(mutation);
  renderPendingMutations();
  _startAdsMutationPoll();
}

function saveCampaignMutation(){
  const op=document.getElementById('adsCampaignModalOp').value;
  const id=document.getElementById('adsCampaignModalId').value;
  const nombre=document.getElementById('adsCampaignModalNombre').value.trim();
  const presupuesto=parseInt(document.getElementById('adsCampaignModalPresupuesto').value)||0;
  const estado=document.getElementById('adsCampaignModalEstado').value;
  const tipo=document.getElementById('adsCampaignModalTipo').value;
  if(!nombre){alert('El nombre de la campaña es obligatorio.');return;}
  if(presupuesto<1000){alert('El presupuesto debe ser al menos $1.000 CLP.');return;}
  const data={nombre,presupuesto,estado,tipo};
  if(op==='create'){
    // Sin comillas/corchetes: la concordancia la aplica el Script 2 según el selector
    const kwText=(document.getElementById('adsCampaignModalKeywords').value||'').split('\n').map(_adsCleanKw).filter(Boolean);
    if(kwText.length) data.palabrasClave=kwText;
    else if(_adsCreateKeywords.length) data.palabrasClave=_adsCreateKeywords.map(_adsCleanKw).filter(Boolean);
    data.concordancia=document.getElementById('adsCampaignModalConcordancia').value;
    data.maxCpc=parseInt(document.getElementById('adsCampaignModalMaxCpc').value)||800;
    data.pujaEstrategia=document.getElementById('adsCampaignModalPuja').value;
    const _pObj=parseInt(document.getElementById('adsCampaignModalPujaObjetivo').value)||0;
    if(data.pujaEstrategia==='TARGET_CPA'||data.pujaEstrategia==='TARGET_ROAS'){
      if(_pObj<=0){alert('Indica el objetivo de la estrategia de puja (CPA en CLP, o ROAS ej. 3).');return;}
      data.pujaObjetivo=_pObj;
    }
    data.ubicaciones=(document.getElementById('adsCampaignModalUbicaciones').value||'').trim();
    data.ubicModo=document.getElementById('adsCampaignModalUbicModo').value;
    data.redSocios=document.getElementById('adsCampaignModalRedSocios').checked;
    data.redDisplay=document.getElementById('adsCampaignModalRedDisplay').checked;
    data.negativas=(document.getElementById('adsCampaignModalNegativas').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const finalUrl=(document.getElementById('adsCampaignModalFinalUrl').value||'').trim();
    const path1=(document.getElementById('adsCampaignModalPath1').value||'').trim();
    const path2=(document.getElementById('adsCampaignModalPath2').value||'').trim();
    const splitLines=v=>(v||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const titulos=splitLines(document.getElementById('adsCampaignModalTitulos').value);
    const descripciones=splitLines(document.getElementById('adsCampaignModalDescripciones').value);
    const hasAdData=finalUrl||titulos.length||descripciones.length||path1||path2;
    if(hasAdData){
      if(!/^https?:\/\/.+/i.test(finalUrl)){alert('La URL final del anuncio debe empezar con http:// o https://');return;}
      if(titulos.length<3){alert('El anuncio necesita al menos 3 títulos (uno por línea).');return;}
      if(descripciones.length<2){alert('El anuncio necesita al menos 2 descripciones (una por línea).');return;}
      const tLargo=titulos.find(t=>t.length>30);
      if(tLargo){alert('Cada título debe tener máximo 30 caracteres. Acorta: "'+tLargo+'" ('+tLargo.length+').');return;}
      const dLargo=descripciones.find(d=>d.length>90);
      if(dLargo){alert('Cada descripción debe tener máximo 90 caracteres. Acorta: "'+dLargo+'" ('+dLargo.length+').');return;}
      if(path1.length>15||path2.length>15){alert('Cada ruta (Path) debe tener máximo 15 caracteres.');return;}
      data.anuncio={finalUrl,titulos:titulos.slice(0,15),descripciones:descripciones.slice(0,4)};
      if(path1) data.anuncio.path1=path1;
      if(path2) data.anuncio.path2=path2;
    } else if(!confirm('La campaña se creará SIN anuncios y no se publicará hasta que agregues uno en Google Ads. ¿Continuar de todos modos?')){
      return;
    }
  }
  // Cascarón automático vía Make: crea la campaña real en Google Ads (pausada,
  // con la declaración UE); el Script 2 la completará al procesar esta orden.
  if(op==='create'&&ADS_MAKE_SHELL.url){
    const qs='?clave='+encodeURIComponent(ADS_MAKE_SHELL.clave)+'&nombre='+encodeURIComponent(data.nombre)+'&presupuesto='+(data.presupuesto||1000);
    fetch(ADS_MAKE_SHELL.url+qs,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({clave:ADS_MAKE_SHELL.clave,nombre:data.nombre,presupuesto:data.presupuesto||1000})})
      .then(r=>{if(r.ok)toast('✓ Cascarón pedido a Make — el Script 2 completará la campaña en su próxima corrida','success');else toast('Make respondió '+r.status+' al pedir el cascarón — si la campaña no aparece, créala a mano','info');})
      .catch(()=>toast('No se pudo contactar el webhook de Make — crea el cascarón a mano si no existe','info'));
  }
  const mutation={op,id,data,timestamp:new Date().toISOString(),status:'pending'};
  closeAdsCampaignModal();
  _adsQueueMutation(mutation);
}

// ─── Generador de campañas con IA ───────────────────────────
function _adsTogglePujaObjetivo(){
  const sel=document.getElementById('adsCampaignModalPuja'); if(!sel) return;
  const v=sel.value;
  const g=document.getElementById('adsCampaignModalPujaObjetivoGroup');
  const lb=document.getElementById('adsCampaignModalPujaObjetivoLabel');
  const inp=document.getElementById('adsCampaignModalPujaObjetivo');
  if(!g) return;
  if(v==='TARGET_CPA'){g.style.display='';if(lb)lb.textContent='CPA objetivo (CLP)';if(inp)inp.placeholder='Ej: 8000';}
  else if(v==='TARGET_ROAS'){g.style.display='';if(lb)lb.textContent='ROAS objetivo (ej: 3 = 300%)';if(inp)inp.placeholder='Ej: 3';}
  else{g.style.display='none';}
}

const ADS_BUILDER_SYS=`Eres el generador experto de campañas de Google Ads de The Lab Solutions, fabricación digital B2B a medida en Santiago, Chile.
NEGOCIO: la web convierte una visita en una cotización (WhatsApp o formulario). Comprador B2B (marketing, RRHH, productoras de eventos, retail) que cotiza con un proveedor y tiene plazo. Se optimiza por GANANCIA real del CRM, no por volumen de clics.
9 LÍNEAS (usa el slug EXACTO en la URL final https://thelab.solutions/servicios/<slug>):
- Activaciones (activaciones)
- Premiaciones (premiaciones): trofeos, galvanos, medallas, reconocimientos
- Merchandising (merchandising): regalos corporativos, artículos promocionales
- Cajas Personalizadas (cajas-personalizadas): packaging
- Impresión 3D (impresion-3d): piezas, prototipos, maquetas
- Volumétricos (volumetricos): letras corpóreas, estructuras, neón/LED
- Cartelería (carteleria): señalética, letreros acrílico
- Papelería (papeleria): imprenta corporativa, tarjetas, membretes
- Chip The Lab (chip-the-lab): tarjetas NFC
REGLAS 2026 (aplícalas):
- Concordancia por defecto FRASE (AMPLIA solo con puja inteligente y datos).
- Puja: empieza en MAXIMIZE_CLICKS para juntar datos; usa TARGET_CPA o TARGET_ROAS solo si el brief dice que ya hay volumen de conversiones.
- Geo: "Región Metropolitana, Chile", modo PRESENCE. Redes: socios y display en false.
- Palabras clave con intención comercial chilena (cotizar, personalizado, para empresas, corporativo, por mayor, santiago); 10-15 por campaña. SIN comillas ni corchetes: la concordancia se define en un campo aparte, no en el texto.
- Negativas: incluye empleo, trabajo, gratis, plantilla, pdf, como hacer, diy, tutorial, curso, usado, segunda mano; para impresión 3D agrega ademas steam, juego, render, blender, roblox, minecraft, lentes 3d.
- RSA: 12-15 títulos ÚNICOS de máximo 30 caracteres (keyword, diferenciador premium, prueba/años, CTA "Cotiza por WhatsApp") y 4 descripciones de máximo 90 caracteres. LOS LÍMITES SON ESTRICTOS: cuenta los caracteres de cada título y descripción antes de incluirlos; si uno se pasa, reescríbelo más corto (no lo entregues largo).
- Presupuesto diario en CLP realista (3000-10000 por línea).
Responde SOLO con este JSON, sin texto adicional y sin bloques de código:
{"nombre":"","tipo":"SEARCH","presupuesto":6000,"concordancia":"FRASE","maxCpc":800,"pujaEstrategia":"MAXIMIZE_CLICKS","pujaObjetivo":0,"ubicaciones":"Región Metropolitana, Chile","ubicModo":"PRESENCE","redSocios":false,"redDisplay":false,"finalUrl":"https://thelab.solutions/servicios/premiaciones","path1":"","path2":"","palabrasClave":[],"negativas":[],"titulos":[],"descripciones":[],"metricas":{"ctr":">3%","cpc":"<$1.200 CLP","cpa":"<$8.000 CLP","roas":">3x (CRM)","convMes":"15-30"},"checklist":["Poner la etiqueta de conversión en la web antes de activar","Confirmar geo en modo Presencia (RM) en Google Ads","Importar conversiones offline del CRM (gclid) para optimizar por ganancia real","Adjuntar sitelinks a cada /servicios y asset de mensaje/WhatsApp"]}`;

async function iaBuildCampaign(){
  const brief=prompt('¿Qué campaña quieres que arme la IA?\nIndica la línea de producto y el objetivo.\n\nEj: Premiaciones — captar pedidos de galvanos y trofeos para empresas de fin de año');
  if(brief===null) return;
  const q=(brief||'').trim();
  if(!q){toast('Describe la campaña que quieres crear','error');return;}
  toast('✨ La IA está armando la campaña…','info');
  try{showAgentWorking('ADS',{verb:'está armando tu campaña de Google Ads…',messages:['Definiendo estructura y puja…','Eligiendo palabras clave y negativas…','Escribiendo títulos y descripciones…','Ajustando métricas objetivo…']});}catch(e){}
  try{
    let ctx='';
    try{ if(typeof state!=='undefined'&&state.loaded&&window._adsLastData&&!window._adsLastData.demo) ctx=('\n\nDATOS ACTUALES DE LA CUENTA (referencia):\n'+buildAgentContext('ADS')).slice(0,3500); }catch(e){}
    const raw=await callClaude(ADS_BUILDER_SYS,'BRIEF: '+q+ctx+'\n\nDevuelve SOLO el JSON.');
    const prop=_parseCampaignJSON(raw);
    if(!prop||!prop.nombre){toast('La IA no devolvió una campaña válida — reintenta','error');return;}
    _applyIACampaign(prop);
    toast('✓ Campaña generada — revísala y guarda','success');
  }catch(e){toast('Error IA: '+((e&&e.message)||e),'error');}
  finally{try{hideAgentWorking();}catch(e){}}
}

function _parseCampaignJSON(raw){
  if(!raw) return null;
  const s=String(raw).trim();
  const a=s.indexOf('{'), b=s.lastIndexOf('}');
  if(a<0||b<0) return null;
  try{return JSON.parse(s.slice(a,b+1));}catch(e){return null;}
}

// Sanitiza la salida de la IA a los límites reales de Google Ads:
// keywords sin comillas/corchetes (la concordancia la pone el Script 2),
// títulos ≤30 y descripciones ≤90 recortados en el último espacio.
function _adsCleanKw(s){return String(s||'').trim().replace(/^["'“”\[\]]+|["'“”\[\]]+$/g,'').trim();}
function _adsTrimLen(s,max){
  s=String(s||'').trim();
  if(s.length<=max) return s;
  const cut=s.slice(0,max);
  const sp=cut.lastIndexOf(' ');
  return (sp>Math.floor(max*0.5)?cut.slice(0,sp):cut).replace(/[\s,;:.]+$/,'');
}
function _applyIACampaign(p){
  if(Array.isArray(p.palabrasClave)) p.palabrasClave=p.palabrasClave.map(_adsCleanKw).filter(Boolean);
  if(Array.isArray(p.negativas)) p.negativas=p.negativas.map(_adsCleanKw).filter(Boolean);
  if(Array.isArray(p.titulos)) p.titulos=p.titulos.map(t=>_adsTrimLen(t,30)).filter(Boolean);
  if(Array.isArray(p.descripciones)) p.descripciones=p.descripciones.map(d=>_adsTrimLen(d,90)).filter(Boolean);
  openCreateCampaign();
  const set=(id,v)=>{const el=document.getElementById(id);if(el&&v!=null&&v!=='') el.value=v;};
  set('adsCampaignModalNombre',p.nombre);
  set('adsCampaignModalTipo',(p.tipo||'SEARCH'));
  set('adsCampaignModalPresupuesto',p.presupuesto);
  set('adsCampaignModalConcordancia',(p.concordancia||'FRASE').toString().toUpperCase());
  set('adsCampaignModalMaxCpc',p.maxCpc);
  set('adsCampaignModalPuja',(p.pujaEstrategia||'MAXIMIZE_CLICKS').toString().toUpperCase());
  _adsTogglePujaObjetivo();
  if(p.pujaObjetivo) set('adsCampaignModalPujaObjetivo',p.pujaObjetivo);
  set('adsCampaignModalUbicaciones',p.ubicaciones);
  set('adsCampaignModalUbicModo',(p.ubicModo||'PRESENCE').toString().toUpperCase());
  const rs=document.getElementById('adsCampaignModalRedSocios');if(rs) rs.checked=!!p.redSocios;
  const rd=document.getElementById('adsCampaignModalRedDisplay');if(rd) rd.checked=!!p.redDisplay;
  set('adsCampaignModalFinalUrl',p.finalUrl);
  set('adsCampaignModalPath1',p.path1);
  set('adsCampaignModalPath2',p.path2);
  if(Array.isArray(p.titulos)) set('adsCampaignModalTitulos',p.titulos.join('\n'));
  if(Array.isArray(p.descripciones)) set('adsCampaignModalDescripciones',p.descripciones.join('\n'));
  if(Array.isArray(p.palabrasClave)){_adsCreateKeywords=p.palabrasClave.slice();set('adsCampaignModalKeywords',p.palabrasClave.join('\n'));}
  if(Array.isArray(p.negativas)) set('adsCampaignModalNegativas',p.negativas.join('\n'));
  const info=document.getElementById('adsCampaignModalIAInfo');
  if(info){
    const m=p.metricas||{};
    const met=Object.keys(m).length?('<div style="font-weight:700;color:var(--accent);font-size:11px;margin-bottom:4px">🎯 Métricas objetivo</div><div style="font-size:11px;color:var(--text2);line-height:1.7">'+Object.keys(m).map(k=>'<b>'+escapeHtml(k)+':</b> '+escapeHtml(String(m[k]))).join(' · ')+'</div>'):'';
    const chk=(Array.isArray(p.checklist)&&p.checklist.length)?('<div style="font-weight:700;color:var(--warn);font-size:11px;margin:8px 0 4px">✅ Terminar en Google Ads</div><ul style="font-size:11px;color:var(--text2);margin:0;padding-left:16px;line-height:1.6">'+p.checklist.map(c=>'<li>'+escapeHtml(String(c))+'</li>').join('')+'</ul>'):'';
    info.innerHTML='<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:10px 12px">'+(met||'')+(chk||'')+'</div>';
    info.style.display=(met||chk)?'':'none';
  }
}

function confirmDeleteCampaign(){
  const id=document.getElementById('adsDeleteModalId').value;
  const nombre=document.getElementById('adsDeleteModalNombre').textContent.replace('Campaña: ','');
  const mutation={op:'delete',id,data:{nombre},timestamp:new Date().toISOString(),status:'pending'};
  closeAdsDeleteModal();
  _adsQueueMutation(mutation);
}

// Purga del servidor (Script 1) las mutaciones ya resueltas; conserva las pendientes.
// El almacén crece para siempre (errores viejos, duplicados) y ensucia el diagnóstico.
async function adsLimpiarHistorialMutaciones(){
  const cfg=getAdsConfig();
  if(!cfg.endpoint){toast('No hay endpoint configurado','error');return;}
  try{
    const r=await fetch(cfg.endpoint+(cfg.endpoint.includes('?')?'&':'?')+'action=mutations&_t='+Date.now());
    const d=await r.json();
    const todas=(d&&d.mutations)||[];
    const pendientes=todas.filter(m=>m.status==='pending');
    const resueltas=todas.length-pendientes.length;
    if(!resueltas){toast('No hay mutaciones resueltas que limpiar','info');return;}
    if(!confirm(`Se eliminarán ${resueltas} mutaciones ya resueltas (aplicadas o con error) del historial del servidor. Se conservan las ${pendientes.length} pendientes. ¿Continuar?`)) return;
    const res=await fetch(cfg.endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({secret:'thelab2025',type:'update_mutations',mutations:pendientes})});
    const dr=await res.json().catch(()=>({}));
    if(dr&&dr.ok){
      _adsPendingMutations=_adsPendingMutations.filter(m=>m.status==='pending'||m.status==='enviado');
      savePendingToStorage();renderPendingMutations();
      toast('✓ Historial limpio — '+resueltas+' eliminadas, '+pendientes.length+' pendientes conservadas','success');
    } else toast('No se pudo limpiar: '+((dr&&dr.error)||'el servidor no respondió ok'),'error');
  }catch(e){toast('Error limpiando historial: '+e.message,'error');}
}

// ─── Piloto automático (propuestas semanales del Worker) ────
let _adsAutopilotProps=[];
async function renderAdsAutopilot(){
  const panel=document.getElementById('adsAutopilotPanel');
  const list=document.getElementById('adsAutopilotList');
  const badge=document.getElementById('adsAutopilotBadge');
  if(!panel||!list) return;
  try{
    const cfg=_airtableConfig();
    const formula=encodeURIComponent("AND({Agente}='ADS_AUTOPILOT',{Estado}='Pendiente')");
    const r=await airtableHttp(`${cfg.base}/${BASE_ID}/Agent_Queue?filterByFormula=${formula}&pageSize=10`,{headers:cfg.headers});
    if(!r.ok) throw new Error('Airtable '+r.status);
    const d=await r.json();
    _adsAutopilotProps=(d.records||[]).map(rec=>{
      let out={};try{out=JSON.parse(rec.fields?.Output||'{}');}catch(e){}
      return{id:rec.id,fecha:rec.fields?.['Fecha creación']||rec.createdTime,resumen:out.resumen||'',acciones:out.acciones||[],mutaciones:out.mutaciones||[],descartadas:out.descartadas||[]};
    }).filter(p=>p.mutaciones.length);
  }catch(e){ panel.style.display='none'; return; }
  if(!_adsAutopilotProps.length){ panel.style.display='none'; return; }
  if(badge) badge.textContent=_adsAutopilotProps.length+' pendiente'+(_adsAutopilotProps.length!==1?'s':'');
  list.innerHTML=_adsAutopilotProps.map((p,i)=>{
    const filas=p.acciones.map(a=>{
      const det=a.tipo==='presupuesto'?`$${(a.anterior||0).toLocaleString('es-CL')} → <b>$${(a.nuevo||0).toLocaleString('es-CL')}</b>/día`:a.tipo;
      return `<div style="display:flex;gap:8px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border2)"><span style="min-width:120px;color:var(--accent)">${escapeHtml(a.linea||'')}</span><span style="flex:1;color:var(--text2)">${escapeHtml(a.campana||'')} · ${det}</span><span style="flex:1;color:var(--text3)">${escapeHtml(a.motivo||'')}</span></div>`;
    }).join('');
    return `<div style="background:var(--surface2);border-radius:8px;padding:10px 12px;border-left:3px solid var(--accent)">
      <div style="font-size:10px;color:var(--text3);margin-bottom:4px">${escapeHtml((p.fecha||'').slice(0,16).replace('T',' '))}</div>
      ${p.resumen?`<div style="font-size:11px;color:var(--text);margin-bottom:6px">${escapeHtml(p.resumen)}</div>`:''}
      ${filas}
      ${p.descartadas.length?`<div style="font-size:10px;color:var(--text3);margin-top:6px">Descartadas por guardrails: ${p.descartadas.map(x=>escapeHtml((x.tipo||'')+' '+(x.linea||'')+' ('+(x.descarte||'')+')')).join(' · ')}</div>`:''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-primary btn-sm" style="font-size:11px" onclick="adsAutopilotDecide(${i},true)">✓ Aprobar y aplicar</button>
        <button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--danger)" onclick="adsAutopilotDecide(${i},false)">✗ Rechazar</button>
      </div>
    </div>`;
  }).join('');
  panel.style.display='block';
}
async function adsAutopilotDecide(i,aprobar){
  const p=_adsAutopilotProps[i]; if(!p) return;
  // Re-verifica el estado justo antes (pudo aprobarse por email hace un momento):
  // evita encolar dos veces las mismas mutaciones (un "create" duplicaría la campaña).
  try{
    const cfg=_airtableConfig();
    const r=await airtableHttp(`${cfg.base}/${BASE_ID}/Agent_Queue/${p.id}`,{headers:cfg.headers});
    if(r.ok){const rec=await r.json();if((rec.fields?.Estado||'')!=='Pendiente'){toast('Esta propuesta ya fue procesada ('+(rec.fields?.Estado||'—')+')','info');renderAdsAutopilot();return;}}
  }catch(e){}
  if(aprobar){
    if(!confirm(`¿Aprobar ${p.mutaciones.length} cambio(s) del piloto? Se aplicarán en Google Ads en la próxima corrida del Script 2.`)) return;
    p.mutaciones.forEach(m=>_adsQueueMutation({...m,timestamp:m.timestamp||new Date().toISOString(),status:'pending'}));
    try{await airtableWriteTolerant('Agent_Queue','PATCH',p.id,{Estado:'Completado','Fecha ejecución':new Date().toISOString(),'Accion sugerida':`Aprobado desde dashboard: ${p.mutaciones.length} mutaciones encoladas`});}catch(e){}
    toast('✓ '+p.mutaciones.length+' cambio(s) del piloto encolados','success');
  }else{
    try{await airtableWriteTolerant('Agent_Queue','PATCH',p.id,{Estado:'Error',Error:'Rechazado desde el dashboard ('+new Date().toISOString().slice(0,16)+')'});}catch(e){}
    toast('Propuesta del piloto rechazada','info');
  }
  renderAdsAutopilot();
}

// ─── Conversiones offline (CRM → Google Ads) ────────────────
function _adsOffSyncNames(){
  const l=(document.getElementById('adsOffLeadName').value||'Lead calificado CRM').trim();
  const v=(document.getElementById('adsOffVentaName').value||'Venta CRM').trim();
  const e1=document.getElementById('adsOffNameEcho1'); if(e1) e1.textContent=l||'Lead calificado CRM';
  const e2=document.getElementById('adsOffNameEcho2'); if(e2) e2.textContent=v||'Venta CRM';
}
function openAdsOfflineModal(){
  const r=document.getElementById('adsOffResult'); if(r){r.style.display='none';r.innerHTML='';}
  _adsOffSyncNames();
  document.getElementById('adsOfflineModal').style.display='flex';
}
function closeAdsOfflineModal(){ document.getElementById('adsOfflineModal').style.display='none'; }
function _adsOfflineTime(d){
  try{ return d.toLocaleString('sv-SE',{timeZone:'America/Santiago'}).replace('T',' ').slice(0,19); }
  catch(e){ return d.toISOString().slice(0,19).replace('T',' '); }
}
function _adsCsvCell(v){ const s=String(v==null?'':v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function _adsDownloadCSV(name,text){
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{try{document.body.removeChild(a);}catch(e){} URL.revokeObjectURL(url);},150);
}
function _adsGetGclid(c){
  if(!c||!c.fields) return '';
  const g=c.fields['GCLID']; if(g) return String(g).trim();
  const notas=c.fields['Notas internas']||''; const m=String(notas).match(/gclid=([^\s]+)/i);
  return m?m[1]:'';
}
function adsExportOfflineConversions(){
  if(typeof state==='undefined'||!state.loaded){toast('Carga primero los datos de Airtable','error');return;}
  const days=Math.max(1,Math.min(90,parseInt(document.getElementById('adsOffDays').value)||90));
  const thr=parseInt(document.getElementById('adsOffScore').value)||6;
  const leadVal=parseInt(document.getElementById('adsOffLeadVal').value)||0;
  const incLeads=document.getElementById('adsOffIncLeads').checked;
  const incVentas=document.getElementById('adsOffIncVentas').checked;
  const nLead=(document.getElementById('adsOffLeadName').value||'Lead calificado CRM').trim();
  const nVenta=(document.getElementById('adsOffVentaName').value||'Venta CRM').trim();
  const cutoff=new Date(Date.now()-days*86400000);
  const etapasCalif=['Propuesta enviada','Negociación','Cliente activo'];
  const rows=[]; let sinGclid=0, nLeads=0, nVentas=0;
  if(incLeads){
    (state.clientes||[]).forEach(c=>{
      const f=c.fields||{}; const dd=c.createdTime?new Date(c.createdTime):null; if(!dd||dd<cutoff) return;
      const score=Number(f['Lead Score IA']||f['Lead Score']||0);
      const etapa=f['Etapa venta']||'';
      if(!(score>=thr||etapasCalif.includes(etapa))) return;
      const g=_adsGetGclid(c); if(!g){sinGclid++;return;}
      rows.push([g,nLead,_adsOfflineTime(dd),leadVal>0?leadVal:'','CLP']); nLeads++;
    });
  }
  if(incVentas){
    (state.pedidos||[]).forEach(p=>{
      const f=p.fields||{}; if((f['Estado pedido']||'')==='Cancelado') return;
      const dd=p.createdTime?new Date(p.createdTime):null; if(!dd||dd<cutoff) return;
      const cid=Array.isArray(f['Cliente'])?f['Cliente'][0]:(typeof f['Cliente']==='string'?f['Cliente']:null);
      const cli=(cid&&state.clientesByIdRec)?state.clientesByIdRec[cid]:null;
      const g=_adsGetGclid(cli); if(!g){sinGclid++;return;}
      const val=Math.round((f['Monto total (CLP)']||0)/1.19);
      rows.push([g,nVenta,_adsOfflineTime(dd),val>0?val:'','CLP']); nVentas++;
    });
  }
  const out=document.getElementById('adsOffResult'); if(out) out.style.display='block';
  if(!rows.length){
    if(out) out.innerHTML='<span style="color:var(--warn)">No se encontraron conversiones con gclid en el período. Revisa que la columna <b>GCLID</b> exista en Clientes y que estén llegando leads desde Google Ads (o que el gclid quede en Notas internas).</span>';
    return;
  }
  const header='Parameters:TimeZone=America/Santiago\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency';
  const csv=header+'\n'+rows.map(r=>r.map(_adsCsvCell).join(',')).join('\n')+'\n';
  _adsDownloadCSV('conversiones_offline_'+new Date().toISOString().slice(0,10)+'.csv',csv);
  if(out) out.innerHTML='✓ CSV generado: <b>'+rows.length+'</b> conversiones ('+nLeads+' leads · '+nVentas+' ventas)'+(sinGclid?' · <span style="color:var(--warn)">'+sinGclid+' sin gclid omitidas</span>':'')+'.<br>Súbelo en Google Ads → Objetivos → Conversiones → Cargas → Subir.';
}

async function adsDiagnostico(){
  const cfg=getAdsConfig();
  const out=document.getElementById('adsDiagOutput');
  if(!out) return;
  out.style.display='block';
  out.innerHTML='<div style="color:var(--text3)">⏳ Diagnosticando...</div>';
  const lines=[];
  lines.push(`<b>Endpoint configurado:</b> <code style="font-size:9px;word-break:break-all">${escapeHtml(cfg.endpoint||'(ninguno)')}</code>`);
  lines.push(`<b>Customer ID:</b> ${escapeHtml(cfg.customerId||'(no definido)')}`);
  lines.push(`<b>Mutaciones locales (localStorage):</b> ${_adsPendingMutations.length} total`);
  const byStatus={};_adsPendingMutations.forEach(m=>{byStatus[m.status]=(byStatus[m.status]||0)+1;});
  Object.entries(byStatus).forEach(([s,n])=>lines.push(`  &nbsp;→ ${s}: ${n}`));
  if(cfg.endpoint){
    try{
      const url=cfg.endpoint+(cfg.endpoint.includes('?')?'&':'?')+'action=mutations&_t='+Date.now();
      const r=await fetch(url);const d=await r.json();
      if(d.ok&&Array.isArray(d.mutations)){
        lines.push(`<b style="color:var(--success)">✓ Script 1 responde OK</b> — ${d.mutations.length} mutaciones almacenadas`);
        const byS2={};d.mutations.forEach(m=>{byS2[m.status]=(byS2[m.status]||0)+1;});
        Object.entries(byS2).forEach(([s,n])=>lines.push(`  &nbsp;→ <b>${s}</b>: ${n}`));
        const pending=d.mutations.filter(m=>m.status==='pending'||m.status==='enviado');
        if(pending.length){
          const oldest=pending.sort((a,b)=>a.timestamp.localeCompare(b.timestamp))[0];
          const mins=Math.round((Date.now()-new Date(oldest.timestamp).getTime())/60000);
          lines.push(`<b style="color:var(--warn)">⚠ ${pending.length} mutación(es) sin aplicar</b> — la más antigua tiene ${mins} min`);
          if(mins>60) lines.push(`<span style="color:var(--danger)">→ El Script 2 no ha corrido en más de 1 hora. Verifica que tenga un trigger horario configurado en Google Ads → Herramientas → Scripts → ⏱</span>`);
          else lines.push(`→ El Script 2 debería procesarlas en la próxima ejecución (si tiene trigger horario).`);
        } else if(d.mutations.length){
          lines.push(`<span style="color:var(--success)">✓ Todas las mutaciones han sido aplicadas por Script 2</span>`);
        }
      } else {
        lines.push(`<b style="color:var(--danger)">✗ Script 1 respondió con error:</b> ${escapeHtml((d&&d.error)||'respuesta inválida')}`);
      }
    }catch(e){
      lines.push(`<b style="color:var(--danger)">✗ No se pudo conectar con Script 1:</b> ${escapeHtml(e.message)}`);
      lines.push(`→ Verifica que el Script 1 esté publicado como <b>Aplicación web</b> con acceso <b>Todos (Anyone)</b>.`);
    }
  } else {
    lines.push(`<b style="color:var(--danger)">✗ No hay endpoint configurado</b> — pega la URL del Script 1 arriba.`);
  }
  out.innerHTML=lines.map(l=>`<div style="margin-bottom:4px;font-size:11px">${l}</div>`).join('');
}

function sendAdsMutation(mutation){
  const cfg=getAdsConfig();
  if(!cfg.endpoint){mutation.status='error';mutation.error='No hay endpoint configurado';savePendingToStorage();renderPendingMutations();return;}
  // text/plain evita el CORS preflight que bloquea los POSTs a Google Apps Script
  fetch(cfg.endpoint,{
    method:'POST',
    headers:{'Content-Type':'text/plain'},
    body:JSON.stringify({secret:'thelab2025',type:'mutation',...mutation})
  }).then(r=>r.json()).then(d=>{
    if(d&&d.ok){mutation.status='enviado';mutation.error='';}
    else{mutation.status='error';mutation.error=(d&&d.error)||'El servidor rechazó la mutación';}
    savePendingToStorage();
    renderPendingMutations();
  }).catch(()=>{
    mutation.status='error';mutation.error='Sin conexión con el endpoint (se reintentará al guardar de nuevo)';
    savePendingToStorage();
    renderPendingMutations();
  });
}

// Sincroniza el estado de las mutaciones desde el servidor (Script 1) — refleja lo que el Script 2 aplicó
async function syncMutationStatuses(){
  const cfg=getAdsConfig();
  if(!cfg.endpoint||!_adsPendingMutations.length) return;
  try{
    const r=await fetch(cfg.endpoint+(cfg.endpoint.includes('?')?'&':'?')+'action=mutations&_t='+Date.now());
    const d=await r.json();
    if(!d.ok||!Array.isArray(d.mutations)) return;
    let aplicadas=0,errores=0,changed=false;
    _adsPendingMutations.forEach(m=>{
      const srv=d.mutations.find(s=>s.timestamp===m.timestamp);
      if(srv&&srv.status&&srv.status!=='pending'&&m.status!==srv.status){
        m.status=srv.status;m.error=srv.error||'';changed=true;
        if(srv.status==='aplicado') aplicadas++;
        if(srv.status==='error') errores++;
      }
    });
    if(changed){
      _adsPendingMutations=_adsPendingMutations.filter(m=>m.status!=='aplicado');
      savePendingToStorage();
      renderPendingMutations();
      if(aplicadas) toast('✓ '+aplicadas+' cambio'+(aplicadas>1?'s':'')+' aplicado'+(aplicadas>1?'s':'')+' en Google Ads','success');
      if(errores) toast('⚠ '+errores+' mutación'+(errores>1?'es':'')+' con error — revisa el detalle en Cambios pendientes','error');
    }
  }catch(e){}
}

function renderPendingMutations(){
  const panel=document.getElementById('adsPendingPanel');
  const list=document.getElementById('adsPendingList');
  const badge=document.getElementById('adsPendingBadge');
  if(!_adsPendingMutations.length){if(panel)panel.style.display='none';return;}
  if(panel)panel.style.display='block';
  const visibles=_adsPendingMutations.filter(m=>m.status!=='aplicado');
  if(!visibles.length){if(panel)panel.style.display='none';return;}
  const nPend=visibles.filter(m=>m.status!=='error').length;
  const nErr=visibles.filter(m=>m.status==='error').length;
  if(badge) badge.textContent=nPend+' pendiente'+(nPend!==1?'s':'')+(nErr?' · '+nErr+' error'+(nErr!==1?'es':''):'');
  const retryBtn=document.getElementById('adsRetryAllBtn');
  if(retryBtn) retryBtn.style.display=nErr?'':'none';
  const opLabel={create:'Crear',edit:'Editar',delete:'Eliminar',negative:'Negativo',pause_keyword:'Pausar kw'};
  const mutDesc=m=>{
    if(m.op==='negative'||m.op==='pause_keyword')return (m.data&&m.data.termino?'«'+m.data.termino+'»':'')+(m.data&&m.data.campana?' · '+m.data.campana:'');
    return (m.data&&m.data.nombre)||m.id||'';
  };
  const stMap={
    pending:{c:'var(--warn)',t:'⏳ Pendiente'},
    enviado:{c:'var(--accent3)',t:'✓ En cola — esperando Script 2'},
    error:{c:'var(--danger)',t:'❌ Error'}
  };
  list.innerHTML=visibles.map(m=>{
    const st=stMap[m.status]||stMap.pending;
    const retry=m.status==='error'?`<button onclick="retryMutation('${m.timestamp}')" style="background:none;border:1px solid var(--border2);color:var(--accent);cursor:pointer;font-size:9px;padding:1px 6px;border-radius:4px;line-height:1.4" title="Reintentar">↻ Reintentar</button>`:'';
    const errLine=m.status==='error'&&m.error?`<div style="font-size:9px;color:var(--danger);margin-top:3px;padding-left:2px">${escapeHtml(m.error)}</div>`:'';
    return `
    <div style="padding:7px 10px;background:var(--surface2);border-radius:6px;font-size:11px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="color:${m.op==='delete'||m.op==='pause_keyword'?'var(--danger)':m.op==='create'?'var(--success)':'var(--accent)'};font-weight:600;flex-shrink:0">${opLabel[m.op]||m.op}</span>
        <span style="color:var(--text2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(mutDesc(m))}</span>
        <span style="color:${st.c};font-size:9px;white-space:nowrap;flex-shrink:0">${st.t}</span>
        ${retry}
        <button onclick="removePendingMutationByTs('${m.timestamp}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0;line-height:1;flex-shrink:0" title="Quitar de la cola">×</button>
      </div>
      ${errLine}
    </div>`;}).join('');
}

function removePendingMutationByTs(ts){
  _adsPendingMutations=_adsPendingMutations.filter(m=>m.timestamp!==ts);
  savePendingToStorage();
  renderPendingMutations();
}

// Auto-poll: verifica estado de mutaciones cada 2 min si hay pendientes y el tab web está activo
let _adsMutationPollInterval=null;
function _startAdsMutationPoll(){
  if(_adsMutationPollInterval) return;
  _adsMutationPollInterval=setInterval(()=>{
    const hasPending=_adsPendingMutations.some(m=>m.status==='enviado'||m.status==='pending');
    const webActive=document.getElementById('tab-web')?.classList.contains('active');
    if(hasPending&&webActive) syncMutationStatuses();
    else if(!hasPending){clearInterval(_adsMutationPollInterval);_adsMutationPollInterval=null;}
  },120000);
}
function _stopAdsMutationPoll(){if(_adsMutationPollInterval){clearInterval(_adsMutationPollInterval);_adsMutationPollInterval=null;}}

function retryMutation(ts){
  const m=_adsPendingMutations.find(x=>x.timestamp===ts);
  if(!m) return;
  m.status='pending';m.error='';
  savePendingToStorage();
  sendAdsMutation(m);
  renderPendingMutations();
}
function retryAllErrors(){
  const errors=_adsPendingMutations.filter(m=>m.status==='error');
  if(!errors.length){toast('Sin errores que reintentar','info');return;}
  errors.forEach(m=>{m.status='pending';m.error='';});
  savePendingToStorage();
  renderPendingMutations();
  errors.forEach(m=>sendAdsMutation(m));
  toast(`↻ Reintentando ${errors.length} mutación${errors.length>1?'es':''}...`,'info');
}

async function loadAdsData(){
  const cfg=getAdsConfig();
  const days=parseInt(document.getElementById('adsPeriodSelect')?.value||'30');
  ['adsAgentBox','adsCapacidadBox','adsSuggestBox'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  ['ads-kpi-gasto','ads-kpi-imp','ads-kpi-clics','ads-kpi-ctr','ads-kpi-cpc','ads-kpi-conv','ads-kpi-cpa','ads-kpi-roas'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='…';});
  if(!cfg.endpoint){
    // Modo demo
    document.getElementById('adsCampaignsArea').innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div></div>';
    await new Promise(r=>setTimeout(r,600));
    const demo=getAdsDemoData(days);
    window._adsLastData=demo;
    renderAdsKPIs(demo,days);
    renderAdsCampaigns(demo);
    renderAdsAgent(demo);
    renderAdsCapacidad(demo);
    renderAdsSugerencias(demo);
    renderPendingMutations();
    try{loadWebStats();}catch(err){console.error('loadWebStats',err);}
    const dot=document.getElementById('adsStatusDot');
    if(dot){dot.style.background='var(--warn)';dot.title='Modo demo — configura tu endpoint real';}
    return;
  }
  document.getElementById('adsCampaignsArea').innerHTML='<div class="loading-state" style="padding:40px 0"><div class="spinner"></div> Cargando Google Ads…</div>';
  try{
    const cidParam=cfg.customerId?'&customerId='+encodeURIComponent(cfg.customerId):'';
    const url=cfg.endpoint+(cfg.endpoint.includes('?')?'&':'?')+'days='+days+cidParam+'&_t='+Date.now();
    const r=await fetch(url);
    if(!r.ok) throw new Error('HTTP '+r.status);
    const data=await r.json();
    if(!data.ok) throw new Error(data.error||'Respuesta inválida del script');
    // Renders visuales aislados: un fallo en uno no debe bloquear la sincronización de mutaciones
    window._adsLastData=data;
    try{ renderAdsKPIs(data,days); }catch(err){ console.error('renderAdsKPIs',err); }
    try{ renderAdsCampaigns(data); }catch(err){ console.error('renderAdsCampaigns',err); }
    try{ renderAdsAgent(data); }catch(err){ console.error('renderAdsAgent',err); }
    try{ renderAdsCapacidad(data); }catch(err){ console.error('renderAdsCapacidad',err); }
    try{ renderAdsSugerencias(data); }catch(err){ console.error('renderAdsSugerencias',err); }
    try{ loadWebStats(); }catch(err){ console.error('loadWebStats',err); }
    renderPendingMutations();
    // Refleja en el dashboard lo que el Script 2 ya aplicó en Google Ads
    syncMutationStatuses();
    try{renderAdsAutopilot();}catch(err){}
    const _aw=document.getElementById('adsAutoWeekly');if(_aw)_aw.checked=localStorage.getItem('ads_auto_weekly')==='1';
    setTimeout(()=>{try{adsAutoWeeklyCheck();}catch(e){}},1200);
    const dot=document.getElementById('adsStatusDot');
    if(dot){dot.style.background='var(--success)';dot.title='Conectado';}
    const btnNueva=document.getElementById('btnNuevaCampana');
    if(btnNueva) btnNueva.style.display='inline-flex';
    // Sync a Airtable (no bloqueante)
    syncAdsToAirtable(data,days).then(()=>toast('✓ Google Ads sincronizado con Airtable','success')).catch(()=>{});
  }catch(e){
    // Sin configuración propia del usuario el endpoint es el default hardcodeado:
    // si falla (sin red, script caído) caemos a modo demo en vez de mostrar error
    if(!localStorage.getItem('ads_config')){
      const demo=getAdsDemoData(days);
      window._adsLastData=demo;
      try{ renderAdsKPIs(demo,days); }catch(err){}
      try{ renderAdsCampaigns(demo); }catch(err){}
      try{ renderAdsAgent(demo); }catch(err){}
      try{ renderAdsCapacidad(demo); }catch(err){}
      try{ renderAdsSugerencias(demo); }catch(err){}
      renderPendingMutations();
      try{ renderWebStats(getWebDemoData(days),days); }catch(err){}
      const dot=document.getElementById('adsStatusDot');
      if(dot){dot.style.background='var(--warn)';dot.title='Modo demo — endpoint no disponible ('+e.message+')';}
      return;
    }
    document.getElementById('adsCampaignsArea').innerHTML=`<div class="empty-state" style="padding:40px 0"><div class="empty-icon"><svg class="dashboard-icon" width="28" height="28" stroke-width="1.5"><use href="#icon-warning"/></svg></div><div style="color:var(--danger)">${e.message}</div><div style="font-size:11px;color:var(--text3);margin-top:8px">Verifica que el Apps Script esté publicado como aplicación web con acceso público</div></div>`;
    ['ads-kpi-gasto','ads-kpi-imp','ads-kpi-clics','ads-kpi-ctr','ads-kpi-cpc','ads-kpi-conv','ads-kpi-cpa','ads-kpi-roas'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—';});
    const dot=document.getElementById('adsStatusDot');
    if(dot){dot.style.background='var(--danger)';dot.title='Error: '+e.message;}
  }
}