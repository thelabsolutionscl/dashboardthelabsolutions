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
  const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(v)&&
    !Number.isNaN(new Date(v.slice(0,10)+'T12:00:00').getTime())?v.slice(0,10):'';
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const pretty=v=>{if(!iso(v))return 'Por confirmar';const d=new Date(v.slice(0,10)+'T12:00:00');return d.toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'})+(v.includes('T')?' · '+v.slice(11,16)+' h':'');};
  const allowedUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/^(?:www\.)?(?:sercotec\.cl|corfo\.cl|fondos\.gob\.cl)$/.test(u.hostname);}catch{return false;}};
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
      '</div><div class="fondos-actions">'+link(f.info,'Fuente oficial')+
      '<button type="button" class="btn btn-ghost btn-sm" data-fondos-open="'+esc(f.id)+'">Ver requisitos</button>'+
      '<button type="button" class="btn btn-primary btn-sm" data-fondos-draft="'+esc(f.id)+'">🤖 Preparar postulación</button>'+
      '</div></article>').join('');
    const select=document.getElementById('fondosConvocatoria');
    if(select){const keep=select.value||selected;select.innerHTML='<option value="">Selecciona un fondo</option>'+
      funds.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name)+'</option>').join('');
      select.value=byId(keep)?keep:'';selected=select.value;}
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
        render();if(typeof window.renderCalendario==='function')window.renderCalendario();
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
    const f=byId(id);
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
  }
  window.TLSFondos={load,render,eventList,open,prepare,draft,copyDraft,status,clean,iso};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
