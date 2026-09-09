/* js/kai.js â€” asistente KAI (extraÃ­do de index.html). */

(function(){
  'use strict';

  const JV = {
    open:false, listening:false, thinking:false, speaking:false, busy:false, ctrl:null,
    rec:null, synth:window.speechSynthesis, history:[], autoListen:false,
    usage:{in:0,out:0}, _btns:[], _delegations:0, _lastDeleg:'', _proactiveAt:0,
  };

  // â”€â”€â”€ Refs â”€â”€â”€
  const $fab   = document.getElementById('jvs-fab');
  const $panel = document.getElementById('jvs-panel');
  const $log   = document.getElementById('jvs-log');
  const $state = document.getElementById('jvs-state');
  const $input = document.getElementById('jvs-input');
  const $send  = document.getElementById('jvs-send');
  const $mic   = document.getElementById('jvs-mic');
  const $close = document.getElementById('jvs-close');
  const $voiceToggle = document.getElementById('jvs-voice-toggle');
  const $autoListen  = document.getElementById('jvs-auto-listen');
  const $usage = document.getElementById('jvs-usage');
  const $topkai = document.querySelector('.topbar-kai-btn');

  // â”€â”€â”€ Live dashboard context builder â”€â”€â”€
  function buildContext(){
    try{
      const s = window.state || {};
      // Este panorama se inyecta en CADA mensaje a KAI, se pregunte o no. Sin
      // acotarlo, a un comercial le bastaba con abrir el chat para recibir los
      // ingresos acumulados, la cobranza y los Ãºltimos pedidos de toda la
      // empresa con cliente y monto â€” todo lo que sus listas sÃ­ le ocultan.
      const _av = (typeof isVendorMode==='function' && isVendorMode());
      const _mio = r => !_av || (typeof vendorOwnsRecord!=='function') || vendorOwnsRecord(r);
      const ped = (s.pedidos || []).filter(_mio);
      const cot = (s.cotizaciones || []).filter(_mio);
      const cli = (s.clientes || []).filter(_mio);
      const cliById = s.clientesById || {};
      const today = new Date(); today.setHours(0,0,0,0);

      const resolveCli = f => {
        if(!f) return 'â€”';
        if(typeof f==='string') return f;
        if(Array.isArray(f)&&f.length) return cliById[f[0]]||'(cliente)';
        return 'â€”';
      };

      const activos = ped.filter(p=>!['Despachado','Completado','Cancelado'].includes(p.fields?.['Estado pedido']||''));
      const atrasados = ped.filter(p=>pedidoAtrasado(p.fields));
      const cotPend = cot.filter(c=>['Enviada','Solicitada'].includes(c.fields?.['Estado cotizaciÃ³n']||''));
      const revTotal = ped.reduce((a,p)=>a+Math.round((p.fields?.['Monto total (CLP)']||0)/1.19),0);

      // Finanzas (cobranza), proveedores y mÃ¡quinas â€” contexto extra
      const fac = s.facturas || [];
      const porCobrar = fac.filter(x=>x.fields&&(x.fields['Estado Pago']||'')!=='Cobrada'&&(+x.fields['Total']>0));
      const vencidas = fac.filter(x=>x.fields&&(x.fields['Estado Pago']||'')==='Vencida');
      const sumCobrar = porCobrar.reduce((a,x)=>a+(+x.fields['Total']||0),0);
      const prov = s.proveedores || [];
      const provAct = prov.filter(p=>(p.fields?.['Estado']||'Activo')==='Activo').length;
      let maqLine='';
      try{
        if(typeof MAQUINAS!=='undefined'&&Array.isArray(MAQUINAS)){
          let impr=0; MAQUINAS.forEach(m=>{try{if((typeof _printerStatus!=='undefined'?(_printerStatus[m.id]||{}).state:'')==='printing')impr++;}catch(e){}});
          let mant=0; if(typeof getMaintAlerts==='function')MAQUINAS.forEach(m=>{try{if(getMaintAlerts(m).length)mant++;}catch(e){}});
          maqLine='\n- MÃ¡quinas: '+MAQUINAS.length+' | Imprimiendo: '+impr+' | Con alerta de mantenciÃ³n: '+mant;
        }
      }catch(e){}

      const pedRows = activos.slice(0,10).map(p=>{
        const f=p.fields||{};
        return `  â€¢ ${f['NÂ° Pedido']||'â€”'} | ${resolveCli(f['Cliente'])} | ${f['Estado pedido']||'â€”'} | $${Math.round((f['Monto total (CLP)']||0)/1.19).toLocaleString('es-CL')} neto | Entrega: ${f['Fecha entrega']||'sin fecha'}`;
      }).join('\n');

      const cotRows = cotPend.slice(0,10).map(c=>{
        const f=c.fields||{};
        return `  â€¢ Cot ${f['NÂ° CotizaciÃ³n']||'â€”'} | ${resolveCli(f['Cliente'])} | ${f['Estado cotizaciÃ³n']||'â€”'} | $${Math.round((f['Total final (CLP)']||0)/1.19).toLocaleString('es-CL')} neto`;
      }).join('\n');

      // Cobranza, proveedores y mÃ¡quinas son de secciones que un comercial no
      // tiene: no se le entregan por esta vÃ­a.
      const lineasEmpresa = _av ? '' :
`
- Cobranza: ${porCobrar.length} facturas por cobrar ($${sumCobrar.toLocaleString('es-CL')}) | ${vencidas.length} vencidas
- Proveedores: ${prov.length} (${provAct} activos)${maqLine}`;
      return `DATOS EN VIVO DEL DASHBOARD (${new Date().toLocaleString('es-CL')})${_av?' â€” SOLO tus clientes y pedidos':''}:
- Pedidos${_av?' tuyos':' totales'}: ${ped.length} | Activos: ${activos.length} | Atrasados: ${atrasados.length}
- Cotizaciones${_av?' tuyas':' totales'}: ${cot.length} | Pendientes de respuesta: ${cotPend.length}
- Clientes${_av?' tuyos':' registrados'}: ${cli.length}
- Ingresos netos acumulados: $${revTotal.toLocaleString('es-CL')} CLP${lineasEmpresa}

PEDIDOS ACTIVOS:
${pedRows||'  (ninguno)'}

COTIZACIONES PENDIENTES:
${cotRows||'  (ninguna)'}`;
    }catch(e){ return 'Datos del dashboard no disponibles en este momento.'; }
  }

  // Los agentes que este rol sÃ­ puede correr. Se le dicen a KAI para que no
  // ofrezca lo que despuÃ©s va a rechazar: la lista fija incluÃ­a los 18 y KAI
  // proponÃ­a delegar al de finanzas a quien no tiene esa secciÃ³n.
  function _kaiAgentesPermitidos(){
    try{
      if(typeof AGENTES_CFG==='undefined') return 'ninguno';
      const ok=AGENTES_CFG.filter(a=>typeof agenteVisible!=='function'||agenteVisible(a)).map(a=>a.id);
      return ok.length?ok.join(', '):'ninguno';
    }catch(e){return 'ninguno';}
  }
  const SYS_RULES = () => `Eres KAI, asistente de IA del Centro de Comando de The Lab Solutions (empresa chilena de impresion 3D, letreros neon y trofeos). Tienes 14 impresoras 3D. Moneda: CLP.

CAPACIDADES Y REGLAS:
- Responde SIEMPRE en espanol chileno, profesional y conciso (maximo 3 oraciones, pensado para voz).
- NUNCA uses emojis, asteriscos, numeral, comillas invertidas ni simbolos decorativos. Solo texto limpio.
- Tienes HERRAMIENTAS (tools) para ACTUAR sobre el dashboard. Invocalas en vez de describir lo que harias o de escribir etiquetas:
  - navegar(modulo): cambia de modulo. Modulos: overview, clientes, cotizaciones, pedidos, proveedores, agentes, maquinas, equipo, reporte, web, finanzas, visual, remuneraciones.
  - abrir_formulario(tipo): abre un formulario de nuevo registro. Tipos: cliente, cotizacion, proveedor, venta, diario.
  - cotizar(): abre el cotizador guiado paso a paso cuando el usuario quiere armar un presupuesto.
  - asistente(tipo): abre un asistente guiado. Tipos: cliente, proveedor, pago, mantencion, cotizar.
  - delegar(agente, instruccion): delega a un agente y recibes su resultado para resumirlo. Agentes: ${_kaiAgentesPermitidos()}. Usalo cuando pidan redactar, cotizar, generar checklist, reporte, analisis o contenido de redes sociales.
  - sugerir_acciones(botones): cuando sea util, ofrece 1 a 3 botones de seguimiento; cada boton tiene texto (2-4 palabras que ve el usuario) y comando (lo que recibirias si lo pulsa).
  - consultar_crm(consulta, nombre, periodo): consulta datos precisos del CRM. Usala SIEMPRE que pregunten por algo concreto: un cliente o proveedor por nombre (consulta=cliente/proveedor con nombre), pedidos atrasados, cartera por cobrar, finanzas o top de clientes de un mes (periodo actual o anterior), cotizaciones pendientes o inventario bajo. Responde con las cifras que te devuelva, sin inventar.
- Acompana SIEMPRE el uso de una herramienta con una frase breve hablada que diga lo que estas haciendo.
- Para preguntas sobre datos especificos (saldos, un cliente, un mes) usa consultar_crm; el resumen de DATOS EN VIVO de abajo es solo panorama general.
- Tono confiado, eficiente, tipo asistente ejecutivo. Nunca digas que eres un modelo de lenguaje.`;
  // Compat: SYS() devuelve el system completo como string (reglas + contexto en vivo).
  const SYS = () => SYS_RULES()+'\n\n'+buildContext();
  // System en bloques: reglas estaticas con cache_control (prompt caching) + contexto dinamico.
  const SYS_BLOCKS = () => [
    {type:'text', text:SYS_RULES(), cache_control:{type:'ephemeral'}},
    {type:'text', text:buildContext()}
  ];

  // â”€â”€â”€ UI helpers â”€â”€â”€
  function setState(mode){
    $fab.className=''; $mic.classList.remove('jvs-rec');
    const map={listening:'ESCUCHANDO...',thinking:'PROCESANDO...',speaking:'RESPONDIENDO...',idle:'EN ESPERA'};
    $state.textContent=map[mode]||'EN ESPERA';
    if(mode==='listening'){ $fab.classList.add('jvs-active','jvs-listening'); $mic.classList.add('jvs-rec'); }
    else if(mode==='thinking'){ $fab.classList.add('jvs-thinking'); }
    else if(mode==='speaking'){ $fab.classList.add('jvs-active'); }
    if($topkai) $topkai.classList.toggle('kai-busy', mode==='thinking'||mode==='speaking');
  }

  // â”€â”€ Contador de tokens / costo estimado de la sesiÃ³n (#8) â”€â”€
  function _kaiUpdateUsage(inTok,outTok,cacheWrite=0,cacheRead=0){
    if(!$usage) return;
    JV.usage.in += (+inTok||0); JV.usage.out += (+outTok||0);
    JV.usage.cacheWrite=(JV.usage.cacheWrite||0)+cacheWrite;
    JV.usage.cacheRead=(JV.usage.cacheRead||0)+cacheRead;
    const tot = JV.usage.in + JV.usage.out + JV.usage.cacheWrite + JV.usage.cacheRead;
    $usage.style.display='';
    $usage.textContent = tot.toLocaleString('es-CL')+' tok Â· cachÃ© '+JV.usage.cacheRead.toLocaleString('es-CL');
    $usage.title='SÃ³lo KAI en esta sesiÃ³n; incluye entrada, salida y cachÃ©. No es una factura ni incluye agentes delegados.';
  }

  // â”€â”€ Botones de acciÃ³n rÃ¡pida bajo una respuesta (#5) â”€â”€
  function _kaiRenderButtons(btns){
    if(!Array.isArray(btns)||!btns.length) return;
    const row=document.createElement('div'); row.className='jvs-acts';
    btns.slice(0,3).forEach(b=>{
      if(!b||!b.label) return;
      const btn=document.createElement('button'); btn.className='jvs-actbtn'; btn.textContent=b.label;
      btn.addEventListener('click',()=>{ if(JV.busy) return; row.remove(); const cmd=b.cmd||b.label; addMsg('u',cmd); ask(cmd); });
      row.appendChild(btn);
    });
    $log.appendChild(row); $log.scrollTop=$log.scrollHeight;
  }

  function addMsg(role,text){
    const cls={u:'jvs-u',j:'jvs-j',a:'jvs-a',e:'jvs-e'}[role];
    const lbl={u:'TÃš',j:'KAI',a:'ACCIÃ“N',e:'ERROR'}[role];
    const d=document.createElement('div');
    d.className='jvs-msg '+cls;
    const ls=document.createElement('span');ls.className='jvs-lbl';ls.textContent=lbl;
    const ts=document.createElement('span');ts.className='jvs-txt';ts.textContent=text;
    d.appendChild(ls);d.appendChild(ts);
    $log.appendChild(d); $log.scrollTop=$log.scrollHeight;
    return ts;
  }

  // â”€â”€ Persistencia de conversaciÃ³n (sobrevive a recargas dentro de la sesiÃ³n) â”€â”€
  function _kaiStripTags(s){return String(s||'').replace(/\[NAV:[^\]]*\]/gi,'').replace(/\[NUEVO:[^\]]*\]/gi,'').replace(/\[AGENTE:[^\]]*\]/gi,'').replace(/\[COTIZAR\]/gi,'').replace(/\[FLUJO:[^\]]*\]/gi,'').trim();}
  function _kaiPersist(){try{sessionStorage.setItem('kai_hist',JSON.stringify(JV.history.slice(-14)));}catch(e){}}
  function _kaiRestore(){
    try{
      const raw=sessionStorage.getItem('kai_hist');if(!raw)return;
      const h=JSON.parse(raw);if(!Array.isArray(h)||!h.length)return;
      JV.history=h.slice(-14);
      JV.history.forEach(msg=>{const t=_kaiStripTags(msg.content);if(t)addMsg(msg.role==='user'?'u':'j',t);});
    }catch(e){}
  }
  // Lanza un asistente guiado por nombre (acciÃ³n [FLUJO:tipo] de KAI)
  function _kaiLaunchFlow(t){
    const map={cliente:window.startNewClientFlow,lead:window.startNewClientFlow,proveedor:window.startNewProveedorFlow,pago:window.startPaymentFlow,abono:window.startPaymentFlow,mantencion:window.startMaintFlow,'mantenciÃ³n':window.startMaintFlow,cotizar:window.startQuoteFlow,cotizacion:window.startQuoteFlow,'cotizaciÃ³n':window.startQuoteFlow};
    const fn=map[t];if(typeof fn==='function')fn();
  }

  // â”€â”€â”€ Panel open/close â”€â”€â”€
  function _ctxSuggest(){
    const chip=document.getElementById('jvs-ctx-chip');if(!chip)return;
    let tab='';try{tab=sessionStorage.getItem('thelab_active_tab')||'';}catch(e){}
    const map={
      clientes:{label:'âž• Nuevo cliente',fn:window.startNewClientFlow},
      cotizaciones:{label:'ðŸ’° Cotizar',fn:window.startQuoteFlow},
      overview:{label:'ðŸ’° Cotizar',fn:window.startQuoteFlow},
      proveedores:{label:'âž• Nuevo proveedor',fn:window.startNewProveedorFlow},
      maquinas:{label:'ðŸ”§ Registrar mantenciÃ³n',fn:window.startMaintFlow},
      finanzas:{label:'ðŸ’µ Registrar pago',fn:window.startPaymentFlow},
    };
    const s=map[tab];
    if(s&&typeof s.fn==='function'){chip.textContent=s.label;chip.style.display='';chip.onclick=()=>{closePanel();s.fn();};}
    else{chip.style.display='none';chip.onclick=null;}
  }
  // Alertas proactivas al abrir el panel (#9): resume lo urgente sin gastar API.
  function _kaiProactiveAlerts(){
    try{
      const now=Date.now();
      if(now-JV._proactiveAt < 10*60*1000) return;   // mÃ¡x. 1 cada 10 min
      const s=window.state||{};
      const ped=s.pedidos||[], cot=s.cotizaciones||[], fac=s.facturas||[];
      const today=new Date(); today.setHours(0,0,0,0);
      const atrasados=ped.filter(p=>pedidoAtrasado(p.fields)).length;
      const vencidas=fac.filter(x=>x.fields&&(x.fields['Estado Pago']||'')==='Vencida').length;
      const cotPend=cot.filter(c=>['Enviada','Solicitada'].includes(c.fields?.['Estado cotizaciÃ³n']||'')).length;
      const parts=[];
      if(atrasados) parts.push(atrasados+(atrasados===1?' pedido atrasado':' pedidos atrasados'));
      if(vencidas) parts.push(vencidas+(vencidas===1?' factura vencida':' facturas vencidas'));
      if(cotPend) parts.push(cotPend+(cotPend===1?' cotizaciÃ³n sin respuesta':' cotizaciones sin respuesta'));
      if(!parts.length) return;
      JV._proactiveAt=now;
      addMsg('a','Alertas: '+parts.join(' Â· '));
    }catch(e){}
  }
  function openPanel(){ JV.open=true; $panel.classList.add('jvs-open'); _ctxSuggest(); _kaiProactiveAlerts(); if(window.innerWidth>768) setTimeout(()=>$input.focus(),200); }
  function closePanel(){ JV.open=false; $panel.classList.remove('jvs-open'); stopListen(); JV.synth.cancel(); if(JV.ctrl){try{JV.ctrl.abort();}catch(e){}JV.ctrl=null;} JV.busy=false; JV.thinking=false; setState('idle'); }
  $fab.addEventListener('click',()=>{ JV.open?closePanel():openPanel(); });
  $close.addEventListener('click',closePanel);

  // â”€â”€â”€ Actions parser (navigation + new records) â”€â”€â”€
  function execActions(text){
    let m;
    JV._delegations=0;           // reinicia tope de delegaciones por respuesta (#2)
    // Botones de acciÃ³n rÃ¡pida (#5): [BTN:texto|comando]
    JV._btns=[];
    const reBtn=/\[BTN:\s*([^\|\]]+?)\s*(?:\|\s*([^\]]+?))?\s*\]/gi;
    while((m=reBtn.exec(text))!==null){ JV._btns.push({label:m[1].trim(), cmd:(m[2]||m[1]).trim()}); }
    text=text.replace(/\[BTN:[^\]]*\]/gi,'');
    const reNav=/\[NAV:\s*([a-zÃ¡Ã©Ã­Ã³ÃºÃ±\-]+)\]/gi;
    let cleaned=text.replace(reNav,'').trim();
    while((m=reNav.exec(text))!==null){
      const target=m[1].toLowerCase().trim();
      if(typeof window.switchTab==='function'){
        try{ window.switchTab(target); addMsg('a',`Navegando a ${target.toUpperCase()}`); }
        catch(e){ addMsg('a',target.toUpperCase()); }
      }
    }
    const reNuevo=/\[NUEVO:\s*([a-zÃ¡Ã©Ã­Ã³ÃºÃ±\-]+)\]/gi;
    cleaned=cleaned.replace(reNuevo,'').trim();
    while((m=reNuevo.exec(text))!==null){
      const tipo=m[1].toLowerCase().trim();
      const labels={cliente:'Nuevo Lead/Cliente',lead:'Nuevo Lead/Cliente',cotizacion:'Nueva Cotizacion',cot:'Nueva Cotizacion',proveedor:'Nuevo Proveedor',venta:'Nueva Venta',diario:'Libro Diario'};
      addMsg('a',`Abriendo formulario: ${labels[tipo]||tipo}`);
      try{
        if(tipo==='cliente'||tipo==='lead') window.switchTab('nuevo-lead');
        else if(tipo==='cotizacion'||tipo==='cot') window.switchTab('nueva-cot');
        else if(tipo==='proveedor') window.switchTab('nuevo-proveedor');
        else if(tipo==='venta'){ if(typeof irANuevaVenta==='function') irANuevaVenta(); }
        else if(tipo==='diario'){ if(typeof irALibroDiario==='function') irALibroDiario(); }
      }catch(e){}
    }
    const reAgente=/\[AGENTE:\s*([A-Z_]+)\s*\|\s*([^\]]+)\]/gi;
    cleaned=cleaned.replace(reAgente,'').trim();
    while((m=reAgente.exec(text))!==null){
      delegateToAgent(m[1].toUpperCase().trim(),m[2].trim());
    }
    if(/\[COTIZAR\]/i.test(text)){ cleaned=cleaned.replace(/\[COTIZAR\]/gi,'').trim(); closePanel(); if(window.startQuoteFlow) setTimeout(window.startQuoteFlow,150); }
    const fm=text.match(/\[FLUJO:\s*([a-zÃ¡Ã©Ã­Ã³ÃºÃ±\-]+)\]/i);
    if(fm){ cleaned=cleaned.replace(/\[FLUJO:[^\]]*\]/gi,'').trim(); const t=fm[1].toLowerCase().trim(); closePanel(); setTimeout(()=>_kaiLaunchFlow(t),150); }
    return cleaned;
  }

  // â”€â”€â”€ DelegaciÃ³n a agentes especializados â”€â”€â”€
  async function delegateToAgent(agentId,consulta){
    if(typeof AGENTES_CFG==='undefined'||typeof callClaude!=='function') return;
    // Guard (#2): tope de delegaciones por respuesta y anti-duplicado inmediato
    const sig=agentId+'|'+consulta;
    if(JV._delegations>=2){ return; }
    if(sig===JV._lastDeleg){ return; }
    JV._delegations++; JV._lastDeleg=sig;
    const cfg=AGENTES_CFG.find(a=>a.id===agentId);
    if(!cfg){ addMsg('e',`Agente ${agentId} no existe`); return; }
    addMsg('a',`Delegando a ${cfg.label}...`);
    const $res=addMsg('j',''); $res.classList.add('jvs-cursor');
    try{
      const ctx=(typeof buildAgentContext==='function'&&typeof state!=='undefined'&&state.loaded)?buildAgentContext(agentId):'';
      const fullInput=ctx?`${ctx}\n\nCONSULTA: ${consulta}`:consulta;
      const result=await callAgentClaude(agentId,cfg.sys,fullInput);
      $res.classList.remove('jvs-cursor');
      $res.innerHTML=`<div style="font-size:10px;color:var(--text3);font-weight:700;margin-bottom:4px">[${escapeHtml(cfg.label)}]</div>`+formatRichText(result);
      $log.scrollTop=$log.scrollHeight;
      try{ const h=JV.history; if(h.length&&h[h.length-1].role==='assistant'){ h[h.length-1].content+='\n\n[Resultado de '+cfg.label+']: '+result; _kaiPersist(); } }catch(e){}
      try{ if(typeof AGENT_LOG!=='undefined') AGENT_LOG.add(cfg.label,'KAI: '+consulta,result); }catch(e){}
    }catch(e){
      $res.classList.remove('jvs-cursor');
      $res.textContent='Error al consultar '+cfg.label+': '+e.message;
      $res.parentElement.className='jvs-msg jvs-e';
    }
  }

  // â”€â”€â”€ Herramientas (tool-use) que KAI puede invocar â”€â”€â”€
  const KAI_TOOLS = [
    {name:'navegar', description:'Cambia el dashboard a un mÃ³dulo concreto.', input_schema:{type:'object',properties:{modulo:{type:'string',enum:['overview','clientes','cotizaciones','pedidos','proveedores','agentes','maquinas','equipo','reporte','web','finanzas','visual','remuneraciones']}},required:['modulo']}},
    {name:'abrir_formulario', description:'Abre un formulario de creaciÃ³n de un nuevo registro.', input_schema:{type:'object',properties:{tipo:{type:'string',enum:['cliente','cotizacion','proveedor','venta','diario']}},required:['tipo']}},
    {name:'cotizar', description:'Abre el cotizador guiado paso a paso para armar un presupuesto.', input_schema:{type:'object',properties:{}}},
    {name:'asistente', description:'Abre un asistente guiado paso a paso.', input_schema:{type:'object',properties:{tipo:{type:'string',enum:['cliente','proveedor','pago','mantencion','cotizar']}},required:['tipo']}},
    {name:'delegar', description:'Delega una tarea a un agente especializado (redactar, cotizar, checklist, reporte, anÃ¡lisis, contenido de redes) y devuelve su resultado para que lo resumas.', input_schema:{type:'object',properties:{agente:{type:'string',enum:['SALES','QUOTE','PRODUCTION','QA','FOLLOWUP','CEO','LEADGEN','FINANCE','ONBOARDING','REPCLIENTE','CONTENT','ADS','SOCIAL_STRATEGIST','CAPTION_AGENT','COMMUNITY_AGENT','SOCIAL_ADS_AGENT','TREND_AGENT','REPORT_SOCIAL_AGENT']},instruccion:{type:'string',description:'InstrucciÃ³n detallada con todo el contexto necesario.'}},required:['agente','instruccion']}},
    {name:'sugerir_acciones', description:'Muestra 1 a 3 botones de acciÃ³n rÃ¡pida bajo tu respuesta.', input_schema:{type:'object',properties:{botones:{type:'array',maxItems:3,items:{type:'object',properties:{texto:{type:'string',description:'2-4 palabras que ve el usuario'},comando:{type:'string',description:'InstrucciÃ³n que recibirÃ­as si lo pulsa'}},required:['texto','comando']}}},required:['botones']}},
    {name:'consultar_crm', description:'Consulta datos precisos del CRM para responder preguntas concretas sobre clientes, pedidos, cobranza, finanzas, proveedores o inventario. Ãšsalo SIEMPRE que pregunten por un cliente/proveedor especÃ­fico, un saldo, pedidos atrasados, ingresos de un mes, top de clientes, precios de un proveedor o materiales con stock bajo. Devuelve datos reales calculados en vivo.', input_schema:{type:'object',properties:{consulta:{type:'string',enum:['cliente','proveedor','pedidos_atrasados','por_cobrar','finanzas_mes','top_clientes','cotizaciones_pendientes','inventario_bajo','resumen'],description:'Tipo de consulta.'},nombre:{type:'string',description:'Nombre del cliente o proveedor a buscar (solo para consulta=cliente o proveedor).'},periodo:{type:'string',enum:['actual','anterior'],description:'Mes a consultar para finanzas_mes/top_clientes: actual (en curso) o anterior (cerrado). Por defecto actual.'}},required:['consulta']}}
  ];
  // Consultas de consultar_crm que exponen datos de secciones que el rol
  // COMERCIAL no tiene (Finanzas, Proveedores, Inventario). Estas consultas leen
  // helpers globales (empresa completa) que saltan el acotamiento por vendedor de
  // `s`, asÃ­ que se niegan explÃ­citamente â€” igual que `resumen` ya oculta el por
  // cobrar. Devuelve el nombre de la secciÃ³n vedada, o '' si estÃ¡ permitida.
  function _kaiConsultaVedada(consulta,esVendedor){
    if(!esVendedor) return '';
    return ({por_cobrar:'Finanzas',finanzas_mes:'Finanzas',top_clientes:'Finanzas',proveedor:'Proveedores',inventario_bajo:'Inventario'})[consulta]||'';
  }
  // Consulta de datos del CRM (solo lectura): calcula la respuesta en vivo desde
  // state y helpers globales del dashboard, para que KAI responda con cifras reales.
  function _kaiConsultarCRM(input){
    input=input||{};
    // KAI leÃ­a el estado COMPLETO: un comercial preguntÃ¡ndole "Â¿cÃ³mo vamos?"
    // recibÃ­a pedidos, cotizaciones, clientes y el total por cobrar de toda la
    // empresa â€” justo lo que sus propias listas, la bÃºsqueda global y los
    // agentes sÃ­ acotan. El chat era la puerta de atrÃ¡s.
    const _st=window.state||{};
    const _av=(typeof isVendorMode==='function'&&isVendorMode());
    const _mio=(r)=>!_av||(typeof vendorOwnsRecord!=='function')||vendorOwnsRecord(r);
    const s=_av?{..._st,
      pedidos:(_st.pedidos||[]).filter(_mio),
      cotizaciones:(_st.cotizaciones||[]).filter(_mio),
      clientes:(_st.clientes||[]).filter(_mio)}:_st;
    const clp=n=>'$'+Math.round(n||0).toLocaleString('es-CL');
    const norm=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[Ì€-Í¯]/g,'').trim();
    const consulta=String(input.consulta||'').toLowerCase().trim();
    const nombre=String(input.nombre||'').trim();
    const off=(String(input.periodo||'').toLowerCase()==='anterior')?-1:0;
    const cliNombre=id=>((s.clientesById||{})[id])||'(cliente)';
    try{
      if(!s.loaded) return 'Los datos aÃºn se estÃ¡n cargando. Pide al usuario que actualice con el botÃ³n â†º y reintenta.';
      const _vedada=_kaiConsultaVedada(consulta,_av);
      if(_vedada) return 'Esa informaciÃ³n pertenece a '+_vedada+', una secciÃ³n fuera de tu acceso. Puedo ayudarte con tus clientes, cotizaciones y pedidos.';
      if(consulta==='cliente'){
        if(!nombre) return 'Falta el nombre del cliente a consultar.';
        const q=norm(nombre);
        const cli=(s.clientes||[]).find(c=>norm(c.fields['Empresa']).includes(q)||norm(c.fields['Contacto']).includes(q));
        if(!cli) return 'No encontrÃ© un cliente que coincida con "'+nombre+'".';
        const f=cli.fields; const emp=f['Empresa']||f['Contacto']||'â€”';
        const peds=(s.pedidos||[]).filter(p=>{const c=p.fields['Cliente'];return Array.isArray(c)?c.includes(cli.id):(norm(c)===norm(emp));});
        const activos=peds.filter(p=>!['Despachado','Completado','Cancelado'].includes(p.fields['Estado pedido']||''));
        let saldo=0;try{saldo=(typeof finGetAllFacturas==='function'?finGetAllFacturas():[]).filter(r=>r.porCobrar>0&&(norm(r.empresa)===norm(emp)||norm(r.nombre)===norm(emp))).reduce((a,r)=>a+(r.porCobrar||0),0);}catch(e){}
        let nps=null;try{const ns=peds.map(p=>typeof _npsScore==='function'?_npsScore(p):null).filter(v=>v!=null);if(ns.length)nps=ns.reduce((a,b)=>a+b,0)/ns.length;}catch(e){}
        const L=['Cliente: '+emp+(f['Etapa venta']?' | Etapa: '+f['Etapa venta']:'')+(f['Estado cuenta']?' | '+f['Estado cuenta']:'')];
        if(f['Revenue total cliente (CLP)'])L.push('Revenue histÃ³rico: '+clp(f['Revenue total cliente (CLP)']));
        L.push('Pedidos: '+peds.length+' ('+activos.length+' activos)');
        L.push(saldo>0?('Saldo por cobrar: '+clp(saldo)):'Sin saldo pendiente de cobro.');
        if(nps!=null)L.push('SatisfacciÃ³n promedio: '+nps.toFixed(1)+'/5');
        if(activos.length)L.push('Activos: '+activos.slice(0,6).map(p=>(p.fields['NÂ° Pedido']||'â€”')+' '+(p.fields['Estado pedido']||'')+(p.fields['Fecha entrega']?' (entrega '+p.fields['Fecha entrega']+')':'')).join('; '));
        if(f['TelÃ©fono']||f['Email'])L.push('Contacto: '+[f['TelÃ©fono'],f['Email']].filter(Boolean).join(' Â· '));
        return L.join('\n');
      }
      if(consulta==='proveedor'){
        if(!nombre) return 'Falta el nombre del proveedor a consultar.';
        const q=norm(nombre);
        const pv=(s.proveedores||[]).find(p=>norm(p.fields['Nombre']).includes(q));
        if(!pv) return 'No encontrÃ© un proveedor que coincida con "'+nombre+'".';
        const f=pv.fields;const L=['Proveedor: '+(f['Nombre']||'â€”')+(f['CategorÃ­a']?' | '+(typeof pvCat==='function'?pvCat(f):''):'')+(f['Estado']?' | '+f['Estado']:'')];
        if(f['ReputaciÃ³n'])L.push('ReputaciÃ³n: '+f['ReputaciÃ³n']+'/5');
        if(f['Plazo de entrega (dÃ­as)'])L.push('Plazo: '+f['Plazo de entrega (dÃ­as)']+' dÃ­as');
        if(f['Condiciones de pago'])L.push('Pago: '+f['Condiciones de pago']);
        try{const pr=(typeof _preciosDeProv==='function')?_preciosDeProv(f['Nombre']):[];
          if(pr.length){const best=(typeof _mejorPrecioPorItem==='function')?_mejorPrecioPorItem():{};
            L.push('Precios registrados ('+pr.length+'): '+pr.slice(0,6).map(p=>{const b=best[typeof _precioKey==='function'?_precioKey(p.item,p.unidad):norm(p.item)];const mejor=b&&norm(b.prov)===norm(f['Nombre'])&&b.precio===p.precio;return p.item+' '+clp(p.precio)+'/'+(p.unidad||'u')+(mejor?' (mejor precio)':'');}).join('; '));}
          else L.push('Sin precios registrados aÃºn.');
        }catch(e){}
        return L.join('\n');
      }
      if(consulta==='pedidos_atrasados'){
        const today=new Date();today.setHours(0,0,0,0);
        const at=(s.pedidos||[]).filter(p=>{const f=p.fields||{};if(['Despachado','Completado','Cancelado'].includes(f['Estado pedido']||''))return false;return f['Fecha entrega']&&new Date(f['Fecha entrega']+'T00:00:00')<today;})
          .sort((a,b)=>String(a.fields['Fecha entrega']).localeCompare(String(b.fields['Fecha entrega'])));
        if(!at.length) return 'No hay pedidos atrasados. Todo al dÃ­a.';
        return at.length+' pedido(s) atrasado(s):\n'+at.slice(0,12).map(p=>{const f=p.fields;const dias=Math.floor((today-new Date(f['Fecha entrega']+'T00:00:00'))/864e5);return '- '+(f['NÂ° Pedido']||'â€”')+' | '+cliNombre(Array.isArray(f['Cliente'])?f['Cliente'][0]:f['Cliente'])+' | '+(f['Estado pedido']||'â€”')+' | '+dias+' dÃ­a(s) de atraso';}).join('\n');
      }
      if(consulta==='por_cobrar'){
        let grupos=[];try{grupos=(typeof _cobGrupos==='function')?_cobGrupos():[];}catch(e){}
        if(!grupos.length) return 'No hay facturas pendientes de cobro registradas.';
        const total=grupos.reduce((a,g)=>a+(g.total||0),0);
        return 'Cartera por cobrar: '+clp(total)+' en '+grupos.length+' cliente(s).\nMÃ¡s morosos:\n'+grupos.slice(0,8).map(g=>'- '+g.empresa+': '+clp(g.total)+' | mora mÃ¡x '+g.maxDias+' dÃ­as | '+g.n+' factura(s)').join('\n');
      }
      if(consulta==='finanzas_mes'){
        if(typeof _mesAgregado!=='function'||typeof _mesRango!=='function') return 'El mÃ³dulo de finanzas no estÃ¡ disponible.';
        const a=_mesAgregado(off),prev=_mesAgregado(off-1),{label}=_mesRango(off);
        const metaM=parseInt(localStorage.getItem('revMetaMensual'))||0;
        const d=prev.rev>0?Math.round((a.rev-prev.rev)/prev.rev*100):null;
        const L=['Finanzas de '+label+(off===0?' (mes en curso)':' (mes cerrado)')+':'];
        L.push('Revenue neto: '+clp(a.rev)+(d!=null?' ('+(d>0?'+':'')+d+'% vs mes anterior)':''));
        L.push('Utilidad estimada: '+clp(a.util)+' | margen '+a.margen.toFixed(0)+'%');
        L.push('Pedidos: '+a.nped);
        if(metaM>0)L.push('Meta mensual: '+clp(metaM)+' â†’ cumplimiento '+Math.round(a.rev/metaM*100)+'%');
        if(a.conv!=null)L.push('ConversiÃ³n cotizaciones: '+a.conv.toFixed(0)+'%');
        return L.join('\n');
      }
      if(consulta==='top_clientes'){
        if(typeof _mesAgregado!=='function') return 'El mÃ³dulo de finanzas no estÃ¡ disponible.';
        const a=_mesAgregado(off),{label}=_mesRango(off);
        if(!a.top.length) return 'Sin datos de clientes para '+label+'.';
        return 'Top clientes por utilidad en '+label+':\n'+a.top.map((c,i)=>(i+1)+'. '+c.nombre+': utilidad '+clp(c.util)+' (venta '+clp(c.rev)+')').join('\n');
      }
      if(consulta==='cotizaciones_pendientes'){
        const cp=(s.cotizaciones||[]).filter(c=>['Enviada','Solicitada'].includes(c.fields['Estado cotizaciÃ³n']||''))
          .sort((a,b)=>(b.fields['Total final (CLP)']||0)-(a.fields['Total final (CLP)']||0));
        if(!cp.length) return 'No hay cotizaciones pendientes de respuesta.';
        const suma=cp.reduce((a,c)=>a+Math.round((c.fields['Total final (CLP)']||0)/1.19),0);
        return cp.length+' cotizaciÃ³n(es) pendiente(s) por '+clp(suma)m«ëŒ+Š×ž®º+º$zzb¥â²ræWFó¥Æâr¶7ç6Æ–6RƒÃ’æÖ†3Óç¶6öç7BcÖ2æf–VÆG3·&WGW&ârÒr²†e²tì+6÷F—¦6œ;6âu×ÇÂ~(	Br’²rÂr¶6Æ”æöÖ'&R„'&’æ—4'&’†e²t6Æ–VçFRuÒ“öe²t6Æ–VçFRuÕ³Ó¦e²t6Æ–VçFRuÒ’²rÂr²†e²tW7FFò6÷F—¦6œ;6âu×ÇÂ~(	Br’²rÂr¶6Ç„ÖF‚ç&÷VæB‚†e²uF÷FÂf–æÂ„4Å’u×ÇÃ’óã’’’²ræWFòs·Ò’æ¦ö–â‚uÆâr“°¢Ð¢–b†6öç7VÇFÓÓÒv–çfVçF&–õö&¦òr—°¢6öç7B–çc×2æ–çfVçF&–÷ÇÅµÓ°¢–b‚–çbæÆVæwF‚’&WGW&âtæò†’–çfVçF&–ò6&vFòâ:ÖFVÆRÂW7V&–ò'&—"Æ6V66œ;6â–çfVçF&–òâs°¢6öç7B&¦÷3Ö–çbæf–ÇFW"†ÓÓç·G'—·&WGW&â‡G—Vöbö–çdW7FFóÓÓÒvgVæ7F–öâsõö–çdW7FFò†Ò’ç6Wc£“ãÓ#·Ö6F6‚†R—·&WGW&âfÇ6S·×Ò“°¢–b‚&¦÷2æÆVæwF‚’&WGW&âuFöFòVÂ–çfVçF&–òW7L:Vâæ—fVÆW2ô²âs°¢&WGW&â&¦÷2æÆVæwF‚²rÖFW&–Â†W2’6öâ7Fö6²&¦òòv÷FFó¥Æâr¶&¦÷2æÖ†ÓÓç¶6öç7BcÖÒæf–VÆG3¶6öç7BS×G—Vöbö–çdW7FFóÓÓÒvgVæ7F–öâsõö–çdW7FFò†Ò“§·G‡C¢rwÓ·&WGW&ârÒr²†e²tÖFW&–Âu×ÇÂ~(	Br’²s¢r²†e²u7Fö6²7GVÂu×ÇÃ’²rr²†e²uVæ–FBu×ÇÂrr’²r‚r¶RçG‡B²r’s·Ò’æ¦ö–â‚uÆâr“°¢Ð¢–b†6öç7VÇFÓÓÒw&W7VÖVâr—°¢6öç7BFöF“ÖæWrFFR‚“·FöF’ç6WD†÷W'2ƒÃÃÃ“°¢6öç7BVC×2çVF–F÷7ÇÅµÓ¶6öç7B7F—f÷3×VBæf–ÇFW"‡Óâ²tFW76†FòrÂt6ö×ÆWFFòrÂt6æ6VÆFòuÒæ–æ6ÇVFW2‡æf–VÆG5²tW7FFòVF–Fòu×ÇÂrr’“°¢6öç7BCÖ7F—f÷2æf–ÇFW"‡Óç¶6öç7Bc×æf–VÆG7ÇÇ·Ó·&WGW&âe²tfV6†VçG&VvuÒbfæWrFFR†e²tfV6†VçG&VvuÒ²uC££r“ÇFöF“·Ò“°¢6öç7B6÷EVæCÒ‡2æ6÷F—¦6–öæW7ÇÅµÒ’æf–ÇFW"†3Óå²tVçf–FrÂu6öÆ–6—FFuÒæ–æ6ÇVFW2†2æf–VÆG5²tW7FFò6÷F—¦6œ;6âu×ÇÂrr’’æÆVæwFƒ°¢òòÆ6ö'&ç¦W'FVæV6Rf–æç¦3¢6’VÂ&öÂæòF–VæRW66V66œ;6âÂæð¢òò6RÆRVçG&VvVÂF÷FÂFRÆV×&W6÷"W7Fl:Öà¢ÆWB÷$6ö'&#ÖçVÆÃ°¢–b‚öb’G'—·÷$6ö'&#Ò‡G—Vöbf–ävWDÆÄf7GW&3ÓÓÒvgVæ7F–öâsöf–ävWDÆÄf7GW&2‚“¥µÒ’æf–ÇFW"‡#Óç"ç÷$6ö'&#ã’ç&VGV6R‚†Ç"“Óæ·"ç÷$6ö'&"Ã“·Ö6F6‚†R—·÷$6ö'&#Ó·Ð¢&WGW&âu&W7VÖVã¢r¶7F—f÷2æÆVæwF‚²rVF–F÷27F—f÷2‚r¶BæÆVæwF‚²rG&6F÷2’Âr¶6÷EVæB²r6÷F—¦6–öæW2VæF–VçFW2Âr¶6Ç‡÷$6ö'&"’²r÷"6ö'&"Âr²‡2æ6Æ–VçFW7ÇÅµÒ’æÆVæwF‚²r6Æ–VçFW2âs°¢Ð¢&WGW&ât6öç7VÇFæò&V6öæö6–Fâs°¢Ö6F6‚†R—²&WGW&âtæòVFR6ö×ÆWF"Æ6öç7VÇF¢r²†RbfRæÖW76vWÇÂrr“²Ð¢Ð¢òòV¦V7WFVæ†W'&Ö–VçF¢VfV7F÷26öÆFW&ÆW26VwW&÷2²FWgVVÇfRFW‡Fò&VÂFööÅ÷&W7VÇBà¢7–æ2gVæ7F–öâö¶”W†V5FööÂ†æÖRÆ–çWB—°¢–çWCÖ–çWGÇÇ·Ó°¢G'—°¢–b†æÖSÓÓÒvæfVv"r—²6öç7BÖöCÕ7G&–ær†–çWBæÖöGVÆ÷ÇÂrr’çFôÆ÷vW$66R‚’çG&–Ò‚“²–b‡G—Vöbv–æF÷rç7v—F6…F#ÓÓÒvgVæ7F–öâr’v–æF÷rç7v—F6…F"†ÖöB“²FD×6r‚vrÂtæfVvæFòr¶ÖöBçFõWW$66R‚’“²&WGW&âtæfVv6œ;6â&VÆ—¦Fr¶ÖöB²râs²Ð¢–b†æÖSÓÓÒv'&—%öf÷&×VÆ&–òr—²6öç7BF—óÕ7G&–ær†–çWBçF—÷ÇÂrr’çFôÆ÷vW$66R‚’çG&–Ò‚“²6öç7BÆ&VÇ3×¶6Æ–VçFS¢tçVWfòÆVBô6Æ–VçFRrÆ6÷F—¦6–öã¢tçVWf6÷F—¦6œ;6ârÇ&÷fVVF÷#¢tçVWfò&÷fVVF÷"rÇfVçF¢tçVWffVçFrÆF–&–ó¢tÆ–'&òF–&–òwÓ²FD×6r‚vrÂt'&–VæFòf÷&×VÆ&–ó¢r²†Æ&VÇ5·F—õ×ÇÇF—ò’“°¢–b‡F—óÓÓÒv6Æ–VçFRr’v–æF÷rç7v—F6…F"‚vçVWfòÖÆVBr“°¢VÇ6R–b‡F—óÓÓÒv6÷F—¦6–öâr’v–æF÷rç7v—F6…F"‚vçVWfÖ6÷Br“°¢VÇ6R–b‡F—óÓÓÒw&÷fVVF÷"r’v–æF÷rç7v—F6…F"‚vçVWfò×&÷fVVF÷"r“°¢VÇ6R–b‡F—óÓÓÒwfVçFr—²–b‡G—Vöb—$çVWffVçFÓÓÒvgVæ7F–öâr’—$çVWffVçF‚“²Ð¢VÇ6R–b‡F—óÓÓÒvF–&–òr—²–b‡G—Vöb—$Æ–'&ôF–&–óÓÓÒvgVæ7F–öâr’—$Æ–'&ôF–&–ò‚“²Ð¢&WGW&âtf÷&×VÆ&–òr²†Æ&VÇ5·F—õ×ÇÇF—ò’²r&–W'Fòâs²Ð¢–b†æÖSÓÓÒv6÷F—¦"r—²¥bå÷VæF–ætfÆ÷sÒv6÷F—¦"s²&WGW&âtVÂ6÷F—¦F÷"wV–Fò6R'&—,:†÷&âs²Ð¢–b†æÖSÓÓÒv6—7FVçFRr—²¥bå÷VæF–ætfÆ÷sÕ7G&–ær†–çWBçF—÷ÇÂrr’çFôÆ÷vW$66R‚’çG&–Ò‚—ÇÂv6Æ–VçFRs²&WGW&âtVÂ6—7FVçFRwV–Fò6R'&—,:†÷&âs²Ð¢–b†æÖSÓÓÒw7VvW&—%ö66–öæW2r—²6öç7B'3Ò†–çWBæ&÷FöæW7ÇÅµÒ’ç6Æ–6RƒÃ2’æf–ÇFW"†#Óæ"bf"çFW‡Fò’æÖ†#Óâ‡¶Æ&VÃ¦"çFW‡FòÆ6ÖC¦"æ6öÖæF÷ÇÆ"çFW‡F÷Ò’“²¥båö'Fç3Ò„¥båö'Fç7ÇÅµÒ’æ6öæ6B†'2“²&WGW&ât&÷FöæW2FR66œ;6âÖ÷7G&F÷2âs²Ð¢–b†æÖSÓÓÒv6öç7VÇF%ö7&Òr—²&WGW&âö¶”6öç7VÇF$5$Ò†–çWB“²Ð¢–b†æÖSÓÓÒvFVÆVv"r—°¢6öç7BvVçD–CÕ7G&–ær†–çWBævVçFWÇÂrr’çFõWW$66R‚’çG&–Ò‚“°¢–b„¥båöFVÆVvF–öç3ãÓ"’&WGW&âtÌ:ÖÖ—FRFRFVÆVv6–öæW2÷"GW&æòÆ6ç¦Fòâs°¢¥båöFVÆVvF–öç2²³°¢–b‡G—VöbtTåDU5ô4dsÓÓÒwVæFVf–æVBwÇÇG—Vöb6ÆÄ6ÆVFRÓÒvgVæ7F–öâr’&WGW&âtÆ÷2vVçFW2æòW7L:âF—7öæ–&ÆW2†÷&âs°¢6öç7B6fsÔtTåDU5ô4dræf–æB†Óææ–CÓÓÖvVçD–B“°¢–b‚6fr’&WGW&âtVÂvVçFRr¶vVçD–B²ræòW†—7FRâs°¢òò6FvVçFRW'FVæV6RVæ6V66œ;6ã²VÂ6†BæòVVFR6W"ÆVW'FFP¢òòG,:2&6÷'&W"VæòVRVÂ&öÂæòF–VæRVâÆ'&–ÆÆà¢–b‡G—VöbvVçFUf—6–&ÆSÓÓÒvgVæ7F–öârbbvVçFUf—6–&ÆR†6fr’’&WGW&âtW6RvVçFRW'FVæV6RVæ6V66œ;6âVRW7FRW7V&–òæòF–VæRâs°¢FD×6r‚vrÂtFVÆVvæFòr¶6fræÆ&VÂ²râââr“°¢6öç7B7GƒÒ‡G—Vöb'V–ÆDvVçD6öçFW‡CÓÓÒvgVæ7F–öârbgG—Vöb7FFRÓÒwVæFVf–æVBrbg7FFRæÆöFVB“ö'V–ÆDvVçD6öçFW‡B†vVçD–B“¢rs°¢6öç7B&W7VÇCÖv—B6ÆÄvVçD6ÆVFR†vVçD–BÆ6frç7—2Â†7Gƒö7G‚²uÆåÆä4ôå5TÅD¢s¢rr’²†–çWBæ–ç7G'V66–öçÇÂrr’“°¢G'—²–b‡G—VöbtTåEôÄôrÓÒwVæFVf–æVBr’tTåEôÄôræFB†6fræÆ&VÂÂt´“¢r²†–çWBæ–ç7G'V66–öçÇÂrr’Ç&W7VÇB“²Ö6F6‚†R—·Ð¢&WGW&âu&W7VÇFFòFRr¶6fræÆ&VÂ²s¥Æâr·&W7VÇC°¢Ð¢Ö6F6‚†R—²&WGW&âtW'&÷"V¦V7WFæFòr¶æÖR²s¢r²†RbfRæÖW76vWÇÂrr“²Ð¢&WGW&âvö²s°¢Ð ¢òò)H)H)H6²6ÆVFR‡&WW6W2F6†&ö&Bw2¶W’²VæGö–çB’)H)H)H ¢7–æ2gVæ7F–öâ6²‡W6W%FW‡B—°¢–b„¥bæ'W7’’&WGW&ã²òò&RÖVçG&F¢&Æ÷VVGW&çFRFöFÆÆÆÖF‡FÖ&œ:–âVâ7G&VÖ–ær¢¥bæ'W7“×G'VS²¥bçF†–æ¶–æs×G'VS²6WE7FFR‚wF†–æ¶–ærr“°¢¥bæ†—7F÷'’çW6‚‡·&öÆS¢wW6W"rÆ6öçFVçC§W6W%FW‡GÒ“° ¢6öç7BGG—ÖFD×6r‚v¢rÂrr“²GG—æ6Æ74Æ—7BæFB‚v§g2Ö7W'6÷"r“°¢òò6’ÆÆÆÖFæòÆÆVvvVæW&"&W7VW7FÂV—FVÂÖVç6¦RFRW7V&–ò6öÆvFó ¢òòFV¦&Æò&÷fö6,:ÖF÷2GW&æ÷2wW6W"r6VwV–F÷2’Æ’&W7öæFW,:ÖCà¢6öç7B÷W6W#Ò‚“Óç²–b„¥bæ†—7F÷'’æÆVæwF‚bb¥bæ†—7F÷'•´¥bæ†—7F÷'’æÆVæwF‚ÓÒç&öÆSÓÓÒwW6W"r’¥bæ†—7F÷'’ç÷‚“²Ó°¢6öç7B7G&ÃÖæWr&÷'D6öçG&öÆÆW"‚“²¥bæ7G&ÃÖ7G&Ã²ÆWBF–ÖVD÷WCÖfÇ6S°¢6öç7BFó×6WEF–ÖV÷WB‚‚“Óç²F–ÖVD÷WC×G'VS²G'—¶7G&Âæ&÷'B‚“·Ö6F6‚†R—·ÒÒÃc“° ¢G'—°¢òò6öâ&÷‡’6öæf–wW&FòÂÆ¶W’FRçF‡&÷–2f—fRVâVÂv÷&¶W"‡7G&VÖ–ær6–wVÂ¢6öç7B‚Ò‡G—Vöbv–æF÷rå÷&÷‡”6fsÓÓÒvgVæ7F–öâr’òv–æF÷rå÷&÷‡”6fr‚’¢çVÆÃ°¢òò&WW6RF6†&ö&Bw27F÷&VBçF‡&÷–2¶W¢ÆWB¶W’Ò‡G—Vöbv–æF÷rævWDçF‡&÷–4¶W“ÓÓÒvgVæ7F–öâr’òv–æF÷rævWDçF‡&÷–4¶W’‚’¢çVÆÃ°¢–b‚¶W’—²¶W’ÒÆö6Å7F÷&vRævWD—FVÒ‚vçF‡&÷–5ö¶W’r“²Ð¢òò7G&—æöâ×&–çF&ÆRÔ44”’6†'2F†B'&V²fWF6‚†VFW'2„•4òÓƒƒS’ÓVæf÷&6VÖVçB¢–b†¶W’’¶W’Ò¶W’ç&WÆ6R‚õµåÇƒ#ÕÇƒtUÒörÂrr’çG&–Ò‚“°¢–b‚‚bb‚¶W—ÇÆ¶W’ç7F'G5v—F‚‚rRRr—ÇÆ¶W“ÓÓÒwVæFVf–æVBr’—°¢6ÆV%F–ÖV÷WB‡Fò“²¥bæ7G&ÃÖçVÆÃ²÷W6W"‚“°¢GG—æ6Æ74Æ—7Bç&VÖ÷fR‚v§g2Ö7W'6÷"r“°¢GG—çFW‡D6öçFVçCÒtæò†’’¶W’6öæf–wW&Fâ6öæf–|;§&ÆFW6FRVÂF6†&ö&B†&÷L;6âFR§W7FW2’’gVVÇfR–çFVçF"âs°¢GG—ç&VçDVÆVÖVçBæ6Æ74æÖSÒv§g2Ö×6r§g2ÖRs°¢¥bæ'W7“ÖfÇ6S²¥bçF†–æ¶–æsÖfÇ6S²6WE7FFR‚v–FÆRr“²&WGW&ã°¢Ð ¢òò)H)HÆö÷|:–çF–6ò6öâ†W'&Ö–VçF2‡FööÂ×W6R’Vâ7G&VÖ–ær)H)H ¢òò¥bæ†—7F÷'’6RÖçF–VæR6öÖòÖVç6¦W2FRDU…Dò6–×ÆW2‡W'6—7FVæ6–÷&W7F÷&P¢òò–çF7F÷2’âÆ÷2&Æ÷VW2FööÅ÷W6R÷FööÅ÷&W7VÇBf—fVâ<;6ÆòVâv6öçfòrÆö6ÂFP¢òòW7FRGW&æó¢çVæ66RW'6—7FVâæ’6R&V6÷'FâVçG&RGW&æ÷2ÂWf—FæFòC÷ ¢òò&Æ÷VW2‡\:—&fæ÷2à¢¥båöFVÆVvF–öç3Ó²¥bå÷VæF–ætfÆ÷sÖçVÆÃ²¥båö'Fç3ÕµÓ²¥båö67VÓÒrs°¢6öç7B7G&—Fw3×3Óç2ç&WÆ6R‚õÅ²„ägÄåTUd÷ÄtTåDWÄdÅT¤÷Ä%Dâ“¥µåÅÕÒ¥ÅÒöv’Ârr’ç&WÆ6R‚õÅ´4õD•¤%ÅÒöv’Ârr’ç&WÆ6R‚õÅ²„ägÄåTUd÷ÄtTåDWÄdÅT¤÷Ä%Dâ“¥µåÅÕÒ¢Bö’Ârr“° ¢òòVæ&öæF¢7G&VÖVVâÖVç6¦RFVÂ6—7FVçFR„&Æö"&öG’÷"Væ–6öFRô•4òÓƒƒS’Ó¢òò6öâ&V–çFVçFòçFRW'&÷&W2G&ç6—F÷&–÷2âFWgVVÇfR·FW‡BÂFööÅW6W2Â7F÷&V6öçÒà¢7–æ2gVæ7F–öâ7G&VÕ&÷VæB†6öçfò—°¢6öç7B&W&öG“ÖæWr&Æö"…´¥4ôâç7G&–æv–g’‡²ÖöFVÃ¢v6ÆVFR×6öææWBÓBÓbrÂÖ…÷Fö¶Vç3£#BÂ7G&VÓ§G'VRÂ7—7FVÓ¥5•5ô$Äô4µ2‚’ÂFööÇ3¤´•õDôôÅ2ÂÖW76vW3¦6öçfòÒ•ÒÇ·G—S¢vÆ–6F–öâö§6öâwÒ“°¢6öç7B$UE%“Õ³C#’ÃSÃS"ÃS2ÃS#•Ó²ÆWB#ÖçVÆÃ°¢f÷"†ÆWBGFV×CÓ²GFV×CÃ2bbF–ÖVD÷WC²GFV×B²²—°¢#Öv—BfWF6‚‡‚ò‚çW&Â²röçF‡&÷–2÷cöÖW76vW2r¢v‡GG3¢òö’æçF‡&÷–2æ6öÒ÷cöÖW76vW2rÇ²ÖWF†öC¢uõ5BrÂ6–væÃ¦7G&Âç6–væÂÀ¢†VFW'3¢‚ò²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÂu‚ÔÔ¶W’s§‚æ¶W—Ð¢¢²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÂw‚Ö’Ö¶W’s¦¶W’ÂvçF‡&÷–2×fW'6–öâs¢s##2ÓbÓrÂvçF‡&÷–2ÖFævW&÷W2ÖF—&V7BÖ'&÷w6W"Ö66W72s¢wG'VRwÒÂ&öG“§&W&öG’Ò“°¢–b‡"æö²ÇÂ$UE%’æ–æ6ÇVFW2‡"ç7FGW2’ÇÂGFV×CÓÓÓ"’'&V³°¢GG—çFW‡D6öçFVçCÒu&V–çFVçFæFò6öæW†œ;6î(
bs°¢v—BæWr&öÖ—6R‡&W3Óç6WEF–ÖV÷WB‡&W2Ãs¢†GFV×B³’’“°¢Ð¢–b‚"æö²—²6öç7BSÖv—B"æ§6öâ‚’æ6F6‚‚‚“Óâ‡·Ò’“²–b‡"ç7FGW3ÓÓÓC—²Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚vçF‡&÷–5ö¶W’r“²6W76–öå7F÷&vRç&VÖ÷fT—FVÒ‚vçF‡&÷–5ö¶W’r“²ÒF‡&÷ræWrW'&÷"†RæW'&÷#òæÖW76vWÇÂ‚t’r·"ç7FGW2’“²Ð¢6öç7B&VFW#×"æ&öG’ævWE&VFW"‚“²6öç7BFV6öFW#ÖæWrFW‡DFV6öFW"‚“°¢ÆWB'VcÒrrÂFW‡CÒrrÂ7F÷&V6öãÒrs²6öç7B&Æö6·3×·Ó²ÆWB–åFö³ÓÆ÷WEFö³ÓÇW6vTÖWF×·Ó°¢v†–ÆR‡G'VR—°¢6öç7B¶FöæRÇfÇVWÓÖv—B&VFW"ç&VB‚“²–b†FöæR’'&V³°¢'Vb³ÖFV6öFW"æFV6öFR‡fÇVRÇ·7G&VÓ§G'VWÒ“°¢6öç7BÆ–æW3Ö'Vbç7Æ—B‚uÆâr“²'VcÖÆ–æW2ç÷‚—ÇÂrs°¢f÷"†6öç7BÆ–æRöbÆ–æW2—°¢6öç7BCÖÆ–æRçG&–Ò‚“²–b‚Bç7F'G5v—F‚‚vFF¢r’’6öçF–çVS°¢6öç7B–ÆöC×Bç6Æ–6RƒR’çG&–Ò‚“²–b‚–ÆöGÇÇ–ÆöCÓÓÒu´DôäUÒr’6öçF–çVS°¢ÆWBWc²G'—²WcÔ¥4ôâç'6R‡–ÆöB“²Ö6F6‚†R—²6öçF–çVS²Ð¢–b†WbçG—SÓÓÒvÖW76vU÷7F'Br—²W6vTÖWF×¶–C¦WbæÖW76vSòæ–BÆÖöFVÃ¦WbæÖW76vSòæÖöFVÂÇW6vS§²ââæWbæÖW76vSòçW6vW×Ó²–åFö³ÖWbæÖW76vSòçW6vSòæ–çWE÷Fö¶Vç7ÇÃ²Ð¢VÇ6R–b†WbçG—SÓÓÒv6öçFVçEö&Æö6µ÷7F'Br—²6öç7B6#ÖWbæ6öçFVçEö&Æö6·ÇÇ·Ó²&Æö6·5¶Wbæ–æFW…Ó×·G—S¦6"çG—RÆæÖS¦6"ææÖRÆ–C¦6"æ–BÇFW‡C¢rrÆ§6öã¢rwÓ²Ð¢VÇ6R–b†WbçG—SÓÓÒv6öçFVçEö&Æö6µöFVÇFr—°¢6öç7B#Ö&Æö6·5¶Wbæ–æFW…×ÇÂ†&Æö6·5¶Wbæ–æFW…Ó×·G—S¢wFW‡BrÇFW‡C¢rrÆ§6öã¢rwÒ“°¢–b†WbæFVÇFòçG—SÓÓÒwFW‡EöFVÇFr—²FW‡B³ÖWbæFVÇFçFW‡C²"çFW‡B³ÖWbæFVÇFçFW‡C²GG—çFW‡D6öçFVçCÒ„¥båö67VÓô¥båö67VÒ²uÆâs¢rr’·7G&—Fw2‡FW‡B“²FÆörç67&öÆÅF÷ÒFÆörç67&öÆÄ†V–v‡C²Ð¢VÇ6R–b†WbæFVÇFòçG—SÓÓÒv–çWEö§6öåöFVÇFr—²"æ§6öâ³ÖWbæFVÇFç'F–Åö§6öçÇÂrs²Ð¢Ð¢VÇ6R–b†WbçG—SÓÓÒvÖW76vUöFVÇFr—²–b†WbæFVÇFòç7F÷÷&V6öâ’7F÷&V6öãÖWbæFVÇFç7F÷÷&V6öã²–b†WbçW6vSòæ÷WGWE÷Fö¶Vç2’÷WEFö³ÖWbçW6vRæ÷WGWE÷Fö¶Vç3²Ð¢VÇ6R–b†WbçG—SÓÓÒvW'&÷"r—²F‡&÷ræWrW'&÷"†WbæW'&÷#òæÖW76vWÇÂtW'&÷"FR7G&VÒr“²Ð¢Ð¢Ð¢W6vTÖWFçW6vS×²ââçW6vTÖWFçW6vRÆ÷WGWE÷Fö¶Vç3¦÷WEFö·Ó°¢–b‡G—Vöb÷&V6÷&D6ÆVFUW6vSÓÓÒvgVæ7F–öâr’÷&V6÷&D6ÆVFUW6vR‡W6vTÖWFÂv¶’r“°¢ö¶•WFFUW6vR†–åFö²Æ÷WEFö²ÇW6vTÖWFçW6vRæ66†Uö7&VF–öåö–çWE÷Fö¶Vç7ÇÃÇW6vTÖWFçW6vRæ66†U÷&VEö–çWE÷Fö¶Vç7ÇÃ“°¢6öç7BFööÅW6W3Ôö&¦V7Bæ¶W—2†&Æö6·2’æÖ†³Óæ&Æö6·5¶µÒ’æf–ÇFW"†#Óæ"çG—SÓÓÒwFööÅ÷W6Rr’æÖ†#Óç²ÆWB–ç×·Ó²G'—²–çÖ"æ§6öãô¥4ôâç'6R†"æ§6öâ“§·Ó²Ö6F6‚†R—·Ò&WGW&â¶–C¦"æ–BÆæÖS¦"ææÖRÆ–çWC¦–çÓ²Ò“°¢&WGW&â²FW‡BÂFööÅW6W2Â7F÷&V6öâÓ°¢Ð ¢òò÷'VW7F&öæF2†7FVRVÂÖöFVÆòFV¦RFRVF—"†W'&Ö–VçF2‡F÷R2’à¢òòVâGW&æòæ÷&ÖÂW6Væ²G&W2Æ6ç¦â&6öç7VÇF(i"66œ;6â(i"&W7VÖVâà¢¥bçF†–æ¶–æsÖfÇ6S²6WE7FFR‚w7V¶–ærr“²GG—æ6Æ74Æ—7Bç&VÖ÷fR‚v§g2Ö7W'6÷"r“°¢ÆWB6öçfóÔ¥bæ†—7F÷'’ç6Æ–6R‚Ó‚’æÖ†ÓÓâ‡·&öÆS¦Òç&öÆRÆ6öçFVçC¦Òæ6öçFVçGÒ’“°¢ÆWBwV&CÓ°¢v†–ÆR†wV&B²³Ã2—°¢6öç7B&W3Öv—B7G&VÕ&÷VæB†6öçfò“°¢6öç7B6†÷vã×7G&—Fw2‡&W2çFW‡GÇÂrr’çG&–Ò‚“°¢–b‡6†÷vâ—²¥båö67VÒ³Ò„¥båö67VÓòuÆâs¢rr’·6†÷vã²GG—çFW‡D6öçFVçCÔ¥båö67VÓ²Ð¢–b‡&W2ç7F÷&V6öâÓÒwFööÅ÷W6RrÇÂ&W2çFööÅW6W2æÆVæwF‚’'&V³°¢6öçfòçW6‚‡²&öÆS¢v76—7FçBrÂ6öçFVçC¥²âââ‡&W2çFW‡Cõ··G—S¢wFW‡BrÇFW‡C§&W2çFW‡GÕÓ¥µÒ’Âââç&W2çFööÅW6W2æÖ‡CÓâ‡·G—S¢wFööÅ÷W6RrÆ–C§Bæ–BÆæÖS§BææÖRÆ–çWC§Bæ–çWGÒ’’ÒÒ“°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†6öç7BGRöb&W2çFööÅW6W2—²6öç7B÷WCÖv—Bö¶”W†V5FööÂ‡GRææÖRÇGRæ–çWB“²&W7VÇG2çW6‚‡·G—S¢wFööÅ÷&W7VÇBrÇFööÅ÷W6Uö–C§GRæ–BÆ6öçFVçC¥7G&–ær†÷WCÓÖçVÆÃòvö²s¦÷WB—Ò“²Ð¢6öçfòçW6‚‡²&öÆS¢wW6W"rÂ6öçFVçC§&W7VÇG2Ò“°¢6WE7FFR‚wF†–æ¶–ærr“°¢Ð¢6ÆV%F–ÖV÷WB‡Fò“²¥bæ7G&ÃÖçVÆÃ° ¢òò6ö×C¢&ö6W67VÇV–W"WF—VWF†W&VFF²&W6W'f&÷FöæW2FRÆ†W'&Ö–VçF¢6öç7B÷FööÄ'Fç3Ò„¥båö'Fç7ÇÅµÒ’ç6Æ–6R‚“°¢6öç7B6ÆVãÖW†V47F–öç2„¥båö67V×ÇÂtÆ—7Fòâr“°¢¥båö'Fç3Õ÷FööÄ'Fç2æ6öæ6B„¥båö'Fç7ÇÅµÒ“°¢GG—æ–ææW$…DÔÃÖf÷&ÖE&–6…FW‡B†6ÆVçÇÂtÆ—7Fòâr“°¢ö¶•&VæFW$'WGFöç2„¥båö'Fç2“°¢FÆörç67&öÆÅF÷ÒFÆörç67&öÆÄ†V–v‡C°¢¥bæ†—7F÷'’çW6‚‡·&öÆS¢v76—7FçBrÆ6öçFVçC¢†6ÆVçÇÂtÆ—7Fòâr—Ò“°¢–b„¥bæ†—7F÷'’æÆVæwFƒã’¥bæ†—7F÷'“Ô¥bæ†—7F÷'’ç6Æ–6R‚Ó‚“°¢ö¶•W'6—7B‚“°¢¥bæ'W7“ÖfÇ6S° ¢òòÆç¦VÂfÇV¦òwV–FòVæF–VçFR†6÷F—¦"ö6—7FVçFR’G&26W'&"VÂGW&æòà¢òò6–W'&VÂæVÂ&–ÖW&òÂÇVVvò†&Æ†VÂEE26–wVRG&26W'&"’’'&RVÂfÇV¦òà¢–b„¥bå÷VæF–ætfÆ÷r—°¢6öç7BcÔ¥bå÷VæF–ætfÆ÷s²¥bå÷VæF–ætfÆ÷sÖçVÆÃ°¢6Æ÷6UæVÂ‚“°¢–b‚Gfö–6UFövvÆRæ6†V6¶VB’7V²†6ÆVâ“°¢6WEF–ÖV÷WB‚‚“Óç²–b‡cÓÓÒv6÷F—¦"r—²–b‡v–æF÷rç7F'EV÷FTfÆ÷r’v–æF÷rç7F'EV÷FTfÆ÷r‚“²ÒVÇ6R²ö¶”ÆVæ6„fÆ÷r‡b“²ÒÒÃS“°¢&WGW&ã°¢Ð¢–b‚Gfö–6UFövvÆRæ6†V6¶VB’7V²†6ÆVâ“²VÇ6R²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²Ð ¢Ö6F6‚†W'"—°¢6ÆV%F–ÖV÷WB‡Fò“²¥bæ7G&ÃÖçVÆÃ²÷W6W"‚“°¢¥bæ'W7“ÖfÇ6S²¥bçF†–æ¶–æsÖfÇ6S°¢–b†W'"bbW'"ææÖSÓÓÒt&÷'DW'&÷"rbbF–ÖVD÷WB—°¢òòVÂW7V&–ò6W',;2VÂæVÂÖ—FC¢Æ–×–VÂÖVç6¦R6–âÖ÷7G&"W'&÷ ¢6öç7BÒGG—ç&VçDVÆVÖVçC²–b‡bgç&VçDVÆVÖVçB’ç&VçDVÆVÖVçBç&VÖ÷fT6†–ÆB‡“°¢&WGW&ã°¢Ð¢GG—æ6Æ74Æ—7Bç&VÖ÷fR‚v§g2Ö7W'6÷"r“°¢GG—çFW‡D6öçFVçCÒ†W'"bfW'"ææÖSÓÓÒt&÷'DW'&÷"r“òtÆ&W7VW7FF&L;2FVÖ6–Fòâ–çFVçFFRçVWfòâs¢‚tW'&÷"FR6öæW†œ;6ã¢r²†W'"bfW'"æÖW76vWÇÂrr’“°¢GG—ç&VçDVÆVÖVçBæ6Æ74æÖSÒv§g2Ö×6r§g2ÖRs°¢6WE7FFR‚v–FÆRr“°¢Ð¢Ð ¢òò)H)H)HEE2)H)H)H ¢7–æ2gVæ7F–öâ7V²‡FW‡B—°¢–b‚FW‡B—²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²&WGW&ã²Ð¢6öç7B6ÆVã×FW‡Bç&WÆ6R‚õ²¥ò6ÒörÂrr’ç&WÆ6R‚õµÇW³c3ÒÕÇW³ddgÕÇW³#cÒÕÇW³#t$gÕÒöwRÂrr’çG&–Ò‚“°¢–b‚6ÆVâ—²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²&WGW&ã²Ð¢òòVÆWfVäÆ'2&VÖ—VÒEE0¢6öç7BVÄ¶W“ÖÆö6Å7F÷&vRævWD—FVÒ‚vVÆWfVæÆ'5ö¶W’r—ÇÂ…ôDTdTÅE2äTÄUdTäÄ%2bbôDTdTÅE2äTÄUdTäÄ%2ç7F'G5v—F‚‚rRRr“õôDTdTÅE2äTÄUdTäÄ%3¢rr“°¢–b†VÄ¶W’—°¢G'—°¢6WE7FFR‚w7V¶–ærr“°¢6öç7Bfö–6T–CÖÆö6Å7F÷&vRævWD—FVÒ‚vVÆWfVæÆ'5÷fö–6Uö–Br—ÇÂt6Äæ–d4Ug6Ö¶ÃDÓ6F²s°¢6öç7B#Öv—BfWF6‚†‡GG3¢òö’æVÆWfVæÆ'2æ–ò÷c÷FW‡B×Fò×7VV6‚òG·fö–6T–GÖÇ°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3§²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÂw†’Ö’Ö¶W’s¦VÄ¶W—ÒÀ¢&öG“¤¥4ôâç7G&–æv–g’‡·FW‡C¦6ÆVâÆÖöFVÅö–C¢vVÆWfVåö×VÇF–Æ–æwVÅ÷c"rÇfö–6U÷6WGF–æw3§·7F&–Æ—G“£ãRÇ6–Ö–Æ&—G•ö&ö÷7C£ãsW×Ò¢Ò“°¢–b‡"æö²—°¢6öç7B&Æö#Öv—B"æ&Æö"‚“°¢6öç7BW&ÃÕU$Âæ7&VFTö&¦V7EU$Â†&Æö"“°¢6öç7BVF–óÖæWrVF–ò‡W&Â“°¢VF–òæöæVæFVCÒ‚“Óç²U$Âç&Wfö¶Tö&¦V7EU$Â‡W&Â“²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²Ó°¢VF–òæöæW'&÷#Ò‚“Óç²U$Âç&Wfö¶Tö&¦V7EU$Â‡W&Â“²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²Ó°¢v—BVF–òçÆ’‚’æ6F6‚‚‚“Óç·Ò“°¢&WGW&ã°¢ÒVÇ6R°¢6öç7BW'$FFÖv—B"æ§6öâ‚’æ6F6‚‚‚“Óâ‡·Ò’“°¢6öç7B×6sÖW'$FFòæFWF–ÃòæÖW76vWÇÆW'$FFòæFWF–ÇÇÂ‚t…EEr·"ç7FGW2“°¢–b‡G—VöbFö7CÓÓÒvgVæ7F–öâr’Fö7B‚tVÆWfVäÆ'3¢r¶×6rÂvW'&÷"r“°¢Ð¢Ö6F6‚†R—²–b‡G—VöbFö7CÓÓÒvgVæ7F–öâr’Fö7B‚tVÆWfVäÆ'3¢r¶RæÖW76vRÂvW'&÷"r“²Ð¢Ð¢òòfÆÆ&6³¢f÷¢FVÂæfVvF÷ ¢–b‚¥bç7–çF‚—²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²&WGW&ã²Ð¢¥bç7–çF‚æ6æ6VÂ‚“°¢6öç7BSÖæWr7VV6…7–çF†W6—5WGFW&æ6R†6ÆVâ“°¢RæÆæsÒvW2Ô4Âs²Rç&FSÓãc²Rç—F6ƒÒã“S°¢6öç7Bg3Ô¥bç7–çF‚ævWEfö–6W2‚“°¢6öç7Bc×g2æf–æB‡ƒÓç‚æÆærç7F'G5v—F‚‚vW2r’bbövöövÆRö’çFW7B‡‚ææÖR’—ÇÇg2æf–æB‡ƒÓç‚æÆærç7F'G5v—F‚‚vW2r’“°¢–b‡b’Rçfö–6S×c°¢Ræöç7F'CÒ‚“Óç6WE7FFR‚w7V¶–ærr“°¢RæöæVæCÒ‚“Óç²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²Ó°¢RæöæW'&÷#Ò‚“Óç²6WE7FFR‚v–FÆRr“²Ö–&U&VÆ—7FVâ‚“²Ó°¢¥bç7–çF‚ç7V²‡R“°¢Ð ¢gVæ7F–öâÖ–&U&VÆ—7FVâ‚—²–b„¥bæWFôÆ—7FVâbb¥bæ÷Vâbb¥bçF†–æ¶–ær—²6WEF–ÖV÷WB‡7F'DÆ—7FVâÃC“²ÒÐ ¢òò)H)H)H5EB)H)H)H ¢gVæ7F–öâ–æ—E&V2‚—°¢6öç7B5#×v–æF÷rå7VV6…&V6övæ—F–öçÇÇv–æF÷rçvV&¶—E7VV6…&V6övæ—F–öã°¢–b‚5"’&WGW&âçVÆÃ°¢6öç7B&V3ÖæWr5"‚“°¢&V2æÆæsÒvW2Ô4Âs²&V2æ–çFW&–Õ&W7VÇG3×G'VS²&V2æÖ„ÇFW&æF—fW3Ó²&V2æ6öçF–çV÷W3ÖfÇ6S°¢&V2æöç7F'CÒ‚“Óç²¥bæÆ—7FVæ–æs×G'VS²6WE7FFR‚vÆ—7FVæ–ærr“²Ó°¢&V2æöç&W7VÇCÒ†Wb“Óç°¢6öç7B–çFW&–ÓÔ'&’æg&öÒ†Wbç&W7VÇG2’æÖ‡#Óç%³ÒçG&ç67&—B’æ¦ö–â‚rr“°¢F–çWBçfÇVSÖ–çFW&–Ó°¢6öç7BÆ7CÖWbç&W7VÇG5¶Wbç&W7VÇG2æÆVæwF‚ÓÓ°¢–b†Æ7Bæ—4f–æÂ—°¢6öç7BCÖÆ7E³ÒçG&ç67&—BçG&–Ò‚“°¢F–çWBçfÇVSÒrs°¢–b‡B—²FD×6r‚wRrÇB“²6²‡B“²Ð¢Ð¢Ó°¢&V2æöæW'&÷#Ò†Wb“Óç²¥bæÆ—7FVæ–æsÖfÇ6S²–b†WbæW'&÷"ÓÒv&÷'FVBrbfWbæW'&÷"ÓÒvæò×7VV6‚r’FD×6r‚vRrÂtÖ–7,;6föæó¢r¶WbæW'&÷"“²–b‚¥bçF†–æ¶–ær’6WE7FFR‚v–FÆRr“²Ó°¢&V2æöæVæCÒ‚“Óç²¥bæÆ—7FVæ–æsÖfÇ6S²–b‚¥bçF†–æ¶–ærbb¥bç7V¶–ær’6WE7FFR‚v–FÆRr“²Ó°¢&WGW&â&V3°¢Ð ¢gVæ7F–öâ7F'DÆ—7FVâ‚—°¢–b„¥bçF†–æ¶–æwÇÄ¥bç7V¶–æwÇÄ¥bæÆ—7FVæ–ær’&WGW&ã°¢–b‚¥bç&V2’¥bç&V3Ö–æ—E&V2‚“°¢–b‚¥bç&V2—²FD×6r‚vRrÂu&V6öæö6–Ö–VçFòFRf÷¢æòF—7öæ–&ÆRâW66‡&öÖRòVFvRâr“²&WGW&ã²Ð¢G'—²¥bç7–çF‚æ6æ6VÂ‚“²¥bç&V2ç7F'B‚“²Ö6F6‚†R—·Ð¢Ð¢gVæ7F–öâ7F÷Æ—7FVâ‚—²–b„¥bç&V2bd¥bæÆ—7FVæ–ær—²G'—´¥bç&V2ç7F÷‚“·Ö6F6‚†R—·ÒÒÐ ¢òòÖ–3¢FFòFövvÆP¢FÖ–2æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚“Óç²¥bæÆ—7FVæ–æs÷7F÷Æ—7FVâ‚“§7F'DÆ—7FVâ‚“²Ò“° ¢òò)H)H)HFW‡B6VæB)H)H)H ¢gVæ7F–öâ6VæB‚—²6öç7BCÒF–çWBçfÇVRçG&–Ò‚“²–b‚B—&WGW&ã²F–çWBçfÇVSÒrs²FD×6r‚wRrÇB“²6²‡B“²Ð¢G6VæBæFDWfVçDÆ—7FVæW"‚v6Æ–6²rÇ6VæB“°¢F–çWBæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÆSÓç²–b†Ræ¶W“ÓÓÒtVçFW"r’6VæB‚“²Ò“° ¢òò)H)H)H6†—2)H)H)H ¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚ræ§g2Ö6†—r’æf÷$V6‚†3Óç°¢2æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚“Óç²–b†2æFF6WBæ7F–öãÓÓÒwV÷FRr—²6Æ÷6UæVÂ‚“²–b‡v–æF÷rç7F'EV÷FTfÆ÷r’v–æF÷rç7F'EV÷FTfÆ÷r‚“²&WGW&ã²Ò6öç7B6ÖCÖ2æFF6WBæ6ÖC²FD×6r‚wRrÆ6ÖB“²6²†6ÖB“²Ò“°¢Ò“° ¢òò)H)H)H6WGF–æw2)H)H)H ¢FWFôÆ—7FVâæ