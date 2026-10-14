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
  const pretty=v=>{if(!iso(v))return 'Por confirmar';const d=new Date(v.slice(0,10)+'T12:00:00');return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'})+(v.includes('T')?' · '+v.slice(11,16)+' h':'');};
  const allowedUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/^(?:www\.)?(?:sercotec\.cl|corfo\.cl|corfo\.gob\.cl|fondos\.gob\.cl)$/.test(u.hostname);}catch{return false;}};
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
  let funds=[],error='',updated='',mode='todos',selected='',inFlight=null,busy=false;
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
  function render(){
    const root=document.getElementById('fondosList');
    if(!root)return;
    const msg=document.getElementById('fondosStatus');
    if(msg)msg.textContent=error||('Catálogo revisado: '+(updated||'sin fecha')+' · '+funds.length+' programas · solo fechas verificadas. No garantiza cobertura de todas las convocatorias.');
    const check=document.getElementById('fondosShowOnCalendar');
    if(check)try{check.checked=localStorage.getItem(KEY)!=='false';}catch{check.checked=true;}
    const filter=document.getElementById('fondosFiltro');
    if(filter)filter.value=mode;
    const shown=funds.filter(f=>mode==='todos'||(mode==='sin-fechas'?pending(f):
      mode==='proximos'?(!pending(f)&&(!f.close||f.close.slice(0,10)>=today())):
      mode==='cerrados'&&hasDate(f)&&!!f.close&&f.close.slice(0,10)<today()));
    if(!shown.length){
      root.innerHTML='<div class="empty-state">No hay convocatorias verificadas en este filtro. Revisa las fuentes oficiales y los programas con fechas por confirmar.</div>';
    }else root.innerHTML=shown.map(f=>'<article class="fondos-row"><div class="fondos-row-main">'+
      '<b>'+esc(f.name)+'</b><span class="fondos-tag">'+esc(status(f))+'</span>'+
      '<small>'+esc(f.organizer)+' · '+esc(f.region)+' · '+esc(f.fit)+'</small>'+
      '<small>🟢 Apertura: '+esc(pretty(f.open))+' &nbsp; 🔴 Cierre: '+esc(pretty(f.close))+'</small>'+
      '<small>'+esc(f.fitReason)+'</small>'+
      '</div><div class="fondos-actions">'+
      (iso(f.open)?'<button type="button" class="btn btn-ghost btn-sm" data-fondos-calendar="'+esc(f.id)+'" data-fondos-phase="open">🟢 Ver apertura</button>':'')+
      (iso(f.close)?'<button type="button" class="btn btn-ghost btn-sm" data-fondos-calendar="'+esc(f.id)+'" data-fondos-phase="close">🔴 Ver cierre</button>':'')+
      link(f.info,'Fuente oficial')+
      '<button type="button" class="btn btn-ghost btn-sm" data-fondos-open="'+esc(f.id)+'">Ver requisitos</button>'+
      '<button type="button" class="btn btn-primary btn-sm" data-fondos-draft="'+esc(f.id)+'">🤖 Preparar postulación</button>'+
      '</div></article>').join('');
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
    container.innerHTML='<h3>'+esc(f.name)+'</h3><p>'+esc(f.fitReason)+'</p>'+
      '<p><b>Organismo:</b> '+esc(f.organizer)+' · '+esc(f.region)+'</p>'+
      '<p><b>Posible compatibilidad:</b> '+esc(f.fit)+'</p>'+
      '<p><b>Apertura:</b> '+esc(pretty(f.open))+' · <b>Cierre:</b> '+esc(pretty(f.close))+'</p>'+
      '<p><b>Requisitos por revisar:</b> '+esc(f.requirements)+'</p>'+
      '<p><b>Respaldo:</b> '+esc(f.verified)+'</p>'+
      '<p>'+link(f.source,'Consultar bases / fuente oficial')+'</p>'+
      '<p class="fondos-warning">Los datos deben confirmarse en la convocatoria vigente. TLS no se considera automáticamente elegible.</p>';
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
    root.addEventListener('click',e=>{
      const goto=e.target.closest('[data-fondos-calendar]');
      if(goto){goTo(goto.dataset.fondosCalendar,goto.dataset.fondosPhase);return;}
      const openButton=e.target.closest('[data-fondos-open]');
      if(openButton){open(openButton.dataset.fondosOpen);return;}
      const draftButton=e.target.closest('[data-fondos-draft]');
      if(draftButton){prepare(draftButton.dataset.fondosDraft);}
    });
    const filter=document.getElementById('fondosFiltro');
    if(filter)filter.addEventListener('change',()=>{mode=filter.value;render();});
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
  window.TLSFondos={load,render,eventList,open,prepare,draft,copyDraft,status,clean,iso,allDates,goTo,goToClosest,renderCalendarSummary,notifyToday};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
