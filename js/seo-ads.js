/* Auditor SEO del sitio Next.js y Google Ads. */
// Borrado definitivo de credenciales heredadas, sin volver a leerlas.
(function clearDeprecatedSiteCredentials(){
  try{localStorage.removeItem('wp_config');}catch(_){}
  try{sessionStorage.removeItem('wp_config');}catch(_){}
})();
// Auditor SEO on-page basado en sitemap real.
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
      const raw=await callAgentClaude('SEO',SEO_IA_SYS,JSON.stringify(batch));
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

// ── GOOGLE ADS AGENT ─────────────────────────────────────
// ── Snapshot histórico ──────────────────────────────────
function _adsLeadDate(record){
  const raw=String(record?.fields?.['Fecha primer contacto']||'').slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
    const d=new Date(raw+'T12:00:00');
    if(!Number.isNaN(d.getTime()))return d;
  }
  const created=record?.createdTime?new Date(record.createdTime):null;
  return created&&!Number.isNaN(created.getTime())?created:null;
}
function _adsClientAttributed(record){
  const f=record?.fields||{};
  const origin=String(f['Origen lead']?.name||f['Origen lead']||'').trim().toLowerCase();
  return !!(String(f.GCLID||'').trim()||String(f['Campaña Ads']||'').trim()||
    origin==='google_ads'||origin==='google ads');
}
function _adsCrmAttribution(days){
  const cutoff=new Date(Date.now()-Math.max(1,Number(days)||30)*86400000);
  const clients=state.clientes||[],adsIds=new Set();
  let leadsAds=0;
  for(const c of clients){
    if(!_adsClientAttributed(c))continue;
    adsIds.add(String(c.id));
    const d=_adsLeadDate(c);if(d&&d>=cutoff)leadsAds++;
  }
  let revenueAds=0,ordersAds=0;
  for(const p of state.pedidos||[]){
    const f=p.fields||{};
    if((f['Estado pedido']||'')==='Cancelado')continue;
    const d=p.createdTime?new Date(p.createdTime):null;if(!d||Number.isNaN(d.getTime())||d<cutoff)continue;
    const links=Array.isArray(f.Cliente)?f.Cliente:(f.Cliente?[f.Cliente]:[]);
    const ids=links.map(v=>String(v?.id||v));
    if(!ids.some(id=>adsIds.has(id)))continue;
    revenueAds+=Math.round((Number(f['Monto total (CLP)'])||0)/1.19);ordersAds++;
  }
  return{revenueAds,ordersAds,leadsAds,attributedClients:adsIds.size};
}

