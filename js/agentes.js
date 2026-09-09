/* js/agentes.js â€” agentes inline, bandejas, CTA y proveedores (extraÃ­do de index.html). */

// Scoping por vendedor: en modo comercial las bandejas/agentes sÃ³lo operan
// sobre los registros del propio comercial (mismo criterio que el resto del panel).
function _agMine(coll){ return (typeof isVendorMode==='function'&&isVendorMode())?(coll||[]).filter(vendorOwnsRecord):(coll||[]); }

// â”€â”€ AGENTES INLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _agentInlineText='';

function closeAgentInlineModal(){document.getElementById('agentInlineModal').style.display='none';_agentInlineText='';}

function copyAgentResult(){if(!_agentInlineText){toast('Sin contenido','error');return;}navigator.clipboard.writeText(_agentInlineText).then(()=>toast('Copiado âœ“','success')).catch(()=>toast('No se pudo copiar','error'));}

function _getClienteRecFromField(field){
  if(!field) return null;
  if(Array.isArray(field)&&field.length) return state.clientes.find(c=>c.id===field[0])||null;
  if(typeof field==='string') return state.clientes.find(c=>c.fields['Empresa']===field)||null;
  return null;
}

function _getClienteWAPhone(cliRec){
  if(!cliRec) return '';
  const wa=(cliRec.fields['WhatsApp']||'').replace(/\D/g,'');
  const tel=(cliRec.fields['TelÃ©fono']||'').replace(/\D/g,'');
  const num=wa||tel;
  if(!num) return '';
  return num.startsWith('56')?num:'56'+num;
}

function _extractWAPart(text){
  const m=text.match(/(?:^|\n)1[\.\)][^\n]*\n([\s\S]+?)(?=\n2[\.\)]|\n*$)/i);
  return m?m[1].trim():text.substring(0,400).trim();
}

function _extractEmailPart(text){
  const m=text.match(/(?:^|\n)2[\.\)][^\n]*\n([\s\S]+?)$/i);
  return m?m[1].trim():text;
}

// â”€â”€ Mensajes listos para enviar (naturales, sin emojis ni asteriscos) â”€â”€â”€â”€â”€â”€
// Regla que se anexa a los agentes de cliente para estandarizar los dos mensajes.
const AGENT_MSG_RULES='\n\nFORMATO DE LOS MENSAJES LISTOS PARA ENVIAR (obligatorio): al final entrega DOS mensajes numerados, exactamente asÃ­:\n1. WhatsApp: (2 a 4 lÃ­neas)\n2. Email: (primera lÃ­nea "Asunto: ..." y luego el cuerpo, con cierre cordial firmado "Equipo The Lab Solutions")\nAmbos en espaÃ±ol chileno natural y cercano, como los escribirÃ­a a mano una persona del equipo. PROHIBIDO usar emojis, asteriscos, negritas o cualquier sÃ­mbolo de formato (markdown, viÃ±etas, comillas de bloque ">"): solo texto plano listo para copiar, pegar y enviar. No uses marcadores como [nombre] ni [empresa]: usa el dato real si lo tienes, o un saludo neutro si no.';

// Limpia un mensaje para enviar: quita emojis y marcas de formato (asteriscos,
// markdown, viÃ±etas, citas) dejando texto plano y natural.
function _cleanMsg(s){
  let t=String(s||'');
  t=t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{2190}-\u{21FF}]/gu,'');
  t=t.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1');
  t=t.replace(/[*_`]+/g,'');
  t=t.replace(/^\s{0,3}#{1,6}\s*/gm,'');
  t=t.replace(/^\s{0,3}>\s?/gm,'');
  t=t.replace(/^\s{0,3}[-â€¢]\s+/gm,'');
  t=t.replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n');
  return t.trim();
}

// â”€â”€ REACTIVADO: marca al cliente/lead tras enviarle un mensaje desde un agente â”€â”€
async function marcarReactivado(cliId,via){
  const c=state.clientes&&state.clientes.find(x=>x.id===cliId); if(!c) return;
  const yaEstaba=!!c.fields['Reactivado'];
  const fecha=hoyCL();
  c.fields['Reactivado']=true; c.fields['Fecha reactivaciÃ³n']=fecha;   // optimista en local
  try{if(typeof renderClientes==='function') renderClientes(true);}catch(e){}
  try{_markAgentModalReactivado();}catch(e){}
  if(!yaEstaba){try{toast('â™» '+(c.fields['Empresa']||'Cliente')+' marcado como Reactivado','success');}catch(e){}}
  try{
    await airtableWrite('Clientes','PATCH',cliId,{'Reactivado':true,'Fecha reactivaciÃ³n':fecha});
  }catch(e){
    if(String(e.message||'').toLowerCase().includes('unknown')){try{ensureClienteReactivadoFields();}catch(_){}}
  }
}
// Quita a mano la marca de Reactivado de un cliente/lead (clic en el badge).
async function quitarReactivado(cliId){
  const c=state.clientes&&state.clientes.find(x=>x.id===cliId); if(!c) return;
  if(!confirm('Â¿Quitar la marca de Reactivado de '+(c.fields['Empresa']||'este cliente')+'?')) return;
  const antes={r:c.fields['Reactivado'],f:c.fields['Fecha reactivaciÃ³n']};
  c.fields['Reactivado']=false; c.fields['Fecha reactivaciÃ³n']=null;   // optimista en local
  try{if(typeof renderClientes==='function') renderClientes(true);}catch(e){}
  try{toast('Marca de Reactivado quitada','info');}catch(e){}
  // El aviso de arriba es optimista. Si el guardado falla hay que deshacer lo
  // local: si no, la marca "vuelve" al recargar y el cliente reaparece en la
  // campaÃ±a de reactivaciÃ³n sin explicaciÃ³n.
  try{await airtableWrite('Clientes','PATCH',cliId,{'Reactivado':false,'Fecha reactivaciÃ³n':null});}
  catch(e){
    c.fields['Reactivado']=antes.r; c.fields['Fecha reactivaciÃ³n']=antes.f;
    try{if(typeof renderClientes==='function') renderClientes(true);}catch(_){}
    avisoNoGuardado('quitar la marca de Reactivado',e);
  }
}
async function ensureClienteReactivadoFields(){
  try{
    const t=(typeof getToken==='function'?getToken():'')||'';
    if(!t&&typeof _proxyCfg==='function'&&!_proxyCfg()) return;
    // Mismo caso que ensureCotizacionFields: se pedÃ­a crear los dos campos sin
    // mirar si ya estaban, y los dos rechazos se tragaban en silencio.
    const needed=[{name:'Reactivado',type:'checkbox',options:{icon:'check',color:'greenBright'}},{name:'Fecha reactivaciÃ³n',type:'date',options:{dateFormat:{name:'iso'}}}];
    await _crearCamposFaltantes('Clientes',needed);
  }catch(e){}
}
function _markAgentModalReactivado(){
  const actions=document.getElementById('agentInlineActions');
  if(!actions||actions.querySelector('.reactivado-chip')) return;
  const chip=document.createElement('span');
  chip.className='badge badge-green reactivado-chip';
  chip.style.cssText='align-self:center;font-size:11px;padding:5px 9px';
  chip.textContent='â™» Reactivado';
  actions.appendChild(chip);
}

// EnvÃ­a el mensaje de WhatsApp del agente (prellenado y limpio) y marca reactivado.
function agentSendWA(phone,cliId){
  const waPart=_cleanMsg(_extractWAPart(_agentInlineText)||_agentInlineText);
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(waPart),'_blank');
  if(window._fuCotId){try{fuMarkDone(window._fuCotId,'WhatsApp');}catch(e){}window._fuCotId=null;}
  if(cliId){try{marcarReactivado(cliId,'WhatsApp');}catch(e){}}
}

// Abre un BORRADOR de correo en la secciÃ³n Correos con el mensaje del agente,
// listo para revisar y enviar. Al enviarlo de verdad, marca al cliente Reactivado
// (y registra el seguimiento de la cotizaciÃ³n si aplica).
function draftAgentEmail(toEmail,subject,cliId,fuCotId){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  let bodyText=_cleanMsg(_extractEmailPart(_agentInlineText)||_agentInlineText);
  let subj=subject;
  const ms=bodyText.match(/^\s*asunto\s*:\s*(.+)$/im);
  if(ms){subj=ms[1].trim();bodyText=bodyText.replace(/^\s*asunto\s*:\s*.+$/im,'').trim();}
  const bodyHtml=escapeHtml(bodyText).replace(/\n/g,'<br>');
  closeAgentInlineModal();
  if(typeof switchTab==='function') switchTab('correo');
  setTimeout(()=>{try{MAIL.openCompose({to:toEmail,subject:subj,body:bodyHtml,title:'Enviar mensaje',_reactivarCli:cliId||'',_fuCotId:fuCotId||''});}catch(e){toast('No se pudo abrir el borrador','error');}},350);
}

async function runAgentInline(agentId,contextText,actionsFn){
  const cfg=AGENTES_CFG.find(a=>a.id===agentId);if(!cfg) return;
  // Los agentes tambiÃ©n se lanzan desde botones repartidos por el dashboard
  // (una ficha de cliente, una cotizaciÃ³nâ€¦), no solo desde la parrilla: el
  // permiso tiene que comprobarse aquÃ­ igual.
  if(typeof agenteVisible==='function'&&!agenteVisible(cfg)){try{toast('Este agente pertenece a una secciÃ³n que no tienes','error');}catch(e){}return;}
  window._fuCotId=null;   // evita registrar seguimientos de una cotizaciÃ³n anterior
  const modal=document.getElementById('agentInlineModal');
  const resultEl=document.getElementById('agentInlineResult');
  const actionsEl=document.getElementById('agentInlineActions');
  document.getElementById('agentInlineTitle').textContent='ğŸ¤– '+(typeof agentDisplayName==='function'?agentDisplayName(cfg):(cfg.persona||cfg.label));
  resultEl.className='agent-modal-result loading';
  resultEl.style.whiteSpace='';
  resultEl.textContent='â³ Procesando...';
  actionsEl.innerHTML='';
  _agentInlineText='';
  modal.style.display='flex';
  try{showAgentWorking(cfg);}catch(e){}
  const ctx=state.loaded?buildAgentContext(agentId):'';
  const fullInput=ctx?`${ctx}\n\nCONSULTA: ${contextText}`:contextText;
  try{
    const result=await callAgentClaude(agentId,cfg.sys+AGENT_TONE,fullInput);
    _agentInlineText=result;
    resultEl.className='agent-modal-result';
    resultEl.style.whiteSpace='normal';resultEl.innerHTML=formatAgentReport(result);
    if(actionsFn) actionsEl.innerHTML=actionsFn(result);
    else actionsEl.innerHTML=agentCtaButtonsHtml('',result)+'<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>';
    try{AGENT_LOG.add(cfg.label,contextText,result);}catch(e){}
  }catch(e){
    resultEl.className='agent-modal-result';
    resultEl.textContent='âŒ Error: '+e.message;
    toast('Error agente: '+e.message,'error');
  }finally{try{hideAgentWorking();}catch(e){}}
}

// â€” FOLLOWUP desde cotizaciÃ³n
// â”€â”€ BANDEJA DE SEGUIMIENTOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detecta cotizaciones 'Enviada' sin respuesta hace N+ dÃ­as y las deja listas
// para hacer seguimiento con 1 clic (FOLLOWUP_AGENT + CTA WhatsApp/correo).
// El registro de seguimientos hechos vive en localStorage (thelab_fu_log_v1)
// y, best-effort, en el campo 'Ãšltimo seguimiento' de la cotizaciÃ³n si existe.
const _FU_LOG_KEY='thelab_fu_log_v1';
function _fuLog(){try{return JSON.parse(localStorage.getItem(_FU_LOG_KEY)||'{}');}catch(e){return{};}}
function _fuDays(){const v=parseInt(localStorage.getItem('thelab_fu_days'));return [3,5,7,10].includes(v)?v:5;}
function fuSetDays(v){localStorage.setItem('thelab_fu_days',v);buildFollowupTray();}
// Secuencia de 3 toques a partir del dÃ­a base elegido: base, base+3, base+8.
// El log guarda cuÃ¡ntos toques se hicieron ({ts,via,toques}); tras 3 sin
// respuesta la cotizaciÃ³n sale de la bandeja (queda para el win-back al vencer).
function _fuSched(){const b=_fuDays();return [b,b+3,b+8];}
function _fuToques(cotId){const e=_fuLog()[cotId];return (e&&e.toques)||0;}
const _FU_ETIQ=['1er toque','2Âº toque','3er toque (Ãºltimo)'];
function buildFollowupTray(){
  const card=document.getElementById('fuTrayCard'); if(!card) return;
  const sel=document.getElementById('fuTrayDays'); if(sel) sel.value=String(_fuDays());
  const sched=_fuSched(), log=_fuLog(), now=Date.now();
  const _t=new Date();_t.setHours(0,0,0,0);
  const cands=_agMine(state.cotizaciones).map(c=>{
    const f=c.fields;
    if((f['Estado cotizaciÃ³n']||'')!=='Enviada') return null;
    const fecha=f['Fecha cotizaciÃ³n']||(c.createdTime||'').slice(0,10);
    if(!fecha) return null;
    const dias=Math.floor((_t-new Date(fecha+'T00:00:00'))/864e5);
    const e=log[c.id]||{}, toques=e.toques||0;
    if(toques>=3) return null;                       // secuencia agotada
    if(dias<sched[toques]) return null;              // aÃºn no toca este toque
    if(e.ts && now-e.ts<2*864e5) return null;        // <2 dÃ­as desde el Ãºltimo toque
    return {c,f,dias,toque:toques};
  }).filter(Boolean).sort((a,b)=>b.toque-a.toque||b.dias-a.dias);
  const cnt=document.getElementById('fuTrayCount'); if(cnt) cnt.textContent=cands.length;
  if(!cands.length){card.style.display='none';return;}
  card.style.display='';
  const list=document.getElementById('fuTrayList'); if(!list) return;
  list.innerHTML=cands.slice(0,12).map(x=>{
    const neto=x.f['Total final (CLP)']?formatCLP(Math.round(x.f['Total final (CLP)']/1.19)):'â€”';
    const vto=x.f['Fecha vencimiento']?Math.round((new Date(x.f['Fecha vencimiento']+'T00:00:00')-_t)/864e5):null;
    const vtoChip=vto==null?'':(vto<0?` Â· <span style="color:var(--danger)">vencida hace ${-vto}d</span>`:` Â· vence en ${vto}d`);
    const tCol=x.toque===2?'badge-red':x.toque===1?'badge-orange':'badge-yellow';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      <span class="badge ${tCol}" style="flex-shrink:0" title="${x.dias} dÃ­as sin respuesta">${_FU_ETIQ[x.toque]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(resolveClienteName(x.f['Cliente']))}</div>
        <div style="font-size:10.5px;color:var(--text3)">${escapeHtml(x.f['NÂ° CotizaciÃ³n']||'â€”')} Â· ${neto} neto Â· ${x.dias}d${vtoChip}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="runFollowupAgent('${x.c.id}')">âœ¨ Seguimiento IA</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar este toque como hecho sin enviar" onclick="fuMarkDone('${x.c.id}','manual')">âœ“</button>
    </div>`;
  }).join('')+(cands.length>12?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">â€¦y ${cands.length-12} mÃ¡s</div>`:'');
}
async function fuMarkDone(cotId,via){
  const log=_fuLog(); const prev=log[cotId]||{};
  log[cotId]={ts:Date.now(),via:via||'manual',toques:Math.min((prev.toques||0)+1,3)};
  try{localStorage.setItem(_FU_LOG_KEY,JSON.stringify(log));}catch(e){}
  try{await airtableWriteTolerant('Cotizaciones','PATCH',cotId,{'Ãšltimo seguimiento':hoyCL()});}catch(e){}
  if(via&&via!=='manual') toast('âœ“ Seguimiento registrado ('+via+') â€” toque '+log[cotId].toques+'/3','success');
  buildFollowupTray();
}

