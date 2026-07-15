/* js/agentes.js — agentes inline, bandejas, CTA y proveedores (extraído de index.html). */

// ── AGENTES INLINE ─────────────────────────────────────────────
let _agentInlineText='';

function closeAgentInlineModal(){document.getElementById('agentInlineModal').style.display='none';_agentInlineText='';}

function copyAgentResult(){if(!_agentInlineText){toast('Sin contenido','error');return;}navigator.clipboard.writeText(_agentInlineText).then(()=>toast('Copiado ✓','success')).catch(()=>toast('No se pudo copiar','error'));}

function _getClienteRecFromField(field){
  if(!field) return null;
  if(Array.isArray(field)&&field.length) return state.clientes.find(c=>c.id===field[0])||null;
  if(typeof field==='string') return state.clientes.find(c=>c.fields['Empresa']===field)||null;
  return null;
}

function _getClienteWAPhone(cliRec){
  if(!cliRec) return '';
  const wa=(cliRec.fields['WhatsApp']||'').replace(/\D/g,'');
  const tel=(cliRec.fields['Teléfono']||'').replace(/\D/g,'');
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

// ── Mensajes listos para enviar (naturales, sin emojis ni asteriscos) ──────
// Regla que se anexa a los agentes de cliente para estandarizar los dos mensajes.
const AGENT_MSG_RULES='\n\nFORMATO DE LOS MENSAJES LISTOS PARA ENVIAR (obligatorio): al final entrega DOS mensajes numerados, exactamente así:\n1. WhatsApp: (2 a 4 líneas)\n2. Email: (primera línea "Asunto: ..." y luego el cuerpo, con cierre cordial firmado "Equipo The Lab Solutions")\nAmbos en español chileno natural y cercano, como los escribiría a mano una persona del equipo. PROHIBIDO usar emojis, asteriscos, negritas o cualquier símbolo de formato (markdown, viñetas, comillas de bloque ">"): solo texto plano listo para copiar, pegar y enviar. No uses marcadores como [nombre] ni [empresa]: usa el dato real si lo tienes, o un saludo neutro si no.';

// Limpia un mensaje para enviar: quita emojis y marcas de formato (asteriscos,
// markdown, viñetas, citas) dejando texto plano y natural.
function _cleanMsg(s){
  let t=String(s||'');
  t=t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{2190}-\u{21FF}]/gu,'');
  t=t.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1');
  t=t.replace(/[*_`]+/g,'');
  t=t.replace(/^\s{0,3}#{1,6}\s*/gm,'');
  t=t.replace(/^\s{0,3}>\s?/gm,'');
  t=t.replace(/^\s{0,3}[-•]\s+/gm,'');
  t=t.replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n');
  return t.trim();
}

// ── REACTIVADO: marca al cliente/lead tras enviarle un mensaje desde un agente ──
async function marcarReactivado(cliId,via){
  const c=state.clientes&&state.clientes.find(x=>x.id===cliId); if(!c) return;
  const yaEstaba=!!c.fields['Reactivado'];
  const fecha=new Date().toISOString().split('T')[0];
  c.fields['Reactivado']=true; c.fields['Fecha reactivación']=fecha;   // optimista en local
  try{if(typeof renderClientes==='function') renderClientes(true);}catch(e){}
  try{_markAgentModalReactivado();}catch(e){}
  if(!yaEstaba){try{toast('♻ '+(c.fields['Empresa']||'Cliente')+' marcado como Reactivado','success');}catch(e){}}
  try{
    await airtableWrite('Clientes','PATCH',cliId,{'Reactivado':true,'Fecha reactivación':fecha});
  }catch(e){
    if(String(e.message||'').toLowerCase().includes('unknown')){try{ensureClienteReactivadoFields();}catch(_){}}
  }
}
// Quita a mano la marca de Reactivado de un cliente/lead (clic en el badge).
async function quitarReactivado(cliId){
  const c=state.clientes&&state.clientes.find(x=>x.id===cliId); if(!c) return;
  if(!confirm('¿Quitar la marca de Reactivado de '+(c.fields['Empresa']||'este cliente')+'?')) return;
  c.fields['Reactivado']=false; c.fields['Fecha reactivación']=null;   // optimista en local
  try{if(typeof renderClientes==='function') renderClientes(true);}catch(e){}
  try{toast('Marca de Reactivado quitada','info');}catch(e){}
  try{await airtableWrite('Clientes','PATCH',cliId,{'Reactivado':false,'Fecha reactivación':null});}catch(e){}
}
async function ensureClienteReactivadoFields(){
  try{
    const t=(typeof getToken==='function'?getToken():'')||'';
    if(!t&&typeof _proxyCfg==='function'&&!_proxyCfg()) return;
    const tableId='tblKCNnXwAfDiKbQz';
    const needed=[{name:'Reactivado',type:'checkbox',options:{icon:'check',color:'greenBright'}},{name:'Fecha reactivación',type:'date',options:{dateFormat:{name:'iso'}}}];
    for(const c of needed){try{await _atFetch(`/meta/bases/${BASE_ID}/tables/${tableId}/fields`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});}catch(e){}}
  }catch(e){}
}
function _markAgentModalReactivado(){
  const actions=document.getElementById('agentInlineActions');
  if(!actions||actions.querySelector('.reactivado-chip')) return;
  const chip=document.createElement('span');
  chip.className='badge badge-green reactivado-chip';
  chip.style.cssText='align-self:center;font-size:11px;padding:5px 9px';
  chip.textContent='♻ Reactivado';
  actions.appendChild(chip);
}

// Envía el mensaje de WhatsApp del agente (prellenado y limpio) y marca reactivado.
function agentSendWA(phone,cliId){
  const waPart=_cleanMsg(_extractWAPart(_agentInlineText)||_agentInlineText);
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(waPart),'_blank');
  if(window._fuCotId){try{fuMarkDone(window._fuCotId,'WhatsApp');}catch(e){}window._fuCotId=null;}
  if(cliId){try{marcarReactivado(cliId,'WhatsApp');}catch(e){}}
}

// Abre un BORRADOR de correo en la sección Correos con el mensaje del agente,
// listo para revisar y enviar. Al enviarlo de verdad, marca al cliente Reactivado
// (y registra el seguimiento de la cotización si aplica).
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
  window._fuCotId=null;   // evita registrar seguimientos de una cotización anterior
  const modal=document.getElementById('agentInlineModal');
  const resultEl=document.getElementById('agentInlineResult');
  const actionsEl=document.getElementById('agentInlineActions');
  document.getElementById('agentInlineTitle').textContent='🤖 '+cfg.label;
  resultEl.className='agent-modal-result loading';
  resultEl.style.whiteSpace='';
  resultEl.textContent='⏳ Procesando...';
  actionsEl.innerHTML='';
  _agentInlineText='';
  modal.style.display='flex';
  try{showAgentWorking(cfg);}catch(e){}
  const ctx=state.loaded?buildAgentContext(agentId):'';
  const fullInput=ctx?`${ctx}\n\nCONSULTA: ${contextText}`:contextText;
  try{
    const result=await callClaude(cfg.sys+AGENT_TONE,fullInput);
    _agentInlineText=result;
    resultEl.className='agent-modal-result';
    resultEl.style.whiteSpace='normal';resultEl.innerHTML=formatAgentReport(result);
    if(actionsFn) actionsEl.innerHTML=actionsFn(result);
    else actionsEl.innerHTML=agentCtaButtonsHtml('',result)+'<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>';
    try{AGENT_LOG.add(cfg.label,contextText,result);}catch(e){}
  }catch(e){
    resultEl.className='agent-modal-result';
    resultEl.textContent='❌ Error: '+e.message;
    toast('Error agente: '+e.message,'error');
  }finally{try{hideAgentWorking();}catch(e){}}
}

// — FOLLOWUP desde cotización
// ── BANDEJA DE SEGUIMIENTOS ────────────────────────────────────
// Detecta cotizaciones 'Enviada' sin respuesta hace N+ días y las deja listas
// para hacer seguimiento con 1 clic (FOLLOWUP_AGENT + CTA WhatsApp/correo).
// El registro de seguimientos hechos vive en localStorage (thelab_fu_log_v1)
// y, best-effort, en el campo 'Último seguimiento' de la cotización si existe.
const _FU_LOG_KEY='thelab_fu_log_v1';
function _fuLog(){try{return JSON.parse(localStorage.getItem(_FU_LOG_KEY)||'{}');}catch(e){return{};}}
function _fuDays(){const v=parseInt(localStorage.getItem('thelab_fu_days'));return [3,5,7,10].includes(v)?v:5;}
function fuSetDays(v){localStorage.setItem('thelab_fu_days',v);buildFollowupTray();}
// Secuencia de 3 toques a partir del día base elegido: base, base+3, base+8.
// El log guarda cuántos toques se hicieron ({ts,via,toques}); tras 3 sin
// respuesta la cotización sale de la bandeja (queda para el win-back al vencer).
function _fuSched(){const b=_fuDays();return [b,b+3,b+8];}
function _fuToques(cotId){const e=_fuLog()[cotId];return (e&&e.toques)||0;}
const _FU_ETIQ=['1er toque','2º toque','3er toque (último)'];
function buildFollowupTray(){
  const card=document.getElementById('fuTrayCard'); if(!card) return;
  const sel=document.getElementById('fuTrayDays'); if(sel) sel.value=String(_fuDays());
  const sched=_fuSched(), log=_fuLog(), now=Date.now();
  const _t=new Date();_t.setHours(0,0,0,0);
  const cands=(state.cotizaciones||[]).map(c=>{
    const f=c.fields;
    if((f['Estado cotización']||'')!=='Enviada') return null;
    const fecha=f['Fecha cotización']||(c.createdTime||'').slice(0,10);
    if(!fecha) return null;
    const dias=Math.floor((_t-new Date(fecha+'T00:00:00'))/864e5);
    const e=log[c.id]||{}, toques=e.toques||0;
    if(toques>=3) return null;                       // secuencia agotada
    if(dias<sched[toques]) return null;              // aún no toca este toque
    if(e.ts && now-e.ts<2*864e5) return null;        // <2 días desde el último toque
    return {c,f,dias,toque:toques};
  }).filter(Boolean).sort((a,b)=>b.toque-a.toque||b.dias-a.dias);
  const cnt=document.getElementById('fuTrayCount'); if(cnt) cnt.textContent=cands.length;
  if(!cands.length){card.style.display='none';return;}
  card.style.display='';
  const list=document.getElementById('fuTrayList'); if(!list) return;
  list.innerHTML=cands.slice(0,12).map(x=>{
    const neto=x.f['Total final (CLP)']?formatCLP(Math.round(x.f['Total final (CLP)']/1.19)):'—';
    const vto=x.f['Fecha vencimiento']?Math.round((new Date(x.f['Fecha vencimiento']+'T00:00:00')-_t)/864e5):null;
    const vtoChip=vto==null?'':(vto<0?` · <span style="color:var(--danger)">vencida hace ${-vto}d</span>`:` · vence en ${vto}d`);
    const tCol=x.toque===2?'badge-red':x.toque===1?'badge-orange':'badge-yellow';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      <span class="badge ${tCol}" style="flex-shrink:0" title="${x.dias} días sin respuesta">${_FU_ETIQ[x.toque]}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(resolveClienteName(x.f['Cliente']))}</div>
        <div style="font-size:10.5px;color:var(--text3)">${escapeHtml(x.f['N° Cotización']||'—')} · ${neto} neto · ${x.dias}d${vtoChip}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="runFollowupAgent('${x.c.id}')">✨ Seguimiento IA</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar este toque como hecho sin enviar" onclick="fuMarkDone('${x.c.id}','manual')">✓</button>
    </div>`;
  }).join('')+(cands.length>12?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">…y ${cands.length-12} más</div>`:'');
}
async function fuMarkDone(cotId,via){
  const log=_fuLog(); const prev=log[cotId]||{};
  log[cotId]={ts:Date.now(),via:via||'manual',toques:Math.min((prev.toques||0)+1,3)};
  try{localStorage.setItem(_FU_LOG_KEY,JSON.stringify(log));}catch(e){}
  try{await airtableWriteTolerant('Cotizaciones','PATCH',cotId,{'Último seguimiento':new Date().toISOString().slice(0,10)});}catch(e){}
  if(via&&via!=='manual') toast('✓ Seguimiento registrado ('+via+') — toque '+log[cotId].toques+'/3','success');
  buildFollowupTray();
}

