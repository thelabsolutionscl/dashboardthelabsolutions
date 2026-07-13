/* js/kai.js — asistente KAI (extraído de index.html). */

(function(){
  'use strict';

  const JV = {
    open:false, listening:false, thinking:false, speaking:false, busy:false, ctrl:null,
    rec:null, synth:window.speechSynthesis, history:[], autoListen:false,
    usage:{in:0,out:0}, _btns:[], _delegations:0, _lastDeleg:'', _proactiveAt:0,
  };

  // ─── Refs ───
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

  // ─── Live dashboard context builder ───
  function buildContext(){
    try{
      const s = window.state || {};
      const ped = s.pedidos || [];
      const cot = s.cotizaciones || [];
      const cli = s.clientes || [];
      const cliById = s.clientesById || {};
      const today = new Date(); today.setHours(0,0,0,0);

      const resolveCli = f => {
        if(!f) return '—';
        if(typeof f==='string') return f;
        if(Array.isArray(f)&&f.length) return cliById[f[0]]||'(cliente)';
        return '—';
      };

      const activos = ped.filter(p=>!['Despachado','Cancelado'].includes(p.fields?.['Estado pedido']||''));
      const atrasados = ped.filter(p=>{const f=p.fields||{};if(['Despachado','Cancelado'].includes(f['Estado pedido']||''))return false;return f['Fecha entrega']&&new Date(f['Fecha entrega'])<today;});
      const cotPend = cot.filter(c=>['Enviada','Solicitada'].includes(c.fields?.['Estado cotización']||''));
      const revTotal = ped.reduce((a,p)=>a+Math.round((p.fields?.['Monto total (CLP)']||0)/1.19),0);

      // Finanzas (cobranza), proveedores y máquinas — contexto extra
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
          maqLine='\n- Máquinas: '+MAQUINAS.length+' | Imprimiendo: '+impr+' | Con alerta de mantención: '+mant;
        }
      }catch(e){}

      const pedRows = activos.slice(0,10).map(p=>{
        const f=p.fields||{};
        return `  • ${f['N° Pedido']||'—'} | ${resolveCli(f['Cliente'])} | ${f['Estado pedido']||'—'} | $${Math.round((f['Monto total (CLP)']||0)/1.19).toLocaleString('es-CL')} neto | Entrega: ${f['Fecha entrega']||'sin fecha'}`;
      }).join('\n');

      const cotRows = cotPend.slice(0,10).map(c=>{
        const f=c.fields||{};
        return `  • Cot ${f['N° Cotización']||'—'} | ${resolveCli(f['Cliente'])} | ${f['Estado cotización']||'—'} | $${Math.round((f['Total final (CLP)']||0)/1.19).toLocaleString('es-CL')} neto`;
      }).join('\n');

      return `DATOS EN VIVO DEL DASHBOARD (${new Date().toLocaleString('es-CL')}):
- Pedidos totales: ${ped.length} | Activos: ${activos.length} | Atrasados: ${atrasados.length}
- Cotizaciones totales: ${cot.length} | Pendientes de respuesta: ${cotPend.length}
- Clientes registrados: ${cli.length}
- Ingresos netos acumulados: $${revTotal.toLocaleString('es-CL')} CLP
- Cobranza: ${porCobrar.length} facturas por cobrar ($${sumCobrar.toLocaleString('es-CL')}) | ${vencidas.length} vencidas
- Proveedores: ${prov.length} (${provAct} activos)${maqLine}

PEDIDOS ACTIVOS:
${pedRows||'  (ninguno)'}

COTIZACIONES PENDIENTES:
${cotRows||'  (ninguna)'}`;
    }catch(e){ return 'Datos del dashboard no disponibles en este momento.'; }
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
  - delegar(agente, instruccion): delega a un agente y recibes su resultado para resumirlo. Agentes: SALES, QUOTE, PRODUCTION, QA, FOLLOWUP, CEO, LEADGEN, FINANCE, ONBOARDING, REPCLIENTE, CONTENT, ADS, SOCIAL_STRATEGIST, CAPTION_AGENT, COMMUNITY_AGENT, SOCIAL_ADS_AGENT, TREND_AGENT, REPORT_SOCIAL_AGENT. Usalo cuando pidan redactar, cotizar, generar checklist, reporte, analisis o contenido de redes sociales.
  - sugerir_acciones(botones): cuando sea util, ofrece 1 a 3 botones de seguimiento; cada boton tiene texto (2-4 palabras que ve el usuario) y comando (lo que recibirias si lo pulsa).
- Acompana SIEMPRE el uso de una herramienta con una frase breve hablada que diga lo que estas haciendo.
- Usa los DATOS EN VIVO del dashboard (que recibes a continuacion) para responder sobre pedidos/cotizaciones/clientes.
- Tono confiado, eficiente, tipo asistente ejecutivo. Nunca digas que eres un modelo de lenguaje.`;
  // Compat: SYS() devuelve el system completo como string (reglas + contexto en vivo).
  const SYS = () => SYS_RULES()+'\n\n'+buildContext();
  // System en bloques: reglas estaticas con cache_control (prompt caching) + contexto dinamico.
  const SYS_BLOCKS = () => [
    {type:'text', text:SYS_RULES(), cache_control:{type:'ephemeral'}},
    {type:'text', text:buildContext()}
  ];

  // ─── UI helpers ───
  function setState(mode){
    $fab.className=''; $mic.classList.remove('jvs-rec');
    const map={listening:'ESCUCHANDO...',thinking:'PROCESANDO...',speaking:'RESPONDIENDO...',idle:'EN ESPERA'};
    $state.textContent=map[mode]||'EN ESPERA';
    if(mode==='listening'){ $fab.classList.add('jvs-active','jvs-listening'); $mic.classList.add('jvs-rec'); }
    else if(mode==='thinking'){ $fab.classList.add('jvs-thinking'); }
    else if(mode==='speaking'){ $fab.classList.add('jvs-active'); }
    if($topkai) $topkai.classList.toggle('kai-busy', mode==='thinking'||mode==='speaking');
  }

  // ── Contador de tokens / costo estimado de la sesión (#8) ──
  function _kaiUpdateUsage(inTok,outTok){
    if(!$usage) return;
    JV.usage.in += (+inTok||0); JV.usage.out += (+outTok||0);
    // claude-sonnet-4-6: ~US$3 / millón entrada, ~US$15 / millón salida
    const usd = JV.usage.in/1e6*3 + JV.usage.out/1e6*15;
    const tot = JV.usage.in + JV.usage.out;
    $usage.style.display='';
    $usage.textContent = '≈ '+tot.toLocaleString('es-CL')+' tok · US$'+usd.toFixed(usd<0.01?4:3);
  }

  // ── Botones de acción rápida bajo una respuesta (#5) ──
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
    const lbl={u:'TÚ',j:'KAI',a:'ACCIÓN',e:'ERROR'}[role];
    const d=document.createElement('div');
    d.className='jvs-msg '+cls;
    const ls=document.createElement('span');ls.className='jvs-lbl';ls.textContent=lbl;
    const ts=document.createElement('span');ts.className='jvs-txt';ts.textContent=text;
    d.appendChild(ls);d.appendChild(ts);
    $log.appendChild(d); $log.scrollTop=$log.scrollHeight;
    return ts;
  }

  // ── Persistencia de conversación (sobrevive a recargas dentro de la sesión) ──
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
  // Lanza un asistente guiado por nombre (acción [FLUJO:tipo] de KAI)
  function _kaiLaunchFlow(t){
    const map={cliente:window.startNewClientFlow,lead:window.startNewClientFlow,proveedor:window.startNewProveedorFlow,pago:window.startPaymentFlow,abono:window.startPaymentFlow,mantencion:window.startMaintFlow,'mantención':window.startMaintFlow,cotizar:window.startQuoteFlow,cotizacion:window.startQuoteFlow,'cotización':window.startQuoteFlow};
    const fn=map[t];if(typeof fn==='function')fn();
  }

  // ─── Panel open/close ───
  function _ctxSuggest(){
    const chip=document.getElementById('jvs-ctx-chip');if(!chip)return;
    let tab='';try{tab=sessionStorage.getItem('thelab_active_tab')||'';}catch(e){}
    const map={
      clientes:{label:'➕ Nuevo cliente',fn:window.startNewClientFlow},
      cotizaciones:{label:'💰 Cotizar',fn:window.startQuoteFlow},
      overview:{label:'💰 Cotizar',fn:window.startQuoteFlow},
      proveedores:{label:'➕ Nuevo proveedor',fn:window.startNewProveedorFlow},
      maquinas:{label:'🔧 Registrar mantención',fn:window.startMaintFlow},
      finanzas:{label:'💵 Registrar pago',fn:window.startPaymentFlow},
    };
    const s=map[tab];
    if(s&&typeof s.fn==='function'){chip.textContent=s.label;chip.style.display='';chip.onclick=()=>{closePanel();s.fn();};}
    else{chip.style.display='none';chip.onclick=null;}
  }
  // Alertas proactivas al abrir el panel (#9): resume lo urgente sin gastar API.
  function _kaiProactiveAlerts(){
    try{
      const now=Date.now();
      if(now-JV._proactiveAt < 10*60*1000) return;   // máx. 1 cada 10 min
      const s=window.state||{};
      const ped=s.pedidos||[], cot=s.cotizaciones||[], fac=s.facturas||[];
      const today=new Date(); today.setHours(0,0,0,0);
      const atrasados=ped.filter(p=>{const f=p.fields||{};if(['Despachado','Cancelado'].includes(f['Estado pedido']||''))return false;return f['Fecha entrega']&&new Date(f['Fecha entrega'])<today;}).length;
      const vencidas=fac.filter(x=>x.fields&&(x.fields['Estado Pago']||'')==='Vencida').length;
      const cotPend=cot.filter(c=>['Enviada','Solicitada'].includes(c.fields?.['Estado cotización']||'')).length;
      const parts=[];
      if(atrasados) parts.push(atrasados+(atrasados===1?' pedido atrasado':' pedidos atrasados'));
      if(vencidas) parts.push(vencidas+(vencidas===1?' factura vencida':' facturas vencidas'));
      if(cotPend) parts.push(cotPend+(cotPend===1?' cotización sin respuesta':' cotizaciones sin respuesta'));
      if(!parts.length) return;
      JV._proactiveAt=now;
      addMsg('a','Alertas: '+parts.join(' · '));
    }catch(e){}
  }
  function openPanel(){ JV.open=true; $panel.classList.add('jvs-open'); _ctxSuggest(); _kaiProactiveAlerts(); if(window.innerWidth>768) setTimeout(()=>$input.focus(),200); }
  function closePanel(){ JV.open=false; $panel.classList.remove('jvs-open'); stopListen(); JV.synth.cancel(); if(JV.ctrl){try{JV.ctrl.abort();}catch(e){}JV.ctrl=null;} JV.busy=false; JV.thinking=false; setState('idle'); }
  $fab.addEventListener('click',()=>{ JV.open?closePanel():openPanel(); });
  $close.addEventListener('click',closePanel);

  // ─── Actions parser (navigation + new records) ───
  function execActions(text){
    let m;
    JV._delegations=0;           // reinicia tope de delegaciones por respuesta (#2)
    // Botones de acción rápida (#5): [BTN:texto|comando]
    JV._btns=[];
    const reBtn=/\[BTN:\s*([^\|\]]+?)\s*(?:\|\s*([^\]]+?))?\s*\]/gi;
    while((m=reBtn.exec(text))!==null){ JV._btns.push({label:m[1].trim(), cmd:(m[2]||m[1]).trim()}); }
    text=text.replace(/\[BTN:[^\]]*\]/gi,'');
    const reNav=/\[NAV:\s*([a-záéíóúñ\-]+)\]/gi;
    let cleaned=text.replace(reNav,'').trim();
    while((m=reNav.exec(text))!==null){
      const target=m[1].toLowerCase().trim();
      if(typeof window.switchTab==='function'){
        try{ window.switchTab(target); addMsg('a',`Navegando a ${target.toUpperCase()}`); }
        catch(e){ addMsg('a',target.toUpperCase()); }
      }
    }
    const reNuevo=/\[NUEVO:\s*([a-záéíóúñ\-]+)\]/gi;
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
    const fm=text.match(/\[FLUJO:\s*([a-záéíóúñ\-]+)\]/i);
    if(fm){ cleaned=cleaned.replace(/\[FLUJO:[^\]]*\]/gi,'').trim(); const t=fm[1].toLowerCase().trim(); closePanel(); setTimeout(()=>_kaiLaunchFlow(t),150); }
    return cleaned;
  }

  // ─── Delegación a agentes especializados ───
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
      const result=await callClaude(cfg.sys,fullInput);
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

  // ─── Herramientas (tool-use) que KAI puede invocar ───
  const KAI_TOOLS = [
    {name:'navegar', description:'Cambia el dashboard a un módulo concreto.', input_schema:{type:'object',properties:{modulo:{type:'string',enum:['overview','clientes','cotizaciones','pedidos','proveedores','agentes','maquinas','equipo','reporte','web','finanzas','visual','remuneraciones']}},required:['modulo']}},
    {name:'abrir_formulario', description:'Abre un formulario de creación de un nuevo registro.', input_schema:{type:'object',properties:{tipo:{type:'string',enum:['cliente','cotizacion','proveedor','venta','diario']}},required:['tipo']}},
    {name:'cotizar', description:'Abre el cotizador guiado paso a paso para armar un presupuesto.', input_schema:{type:'object',properties:{}}},
    {name:'asistente', description:'Abre un asistente guiado paso a paso.', input_schema:{type:'object',properties:{tipo:{type:'string',enum:['cliente','proveedor','pago','mantencion','cotizar']}},required:['tipo']}},
    {name:'delegar', description:'Delega una tarea a un agente especializado (redactar, cotizar, checklist, reporte, análisis, contenido de redes) y devuelve su resultado para que lo resumas.', input_schema:{type:'object',properties:{agente:{type:'string',enum:['SALES','QUOTE','PRODUCTION','QA','FOLLOWUP','CEO','LEADGEN','FINANCE','ONBOARDING','REPCLIENTE','CONTENT','ADS','SOCIAL_STRATEGIST','CAPTION_AGENT','COMMUNITY_AGENT','SOCIAL_ADS_AGENT','TREND_AGENT','REPORT_SOCIAL_AGENT']},instruccion:{type:'string',description:'Instrucción detallada con todo el contexto necesario.'}},required:['agente','instruccion']}},
    {name:'sugerir_acciones', description:'Muestra 1 a 3 botones de acción rápida bajo tu respuesta.', input_schema:{type:'object',properties:{botones:{type:'array',maxItems:3,items:{type:'object',properties:{texto:{type:'string',description:'2-4 palabras que ve el usuario'},comando:{type:'string',description:'Instrucción que recibirías si lo pulsa'}},required:['texto','comando']}}},required:['botones']}}
  ];
  // Ejecuta una herramienta: efectos colaterales seguros + devuelve texto para el tool_result.
  async function _kaiExecTool(name,input){
    input=input||{};
    try{
      if(name==='navegar'){ const mod=String(input.modulo||'').toLowerCase().trim(); if(typeof window.switchTab==='function') window.switchTab(mod); addMsg('a','Navegando a '+mod.toUpperCase()); return 'Navegación realizada a '+mod+'.'; }
      if(name==='abrir_formulario'){ const tipo=String(input.tipo||'').toLowerCase().trim(); const labels={cliente:'Nuevo Lead/Cliente',cotizacion:'Nueva Cotización',proveedor:'Nuevo Proveedor',venta:'Nueva Venta',diario:'Libro Diario'}; addMsg('a','Abriendo formulario: '+(labels[tipo]||tipo));
        if(tipo==='cliente') window.switchTab('nuevo-lead');
        else if(tipo==='cotizacion') window.switchTab('nueva-cot');
        else if(tipo==='proveedor') window.switchTab('nuevo-proveedor');
        else if(tipo==='venta'){ if(typeof irANuevaVenta==='function') irANuevaVenta(); }
        else if(tipo==='diario'){ if(typeof irALibroDiario==='function') irALibroDiario(); }
        return 'Formulario '+(labels[tipo]||tipo)+' abierto.'; }
      if(name==='cotizar'){ JV._pendingFlow='cotizar'; return 'El cotizador guiado se abrirá ahora.'; }
      if(name==='asistente'){ JV._pendingFlow=String(input.tipo||'').toLowerCase().trim()||'cliente'; return 'El asistente guiado se abrirá ahora.'; }
      if(name==='sugerir_acciones'){ const bs=(input.botones||[]).slice(0,3).filter(b=>b&&b.texto).map(b=>({label:b.texto,cmd:b.comando||b.texto})); JV._btns=(JV._btns||[]).concat(bs); return 'Botones de acción mostrados.'; }
      if(name==='delegar'){
        const agentId=String(input.agente||'').toUpperCase().trim();
        if(JV._delegations>=2) return 'Límite de delegaciones por turno alcanzado.';
        JV._delegations++;
        if(typeof AGENTES_CFG==='undefined'||typeof callClaude!=='function') return 'Los agentes no están disponibles ahora.';
        const cfg=AGENTES_CFG.find(a=>a.id===agentId);
        if(!cfg) return 'El agente '+agentId+' no existe.';
        addMsg('a','Delegando a '+cfg.label+'...');
        const ctx=(typeof buildAgentContext==='function'&&typeof state!=='undefined'&&state.loaded)?buildAgentContext(agentId):'';
        const result=await callClaude(cfg.sys,(ctx?ctx+'\n\nCONSULTA: ':'')+(input.instruccion||''));
        try{ if(typeof AGENT_LOG!=='undefined') AGENT_LOG.add(cfg.label,'KAI: '+(input.instruccion||''),result); }catch(e){}
        return 'Resultado de '+cfg.label+':\n'+result;
      }
    }catch(e){ return 'Error ejecutando '+name+': '+(e&&e.message||''); }
    return 'ok';
  }

  // ─── Ask Claude (reuses dashboard's key + endpoint) ───
  async function ask(userText){
    if(JV.busy) return;                       // re-entrada: bloquea durante toda la llamada (también en streaming)
    JV.busy=true; JV.thinking=true; setState('thinking');
    JV.history.push({role:'user',content:userText});

    const $typ=addMsg('j',''); $typ.classList.add('jvs-cursor');
    // Si la llamada no llega a generar respuesta, quita el mensaje de usuario colgado:
    // dejarlo provocaría dos turnos 'user' seguidos y la API respondería 400.
    const popUser=()=>{ if(JV.history.length && JV.history[JV.history.length-1].role==='user') JV.history.pop(); };
    const ctrl=new AbortController(); JV.ctrl=ctrl; let timedOut=false;
    const to=setTimeout(()=>{ timedOut=true; try{ctrl.abort();}catch(e){} },60000);

    try{
      // reuse dashboard's stored Anthropic key
      let key = (typeof window.getAnthropicKey==='function') ? window.getAnthropicKey() : null;
      if(!key){ key = localStorage.getItem('anthropic_key'); }
      // Strip non-printable-ASCII chars that break fetch headers (ISO-8859-1 enforcement)
      if(key) key = key.replace(/[^\x20-\x7E]/g,'').trim();
      if(!key||key.startsWith('%%')||key==='undefined'){
        clearTimeout(to); JV.ctrl=null; popUser();
        $typ.classList.remove('jvs-cursor');
        $typ.textContent='No hay API Key configurada. Configúrala desde el dashboard (botón de ajustes) y vuelve a intentar.';
        $typ.parentElement.className='jvs-msg jvs-e';
        JV.busy=false; JV.thinking=false; setState('idle'); return;
      }

      // ── Loop agéntico con herramientas (tool-use) en streaming ──
      // JV.history se mantiene como mensajes de TEXTO simples (persistencia/restore
      // intactos). Los bloques tool_use/tool_result viven sólo en 'convo' local de
      // este turno: nunca se persisten ni se recortan entre turnos, evitando 400 por
      // bloques huérfanos.
      JV._delegations=0; JV._pendingFlow=null; JV._btns=[]; JV._accum='';
      const stripTags=s=>s.replace(/\[(NAV|NUEVO|AGENTE|FLUJO|BTN):[^\]]*\]/gi,'').replace(/\[COTIZAR\]/gi,'').replace(/\[(NAV|NUEVO|AGENTE|FLUJO|BTN):[^\]]*$/i,'');

      // Una ronda: streamea un mensaje del asistente (Blob body por Unicode/ISO-8859-1)
      // con reintento ante errores transitorios. Devuelve {text, toolUses, stopReason}.
      async function streamRound(convo){
        const reqBody=new Blob([JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1024, stream:true, system:SYS_BLOCKS(), tools:KAI_TOOLS, messages:convo })],{type:'application/json'});
        const RETRY=[429,500,502,503,529]; let r=null;
        for(let attempt=0; attempt<3 && !timedOut; attempt++){
          r=await fetch('https://api.anthropic.com/v1/messages',{ method:'POST', signal:ctrl.signal, headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}, body:reqBody });
          if(r.ok || !RETRY.includes(r.status) || attempt===2) break;
          $typ.textContent='Reintentando conexión…';
          await new Promise(res=>setTimeout(res,700*(attempt+1)));
        }
        if(!r.ok){ const e=await r.json().catch(()=>({})); if(r.status===401){ localStorage.removeItem('anthropic_key'); sessionStorage.removeItem('anthropic_key'); } throw new Error(e.error?.message||('API '+r.status)); }
        const reader=r.body.getReader(); const decoder=new TextDecoder();
        let buf='', text='', stopReason=''; const blocks={}; let inTok=0,outTok=0;
        while(true){
          const {done,value}=await reader.read(); if(done) break;
          buf+=decoder.decode(value,{stream:true});
          const lines=buf.split('\n'); buf=lines.pop()||'';
          for(const line of lines){
            const t=line.trim(); if(!t.startsWith('data:')) continue;
            const payload=t.slice(5).trim(); if(!payload||payload==='[DONE]') continue;
            let ev; try{ ev=JSON.parse(payload); }catch(e){ continue; }
            if(ev.type==='message_start'){ inTok=ev.message?.usage?.input_tokens||0; }
            else if(ev.type==='content_block_start'){ const cb=ev.content_block||{}; blocks[ev.index]={type:cb.type,name:cb.name,id:cb.id,text:'',json:''}; }
            else if(ev.type==='content_block_delta'){
              const b=blocks[ev.index]||(blocks[ev.index]={type:'text',text:'',json:''});
              if(ev.delta?.type==='text_delta'){ text+=ev.delta.text; b.text+=ev.delta.text; $typ.textContent=(JV._accum?JV._accum+'\n':'')+stripTags(text); $log.scrollTop=$log.scrollHeight; }
              else if(ev.delta?.type==='input_json_delta'){ b.json+=ev.delta.partial_json||''; }
            }
            else if(ev.type==='message_delta'){ if(ev.delta?.stop_reason) stopReason=ev.delta.stop_reason; if(ev.usage?.output_tokens) outTok=ev.usage.output_tokens; }
            else if(ev.type==='error'){ throw new Error(ev.error?.message||'Error de stream'); }
          }
        }
        _kaiUpdateUsage(inTok,outTok);
        const toolUses=Object.keys(blocks).map(k=>blocks[k]).filter(b=>b.type==='tool_use').map(b=>{ let inp={}; try{ inp=b.json?JSON.parse(b.json):{}; }catch(e){} return {id:b.id,name:b.name,input:inp}; });
        return { text, toolUses, stopReason };
      }

      // Orquesta rondas hasta que el modelo deje de pedir herramientas (tope 4)
      JV.thinking=false; setState('speaking'); $typ.classList.remove('jvs-cursor');
      let convo=JV.history.slice(-12).map(m=>({role:m.role,content:m.content}));
      let guard=0;
      while(guard++<4){
        const res=await streamRound(convo);
        const shown=stripTags(res.text||'').trim();
        if(shown){ JV._accum += (JV._accum?'\n':'')+shown; $typ.textContent=JV._accum; }
        if(res.stopReason!=='tool_use' || !res.toolUses.length) break;
        convo.push({ role:'assistant', content:[ ...(res.text?[{type:'text',text:res.text}]:[]), ...res.toolUses.map(t=>({type:'tool_use',id:t.id,name:t.name,input:t.input})) ] });
        const results=[];
        for(const tu of res.toolUses){ const out=await _kaiExecTool(tu.name,tu.input); results.push({type:'tool_result',tool_use_id:tu.id,content:String(out==null?'ok':out)}); }
        convo.push({ role:'user', content:results });
        setState('thinking');
      }
      clearTimeout(to); JV.ctrl=null;

      // Compat: procesa cualquier etiqueta heredada; preserva botones de la herramienta
      const _toolBtns=(JV._btns||[]).slice();
      const clean=execActions(JV._accum||'Listo.');
      JV._btns=_toolBtns.concat(JV._btns||[]);
      $typ.innerHTML=formatRichText(clean||'Listo.');
      _kaiRenderButtons(JV._btns);
      $log.scrollTop=$log.scrollHeight;
      JV.history.push({role:'assistant',content:(clean||'Listo.')});
      if(JV.history.length>14) JV.history=JV.history.slice(-12);
      _kaiPersist();
      JV.busy=false;

      // Lanza el flujo guiado pendiente (cotizar/asistente) tras cerrar el turno.
      // Cierra el panel primero, luego habla (el TTS sigue tras cerrar) y abre el flujo.
      if(JV._pendingFlow){
        const pf=JV._pendingFlow; JV._pendingFlow=null;
        closePanel();
        if($voiceToggle.checked) speak(clean);
        setTimeout(()=>{ if(pf==='cotizar'){ if(window.startQuoteFlow) window.startQuoteFlow(); } else { _kaiLaunchFlow(pf); } },150);
        return;
      }
      if($voiceToggle.checked) speak(clean); else { setState('idle'); maybeRelisten(); }

    }catch(err){
      clearTimeout(to); JV.ctrl=null; popUser();
      JV.busy=false; JV.thinking=false;
      if(err && err.name==='AbortError' && !timedOut){
        // el usuario cerró el panel a mitad: limpia el mensaje sin mostrar error
        const p=$typ.parentElement; if(p&&p.parentElement) p.parentElement.removeChild(p);
        return;
      }
      $typ.classList.remove('jvs-cursor');
      $typ.textContent=(err&&err.name==='AbortError')?'La respuesta tardó demasiado. Intenta de nuevo.':('Error de conexión: '+(err&&err.message||''));
      $typ.parentElement.className='jvs-msg jvs-e';
      setState('idle');
    }
  }

  // ─── TTS ───
  async function speak(text){
    if(!text){ setState('idle'); maybeRelisten(); return; }
    const clean=text.replace(/[*_#`]/g,'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'').trim();
    if(!clean){ setState('idle'); maybeRelisten(); return; }
    // ElevenLabs premium TTS
    const elKey=localStorage.getItem('elevenlabs_key')||(_DEFAULTS.ELEVENLABS&&!_DEFAULTS.ELEVENLABS.startsWith('%%')?_DEFAULTS.ELEVENLABS:'');
    if(elKey){
      try{
        setState('speaking');
        const voiceId=localStorage.getItem('elevenlabs_voice_id')||'ClNifCEVq1smkl4M3aTk';
        const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,{
          method:'POST',
          headers:{'Content-Type':'application/json','xi-api-key':elKey},
          body:JSON.stringify({text:clean,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.5,similarity_boost:0.75}})
        });
        if(r.ok){
          const blob=await r.blob();
          const url=URL.createObjectURL(blob);
          const audio=new Audio(url);
          audio.onended=()=>{ URL.revokeObjectURL(url); setState('idle'); maybeRelisten(); };
          audio.onerror=()=>{ URL.revokeObjectURL(url); setState('idle'); maybeRelisten(); };
          await audio.play().catch(()=>{});
          return;
        } else {
          const errData=await r.json().catch(()=>({}));
          const msg=errData?.detail?.message||errData?.detail||('HTTP '+r.status);
          if(typeof toast==='function') toast('ElevenLabs: '+msg,'error');
        }
      }catch(e){ if(typeof toast==='function') toast('ElevenLabs: '+e.message,'error'); }
    }
    // Fallback: voz del navegador
    if(!JV.synth){ setState('idle'); maybeRelisten(); return; }
    JV.synth.cancel();
    const u=new SpeechSynthesisUtterance(clean);
    u.lang='es-CL'; u.rate=1.06; u.pitch=.95;
    const vs=JV.synth.getVoices();
    const v=vs.find(x=>x.lang.startsWith('es')&&/google/i.test(x.name))||vs.find(x=>x.lang.startsWith('es'));
    if(v) u.voice=v;
    u.onstart=()=>setState('speaking');
    u.onend=()=>{ setState('idle'); maybeRelisten(); };
    u.onerror=()=>{ setState('idle'); maybeRelisten(); };
    JV.synth.speak(u);
  }

  function maybeRelisten(){ if(JV.autoListen && JV.open && !JV.thinking){ setTimeout(startListen,400); } }

  // ─── STT ───
  function initRec(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR) return null;
    const rec=new SR();
    rec.lang='es-CL'; rec.interimResults=true; rec.maxAlternatives=1; rec.continuous=false;
    rec.onstart=()=>{ JV.listening=true; setState('listening'); };
    rec.onresult=(ev)=>{
      const interim=Array.from(ev.results).map(r=>r[0].transcript).join('');
      $input.value=interim;
      const last=ev.results[ev.results.length-1];
      if(last.isFinal){
        const t=last[0].transcript.trim();
        $input.value='';
        if(t){ addMsg('u',t); ask(t); }
      }
    };
    rec.onerror=(ev)=>{ JV.listening=false; if(ev.error!=='aborted'&&ev.error!=='no-speech') addMsg('e','Micrófono: '+ev.error); if(!JV.thinking) setState('idle'); };
    rec.onend=()=>{ JV.listening=false; if(!JV.thinking&&!JV.speaking) setState('idle'); };
    return rec;
  }

  function startListen(){
    if(JV.thinking||JV.speaking||JV.listening) return;
    if(!JV.rec) JV.rec=initRec();
    if(!JV.rec){ addMsg('e','Reconocimiento de voz no disponible. Usa Chrome o Edge.'); return; }
    try{ JV.synth.cancel(); JV.rec.start(); }catch(e){}
  }
  function stopListen(){ if(JV.rec&&JV.listening){ try{JV.rec.stop();}catch(e){} } }

  // mic: tap to toggle
  $mic.addEventListener('click',()=>{ JV.listening?stopListen():startListen(); });

  // ─── Text send ───
  function send(){ const t=$input.value.trim(); if(!t)return; $input.value=''; addMsg('u',t); ask(t); }
  $send.addEventListener('click',send);
  $input.addEventListener('keydown',e=>{ if(e.key==='Enter') send(); });

  // ─── Chips ───
  document.querySelectorAll('.jvs-chip').forEach(c=>{
    c.addEventListener('click',()=>{ if(c.dataset.action==='quote'){ closePanel(); if(window.startQuoteFlow) window.startQuoteFlow(); return; } const cmd=c.dataset.cmd; addMsg('u',cmd); ask(cmd); });
  });

  // ─── Settings ───
  $autoListen.addEventListener('change',()=>{ JV.autoListen=$autoListen.checked; });

  // ─── Init ───
  JV.rec=initRec();
  window.speechSynthesis && (window.speechSynthesis.onvoiceschanged=()=>{});
  // Expose a global to open KAI programmatically if needed
  window.openKai=()=>{ JV.open?closePanel():openPanel(); };
  _kaiRestore();
})();