// â”€â”€ LEADS DORMIDOS (win-back accionable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Dos perfiles: "nunca comprÃ³" (2+ cotizaciones, 0 pedidos, 30+ dÃ­as quieto)
// y "ex-cliente" (comprÃ³ alguna vez y lleva 60+ dÃ­as sin actividad). Se
// excluye a quien tiene una cotizaciÃ³n abierta reciente, estÃ¡ bloqueado o ya
// fue gestionado hace <30 dÃ­as (registro en thelab_wb_log_v1).
const _WB_LOG_KEY='thelab_wb_log_v1';
function _wbLog(){try{return JSON.parse(localStorage.getItem(_WB_LOG_KEY)||'{}');}catch(e){return{};}}
function _wbCands(){
  const now=Date.now(),log=_wbLog();
  const cotsByCli={},pedsByCli={};
  (state.cotizaciones||[]).forEach(c=>(Array.isArray(c.fields['Cliente'])?c.fields['Cliente']:[]).forEach(id=>(cotsByCli[id]=cotsByCli[id]||[]).push(c)));
  (state.pedidos||[]).forEach(p=>(Array.isArray(p.fields['Cliente'])?p.fields['Cliente']:[]).forEach(id=>(pedsByCli[id]=pedsByCli[id]||[]).push(p)));
  const lastTs=r=>{const f=r.fields;const d=f['Fecha cotizaciÃ³n']||f['Fecha entrega']||f['Fecha despacho']||(r.createdTime||'').slice(0,10);return d?new Date(d+(d.length===10?'T00:00:00':'')).getTime():0;};
  return _agMine(state.clientes).map(c=>{
    const f=c.fields;
    if((f['Estado cuenta']||'')==='Bloqueado') return null;
    const cots=cotsByCli[c.id]||[],peds=pedsByCli[c.id]||[];
    const acts=[...cots,...peds].map(lastTs).filter(Boolean);
    if(!acts.length) return null;
    const dias=Math.floor((now-Math.max(...acts))/864e5);
    if(cots.some(x=>['Enviada','Solicitada'].includes(x.fields['Estado cotizaciÃ³n']||'')&&now-lastTs(x)<45*864e5)) return null;
    const l=log[c.id]&&log[c.id].ts; if(l&&now-l<30*864e5) return null;
    let tipo=null;
    if(!peds.length&&cots.length>=2&&dias>=30) tipo='nunca';
    else if(peds.length&&dias>=60) tipo='ex';
    if(!tipo) return null;
    return {c,f,dias,tipo,rev:f['Revenue total cliente (CLP)']||0,nCots:cots.length,nPeds:peds.length};
  }).filter(Boolean).sort((a,b)=>b.rev-a.rev||b.dias-a.dias);
}
function buildWinbackTray(){
  const card=document.getElementById('wbTrayCard'); if(!card) return;
  const cands=_wbCands();
  const cnt=document.getElementById('wbTrayCount'); if(cnt) cnt.textContent=cands.length;
  if(!cands.length){card.style.display='none';return;}
  card.style.display='';
  const list=document.getElementById('wbTrayList'); if(!list) return;
  list.innerHTML=cands.slice(0,10).map(x=>{
    const chip=x.tipo==='ex'
      ?`<span class="badge badge-purple" style="flex-shrink:0" title="ComprÃ³ antes y desapareciÃ³">ğŸ’ ex-cliente</span>`
      :`<span class="badge badge-yellow" style="flex-shrink:0" title="CotizÃ³ ${x.nCots} veces y nunca comprÃ³">ğŸŒ± nunca comprÃ³</span>`;
    const sub=x.tipo==='ex'?`${formatCLP(x.rev)} histÃ³rico Â· ${x.nPeds} pedido${x.nPeds!==1?'s':''}`:`${x.nCots} cotizaciones sin cierre`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      ${chip}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.f['Empresa']||x.f['Contacto']||'â€”')}</div>
        <div style="font-size:10.5px;color:var(--text3)">ğŸ˜´ ${x.dias} dÃ­as sin actividad Â· ${sub}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="wbReactivar('${x.c.id}')">â™» Reactivar IA</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar como gestionado sin enviar" onclick="wbMarkDone('${x.c.id}')">âœ“</button>
    </div>`;
  }).join('')+(cands.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">â€¦y ${cands.length-10} mÃ¡s (se muestran primero los de mayor revenue histÃ³rico)</div>`:'');
}
function wbReactivar(cliId){
  const log=_wbLog(); log[cliId]={ts:Date.now(),via:'ia'};
  try{localStorage.setItem(_WB_LOG_KEY,JSON.stringify(log));}catch(e){}
  runClienteWinbackAgent(cliId);
  buildWinbackTray();
}
function wbMarkDone(cliId){
  const log=_wbLog(); log[cliId]={ts:Date.now(),via:'manual'};
  try{localStorage.setItem(_WB_LOG_KEY,JSON.stringify(log));}catch(e){}
  toast('âœ“ Gestionado â€” no volverÃ¡ a aparecer por 30 dÃ­as','success');
  buildWinbackTray();
}