// ── LEADS DORMIDOS (win-back accionable) ───────────────────────
// Dos perfiles: "nunca compró" (2+ cotizaciones, 0 pedidos, 30+ días quieto)
// y "ex-cliente" (compró alguna vez y lleva 60+ días sin actividad). Se
// excluye a quien tiene una cotización abierta reciente, está bloqueado o ya
// fue gestionado hace <30 días (registro en thelab_wb_log_v1).
const _WB_LOG_KEY='thelab_wb_log_v1';
function _wbLog(){try{return JSON.parse(localStorage.getItem(_WB_LOG_KEY)||'{}');}catch(e){return{};}}
function _wbCands(){
  const now=Date.now(),log=_wbLog();
  const cotsByCli={},pedsByCli={};
  (state.cotizaciones||[]).forEach(c=>(Array.isArray(c.fields['Cliente'])?c.fields['Cliente']:[]).forEach(id=>(cotsByCli[id]=cotsByCli[id]||[]).push(c)));
  (state.pedidos||[]).forEach(p=>(Array.isArray(p.fields['Cliente'])?p.fields['Cliente']:[]).forEach(id=>(pedsByCli[id]=pedsByCli[id]||[]).push(p)));
  const lastTs=r=>{const f=r.fields;const d=f['Fecha cotización']||f['Fecha entrega']||f['Fecha despacho']||(r.createdTime||'').slice(0,10);return d?new Date(d+(d.length===10?'T00:00:00':'')).getTime():0;};
  return (state.clientes||[]).map(c=>{
    const f=c.fields;
    if((f['Estado cuenta']||'')==='Bloqueado') return null;
    const cots=cotsByCli[c.id]||[],peds=pedsByCli[c.id]||[];
    const acts=[...cots,...peds].map(lastTs).filter(Boolean);
    if(!acts.length) return null;
    const dias=Math.floor((now-Math.max(...acts))/864e5);
    if(cots.some(x=>['Enviada','Solicitada'].includes(x.fields['Estado cotización']||'')&&now-lastTs(x)<45*864e5)) return null;
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
      ?`<span class="badge badge-purple" style="flex-shrink:0" title="Compró antes y desapareció">💎 ex-cliente</span>`
      :`<span class="badge badge-yellow" style="flex-shrink:0" title="Cotizó ${x.nCots} veces y nunca compró">🌱 nunca compró</span>`;
    const sub=x.tipo==='ex'?`${formatCLP(x.rev)} histórico · ${x.nPeds} pedido${x.nPeds!==1?'s':''}`:`${x.nCots} cotizaciones sin cierre`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      ${chip}
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.f['Empresa']||x.f['Contacto']||'—')}</div>
        <div style="font-size:10.5px;color:var(--text3)">😴 ${x.dias} días sin actividad · ${sub}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="wbReactivar('${x.c.id}')">♻ Reactivar IA</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar como gestionado sin enviar" onclick="wbMarkDone('${x.c.id}')">✓</button>
    </div>`;
  }).join('')+(cands.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">…y ${cands.length-10} más (se muestran primero los de mayor revenue histórico)</div>`:'');
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
  toast('✓ Gestionado — no volverá a aparecer por 30 días','success');
  buildWinbackTray();
}

// ── RECOMPRA PREDICTIVA (O3) ───────────────────────────────────
// Clientes recurrentes (2+ pedidos) con una cadencia de compra estimada: cuando
// el tiempo desde el último pedido alcanza ~su cadencia habitual, es momento de
// invitarlos a reponer — proactivo, ANTES de que se enfríen (eso lo cubre winback).
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
  if(!(cadencia>=7&&cadencia<=400)) return null;            // cadencia razonable (semana a ~año)
  const last=fechas[fechas.length-1];
  const diasDesde=Math.floor((Date.now()-last)/864e5);
  const ratio=diasDesde/cadencia;
  return {cadencia:Math.round(cadencia),diasDesde,ratio,nPeds:fechas.length,last};
}
function _recompraCands(){
  const log=_recompraLog();
  return (state.clientes||[]).map(c=>{
    if(log[c.id]&&(Date.now()-log[c.id].ts<30*864e5)) return null;   // gestionado hace <30 días
    const info=_recompraInfo(c);if(!info) return null;
    // "toca" desde el 85% de la cadencia y hasta 2.5× (más allá es winback, no recompra)
    if(info.ratio<0.85||info.ratio>2.5) return null;
    return {c,f:c.fields,...info};
  }).filter(Boolean).sort((a,b)=>b.ratio-a.ratio);
}
function _recompraMsg(cand){
  const nombre=cand.f['Contacto']?String(cand.f['Contacto']).trim().split(/\s+/)[0]:'';
  const emp=cand.f['Empresa']||'';
  return `Hola${nombre?' '+nombre:''} 👋 Te saludo de The Lab Solutions. Vimos que sueles renovar con nosotros cada ~${cand.cadencia} días y ya pasó un tiempo desde tu último pedido${emp?` (${emp})`:''}. ¿Te preparamos una nueva producción o cotización? Cuéntanos qué necesitas y lo dejamos listo. 💙`;
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
      <span class="badge ${vencido?'badge-orange':'badge-yellow'}" style="flex-shrink:0" title="Días desde el último pedido vs. cadencia habitual">${x.diasDesde}d / ~${x.cadencia}d</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.f['Empresa']||x.f['Contacto']||'—')}</div>
        <div style="font-size:10.5px;color:var(--text3)">${x.nPeds} pedidos · compra cada ~${x.cadencia} días${vencido?' · <span style="color:var(--warn)">ya toca reponer</span>':' · a punto'}</div>
      </div>
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="recompraWhatsApp('${cli.id}')" ${tienePhone?'':'title="Sin teléfono en la ficha — se abrirá WhatsApp para elegir contacto"'}>📲</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="recompraEmail('${cli.id}',this)">📧</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar como gestionado (no reaparece por 30 días)" onclick="recompraSnooze('${cli.id}')">✓</button>
    </div>`;
  }).join('')+(cands.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">…y ${cands.length-10} más</div>`:'');
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
  let to=cli.fields['Email']||prompt('¿A qué correo enviamos la invitación de recompra?','');
  if(!to)return; to=String(to).trim();
  if(!validEmail(to)){toast('Correo inválido','error');return;}
  const prev=btn?btn.innerHTML:'';if(btn){btn.disabled=true;btn.textContent='…';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to,subject:'¿Preparamos tu próxima producción? — The Lab Solutions',body:_recompraMsg(cand),from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('✓ Invitación de recompra enviada a '+to,'success');_recompraMark(cliId,'correo');}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=prev;}}
}
function recompraSnooze(cliId){_recompraMark(cliId,'manual');toast('✓ Gestionado — no reaparece por 30 días','success');}

