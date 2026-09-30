/* Centro de Conexiones TLS. Solo lecturas de diagnostico; nunca almacena credenciales ni ejecuta IA. */
(function(root){
  'use strict';
  const DOC=typeof document==='undefined'?null:document;
  const FIVE_MIN=300000, FRESH_FOR=900000, HISTORY_MAX=80;
  const catalog=[
    {id:'proxy',name:'Cloudflare · Proxy CRM',group:'Datos y seguridad',page:'overview',impact:'Clientes, Cotizaciones, Pedidos, Agentes y Reportes',guide:'Comprobar DNS y ruta /health del proxy. Las credenciales deben permanecer en Cloudflare; no pegarlas en este panel.',auto:true},
    {id:'airtable',name:'Airtable · Base CRM',group:'Datos y seguridad',page:'clientes',impact:'Clientes, Cotizaciones, Pedidos y Reportes',guide:'Revisar el estado del proxy, los permisos del token en Cloudflare y la base autorizada. Reintentar una lectura antes de editar datos.',auto:true},
    {id:'github',name:'GitHub · Despliegue Pages',group:'Datos y seguridad',page:'overview',impact:'Publicación de nuevas versiones del dashboard',guide:'Abrir GitHub Actions > Deploy Dashboard. Revisar la última ejecución y que el commit publicado coincida con la versión cargada.',auto:true},
    {id:'calendar',name:'Google Calendar',group:'Google y comunicación',page:'calendario',impact:'Agenda y sincronización de eventos',guide:'Reconectar la cuenta usando OAuth. Después, abrir Calendario para revisar la sincronización real de eventos. Una prueba de acceso no confirma que todos los eventos se sincronizaron.',auto:true,oauth:true},
    {id:'drive',name:'Google Drive',group:'Google y comunicación',page:'cotizaciones',impact:'Archivos, carpetas y propuestas',guide:'Reconectar mediante el botón OAuth. Revisar el Client ID autorizado y las carpetas desde una cotización; la lectura no crea archivos.',auto:true,oauth:true},
    {id:'imap',name:'Correos · Entrada IMAP',group:'Google y comunicación',page:'correo',impact:'Recepción, carpetas y lectura de correos',guide:'Abrir Correos, elegir la cuenta afectada y volver a introducir la clave en esa sesión. El diagnóstico solo consulta carpetas, nunca marca mensajes como leídos.',auto:false},
    {id:'resend',name:'Correos · Salida Resend',group:'Google y comunicación',page:'correo',impact:'Envío de correos desde el dashboard',guide:'La salida utiliza Resend. Verificar la clave en el servidor y los registros de entrega en Resend. No se envían correos de prueba automáticamente.',auto:false},
    {id:'printer',name:'Bridge de impresoras',group:'Operaciones',page:'maquinas',impact:'Telemetría y cámaras de las impresoras',guide:'Comprobar el bridge y el túnel. Si está disponible, revisar luego las cámaras y la autenticación en Máquinas; /healthz por sí solo no certifica cada impresora.',auto:true},
    {id:'sii',name:'SII · Emisor electrónico',group:'Operaciones',page:'finanzas',impact:'Facturas, certificado y emisión de DTE',guide:'Revisar configuración y certificados del Worker SII desde el entorno seguro. El diagnóstico jamás emite DTE ni consume folios.',auto:true},
    {id:'leads',name:'Leads · Worker web',group:'Marketing y web',page:'clientes',impact:'Formulario web, nuevos leads y newsletter',guide:'Comprobar /health y la credencial Airtable en el Worker. Para verificar un envío real del formulario, realizar una prueba controlada fuera de este monitor.',auto:true},
    {id:'anthropic',name:'Claude API',group:'IA y automatización',page:'reporte',impact:'Agentes e informes IA',guide:'Comprobar desde el servidor la validez y saldo de Anthropic. El monitor solo verifica si existe la configuración; nunca genera tokens.',auto:false},
    {id:'openai',name:'OpenAI API',group:'IA y automatización',page:'reporte',impact:'Funciones IA habilitadas mediante proxy',guide:'Comprobar la configuración de la clave en Cloudflare y el servicio de facturación. El monitor no llama a modelos de pago.',auto:false},
    {id:'make',name:'Make · Automatizaciones',group:'IA y automatización',page:'overview',impact:'Escenarios de automatización y notificaciones',guide:'Abrir el historial de ejecuciones de Make y revisar escenarios fallidos. No llamar al webhook para probarlo: podría crear registros o enviar mensajes.',auto:false},
    {id:'ads',name:'Google Ads',group:'Marketing y web',page:'web',impact:'Campañas, gasto y reportes publicitarios',guide:'Verificar autorización en Google Ads y la última sincronización en WEB. Las credenciales y los permisos comerciales no se prueban por una solicitud pública.',auto:false},
    {id:'meta',name:'Meta / Redes sociales',group:'Marketing y web',page:'redes',impact:'Publicaciones, integraciones y métricas sociales',guide:'Abrir Redes y revisar autorizaciones de Meta. Evitar publicar mensajes de prueba desde una comprobación de salud.',auto:false},
    {id:'wordpress',name:'WordPress · Sitio web',group:'Marketing y web',page:'web',impact:'Contenido del sitio y diagnóstico SEO',guide:'Revisar WEB y la API REST de WordPress. La validación de edición requiere un permiso de sitio; el monitor no modifica entradas.',auto:false}
  ];
  const byId=Object.fromEntries(catalog.map(s=>[s.id,s]));
  const store={results:{},history:[],lastGood:{},lastSweep:0,lastCheckAt:0,busy:new Set(),snapshot:null,active:'Todas',mounted:false,autoStarted:false,userKey:null};
  const label={green:'Operativo',yellow:'Advertencia',red:'Error confirmado',gray:'Sin verificar'};
  function user(){
    try{return typeof AUTH!=='undefined'&&AUTH.getUser?AUTH.getUser():null;}catch(_){return null;}
  }
  function isAdmin(){return ['admin','gerencia'].includes(String(user()?.role||'').toLowerCase());}
  function permitted(page){
    try{const u=user();return !!u&&typeof RBAC!=='undefined'&&(RBAC.tabs[u.role]||[]).includes(page);}catch(_){return false;}
  }
  function stateKey(){
    const id=String(user()?.username||'anon').toLowerCase().replace(/[^a-z0-9@._-]/g,'_').slice(0,120);
    return 'tls_connections_history_v1_'+id;
  }
  function restore(){
    if(!user())return;
    try{
      const data=JSON.parse(localStorage.getItem(stateKey())||'{}');
      store.history=Array.isArray(data.history)?data.history.slice(0,HISTORY_MAX):[];
      store.lastGood=data.lastGood&&typeof data.lastGood==='object'?data.lastGood:{};
    }catch(_){store.history=[];store.lastGood={};}
  }
  function persist(){
    try{if(user())localStorage.setItem(stateKey(),JSON.stringify({history:store.history.slice(0,HISTORY_MAX),lastGood:store.lastGood}));}catch(_){}
  }
  function visibleServices(){
    return catalog.filter(s=>s.page==='overview'||permitted(s.page)||isAdmin());
  }
  function counts(items){
    return items.reduce((a,s)=>{const status=displayStatus(s.id).status;a[status]=(a[status]||0)+1;return a;},{green:0,yellow:0,red:0,gray:0});
  }
  function formatTime(ms){
    if(!Number.isFinite(Number(ms))||!ms)return 'Sin registro';
    try{return new Date(ms).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(_){return 'Sin registro';}
  }
  function displayStatus(id){
    const r=store.results[id];
    if(!r)return {status:'gray',message:'Todavía no se ha ejecutado una prueba',checkedAt:0};
    if(r.status==='green'&&Date.now()-r.checkedAt>FRESH_FOR)return {...r,status:'yellow',message:'La última prueba ya está desactualizada'};
    return r;
  }
  // Solo se almacenan categorías y textos elegidos por este módulo. No se
  // registra ninguna respuesta HTTP cruda, token, correo ni URL con parámetros.
  function result(id,status,message,mode){
    if(!byId[id])return;
    const before=store.results[id],now=Date.now();
    const next={status,message,checkedAt:now};
    store.results[id]=next;store.lastCheckAt=now;
    if(id==='proxy'&&status!=='green')store.snapshot=null;
    if(status==='green')store.lastGood[id]=now;
    if(before?.status!==status&&status!=='gray'){
      store.history.unshift({id,status,at:now,trigger:mode==='manual'?'manual':'automático'});
      store.history=store.history.slice(0,HISTORY_MAX);
    }
    persist();render();return next;
  }
  function configuredUrl(raw){
    try{
      if(typeof raw!=='string'||!raw.trim()||raw.includes('%%'))return '';
      const url=new URL(raw.trim());
      if(url.username||url.password||url.search||url.hash)return '';
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))return '';
      return url.origin;
    }catch(_){return '';}
  }
  function defs(){try{return typeof _DEFAULTS!=='undefined'?_DEFAULTS:{};}catch(_){return {};}}
  function proxyUrl(){
    let local='';try{local=localStorage.getItem('proxy_url')||'';}catch(_){}
    return configuredUrl(local||defs().PROXY_URL||'');
  }
  function workerUrl(id){
    if(id==='printer'){
      try{return configuredUrl(typeof getPrinterTunnel==='function'?getPrinterTunnel():'');}catch(_){return '';}
    }
    if(id==='sii')return configuredUrl(defs().SII_WORKER_URL||'');
    if(id==='leads')return configuredUrl(defs().LEAD_WORKER_URL||'');
    return '';
  }
  function configured(id){
    if(['proxy','airtable','anthropic','openai'].includes(id))return !!proxyUrl();
    if(['sii','printer','leads'].includes(id))return !!workerUrl(id);
    if(id==='calendar'){try{return typeof _calClientId==='function'&&!!configuredClientId(_calClientId());}catch(_){return false;}}
    if(id==='drive'){try{return typeof _driveGetClientId==='function'&&!!configuredClientId(_driveGetClientId());}catch(_){return false;}}
    if(id==='imap'||id==='resend')return typeof MAIL!=='undefined'&&!!MAIL.activeAccount?.();
    if(id==='github')return true;
    if(id==='ads')return typeof loadAdsData==='function'||permitted('web');
    if(id==='meta')return permitted('redes');
    if(id==='wordpress')return permitted('web');
    return false;
  }
  function configuredClientId(value){return !!(value&&typeof value==='string'&&!value.startsWith('%%'));}
  async function getJson(url,options){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
    try{
      const r=await fetch(url,{method:'GET',cache:'no-store',credentials:'omit',...options,signal:controller.signal});
      if(r.status===401||r.status===403)return {status:'yellow',message:'El servicio requiere autorización o permisos',http:r.status};
      if(r.status===429)return {status:'yellow',message:'El servicio limitó temporalmente las solicitudes',http:429};
      if(r.status>=500)return {status:'red',message:'El servidor respondió con un error '+r.status,http:r.status};
      if(!r.ok)return {status:'yellow',message:'La ruta de diagnóstico respondió '+r.status,http:r.status};
      const data=await r.json().catch(()=>null);
      if(!data||typeof data!=='object')return {status:'yellow',message:'Respuesta de diagnóstico no reconocida'};
      return {status:'green',message:'La ruta respondió correctamente',data};
    }catch(e){
      // Una excepción fetch puede ser CORS, DNS o un equipo sin red. No afirmar
      // que el servicio cayó sin una respuesta verificable del servidor.
      return {status:'yellow',message:e?.name==='AbortError'?'La comprobación agotó el tiempo':'No fue posible verificarlo desde este navegador'};
    }finally{clearTimeout(timer);}
  }
  async function probe(id,mode){
    const manual=mode==='manual',u=user();
    if(!u||root._DEMO_MODE)return {status:'gray',message:'Inicia sesión fuera del modo DEMO para diagnosticar'};
    if(id==='proxy'){
      const url=proxyUrl();if(!url)return {status:'gray',message:'Proxy sin URL válida configurada'};
      const r=await getJson(url+'/health');
      if(r.status==='green'&&r.data?.ok===true){store.snapshot=r.data;return {status:'green',message:'Proxy activo; comprueba Airtable por separado'};}
      if(r.status==='green')return {status:'yellow',message:'El proxy respondió, pero no confirmó su estado'};
      return r;
    }
    if(id==='airtable'){
      if(!proxyUrl())return {status:'gray',message:'Configura primero el proxy seguro'};
      if(typeof airtableFetch!=='function')return {status:'gray',message:'La función de lectura CRM aún no está disponible'};
      const scope=['clientes','cotizaciones','pedidos'].find(permitted);
      if(!scope)return {status:'gray',message:'Tu rol no permite una lectura de diagnóstico del CRM'};
      try{
        const table={clientes:'Clientes',cotizaciones:'Cotizaciones',pedidos:'Pedidos'}[scope];
        const data=await airtableFetch(table,1);
        if(data&&Array.isArray(data.records))return {status:'green',message:'Lectura autenticada de Airtable correcta'};
        return {status:'yellow',message:'La respuesta CRM no tiene el formato esperado'};
      }catch(e){return {status:'yellow',message:'La lectura CRM falló. Revisa sesión, proxy y permisos'};}
    }
    if(id==='calendar'){
      if(!configured(id))return {status:'gray',message:'Falta configurar el Google Client ID'};
      if(typeof _calTokenVigente!=='function'||!_calTokenVigente())
        return {status:'gray',message:'Cuenta aún no autorizada en esta sesión'};
      const token=typeof _calAccessToken==='undefined'?'':_calAccessToken;
      if(!token)return {status:'gray',message:'No hay sesión Google disponible'};
      const r=await getJson('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=items(id)',{headers:{Authorization:'Bearer '+token}});
      return r.status==='green'?{status:'green',message:'Google Calendar autoriza lecturas; sincronización no verificada'}:r;
    }
    if(id==='drive'){
      if(!configured(id))return {status:'gray',message:'Falta configurar el Google Client ID'};
      const token=(typeof _driveAccessToken!=='undefined'&&typeof _driveTokenExpiry!=='undefined'&&_driveTokenExpiry>Date.now()+60000)?_driveAccessToken:'';
      if(!token)return {status:'gray',message:'Drive aún no autorizado en esta sesión'};
      const r=await getJson('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',{headers:{Authorization:'Bearer '+token}});
      return r.status==='green'?{status:'green',message:'Google Drive autoriza consultas de archivos'}:r;
    }
    if(id==='imap'){
      if(typeof MAIL==='undefined'||!MAIL.getMailPass?.())return {status:'gray',message:'Abre Correos y autentica la cuenta activa'};
      if(!manual)return {status:'gray',message:'La lectura IMAP se prueba bajo demanda'};
      try{const d=await MAIL.post({action:'folders'});return d&&Array.isArray(d.folders)?{status:'green',message:'IMAP autenticado y carpetas disponibles'}:{status:'yellow',message:'No fue posible leer las carpetas de la cuenta'};}
      catch(_){return {status:'yellow',message:'No se pudo comprobar la cuenta IMAP'};}
    }
    if(id==='resend')return {status:'gray',message:'No se envían correos automáticamente; revisa las entregas en Resend'};
    if(id==='printer'){
      const url=workerUrl('printer');if(!url)return {status:'gray',message:'No hay túnel de impresoras válido'};
      const r=await getJson(url+'/healthz');
      if(r.status==='green'&&r.data?.ok===true)return {status:'green',message:'El bridge confirma salud; cámaras y máquinas se comprueban aparte'};
      if(r.status==='green')return {status:'yellow',message:'El bridge respondió, pero no confirmó /healthz'};
      return r;
    }
    if(id==='sii'){
      const url=workerUrl('sii');if(!url)return {status:'gray',message:'La URL del Worker SII no está configurada'};
      const r=await getJson(url+'/health');
      if(r.status!=='green')return r;
      const d=r.data||{};
      if(d.status!=='ok')return {status:'yellow',message:'El emisor respondió sin confirmar su configuración'};
      if(d.auth!=='on'||!d.rut_emisor_configurado||!d.cert_loaded)
        return {status:'yellow',message:'Worker accesible, pero faltan parámetros de autenticación o certificado'};
      return {status:'green',message:'Worker y credenciales básicas configurados; emisión no probada'};
    }
    if(id==='leads'){
      const url=workerUrl('leads');if(!url)return {status:'gray',message:'La URL del Worker de leads no está configurada'};
      const r=await getJson(url+'/health');
      if(r.status!=='green')return r;
      const d=r.data||{};
      if(d.ok!==true)return {status:'yellow',message:'El Worker respondió sin estado confirmado'};
      return d.airtable===false?{status:'yellow',message:'Worker activo, sin token Airtable configurado'}:{status:'green',message:'Worker activo; captura de leads no probada'};
    }
    if(id==='github'){
      const r=await getJson('https://api.github.com/repos/thelabsolutionscl/dashboardthelabsolutions/actions/workflows/deploy.yml/runs?branch=main&per_page=1',{headers:{Accept:'application/vnd.github+json'}});
      if(r.status!=='green')return r;
      const run=r.data?.workflow_runs?.[0];
      if(!run)return {status:'gray',message:'GitHub respondió sin información de despliegue'};
      if(run.status!=='completed')return {status:'yellow',message:'Hay una publicación en curso'};
      if(run.conclusion!=='success')return {status:'yellow',message:'La última publicación no concluyó correctamente'};
      const version=(DOC?.querySelector('script[src*="operativo-visual.js"]')?.src||'').match(/[?&]v=([0-9a-f]{7,40})/i)?.[1];
      if(version&&run.head_sha&&!run.head_sha.startsWith(version))
        return {status:'yellow',message:'GitHub publicó otra versión; recarga antes de comparar'};
      return {status:'green',message:'Última ejecución de Pages correcta'+(version?' y versión coincidente':' (versión no contrastada)')};
    }
    if(id==='anthropic'||id==='openai'){
      if(!proxyUrl())return {status:'gray',message:'Primero configura el proxy seguro'};
      if(!store.snapshot){const p=await probe('proxy',mode);if(p.status!=='green')return {status:'gray',message:'No se puede comprobar la configuración sin el proxy'};}
      const set=id==='anthropic'?store.snapshot?.anthropic:store.snapshot?.openai;
      return set===true?{status:'yellow',message:'Credencial configurada en el servidor; saldo y validez sin verificar'}:
        {status:'gray',message:'No hay una credencial configurada en el servidor'};
    }
    if(id==='make')return {status:'gray',message:'Sin endpoint de lectura fiable; comprobar el historial en Make'};
    if(id==='ads')return {status:'gray',message:'Revisa la última sincronización y permisos en WEB'};
    if(id==='meta')return {status:'gray',message:'Revisa autorizaciones y métricas en Redes'};
    if(id==='wordpress')return {status:'gray',message:'Revisa WEB y el diagnóstico SEO; la edición no se prueba'};
    return {status:'gray',message:'Aún no dispone de comprobación segura'};
  }
  const pending=new Map();
  function check(id,mode){
    if(!byId[id])return Promise.resolve(null);
    if(pending.has(id))return pending.get(id);
    store.busy.add(id);render();
    const promise=Promise.resolve().then(()=>probe(id,mode)).catch(()=>({status:'yellow',message:'Error inesperado en el diagnóstico'}))
      .then(r=>result(id,r.status,r.message,mode)).finally(()=>{pending.delete(id);store.busy.delete(id);render();});
    pending.set(id,promise);return promise;
  }
  async function sweep(manual){
    if(!user()||root._DEMO_MODE||(!manual&&DOC?.hidden))return;
    if(!manual&&store.lastSweep&&Date.now()-store.lastSweep<FIVE_MIN)return;
    store.lastSweep=Date.now();
    const list=visibleServices().filter(s=>manual||s.auto);
    // Serial para limitar concurrencia, sin ejecutar solicitudes pagadas ni
    // abrir OAuth de fondo. El resto permanece explícitamente "sin verificar".
    for(const s of list){if(!user()||root._DEMO_MODE||(!manual&&DOC?.hidden))break;await check(s.id,manual?'manual':'auto');}
    render();
  }
  function el(tag,className,textValue){
    const n=DOC.createElement(tag);if(className)n.className=className;
    if(textValue!==undefined)n.textContent=textValue;return n;
  }
  function button(labelText,action,id){
    const b=el('button','tls-conn-button',labelText);b.type='button';b.dataset.tlsConn=action;
    if(id)b.dataset.service=id;return b;
  }
  function summary(){
    const items=visibleServices(),c=counts(items),last=store.lastSweep;
    return {total:items.length,green:c.green,yellow:c.yellow,red:c.red,gray:c.gray,last:store.lastCheckAt||last};
  }
  function renderSummary(){
    const box=DOC?.getElementById('tlsConnOverviewMetrics');if(!box)return;
    box.replaceChildren();
    const c=summary();
    [['green','Operativas'],['yellow','Advertencias'],['red','Errores'],['gray','Sin verificar']].forEach(([color,name])=>{
      const cell=el('div','tls-conn-kpi tls-conn-kpi-'+color);
      cell.append(el('strong','',String(c[color])),el('span','',name));box.append(cell);
    });
    const stamp=DOC.getElementById('tlsConnOverviewTime');
    if(stamp)stamp.textContent=c.last?'Última revisión: '+formatTime(c.last):'Aún no se ha ejecutado una revisión';
    const red=DOC.getElementById('tlsConnOverviewAlert');
    if(red){red.hidden=c.red===0;red.textContent=c.red?c.red+' conexión(es) con error confirmado':'';}
  }
  function renderDialog(){
    const dlg=DOC?.getElementById('tlsConnDialog');if(!dlg)return;
    const list=DOC.getElementById('tlsConnServices'),filters=DOC.getElementById('tlsConnFilters'),history=DOC.getElementById('tlsConnHistory');
    if(!list||!filters||!history)return;
    filters.replaceChildren();list.replaceChildren();history.replaceChildren();
    const groups=['Todas',...new Set(visibleServices().map(s=>s.group))];
    groups.forEach(group=>{
      const b=button(group,'filter');b.dataset.group=group;b.classList.toggle('is-active',store.active===group);b.setAttribute('aria-pressed',String(store.active===group));filters.append(b);
    });
    visibleServices().filter(s=>store.active==='Todas'||s.group===store.active).forEach(s=>{
      const r=displayStatus(s.id),item=el('article','tls-conn-service tls-conn-'+r.status),top=el('div','tls-conn-service-top');
      const dot=el('span','tls-conn-light tls-conn-light-'+r.status);dot.setAttribute('aria-hidden','true');
      const title=el('div','tls-conn-service-title');
      title.append(el('strong','',s.name),el('small','',label[r.status]+' · '+r.message));
      top.append(dot,title);
      const info=el('div','tls-conn-service-info');
      info.append(el('span','','Afecta: '+s.impact),el('span','','Comprobado: '+formatTime(r.checkedAt)));
      if(store.lastGood[s.id])info.append(el('span','','Último OK: '+formatTime(store.lastGood[s.id])));
      const actions=el('div','tls-conn-service-actions');
      const test=button('Diagnosticar','check',s.id);test.disabled=store.busy.has(s.id);actions.append(test);
      if(s.oauth&&configured(s.id)){const oauth=button('Reconectar OAuth','oauth',s.id);oauth.disabled=store.busy.has(s.id);actions.append(oauth);}
      const guide=button('Cómo resolver','guide',s.id);actions.append(guide);
      if(permitted(s.page)&&s.page!=='overview')actions.append(button('Ir a '+s.page,'navigate',s.id));
      item.append(top,info,actions);list.append(item);
    });
    if(!store.history.length)history.append(el('p','tls-conn-muted','Todavía no hay cambios de estado registrados en este navegador.'));
    store.history.slice(0,10).forEach(h=>{
      const row=el('div','tls-conn-history-row'),s=byId[h.id];if(!s)return;
      row.append(el('span','tls-conn-light tls-conn-light-'+h.status),el('span','',s.name),el('span','',label[h.status]||''),el('time','',formatTime(h.at)));
      history.append(row);
    });
    const pendingLabel=DOC.getElementById('tlsConnBusy');
    if(pendingLabel)pendingLabel.textContent=store.busy.size?'Comprobando '+store.busy.size+' servicio(s)…':'';
    const all=DOC.getElementById('tlsConnCheckAll');if(all)all.disabled=store.busy.size>0;
  }
  function render(){if(!DOC)return;renderSummary();renderDialog();}
  function mount(){
    if(!DOC||!user()||!permitted('overview'))return;
    const rootPanel=DOC.getElementById('tab-overview'),target=DOC.getElementById('opToday');
    if(!rootPanel||!target)return;
    let panel=DOC.getElementById('tlsConnectionsPanel');
    if(!panel){
      panel=el('section','tls-connections-panel');panel.id='tlsConnectionsPanel';
      panel.innerHTML='<div class="tls-conn-header"><div><span class="tls-conn-eyebrow">MONITOR DEL SISTEMA</span><h2>Centro de conexiones</h2><p>Diagnóstico sin gastos de IA ni escrituras CRM.</p></div><button type="button" class="tls-conn-open" data-tls-conn="open">Abrir centro de diagnóstico ↗</button></div><div class="tls-conn-kpis" id="tlsConnOverviewMetrics"></div><p class="tls-conn-alert" id="tlsConnOverviewAlert" hidden></p><small id="tlsConnOverviewTime">Aún no se ha ejecutado una revisión</small>';
      (target.closest('.card')||target).insertAdjacentElement('afterend',panel);
    }
    if(!DOC.getElementById('tlsConnDialog')){
      const dlg=el('dialog','tls-conn-dialog');dlg.id='tlsConnDialog';dlg.setAttribute('aria-label','Centro de conexiones y diagnóstico');
      dlg.innerHTML='<div class="tls-conn-dialog-head"><div><span class="tls-conn-eyebrow">THE LAB SOLUTIONS</span><h2>Conexiones y diagnóstico</h2><p>Rojo: fallo confirmado. Amarillo: advertencia. Gris: no probado o no configurado.</p></div><button class="tls-conn-close" type="button" data-tls-conn="close" aria-label="Cerrar">✕</button></div><div class="tls-conn-tools"><button type="button" id="tlsConnCheckAll" class="tls-conn-open" data-tls-conn="check-all">Comprobar ahora</button><span id="tlsConnBusy" aria-live="polite"></span></div><nav class="tls-conn-filters" id="tlsConnFilters" aria-label="Filtrar conexiones"></nav><div id="tlsConnServices" class="tls-conn-services"></div><details class="tls-conn-history"><summary>Historial de incidencias de este navegador</summary><div id="tlsConnHistory"></div></details><p class="tls-conn-foot">Los diagnósticos se hacen solo con lecturas autorizadas. Los fallos de red/CORS no se confunden con una caída confirmada. Las claves nunca se muestran ni se guardan aquí.</p><section class="tls-conn-guide" id="tlsConnGuide" hidden><button type="button" data-tls-conn="close-guide" aria-label="Cerrar ayuda">✕</button><h3 id="tlsConnGuideTitle"></h3><p id="tlsConnGuideBody"></p></section>';
      DOC.body.append(dlg);
    }
    // Un cambio de usuario no debe enseñar resultados/historial de otra sesión.
    const key=stateKey();
    if(store.userKey!==key){
      store.userKey=key;store.results={};store.history=[];store.lastGood={};
      store.snapshot=null;store.lastSweep=0;store.lastCheckAt=0;store.active='Todas';restore();
    }
    if(!store.mounted)store.mounted=true;
    render();
    startMonitoring();
  }
  function startMonitoring(){
    // Puede iniciarse después de DOMContentLoaded si el login fue asíncrono.
    if(store.autoStarted||!user()||root._DEMO_MODE)return;
    store.autoStarted=true;
    setTimeout(()=>{if(!DOC.hidden&&user())void sweep(false);},1300);
    setInterval(()=>{if(!DOC.hidden&&permitted('overview'))void sweep(false);},FIVE_MIN);
    DOC.addEventListener('visibilitychange',()=>{
      if(!DOC.hidden&&Date.now()-store.lastSweep>=FIVE_MIN)void sweep(false);
    });
  }
  function open(){
    mount();
    const dlg=DOC?.getElementById('tlsConnDialog');if(!dlg)return;
    renderDialog();
    if(!dlg.open)dlg.showModal();
  }
  function guide(id){
    const s=byId[id];if(!s)return;open();
    const node=DOC.getElementById('tlsConnGuide');if(!node)return;
    DOC.getElementById('tlsConnGuideTitle').textContent=s.name;
    DOC.getElementById('tlsConnGuideBody').textContent=s.guide;
    node.hidden=false;node.scrollIntoView({block:'nearest'});
  }
  async function reconnect(id){
    if(!user()||root._DEMO_MODE)return;
    try{
      if(id==='calendar'&&typeof _calGetToken==='function'){
        // Invocar OAuth inmediatamente desde el clic (gesto requerido por Google).
        const tokenPromise=_calGetToken();await tokenPromise;await check(id,'manual');return;
      }
      if(id==='drive'&&typeof _driveGetToken==='function'){
        const tokenPromise=_driveGetToken();await tokenPromise;await check(id,'manual');return;
      }
      guide(id);
    }catch(_){
      result(id,'yellow','La autorización no se completó. Revisa la cuenta y vuelve a intentar','manual');guide(id);
    }
  }
  function bootstrap(){
    if(!DOC)return;
    mount();
  }
  const api={catalog,counts,displayStatus,configuredUrl,formatTime,mount,open,check,sweep,summary,probe,result,getJson};
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
  root.TLSConnections=api;
  DOC?.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-tls-conn]');if(!b)return;
    const action=b.dataset.tlsConn,id=b.dataset.service;
    if(action==='open')open();
    if(action==='close')DOC.getElementById('tlsConnDialog')?.close();
    if(action==='check')void check(id,'manual');
    if(action==='check-all')void sweep(true);
    if(action==='oauth')void reconnect(id);
    if(action==='guide')guide(id);
    if(action==='close-guide')DOC.getElementById('tlsConnGuide').hidden=true;
    if(action==='filter'){store.active=b.dataset.group;renderDialog();}
    if(action==='navigate'&&byId[id]&&permitted(byId[id].page)&&typeof switchTab==='function'){
      DOC.getElementById('tlsConnDialog')?.close();switchTab(byId[id].page);
    }
  });
  // El JS se añade desde operativo-visual.js, que ya lleva el hash del build.
  // Usar la misma versión en CSS evita mezclar interfaces entre despliegues.
  if(DOC?.currentScript?.src){
    const script=new URL(DOC.currentScript.src),style=new URL('operativo-conexiones.css',script);
    if(script.searchParams.has('v'))style.searchParams.set('v',script.searchParams.get('v'));
    if(!DOC.getElementById('tlsConStyles')){
      const link=el('link');link.id='tlsConStyles';link.rel='stylesheet';link.href=style.href;DOC.head?.append(link);
    }
  }
  if(DOC?.readyState==='loading')DOC.addEventListener('DOMContentLoaded',bootstrap,{once:true});
  else bootstrap();
})(typeof window!=='undefined'?window:globalThis);
