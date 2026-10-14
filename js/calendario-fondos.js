/* Fondos Concursables TLS — agenda de aperturas/cierres verificados y copiloto de postulación.
 * Solo datos públicos curados. No escribe en Airtable ni envía postulaciones.
 * Fechas ISO Chile: se representan por día local para evitar corrimientos UTC.
 */
(function(){
  'use strict';
  if(window.TLSFondos)return;
  const KEY='thelab_fondos_mostrar_v1';
  const SOURCE='data/fondos-concursables.json';
  const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const iso=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(v))return '';
    const [y,m,d]=v.slice(0,10).split('-').map(Number),t=new Date(y,m-1,d,12);
    if(t.getFullYear()!==y||t.getMonth()+1!==m||t.getDate()!==d)return '';
    if(v.length>10&&(Number(v.slice(11,13))>23||Number(v.slice(14,16))>59))return '';
    return v.slice(0,10);
  };
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const pretty=v=>{if(!iso(v))return 'Por confirmar';const d=new Date(v.slice(0,10)+'T12:00:00');return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'})+(v.includes('T')&&v.slice(11,16)!=='00:00'?' · '+v.slice(11,16)+' h':'');};
  const allowedUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/^(?:www\.)?(?:sercotec\.cl|corfo\.cl|corfo\.gob\.cl|fondos\.gob\.cl|prochile\.gob\.cl|startupchile\.org)$/.test(u.hostname);}catch{return false;}};
  const clean=f=>{
    if(!f||typeof f!=='object'||!/^[a-z0-9-]{3,90}$/.test(f.id||'')||typeof f.name!=='string'||!allowedUrl(f.source))return null;
    const begin=iso(f.open),end=iso(f.close);
    if(begin&&end&&begin>end)return null;
    return {id:f.id,name:f.name.slice(0,180),organizer:String(f.organizer||'').slice(0,80),
      region:String(f.region||'').slice(0,100),category:String(f.category||'').slice(0,100),
      fit:String(f.fit||'Por evaluar').slice(0,120),fitReason:String(f.fitReason||'').slice(0,650),
      open:begin?String(f.open):'',close:end?String(f.close):'',
      source:f.source,info:allowedUrl(f.info)?f.info:f.source,
      verified:String(f.verified||'').slice(0,550),requirements:String(f.requirements||'').slice(0,900)};
  };
  let funds=[],error='',updated='',mode='todos',selected='',inFlight=null,busy=false,searchTerm='';
  // DEMO independiente: solo UI local, nunca toca catálogos, eventos ni avisos.
  let demoMode=false,demoStep='inicio';
  const demoISO=days=>{
    const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+days);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+'T12:00';
  };
  function toggleDemo(){demoMode=!demoMode;demoStep='inicio';render();}
  function demoIllustration(){
    const opening=pretty(demoISO(3)),closing=pretty(demoISO(17));
    const screens={
      inicio:'<div class="fondos-demo-screen"><div class="fondos-demo-icon">◎</div><h4>Recorre el radar sin comprometer datos</h4><p>Selecciona una opción para ver qué ocurre al encontrar un fondo, revisar sus plazos, recibir una alerta o preparar su postulación.</p><small>Todos los proyectos, fechas y textos son inventados.</small></div>',
      requisitos:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">01 / REQUISITOS</div><h4>Evaluación de compatibilidad</h4><p><strong>Fondo ficticio:</strong> Innovación en fabricación 3D.</p><p><strong>Posible encaje:</strong> Desarrollo de nuevos procesos de impresión.</p><p><strong>Por comprobar:</strong> antigüedad tributaria, ventas, inversión, cofinanciamiento y mérito innovador.</p><small>En un concurso real se consultan siempre las bases oficiales.</small></div>',
      fechas:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">02 / CALENDARIO</div><h4>Así se ven las fechas verificadas</h4><div class="fondos-demo-dates"><div><small>🟢 Apertura simulada</small><b>'+esc(opening)+'</b></div><div><small>🟠 Cierre simulado</small><b>'+esc(closing)+'</b></div></div><p>Cuando existe un plazo oficial, aparece en el Calendario. Estos días de ejemplo <strong>no se incorporan</strong> a la agenda real.</p></div>',
      alerta:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">03 / AVISOS</div><h4>Ejemplo de aviso a gerencia</h4><div class="fondos-demo-email"><span>✉ Correo simulado</span><b>🟢 Abre hoy: Innovación para TLS</b><small>Destinatarios de ejemplo: Gustavo y Nicanor</small><p>Revisa requisitos, monto y bases antes de iniciar la postulación.</p></div><small>Vista previa local. No se utiliza Cloudflare, Resend ni las casillas reales.</small></div>',
      borrador:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">04 / ASISTENTE</div><h4>Cómo ayuda el agente de postulaciones</h4><p><strong>Pregunta de ejemplo:</strong> ¿Qué mejora propone el proyecto?</p><div class="fondos-demo-email"><span>✦ Borrador ilustrativo</span><p>Proponemos investigar y validar una mejora en los procesos de fabricación digital mediante prototipos y pruebas medibles.</p></div><p><strong>Datos pendientes:</strong> presupuesto, equipo, evidencia técnica y calendario.</p><small>Respuesta prediseñada: no se llama al motor IA ni se envía un formulario.</small></div>'
    };
    const steps=[['requisitos','◇ Ver requisitos'],['fechas','▦ Ver calendario'],['alerta','✉ Simular aviso'],['borrador','✦ Ver borrador']];
    return '<section class="fondos-demo-panel" aria-label="Demo interactiva de fondos TLS">'+
      '<div class="fondos-demo-top"><div><span class="fondos-demo-label">◈ MODO DEMO · SIMULACIÓN</span><h3>Prueba cada función con un fondo ficticio.</h3><p>Los datos reales siguen intactos. No se crean eventos, no se manda correo y no se envían postulaciones.</p></div><button type="button" data-fondos-demo-toggle class="fondos-demo-exit">↩ Volver al radar real</button></div>'+
      '<div class="fondos-demo-steps" role="group" aria-label="Escenas de la demostración">'+steps.map(([key,label])=>'<button type="button" data-fondos-demo-step="'+key+'" aria-pressed="'+(demoStep===key?'true':'false')+'" class="'+(demoStep===key?'active':'')+'">'+label+'</button>').join('')+'</div>'+
      '<div class="fondos-demo-stage">'+screens[demoStep]+'</div>'+
      '<p class="fondos-demo-footnote">Los nombres y plazos mostrados en DEMO son simulados. Ningún evento, notificación o solicitud será real.</p>'+
    '</section>';
  }
  const byId=id=>funds.find(f=>f.id===id);
  const hasDate=f=>!!(f.open||f.close);
  const pending=f=>!hasDate(f);
  const status=f=>{
    const now=today();
    if(!hasDate(f))return 'Sin fechas publicadas';
    if(f.close&&f.close.slice(0,10)<now)return 'Cerrado';
    if(f.open&&f.open.slice(0,10)>now)return 'Próximamente';
    if(f.open&&f.open.slice(0,10)<=now&&(!f.close||f.close.slice(0,10)>=now))return 'Posiblemente abierto · verificar';
    return 'Por confirmar';
  };
  // Avisos persistentes del dashboard al usuario autenticado: Gustavo y Nicanor.
  // El envío POR CORREO corre 24/7 en lead-worker y no depende de esta pestaña.
  function notifyToday(){
    const n=typeof NOTIFY!=='undefined'?NOTIFY:null;
    if(!n||typeof n.priority!=='function'||typeof n.persona!=='function')return 0;
    const who=n.persona();
    if(who!=='gustavo'&&who!=='nicanor')return 0;
    // Chile continental: el calendario sigue usando fechas locales, pero las
    // notificaciones de fondos se evalúan exclusivamente en America/Santiago.
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const field=name=>parts.find(x=>x.type===name)?.value||'';
    const day=[field('year'),field('month'),field('day')].join('-');
    let count=0;
    for(const f of funds){
      for(const [phase,name] of [['open','Apertura'],['close','Cierre']]){
        if(iso(f[phase])!==day)continue;
        const key='fondos:'+who+':'+f.id+':'+phase+':'+day;
        try{if(localStorage.getItem(key)==='1')continue;}catch(_){}
        const title=(phase==='open'?'🟢 Abre hoy: ':'🔴 Cierra hoy: ')+f.name;
        const detail=name+' a las '+f[phase].slice(11,16)+' h (Chile) · Revisa las bases oficiales antes de postular.';
        if(n.priority('info',title,detail,'calendario',{
          personas:['gustavo','nicanor'],
          tone:phase==='close'?'warning':'info',key
        })){
          count++;
          try{localStorage.setItem(key,'1');}catch(_){}
        }
      }
    }
    return count;
  }
  function eventList(){
    let on=true;try{on=localStorage.getItem(KEY)!=='false';}catch{}
    if(!on)return [];
    return funds.flatMap(f=>[["open","fondo_inicio","🟢 Abre"],["close","fondo_cierre","🔴 Cierra"]]
      .filter(([field])=>iso(f[field]))
      .map(([field,type,prefix])=>({
        id:'fondo-'+f.id+'-'+field,source:'fondos',type,fecha:iso(f[field]),
        titulo:prefix+' · '+f.name,desc:f.verified,personas:[],allDay:true,
        color:field==='open'?'#3dbd92':'#e69b55',fundId:f.id,phase:field,
        risk:'normal',gcal:{}
      })));
  }
  /* Los hitos son eventos virtuales con fecha oficial. Los fondos sin fecha
     se muestran al pie de la grilla, nunca sobre una fecha inventada. */
  function allDates(){
    return funds.flatMap(f=>['open','close']
      .filter(phase=>!!iso(f[phase]))
      .map(phase=>({id:f.id,phase,fecha:iso(f[phase]),name:f.name}))
    ).sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.name.localeCompare(b.name));
  }
  function goTo(id,phase){
    const f=byId(id);
    const fecha=f&&iso(f[phase]);
    if(!fecha)return false;
    // Un enlace explícito a la fecha habilita de nuevo los hitos, incluso si
    // estaban ocultos localmente, para evitar un calendario aparentemente vacío.
    try{localStorage.setItem(KEY,'true');}catch(_){}
    const check=document.getElementById('fondosShowOnCalendar');
    if(check)check.checked=true;
    if(typeof window.calIrAFondoFecha!=='function')return false;
    return window.calIrAFondoFecha(fecha);
  }
  function goToClosest(){
    const dates=allDates(),now=today();
    const closest=dates.find(d=>d.fecha>=now)||dates[dates.length-1];
    return closest?goTo(closest.id,closest.phase):false;
  }
  function renderCalendarSummary(){
    const summary=document.getElementById('fondosCalendarioResumen');
    const unknown=document.getElementById('fondosCalendarioSinFecha');
    const dates=allDates();
    const month=typeof _calMes!=='undefined'&&_calMes instanceof Date
      ?String(_calMes.getFullYear())+'-'+String(_calMes.getMonth()+1).padStart(2,'0')
      :today().slice(0,7);
    const thisMonth=dates.filter(d=>d.fecha.startsWith(month));
    const undated=funds.filter(pending);
    const closest=dates.find(d=>d.fecha>=today())||dates[dates.length-1];
    let on=true;try{on=localStorage.getItem(KEY)!=='false';}catch(_){}
    if(summary){
      if(!funds.length){summary.innerHTML='<span>🏛 Cargando fechas de fondos concursables…</span>';}
      else{
        const label=new Date(month+'-01T12:00:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'});
        summary.innerHTML='<div class="fondos-cal-summary-text"><b>🏛 Fondos concursables</b> <span>'+
          esc(on?(thisMonth.length?thisMonth.length+' hitos en '+label:'Sin aperturas ni cierres confirmados en '+label):'Visualización desactivada')+
          ' · '+dates.length+' fechas confirmadas · '+undated.length+' programas por anunciar</span></div>'+
          (closest?'<button class="btn btn-ghost btn-sm" type="button" data-fondos-calendar="'+esc(closest.id)+'" data-fondos-phase="'+closest.phase+'">'+
            (closest.fecha>=today()?'📅 Ir a la próxima fecha':'📅 Ver último hito registrado')+'</button>':'');
      }
    }
    if(unknown){
      if(!funds.length||!undated.length){unknown.innerHTML='';return;}
      unknown.innerHTML='<div class="fondos-undated-title">📌 Programas sin fecha oficial confirmada <small>(no se ubican en un día hasta que se publiquen las bases)</small></div>'+
        '<div class="fondos-undated-items">'+undated.map(f=>
          '<button type="button" class="fondos-undated-chip" data-fondos-open="'+esc(f.id)+'">'+esc(f.name)+' · Fecha por confirmar</button>'
        ).join('')+'</div>';
    }
  }
  const link=(url,label)=>allowedUrl(url)?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>':'';
  const radarIds=new Set(['corfo-semilla-inicia-nueva-vigilar','corfo-semilla-expande-nueva-vigilar','corfo-crea-y-valida-proxima-vigilar','startupchile-big-proximo-vigilar']);
  const compact=txt=>String(txt||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function tone(f){
    const s=status(f);
    if(pending(f))return 'seguimiento';
    if(s==='Cerrado')return 'cerrado';
    if(s==='Próximamente')return 'proximo';
    return 'abierto';
  }
  function countFor(f){return compact([f.name,f.organizer,f.region,f.category,f.fit,f.fitReason].join(' '));}
  function applySearch(){
    const root=document.getElementById('fondosList');
    if(!root||typeof root.querySelectorAll!=='function')return;
    const q=compact(searchTerm.trim());
    let visible=0;
    root.querySelectorAll('[data-fondos-card]').forEach(node=>{
      const item=byId(node.dataset.fondosCard);
      const matches=!!item&&(!q||countFor(item).includes(q));
      node.hidden=!matches;
      if(matches)visible++;
    });
    const count=root.querySelector('[data-fondos-count]');
    if(count)count.textContent=visible+' '+(visible===1?'oportunidad':'oportunidades')+' visibles';
    const empty=root.querySelector('[data-fondos-no-match]');
    if(empty)empty.hidden=visible!==0;
  }
  function render(){
    const root=document.getElementById('fondosList');
    if(!root)return;
    const msg=document.getElementById('fondosStatus');
    if(msg)msg.textContent=error||('Fuentes oficiales revisadas el '+(updated||'día pendiente de confirmar')+'. Las fechas y la elegibilidad se validan contra las bases de cada llamado.');
    const check=document.getElementById('fondosShowOnCalendar');
    if(check)try{check.checked=localStorage.getItem(KEY)!=='false';}catch{check.checked=true;}
    const filter=document.getElementById('fondosFiltro');
    if(filter)filter.value=mode;
    const now=today();
    const watch=funds.filter(pending).length;
    const future=funds.filter(f=>!!iso(f.open)&&iso(f.open)>=now).length;
    const historical=funds.filter(f=>hasDate(f)&&f.close&&f.close.slice(0,10)<now).length;
    const shown=funds.filter(f=>mode==='todos'||(mode==='sin-fechas'?pending(f):
      mode==='proximos'?(!pending(f)&&(!f.close||f.close.slice(0,10)>=now)):
      mode==='cerrados'&&hasDate(f)&&!!f.close&&f.close.slice(0,10)<now));
    const ordered=shown.slice().sort((a,b)=>{
      const rank=f=>radarIds.has(f.id)?0:tone(f)==='abierto'?1:tone(f)==='proximo'?2:pending(f)?3:4;
      const difference=rank(a)-rank(b);
      if(difference)return difference;
      if(tone(a)==='cerrado'&&tone(b)==='cerrado')return (b.close||'').localeCompare(a.close||'');
      return a.name.localeCompare(b.name,'es');
    });
    const groups=[['todos','Todos'],['sin-fechas','En seguimiento'],['proximos','Con fechas próximas'],['cerrados','Históricos']];
    const chips=groups.map(([value,title])=>
      '<button type="button" class="fondos-filter-pill'+(mode===value?' is-active':'')+
      '" data-fondos-view="'+value+'" aria-pressed="'+(mode===value?'true':'false')+'">'+esc(title)+'</button>'
    ).join('');
    const card=f=>{
      const stage=tone(f),dating=!pending(f),restricted=/no elegible|no apto|baja|indirecta/i.test(f.fit);
      const title=status(f)==='Sin fechas publicadas'?'Por anunciar':status(f)==='Cerrado'?'Finalizado':status(f)==='Próximamente'?'Próxima apertura':'Revisar vigencia';
      const label=radarIds.has(f.id)?'VIGILANCIA PRIORITARIA':f.category;
      const acronym=String(f.organizer||'TLS').split(/[\s/]+/).filter(Boolean).map(x=>x[0]).join('').slice(0,2).toUpperCase();
      const dates=dating?
        '<div class="fondos-date-strip" aria-label="Fechas de la convocatoria">'+
          '<div class="fondos-date fondos-date--open"><small>● Apertura</small><b>'+esc(pretty(f.open))+'</b>'+
            (iso(f.open)?'<button type="button" class="fondos-inline-jump" data-fondos-calendar="'+esc(f.id)+'" data-fondos-phase="open">Ver en calendario ↗</button>':'')+
          '</div><div class="fondos-date fondos-date--close"><small>● Cierre</small><b>'+esc(pretty(f.close))+'</b>'+
            (iso(f.close)?'<button type="button" class="fondos-inline-jump" data-fondos-calendar="'+esc(f.id)+'" data-fondos-phase="close">Ver en calendario ↗</button>':'')+
          '</div></div>':
        '<div class="fondos-date-strip"><div class="fondos-date fondos-date--unknown"><small>Próximo llamado</small><b>Fechas por confirmar en fuente oficial</b></div></div>';
      return '<article class="fondos-row" data-status="'+stage+'" data-fondos-card="'+esc(f.id)+'">'+
        '<div class="fondos-row-main">'+
          '<div class="fondos-card-top"><span class="fondos-card-org"><span class="fondos-org-icon" aria-hidden="true">'+esc(acronym)+'</span><span>'+esc(f.organizer)+'</span></span>'+
          '<span class="fondos-status" data-tone="'+stage+'">'+esc(title)+'</span></div>'+
          '<div class="fondos-eyebrow">'+esc(label)+'</div>'+
          '<h3 class="fondos-card-name">'+esc(f.name)+'</h3>'+
          '<div class="fondos-card-meta">⌖ '+esc(f.region)+'</div>'+
          '<div class="fondos-fit" data-tone="'+(restricted?'restricted':'normal')+'"><span class="fondos-fit-icon" aria-hidden="true">'+(restricted?'◇':'✦')+'</span><span><strong>Encaje estimado:</strong> '+esc(f.fit)+'</span></div>'+
          '<p class="fondos-card-summary">'+esc(f.fitReason)+'</p>'+dates+
        '</div>'+
        '<div class="fondos-actions">'+
          '<button type="button" class="btn btn-ghost btn-sm" data-fondos-open="'+esc(f.id)+'">Ver detalles</button>'+
          link(f.info,'↗ Fuente oficial')+
          '<button type="button" class="btn btn-primary btn-sm" data-fondos-draft="'+esc(f.id)+'">✦ Preparar borrador</button>'+
        '</div></article>';
    };
    root.innerHTML='<div class="fondos-tls'+(demoMode?' is-demo':'')+'">'+
      '<section class="fondos-hero" aria-label="Radar de oportunidades TLS">'+
        '<div><div class="fondos-eyebrow"><span class="fondos-live-dot" aria-hidden="true"></span> THE LAB SOLUTIONS · OPPORTUNITY RADAR</div>'+
          '<h2 class="fondos-title">'+(demoMode?'Explora TLS en <span>modo DEMO.</span>':'Oportunidades para <span>seguir creciendo.</span>')+'</h2>'+
          '<p class="fondos-lead">Fondos, innovación y programas para impulsar nuevos proyectos de TLS. Encuentra lo que vale la pena revisar, mira fechas oficiales y prepara tu postulación con ayuda del asistente.</p>'+
          '<div class="fondos-hero-chips"><span class="fondos-micro fondos-micro--cyan">'+(demoMode?'◈ ENTORNO DE PRUEBA':'✓ Fechas respaldadas')+'</span><span class="fondos-micro">◷ Seguimiento continuo</span><span class="fondos-micro">✦ Asistente IA</span></div>'+ 
          '<div class="fondos-demo-hero-action"><button type="button" data-fondos-demo-toggle class="fondos-demo-button" aria-pressed="'+(demoMode?'true':'false')+'">'+(demoMode?'↩ Salir de DEMO':'▶ DEMO · Ver funcionamiento')+'</button></div>'+
        '</div>'+
        '<div class="fondos-kpis" aria-label="Resumen de programas">'+
          '<div class="fondos-kpi fondos-kpi--focus"><b>'+funds.length+'</b><small>Programas en radar</small></div>'+
          '<div class="fondos-kpi fondos-kpi--attention"><b>'+watch+'</b><small>Por anunciar</small></div>'+
          '<div class="fondos-kpi"><b>'+future+'</b><small>Con apertura futura verificada</small></div>'+
          '<div class="fondos-kpi"><b>'+historical+'</b><small>Convocatorias cerradas</small></div>'+
        '</div>'+
      '</section>'+ 
      (demoMode?demoIllustration():'')+
      '<div class="fondos-toolbar">'<div class="fondos-filter-pills" role="group" aria-label="Filtrar convocatorias">'+chips+'</div>'+
        '<label class="fondos-search-wrap"><span class="fondos-search-icon" aria-hidden="true">⌕</span><input type="search" id="fondosBuscar" autocomplete="off" aria-label="Buscar por programa, institución o categoría" placeholder="Buscar fondo, organismo o proyecto…" value="'+esc(searchTerm)+'"></label></div>'+
      '<div class="fondos-list-header"><b>Explora las oportunidades</b><span data-fondos-count>'+ordered.length+' oportunidades visibles</span></div>'+
      '<div class="fondos-grid">'+ordered.map(card).join('')+'</div>'+
      '<div class="fondos-empty" data-fondos-no-match'+(ordered.length?' hidden':'')+'><strong>No encontramos resultados en esta vista</strong>Prueba otra categoría o cambia el texto de búsqueda.</div>'+
      '<p class="fondos-summary-footnote">El encaje con TLS es orientativo, no significa aprobación ni elegibilidad. Sin fecha oficial publicada, el programa queda en seguimiento y no genera alertas de apertura o cierre. <span aria-hidden="true">·</span> Catálogo actualizado: '+esc(updated||'sin fecha')+'.</p>'+
    '</div>';
    applySearch();
    const select=document.getElementById('fondosConvocatoria');
    if(select){const keep=select.value||selected;select.innerHTML='<option value="">Selecciona un fondo</option><option value="otro">Otra convocatoria (manual)</option>'+
      funds.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('');
      select.value=byId(keep)||keep==='otro'?keep:'';selected=select.value;}
    renderCalendarSummary();
  }
  async function load(){
    if(inFlight)return inFlight;
    inFlight=(async()=>{
      try{
        const response=await fetch(new URL(SOURCE,document.baseURI),{cache:'no-store'});
        if(!response.ok)throw Error('No se pudo cargar el catálogo');
        const data=await response.json();
        if(!Array.isArray(data.funds)||data.schema!==1)throw Error('Formato de catálogo inválido');
        const fresh=data.funds.map(clean).filter(Boolean),ids=new Set();
        funds=fresh.filter(f=>{if(ids.has(f.id))return false;ids.add(f.id);return true;});
        updated=String(data.reviewedAt||'');
        error='';
        render();notifyToday();if(typeof window.renderCalendario==='function')window.renderCalendario();
      }catch(e){error='No se pudo actualizar el catálogo de fondos. '+String(e.message||e);render();}
    })().finally(()=>{inFlight=null;});
    return inFlight;
  }
  function open(id){
    const match=/^fondo-(.*)-(open|close)$/.exec(id||'');
    const f=byId(match?match[1]:id);
    if(!f)return;
    const modal=document.getElementById('fondosDetalleModal');
    const container=document.getElementById('fondosDetalleBody');
    if(!modal||!container)return;
    container.innerHTML='<div class="fondos-detail-shell">'+
      '<div class="fondos-eyebrow"><span class="fondos-live-dot" aria-hidden="true"></span>'+esc(f.organizer)+' · TLS FUNDING RADAR</div>'+
      '<h3 class="fondos-detail-title">'+esc(f.name)+'</h3>'+
      '<p class="fondos-detail-lead">'+esc(f.fitReason)+'</p>'+
      '<div class="fondos-detail-grid">'+
        '<div class="fondos-detail-cell"><small>Estado</small><b>'+esc(status(f))+'</b></div>'+
        '<div class="fondos-detail-cell"><small>Encaje estimado</small><b>'+esc(f.fit)+'</b></div>'+
        '<div class="fondos-detail-cell"><small>Apertura</small><b>'+esc(pretty(f.open))+'</b></div>'+
        '<div class="fondos-detail-cell"><small>Cierre</small><b>'+esc(pretty(f.close))+'</b></div>'+
      '</div>'+
      '<div class="fondos-detail-section"><h4>Lo que debes verificar antes de postular</h4><p>'+esc(f.requirements)+'</p></div>'+
      '<div class="fondos-detail-section"><h4>Respaldo y territorio</h4><p>'+esc(f.region)+'. '+esc(f.verified)+'</p></div>'+
      '<div class="fondos-detail-section"><h4>Información oficial</h4><p>'+link(f.source,'↗ Abrir fuente y bases del organismo')+'</p></div>'+
      '<p class="fondos-warning">Los antecedentes y fechas se deben confirmar en las bases del nuevo llamado. La empresa no se considera elegible automáticamente.</p>'+
    '</div>';
    const b=document.getElementById('fondosDetallePreparar');if(b)b.dataset.fondosDraft=f.id;
    modal.style.display='flex';
  }
  function close(){const m=document.getElementById('fondosDetalleModal');if(m)m.style.display='none';}
  function prepare(id){
    const f=byId(id);if(!f)return;
    close();selected=f.id;mode='todos';render();
    const select=document.getElementById('fondosConvocatoria');if(select)select.value=f.id;
    document.getElementById('fondosCopiloto')?.scrollIntoView({behavior:'smooth',block:'center'});
    document.getElementById('fondosPreguntas')?.focus();
  }
  async function draft(){
    if(busy)return;
    const id=document.getElementById('fondosConvocatoria')?.value;
    const typed=(document.getElementById('fondosOtroFondo')?.value||'').trim();
    const f=id==='otro'&&typed.length>=5?{name:typed.slice(0,200),organizer:'Por identificar',source:'No proporcionada',verified:'Convocatoria ingresada manualmente: revisar bases originales.',open:'',close:'',requirements:'Verificar requisitos y antecedentes de la convocatoria original.'}:byId(id);
    const questions=(document.getElementById('fondosPreguntas')?.value||'').trim();
    const evidence=(document.getElementById('fondosAntecedentes')?.value||'').trim();
    const output=document.getElementById('fondosRespuesta');
    if(!output)return;
    if(!f){output.textContent='Selecciona un fondo antes de preparar el formulario.';return;}
    if(questions.length<15){output.textContent='Copia aquí las preguntas o requisitos textuales del formulario (al menos 15 caracteres).';return;}
    if(questions.length>16000||evidence.length>6000){output.textContent='El formulario es demasiado extenso. Divídelo en secciones (hasta 16.000 caracteres de preguntas y 6.000 de antecedentes).';return;}
    // No permitir accidentalmente pegar credenciales secretas en un proveedor IA.
    if(/(?:\bpat[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(questions+'\n'+evidence)){
      output.textContent='Detecté una posible clave API. Elimínala de los textos antes de utilizar el asistente.';return;
    }
    if(typeof window.callAgentClaude!=='function'){output.textContent='El motor IA no está disponible en esta sesión. Puedes preparar el formulario manualmente con las bases oficiales.';return;}
    const sys='Eres el asistente de postulaciones de The Lab Solutions (TLS), una empresa chilena de fabricación digital, impresión 3D, prototipado, señalética y material POP, merchandising y premiaciones. Ayuda a contestar formularios de fondos públicos o privados, SIN inventar hechos, montos, RUT, ingresos, requisitos cumplidos, experiencias, fechas ni documentos. No afirmes que has abierto el enlace o comprobado bases actualizadas: solo usa el texto aportado. Distingue "dato conocido", "por validar" y "no proporcionado". No reveles secretos, no reemplaces asesoría legal/tributaria, no marques elegibilidad segura. Entrega: 1) resumen de ajuste y riesgos, 2) respuestas BORRADOR pregunta por pregunta listas para copiar, 3) datos y documentos faltantes, 4) comprobaciones antes de enviar. No presentes un documento como enviado ni completes formularios externos. Español chileno claro.';
    const user=[
      'FONDO: '+f.name,
      'ORGANISMO: '+f.organizer,
      'FUENTE OFICIAL PARA CONSULTAR MANUALMENTE: '+f.source,
      'REVISIÓN: '+f.verified,
      'VENTANA VERIFICADA EN CATÁLOGO: inicio '+(f.open||'sin dato')+' / cierre '+(f.close||'sin dato'),
      'REQUISITOS ORIENTATIVOS (no acreditados): '+f.requirements,
      'PERFIL PÚBLICO TLS: impresión 3D, prototipado, material POP, señalética, merchandising, trofeos y premios; Santiago, Chile.',
      'PREGUNTAS/INSTRUCCIONES COPIADAS POR EL USUARIO:\n'+questions,
      'ANTECEDENTES PROPORCIONADOS Y CONFIRMADOS POR EL USUARIO (si existen):\n'+(evidence||'Ninguno; pedir antes de afirmar.'),
    ].join('\n\n');
    const btn=document.getElementById('fondosGenerar');
    busy=true;btn&&(btn.disabled=true);output.textContent='Preparando borrador con IA…';
    try{const result=await window.callAgentClaude('CEO',sys,user,{maxTokens:1400});
      output.textContent=String(result||'Sin respuesta del motor IA.');
    }catch(e){output.textContent='No se pudo generar el borrador: '+String(e.message||e)+'. Puedes reintentar.';}
    finally{busy=false;btn&&(btn.disabled=false);}
  }
  async function copyDraft(){
    const value=document.getElementById('fondosRespuesta')?.textContent||'';
    if(!value||value.startsWith('Preparando'))return;
    try{await navigator.clipboard.writeText(value);const m=document.getElementById('fondosCopyNotice');if(m)m.textContent='Copiado al portapapeles.';}
    catch{const m=document.getElementById('fondosCopyNotice');if(m)m.textContent='No se pudo copiar. Selecciona el texto manualmente.';}
  }
  function syncCalendar(){
    try{localStorage.setItem(KEY,document.getElementById('fondosShowOnCalendar')?.checked?'true':'false');}catch{}
    if(typeof window.renderCalendario==='function')window.renderCalendario();
  }
  function init(){
    const root=document.getElementById('tab-calendario');if(!root)return;
    if(typeof document.createElement==='function'&&document.head&&!document.getElementById('fondosTlsStyles')){
      const sheet=document.createElement('link');
      sheet.rel='stylesheet';sheet.id='fondosTlsStyles';
      sheet.href=new URL('fondos-tls.css?v=20261014demo',document.baseURI).href;
      document.head.appendChild(sheet);
    }
    root.addEventListener('click',e=>{
      if(e.target.closest('[data-fondos-demo-toggle]')){toggleDemo();return;}
      const scene=e.target.closest('[data-fondos-demo-step]');
      if(scene&&demoMode){demoStep=scene.dataset.fondosDemoStep;render();return;}
      const quick=e.target.closest('[data-fondos-view]');
      if(quick){mode=quick.dataset.fondosView;render();return;}
      const goto=e.target.closest('[data-fondos-calendar]');
      if(goto){goTo(goto.dataset.fondosCalendar,goto.dataset.fondosPhase);return;}
      const openButton=e.target.closest('[data-fondos-open]');
      if(openButton){open(openButton.dataset.fondosOpen);return;}
      const draftButton=e.target.closest('[data-fondos-draft]');
      if(draftButton){prepare(draftButton.dataset.fondosDraft);}
    });
    const filter=document.getElementById('fondosFiltro');
    if(filter)filter.addEventListener('change',()=>{mode=filter.value;render();});
    document.getElementById('fondosList')?.addEventListener('input',e=>{
      if(e.target.id==='fondosBuscar'){searchTerm=e.target.value;applySearch();}
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&document.getElementById('fondosDetalleModal')?.style.display==='flex')close();
    });
    document.getElementById('fondosShowOnCalendar')?.addEventListener('change',syncCalendar);
    document.getElementById('fondosReload')?.addEventListener('click',load);
    document.getElementById('fondosGenerar')?.addEventListener('click',draft);
    document.getElementById('fondosCopiar')?.addEventListener('click',copyDraft);
    document.getElementById('fondosCerrarDetalle')?.addEventListener('click',close);
    document.getElementById('fondosDetalleModal')?.addEventListener('click',e=>{if(e.target.id==='fondosDetalleModal')close();});
    render();
    load();
    // Ventana abierta durante horas: recordar nuevas aperturas y cierres.
    setInterval(notifyToday,15*60*1000);
  }
  window.TLSFondos={load,render,eventList,open,prepare,draft,copyDraft,status,clean,iso,allDates,goTo,goToClosest,renderCalendarSummary,notifyToday,toggleDemo,isDemo:()=>demoMode};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