// ── CLIENTES EN RIESGO DE FUGA / CHURN (S3) ────────────────────────────
// Combina señales para detectar clientes recurrentes que se están enfriando o
// tienen problemas: muy pasados de su cadencia, reclamo abierto, NPS bajo o
// facturas vencidas. Distinto de recompra (ventana normal) y winback (leads).
function _churnRiesgo(){
  const log=_recompraLog();
  const reclamos=(typeof _reclamos==='function')?_reclamos():[];
  return (state.clientes||[]).map(c=>{
    const info=_recompraInfo(c);if(!info)return null;          // necesita historial (2+ pedidos)
    const emp=c.fields['Empresa']||c.fields['Contacto']||'';
    const peds=_clientePedidos(c);
    let score=0;const razones=[];
    // 1) muy pasado de su cadencia habitual (más allá de la ventana de recompra)
    if(info.ratio>=2.5){score+=2;razones.push(`${info.diasDesde}d sin comprar (compra cada ~${info.cadencia}d)`);}
    else if(info.ratio>=1.5){score+=1;razones.push('atrasado en su recompra');}
    // 2) reclamo abierto
    const rc=reclamos.find(r=>peds.some(p=>p.id===r.pedidoId)&&(r.estado==='Abierto'||r.estado==='En proceso'));
    if(rc){score+=2;razones.push('reclamo sin resolver');}
    // 3) NPS bajo en algún pedido
    const npsBajo=peds.some(p=>{const s=(typeof _npsScore==='function')?_npsScore(p):null;return s!=null&&s<=2;});
    if(npsBajo){score+=2;razones.push('calificó bajo (NPS ≤2)');}
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
    <div class="card-header"><span class="card-title" style="color:var(--danger)">🚨 Clientes en riesgo de fuga <span class="badge badge-red">${list.length}</span></span>
      <span style="margin-left:auto;font-size:10.5px;color:var(--text3)">recurrentes que se enfrían o con problemas — reactívalos antes de perderlos</span></div>
    <div>${list.slice(0,10).map(x=>{
      const cli=x.c;const tienePhone=!!_getClienteWAPhone(cli);
      const sev=x.score>=4?'badge-red':'badge-orange';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
        <span class="badge ${sev}" style="flex-shrink:0" title="Nivel de riesgo">riesgo ${x.score}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.emp)}${x.rev>0?` <span style="font-size:10px;color:var(--text3)">· ${formatCLP(x.rev)} histórico</span>`:''}</div>
          <div style="font-size:10.5px;color:var(--warn);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.razones.join(' · '))}</div>
        </div>
        <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="churnReactivar('${cli.id}')" title="Reactivar con IA">♻ Reactivar</button>
        <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar gestionado (30 días)" onclick="recompraSnooze('${cli.id}')">✓</button>
      </div>`;
    }).join('')}${list.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">…y ${list.length-10} más</div>`:''}</div>
  </div>`;
}
function churnReactivar(cliId){
  _recompraMark(cliId,'churn');
  if(typeof runClienteWinbackAgent==='function') runClienteWinbackAgent(cliId);
  else if(typeof recompraWhatsApp==='function') recompraWhatsApp(cliId);
  renderChurn();
}

// ── POST-ENTREGA ───────────────────────────────────────────────
// Pedidos despachados hace 3+ días (hasta 30): mensaje de satisfacción con
// invitación a dejar reseña en Google, por WhatsApp o correo (Andrea).
const _PD_LOG_KEY='thelab_postdel_log_v1';
function _pdLog(){try{return JSON.parse(localStorage.getItem(_PD_LOG_KEY)||'{}');}catch(e){return{};}}
function _pdReviewUrl(){return localStorage.getItem('thelab_greview_url')||'';}
function pdSetReviewUrl(){
  const cur=_pdReviewUrl();
  const v=prompt('Enlace de reseña de Google (se incluye en los mensajes post-entrega).\nEn Google Maps: tu negocio → Compartir → "Escribir una reseña".',cur||'https://g.page/r/');
  if(v===null) return;
  const t=v.trim();
  if(t&&!/^https?:\/\//i.test(t)){toast('Debe ser un enlace https://','error');return;}
  if(t) localStorage.setItem('thelab_greview_url',t); else localStorage.removeItem('thelab_greview_url');
  toast(t?'✓ Enlace de reseña guardado':'Enlace de reseña eliminado','success');
}
function _pdCliRec(p){const c=p.fields['Cliente'];const id=Array.isArray(c)?c[0]:null;return id?(state.clientesByIdRec||{})[id]||null:null;}
// URL de la encuesta NPS 1-clic para un pedido (si el lead-worker está configurado).
// La página del worker registra la nota en el pedido y, para notas altas, invita
// a dejar reseña en Google (por eso se le pasa el enlace de reseña como &g).
function _npsWorkerUrl(){
  try{
    const u=(typeof _DEFAULTS!=='undefined'&&_DEFAULTS.LEAD_WORKER_URL)||'';
    if(!u||/^%%/.test(u)) return '';
    return u.replace(/\/$/,'');
  }catch(e){return '';}
}
function _npsLink(p){
  const base=_npsWorkerUrl(); if(!base||!p||!p.id) return '';
  let url=base+'/nps?p='+encodeURIComponent(btoa(p.id));
  const rev=_pdReviewUrl(); if(rev) url+='&g='+encodeURIComponent(rev);
  return url;
}
// ── PORTAL DE SEGUIMIENTO DE PEDIDO (S2) ───────────────────────────────
// Enlace público (worker /pedido) donde el cliente ve el estado de su pedido.
function _seguimientoLink(p){const base=_npsWorkerUrl();if(!base||!p||!p.id)return '';return base+'/pedido?p='+encodeURIComponent(btoa(p.id));}
function compartirSeguimiento(pedidoId){
  const p=(state.pedidosById||{})[pedidoId]||(state.pedidos||[]).find(x=>x.id===pedidoId);if(!p){toast('Pedido no encontrado','error');return;}
  const link=_seguimientoLink(p);if(!link){toast('Configura el lead-worker para compartir seguimiento','info');return;}
  const cli=_pdCliRec(p);const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  const msg=`Hola${nombre?' '+nombre:''} 👋 Aquí puedes seguir el estado de tu pedido ${p.fields['N° Pedido']?('('+p.fields['N° Pedido']+')'):''} en tiempo real: ${link}\n— The Lab Solutions`;
  const phone=cli?_getClienteWAPhone(cli):'';
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(msg),'_blank');
  toast('Compartiendo seguimiento del pedido','success');
}

// ── COMPROBANTE DE ENTREGA / POD (Q7) ──────────────────────────────────
// Pide al cliente confirmar la recepción con un enlace de 1 clic (worker /pod),
// que marca "Recepción confirmada" en el pedido. Mismo patrón que el NPS (N4).
function _podLink(p){const base=_npsWorkerUrl();if(!base||!p||!p.id)return '';return base+'/pod?p='+encodeURIComponent(btoa(p.id));}
function _podConfirmado(p){return !!(p&&p.fields&&p.fields['Recepción confirmada']);}
async function ensurePodFields(){
  try{
    if(typeof getToken==='function'&&!getToken()&&!(typeof _proxyCfg==='function'&&_proxyCfg())) return;
    const r=await _atFetch(`/meta/bases/${BASE_ID}/tables`,{headers:{}});
    if(!r.ok) return;const d=await r.json();const tbl=d.tables?.find(x=>x.name==='Pedidos');if(!tbl) return;
    const have=new Set((tbl.fields||[]).map(x=>x.name));
    const want=[{name:'Recepción confirmada',type:'checkbox',options:{icon:'check',color:'greenBright'}},{name:'Recepción fecha',type:'singleLineText'}];
    for(const w of want){if(have.has(w.name))continue;try{await _atFetch(`/meta/bases/${BASE_ID}/tables/${tbl.id}/fields`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(w)});}catch(e){}}
  }catch(e){}
}
function _podMsg(p){
  const f=p.fields;const cli=_pdCliRec(p);
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  const link=_podLink(p);
  return `Hola${nombre?' '+nombre:''} 👋 Soy de The Lab Solutions. Te despachamos tu pedido ${f['N° Pedido']?('('+f['N° Pedido']+')'):''} y queremos confirmar que llegó todo bien. ¿Nos confirmas la recepción con un clic aquí? ${link}\n¡Gracias! 💙`;
}
function pedirPOD(pedidoId){
  const p=(state.pedidosById||{})[pedidoId]||(state.pedidos||[]).find(x=>x.id===pedidoId);if(!p){toast('Pedido no encontrado','error');return;}
  if(!_podLink(p)){toast('Configura el lead-worker para enviar el comprobante','info');return;}
  try{ensurePodFields();}catch(e){}
  const cli=_pdCliRec(p);const phone=cli?_getClienteWAPhone(cli):'';
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(_podMsg(p)),'_blank');
  toast('Enviando solicitud de confirmación de entrega','success');
}
function _pdMsg(p){
  const f=p.fields;
  const cli=_pdCliRec(p);
  const nombre=cli&&cli.fields['Contacto']?String(cli.fields['Contacto']).trim().split(/\s+/)[0]:'';
  const prod=String(f['Detalle productos']||f['Solicitud cliente (texto libre)']||'').trim().slice(0,60);
  const nps=_npsLink(p);
  const rev=_pdReviewUrl();
  const base=`Hola${nombre?' '+nombre:''} 👋 Soy Andrea de The Lab Solutions. Hace unos días te entregamos ${prod?('tu pedido ('+prod+')'):'tu pedido'} y queríamos saber cómo llegó todo — ¿quedaste conforme? 😊`;
  // Con lead-worker: encuesta de 1 clic (registra la nota y ofrece la reseña si quedó feliz).
  if(nps) return `${base}\n\nCalifícanos en 5 segundos (del 1 al 5): ${nps}\n\n¡Gracias por preferirnos! 💙`;
  // Sin worker: cae al flujo anterior (comentario libre + reseña directa).
  return `${base} Si hubo cualquier detalle, cuéntame y lo resolvemos de inmediato.${rev?`\n\nY si quedaste contento/a, nos ayudarías un montón dejándonos una reseña en Google: ${rev}`:''}\n¡Gracias por preferirnos! 💙`;
}
// Crea los campos NPS en Pedidos bajo demanda (nota, fecha, comentario) para que
// las escrituras del worker persistan. Best-effort: requiere token/proxy con meta.
async function ensureNpsFields(){
  try{
    if(typeof getToken==='function'&&!getToken()&&!(typeof _proxyCfg==='function'&&_proxyCfg())) return;
    const r=await _atFetch(`/meta/bases/${BASE_ID}/tables`,{headers:{}});
    if(!r.ok) return;const d=await r.json();const tbl=d.tables?.find(x=>x.name==='Pedidos');if(!tbl) return;
    const have=new Set((tbl.fields||[]).map(x=>x.name));
    const want=[
      {name:'NPS score',type:'number',options:{precision:0}},
      {name:'NPS fecha',type:'singleLineText'},
      {name:'NPS comentario',type:'multilineText'},
    ];
    for(const w of want){
      if(have.has(w.name)) continue;
      try{await _atFetch(`/meta/bases/${BASE_ID}/tables/${tbl.id}/fields`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(w)});}catch(e){}
    }
  }catch(e){}
}
// Lectura/estadística de las notas ya recibidas (satisfacción tipo CSAT 1-5).
function _npsScore(p){const v=p&&p.fields?parseInt(p.fields['NPS score'],10):NaN;return(v>=1&&v<=5)?v:null;}
function _npsStats(){
  const notas=(state.pedidos||[]).map(_npsScore).filter(v=>v!=null);
  if(!notas.length) return null;
  const n=notas.length,sum=notas.reduce((a,b)=>a+b,0);
  const prom=notas.filter(v=>v>=4).length,detr=notas.filter(v=>v<=2).length;
  return {n,avg:sum/n,promotores:prom,detractores:detr,nps:Math.round((prom-detr)/n*100),pctProm:Math.round(prom/n*100)};
}
// Resumen de satisfacción (CSAT/NPS) con las notas ya recibidas de los clientes.
function renderCsatSummary(){
  const bar=document.getElementById('pdCsatBar'); if(!bar) return;
  const s=_npsStats();
  if(!s){bar.style.display='none';bar.innerHTML='';return;}
  const emo=s.avg>=4.5?'😍':s.avg>=4?'🙂':s.avg>=3?'😐':'🙁';
  const npsCol=s.nps>=50?'var(--accent3)':s.nps>=0?'var(--warn)':'var(--danger)';
  bar.style.display='';
  bar.innerHTML=`<div class="card" style="padding:14px 16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span class="card-title" style="font-size:13px">${emo} Satisfacción post-entrega</span>
      <span style="font-size:10.5px;color:var(--text3)">${s.n} calificación${s.n!==1?'es':''}</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="fac-kpi" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Promedio</span><span class="fac-kpi-val">${s.avg.toFixed(1)} <span style="font-size:11px;color:var(--text3)">/5</span></span></div>
      <div class="fac-kpi" style="flex:1;min-width:90px" title="Net Promoter Score: % de promotores (4-5) menos % de detractores (1-2)"><span class="fac-kpi-lbl">NPS</span><span class="fac-kpi-val" style="color:${npsCol}">${s.nps>0?'+':''}${s.nps}</span></div>
      <div class="fac-kpi" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Promotores</span><span class="fac-kpi-val" style="color:var(--accent3)">${s.pctProm}%</span></div>
      <div class="fac-kpi ${s.detractores?'fac-kpi-danger':''}" style="flex:1;min-width:90px"><span class="fac-kpi-lbl">Detractores</span><span class="fac-kpi-val">${s.detractores}</span></div>
    </div>
  </div>`;
}
function buildPostEntregaTray(){
  try{renderCsatSummary();}catch(e){}
  const card=document.getElementById('pdTrayCard'); if(!card) return;
  const log=_pdLog();
  const _t=new Date();_t.setHours(0,0,0,0);
  const cands=(state.pedidos||[]).map(p=>{
    const f=p.fields;
    if((f['Estado pedido']||'')!=='Despachado') return null;
    const fecha=f['Fecha despacho']||f['Fecha entrega']||'';
    if(!fecha) return null;
    const dias=Math.floor((_t-new Date(fecha+'T00:00:00'))/864e5);
    if(dias<3||dias>30) return null;   // ventana útil: ni muy pronto ni pedidos antiguos
    if(log[p.id]) return null;
    return {p,f,dias};
  }).filter(Boolean).sort((a,b)=>a.dias-b.dias);
  const cnt=document.getElementById('pdTrayCount'); if(cnt) cnt.textContent=cands.length;
  if(!cands.length){card.style.display='none';return;}
  card.style.display='';
  const list=document.getElementById('pdTrayList'); if(!list) return;
  list.innerHTML=cands.slice(0,10).map(x=>{
    const cli=_pdCliRec(x.p);
    const tieneTel=!!(cli&&_getClienteWAPhone(cli));
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--border)">
      <span class="badge badge-green" style="flex-shrink:0" title="Días desde el despacho">${x.dias} d</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(resolveClienteName(x.f['Cliente']))}</div>
        <div style="font-size:10.5px;color:var(--text3)">${escapeHtml(x.f['N° Pedido']||'—')} · despachado el ${formatFecha(x.f['Fecha despacho']||x.f['Fecha entrega'])}</div>
      </div>
      ${_podLink(x.p)?(_podConfirmado(x.p)?'<span class="badge badge-green" style="flex-shrink:0" title="El cliente confirmó la recepción">✅ recibido</span>':`<button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="pedirPOD('${x.p.id}')" title="Pedir confirmación de recepción">📦</button>`):''}
      <button class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="pdWhatsApp('${x.p.id}')" ${tieneTel?'':'title="Sin teléfono en la ficha — se abrirá WhatsApp para elegir contacto"'}>📲</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="pdEmail('${x.p.id}',this)">📧</button>
      <button class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Marcar como gestionado sin enviar" onclick="pdMarkDone('${x.p.id}','manual')">✓</button>
    </div>`;
  }).join('')+(cands.length>10?`<div style="padding:8px 16px;font-size:11px;color:var(--text3)">…y ${cands.length-10} más</div>`:'');
}
function pdWhatsApp(pedidoId){
  const p=(state.pedidosById||{})[pedidoId]||(state.pedidos||[]).find(x=>x.id===pedidoId); if(!p){toast('Pedido no encontrado','error');return;}
  const cli=_pdCliRec(p);
  const phone=cli?_getClienteWAPhone(cli):'';
  if(_npsLink(p)){try{ensureNpsFields();}catch(e){}}   // prepara los campos NPS (best-effort)
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(_pdMsg(p)),'_blank');
  pdMarkDone(pedidoId,'WhatsApp',true);
}
// Abre un BORRADOR del mensaje post-entrega en la sección Correos, listo para
// revisar/editar antes de mandarlo (no se envía automáticamente). Al enviarlo de
// verdad desde Correos, el pedido queda marcado como gestionado por 'correo'.
async function pdEmail(pedidoId,btn){
  const p=(state.pedidosById||{})[pedidoId]||(state.pedidos||[]).find(x=>x.id===pedidoId); if(!p){toast('Pedido no encontrado','error');return;}
  const cli=_pdCliRec(p);
  let to=cli?.fields['Email']||prompt('¿A qué correo enviamos el mensaje post-entrega?','');
  if(!to)return; to=String(to).trim();
  if(!validEmail(to)){toast('Correo inválido','error');return;}
  const prev=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.textContent='…';}
  if(_npsLink(p)){try{await ensureNpsFields();}catch(e){}}   // prepara los campos NPS antes de abrir el borrador
  if(btn){btn.disabled=false;btn.innerHTML=prev;}
  const bodyHtml=escapeHtml(_pdMsg(p)).replace(/\n/g,'<br>');
  if(typeof switchTab==='function') switchTab('correo');
  setTimeout(()=>{try{MAIL.openCompose({to,subject:'¿Cómo llegó tu pedido? — The Lab Solutions',body:bodyHtml,title:'Mensaje post-entrega',_pdPedidoId:pedidoId,_fromName:AGENT_CTA_FROM.name,_fromEmail:AGENT_CTA_FROM.email});}catch(e){toast('No se pudo abrir el borrador','error');}},350);
}
async function pdMarkDone(pedidoId,via,silent){
  const log=_pdLog(); log[pedidoId]={ts:Date.now(),via:via||'manual'};
  try{localStorage.setItem(_PD_LOG_KEY,JSON.stringify(log));}catch(e){}
  // Nota en el pedido (aparece en Notas internas del pedido, best-effort)
  try{const arr=_getNotas('ped',pedidoId);arr.push({id:'n'+Date.now(),ts:Date.now(),text:'💚 Mensaje post-entrega enviado por '+(via||'—')+' (Andrea)'});_saveNotas('ped',pedidoId,arr);}catch(e){}
  if(!silent&&via==='manual') toast('✓ Post-entrega marcado como gestionado','success');
  else if(!silent) toast('✓ Post-entrega registrado ('+via+')','success');
  buildPostEntregaTray();
}