// â”€â”€ RECOMPRA PREDICTIVA (O3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Clientes recurrentes (2+ pedidos) con una cadencia de compra estimada: cuando
// el tiempo desde el Ãºltimo pedido alcanza ~su cadencia habitual, es momento de
// invitarlos a reponer â€” proactivo, ANTES de que se enfrÃ­en (eso lo cubre winback).
const _RECOMPRA_LOG_KEY='thelab_recompra_log_v1';
function _recompraLog(){try{return JSON.parse(localStorage.getItem(_RECOMPRA_LOG_KEY)||'{}');}catch(e){return{};}}
function _clientePedidos(cli){
  const emp=cli.fields['Empresa']||cli.fields['Contacto']||'';
  return (state.pedidos||[]).filter(p=>{
    const f=p.fields;if((f['Estado pedido']||'')==='Cancelado')return false;
    const c=f['Cliente'];const match=Array.isArray(c)?c.includes(cli.id):(String(c||'').toLowerCase()===String(emp).toLowerCase());
    if(!match)return false;
    return !!(p.createdTime||f['Fecha entrega']||f['Fecha ingreso']);
  });
}
function _recompraInfo(cli){
  // Fechas de compra (createdTime como referencia principal) ordenadas asc.
  const fechas=_clientePedidos(cli).map(p=>new Date(p.createdTime||p.fields['Fecha entrega']||p.fields['Fecha ingreso']).getTime()).filter(t=>!isNaN(t)).sort((a,b)=>a-b);
  if(fechas.length<2) return null;                          // sin cadencia no se predice
  const intervalos=[];for(let i=1;i<fechas.length;i++)intervalos.push((fechas[i]-fechas[i-1])/864e5);
  const cadencia=intervalos.reduce((a,b)=>a+b,0)/intervalos.length;
  if(!(cadencia>=7&&cadencia<=400)) return null;            // cadencia razonable (semana a ~aÃ±o)
  const last=fechas[fechas.length-1];
  const diasDesde=Math.floor((Date.now()-last)/864e5);
  const ratio=diasDesde/cadencia;
  return {cadencia:Math.round(cadencia),diasDesde,ratio,nPeds:fechas.length,last};
}
function _recompraCands(){
  const log=_recompraLog();
  return _agMine(state.clientes).map(c=>{
    if(log[c.id]&&(Date.now()-log[c.id].ts<30*864e5)) return null;   // gestionado hace <30 dÃ­as
    const info=_recompraInfo(c);if(!info) return null;
    // "toca" desde el 85% de la cadencia y hasta 2.5Ã— (mÃ¡s allÃ¡ es winback, no recompra)
    if(info.ratio<0.85||info.ratio>2.5) return null;
    return {c,f:c.fields,...info};
  }).filter(Boolean).sort((a,b)=>b.ratio-a.ratio);
}
function _recompraMsg(cand){
  const nombre=cand.f['Contacto']?String(cand.f['Contacto']).trim().split(/\s+/)[0]:'';
  const emp=cand.f['Empresa']||'';
  return `Hola${nombre?' '+nombre:''} ğŸ‘‹ Te saludo de The Lab Solutions. Vimos que sueles renovar con nosotros cada ~${cand.cadencia} dÃ­as y ya pasÃ³ un tiempo desde tu Ãºltimo pedido${emp?` (${emp})`:''}. Â¿Te preparamos una nueva producciÃ³n o cotizaciÃ³n? CuÃ©ntanos quÃ© necesitas y lo dejamos listo. ğŸ’™`;
}
function buildRecompraTray(){
  const card=document.getElementById('recompraTrayCard'); if(!card) return;
  const cands=_recompraCands();
  const cnt=document.getElementById('recompraTrayCount'); if(cnt) cnt.textContent=cands.length;
  if(!cands.length){card.style.display='none';return;}
  card.style.display='';
  const list=document.getElementById('recompraTrayList'); if(!list) return;
  list.innerHTML=cands.slice(0,10).map(x=>{
    const cli=x.c;const tienePhone=!!_getClienteWAPhone(cli);
    const vencido=x.ratio>=1;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      <span class="badge ${vencido?'badge-orange':'badge-yellow'}" style="flex-shrink:0" title="DÃ­as desde el Ãºltimo pedido vs. cadencia habitual">${x.diasDesde}d / ~${x.cadencia}d</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.f['Empresa']||x.f['Contacto']||'â€”')}</div>
        <div style="font-size:10.5px;color:var(--text3)">${x.nPeds} pedidos Â· compra cada ~${x.cadencia} dÃ­as${vencido?' Â· <span style="color:var(--warn)">ya toca reponer</span>':' Â· a punto'}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="recompraWhatsApp('${cli.id}')" ${tienePhone?'':'title="Sin telÃ©fono en la ficha â€” se abrirÃ¡ WhatsApp para elegir contacto"'}>ğŸ“²</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="recompraEmail('${cli.id}',this)">ğŸ“§</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar como gestionado (no reaparece por 30 dÃ­as)" onclick="recompraSnooze('${cli.id}')">âœ“</button>
    </div>`;
  }).join('')+(cands.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">â€¦y ${cands.length-10} mÃ¡s</div>`:'');
}
function _recompraMark(cliId,via){
  const log=_recompraLog(); log[cliId]={ts:Date.now(),via:via||'manual'};
  try{localStorage.setItem(_RECOMPRA_LOG_KEY,JSON.stringify(log));}catch(e){}
  buildRecompraTray();
}
function recompraWhatsApp(cliId){
  const cli=(state.clientes||[]).find(c=>c.id===cliId); if(!cli){toast('Cliente no encontrado','error');return;}
  const cand=_recompraCands().find(x=>x.c.id===cliId)||{c:cli,f:cli.fields,cadencia:_recompraInfo(cli)?.cadencia||30};
  const phone=_getClienteWAPhone(cli)||'';
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(_recompraMsg(cand)),'_blank');
  _recompraMark(cliId,'WhatsApp');
}
async function recompraEmail(cliId,btn){
  const cli=(state.clientes||[]).find(c=>c.id===cliId); if(!cli){toast('Cliente no encontrado','error');return;}
  const cand=_recompraCands().find(x=>x.c.id===cliId)||{c:cli,f:cli.fields,cadencia:_recompraInfo(cli)?.cadencia||30};
  let to=cli.fields['Email']||prompt('Â¿A quÃ© correo enviamos la invitaciÃ³n de recompra?','');
  if(!to)return; to=String(to).trim();
  if(!validEmail(to)){toast('Correo invÃ¡lido','error');return;}
  const prev=btn?btn.innerHTML:'';if(btn){btn.disabled=true;btn.textContent='â€¦';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to,subject:'Â¿Preparamos tu prÃ³xima producciÃ³n? â€” The Lab Solutions',body:_recompraMsg(cand),from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('âœ“ InvitaciÃ³n de recompra enviada a '+to,'success');_recompraMark(cliId,'correo');}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=prev;}}
}
function recompraSnooze(cliId){_recompraMark(cliId,'manual');toast('âœ“ Gestionado â€” no reaparece por 30 dÃ­as','success');}

