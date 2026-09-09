/* js/seo-ads.js â€” mÃ³dulo extraÃ­do de index.html (carga en el mismo punto). */
// â”€â”€ SEO WORDPRESS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getWPConfig(){try{const s=localStorage.getItem('wp_config');if(s) return JSON.parse(s);}catch(e){}return{url:'https://thelab.solutions',user:'',pass:''};}
function saveWPConfig(){
  const url=(document.getElementById('wp-url')?.value||'').trim().replace(/\/$/,'');
  const user=(document.getElementById('wp-user')?.value||'').trim();
  const pass=(document.getElementById('wp-pass')?.value||'').trim();
  if(!url||!user||!pass){toast('Completa todos los campos','error');return;}
  localStorage.setItem('wp_config',JSON.stringify({url,user,pass}));
  toast('âœ“ Credenciales guardadas','success');
  const panel=document.getElementById('wpConfigPanel');if(panel)panel.style.display='none';
}
// El panel de WordPress se retirÃ³ al migrar el sitio: estas funciones quedan
// operativas pero no deben reventar si sus campos ya no estÃ¡n en el DOM.
function loadWPConfigForm(){
  const cfg=getWPConfig(),set=(id,v)=>{const e=document.getElementById(id);if(e&&v)e.value=v;};
  set('wp-url',cfg.url);set('wp-user',cfg.user);set('wp-pass',cfg.pass);
}
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AUDITOR SEO ON-PAGE â€” analiza las pÃ¡ginas del sitio (Next.js, sin WordPress)
// vÃ­a el proxy /seo-fetch (evita CORS; el Worker restringe a thelab.solutions).
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function _seoProxy(){
  const u=localStorage.getItem('proxy_url')||(_DEFAULTS.PROXY_URL.startsWith('%%')?'':_DEFAULTS.PROXY_URL);
  const k=localStorage.getItem('proxy_key')||(_DEFAULTS.PROXY_KEY.startsWith('%%')?'':_DEFAULTS.PROXY_KEY);
  return u&&k?{base:u.replace(/\/$/,''),key:k}:null;
}
async function _seoFetch(pageUrl){
  const p=_seoProxy();
  if(!p) throw new Error('Configura el proxy (Mi cuenta â†’ Proxy) para usar el auditor.');
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
  const ic=c.level==='ok'?'âœ“':c.level==='warn'?'!':'âœ•';
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
  add(title.length>=30&&title.length<=65, title.length>0, 'TÃ­tulo', title?(title.length+' car â€” '+title.slice(0,60)):'FALTA');
  add(desc.length>=110&&desc.length<=165, desc.length>0, 'Meta desc', desc?(desc.length+' car'):'FALTA');
  add(h1s.length===1, h1s.length>1, 'H1', h1s.length+' H1');
  add(!!canonical, false, 'Canonical', canonical?'sÃ­':'FALTA');
  add(!robots.includes('noindex'), false, 'Indexable', robots.includes('noindex')?'NOINDEX':'sÃ­');
  add(!!(ogT&&ogD&&ogI), !!(ogT||ogD||ogI), 'Open Graph', ((ogT?'T':'')+(ogD?'D':'')+(ogI?'I':''))||'FALTA');
  add(!!viewport, false, 'Viewport', viewport?'sÃ­':'FALTA');
  add(!!lang, false, 'Lang', lang||'FALTA');
  add(noAlt===0, noAlt<=2, 'Alt imÃ¡genes', noAlt===0?'todas':(noAlt+' sin alt'));
  add(words>=250, words>=120, 'Contenido', words+' palabras');
  const bad=checks.filter(function(c){return c.level==='bad';}).length;
  const warn=checks.filter(function(c){return c.level==='warn';}).length;
  const score=Math.max(0,Math.round(100-(bad*12)-(warn*5)));
  return {url:pageUrl,score:score,checks:checks,bad:bad,warn:warn};
}
async function runSeoAudit(){
  const btn=document.getElementById('seoAuditBtn'),body=document.getElementById('seoAuditBody'),scoreEl=document.getElementById('seoAuditScore');
  if(!_seoProxy()){ toast('Configura el proxy primero (Mi cuenta â†’ Proxy)','error'); return; }
  btn.disabled=true; btn.textContent='Analizandoâ€¦'; scoreEl.textContent='';
  body.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Leyendo sitemapâ€¦</div>';
  let urls=await _seoSitemap();
  if(!urls.length){ urls=['https://thelab.solutions/','https://thelab.solutions/nosotros','https://thelab.solutions/contacto','https://thelab.solutions/servicios','https://thelab.solutions/blog']; }
  urls=urls.slice(0,25);
  const rows=[];
  for(let i=0;i<urls.length;i++){
    body.innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div> Analizando '+(i+1)+'/'+urls.length+'â€¦</div>';
    try{ const html=await _seoFetch(urls[i]); rows.push(_seoAnalyze(html,urls[i])); }
    catch(e){ rows.push({url:urls[i],score:0,checks:[{level:'bad',label:'Error',detail:String(e&&e.message||e)}],bad:1,warn:0}); }
  }
  rows.sort(function(a,b){return a.score-b.score;});
  window._seoLastRows=rows;
  const avg=Math.round(rows.reduce(function(s,r){return s+r.score;},0)/(rows.length||1));
  const withIssues=rows.filter(function(r){return r.bad>0;}).length;
  const col=avg>=80?'#2ea043':avg>=60?'#ffc107':'#f85149';
  scoreEl.innerHTML='Promedio: <strong style="color:'+col+'">'+avg+'/100</strong> Â· '+withIssues+' con problemas';
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
  toast('âœ“ AuditorÃ­a SEO completa','success');
}