// ── MEMORIA DE AGENTES ─────────────────────────────────────────
// Bloque compacto con los contactos previos al cliente (mensajes redactados por
// agentes, seguimientos, cobranzas y post-entregas registrados) para que el
// agente dé continuidad a la conversación y no se repita.
function agentMemoriaCliente(empresa,cliId){
  try{
    const emp=String(empresa||'').trim();
    if(emp.length<4&&!cliId) return '';
    const ev=[];
    const push=(ts,txt)=>{if(ts&&txt)ev.push({ts,txt});};
    try{
      AGENT_LOG._load();
      const el=emp.toLowerCase();
      if(el.length>=4)(AGENT_LOG._runs||[]).forEach(r=>{
        if(!r||!r.time)return;
        if((((r.input||'')+' '+(r.output||'')).toLowerCase()).includes(el)){
          const snip=String(r.output||'').replace(/\s+/g,' ').slice(0,110);
          push(r.time,`${(typeof _ofPretty==='function'?_ofPretty(r.agent):r.agent)||'Agente'} redactó: "${snip}…"`);
        }
      });
    }catch(e){}
    try{
      if(cliId){const fl=_fuLog();
        (state.cotizaciones||[]).forEach(c=>{const cid=Array.isArray(c.fields['Cliente'])?c.fields['Cliente'][0]:null;if(cid!==cliId)return;const e=fl[c.id];if(e&&e.ts)push(e.ts,`Seguimiento enviado por ${e.via||'—'} (cot ${c.fields['N° Cotización']||'—'})`);});}
    }catch(e){}
    try{(_cobLog()[emp.toLowerCase()]||[]).forEach(e=>push(e.ts,`Recordatorio de cobranza por ${e.via||'—'}`));}catch(e){}
    try{
      if(cliId){const pl=_pdLog();
        (state.pedidos||[]).forEach(p=>{const cid=Array.isArray(p.fields['Cliente'])?p.fields['Cliente'][0]:null;if(cid!==cliId)return;const e=pl[p.id];if(e&&e.ts)push(e.ts,`Mensaje post-entrega por ${e.via||'—'} (${p.fields['N° Pedido']||'—'})`);});}
    }catch(e){}
    if(!ev.length)return'';
    ev.sort((a,b)=>b.ts-a.ts);
    const fch=ts=>new Date(ts).toISOString().slice(0,10);
    return '\nCONTACTOS PREVIOS CON ESTE CLIENTE (dales continuidad — NO repitas el mismo saludo ni los mismos argumentos; si ayuda, alude brevemente al contacto anterior):\n'
      +ev.slice(0,5).map(e=>`- [${fch(e.ts)}] ${e.txt}`).join('\n');
  }catch(e){return'';}
}

function runFollowupAgent(cotId){
  const c=state.cotizacionesById[cotId];if(!c) return;
  const f=c.fields;
  const _t=new Date();_t.setHours(0,0,0,0);
  const cliRec=_getClienteRecFromField(f['Cliente']);
  const nombre=resolveClienteName(f['Cliente']);
  const dias=f['Fecha cotización']?Math.round((_t-new Date(f['Fecha cotización']+'T00:00:00'))/86400000):'—';
  const vto=f['Fecha vencimiento']?Math.round((new Date(f['Fecha vencimiento']+'T00:00:00')-_t)/86400000):null;
  const sol=(f['Solicitud cliente (texto libre)']||f['Detalle productos']||f['Solicitud / detalle']||'').substring(0,150);
  const monto=f['Total final (CLP)']?formatCLP(Math.round(f['Total final (CLP)']/1.19)):'';
  const waPhone=_getClienteWAPhone(cliRec);
  const email=cliRec?.fields['Email']||'';
  const _toque=Math.min(_fuToques(cotId)+1,3);
  const _guia=_toque===1?'recordatorio breve y amable, sin presión'
    :_toque===2?'aporta valor: resuelve dudas típicas, ofrece ajustar el alcance o una alternativa, refuerza el beneficio'
    :'último contacto de la secuencia: crea urgencia suave (vencimiento, cupo de producción) y facilita el cierre con una pregunta directa';
  const ctx=`Cliente: ${nombre}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nCotización: ${f['N° Cotización']||'—'}${monto?' | Monto neto: '+monto:''}\nDías sin respuesta: ${dias}${vto!=null?' | Vence en: '+vto+'d':''}\nProducto/Servicio: ${sol||'No especificado'}\nToque de la secuencia: ${_toque} de 3 — enfoque: ${_guia}. No repitas el mismo texto de un toque anterior.`+agentMemoriaCliente(nombre,cliRec?.id)+AGENT_MSG_RULES;
  runAgentInline('FOLLOWUP',ctx,(result)=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliRec?.id||''}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Seguimiento de tu cotización — The Lab Solutions','${cliRec?.id||''}','${cotId}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar todo</button>`;
  });
  window._fuCotId=cotId;   // para auto-registrar el seguimiento al enviar por WA/correo
}

function openFollowupWA(phone){
  const waPart=_extractWAPart(_agentInlineText)||_agentInlineText;
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(waPart),'_blank');
  if(window._fuCotId){try{fuMarkDone(window._fuCotId,'WhatsApp');}catch(e){}window._fuCotId=null;}
}

// ── CTA universal de agentes: enviar el resultado por WhatsApp o correo ──
// Identidad comercial de los envíos: salen SIEMPRE desde la casilla corporativa
// con la firma de Andrea, sin importar qué usuario del dashboard esté logueado.
const AGENT_CTA_FROM={email:'hola@thelab.solutions',name:'Andrea Garrido - The Lab Solutions'};
// Extrae la sección cuyo encabezado calza con re (misma noción de encabezado que
// formatAgentReport: #, **negrita**, o LÍNEA EN MAYÚSCULAS corta).
function _agentSection(raw,re){
  const lines=String(raw||'').replace(/\r/g,'').split('\n');
  const isHead=l=>{const t=l.trim();if(!t)return false;
    if(/^#{1,4}\s+/.test(t)||/^\*\*[^*]+\*\*:?\s*$/.test(t))return true;
    const c=t.replace(/^\d+[\.\)]\s*/,'').replace(/:\s*$/,'');
    return c===c.toUpperCase()&&/[A-ZÁÉÍÓÚÜÑ]/.test(c)&&c.split(/\s+/).length<=10&&c.length<=64;};
  let start=-1;
  for(let i=0;i<lines.length;i++){ if(isHead(lines[i])&&re.test(lines[i])){start=i+1;break;} }
  if(start<0)return'';
  const out=[];
  for(let i=start;i<lines.length;i++){ if(isHead(lines[i]))break; out.push(lines[i]); }
  return out.join('\n').trim();
}
// Texto crudo de la fuente: un output del grid (por id) o el modal inline.
function _agentCtaRaw(srcId){
  const el=srcId?document.getElementById(srcId):null;
  return (el&&el._rawText)||_agentInlineText||'';
}
function _agentCtaClean(raw){return String(raw||'').replace(/\[ITEMS\][\s\S]*?\[\/ITEMS\]/gi,'').replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/gi,'').trim();}
function agentCtaWA(srcId,phone){
  const raw=_agentCtaRaw(srcId); if(!raw){toast('Sin contenido','error');return;}
  const msg=_agentSection(raw,/whatsapp|\bwsp\b/i)||_agentCtaClean(raw);
  window.open('https://wa.me/'+(phone||'')+'?text='+encodeURIComponent(msg.slice(0,1800)),'_blank');
}
async function agentCtaEmail(srcId,btn,toEmail){
  const raw=_agentCtaRaw(srcId); if(!raw){toast('Sin contenido','error');return;}
  let to=toEmail||prompt('¿A qué correo lo enviamos?','');
  if(!to)return; to=to.trim();
  if(!validEmail(to)){toast('Correo inválido','error');return;}
  const body=(_agentSection(raw,/e-?mail|correo/i)||_agentCtaClean(raw)).replace(/^\s*\**asunto\s*[:\-][^\n]*\n+/i,'');
  const subjM=raw.match(/asunto\s*[:\-]\s*\**([^\n*]+)/i);
  const subject=(subjM?subjM[1].trim():'The Lab Solutions');
  const prev=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.textContent='Enviando…';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to,subject,body,from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error) toast('✓ Enviado a '+to+' desde '+AGENT_CTA_FROM.email,'success');
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btn){btn.disabled=false;btn.innerHTML=prev;}}
}
// Botones CTA según el contenido de la respuesta (WhatsApp / correo detectados).
function agentCtaButtonsHtml(srcId,raw){
  raw=raw||_agentCtaRaw(srcId);
  const hasWA=/whatsapp|\bwsp\b/i.test(raw);
  const hasMail=/asunto\s*[:\-]|e-?mail|correo/i.test(raw);
  if(!hasWA&&!hasMail)return'';
  return (hasWA?`<button class="btn btn-primary btn-sm" onclick="agentCtaWA('${srcId||''}')">📲 Enviar por WhatsApp</button>`:'')
       +(hasMail?`<button class="btn ${hasWA?'btn-ghost':'btn-primary'} btn-sm" onclick="agentCtaEmail('${srcId||''}',this)">📧 Enviar por correo</button>`:'');
}

async function _sendFollowupEmail(cotId,toEmail){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const c=state.cotizacionesById[cotId];if(!c) return;
  const emailText=_extractEmailPart(_agentInlineText)||_agentInlineText;
  const btnEl=document.querySelector('#agentInlineActions button:nth-child(2)');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Enviando...';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to:toEmail,subject:`Seguimiento — Cotización ${c.fields['N° Cotización']||''}`,body:emailText,from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('✓ Correo enviado','success');try{fuMarkDone(cotId,'correo');}catch(e){}window._fuCotId=null;closeAgentInlineModal();}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btnEl){btnEl.disabled=false;btnEl.textContent='📧 Enviar por correo';}}
}

// — QUOTE: insertar ítems parseados en Nueva Cotización
let _quoteParsedItems=null;
function quoteInsertItems(){
  if(!Array.isArray(_quoteParsedItems)||!_quoteParsedItems.length){toast('Sin ítems para insertar','error');return;}
  const items=_quoteParsedItems;
  switchTab('nueva-cot');
  setTimeout(()=>{
    let n=0;
    items.forEach(it=>{
      try{
        qcalcInsertRow('n',{desc:String(it.desc||'Ítem').substring(0,120),und:Math.max(1,parseInt(it.qty)||1),costoUnit:Math.max(0,Math.round(it.costo)||0),ventaUnit:Math.max(0,Math.round(it.venta)||0)});
        n++;
      }catch(e){}
    });
    toast(`✓ ${n} ítem${n!==1?'s':''} insertado${n!==1?'s':''} en la cotización`,'success');
  },150);
}

// — QUOTE desde el formulario de Nueva Cotización
function runQuoteFormAgent(){
  const sol=(document.getElementById('cot-solicitud')?.value||'').trim();
  if(!sol){toast('Escribe primero la solicitud del cliente en Observaciones','error');return;}
  const cliNombre=(document.getElementById('cot-cliente-search')?.value||'').trim();
  const urgente=document.getElementById('cot-urgente')?.value==='true';
  const ctx=`${cliNombre?'Cliente: '+cliNombre+'\n':''}Solicitud: ${sol}${urgente?'\nURGENTE: aplicar recargo +25%':''}`;
  runAgentInline('QUOTE',ctx,(result)=>{
    let insBtn='';
    const qm=result.match(/\[ITEMS\]([\s\S]*?)\[\/ITEMS\]/i);
    if(qm){
      try{_quoteParsedItems=JSON.parse(qm[1].trim());}catch(e){_quoteParsedItems=null;}
      const stripped=result.replace(/\[ITEMS\][\s\S]*?\[\/ITEMS\]/i,'').trim();
      document.getElementById('agentInlineResult').innerHTML=formatAgentReport(stripped);
      _agentInlineText=stripped;
      if(Array.isArray(_quoteParsedItems)&&_quoteParsedItems.length)
        insBtn=`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();quoteInsertItems()">→ Insertar ${_quoteParsedItems.length} ítem${_quoteParsedItems.length>1?'s':''} en el formulario</button>`;
    }
    return `${insBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — QUOTE para una cotización existente en estado Solicitada
function runQuoteCotAgent(cotId){
  const c=state.cotizacionesById[cotId];if(!c) return;
  const f=c.fields;
  const sol=(f['Solicitud cliente (texto libre)']||f['Solicitud / detalle']||'').trim();
  if(!sol){toast('La cotización no tiene solicitud del cliente registrada — edítala primero','error');return;}
  const ctx=`Cliente: ${resolveClienteName(f['Cliente'])}\nSolicitud: ${sol}${f['Urgencia (+25%)']?'\nURGENTE: aplicar recargo +25%':''}`;
  runAgentInline('QUOTE',ctx,(result)=>{
    let insBtn='';
    const qm=result.match(/\[ITEMS\]([\s\S]*?)\[\/ITEMS\]/i);
    if(qm){
      try{_quoteParsedItems=JSON.parse(qm[1].trim());}catch(e){_quoteParsedItems=null;}
      const stripped=result.replace(/\[ITEMS\][\s\S]*?\[\/ITEMS\]/i,'').trim();
      document.getElementById('agentInlineResult').innerHTML=formatAgentReport(stripped);
      _agentInlineText=stripped;
      if(Array.isArray(_quoteParsedItems)&&_quoteParsedItems.length)
        insBtn=`<button class="btn btn-primary btn-sm" onclick="quoteInsertItemsToEdit('${cotId}')">→ Insertar ${_quoteParsedItems.length} ítem${_quoteParsedItems.length>1?'s':''} y editar</button>`;
    }
    return `${insBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}
