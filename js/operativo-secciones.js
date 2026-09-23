/* Densidad de información por sección. Reutiliza nodos, filtros y acciones originales. */
(function(global){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>escapeHtml(String(v??''));
  const permitted=page=>typeof AUTH!=='undefined'&&typeof RBAC!=='undefined'&&(RBAC.tabs[AUTH.getUser()?.role]||[]).includes(page);
  const cash=v=>v==null||v===''||!Number.isFinite(Number(v))?'Sin dato':formatCLP(Number(v));
  let clientRows=[],clientLimit=24,clientsInitialized=false;
  const action=(label,type,id)=>`<button type="button" class="op-button op-primary" data-ops="${type}" data-id="${esc(id||'')}">${esc(label)}</button>`;
  function fold(nodes,label){
    nodes=[...new Set(nodes.filter(Boolean))];if(!nodes.length||nodes[0].closest('details.op-disclosure'))return;
    // Un grupo nunca debe trasladar contenido entre paneles o contenedores.
    const parent=nodes[0].parentElement;
    if(nodes.some(n=>n.parentElement!==parent)){nodes.forEach(n=>fold([n],label));return;}
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
    // Próximos 14 días, Foco operativo y Compromisos sin fecha tienen su propio
    // colapsado en calendario-collapsible.js; no envolverlos otra vez en <details>.
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
  function clientCategoryState(){
    const active=$('cliCatBar')?.querySelector?.('.cli-cat-chip.active')?.dataset?.cat||'todos';
    const n=k=>String($('cliCatN-'+k)?.textContent||'0').trim();
    return {active,leads:n('lead'),clientes:n('cliente'),todos:n('todos')};
  }
  function clientToolbar(){
    const s=clientCategoryState(),search=String($('clienteSearch')?.value||'');
    const originHtml=s.active==='lead'?String($('cliOrigenBar')?.innerHTML||''):'';
    const seg=(cat,icon,label,n)=>`<button type="button" class="op-client-seg ${s.active===cat?'active':''}" data-ops="client-cat" data-cat="${cat}"><span>${icon}</span><b>${label}</b><em>${esc(n)}</em></button>`;
    return `<section class="op-client-command">
      <div class="op-client-command-head">
        <div><span class="op-eyebrow">BASE CRM</span><h2>Clientes y leads</h2><p>Filtra, prioriza y ejecuta las mismas acciones del modo Experto sin salir de Tarjetas.</p></div>
        <div class="op-client-queue ${Number(s.leads)>0?'has-leads':''}"><span>LEADS EN COLA</span><strong>${esc(s.leads)}</strong><small>pendientes de validar</small></div>
      </div>
      <div class="op-client-command-row">
        <div class="op-client-segments">${seg('lead','🎯','Leads',s.leads)}${seg('cliente','✓','Clientes',s.clientes)}${seg('todos','◎','Todos',s.todos)}</div>
        <label class="op-client-search"><span>⌕</span><input type="search" data-ops-input="client-search" value="${esc(search)}" placeholder="Buscar empresa, contacto, email…"></label>
      </div>
      ${originHtml?`<div class="op-client-origins">${originHtml}</div>`:''}
      <div class="op-client-command-actions">
        <button type="button" class="op-client-tool primary" data-ops="client-new"><span>＋</span><b>Nuevo lead</b></button>
        <button type="button" class="op-client-tool" data-ops="client-prospect"><span>🎯</span><b>Prospección IA</b></button>
        <button type="button" class="op-client-tool" data-ops="client-ranking"><span>✦</span><b>Ranking IA</b></button>
        <button type="button" class="op-client-tool" data-ops="client-sort" data-sort="score"><span>🔥</span><b>Por score</b></button>
        <button type="button" class="op-client-tool" data-ops="client-sort" data-sort="silencio"><span>◷</span><b>Inactivos</b></button>
        <button type="button" class="op-client-tool quiet" data-ops="client-export"><span>↓</span><b>CSV</b></button>
      </div>
    </section>`;
  }
  function clientCardMenu(c){
    const f=c?.fields||{},id=esc(c?.id||''),company=esc(f.Empresa||''),name=esc(f.Empresa||f.Contacto||'este cliente');
    const isLead=typeof esLeadCat==='function'?esLeadCat(c):!(f['Validado']===true);
    const debt=(Number(f['Facturas vencidas'])||0)>=1;
    const info=typeof _cliUltInteraccion==='function'?_cliUltInteraccion(c):null;
    const inactive=['Cliente inactivo','Inactivo','Perdido'].includes(f['Etapa venta']||'');
    const reactivable=inactive||(info&&Number(info.dias)>=30);
    return `<div class="op-card-footer-actions">
      ${action('Ver cliente','client',c.id)}
      <div class="act-drop op-client-card-actions">
        <button type="button" class="act-toggle op-client-more" onclick="toggleActMenu(event,'op-actmenu-cli-${id}')" title="Más acciones" aria-label="Más acciones">•••</button>
        <div class="act-menu op-client-menu" id="op-actmenu-cli-${id}">
          <button class="act-item" data-ops="client-view" data-id="${id}">👁 &nbsp;Ver detalle</button>
          <button class="act-item" data-ops="client-edit" data-id="${id}">✏️ &nbsp;Editar (guiado)</button>
          ${isLead?`<button class="act-item act-item-green" data-ops="client-validate" data-id="${id}">✅ &nbsp;Validar como cliente</button>`:`<button class="act-item" data-ops="client-revert" data-id="${id}">↩ &nbsp;Volver a lead</button>`}
          <button class="act-item act-item-yellow" data-ops="client-quotes" data-id="${id}" data-company="${company}">▤ &nbsp;Ver cotizaciones</button>
          <button class="act-item act-item-green" data-ops="client-new-quote" data-id="${id}">＋ &nbsp;Nueva cotización</button>
          <button class="act-item act-item-green" data-ops="client-kai-quote" data-id="${id}" data-company="${company}">💰 &nbsp;Cotizar con KAI (guiado)</button>
          <button class="act-item" data-ops="client-portal" data-id="${id}">🔗 &nbsp;Portal cliente</button>
          <button class="act-item act-item-red" data-ops="client-revoke" data-id="${id}" data-name="${name}">⊘ &nbsp;Revocar links del portal</button>
          ${isLead?`<button class="act-item act-item-cyan" data-ops="client-sales-ai" data-id="${id}">💬 &nbsp;Estrategia venta IA</button><button class="act-item act-item-cyan" data-ops="client-onboarding-ai" data-id="${id}">📨 &nbsp;Bienvenida IA</button>`:''}
          ${debt?`<button class="act-item act-item-cyan" data-ops="client-finance-ai" data-id="${id}">💰 &nbsp;Recordatorio pago IA</button>`:''}
          ${reactivable?`<div class="act-sep"></div><button class="act-item act-item-cyan" data-ops="client-reactivate" data-id="${id}">♻ &nbsp;Reactivar IA</button><button class="act-item act-item-green" data-ops="client-reactivate-done" data-id="${id}">✓ &nbsp;Marcar gestionado (listo)</button>`:''}
        </div>
      </div>
    </div>`;
  }
  function clients(rows){
    if(!permitted('clientes'))return;
    if(rows!==undefined){clientRows=Array.isArray(rows)?rows:[];clientLimit=24;clientsInitialized=true;}
    else if(!clientsInitialized&&typeof state!=='undefined'&&Array.isArray(state.clientes)){clientRows=state.clientes;clientsInitialized=true;}
    const el=$('opClients');if(!el)return;
    const visible=typeof isVendorMode==='function'&&isVendorMode()?clientRows.filter(vendorOwnsRecord):clientRows;
    const index=new Map();
    (state.cotizaciones||[]).forEach(q=>{
      if(typeof isVendorMode==='function'&&isVendorMode()&&!vendorOwnsRecord(q))return;
      (Array.isArray(q.fields.Cliente)?q.fields.Cliente:[]).forEach(id=>{const n=index.get(id)||{sent:0,pending:0,open:0,purchases:0};if(q.fields['Estado cotización']==='Enviada')n.sent++;if(q.fields['Estado cotización']==='Solicitada')n.pending++;if(['Solicitada','Enviada','Negociación'].includes(q.fields['Estado cotización']))n.open++;index.set(id,n);});
    });
    (state.pedidos||[]).forEach(p=>{
      if(typeof isVendorMode==='function'&&isVendorMode()&&!vendorOwnsRecord(p))return;
      if(!['Despachado','Completado'].includes(p.fields?.['Estado pedido']))return;
      (Array.isArray(p.fields.Cliente)?p.fields.Cliente:[]).forEach(id=>{const n=index.get(id)||{sent:0,pending:0,open:0,purchases:0};n.purchases++;index.set(id,n);});
    });
    const ranked=visible.map(c=>({c,info:clientInfo(c,index)})).sort((a,b)=>a.info.rank-b.info.rank);
    try{global.DashboardNotificationBadges?.render?.();}catch(e){}
    el.innerHTML=`${clientToolbar()}<div class="op-section-heading op-client-list-heading"><div><span class="op-eyebrow">VISTA TARJETAS</span><h2>Próximas gestiones</h2><p>${ranked.length} registros en la selección · prioridades según actividad real del CRM.</p></div></div><div class="op-records op-client-records">${ranked.slice(0,clientLimit).map(({c,info})=>{
      const f=c.fields||{},activity=typeof _cliUltInteraccion==='function'?_cliUltInteraccion(c):null;
      const last=activity&&Number.isFinite(activity.ts)?new Date(activity.ts).toLocaleDateString('es-CL'):'Sin registro';
      const activityLabel=activity?.src==='ingreso'?'Ingreso al CRM':'Última cotización o pedido';
      const count=index.get(c.id)||{sent:0,pending:0,open:0,purchases:0};
      return `<article class="op-record"><header><div><h3>${esc(f.Empresa||f.Contacto||'Sin nombre')}</h3><p>${esc(f.Contacto||'Contacto sin registrar')}</p></div><span class="op-pill">${esc(f['Etapa venta']||'Sin etapa')}</span></header><p class="op-caption">${esc(info.reason)}</p><div class="op-facts"><div><span>${esc(activityLabel)}</span><b>${esc(last)}</b><small>${activity&&Number.isFinite(activity.dias)?esc(activity.dias===0?'Hoy':'Hace '+activity.dias+' días'):'Sin actividad registrada'}</small></div><div><span>Actividad comercial</span><b>${count.open} cotizaciones abiertas</b><small>${count.purchases} pedidos despachados o completados</small></div></div><footer><span><small>Siguiente paso</small>${esc(info.next)}</span>${clientCardMenu(c)}</footer></article>`;
    }).join('')||'<p class="op-empty">No hay clientes en esta selección. Revisa la búsqueda y los filtros.</p>'}</div>${ranked.length>clientLimit?action('Ver más clientes','more-clients'):''}`;
  }
  function reportSummary(raw){
    const summary=typeof _kaiSimpleSummary==='function'?_kaiSimpleSummary(raw):'Consulta las conclusiones del reporte.';
    const actions=typeof _kaiSimpleActions==='function'?_kaiSimpleActions(raw).slice(0,3):[];
    return `<p class="op-caption">${esc(summary)}</p>${actions.length?`<h3>Próximas acciones</h3><ol>${actions.map(a=>`<li>${esc(a)}</li>`).join('')}</ol>`:''}<details class="op-disclosure"><summary>Leer informe completo</summary>${formatCeoReport(raw)}</details>`;
  }
  function reportDelta(current,previous,key,kind){
    const read=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
    let a=read(current?.[key]),b=read(previous?.[key]);
    if(a===null||b===null)return 'Sin comparación disponible';
    if(kind==='margin'){a=a<=1?a*100:a;b=b<=1?b*100:b;}
    const delta=a-b;
    if(delta===0)return 'Sin cambio respecto al reporte anterior';
    const amount=kind==='cash'?cash(Math.abs(delta)):Math.abs(delta).toLocaleString('es-CL',{maximumFractionDigits:1});
    return (delta>0?'+':'−')+amount+(kind==='margin'?' puntos porcentuales':'')+' vs. reporte anterior';
  }
  function reports(){
    if(!permitted('reporte'))return;
    const el=$('opReports');if(!el)return;
    const rows=[...(state.reportes||[])].sort((a,b)=>String(b.createdTime||'').localeCompare(String(a.createdTime||''))),r=rows[0];
    if(!r){el.innerHTML='<p class="op-empty">Aún no hay reportes. Genera el primero para revisar indicadores y conclusiones.</p>';return;}
    const f=r.fields||{},mp=f['Margen promedio semana (%)'],prev=rows[1]?.fields;
    const margin=mp==null||mp===''||!Number.isFinite(Number(mp))?'Sin dato':(Number(mp)<=1?Number(mp)*100:Number(mp)).toFixed(0)+'%';
    el.innerHTML=`<div class="op-section-heading"><div><span class="op-eyebrow">ÚLTIMO REPORTE REGISTRADO</span><h2>${esc(f.Semana||'Semana sin registrar')}</h2><p>${esc(f['Estado reporte']||'Estado sin registrar')}</p></div></div><div class="op-metrics"><div class="op-metric"><span>Revenue neto</span><strong>${esc(cash(f['Revenue semana (CLP)']))}</strong><small>${esc(reportDelta(f,prev,'Revenue semana (CLP)','cash'))}</small></div><div class="op-metric"><span>Pedidos despachados</span><strong>${esc(f['Pedidos despachados']??'Sin dato')}</strong><small>${esc(reportDelta(f,prev,'Pedidos despachados','count'))}</small></div><div class="op-metric"><span>Margen semanal</span><strong>${esc(margin)}</strong><small>${esc(reportDelta(f,prev,'Margen promedio semana (%)','margin'))}</small></div></div>${f['Resumen ejecutivo']?reportSummary(f['Resumen ejecutivo']):'<p class="op-caption">Este reporte no tiene conclusiones registradas.</p>'}`;
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-ops]');if(!b)return;
    const op=b.dataset.ops,id=b.dataset.id||'';
    if(op==='client'&&permitted('clientes')&&clientRows.some(c=>c.id===id&&(typeof isVendorMode!=='function'||!isVendorMode()||vendorOwnsRecord(c))))openClienteDetalle(id);
    if(op==='more-clients'){clientLimit+=24;clients();}
    if(op==='client-cat'&&typeof setCliCat==='function')setCliCat(b.dataset.cat||'todos');
    if(op==='client-new'){if(typeof switchTab==='function')switchTab('nuevo-lead');}
    if(op==='client-prospect'&&typeof runLeadGenAgent==='function')runLeadGenAgent();
    if(op==='client-ranking'&&typeof runLeadRankingAgent==='function')runLeadRankingAgent();
    if(op==='client-sort'){
      try{if(typeof clientesSort!=='undefined'){clientesSort.key=b.dataset.sort||'score';clientesSort.dir=-1;}if(typeof renderClientes==='function')renderClientes();if(typeof _saveUIState==='function')_saveUIState();}catch(_){}
    }
    if(op==='client-export'&&typeof exportToCSV==='function')exportToCSV('clientes');
    if(op==='client-view'&&typeof openClienteDetalle==='function')openClienteDetalle(id);
    if(op==='client-edit'&&typeof startEditClientFlow==='function')startEditClientFlow(id);
    if(op==='client-validate'&&typeof validarCliente==='function')validarCliente(id);
    if(op==='client-revert'&&typeof revertirALead==='function')revertirALead(id);
    if(op==='client-quotes'&&typeof verCotizacionesCliente==='function')verCotizacionesCliente(id,b.dataset.company||'');
    if(op==='client-new-quote'&&typeof cotizarParaCliente==='function')cotizarParaCliente(id);
    if(op==='client-kai-quote'&&typeof startQuoteFlow==='function')startQuoteFlow(id,b.dataset.company||'');
    if(op==='client-portal'&&typeof compartirPortalCliente==='function')compartirPortalCliente(id);
    if(op==='client-revoke'&&typeof revocarPortalCliente==='function')revocarPortalCliente(id,b.dataset.name||'este cliente');
    if(op==='client-sales-ai'&&typeof runSalesAgent==='function')runSalesAgent(id);
    if(op==='client-onboarding-ai'&&typeof runOnboardingAgent==='function')runOnboardingAgent(id);
    if(op==='client-finance-ai'&&typeof runFinanceAgent==='function')runFinanceAgent(id);
    if(op==='client-reactivate'&&typeof wbReactivar==='function')wbReactivar(id);
    if(op==='client-reactivate-done'&&typeof wbMarkDone==='function')wbMarkDone(id);
  });
  document.addEventListener('input',e=>{
    const input=e.target.closest?.('[data-ops-input="client-search"]');if(!input)return;
    const canonical=$('clienteSearch');if(canonical)canonical.value=input.value;
    if(typeof debInput==='function')debInput('cli',filterClientes);else if(typeof filterClientes==='function')filterClientes();
  });
  global.OPSections={mount,clients,reports,clientInfo};
  document.addEventListener('DOMContentLoaded',mount);
})(window);