// â”€â”€ CLIENTES EN RIESGO DE FUGA / CHURN (S3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Combina seÃ±ales para detectar clientes recurrentes que se estÃ¡n enfriando o
// tienen problemas: muy pasados de su cadencia, reclamo abierto, NPS bajo o
// facturas vencidas. Distinto de recompra (ventana normal) y winback (leads).
function _churnRiesgo(){
  const log=_recompraLog();
  const reclamos=(typeof _reclamos==='function')?_reclamos():[];
  return _agMine(state.clientes).map(c=>{
    const info=_recompraInfo(c);if(!info)return null;          // necesita historial (2+ pedidos)
    const emp=c.fields['Empresa']||c.fields['Contacto']||'';
    const peds=_clientePedidos(c);
    let score=0;const razones=[];
    // 1) muy pasado de su cadencia habitual (mÃ¡s allÃ¡ de la ventana de recompra)
    if(info.ratio>=2.5){score+=2;razones.push(`${info.diasDesde}d sin comprar (compra cada ~${info.cadencia}d)`);}
    else if(info.ratio>=1.5){score+=1;razones.push('atrasado en su recompra');}
    // 2) reclamo abierto
    const rc=reclamos.find(r=>peds.some(p=>p.id===r.pedidoId)&&(r.estado==='Abierto'||r.estado==='En proceso'));
    if(rc){score+=2;razones.push('reclamo sin resolver');}
    // 3) NPS bajo en algÃºn pedido
    const npsBajo=peds.some(p=>{const s=(typeof _npsScore==='function')?_npsScore(p):null;return s!=null&&s<=2;});
    if(npsBajo){score+=2;razones.push('calificÃ³ bajo (NPS â‰¤2)');}
    // 4) facturas vencidas
    const venc=c.fields['Facturas vencidas']||0;if(venc>=2){score+=1;razones.push(`${venc} facturas vencidas`);}
    if(score<2)return null;
    const gestionado=log[c.id]&&(Date.now()-log[c.id].ts<30*864e5);
    if(gestionado)return null;
    const rev=c.fields['Revenue total cliente (CLP)']||0;
    return {c,emp,score,razones,rev,dias:info.diasDesde};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||b.rev-a.rev);
}
function renderChurn(){
  const el=document.getElementById('churnCard');if(!el)return;
  const list=_churnRiesgo();
  if(!list.length){el.innerHTML='';return;}
  el.innerHTML=`<div class="card" style="border-color:rgba(255,68,68,0.4)">
    <div class="card-header"><span class="card-title" style="color:var(--danger)">ğŸš¨ Clientes en riesgo de fuga <span class="badge badge-red">${list.length}</span></span>
      <span style="margin-left:auto;font-size:10.5px;color:var(--text3)">recurrentes que se enfrÃ­an o con problemas â€” reactÃ­valos antes de perderlos</span></div>
    <div>${list.slice(0,10).map(x=>{
      const cli=x.c;const tienePhone=!!_getClienteWAPhone(cli);
      const sev=x.score>=4?'badge-red':'badge-orange';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
        <span class="badge ${sev}" style="flex-shrink:0" title="Nivel de riesgo">riesgo ${x.score}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.emp)}${x.rev>0?` <span style="font-size:10px;color:var(--text3)">Â· ${formatCLP(x.rev)} histÃ³rico</span>`:''}</div>
          <div style="font-size:10.5px;color:var(--warn);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.razones.join(' Â· '))}</div>
        </div>
        <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="churnReactivar('${cli.id}')" title="Reactivar con IA">â™» Reactivar</button>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar gestionado (30 dÃ­as)" onclick="recompraSnooze('${cli.id}')">âœ“</button>
      </div>`;
    }).join('')}${list.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">â€¦y ${list.length-10} mÃ¡s</div>`:''}</div>
  </div>`;
}
function churnReactivar(cliId){
  _recompraMark(cliId,'churn');
  if(typeof runClienteWinbackAgent==='function') runClienteWinbackAgent(cliId);
  else if(typeof recompraWhatsApp==='function') recompraWhatsApp(cliId);
  renderChurn();
}

// â”€â”€ POST-ENTREGA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pedidos despachados hace 3+ dÃ­as (hasta 30): mensaje de satisfacciÃ³n con
// invitaciÃ³n a dejar reseÃ±a en Google, por WhatsApp o correo (Andrea).
const _PD_LOG_KEY='thelab_postdel_log_v1';
function _pdLog(){try{return JSON.parse(localStorage.getItem(_PD_LOG_KEY)||'{}');}catch(e){return{};}}
function _pdReviewUrl(){return localStorage.getItem('thelab_greview_url')||'';}
function pdSetReviewUrl(){
  const cur=_pdReviewUrl();
  const v=prompt('Enlace de reseÃ±a de Google (se incluye en los mensajes post-entrega).\nEn Google Maps: tu negocio â†’ Compartir â†’ "Escribir una reseÃ±a".',cur||'https://g.page/r/');
  if(v===null) return;
  const t=v.trim();
  if(t&&!/^https?:\/\//i.test(t)){toast('Debe ser un enlace https://','error');return;}
  if(t) localStorage.setItem('thelab_greview_url',t); else localStorage.removeItem('thelab_greview_url');
  toast(t?'âœ“ Enlace de reseÃ±a guardado':'Enlace de reseÃ±a eliminado','success');
}
function _pdCliRec(p){const c=p.fields['Cliente'];const id=Array.isArray(c)?c[0]:null;return id?(state.clientesByIdRec||{})[id]||null:null;}
// URL de la encuesta NPS 1-clic para un pedido (si el lead-worker estÃ¡ configurado).
// La pÃ¡gina del worker registra la nota en el pedido y, para notas altas, invita
// a dejar reseÃ±a en Google (por eso se le pasa el enlace de reseÃ±a como &g).
function _npsWorkerUrl(){
  try{
    const u=(typeof _DEFAULTS!=='undefined'&&_DEFAULTS.Lm«ëŒ+Š×®º+º$zzb¥ç'3§·×Ò“°¢–b‚"æö²’&WGW&ã¶6öç7BCÖv—B"æ§6öâ‚“¶6öç7BF&ÃÖBçF&ÆW3òæf–æB‡ƒÓç‚ææÖSÓÓÒuVF–F÷2r“¶–b‚F&Â’&WGW&ã°¢6öç7B†fSÖæWr6WB‚‡F&Âæf–VÆG7ÇÅµÒ’æÖ‡ƒÓç‚ææÖR’“°¢6öç7BvçCÕ°¢¶æÖS¢tå266÷&RrÇG—S¢vçVÖ&W"rÆ÷F–öç3§·&V6—6–öã£×ÒÀ¢¶æÖS¢tå2fV6†rÇG—S¢w6–ævÆTÆ–æUFW‡BwÒÀ¢¶æÖS¢tå26öÖVçF&–òrÇG—S¢v×VÇF–Æ–æUFW‡BwÒÀ¢Ó°¢f÷"†6öç7BröbvçB—°¢–b††fRæ†2‡rææÖR’’6öçF–çVS°¢G'—¶v—BöDfWF6‚†öÖWFö&6W2òG´$4Uô”GÒ÷F&ÆW2òG·F&Âæ–GÒöf–VÆG6Ç¶ÖWF†öC¢uõ5BrÆ†VFW'3§²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öâwÒÆ&öG“¤¥4ôâç7G&–æv–g’‡r—Ò“·Ö6F6‚†R—·Ğ¢Ğ¢Ö6F6‚†R—·Ğ§Ğ¢òòÆV7GW&öW7FL:×7F–6FRÆ2æ÷F2–&V6–&–F2‡6F—6f66œ;6âF—ò54BÓR’à¦gVæ7F–öâöç566÷&R‡—¶6öç7Bc×bgæf–VÆG3÷'6T–çB‡æf–VÆG5²tå266÷&RuÒÃ“¤æã·&WGW&â‡cãÓbgcÃÓR“÷c¦çVÆÃ·Ğ¦gVæ7F–öâöç57FG2‚—°¢6öç7Bæ÷F3ÕötÖ–æR‡7FFRçVF–F÷2’æÖ…öç566÷&R’æf–ÇFW"‡cÓçbÖçVÆÂ“°¢–b‚æ÷F2æÆVæwF‚’&WGW&âçVÆÃ°¢6öç7BãÖæ÷F2æÆVæwF‚Ç7VÓÖæ÷F2ç&VGV6R‚†Æ"“Óæ¶"Ã“°¢6öç7B&öÓÖæ÷F2æf–ÇFW"‡cÓçcãÓB’æÆVæwF‚ÆFWG#Öæ÷F2æf–ÇFW"‡cÓçcÃÓ"’æÆVæwFƒ°¢&WGW&â¶âÆfs§7VÒöâÇ&öÖ÷F÷&W3§&öÒÆFWG&7F÷&W3¦FWG"Æç3¤ÖF‚ç&÷VæB‚‡&öÒÖFWG"’öâ£’Ç7E&öÓ¤ÖF‚ç&÷VæB‡&öÒöâ£’Ç7DFWG#¤ÖF‚ç&÷VæB†FWG"öâ£—Ó°§Ğ¢òò&W7VÖVâFR6F—6f66œ;6â„54Bôå2’6öâÆ2æ÷F2–&V6–&–F2FRÆ÷26Æ–VçFW2à¦gVæ7F–öâ&VæFW$76E7VÖÖ'’‚—°¢6öç7B&#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wD76D&"r“²–b‚&"’&WGW&ã°¢6öç7B3Õöç57FG2‚“°¢–b‚2—¶&"ç7G–ÆRæF—7Æ“ÒvæöæRs¶&"æ–ææW$…DÔÃÒrs·&WGW&ã·Ğ¢6öç7BVÖó×2æfsãÓBãSò	ùˆÒs§2æfsãÓCò	ù˜"s§2æfsãÓ3ò	ù‰s¢	ù˜s°¢6öç7Bç46öÃ×2æç3ãÓSòwf"‚ÒÖ66VçC2’s§2æç3ãÓòwf"‚Ò×v&â’s¢wf"‚ÒÖFævW"’s°¢&"ç7G–ÆRæF—7Æ“Òrs°¢&"æ–ææW$…DÔÃÖÆF—b6Æ73Ò&6&B"7G–ÆSÒ'FF–æs£G‚g‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£‚#à¢Ç7â6Æ73Ò&6&B×F—FÆR"7G–ÆSÒ&föçB×6—¦S£7‚#âG¶VÖ÷Ò6F—6f66œ;6â÷7BÖVçG&VvÂ÷7ãà¢Ç7â7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG·2æçÒ6Æ–f–66œ;6âG·2æâÓÓòvW2s¢rwÓÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£‡ƒ¶fÆW‚×w&§w&#à¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£“‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#å&öÖVF–óÂ÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ#âG·2æfrçFôf—†VBƒ—ÒÇ7â7G–ÆSÒ&föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âóSÂ÷7ããÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£“‚"F—FÆSÒ$æWB&öÖ÷FW"66÷&S¢RFR&öÖ÷F÷&W2ƒBÓR’ÖVæ÷2RFRFWG&7F÷&W2ƒÓ"’#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#äå3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#¢G¶ç46öÇÒ#âG·2æç3ãòr²s¢rwÒG·2æç7ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£“‚#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#å&öÖ÷F÷&W3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçC2’#âG·2ç7E&ö×ÒSÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&f2Ö·’G·2æFWG&7F÷&W3òvf2Ö·’ÖFævW"s¢rwÒ"7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£“‚"F—FÆSÒ"G·2æFWG&7F÷&W7ÒFRG·2æçÒ6Æ–f–66–öæW2#ãÇ7â6Æ73Ò&f2Ö·’ÖÆ&Â#äFWG&7F÷&W3Â÷7ããÇ7â6Æ73Ò&f2Ö·’×fÂ#âG·2ç7DFWG'ÒSÂ÷7ããÂöF—cà¢ÂöF—cà¢ÂöF—cæ°§Ğ¦gVæ7F–öâ'V–ÆE÷7DVçG&VvG&’‚—°¢G'—·&VæFW$76E7VÖÖ'’‚“·Ö6F6‚†R—·Ğ¢6öç7B6&CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wEG&”6&Br“²–b‚6&B’&WGW&ã°¢6öç7BÆösÕ÷DÆör‚“°¢6öç7B÷CÖæWrFFR‚“µ÷Bç6WD†÷W'2ƒÃÃÃ“°¢6öç7B6æG3ÕötÖ–æR‡7FFRçVF–F÷2’æÖ‡Óç°¢6öç7Bc×æf–VÆG3°¢–b‚†e²tW7FFòVF–Fòu×ÇÂrr’ÓÒtFW76†Fòr’&WGW&âçVÆÃ°¢6öç7BfV6†Öe²tfV6†FW76†òu×ÇÆe²tfV6†VçG&Vvu×ÇÂrs°¢–b‚fV6†’&WGW&âçVÆÃ°¢6öç7BF–3ÔÖF‚æfÆö÷"‚…÷BÖæWrFFR†fV6†²uC££r’’óƒcFSR“°¢–b†F–3Ã7ÇÆF–3ã3’&WGW&âçVÆÃ²òòfVçFæ;§F–Ã¢æ’×W’&öçFòæ’VF–F÷2çF–wV÷0¢–b†Æöu·æ–EÒ’&WGW&âçVÆÃ°¢&WGW&â·ÆbÆF–7Ó°¢Ò’æf–ÇFW"„&ööÆVâ’ç6÷'B‚†Æ"“ÓææF–2Ö"æF–2“°¢6öç7B6çCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wEG&”6÷VçBr“²–b†6çB’6çBçFW‡D6öçFVçCÖ6æG2æÆVæwFƒ°¢–b‚6æG2æÆVæwF‚—¶6&Bç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ğ¢6&Bç7G–ÆRæF—7Æ“Òrs°¢6öç7BÆ—7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wEG&”Æ—7Br“²–b‚Æ—7B’&WGW&ã°¢Æ—7Bæ–ææW$…DÔÃÖ6æG2ç6Æ–6RƒÃ’æÖ‡ƒÓç°¢6öç7B6Æ“Õ÷D6Æ•&V2‡‚ç“°¢6öç7BF–VæUFVÃÒ†6Æ’beövWD6Æ–VçFUt†öæR†6Æ’’“°¢&WGW&âÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ·FF–æs£—‚gƒ¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#à¢Ç7â6Æ73Ò&&FvR&FvRÖw&VVâ"7G–ÆSÒ&fÆW‚×6‡&–æ³£"F—FÆSÒ$L:Ö2FW6FRVÂFW76†ò#âG·‚æF–7ÒCÂ÷7ãà¢ÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£c¶föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—3·v†—FR×76S¦æ÷w&#âG¶W66T‡FÖÂ‡&W6öÇfT6Æ–VçFTæÖR‡‚æe²t6Æ–VçFRuÒ’—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£ãWƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#âG¶W66T‡FÖÂ‡‚æe²tì+VF–Fòu×ÇÂ~(	Br—Ò+rFW76†FòVÂG¶f÷&ÖDfV6†‡‚æe²tfV6†FW76†òu×ÇÇ‚æe²tfV6†VçG&VvuÒ—ÓÂöF—cà¢ÂöF—cà¢Gµ÷öDÆ–æ²‡‚ç“ò…÷öD6öæf—&ÖFò‡‚ç“òsÇ7â6Æ73Ò&&FvR&FvRÖw&VVâ"7G–ÆSÒ&fÆW‚×6‡&–æ³£"F—FÆSÒ$VÂ6Æ–VçFR6öæf—&Ü;2Æ&V6W6œ;6â#î)ÈR&V6–&–FóÂ÷7ãâs¦Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&fÆW‚×6‡&–æ³£"öæ6Æ–6³Ò'VF—%ôB‚rG·‚çæ–GÒr’"F—FÆSÒ%VF—"6öæf—&Ö6œ;6âFR&V6W6œ;6â#ï	ù:cÂö'WGFöãæ“¢rwĞ¢Æ'WGFöâ6Æ73Ò&'Fâ'Fâ×&–Ö'’'Fâ×6Ò"7G–ÆSÒ&fÆW‚×6‡&–æ³£"öæ6Æ–6³Ò'Ev†G4‚rG·‚çæ–GÒr’"G·F–VæUFVÃòrs¢wF—FÆSÒ%6–âFVÌ:–föæòVâÆf–6†(	B6R'&—,:v†G4&VÆVv—"6öçF7Fò"wÓï	ù;#Âö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&fÆW‚×6‡&–æ³£"öæ6Æ–6³Ò'DVÖ–Â‚rG·‚çæ–GÒrÇF†—2’#ï	ù:sÂö'WGFöãà¢Æ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"7G–ÆSÒ&fÆW‚×6‡&–æ³£"F—FÆSÒ$Ö&6"6öÖòvW7F–öæFò6–âVçf–""öæ6Æ–6³Ò'DÖ&´FöæR‚rG·‚çæ–GÒrÂvÖçVÂr’#î)É3Âö'WGFöãà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr’²†6æG2æÆVæwFƒãöÆF—b7G–ÆSÒ'FF–æs£‡‚gƒ¶föçB×6—¦S£ƒ¶6öÆ÷#§f"‚Ò×FW‡C2’#î(
g’G¶6æG2æÆVæwF‚ÓÒÜ:3ÂöF—cæ¢rr“°§Ğ¦gVæ7F–öâEv†G4‡VF–Fô–B—°¢6öç7BÒ‡7FFRçVF–F÷4'”–GÇÇ·Ò•·VF–Fô–E×ÇÂ‡7FFRçVF–F÷7ÇÅµÒ’æf–æB‡ƒÓç‚æ–CÓÓ×VF–Fô–B“²–b‚—·Fö7B‚uVF–FòæòVæ6öçG&FòrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7B6Æ“Õ÷D6Æ•&V2‡“°¢6öç7B†öæSÖ6Æ“õövWD6Æ–VçFUt†öæR†6Æ’“¢rs°¢–b…öç4Æ–æ²‡’—·G'—¶Vç7W&Tç4f–VÆG2‚“·Ö6F6‚†R—·×Òòò&W&Æ÷26×÷2å2†&W7BÖVff÷'B¢v–æF÷ræ÷Vâ‚v‡GG3¢ò÷væÖRòr²‡†öæWÇÂrr’²s÷FW‡CÒr¶Væ6öFUU$”6ö×öæVçB…÷D×6r‡’’Âuö&Ææ²r“°¢DÖ&´FöæR‡VF–Fô–BÂuv†G4rÇG'VR“°§Ğ¢òò'&RVâ$õ%$Dõ"FVÂÖVç6¦R÷7BÖVçG&VvVâÆ6V66œ;6â6÷'&V÷2ÂÆ—7Fò&¢òò&Wf—6"öVF—F"çFW2FRÖæF&Æò†æò6RVçl:ÖWFöÜ:F–6ÖVçFR’âÂVçf–&ÆòFP¢òòfW&FBFW6FR6÷'&V÷2ÂVÂVF–FòVVFÖ&6Fò6öÖòvW7F–öæFò÷"v6÷'&Vòrà¦7–æ2gVæ7F–öâDVÖ–Â‡VF–Fô–BÆ'Fâ—°¢6öç7BÒ‡7FFRçVF–F÷4'”–GÇÇ·Ò•·VF–Fô–E×ÇÂ‡7FFRçVF–F÷7ÇÅµÒ’æf–æB‡ƒÓç‚æ–CÓÓ×VF–Fô–B“²–b‚—·Fö7B‚uVF–FòæòVæ6öçG&FòrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7B6Æ“Õ÷D6Æ•&V2‡“°¢ÆWBFóÖ6Æ“òæf–VÆG5²tVÖ–Âu×ÇÇ&ö×B‚|+ô\:’6÷'&VòVçf–Ö÷2VÂÖVç6¦R÷7BÖVçG&VvòrÂrr“°¢–b‚Fò—&WGW&ã²FóÕ7G&–ær‡Fò’çG&–Ò‚“°¢–b‚fÆ–DVÖ–Â‡Fò’—·Fö7B‚t6÷'&Vò–çl:Æ–FòrÂvW'&÷"r“·&WGW&ã·Ğ¢6öç7B&WcÖ'Fãö'Fâæ–ææW$…DÔÃ¢rs°¢–b†'Fâ—¶'FâæF—6&ÆVC×G'VS¶'FâçFW‡D6öçFVçCÒ~(
bs·Ğ¢–b…öç4Æ–æ²‡’—·G'—¶v—BVç7W&Tç4f–VÆG2‚“·Ö6F6‚†R—·×Òòò&W&Æ÷26×÷2å2çFW2FR'&—"VÂ&÷'&F÷ ¢–b†'Fâ—¶'FâæF—6&ÆVCÖfÇ6S¶'Fâæ–ææW$…DÔÃ×&Wc·Ğ¢6öç7B&öG”‡FÖÃÖW66T‡FÖÂ…÷D×6r‡’’ç&WÆ6R‚õÆâörÂsÆ'#âr“°¢–b‡G—Vöb7v—F6…F#ÓÓÒvgVæ7F–öâr’7v—F6…F"‚v6÷'&Vòr“°¢6WEF–ÖV÷WB‚‚“Óç·G'—´Ô”Âæ÷Vä6ö×÷6R‡·FòÇ7V&¦V7C¢|+ô<;6ÖòÆÆV|;2GRVF–Fóò(	BF†RÆ"6öÇWF–öç2rÆ&öG“¦&öG”‡FÖÂÇF—FÆS¢tÖVç6¦R÷7BÖVçG&VvrÅ÷EVF–Fô–C§VF–Fô–BÅög&öÔæÖS¤tTåEô5Dôe$ôÒææÖRÅög&öÔVÖ–Ã¤tTåEô5Dôe$ôÒæVÖ–ÇÒ“·Ö6F6‚†R—·Fö7B‚tæò6RVFò'&—"VÂ&÷'&F÷"rÂvW'&÷"r“·×ÒÃ3S“°§Ğ¦7–æ2gVæ7F–öâDÖ&´FöæR‡VF–Fô–BÇf–Ç6–ÆVçB—°¢6öç7BÆösÕ÷DÆör‚“²Æöu·VF–Fô–EÓ×·G3¤FFRææ÷r‚’Çf–§f–ÇÂvÖçVÂwÓ°¢G'—¶Æö6Å7F÷&vRç6WD—FVÒ…õEôÄôuô´U’Ä¥4ôâç7G&–æv–g’†Æör’“·Ö6F6‚†R—·Ğ¢òòæ÷FVâVÂVF–Fò†&V6RVâæ÷F2–çFW&æ2FVÂVF–FòÂ&W7BÖVff÷'B¢G'—¶6öç7B'#ÕövWDæ÷F2‚wVBrÇVF–Fô–B“¶'"çW6‚‡¶–C¢vâr´FFRææ÷r‚’ÇG3¤FFRææ÷r‚’ÇFW‡C¢	ù)¢ÖVç6¦R÷7BÖVçG&VvVçf–Fò÷"r²‡f–ÇÂ~(	Br’²r„æG&V’wÒ“µ÷6fTæ÷F2‚wVBrÇVF–Fô–BÆ'"“·Ö6F6‚†R—·Ğ¢–b‚6–ÆVçBbgf–ÓÓÒvÖçVÂr’Fö7B‚~)É2÷7BÖVçG&VvÖ&6Fò6öÖòvW7F–öæFòrÂw7V66W72r“°¢VÇ6R–b‚6–ÆVçB’Fö7B‚~)É2÷7BÖVçG&Vv&Vv—7G&Fò‚r·f–²r’rÂw7V66W72r“°¢'V–ÆE÷7DVçG&VvG&’‚“°§Ğ ¢òò)H)HÔTÔõ$”DRtTåDU2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òò&Æ÷VR6ö×7Fò6öâÆ÷26öçF7F÷2&Wf–÷2Â6Æ–VçFR†ÖVç6¦W2&VF7FF÷2÷ ¢òòvVçFW2Â6VwV–Ö–VçF÷2Â6ö'&ç¦2’÷7BÖVçG&Vv2&Vv—7G&F÷2’&VRVÀ¢òòvVçFRL:’6öçF–çV–FBÆ6öçfW'66œ;6â’æò6R&W—Fà¦gVæ7F–öâvVçDÖVÖ÷&–6Æ–VçFR†V×&W6Æ6Æ”–B—°¢G'—°¢6öç7BV×Õ7G&–ær†V×&W6ÇÂrr’çG&–Ò‚“°¢–b†V×æÆVæwFƒÃBbb6Æ”–B’&WGW&ârs°¢6öç7BWcÕµÓ°¢6öç7BW6ƒÒ‡G2ÇG‡B“Óç¶–b‡G2bgG‡B–WbçW6‚‡·G2ÇG‡GÒ“·Ó°¢G'—°¢tTåEôÄôråöÆöB‚“°¢6öç7BVÃÖV×çFôÆ÷vW$66R‚“°¢–b†VÂæÆVæwFƒãÓB’„tTåEôÄôrå÷'Vç7ÇÅµÒ’æf÷$V6‚‡#Óç°¢–b‚'ÇÂ"çF–ÖR—&WGW&ã°¢–b‚‚‚‡"æ–çWGÇÂrr’²rr²‡"æ÷WGWGÇÂrr’’çFôÆ÷vW$66R‚’’æ–æ6ÇVFW2†VÂ’—°¢6öç7B6æ—Õ7G&–ær‡"æ÷WGWGÇÂrr’ç&WÆ6R‚õÇ2²örÂrr’ç6Æ–6RƒÃ“°¢W6‚‡"çF–ÖRÆG²‡G—Vöbööe&WGG“ÓÓÒvgVæ7F–öâsõööe&WGG’‡"ævVçB“§"ævVçB—ÇÂtvVçFRwÒ&VF7L;3¢"G·6æ—Ş(
b&“°¢Ğ¢Ò“°¢Ö6F6‚†R—·Ğ¢G'—°¢–b†6Æ”–B—¶6öç7BfÃÕögTÆör‚“°¢‡7FFRæ6÷F—¦6–öæW7ÇÅµÒ’æf÷$V6‚†3Óç¶6öç7B6–CÔ'&’æ—4'&’†2æf–VÆG5²t6Æ–VçFRuÒ“ö2æf–VÆG5²t6Æ–VçFRuÕ³Ó¦çVÆÃ¶–b†6–BÓÖ6Æ”–B—&WGW&ã¶6öç7BSÖfÅ¶2æ–EÓ¶–b†RbfRçG2—W6‚†RçG2Æ6VwV–Ö–VçFòVçf–Fò÷"G¶Rçf–ÇÂ~(	BwÒ†6÷BG¶2æf–VÆG5²tì+6÷F—¦6œ;6âu×ÇÂ~(	BwÒ–“·Ò“·Ğ¢Ö6F6‚†R—·Ğ¢G'—²…ö6ö$Æör‚•¶V×çFôÆ÷vW$66R‚•×ÇÅµÒ’æf÷$V6‚†SÓçW6‚†RçG2Æ&V6÷&FF÷&–òFR6ö'&ç¦÷"G¶Rçf–ÇÂ~(	BwÖ’“·Ö6F6‚†R—·Ğ¢G'—°¢–b†6Æ”–B—¶6öç7BÃÕ÷DÆör‚“°¢‡7FFRçVF–F÷7ÇÅµÒ’æf÷$V6‚‡Óç¶6öç7B6–CÔ'&’æ—4'&’‡æf–VÆG5²t6Æ–VçFRuÒ“÷æf–VÆG5²t6Æ–VçFRuÕ³Ó¦çVÆÃ¶–b†6–BÓÖ6Æ”–B—&WGW&ã¶6öç7BS×Å·æ–EÓ¶–b†RbfRçG2—W6‚†RçG2ÆÖVç6¦R÷7BÖVçG&Vv÷"G¶Rçf–ÇÂ~(	BwÒ‚G·æf–VÆG5²tì+VF–Fòu×ÇÂ~(	BwÒ–“·Ò“·Ğ¢Ö6F6‚†R—·Ğ¢–b‚WbæÆVæwF‚—&WGW&ârs°¢Wbç6÷'B‚†Æ"“Óæ"çG2ÖçG2“°¢6öç7Bf6ƒ×G3ÓææWrFFR‡G2’çFô•4õ7G&–ær‚’ç6Æ–6RƒÃ“°¢&WGW&âuÆä4ôåD5Dõ2$Ud”õ24ôâU5DR4Ä”TåDR†FÆW26öçF–çV–FB(	Bäò&W—F2VÂÖ—6Öò6ÇVFòæ’Æ÷2Ö—6Ö÷2&wVÖVçF÷3²6’—VFÂÇVFR'&WfVÖVçFRÂ6öçF7FòçFW&–÷"“¥Æâp¢¶Wbç6Æ–6RƒÃR’æÖ†SÓæÒ²G¶f6‚†RçG2—ÕÒG¶RçG‡GÖ’æ¦ö–â‚uÆâr“°¢Ö6F6‚†R—·&WGW&ârs·Ğ§Ğ ¦gVæ7F–öâ'VäföÆÆ÷wWvVçB†6÷D–B—°¢6öç7B3×7FFRæ6÷F—¦6–öæW4'”–E¶6÷D–EÓ¶–b‚2’&WGW&ã°¢6öç7BcÖ2æf–VÆG3°¢6öç7B÷CÖæWrFFR‚“µ÷Bç6WD†÷W'2ƒÃÃÃ“°¢6öç7B6Æ•&V3ÕövWD6Æ–VçFU&V4g&öÔf–VÆB†e²t6Æ–VçFRuÒ“°¢6öç7BæöÖ'&S×&W6öÇfT6Æ–VçFTæÖR†e²t6Æ–VçFRuÒ“°¢6öç7BF–3Öe²tfV6†6÷F—¦6œ;6âuÓôÖF‚ç&÷VæB‚…÷BÖæWrFFR†e²tfV6†6÷F—¦6œ;6âuÒ²uC££r’’óƒcC“¢~(	Bs°¢6öç7BgFóÖe²tfV6†fVæ6–Ö–VçFòuÓôÖF‚ç&÷VæB‚†æWrFFR†e²tfV6†fVæ6–Ö–VçFòuÒ²uC££r’Õ÷B’óƒcC“¦çVÆÃ°¢6öç7B6öÃÒ†e²u6öÆ–6—GVB6Æ–VçFR‡FW‡FòÆ–'&R’u×ÇÆe²tFWFÆÆR&öGV7F÷2u×ÇÆe²u6öÆ–6—GVBòFWFÆÆRu×ÇÂrr’ç7V'7G&–ærƒÃS“°¢6öç7BÖöçFóÖe²uF÷FÂf–æÂ„4Å’uÓöf÷&ÖD4Å„ÖF‚ç&÷VæB†e²uF÷FÂf–æÂ„4Å’uÒóã’’“¢rs°¢6öç7Bv†öæSÕövWD6Æ–VçFUt†öæR†6Æ•&V2“°¢6öç7BVÖ–ÃÖ6Æ•&V3òæf–VÆG5²tVÖ–Âu×ÇÂrs°¢6öç7B÷F÷VSÔÖF‚æÖ–â…ögUF÷VW2†6÷D–B’³Ã2“°¢6öç7BöwV–Õ÷F÷VSÓÓÓòw&V6÷&FF÷&–ò'&WfR’Ö&ÆRÂ6–â&W6œ;6âp¢¥÷F÷VSÓÓÓ#òv÷'FfÆ÷#¢&W7VVÇfRGVF2L:×–62Âög&V6R§W7F"VÂÆ6æ6RòVæÇFW&æF—fÂ&VgVW'¦VÂ&VæVf–6–òp¢¢|;¦ÇF–Öò6öçF7FòFRÆ6V7VVæ6–¢7&VW&vVæ6–7VfR‡fVæ6–Ö–VçFòÂ7WòFR&öGV66œ;6â’’f6–Æ—FVÂ6–W'&R6öâVæ&VwVçFF—&V7Fs°¢6öç7B7GƒÖ6Æ–VçFS¢G¶æöÖ'&WÒG¶VÖ–ÃòrÂVÖ–Ã¢r¶VÖ–Ã¢rwÒG·v†öæSòrÂFVÃ¢²r·v†öæS¢rwÕÆä6÷F—¦6œ;6ã¢G¶e²tì+6÷F—¦6œ;6âu×ÇÂ~(	BwÒG¶ÖöçFóòrÂÖöçFòæWFó¢r¶ÖöçFó¢rwÕÆäL:Ö26–â&W7VW7F¢G¶F–7ÒG·gFòÖçVÆÃòrÂfVæ6RVã¢r·gFò²vBs¢rwÕÆå&öGV7Fòõ6W'f–6–ó¢G·6öÇÇÂtæòW7V6–f–6FòwÕÆåF÷VRFRÆ6V7VVæ6–¢Gµ÷F÷VWÒFR2(	BVæf÷VS¢GµöwV–Òâæò&W—F2VÂÖ—6ÖòFW‡FòFRVâF÷VRçFW&–÷"æ¶vVçDÖVÖ÷&–6Æ–VçFR†æöÖ'&RÆ6Æ•&V3òæ–B’´tTåEôÕ4uõ%TÄU3°¢'VävVçD–æÆ–æR‚tdôÄÄõuUrÆ7G‚Â‡&W7VÇB“Óç°¢6öç7Bv'Fã×v†öæSöÆ'WGFöâ6Æ73Ò&'Fâ'Fâ×&–Ö'’'Fâ×6Ò"öæ6Æ–6³Ò&vVçE6VæEt‚rG·v†öæWÒrÂrG¶6Æ•&V3òæ–GÇÂrwÒr’#ï	ù;"'&—"v†G4Âö'WGFöãæ¢rs°¢6öç7BÖ–Ä'FãÖVÖ–ÃöÆ'WGFöâ6Æ73Ò&'Fâ'Fâ×&–Ö'’'Fâ×6Ò"öæ6Æ–6³Ò&G&gDvVçDVÖ–Â‚rG¶VÖ–Âç&WÆ6R‚òrörÂrr—ÒrÂu6VwV–Ö–VçFòFRGR6÷F—¦6œ;6â(	BF†RÆ"6öÇWF–öç2rÂrG¶6Æ•&V3òæ–GÇÂrwÒrÂrG¶6÷D–GÒr’#î)ÈûˆòVçf–"6÷'&VóÂö'WGFöãæ¢rs°¢&WGW&âG·v'FçÒG¶Ö–Ä'FçÓÆ'WGFöâ6Æ73Ò&'Fâ'FâÖv†÷7B'Fâ×6Ò"öæ6Æ–6³Ò&6÷”vVçE&W7VÇB‚’#ï	ù8²6÷–"FöFóÂö'WGFöãæ°¢Ò“°¢v–æF÷råögT6÷D–CÖ6÷D–C²òò&WFò×&Vv—7G&"VÂ6VwV–Ö–VçFòÂVçf–"÷"tö6÷'&Vğ§Ğ ¦gVæ7F–öâ÷VäföÆÆ÷wWt‡†öæR—°¢6öç7Bv'CÕöW‡G&7Et'B…övVçD–æÆ–æUFW‡B—ÇÅövVçD–æÆ–æUFW‡C°¢v–æF÷ræ÷Vâ‚v‡GG3¢ò÷væÖRòr·†öæR²s÷FW‡CÒr¶Væ6öFUU$”6ö×öæVçB‡v'B’Âuö&Ææ²r“°¢–b‡v–æF÷råögT6÷D–B—·G'—¶gTÖ&´FöæR‡v–æF÷råögT6÷D–BÂuv†G4r“·Ö6F6‚†R—·×v–æF÷råögT6÷D–CÖçVÆÃ·Ğ§Ğ ¢òò)H)H5DVæ—fW'6ÂFRvVçFW3¢Vçf–"VÂ&W7VÇFFò÷"v†G4ò6÷'&Vò)H)H ¢òò–FVçF–FB6öÖW&6–ÂFRÆ÷2Vçl:Ö÷3¢6ÆVâ4”TÕ$RFW6FRÆ66–ÆÆ6÷'÷&F—f¢òò6öâÆf—&ÖFRæG&VÂ6–â–×÷'F"\:’W7V&–òFVÂF6†&ö&BW7L:’ÆöwVVFòà¦6öç7BtTåEô5Dôe$ôÓ×¶VÖ–Ã¢vÚ±î¸Â¸­yêë¢°k¢G§¦*^lass="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Conversemos â€” The Lab Solutions','${cliId}')">âœ‰ï¸ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

// â€” LEADGEN: prospecciÃ³n de nichos desde el header de Clientes
function runLeadGenAgent(){
  if(!state.loaded){toast('Carga los datos primero (â†º Actualizar)','error');return;}
  const ctx='En base a mi cartera actual (ver contexto), propÃ³n 3 nichos nuevos con potencial alto que aÃºn no estoy atacando, con el formato completo por nicho.';
  runAgentInline('LEADGEN',ctx,()=>`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();switchTab('nuevo-lead')">â• Crear lead</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`);
}