// â”€â”€ âœ¨ Optimizar SEO con IA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Audita (si hace falta), manda las pÃ¡ginas con problemas a Claude y
// devuelve los textos exactos (tÃ­tulo 30-65c, meta 120-158c, alt, OGâ€¦).
const SEO_IA_SYS='Eres el SEO senior de The Lab Solutions, estudio B2B de fabricaciÃ³n digital en Santiago de Chile (impresiÃ³n 3D, letras volumÃ©tricas, cartelerÃ­a y neones, premiaciones y galvanos, merchandising corporativo, activaciones y stands, papelerÃ­a, cajas personalizadas). Recibes un JSON de pÃ¡ginas con sus problemas SEO. PropÃ³n la correcciÃ³n EXACTA de cada problema. REGLAS DURAS: campo title debe quedar de 30 a 65 caracteres INCLUYENDO el sufijo " Â· The Lab Solutions" cuando corresponda (todas las pÃ¡ginas menos la home lo llevan â€” inclÃºyelo tÃº en el texto propuesto); campo metaDescription de 120 a 158 caracteres, con la keyword principal de la pÃ¡gina y un llamado a la acciÃ³n; espaÃ±ol de Chile, tono profesional B2B, sin emojis. Para problemas de altImagenes, h1, openGraph o contenido, escribe en "propuesto" la correcciÃ³n concreta (ej: el texto alt sugerido, o quÃ© H1 eliminar). Responde SOLO un JSON vÃ¡lido sin markdown ni texto extra: {"paginas":[{"url":"...","cambios":[{"campo":"title|metaDescription|openGraph|altImagenes|h1|contenido","propuesto":"...","nota":"..."}]}]}';
async function seoOptimizeIA(){
  const btn=document.getElementById('seoIABtn'),out=document.getElementById('seoIAResults');
  btn.disabled=true;btn.textContent='âœ¨ Optimizandoâ€¦';
  try{showAgentWorking('SEO',{name:'SEO',emoji:'ğŸ§­',color:'#ff6b35',verb:'estÃ¡ optimizando tu sitioâ€¦',messages:['Auditando las pÃ¡ginasâ€¦','Reescribiendo tÃ­tulos y metasâ€¦','Sugiriendo alt y Open Graphâ€¦','Puliendo cada propuestaâ€¦']});}catch(e){}
  try{
    if(!window._seoLastRows) await runSeoAudit();
    const rows=(window._seoLastRows||[]).filter(function(r){return r.checks&&r.checks.some(function(c){return c.level!=='ok';});});
    if(!rows.length){ toast('âœ“ El sitio ya estÃ¡ al 100% â€” nada que optimizar','success'); btn.disabled=false;btn.textContent='âœ¨ Optimizar con IA'; return; }
    out.style.display='block';
    const props=[];
    for(let i=0;i<rows.length;i+=3){
      out.innerHTML='<div class="loading-state" style="padding:14px 0"><div class="spinner"></div> La IA estÃ¡ redactando propuestasâ€¦ '+Math.min(i+3,rows.length)+'/'+rows.length+' pÃ¡ginas</div>';
      const batch=rows.slice(i,i+3).map(function(r){return {url:r.url,score:r.score,problemas:r.checks.filter(function(c){return c.level!=='ok';}).map(function(c){return c.label+': '+(c.detail||'');})};});
      const raw=await callAgentClaude('SEO',SEO_IA_SYS,JSON.stringify(batch));
      const start=raw.indexOf('{');
      if(start<0) throw new Error('la IA no devolviÃ³ JSON');
      const j=JSON.parse(raw.slice(start,raw.lastIndexOf('}')+1));
      (j.paginas||[]).forEach(function(p){props.push(p);});
    }
    window._seoIAProps=props;
    renderSeoIAProps(props);
    toast('âœ“ Propuestas listas â€” cÃ³pialas o baja el informe','success');
  }catch(e){
    out.style.display='block';
    out.innerHTML='<div style="font-size:12px;color:var(--danger)">Error generando propuestas: '+escapeHtml(e.message)+'</div>';
  }
  try{hideAgentWorking();}catch(e){}
  btn.disabled=false;btn.textContent='âœ¨ Optimizar con IA';
}
function renderSeoIAProps(props){
  const out=document.getElementById('seoIAResults');
  const CAMPOS={title:'TÃ­tulo',metaDescription:'Meta description',openGraph:'Open Graph',altImagenes:'Alt de imÃ¡genes',h1:'H1',contenido:'Contenido'};
  out.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">'
    +'<div style="font-size:12px;font-weight:700;color:var(--accent)">âœ¨ Propuestas de la IA ('+props.length+' pÃ¡ginas)</div>'
    +'<button class="btn btn-ghost btn-sm" onclick="seoCopyIAReport()" style="font-size:10px">ğŸ“‹ Copiar informe para aplicar</button></div>'
    +'<div style="font-size:10px;color:var(--text3);margin-bottom:8px">Copia el informe y pÃ©gaselo a Claude Code con: Â«aplica este informe SEO al repo de la webÂ» â€” o copia cada texto y aplÃ­calo a mano.</div>'
    +props.map(function(p,i){
      const path=(p.url||'').replace('https://thelab.solutions','')||'/';
      return '<div style="padding:8px 0;border-top:1px solid var(--border2)"><div style="font-size:12px;font-weight:600;margin-bottom:2px">'+escapeHtml(path)+'</div>'
        +(p.cambios||[]).map(function(c,j){
          const len=(c.propuesto||'').length;
          const esTexto=c.campo==='title'||c.campo==='metaDescription';
          const okLen=c.campo==='title'?(len>=30&&len<=65):(len>=110&&len<=165);
          return '<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:11.5px">'
            +'<span style="flex-shrink:0;min-width:118px;color:var(--text3)">'+(CAMPOS[c.campo]||escapeHtml(c.campo||''))+(esTexto?' <span style="color:'+(okLen?'var(--success)':'var(--warn)')+'">('+len+'c)</span>':'')+'</span>'
            +'<span style="flex:1;color:var(--text);word-break:break-word">'+escapeHtml(c.propuesto||'')+(c.nota?' <span style="color:var(--text3)">â€” '+escapeHtml(c.nota)+'</span>':'')+'</span>'
            +'<button class="btn btn-ghost btn-sm" style="font-size:9px;padding:1px 7px;flex-shrink:0" onclick="seoCopyProp('+i+','+j+')">Copiar</button></div>';
        }).join('')+'</div>';
    }).join('');
}
function seoCopyProp(i,j){
  const p=(window._seoIAProps||[])[i];const c=p&&p.cambios&&p.cambios[j];
  if(!c)return;
  navigator.clipboard.writeText(c.propuesto||'').then(function(){toast('âœ“ Copiado','success');}).catch(function(){toast('No se pudo copiar','error');});
}
function seoCopyIAReport(){
  const props=window._seoIAProps||[];
  let md='# Informe SEO â€” thelab.solutions ('+new Date().toLocaleDateString('es-CL')+')\n\nAplica estos cambios en el repo `thelabsolutionscl/web-thelab-solutions` (metadata/contenido de cada pÃ¡gina). Reglas: tÃ­tulo 30-65 caracteres, meta description 110-165, OG completo con imagen, todas las imÃ¡genes con alt, un solo H1 por pÃ¡gina.\n\n';
  props.forEach(function(p){
    md+='## '+p.url+'\n';
    (p.cambios||[]).forEach(function(c){ md+='- **'+c.campo+'**: '+(c.propuesto||'')+(c.nota?'  _('+c.nota+')_':'')+'\n'; });
    md+='\n';
  });
  navigator.clipboard.writeText(md).then(function(){toast('âœ“ Informe copiado â€” pÃ©gaselo a Claude Code para aplicarlo','success');}).catch(function(){toast('No se pudo copiar','error');});
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
    if(r.ok){const d=await r.json();toast(`âœ“ Conectado como ${d.name||d.slug}`,'success');}
    else toast(`Error ${r.status}: verifica credenciales`,'error');
  }catch(e){toast('Error de conexiÃ³n: '+e.message,'error');}
}
async function loadWPPages(){
  const cfg=getWPConfig();
  if(!cfg.url){const _wp=document.getElementById('wpConfigPanel');if(_wp)_wp.style.display='block';loadWPConfigForm();toast('Configura las credenciales primero','info');return;}
  // El panel de WordPress se retirÃ³ al migrar el sitio (hoy manda el Auditor SEO
  // on-page). Sin contenedor no se sigue: antes reventaba con TypeError.
  const list=document.getElementById('seoPagesList');
  if(!list){toast('El panel de WordPress ya no estÃ¡ disponible â€” usa â€œAnalizar sitioâ€ del Auditor SEO','info');return;}
  list.innerHTML='<div style="padding:30px;text-align:center;color:var(--text3)">Cargando pÃ¡ginas...</div>';
  try{
    const h=wpAuthHeader();
    const [pagesRes,postsRes]=await Promise.all([
      fetch(cfg.url+'/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,link,yoast_head_json,meta&status=publish',{headers:h}),
      fetch(cfg.url+'/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,title,link,yoast_head_json,meta&status=publish',{headers:h})
    ]);
    const pages=pagesRes.ok?await pagesRes.json():[];
    const posts=postsRes.ok?await postsRes.json():[];
    if(!pagesRes.ok) toast(`WP pÃ¡ginas: HTTP ${pagesRes.status}`,'error');
    if(!postsRes.ok) toast(`WP posts: HTTP ${postsRes.status}`,'error');
    const all=[...pages.map(p=>({...p,_type:'page'})),...posts.map(p=>({...p,_type:'post'}))];
    if(!all.length){list.innerHTML=`<div class="empty-state">${(!pagesRes.ok||!postsRes.ok)?`Error HTTP ${pagesRes.status} â€” verifica URL y credenciales WordPress`:'No se encontraron pÃ¡ginas'}</div>`;return;}
    wpPagesCache=all;
    renderSEOList(all);renderWebKPIs(all);
  }catch(e){list.innerHTML=`<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;}
}
function renderSEOList(pages){
  const list=document.getElementById('seoPagesList');
  if(!list)return;   // panel de WordPress retirado: no hay dÃ³nde pintar
  list.innerHTML=`<div class="card"><div class="card-header"><span class="card-title">PÃ¡ginas y Posts (${pages.length})</span></div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
  <thead><tr style="border-bottom:2px solid var(--border2)">
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase;white-space:nowrap">PÃ¡gina</th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase">SEO Title <span style="color:var(--text3);font-weight:400">(60 car.)</span></th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase">Meta Description <span style="color:var(--text3);font-weight:400">(155 car.)</span></th>
    <th style="padding:10px;font-size:10px;text-align:left;color:var(--text3);font-weight:700;text-transform:uppercase;white-space:nowrap">Acciones</th>
  </tr></thead><tbody>
  ${pages.map(p=>{
    const yoast=p.yoast_head_json||{};
    const curTitle=yoast.title||p.title?.rendered||'';
    const curDesc=yoast.description||'';
    const pageTitle=p.title?.rendered||p.slug||'â€”';
    const tid=`seo-title-${p.id}`;const did=`seo-desc-${p.id}`;
    return`<tr data-wpid="${p.id}" data-wptype="${p._type}" style="border-bottom:1px solid var(--border2)">
      <td style="padding:10px;min-width:140px;max-width:200px">
        <div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.3">${escapeHtml(pageTitle)}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px">${p._type==='post'?'Post':'PÃ¡gina'}</div>
        <a href="${escapeHtml(p.link||'#')}" target="_blank" style="font-size:9px;color:var(--accent);text-decoration:none">â†— ver</a>
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
          <button onclick="optimizarSEOPage('${p.id}','${escapeHtml(pageTitle)}','${p._type}')" class="btn btn-ghost btn-sm" style="font-size:10px;white-space:nowrap">âœ¨ Optimizar IA</button>
          <button onclick="saveYoastFields('${p.id}','${p._type}','${escapeHtml(p.link||'')}')" class="btn btn-primary btn-sm" style="font-size:10px">ğŸ’¾ Guardar</button>
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
  try{showAgentWorking('SEO',{name:'SEO',emoji:'ğŸ§­',color:'#ff6b35',verb:'estÃ¡ optimizando la pÃ¡ginaâ€¦',messages:['Analizando el tÃ­tulo y la metaâ€¦','Reescribiendo con la keywordâ€¦','Ajustando a los lÃ­mites de Googleâ€¦']});}catch(e){}
  try{
    const system=`Eres un experto en SEO para The Lab Solutions, empresa chilena de impresiÃ³n 3D, neones y trofeos personalizados ubicada en Santiago de Chile. Tu tarea es optimizar tÃ­tulos y meta descripciones para Google, enfocados en bÃºsquedas locales chilenas. Siempre responde SOLO con JSON vÃ¡lido, sin markdown.`;
    const user=`Optimiza el SEO de esta pÃ¡gina:
Nombre: ${pageTitle}
Tipo: ${wpType==='post'?'blog post':'pÃ¡gina web'}
SEO Title actual: ${curTitle||'(vacÃ­o)'}
Meta Description actual: ${curDesc||'(vacÃ­o)'}

Genera:
- SEO title: mÃ¡ximo 60 caracteres, incluye keyword principal y marca "The Lab Solutions" si cabe
- Meta description: mÃ¡ximo 155 caracteres, persuasiva con beneficio claro y CTA

Responde SOLO en JSON: {"title":"...","description":"..."}`;
    const raw=await callAgentClaude('SEO',system,user);
    const json=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(json.title){document.getElementById(tid).value=json.title;seoCounter(document.getElementById(tid),60,tid+'-cnt');}
    if(json.description){document.getElementById(did).value=json.description;seoCounter(document.getElementById(did),155,did+'-cnt');}
    toast('âœ“ SEO optimizado con IA â€” revisa y guarda','success');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}}
  if(btn){btn.disabled=false;btn.textContent='âœ¨ Optimizar IA';}
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
        // fields not registered â€” open diagnostic modal
        openSEODiag();
        document.getElementById('seoDiagPhpBox').style.display='block';
        document.getElementById('seoDiagSteps').innerHTML='<div style="color:var(--warn);font-size:12px;font-weight:600">âš  El SEO no se guardÃ³ â€” los campos Yoast no estÃ¡n registrados en la REST API. Agrega el snippet PHP indicado abajo y luego ejecuta el diagnÃ³stico para verificar.</div>';
        toast('âš  SEO no guardado â€” revisa el DiagnÃ³stico SEO','warn');
      } else {
        toast('âœ“ SEO guardado en WordPress','success');
        const idxBtn=document.getElementById(`idx-btn-${wpId}`);
        if(idxBtn) idxBtn.style.display='block';
      }
    }
    else{const j=await r.json().catch(()=>({}));toast(`Error ${r.status}: ${j.message||'verifica permisos'}`,'error');}
  }catch(e){toast('Error: '+e.message,'error');}
  if(btn){btn.disabled=false;btn.textContent='ğŸ’¾ Guardar';}
}
function openSEODiag(){
  const el=document.getElementById('seoDiagOverlay');
  el.style.display='flex';
  document.getElementById('seoDiagSteps').innerHTML='<div style="color:var(--text3);font-size:12px">Haz clic en "Ejecutar diagnÃ³stico" para comenzar.</div>';
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
    seoDiagStep('cfg','âŒ','Sin credenciales configuradas','Abre "âš™ Configurar WP" y guarda las credenciales.','var(--danger)');
    if(btn){btn.disabled=false;btn.textContent='â–¶ Ejecutar diagnÃ³stico';}
    return;
  }
  seoDiagStep('cfg','âœ“',`Credenciales cargadas`,`${cfg.user} @ ${cfg.url}`,'var(--success)');

  // Step 2: connectivity
  seoDiagStep('conn','â³','Comprobando conexiÃ³nâ€¦','','var(--text3)');
  try{
    const r=await fetch(cfg.url+'/wp-json/wp/v2/users/me',{headers:wpAuthHeader()});
    if(!r.ok){
      const j=await r.json().catch(()=>({}));
      seoDiagStep('conn','âŒ',`Error de autenticaciÃ³n (HTTP ${r.status})`,j.message||'Verifica usuario y Application Password.','var(--danger)');
      if(btn){btn.disabled=false;btn.textContent='â–¶ Ejecutar diagnÃ³stico';}
      return;
    }
    const me=await r.json();
    seoDiagStep('conn','âœ“',`Conectado como: ${me.name||me.slug}`,`Roles: ${(me.roles||[]).join(', ')}`,'var(--success)');
  }catch(e){
    seoDiagStep('conn','âŒ','Error de red / CORS',`${e.message} â€” WordPress puede estar bloqueando peticiones externas. Verifica que REST API estÃ© habilitada y no haya plugins de seguridad bloqueando.`,'var(--danger)');
    if(btn){btn.disabled=false;btn.textContent='â–¶ Ejecutar diagnÃ³stico';}
    return;
  }

  // Step 3a: schema check via OPTIONS
  seoDiagStep('schema','â³','Verificando esquema REST API (OPTIONS)â€¦','','var(--text3)');
  let schemaHasFields=false;
  try{
    const sr=await fetch(cfg.url+'/wp-json/wp/v2/pages',{method:'OPTIONS',headers:wpAuthHeader()});
    if(sr.ok){
      const sd=await sr.json();
      const metaProps=sd?.schema?.properties?.meta?.properties||sd?.endpoints?.[0]?.args?.meta?.properties||null;
      schemaHasFields=!!(metaProps&&metaProps._yoast_wpseo_title&&metaProps._yoast_wpseo_metadesc);
      if(schemaHasFields){
        seoDiagStep('schema','âœ“','Esquema registra campos Yoast','_yoast_wpseo_title y _yoast_wpseo_metadesc presentes en el schema','var(--success)');
      } else {
        const schemaKeys=metaProps?Object.keys(metaProps).slice(0,6).join(', '):'(sin propiedades meta en schema)';
        seoDiagStep('schema','âŒ','Campos Yoast ausentes en el schema REST',`El schema no incluye los campos. Claves meta en schema: ${schemaKeys}. El snippet PHP aÃºn no estÃ¡ activo.`,'var(--danger)');
      }
    } else {
      seoDiagStep('schema','âš ','No se pudo leer el schema (OPTIONS)',`HTTP ${sr.status} â€” continuando con verificaciÃ³n de datos.`,'var(--warn)');
    }
  }catch(e){
    seoDiagStep('schema','âš ','OPTIONS bloqueado por CORS','El servidor no permite OPTIONS â€” continuando.','var(--warn)');
  }

  // Step 3b: read meta fields â€” use cached pages from loadWPPages if available
  seoDiagStep('meta','â³','Leyendo meta de pÃ¡gina realâ€¦','','var(--text3)');
  let testPageId=null;
  let diagMeta=null;
  if(wpPagesCache.length>0){
    seoDiagStep('meta-src','â„¹','Usando datos ya cargados',`Cache tiene ${wpPagesCache.length} pÃ¡ginas/posts â€” sin fetch adicional.`,'var(--text3)');
    // reuse data already fetched by loadWPPages (avoids second CORS request)
    const p=wpPagesCache[0];
    testPageId=p.id;
    diagMeta=p.meta;
  } else {
    try{
      const r=await fetch(cfg.url+'/wp-json/wp/v2/pages?per_page=1&status=publish&_fields=id,slug,meta',{headers:wpAuthHeader()});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const items=await r.json();
      if(!items.length) throw new Error('No hay pÃ¡ginas publicadas en WordPress');
      testPageId=items[0].id;
      diagMeta=items[0].meta;
    }catch(e){
      seoDiagStep('meta','âŒ','Error al leer meta',`${e.message} â€” Abre primero la pestaÃ±a Web para que elm«ëŒ+Š×®º+º$zzb¥âÆ—7FFòFR:v–æ26&wVRÂÇVVvògVVÇfRV¦V7WF"VÂF–vì;77F–6òæÂwf"‚ÒÖFævW"’r“°¢–b†'Fâ—¶'FâæF—6&ÆVCÖfÇ6S¶'FâçFW‡D6öçFVçCÒ~)kbV¦V7WF"F–vì;77F–6òs·Ğ¢&WGW&ã°¢Ğ¢Ğ¢°¢6öç7BÖWFÖF–tÖWF°¢6öç7B†5F—FÆSÖÖWFbfÖWFå÷–ö7E÷w6Võ÷F—FÆRÓ×VæFVf–æVC°¢6öç7B†4FW63ÖÖWFbfÖWFå÷–ö7E÷w6VõöÖWFFW62Ó×VæFVf–æVC°¢–b††5F—FÆRbf†4FW62—°¢6VôF–u7FW‚vÖWFrÂ~)É2rÂt6×÷2–ö7B&Vv—7G&F÷26÷'&V7FÖVçFRrÆ÷–ö7E÷w6Võ÷F—FÆRÒ"G¶ÖWFå÷–ö7E÷w6Võ÷F—FÆWÇÂr‡f<:Öò’wÒ"Â÷–ö7E÷w6VõöÖWFFW62Ò"G²†ÖWFå÷–ö7E÷w6VõöÖWFFW67ÇÂrr’ç6Æ–6RƒÃc—ÇÂr‡f<:Öò’wÒ&Âwf"‚Ò×7V66W72’r“°¢ÒVÇ6R°¢6öç7BÖWF¶W—3ÖÖWFôö&¦V7Bæ¶W—2†ÖWF“¥µÓ°¢6öç7B&u6æ—WCÔ¥4ôâç7G&–æv–g’†ÖWF’ç6Æ–6RƒÃ#“°¢6öç7BÖWFFV'VsÖÖWF¢ò†ÖWF¶W—2æÆVæwFƒö6ÆfW2VâÖWF¢G¶ÖWF¶W—2ç6Æ–6RƒÃ‚’æ¦ö–â‚rÂr—ÒÂ&s¢G·&u6æ—WGÖ¢vÖWFW†—7FRW&òW2·Òf<:Öòr¢¢vÖWFW2çVÆÂ÷VæFVf–æVB(	Bv÷&E&W72æòW‡öæRÖWFVâW7FRVæGö–çBs°¢6VôF–u7FW‚vÖWFrÂ~)ØÂrÂt6×÷2–ö7BäòW7L:âVâÆ&W7VW7FrÆÖWFFV'VrÂwf"‚ÒÖFævW"’r“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6VôF–u‡&÷‚r’ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢–b†'Fâ—¶'FâæF—6&ÆVCÖfÇ6S¶'FâçFW‡D6öçFVçCÒ~)kbV¦V7WF"F–vì;77F–6òs·Ğ¢&WGW&ã°¢Ğ¢Ğ ¢òò7FWC¢w&—FRFW7@¢6VôF–u7FW‚ww&—FRrÂ~(û2rÂu&ö&æFòW67&—GW&FR6×ò4Tş(
brÂrrÂwf"‚Ò×FW‡C2’r“°¢G'—°¢6öç7BFW7EfÃÒuõöF–u÷FW7Eõòs°¢6öç7Bw#Öv—BfWF6‚†6frçW&Â¶÷wÖ§6öâ÷w÷c"÷vW2òG·FW7EvT–GÖÇ°¢ÖWF†öC¢uõ5BrÆ†VFW'3§wWF„†VFW"‚’À¢&öG“¤¥4ôâç7G&–æv–g’‡¶ÖWF§µ÷–ö7E÷w6Võ÷F—FÆS§FW7EfÇ×Ò¢Ò“°¢–b‚w"æö²—¶6öç7B£Öv—Bw"æ§6öâ‚’æ6F6‚‚‚“Óâ‡·Ò’“·F‡&÷ræWrW'&÷"†…EEG·w"ç7FGW7Ó¢G¶¢æÖW76vWÇÂw6–âFWFÆÆRwÖ“·Ğ¢òòfW&–g’w&—FRW'6—7FV@¢6öç7Bg#Öv—BfWF6‚†6frçW&Â¶÷wÖ§6öâ÷w÷c"÷vW2òG·FW7EvT–GÖÇ¶†VFW'3§wWF„†VFW"‚—Ò“°¢6öç7BfC×g"æö³öv—Bg"æ§6öâ‚“§·Ó°¢6öç7Bw&—GFVã×fBæÖWFbgfBæÖWFå÷–ö7E÷w6Võ÷F—FÆSÓÓ×FW7EfÃ°¢–b‡w&—GFVâ—°¢6VôF–u7FW‚ww&—FRrÂ~)É2rÂtW67&—GW&fW&–f–6F(	BVÂwV&FFò4TògVæ6–öærÂtVÂ6×ò÷–ö7E÷w6Võ÷F—FÆR6RwV&L;2’6RÆWœ;26÷'&V7FÖVçFRârÂwf"‚Ò×7V66W72’r“°¢òò&W7F÷&R†÷F–öæÂ(	BÆVfRFW7BfÇVRÂ–ö7Bv–ÆÂ÷fW'w&—FRöâæW‡B6fRg&öÒuFÖ–â¢6VôF–u7FW‚vFöæRrÂ	øè’rÂuFöFòÆ—7FòrÂuVVFW2wV&F"4TòFW6FRVÂF6†&ö&B6–â&ö&ÆVÖ2ârÂwf"‚ÒÖ66VçB’r“°¢ÒVÇ6R°¢6VôF–u7FW‚ww&—FRrÂ~)ªrÂtW67&—GW&6WFFW&òfÆ÷"æòW'6—7Fœ;2rÆv÷&E&W726WL;2VÂõ5B„…EEG·w"ç7FGW7Ò’W&òVÂfÆ÷"Æ\:ÖFòFRgVVÇFæò6ö–æ6–FRâVVFR6W"Vâ66†RòVâÇVv–âFR6VwW&–FBæÂwf"‚Ò×v&â’r“°¢Ğ¢Ö6F6‚†R—°¢6VôF–u7FW‚ww&—FRrÂ~)ØÂrÂtW'&÷"ÂW67&–&—"6×ò4TòrÆRæÖW76vRÂwf"‚ÒÖFævW"’r“°¢Ğ¢–b†'Fâ—¶'FâæF—6&ÆVCÖfÇ6S¶'FâçFW‡D6öçFVçCÒ~)kbV¦V7WF"F–vì;77F–6òs·Ğ§Ğ¦gVæ7F–öâ6÷•4TôF–u6æ—WB‚—°¢6öç7B6öFSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w6VôF–u‡6öFRr“òçFW‡D6öçFVçGÇÂrs°¢æf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B†6öFR’çF†Vâ‚‚“ÓçFö7B‚~)É2<;6F–vò…6÷–FòrÂw7V66W72r’’æ6F6‚‚‚“Óç°¢6öç7BFÖFö7VÖVçBæ7&VFTVÆVÖVçB‚wFW‡F&Vr“·FçfÇVSÖ6öFS¶Fö7VÖVçBæ&öG’æVæD6†–ÆB‡F“·Fç6VÆV7B‚“¶Fö7VÖVçBæW†V46öÖÖæB‚v6÷’r“¶Fö7VÖVçBæ&öG’ç&VÖ÷fT6†–ÆB‡F“·Fö7B‚~)É2<;6F–vò…6÷–FòrÂw7V66W72r“°¢Ò“°§Ğ¦7–æ2gVæ7F–öâFW7E–ö7Ew&—FR‚—¶÷Vå4TôF–r‚“¶v—B'Vå4TôF–r‚“·Ğ¢òò)H)HtôôtÄRE2tTåB)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò)H)H6æ6†÷B†—7L;7&–6ò)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâG56fU6æ6†÷B†FFÆF—2—°¢ÆWB6æ3·G'—·6æ3Ô¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚vG5÷6æ6†÷G2r—ÇÂuµÒr“·Ö6F6‚†R—·6æ3ÕµÓ·Ğ¢6öç7BFöF“Ö†÷”4Â‚“°¢6öç7B–×ÖFFæ–×&W6–öæW7ÇÃÆ6Æ–73ÖFFæ6Æ–77ÇÃÆv7FóÖFFæv7F÷ÇÃ°¢6öç7B6öçcÖFFæ6öçfW'6–öæW7ÇÃ°¢6öç7B7G#Ö–×ãò†6Æ–72ö–×£“£°¢6öç7B&ö3Öv7Fóãbb†FFçfÆ÷%ö6öçfW'6–öçÇÃ“ãöFFçfÆ÷%ö6öçfW'6–öâöv7Fó£°¢òòfW&FB5$Ó¢–æw&W6÷2æWF÷2²ÆVG2FVÂÖ—6ÖòW,:ÖöFòÂ&VRVÂvVçFRfVÆF—&V66œ;6â$TÀ¢ÆWB–æw&W6ô5$ÓÓÆÆVG3Ó°¢G'—°¢6öç7B7WFöfcÖæWrFFR„FFRææ÷r‚’ÖF—2£ƒcC“°¢–æw&W6ô5$ÓÒ‡7FFRçVF–F÷7ÇÅµÒ’æf–ÇFW"‡Óç¶6öç7Bc×æf–VÆG3¶–b‚†e²tW7FFòVF–Fòu×ÇÂrr“ÓÓÒt6æ6VÆFòr—&WGW&âfÇ6S¶6öç7BFC×æ7&VFVEF–ÖSöæWrFFR‡æ7&VFVEF–ÖR“¦çVÆÃ·&WGW&âFBbfFCãÖ7WFöfc·Ò’ç&VGV6R‚‡2Ç“Óç2´ÖF‚ç&÷VæB‚‡æf–VÆG5²tÖöçFòF÷FÂ„4Å’u×ÇÃ’óã’’Ã“°¢ÆVG3Ò‡7FFRæ6Æ–VçFW7ÇÅµÒ’æf–ÇFW"†3Óç¶6öç7BFCÖ2æ7&VFVEF–ÖSöæWrFFR†2æ7&VFVEF–ÖR“¦çVÆÃ·&WGW&âFBbfFCãÖ7WFöfc·Ò’æÆVæwFƒ°¢Ö6F6‚†R—·Ğ¢6öç7B&ö5&VÃÖv7Fóãö–æw&W6ô5$Òöv7Fó£°¢òò‡VVÆÆ÷"6×;†–N(i&v7Fòö6öçb’&FWFV7F"æöÖÌ:Ö2æ—fVÂ6×;¢6öç7B6×3×·Ó²†FFæ6×æ7ÇÅµÒ’æf÷$V6‚†3Óç¶–b†2bf2æ–BÖçVÆÂ–6×5¶2æ–EÓ×¶v7Fó¦2æv7F÷ÇÃÆ6öçc¦2æ6öçfW'6–öæW7ÇÃÓ·Ò“°¢6öç7B6æ×¶FFS§FöF’ÇG3¦æWrFFR‚’çFô•4õ7G&–ær‚’Æv7FòÆ6Æ–72Æ6öçbÇ&ö2Æ–×Æ7G"ÆF—2Æ–æw&W6ô5$ÒÆÆVG2Ç&ö5&VÂÆ6×7Ó°¢6öç7B–Gƒ×6æ2æf–æD–æFW‚‡3Óç2æFFSÓÓ×FöF’“°¢–b†–GƒãÓ’6æ5¶–G…Ó×6æ²VÇ6R6æ2çW6‚‡6æ“°¢6æ2ç6÷'B‚†Æ"“ÓææFFRæÆö6ÆT6ö×&R†"æFFR’“°¢–b‡6æ2æÆVæwFƒã3’6æ2ç7Æ–6RƒÇ6æ2æÆVæwF‚Ó3“°¢Æö6Å7F÷&vRç6WD—FVÒ‚vG5÷6æ6†÷G2rÄ¥4ôâç7G&–æv–g’‡6æ2’“°¢Æö6Å7F÷&vRç6WD—FVÒ‚vG5öÆ7E÷7–æ2rÆæWrFFR‚’çFô•4õ7G&–ær‚’“°§Ğ¦gVæ7F–öâG4vWE&We6æ6†÷B†F—2—°¢ÆWB6æ3·G'—·6æ3Ô¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚vG5÷6æ6†÷G2r—ÇÂuµÒr“·Ö6F6‚†R—·6æ3ÕµÓ·Ğ¢òò6ö×&"4ôÄò6öçG&Vâ6æ6†÷BFVÂÔ•4ÔòÆ&vòFRfVçFæâÆ÷2F÷FÆW0¢òò†–×&W6–öæW2ö6Æ–72ö6öçfW'6–öæW2’W66Æâ6öâÆ÷2L:Ö2Â<:ÒVRFöÖ"VÀ¢òò6æ6†÷BçFW&–÷"6–âÖ—&"F—66ö×&&rg23L:Ö2’–çF&7V&–F2ğ¢òò6:ÖF2fÇ62FRì+3Râ6æ2f÷&FVæFò÷"fV6†²VÂFR„õ’W2VÂ;¦ÇF–Öğ¢òò†Ö—6ÖòFFV“²VÂ&çFW&–÷""l:Æ–FòW2VÂÜ:2&V6–VçFRåDU2FR†÷’6öâ–wVÂF—6à¢6öç7BFöF“Ö†÷”4Â‚“°¢6öç7B&Wf–÷3×6æ2æf–ÇFW"‡3Óç2bg2æFFRÓ×FöF’bb†F—3ÓÖçVÆÇÇÇ2æF—3ÓÓÖF—2’“°¢&WGW&â&Wf–÷2æÆVæwFƒ÷&Wf–÷5·&Wf–÷2æÆVæwF‚ÓÓ¦çVÆÃ°§Ğ¦gVæ7F–öâG4Æ7E7–æ57G"‚—°¢6öç7BG3ÖÆö6Å7F÷&vRævWD—FVÒ‚vG5öÆ7E÷7–æ2r“°¢–b‚G2’&WGW&ârs°¢6öç7BF–fcÔFFRææ÷r‚’ÖæWrFFR‡G2’ævWEF–ÖR‚“°¢6öç7BÖ–ç3ÔÖF‚æfÆö÷"†F–fbóc“°¢–b†Ö–ç3Ã’&WGW&âv7GVÆ—¦Fò†÷&s°¢–b†Ö–ç3Ãc’&WGW&âv†6Rr¶Ö–ç2²rÖ–âs°¢6öç7B‡'3ÔÖF‚æfÆö÷"†F–fbó3c“°¢–b†‡'3Ã#B’&WGW&âv†6Rr¶‡'2²v‚s°¢&WGW&âv†6Rr´ÖF‚æfÆö÷"†F–fbóƒcC’²vBs°§Ğ¢òò)H)HÌ:ÖæV2FR&öGV66œ;6â(iB6×;2vöövÆRG2)H)H)H)H)H)H)H)H)H)H)H ¦6öç7BE5ôDTdTÅEõU$ÃÒv‡GG3¢ò÷F†VÆ"ç6öÇWF–öç2s°¢òòvV&†öö²FRÖ¶RVR7&VVÂ&666,;6â"FR6×;l:ÖÆ’&VÂFRvöövÆP¢òòG2†6öâÆFV6Æ&6œ;6âFRçVæ6–÷2öÌ:×F–6÷2TRVRVÂ55bæòVVFR6WFV"’à¢òòVÂ67&—B"6ö×ÆWFÆ6×;†¶W—v÷&G2õ%4öæVvF—f2’Vâ7R,;7†–Ö6÷'&–Fà¦6öç7BE5ôÔ´Uõ4„TÄÃ×·W&Ã¢v‡GG3¢òö†öö²çW3"æÖ¶Ræ6öÒóFÇg—&óFG6æ·&—wFV#vÖsSCC&G7²rÆ6ÆfS¢wFÂÖ666&öâÓ–c#v3FwÓ°¢òò–BÓÓÒ6ÇVrFRÆÆæF–ær÷6W'f–6–÷2óÇ6ÇVsââf–æÅW&Â6R&ÖVâ÷Vä7&VFT6×–vä'”Æ–æV–Bà¦6öç7BE5ôÄ”äT3Õ°¢¶–C¢v7F—f6–öæW2rÇ6ÇVs¢v7F—f6–öæW2rÆÆ&VÃ¢t7F—f6–öæW2rÆ6×;7VvW&–F¢t,;§7VVFÒ7F—f6–öæW2FRÖ&6rÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£cÀ¢Æ'&46ÆfS¥²v7F—f6–öæW2FRÖ&6rÂv7F—f6–öæW2'FÂrÂv7F—f6–öâFRÖ&6V×&W6rÂw7FæG2&7F—f6–öârÂv7F—f6–öæW2V&Æ–6—F&–2rÂw&öGV66–öâFRWfVçF÷2'FÂrÂv7F—f6–öâÖ&66çF–vòrÂvÖöçF¦RFR7F—f6–öæW2uÒÀ¢F—GVÆ÷3¥²t7F—f6–öæW2FRÖ&6rÂt7F—f6–öæW2%DÂÖVF–FrÂu7FæG2’ÖöçF¦W2FRÖ&6rÂu&öGV66œ;6âFR7F—f6–öæW2rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²t7F—f6–öæW2FRÖ&6’%DÂ&öGV6–F2VæB×FòÖVæB&GR6×;òWfVçFòârÂtF—6\;òÂf'&–66œ;6â’ÖöçF¦Râ6÷F—¦GR7F—f6œ;6âVâ6çF–vòâu×ÒÀ¢¶–C¢w&VÖ–6–öæW2rÇ6ÇVs¢w&VÖ–6–öæW2rÆÆ&VÃ¢u&VÖ–6–öæW2rÆ6×;7VvW&–F¢t,;§7VVFÒ&VÖ–6–öæW2’vÇfæ÷2rÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£cÀ¢Æ'&46ÆfS¥²vvÇfæ÷2W'6öæÆ—¦F÷2rÂwG&öfV÷2W'6öæÆ—¦F÷2rÂwG&öfV÷26÷'÷&F—f÷2rÂvÖVFÆÆ2W'6öæÆ—¦F2rÂvvÇfæòFR&V6öæö6–Ö–VçFòrÂw&VÖ–÷2&V×&W6rÂw&V6öæö6–Ö–VçF÷26÷'÷&F—f÷2rÂwG&öfV÷2&&VÖ–6–öârÂwÆ6FR&V6öæö6–Ö–VçFòuÒÀ¢F—GVÆ÷3¥²tvÇfæ÷2’G&öfV÷2rÂu&VÖ–6–öæW26÷'÷&F—f2rÂuG&öfV÷2W'6öæÆ—¦F÷2rÂtÖVFÆÆ2’&V6öæö6–Ö–VçF÷2rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²tvÇfæ÷2ÂG&öfV÷2’ÖVFÆÆ2W'6öæÆ—¦F÷2&&VÖ–"GRWV—òârÂtf'&–66œ;6âÖVF–F&GR&VÖ–6œ;6âFRf–âFR;òâ6÷F—¦öæÆ–æRâu×ÒÀ¢¶–C¢vÖW&6†æF—6–ærrÇ6ÇVs¢vÖW&6†æF—6–ærrÆÆ&VÃ¢tÖW&6†æF—6–ærrÆ6×;7VvW&–F¢t,;§7VVFÒÖW&6†æF—6–ær6÷'÷&F—fòrÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£cÀ¢Æ'&46ÆfS¥²vÖW&6†æF—6–ær6÷'÷&F—fòrÂw&VvÆ÷26÷'÷&F—f÷2rÂv'F–7VÆ÷2&öÖö6–öæÆW2rÂw&VvÆ÷26÷'÷&F—f÷2÷"Ö–÷"rÂvÖW&6†æF—6–ærW'6öæÆ—¦FòrÂw&öGV7F÷2&öÖö6–öæÆW2V×&W6rÂv¶—BFR&–VçfVæ–F6÷'÷&F—fòrÂw&VvÆ÷2&V×&W62uÒÀ¢F—GVÆ÷3¥²tÖW&6†æF—6–ær6÷'÷&F—fòrÂu&VvÆ÷26÷'÷&F—f÷2rÂt'L:Ö7VÆ÷2&öÖö6–öæÆW2rÂt¶—G2&V×&W62rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²tÖW&6†æF—6–ær’&VvÆ÷26÷'÷&F—f÷2W'6öæÆ—¦F÷2&GRÖ&6ârÂt¶—G2Â'L:Ö7VÆ÷2&öÖö6–öæÆW2’6·2÷"Ö–÷"â6÷F—¦&GRV×&W6âu×ÒÀ¢¶–C¢v6¦2×W'6öæÆ—¦F2rÇ6ÇVs¢v6¦2×W'6öæÆ—¦F2rÆÆ&VÃ¢t6¦2W'6öæÆ—¦F2rÆ6×;7VvW&–F¢t,;§7VVFÒ6¦2’6¶v–ærrÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£CÀ¢Æ'&46ÆfS¥²v6¦2W'6öæÆ—¦F2rÂw6¶v–ærW'6öæÆ—¦FòrÂv6¦2&6¶v–ærrÂv6¦2FR&VvÆòW'6öæÆ—¦F2rÂw6¶v–ær6÷'÷&F—fòrÂv6¦26öâÆövòV×&W6rÂv6¦2&–v–F2W'6öæÆ—¦F2rÂw6¶v–ærÖVF–FuÒÀ¢F—GVÆ÷3¥²t6¦2W'6öæÆ—¦F2rÂu6¶v–ærÖVF–FrÂt6¦26öâGRÆövòrÂu6¶v–ær6÷'÷&F—fòrÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²t6¦2’6¶v–ærW'6öæÆ—¦F÷2&&VvÆòò&öGV7Fò6÷'÷&F—fòârÂtF—6\;ò’f'&–66œ;6âFR6¦2ÖVF–F6öâGRÖ&6â6÷F—¦öæÆ–æRâu×ÒÀ¢¶–C¢v–×&W6–öâÓ6BrÇ6ÇVs¢v–×&W6–öâÓ6BrÆÆ&VÃ¢t–×&W6œ;6â4BrÆ6×;7VvW&–F¢t,;§7VVFÒ–×&W6œ;6â4B6çF–vòrÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£ƒÀ¢Æ'&46ÆfS¥²v–×&W6œ;6â6B6çF–vòrÂv–×&W6œ;6â6BrÂw6W'f–6–òFR–×&W6–öâ6BrÂw–W¦26BÖVF–FrÂw&÷F÷F—ò6BrÂvf'&–66–öâ6BrÂv–×&W6–öâ6B&V×&W62rÂvÖöFVÆ÷2’ÖVWF26BrÂw&WVW7F÷2–×&W6÷26BuÒÀ¢F—GVÆ÷3¥²t–×&W6œ;6â4BVâ6çF–vòrÂu–W¦2’&÷F÷F—÷24BrÂt–×&W6œ;6â4BÖVF–FrÂtf'&–66œ;6â4BV×&W62rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²t–×&W6œ;6â4B&öfW6–öæÃ¢–W¦2Â&÷F÷F—÷2’&WVW7F÷2ÖVF–FârÂtÆÆWfÖ÷2GR–FVVæ–W¦&VÂâ6÷F—¦GR&÷–V7Fò4BVâ6çF–vòâu×ÒÀ¢¶–C¢wföÇVÖWG&–6÷2rÇ6ÇVs¢wföÇVÖWG&–6÷2rÆÆ&VÃ¢uföÇVÜ:—G&–6÷2rÆ6×;7VvW&–F¢t,;§7VVFÒföÇVÜ:—G&–6÷2’æ\;6âÄTBrÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£SÀ¢Æ'&46ÆfS¥²vÆWG&26÷'÷&V2rÂvÆWG&2föÇVÖWG&–62rÂvÆövò6÷'÷&VòrÂvÆWG&W&òæVöâÆVBrÂvÆWG&26B&V×&W6rÂvÆWG&W&÷2ÇVÖ–æ÷6÷2ÆVBrÂvW7G'V7GW&2&WfVçF÷2rÂvÆWG&26÷'÷&V27&–Æ–6òrÂvæVöâW'6öæÆ—¦FòuÒÀ¢F—GVÆ÷3¥²tÆWG&26÷';7&V2’æ\;6ârÂuföÇVÜ:—G&–6÷2ÖVF–FrÂtÆWG&W&÷2æ\;6âÄTBrÂtÆöv÷26÷';7&V÷24BrÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²tÆWG&26÷';7&V2ÂÆöv÷24B’æ\;6âÄTBW'6öæÆ—¦F÷2&GRÖ&6ârÂuföÇVÜ:—G&–6÷2’W7G'V7GW&2&öf–6–æòWfVçFòâ6÷F—¦ÖVF–Fâu×ÒÀ¢¶–C¢v6'FVÆW&–rÇ6ÇVs¢v6'FVÆW&–rÆÆ&VÃ¢t6'FVÆW,:ÖrÆ6×;7VvW&–F¢t,;§7VVFÒ6'FVÆW,:Ö’6\;Ì:—F–6rÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£cÀ¢Æ'&46ÆfS¥²w6\;ÆWF–66÷'÷&F—frÂw6\;ÆWF–67&–Æ–6òrÂvÆWG&W&ò7&–Æ–6òrÂv6'FVÆW&–V×&W6rÂw6\;Æ—¦6–öâV×&W6rÂw&÷GVÆ÷26÷'÷&F—f÷2rÂv6÷'FR’w&&FòÆ6W"rÂwÆ627&–Æ–6òrÂvÆWG&W&÷2&öf–6–æuÒÀ¢F—GVÆ÷3¥²t6'FVÆW,:Ö’6\;Ì:—F–6rÂu6\;Ì:—F–6Vâ7,:ÖÆ–6òrÂtÆWG&W&÷2&V×&W62rÂu,;7GVÆ÷2’Æ62ÖVF–FrÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²t6'FVÆW,:Ö’6\;Ì:—F–66÷'÷&F—fVâ7,:ÖÆ–6ò6öâ6÷'FRÌ:6W"ârÂtÆWG&W&÷2Â,;7GVÆ÷2’Æ62ÖVF–F&GRV×&W6â6÷F—¦öæÆ–æRâu×ÒÀ¢¶–C¢wVÆW&–rÇ6ÇVs¢wVÆW&–rÆÆ&VÃ¢uVÆW,:ÖrÆ6×;7VvW&–F¢t,;§7VVFÒVÆW,:Ö6÷'÷&F—frÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£3À¢Æ'&46ÆfS¥²wVÆW&–6÷'÷&F—frÂwF&¦WF2FR&W6VçF6–öârÂv–×&VçF6÷'÷&F—frÂvÖVÖ'&WFRW'6öæÆ—¦FòrÂv6'WF26÷'÷&F—f2rÂw6VÆÆ÷2&V×&W6rÂv–×&W6–öâ6÷'÷&F—f6çF–vòrÂwF&¦WF2FR&W6VçF6–öâV×&W6uÒÀ¢F—GVÆ÷3¥²uVÆW,:Ö6÷'÷&F—frÂuF&¦WF2’ÖVÖ'&WFW2rÂt–×&VçF&V×&W62rÂu6VÆÆ÷2’6'WF2rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²uVÆW,:Ö6÷'÷&F—f¢F&¦WF2ÂÖVÖ'&WFW2Â6VÆÆ÷2’6'WF2ârÂt–ÖvVâ&öfW6–öæÂ&GRV×&W6â6÷F—¦GRVÆW,:ÖöæÆ–æRâu×ÒÀ¢¶–C¢v6†—×F†RÖÆ"rÇ6ÇVs¢v6†—×F†RÖÆ"rÆÆ&VÃ¢t6†—F†RÆ"„äd2’rÆ6×;7VvW&–F¢t,;§7VVFÒF&¦WF2äd2rÇF—ó¢u4T$4‚rÇ&W7WVW7Fó£3À¢Æ'&46ÆfS¥²wF&¦WF2æf2rÂwF&¦WFFR&W6VçF6–öâæf2rÂwF&¦WFF–v—FÂæf2rÂwF&¦WF2æf2V×&W6rÂwF&¦WFæf2W'6öæÆ—¦FrÂwF&¦WFFR6öçF7Fòæf2rÂwF&¦WF2–çFVÆ–vVçFW2æf2rÂvæf26†–ÆRuÒÀ¢F—GVÆ÷3¥²uF&¦WF2äd2rÂuF&¦WFF–v—FÂäd2rÂuF&¦WF2äd2ÖVF–FrÂtäd2&V×&W62rÂuF†RÆ"6öÇWF–öç2uÒÀ¢FW67&—6–öæW3¥²uF&¦WF2FR&W6VçF6œ;6âäd2W'6öæÆ—¦F3¢6ö×'FRGR6öçF7FòÂFö6"ârÂuF&¦WF2–çFVÆ–vVçFW2äd2&GRWV—òâ6÷F—¦Æ2GW–2öæÆ–æRâu×ÒÀ¥Ó°¦gVæ7F–öâöG4ÖF6„6×–vâ†6×æ2ÆÆ–æV—°¢–b‚6×æ7ÇÂ6×æ2æÆVæwF‚’&WGW&âçVÆÃ°¢6öç7B·w3Õ°¢ââæÆ–æVæ6×;7VvW&–FçFôÆ÷vW$66R‚’ç&WÆ6R‚õ¾(	5ÂÕÒörÂrr’ç7Æ—B‚õÇ2²ò’æf–ÇFW"‡sÓçræÆVæwFƒã2’À¢âââ†Æ–æVçÆ'&46ÆfWÇÅµÒ’æfÆDÖ†³Óæ²çFôÆ÷vW$66R‚’ç7Æ—B‚õÇ2²ò’æf–ÇFW"‡sÓçræÆVæwFƒã2’¢Ó°¢&WGW&â6×æ2æf–æB†3Óæ·w2ç6öÖR†³Óâ†2ææöÖ'&WÇÂrr’çFôÆ÷vW$66R‚’æ–æ6ÇVFW2†²’’—ÇÆçVÆÃ°§Ğ¦gVæ7F–öâG46÷”·r†Væ6öFVB—°¢6öç7B·sÖFV6öFUU$”6ö×öæVçB†Væ6öFVB“°¢æf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B†·r’çF†Vâ‚‚“ÓçFö7B‚~)É2"r¶·r²r"6÷–FòrÂw7V66W72r’’æ6F6‚‚‚“Óç·Ò“°§Ğ¦gVæ7F–öâG46÷”ÆÄ·r†Æ–æV–B—°¢6öç7BÃÔE5ôÄ”äT2æf–æB‡ƒÓç‚æ–CÓÓÖÆ–æV–B“°¢–b‚ÇÇÂÂçÆ'&46ÆfR’&WGW&ã°¢æf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B†ÂçÆ'&46ÆfRæ¦ö–â‚uÆâr’’çF†Vâ‚‚“ÓçFö7B‚~)É2r¶ÂçÆ'&46ÆfRæÆVæwF‚²rÆ'&26ÆfR6÷–F2rÂw7V66W72r’’æ6F6‚‚‚“Óç·Ò“°§Ğ¦gVæ7F–öâvWD66–FDÆ–æV2‚—°¢6öç7BFöF“ÖæWrFFR‚“·FöF’ç6WD†÷W'2ƒÃÃÃ“°¢6öç7BF÷s×FöF’ævWDF’‚“°¢6öç7BÇVæW3ÖæWrFFR‡FöF’“¶ÇVæW2ç6WDFFR‡FöF’ævWDFFR‚’Ò†F÷sÓÓÓóc¦F÷rÓ’“°¢6öç7BF–3Ô'&’æg&öÒ‡¶ÆVæwFƒ£WÒÂ…òÆ’“Óç¶6öç7BCÖæWrFFR†ÇVæW2“¶Bç6WDFFR†ÇVæW2ævWDFFR‚’¶’“·&WGW&âBçFô•4õ7G&–ær‚’ç6Æ–6RƒÃ“·Ò“°¢6öç7B6Æ56Æ÷G3Ö–G3Óç°¢ÆWBF÷FÃÓÆVåW6óÓÆVäÖçCÓ°¢–G2æf÷$V6‚†–CÓç°¢6öç7BtÖçCÖvWDÖV–æW7FFôvÆö&Â†–B“ÓÓÒvÖçFVæ6–öâs°¢F–2æf÷$V6‚†G3Óç°¢F÷FÂ²³°¢6öç7BWcÒ†ÖV–æ7FFRæWfVçF÷7ÇÇ·Ò•¶G¶–GÕòG¶G7ÖÓ°¢–b†tÖçGÇÆWcòçF—óÓÓÒvÖçFVæ6–öâr’VäÖçB²³°¢VÇ6R–b†WcòçF—óÓÓÒwW6òr’VåW6ò²³°¢Ò“°¢Ò“°¢6öç7BF—7ÔÖF‚æÖ‚‡F÷FÂÖVäÖçBÃ“°¢&WGW&ç¶VåW6òÆF—7Ç7C¤ÖF‚æÖ–â„ÖF‚ç&÷VæB†VåW6òöF—7£’Ã—Ó°¢Ó°¢ÆWBfFÕ6ÖÆÄ–G3ÕµÒÆfFÔÆ&vT–G3ÕµÓ°¢G'—°¢fFÕ6ÖÆÄ–G3ÔÔT”ä2æf–ÇFW"†ÓÓå²t³rÂt³"rÂt³"ÇW2rÂtVæFW"ÓRÖ‚uÒæ–æ6ÇVFW2†ÒæÖöFVÆò’’æÖ†ÓÓæÒæ–B“°¢fFÔÆ&vT–G3ÔÔT”ä2æf–ÇFW"†ÓÓæÒæÖöFVÆóÓÓÒtv–vr’æÖ†ÓÓæÒæ–B“°¢Ö6F6‚†R—·Ğ¢6öç7BfFÕ3Ö6Æ56Æ÷G2†fFÕ6ÖÆÄ–G2“°¢6öç7BfFÔÃÖ6Æ56Æ÷G2†fFÔÆ&vT–G2“°¢6öç7B7F—f÷3Ò‡7FFRçVF–F÷7ÇÅµÒ’æf–ÇFW"‡Óç¶6öç7BSÒ‡æf–VÆG7ÇÇ·Ò•²tW7FFòVF–Fòu×ÇÂrs·&WGW&â²tFW76†FòrÂt6ö×ÆWFFòrÂt6æ6VÆFòuÒæ–æ6ÇVFW2†R“·Ò’æÆVæwFƒ°¢6öç7BVE7CÔÖF‚æÖ–â„ÖF‚ç&÷VæB†7F—f÷2ó#£’Ã“°¢6öç7B6VÓ×7CÓç°¢–b‡7CãÓƒR’&WGW&ç·3¢	ùKBrÆ¢uU4"rÆÓ¢tÌ:ÖæV6GW&F(	B6öç6–FW&W6"6×;2&æò6öÆ6"&öGV66œ;6ârÆ3¢wf"‚ÒÖFævW"’wÓ°¢–b‡7CãÓcR’&WGW&ç·3¢	ùúrÆ¢u$TET4•"rÆÓ¢t6&vÇF(	B&VGV6RVÂ&W7WVW7Fòã3R&6öçG&öÆ"VÂfÇV¦òFRVF–F÷2rÆ3¢wf"‚Ò×v&â’wÓ°¢–b‡7CÃC’&WGW&ç·3¢	ùú"rÆ¢t5D•d"rÆÓ¢t66–FBF—7öæ–&ÆR(	B7F—fòVÖVçFVÂ&W7WVW7Fò&6F"Ü:2FVÖæFrÆ3¢wf"‚Ò×7V66W72’wÓ°¢&WGW&ç·3¢~)ª¢rÆ¢tÔåDTäU"rÆÓ¢t6&vÖöFW&F(	BÖçL:–âVÂ&W7WVW7Fò7GVÂrÆ3¢wf"‚ÒÖ66VçB’wÓ°¢Ó°¢6öç7BÖµ&÷sÒ†–BÆÆ&VÂÇ7BÆ–æfòÆÆ–G2“Óâ‡¶–BÆÆ&VÂÇ7BÆ–æfòÆÆ–æV4–G3¦Æ–G2Âââç6VÒ‡7B—Ò“°¢&WGW&å°¢Öµ&÷r‚s6E÷6ÖÆÂrÂtdDÒ6ÖÆÂ„³ô³"ôVæFW"’rÆfFÕ2ç7BÆfFÕ2æVåW6ò²ròr¶fFÕ2æF—7²r6Æ÷G2W7F6VÖærÅ²v–×&W6–öâÓ6BuÒ’À¢Öµ&÷r‚s6EöÆ&vRrÂtdDÒÆ&vR„v–v’rÆfFÔÂç7BÆfFÔÂæVåW6ò²ròr¶fFÔÂæF—7²r6Æ÷G2W7F6VÖærÅ²v–×&W6–öâÓ6BuÒ’À¢Öµ&÷r‚vÆ6W"rÂtÌ:6W"ò6'FVÆW,:ÖrÇVE7BÆ7F—f÷2²rVF–F÷27F—f÷2Vâ6öÆrÅ²v6'FVÆW&–uÒ’À¢Öµ&÷r‚vÖçVÂrÂtÖçVÂ…&VÖ–6–öæW2+rÖW&6‚+rVÆW,:Ö+r÷G&÷2’rÇVE7BÆ7F—f÷2²rVF–F÷27F—f÷2Vâ6öÆrÅ²w&VÖ–6–öæW2rÂvÖW&6†æF—6–ærrÂwVÆW&–rÂv7F—f6–öæW2rÂv6¦2×W'6öæÆ—¦F2rÂwföÇVÖWG&–6÷2rÂv6†—×F†RÖÆ"uÒ’À¢Ó°§Ğ¦gVæ7F–öâ&VæFW$G466–FB†FF—°¢6öç7B&÷ƒÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG466–FD&÷‚r“°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG466–FDÆ—7Br“°¢–b‚&÷‡ÇÂÆ—7B’&WGW&ã°¢ÆWBf–Æ3°¢G'—²f–Æ3ÖvWD66–FDÆ–æV2‚“²Ğ¢6F6‚†R—²&÷‚ç7G–ÆRæF—7Æ“ÒvæöæRs²&WGW&ã²Ğ¢6öç7B6×3ÖFFæ6×æ7ÇÅµÓ°¢öG46'Få7F÷&SÕµÓ°¢Æ—7Bæ–ææW$…DÔÃÖf–Æ2æÖ‚†bÆf’“Óç°¢6öç7BÖF6†VD6×3ÖbæÆ–æV4–G2æfÆDÖ†Æ–CÓç°¢6öç7BÆ–æVÔE5ôÄ”äT2æf–æB†ÃÓæÂæ–CÓÓÖÆ–B“°¢&WGW&âÆ–æVõµöG4ÖF6„6×–vâ†6×2ÆÆ–æV•Òæf–ÇFW"„&ööÆVâ“¥µÓ°¢Ò“°¢6öç7BVæ—VSÕ²ââææWrÖ†ÖF6†VD6×2æÖ†3Óå¶2æ–BÆ5Ò’’çfÇVW2‚•Ó°¢6öç7Bf—'7D7F—fS×Væ—VRæf–æB†3Óæ2æW7FFóÓÓÒtTä$ÄTBr“°¢6öç7Bf—'7Dç“×Væ—VU³×ÇÆçVÆÃ°¢ÆWB'Fä‡FÖÃÒrs°¢6öç7BÖ´'FãÒ†Æ&VÂÇ7G–ÆR“Óç¶6öç7B–GƒÕöG46'Få7F÷&RæÆVæwF‚Ó·&WGW&æÆ'WGFöâöæ6Æ–6³Ò%öG46'Fâ‚G¶–G‡Ò’"7G–ÆSÒ"G·7G–ÆWÒ#âG¶Æ&VÇÓÂö'WGFöãæ·Ó°¢–b†bæÓÓÒuU4"rbff—'7D7F—fR—°¢öG46'Få7F÷&RçW6‚‡·G—S¢vVF—BrÆ–C¦f—'7D7F—fRæ–BÆæöÖ'&S¦f—'7D7F—fRææöÖ'&RÆW7FFó¢uU4TBrÇ&W7WVW7Fó¦f—'7D7F—fRç&W7WVW7F÷ÇÃÒ“°¢'Fä‡FÖÃÖÖ´'Fâ‚~(û‚W6"rÂv&6¶w&÷VæC§&v&ƒ##ÃS2Ãc’Ãã“¶&÷&FW#£‚6öÆ–B&v&ƒ##ÃS2Ãc’Ãã2“¶6öÆ÷#§f"‚ÒÖFævW"“¶&÷&FW"×&F—W3£Wƒ·FF–æs£7‚—ƒ¶föçB×6—¦S£ƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£r“°¢ÒVÇ6R–b†bæÓÓÒu$TET4•"rbff—'7D7F—fR—°¢6öç7Bæ#ÔÖF‚ç&÷VæB‚†f—'7D7F—fRç&W7WVW7F÷ÇÃ’£ãr“°¢öG46'Få7F÷&RçW6‚‡·G—S¢vVF—BrÆ–C¦f—'7D7F—fRæ–BÆæöÖ'&S¦f—'7D7F—fRææöÖ'&RÆW7FFó¢tTä$ÄTBrÇ&W7WVW7Fó¦æ'Ò“°¢'Fä‡FÖÃÖÖ´'Fâ‚~(i2Ó3RrÂv&6¶w&÷VæC§&v&ƒ#SRÃ“2ÃrÃã“¶&÷&FW#£‚6öÆ–B&v&ƒ#SRÃ“2ÃrÃã2“¶6öÆ÷#§f"‚Ò×v&â“¶&÷&FW"×&F—W3£Wƒ·FF–æs£7‚—ƒ¶föçB×6—¦S£ƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£r“°¢ÒVÇ6R–b†bæÓÓÒt5D•d"r—°¢–b†f—'7Dç’bff—'7Dç’æW7FFóÓÓÒuU4TBr—°¢öG46'Få7F÷&RçW6‚‡·G—S¢vVF—BrÆ–C¦f—'7Dç’æ–BÆæöÖ'&S¦f—'7Dç’ææöÖ'&RÆW7FFó¢tTä$ÄTBrÇ&W7WVW7Fó¦f—'7Dç’ç&W7WVW7F÷ÇÃÒ“°¢'Fä‡FÖÃÖÖ´'Fâ‚~)kb&V7F—f"rÂv&6¶w&÷VæC§&v&ƒCÃ“’ÃÃã“¶&÷&FW#£‚6öÆ–B&v&ƒCÃ“’ÃÃã2“¶6öÆ÷#§f"‚Ò×7V66W72“¶&÷&FW"×&F—W3£Wƒ·FF–æs£7‚—ƒ¶föçB×6—¦S£ƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£r“°¢ÒVÇ6R–b‚f—'7Dç’—°¢6öç7BÃÔE5ôÄ”äT2æf–æB†ÃÓæbæÆ–æV4–G2æ–æ6ÇVFW2†Âæ–B’“°¢–b‡Â—µöG46'Få7F÷&RçW6‚‡·G—S¢v7&VFRrÆÆ–æV–C§Âæ–GÒ“¶'Fä‡FÖÃÖÖ´'Fâ‚r²7&V"rÂv&6¶w&÷VæC§&v&ƒÃ#"Ã#BÃã“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"Ã#BÃã2“¶6öÆ÷#§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£Wƒ·FF–æs£7‚—ƒ¶föçB×6—¦S£ƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£r“·Ğ¢Ğ¢Ğ¢6öç7B7D&#ÔÖF‚æÖ‚†bç7BÃ"“°¢&WGW&âG¶f“ãòsÆ‡"7G–ÆSÒ&&÷&FW#¦æöæS¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶Ö&v–ã£'‚#âs¢rwÓÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£G‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶fÆW‚×w&§w&#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£gƒ¶fÆWƒ£¶Ö–â×v–GFƒ£#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£G‚#âG¶bç7ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚Ò×FW‡B’#âG¶bæÆ&VÇÓÂ÷7ãà¢G¶bæ–æfóöÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£7ƒ·FF–æs£‚Wƒ·v†—FR×76S¦æ÷w&#âG¶bæ–æf÷ÓÂ÷7ãæ¢rwĞ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£gƒ¶fÆW‚×6‡&–æ³£#à¢Ç7â7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G¶bæ7Ò#âG¶bç7GÒSÂ÷7ãà¢G¶'Fä‡FÖÇĞ¢ÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&†V–v‡C£Wƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW"×&F—W3£7ƒ¶÷fW&fÆ÷s¦†–FFVâ#à¢ÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G·7D&'ÒS¶&6¶w&÷VæC¢G¶bæ7Ó¶&÷&FW"×&F—W3£7ƒ·G&ç6—F–öã§v–GF‚ãg2V6R#ãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶bæ×ÓÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢&÷‚ç7G–ÆRæF—7Æ“Òv&Æö6²s°§Ğ¦gVæ7F–öâ&VæFW$G57VvW&Væ6–2†FF—°¢6öç7B&÷ƒÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57VvvW7D&÷‚r“°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57VvvW7DÆ—7Br“°¢6öç7B&FvSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57VvvW7D&FvRr“°¢–b‚&÷‡ÇÂÆ—7B’&WGW&ã°¢6öç7B6×3ÖFFæ6×æ7ÇÅµÓ°¢6öç7BfÇFçFW3ÔE5ôÄ”äT2æf–ÇFW"†ÃÓâöG4ÖF6„6×–vâ†6×2ÆÂ’“°¢–b†&FvR’&FvRçFW‡D6öçFVçCÖfÇFçFW2æÆVæwF‚²r7VvW&–Fr²†fÇFçFW2æÆVæwF‚ÓÓòw2s¢rr“°¢–b‚fÇFçFW2æÆVæwF‚—°¢Æ—7Bæ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×7V66W72“·FF–æs£G‚#î)É2–F–VæW26×;2&FöF2Æ2Ì:ÖæV2FR&öGV66œ;6â7F—f2ãÂöF—câs°¢&÷‚ç7G–ÆRæF—7Æ“Òv&Æö6²s·&WGW&ã°¢Ğ¢Æ—7Bæ–ææW$…DÔÃÖfÇFçFW2æÖ†ÃÓç°¢6öç7B·w3Ò†ÂçÆ'&46ÆfWÇÅµÒ’ç6Æ–6RƒÃb“°¢6öç7B·t6†—3Ö·w2æÆVæwFƒöÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£Gƒ¶Ö&v–â×F÷£g‚#âG¶·w2æÖ†³ÓæÇ7âöæ6Æ–6³Ò&G46÷”·r‚rG¶Væ6öFUU$”6ö×öæVçB†²—Òr’"F—FÆSÒ$6Æ–2&6÷–""7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚Ò×FW‡C"“¶&6¶w&÷VæC§f"‚Ò×7W&f6S2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶&÷&FW"×&F—W3£ƒ·FF–æs£‚wƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&#âG¶W66T‡FÖÂ†²—ÓÂ÷7ãæ’æ¦ö–â‚rr—ÒG²†ÂçÆ'&46ÆfWÇÅµÒ’æÆVæwFƒãcöÇ7âöæ6Æ–6³Ò&G46÷”ÆÄ·r‚rG¶Âæ–GÒr’"F—FÆSÒ$6÷–"FöF2Æ2Æ'&26ÆfR"7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚ÒÖ66VçB“¶&6¶w&÷VæC§&v&ƒÃ#"Ã#BÃã‚“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"Ã#BÃã#R“¶&÷&FW"×&F—W3£ƒ·FF–æs£‚wƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&#â²G²†ÂçÆ'&46ÆfWÇÅµÒ’æÆVæwF‚ÓgÒ+r6÷–"FöF3Â÷7ãæ¢rwÓÂöF—cæ¢rs°¢&WGW&â ¢ÆF—b7G–ÆSÒ'FF–æs£‡‚ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£wƒ¶&÷&FW"ÖÆVgC£7‚6öÆ–B&v&ƒÃ#"Ã#BÃãB’#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‚#à¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚Ò×FW‡B“¶Ö&v–âÖ&÷GFöÓ£'‚#âG¶W66T‡FÖÂ†Âæ6×;7VvW&–F—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶W66T‡FÖÂ†ÂæÆ&VÂ—Ò+rG¶ÂçF—÷Ò+r&W7WVW7Fò7VvW&–Fó¢BG¶Âç&W7WVW7FòçFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÒöL:ÖÂöF—cà¢ÂöF—cà¢Æ'WGFöâöæ6Æ–6³Ò&÷Vä7&VFT6×–vä'”Æ–æV–B‚rG¶Âæ–GÒr’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒÃ#"Ã#BÃã“¶&÷&FW#£‚6öÆ–B&v&ƒÃ#"Ã#BÃã2“¶6öÆ÷#§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£Wƒ·FF–æs£G‚ƒ¶föçB×6—¦S£ƒ¶7W'6÷#§ö–çFW#·v†—FR×76S¦æ÷w&¶föçB×vV–v‡C£c¶fÆW‚×6‡&–æ³£#â²7&V#Âö'WGFöãà¢ÂöF—cà¢G¶·t6†—7Ğ¢ÂöF—cæ·Ò’æ¦ö–â‚rr“°¢&÷‚ç7G–ÆRæF—7Æ“Òv&Æö6²s°§Ğ¢òòÆ'&26ÆfR–æ6ÇV—"VâÆ,;7†–Ö6×;7&VF…67&—B"Æ2W6,:&&Ö"VÂw'WòFRçVæ6–÷2¦ÆWBöG47&VFT¶W—v÷&G3ÕµÓ°¦gVæ7F–öâ÷Vä7&VFT6×–våFV×ÆFR†æöÖ'&RÇ&W7WVW7FòÇF—òÇÆ'&46ÆfRÇF—GVÆ÷2ÆFW67&—6–öæW2Æf–æÅW&Â—°¢÷Vä7&VFT6×–vâ‚“°¢öG47&VFT¶W—v÷&G3Ô'&’æ—4'&’‡Æ'&46ÆfR“÷Æ'&46ÆfRç6Æ–6R‚“¥µÓ°¢6WEF–ÖV÷WB‚‚“Óç°¢6öç7BæÓÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄæöÖ'&Rr“¶–b†æÒ’æÒçfÇVSÖæöÖ'&S°¢6öç7B&CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÅ&W7WVW7Fòr“¶–b†&B’&BçfÇVS×&W7WVW7Fó°¢6öç7B7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄW7FFòr“¶–b‡7B’7BçfÇVSÒtTä$ÄTBs°¢6öç7BGÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÅF—òr“¶–b‡G’GçfÇVS×F—÷ÇÂu4T$4‚s°¢6öç7BgSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄf–æÅW&Âr“¶–b†gRbff–æÅW&Â’gRçfÇVSÖf–æÅW&Ã°¢6öç7BGCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÅF—GVÆ÷2r“¶–b‡GBbd'&’æ—4'&’‡F—GVÆ÷2’bgF—GVÆ÷2æÆVæwF‚’GBçfÇVS×F—GVÆ÷2æ¦ö–â‚uÆâr“°¢6öç7BG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄFW67&—6–öæW2r“¶–b†G2bd'&’æ—4'&’†FW67&—6–öæW2’bfFW67&—6–öæW2æÆVæwF‚’G2çfÇVSÖFW67&—6–öæW2æ¦ö–â‚uÆâr“°¢6öç7B·sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄ¶W—v÷&G2r“¶–b†·rbeöG47&VFT¶W—v÷&G2æÆVæwF‚’·rçfÇVSÕöG47&VFT¶W—v÷&G2æ¦ö–â‚uÆâr“°¢6öç7B†–çCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–väÖöFÄ·t†–çBr“°¢–b††–çB—°¢–b…öG47&VFT¶W—v÷&G2æÆVæwF‚—¶†–çBç7G–ÆRæF—7Æ“Òv&Æö6²s¶†–çBçFW‡D6öçFVçCÒ~)É26R–æ6ÇV—,:ârµöG47&VFT¶W—v÷&G2æÆVæwF‚²rÆ'&26ÆfR’VâçVæ6–ò&W7öç6—fòVâVÂw'WòFRçVæ6–÷2Â7&V"Æ6×;â&Wf—6òVF—FVÂçVæ6–ò&¦òâs·Ğ¢VÇ6R†–çBç7G–ÆRæF—7Æ“ÒvæöæRs°¢Ğ¢ÒÃƒ“°§Ğ¦gVæ7F–öâ÷Vä7&VFT6×–vä'”Æ–æV–B†Æ–æV–B—°¢6öç7BÃÔE5ôÄ”äT2æf–æB‡ƒÓç‚æ–CÓÓÖÆ–æV–B“°¢–b†Â—°¢6öç7Bf–æÅW&ÃÖÂç6ÇVsò„E5ôDTdTÅEõU$Â²r÷6W'f–6–÷2òr¶Âç6ÇVr“¤E5ôDTdTÅEõU$Ã°¢÷Vä7&VFT6×–våFV×ÆFR†Âæ6×;7VvW&–FÆÂç&W7WVW7FòÆÂçF—òÆÂçÆ'&46ÆfRÆÂçF—GVÆ÷2ÆÂæFW67&—6–öæW2Æf–æÅW&Â“°¢Ğ§Ğ¦ÆWBöG46'Få7F÷&SÕµÓ°¦gVæ7F–öâöG46'Fâ†–G‚—°¢6öç7BCÕöG46'Få7F÷&U¶–G…Ó¶–b‚B’&WGW&ã°¢–b†BçG—SÓÓÒvVF—Br’÷VäVF—D6×–vâ†Bæ–BÆBææöÖ'&RÆBæW7FFòÆBç&W7WVW7Fò“°¢VÇ6R÷Vä7&VFT6×–vä'”Æ–æV–B†BæÆ–æV–B“°§Ğ¢òò66–öæW2FRÆF&ÆFR6×;2†VF—F"öVÆ–Ö–æ"’÷":ÖæF–6R(	BWf—FW66W2Vâöæ6Æ–6°¦ÆWBöG46×7F–öç3ÕµÓ°¦gVæ7F–öâöG46×7F–öâ†–G‚—°¢6öç7BCÕöG46×7F–öç5¶–G…Ó¶–b‚B’&WGW&ã°¢–b†BçG—SÓÓÒvVF—Br’÷VäVF—D6×–vâ†Bæ–BÆBææöÖ'&RÆBæW7FFòÆBç&W7WVW7Fò“°¢VÇ6R–b†BçG—SÓÓÒvFVÆWFRr’÷VäFVÆWFT6×–vâ†Bæ–BÆBææöÖ'&R“°¢VÇ6R–b†BçG—SÓÓÒv6÷’r’'VäG46÷”vVçB†B“°¢VÇ6R–b†BçG—SÓÓÒvæÇ—¦Rr’'VäG46×–vävVçB†Bæ–B“°§Ğ¢òòì:Æ—6—2&ögVæFòFRTä6×;†6öâ7W266–öæW2FR6Æ–2¦gVæ7F–öâ'VäG46×–vävVçB†–B—°¢6öç7B6×Ò‡v–æF÷råöG4Æ7DFFòæ6×æ7ÇÅµÒ’æf–æB†3Óå7G&–ær†2æ–B“ÓÓÕ7G&–ær†–B’“°¢–b‚6×—·Fö7B‚t6&v&–ÖW&òÆ÷2FF÷2FRvöövÆRG2rÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BF—3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG5W&–öE6VÆV7Br“òçfÇVWÇÂs3r“°¢6öç7B7G#Ö6×æ–×&W6–öæW3ãò†6×æ6Æ–72ö6×æ–×&W6–öæW2£’çFôf—†VBƒ"“£°¢6öç7B73Ö6×æ6Æ–73ãôÖF‚ç&÷VæB†6×æv7Fòö6×æ6Æ–72“£°¢6öç7B7Ö6×æ6öçfW'6–öæW3ãôÖF‚ç&÷VæB†6×æv7Fòö6×æ6öçfW'6–öæW2“£°¢6öç7B&óÖ6×æv7Fóãbb†6×çfÆ÷%ö6öçfW'6–öçÇÃ“ãò†6×çfÆ÷%ö6öçfW'6–öâö6×æv7Fò’çFôf—†VBƒ"“£°¢6öç7BWF–ÃÖ6×ç&W7WVW7FóãôÖF‚ç&÷VæB†6×æv7FòöF—2ö6×ç&W7WVW7Fò£“£°¢6öç7B7GƒÖÆåÆääÄ•¤Tâ$ôeTäD”DB<94ÄòU5D4Õ9¥Ææ–CÒG¶6×æ–GÒ"G¶6×ææöÖ'&WÒ"²G¶6×æW7FF÷ÕÒ+rG¶F—7ÒL:Ö5ÆåFòG¶f×DÖöæW’†6×ç&W7WVW7F÷ÇÃ—ÒöL:Ö‚G·WF–ÇÒRW6ò’+rv7FòG¶f×DÖöæW’†6×æv7F÷ÇÃ—Ò+r5E"G¶7G'ÒR+r52G¶f×DÖöæW’†72—Ò+r6öçbG¶6×æ6öçfW'6–öæW7ÇÃÒ+r5G¶6×æ6öçfW'6–öæW3ãöf×DÖöæW’†7“¢~(	BwÒ+r$ô2ÔvöövÆRG²†6×çfÆ÷%ö6öçfW'6–öçÇÃ“ã÷&ò²w‚s¢~(	BwÕÆäFVâF–vì;77F–6òW7V<:Öf–6ò’Æ266–öæW26öæ7&WF2†6öâ´5D”ôå5Ò’&W7F6×;â6’Æ×VW7G&W26†–6ÂF–Æòæ°¢'VävVçD–æÆ–æR‚tE2rÆ7G‚Â‡&W7VÇB“Óç°¢6öç7B7F–öç3Õ÷'6TG47F–öç2‡&W7VÇB“·v–æF÷råöG4vVçD7F–öç3Ö7F–öç3°¢6öç7B$VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vvVçD–æÆ–æU&W7VÇBr“¶–b‡$VÂ—·$VÂç7G–ÆRçv†—FU76SÒvæ÷&ÖÂs·$VÂæ–ææW$…DÔÃÖf÷&ÖDvVçE&W÷'B‡&W7VÇB“·Ğ¢6öç7B'Fç3ÕöG5&VæFW$7F–öä'Fç2†7F–öç2“°¢&WGW&â'Fç2¶Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"öæ6Æ–6³Ò&6÷”vVçE&W7VÇB‚’#ï	ù8²6÷–#Âö'WGFöãæ°¢Ò“°§Ğ¢òò)H)H†VÇF‚66÷&R÷"6×;ƒ(	3’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâG4†VÇF…66÷&R†2—°¢–b‚2æ–×&W6–öæW7ÇÆ2æ–×&W6–öæW3ÓÓÓ’&WGW&ç·66÷&S£Æ6öÆ÷#¢wf"‚Ò×FW‡C2’rÆÆ&VÃ¢u6–âFF÷2wÓ°¢6öç7B7G#Ö2æ6Æ–72ö2æ–×&W6–öæW2£°¢6öç7B6öçe&FSÖ2æ6Æ–73ãö2æ6öçfW'6–öæW2ö2æ6Æ–72££°¢6öç7B&ö3Ö2æv7Fóãbb†2çfÆ÷%ö6öçfW'6–öçÇÃ“ãö2çfÆ÷%ö6öçfW'6–öâö2æv7Fó£°¢6öç7B3ÔÖF‚ç&÷VæB„ÖF‚æÖ–â†7G"óRÃ’£3R´ÖF‚æÖ–â†6öçe&FRó2Ã’£3R²‡&ö3ãôÖF‚æÖ–â‡&ö2óBÃ’£3£’“°¢6öç7B6öÆ÷#×3ãÓsòwf"‚Ò×7V66W72’s§3ãÓCòwf"‚Ò×v&â’s¢wf"‚ÒÖFævW"’s°¢&WGW&ç·66÷&S§2Æ6öÆ÷"ÆÆ&VÃ§3ãÓsòt'VVæòs§3ãÓCòu&VwVÆ"s¢t&¦òwÓ°§Ğ¢òò)H)H—'F&ÆR7–æ2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦7–æ2gVæ7F–öâ7–æ4G5Fô—'F&ÆR†FFÆF—2—°¢ÆWB6fs·G'—¶6fsÕö—'F&ÆT6öæf–r‚“·Ö6F6‚†R—·&WGW&ã·Ğ¢6öç7BFöF“Ö†÷”4Â‚“°¢6öç7Bv7FóÖFFæv7F÷ÇÃÆ–×ÖFFæ–×&W6–öæW7ÇÃÆ6Æ–73ÖFFæ6Æ–77ÇÃ°¢6öç7B6öçcÖFFæ6öçfW'6–öæW7ÇÃÇfÄ6öçcÖFFçfÆ÷%ö6öçfW'6–öçÇÃ°¢6öç7B7G#Ö–×ãö6Æ–72ö–×£°¢6öç7B73Ö6Æ–73ãôÖF‚ç&÷VæB†v7Fòö6Æ–72“£°¢6öç7B7Ö6öçcãôÖF‚ç&÷VæB†v7Fòö6öçb“£°¢6öç7B&ö3Öv7FóãôÖF‚ç&÷VæB‡fÄ6öçböv7Fò£’ó£°¢6öç7BG46fsÖvWDG46öæf–r‚“°¢6öç7B&6SÖ6fræ&6R²ròr´$4Uô”C°¢6öç7B†VFW'3×²ââæ6fræ†VFW'2Ât6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öâwÓ°¢òòµ’&V6÷&@¢v—B—'F&ÆT‡GG†&6R²rôvöövÆUôG5ôµ—2rÇ¶ÖWF†öC¢uõ5BrÆ†VFW'2Æ&öG“¤¥4ôâç7G&–æv–g’‡·&V6÷&G3¥·¶f–VÆG3§°¢uW,:ÖöFòs§FöF’²r+rr¶F—2²vBrÀ¢tfV6†s§FöF’ÂtL:Ö2W,:ÖöFòs¦F—2À¢tv7Fò„4Å’s¦v7FòÂt–×&W6–öæW2s¦–×Ât6Æ–72s¦6Æ–72À¢t5E"‚R’s¦7G"Ât52&öÖVF–ò„4Å’s¦72À¢t6öçfW'6–öæW2s¦6öçbÂufÆ÷"6öçfW'6–öæW2„4Å’s§fÄ6öçbÀ¢t5„4Å’s¦7Âu$ô2s§&ö2À¢t7W7FöÖW"”Bs¦G46fræ7W7FöÖW$–GÇÂrrÂtgVVçFRs¢w&VÂp¢×ÕÒÇG—V67C§G'VWÒ—Ò“°¢òò6×–vâ&V6÷&G2†&F6‚¢6öç7B6×3ÖFFæ6×æ7ÇÅµÓ°¢–b†6×2æÆVæwF‚—°¢6öç7B&V73Ö6×2æÖ†3Óç°¢6öç7B7CÖ2æ–×&W6–öæW3ãö2æ6Æ–72ö2æ–×&W6–öæW3£°¢6öç7B7Ö2æ6Æ–73ãôÖF‚ç&÷VæB†2æv7Fòö2æ6Æ–72“£°¢6öç7B6Ö2æ6öçfW'6–öæW3ãôÖF‚ç&÷VæB†2æv7Fòö2æ6öçfW'6–öæW2“£°¢6öç7B&óÖ2æv7Fóãbb†2çfÆ÷%ö6öçfW'6–öçÇÃ“ãôÖF‚ç&÷VæB†2çfÆ÷%ö6öçfW'6–öâö2æv7Fò£’ó£°¢&WGW&ç¶f–VÆG3§°¢t6×;s¦2ææöÖ'&WÇÅ7G&–ær†2æ–B’À¢t6×–vâ”Bs¥7G&–ær†2æ–GÇÂrr’À¢tfV6†6æ6†÷Bs§FöF’ÂtW7FFòs¦2æW7FF÷ÇÂtTä$ÄTBrÀ¢u&W7WVW7FòF–&–ò„4Å’s¦2ç&W7WVW7F÷ÇÃÂtv7Fò„4Å’s¦2æv7F÷ÇÃÀ¢t–×&W6–öæW2s¦2æ–×&W6–öæW7ÇÃÂt6Æ–72s¦2æ6Æ–77ÇÃÀ¢t5E"‚R’s¦7BÂt52„4Å’s¦7À¢t6öçfW'6–öæW2s¦2æ6öçfW'6–öæW7ÇÃÂt5„4Å’s¦6Âu$ô2s§&òÀ¢u66÷&R6ÇVBs¦G4†VÇF…66÷&R†2’ç66÷&RÂuW,:ÖöFò†L:Ö2’s¦F—0¢×Ó°¢Ò“°¢f÷"†ÆWB“Ó¶“Ç&V72æÆVæwFƒ¶’³Ó—°¢v—B—'F&ÆT‡GG†&6R²rôvöövÆUôG5ô6×æ2rÇ¶ÖWF†öC¢uõ5BrÆ†VFW'2Æ&öG“¤¥4ôâç7G&–æv–g’‡·&V6÷&G3§&V72ç6Æ–6R†’Æ’³’ÇG—V67C§G'VWÒ—Ò“°¢Ğ¢Ğ§Ğ¦7–æ2gVæ7F–öâÆöDG56æ6†÷G4g&öÔ—'F&ÆR‚—°¢ÆWB6fs·G'—¶6fsÕö—'F&ÆT6öæf–r‚“·Ö6F6‚†R—·&WGW&ã·Ğ¢6öç7B&W3Öv—B—'F&ÆTfWF6‚‚tvöövÆUôG5ôµ—2rÃc“°¢6öç7B&V6÷&G3×&W2ç&V6÷&G7ÇÅµÓ¶–b‚&V6÷&G2æÆVæwF‚’&WGW&ã°¢&V6÷&G2ç6÷'B‚†Æ"“Óâ†"æf–VÆG5²tfV6†u×ÇÂrr’æÆö6ÆT6ö×&R†æf–VÆG5²tfV6†u×ÇÂrr’“°¢6öç7B6VVãÖæWr6WB‚“°¢6öç7BFVGWVC×&V6÷&G2æf–ÇFW"‡#Óç¶6öç7BC×"æf–VÆG5²tfV6†u×ÇÂrs¶–b‡6VVâæ†2†B’’&WGW&âfÇ6S·6VVâæFB†B“·&WGW&âG'VS·Ò“°¢6öç7B6æ3ÖFVGWVBç&WfW'6R‚’æÖ‡#Óç¶6öç7Bc×"æf–VÆG3·&WGW&ç°¢FFS¦e²tfV6†u×ÇÂrrÇG3¦e²tfV6†u×ÇÂrrÀ¢v7Fó¦e²tv7Fò„4Å’u×ÇÃÆ6Æ–73¦e²t6Æ–72u×ÇÃÆ6öçc¦e²t6öçfW'6–öæW2u×ÇÃÀ¢&ö3¦e²u$ô2u×ÇÃÆ–×¦e²t–×&W6–öæW2u×ÇÃÆ7G#¦e²t5E"‚R’u×ÇÃÆF—3¦fÚ±î¸Â¸­yêë¢°k¢G§¦*^['DÃ­as perÃ­odo']||30
  };});
  localStorage.setItem('ads_snapshots',JSON.stringify(snaps));
}
// â”€â”€ Export CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const blob=new Blob(['ï»¿'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='campanas_google_ads_'+hoyCL()+'.csv';
  a.click();
  toast('âœ“ CSV descargado','success');
}
function adsExportKeywordsCSV(){
  const kws=(window._adsLastData&&window._adsLastData.keywords)||[];
  if(!kws.length){toast('No hay palabras clave para exportar','error');return;}
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const head=['Palabra clave','Concordancia','Quality Score','Anuncio','Landing','CTR esperado','CampaÃ±a','Grupo','Impresiones','Clics','Gasto','Conversiones','CPA'];
  const lines=[head.map(q).join(',')];
  [...kws].sort((a,b)=>(b.gasto||0)-(a.gasto||0)).forEach(k=>{
    const cpa=(k.conversiones||0)>0?Math.round(k.gasto/k.conversiones):'';
    lines.push([k.kw,k.match,k.qs||'',k.qs_anuncio,k.qs_landing,k.qs_ctr,k.campana,k.grupo,k.impresiones||0,k.clics||0,k.gasto||0,k.conversiones||0,cpa].map(q).join(','));
  });
  const blob=new Blob(['ï»¿'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='palabras_clave_google_ads_'+hoyCL()+'.csv';
  a.click();
  toast('âœ“ CSV de palabras clave descargado','success');
}
function getAdsConfig(){try{const s=localStorage.getItem('ads_config');if(s){const c=JSON.parse(s);return{...c,secret:c.secret||''};}}catch(e){}const _dw=_DEFAULTS.ADS_WEBAPP,_dc=_DEFAULTS.ADS_CUSTOMER;return{endpoint:(_dw&&!_dw.startsWith('%%'))?_dw:'https://script.google.com/macros/s/AKfycbzepd4w_8meCRmOCsx-pngGHyQ_BqUXAaWAFE8WpIFtTO6zRmFPDukNarCXUNzmfLdt/exec',customerId:(_dc&&!_dc.startsWith('%%'))?_dc:'757-781-2099',secret:''};}
function saveAdsConfig(){
  const endpoint=(document.getElementById('ads-endpoint')?.value||'').trim();
  const customerId=(document.getElementById('ads-customer-id')?.value||'').trim();
  const secret=(document.getElementById('ads-secret')?.value||'').trim();
  if(!endpoint){toast('Ingresa la URL del endpoint','error');return;}
  if(secret.length<16){toast('Usa un secreto de al menos 16 caracteres','error');return;}
  localStorage.setItem('ads_config',JSON.stringify({endpoint,customerId,secret}));
  document.getElementById('adsConfigPanel').style.display='none';
  toast('âœ“ ConfiguraciÃ³n Google Ads guardada','success');
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
    document.getElementById('ads-secret').value=cfg.secret||'';
  }
}
function copyAdsScript(id){
  let code=document.getElementById(id||'adsScriptCode')?.textContent||'';
  const cfg=getAdsConfig();
  if(cfg.endpoint) code=code.replace('PEGA_AQUI_LA_URL_DEL_SCRIPT_1',cfg.endpoint);
  if(cfg.secret) code=code.replace('CONFIGURA_UN_SECRETO_LARGO_Y_UNICO',cfg.secret);
  if(cfg.customerId) code=code.replace('PEGA_AQUI_EL_CUSTOMER_ID',cfg.customerId.replace(/-/g,''));
  navigator.clipboard.writeText(code).then(()=>toast('âœ“ Script copiado (endpoint y customer ID pre-rellenados)','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=code;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('âœ“ Script copiado','success');
  });
}
function fmtMoney(n){if(!n&&n!==0)return'â€”';if(n>=1000000)return'$'+(n/1000000).toFixed(1)+'M';if(n>=1000)return'$'+(n/1000).toFixed(0)+'K';return'$'+Math.round(n).toLocaleString('es-CL');}
function fmtNum(n){if(!n&&n!==0)return'â€”';if(n>=1000000)return(n/1000000).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(0)+'K';return Math.round(n).toLocaleString('es-CL');}
function fmtPct(n){return(n||0).toFixed(2)+'%';}
function getAdsDemoData(days){
  const f=days<=7?0.23:days<=30?1:3;
  return{ok:true,periodo:'Demo Â· '+days+' dÃ­as',demo:true,
    gasto:Math.round(187400*f),impresiones:Math.round(94200*f),clics:Math.round(2310*f),
    conversiones:Math.round(38*f),valor_conversion:Math.round(1140000*f),
    campanas:[
      {id:'1',nombre:'BÃºsqueda - ImpresiÃ³n 3D General',estado:'ENABLED',presupuesto:8000,
        gasto:Math.round(74200*f),impresiones:Math.round(38400*f),clics:Math.round(980*f),conversiones:Math.round(18*f),valor_conversion:Math.round(540000*f),
        is:0.42,is_lost_budget:0.31,is_lost_rank:0.27},
      {id:'2',nombre:'BÃºsqueda - Arquitectura & DiseÃ±o',estado:'ENABLED',presupuesto:6000,
        gasto:Math.round(58900*f),impresiones:Math.round(29100*f),clics:Math.round(820*f),conversiones:Math.round(12*f),valor_conversion:Math.round(360000*f),
        is:0.55,is_lost_budget:0.08,is_lost_rank:0.37},
      {id:'3',nombre:'Display Remarketing',estado:'ENABLED',presupuesto:3000,
        gasto:Math.round(31400*f),impresiones:Math.round(22700*f),clics:Math.round(310*f),conversiones:Math.round(6*f),valor_conversion:Math.round(180000*f)},
      {id:'4',nombre:'BÃºsqueda - PapelerÃ­a Corporativa',estado:'PAUSED',presupuesto:4000,
        gasto:Math.round(18200*f),impresiones:Math.round(3900*f),clics:Math.round(180*f),conversiones:Math.round(2*f),valor_conversion:Math.round(60000*f)},
      {id:'5',nombre:'YouTube - Branding Lab',estado:'ENABLED',presupuesto:2000,
        gasto:Math.round(4700*f),impresiones:Math.round(102*f*100),clics:Math.round(20*f),conversiones:0,valor_conversion:0},
    ],
    terminos:[
      {termino:'impresora 3d barata',campana:'BÃºsqueda - ImpresiÃ³n 3D General',clics:Math.round(64*f),gasto:Math.round(11800*f),conversiones:0},
      {termino:'reparar impresora 3d',campana:'BÃºsqueda - ImpresiÃ³n 3D General',clics:Math.round(38*f),gasto:Math.round(7200*f),conversiones:0},
      {termino:'impresiÃ³n 3d santiago',campana:'BÃºsqueda - ImpresiÃ³n 3D General',clics:Math.round(120*f),gasto:Math.round(22400*f),conversiones:Math.round(9*f)},
      {termino:'maqueta arquitectura',campana:'BÃºsqueda - Arquitectura & DiseÃ±o',clics:Math.round(72*f),gasto:Math.round(15100*f),conversiones:Math.round(7*f)},
    ],
    keywords:[
      {kw:'impresora 3d',match:'BROAD',qs:4,qs_anuncio:'BELOW_AVERAGE',qs_landing:'AVERAGE',qs_ctr:'BELOW_AVERAGE',campana:'BÃºsqueda - ImpresiÃ³n 3D General',grupo:'3D General',impresiones:Math.round(14200*f),clics:Math.round(280*f),gasto:Math.round(28400*f),conversiones:Math.round(2*f)},
      {kw:'impresiÃ³n 3d santiago',match:'PHRASE',qs:8,qs_anuncio:'ABOVE_AVERAGE',qs_landing:'ABOVE_AVERAGE',qs_ctr:'AVERAGE',campana:'BÃºsqueda - ImpresiÃ³n 3D General',grupo:'3D Local',impresiones:Math.round(9800*f),clics:Math.round(310*f),gasto:Math.round(21600*f),conversiones:Math.round(11*f)},
      {kw:'prototipo 3d',match:'PHRASE',qs:5,qs_anuncio:'AVERAGE',qs_landing:'BELOW_AVERAGE',qs_ctr:'AVERAGE',campana:'BÃºsqueda - Arquitectura & DiseÃ±o',grupo:'Prototipos',impresiones:Math.round(6100*f),clics:Math.round(150*f),gasto:Math.round(13900*f),conversiones:0},
      {kw:'maqueta arquitectura',match:'EXACT',qs:9,qs_anuncio:'ABOVE_AVERAGE',qs_landing:'ABOVE_AVERAGE',qs_ctr:'ABOVE_AVERAGE',campana:'BÃºsqueda - Arquitectura & DiseÃ±o',grupo:'Maquetas',impresiones:Math.round(4200*f),clics:Math.round(190*f),gasto:Math.round(16800*f),conversiones:Math.round(7*f)},
    ]
  };
}
function testAdsEndpoint(){
  const url=document.getElementById('ads-endpoint').value.trim();
  if(!url){alert('Primero pega la URL del endpoint en el campo de arriba.');return;}
  const testUrl=url+(url.includes('?')?'&':'?')+'days=30';
  window.open(testUrl,'_blank');
}
// â”€â”€â”€ Ads Campaign Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
var _adsPendingMutations;try{_adsPendingMutations=JSON.parse(localStorage.getItem('ads_pending_mutations')||'[]');}catch(e){_adsPendingMutations=[];}

function savePendingToStorage(){
  localStorage.setItem('ads_pending_mutations', JSON.stringify(_adsPendingMutations));
}

function openCreateCampaign(){
  _adsCreateKeywords=[];
  document.getElementById('adsCampaignModalId').value='';
  document.getElementById('adsCampaignModalOp').value='create';
  document.getElementById('adsCampaignModalTitle').textContent='Nueva CampaÃ±a';
  document.getElementById('adsCampaignModalDesc').textContent='La campaÃ±a se crearÃ¡ en Google Ads en la prÃ³xima ejecuciÃ³n del Script 2.';
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
  document.getElementById('adsCampaignModalUbicaciones').value='RegiÃ³n Metropolitana, Chile';
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
  document.getElementById('adsCampaignModalTitle').textContent='Editar CampaÃ±a';
  document.getElementById('adsCampaignModalDesc').textContent='Los cambios se aplicarÃ¡n en Google Ads en la prÃ³xima ejecuciÃ³n del Script 2.';
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
  document.getElementById('adsDeleteModalNombre').textContent='CampaÃ±a: '+nombre;
  document.getElementById('adsDeleteModal').style.display='flex';
}

function closeAdsDeleteModal(){
  document.getElementById('adsDeleteModal').style.display='none';
}

// â”€â”€ FRENO DE PRESUPUESTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// El presupuesto DIARIO de una campaÃ±a se cambia con un clic y va derecho al
// Script 2, que lo aplica en la cuenta real. HabÃ­a piso ($1.000) pero ningÃºn
// techo, y el nÃºmero lo puede proponer el agente de IA: un cero de mÃ¡s pasaba
// entero. Peor todavÃ­a, si el agente omitÃ­a el campo, Math.max(1000, NaN||0)
// lo dejaba en $1.000 â€” bajar una campaÃ±a de $8.000 a $1.000 sin que nadie se
// entere. Las lÃ­neas del taller van entre $2.000 y $8.000 al dÃ­a.
const _ADS_TOPE_KEY='ads_tope_diario';
function adsTopeDiario(){const v=parseInt(localStorage.getItem(_ADS_TOPE_KEY),10);return v>0?v:20000;}
function setAdsTopeDiario(){
  const v=prompt('Tope de presupuesto DIARIO por campaÃ±a (CLP).\nEs una red de seguridad: nada por encima de este monto se envÃ­a a Google Ads sin que lo subas a propÃ³sito.',String(adsTopeDiario()));
  if(v===null) return;
  const n=parseInt(v,10);
  if(!(n>=1000)){toast('El tope debe ser al menos $1.000','error');return;}
  localStorage.setItem(_ADS_TOPE_KEY,String(n));
  toast('ğŸ›¡ Tope diario por campaÃ±a: '+fmtMoney(n),'success');
}
// Ãšnico lugar donde se decide si un presupuesto puede salir hacia Google Ads.
// Lo usan las dos rutas â€”el botÃ³n del agente y el modal a manoâ€” para que no
// puedan separarse. Devuelve el monto a aplicar, o null si no debe enviarse.
function adsPresupuestoValido(nuevo,actual,nombre){
  const crudo=(nuevo===''||nuevo===null||nuevo===undefined)?NaN:Number(nuevo);
  if(!Number.isFinite(crudo)){
    toast('No se entendiÃ³ el presupuesto propuesto para '+(nombre||'la campaÃ±a')+' â€” escrÃ­belo a mano.','error');
    return null;
  }
  const n=Math.round(crudo);
  if(n<1000){toast('El presupuesto diario debe ser al menos $1.000 CLP.','error');return null;}
  const tope=adsTopeDiario();
  if(n>tope){
    toast('ğŸ›¡ '+fmtMoney(n)+' al dÃ­a supera el tope de '+fmtMoney(tope)+' para '+(nombre||'esta campaÃ±a')+'. No se envÃ­a. Si de verdad lo quieres, sube el tope con el botÃ³n ğŸ›¡.','error');
    return null;
  }
  // Un salto grande dentro del tope puede ser correcto, pero no en piloto automÃ¡tico.
  const act=Math.round(Number(actual)||0);
  if(act>0&&(n>act*3||n<act/3)){
    if(!confirm('Cambio fuerte de presupuesto en "'+(nombre||'la campaÃ±a')+'":\n\n'+fmtMoney(act)+' â†’ '+fmtMoney(n)+' al dÃ­a\n\nÂ¿Lo aplicas?')) return null;
  }
  return n;
}

// Encola una mutaciÃ³n reemplazando cualquier mutaciÃ³n pendiente equivalente (evita duplicados)
function _adsQueueMutation(mutation){
  const keyOf=m=>m.op+'|'+(m.id||'')+'|'+(m.op==='create'?((m.data&&m.data.nombre)||''):(m.op==='negative'||m.op==='pause_keyword')?((m.data&&m.data.termino)||'')+'|'+((m.data&&m.data.campana)||''):'');
  const k=keyOf(mutation);
  // Conserva las ya aplicadas; descarta una pendiente/enviada/errÃ³nea equivalente
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
  if(!nombre){alert('El nombre de la campaÃ±a es obligatorio.');return;}
  // Mismo freno que usa el botÃ³n del agente: si se separan, uno de los dos queda sin techo.
  const _actual=(window._adsLastData?.campanas||[]).find(c=>String(c.id)===String(id))?.presupuesto||0;
  const _ppto=adsPresupuestoValido(document.getElementById('adsCampaignModalPresupuesto').value,_actual,nombre);
  if(_ppto===null) return;
  const data={nombre,presupuesto:_ppto,estado,tipo};
  if(op==='create'){
    // Sin comillas/corchetes: la concordancia la aplica el Script 2 segÃºn el selector
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
      if(titulos.length<3){alert('El anuncio necesita al menos 3 tÃ­tulos (uno por lÃ­nea).');return;}
      if(descripciones.length<2){alert('El anuncio necesita al menos 2 descripciones (una por lÃ­nea).');return;}
      const tLargo=titulos.find(t=>t.length>30);
      if(tLargo){alert('Cada tÃ­tulo debe tener mÃ¡ximo 30 caracteres. Acorta: "'+tLargo+'" ('+tLargo.length+').');return;}
      const dLargo=descripciones.find(d=>d.length>90);
      if(dLargo){alert('Cada descripciÃ³n debe tener mÃ¡ximo 90 caracteres. Acorta: "'+dLargo+'" ('+dLargo.length+').');return;}
      if(path1.length>15||path2.length>15){alert('Cada ruta (Path) debe tener mÃ¡ximo 15 caracteres.');return;}
      data.anuncio={finalUrl,titulos:titulos.slice(0,15),descripciones:descripciones.slice(0,4)};
      if(path1) data.anuncio.path1=path1;
      if(path2) data.anuncio.path2=path2;
    } else if(!confirm('La campaÃ±a se crearÃ¡ SIN anuncios y no se publicarÃ¡ hasta que agregues uno en Google Ads. Â¿Continuar de todos modos?')){
      return;
    }
  }
  // CascarÃ³n automÃ¡tico vÃ­a Make: crea la campaÃ±a real en Google Ads (pausada,
  // con la declaraciÃ³n UE); el Script 2 la completarÃ¡ al procesar esta orden.
  if(op==='create'&&ADS_MAKE_SHELL.url){
    const qs='?clave='+encodeURIComponent(ADS_MAKE_SHELL.clave)+'&nombre='+encodeURIComponent(data.nombre)+'&presupuesto='+(data.presupuesto||1000);
    fetch(ADS_MAKE_SHELL.url+qs,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({clave:ADS_MAKE_SHELL.clave,nombre:data.nombre,presupuesto:data.presupuesto||1000})})
      .then(r=>{if(r.ok)toast('âœ“ CascarÃ³n pedido a Make â€” el Script 2 completarÃ¡ la campaÃ±a en su prÃ³xima corrida','success');else toast('Make respondiÃ³ '+r.status+' al pedir el cascarÃ³n â€” si la campaÃ±a no aparece, crÃ©ala a mano','info');})
      .catch(()=>toast('No se pudo contactar el webhook de Make â€” crea el cascarÃ³n a mano si no existe','info'));
  }
  const mutation={op,id,data,timestamp:new Date().toISOString(),status:'pending'};
  closeAdsCampaignModal();
  _adsQueueMutation(mutation);
}

