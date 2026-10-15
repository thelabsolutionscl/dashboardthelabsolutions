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
  // Un día de apertura/cierre siempre corresponde a Chile, no a la zona del equipo.
  const today=()=>{
    const pieces=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part=k=>pieces.find(x=>x.type===k)?.value||'';
    return [part('year'),part('month'),part('day')].join('-');
  };
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
  let funds=[],error='',updated='',mode='todos',selected='',inFlight=null,busy=false,searchTerm='',draftReady=false,draftFor='';
  // DEMO independiente: solo UI local, nunca toca catálogos, eventos ni avisos.
  let demoMode=false,demoStep='inicio',demoRunId=0;
  const DEMO_QUESTION='TLS quiere evaluar un proyecto piloto para mejorar el prototipado y la impresión 3D. ¿Qué debería incluir en una postulación a un fondo de innovación y qué antecedentes faltan?';
  let demoAgent={status:'idle',prompt:DEMO_QUESTION,result:'',error:'',source:''};
  // No cambia los fondos del calendario ni produce notificaciones; la IA genera SOLO un borrador.
  function demoLocalAnswer(prompt){
    const words=compact(prompt);
    const focus=/impresi[oó]n 3d|prototip|fabricaci[oó]n|pl[aá]/i.test(words)?'fabricación digital y prototipado':
      /merchand|se[nñ]al|trofeo|acril/i.test(words)?'señalética, merchandising y fabricación publicitaria':'el proyecto descrito';
    return [
      'EVALUACIÓN DE EJEMPLO — SIMULACIÓN LOCAL (NO IA)',
      '',
      'Proyecto descrito: '+prompt,
      '',
      '1. Posible enfoque: formular un piloto verificable sobre '+focus+', con objetivos, beneficiarios, actividades y resultados medibles.',
      '2. Comprobar antes de postular: bases vigentes, organismo, fecha, innovación exigida, antigüedad de la empresa, ventas, cofinanciamiento y gastos admisibles.',
      '3. Datos que faltan: presupuesto y cotizaciones, indicadores de éxito, equipo, capacidad instalada, evidencia técnica y documentos tributarios.',
      '4. Próximo paso sugerido: reunir las bases del fondo real y sus preguntas. Preparar respuestas únicamente con antecedentes confirmados.',
      '',
      'Esto no es una evaluación de elegibilidad ni una postulación enviada.'
    ].join('\n');
  }
  function demoAgentPanel(){
    const working=demoAgent.status==='working',done=demoAgent.status==='done',failed=demoAgent.status==='error';
    const badge=working?'AGENTE PROCESANDO':done?(demoAgent.source==='ia'?'AGENTE IA · RESPUESTA OBTENIDA':'SIMULACIÓN LOCAL · SIN IA'):failed?'AGENTE NO DISPONIBLE':'PRUEBA EL AGENTE';
    const stage=working?
      '<div class="fondos-agent-working" role="status" aria-live="polite" aria-busy="true"><div class="fondos-agent-orbit" aria-hidden="true"><span>✦</span></div><div><b>El agente TLS está procesando tu solicitud…</b><p>Analizando el proyecto, identificando requisitos y preparando una respuesta.</p><div class="fondos-agent-work-steps"><span>Revisión del proyecto</span><span>Encaje y riesgos</span><span>Borrador de respuesta</span></div></div></div>':
      done?'<div class="fondos-demo-agent-result" role="status" aria-live="polite"><b>✓ Análisis finalizado</b><span class="fondos-demo-agent-source">'+esc(demoAgent.source==='ia'?'Respuesta generada por IA':'Procesamiento local de ejemplo (no IA)')+'</span><pre>'+esc(demoAgent.result)+'</pre><button type="button" class="fondos-demo-copy" data-fondos-demo-copy>📋 Copiar resultado</button></div>':
      failed?'<div class="fondos-demo-agent-error" role="alert"><strong>No se pudo completar la consulta a la IA.</strong><p>'+esc(demoAgent.error)+'</p><button type="button" data-fondos-demo-run-local>Probar simulación local sin IA</button></div>':
      '<p class="fondos-demo-agent-hint">Escribe un caso sobre un proyecto de TLS y ejecútalo. El resultado dependerá de tu solicitud.</p>';
    return '<div class="fondos-demo-screen fondos-demo-agent-screen"><div class="fondos-demo-eyebrow">04 / AGENTE DE POSTULACIONES · '+badge+'</div>'+
      '<h4>Agente de fondos TLS</h4><p>Prueba un análisis de innovación. En modo DEMO nunca se enviarán formularios ni se generarán fechas o alertas.</p>'+
      '<label for="fondosDemoPregunta" class="fondos-demo-agent-label">Describe el proyecto o lo que quieres preparar</label>'+
      '<textarea id="fondosDemoPregunta" maxlength="1500" rows="3" placeholder="Describe tu proyecto de ejemplo…" '+(working?'disabled aria-disabled="true"':'')+'>'+esc(demoAgent.prompt)+'</textarea>'+
      '<div class="fondos-demo-agent-controls"><button type="button" class="fondos-demo-agent-run" data-fondos-demo-run '+(working?'disabled aria-disabled="true"':'')+'>'+(working?'◌ Agente procesando…':'✦ Ejecutar análisis con agente')+'</button>'+
      '<small>Ejemplo editable · No usar información confidencial.</small><span id="fondosDemoCopyNotice" aria-live="polite"></span></div>'+
      stage+
    '</div>';
  }
  async function runDemoAgent(forceLocal=false){
    if(!demoMode||demoAgent.status==='working')return false;
    const raw=String(document.getElementById('fondosDemoPregunta')?.value??demoAgent.prompt).trim();
    if(raw.length<18||raw.length>1500){
      demoAgent={...demoAgent,status:'error',error:'Describe un proyecto de entre 18 y 1.500 caracteres.',prompt:raw};
      render();return false;
    }
    if(/(?:\bpat[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(raw)){
      demoAgent={...demoAgent,status:'error',error:'Detecté una posible clave de acceso. Retírala antes de continuar.',prompt:raw};
      render();return false;
    }
    const id=++demoRunId;
    demoAgent={status:'working',prompt:raw,result:'',error:'',source:''};
    demoStep='borrador';
    render(); // Pintar el agente y spinner ANTES de llamar a cualquier API.
    try{
      let answer='',source='ia';
      if(forceLocal||typeof window.callAgentClaude!=='function'){
        source='local';
        // Es una transformación local real del texto escrito, señalada siempre como simulación.
        await new Promise(resolve=>setTimeout(resolve,650));
        answer=demoLocalAnswer(raw);
      }else{
        const sys='Eres un agente demostrativo para postulaciones de The Lab Solutions en Chile. Estás en MODO DEMO y trabajas con un proyecto hipotético. Responde en español chileno, concreto, con 4 apartados: Idea y ajuste potencial, riesgos de elegibilidad, borrador editable, antecedentes faltantes. No inventes convocatorias reales, fechas, requisitos comprobados, montos, ventas ni documentos. No afirmes haber revisado bases ni enviado solicitudes.';
        const user='ANÁLISIS DE PRUEBA, NO POSTULACIÓN REAL. Proyecto de ejemplo:\n'+raw+'\n\nDevuelve un borrador breve, con datos a confirmar.';
        answer=String(await window.callAgentClaude('CEO',sys,user,{maxTokens:900})||'').trim();
        if(!answer)throw new Error('El motor respondió sin contenido.');
      }
      if(id!==demoRunId||!demoMode)return false;
      demoAgent={...demoAgent,status:'done',source,result:answer};
      render();
      return true;
    }catch(e){
      if(id!==demoRunId||!demoMode)return false;
      demoAgent={...demoAgent,status:'error',error:String(e?.message||e||'Error de conexión.').slice(0,280),source:'ia'};
      render();return false;
    }
  }
  function toggleDemo(){
    demoMode=!demoMode;demoRunId++;
    workspaceRunId++;workspaceBusy=false;
    if(workspaceResult.status==='working')workspaceResult={status:'idle',source:'',text:'',error:''};
    demoStep=demoMode?'borrador':'inicio';
    demoAgent={status:'idle',prompt:DEMO_QUESTION,result:'',error:'',source:''};
    render();
    if(demoMode)void runDemoAgent();
  }
  const demoISO=days=>{
    const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+days);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+'T12:00';
  };
  function demoIllustration(){
    const opening=pretty(demoISO(3)),closing=pretty(demoISO(17));
    const screens={
      inicio:'<div class="fondos-demo-screen"><div class="fondos-demo-icon">◎</div><h4>Recorre el radar sin comprometer datos</h4><p>Selecciona una opción para ver qué ocurre al encontrar un fondo, revisar sus plazos, recibir una alerta o preparar su postulación.</p><small>Todos los proyectos, fechas y textos son inventados.</small></div>',
      requisitos:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">01 / REQUISITOS</div><h4>Evaluación de compatibilidad</h4><p><strong>Fondo ficticio:</strong> Innovación en fabricación 3D.</p><p><strong>Posible encaje:</strong> Desarrollo de nuevos procesos de impresión.</p><p><strong>Por comprobar:</strong> antigüedad tributaria, ventas, inversión, cofinanciamiento y mérito innovador.</p><small>En un concurso real se consultan siempre las bases oficiales.</small></div>',
      fechas:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">02 / CALENDARIO</div><h4>Así se ven las fechas verificadas</h4><div class="fondos-demo-dates"><div><small>🟢 Apertura simulada</small><b>'+esc(opening)+'</b></div><div><small>🟠 Cierre simulado</small><b>'+esc(closing)+'</b></div></div><p>Cuando existe un plazo oficial, aparece en el Calendario. Estos días de ejemplo <strong>no se incorporan</strong> a la agenda real.</p></div>',
      alerta:'<div class="fondos-demo-screen"><div class="fondos-demo-eyebrow">03 / AVISOS</div><h4>Ejemplo de aviso a gerencia</h4><div class="fondos-demo-email"><span>✉ Correo simulado</span><b>🟢 Abre hoy: Innovación para TLS</b><small>Destinatarios de ejemplo: Gustavo y Nicanor</small><p>Revisa requisitos, monto y bases antes de iniciar la postulación.</p></div><small>Vista previa local. No se utiliza Cloudflare, Resend ni las casillas reales.</small></div>',
      borrador:demoAgentPanel()
    };
    const steps=[['requisitos','◇ Ver requisitos'],['fechas','▦ Ver calendario'],['alerta','✉ Simular aviso'],['borrador','✦ Ejecutar agente']];
    return '<section class="fondos-demo-panel" aria-label="Demo interactiva de fondos TLS">'+
      '<div class="fondos-demo-top"><div><span class="fondos-demo-label">◈ MODO DEMO · SIMULACIÓN</span><h3>El agente procesa un proyecto de ejemplo, y puedes recorrer las demás funciones.</h3><p>Los datos reales siguen intactos. No se crean eventos, no se manda correo y no se envían postulaciones.</p></div><button type="button" data-fondos-demo-toggle class="fondos-demo-exit">↩ Volver al radar real</button></div>'+
      '<div class="fondos-demo-steps" role="group" aria-label="Escenas de la demostración">'+steps.map(([key,label])=>'<button type="button" data-fondos-demo-step="'+key+'" aria-pressed="'+(demoStep===key?'true':'false')+'" class="'+(demoStep===key?'active':'')+'">'+label+'</button>').join('')+'</div>'+
      '<div class="fondos-demo-stage">'+screens[demoStep]+'</div>'+
      '<p class="fondos-demo-footnote">Los nombres y plazos mostrados en DEMO son simulados. Ningún evento, notificación o solicitud será real.</p>'+
    '</section>';
  }

  // Mesa de trabajo: solo preferencias y casillas manuales del navegador, no información tributaria.
  const FLOW_STORAGE='thelab_fondos_mesa_v1';
  const FLOW_STAGES=new Set(['seguimiento','evaluando','preparando','postulado','descartado']);
  const FLOW_CHECKS=[
    ['bases','Leí las bases de la convocatoria vigente'],
    ['empresa','Revisé antigüedad, ventas y condiciones tributarias'],
    ['proyecto','Definí objetivos, innovación y resultados medibles'],
    ['finanzas','Revisé presupuesto, cofinanciamiento y gastos permitidos'],
    ['documentos','Identifiqué documentos y cotizaciones necesarios'],
    ['formulario','Tengo las preguntas del formulario original'],
    ['plazos','Confirmé apertura y cierre en la fuente oficial']
  ];
  let tracked={},workspaceId='',workspaceBrief='',workspaceBusy=false,workspaceRunId=0;
  let workspaceResult={status:'idle',source:'',text:'',error:''},visibleLimit=8;
  function trackKey(){
    let person='local';
    try{
      const notice=typeof NOTIFY!=='undefined'?NOTIFY:null;
      const value=notice?.persona?.();
      if(value==='gustavo'||value==='nicanor')person=value;
    }catch(_){}
    return FLOW_STORAGE+':'+person;
  }
  function readTracked(){
    try{
      const data=JSON.parse(localStorage.getItem(trackKey())||'{}');
      if(!data||typeof data!=='object'||Array.isArray(data))return {};
      return Object.fromEntries(Object.entries(data).slice(0,100).filter(([id,v])=>
        /^[a-z0-9-]{3,90}$/.test(id)&&v&&typeof v==='object'
      ).map(([id,v])=>[id,{
        stage:FLOW_STAGES.has(v.stage)?v.stage:'seguimiento',
        checks:Array.isArray(v.checks)?v.checks.filter(x=>FLOW_CHECKS.some(y=>y[0]===x)):[],
        watching:v.watching!==false
      }]));
    }catch(_){return {};}
  }
  function saveTracked(){
    try{localStorage.setItem(trackKey(),JSON.stringify(tracked));}catch(_){}
  }
  function trackFund(id){
    if(!byId(id))return false;
    if(tracked[id]?.watching){delete tracked[id];if(workspaceId===id){workspaceRunId++;workspaceBusy=false;workspaceId='';workspaceBrief='';workspaceResult={status:'idle',source:'',text:'',error:''};}}
    else tracked[id]={stage:'seguimiento',checks:tracked[id]?.checks||[],watching:true};
    saveTracked();render();return !!tracked[id]?.watching;
  }
  function openWorkspace(id){
    if(!byId(id))return false;
    if(workspaceId!==id){
      workspaceRunId++;
      workspaceBusy=false;
      workspaceBrief='';
      workspaceResult={status:'idle',source:'',text:'',error:''};
    }
    workspaceId=id;
    if(!tracked[id])tracked[id]={stage:'seguimiento',checks:[],watching:true};
    saveTracked();
    render();
    document.getElementById('fondosMesa')?.scrollIntoView?.({behavior:'smooth',block:'start'});
    return true;
  }
  function stageFund(id,next){
    if(!byId(id)||!FLOW_STAGES.has(next)||!tracked[id])return false;
    tracked[id].stage=next;saveTracked();render();return true;
  }
  function toggleFlowCheck(id,key,checked){
    if(!byId(id)||!tracked[id]||!FLOW_CHECKS.some(x=>x[0]===key))return false;
    const current=new Set(tracked[id].checks||[]);
    if(checked)current.add(key);else current.delete(key);
    tracked[id].checks=[...current];saveTracked();render();return true;
  }
  function fundWindow(f){
    const d=today(),opening=iso(f.open),closing=iso(f.close);
    if((opening&&!closing)||(!opening&&closing))return {tone:'watch',label:'Fechas incompletas',reason:'No está confirmada toda la ventana del concurso. Revisar la fuente antes de considerarlo disponible.'};
    if(!opening&&!closing)return {tone:'watch',label:'Sin fecha oficial',reason:'No hay nueva apertura confirmada. Seguir noticias y revisar bases cuando se publique un llamado.'};
    if(closing&&closing<d)return {tone:'closed',label:'Convocatoria cerrada',reason:'Esta edición ya cerró. Sus fechas quedan solo como referencia histórica.'};
    if(opening&&opening>d)return {tone:'future',label:'Apertura programada',reason:'Fecha incluida en catálogo oficial; validar condiciones y cambios antes de postular.'};
    if(opening&&opening<=d&&(!closing||closing>=d))return {tone:'window',label:'Dentro de ventana publicada',reason:'La ventana registrada incluye hoy, pero es obligatorio confirmar vigencia y bases en la fuente oficial.'};
    return {tone:'watch',label:'Fechas por validar',reason:'Revisar la fuente oficial antes de tomar decisiones.'};
  }
  function offlinePlan(f,idea){
    const missing=FLOW_CHECKS.filter(([key])=>!tracked[f.id]?.checks?.includes(key)).map(([,label])=>'• '+label);
    return [
      'GUÍA DE TRABAJO — GENERADA EN EL NAVEGADOR (NO IA)',
      'Fondo: '+f.name,
      'Situación: '+fundWindow(f).label+'. '+fundWindow(f).reason,
      '',
      'PROYECTO PROPUESTO:',
      idea||'Aún no has descrito el proyecto de TLS.',
      '',
      'COMPATIBILIDAD ORIENTATIVA:',
      f.fit+'. '+f.fitReason,
      '',
      'VERIFICAR ANTES DE POSTULAR:',
      f.requirements,
      '',
      'TAREAS PENDIENTES (según casillas marcadas manualmente):',
      ...(missing.length?missing:['• Todas las casillas están marcadas; de todos modos verifica la convocatoria vigente.']),
      '',
      'PRÓXIMO PASO: abrir las bases oficiales, copiar las preguntas del llamado real y preparar respuestas con datos comprobados.',
      'No es confirmación de elegibilidad ni una postulación enviada.'
    ].join('\n');
  }
  async function workspaceAnalyze(forceLocal=false){
    const f=byId(workspaceId);
    if(!f||workspaceBusy||demoMode)return false;
    const idea=String(document.getElementById('fondosMesaIdea')?.value??workspaceBrief).trim();
    if(idea.length<20){
      workspaceBrief=idea;
      workspaceResult={status:'error',source:'',text:'',error:'Describe tu proyecto en al menos 20 caracteres para generar un análisis útil.'};
      render();return false;
    }
    if(idea.length>3000){
      workspaceResult={status:'error',source:'',text:'',error:'Resume el proyecto a un máximo de 3.000 caracteres.'};
      render();return false;
    }
    if(/(?:\bpat[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/.test(idea)){
      workspaceResult={status:'error',source:'',text:'',error:'Detecté una posible clave privada. Retírala antes de continuar.'};render();return false;
    }
    workspaceBrief=idea;
    const id=++workspaceRunId;
    workspaceBusy=true;
    workspaceResult={status:'working',source:'',text:'',error:''};
    render();
    try{
      let textResult,source='ia';
      if(forceLocal||typeof window.callAgentClaude!=='function'){
        source='local';
        textResult=offlinePlan(f,idea);
      }else{
        const system='Eres asesor de postulaciones de The Lab Solutions (fabricación digital, señalética, impresión 3D) en Chile. Usa SOLO los datos proporcionados, sin inventar bases, fechas, ventas, montos, requisitos cumplidos, ingresos ni elegibilidad. No digas que revisaste internet. Responde en español sencillo con 1) Resumen de proyecto, 2) Encaje potencial y límites, 3) Requisitos a comprobar en bases oficiales, 4) Texto borrador editable, 5) Lista concreta de antecedentes pendientes y próxima acción. No envíes postulación ni prometas financiamiento.';
        const user='CONVOCATORIA DEL CATÁLOGO (NO VERIFICADA EN VIVO):\n'+f.name+'\nOrganismo: '+f.organizer+'\nVentana: '+(f.open||'Sin fecha')+' a '+(f.close||'Sin fecha')+'\nEncaje orientativo: '+f.fitReason+'\nRequisitos preliminares: '+f.requirements+'\n\nDESCRIPCIÓN DEL PROYECTO ESCRITA POR EL USUARIO:\n'+idea+'\n\nEl usuario debe validar todos los requisitos en la fuente oficial.';
        textResult=String(await window.callAgentClaude('CEO',system,user,{maxTokens:1200})||'').trim();
        if(!textResult)throw new Error('La IA no entregó texto.');
      }
      if(id!==workspaceRunId||workspaceId!==f.id||demoMode)return false;
      workspaceBusy=false;workspaceResult={status:'done',source,text:textResult,error:''};render();return true;
    }catch(e){
      if(id!==workspaceRunId||workspaceId!==f.id||demoMode)return false;
      workspaceBusy=false;workspaceResult={status:'error',source:'',text:'',error:String(e?.message||e).slice(0,300)};render();return false;
    }finally{
      if(id===workspaceRunId)workspaceBusy=false;
    }
  }
  function workspaceHtml(){
    const f=byId(workspaceId);
    const count=Object.keys(tracked).filter(id=>tracked[id]?.watching&&byId(id)).length;
    if(!f){
      return '<section id="fondosMesa" class="fondos-workspace fondos-workspace-empty" aria-label="Mesa de trabajo de fondos">'+
        '<div class="fondos-workspace-intro"><span class="fondos-eyebrow">01 · DECIDIR Y PREPARAR</span><h3>Un fondo a la vez. Un plan claro.</h3>'+
        '<p>Elige <strong>Revisar para TLS</strong> en una oportunidad para ver sus condiciones, marcar antecedentes pendientes y trabajar un borrador. El seguimiento se guarda solo en este navegador.</p></div>'+
        '<span class="fondos-workspace-count">'+count+' en mi seguimiento</span></section>';
    }
    const win=fundWindow(f),record=tracked[f.id]||{stage:'seguimiento',checks:[]};
    const checked=record.checks||[];
    const stageLabels={seguimiento:'Por revisar',evaluando:'Revisando requisitos',preparando:'Preparando borrador',postulado:'Enviado (marcado manualmente)',descartado:'Descartado'};
    const status=workspaceResult.status;
    const result=status==='working'?'<div class="fondos-workspace-working" role="status" aria-live="polite" aria-busy="true"><span class="fondos-mini-spinner" aria-hidden="true"></span><span><strong>Agente TLS procesando tu proyecto…</strong><small>Evaluando el caso y preparando pasos concretos</small></span></div>':
      status==='done'?'<div class="fondos-workspace-output" role="status"><b>✓ Plan preparado · '+(workspaceResult.source==='ia'?'Generado con IA':'Guía local sin IA')+'</b><pre>'+esc(workspaceResult.text)+'</pre><button type="button" class="fondos-outline-action" data-fondos-work-copy>Copiar plan</button><span id="fondosWorkCopyNote" aria-live="polite"></span></div>':
      status==='error'?'<div class="fondos-workspace-error" role="alert"><b>No se completó el análisis</b><p>'+esc(workspaceResult.error)+'</p><button type="button" class="fondos-outline-action" data-fondos-work-local>Crear guía local sin IA</button></div>':'';
    return '<section id="fondosMesa" class="fondos-workspace" aria-label="Mesa de trabajo de '+esc(f.name)+'">'+
      '<div class="fondos-workspace-heading"><div><div class="fondos-eyebrow">MI MESA DE TRABAJO · 3 PASOS</div><h3>'+esc(f.name)+'</h3><span class="fondos-workspace-agency">'+esc(f.organizer)+' · '+esc(f.region)+'</span></div>'+
        '<button type="button" class="fondos-outline-action" data-fondos-work-close>✕ Cerrar ficha</button></div>'+
      '<div class="fondos-workspace-window" data-tone="'+win.tone+'"><strong>'+esc(win.label)+'</strong><span>'+esc(win.reason)+'</span></div>'+
      '<div class="fondos-workspace-steps">'+
        '<div class="fondos-workspace-step"><div class="fondos-step-index">01</div><h4>¿Conviene postular?</h4><p>'+esc(f.fit)+' · '+esc(f.fitReason)+'</p><p class="fondos-workspace-req"><b>Requisitos que debes verificar:</b> '+esc(f.requirements)+'</p>'+
          '<div class="fondos-workspace-sources">'+link(f.source,'↗ Bases y fuente oficial')+(f.info!==f.source?' · '+link(f.info,'↗ Ficha del organismo'):'')+'</div>'+
          '<label for="fondosMesaEtapa">Estado que marca TLS (manual)</label><select id="fondosMesaEtapa" aria-label="Estado de seguimiento">'+Object.entries(stageLabels).map(([val,l])=>'<option value="'+val+'"'+(record.stage===val?' selected':'')+'>'+l+'</option>').join('')+'</select>'+
          '<small>El estado es una anotación local; no significa que la institución haya aceptado una solicitud.</small>'+
        '</div>'+
        '<div class="fondos-workspace-step"><div class="fondos-step-index">02</div><h4>¿Qué falta reunir?</h4><p>Marca solo lo que hayas revisado realmente. <b>'+checked.length+' de '+FLOW_CHECKS.length+'</b> controles completados manualmente.</p>'+
          '<div class="fondos-workspace-meter" role="progressbar" aria-valuenow="'+checked.length+'" aria-valuemin="0" aria-valuemax="'+FLOW_CHECKS.length+'" aria-label="Antecedentes revisados"><span style="width:'+(checked.length/FLOW_CHECKS.length*100).toFixed(0)+'%"></span></div>'+
          '<div class="fondos-workspace-checks">'+FLOW_CHECKS.map(([key,label])=>'<label><input type="checkbox" data-fondos-work-check="'+key+'"'+(checked.includes(key)?' checked':'')+'><span>'+esc(label)+'</span></label>').join('')+'</div>'+
          '<small>Son recordatorios generales; la lista vinculante está en las bases oficiales.</small>'+
        '</div>'+
        '<div class="fondos-workspace-step fondos-workspace-agent"><div class="fondos-step-index">03</div><h4>Preparar con el agente</h4><p>Describe qué quieres financiar o desarrollar. Generaremos un plan o un borrador sin suponer que cumples las bases.</p>'+
          '<label for="fondosMesaIdea">Tu proyecto o necesidad</label><textarea id="fondosMesaIdea" rows="5" maxlength="3000" placeholder="Ej.: Queremos desarrollar y validar un nuevo proceso de producción que reduzca tiempos y desperdicio en impresiones 3D…">'+esc(workspaceBrief)+'</textarea>'+
          '<div class="fondos-workspace-agent-actions"><button type="button" class="fondos-main-action" data-fondos-work-analyze'+(workspaceBusy?' disabled':'')+'>'+(workspaceBusy?'✦ Procesando…':'✦ Analizar con IA')+'</button>'+
            '<button type="button" class="fondos-outline-action" data-fondos-work-form>Preparar respuestas del formulario</button></div>'+
          '<small>La IA redacta borradores; no completa ni envía formularios. Copia las preguntas reales en el copiloto.</small>'+result+
        '</div>'+
      '</div>'+
    '</section>';
  }
  function prepareFromWorkspace(){
    const f=byId(workspaceId);if(!f)return false;
    const existing=document.getElementById('fondosPreguntas');
    // No completar preguntas ficticias: la IA debe recibir texto REAL del formulario.
    // Dar una instrucción visible; un placeholder no se envía al servicio de IA.
    if(existing&&!existing.value.trim()){
      existing.placeholder='Copia aquí las preguntas TEXTUALES del formulario oficial. Si todavía no existen, revisa primero las bases del organismo.';
    }
    const notes=document.getElementById('fondosAntecedentes');
    if(notes&&!notes.value.trim()&&workspaceBrief.trim())notes.value=workspaceBrief.trim();
    prepare(f.id);
    return true;
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
    const windowInfo=fundWindow(f).tone;
    return windowInfo==='closed'?'cerrado':windowInfo==='future'?'proximo':windowInfo==='window'?'abierto':'seguimiento';
  }
  function countFor(f){return compact([f.name,f.organizer,f.region,f.category,f.fit,f.fitReason].join(' '));}
  function applySearch(){
    const root=document.getElementById('fondosList');
    if(!root||typeof root.querySelectorAll!=='function')return;
    const q=compact(searchTerm.trim());
    let total=0,visible=0;
    root.querySelectorAll('[data-fondos-card]').forEach(node=>{
      const item=byId(node.dataset.fondosCard);
      const matches=!!item&&(!q||countFor(item).includes(q));
      if(matches){total++;if(total<=visibleLimit)visible++;}
      node.hidden=!matches||total>visibleLimit;
    });
    const count=root.querySelector('[data-fondos-count]');
    if(count)count.textContent=total===0?'0 oportunidades visibles':visible+' de '+total+' oportunidades visibles';
    const empty=root.querySelector('[data-fondos-no-match]');
    if(empty){
      empty.hidden=total!==0;
      if(!total)empty.innerHTML=mode==='mios'&&!q?
        '<strong>Aún no sigues fondos</strong>Usa ☆ Seguir o Revisar para TLS para comenzar.':
        '<strong>No hay resultados en esta vista</strong>Prueba otra categoría o modifica la búsqueda.';
    }
    const more=root.querySelector('[data-fondos-more]');
    if(more){more.hidden=total<=visibleLimit;more.textContent='Ver '+Math.min(8,total-visibleLimit)+' oportunidades más ↓';}
  }
  function render(){
    const root=document.getElementById('fondosList');
    if(!root)return;
    const msg=document.getElementById('fondosStatus');
    if(msg)msg.textContent=error||('Fuentes oficiales revisadas el '+(updated||'día pendiente de confirmar')+'. Las fechas y la elegibilidad se validan contra las bases de cada llamado.');
    const check=document.getElementById('fondosShowOnCalendar');
    if(check)try{check.checked=localStorage.getItem(KEY)!=='false';}catch{check.checked=true;}
    const filter=document.getElementById('fondosFiltro');
    if(filter&&Array.from(filter.options||[]).some(x=>x.value===mode))filter.value=mode;
    const now=today();
    const watch=funds.filter(f=>fundWindow(f).tone==='watch').length;
    const future=funds.filter(f=>fundWindow(f).tone==='future').length;
    const historical=funds.filter(f=>fundWindow(f).tone==='closed').length;
    const openWindow=funds.filter(f=>fundWindow(f).tone==='window').length;
    const myCount=funds.filter(f=>tracked[f.id]?.watching).length;
    const shown=funds.filter(f=>mode==='todos'||(mode==='mios'?!!tracked[f.id]?.watching:mode==='sin-fechas'?pending(f):
      mode==='proximos'?['window','future'].includes(fundWindow(f).tone):
      mode==='cerrados'&&fundWindow(f).tone==='closed'));
    const ordered=shown.slice().sort((a,b)=>{
      const rank=f=>{
        // La prioridad comercial precede a una lista histórica de programas.
        if(tone(f)==='abierto')return 0;
        if(tone(f)==='proximo')return 1;
        if(tracked[f.id]?.watching)return 2;
        if(tone(f)==='cerrado')return 6;
        if(/no elegible|no apto|baja|indirecta|hist[oó]ric/i.test(f.fit))return 5;
        return radarIds.has(f.id)?3:4;
      };
      const difference=rank(a)-rank(b);
      if(difference)return difference;
      if(tone(a)==='cerrado'&&tone(b)==='cerrado')return (b.close||'').localeCompare(a.close||'');
      return a.name.localeCompare(b.name,'es');
    });
    const groups=[['todos','Explorar'],['mios','Mi seguimiento ('+myCount+')'],['sin-fechas','Sin fecha oficial'],['proximos','Fechas vigentes / futuras'],['cerrados','Históricos']];
    const chips=groups.map(([value,title])=>
      '<button type="button" class="fondos-filter-pill'+(mode===value?' is-active':'')+
      '" data-fondos-view="'+value+'" aria-pressed="'+(mode===value?'true':'false')+'">'+esc(title)+'</button>'
    ).join('');
    const card=f=>{
      const stage=tone(f),dating=!pending(f),restricted=/no elegible|no apto|baja|indirecta/i.test(f.fit);
      const title=fundWindow(f).label;
      const label=tracked[f.id]?.watching?'EN MI SEGUIMIENTO':radarIds.has(f.id)?'PROGRAMA EN VIGILANCIA':f.category;
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
          '<button type="button" class="btn btn-primary btn-sm" data-fondos-work-open="'+esc(f.id)+'">Revisar para TLS →</button>'+
          '<button type="button" class="btn btn-ghost btn-sm" data-fondos-work-track="'+esc(f.id)+'" aria-pressed="'+(!!tracked[f.id]?.watching)+'">'+(tracked[f.id]?.watching?'★ Siguiendo':'☆ Seguir')+'</button>'+
          '<button type="button" class="btn btn-ghost btn-sm" data-fondos-open="'+esc(f.id)+'">Detalles</button>'+
          link(f.info,'↗ Fuente oficial')+
        '</div></article>';
    };
    root.innerHTML='<div class="fondos-tls'+(demoMode?' is-demo':'')+'">'+
      '<section class="fondos-hero" aria-label="Radar de oportunidades TLS">'+
        '<div><div class="fondos-eyebrow"><span class="fondos-live-dot" aria-hidden="true"></span> THE LAB SOLUTIONS · OPPORTUNITY RADAR</div>'+
          '<h2 class="fondos-title">'+(demoMode?'Explora TLS en <span>modo DEMO.</span>':'Fondos para TLS. <span>De la idea a la postulación.</span>')+'</h2>'+
          '<p class="fondos-lead">Identifica oportunidades, comprueba condiciones y prepara respuestas con el agente. Las fechas y los requisitos se validan siempre en la fuente oficial.</p>'+
          '<div class="fondos-hero-chips"><span class="fondos-micro fondos-micro--cyan">'+(demoMode?'◈ ENTORNO DE PRUEBA':'✓ Fechas respaldadas')+'</span><span class="fondos-micro">◷ Seguimiento continuo</span><span class="fondos-micro">✦ Asistente IA</span></div>'+ 
          '<div class="fondos-demo-hero-action"><button type="button" data-fondos-demo-toggle class="fondos-demo-button" aria-pressed="'+(demoMode?'true':'false')+'">'+(demoMode?'↩ Salir de DEMO':'▶ DEMO · Ver funcionamiento')+'</button></div>'+
        '</div>'+
        '<div class="fondos-kpis" aria-label="Resumen de programas">'+
          '<div class="fondos-kpi fondos-kpi--focus"><b>'+openWindow+'</b><small>Ventanas publicadas · confirmar</small></div>'+
          '<div class="fondos-kpi fondos-kpi--attention"><b>'+watch+'</b><small>Sin fecha oficial confirmada</small></div>'+
          '<div class="fondos-kpi"><b>'+future+'</b><small>Aperturas futuras registradas</small></div>'+
          '<div class="fondos-kpi"><b>'+myCount+'</b><small>Fondos en mi seguimiento</small></div>'+
        '</div>'+
      '</section>'+ 
      (demoMode?demoIllustration():('<div class="fondos-action-banner"><span>ESTADO REAL DEL CATÁLOGO</span><strong>'+(
        openWindow>0?'Hay '+openWindow+' ventana(s) que requieren verificar vigencia.':
        future>0?'Hay '+future+' apertura(s) futura(s) registradas.':
        'No hay un fondo con apertura vigente o futura registrada en este catálogo.'
      )+'</strong><p>Trabaja el proyecto y los requisitos mientras se vigilan nuevas convocatorias. No se presentan fondos cerrados como abiertos.</p></div>'+workspaceHtml()))+
      '<div class="fondos-toolbar"><div class="fondos-filter-pills" role="group" aria-label="Filtrar convocatorias">'+chips+'</div>'+
        '<label class="fondos-search-wrap"><span class="fondos-search-icon" aria-hidden="true">⌕</span><input type="search" id="fondosBuscar" autocomplete="off" aria-label="Buscar por programa, institución o categoría" placeholder="Buscar fondo, organismo o proyecto…" value="'+esc(searchTerm)+'"></label></div>'+
      '<div class="fondos-list-header"><b>Catálogo · '+funds.length+' programas</b><span data-fondos-count>'+ordered.length+' oportunidades visibles</span></div>'+
      '<div class="fondos-grid">'+ordered.map(card).join('')+'</div>'+ 
      '<button type="button" class="fondos-more" data-fondos-more hidden>Ver más oportunidades ↓</button>'+
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
    // Invalidar el borrador previo al cambiar la selección: nunca copiar contenido
    // que fue generado para otra convocatoria.
    const previous=document.getElementById('fondosConvocatoria')?.value||selected;
    if(previous!==f.id){
      draftReady=false;draftFor='';
      const out=document.getElementById('fondosRespuesta');
      if(out)out.textContent='';
      const notice=document.getElementById('fondosCopyNotice');
      if(notice)notice.textContent='';
    }
    close();selected=f.id;mode='todos';render();
    const select=document.getElementById('fondosConvocatoria');if(select)select.value=f.id;
    document.getElementById('fondosCopiloto')?.scrollIntoView({behavior:'smooth',block:'center'});
    document.getElementById('fondosPreguntas')?.focus();
  }
  async function draft(){
    if(busy)return;
    draftReady=false;draftFor='';
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
    const prevLabel=btn?.innerHTML||'';
    busy=true;
    if(btn){btn.disabled=true;btn.textContent='✦ Agente TLS trabajando…';}
    output.classList?.add('fondos-agent-loading');
    output.setAttribute?.('aria-busy','true');
    output.textContent='✦ AGENTE TLS PROCESANDO\n\nAnalizando las preguntas y requisitos…\nPreparando un borrador sin inventar información…';
    try{const result=await window.callAgentClaude('CEO',sys,user,{maxTokens:1400});
      const body=String(result||'').trim();
      if(!body)throw Error('El motor no devolvió contenido.');
      output.textContent=body;
      draftReady=true;
      draftFor=id;
    }catch(e){output.textContent='No se pudo generar el borrador: '+String(e.message||e)+'. Puedes reintentar.';}
    finally{
      busy=false;
      output.classList?.remove('fondos-agent-loading');
      output.setAttribute?.('aria-busy','false');
      if(btn){btn.disabled=false;btn.innerHTML=prevLabel;}
    }
  }
  async function copyDraft(){
    const value=document.getElementById('fondosRespuesta')?.textContent||'';
    const current=document.getElementById('fondosConvocatoria')?.value||'';
    const notice=document.getElementById('fondosCopyNotice');
    if(busy||!draftReady||!value||draftFor!==current){
      if(notice)notice.textContent='Primero genera un borrador válido para el fondo seleccionado.';
      return;
    }
    try{await navigator.clipboard.writeText(value);const m=document.getElementById('fondosCopyNotice');if(m)m.textContent='Copiado al portapapeles.';}
    catch{const m=document.getElementById('fondosCopyNotice');if(m)m.textContent='No se pudo copiar. Selecciona el texto manualmente.';}
  }
  function syncCalendar(){
    try{localStorage.setItem(KEY,document.getElementById('fondosShowOnCalendar')?.checked?'true':'false');}catch{}
    if(typeof window.renderCalendario==='function')window.renderCalendario();
  }
  function init(){
    const root=document.getElementById('tab-calendario');if(!root)return;
    tracked=readTracked();
    if(typeof document.createElement==='function'&&document.head&&!document.getElementById('fondosTlsStyles')){
      const sheet=document.createElement('link');
      sheet.rel='stylesheet';sheet.id='fondosTlsStyles';
      sheet.href=new URL('fondos-tls.css?v=20261015workflow',document.baseURI).href;
      document.head.appendChild(sheet);
    }
    root.addEventListener('click',e=>{
      if(e.target.closest('[data-fondos-demo-toggle]')){toggleDemo();return;}
      if(e.target.closest('[data-fondos-demo-run]')&&demoMode){void runDemoAgent();return;}
      if(e.target.closest('[data-fondos-demo-run-local]')&&demoMode){void runDemoAgent(true);return;}
      if(e.target.closest('[data-fondos-demo-copy]')&&demoMode&&demoAgent.status==='done'){
        if(navigator.clipboard?.writeText){
          navigator.clipboard.writeText(demoAgent.result).then(()=>{
            const notice=document.getElementById('fondosDemoCopyNotice');
            if(notice)notice.textContent='Resultado copiado.';
          }).catch(()=>{const notice=document.getElementById('fondosDemoCopyNotice');if(notice)notice.textContent='No se pudo copiar. Selecciona el texto.';});
        }
        return;
      }
      const scene=e.target.closest('[data-fondos-demo-step]');
      if(scene&&demoMode){demoStep=scene.dataset.fondosDemoStep;render();return;}
      const workOpen=e.target.closest('[data-fondos-work-open]');
      if(workOpen&&!demoMode){openWorkspace(workOpen.dataset.fondosWorkOpen);return;}
      const workTrack=e.target.closest('[data-fondos-work-track]');
      if(workTrack&&!demoMode){trackFund(workTrack.dataset.fondosWorkTrack);return;}
      if(e.target.closest('[data-fondos-work-close]')){workspaceRunId++;workspaceBusy=false;workspaceId='';workspaceResult={status:'idle',source:'',text:'',error:''};render();return;}
      if(e.target.closest('[data-fondos-work-analyze]')){void workspaceAnalyze();return;}
      if(e.target.closest('[data-fondos-work-local]')){void workspaceAnalyze(true);return;}
      if(e.target.closest('[data-fondos-work-form]')){prepareFromWorkspace();return;}
      if(e.target.closest('[data-fondos-work-copy]')&&workspaceResult.status==='done'){
        const note=document.getElementById('fondosWorkCopyNote');
        if(typeof navigator!=='undefined'&&navigator.clipboard?.writeText){
          navigator.clipboard.writeText(workspaceResult.text).then(()=>{if(note)note.textContent='Copiado';}).catch(()=>{if(note)note.textContent='Selecciona el texto para copiar';});
        }else if(note)note.textContent='Selecciona el texto para copiar';
        return;
      }
      if(e.target.closest('[data-fondos-more]')){visibleLimit+=8;applySearch();return;}
      const quick=e.target.closest('[data-fondos-view]');
      if(quick){mode=quick.dataset.fondosView;visibleLimit=8;render();return;}
      const goto=e.target.closest('[data-fondos-calendar]');
      if(goto){goTo(goto.dataset.fondosCalendar,goto.dataset.fondosPhase);return;}
      const openButton=e.target.closest('[data-fondos-open]');
      if(openButton){open(openButton.dataset.fondosOpen);return;}
      const draftButton=e.target.closest('[data-fondos-draft]');
      if(draftButton){prepare(draftButton.dataset.fondosDraft);}
    });
    root.addEventListener('change',e=>{
      if(e.target.id==='fondosMesaEtapa'&&workspaceId){stageFund(workspaceId,e.target.value);return;}
      const check=e.target.closest?.('[data-fondos-work-check]');
      if(check&&workspaceId){toggleFlowCheck(workspaceId,check.dataset.fondosWorkCheck,!!check.checked);return;}
    });
    const filter=document.getElementById('fondosFiltro');
    if(filter)filter.addEventListener('change',()=>{mode=filter.value;visibleLimit=8;render();});
    document.getElementById('fondosList')?.addEventListener('input',e=>{
      if(e.target.id==='fondosBuscar'){searchTerm=e.target.value;visibleLimit=8;applySearch();}
      if(e.target.id==='fondosDemoPregunta'&&demoMode){demoAgent.prompt=e.target.value;}
      if(e.target.id==='fondosMesaIdea'&&!demoMode){workspaceBrief=e.target.value;}
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
  window.TLSFondos={load,render,eventList,open,prepare,draft,copyDraft,status,clean,iso,allDates,goTo,goToClosest,renderCalendarSummary,notifyToday,toggleDemo,isDemo:()=>demoMode,runDemoAgent,demoAgentState:()=>({...demoAgent}),openWorkspace,trackFund,stageFund,toggleFlowCheck,workspaceAnalyze,workspaceState:()=>({...workspaceResult}),fundWindow};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