function quoteInsertItemsToEdit(cotId){
  if(!Array.isArray(_quoteParsedItems)||!_quoteParsedItems.length){toast('Sin ítems para insertar','error');return;}
  const items=_quoteParsedItems;
  closeAgentInlineModal();
  openEditCot(cotId);
  setTimeout(()=>{
    document.querySelectorAll('#editItemsContainer .edit-item-row').forEach(r=>{
      const d=(r.querySelector('.edit-item-desc')?.value||'').trim();
      const v=parseFloat(r.querySelector('.edit-item-venta')?.value)||0;
      if(!d&&!v) r.remove();
    });
    items.forEach(it=>addEditItemRow({desc:String(it.desc||'Ítem').substring(0,120),und:Math.max(1,parseInt(it.qty)||1),costoUnit:Math.max(0,Math.round(it.costo)||0),ventaUnit:Math.max(0,Math.round(it.venta)||0)}));
    updateEditItemTotal();
    toast(`✓ ${items.length} ítem${items.length>1?'s':''} insertado${items.length>1?'s':''} — revisa y guarda`,'success');
  },200);
}

// — WIN-BACK: reactivar cotización vencida o rechazada
function runWinbackAgent(cotId){
  const c=state.cotizacionesById[cotId];if(!c) return;
  const f=c.fields;
  const cliRec=_getClienteRecFromField(f['Cliente']);
  const waPhone=_getClienteWAPhone(cliRec);
  const email=cliRec?.fields['Email']||'';
  const estado=f['Estado cotización'];
  const sol=(f['Solicitud cliente (texto libre)']||f['Solicitud / detalle']||'').substring(0,150);
  const monto=f['Total final (CLP)']?formatCLP(Math.round(f['Total final (CLP)']/1.19)):'—';
  const motivo=estado==='Rechazada'?`\nMotivo de rechazo: ${String(f['Motivo rechazo']||'no registrado').substring(0,150)}`:'';
  const ctx=`Cotización ${estado==='Rechazada'?'RECHAZADA':'VENCIDA'}: ${f['N° Cotización']||'—'} | Cliente: ${resolveClienteName(f['Cliente'])} | Monto neto: ${monto} | Vencía: ${f['Fecha vencimiento']||'—'}${motivo}\nProducto: ${sol}\nTAREA: redacta un mensaje de REACTIVACIÓN (win-back): ofrecer actualizar la cotización${estado==='Rechazada'?', abordando con tacto el motivo del rechazo si ayuda a recuperar la venta':''}, sin presionar.`+agentMemoriaCliente(resolveClienteName(f['Cliente']),cliRec?.id)+AGENT_MSG_RULES;
  runAgentInline('FOLLOWUP',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliRec?.id||''}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Retomemos tu cotización — The Lab Solutions','${cliRec?.id||''}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — Envío genérico de correo desde resultado de agente
async function _sendAgentEmail(toEmail,subject,btnEl){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const emailText=_extractEmailPart(_agentInlineText)||_agentInlineText;
  if(btnEl){btnEl.disabled=true;btnEl.dataset.orig=btnEl.textContent;btnEl.textContent='Enviando...';}
  try{
    const r=await MAIL.postAs(AGENT_CTA_FROM.email,{action:'send',to:toEmail,subject,body:emailText,from_name:AGENT_CTA_FROM.name});
    if(r&&!r.error){toast('✓ Correo enviado','success');closeAgentInlineModal();}
    else throw new Error(r?.error||'Error desconocido');
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btnEl){btnEl.disabled=false;btnEl.textContent=btnEl.dataset.orig||'📧 Enviar';}}
}

// — SALES: estrategia de venta para un lead específico
function runSalesAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const cotsCli=state.cotizaciones.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(cliId));
  const cotsTxt=cotsCli.length?cotsCli.slice(-3).map(x=>`${x.fields['N° Cotización']||'—'} (${x.fields['Estado cotización']||'—'})`).join(', '):'ninguna aún';
  const ctx=`Lead: ${f['Empresa']||'—'} | Contacto: ${f['Contacto']||'—'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nEtapa: ${f['Etapa venta']||'—'} | Origen: ${f['Origen lead']||'—'} | Industria: ${f['Industria / Rubro']||'—'}\nCotizaciones previas: ${cotsTxt}${f['Notas internas']?'\nNotas: '+String(f['Notas internas']).substring(0,200):''}\nTAREA: dame la estrategia para avanzar este lead a la siguiente etapa: cómo abordarlo, qué producto ofrecerle según su industria, posibles objeciones y cómo responderlas, y los mensajes de apertura listos para enviar.`+AGENT_MSG_RULES;
  runAgentInline('SALES',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Conversemos — The Lab Solutions','${cliId}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — LEADGEN: prospección de nichos desde el header de Clientes
function runLeadGenAgent(){
  if(!state.loaded){toast('Carga los datos primero (↺ Actualizar)','error');return;}
  const ctx='En base a mi cartera actual (ver contexto), propón 3 nichos nuevos con potencial alto que aún no estoy atacando, con el formato completo por nicho.';
  runAgentInline('LEADGEN',ctx,()=>`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();switchTab('nuevo-lead')">➕ Crear lead</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`);
}

// — SALES: ranking diario de prioridad de leads
function runLeadRankingAgent(){
  if(!state.loaded){toast('Carga los datos primero (↺ Actualizar)','error');return;}
  const _t=new Date();_t.setHours(0,0,0,0);
  const leads=state.clientes.filter(c=>esLeadCat(c)&&(c.fields['Etapa venta']||'')!=='Perdido');
  if(!leads.length){toast('No hay leads en el pipeline','info');return;}
  const lineas=leads.map(c=>{
    const f=c.fields;
    const dias=c.createdTime?Math.round((_t-new Date(c.createdTime))/86400000):'—';
    const cotsCli=state.cotizaciones.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(c.id));
    const abiertas=cotsCli.filter(x=>['Enviada','Solicitada'].includes(x.fields['Estado cotización']||''));
    const montoAbierto=abiertas.reduce((s,x)=>s+Math.round((x.fields['Total final (CLP)']||0)/1.19),0);
    return `  • ${f['Empresa']||'—'} | ${f['Etapa venta']} | ${dias}d en pipeline | Industria: ${f['Industria / Rubro']||'—'} | Revenue histórico: ${formatCLP(f['Revenue total cliente (CLP)']||0)} | Cotizaciones abiertas: ${abiertas.length}${montoAbierto?' por '+formatCLP(montoAbierto)+' neto':''}`;
  });
  const ctx=`MIS LEADS EN PIPELINE (${leads.length}):\n${lineas.join('\n')}\n\nTAREA: rankea TODOS estos leads de mayor a menor prioridad de contacto HOY. Criterios: monto en juego, días sin avance (más días = más urgente hasta los 14d, después baja probabilidad), etapa (Negociación > Propuesta enviada > Contactado > lead sin etapa) e industria con historial de conversión. Para cada uno: posición, empresa, score 1-10, POR QUÉ, y la acción concreta de hoy (1 línea).`;
  runAgentInline('SALES',ctx,()=>`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();switchTab('clientes')">👥 Ir a Clientes</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`);
}