// â”€â”€â”€ Generador de campaÃ±as con IA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

const ADS_BUILDER_SYS=`Eres el generador experto de campaÃ±as de Google Ads de The Lab Solutions, fabricaciÃ³n digital B2B a medida en Santiago, Chile.
NEGOCIO: la web convierte una visita en una cotizaciÃ³n (WhatsApp o formulario). Comprador B2B (marketing, RRHH, productoras de eventos, retail) que cotiza con un proveedor y tiene plazo. Se optimiza por GANANCIA real del CRM, no por volumen de clics.
9 LÃNEAS (usa el slug EXACTO en la URL final https://thelab.solutions/servicios/<slug>):
- Activaciones (activaciones)
- Premiaciones (premiaciones): trofeos, galvanos, medallas, reconocimientos
- Merchandising (merchandising): regalos corporativos, artÃ­culos promocionales
- Cajas Personalizadas (cajas-personalizadas): packaging
- ImpresiÃ³n 3D (impresion-3d): piezas, prototipos, maquetas
- VolumÃ©tricos (volumetricos): letras corpÃ³reas, estructuras, neÃ³n/LED
- CartelerÃ­a (carteleria): seÃ±alÃ©tica, letreros acrÃ­lico
- PapelerÃ­a (papeleria): imprenta corporativa, tarjetas, membretes
- Chip The Lab (chip-the-lab): tarjetas NFC
REGLAS 2026 (aplÃ­calas):
- Concordancia por defecto FRASE (AMPLIA solo con puja inteligente y datos).
- Puja: empieza en MAXIMIZE_CLICKS para juntar datos; usa TARGET_CPA o TARGET_ROAS solo si el brief dice que ya hay volumen de conversiones.
- Geo: "RegiÃ³n Metropolitana, Chile", modo PRESENCE. Redes: socios y display en false.
- Palabras clave con intenciÃ³n comercial chilena (cotizar, personalizado, para empresas, corporativo, por mayor, santiago); 10-15 por campaÃ±a. SIN comillas ni corchetes: la concordancia se define en un campo aparte, no en el texto.
- Negativas: incluye empleo, trabajo, gratis, plantilla, pdf, como hacer, diy, tutorial, curso, usado, segunda mano; para impresiÃ³n 3D agrega ademas steam, juego, render, blender, roblox, minecraft, lentes 3d.
- RSA: 12-15 tÃ­tulos ÃšNICOS de mÃ¡ximo 30 caracteres (keyword, diferenciador premium, prueba/aÃ±os, CTA "Cotiza por WhatsApp") y 4 descripciones de mÃ¡ximo 90 caracteres. LOS LÃMITES SON ESTRICTOS: cuenta los caracteres de cada tÃ­tulo y descripciÃ³n antes de incluirlos; si uno se pasa, reescrÃ­belo mÃ¡s corto (no lo entregues largo).
- Presupuesto diario en CLP realista (3000-10000 por lÃ­nea).
Responde SOLO con este JSON, sin texto adicional y sin bloques de cÃ³digo:
{"nombre":"","tipo":"SEARCH","presupuesto":6000,"concordancia":"FRASE","maxCpc":800,"pujaEstrategia":"MAXIMIZE_CLICKS","pujaObjetivo":0,"ubicaciones":"RegiÃ³n Metropolitana, Chile","ubicModo":"PRESENCE","redSocios":false,"redDisplay":false,"finalUrl":"https://thelab.solutions/servicios/premiaciones","path1":"","path2":"","palabrasClave":[],"negativas":[],"titulos":[],"descripciones":[],"metricas":{"ctr":">3%","cpc":"<$1.200 CLP","cpa":"<$8.000 CLP","roas":">3x (CRM)","convMes":"15-30"},"checklist":["Poner la etiqueta de conversiÃ³n en la web antes de activar","Confirmar geo en modo Presencia (RM) en Google Ads","Importar conversiones offline del CRM (gclid) para optimizar por ganancia real","Adjuntar sitelinks a cada /servicios y asset de mensaje/WhatsApp"]}`;

