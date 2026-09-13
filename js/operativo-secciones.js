/* Densidad de información por sección. Reutiliza nodos, filtros y acciones originales. */
(function(global){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>escapeHtml(String(v??''));
  const permitted=page=>typeof AUTH!=='undefined'&&typeof RBAC!=='undefined'&&(RBAC.tabs[AUTH.getUser()?.role]||[]).includes(page);
  const cash=v=>v==null||v===''||!Number.isFinite(Number(v))?'Sin dato':formatCLP(Number(v));
  let clientRows=[],clientLimit=24;
  const action=(label,type,id)=>`<button type="button" class="op-button op-primary" data-ops="${type}" data-id="${esc(id||'')}">${esc(label)}</button>`;
  function fold(nodes,label){
    nodes=nodes.filter(Boolean);if(!nodes.length||nodes[0].closest('details.op-disclosure'))return;
    const box=document.createElement('details');box.className='op-disclosure';
    const summary=document.createElement('summary');summary.textContent=label;box.appendChild(summary);
    nodes[0].before(box);nodes.forEach(n=>box.appendChild(n));
    box.open=box.closest('.tab-panel')?.dataset.opView==='expert';
  }
  function card(id){return $(id)?.closest('.card');}
  function markMetric(id){$(id)?.closest('.stat-card, .kpi-card')?.classList.add('op-expert-only');}
  function mount(){
    if(!$('tab-clientes')||$('tab-clientes').dataset.opsReady)return;
    $('tab-clientes').dataset.opsReady='1';
    OP.mount();
    const table=$('clientesTableBody')?.closest('.table-wrap');
    if(table){
      const list=document.createElement('section');list.id='opClients';list.className='op-simple op-client-list';table.before(list);
      fold([table],'Tabla completa y selección múltiple');
    }
    fold(['wbTrayCard','recompraTrayCard','retainersCard','churnCard','fechasClaveCard'].map($),'Análisis de cartera y oportunidades');
    // Se preservan filtros, estado, errores, antigüedad de telemetría y controles.
    fold([$('maqOcupacion')],'Ocupación de la flota');
    fold([$('calHistory')?.closest('.card')],'Historial de reprogramaciones');
    fold([$('calProximos')?.closest('.card')],'Próximos 14 días');
    fold([$('equipoHeader')?.closest('.card'),$('equipoDetalleSemana')],'Planificación semanal del equipo');
    fold([$('comMes')?.parentElement,$('comisionesRanking')],'Ventas y comisiones del equipo');
    fold([$('redesAutoPanel')],'Automatizaciones de redes');
    fold([card('redesMetrics'),card('redesRecycle')],'Métricas y reciclaje de contenido');
    markMetric('redesKpiPub');markMetric('redesKpiLeads');
    fold([card('nlAudience'),card('nlSubsList')],'Segmentación y destinatarios');
    fold([card('nlAnalytics')],'Rendimiento detallado del newsletter');
    markMetric('nlKpiSub');markMetric('nlKpiEnv');
    fold([$('seoAuditPanel')],'Auditoría y optimización SEO');
    fold([$('adsCampaignsArea')],'Campañas y gestión detallada');
    fold([$('adsKeywordsPanel')],'Palabras clave');
    fold([$('adsAutopilotPanel')],'Automatización publicitaria');
    // Advertencias de conexión, datos DEMO, desactualización y mutaciones siguen visibles.
    ['ads-kpi-imp','ads-kpi-clics','ads-kpi-ctr','ads-kpi-cpc','ads-kpi-roas'].forEach(markMetric);
    ['web-kpi-nuevos','web-kpi-vistas'].forEach(markMetric);
    const channels=$('webTrafficCanales')?.parentElement?.parentElement;
    fold(channels?[channels]:[],'Canales y páginas más vistas');
    fold([$('estacionalidadCard'),$('cacCanalCard')],'Estacionalidad y adquisición');
    const history=card('reportesTableBody');
    if(history){
      const surface=document.createElement('section');surface.id='opReports';surface.className='op-simple op-surface';history.before(surface);
      fold([history],'Historial de reportes');
    }
    const finance=$('tab-finanzas')?.querySelector('.section-header');
    if(finance){const note=document.createElement('p');note.className='op-scope-note';note.textContent='Simple / Experto organiza Resumen y Por cobrar. Las demás pestañas conservan sus herramientas completas.';finance.after(note);}
    // Algunas secciones se renderizan en listeners registrados antes que este
    // módulo; repintamos aquí para que el primer estado nunca quede vacío.
    clients();
    reports();
  }
  function clientInfo(c,index){
    const f=c.fields||{},counts=index?.get(c.id)||{sent:0,pending:0};
    const sent=counts.sent,pending=counts.pending;
    const overdue=Number(f['Facturas vencidas'])||0;
    const days=typeof _cliSilencioDias==='function'?_cliSilencioDias(c):null;
    if(overdue>0)return {rank:0,reason:`${overdue} facturas vencidas registradas`,next:'Revisar estado de cuenta'};
    if(pending)return {rank:1,reason:`${pending} cotizaciones pendientes de envío`,next:'Preparar propuesta'};
    if(sent)return {rank:2,reason:`${sent} cotizaciones enviadas, sin aprobación registrada`,next:'Revisar seguimiento'};
    if(days!==null&&days>=60)return {rank:3,reason:`${days} días desde la última cotización o pedido`,next:'Revisar oportunidad de reactivación'};
    return {rank:4,reason:days===null?'Sin cotizaciones ni pedidos registrados':'Con actividad comercial registrada',next:'Consultar ficha y próxima gestión'};
  }
  function clients(rows){
    if(!permitted('clientes'))return;
    if(rows!==undefined){clientRows=rows;clientLimit=24;}
    else if(!clientRows.length&&typeof state!=='undefined'&&Array.isArray(state.clientes))clientRows=state.clientes;
    const el=$('opClients');if(!el)return;
    const visible=typeof isVendorMode==='function'&&isVendorMode()?clientRows.filter(vendorOwnsRecord):clientRows;
    const index=new Map();
    (state.cotizaciones||[]).forEach(q=>{
      if(typeof isVendorMode==='function'&&isVendorMode()&&!vendorOwnsRecord(q))return;
      (Array.isArray(q.fields.Cliente)?q.fields.Cliente:[]).forEach(id=>{const n=index.get(id)||{sent:0,pending:0};if(q.fields['Estado cotización']==='Enviada')n.sent++;if(q.fields['Estado cotización']==='Solicitada')n.pending++;index.set(id,n);});
    });
    const ranked=visible.map(c=>({c,info:clientInfo(c,index)})).sort((a,b)=>a.info.rank-b.info.rank);
    el.innerHTML=`<div class="op-section-heading"><div><h2>Próximas gestiones</h2><p>${ranked.length} clientes en la selección · prioridades según registros del CRM.</p></div></div><div class="op-records">${ranked.slice(0,clientLimit).map(({c,info})=>{
      const f=c.fields||{};return `<article class="op-record"><header><div><h3>${esc(f.Empresa||f.Contacto||'Sin nombre')}</h3><p>${esc(f.Contacto||'Contacto sin registrar')}</p></div><span class="op-pill">${esc(f['Etapa venta']||'Sin etapa')}</span></header><p class="op-caption">${esc(info.reason)}</p><footer><span><small>Siguiente paso</small>${esc(info.next)}</span>${action('Ver cliente','client',c.id)}</footer></article>`;
    }).join('')||'<p class="op-empty">No hay clientes en esta selección. Revisa la búsqueda y los filtros.</p>'}</div>${ranked.length>clientLimit?action('Ver más clientes','more-clients'):''}`;
  }
  function reportSummary(raw){
    const summary=typeof _kaiSimpleSummary==='function'?_kaiSimpleSummary(raw):'Consulta las conclusiones del reporte.';
    const actions=typeof _kaiSimpleActions==='function'?_kaiSimpleActions(raw):[];
    return `<p class="op-caption">${esc(summary)}</p>${actions.length?`<h3>Próximas acciones</h3><ol>${actions.map(a=>`<li>${esc(a)}</li>`).join('')}</ol>`:''}<details class="op-disclosure"><summary>Leer informe completo</summary>${formatCeoReport(raw)}</details>`;
  }
  function reports(){
    if(!permitted('reporte'))return;
    const el=$('opReports');if(!el)return;
    const rows=[...(state.reportes||[])].sort((a,b)=>String(b.createdTime||'').localeCompare(String(a.createdTime||''))),r=rows[0];
    if(!r){el.innerHTML='<p class="op-empty">Aún no hay reportes. Genera el primero para revisar indicadores y conclusiones.</p>';return;}
    const f=r.fields||{},mp=f['Margen promedio semana (%)'];
    el.innerHTML=`<div class="op-section-heading"><div><span class="op-eyebrow">ÚLTIMO REPORTE REGISTRADO</span><h2>${esc(f.Semana||'Semana sin registrar')}</h2><p>${esc(f['Estado reporte']||'Estado sin registrar')}</p></div></div><div class="op-metrics"><div class="op-metric"><span>Revenue neto</span><strong>${esc(cash(f['Revenue semana (CLP)']))}</strong></div><div class="op-metric"><span>Pedidos despachados</span><strong>${esc(f['Pedidos despachados']??'Sin dato')}</strong></div><div class="op-metric"><span>Margen semanal</span><strong>${mp==null?'Sin dato':esc((Number(mp)<=1?Number(mp)*100:Number(mp)).toFixed(0)+'%')}</strong></div></div>${f['Resumen ejecutivo']?reportSummary(f['Resumen ejecutivo']):'<p class="op-caption">Este reporte no tiene conclusiones registradas.</p>'}`;
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-ops]');if(!b)return;
    if(b.dataset.ops==='client'&&permitted('clientes')&&clientRows.some(c=>c.id===b.dataset.id&&(typeof isVendorMode!=='function'||!isVendorMode()||vendorOwnsRecord(c))))openClienteDetalle(b.dataset.id);
    if(b.dataset.ops==='more-clients'){clientLimit+=24;clients();}
  });
  global.OPSections={mount,clients,reports,clientInfo};
  document.addEventListener('DOMContentLoaded',mount);
})(window);