function adsSaveSnapshot(data,days){
  let snaps;try{snaps=JSON.parse(localStorage.getItem('ads_snapshots')||'[]');}catch(e){snaps=[];}
  if(!Array.isArray(snaps))snaps=[];
  const today=hoyCL();
  const imp=data.impresiones||0,clics=data.clics||0,gasto=data.gasto||0;
  const conv=data.conversiones||0;
  const ctr=imp>0?(clics/imp*100):0;
  const roas=gasto>0&&(data.valor_conversion||0)>0?data.valor_conversion/gasto:0;
  const crm=_adsCrmAttribution(days);
  const roasCRM=gasto>0?crm.revenueAds/gasto:0;
  const camps={};(data.campanas||[]).forEach(c=>{if(c&&c.id!=null)camps[c.id]={gasto:c.gasto||0,conv:c.conversiones||0};});
  const snap={date:today,ts:new Date().toISOString(),gasto,clics,conv,roas,imp,ctr,days,
    ingresoAdsCRM:crm.revenueAds,leadsAds:crm.leadsAds,ordersAds:crm.ordersAds,roasCRM,camps};
  const idx=snaps.findIndex(row=>row.date===today&&Number(row.days||30)===Number(days||30));
  if(idx>=0)snaps[idx]=snap;else snaps.push(snap);
  snaps.sort((a,b)=>String(a.date).localeCompare(String(b.date))||Number(a.days||30)-Number(b.days||30));
  if(snaps.length>90)snaps.splice(0,snaps.length-90);
  localStorage.setItem('ads_snapshots',JSON.stringify(snaps));
  localStorage.setItem('ads_last_sync',new Date().toISOString());
}
function adsGetPrevSnapshot(days){
  let snaps;try{snaps=JSON.parse(localStorage.getItem('ads_snapshots')||'[]');}catch(e){snaps=[];}
  // Comparar SOLO contra un snapshot del MISMO largo de ventana. Los totales
  // (impresiones/clics/conversiones) escalan con los días, así que tomar el
  // snapshot anterior sin mirar `days` comparaba 7 vs 30 días y pintaba subidas o
  // caídas falsas de ~±300%. snaps va ordenado por fecha; el de HOY es el último
  // (mismo `date`); el "anterior" válido es el más reciente ANTES de hoy con igual `days`.
  const today=hoyCL();
  const previos=snaps.filter(s=>s&&s.date!==today&&(days==null||s.days===days));
  return previos.length?previos[previos.length-1]:null;
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
// Make webhook URL/key and Google Ads mutation secret live only in the Proxy
// Worker environment. They must never be shipped in the Pages bundle.
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
function _adsTextNorm(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function _adsOrderLineIds(order){
  const f=order?.fields||{},parts=[
    f['Notas pedido'],f['Material'],f['FT Material'],f['Ficha Tecnica'],f['Instrucciones fabricación']
  ];
  const quoteIds=(Array.isArray(f.Cotizaciones)?f.Cotizaciones:(f.Cotizaciones?[f.Cotizaciones]:[]))
    .map(v=>String(v?.id||v));
  const qIndex=new Map((state.cotizaciones||[]).map(q=>[String(q.id),q]));
  for(const qid of quoteIds){
    const q=(state.cotizacionesById&&state.cotizacionesById[qid])||qIndex.get(qid);
    const qf=q?.fields||{};
    parts.push(qf['Solicitud cliente (texto libre)'],qf['Detalle productos'],qf['Detalle JSON'],qf['Alias / Título']);
  }
  const clientIds=(Array.isArray(f.Cliente)?f.Cliente:(f.Cliente?[f.Cliente]:[])).map(v=>String(v?.id||v));
  const cIndex=new Map((state.clientes||[]).map(c=>[String(c.id),c]));
  for(const cid of clientIds){
    const c=(state.clientesByIdRec&&state.clientesByIdRec[cid])||cIndex.get(cid);
    parts.push(c?.fields?.['Servicio interés']);
  }
  const text=_adsTextNorm(parts.filter(Boolean).join(' | ')),ids=new Set();
  const hit=(id,re)=>{if(re.test(text))ids.add(id);};
  hit('chip-the-lab',/\bnfc\b|tarjeta inteligente|chip the lab/);
  hit('premiaciones',/trofeo|medalla|galvano|premiaci|reconocimiento|placa premio/);
  hit('cajas-personalizadas',/\bcaja\b|\bcajas\b|packaging|empaque|estuche/);
  hit('activaciones',/activacion|\bbtl\b|stand\b|montaje evento|produccion de evento/);
  hit('papeleria',/papeleria|tarjeta de presentacion|membrete|carpeta corporativa|folleto|imprenta/);
  hit('volumetricos',/volumetric|letra corporea|logo corporeo|neon|estructura corpore/);
  hit('carteleria',/carteleria|senaletica|letrero|rotulo|corte laser|grabado laser|placa acril/);
  hit('impresion-3d',/impresion 3d|\b3d\b|\bpla\b|\brpla\b|\bpetg\b|\babs\b|resina|prototipo 3d|funko/);
  hit('merchandising',/merchandising|regalo corporativo|promocional|llavero|\bbolsa\b|kit corporativo/);
  return [...ids];
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
        const ev=(maquinaState.eventos||{})[id+'_'+ds];
        if(gMant||ev?.tipo==='mantencion')enMant++;
        else if(ev?.tipo==='uso')enUso++;
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
  const fdmS=calcSlots(fdmSmallIds),fdmL=calcSlots(fdmLargeIds);
  const active=(state.pedidos||[]).filter(p=>{
    const e=(p.fields||{})['Estado pedido']||'';
    return!['Despachado','Completado','Cancelado'].includes(e);
  });
  const classified=new Map(active.map(p=>[p.id,_adsOrderLineIds(p)]));
  const unknown=active.filter(p=>!(classified.get(p.id)||[]).length);
  const countAny=ids=>active.filter(p=>(classified.get(p.id)||[]).some(id=>ids.includes(id))).length;
  const pct=n=>Math.min(Math.round(n/20*100),100);
  const sem=value=>{
    if(value>=85)return{s:'🔴',a:'PAUSAR',m:'Línea saturada — considera pausar campañas para no colapsar producción',c:'var(--danger)'};
    if(value>=65)return{s:'🟡',a:'REDUCIR',m:'Carga alta — reduce el presupuesto ~30% para controlar el flujo de pedidos',c:'var(--warn)'};
    if(value<40)return{s:'🟢',a:'ACTIVAR',m:'Capacidad disponible — activa o aumenta el presupuesto para captar más demanda',c:'var(--success)'};
    return{s:'⚪',a:'MANTENER',m:'Carga moderada — mantén el presupuesto actual',c:'var(--accent)'};
  };
  const mkRow=(id,label,value,info,lids)=>({id,label,pct:value,info,lineasIds:lids,...sem(value)});
  const laserIds=['carteleria'],manualIds=['premiaciones','merchandising','papeleria','activaciones','cajas-personalizadas','volumetricos','chip-the-lab'];
  const laser=countAny(laserIds),manual=countAny(manualIds);
  return[
    mkRow('3d_small','FDM Small (K1/K2/Ender)',fdmS.pct,fdmS.enUso+'/'+fdmS.disp+' slots esta semana',['impresion-3d']),
    mkRow('3d_large','FDM Large (Giga)',fdmL.pct,fdmL.enUso+'/'+fdmL.disp+' slots esta semana',['impresion-3d']),
    mkRow('laser','Láser / Cartelería',pct(laser),laser+' pedido'+(laser!==1?'s':'')+' de esta línea',laserIds),
    mkRow('manual','Manual (Premiaciones · Merch · Papelería · otros)',pct(manual),manual+' pedido'+(manual!==1?'s':'')+' de estas líneas'+(unknown.length?' · '+unknown.length+' sin clasificar':''),manualIds),
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
  const ctx=`\n\nANALIZA EN PROFUNDIDAD SÓLO ESTA CAMPAÑA:\nid=${camp.id} "${camp.nombre}" [${camp.estado}] · ${days} días\nPpto ${fmtMoney(camp.presupuesto||0)}/día (${util}% uso) · Gasto ${fmtMoney(camp.gasto||0)} · CTR ${ctr}% · CPC ${fmtMoney(cpc)} · Conv ${camp.conversiones||0} · CPA ${camp.conversiones>0?fmtMoney(cpa):'—'} · ROAS-Google ${(camp.valor_conversion||0)>0?ro+'x':'—'}\nDa un diagnóstico específico y las acciones concretas (con [ACTIONS]) para esta campaña. Si la muestra es chica, dilo.`;
  runAgentInline('ADS',ctx,(result)=>{
    const actions=_parseAdsActions(result);window._adsAgentActions=actions;
    const rEl=document.getElementById('agentInlineResult');if(rEl){rEl.style.whiteSpace='normal';rEl.innerHTML=typeof renderAgentResult==='function'?renderAgentResult('ADS',result,rEl._agentMeta||{}):formatAgentReport(result);}
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
  if(_adsIsReadOnly()||data?.demo)return;
  const today=hoyCL(),gasto=Number(data.gasto)||0,imp=Number(data.impresiones)||0,
    clics=Number(data.clics)||0,conv=Number(data.conversiones)||0,
    valConv=Number(data.valor_conversion)||0;
  const campaigns=(data.campanas||[]).slice(0,100).map(c=>({
    id:String(c.id||''),nombre:String(c.nombre||String(c.id||'')),estado:String(c.estado||'ENABLED'),
    presupuesto:Number(c.presupuesto)||0,gasto:Number(c.gasto)||0,
    impresiones:Number(c.impresiones)||0,clics:Number(c.clics)||0,
    conversiones:Number(c.conversiones)||0,valor_conversion:Number(c.valor_conversion)||0,
    score:adsHealthScore(c).score
  }));
  try{
    const result=await _adsProxyFetch('/ads/snapshot',{method:'POST',body:JSON.stringify({
      date:today,days:Number(days)||30,customerId:getAdsConfig().customerId||'',
      kpi:{gasto,impresiones:imp,clics,conversiones:conv,valor_conversion:valConv},
      campaigns
    })});
    if((result.legacy_duplicates||0)>0)
      console.warn('[Ads] snapshots históricos duplicados detectados:',result.legacy_duplicates);
  }catch(e){
    console.warn('[Ads] snapshot compartido no actualizado:',e.message);
  }
}
async function loadAdsSnapshotsFromAirtable(){
  let cfg;try{cfg=_airtableConfig();}catch(e){return;}
  const res=await airtableFetch('Google_Ads_KPIs',500);
  const records=res.records||[];if(!records.length)return;
  const canon=v=>String(v||'').replace(/\D/g,'');
  const current=canon(getAdsConfig().customerId);
  records.sort((a,b)=>String(b.fields['Fecha']||'').localeCompare(String(a.fields['Fecha']||''))||
    String(b.createdTime||'').localeCompare(String(a.createdTime||'')));
  const seen=new Set(),deduped=[];
  for(const r of records){
    const f=r.fields||{},key=canon(f['Customer ID'])+'|'+String(f['Fecha']||'')+'|'+Number(f['Días período']||30);
    if(current&&canon(f['Customer ID'])!==current||seen.has(key))continue;
    seen.add(key);deduped.push(r);
  }
  const snaps=deduped.reverse().map(r=>{const f=r.fields||{};return{
    date:f['Fecha']||'',ts:r.createdTime||f['Fecha']||'',
    gasto:f['Gasto (CLP)']||0,clics:f['Clics']||0,conv:f['Conversiones']||0,
    roas:f['ROAS']||0,imp:f['Impresiones']||0,ctr:(f['CTR (%)']||0)*100,
    days:f['Días período']||30
  };});
  localStorage.setItem('ads_snapshots',JSON.stringify(snaps.slice(-90)));
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
  a.download='campanas_google_ads_'+hoyCL()+'.csv';
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
  a.download='palabras_clave_google_ads_'+hoyCL()+'.csv';
  a.click();
  toast('✓ CSV de palabras clave descargado','success');
}
function getAdsConfig(){
  const _dw=_DEFAULTS.ADS_WEBAPP,_dc=_DEFAULTS.ADS_CUSTOMER;
  const defaults={endpoint:(_dw&&!_dw.startsWith('%%'))?_dw:'https://script.google.com/macros/s/AKfycbzepd4w_8meCRmOCsx-pngGHyQ_BqUXAaWAFE8WpIFtTO6zRmFPDukNarCXUNzmfLdt/exec',customerId:(_dc&&!_dc.startsWith('%%'))?_dc:'757-781-2099'};
  try{
    // Mutation credentials are server-side only. Purge the legacy browser copy
    // instead of migrating it between local/session storage.
    localStorage.removeItem('ads_mutation_secret');
    sessionStorage.removeItem('ads_mutation_secret');
    const previous=localStorage.getItem('ads_config');
    if(previous){
      const old=JSON.parse(previous);
      if(old&&typeof old==='object')
        localStorage.setItem('ads_config',JSON.stringify({endpoint:old.endpoint||'',customerId:old.customerId||''}));
    }
    const stored=JSON.parse(localStorage.getItem('ads_config')||'null');
    return {...defaults,...(stored||{})};
  }catch(e){return defaults;}
}
function _adsProxyConfig(){
  try{
    const px=typeof _proxyCfg==='function'?_proxyCfg():null;
    if(!px?.url||!px?.key)return null;
    const u=new URL(px.url);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)return null;
    return{url:u.href.replace(/\/$/,''),key:px.key};
  }catch(_){return null;}
}
async function _adsProxyFetch(path,options={}){
  const px=_adsProxyConfig();
  if(!px)throw new Error('Google Ads requiere Proxy Worker + Cloudflare Access para cambios');
  const url=px.url+path;
  const headers={...(options.headers||{}),'X-App-Key':px.key,Accept:'application/json'};
  if(options.body&&!headers['Content-Type'])headers['Content-Type']='application/json';
  const res=await fetch(url,{...options,headers,
    credentials:typeof _proxyCredentials==='function'?_proxyCredentials(url):'include',
    redirect:'manual'});
  let body={};try{body=await res.json();}catch(_){}
  if(!res.ok)throw Object.assign(new Error(body.error||('HTTP '+res.status)),{status:res.status,code:body.code,body});
  return body;
}
function saveAdsConfig(){
  const endpoint=(document.getElementById('ads-endpoint')?.value||'').trim();
  const customerId=(document.getElementById('ads-customer-id')?.value||'').trim();
  if(!endpoint){toast('Ingresa la URL del endpoint de lectura','error');return;}
  try{
    const u=new URL(endpoint);
    if(u.protocol!=='https:'||u.hostname!=='script.google.com'||!/\/macros\/s\/[^/]+\/exec$/.test(u.pathname)||u.username||u.password)
      throw Error('endpoint');
  }catch(_){toast('Usa la URL HTTPS /macros/s/.../exec del Apps Script','error');return;}
  localStorage.setItem('ads_config',JSON.stringify({endpoint,customerId}));
  document.getElementById('adsConfigPanel').style.display='none';
  toast('✓ Configuración de lectura Google Ads guardada','success');
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
  if(cfg.secret) code=code.replace('CONFIGURA_UN_SECRETO_LARGO_Y_UNICO',cfg.secret);
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
let _adsDemoQueueReady=false;
function _adsEnsureDemoQueue(){
  if(!window._DEMO_MODE||_adsDemoQueueReady)return;
  try{_adsPendingMutations=JSON.parse(sessionStorage.getItem('ads_demo_pending_mutations')||'[]');}catch(e){_adsPendingMutations=[];}
  _adsDemoQueueReady=true;
}

function savePendingToStorage(){
  if(window._DEMO_MODE)sessionStorage.setItem('ads_demo_pending_mutations',JSON.stringify(_adsPendingMutations));
  else localStorage.setItem('ads_pending_mutations', JSON.stringify(_adsPendingMutations));
}

function openCreateCampaign(){
  if(!_adsRequireLive())return;
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
  if(!_adsRequireLive())return;
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
  if(!_adsRequireLive())return;
  document.getElementById('adsDeleteModalId').value=id;
  document.getElementById('adsDeleteModalNombre').textContent='Campaña: '+nombre;
  document.getElementById('adsDeleteModal').style.display='flex';
}

function closeAdsDeleteModal(){
  document.getElementById('adsDeleteModal').style.display='none';
}

// ── FRENO DE PRESUPUESTO ──────────────────────────────────────────────
// El presupuesto DIARIO de una campaña se cambia con un clic y va derecho al
// Script 2, que lo aplica en la cuenta real. Había piso ($1.000) pero ningún
// techo, y el número lo puede proponer el agente de IA: un cero de más pasaba
// entero. Peor todavía, si el agente omitía el campo, Math.max(1000, NaN||0)
// lo dejaba en $1.000 — bajar una campaña de $8.000 a $1.000 sin que nadie se
// entere. Las líneas del taller van entre $2.000 y $8.000 al día.
const _ADS_TOPE_KEY='ads_tope_diario';
function adsTopeDiario(){const v=parseInt(localStorage.getItem(_ADS_TOPE_KEY),10);return v>0?v:20000;}
function setAdsTopeDiario(){
  const v=prompt('Tope de presupuesto DIARIO por campaña (CLP).\nEs una red de seguridad: nada por encima de este monto se envía a Google Ads sin que lo subas a propósito.',String(adsTopeDiario()));
  if(v===null) return;
  const n=parseInt(v,10);
  if(!(n>=1000)){toast('El tope debe ser al menos $1.000','error');return;}
  localStorage.setItem(_ADS_TOPE_KEY,String(n));
  toast('🛡 Tope diario por campaña: '+fmtMoney(n),'success');
}
// Único lugar donde se decide si un presupuesto puede salir hacia Google Ads.
// Lo usan las dos rutas —el botón del agente y el modal a mano— para que no
// puedan separarse. Devuelve el monto a aplicar, o null si no debe enviarse.
function adsPresupuestoValido(nuevo,actual,nombre){
  const crudo=(nuevo===''||nuevo===null||nuevo===undefined)?NaN:Number(nuevo);
  if(!Number.isFinite(crudo)){
    toast('No se entendió el presupuesto propuesto para '+(nombre||'la campaña')+' — escríbelo a mano.','error');
    return null;
  }
  const n=Math.round(crudo);
  if(n<1000){toast('El presupuesto diario debe ser al menos $1.000 CLP.','error');return null;}
  const tope=adsTopeDiario();
  if(n>tope){
    toast('🛡 '+fmtMoney(n)+' al día supera el tope de '+fmtMoney(tope)+' para '+(nombre||'esta campaña')+'. No se envía. Si de verdad lo quieres, sube el tope con el botón 🛡.','error');
    return null;
  }
  // Un salto grande dentro del tope puede ser correcto, pero no en piloto automático.
  const act=Math.round(Number(actual)||0);
  if(act>0&&(n>act*3||n<act/3)){
    if(!confirm('Cambio fuerte de presupuesto en "'+(nombre||'la campaña')+'":\n\n'+fmtMoney(act)+' → '+fmtMoney(n)+' al día\n\n¿Lo aplicas?')) return null;
  }
  return n;
}

// Encola una mutación reemplazando cualquier mutación pendiente equivalente (evita duplicados)
// A failed Ads request may display fixture data even on a real dashboard.
// This state is read-only: never mutate live campaigns based on fake IDs.
function _adsIsReadOnly(){
  return !!(window._DEMO_MODE||window._adsLastData?.demo===true);
}
function _adsRenderReadOnlyBanner(){
  const container=document.getElementById('adsCampaignsArea');
  if(!container||!container.parentNode)return;
  let banner=document.getElementById('adsReadonlyBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='adsReadonlyBanner';
    banner.setAttribute('role','alert');
    banner.style.cssText='margin:12px 0;padding:12px 16px;border-radius:10px;border:1px solid var(--warn);background:var(--surface2);color:var(--warn);font-size:12px;font-weight:600';
    container.parentNode.insertBefore(banner,container);
  }
  const blocked=_adsIsReadOnly();
  banner.textContent=blocked?'DATOS DEMO — SOLO LECTURA. Google Ads no está conectado: no se enviarán campañas, presupuestos, negativos ni órdenes del piloto.':'';
  banner.style.display=blocked?'block':'none';
  for(const id of ['btnNuevaCampana','adsRetryAllBtn']){
    const el=document.getElementById(id);
    if(el){el.disabled=blocked;el.title=blocked?'Modo demo de solo lectura':'';}
  }
}
function _adsRequireLive(){
  if(!_adsIsReadOnly())return true;
  _adsRenderReadOnlyBanner();
  toast('Modo demo: Google Ads está en solo lectura. Conecta datos reales antes de hacer cambios.','error');
  return false;
}
function _adsQueueMutation(mutation){
  if(!_adsRequireLive())return false;
  _adsEnsureDemoQueue();
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
  if(!_adsRequireLive())return;
  const op=document.getElementById('adsCampaignModalOp').value;
  const id=document.getElementById('adsCampaignModalId').value;
  const nombre=document.getElementById('adsCampaignModalNombre').value.trim();
  const presupuesto=parseInt(document.getElementById('adsCampaignModalPresupuesto').value)||0;
  const estado=document.getElementById('adsCampaignModalEstado').value;
  const tipo=document.getElementById('adsCampaignModalTipo').value;
  if(!nombre){alert('El nombre de la campaña es obligatorio.');return;}
  // Mismo freno que usa el botón del agente: si se separan, uno de los dos queda sin techo.
  const _actual=(window._adsLastData?.campanas||[]).find(c=>String(c.id)===String(id))?.presupuesto||0;
  const _ppto=adsPresupuestoValido(document.getElementById('adsCampaignModalPresupuesto').value,_actual,nombre);
  if(_ppto===null) return;
  const data={nombre,presupuesto:_ppto,estado,tipo};
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
  // Para CREATE, el Proxy confirma primero la cola de mutaciones y solo
  // después solicita el cascarón a Make con credenciales server-side.
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
    const raw=await callAgentClaude('ADS',ADS_BUILDER_SYS,'BRIEF: '+q+ctx+'\n\nDevuelve SOLO el JSON.');
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
  try{
    const d=await _adsProxyFetch('/ads/mutations',{method:'GET'});
    const todas=Array.isArray(d.mutations)?d.mutations:[];
    const pendientes=todas.filter(m=>m.status==='pending');
    const resueltas=todas.length-pendientes.length;
    if(!resueltas){toast('No hay mutaciones resueltas que limpiar','info');return;}
    if(!confirm(`Se eliminarán ${resueltas} mutaciones ya resueltas del historial del servidor. Se conservan ${pendientes.length} pendientes. ¿Continuar?`))return;
    await _adsProxyFetch('/ads/mutations',{method:'PUT',
      body:JSON.stringify({mutations:pendientes})});
    _adsPendingMutations=_adsPendingMutations.filter(m=>m.status==='pending'||m.status==='enviado');
    savePendingToStorage();renderPendingMutations();
    toast('✓ Historial limpio — '+resueltas+' eliminadas','success');
  }catch(e){toast('No se pudo limpiar el historial: '+e.message,'error');}
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
  if(!_adsRequireLive())return;
  const p=_adsAutopilotProps[i];if(!p)return;
  if(aprobar&&!confirm(`¿Aprobar ${p.mutaciones.length} cambio(s) del piloto? El servidor reservará la propuesta antes de encolar.`))return;
  const mutations=(p.mutaciones||[]).map((m,j)=>({
    ...m,timestamp:m.timestamp||new Date(Date.now()+j).toISOString(),status:'pending'
  }));
  try{
    const result=await _adsProxyFetch('/ads/autopilot/decision',{method:'POST',
      body:JSON.stringify({recordId:p.id,approve:!!aprobar,mutations})});
    if(aprobar){
      const keyOf=m=>m.op+'|'+(m.id||'')+'|'+(m.op==='create'?((m.data&&m.data.nombre)||''):
        (m.op==='negative'||m.op==='pause_keyword')?((m.data&&m.data.termino)||'')+'|'+((m.data&&m.data.campana)||''):'');
      for(const m of mutations){
        const key=keyOf(m);
        _adsPendingMutations=_adsPendingMutations.filter(x=>x.status==='aplicado'||keyOf(x)!==key);
        _adsPendingMutations.push({...m,status:'enviado',error:''});
      }
      savePendingToStorage();renderPendingMutations();_startAdsMutationPoll();
      toast(result.reused?'La propuesta ya estaba procesada':'✓ '+mutations.length+' cambio(s) reservados y encolados','success');
    }else toast('Propuesta del piloto rechazada','info');
  }catch(e){toast('Piloto no aplicado: '+e.message,'error');}
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
  _adsDownloadCSV('conversiones_offline_'+hoyCL()+'.csv',csv);
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

async function sendAdsMutation(mutation){
  if(_adsIsReadOnly()){
    mutation.status='demo';mutation.error='';savePendingToStorage();renderPendingMutations();
    toast('Cambio simulado: no se envió nada a Google Ads','success');return;
  }
  try{
    const d=await _adsProxyFetch('/ads/mutation',{method:'POST',
      body:JSON.stringify({mutation:{...mutation,status:'pending'}})});
    mutation.status='enviado';mutation.error='';
    if(mutation.op==='create'&&d.shell==='created')
      toast('✓ Cambio en cola y cascarón solicitado a Make','success');
  }catch(e){
    mutation.status='error';
    mutation.error=e.code==='ADS_MUTATION_PENDING_RECONCILIATION'
      ?'Resultado incierto: no reintentes a ciegas; verifica el historial'
      :e.code==='ADS_SHELL_PENDING_RECONCILIATION'
        ?'La mutación quedó en cola, pero Make tiene resultado incierto'
        :(e.message||'No se pudo enviar la mutación');
  }
  savePendingToStorage();
  renderPendingMutations();
}

// Sincroniza el estado de las mutaciones desde el servidor (Script 1) — refleja lo que el Script 2 aplicó
async function syncMutationStatuses(){
  if(window._DEMO_MODE||!_adsPendingMutations.length)return;
  try{
    const d=await _adsProxyFetch('/ads/mutations',{method:'GET'});
    if(!d.ok||!Array.isArray(d.mutations))return;
    let aplicadas=0,errores=0,changed=false;
    _adsPendingMutations.forEach(m=>{
      const srv=d.mutations.find(x=>x.timestamp===m.timestamp);
      if(srv&&srv.status&&srv.status!=='pending'&&m.status!==srv.status){
        m.status=srv.status;m.error=srv.error||'';changed=true;
        if(srv.status==='aplicado')aplicadas++;
        if(srv.status==='error')errores++;
      }
    });
    if(changed){
      _adsPendingMutations=_adsPendingMutations.filter(m=>m.status!=='aplicado');
      savePendingToStorage();renderPendingMutations();
      if(aplicadas)toast('✓ '+aplicadas+' cambio'+(aplicadas>1?'s':'')+' aplicado'+(aplicadas>1?'s':'')+' en Google Ads','success');
      if(errores)toast('⚠ '+errores+' mutación'+(errores>1?'es':'')+' con error — revisa el detalle','error');
    }
  }catch(e){
    if(e.status===401||e.status===403||e.code==='ACCESS_REQUIRED')
      console.warn('[Ads] historial de mutaciones requiere sesión admin de Access');
  }
}

function renderPendingMutations(){
  _adsEnsureDemoQueue();
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
    demo:{c:'var(--success)',t:'✓ Simulado — no enviado'},
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
  if(!_adsRequireLive())return;
  const m=_adsPendingMutations.find(x=>x.timestamp===ts);
  if(!m) return;
  m.status='pending';m.error='';
  savePendingToStorage();
  sendAdsMutation(m);
  renderPendingMutations();
}
function retryAllErrors(){
  if(!_adsRequireLive())return;
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
  _adsEnsureDemoQueue();
  ['adsAgentBox','adsCapacidadBox','adsSuggestBox'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  ['ads-kpi-gasto','ads-kpi-imp','ads-kpi-clics','ads-kpi-ctr','ads-kpi-cpc','ads-kpi-conv','ads-kpi-cpa','ads-kpi-roas'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='…';});
  if(window._DEMO_MODE||!cfg.endpoint){
    // Modo demo
    document.getElementById('adsCampaignsArea').innerHTML='<div class="loading-state" style="padding:20px 0"><div class="spinner"></div></div>';
    await new Promise(r=>setTimeout(r,600));
    const demo=getAdsDemoData(days);
    window._adsLastData=demo;
    _adsRenderReadOnlyBanner();
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
    _adsRenderReadOnlyBanner();
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
      _adsRenderReadOnlyBanner();
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


// ══════════════════════════════════════════════════════════════
// WEB · PRESENTACIÓN DIDÁCTICA
// Mantiene toda la funcionalidad existente, pero organiza la lectura de arriba
// hacia abajo: Tráfico → Publicidad → SEO. En Simple deja a la vista lo que
// sirve para decidir; en Experto siguen disponibles todos los controles.
// ══════════════════════════════════════════════════════════════
function webVisualAdsPanel(){
  const dot=document.getElementById('adsStatusDot');
  if(!dot)return null;
  const header=dot.closest('.section-header');
  return header?.parentElement||null;
}
function webVisualContainer(node){
  return node?.closest('details.op-disclosure')||node||null;
}
function webVisualChapter(node,step,title,question){
  if(!node||node.previousElementSibling?.classList?.contains('web-chapter-head'))return;
  const head=document.createElement('div');
  head.className='web-chapter-head';
  head.innerHTML=`<span class="web-chapter-num">${step}</span><div><strong>${title}</strong><small>${question}</small></div>`;
  node.before(head);
}
function webVisualGo(target){
  const ids={traffic:'webTrafficPanel',ads:'webAdsPanel',seo:'seoAuditPanel'};
  const el=document.getElementById(ids[target]||target);if(!el)return;
  const disclosure=el.closest('details.op-disclosure');
  if(disclosure)disclosure.open=true;
  el.scrollIntoView({behavior:'smooth',block:'start'});
}
function webVisualText(id,fallback='—'){
  const t=(document.getElementById(id)?.textContent||'').trim();
  return t&&t!=='—'?t:fallback;
}
function webVisualNumber(text){
  const n=parseFloat(String(text||'').replace(/[^0-9,.-]/g,'').replace(',','.'));
  return Number.isFinite(n)?n:null;
}
function webVisualSetText(el,value){
  if(el&&el.textContent!==String(value))el.textContent=String(value);
}
function webVisualSetAction(el,html,target){
  if(!el)return;
  if(el.innerHTML!==html)el.innerHTML=html;
  if(el.dataset.webGo!==target)el.dataset.webGo=target;
}
function webVisualSyncGuide(){
  const visitors=document.getElementById('webGuideTrafficValue');
  const trafficMeta=document.getElementById('webGuideTrafficMeta');
  const ads=document.getElementById('webGuideAdsValue');
  const adsMeta=document.getElementById('webGuideAdsMeta');
  const seo=document.getElementById('webGuideSeoValue');
  const seoMeta=document.getElementById('webGuideSeoMeta');
  const action=document.getElementById('webGuideAction');
  webVisualSetText(visitors,webVisualText('web-kpi-usuarios'));
  if(trafficMeta){
    const sessions=webVisualText('web-kpi-sesiones','sin datos');
    webVisualSetText(trafficMeta,sessions==='sin datos'?'Personas que llegan a tu sitio':'Sesiones: '+sessions);
  }
  webVisualSetText(ads,webVisualText('ads-kpi-roas'));
  if(adsMeta){
    const conv=webVisualText('ads-kpi-conv','sin datos');
    webVisualSetText(adsMeta,conv==='sin datos'?'Retorno por cada $1 invertido':'Conversiones: '+conv);
  }
  webVisualSetText(seo,webVisualText('seoAuditScore','Pendiente'));
  if(seoMeta){
    const score=webVisualNumber(webVisualText('seoAuditScore',''));
    webVisualSetText(seoMeta,score===null?'Analiza el sitio para obtener una nota':score>=90?'SEO saludable':score>=70?'Hay mejoras importantes':'Requiere atención');
  }
  if(action){
    const stale=document.getElementById('adsStaleWarning');
    const pending=document.getElementById('adsPendingPanel');
    const score=webVisualNumber(webVisualText('seoAuditScore',''));
    if(stale&&getComputedStyle(stale).display!=='none'){
      webVisualSetAction(action,'<b>1.</b> Actualiza Google Ads: los datos están desactualizados.','ads');
    }else if(pending&&getComputedStyle(pending).display!=='none'){
      webVisualSetAction(action,'<b>1.</b> Revisa los cambios de Google Ads que aún están pendientes.','ads');
    }else if(score!==null&&score<90){
      webVisualSetAction(action,'<b>1.</b> Revisa SEO: hay oportunidades para mejorar visibilidad.','seo');
    }else{
      webVisualSetAction(action,'<b>1.</b> Empieza por Tráfico: mira cuántas personas llegaron y desde dónde.','traffic');
    }
  }
}
function webVisualExplainMetric(id,help){
  const value=document.getElementById(id),card=value?.closest('.stat-card');
  if(!card||card.querySelector('.web-metric-help'))return;
  const note=document.createElement('div');note.className='web-metric-help';note.textContent=help;
  card.appendChild(note);
}
function webVisualMount(){
  const tab=document.getElementById('tab-web');if(!tab||tab.dataset.webVisualReady==='1')return;
  tab.dataset.webVisualReady='1';

  const header=tab.querySelector(':scope > .section-header');
  if(header){
    const guide=document.createElement('section');
    guide.id='webOverviewGuide';guide.className='web-guide';
    guide.innerHTML=`
      <div class="web-guide-intro">
        <div><span class="web-guide-eyebrow">WEB EN 3 PREGUNTAS</span>
          <h2>¿La web está atrayendo, convirtiendo y creciendo?</h2>
          <p>Lee esta sección en orden. Primero mira el tráfico, después si la publicidad convierte y finalmente la salud SEO. Los detalles técnicos quedan abajo.</p>
        </div>
        <button type="button" id="webGuideAction" class="web-guide-action" data-web-go="traffic"></button>
      </div>
      <div class="web-guide-grid">
        <button type="button" class="web-guide-card" data-web-go="traffic"><span>01 · TRÁFICO</span><strong id="webGuideTrafficValue">—</strong><small id="webGuideTrafficMeta">Personas que llegan a tu sitio</small><em>¿Nos están encontrando?</em></button>
        <button type="button" class="web-guide-card" data-web-go="ads"><span>02 · GOOGLE ADS</span><strong id="webGuideAdsValue">—</strong><small id="webGuideAdsMeta">Retorno por cada $1 invertido</small><em>¿La inversión está generando negocio?</em></button>
        <button type="button" class="web-guide-card" data-web-go="seo"><span>03 · SEO</span><strong id="webGuideSeoValue">Pendiente</strong><small id="webGuideSeoMeta">Analiza el sitio para obtener una nota</small><em>¿Google entiende bien nuestras páginas?</em></button>
      </div>
      <details class="web-concepts">
        <summary>¿Qué significan los indicadores?</summary>
        <div><span><b>Visitantes</b> personas únicas que entraron al sitio.</span><span><b>CTR</b> porcentaje de personas que hicieron clic después de ver un anuncio.</span><span><b>Costo/Conv.</b> cuánto gastamos para conseguir una conversión.</span><span><b>ROAS</b> cuánto ingreso atribuimos por cada $1 invertido en Ads.</span><span><b>SEO</b> qué tan preparada está cada página para ser entendida e indexada por buscadores.</span></div>
      </details>`;
    header.after(guide);
  }

  const traffic=document.getElementById('webTrafficPanel');
  const ads=webVisualAdsPanel();
  const seo=document.getElementById('seoAuditPanel');
  if(ads){ads.id='webAdsPanel';ads.classList.add('web-chapter-panel');}
  traffic?.classList.add('web-chapter-panel');
  seo?.classList.add('web-chapter-panel');

  // Orden de lectura más natural: adquisición → conversión pagada → optimización orgánica.
  if(ads&&seo){
    const seoContainer=webVisualContainer(seo);
    if(seoContainer&&seoContainer.previousElementSibling!==ads)ads.after(seoContainer);
  }

  webVisualChapter(webVisualContainer(traffic),'01','Tráfico del sitio','¿Cuánta gente llega, cómo llega y qué páginas mira?');
  webVisualChapter(ads,'02','Publicidad y conversiones','¿La inversión en Google Ads está devolviendo resultados?');
  webVisualChapter(webVisualContainer(seo),'03','SEO y visibilidad orgánica','¿Qué debemos mejorar para aparecer mejor en Google?');

  // En Simple dejamos solo los controles que ayudan a decidir o actuar hoy.
  ['toggleAdsConfig()','openAdsOfflineModal()','setAdsTopeDiario()'].forEach(code=>{
    tab.querySelectorAll(`button[onclick*="${code}"]`).forEach(b=>b.classList.add('op-expert-only'));
  });
  const adsQuick=[...tab.querySelectorAll('a[href*="ads.google.com"],a[href*="lookerstudio.google.com"]')];
  if(adsQuick.length){
    const parent=adsQuick[0].parentElement;
    if(parent&&adsQuick.every(a=>a.parentElement===parent))parent.classList.add('web-tool-links','op-expert-only');
  }
  const external=[...tab.querySelectorAll('a[href*="search.google.com/search-console"],a[href*="analytics.google.com"]')];
  if(external.length){
    const parent=external[0].parentElement;
    if(parent&&external.every(a=>a.parentElement===parent))parent.classList.add('web-tool-links','op-expert-only');
  }

  webVisualExplainMetric('web-kpi-usuarios','Personas únicas que visitaron el sitio.');
  webVisualExplainMetric('web-kpi-sesiones','Visitas totales; una persona puede generar varias.');
  webVisualExplainMetric('web-kpi-duracion','Tiempo promedio que dura cada visita.');
  webVisualExplainMetric('ads-kpi-gasto','Dinero invertido en el período seleccionado.');
  webVisualExplainMetric('ads-kpi-conv','Acciones que Google Ads registró como conversión.');
  webVisualExplainMetric('ads-kpi-cpa','Costo promedio para conseguir una conversión.');
  webVisualExplainMetric('ads-kpi-roas','Retorno atribuido por cada $1 invertido.');

  tab.addEventListener('click',e=>{
    const b=e.target.closest('[data-web-go]');if(b)webVisualGo(b.dataset.webGo);
  });

  const observer=new MutationObserver(()=>webVisualSyncGuide());
  observer.observe(tab,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});
  tab.__webVisualObserver=observer;
  webVisualSyncGuide();
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>setTimeout(webVisualMount,0),{once:true});
}else setTimeout(webVisualMount,0);