async function iaBuildCampaign(){
  const brief=prompt('Â¿QuÃ© campaÃ±a quieres que arme la IA?\nIndica la lÃ­nea de producto y el objetivo.\n\nEj: Premiaciones â€” captar pedidos de galvanos y trofeos para empresas de fin de aÃ±o');
  if(brief===null) return;
  const q=(brief||'').trim();
  if(!q){toast('Describe la campaÃ±a que quieres crear','error');return;}
  toast('âœ¨ La IA estÃ¡ armando la campaÃ±aâ€¦','info');
  try{showAgentWorking('ADS',{verb:'estÃ¡ armando tu campaÃ±a de Google Adsâ€¦',messages:['Definiendo estructura y pujaâ€¦','Eligiendo palabras clave y negativasâ€¦','Escribiendo tÃ­tulos y descripcionesâ€¦','Ajustando mÃ©tricas objetivoâ€¦']});}catch(e){}
  try{
    let ctx='';
    try{ if(typeof state!=='undefined'&&state.loaded&&window._adsLastData&&!window._adsLastData.demo) ctx=('\n\nDATOS ACTUALES DE LA CUENTA (referencia):\n'+buildAgentContext('ADS')).slice(0,3500); }catch(e){}
    const raw=await callAgentClaude('ADS',ADS_BUILDER_SYS,'BRIEF: '+q+ctx+'\n\nDevuelve SOLO el JSON.');
    const prop=_parseCampaignJSON(raw);
    if(!prop||!prop.nombre){toast('La IA no devolviÃ³ una campaÃ±a vÃ¡lida â€” reintenta','error');return;}
    _applyIACampaign(prop);
    toast('âœ“ CampaÃ±a generada â€” revÃ­sala y guarda','success');
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

// Sanitiza la salida de la IA a los lÃ­mites reales de Google Ads:
// keywords sin comillas/corchetes (la concordancia la pone el Script 2),
// tÃ­tulos â‰¤30 y descripciones â‰¤90 recortados en el Ãºltimo espacio.
function _adsCleanKw(s){return String(s||'').trim().replace(/^["'â€œâ€\[\]]+|["'â€œâ€\[\]]+$/g,'').trim();}
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
    const met=Object.keys(m).length?('<div style="font-weight:700;color:var(--accent);font-size:11px;margin-bottom:4px">ğŸ¯ MÃ©tricas objetivo</div><div style="font-size:11px;color:var(--text2);line-height:1.7">'+Object.keys(m).map(k=>'<b>'+escapeHtml(k)+':</b> '+escapeHtml(String(m[k]))).join(' Â· ')+'</div>'):'';
    const chk=(Array.isArray(p.checklist)&&p.checklist.length)?('<div style="font-weight:700;color:var(--warn);font-size:11px;margin:8px 0 4px">âœ… Terminar en Google Ads</div><ul style="font-size:11px;color:var(--text2);margin:0;padding-left:16px;line-height:1.6">'+p.checklist.map(c=>'<li>'+escapeHtml(String(c))+'</li>').join('')+'</ul>'):'';
    info.innerHTML='<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:10px 12px">'+(met||'')+(chk||'')+'</div>';
    info.style.display=(met||chk)?'':'none';
  }
}

function confirmDeleteCampaign(){
  const id=document.getElementById('adsDeleteModalId').value;
  const nombre=document.getElementById('adsDeleteModalNombre').textContent.replace('CampaÃ±a: ','');
  const mutation={op:'delete',id,data:{nombre},timestamp:new Date().toISOString(),status:'pending'};
  closeAdsDeleteModal();
  _adsQueueMutation(mutation);
}

// Purga del servidor (Script 1) las mutaciones ya resueltas; conserva las pendientes.
// El almacÃ©n crece para siempre (errores viejos, duplicados) y ensucia el diagnÃm«ëŒ+Š×®º+º$zzb¥ë77F–6òà¦7–æ2gVæ7F–öâG4Æ–×–$†—7F÷&–Ä×WF6–öæW2‚—°¢6öç7B6fsÖvWDG46öæf–r‚“°¢–b‚6fræVæGö–çB—·Fö7B‚tæò†’VæGö–çB6öæf–wW&FòrÂvW'&÷"r“·&WGW&ã·Ğ¢–b‚6frç6V7&WB—·Fö7B‚t6öæf–wW&VÂ6V7&WFòFR×WF6–öæW2FRvöövÆRG2rÂvW'&÷"r“·&WGW&ã·Ğ¢G'—°¢6öç7B#Öv—BfWF6‚†6fræVæGö–çB²†6fræVæGö–çBæ–æ6ÇVFW2‚sòr“òrbs¢sòr’²v7F–öãÖ×WFF–öç2e÷CÒr´FFRææ÷r‚’“°¢6öç7BCÖv—B"æ§6öâ‚“°¢6öç7BFöF3Ò†BbfBæ×WFF–öç2—ÇÅµÓ°¢6öç7BVæF–VçFW3×FöF2æf–ÇFW"†ÓÓæÒç7FGW3ÓÓÒwVæF–ærr“°¢6öç7B&W7VVÇF3×FöF2æÆVæwF‚×VæF–VçFW2æÆVæwFƒ°¢–b‚&W7VVÇF2—·Fö7B‚tæò†’×WF6–öæW2&W7VVÇF2VRÆ–×–"rÂv–æfòr“·&WGW&ã·Ğ¢–b‚6öæf—&Ò†6RVÆ–Ö–æ,:âG·&W7VVÇF7Ò×WF6–öæW2–&W7VVÇF2†Æ–6F2ò6öâW'&÷"’FVÂ†—7F÷&–ÂFVÂ6W'f–F÷"â6R6öç6W'fâÆ2G·VæF–VçFW2æÆVæwF‡ÒVæF–VçFW2â+ô6öçF–çV#ö’’&WGW&ã°¢6öç7B&W3Öv—BfWF6‚†6fræVæGö–çBÇ¶ÖWF†öC¢uõ5BrÆ†VFW'3§²t6öçFVçBÕG—Rs¢wFW‡B÷Æ–âwÒÆ&öG“¤¥4ôâç7G&–æv–g’‡·6V7&WC¦6frç6V7&WBÇG—S¢wWFFUö×WFF–öç2rÆ×WFF–öç3§VæF–VçFW7Ò—Ò“°¢6öç7BG#Öv—B&W2æ§6öâ‚’æ6F6‚‚‚“Óâ‡·Ò’“°¢–b†G"bfG"æö²—°¢öG5VæF–æt×WFF–öç3ÕöG5VæF–æt×WFF–öç2æf–ÇFW"†ÓÓæÒç7FGW3ÓÓÒwVæF–ærwÇÆÒç7FGW3ÓÓÒvVçf–Fòr“°¢6fUVæF–æuFõ7F÷&vR‚“·&VæFW%VæF–æt×WFF–öç2‚“°¢Fö7B‚~)É2†—7F÷&–ÂÆ–×–ò(	Br·&W7VVÇF2²rVÆ–Ö–æF2Âr·VæF–VçFW2æÆVæwF‚²rVæF–VçFW26öç6W'fF2rÂw7V66W72r“°¢ÒVÇ6RFö7B‚tæò6RVFòÆ–×–#¢r²‚†G"bfG"æW'&÷"—ÇÂvVÂ6W'f–F÷"æò&W7öæFœ;2ö²r’ÂvW'&÷"r“°¢Ö6F6‚†R—·Fö7B‚tW'&÷"Æ–×–æFò†—7F÷&–Ã¢r¶RæÖW76vRÂvW'&÷"r“·Ğ§Ğ ¢òò)H)H)H–Æ÷FòWFöÜ:F–6ò‡&÷VW7F26VÖæÆW2FVÂv÷&¶W"’)H)H)H)H ¦ÆWBöG4WF÷–Æ÷E&÷3ÕµÓ°¦7–æ2gVæ7F–öâ&VæFW$G4WF÷–Æ÷B‚—°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4WF÷–Æ÷EæVÂr“°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4WF÷–Æ÷DÆ—7Br“°¢6öç7B&FvSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4WF÷–Æ÷D&FvRr“°¢–b‚æVÇÇÂÆ—7B’&WGW&ã°¢G'—°¢6öç7B6fsÕö—'F&ÆT6öæf–r‚“°¢6öç7Bf÷&×VÆÖVæ6öFUU$”6ö×öæVçB‚$äB‡´vVçFWÓÒtE5ôUDõ”ÄõBrÇ´W7FF÷ÓÒuVæF–VçFRr’"“°¢6öç7B#Öv—B—'F&ÆT‡GG†G¶6fræ&6WÒòG´$4Uô”GÒôvVçEõVWVSöf–ÇFW$'”f÷&×VÆÒG¶f÷&×VÆÒgvU6—¦SÓÇ¶†VFW'3¦6fræ†VFW'7Ò“°¢–b‚"æö²’F‡&÷ræWrW'&÷"‚t—'F&ÆRr·"ç7FGW2“°¢6öç7BCÖv—B"æ§6öâ‚“°¢öG4WF÷–Æ÷E&÷3Ò†Bç&V6÷&G7ÇÅµÒ’æÖ‡&V3Óç°¢ÆWB÷WC×·Ó·G'—¶÷WCÔ¥4ôâç'6R‡&V2æf–VÆG3òä÷WGWGÇÂw·Òr“·Ö6F6‚†R—·Ğ¢&WGW&ç¶–C§&V2æ–BÆfV6†§&V2æf–VÆG3òå²tfV6†7&V6œ;6âu×ÇÇ&V2æ7&VFVEF–ÖRÇ&W7VÖVã¦÷WBç&W7VÖVçÇÂrrÆ66–öæW3¦÷WBæ66–öæW7ÇÅµÒÆ×WF6–öæW3¦÷WBæ×WF6–öæW7ÇÅµÒÆFW66'FF3¦÷WBæFW66'FF7ÇÅµ×Ó°¢Ò’æf–ÇFW"‡Óçæ×WF6–öæW2æÆVæwF‚“°¢Ö6F6‚†R—²æVÂç7G–ÆRæF—7Æ“ÒvæöæRs²&WGW&ã²Ğ¢–b‚öG4WF÷–Æ÷E&÷2æÆVæwF‚—²æVÂç7G–ÆRæF—7Æ“ÒvæöæRs²&WGW&ã²Ğ¢–b†&FvR’&FvRçFW‡D6öçFVçCÕöG4WF÷–Æ÷E&÷2æÆVæwF‚²rVæF–VçFRr²…öG4WF÷–Æ÷E&÷2æÆVæwF‚ÓÓòw2s¢rr“°¢Æ—7Bæ–ææW$…DÔÃÕöG4WF÷–Æ÷E&÷2æÖ‚‡Æ’“Óç°¢6öç7Bf–Æ3×æ66–öæW2æÖ†Óç°¢6öç7BFWCÖçF—óÓÓÒw&W7WVW7FòsöBG²†æçFW&–÷'ÇÃ’çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—Ò(i"Æ#âBG²†æçVWf÷ÇÃ’çFôÆö6ÆU7G&–ær‚vW2Ô4Âr—ÓÂö#âöL:Ö¦çF—ó°¢&WGW&âÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶föçB×6—¦S£ƒ·FF–æs£7‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW#"’#ãÇ7â7G–ÆSÒ&Ö–â×v–GFƒ£#ƒ¶6öÆ÷#§f"‚ÒÖ66VçB’#âG¶W66T‡FÖÂ†æÆ–æVÇÂrr—ÓÂ÷7ããÇ7â7G–ÆSÒ&fÆWƒ£¶6öÆ÷#§f"‚Ò×FW‡C"’#âG¶W66T‡FÖÂ†æ6×æÇÂrr—Ò+rG¶FWGÓÂ÷7ããÇ7â7G–ÆSÒ&fÆWƒ£¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶W66T‡FÖÂ†æÖ÷F—f÷ÇÂrr—ÓÂ÷7ããÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢&WGW&âÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚'ƒ¶&÷&FW"ÖÆVgC£7‚6öÆ–Bf"‚ÒÖ66VçB’#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–âÖ&÷GFöÓ£G‚#âG¶W66T‡FÖÂ‚‡æfV6†ÇÂrr’ç6Æ–6RƒÃb’ç&WÆ6R‚uBrÂrr’—ÓÂöF—cà¢G·ç&W7VÖVãöÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶Ö&v–âÖ&÷GFöÓ£g‚#âG¶W66T‡FÖÂ‡ç&W7VÖVâ—ÓÂöF—cæ¢rwĞ¢G¶f–Æ7Ğ¢G·æFW66'FF2æÆVæwFƒöÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–â×F÷£g‚#äFW66'FF2÷"wV&G&–Ç3¢G·æFW66'FF2æÖ‡ƒÓæW66T‡FÖÂ‚‡‚çF—÷ÇÂrr’²rr²‡‚æÆ–æVÇÂrr’²r‚r²‡‚æFW66'FWÇÂrr’²r’r’’æ¦ö–â‚r+rr—ÓÂöF—cæ¢rwĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶Ö&v–â×F÷£‚#à¢Æ'WGFöâ6Æ73Ò&'Fâ'Fâ×&–Ö'’'Fâ×6Ò"7G–ÆSÒ&föçB×6—¦S£‚"öæ6Æ–6³Ò&G4WF÷–Æ÷DFV6–FR‚G¶—ÒÇG'VR’#î)É2&ö&"’Æ–6#Âö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚ÒÖFævW"’"öæ6Æ–6³Ò&G4WF÷–Æ÷DFV6–FR‚G¶—ÒÆfÇ6R’#î)Ér&V6†¦#Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°§Ğ¦7–æ2gVæ7F–öâG4WF÷–Æ÷DFV6–FR†’Æ&ö&"—°¢6öç7BÕöG4WF÷–Æ÷E&÷5¶•Ó²–b‚’&WGW&ã°¢òò&R×fW&–f–6VÂW7FFò§W7FòçFW2‡VFò&ö&'6R÷"VÖ–Â†6RVâÖöÖVçFò“ ¢òòWf—FVæ6öÆ"F÷2fV6W2Æ2Ö—6Ö2×WF6–öæW2‡Vâ&7&VFR"GWÆ–6,:ÖÆ6×;’à¢G'—°¢6öç7B6fsÕö—'F&ÆT6öæf–r‚“°¢6öç7B#Öv—B—'F&ÆT‡GG†G¶6fræ&6WÒòG´$4Uô”GÒôvVçEõVWVRòG·æ–GÖÇ¶†VFW'3¦6fræ†VFW'7Ò“°¢–b‡"æö²—¶6öç7B&V3Öv—B"æ§6öâ‚“¶–b‚‡&V2æf–VÆG3òäW7FF÷ÇÂrr’ÓÒuVæF–VçFRr—·Fö7B‚tW7F&÷VW7F–gVR&ö6W6F‚r²‡&V2æf–VÆG3òäW7FF÷ÇÂ~(	Br’²r’rÂv–æfòr“·&VæFW$G4WF÷–Æ÷B‚“·&WGW&ã·×Ğ¢Ö6F6‚†R—·Ğ¢–b†&ö&"—°¢–b‚6öæf—&Ò†+ô&ö&"G·æ×WF6–öæW2æÆVæwF‡Ò6Ö&–ò‡2’FVÂ–Æ÷Fóò6RÆ–6,:âVâvöövÆRG2VâÆ,;7†–Ö6÷'&–FFVÂ67&—B"æ’’&WGW&ã°¢æ×WF6–öæW2æf÷$V6‚†ÓÓåöG5VWVT×WFF–öâ‡²ââæÒÇF–ÖW7F×¦ÒçF–ÖW7F×ÇÆæWrFFR‚’çFô•4õ7G&–ær‚’Ç7FGW3¢wVæF–ærwÒ’“°¢G'—¶v—B—'F&ÆUw&—FUFöÆW&çB‚tvVçEõVWVRrÂuD4‚rÇæ–BÇ´W7FFó¢t6ö×ÆWFFòrÂtfV6†V¦V7V6œ;6âs¦æWrFFR‚’çFô•4õ7G&–ær‚’Ât66–öâ7VvW&–Fs¦&ö&FòFW6FRF6†&ö&C¢G·æ×WF6–öæW2æÆVæwF‡Ò×WF6–öæW2Væ6öÆF6Ò“·Ö6F6‚†R—·Ğ¢Fö7B‚~)É2r·æ×WF6–öæW2æÆVæwF‚²r6Ö&–ò‡2’FVÂ–Æ÷FòVæ6öÆF÷2rÂw7V66W72r“°¢ÖVÇ6W°¢G'—¶v—B—'F&ÆUw&—FUFöÆW&çB‚tvVçEõVWVRrÂuD4‚rÇæ–BÇ´W7FFó¢tW'&÷"rÄW'&÷#¢u&V6†¦FòFW6FRVÂF6†&ö&B‚r¶æWrFFR‚’çFô•4õ7G&–ær‚’ç6Æ–6RƒÃb’²r’wÒ“·Ö6F6‚†R—·Ğ¢Fö7B‚u&÷VW7FFVÂ–Æ÷Fò&V6†¦FrÂv–æfòr“°¢Ğ¢&VæFW$G4WF÷–Æ÷B‚“°§Ğ ¢òò)H)H)H6öçfW'6–öæW2öffÆ–æR„5$Ò(i"vöövÆRG2’)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâöG4öfe7–æ4æÖW2‚—°¢6öç7BÃÒ†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdÆVDæÖRr’çfÇVWÇÂtÆVB6Æ–f–6Fò5$Òr’çG&–Ò‚“°¢6öç7BcÒ†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfefVçFæÖRr’çfÇVWÇÂufVçF5$Òr’çG&–Ò‚“°¢6öç7BSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdæÖTV6†ór“²–b†S’SçFW‡D6öçFVçCÖÇÇÂtÆVB6Æ–f–6Fò5$Òs°¢6öç7BS#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdæÖTV6†ó"r“²–b†S"’S"çFW‡D6öçFVçC×gÇÂufVçF5$Òs°§Ğ¦gVæ7F–öâ÷VäG4öffÆ–æTÖöFÂ‚—°¢6öç7B#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfe&W7VÇBr“²–b‡"—·"ç7G–ÆRæF—7Æ“ÒvæöæRs·"æ–ææW$…DÔÃÒrs·Ğ¢öG4öfe7–æ4æÖW2‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öffÆ–æTÖöFÂr’ç7G–ÆRæF—7Æ“ÒvfÆW‚s°§Ğ¦gVæ7F–öâ6Æ÷6TG4öffÆ–æTÖöFÂ‚—²Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öffÆ–æTÖöFÂr’ç7G–ÆRæF—7Æ“ÒvæöæRs²Ğ¦gVæ7F–öâöG4öffÆ–æUF–ÖR†B—°¢G'—²&WGW&âBçFôÆö6ÆU7G&–ær‚w7bÕ4RrÇ·F–ÖU¦öæS¢tÖW&–6õ6çF–vòwÒ’ç&WÆ6R‚uBrÂrr’ç6Æ–6RƒÃ’“²Ğ¢6F6‚†R—²&WGW&âBçFô•4õ7G&–ær‚’ç6Æ–6RƒÃ’’ç&WÆ6R‚uBrÂrr“²Ğ§Ğ¦gVæ7F–öâöG477d6VÆÂ‡b—²6öç7B3Õ7G&–ær‡cÓÖçVÆÃòrs§b“²&WGW&âõ²"ÅÆåÒòçFW7B‡2“òr"r·2ç&WÆ6R‚ò"örÂr""r’²r"s§3²Ğ¦gVæ7F–öâöG4F÷væÆöD55b†æÖRÇFW‡B—°¢6öç7B&Æö#ÖæWr&Æö"…·FW‡EÒÇ·G—S¢wFW‡Bö77c¶6†'6WC×WFbÓ‚wÒ“°¢6öç7BW&ÃÕU$Âæ7&VFTö&¦V7EU$Â†&Æö"“°¢6öç7BÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“²æ‡&Vc×W&Ã²æF÷væÆöCÖæÖS°¢Fö7VÖVçBæ&öG’æVæD6†–ÆB†“²æ6Æ–6²‚“°¢6WEF–ÖV÷WB‚‚“Óç·G'—¶Fö7VÖVçBæ&öG’ç&VÖ÷fT6†–ÆB†“·Ö6F6‚†R—·ÒU$Âç&Wfö¶Tö&¦V7EU$Â‡W&Â“·ÒÃS“°§Ğ¦gVæ7F–öâöG4vWDv6Æ–B†2—°¢–b‚7ÇÂ2æf–VÆG2’&WGW&ârs°¢6öç7BsÖ2æf–VÆG5²tt4Ä”BuÓ²–b†r’&WGW&â7G&–ær†r’çG&–Ò‚“°¢6öç7Bæ÷F3Ö2æf–VÆG5²tæ÷F2–çFW&æ2u×ÇÂrs²6öç7BÓÕ7G&–ær†æ÷F2’æÖF6‚‚öv6Æ–CÒ…µåÇ5Ò²’ö’“°¢&WGW&âÓöÕ³Ó¢rs°§Ğ¦gVæ7F–öâG4W‡÷'DöffÆ–æT6öçfW'6–öç2‚—°¢–b‡G—Vöb7FFSÓÓÒwVæFVf–æVBwÇÂ7FFRæÆöFVB—·Fö7B‚t6&v&–ÖW&òÆ÷2FF÷2FR—'F&ÆRrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7BF—3ÔÖF‚æÖ‚ƒÄÖF‚æÖ–âƒ“Ç'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdF—2r’çfÇVR—ÇÃ“’“°¢6öç7BF‡#×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfe66÷&Rr’çfÇVR—ÇÃc°¢6öç7BÆVEfÃ×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdÆVEfÂr’çfÇVR—ÇÃ°¢6öç7B–æ4ÆVG3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfd–æ4ÆVG2r’æ6†V6¶VC°¢6öç7B–æ5fVçF3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfd–æ5fVçF2r’æ6†V6¶VC°¢6öç7BäÆVCÒ†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfdÆVDæÖRr’çfÇVWÇÂtÆVB6Æ–f–6Fò5$Òr’çG&–Ò‚“°¢6öç7BåfVçFÒ†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfefVçFæÖRr’çfÇVWÇÂufVçF5$Òr’çG&–Ò‚“°¢6öç7B7WFöfcÖæWrFFR„FFRææ÷r‚’ÖF—2£ƒcC“°¢6öç7BWF46Æ–cÕ²u&÷VW7FVçf–FrÂtæVvö6–6œ;6ârÂt6Æ–VçFR7F—fòuÓ°¢6öç7B&÷w3ÕµÓ²ÆWB6–äv6Æ–CÓÂäÆVG3ÓÂåfVçF3Ó°¢–b†–æ4ÆVG2—°¢‡7FFRæ6Æ–VçFW7ÇÅµÒ’æf÷$V6‚†3Óç°¢6öç7BcÖ2æf–VÆG7ÇÇ·Ó²6öç7BFCÖ2æ7&VFVEF–ÖSöæWrFFR†2æ7&VFVEF–ÖR“¦çVÆÃ²–b‚FGÇÆFCÆ7WFöfb’&WGW&ã°¢6öç7B66÷&SÔçVÖ&W"†e²tÆVB66÷&R”u×ÇÆe²tÆVB66÷&Ru×ÇÃ“°¢6öç7BWFÖe²tWFfVçFu×ÇÂrs°¢–b‚‡66÷&Sã×F‡'ÇÆWF46Æ–bæ–æ6ÇVFW2†WF’’’&WGW&ã°¢6öç7BsÕöG4vWDv6Æ–B†2“²–b‚r—·6–äv6Æ–B²³·&WGW&ã·Ğ¢&÷w2çW6‚…¶rÆäÆVBÅöG4öffÆ–æUF–ÖR†FB’ÆÆVEfÃãöÆVEfÃ¢rrÂt4ÅuÒ“²äÆVG2²³°¢Ò“°¢Ğ¢–b†–æ5fVçF2—°¢‡7FFRçVF–F÷7ÇÅµÒ’æf÷$V6‚‡Óç°¢6öç7Bc×æf–VÆG7ÇÇ·Ó²–b‚†e²tW7FFòVF–Fòu×ÇÂrr“ÓÓÒt6æ6VÆFòr’&WGW&ã°¢6öç7BFC×æ7&VFVEF–ÖSöæWrFFR‡æ7&VFVEF–ÖR“¦çVÆÃ²–b‚FGÇÆFCÆ7WFöfb’&WGW&ã°¢6öç7B6–CÔ'&’æ—4'&’†e²t6Æ–VçFRuÒ“öe²t6Æ–VçFRuÕ³Ó¢‡G—Vöbe²t6Æ–VçFRuÓÓÓÒw7G&–ærsöe²t6Æ–VçFRuÓ¦çVÆÂ“°¢6öç7B6Æ“Ò†6–Bbg7FFRæ6Æ–VçFW4'”–E&V2“÷7FFRæ6Æ–VçFW4'”–E&V5¶6–EÓ¦çVÆÃ°¢6öç7BsÕöG4vWDv6Æ–B†6Æ’“²–b‚r—·6–äv6Æ–B²³·&WGW&ã·Ğ¢6öç7BfÃÔÖF‚ç&÷VæB‚†e²tÖöçFòF÷FÂ„4Å’u×ÇÃ’óã’“°¢&÷w2çW6‚…¶rÆåfVçFÅöG4öffÆ–æUF–ÖR†FB’ÇfÃã÷fÃ¢rrÂt4ÅuÒ“²åfVçF2²³°¢Ò“°¢Ğ¢6öç7B÷WCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4öfe&W7VÇBr“²–b†÷WB’÷WBç7G–ÆRæF—7Æ“Òv&Æö6²s°¢–b‚&÷w2æÆVæwF‚—°¢–b†÷WB’÷WBæ–ææW$…DÔÃÒsÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#äæò6RVæ6öçG&&öâ6öçfW'6–öæW26öâv6Æ–BVâVÂW,:ÖöFòâ&Wf—6VRÆ6öÇVÖæÆ#ät4Ä”CÂö#âW†—7FVâ6Æ–VçFW2’VRW7L:–âÆÆVvæFòÆVG2FW6FRvöövÆRG2†òVRVÂv6Æ–BVVFRVâæ÷F2–çFW&æ2’ãÂ÷7ãâs°¢&WGW&ã°¢Ğ¢6öç7B†VFW#Òu&ÖWFW'3¥F–ÖU¦öæSÔÖW&–6õ6çF–võÆävöövÆR6Æ–6²”BÄ6öçfW'6–öâæÖRÄ6öçfW'6–öâF–ÖRÄ6öçfW'6–öâfÇVRÄ6öçfW'6–öâ7W'&Væ7’s°¢6öç7B77cÖ†VFW"²uÆâr·&÷w2æÖ‡#Óç"æÖ…öG477d6VÆÂ’æ¦ö–â‚rÂr’’æ¦ö–â‚uÆâr’²uÆâs°¢öG4F÷væÆöD55b‚v6öçfW'6–öæW5ööffÆ–æUòr¶†÷”4Â‚’²ræ77brÆ77b“°¢–b†÷WB’÷WBæ–ææW$…DÔÃÒ~)É255bvVæW&Fó¢Æ#âr·&÷w2æÆVæwF‚²sÂö#â6öçfW'6–öæW2‚r¶äÆVG2²rÆVG2+rr¶åfVçF2²rfVçF2’r²‡6–äv6Æ–Còr+rÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#âr·6–äv6Æ–B²r6–âv6Æ–BöÖ—F–F3Â÷7ãâs¢rr’²rãÆ'#å<;¦&VÆòVâvöövÆRG2(i"ö&¦WF—f÷2(i"6öçfW'6–öæW2(i"6&v2(i"7V&—"âs°§Ğ ¦7–æ2gVæ7F–öâG4F–væ÷7F–6ò‚—°¢6öç7B6fsÖvWDG46öæf–r‚“°¢6öç7B÷WCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4F–t÷WGWBr“°¢–b‚÷WB’&WGW&ã°¢÷WBç7G–ÆRæF—7Æ“Òv&Æö6²s°¢÷WBæ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C2’#î(û2F–væ÷7F–6æFòââãÂöF—câs°¢6öç7BÆ–æW3ÕµÓ°¢Æ–æW2çW6‚†Æ#äVæGö–çB6öæf–wW&Fó£Âö#âÆ6öFR7G–ÆSÒ&föçB×6—¦S£—ƒ·v÷&BÖ'&V³¦'&V²ÖÆÂ#âG¶W66T‡FÖÂ†6fræVæGö–çGÇÂr†æ–æwVæò’r—ÓÂö6öFSæ“°¢Æ–æW2çW6‚†Æ#ä7W7FöÖW"”C£Âö#âG¶W66T‡FÖÂ†6fræ7W7FöÖW$–GÇÂr†æòFVf–æ–Fò’r—Ö“°¢Æ–æW2çW6‚†Æ#ä×WF6–öæW2Æö6ÆW2†Æö6Å7F÷&vR“£Âö#âGµöG5VæF–æt×WFF–öç2æÆVæwF‡ÒF÷FÆ“°¢6öç7B'•7FGW3×·ÓµöG5VæF–æt×WFF–öç2æf÷$V6‚†ÓÓç¶'•7FGW5¶Òç7FGW5ÓÒ†'•7FGW5¶Òç7FGW5×ÇÃ’³·Ò“°¢ö&¦V7BæVçG&–W2†'•7FGW2’æf÷$V6‚‚…·2ÆåÒ“ÓæÆ–æW2çW6‚†fæ'7¾(i"G·7Ó¢G¶çÖ’“°¢–b†6fræVæGö–çB—°¢G'—°¢6öç7BW&ÃÖ6fræVæGö–çB²†6fræVæGö–çBæ–æ6ÇVFW2‚sòr“òrbs¢sòr’²v7F–öãÖ×WFF–öç2e÷CÒr´FFRææ÷r‚“°¢6öç7B#Öv—BfWF6‚‡W&Â“¶6öç7BCÖv—B"æ§6öâ‚“°¢–b†Bæö²bd'&’æ—4'&’†Bæ×WFF–öç2’—°¢Æ–æW2çW6‚†Æ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×7V66W72’#î)É267&—B&W7öæFRô³Âö#â(	BG¶Bæ×WFF–öç2æÆVæwF‡Ò×WF6–öæW2ÆÖ6VæF6“°¢6öç7B'•3#×·Ó¶Bæ×WFF–öç2æf÷$V6‚†ÓÓç¶'•3%¶Òç7FGW5ÓÒ†'•3%¶Òç7FGW5×ÇÃ’³·Ò“°¢ö&¦V7BæVçG&–W2†'•3"’æf÷$V6‚‚…·2ÆåÒ“ÓæÆ–æW2çW6‚†fæ'7¾(i"Æ#âG·7ÓÂö#ã¢G¶çÖ’“°¢6öç7BVæF–æsÖBæ×WFF–öç2æf–ÇFW"†ÓÓæÒç7FGW3ÓÓÒwVæF–ærwÇÆÒç7FGW3ÓÓÒvVçf–Fòr“°¢–b‡VæF–æræÆVæwF‚—°¢6öç7BöÆFW7C×VæF–ærç6÷'B‚†Æ"“ÓæçF–ÖW7F×æÆö6ÆT6ö×&R†"çF–ÖW7F×’•³Ó°¢6öç7BÖ–ç3ÔÖF‚ç&÷VæB‚„FFRææ÷r‚’ÖæWrFFR†öÆFW7BçF–ÖW7F×’ævWEF–ÖR‚’’óc“°¢Æ–æW2çW6‚†Æ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×v&â’#î)ªG·VæF–æræÆVæwF‡Ò×WF6œ;6â†W2’6–âÆ–6#Âö#â(	BÆÜ:2çF–wVF–VæRG¶Ö–ç7ÒÖ–æ“°¢–b†Ö–ç3ãc’Æ–æW2çW6‚†Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#î(i"VÂ67&—B"æò†6÷'&–FòVâÜ:2FR†÷&âfW&–f–6VRFVævVâG&–vvW"†÷&&–ò6öæf–wW&FòVâvöövÆRG2(i"†W'&Ö–VçF2(i"67&—G2(i"(ûÂ÷7ãæ“°¢VÇ6RÆ–æW2çW6‚†(i"VÂ67&—B"FV&W,:Ö&ö6W6&Æ2VâÆ,;7†–ÖV¦V7V6œ;6â‡6’F–VæRG&–vvW"†÷&&–ò’æ“°¢ÒVÇ6R–b†Bæ×WFF–öç2æÆVæwF‚—°¢Æ–æW2çW6‚†Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×7V66W72’#î)É2FöF2Æ2×WF6–öæW2†â6–FòÆ–6F2÷"67&—B#Â÷7ãæ“°¢Ğ¢ÒVÇ6R°¢Æ–æW2çW6‚†Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#î)Ér67&—B&W7öæFœ;26öâW'&÷#£Âö#âG¶W66T‡FÖÂ‚†BbfBæW'&÷"—ÇÂw&W7VW7F–çl:Æ–Fr—Ö“°¢Ğ¢Ö6F6‚†R—°¢Æ–æW2çW6‚†Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#î)Éræò6RVFò6öæV7F"6öâ67&—B£Âö#âG¶W66T‡FÖÂ†RæÖW76vR—Ö“°¢Æ–æW2çW6‚†(i"fW&–f–6VRVÂ67&—BW7L:’V&Æ–6Fò6öÖòÆ#äÆ–66œ;6âvV#Âö#â6öâ66W6òÆ#åFöF÷2„ç–öæR“Âö#âæ“°¢Ğ¢ÒVÇ6R°¢Æ–æW2çW6‚†Æ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#î)Éræò†’VæGö–çB6öæf–wW&FóÂö#â(	BVvÆU$ÂFVÂ67&—B'&–&æ“°¢Ğ¢÷WBæ–ææW$…DÔÃÖÆ–æW2æÖ†ÃÓæÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£Gƒ¶föçB×6—¦S£‚#âG¶ÇÓÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¦gVæ7F–öâ6VæDG4×WFF–öâ†×WFF–öâ—°¢6öç7B6fsÖvWDG46öæf–r‚“°¢–b‚6fræVæGö–çB—¶×WFF–öâç7FGW3ÒvW'&÷"s¶×WFF–öâæW'&÷#Òtæò†’VæGö–çB6öæf–wW&Fòs·6fUVæF–æuFõ7F÷&vR‚“·&VæFW%VæF–æt×WFF–öç2‚“·&WGW&ã·Ğ¢–b‚6frç6V7&WB—¶×WFF–öâç7FGW3ÒvW'&÷"s¶×WFF–öâæW'&÷#Òt6öæf–wW&VÂ6V7&WFòFR×WF6–öæW2s·6fUVæF–æuFõ7F÷&vR‚“·&VæFW%VæF–æt×WFF–öç2‚“·&WGW&ã·Ğ¢òòFW‡B÷Æ–âWf—FVÂ4õ%2&VfÆ–v‡BVR&Æ÷VVÆ÷2õ5G2vöövÆR267&—@¢fWF6‚†6fræVæGö–çBÇ°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3§²t6öçFVçBÕG—Rs¢wFW‡B÷Æ–âwÒÀ¢&öG“¤¥4ôâç7G&–æv–g’‡·6V7&WC¦6frç6V7&WBÇG—S¢v×WFF–öârÂââæ×WFF–öçÒ¢Ò’çF†Vâ‡#Óç"æ§6öâ‚’’çF†Vâ†CÓç°¢–b†BbfBæö²—¶×WFF–öâç7FGW3ÒvVçf–Fòs¶×WFF–öâæW'&÷#Òrs·Ğ¢VÇ6W¶×WFF–öâç7FGW3ÒvW'&÷"s¶×WFF–öâæW'&÷#Ò†BbfBæW'&÷"—ÇÂtVÂ6W'f–F÷"&V6†¬;2Æ×WF6œ;6âs·Ğ¢6fUVæF–æuFõ7F÷&vR‚“°¢&VæFW%VæF–æt×WFF–öç2‚“°¢Ò’æ6F6‚‚‚“Óç°¢×WFF–öâç7FGW3ÒvW'&÷"s¶×WFF–öâæW'&÷#Òu6–â6öæW†œ;6â6öâVÂVæGö–çB‡6R&V–çFVçF,:ÂwV&F"FRçVWfò’s°¢6fUVæF–æuFõ7F÷&vR‚“°¢&VæFW%VæF–æt×WFF–öç2‚“°¢Ò“°§Ğ ¢òò6–æ7&öæ—¦VÂW7FFòFRÆ2×WF6–öæW2FW6FRVÂ6W'f–F÷"…67&—B’(	B&VfÆV¦ÆòVRVÂ67&—B"Æ–<;0¦7–æ2gVæ7F–öâ7–æ4×WFF–öå7FGW6W2‚—°¢6öç7B6fsÖvWDG46öæf–r‚“°¢–b‚6fræVæGö–çGÇÂöG5VæF–æt×WFF–öç2æÆVæwF‚’&WGW&ã°¢G'—°¢6öç7B#Öv—BfWF6‚†6fræVæGö–çB²†6fræVæGö–çBæ–æ6ÇVFW2‚sòr“òrbs¢sòr’²v7F–öãÖ×WFF–öç2e÷CÒr´FFRææ÷r‚’“°¢6öç7BCÖv—B"æ§6öâ‚“°¢–b‚Bæö·ÇÂ'&’æ—4'&’†Bæ×WFF–öç2’’&WGW&ã°¢ÆWBÆ–6F3ÓÆW'&÷&W3ÓÆ6†ævVCÖfÇ6S°¢öG5VæF–æt×WFF–öç2æf÷$V6‚†ÓÓç°¢6öç7B7'cÖBæ×WFF–öç2æf–æB‡3Óç2çF–ÖW7F×ÓÓÖÒçF–ÖW7F×“°¢–b‡7'bbg7'bç7FGW2bg7'bç7FGW2ÓÒwVæF–ærrbfÒç7FGW2Ó×7'bç7FGW2—°¢Òç7FGW3×7'bç7FGW3¶ÒæW'&÷#×7'bæW'&÷'ÇÂrs¶6†ævVC×G'VS°¢–b‡7'bç7FGW3ÓÓÒvÆ–6Fòr’Æ–6F2²³°¢–b‡7'bç7FGW3ÓÓÒvW'&÷"r’W'&÷&W2²³°¢Ğ¢Ò“°¢–b†6†ævVB—°¢öG5VæF–æt×WFF–öç3ÕöG5VæF–æt×WFF–öç2æf–ÇFW"†ÓÓæÒç7FGW2ÓÒvÆ–6Fòr“°¢6fUVæF–æuFõ7F÷&vR‚“°¢&VæFW%VæF–æt×WFF–öç2‚“°¢–b†Æ–6F2’Fö7B‚~)É2r¶Æ–6F2²r6Ö&–òr²†Æ–6F3ãòw2s¢rr’²rÆ–6Fòr²†Æ–6F3ãòw2s¢rr’²rVâvöövÆRG2rÂw7V66W72r“°¢–b†W'&÷&W2’Fö7B‚~)ªr¶W'&÷&W2²r×WF6œ;6âr²†W'&÷&W3ãòvW2s¢rr’²r6öâW'&÷"(	B&Wf—6VÂFWFÆÆRVâ6Ö&–÷2VæF–VçFW2rÂvW'&÷"r“°¢Ğ¢Ö6F6‚†R—·Ğ§Ğ ¦gVæ7F–öâ&VæFW%VæF–æt×WFF–öç2‚—°¢6öç7BæVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG5VæF–æuæVÂr“°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG5VæF–ætÆ—7Br“°¢6öç7B&FvSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG5VæF–æt&FvRr“°¢–b‚öG5VæF–æt×WFF–öç2æÆVæwF‚—¶–b‡æVÂ—æVÂç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ğ¢–b‡æVÂ—æVÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢6öç7Bf—6–&ÆW3ÕöG5VæF–æt×WFF–öç2æf–ÇFW"†ÓÓæÒç7FGW2ÓÒvÆ–6Fòr“°¢–b‚f—6–&ÆW2æÆVæwF‚—¶–b‡æVÂ—æVÂç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ğ¢6öç7BåVæC×f—6–&ÆW2æf–ÇFW"†ÓÓæÒç7FGW2ÓÒvW'&÷"r’æÆVæwFƒ°¢6öç7BäW'#×f—6–&ÆW2æf–ÇFW"†ÓÓæÒç7FGW3ÓÓÒvW'&÷"r’æÆVæwFƒ°¢–b†&FvR’&FvRçFW‡D6öçFVçCÖåVæB²rVæF–VçFRr²†åVæBÓÓòw2s¢rr’²†äW'#òr+rr¶äW'"²rW'&÷"r²†äW'"ÓÓòvW2s¢rr“¢rr“°¢6öç7B&WG'”'FãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG5&WG'”ÆÄ'Fâr“°¢–b‡&WG'”'Fâ’&WG'”'Fâç7G–ÆRæF—7Æ“ÖäW'#òrs¢væöæRs°¢6öç7B÷Æ&VÃ×¶7&VFS¢t7&V"rÆVF—C¢tVF—F"rÆFVÆWFS¢tVÆ–Ö–æ"rÆæVvF—fS¢tæVvF—fòrÇW6Uö¶W—v÷&C¢uW6"·rwÓ°¢6öç7B×WDFW63ÖÓÓç°¢–b†Òæ÷ÓÓÒvæVvF—fRwÇÆÒæ÷ÓÓÒwW6Uö¶W—v÷&Br—&WGW&â†ÒæFFbfÒæFFçFW&Ö–æóò|*²r¶ÒæFFçFW&Ö–æò²|+²s¢rr’²†ÒæFFbfÒæFFæ6×æòr+rr¶ÒæFFæ6×æ¢rr“°¢&WGW&â†ÒæFFbfÒæFFææöÖ'&R—ÇÆÒæ–GÇÂrs°¢Ó°¢6öç7B7DÖ×°¢VæF–æs§¶3¢wf"‚Ò×v&â’rÇC¢~(û2VæF–VçFRwÒÀ¢Vçf–Fó§¶3¢wf"‚ÒÖ66VçC2’rÇC¢~)É2Vâ6öÆ(	BW7W&æFò67&—B"wÒÀ¢W'&÷#§¶3¢wf"‚ÒÖFævW"’rÇC¢~)ØÂW'&÷"wĞ¢Ó°¢Æ—7Bæ–ææW$…DÔÃ×f—6–&ÆW2æÖ†ÓÓç°¢6öç7B7C×7DÖ¶Òç7FGW5×ÇÇ7DÖçVæF–æs°¢6öç7B&WG'“ÖÒç7FGW3ÓÓÒvW'&÷"söÆ'WGFöâöæ6Æ–6³Ò'&WG'”×WFF–öâ‚rG¶ÒçF–ÖW7F×Òr’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW#"“¶6öÆ÷#§f"‚ÒÖ66VçB“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£—ƒ·FF–æs£‚gƒ¶&÷&FW"×&F—W3£Gƒ¶Æ–æRÖ†V–v‡C£ãB"F—FÆSÒ%&V–çFVçF"#î(k²&V–çFVçF#Âö'WGFöãæ¢rs°¢6öç7BW'$Æ–æSÖÒç7FGW3ÓÓÒvW'&÷"rbfÒæW'&÷#öÆF—b7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚ÒÖFævW"“¶Ö&v–â×F÷£7ƒ·FF–ærÖÆVgC£'‚#âG¶W66T‡FÖÂ†ÒæW'&÷"—ÓÂöF—cæ¢rs°¢&WGW&â ¢ÆF—b7G–ÆSÒ'FF–æs£w‚ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6S"“¶&÷&FW"×&F—W3£gƒ¶föçB×6—¦S£‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‚#à¢Ç7â7G–ÆSÒ&6öÆ÷#¢G¶Òæ÷ÓÓÒvFVÆWFRwÇÆÒæ÷ÓÓÒwW6Uö¶W—v÷&Bsòwf"‚ÒÖFævW"’s¦Òæ÷ÓÓÒv7&VFRsòwf"‚Ò×7V66W72’s¢wf"‚ÒÖ66VçB’wÓ¶föçB×vV–v‡C£c¶fÆW‚×6‡&–æ³£#âG¶÷Æ&VÅ¶Òæ÷×ÇÆÒæ÷ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡C"“¶fÆWƒ£¶Ö–â×v–GFƒ£¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3·v†—FR×76S¦æ÷w&#âG¶W66T‡FÖÂ†×WDFW62†Ò’—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#¢G·7Bæ7Ó¶föçB×6—¦S£—ƒ·v†—FR×76S¦æ÷w&¶fÆW‚×6‡&–æ³£#âG·7BçGÓÂ÷7ãà¢G·&WG'—Ğ¢Æ'WGFöâöæ6Æ–6³Ò'&VÖ÷fUVæF–æt×WFF–öä'•G2‚rG¶ÒçF–ÖW7F×Òr’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×FW‡C2“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£Gƒ·FF–æs£¶Æ–æRÖ†V–v‡C£¶fÆW‚×6‡&–æ³£"F—FÆSÒ%V—F"FRÆ6öÆ#ì9sÂö'WGFöãà¢ÂöF—cà¢G¶W'$Æ–æWĞ¢ÂöF—cæ·Ò’æ¦ö–â‚rr“°§Ğ ¦gVæ7F–öâ&VÖ÷fUVæF–æt×WFF–öä'•G2‡G2—°¢öG5VæF–æt×WFF–öç3ÕöG5VæF–æt×WFF–öç2æf–ÇFW"†ÓÓæÒçF–ÖW7F×Ó×G2“°¢6fUVæF–æuFõ7F÷&vR‚“°¢&VæFW%VæF–æt×WFF–öç2‚“°§Ğ ¢òòWFò×öÆÃ¢fW&–f–6W7FFòFR×WF6–öæW26F"Ö–â6’†’VæF–VçFW2’VÂF"vV"W7L:7F—fğ¦ÆWBöG4×WFF–öåöÆÄ–çFW'fÃÖçVÆÃ°¦gVæ7F–öâ÷7F'DG4×WFF–öåöÆÂ‚—°¢–b…öG4×WFF–öåöÆÄ–çFW'fÂ’&WGW&ã°¢öG4×WFF–öåöÆÄ–çFW'fÃ×6WD–çFW'fÂ‚‚“Óç°¢6öç7B†5VæF–æsÕöG5VæF–æt×WFF–öç2ç6öÖR†ÓÓæÒç7FGW3ÓÓÒvVçf–FòwÇÆÒç7FGW3ÓÓÒwVæF–ærr“°¢6öç7BvV$7F—fSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wF"×vV"r“òæ6Æ74Æ—7Bæ6öçF–ç2‚v7F—fRr“°¢–b††5VæF–ærbgvV$7F—fR’7–æ4×WFF–öå7FGW6W2‚“°¢VÇ6R–b‚†5VæF–ær—¶6ÆV$–çFW'fÂ…öG4×WFF–öåöÆÄ–çFW'fÂ“µöG4×WFF–öåöÆÄ–çFW'fÃÖçVÆÃ·Ğ¢ÒÃ#“°§Ğ¦gVæ7F–öâ÷7F÷G4×WFF–öåöÆÂ‚—¶–b…öG4×WFF–öåöÆÄ–çFW'fÂ—¶6ÆV$–çFW'fÂ…öG4×WFF–öåöÆÄ–çFW'fÂ“µöG4×WFF–öåöÆÄ–çFW'fÃÖçVÆÃ·×Ğ ¦gVæ7F–öâ&WG'”×WFF–öâ‡G2—°¢6öç7BÓÕöG5VæF–æt×WFF–öç2æf–æB‡ƒÓç‚çF–ÖW7F×ÓÓ×G2“°¢–b‚Ò’&WGW&ã°¢Òç7FGW3ÒwVæF–ærs¶ÒæW'&÷#Òrs°¢6fUVæF–æuFõ7F÷&vR‚“°¢6VæDG4×WFF–öâ†Ò“°¢&VæFW%VæF–æt×WFF–öç2‚“°§Ğ¦gVæ7F–öâ&WG'”ÆÄW'&÷'2‚—°¢6öç7BW'&÷'3ÕöG5VæF–æt×WFF–öç2æf–ÇFW"†ÓÓæÒç7FGW3ÓÓÒvW'&÷"r“°¢–b‚W'&÷'2æÆVæwF‚—·Fö7B‚u6–âW'&÷&W2VR&V–çFVçF"rÂv–æfòr“·&WGW&ã·Ğ¢W'&÷'2æf÷$V6‚†ÓÓç¶Òç7FGW3ÒwVæF–ærs¶ÒæW'&÷#Òrs·Ò“°¢6fUVæF–æuFõ7F÷&vR‚“°¢&VæFW%VæF–æt×WFF–öç2‚“°¢W'&÷'2æf÷$V6‚†ÓÓç6VæDG4×WFF–öâ†Ò’“°¢Fö7B†(k²&V–çFVçFæFòG¶W'&÷'2æÆVæwF‡Ò×WF6œ;6âG¶W'&÷'2æÆVæwFƒãòvW2s¢rwÒââæÂv–æfòr“°§Ğ ¦7–æ2gVæ7F–öâÆöDG4FF‚—°¢6öç7B6fsÖvWDG46öæf–r‚“°¢6öç7BF—3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG5W&–öE6VÆV7Br“òçfÇVWÇÂs3r“°¢²vG4vVçD&÷‚rÂvG466–FD&÷‚rÂvG57VvvW7D&÷‚uÒæf÷$V6‚†–CÓç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂç7G–ÆRæF—7Æ“ÒvæöæRs·Ò“°¢²vG2Ö·’Öv7FòrÂvG2Ö·’Ö–×rÂvG2Ö·’Ö6Æ–72rÂvG2Ö·’Ö7G"rÂvG2Ö·’Ö72rÂvG2Ö·’Ö6öçbrÂvG2Ö·’Ö7rÂvG2Ö·’×&ö2uÒæf÷$V6‚†–CÓç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂçFW‡D6öçFVçCÒ~(
bs·Ò“°¢–b‚6fræVæGö–çB—°¢òòÖöFòFVÖğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–vç4&Vr’æ–ææW$…DÔÃÒsÆF—b6Æ73Ò&ÆöF–ær×7FFR"7G–ÆSÒ'FF–æs£#‚#ãÆF—b6Æ73Ò'7–ææW"#ãÂöF—cãÂöF—câs°¢v—BæWr&öÖ—6R‡#Óç6WEF–ÖV÷WB‡"Ãc’“°¢6öç7BFVÖóÖvWDG4FVÖôFF†F—2“°¢v–æF÷råöG4Æ7DFFÖFVÖó°¢&VæFW$G4µ—2†FVÖòÆF—2“°¢&VæFW$G46×–vç2†FVÖò“°¢&VæFW$G4vVçB†FVÖò“°¢&VæFW$G466–FB†FVÖò“°¢&VæFW$G57VvW&Væ6–2†FVÖò“°¢&VæFW%VæF–æt×WFF–öç2‚“°¢G'—¶ÆöEvV%7FG2‚“·Ö6F6‚†W'"—¶6öç6öÆRæW'&÷"‚vÆöEvV%7FG2rÆW'"“·Ğ¢6öç7BF÷CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57FGW4F÷Br“°¢–b†F÷B—¶F÷Bç7G–ÆRæ&6¶w&÷VæCÒwf"‚Ò×v&â’s¶F÷BçF—FÆSÒtÖöFòFVÖò(	B6öæf–wW&GRVæGö–çB&VÂs·Ğ¢&WGW&ã°¢Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–vç4&Vr’æ–ææW$…DÔÃÒsÆF—b6Æ73Ò&ÆöF–ær×7FFR"7G–ÆSÒ'FF–æs£C‚#ãÆF—b6Æ73Ò'7–ææW"#ãÂöF—câ6&væFòvöövÆRG>(
cÂöF—câs°¢G'—°¢6öç7B6–E&ÓÖ6fræ7W7FöÖW$–Còrf7W7FöÖW$–CÒr¶Væ6öFUU$”6ö×öæVçB†6fræ7W7FöÖW$–B“¢rs°¢6öç7BW&ÃÖ6fræVæGö–çB²†6fræVæGö–çBæ–æ6ÇVFW2‚sòr“òrbs¢sòr’²vF—3Òr¶F—2¶6–E&Ò²re÷CÒr´FFRææ÷r‚“°¢6öç7B#Öv—BfWF6‚‡W&Â“°¢–b‚"æö²’F‡&÷ræWrW'&÷"‚t…EEr·"ç7FGW2“°¢6öç7BFFÖv—B"æ§6öâ‚“°¢–b‚FFæö²’F‡&÷ræWrW'&÷"†FFæW'&÷'ÇÂu&W7VW7F–çl:Æ–FFVÂ67&—Br“°¢òò&VæFW'2f—7VÆW2—6ÆF÷3¢VâfÆÆòVâVæòæòFV&R&Æ÷VV"Æ6–æ7&öæ—¦6œ;6âFR×WF6–öæW0¢v–æF÷råöG4Æ7DFFÖFF°¢G'—²&VæFW$G4µ—2†FFÆF—2“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚w&VæFW$G4µ—2rÆW'"“²Ğ¢G'—²&VæFW$G46×–vç2†FF“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚w&VæFW$G46×–vç2rÆW'"“²Ğ¢G'—²&VæFW$G4vVçB†FF“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚w&VæFW$G4vVçBrÆW'"“²Ğ¢G'—²&VæFW$G466–FB†FF“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚w&VæFW$G466–FBrÆW'"“²Ğ¢G'—²&VæFW$G57VvW&Væ6–2†FF“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚w&VæFW$G57VvW&Væ6–2rÆW'"“²Ğ¢G'—²ÆöEvV%7FG2‚“²Ö6F6‚†W'"—²6öç6öÆRæW'&÷"‚vÆöEvV%7FG2rÆW'"“²Ğ¢&VæFW%VæF–æt×WFF–öç2‚“°¢òò&VfÆV¦VâVÂF6†&ö&BÆòVRVÂ67&—B"–Æ–<;2VâvöövÆRG0¢7–æ4×WFF–öå7FGW6W2‚“°¢G'—·&VæFW$G4WF÷–Æ÷B‚“·Ö6F6‚†W'"—·Ğ¢6öç7BösÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG4WFõvVV¶Ç’r“¶–b…ör•öræ6†V6¶VCÖÆö6Å7F÷&vRævWD—FVÒ‚vG5öWFõ÷vVV¶Ç’r“ÓÓÒss°¢6WEF–ÖV÷WB‚‚“Óç·G'—¶G4WFõvVV¶Ç”6†V6²‚“·Ö6F6‚†R—·×ÒÃ#“°¢6öç7BF÷CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57FGW4F÷Br“°¢–b†F÷B—¶F÷Bç7G–ÆRæ&6¶w&÷VæCÒwf"‚Ò×7V66W72’s¶F÷BçF—FÆSÒt6öæV7FFòs·Ğ¢6öç7B'FäçVWfÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v'FäçVWf6×ær“°¢–b†'FäçVWf’'FäçVWfç7G–ÆRæF—7Æ“Òv–æÆ–æRÖfÆW‚s°¢òò7–æ2—'F&ÆR†æò&Æ÷VVçFR¢7–æ4G5Fô—'F&ÆR†FFÆF—2’çF†Vâ‚‚“ÓçFö7B‚~)É2vöövÆRG26–æ7&öæ—¦Fò6öâ—'F&ÆRrÂw7V66W72r’’æ6F6‚‚‚“Óç·Ò“°¢Ö6F6‚†R—°¢òò6–â6öæf–wW&6œ;6â&÷–FVÂW7V&–òVÂVæGö–çBW2VÂFVfVÇB†&F6öFVFó ¢òò6’fÆÆ‡6–â&VBÂ67&—B6:ÖFò’6VÖ÷2ÖöFòFVÖòVâfW¢FRÖ÷7G&"W'&÷ ¢–b‚Æö6Å7F÷&vRævWD—FVÒ‚vG5ö6öæf–rr’—°¢6öç7BFVÖóÖvWDG4FVÖôFF†F—2“°¢v–æF÷råöG4Æ7DFFÖFVÖó°¢G'—²&VæFW$G4µ—2†FVÖòÆF—2“²Ö6F6‚†W'"—·Ğ¢G'—²&VæFW$G46×–vç2†FVÖò“²Ö6F6‚†W'"—·Ğ¢G'—²&VæFW$G4vVçB†FVÖò“²Ö6F6‚†W'"—·Ğ¢G'—²&VæFW$G466–FB†FVÖò“²Ö6F6‚†W'"—·Ğ¢G'—²&VæFW$G57VvW&Væ6–2†FVÖò“²Ö6F6‚†W'"—·Ğ¢&VæFW%VæF–æt×WFF–öç2‚“°¢G'—²&VæFW%vV%7FG2†vWEvV$FVÖôFF†F—2’ÆF—2“²Ö6F6‚†W'"—·Ğ¢6öç7BF÷CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57FGW4F÷Br“°¢–b†F÷B—¶F÷Bç7G–ÆRæ&6¶w&÷VæCÒwf"‚Ò×v&â’s¶F÷BçF—FÆSÒtÖöFòFVÖò(	BVæGö–çBæòF—7öæ–&ÆR‚r¶RæÖW76vR²r’s·Ğ¢&WGW&ã°¢Ğ¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG46×–vç4&Vr’æ–ææW$…DÔÃÖÆF—b6Æ73Ò&V×G’×7FFR"7G–ÆSÒ'FF–æs£C‚#ãÆF—b6Æ73Ò&V×G’Ö–6öâ#ãÇ7fr6Æ73Ò&F6†&ö&BÖ–6öâ"v–GFƒÒ##‚"†V–v‡CÒ##‚"7G&ö¶R×v–GFƒÒ#ãR#ãÇW6R‡&VcÒ"6–6öâ×v&æ–ær"óãÂ÷7fsãÂöF—cãÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖFævW"’#âG¶RæÖW76vWÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2“¶Ö&v–â×F÷£‡‚#åfW&–f–6VRVÂ267&—BW7L:’V&Æ–6Fò6öÖòÆ–66œ;6âvV"6öâ66W6ò;¦&Æ–6óÂöF—cãÂöF—cæ°¢²vG2Ö·’Öv7FòrÂvG2Ö·’Ö–×rÂvG2Ö·’Ö6Æ–72rÂvG2Ö·’Ö7G"rÂvG2Ö·’Ö72rÂvG2Ö·’Ö6öçbrÂvG2Ö·’Ö7rÂvG2Ö·’×&ö2uÒæf÷$V6‚†–CÓç¶6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B†–B“¶–b†VÂ–VÂçFW‡D6öçFVçCÒ~(	Bs·Ò“°¢6öç7BF÷CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vG57FGW4F÷Br“°¢–b†F÷B—¶F÷Bç7G–ÆRæ&6¶w&÷VæCÒwf"‚ÒÖFævW"’s¶F÷BçF—FÆSÒtW'&÷#¢r¶RæÖW76vS·Ğ¢Ğ§Ğ