// â€” SALES: ranking diario de prioridad de leads
function runLeadRankingAgent(){
  if(!state.loaded){toast('Carga los datos primero (â†º Actualizar)','error');return;}
  const _t=new Date();_t.setHours(0,0,0,0);
  const leads=_agMine(state.clientes).filter(c=>esLeadCat(c)&&(c.fields['Etapa venta']||'')!=='Perdido');
  if(!leads.length){toast('No hay leads en el pipeline','info');return;}
  const lineas=leads.map(c=>{
    const f=c.fields;
    const dias=c.createdTime?Math.round((_t-new Date(c.createdTime))/86400000):'â€”';
    const cotsCli=state.cotizaciones.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(c.id));
    const abiertas=cotsCli.filter(x=>['Enviada','Solicitada'].includes(x.fields['Estado cotizaciÃ³n']||''));
    const montoAbierto=abiertas.reduce((s,x)=>s+Math.round((x.fields['Total final (CLP)']||0)/1.19),0);
    return `  â€¢ ${f['Empresa']||'â€”'} | ${f['Etapa venta']} | ${dias}d en pipeline | Industria: ${f['Industria / Rubro']||'â€”'} | Revenue histÃ³rico: ${formatCLP(f['Revenue total cliente (CLP)']||0)} | Cotizaciones abiertas: ${abiertas.length}${montoAbierto?' por '+formatCLP(montoAbierto)+' neto':''}`;
  });
  const ctx=`MIS LEADS EN PIPELINE (${leads.length}):\n${lineas.join('\n')}\n\nTAREA: rankea TODOS estos leads de mayor a menor prioridad de contacto HOY. Criterios: monto en juego, dÃ­as sin avance (mÃ¡s dÃ­as = mÃ¡s urgente hasta los 14d, despuÃ©s baja probabilidad), etapa (NegociaciÃ³n > Propuesta enviada > Contactado > lead sin etapa) e industria con historial de conversiÃ³n. Para cada uno: posiciÃ³n, empresa, score 1-10, POR QUÃ‰, y la acciÃ³n concreta de hoy (1 lÃ­nea).`;
  runAgentInline('SALES',ctx,()=>`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();switchTab('clientes')">ğŸ‘¥ Ir a Clientes</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`);
}

