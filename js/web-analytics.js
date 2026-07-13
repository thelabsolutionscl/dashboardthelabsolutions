/* js/web-analytics.js — módulo extraído de index.html (carga en el mismo punto). */
// ── Tráfico del sitio web (GA4 vía Script 1, action=web) ──────────────
const WEB_CANAL_ES={'Organic Search':'Búsqueda orgánica','Paid Search':'Google Ads (búsqueda)','Direct':'Directo','Organic Social':'Redes sociales','Paid Social':'Redes sociales (pago)','Referral':'Referidos','Email':'Email','Display':'Display','Cross-network':'Multired','Organic Video':'Video orgánico','Paid Video':'Video (pago)','Unassigned':'Sin asignar'};
async function loadWebStats(){
  const panel=document.getElementById('webTrafficPanel');if(!panel)return;
  const cfg=getAdsConfig();
  const days=parseInt(document.getElementById('adsPeriodSelect')?.value||'30');
  if(!cfg.endpoint){renderWebStats(getWebDemoData(days),days);return;}
  try{
    const url=cfg.endpoint+(cfg.endpoint.includes('?')?'&':'?')+'action=web&days='+days+'&_t='+Date.now();
    const r=await fetch(url);
    const data=await r.json().catch(()=>null);
    if(data&&data.ok&&data.web){renderWebStats(data,days);return;}
    if(!data||!data.web){showWebTrafficHint('script');return;}
    if(data.error==='no-config'){showWebTrafficHint('property');return;}
    if(data.error==='no-service'){showWebTrafficHint('service');return;}
    showWebTrafficHint('error',data.error);
  }catch(e){showWebTrafficHint('error',e.message);}
}
function showWebTrafficHint(tipo,detalle){
  const hint=document.getElementById('webTrafficHint'),body=document.getElementById('webTrafficBody');
  if(!hint)return;
  body.style.display='none';hint.style.display='block';
  document.getElementById('webKpiAhoraBadge').style.display='none';
  const pasos={
    script:'<b style="color:var(--warn)">El Script 1 necesita actualizarse</b> para mostrar el tráfico web:<br>1. Botón <b>⚙ Configurar</b> (arriba) → <b>Ver Apps Script</b> → copia el bloque del <b>Script 1</b>.<br>2. En <b>script.google.com</b> abre tu proyecto y reemplaza TODO el código por el nuevo.<br>3. <b>Desplegar → Administrar implementaciones → ✏ → Versión: Nueva versión → Desplegar</b>.<br>4. Sigue los pasos de GA4 que vienen en los comentarios del script.',
    service:'<b style="color:var(--warn)">Falta el servicio de Analytics en el Script 1</b>:<br>En el editor de Apps Script → menú izquierdo <b>Servicios (+)</b> → busca <b>Google Analytics Data API</b> → Añadir → autoriza cuando lo pida → <b>Desplegar → nueva versión</b>.',
    property:'<b style="color:var(--warn)">Falta el ID de la propiedad GA4</b>:<br>1. En <b>analytics.google.com</b> → ⚙ Administrar → <b>Detalles de la propiedad</b> → copia el <b>ID de la propiedad</b> (número, ej. 123456789).<br>2. En el Script 1 pégalo en la línea <code>var GA4_PROPERTY = \'\';</code><br>3. <b>Desplegar → Administrar implementaciones → ✏ → Nueva versión</b>.',
    error:'<b style="color:var(--danger)">No se pudo leer GA4:</b> '+escapeHtml(detalle||'error desconocido')+'<br>Verifica que la cuenta del Script 1 tenga acceso a la propiedad GA4 y que el ID en <code>GA4_PROPERTY</code> sea el numérico.'
  };
  hint.innerHTML='📈 '+ (pasos[tipo]||pasos.error);
}
function renderWebStats(data,days){
  const hint=document.getElementById('webTrafficHint'),body=document.getElementById('webTrafficBody');
  if(!body)return;
  hint.style.display='none';body.style.display='block';
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('web-kpi-usuarios',fmtNum(data.usuarios||0));
  set('web-kpi-periodo',(data.demo?'demo · ':'')+days+' días');
  set('web-kpi-nuevos',fmtNum(data.nuevos||0));
  set('web-kpi-sesiones',fmtNum(data.sesiones||0));
  set('web-kpi-vistas',fmtNum(data.vistas||0));
  const dur=Math.round(data.duracion||0);
  set('web-kpi-duracion',dur>0?Math.floor(dur/60)+'m '+String(dur%60).padStart(2,'0')+'s':'—');
  const badge=document.getElementById('webKpiAhoraBadge');
  if(badge){const ok=typeof data.ahora==='number'&&data.ahora>=0;badge.style.display=ok?'inline-block':'none';if(ok)set('web-kpi-ahora',data.ahora);}
  // Barras por día
  const chart=document.getElementById('webTrafficChart');
  const dias=data.dias||[];
  if(chart){
    const max=Math.max(1,...dias.map(d=>d.usuarios||0));
    const fmtF=f=>f&&f.length>=8?f.slice(6,8)+'/'+f.slice(4,6):f;
    chart.innerHTML=dias.map(d=>{
      const h=Math.max(4,Math.round((d.usuarios||0)/max*100));
      return '<div title="'+fmtF(d.fecha)+': '+(d.usuarios||0)+' visitantes · '+(d.sesiones||0)+' sesiones" style="flex:1;height:'+h+'%;background:'+((d.usuarios||0)===max&&max>1?'var(--accent)':'rgba(0,212,204,0.35)')+';border-radius:2px 2px 0 0;min-width:2px"></div>';
    }).join('');
    set('webChartDesde',dias.length?fmtF(dias[0].fecha):'');
    set('webChartHasta',dias.length?fmtF(dias[dias.length-1].fecha):'');
  }
  // Canales y páginas
  const fila=(nombre,valor,pct)=>'<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px"><span style="flex:1;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+escapeHtml(nombre)+'">'+escapeHtml(nombre)+'</span><div style="width:70px;height:5px;border-radius:3px;background:var(--surface3);overflow:hidden;flex-shrink:0"><div style="width:'+pct+'%;height:100%;background:var(--accent)"></div></div><span style="width:44px;text-align:right;color:var(--text1);font-weight:600;flex-shrink:0">'+fmtNum(valor)+'</span></div>';
  const canales=data.canales||[];
  const maxC=Math.max(1,...canales.map(c=>c.usuarios||0));
  const elC=document.getElementById('webTrafficCanales');
  if(elC)elC.innerHTML=canales.length?canales.map(c=>fila(WEB_CANAL_ES[c.canal]||c.canal,c.usuarios||0,Math.round((c.usuarios||0)/maxC*100))).join(''):'<div style="font-size:11px;color:var(--text3)">Sin datos aún</div>';
  const paginas=data.paginas||[];
  const maxP=Math.max(1,...paginas.map(p=>p.vistas||0));
  const elP=document.getElementById('webTrafficPaginas');
  if(elP)elP.innerHTML=paginas.length?paginas.map(p=>fila(p.ruta||'/',p.vistas||0,Math.round((p.vistas||0)/maxP*100))).join(''):'<div style="font-size:11px;color:var(--text3)">Sin datos aún</div>';
  const demoEl=document.getElementById('webTrafficDemo');
  if(demoEl)demoEl.style.display=data.demo?'block':'none';
}
function getWebDemoData(days){
  const dias=[];const hoy=new Date();let u=0,s=0,v=0;
  for(let i=days-1;i>=0;i--){
    const d=new Date(hoy);d.setDate(d.getDate()-i);
    const finde=d.getDay()===0||d.getDay()===6;
    const du=Math.max(3,18+((i*7)%13)+(finde?-9:4));const ds=Math.round(du*1.25);
    const f=d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
    dias.push({fecha:f,usuarios:du,sesiones:ds});u+=du;s+=ds;v+=du*3;
  }
  return {ok:true,web:true,demo:true,ahora:2,usuarios:u,nuevos:Math.round(u*0.78),sesiones:s,vistas:v,duracion:96,dias,
    canales:[{canal:'Organic Search',usuarios:Math.round(u*0.36)},{canal:'Direct',usuarios:Math.round(u*0.27)},{canal:'Paid Search',usuarios:Math.round(u*0.19)},{canal:'Organic Social',usuarios:Math.round(u*0.11)},{canal:'Referral',usuarios:Math.round(u*0.07)}],
    paginas:[{ruta:'/',vistas:Math.round(v*0.34)},{ruta:'/servicios/impresion-3d',vistas:Math.round(v*0.14)},{ruta:'/servicios/volumetricos',vistas:Math.round(v*0.11)},{ruta:'/servicios/premiaciones',vistas:Math.round(v*0.09)},{ruta:'/contacto',vistas:Math.round(v*0.08)}]};
}
function renderAdsKPIs(data,days){
  const gasto=data.gasto||0,imp=data.impresiones||0,clics=data.clics||0;
  const conv=data.conversiones||0,valConv=data.valor_conversion||0;
  const ctr=imp>0?(clics/imp*100):0;
  const cpc=clics>0?(gasto/clics):0;
  const cpa=conv>0?(gasto/conv):0;
  const roas=gasto>0?(valConv/gasto):0;
  document.getElementById('ads-kpi-gasto').textContent=fmtMoney(gasto);
  document.getElementById('ads-kpi-periodo').textContent=data.periodo||days+' días';
  document.getElementById('ads-kpi-imp').textContent=fmtNum(imp);
  document.getElementById('ads-kpi-clics').textContent=fmtNum(clics);
  document.getElementById('ads-kpi-ctr').textContent=fmtPct(ctr);
  document.getElementById('ads-kpi-cpc').textContent=fmtMoney(cpc);
  document.getElementById('ads-kpi-conv').textContent=conv>0?conv.toFixed(0):'0';
  document.getElementById('ads-kpi-cpa').textContent=conv>0?fmtMoney(cpa):'—';
  document.getElementById('ads-kpi-roas').textContent=valConv>0?roas.toFixed(2)+'x':'—';
  ovSyncAdsKPIs(data);
  renderAdsCRMPanel(data,days);
  // — Snapshot, tendencias vs período anterior, sync label, stale warning
  if(!data.demo) adsSaveSnapshot(data,days);
  const prev=adsGetPrevSnapshot();
  if(prev){
    const trendHtml=(curr,old,higherGood)=>{
      if(!old||old===0) return '';
      const pct=(curr-old)/Math.abs(old)*100;
      const up=pct>0;
      const good=higherGood?up:!up;
      return '<span style="color:'+(good?'var(--success)':'var(--danger)')+';font-size:9px">'+(up?'↑':'↓')+Math.abs(pct).toFixed(0)+'%</span>';
    };
    const setTrend=(id,curr,old,hg)=>{const el=document.getElementById(id);if(el)el.innerHTML=trendHtml(curr,old,hg);};
    setTrend('ads-kpi-imp-trend',imp,prev.imp,true);
    setTrend('ads-kpi-clics-trend',clics,prev.clics,true);
    setTrend('ads-kpi-ctr-trend',ctr,prev.ctr,true);
    setTrend('ads-kpi-conv-trend',conv,prev.conv,true);
    setTrend('ads-kpi-roas-trend',roas,prev.roas,true);
  }
  // Stale warning (data.guardado = cuando el Script 2 corrió por última vez)
  const staleEl=document.getElementById('adsStaleWarning');
  if(staleEl){
    if(data.guardado&&!data.demo){
      const age=Date.now()-new Date(data.guardado).getTime();
      staleEl.style.display=age>86400000?'flex':'none';
    } else staleEl.style.display='none';
  }
  // Última sincronización
  const lbl=document.getElementById('adsLastSyncLabel');
  if(lbl) lbl.textContent=adsLastSyncStr();
}
function renderAdsCRMPanel(data,days){
  const el=document.getElementById('adsCRMPanel');if(!el)return;
  el.style.display='';
  const gasto=data.gasto||0;
  const cutoff=new Date(Date.now()-days*86400000);
  const ingresoCRM=(state.pedidos||[]).filter(p=>{
    const f=p.fields;
    if((f['Estado pedido']||'')==='Cancelado') return false;
    const d=p.createdTime?new Date(p.createdTime):null;
    return d&&d>=cutoff;
  }).reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const pedCount=(state.pedidos||[]).filter(p=>{const d=p.createdTime?new Date(p.createdTime):null;return d&&d>=cutoff&&(p.fields['Estado pedido']||'')!=='Cancelado';}).length;
  const leads=(state.clientes||[]).filter(c=>{const d=c.createdTime?new Date(c.createdTime):null;return d&&d>=cutoff;}).length;
  const roasReal=gasto>0?ingresoCRM/gasto:0;
  const cpl=leads>0&&gasto>0?Math.round(gasto/leads):0;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('crm-ads-gasto',fmtMoney(gasto));
  set('crm-ads-ingresos',fmtMoney(ingresoCRM));
  set('crm-ads-ingresos-sub',`${pedCount} pedido${pedCount!==1?'s':''}`);
  set('crm-ads-roas',roasReal>0?roasReal.toFixed(2)+'x':'—');
  set('crm-ads-cpl',cpl>0?fmtMoney(cpl):'—');
  set('crm-ads-cpl-sub',leads>0?`${leads} lead${leads!==1?'s':''} nuevos`:'sin leads');
  set('adsCRMPeriodo',`últimos ${days} días`);
  const bar=document.getElementById('crm-ads-bar');
  if(bar){
    const total=Math.max(gasto,ingresoCRM)||1;
    const gp=Math.round(gasto/total*100),ip=Math.round(ingresoCRM/total*100);
    bar.innerHTML=`<div style="height:100%;width:${gp}%;background:var(--danger);display:inline-block"></div><div style="height:100%;width:${ip}%;background:var(--success);display:inline-block"></div>`;
  }
  set('crm-ads-bar-label',roasReal>=1?`✓ ROAS ${roasReal.toFixed(1)}x — rentable`:`⚠ ROAS ${roasReal>0?roasReal.toFixed(2)+'x':'sin datos'}`);
}
let _adsKwActions=[];
let _adsKwSort='gasto',_adsKwFilter='all';
function _adsKwAction(idx){
  const d=_adsKwActions[idx];if(!d)return;
  if(d.type==='copy') adsGenerateAdCopy(d.termino,d.campana);
  else if(d.type==='pause'){
    if(window._adsLastData&&window._adsLastData.demo){toast('Datos DEMO — conecta tu cuenta para pausar','info');return;}
    if(typeof _adsQueueMutation==='function'){_adsQueueMutation({op:'pause_keyword',id:'',data:{campana:d.campana||'',termino:d.termino},timestamp:new Date().toISOString(),status:'pending'});toast(`⏸ Pausar "${d.termino}" en cola`,'success');}
    else toast('Cola de mutaciones no disponible','error');
  }
}
function _adsKwSetSort(v){_adsKwSort=v;if(window._adsLastData)renderAdsKeywords(window._adsLastData);}
function _adsKwSetFilter(v){_adsKwFilter=v;if(window._adsLastData)renderAdsKeywords(window._adsLastData);}
function renderAdsKeywords(data){
  const panel=document.getElementById('adsKeywordsPanel');
  const area=document.getElementById('adsKeywordsArea');
  const badge=document.getElementById('adsKwBadge');
  if(!panel||!area)return;
  const kws=(data&&data.keywords)||[];
  if(!kws.length){panel.style.display='none';return;}
  panel.style.display='';
  _adsKwActions=[];
  const nLow=kws.filter(k=>(k.qs||0)>0&&(k.qs||0)<=5).length;
  const nWaste=kws.filter(k=>(k.gasto||0)>4000&&(k.conversiones||0)===0).length;
  const nAd=kws.filter(k=>k.qs_anuncio==='BELOW_AVERAGE').length;
  if(badge)badge.textContent=`${kws.length} kw · ${nLow} con QS bajo · ${nWaste} sin convertir`;
  // Filtro
  const filtFns={all:()=>true,qsbajo:k=>(k.qs||0)>0&&(k.qs||0)<=5,waste:k=>(k.gasto||0)>4000&&(k.conversiones||0)===0,anuncio:k=>k.qs_anuncio==='BELOW_AVERAGE'};
  const filt=filtFns[_adsKwFilter]||filtFns.all;
  // Orden
  const sortFns={gasto:(a,b)=>(b.gasto||0)-(a.gasto||0),qs:(a,b)=>(a.qs||99)-(b.qs||99),conv:(a,b)=>(b.conversiones||0)-(a.conversiones||0),cpa:(a,b)=>{const ca=(a.conversiones||0)>0?a.gasto/a.conversiones:Infinity,cb=(b.conversiones||0)>0?b.gasto/b.conversiones:Infinity;return cb===ca?0:ca-cb;}};
  const srt=sortFns[_adsKwSort]||sortFns.gasto;
  const filtered=kws.filter(filt).sort(srt);
  const top=filtered.slice(0,20);
  // Controles de orden y filtro
  const filtChip=(val,lbl,n)=>`<button onclick="_adsKwSetFilter('${val}')" style="background:${_adsKwFilter===val?'var(--accent)':'var(--surface3)'};color:${_adsKwFilter===val?'var(--black)':'var(--text2)'};border:1px solid ${_adsKwFilter===val?'var(--accent)':'var(--border2)'};border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;font-weight:600">${lbl}${n!=null?` (${n})`:''}</button>`;
  const sortOpt=(v,l)=>`<option value="${v}"${_adsKwSort===v?' selected':''}>${l}</option>`;
  const controls=`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
    <div style="display:flex;gap:5px;flex-wrap:wrap">${filtChip('all','Todas',kws.length)}${filtChip('qsbajo','QS bajo',nLow)}${filtChip('waste','Sin convertir',nWaste)}${filtChip('anuncio','Anuncio débil',nAd)}</div>
    <div style="margin-left:auto;display:flex;align-items:center;gap:5px"><span style="font-size:10px;color:var(--text3)">Ordenar</span>
      <select onchange="_adsKwSetSort(this.value)" class="field-input" style="width:auto;padding:3px 8px;font-size:10px">${sortOpt('gasto','Mayor gasto')}${sortOpt('qs','Menor QS')}${sortOpt('conv','Más conversiones')}${sortOpt('cpa','Menor CPA')}</select>
    </div>
  </div>`;
  const _qsComp=(label,v)=>{const c=v==='ABOVE_AVERAGE'?'var(--success)':v==='BELOW_AVERAGE'?'var(--danger)':v==='AVERAGE'?'var(--warn)':'var(--text3)';return `<span title="${label}: ${v||'s/d'}" style="display:inline-flex;align-items:center;gap:2px;font-size:8px;color:var(--text3);margin-right:5px"><span style="width:6px;height:6px;border-radius:50%;background:${c};display:inline-block"></span>${label}</span>`;};
  const rows=top.map(k=>{
    const qs=k.qs||0;
    const qsColor=qs>=7?'var(--success)':qs>=4?'var(--warn)':qs>0?'var(--danger)':'var(--text3)';
    const cpa=(k.conversiones||0)>0?Math.round(k.gasto/k.conversiones):0;
    const waste=(k.gasto||0)>4000&&(k.conversiones||0)===0;
    const anuncioBajo=k.qs_anuncio==='BELOW_AVERAGE';
    const ci=_adsKwActions.push({type:'copy',termino:k.kw||'',campana:k.campana||''})-1;
    const pi=_adsKwActions.push({type:'pause',termino:k.kw||'',campana:k.campana||''})-1;
    const acc=`<span style="display:inline-flex;gap:4px">
        <button class="btn-icon accent" onclick="_adsKwAction(${ci})" title="Generar anuncios para esta keyword">✍</button>
        <button class="btn-icon danger" onclick="_adsKwAction(${pi})" title="Pausar esta palabra clave">⏸</button>
      </span>`;
    return `<tr${waste?' style="background:rgba(255,68,68,0.05)"':''}>
      <td style="white-space:nowrap"><span style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle" title="${escapeHtml(k.kw||'')}${k.campana?' · '+escapeHtml(k.campana):''}">${escapeHtml(k.kw||'')}</span> <span style="font-size:8px;color:var(--text3)">${escapeHtml((k.match||'').slice(0,1)||'')}</span>${anuncioBajo?' <span title="Anuncio con relevancia baja — genera mejor copy" style="font-size:9px">✍</span>':''}${waste?' <span title="Gasta sin convertir" style="color:var(--danger);font-size:9px">⚑</span>':''}</td>
      <td style="text-align:center"><span style="display:inline-block;min-width:24px;text-align:center;color:${qsColor};border:1px solid ${qsColor};border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700">${qs>0?qs:'—'}</span></td>
      <td style="white-space:nowrap">${_qsComp('Anuncio',k.qs_anuncio)}${_qsComp('Landing',k.qs_landing)}${_qsComp('CTR',k.qs_ctr)}</td>
      <td style="text-align:right">${fmtMoney(k.gasto||0)}</td>
      <td style="text-align:right;color:var(--success)">${(k.conversiones||0)>0?Number(k.conversiones).toFixed(0):'—'}</td>
      <td style="text-align:right">${(k.conversiones||0)>0?fmtMoney(cpa):'—'}</td>
      <td style="text-align:right">${acc}</td>
    </tr>`;
  }).join('');
  const emptyMsg=top.length?'':`<div class="empty-state" style="padding:24px 0"><div style="color:var(--text3);font-size:12px">Ninguna palabra clave coincide con el filtro</div></div>`;
  area.innerHTML=controls+(top.length?`<div class="table-wrap"><table>
    <thead><tr><th>Palabra clave</th><th style="text-align:center" title="Quality Score 1–10">QS</th><th title="Componentes del Quality Score">Componentes</th><th style="text-align:right">Gasto</th><th style="text-align:right">Conv.</th><th style="text-align:right">CPA</th><th style="text-align:right">Acción</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`:emptyMsg)+`
  <div style="font-size:10px;color:var(--text3);margin-top:8px;padding:0 4px;line-height:1.5">Mostrando ${top.length} de ${filtered.length}${filtered.length>20?' (top 20)':''}. <span style="color:var(--danger)">⚑</span> gasta sin convertir · <span>✍</span> relevancia de anuncio baja (el copy es la palanca). Quality Score alto = CPC más barato.</div>`;
}
function renderAdsCampaigns(data){
  try{renderAdsKeywords(data);}catch(e){console.error('renderAdsKeywords',e);}
  const camps=data.campanas||[];
  if(!camps.length){
    document.getElementById('adsCampaignsArea').innerHTML='<div class="empty-state" style="padding:30px 0"><div>No hay campañas en el período seleccionado</div></div>';
    return;
  }
  _adsCampActions=[];
  // ROAS-real estimado por campaña: el CRM no atribuye qué pedido vino de qué campaña,
  // así que repartimos el ingreso CRM del período por participación en conversiones (proxy honesto).
  const _adsDays=parseInt(document.getElementById('adsPeriodSelect')?.value||'30');
  const _cutoff=new Date(Date.now()-_adsDays*86400000);
  const _ingresoCRM=(state.pedidos||[]).filter(p=>{const f=p.fields;if((f['Estado pedido']||'')==='Cancelado')return false;const d=p.createdTime?new Date(p.createdTime):null;return d&&d>=_cutoff;}).reduce((s,p)=>s+Math.round((p.fields['Monto total (CLP)']||0)/1.19),0);
  const _totalConv=camps.reduce((s,c)=>s+(c.conversiones||0),0);
  const rows=camps.map(c=>{
    const ctr=c.impresiones>0?(c.clics/c.impresiones*100):0;
    const cpc=c.clics>0?(c.gasto/c.clics):0;
    const cpa=c.conversiones>0?(c.gasto/c.conversiones):0;
    const estIng=_totalConv>0?_ingresoCRM*((c.conversiones||0)/_totalConv):0;
    const rrEst=(c.gasto||0)>0&&estIng>0?estIng/c.gasto:0;
    const rrColor=rrEst>=2?'var(--success)':rrEst>=1?'var(--warn)':rrEst>0?'var(--danger)':'var(--text3)';
    const convShare=_totalConv>0?Math.round((c.conversiones||0)/_totalConv*100):0;
    const activa=c.estado==='ENABLED';
    const estadoBadge=activa
      ?'<span style="background:rgba(0,212,170,0.15);color:var(--accent3);border:1px solid rgba(0,212,170,0.3);border-radius:4px;padding:1px 7px;font-size:9px;font-weight:600">Activa</span>'
      :'<span style="background:rgba(255,68,68,0.12);color:var(--danger);border:1px solid rgba(255,68,68,0.25);border-radius:4px;padding:1px 7px;font-size:9px;font-weight:600">Pausada</span>';
    const ctrColor=ctr>=5?'var(--success)':ctr>=2?'var(--text)':'var(--danger)';
    const hs=adsHealthScore(c);
    const hsBadge=`<span style="display:inline-block;min-width:28px;text-align:center;color:${hs.color};border:1px solid ${hs.color};border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;opacity:0.9" title="Score de salud: ${hs.label} (CTR + Conv. + ROAS)">${hs.score}</span>`;
    // Índices a _adsCampActions para evitar problemas de escape de comillas en onclick
    const ei=_adsCampActions.push({type:'edit',id:c.id,nombre:c.nombre||'',estado:c.estado,presupuesto:c.presupuesto||0})-1;
    const di=_adsCampActions.push({type:'delete',id:c.id,nombre:c.nombre||''})-1;
    const ci=_adsCampActions.push({type:'copy',nombre:c.nombre||'',estado:c.estado||'',gasto:c.gasto||0,clics:c.clics||0,conv:c.conversiones||0,ctr:ctr.toFixed(2),cpc:c.clics>0?Math.round(c.gasto/c.clics):0})-1;
    const ai=_adsCampActions.push({type:'analyze',id:c.id})-1;
    const acciones=`<span style="display:inline-flex;gap:4px;margin-left:6px;vertical-align:middle">
        <button class="btn-icon purple" onclick="event.stopPropagation();_adsCampAction(${ai})" title="Analizar esta campaña con IA">⚡</button>
        <button class="btn-icon" onclick="event.stopPropagation();_adsCampAction(${ei})" title="Editar">✏</button>
        <button class="btn-icon danger" onclick="event.stopPropagation();_adsCampAction(${di})" title="Eliminar"><svg class="dashboard-icon" width="12" height="12" stroke-width="1.5"><use href="#icon-trash"/></svg></button>
        <button class="btn-icon accent" onclick="event.stopPropagation();_adsCampAction(${ci})" title="Generar copy IA">✍</button>
      </span>`;
    return `<tr>
      <td style="white-space:nowrap"><span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle" title="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</span>${acciones}</td>
      <td>${estadoBadge}</td>
      <td style="text-align:center">${hsBadge}</td>
      <td style="text-align:right">${fmtMoney(c.gasto)}</td>
      <td style="text-align:right">${fmtNum(c.impresiones)}</td>
      <td style="text-align:right">${fmtNum(c.clics)}</td>
      <td style="text-align:right;color:${ctrColor}">${fmtPct(ctr)}</td>
      <td style="text-align:right">${fmtMoney(cpc)}</td>
      <td style="text-align:right;color:var(--success)">${c.conversiones>0?Number(c.conversiones).toFixed(0):'—'}</td>
      <td style="text-align:right">${c.conversiones>0?fmtMoney(cpa):'—'}</td>
      <td style="text-align:right;color:${rrColor}" title="ROAS-real estimado: ingreso CRM del período repartido por participación en conversiones (esta campaña = ${convShare}% de las conversiones). No es atribución exacta.">${rrEst>0?rrEst.toFixed(2)+'x':'—'}</td>
    </tr>`;
  }).join('');
  const demoBanner=data.demo?`<div style="background:rgba(255,200,0,0.08);border-bottom:1px solid rgba(255,200,0,0.2);padding:7px 16px;font-size:10px;color:#ffc107;display:flex;align-items:center;gap:6px"><span>⚠</span><span>Datos de demostración — <button onclick="toggleAdsConfig()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:10px;padding:0;text-decoration:underline">configura tu endpoint</button> para ver datos reales</span></div>`:'';
  document.getElementById('adsCampaignsArea').innerHTML=`
    <div class="card">
      <div class="card-header"><span class="card-title">Campañas</span><div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;color:var(--text3)">${camps.length} campaña${camps.length!==1?'s':''}</span><button onclick="adsExportCSV()" style="background:rgba(0,212,204,0.06);border:1px solid rgba(0,212,204,0.2);color:var(--text2);border-radius:5px;padding:3px 10px;font-size:10px;cursor:pointer" title="Descargar tabla como CSV">⬇ CSV</button><button onclick="openCreateCampaign()" style="background:rgba(0,212,204,0.1);border:1px solid rgba(0,212,204,0.3);color:var(--accent);border-radius:5px;padding:3px 10px;font-size:10px;cursor:pointer;font-weight:600">+ Nueva</button></div></div>
      ${demoBanner}
      <div class="table-wrap"><table>
        <thead><tr><th>Campaña</th><th>Estado</th><th style="text-align:center" title="Score de salud 0–100 (CTR + Conv. + ROAS)">Score</th><th style="text-align:right">Gasto</th><th style="text-align:right">Impres.</th><th style="text-align:right">Clics</th><th style="text-align:right">CTR</th><th style="text-align:right">CPC</th><th style="text-align:right">Conv.</th><th style="text-align:right">CPA</th><th style="text-align:right" title="ROAS-real estimado por participación en conversiones (no atribución exacta)">ROAS-real*</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div style="font-size:10px;color:var(--text3);padding:8px 16px 12px;line-height:1.5">* ROAS-real estimado: el ingreso del CRM del período (${fmtMoney(_ingresoCRM)}) repartido entre campañas según su participación en conversiones. Es una aproximación —el CRM no registra de qué campaña vino cada pedido—, pero refleja mejor la ganancia que el ROAS que reporta Google.</div>
    </div>`;
}
function renderAdsAgent(data){
  const camps=data.campanas||[];
  const recs=[];
  // Capacity-based recommendations from production lines
  try{
    const caps=getCapacidadLineas();
    caps.forEach(f=>{
      if(f.a==='PAUSAR') recs.push({tipo:'danger',msg:`Producción "${f.label}" al ${f.pct}% de capacidad (${f.info}). ${f.m}.`});
      else if(f.a==='REDUCIR') recs.push({tipo:'warn',msg:`Producción "${f.label}" al ${f.pct}% de capacidad. ${f.m}.`});
      else if(f.a==='ACTIVAR'&&f.pct<20) recs.push({tipo:'info',msg:`Producción "${f.label}" con baja ocupación (${f.pct}%). ${f.m}.`});
    });
  }catch(e){}
  const gasto=data.gasto||0,imp=data.impresiones||0,clics=data.clics||0,conv=data.conversiones||0;
  const ctrGlobal=imp>0?(clics/imp*100):0;
  const cpcGlobal=clics>0?(gasto/clics):0;
  // Análisis global
  if(ctrGlobal<2&&imp>1000) recs.push({tipo:'warn',msg:`CTR global bajo (${fmtPct(ctrGlobal)}). Considera revisar el copy de los anuncios o mejorar la relevancia de las palabras clave.`});
  if(ctrGlobal>=5) recs.push({tipo:'success',msg:`CTR global excelente (${fmtPct(ctrGlobal)}). Los anuncios tienen buena relevancia.`});
  if(conv===0&&gasto>0) recs.push({tipo:'danger',msg:`Sin conversiones en el período con $${gasto.toLocaleString('es-CL')} gastados. Verifica el tracking de conversiones y las landing pages.`});
  const valConv=data.valor_conversion||0;
  if(valConv>0&&gasto>0){const roas=valConv/gasto;if(roas<2) recs.push({tipo:'warn',msg:`ROAS bajo (${roas.toFixed(2)}x). Por cada $1 invertido se generan $${roas.toFixed(2)}. Objetivo recomendado: >3x.`});}
  // Análisis por campaña
  camps.forEach(c=>{
    const ctr=c.impresiones>0?(c.clics/c.impresiones*100):0;
    const cpc=c.clics>0?(c.gasto/c.clics):0;
    if(c.estado==='ENABLED'&&c.impresiones>500&&ctr<1) recs.push({tipo:'danger',msg:`"${c.nombre}": CTR muy bajo (${fmtPct(ctr)}). Revisa la relevancia de palabras clave y el copy del anuncio.`});
    if(c.estado==='PAUSED'&&c.gasto>0) recs.push({tipo:'info',msg:`"${c.nombre}" está pausada pero registró gasto (${fmtMoney(c.gasto)}). Verifica que sea intencional.`});
    if(c.estado==='ENABLED'&&c.clics===0&&c.impresiones>0) recs.push({tipo:'warn',msg:`"${c.nombre}": tiene ${fmtNum(c.impresiones)} impresiones pero 0 clics. El anuncio no está atrayendo tráfico.`});
  });
  // Campaña top y bajo rendimiento
  const activas=camps.filter(c=>c.estado==='ENABLED'&&c.gasto>0);
  if(activas.length>1){
    const top=activas.reduce((a,b)=>(b.conversiones>a.conversiones?b:a),activas[0]);
    const bottom=activas.reduce((a,b)=>{const ctrA=a.impresiones>0?a.clics/a.impresiones:0;const ctrB=b.impresiones>0?b.clics/b.impresiones:0;return ctrB<ctrA?b:a;},activas[0]);
    if(top.conversiones>0) recs.push({tipo:'success',msg:`Mejor campaña: "${top.nombre}" con ${top.conversiones.toFixed(0)} conversiones. Considera aumentar su presupuesto.`});
    if(bottom!==top&&bottom.impresiones>200){const ctr=bottom.impresiones>0?(bottom.clics/bottom.impresiones*100):0;recs.push({tipo:'warn',msg:`Campaña de menor CTR: "${bottom.nombre}" (${fmtPct(ctr)}). Evalúa pausarla o reestructurar sus palabras clave.`});}
  }
  // Detección de presupuesto agotado (gasto diario vs presupuesto diario)
  const days=parseInt(document.getElementById('adsPeriodSelect')?.value||'30');
  camps.forEach(c=>{
    if(c.estado==='ENABLED'&&c.presupuesto>0&&c.gasto>0){
      const dailyAvg=c.gasto/days;
      const util=dailyAvg/c.presupuesto;
      if(util>=0.9) recs.push({tipo:'warn',msg:`"${c.nombre}": gasto diario promedio (${fmtMoney(Math.round(dailyAvg))}) es el ${Math.round(util*100)}% del presupuesto diario. Considera aumentarlo para evitar cortes de visibilidad.`});
    }
  });
  // Score bajo en campaña activa con gasto
  camps.forEach(c=>{
    if(c.estado==='ENABLED'&&c.gasto>0){
      const hs=adsHealthScore(c);
      if(hs.score>0&&hs.score<30) recs.push({tipo:'danger',msg:`"${c.nombre}": score de salud muy bajo (${hs.score}/100). CTR, conversiones y ROAS están por debajo del umbral — requiere atención urgente.`});
    }
  });
  // Datos desactualizados del servidor
  if(data.guardado&&!data.demo){
    const age=Date.now()-new Date(data.guardado).getTime();
    if(age>86400000) recs.unshift({tipo:'warn',msg:`Datos del servidor con ${Math.floor(age/3600000)}h de antigüedad (última sync: ${new Date(data.guardado).toLocaleString('es-CL')}). Ejecuta el Script 2 en Google Ads para actualizar.`});
  }
  if(!recs.length) recs.push({tipo:'success',msg:'Todo en orden — no hay alertas críticas en este período.'});
  const colorMap={success:'var(--success)',warn:'var(--warn)',danger:'var(--danger)',info:'var(--accent)'};
  const iconMap={success:'✓',warn:'⚠',danger:'❌',info:'ℹ'};
  document.getElementById('adsAgentList').innerHTML=recs.map(r=>`
    <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;background:var(--surface2);border-radius:7px;border-left:3px solid ${colorMap[r.tipo]}">
      <span style="color:${colorMap[r.tipo]};font-size:13px;flex-shrink:0;margin-top:1px">${iconMap[r.tipo]}</span>
      <span style="font-size:11px;color:var(--text2);line-height:1.5">${r.msg}</span>
    </div>`).join('');
  document.getElementById('adsAgentBadge').textContent=recs.length+' hallazgo'+(recs.length!==1?'s':'');
  document.getElementById('adsAgentBox').style.display='block';
}
// ─────────────────────────────────────────────────────────
function copyPhpSnippet(){
  const code=document.getElementById('phpSnippetCode')?.textContent||'';
  navigator.clipboard.writeText(code).then(()=>toast('✓ Código copiado','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=code;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('✓ Código copiado','success');
  });
}
function solicitarIndexacion(pageUrl){
  if(!pageUrl){toast('URL no disponible','error');return;}
  const scUrl='https://search.google.com/search-console/inspect?resource_id=https://thelab.solutions/&url='+encodeURIComponent(pageUrl);
  window.open(scUrl,'_blank');
  toast('Abre Search Console → haz clic en "Solicitar indexación"','info');
}
function renderWebKPIs(pages){
  const total=pages.length;
  const withTitle=pages.filter(p=>(p.yoast_head_json?.title||'').trim().length>0);
  const withDesc=pages.filter(p=>(p.yoast_head_json?.description||'').trim().length>0);
  const completo=pages.filter(p=>(p.yoast_head_json?.title||'').trim()&&(p.yoast_head_json?.description||'').trim());
  const titleOk=pages.filter(p=>{const l=(p.yoast_head_json?.title||'').length;return l>=40&&l<=60;});
  const descOk=pages.filter(p=>{const l=(p.yoast_head_json?.description||'').length;return l>=120&&l<=155;});
  const sinTitle=total-withTitle.length;
  const sinDesc=total-withDesc.length;
  const pct=n=>total>0?Math.round(n/total*100)+'%':'—';
  document.getElementById('kpi-total').textContent=total;
  document.getElementById('kpi-completo').textContent=completo.length;
  document.getElementById('kpi-completo-sub').textContent=pct(completo.length);
  document.getElementById('kpi-sin-title').textContent=sinTitle||'✓';
  document.getElementById('kpi-sin-title').style.color=sinTitle>0?'var(--danger)':'var(--success)';
  document.getElementById('kpi-sin-desc').textContent=sinDesc||'✓';
  document.getElementById('kpi-sin-desc').style.color=sinDesc>0?'var(--warn)':'var(--success)';
  document.getElementById('kpi-title-ok').textContent=titleOk.length+'/'+total;
  document.getElementById('kpi-desc-ok').textContent=descOk.length+'/'+total;
  // Sincronizar al card de Overview
  ovSyncWebKPIs(total, completo.length, sinTitle, sinDesc, pct(completo.length));
}

function ovSyncWebKPIs(total, completo, sinTitle, sinDesc, pctStr){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('ov-web-total', total||'—');
  set('ov-web-ok', completo||'—');
  set('ov-web-oks', total>0?pctStr+' de las páginas':'—');
  const titleEl=document.getElementById('ov-web-title');
  if(titleEl){titleEl.textContent=sinTitle||'✓';titleEl.style.color=sinTitle>0?'var(--danger)':'var(--accent3)';}
  const descEl=document.getElementById('ov-web-desc');
  if(descEl){descEl.textContent=sinDesc||'✓';descEl.style.color=sinDesc>0?'#ffaa00':'var(--accent3)';}
  const now=new Date();
  const ts=now.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});
  set('ov-web-status','Actualizado '+now.toLocaleDateString('es-CL')+' a las '+ts);
}