// — SALES: win-back de cliente inactivo o perdido
function runClienteWinbackAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const cotsCli=state.cotizaciones.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(cliId));
  const ultCot=cotsCli.length?cotsCli[cotsCli.length-1]:null;
  const pedsCli=state.pedidos.filter(x=>Array.isArray(x.fields['Cliente'])&&x.fields['Cliente'].includes(cliId));
  const ultPed=pedsCli.length?pedsCli[pedsCli.length-1]:null;
  const ctx=`Cliente ${f['Etapa venta']==='Perdido'?'PERDIDO':'INACTIVO'}: ${f['Empresa']||'—'} | Contacto: ${f['Contacto']||'—'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nIndustria: ${f['Industria / Rubro']||'—'} | Revenue histórico: ${formatCLP(f['Revenue total cliente (CLP)']||0)}\n${ultPed?'Último pedido: '+(ultPed.fields['Descripción del pedido']||ultPed.fields['Solicitud cliente (texto libre)']||'—').substring(0,120):''}${ultCot?'\nÚltima cotización: '+(ultCot.fields['N° Cotización']||'—')+' ('+(ultCot.fields['Estado cotización']||'—')+')':''}${f['Notas internas']?'\nNotas: '+String(f['Notas internas']).substring(0,150):''}\nTAREA: redacta un mensaje de RECONEXIÓN para recuperar a este cliente. Referencia lo que compró antes, ofrece algo concreto (novedad de producto o revisión de precios), sin sonar desesperado.`+agentMemoriaCliente(f['Empresa'],cliId)+AGENT_MSG_RULES;
  runAgentInline('SALES',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Tenemos novedades para ti — The Lab Solutions','${cliId}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — ONBOARDING desde cliente (leads nuevos)
function runOnboardingAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const ctx=`Cliente nuevo: ${f['Empresa']||'—'} | Contacto: ${f['Contacto']||'—'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nEtapa: ${f['Etapa venta']||'—'}${f['Notas internas']?'\nNotas: '+String(f['Notas internas']).substring(0,150):''}\nTAREA: prepara la bienvenida para este cliente nuevo: cómo darle la mejor primera impresión y los mensajes de bienvenida listos para enviar.`+AGENT_MSG_RULES;
  runAgentInline('ONBOARDING',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Bienvenido a The Lab Solutions','${cliId}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — FINANCE desde cliente (facturas vencidas)
function runFinanceAgent(cliId){
  const c=state.clientes.find(x=>x.id===cliId);if(!c) return;
  const f=c.fields;
  const waPhone=_getClienteWAPhone(c);
  const email=f['Email']||'';
  const ctx=`Cliente con deuda: ${f['Empresa']||'—'} | Contacto: ${f['Contacto']||'—'}${email?' | Email: '+email:''}${waPhone?' | Tel: +'+waPhone:''}\nFacturas vencidas: ${f['Facturas vencidas']||0} | Estado cuenta: ${f['Estado cuenta']||'—'}\nTAREA: redacta un recordatorio de pago para este cliente, formal pero cordial.`+agentMemoriaCliente(f['Empresa'],cliId)+AGENT_MSG_RULES;
  runAgentInline('FINANCE',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','${cliId}')">📲 Abrir WhatsApp</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Recordatorio de pago — The Lab Solutions','${cliId}')">✉️ Enviar correo</button>`:'';
    return `${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — ADS analysis desde sección Web → Google Ads
function _parseAdsActions(text){
  const m=/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/i.exec(text||'');
  if(!m)return[];
  try{const arr=JSON.parse(m[1].trim());return Array.isArray(arr)?arr.filter(a=>a&&a.tipo):[];}catch(e){return[];}
}
// Etiqueta y estilo del botón de una acción del agente (compartido por todos los render)
function _adsActionLabel(a){
  switch(a.tipo){
    case 'pausar':return '⏸ Pausar '+(a.campana||'');
    case 'activar':return '▶ Activar '+(a.campana||'');
    case 'presupuesto':return '💰 '+(a.campana||'')+' → '+fmtMoney(+a.nuevo||0);
    case 'negativo':return '🚫 «'+(a.termino||'')+'»';
    case 'pausar_kw':return '⏸ Pausar kw «'+(a.termino||'')+'»';
    case 'keyword_exacta':return '🎯 Subir «'+(a.termino||'')+'» a exacta';
    case 'generar_copy':return '✍ Anuncios para «'+(a.termino||a.campana||'')+'»';
    default:return a.tipo;
  }
}
function _adsActionClass(a){return (a.tipo==='pausar'||a.tipo==='pausar_kw')?'btn-danger':a.tipo==='keyword_exacta'?'btn-success':'btn-accent';}
function _adsRenderActionBtns(actions){
  return actions.map((a,i)=>`<button class="btn btn-sm ${_adsActionClass(a)}" title="${escapeHtml(a.motivo||'')}" onclick="applyAdsAction(${i})">${escapeHtml(_adsActionLabel(a))}</button>`).join('');
}
// Convierte una acción del agente en una mutación de Google Ads aplicable con 1 clic
function applyAdsAction(i){
  const a=(window._adsAgentActions||[])[i];if(!a)return;
  if(a.tipo==='negativo'){
    try{navigator.clipboard.writeText(a.termino||'');}catch(e){}
    const camp=(window._adsLastData?.campanas||[]).find(c=>c.nombre===a.campana||String(c.id)===String(a.id));
    if(typeof _adsQueueMutation==='function'&&a.termino){_adsQueueMutation({op:'negative',id:camp?camp.id:'',data:{campana:a.campana||'cuenta',termino:a.termino},timestamp:new Date().toISOString(),status:'pending'});toast(`🚫 Negativo "${a.termino}" en cola (requiere Script 2 actualizado) · copiado al portapapeles`,'success');}
    else toast(`Negativo "${a.termino}" copiado al portapapeles`,'info');
    return;
  }
  if(a.tipo==='pausar_kw'){
    if(typeof _adsQueueMutation==='function'&&a.termino){_adsQueueMutation({op:'pause_keyword',id:'',data:{campana:a.campana||'',termino:a.termino},timestamp:new Date().toISOString(),status:'pending'});toast(`⏸ Pausar palabra clave "${a.termino}" en cola (requiere Script 2 actualizado)`,'success');}
    else toast('Falta el término de la palabra clave','error');
    return;
  }
  if(a.tipo==='keyword_exacta'){
    // Promover a exacta es ambiguo (¿qué grupo de anuncios?) → guía + portapapeles, no mutación a ciegas
    try{navigator.clipboard.writeText('['+(a.termino||'')+']');}catch(e){}
    toast(`🎯 "[${a.termino}]" copiado — agrégalo como exacta en el grupo correcto de "${a.campana||'la campaña'}"`,'info');
    return;
  }
  if(a.tipo==='generar_copy'){
    adsGenerateAdCopy(a.termino||a.campana||'',a.campana||'');
    return;
  }
  const camp=(window._adsLastData?.campanas||[]).find(c=>String(c.id)===String(a.id)||c.nombre===a.campana);
  if(!camp){toast('No encontré la campaña de la acción','error');return;}
  const base={nombre:camp.nombre,presupuesto:camp.presupuesto,estado:camp.estado,tipo:camp.tipo||'SEARCH'};
  let data,desc;
  if(a.tipo==='pausar'){data={...base,estado:'PAUSED'};desc='Pausar '+camp.nombre;}
  else if(a.tipo==='activar'){data={...base,estado:'ENABLED'};desc='Activar '+camp.nombre;}
  else if(a.tipo==='presupuesto'){const nb=Math.max(1000,Math.round(+a.nuevo||0));data={...base,presupuesto:nb};desc='Ppto '+camp.nombre+' → '+fmtMoney(nb);}
  else{toast('Tipo de acción no soportado','error');return;}
  if(typeof _adsQueueMutation==='function'){_adsQueueMutation({op:'edit',id:camp.id,data,timestamp:new Date().toISOString(),status:'pending'});toast('✓ En cola: '+desc,'success');}
  else toast('Cola de mutaciones no disponible','error');
}
// ── Generador de copy de anuncios (RSA) para keywords con relevancia baja ──
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
function _adsCopyClip(cat,i){const t=(_adsCopyData[cat]||[])[i];if(t==null)return;navigator.clipboard.writeText(t).then(()=>toast('Copiado ✓','success')).catch(()=>{});}
function _adsCopyClipAll(cat){const a=_adsCopyData[cat]||[];if(!a.length)return;navigator.clipboard.writeText(a.join('\n')).then(()=>toast('Copiado ✓','success')).catch(()=>{});}
function _adsCopyItemRow(cat,i,text,limit){
  const len=[...String(text)].length;const ok=len<=limit;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--surface2);border-radius:5px;margin-bottom:4px">
    <span style="flex:1;min-width:0;font-size:12px;color:var(--text);word-break:break-word">${escapeHtml(text)}</span>
    <span style="font-size:9px;font-weight:600;flex-shrink:0;color:${ok?'var(--success)':'var(--danger)'}">${len}/${limit}</span>
    <button onclick="_adsCopyClip('${cat}',${i})" style="background:none;border:1px solid var(--border2);color:var(--text3);border-radius:4px;padding:2px 7px;font-size:10px;cursor:pointer;flex-shrink:0">📋</button>
  </div>`;
}
async function adsGenerateAdCopy(termino,campana){
  const ov=_adsCopyOverlay();
  const kw=String(termino||'').trim();
  ov.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto;padding:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div><div style="font-weight:700;font-size:15px;color:var(--text)">✍ Anuncios para «${escapeHtml(kw)}»</div><div style="font-size:11px;color:var(--text3)">${escapeHtml(campana||'')}</div></div>
      <button onclick="document.getElementById('adsCopyOverlay').remove()" style="background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer;line-height:1">×</button>
    </div>
    <div id="adsCopyBody"><div class="loading-state" style="padding:30px 0;text-align:center"><div class="spinner"></div><div style="color:var(--text3);font-size:12px;margin-top:10px">Generando anuncios optimizados…</div></div></div>
  </div>`;
  const sys=`Eres copywriter senior de Google Ads para The Lab Solutions, fabricación digital premium en Santiago, Chile (impresión 3D, trofeos y medallas, señalética acrílico, neones LED, packaging).
Escribes anuncios de búsqueda responsivos (RSA) en español chileno, persuasivos y de alta relevancia.
REGLAS DURAS:
- Títulos: máximo 30 caracteres CADA UNO (cuenta los caracteres, no te pases).
- Descripciones: máximo 90 caracteres CADA UNA.
- Rutas de visualización: máximo 15 caracteres cada una.
- Incluye la palabra clave (o su raíz) en al menos 3 títulos para subir la relevancia/Quality Score.
- Variedad: beneficios, diferenciadores, llamados a la acción (CTA), prueba social, urgencia. Sin clickbait falso.
- Nada de mayúsculas sostenidas ni signos de exclamación repetidos. Profesional y local.
Responde SOLO con un objeto JSON válido, sin texto adicional ni markdown, con esta forma exacta:
{"titulos":["...", ... 12 ítems], "descripciones":["...", ...4 ítems], "rutas":["...","..."]}`;
  const user=`Palabra clave objetivo: "${kw}"${campana?`\nCampaña: ${campana}`:''}
Genera 12 títulos, 4 descripciones y 2 rutas para esta keyword. Respeta los límites de caracteres al pie de la letra.`;
  try{showAgentWorking('ADS',{verb:'está escribiendo tus anuncios…',messages:['Analizando la palabra clave…','Redactando títulos que convierten…','Cuidando los límites de caracteres…']});}catch(e){}
  try{
    const raw=await callClaude(sys,user);
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
    const warn=(overTit||overDes)?`<div style="font-size:10px;color:var(--warn);margin-bottom:8px">⚠ ${overTit+overDes} elemento(s) exceden el límite (en rojo) — edítalos antes de pegar.</div>`:'';
    body.innerHTML=`${warn}
      <div style="display:flex;justify-content:space-between;align-items:center;margin:2px 0 6px"><div style="font-size:11px;font-weight:700;color:var(--text2)">TÍTULOS (${titulos.length})</div><button class="btn btn-ghost btn-sm" onclick="_adsCopyClipAll('titulos')">📋 Copiar todos</button></div>
      ${titulos.map((t,i)=>_adsCopyItemRow('titulos',i,t,_RSA_LIMITS.titulo)).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px"><div style="font-size:11px;font-weight:700;color:var(--text2)">DESCRIPCIONES (${descripciones.length})</div><button class="btn btn-ghost btn-sm" onclick="_adsCopyClipAll('descripciones')">📋 Copiar todas</button></div>
      ${descripciones.map((t,i)=>_adsCopyItemRow('descripciones',i,t,_RSA_LIMITS.descripcion)).join('')}
      ${rutas.length?`<div style="font-size:11px;font-weight:700;color:var(--text2);margin:12px 0 6px">RUTAS</div>${rutas.map((t,i)=>_adsCopyItemRow('rutas',i,t,_RSA_LIMITS.ruta)).join('')}`:''}
      <div style="font-size:10px;color:var(--text3);margin-top:12px;line-height:1.5">Pégalos en Google Ads → tu grupo de anuncios → Anuncios → nuevo anuncio responsivo de búsqueda. Mantén los que tengan la keyword para subir el Quality Score del componente "anuncio".</div>`;
  }catch(e){
    const body=document.getElementById('adsCopyBody');
    if(body)body.innerHTML=`<div style="color:var(--danger);font-size:12px">Error generando anuncios: ${escapeHtml(e.message||String(e))}</div>`;
  }finally{try{hideAgentWorking();}catch(e){}}
}
function runAdsAgent(){
  if(!window._adsLastData){toast('Carga primero los datos de Google Ads','error');return;}
  if(window._adsLastData.demo){toast('Datos DEMO — conecta tu cuenta para acciones reales','info');}
  const ctx=buildAgentContext('ADS');
  runAgentInline('ADS',ctx,(result)=>{
    const actions=_parseAdsActions(result);window._adsAgentActions=actions;
    // limpiar el bloque [ACTIONS] del texto visible
    const rEl=document.getElementById('agentInlineResult');if(rEl){rEl.style.whiteSpace='normal';rEl.innerHTML=formatAgentReport(result);}
    // log de memoria (qué recomendó y cuándo)
    try{_adsLogRecommendation(actions,result);}catch(e){}
    const btns=_adsRenderActionBtns(actions);
    return btns+`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}
// ── Reporte Ads semanal automático (genera + email 1×/semana al cargar datos) ──
function adsToggleAutoWeekly(on){
  localStorage.setItem('ads_auto_weekly',on?'1':'0');
  if(on){const def=(typeof AUTH!=='undefined'&&AUTH.getUser&&AUTH.getUser()?.email)||'';const to=prompt('¿A qué correo enviar el reporte Google Ads semanal?',localStorage.getItem('ads_auto_email')||def||'');if(to&&validEmail(to.trim())){localStorage.setItem('ads_auto_email',to.trim());toast('✓ Reporte Ads semanal activado','success');}else if(to!==null)toast('Correo inválido — se generará igual sin envío','info');}
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
    const resp=await callClaude(sys,ctx);
    localStorage.setItem('ads_auto_last_week',wk);
    try{_adsLogRecommendation(_parseAdsActions(resp),resp);}catch(e){}
    const to=localStorage.getItem('ads_auto_email')||'';
    const body=String(resp).replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/i,'').trim();
    if(to&&typeof MAIL!=='undefined'){try{await MAIL.post({action:'send',to,subject:`Reporte Google Ads ${wk} — The Lab Solutions`,body,from_name:'The Lab Solutions'});toast('✓ Reporte Ads semanal generado y enviado','success');}catch(e){toast('Reporte Ads generado (no se pudo enviar)','info');}}
    else toast('✓ Reporte Ads semanal generado','success');
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

// — ADS copy generator para campaña específica
function runAdsCopyAgent(d){
  const ctx=`Genera 3 variaciones de anuncio de texto para Google Ads para la siguiente campaña de The Lab Solutions.\n\nCampaña: "${d.nombre}"\nEstado: ${d.estado==='ENABLED'?'Activa':'Pausada'} | Gasto: ${fmtMoney(d.gasto)} | CTR: ${d.ctr}% | CPC: ${fmtMoney(d.cpc)} | Conversiones: ${d.conv}\n\nEmpresa: fabricación digital premium en Santiago — trofeos personalizados, medallas, neones LED, impresión 3D, señalética acrílico.\n\nPara cada variación:\n- Título 1 (máx 30 car.)\n- Título 2 (máx 30 car.)\n- Título 3 (máx 30 car.)\n- Descripción 1 (máx 90 car.)\n- Descripción 2 (máx 90 car.)\n- Ruta de pantalla: thelab.solutions/[algo relevante]\n\nEnfoca en el beneficio del cliente. CTA claro. Sin inventar premios ni certificaciones.`;
  runAgentInline('ADS',ctx,()=>`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar copy</button>`);
}

// — REPCLIENTE: update de estado al cliente desde pedido
function runRepClienteAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const cid=Array.isArray(f['Cliente'])?f['Cliente'][0]:null;
  const cl=cid?state.clientesByIdRec[cid]:null;
  const waPhone=cl?_getClienteWAPhone(cl):'';
  const email=cl?.fields['Email']||'';
  const today=new Date();today.setHours(0,0,0,0);
  const atrasado=f['Fecha entrega']&&new Date(f['Fecha entrega']+'T00:00:00')<today;
  const sol=(f['Solicitud cliente (texto libre)']||f['Descripción del pedido']||f['Detalle productos']||'Sin detalle').substring(0,200);
  const ctx=`Pedido: ${f['N° Pedido']||'—'} | Cliente: ${resolveClienteName(f['Cliente'])} | Estado: ${f['Estado pedido']||'—'} | Entrega: ${f['Fecha entrega']||'—'}${atrasado?' ⚠ ATRASADO':''}\nProducto: ${sol}\nQA: ${f['Resultado QA']||'Pendiente'}\nTAREA: genera el update de estado para el cliente, claro y tranquilizador.`+AGENT_MSG_RULES;
  runAgentInline('REPCLIENTE',ctx,()=>{
    const waBtn=waPhone?`<button class="btn btn-primary btn-sm" onclick="agentSendWA('${waPhone}','')">📲 WhatsApp cliente</button>`:'';
    const mailBtn=email?`<button class="btn btn-primary btn-sm" onclick="draftAgentEmail('${email.replace(/'/g,'')}','Update de tu pedido — The Lab Solutions','')">✉️ Enviar correo</button>`:'';
    return`${waBtn}${mailBtn}<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

// — CONTENT: generar post de redes para pedido despachado
function runContentAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const sol=(f['Solicitud cliente (texto libre)']||f['Descripción del pedido']||f['Detalle productos']||'Sin detalle').substring(0,300);
  const montoNeto=f['Monto total (CLP)']?'$'+Math.round(f['Monto total (CLP)']/1.19).toLocaleString('es-CL')+' neto':'—';
  const ctx=`Proyecto entregado:\nN° Pedido: ${f['N° Pedido']||'—'} | Fecha despacho: ${f['Fecha despacho']||f['Fecha entrega']||'—'} | Monto: ${montoNeto}\nProducto: ${sol}\nQA: ${f['Resultado QA']||'Aprobado'}\nGenera contenido para los 3 formatos con el máximo impacto visual y de conversión.`;
  runAgentInline('CONTENT',ctx,()=>`<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar contenido</button>`);
}

// — PRODUCTION desde pedido
function runProductionAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const ctx=`Pedido: ${f['N° Pedido']||'—'} | Cliente: ${resolveClienteName(f['Cliente'])}\nEstado: ${f['Estado pedido']||'—'} | Entrega: ${f['Fecha entrega']||'—'} | Equipo: ${f['Equipo asignado']||'Sin asignar'}\nSolicitud: ${(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Sin detalle').substring(0,300)}`;
  runAgentInline('PRODUCTION',ctx,()=>{
    const hasFicha=!!parseFichaData(p.fields['Ficha Tecnica']);
    return `<button class="btn btn-primary btn-sm" onclick="saveProductionFicha('${pedidoId}')">${hasFicha?'🔄 Reemplazar':'💾 Guardar'} Ficha Técnica</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
  });
}

async function saveProductionFicha(pedidoId){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const p=state.pedidosById[pedidoId];if(!p) return;
  const existing=parseFichaData(p.fields['Ficha Tecnica'])||{};
  existing.instrucciones=_agentInlineText;
  existing.generadoIA=new Date().toISOString().substring(0,10);
  const btnEl=document.querySelector('#agentInlineActions .btn-primary');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Guardando...';}
  try{
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Ficha Tecnica':JSON.stringify(existing)});
    p.fields['Ficha Tecnica']=JSON.stringify(existing);
    toast('✓ Ficha Técnica guardada','success');
    closeAgentInlineModal();renderPedidos();
  }catch(e){toast('Error: '+e.message,'error');}
  finally{if(btnEl){btnEl.disabled=false;btnEl.textContent='💾 Guardar Ficha Técnica';}}
}

// — Rellena las notas de producción del modal Ficha con el PRODUCTION_AGENT (inline, sin abrir otro modal)
async function rellenarFichaNotasIA(){
  const id=document.getElementById('fichaPedidoId').value;
  const p=state.pedidosById[id];const f=p?.fields||{};
  const mat=document.getElementById('fichaMaterial').value,col=document.getElementById('fichaColor').value,cant=document.getElementById('fichaCantidad').value,acab=document.getElementById('fichaAcabado').value;
  const sol=(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'').trim();
  if(!sol&&!mat&&!col){toast('Indica al menos material o la solicitud del pedido','error');return;}
  const btn=document.getElementById('fichaIABtn');const prev=btn.innerHTML;btn.disabled=true;btn.innerHTML='⏳…';
  try{showAgentWorking('PRODUCTION',{verb:'está redactando las notas de producción…'});}catch(e){}
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='PRODUCTION');
    const ctx=[
      f['N° Pedido']?`Pedido: ${f['N° Pedido']}`:'',
      sol?`Solicitud: ${sol}`:'',
      mat?`Material: ${mat}`:'',col?`Color: ${col}`:'',cant?`Cantidad: ${cant}`:'',acab?`Acabado: ${acab}`:'',
      'TAREA: redacta SOLO las notas de producción (instrucciones concretas para el operador). Sin encabezados, conciso, en viñetas o párrafos cortos.'
    ].filter(Boolean).join('\n');
    const raw=await callClaude(cfg.sys,ctx);
    const ta=document.getElementById('fichaNotas');
    ta.value=(ta.value.trim()?ta.value.trim()+'\n\n':'')+raw.trim();
    toast('✓ Notas generadas con IA','success');
  }catch(e){toast('Error IA: '+e.message,'error');}
  finally{try{hideAgentWorking();}catch(e){}btn.disabled=false;btn.innerHTML=prev;}
}

// — QA desde pedido
function runQAAgent(pedidoId){
  const p=state.pedidosById[pedidoId];if(!p) return;
  const f=p.fields;
  const ctx=`Pedido: ${f['N° Pedido']||'—'} | Cliente: ${resolveClienteName(f['Cliente'])}\nEntrega: ${f['Fecha entrega']||'—'}\nSolicitud/Producto: ${(f['Solicitud cliente (texto libre)']||f['Detalle productos']||'Sin detalle').substring(0,300)}`;
  runAgentInline('QA',ctx,()=>
    `<button class="btn btn-sm" style="background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.4);color:#10b981;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700" onclick="saveQAFromAgent('${pedidoId}','QA aprobado')">✅ Guardar: Aprobado</button><button class="btn btn-sm" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.4);color:#ef4444;border-radius:7px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:700" onclick="saveQAFromAgent('${pedidoId}','Rechazado')">❌ Guardar: Rechazado</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`
  );
}

async function saveQAFromAgent(pedidoId,resultado){
  if(!_agentInlineText){toast('Sin contenido','error');return;}
  const p=state.pedidosById[pedidoId];if(!p) return;
  try{
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Resultado QA':resultado,'Notas QA':_agentInlineText});
    p.fields['Resultado QA']=resultado;p.fields['Notas QA']=_agentInlineText;
    toast(`✓ QA ${resultado}`,'success');
    closeAgentInlineModal();renderPedidos();renderOverview();
  }catch(e){toast('Error: '+e.message,'error');}
}

// ── CADENA DE AGENTES (PRODUCTION → QA) ────────────────────────
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
  const num=f['N° Pedido']||'—';
  const solicitud=(solicitudOverride||f['Solicitud cliente (texto libre)']||f['Detalle productos']||'').substring(0,300);
  const resultEl=document.getElementById('agentInlineResult');
  const actionsEl=document.getElementById('agentInlineActions');
  document.getElementById('agentInlineTitle').textContent='⚡ Cadena IA — '+num;
  resultEl.className='agent-modal-result';
  resultEl.style.whiteSpace='pre-wrap';
  actionsEl.innerHTML='';
  _agentInlineText='';
  document.getElementById('agentInlineModal').style.display='flex';
  const baseCtx=`Pedido: ${num} | Cliente: ${resolveClienteName(f['Cliente'])}\nEntrega: ${f['Fecha entrega']||'—'} | Equipo: ${f['Equipo asignado']||'Sin asignar'}\nSolicitud/Producto: ${solicitud||'Sin detalle'}`;
  const steps={prod:'⏳ Generando Ficha Técnica (PRODUCTION_AGENT)...',qa:'· Checklist QA — en espera'};
  const paint=()=>{resultEl.textContent=steps.prod+'\n'+steps.qa;};
  paint();
  try{showAgentWorking('PRODUCTION',{verb:'está generando la ficha técnica…',messages:['Leyendo el pedido…','Definiendo materiales y parámetros…','Escribiendo las instrucciones de producción…']});}catch(e){}
  let ficha='',checklist='';
  // Paso 1: PRODUCTION
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='PRODUCTION');
    const ctx=state.loaded?buildAgentContext('PRODUCTION'):'';
    ficha=await callClaude(cfg.sys,(ctx?ctx+'\n\nCONSULTA: ':'')+baseCtx);
    try{AGENT_LOG.add(cfg.label,'Cadena IA: '+num,ficha);}catch(e){}
    const existing=parseFichaData(f['Ficha Tecnica'])||{};
    existing.instrucciones=ficha;
    existing.generadoIA=new Date().toISOString().substring(0,10);
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Ficha Tecnica':JSON.stringify(existing)});
    p.fields['Ficha Tecnica']=JSON.stringify(existing);
    steps.prod='✅ Ficha Técnica generada y guardada';
    steps.qa='⏳ Generando Checklist QA (QA_AGENT)...';
    paint();
  }catch(e){
    steps.prod='❌ Ficha Técnica: '+e.message;
    steps.qa='· Checklist QA — cancelado';
    paint();
    try{hideAgentWorking();}catch(e){}
    actionsEl.innerHTML='<button class="btn btn-ghost btn-sm" onclick="closeAgentInlineModal()">Cerrar</button>';
    return;
  }
  // Paso 2: QA
  try{showAgentWorking('QA',{verb:'está armando el checklist de calidad…',messages:['Revisando la ficha técnica…','Definiendo puntos de control…','Escribiendo el checklist QA…']});}catch(e){}
  try{
    const cfg=AGENTES_CFG.find(a=>a.id==='QA');
    const ctx=state.loaded?buildAgentContext('QA'):'';
    checklist=await callClaude(cfg.sys,(ctx?ctx+'\n\nCONSULTA: ':'')+baseCtx);
    try{AGENT_LOG.add(cfg.label,'Cadena IA: '+num,checklist);}catch(e){}
    const qaItems=_parseQAChecklist(checklist);
    await airtableWrite('Pedidos','PATCH',pedidoId,{'Notas QA':qaItems?JSON.stringify(qaItems):checklist});
    p.fields['Notas QA']=qaItems?JSON.stringify(qaItems):checklist;
    steps.qa='✅ Checklist QA generado y guardado'+(qaItems?` (${qaItems.length} ítems)`:'');
  }catch(e){
    steps.qa='❌ Checklist QA: '+e.message;
  }
  try{hideAgentWorking();}catch(e){}
  paint();
  renderPedidos();
  _agentInlineText='═══ FICHA TÉCNICA ═══\n'+ficha+(checklist?'\n\n═══ CHECKLIST QA ═══\n'+checklist:'');
  resultEl.textContent=steps.prod+'\n'+steps.qa+'\n\n'+_agentInlineText;
  actionsEl.innerHTML=`<button class="btn btn-primary btn-sm" onclick="closeAgentInlineModal();openFichaModal('${pedidoId}')">📋 Ver Ficha Técnica</button><button class="btn btn-ghost btn-sm" onclick="closeAgentInlineModal();openQAModal('${pedidoId}','${escapeHtml(num)}')">✓ Ver Checklist QA</button><button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button>`;
}

function _offerAgentChain(numPedido,solicitud){
  try{
    if(typeof hasClaudeAccess!=='function'||!hasClaudeAccess()) return;
    const nuevo=state.pedidos.find(x=>x.fields['N° Pedido']===numPedido);
    if(!nuevo) return;
    if(confirm(`⚡ ¿Generar Ficha Técnica + Checklist QA con IA para ${numPedido}?`)) runAgentChain(nuevo.id,solicitud);
  }catch(e){}
}

// ── HISTORIAL DE EJECUCIONES DE AGENTES ────────────────────────
const AGENT_LOG={
  _key:'thelab_agent_runs_v1',
  _runs:null,
  _merged:null,
  _load(){if(this._runs) return;try{this._runs=JSON.parse(localStorage.getItem(this._key)||'[]');}catch(e){this._runs=[];}},
  add(agent,input,output){
    this._load();
    const u=typeof AUTH!=='undefined'&&AUTH.getUser?AUTH.getUser():null;
    const entry={id:Date.now(),agent,input:(input||'').substring(0,300),output:output||'',time:new Date().toISOString(),user:u?.name||u?.username||'—'};
    // Comunicación entre agentes: si justo antes ejecutó otro agente distinto, es un handoff → el agente anterior camina a este departamento
    try{ const now=Date.now(); if(typeof ofLogComm==='function'){ if(_ofLastExec && _ofLastExec.label!==agent && now-_ofLastExec.t<120000) ofLogComm(_ofLastExec.label, agent); _ofLastExec={label:agent,t:now}; } }catch(e){}
    this._runs.unshift(entry);
    if(this._runs.length>100) this._runs=this._runs.slice(0,100);
    try{localStorage.setItem(this._key,JSON.stringify(this._runs));}catch(e){}
    this._merged=null;
    // Write-behind a Airtable (silencioso: la tabla puede no existir o el rol no escribir)
    try{
      if(u&&typeof RBAC!=='undefined'&&RBAC.canWriteRole(u.role)){
        airtableWrite('Agent_Log','POST',null,{'Agente':entry.agent,'Consulta':entry.input,'Resultado':entry.output.substring(0,5000),'Usuario':entry.user,'Fecha':entry.time}).catch(()=>{});
      }
    }catch(e){}
  },
  _dedupKey(r){return r.agent+'|'+(r.time||'').substring(0,16)+'|'+(r.input||'').substring(0,40);},
  open(){
    this._load();
    const m=document.getElementById('agentLogModal');if(!m) return;
    m.style.display='flex';
    this._merged=this._runs;
    this.render();
    // Merge con el historial compartido de Airtable (si la tabla existe)
    airtableFetch('Agent_Log',100).then(res=>{
      const remote=(res.records||[]).map(rec=>({id:'at_'+rec.id,agent:rec.fields['Agente']||'—',input:rec.fields['Consulta']||'',output:rec.fields['Resultado']||'',time:rec.fields['Fecha']||rec.createdTime||'',user:rec.fields['Usuario']||'—',remote:true}));
      const seen=new Set();
      const all=[...this._runs,...remote].filter(r=>{const k=this._dedupKey(r);if(seen.has(k)) return false;seen.add(k);return true;});
      all.sort((a,b)=>(b.time||'').localeCompare(a.time||''));
      this._merged=all.slice(0,100);
      this.render();
    }).catch(()=>{});
  },
  close(){const m=document.getElementById('agentLogModal');if(m) m.style.display='none';},
  render(){
    const list=document.getElementById('agentLogList');if(!list) return;
    const rows=this._merged||this._runs;
    if(!rows.length){list.innerHTML='<div class="notif-empty">Aún no hay ejecuciones registradas</div>';return;}
    list.innerHTML=rows.map(r=>`
      <div class="notif-item" onclick="AGENT_LOG.view('${r.id}')" style="cursor:pointer">
        <div class="notif-body">
          <div class="notif-title">🤖 ${escapeHtml(r.agent)} <span style="font-weight:400;color:var(--text3)">· ${escapeHtml(r.user)}${r.remote?' ☁':''}</span></div>
          <div class="notif-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml((r.input||r.output).substring(0,90))}</div>
        </div>
        <div class="notif-time" style="white-space:nowrap;font-size:10px">${NOTIFY._fmtFull(r.time)}</div>
      </div>`).join('');
  },
  view(id){
    this._load();
    const rows=this._merged||this._runs;
    const r=rows.find(x=>String(x.id)===String(id));if(!r) return;
    this.close();
    document.getElementById('agentInlineTitle').textContent='📜 '+r.agent+' — '+NOTIFY._fmtFull(r.time);
    const resultEl=document.getElementById('agentInlineResult');
    resultEl.className='agent-modal-result';
    resultEl.style.whiteSpace='normal';
    // Consulta como cabecera ligera + salida procesada (suave y estructurada, igual que en Agentes).
    const consultaHtml=r.input?`<div style="font-size:11px;color:var(--text2);background:var(--surface3);border:1px solid var(--border);border-radius:8px;padding:8px 11px;margin-bottom:12px;line-height:1.5"><div style="font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;font-size:9.5px;margin-bottom:3px">▸ Consulta</div>${escapeHtml(String(r.input)).replace(/\n/g,'<br>')}</div>`:'';
    resultEl.innerHTML=consultaHtml+formatAgentReport(r.output||'');
    _agentInlineText=r.output;
    document.getElementById('agentInlineActions').innerHTML=agentCtaButtonsHtml('',r.output||'')+'<button class="btn btn-ghost btn-sm" onclick="copyAgentResult()">📋 Copiar</button><button class="btn btn-ghost btn-sm" onclick="closeAgentInlineModal();AGENT_LOG.open()">← Volver al historial</button>';
    document.getElementById('agentInlineModal').style.display='flex';
  },
  clear(){if(!confirm('¿Borrar el historial local de agentes? (el historial compartido en Airtable no se borra)')) return;this._runs=[];this._merged=null;try{localStorage.removeItem(this._key);}catch(e){}this.render();}
};