// â€” SALES: win-back de cliente inactivo o perdido
function runClienteWinbackAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const cotsCli=state.cotizaciones.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(cliId));
  const ultCot=cotsCli.length?cotsCli[cotsCli.length-1]:null;
  const pedsCli=state.pedidos.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(cliId));
  const ultPed=pedsCli.length?pedsCli[pedsCli.length-1]:null;
  const ctx=`Cliente ${f['Etapa venta']==='Perdido'?'PERDIDO':'INACTIVO'}: ${f['Empresa']||'â€”'} | Contacto: ${f['Contacto']||'â€”'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nIndustria: ${f['Industria / Rubro']||'â€”'} | Revenue histÃ³rico: ${formatCLP(f['Revenue total cliente (CLP)']||0)}\n${ultPed?'Ãšltimo pedido: '+(ultPed.fields['DescripciÃ³n del pedido']||ultPed.fields['Solicitud cliente (texto libre)']||'â€”').substring(0,120):''}${ultCot?'\nÃšltima cotizaciÃ³n: '+(ultCot.fields['NÂ° CotizaciÃ³n']||'â€”')+' ('+(ultCot.fields['Estado cotizaciÃ³n']||'â€”')+')':''}${f['Notas internas']?'\nNotas: '+String(f['Notas internas']).substring(0,150):''}\nTAREA: redacta un mensaje de RECONEXIÃ“N para recuperar a este cliente. Referencia lo que comprÃ³ antes, ofrece algo concreto (novedad de producto o revisiÃ³n de precios), sin sonar desesperado.`+agentMemoriaCliente(f['Empresa'],cliId)+AGENT_MSG_RULES;
  runAgentInline('SALES',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">ğŸ“² Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Tenemos novedades para ti â€” The Lab Solutions','${cliId}')">âœ‰ï¸ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

// â€” ONBOARDING desde cliente (leads nuevos)
function runOnboardingAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const ctx=`Cliente nuevo: ${f['Empresa']||'â€”'} | Contacto: ${f['Contacto']||'â€”'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nEtapa: ${f['Etapa venta']||'â€”'}${f['Notas internas']?'\nNotas: '+String(f['Notas internas']).substring(0,150):''}\nTAREA: prepara la bienvenida para este cliente nuevo: cÃ³mo darle la mejor primera impresiÃ³n y los mensajes de bienvenida listos para enviar.`+AGENT_MSG_RULES;
  runAgentInline('ONBOARDING',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">ğŸ“² Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Bienvenido a The Lab Solutions','${cliId}')">âœ‰ï¸ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

// â€” FINANCE desde cliente (facturas vencidas)
function runFinanceAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const ctx=`Cliente con deuda: ${f['Empresa']||'â€”'} | Contacto: ${f['Contacto']||'â€”'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nFacturas vencidas: ${f['Facturas vencidas']||0} | Estado cuenta: ${f['Estado cuenta']||'â€”'}\nTAREA: redacta un recordatorio de pago para este cliente, formal pero cordial.`+agentMemoriaCliente(f['Empresa'],cliId)+AGENT_MSG_RULES;
  runAgentInline('FINANCE',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">ğŸ“² Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Recordatorio de pago â€” The Lab Solutions','${cliId}')">âœ‰ï¸ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

// â€” ADS analysis desde secciÃ³n Web â†’ Google Ads
function _parseAdsActions(text){
  const m=/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/i.exec(text||'');
  if(!m)return[];
  try{const arr=JSON.parse(m[1].trim());return Array.isArray(arr)?arr.filter(a=>a&&a.tipo):[];}catch(e){return[];}
}
// Etiqueta y estilo del botÃ³n de una acciÃ³n del agente (compartido por todos los render)
function _adsActionLabel(a){
  switch(a.tipo){
    case 'pausar':return 'â¸ Pausar '+(a.campana||'');
    case 'activar':return 'â–¶ Activar '+(a.campana||'');
    case 'presupuesto':return 'ğŸ’° '+(a.campana||'')+' â†’ '+fmtMoney(+a.nuevo||0);
    case 'negativo':return 'ğŸš« Â«'+(a.termino||'')+'Â»';
    case 'pausar_kw':return 'â¸ Pausar kw Â«'+(a.termino||'')+'Â»';
    case 'keyword_exacta':return 'ğŸ¯ Subir Â«'+(a.termino||'')+'Â» a exacta';
    case 'generar_copy':return 'âœ Anuncios para Â«'+(a.termino||a.campana||'')+'Â»';
    default:return a.tipo;
  }
}
function _adsActionClass(a){return (a.tipo==='pausar'||a.tipo==='pausar_kw')?'btn-danger':a.tipo==='keyword_exacta'?'btn-success':'btn-accent';}
function _adsRenderActionBtns(actions){
  return actions.map((a,i)=>`<button class="btn btn-sm ${_adsActionClass(a)}" title="${escapeHtml(a.motivo||'')}" onclick="applyAdsAction(${i})">${escapeHtml(_adsActionLabel(a))}</button>`).join('');
}
// Convierte una acciÃ³n del agente en una mutaciÃ³n de Google Ads aplicable con 1 clic
function applyAdsAction(i){
  const a=(window._adsAgentActions||[])[i];if(!a)return;
  if(a.tipo==='negativo'){
    try{navigator.clipboard.writeText(a.termino||'');}catch(e){}
    const camp=(window._adsLastData?.campanas||[]).find(c=>c.nombre===a.campana||String(c.id)===String(a.id));
    if(typeof _adsQueueMutation==='function'&&a.termino){_adsQueueMutation({op:'negative',id:camp?camp.id:'',data:{campana:a.campana||'cuenta',termino:a.termino},timestamp:new Date().toISOString(),status:'pending'});toast(`ğŸš« Negativo "${a.termino}" en cola (requiere Script 2 actualizado) Â· copiado al portapapeles`,'success');}
    else toast(`Negativo "${a.termino}" copiado al portapapeles`,'info');
    return;
  }
  if(a.tipo==='pausar_kw'){
    if(typeof _adsQueueMutation==='function'&&a.termino){_adsQueueMutation({op:'pause_keyword',id:'',data:{campana:a.campana||'',termino:a.termino},timestamp:new Date().toISOString(),status:'pending'});toast(`â¸ Pausar palabra clave "${a.termino}" en cola (requiere Script 2 actualizado)`,'success');}
    else toast('Falta el tÃ©rmino de la palabra clave','error');
    return;
  }
  if(a.tipo==='keyword_exacta'){
    // Promover a exacta es ambiguo (Â¿quÃ© grupo de anuncios?) â†’ guÃ­a + portapapeles, no mutaciÃ³n a ciegas
    try{navigator.clipboard.writeText('['+(a.termino||'')+']');}catch(e){}
    toast(`ğŸ¯ "[${a.termino}]" copiado â€” agrÃ©galo como exacta en el grupo correcto de "${a.campana||'la campaÃ±a'}"`,'info');
    return;
  }
  if(a.tipo==='generar_copy'){
    adsGenerateAdCopy(a.termino||a.campana||'',a.campana||'');
    return;
  }
  const camp=(window._adsLastData?.campanas||[]).find(c=>String(c.id)===String(a.id)||c.nombre===a.campana);
  if(!camp){toast('No encontrÃ© la campaÃ±a de la acciÃ³n','error');return;}
  const base={nombre:camp.nombre,presupuesto:camp.presupuesto,estado:camp.estado,tipo:camp.tipo||'SEARCH'};
  let data,desc;
  if(a.tipo==='pausar'){data={...base,estado:'PAUSED'};desc='Pausar '+camp.nombre;}
  else if(a.tipo==='activar'){data={...base,estado:'ENABLED'};desc='Activar '+camp.nombre;}
  else if(a.tipo==='presupuesto'){
    // El nÃºmero lo propuso un modelo de lenguaje y de aquÃ­ sale hacia la cuenta
    // real. Antes: Math.max(1000, +a.nuevo||0) â€” sin techo, y con el campo
    // ausente dejaba la campaÃ±a en $1.000/dÃ­a sin decir nada.
    const nb=(typeof adsPresupuestoValido==='function')
      ? adsPresupuestoValido(a.nuevo,camp.presupuesto,camp.nombre)
      : null;
    if(nb===null){if(typeof adsPresupuestoValido!=='function')toast('Freno de presupuesto no disponible â€” no se envÃ­a','error');return;}
    data={...base,presupuesto:nb};desc='Ppto '+camp.nombre+' â†’ '+fmtMoney(nb);
  }
  else{toast('Tipo de acciÃ³n no soportado','error');return;}
  if(typeof _adsQueueMutation==='function'){_adsQueueMutation({op:'edit',id:camp.id,data,timestamp:new Date().toISOString(),status:'pending'});toast('âœ“ En cola: '+desc,'success');}
  else toast('Cola de mutaciones no disponible','error');
}
// â”€â”€ Generador de copy de anuncios (RSA) para keywords con relevancia baja â”€â”€
const _RSA_LIMITS={titulo:30,descripcion:90,ruta:15};
function _adsCopyOverlay(){
  let ov=document.getElementById('adsCopyOverlay');
  if(!ov){
    ov=document.createElement('div');ov.id='adsCopyOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick=e=>{if(e.target===ov)ov.remove();};
    document.body.appendChild(ov);
  }
  return ov;
}
let _adsCopyData={titulos:[],descripciones:[],rutas:[]};
function _adsCopyClip(cat,i){const t=(_adsCopyData[cat]||[])[i];if(t==null)return;navigator.clipboard.writeText(t).then(()=>toast('Copiado âœ“','success')).catch(()=>{});}
function _adsCopyClipAll(cat){const a=_adsCopyData[cat]||[];if(!a.length)return;navigator.clipboard.writeText(a.join('\n')).then(()=>toast('Copiado âœ“','success')).catch(()=>{});}
function _adsCopyItemRow(cat,i,text,limit){
  const len=[...String(text)].length;const ok=len<=limit;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--surface2);border-radius:5px;margin-bottom:4px">
    <span style="flex:1;min-width:0;font-size:12px;color:var(--text);word-break:break-word">${escapeHtml(text)}</span>
    <span style="font-size:9px;font-weight:600;flex-shrink:0;color:${ok?'var(--success)':'var(--danger)'}">${len}/${limit}</span>
    <button onclick="_adsCopyClip('${cat}',${i})" style="background:none;border:1px solid var(--border2);color:var(--text3);border-radius:4px;padding:2px 7px;font-size:10px;cursor:pointer;flex-shrink:0">ğŸ“‹</button>
  </div>`;
}
async function adsGenerateAdCopy(termino,campana){
  const ov=_adsCopyOverlay();
  const kw=String(termino||'').trim();
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div><div style="font-weight:700;font-size:15px;color:var(--text)">âœ Anuncios para Â«${escapeHtml(kw)}Â»</div><div style="font-size:11px;color:var(--text3)">${escapeHtml(campana||'')}</div></div>
      <button onclick="document.getElementById('adsCopyOverlay').remove()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">Ã—</button>
    </div>
    <div id="adsCopyBody"><div class="loading-state" style="padding:30px 0;text-align:center"><div class="spinner"></div><div style="color:var(--text3);font-size:12px;margin-top:10px">Generando anuncios optimizadosâ€¦</div></div></div>
  </div>`;
  const sys=`Eres copywriter senior de Google Ads para The Lab Solutions, fabricaciÃ³n digital premium en Santiago, Chile (impresiÃ³n 3D, trofeos y medallas, seÃ±alÃ©tica acrÃ­lico, neones LED, packaging).
Escribes anuncios de bÃºsqueda responsivos (RSA) en espaÃ±ol chileno, persuasivos y de alta relevancia.
REGLAS DURAS:
- TÃ­tulos: mÃ¡ximo 30 caracteres CADA UNO (cuenta los caracteres, no te pases).
- Descripciones: mÃ¡ximo 90 caracteres CADA UNA.
- Rutas de visualizaciÃ³n: mÃ¡ximo 15 caracteres cada una.
- Incluye la palabra clave (o su raÃ­z) en al menos 3 tÃ­tulos para subir la relevancia/Quality Score.
- Variedad: beneficios, diferenciadores, llamados a la acciÃ³n (CTA), prueba social, urgencia. Sin clickbait falso.
- Nada de mayÃºsculas sostenidas ni signos de exclamaciÃ³n repetidos. Profesional y local.
Responde SOLO con un objeto JSON vÃ¡lido, sin texto adicional ni markdown, con esta forma exacta:
{"titulos":["...", ... 12 Ã­tems], "descripciones":["...", ...4 Ã­tems], "rutas":["...","..."]}`;
  const user=`Palabra clave objetivo: "${kw}"${campana?`\nCampaÃ±a: ${campana}`:''}
Genera 12 tÃ­tulos, 4 descripciones y 2 rutas para esta keyword. Respeta los lÃ­mites de caracteres al pie de la letra.`;
  try{showAgentWorking('ADS',{verb:'estÃ¡ escribiendo tus anunciosâ€¦',messages:['Analizando la palabra claveâ€¦','Redactando tÃ­tulos que conviertenâ€¦','Cuidando los lÃ­mites de caracteresâ€¦']});}catch(e){}
  try{
    const raw=await callAgentClaude('ADS',sys,user);
    let obj=null;
    try{const mm=String(raw).match(/\{[\s\S]*\}/);obj=JSON.parse(mm?mm[0]:raw);}catch(e){obj=null;}
    const body=document.getElementById('adsCopyBody');
    if(!body)return;
    if(!obj||!Array.isArray(obj.titulos)){
      body.innerHTML=`<div style="color:var(--danger);font-size:12px">No pude interpretar la respuesta. Texto crudo:</div><pre style="white-space:pre-wrap;font-size:11px;color:var(--text2);margin-top:8px">${escapeHtml(String(raw).slice(0,1200))}</pre>`;
      return;
    }
    const titulos=(obj.titulos||[]).map(String),descripciones=(obj.descripciones||[]).map(String),rutas=(obj.rutas||[]).map(String);
    _adsCopyData={titulos,descripciones,rutas};
    const overTit=titulos.filter(t=>[...t].length>_RSA_LIMITS.titulo).length;
    const overDes=descripciones.filter(t=>[...t].length>_RSA_LIMITS.descripcion).length;
    const warn=(overTit||overDes)?`<div style="font-size:10px;color:var(--warn);margin-bottom:8px">âš  ${overTit+overDes} elemento(s) exceden el lÃ­mite (en rojo) â€” edÃ­talos antes de pegar.</div>`:'';
    body.innerHTML=`${warn}
      <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px"><div style="font-size:11px;font-weight:700;color:var(--text2)">TÃTULOS (${titulos.length})</div><button class="btn btn-ghost btn-sm" onclick="_adsCopyClipAll('titulos')">ğŸ“‹ Copiar todos</button></div>
      ${titulos.map((t,i)=>_adsCopyItemRow('titulos',i,t,_RSA_LIMITS.titulo)).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px"><div style="font-size:11px;font-weight:700;color:var(--text2)">DESCRIPCIONES (${descripciones.length})</div><button class="btn btn-ghost btn-sm" onclick="_adsCopyClipAll('descripciones')">ğŸ“‹ Copiar todas</button></div>
      ${descripciones.map((t,i)=>_adsCopyItemRow('descripciones',i,t,_RSA_LIMITS.descripcion)).join('')}
      ${rutas.length?`<div style="font-size:11px;font-weight:700;color:var(--text2);margin:12px 0 6px">RUTAS</div>${rutas.map((t,i)=>_adsCopyItemRow('rutas',i,t,_RSA_LIMITS.ruta)).join('')}`:''}
      <div style="font-size:10px;color:var(--text3);margin-top:12px;line-height:1.5">PÃ©galos en Google Ads â†’ tu grupo de anuncios â†’ Anuncios â†’ nuevo anuncio responsivo de bÃºsqueda. MantÃ©n los que tengan la keyword para subir el Quality Score del componente "anuncio".</div>`;
  }catch(e){
    const body=document.getElementById('adsCopyBody');
    if(body)body.innerHTML=`<div style="color:var(--danger);font-size:12px">Error generando anuncios: ${escapeHtml(e.message||String(e))}</div>`;
  }finally{try{hideAgentWorking();}catch(e){}}
}
function runAdsAgent(){
  if(!window._adsLastData){toast('Carga primero los datos de Google Ads','error');return;}
  if(window._adsLastData.demo){toast('Datos DEMO â€” conecta tu cuenta para acciones reales','info');}
  const ctx='Analiza la cuenta de Google Ads y propone acciones concretas.';
  runAgentInline('ADS',ctx,(result)=>{
    const actions=_parseAdsActions(result);window._adsAgentActions=actions;
    // limpiar el bloque [ACTIONS] del texto visible
    const rEl=document.getElementById('agentInlineResult');if(rEl){rEl.style.whiteSpace='normal';rEl.innerHTML=formatAgentReport(result);}
    // log de memoria (quÃ© recomendÃ³ y cuÃ¡ndo)
    try{_adsLogRecommendation(actions,result);}catch(e){}
    const btns=_adsRenderActionBtns(actions);
    return btns+`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}
// â”€â”€ Reporte Ads semanal automÃ¡tico (genera + email 1Ã—/semana al cargar datos) â”€â”€
function adsToggleAutoWeekly(on){
  localStorage.setItem('ads_auto_weekly',on?'1':'0');
  if(on){const def=(typeof AUTH!=='undefined'&&AUTH.getUser&&AUTH.getUser()?.email)||'';const to=prompt('Â¿A quÃ© correo enviar el reporte Google Ads semanal?',localStorage.getItem('ads_auto_email')||def||'');if(to&&validEmail(to.trim())){localStorage.setItem('ads_auto_email',to.trim());toast('âœ“ Reporte Ads semanal activado','success');}else if(to!==null)toast('Correo invÃ¡lido â€” se generarÃ¡ igual sin envÃ­o','info');}
  else toast('Reporte Ads semanal desactivado','info');
}
let _adsAutoRunning=false;
async function adsAutoWeeklyCheck(){
  if(localStorage.getItem('ads_auto_weekly')!=='1'||!window._adsLastData||window._adsLastData.demo||_adsAutoRunning)return;
  const wk=(typeof _isoWeekKey==='function')?_isoWeekKey():new Date().toISOString().slice(0,7);
  if(localStorage.getItem('ads_auto_last_week')===wk)return;
  _adsAutoRunning=true;
  try{
    const sys=AGENTES_CFG.find(a=>a.id==='ADS').sys, ctx=buildAgentContext('ADS');
    const resp=await callAgentClaude('ADS',sys,ctx);
    localStorage.setItem('ads_auto_last_week',wk);
    try{_adsLogRecommendation(_parseAdsActions(resp),resp);}catch(e){}
    const to=localStorage.getItem('ads_auto_email')||'';
    const body=String(resp).replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/i,'').trim();
    if(to&&typeof MAIL!=='undefined'){try{await MAIL.post({action:'send',to,subject:`Reporte Google Ads ${wk} â€” The Lab Solutions`,body,from_name:'The Lab Solutions'});toast('âœ“ Reporte Ads semanal generado y enviado','success');}catch(e){toast('Reporte Ads generado (no se pudo enviar)','info');}}
    else toast('âœ“ Reporte Ads semanal generado','success');
  }catch(e){console.error('adsAutoWeeklyCheck:',e);}
  finally{_adsAutoRunning=false;}
}
// Memoria de recomendaciones del agente Ads (para realimentar y no repetir)
function _adsLogRecommendation(actions,text){
  let log=[];try{log=JSON.parse(localStorage.getItem('ads_agent_log')||'[]');}catch(e){}
  log.push({t:new Date().toISOString(),n:actions.length,acciones:actions.map(a=>a.tipo+(a.campana?':'+a.campana:'')),resumen:(text||'').slice(0,400)});
  if(log.length>20)log=log.slice(-20);
  try{localStorage.setItem('ads_agent_log',JSON.stringify(log));}catch(e){}
}

// â€” ADS copy generator para campaÃ±a especÃ­fica
function runAdsCopyAgent(d){
  const ctx=`Genera 3 variaciones de anuncio de texto para Google Ads para la siguiente campaÃ±a de The Lab Solutions.\n\nCampaÃ±a: "${d.nombre}"\nEstado: ${d.estado==='ENABLED'?'Activa':'Pausada'} | Gasto: ${fmtMoney(d.gasto)} | CTR: ${d.ctr}% | CPC: ${fmtMoney(d.cpc)} | Conversiones: ${d.conv}\n\nEmpresa: fabricaciÃ³n digital premium en Santiago â€” trofeos personalizados, medallas, neones LED, impresiÃ³n 3D, seÃ±alÃ©tica acrÃ­lico.\n\nPara cada variaciÃ³n:\n- TÃ­tulo 1 (mÃ¡x 30 car.)\n- TÃ­tulo 2 (mÃ¡x 30 car.)\n- TÃ­tulo 3 (mÃ¡x 30 car.)\n- DescripciÃ³n 1 (mÃ¡x 90 car.)\n- DescripciÃ³n 2 (mÃ¡x 90 car.)\n- Ruta de pantalla: thelab.solutions/[algo relevante]\n\nEnfoca en el beneficio del cliente. CTA claro. Sin inventar premios ni certificaciones.`;
  runAgentInline('ADS',ctx,()=>`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar copy</button>`);
}

// â€” REPCLIENTE: update de estado al cliente desde pedido
function runRepClienteAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const cid=Array.isArray(f['Cliente'])?f['Cliente'][0]:null;
  const cl=cid?state.clientesByIdRec[cid]:null;
  const waPhone=cl?_getClienteWAPhone(cl):'';
  const email=cl?.fields['Email']||'';
  const today=new Date();today.setHours(0,0,0,0);
  const atrasado=f['Fecha entrega']&&new Date(f['Fecha entrega']+'T00:00:00')<today;
  const sol=(f['Solicitud cliente (texto libre)']||f['DescripciÃ³n del pedido']||f['Detalle productos']||'Sin detalle').substring(0,200);
  const ctx=`Pedido: ${f['NÂ° Pedido']||'â€”'} | Cliente: ${resolveClienteName(f['Cliente'])} | Estado: ${f['Estado pedido']||'â€”'} | Entrega: ${f['Fecha entrega']||'â€”'}${atrasado?' âš  ATRASADO':''}\nProducto: ${sol}\nQA: ${f['Resultado QA']||'Pendiente'}\nTAREA: genera el update de estado para el cliente, claro y tranquilizador.`+AGENT_MSG_RULES;
  runAgentInline('REPCLIENTE',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','')">ğŸ“² WhatsApp cliente</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Update de tu pedido â€” The Lab Solutions','')">âœ‰ï¸ Enviar correo</button>`:'';
    return`${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

// â€” CONTENT: generar post de redes para pedido despachado
function runContentAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const sol=(f['Solicitud cliente (texto libre)']||f['DescripciÃ³n del pedido']||f['Detalle productos']||'Sin detalle').substring(0,300);
  const montoNeto=f['Monto total (CLP)']?'$'+Math.round(f['Monto total (CLP)']/1.19).toLocaleString('es-CL')+' neto':'â€”';
  const ctx=`Proyecto entregado:\nNÂ° Pedido: ${f['NÂ° Pedido']||'â€”'} | Fecha despacho: ${f['Fecha despacho']||f['Fecha entrega']||'â€”'} | Monto: ${montoNeto}\nProducto: ${sol}\nQA: ${f['Resultado QA']||'Aprobado'}\nGenera contenido para los 3 formatos con el mÃ¡ximo impacto visual y de conversiÃ³n.`;
  runAgentInline('CONTENT',ctx,()=>`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar contenido</button>`);
}

// â€” PRODUCTION desde pedido
function runProductionAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const ctx=`Pedido: ${f['NÂ° Pedido']||'â€”'} | Cliente: ${resolveClienteName(f['Cliente'])}\nEstado: ${f['Estado pedido']||'â€”'} | Entrega: ${f['Fecha entrega']||'â€”'} | Equipo: ${f['Equipo asignado']||'Sin asignar'}\nSolicitud: ${(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Sin detalle').substring(0,300)}`;
  runAgentInline('PRODUCTION',ctx,()=>{
    const hasFicha=!!parseFichaData(p.fields['Ficha Tecnica']);
    return `<button class="btn btn-primary btn-sm" onclick="saveProductionFicha('${pedidoId}')">${hasFicha?'ğŸ”„ Reemplazar':'ğŸ’¾ Guardar'} Ficha TÃ©cnica</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`;
  });
}

async function saveProductionFicha(pedidoId){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const p=state.pedidosById[pedidoId];if(!p) return;
  const existing=parseFichaData(p.fields['Ficha Tecnica'])||{};
  existing.instrucciones=_agentInlineText;
  existing.generadoIA=hoyCL();
  const btnEl=document.querySelector('#agentInlineActions .btn-primary');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Guardando...';}
  try{
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Ficha Tecnica':JSON.stringify(existing)});
    p.fields['Ficha Tecnica']=JSON.stringify(existing);
    toast('âœ“ Ficha TÃ©cnica guardada','success');
    closeAgentInlineModal();renderPedidos();
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btnEl){btnEl.disabled=false;btnEl.textContent='ğŸ’¾ Guardar Ficha TÃ©cnica';}}
}

// â€” Rellena las notas de producciÃ³n del modal Ficha con el PRODUCTION_AGENT (inline, sin abrir otro modal)
async function rellenarFichaNotasIA(){
  const id=document.getElementById('fichaPedidoId').value;
  const p=state.pedidosById[id];const f=p?.fields||{};
  const mat=document.getElementById('fichaMaterial').value,col=document.getElementById('fichaColor').value,cant=document.getElementById('fichaCantidad').value,acab=document.getElementById('fichaAcabado').value;
  const sol=(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'').trim();
  if(!sol&&!mat&&!col){toast('Indica al menos material o la solicitud del pedido','error');return;}
  const btn=document.getElementById('fichaIABtn');const prev=btn.innerHTML;btn.disabled=true;btn.innerHTML='â³â€¦';
  try{showAgentWorking('PRODUCTION',{verb:'estÃ¡ redactando las notas de producciÃ³nâ€¦'});}catch(e){}
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='PRODUCTION');
    const ctx=[
      f['NÂ° Pedido']?`Pedido: ${f['NÂ° Pedido']}`:'',
      sol?`Solicitud: ${sol}`:'',
      mat?`Material: ${mat}`:'',col?`Color: ${col}`:'',cant?`Cantidad: ${cant}`:'',acab?`Acabado: ${acab}`:'',
      'TAREA: redacta SOLO las notas de producciÃ³n (instrucciones concretas para el operador). Sin encabezados, conciso, en viÃ±etas o pÃ¡rrafos cortos.'
    ].filter(Boolean).join('\n');
    const raw=await callAgentClaude('PRODUCTION',cfg.sys,ctx);
    const ta=document.getElementById('fichaNotas');
    ta.value=(ta.value.trim()?ta.value.trim()+'\n\n':'')+raw.trim();
    toast('âœ“ Notas generadas con IA','success');
  }catch(e){toast('Error IA: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}btn.disabled=false;btn.innerHTML=prev;}
}

// â€” QA desde pedido
function runQAAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const ctx=`Pedido: ${f['NÂ° Pedido']||'â€”'} | Cliente: ${resolveClienteName(f['Cliente'])}\nEntrega: ${f['Fecha entrega']||'â€”'}\nSolicitud/Producto: ${(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Sin detalle').substring(0,300)}`;
  runAgentInline('QA',ctx,()=>
    `<button class="btn btn-sm" style="background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#10b981;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700" onclick="saveQAFromAgent('${pedidoId}','QA aprobado')">âœ… Guardar: Aprobado</button><button class="btn btn-sm" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#ef4444;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700" onclick="saveQAFromAgent('${pedidoId}','Rechazado')">âŒ Guardar: Rechazado</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">ğŸ“‹ Copiar</button>`
  );
}

async function saveQAFromAgent(pedidoId,resultado){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const p=state.pedidosById[pedidoId];if(!p) return;
  try{
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Resultado QA':resultado,'Notas QA':_agentInlineText});
    p.fields['Resultado QA']=resultado;p.fields['Notas QA']=_agentInlineText;
    toast(`âœ“ QA ${resultado}`,'success');
    closeAgentInlineModal();renderPedidos();renderOverview();
  }catch(e){toast('Error: '+e.message,'error');}
}

// â”€â”€ CADENA DE AGENTES (PRODUCTION â†’ QA) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _parseQAChecklist(text){
  const items=[];
  text.split('\n').forEach(l=>{
    const m=l.match(/^\s*(?:[-*]\s*)?\[([ xX])\]\s*(.+)/);
    if(m) items.push({texto:m[2].trim(),checked:m[1]!==' '});
  });
  return items.length>=3?items:null;
}

async function runAgentChain(pedidoId,solicitudOverride){
  const p=state.pedidosById[pedidoId];if(!p){toast('Pedido no encontrado','error');return;}
  const f=p.fields;
  const num=f['NÂ° Pedido']||'â€”';
  const solicitud=(solicitudOverride||f['Solicitud clienm«ëŒ+Š×®º+º$zzb¥