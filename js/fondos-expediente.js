/* Expedientes de postulación TLS. Borradores locales, controles compartidos en FONDOS_TLS. */
(function(){
  'use strict';
  if(window.TLSFondosExpediente)return;
  const PROFILES={
    'corfo-crea-y-valida-proxima-vigilar':{
      title:'Crea y Valida · expediente de I+D',
      warning:'NO hay una nueva convocatoria confirmada por Corfo. El llamado nacional de 2026 cerró el 04/08 y exigió perfil previo. Preparar sin señalar “postulado”.',
      idea:'Proyecto preliminar: desarrollar y validar una innovación en fabricación aditiva para POP y señalética, con un prototipo medible, una incertidumbre técnica real, pruebas comparativas y validación comercial.',
      details:{
        bases:'Identificar bases de la próxima convocatoria. Confirmar fases, formularios y condiciones de I+D; no utilizar la fecha 10/11 como oficial.',
        empresa:'Acreditar 24 meses de actividad en primera categoría vigente y ventas dentro de los 24 meses anteriores. Confirmar con respaldo SII.',
        proyecto:'Documentar el prototipo de partida, hipótesis técnica, brecha I+D, alternativa actual, pruebas y ventaja nacional demostrable.',
        finanzas:'Presupuestar actividades de I+D, ensayos, horas especializadas, cotizaciones, gastos admisibles y aporte propio según tamaño de TLS.',
        documentos:'Constitución y poderes vigentes, certificados tributarios, fichas de prototipo, pruebas y cartas de validación con clientes.',
        formulario:'Preparar primero el perfil técnico, si la próxima convocatoria mantiene esa fase; recopilar preguntas oficiales antes de redactar respuestas.',
        plazos:'Comprobar las fechas en Corfo. No marcar apertura ni perfil enviado sin fuente y comprobante.'
      },
      source:'https://www.corfo.gob.cl/sites/cpp/convocatoria/crea-y-valida-2026/'
    },
    'corfo-crea-y-valida-2026':{
      title:'Crea y Valida · preparación para próximo llamado',
      warning:'La convocatoria 2026 cerró el 04/08; usar estas bases como referencia, no como postulación vigente.',
      idea:'Proyecto preliminar: validar un nuevo proceso de manufactura aditiva con desafío técnico y resultados medibles, a partir de prototipo existente.',
      details:{
        bases:'Revisar bases históricas y esperar nuevas condiciones.',
        empresa:'Respaldar 24 meses de primera categoría vigente y ventas de los 24 meses previos.',
        proyecto:'Definir prototipo, incertidumbre tecnológica y validación real.',
        finanzas:'Preparar costos I+D, cotizaciones y cofinanciamiento propio.',
        documentos:'Identificar documentos legales, tributarios y pruebas del prototipo.',
        formulario:'Preparar un perfil editable, sin usar preguntas no confirmadas.',
        plazos:'Cerrar seguimiento de 2026 y esperar el siguiente llamado oficial.'
      },
      source:'https://www.corfo.gob.cl/sites/cpp/convocatoria/crea-y-valida-2026/'
    },
    'startupchile-big-proximo-vigilar':{
      title:'BIG 13 · evaluar Growth antes de postular',
      warning:'BIG 13 cierra el 24/11/2026 a las 13:00 (Chile). TLS operativa no equivale automáticamente a startup escalable. Build/Ignite no parecen adecuarse a su antigüedad.',
      idea:'Evaluar si TLS dispone de tecnología propia, ventas atribuibles y un producto replicable/escalable distinto de la fabricación por encargo; si no, descartar antes de consumir tiempo.',
      details:{
        bases:'Descargar términos BIG 13 y revisar la modalidad Growth en particular.',
        empresa:'Verificar en SII antigüedad entre 24 y 120 meses y ventas de 2.400 a 25.000 UF en los últimos 12 meses.',
        proyecto:'Demostrar producto digital o tecnológico diferencial, mercado global, crecimiento y escalabilidad independiente de pedidos a medida.',
        finanzas:'Reunir ventas comprobables de 12 meses, estructura de costos, tracción y plan de crecimiento.',
        documentos:'Identificar team leader, % de participación, dedicación, pitch, demo y clientes medibles.',
        formulario:'Completar únicamente preguntas oficiales de Growth; preparar presentación y respuestas.',
        plazos:'Antes del 24/11/2026 a las 13:00; guardar comprobante de envío si se postula.'
      },
      source:'https://startupchile.org/postula/'
    },
    'corfo-pati-futuras':{
      title:'PATI · preparación de alianza entre pymes',
      warning:'El llamado nacional 2025–2026 cerró el 15/07/2026. La próxima fecha aún no está confirmada.',
      idea:'Propuesta preliminar: identificar varias pymes de fabricación digital con una brecha tecnológica compartida, buscar entidad gestora y elaborar un plan de absorción tecnológica con indicadores.',
      details:{
        bases:'Determinar modalidad de PATI (prospección, difusión o absorción) y bases del futuro llamado.',
        empresa:'Verificar condiciones del gestor y de empresas participantes: actividad, ventas y perfil pyme.',
        proyecto:'Levantar brecha tecnológica común, empresas beneficiarias y plan de adopción medible.',
        finanzas:'Estimar aporte de las empresas, costos de la transferencia y tope del nuevo instrumento (referencia previa: 60%).',
        documentos:'Identificar gestor, cartas de compromiso y evidencia de la brecha compartida.',
        formulario:'Preparar descripción del grupo, metodología y metas de absorción.',
        plazos:'Esperar nueva ficha oficial; no indicar convocatoria abierta.'
      },
      source:'https://www.corfo.gob.cl/sites/cpp/programa/programa-absorcion-tecnologica-innovacion/'
    },
    'corfo-pati-nacional-2025-2026':{
      title:'PATI · próximo proceso asociativo',
      warning:'La convocatoria 2025–2026 cerró el 15/07/2026.',
      idea:'Identificar grupo de empresas con brecha tecnológica compartida y entidad gestora para futura PATI.',
      details:{
        bases:'Revisar bases anteriores solo como referencia.',
        empresa:'Verificar requisitos de gestor y participantes.',
        proyecto:'Definir desafío común y plan de transferencia.',
        finanzas:'Presupuesto y cofinanciamiento de varias entidades.',
        documentos:'Cartas de compromiso y diagnóstico de brechas.',
        formulario:'Preparar objetivo, actividades y beneficiarios.',
        plazos:'Comprobar próxima apertura oficial.'
      },
      source:'https://www.corfo.gob.cl/sites/cpp/programa/programa-absorcion-tecnologica-innovacion/'
    }
  };
  const FIELDS=[
    ['responsable','Responsable en TLS','Persona encargada de revisar y reunir antecedentes.',90,1],
    ['problema','Problema y línea base','Situación actual, tiempos, costos y defectos con datos verificables.',1400,3],
    ['prototipo','Prototipo y desafío tecnológico','Qué existe, qué incertidumbre de I+D persiste y cómo probarla.',1400,3],
    ['validacion','Validación y clientes','Ensayos, indicadores, clientes piloto y evidencia técnica/comercial.',1400,3],
    ['presupuesto','Presupuesto y cofinanciamiento','Costos admisibles a verificar, cotizaciones y aporte de la empresa.',1400,3],
    ['respaldo','Documentos y enlaces','Enlaces a archivos de Drive. No pegues RUT, secretos, claves ni datos personales.',1800,3]
  ];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function person(){
    try{const p=typeof NOTIFY!=='undefined'?NOTIFY?.persona?.():null;return ['gustavo','nicanor'].includes(p)?p:'local';}catch(_){return 'local';}
  }
  function key(id){return 'tls-fondos-dossier-v1:'+person()+':'+id;}
  function profile(id){return PROFILES[id]||null;}
  function read(id){
    if(!profile(id))return {};
    try{
      const d=JSON.parse(localStorage.getItem(key(id))||'{}');
      if(!d||typeof d!=='object'||Array.isArray(d))return {};
      const valid=[['idea',3000],...FIELDS.map(f=>[f[0],f[3]])];
      const out={};
      for(const [name,max] of valid)if(typeof d[name]==='string')out[name]=d[name].slice(0,max);
      return out;
    }catch{return {};}
  }
  function save(id,name,value){
    if(!profile(id)||typeof value!=='string')return false;
    const max=name==='idea'?3000:FIELDS.find(f=>f[0]===name)?.[3];
    if(!max||value.length>max)return false;
    const doc=read(id);doc[name]=value;
    try{localStorage.setItem(key(id),JSON.stringify(doc));return true;}catch{return false;}
  }
  function ideaFor(id){return read(id).idea||profile(id)?.idea||'';}
  function hint(id,check){return profile(id)?.details?.[check]||'';}
  function html(f,record,checks){
    const p=profile(f?.id);if(!p)return '';
    const d=read(f.id);
    const done=new Set(Array.isArray(record?.checks)?record.checks:[]);
    const percent=Math.round(100*(checks||[]).filter(x=>done.has(x[0])).length/Math.max(1,(checks||[]).length));
    return '<div class="fondos-dossier" aria-label="Expediente TLS para '+esc(f.name)+'">'+
      '<div class="fondos-dossier-head"><div><span class="fondos-eyebrow">EXPEDIENTE DE POSTULACIÓN</span><h4>'+esc(p.title)+'</h4></div>'+
      '<button type="button" class="fondos-outline-action" data-fondos-dossier-copy="'+esc(f.id)+'">Copiar expediente ↗</button></div>'+
      '<p class="fondos-dossier-warning">'+esc(p.warning)+'</p>'+
      '<div class="fondos-dossier-metric"><strong>'+percent+'%</strong><span>Controles revisados por TLS. Marca los siete controles del paso 02 cuando hayas verificado la evidencia; no se completan automáticamente.</span></div>'+
      '<div class="fondos-dossier-editor">'+FIELDS.map(([name,label,guide,max,rows])=>
        '<label class="fondos-dossier-field"><strong>'+esc(label)+'</strong><small>'+esc(guide)+'</small>'+
        '<textarea data-fondos-dossier-input="'+esc(name)+'" maxlength="'+max+'" rows="'+rows+'" placeholder="Pendiente de completar y respaldar">'+esc(d[name]||'')+'</textarea></label>').join('')+
      '</div>'+
      '<div class="fondos-dossier-foot"><small>Estos textos se guardan solo en este navegador. Las siete casillas de avance se sincronizan con TLS si el seguimiento compartido está conectado. Exporta una copia periódicamente.</small><span data-fondos-dossier-message role="status" aria-live="polite">Edición local</span></div>'+
      '</div>';
  }
  function textFor(f,checks){
    const p=profile(f?.id);if(!p)return '';
    const data=read(f.id);
    const done=new Set(Array.isArray(checks)?checks:[]);
    return [
      'THE LAB SOLUTIONS · EXPEDIENTE DE FONDO (BORRADOR)',
      'Convocatoria: '+f.name,
      'Organismo: '+f.organizer,
      'Fuente oficial: '+p.source,
      'AVISO: '+p.warning,
      '',
      'IDEA DE PROYECTO (NO VALIDADA)',
      data.idea||p.idea,
      '',
      'CONTROLES DE PREPARACIÓN',
      ...Object.entries(p.details).map(([key,desc])=>(done.has(key)?'[X] ':'[ ] ')+desc),
      '',
      'DATOS PENDIENTES / COMPLETADOS',
      ...FIELDS.flatMap(([k,label])=>[label+':',data[k]||'(Pendiente)','']),
      'Advertencia: el expediente no acredita elegibilidad ni representa una postulación enviada.'
    ].join('\n');
  }
  async function copy(id){
    if(!profile(id))return false;
    const f=window.TLSFondos?.getFund?.(id);
    if(!f)return false;
    const checks=window.TLSFondos?.getTracked?.(id)?.checks||[];
    const body=textFor(f,checks);
    const node=document.querySelector('[data-fondos-dossier-message]');
    try{
      if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(body);
      if(node)node.textContent='Expediente copiado para respaldar.';
      return true;
    }catch{
      if(node)node.textContent='No se pudo copiar; revisa permisos del navegador.';
      return false;
    }
  }
  function bind(){
    const root=document.getElementById('tab-calendario');
    if(!root)return;
    root.addEventListener('input',e=>{
      const input=e.target.closest?.('[data-fondos-dossier-input]');
      const idea=e.target.id==='fondosMesaIdea'&&e.target;
      if(!input&&!idea)return;
      const fundId=window.TLSFondos?.currentWorkspaceId?.();
      if(!fundId||!profile(fundId))return;
      const ok=save(fundId,input?.dataset.fondosDossierInput||'idea',(input||idea).value);
      const el=document.querySelector('[data-fondos-dossier-message]');
      if(el)el.textContent=ok?'Guardado localmente':'No se pudo guardar. Copia tu texto.';
    });
    root.addEventListener('click',e=>{
      const btn=e.target.closest?.('[data-fondos-dossier-copy]');
      if(btn)void copy(btn.dataset.fondosDossierCopy);
    });
  }
  window.TLSFondosExpediente={profile,read,save,ideaFor,hint,html,copy,textFor};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();