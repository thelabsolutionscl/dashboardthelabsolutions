/* js/linkedin.js — prospeccion LinkedIn dentro de Redes Sociales. */
(function(){
'use strict';
var TABLE='LinkedIn_Prospects';
var STATES=['Descubierto','Analizado','Calificado','Por contactar','Contactado','Respondió','Oportunidad','Cliente','Descartado'];
var SEGMENTS=['Agencia marketing / BTL','Marketing / Brand','Trade Marketing','RRHH / People','Compras','Eventos / Productora','Retail / Locales','Merchandising','Otro'];
var IDENTITIES=['The Lab Solutions','Gustavo','Nicanor'];
var SERVICE=['Activaciones','Premiaciones','Merchandising','Impresión 3D','Volumétricos','Cartelería','Papelería','Chip The Lab','Otro'];
var QUERY={
 'Agencia marketing / BTL':'agencia marketing BTL brand experience director gerente',
 'Marketing / Brand':'marketing manager brand manager gerente marketing',
 'Trade Marketing':'trade marketing shopper marketing category manager',
 'RRHH / People':'people manager recursos humanos HR employee experience',
 'Compras':'procurement compras abastecimiento buyer',
 'Eventos / Productora':'productora eventos event manager experiential',
 'Retail / Locales':'retail expansión visual merchandising aperturas locales',
 'Merchandising':'merchandising marketing promocional compras corporativas','Otro':''
};
var loaded=false,busy=false,editId=null;
var analyzeBusy=new Set(),convertBusy=new Set(),statusBusy=new Set();
var CONVERTIBLE_STATES=['Calificado','Por contactar','Contactado','Respondió','Oportunidad'];
function cleanText(v){return String(v||'').trim().replace(/\s+/g,' ');}
function normText(v){return cleanText(v).toLowerCase();}
function normEmail(v){return cleanText(v).toLowerCase();}
function normPhone(v){return String(v||'').replace(/\D/g,'');}
function canonicalLinkedinUrl(v){
 var raw=cleanText(v);if(!raw)return '';
 try{
   var u=new URL(raw);
   if(!/(^|\.)linkedin\.com$/i.test(u.hostname))return '';
   var path=(u.pathname||'').replace(/\/{2,}/g,'/').replace(/\/$/,'');
   return 'https://www.linkedin.com'+(path||'');
 }catch(_){return '';}
}
function prospectDue(f){
 if(!f||!f['Próximo seguimiento']||['Cliente','Descartado'].indexOf(f.Estado)>=0)return false;
 var t=new Date(f['Próximo seguimiento']).getTime();return Number.isFinite(t)&&t<=Date.now();
}
function e(v){return typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function say(m,t){try{toast(m,t||'info');}catch(_){console.log(m);}}
function wr(table,method,id,fields){return typeof _redesWrite==='function'?_redesWrite(table,method,id,fields):airtableWriteTolerant(table,method,id,fields);}
function opts(a,blank){return (blank?'<option value="">'+e(blank)+'</option>':'')+a.map(function(x){return '<option value="'+e(x)+'">'+e(x)+'</option>';}).join('');}
function css(){
 if(document.getElementById('linkedinLeadsStyle'))return;
 var s=document.createElement('style');s.id='linkedinLeadsStyle';
 s.textContent='#linkedinLeadEngine{margin-bottom:20px;overflow:hidden}#linkedinLeadEngine .li-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--border)}#linkedinLeadEngine .li-brand{display:flex;gap:11px}#linkedinLeadEngine .li-logo{width:38px;height:38px;border-radius:10px;background:#0a66c2;color:#fff;display:grid;place-items:center;font-weight:800;font-size:19px}#linkedinLeadEngine .li-title{font-size:15px;font-weight:750}#linkedinLeadEngine .li-sub{font-size:11.5px;color:var(--text2);margin-top:3px;max-width:760px;line-height:1.45}#linkedinLeadEngine .li-status,#linkedinLeadEngine .li-row,#linkedinLeadEngine .li-actions,#linkedinLeadEngine .li-filters{display:flex;gap:7px;flex-wrap:wrap;align-items:center}#linkedinLeadEngine .li-pill{border:1px solid var(--border);background:var(--surface3);color:var(--text2);font-size:10px;padding:4px 8px;border-radius:999px;font-weight:700}#linkedinLeadEngine .li-pill.ok{color:var(--success);border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.09)}#linkedinLeadEngine .li-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px 16px}#linkedinLeadEngine .li-kpi{padding:10px 12px;border:1px solid var(--border);background:var(--surface2);border-radius:10px}#linkedinLeadEngine .li-kpi span{display:block;font-size:9px;text-transform:uppercase;color:var(--text3)}#linkedinLeadEngine .li-kpi b{display:block;font-size:21px;margin-top:2px}#linkedinLeadEngine .li-builder,#linkedinLeadEngine .li-filters{padding:12px 16px;border-top:1px solid var(--border)}#linkedinLeadEngine select,#linkedinLeadEngine input{min-height:34px;border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:8px;padding:7px 9px;font-size:11.5px}#linkedinLeadEngine .grow{flex:1;min-width:190px}#linkedinLeadEngine .li-note,#linkedinLeadEngine .meta{font-size:10.5px;color:var(--text3);line-height:1.45}#linkedinLeadEngine .li-note{margin-top:8px}#linkedinLeadEngine .cardrow{padding:13px 16px;border-top:1px solid var(--border);display:grid;grid-template-columns:minmax(210px,1.25fr) minmax(160px,.8fr) minmax(220px,1.1fr);gap:12px}#linkedinLeadEngine .name{font-size:13px;font-weight:750}#linkedinLeadEngine .company{font-size:11.5px;color:var(--text2);margin-top:2px}#linkedinLeadEngine .score{display:inline-grid;place-items:center;min-width:34px;height:30px;border-radius:8px;background:rgba(10,102,194,.13);border:1px solid rgba(10,102,194,.3);font-weight:800;color:#3b9bff}#linkedinLeadEngine .state{display:inline-block;font-size:9px;font-weight:800;border:1px solid var(--border);border-radius:999px;padding:3px 7px;background:var(--surface3)}#linkedinLeadEngine .msg{font-size:10.5px;color:var(--text2);line-height:1.45;white-space:pre-line;max-height:84px;overflow:hidden}#linkedinLeadEngine .in-title{padding:12px 16px 8px;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--text3);border-top:1px solid var(--border)}#linkedinLeadEngine .inbound{padding:0 16px 14px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#linkedinLeadEngine .in-card{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface2)}#linkedinLeadEngine .empty{padding:18px;text-align:center;color:var(--text3);font-size:11.5px}.li-modal-bg{position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.62);display:none;align-items:center;justify-content:center;padding:18px}.li-modal{width:min(760px,96vw);max-height:90vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px}.li-modal .mh,.li-modal .mf{padding:14px 17px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:7px}.li-modal .mf{border-bottom:0;border-top:1px solid var(--border);justify-content:flex-end}.li-modal .mb{padding:14px 17px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.li-modal label{font-size:10px;color:var(--text3);display:flex;flex-direction:column;gap:5px}.li-modal input,.li-modal select,.li-modal textarea{width:100%;border:1px solid var(--border);background:var(--surface2);color:var(--text);border-radius:8px;padding:8px}.li-modal textarea{min-height:72px}.li-modal .wide{grid-column:1/-1}@media(max-width:900px){#linkedinLeadEngine .li-kpis{grid-template-columns:repeat(2,1fr)}#linkedinLeadEngine .cardrow,#linkedinLeadEngine .inbound{grid-template-columns:1fr}#linkedinLeadEngine .li-head{flex-direction:column}.li-modal .mb{grid-template-columns:1fr}.li-modal .wide{grid-column:1}}';
 document.head.appendChild(s);
}
function mount(){
 if(document.getElementById('linkedinLeadEngine'))return true;
 var host=document.getElementById('tab-redes');if(!host)return false;css();
 var box=document.createElement('div');box.className='card';box.id='linkedinLeadEngine';
 box.innerHTML='<div class="li-head"><div class="li-brand"><div class="li-logo">in</div><div><div class="li-title">LinkedIn · Motor de leads B2B</div><div class="li-sub">Inbound + prospección outbound. Los prospectos se califican aquí y solo pasan a <b>Clientes</b> cuando corresponde. TLS, Gustavo y Nicanor quedan trazados como identidad de contacto.</div></div></div><div class="li-status"><span class="li-pill ok">✓ CRM conectado</span><span class="li-pill">Perfiles personales: envío asistido</span></div></div>'+
 '<div class="li-kpis"><div class="li-kpi"><span>Prospectos activos</span><b id="liKpiA">—</b></div><div class="li-kpi"><span>Por contactar</span><b id="liKpiP">—</b></div><div class="li-kpi"><span>Contactados</span><b id="liKpiC">—</b></div><div class="li-kpi"><span>Respondieron</span><b id="liKpiR">—</b></div><div class="li-kpi"><span>Leads CRM LinkedIn</span><b id="liKpiL">—</b></div></div>'+
 '<div class="li-builder"><div style="font-size:11px;font-weight:800;margin-bottom:8px">Descubrir prospectos</div><div class="li-row"><select id="liMode"><option value="people">Personas</option><option value="companies">Empresas</option></select><select id="liSeg">'+opts(SEGMENTS,'Segmento')+'</select><select id="liIdentity">'+opts(IDENTITIES,'Identidad / IA después')+'</select><input id="liKw" class="grow" placeholder="Ej: gerente marketing retail Santiago"><input id="liCamp" placeholder="Campaña (opcional)"><button class="btn btn-primary btn-sm" onclick="linkedinOpenSearch()">Buscar en LinkedIn ↗</button><button class="btn btn-ghost btn-sm" onclick="linkedinNewProspect()">+ Guardar prospecto</button></div><div class="li-note">La búsqueda abre LinkedIn para elegir perfiles reales. El dashboard no scrapea ni envía invitaciones automáticamente; la IA sí analiza, redacta y administra el seguimiento.</div></div>'+
 '<div class="li-filters"><input id="liQ" class="grow" placeholder="Buscar persona, empresa, cargo…" oninput="linkedinRender()"><select id="liState" onchange="linkedinRender()">'+opts(STATES,'Todos los estados')+'</select><select id="liFIdentity" onchange="linkedinRender()">'+opts(IDENTITIES,'Todas las identidades')+'</select><select id="liFSeg" onchange="linkedinRender()">'+opts(SEGMENTS,'Todos los segmentos')+'</select><button class="btn btn-ghost btn-sm" onclick="linkedinLoad(true)">↻ Actualizar</button></div>'+
 '<div id="linkedinProspectList"><div class="empty">Cargando prospectos…</div></div><div class="in-title">Inbound LinkedIn ya convertido a CRM</div><div class="inbound" id="linkedinInboundList"></div>';
 var a=document.getElementById('redesAutoPanel');if(a&&a.parentNode)a.parentNode.insertBefore(box,a);else host.appendChild(box);modal();return true;
}
function modal(){
 if(document.getElementById('linkedinProspectModal'))return;
 var m=document.createElement('div');m.className='li-modal-bg';m.id='linkedinProspectModal';
 m.innerHTML='<div class="li-modal"><div class="mh"><b id="liMTitle">Nuevo prospecto LinkedIn</b><button class="btn btn-ghost btn-sm" onclick="linkedinCloseProspect()">✕</button></div><div class="mb">'+
 '<label>Nombre / contacto<input id="liPName"></label><label>Empresa<input id="liPCompany"></label><label>Cargo<input id="liPTitle"></label><label>LinkedIn URL<input id="liPUrl" placeholder="https://www.linkedin.com/in/..."></label><label>Email<input id="liPEmail"></label><label>Teléfono<input id="liPPhone"></label><label>Sitio web<input id="liPWeb"></label><label>Industria<input id="liPIndustry"></label><label>Segmento<select id="liPSeg">'+opts(SEGMENTS,'—')+'</select></label><label>Fuente<select id="liPSource">'+opts(['Outbound','Lead Gen Form','Interacción','Importado'])+'</select></label><label>Identidad<select id="liPIdentity">'+opts(IDENTITIES,'IA / sin asignar')+'</select></label><label>Campaña<input id="liPCamp"></label><label class="wide">Notas<textarea id="liPNotes"></textarea></label></div><div class="mf"><button class="btn btn-ghost btn-sm" onclick="linkedinCloseProspect()">Cancelar</button><button class="btn btn-primary btn-sm" onclick="linkedinSaveProspect()">Guardar</button></div></div>';
 m.addEventListener('click',function(x){if(x.target===m)linkedinCloseProspect();});document.body.appendChild(m);
}
async function linkedinLoad(force){
 mount();if(typeof _redesDemo!=='undefined'&&_redesDemo){state.linkedinProspects=[];loaded=true;linkedinRender();return;}
 if(busy)return;if(loaded&&!force){linkedinRender();return;}busy=true;
 try{var r=await airtableFetch(TABLE,500);state.linkedinProspects=r.records||[];loaded=true;linkedinRender();}
 catch(err){var x=document.getElementById('linkedinProspectList');if(x)x.innerHTML='<div class="empty">⚠ '+e(err.message)+'</div>';}finally{busy=false;}
}
function crmLeads(){return (state.clientes||[]).filter(function(c){return String((c.fields||{})['Origen lead']||'').toLowerCase()==='linkedin';});}
function filtered(){
 var q=(document.getElementById('liQ')||{}).value||'',st=(document.getElementById('liState')||{}).value||'',idn=(document.getElementById('liFIdentity')||{}).value||'',seg=(document.getElementById('liFSeg')||{}).value||'';q=q.toLowerCase();
 return (state.linkedinProspects||[]).filter(function(r){var f=r.fields||{},txt=[f.Prospecto,f.Empresa,f.Cargo,f.Industria,f['Servicio interés'],f.Campaña].join(' ').toLowerCase();return (!q||txt.indexOf(q)>=0)&&(!st||(f.Estado||'Descubierto')===st)&&(!idn||f.Identidad===idn)&&(!seg||f.Segmento===seg);}).sort(function(a,b){
   var da=prospectDue(a.fields||{})?1:0,db=prospectDue(b.fields||{})?1:0;if(da!==db)return db-da;
   var sa=Number((a.fields||{})['Score B2B']||0),sb=Number((b.fields||{})['Score B2B']||0);if(sa!==sb)return sb-sa;
   return new Date((b.fields||{})['Fecha descubrimiento']||b.createdTime||0)-new Date((a.fields||{})['Fecha descubrimiento']||a.createdTime||0);
 });
}
function linkedinRender(){
 if(!mount())return;var p=state.linkedinProspects||[],c=crmLeads(),set=function(id,v){var x=document.getElementById(id);if(x)x.textContent=v;};
 set('liKpiA',p.filter(function(x){return ['Cliente','Descartado'].indexOf((x.fields||{}).Estado)<0;}).length);
 set('liKpiP',p.filter(function(x){return ['Calificado','Por contactar'].indexOf((x.fields||{}).Estado)>=0;}).length);
 set('liKpiC',p.filter(function(x){return ['Contactado','Respondió','Oportunidad','Cliente'].indexOf((x.fields||{}).Estado)>=0;}).length);
 set('liKpiR',p.filter(function(x){return ['Respondió','Oportunidad','Cliente'].indexOf((x.fields||{}).Estado)>=0;}).length);set('liKpiL',c.length);
 var l=document.getElementById('linkedinProspectList'),rows=filtered();if(l)l.innerHTML=rows.length?rows.map(card).join(''):'<div class="empty">Sin prospectos con estos filtros. Busca en LinkedIn y guarda los perfiles que quieras trabajar.</div>';
 var ib=document.getElementById('linkedinInboundList');if(ib){var rec=c.slice().sort(function(a,b){return new Date(b.createdTime||0)-new Date(a.createdTime||0);}).slice(0,9);ib.innerHTML=rec.length?rec.map(function(r){var f=r.fields||{};return '<div class="in-card"><div class="name">'+e(f.Empresa||f.Contacto||'Lead LinkedIn')+'</div><div class="company">'+e(f.Contacto||'')+(f['Cargo contacto']?' · '+e(f['Cargo contacto']):'')+'</div><div class="meta">'+(f['Lead Score IA']?'Score '+e(f['Lead Score IA'])+'/10 · ':'')+e(f['Etapa venta']||'Lead')+'</div><div class="li-actions"><button class="btn btn-ghost btn-sm" onclick="linkedinOpenClient(\''+r.id+'\')">Ver en Clientes</button></div></div>';}).join(''):'<div class="empty" style="grid-column:1/-1">Aún no hay Clientes con origen LinkedIn.</div>';}
}
function card(r){
 var f=r.fields||{},st=f.Estado||'Descubierto',sc=Number(f['Score B2B']||0),url=f['LinkedIn URL']||'',cl=Array.isArray(f.Cliente)&&f.Cliente[0]?f.Cliente[0]:'',msg=f['Mensaje inicial']||'',fu=f['Follow-up']||'',due=prospectDue(f);
 var b1=url?'<button class="btn btn-ghost btn-sm" onclick="linkedinOpenProfile(\''+r.id+'\')">LinkedIn ↗</button>':'';
 var bc=CONVERTIBLE_STATES.indexOf(st)>=0?'<button class="btn btn-primary btn-sm" onclick="linkedinConvertToClient(\''+r.id+'\')">→ Clientes</button>':'';
 var bq=st==='Calificado'?'<button class="btn btn-ghost btn-sm" onclick="linkedinQueueForContact(\''+r.id+'\')">→ Por contactar</button>':'';
 var bm=['Calificado','Por contactar'].indexOf(st)>=0?'<button class="btn btn-ghost btn-sm" onclick="linkedinMarkContacted(\''+r.id+'\')">✓ Contactado</button>':'';
 var br=st==='Contactado'?'<button class="btn btn-ghost btn-sm" onclick="linkedinMarkReplied(\''+r.id+'\')">Respondió</button>':'';
 var bo=st==='Respondió'?'<button class="btn btn-ghost btn-sm" onclick="linkedinMarkOpportunity(\''+r.id+'\')">★ Oportunidad</button>':'';
 var bd=['Cliente','Descartado'].indexOf(st)<0?'<button class="btn btn-ghost btn-sm" onclick="linkedinDiscard(\''+r.id+'\')">Descartar</button>':'';
 var follow=f['Próximo seguimiento']?'<div class="meta" style="'+(due?'color:var(--danger);font-weight:700':'')+'">Seguimiento: '+e(new Date(f['Próximo seguimiento']).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))+(due?' · VENCIDO':'')+'</div>':'';
 return '<div class="cardrow"><div><div class="name">'+e(f.Prospecto||'Sin nombre')+' <span class="state">'+e(st)+'</span></div><div class="company">'+e(f.Empresa||'—')+(f.Cargo?' · '+e(f.Cargo):'')+'</div><div class="meta">'+e(f.Segmento||'Sin segmento')+' · '+e(f.Identidad||'identidad pendiente')+(f.Campaña?' · '+e(f.Campaña):'')+'</div>'+follow+'<div class="li-actions">'+b1+'<button class="btn btn-ghost btn-sm" onclick="linkedinEditProspect(\''+r.id+'\')">Editar</button>'+bd+'</div></div>'+
 '<div><div style="display:flex;gap:8px;align-items:center"><span class="score">'+(sc||'—')+'</span><div><b style="font-size:11px">'+e(f['Servicio interés']||'Sin servicio')+'</b><div class="meta">Decisor: '+e(f.Decisor||'—')+'</div></div></div><div class="meta">'+e(f['Próxima acción']||'Sin próxima acción')+'</div></div>'+
 '<div><div class="msg">'+e(msg||f['Motivo IA']||'Analiza este prospecto para generar mensaje y siguiente paso.')+'</div><div class="li-actions"><button class="btn btn-ghost btn-sm" onclick="linkedinAnalyze(\''+r.id+'\')">✨ Analizar IA</button>'+(msg?'<button class="btn btn-ghost btn-sm" onclick="linkedinCopyMessage(\''+r.id+'\')">Copiar mensaje</button>':'')+(fu?'<button class="btn btn-ghost btn-sm" onclick="linkedinCopyFollowup(\''+r.id+'\')">Copiar follow-up</button>':'')+bq+bm+br+bo+bc+(cl?'<button class="btn btn-ghost btn-sm" onclick="linkedinOpenClient(\''+cl+'\')">Abrir cliente</button>':'')+'</div></div></div>';
}
function linkedinOpenSearch(){var mode=(document.getElementById('liMode')||{}).value||'people',seg=(document.getElementById('liSeg')||{}).value||'',kw=((document.getElementById('liKw')||{}).value||'').trim(),q=[QUERY[seg]||'',kw].filter(Boolean).join(' ')||'marketing manager Chile';window.open('https://www.linkedin.com/search/results/'+(mode==='companies'?'companies':'people')+'/?keywords='+encodeURIComponent(q),'_blank','noopener,noreferrer');}
function linkedinNewProspect(){modal();editId=null;['liPName','liPCompany','liPTitle','liPUrl','liPEmail','liPPhone','liPWeb','liPIndustry','liPNotes'].forEach(function(id){document.getElementById(id).value='';});document.getElementById('liPSeg').value=(document.getElementById('liSeg')||{}).value||'';document.getElementById('liPIdentity').value=(document.getElementById('liIdentity')||{}).value||'';document.getElementById('liPCamp').value=(document.getElementById('liCamp')||{}).value||'';document.getElementById('liPSource').value='Outbound';document.getElementById('liMTitle').textContent='Nuevo prospecto LinkedIn';document.getElementById('linkedinProspectModal').style.display='flex';}
function linkedinEditProspect(id){var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;});if(!r)return;modal();editId=id;var f=r.fields||{},m={liPName:'Prospecto',liPCompany:'Empresa',liPTitle:'Cargo',liPUrl:'LinkedIn URL',liPEmail:'Email',liPPhone:'Teléfono',liPWeb:'Sitio web',liPIndustry:'Industria',liPSeg:'Segmento',liPSource:'Fuente',liPIdentity:'Identidad',liPCamp:'Campaña',liPNotes:'Notas'};Object.keys(m).forEach(function(k){document.getElementById(k).value=f[m[k]]||'';});document.getElementById('liMTitle').textContent='Editar prospecto LinkedIn';document.getElementById('linkedinProspectModal').style.display='flex';}
function linkedinCloseProspect(){var m=document.getElementById('linkedinProspectModal');if(m)m.style.display='none';editId=null;}
function duplicate(f,id){
 var em=normEmail(f.Email),u=canonicalLinkedinUrl(f['LinkedIn URL']),ph=normPhone(f['Teléfono']),n=normText(f.Prospecto),co=normText(f.Empresa);
 return (state.linkedinProspects||[]).find(function(r){
   if(r.id===id)return false;var x=r.fields||{};
   return (em&&normEmail(x.Email)===em)||(u&&canonicalLinkedinUrl(x['LinkedIn URL'])===u)||(ph&&normPhone(x['Teléfono'])===ph)||(n&&co&&normText(x.Prospecto)===n&&normText(x.Empresa)===co);
 });
}
async function linkedinSaveProspect(){
 var f={Prospecto:document.getElementById('liPName').value.trim(),Empresa:document.getElementById('liPCompany').value.trim(),Cargo:document.getElementById('liPTitle').value.trim(),'LinkedIn URL':document.getElementById('liPUrl').value.trim(),Email:document.getElementById('liPEmail').value.trim(),'Teléfono':document.getElementById('liPPhone').value.trim(),'Sitio web':document.getElementById('liPWeb').value.trim(),Industria:document.getElementById('liPIndustry').value.trim(),Segmento:document.getElementById('liPSeg').value,Fuente:document.getElementById('liPSource').value,Identidad:document.getElementById('liPIdentity').value,Campaña:document.getElementById('liPCamp').value.trim(),Notas:document.getElementById('liPNotes').value.trim()};
 if(!f.Prospecto&&!f.Empresa){say('Ingresa al menos nombre o empresa','error');return;}
 if(f.Email&&typeof validEmail==='function'&&!validEmail(f.Email)){say('El email no es válido','error');return;}
 if(f['LinkedIn URL']){var canon=canonicalLinkedinUrl(f['LinkedIn URL']);if(!canon){say('La URL debe ser un perfil o empresa de linkedin.com','error');return;}f['LinkedIn URL']=canon;}
 if(duplicate(f,editId)){say('Ese prospecto ya está en la cola (email, teléfono, perfil o nombre+empresa)','error');return;}
 try{if(editId){await wr(TABLE,'PATCH',editId,f);Object.assign((state.linkedinProspects||[]).find(function(x){return x.id===editId;}).fields,f);}else{f.Estado='Descubierto';f['Fecha descubrimiento']=new Date().toISOString();var r=await wr(TABLE,'POST',null,f);if(r)(state.linkedinProspects||(state.linkedinProspects=[])).push(r);}linkedinCloseProspect();linkedinRender();say('Prospecto guardado ✓','success');}catch(err){say('No se pudo guardar: '+err.message,'error');}
}
function label(t,k){var names=['SCORE_B2B','SERVICIO_RECOMENDADO','DECISOR','MENSAJE_LINKEDIN','MENSAJE_EMAIL','OBJECIONES_PROBABLES','PROXIMA_ACCION','MOTIVO_IA','FOLLOW_UP','IDENTIDAD_RECOMENDADA'],re=new RegExp('(?:^|\\n)'+k+':\\s*([\\s\\S]*?)(?=\\n(?:'+names.join('|')+'):|$)','i'),m=String(t||'').match(re);return m?m[1].trim():'';}
function service(v){var z=String(v||'').toLowerCase();return SERVICE.find(function(x){return x.toLowerCase()===z;})||SERVICE.find(function(x){return z.indexOf(x.toLowerCase())>=0;})||(z?'Otro':'');}
async function linkedinAnalyze(id){
 if(analyzeBusy.has(id))return;var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;});if(!r)return;var f=r.fields||{},cfg=(typeof AGENTES_CFG!=='undefined'?AGENTES_CFG:[]).find(function(x){return x.id==='LINKEDIN'||x.label==='LINKEDIN_AGENT';});if(typeof callAgentClaude!=='function'){say('Motor IA no disponible','error');return;}analyzeBusy.add(id);
 var sys=(cfg&&cfg.sys?cfg.sys:'Eres analista B2B de The Lab Solutions.')+'\nAñade al final: MOTIVO_IA: <por qué encaja>; FOLLOW_UP: <seguimiento breve>; IDENTIDAD_RECOMENDADA: <The Lab Solutions, Gustavo o Nicanor>. No inventes datos ausentes.';
 var u='Prospecto LinkedIn\nNombre: '+(f.Prospecto||'desconocido')+'\nEmpresa: '+(f.Empresa||'desconocida')+'\nCargo: '+(f.Cargo||'desconocido')+'\nIndustria: '+(f.Industria||'desconocida')+'\nSegmento: '+(f.Segmento||'sin clasificar')+'\nNotas: '+(f.Notas||'sin notas')+'\nCampaña: '+(f.Campaña||'sin campaña');
 try{say('Analizando con LINKEDIN_AGENT…','info');var out=await callAgentClaude('LINKEDIN',sys,u,{maxTokens:650}),rawScore=parseInt(label(out,'SCORE_B2B')),score=Number.isFinite(rawScore)?Math.max(1,Math.min(10,rawScore)):0;if(!score)throw new Error('La IA no devolvió un SCORE_B2B válido');var dec=label(out,'DECISOR').split(/\s|\n/)[0],idn=label(out,'IDENTIDAD_RECOMENDADA'),p={'Score B2B':score,'Servicio interés':service(label(out,'SERVICIO_RECOMENDADO')),Decisor:['Alto','Medio','Bajo'].indexOf(dec)>=0?dec:undefined,'Mensaje inicial':label(out,'MENSAJE_LINKEDIN'),'Follow-up':label(out,'FOLLOW_UP'),'Próxima acción':label(out,'PROXIMA_ACCION'),'Motivo IA':label(out,'MOTIVO_IA')||label(out,'OBJECIONES_PROBABLES'),Estado:score>=7?'Calificado':'Analizado'};if(!f.Identidad&&IDENTITIES.indexOf(idn)>=0)p.Identidad=idn;Object.keys(p).forEach(function(k){if(p[k]===undefined)delete p[k];});await wr(TABLE,'PATCH',id,p);Object.assign(f,p);linkedinRender();say('Análisis listo ✓','success');}catch(err){say('No se pudo analizar: '+err.message,'error');}finally{analyzeBusy.delete(id);}
}
function linkedinCopyMessage(id){var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;}),m=r&&r.fields?r.fields['Mensaje inicial']:'';if(!m){say('Primero analiza el prospecto','error');return;}navigator.clipboard.writeText(m).then(function(){say('Mensaje copiado ✓','success');}).catch(function(){say('No se pudo copiar','error');});}
function linkedinCopyFollowup(id){var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;}),m=r&&r.fields?r.fields['Follow-up']:'';if(!m){say('No hay follow-up generado','error');return;}navigator.clipboard.writeText(m).then(function(){say('Follow-up copiado ✓','success');}).catch(function(){say('No se pudo copiar','error');});}
function linkedinOpenProfile(id){var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;}),u=r&&r.fields?r.fields['LinkedIn URL']:'';if(!/^https:\/\/(www\.)?linkedin\.com\//i.test(u||'')){say('Falta URL de LinkedIn','error');return;}window.open(u,'_blank','noopener,noreferrer');}
async function status(id,st,extra){
 if(statusBusy.has(id))return;var r=(state.linkedinProspects||[]).find(function(x){return x.id===id;});if(!r)return;
 statusBusy.add(id);try{var p=Object.assign({Estado:st},extra||{});await wr(TABLE,'PATCH',id,p);Object.assign(r.fields,p);linkedinRender();}finally{statusBusy.delete(id);}
}
async function linkedinQueueForContact(id){try{await status(id,'Por contactar');say('Prospecto puesto en cola de contacto ✓','success');}catch(err){say(err.message,'error');}}
async function linkedinMarkContacted(id){try{var n=new Date(),d=new Date(n.getTime()+3*86400000);await status(id,'Contactado',{'Fecha último contacto':n.toISOString(),'Próximo seguimiento':d.toISOString()});say('Contactado · follow-up en 3 días','success');}catch(err){say(err.message,'error');}}
async function linkedinMarkReplied(id){try{await status(id,'Respondió',{'Fecha último contacto':new Date().toISOString(),'Próximo seguimiento':null});say('Respuesta registrada ✓','success');}catch(err){say(err.message,'error');}}
async function linkedinMarkOpportunity(id){try{await status(id,'Oportunidad');say('Marcado como oportunidad ✓','success');}catch(err){say(err.message,'error');}}
async function linkedinDiscard(id){try{await status(id,'Descartado',{'Próximo seguimiento':null});say('Prospecto descartado','success');}catch(err){say(err.message,'error');}}
function findClient(p){
 var f=p.fields||{},em=normEmail(f.Email),u=canonicalLinkedinUrl(f['LinkedIn URL']),ph=normPhone(f['Teléfono']),n=normText(f.Prospecto),co=normText(f.Empresa);
 return (state.clientes||[]).find(function(c){var x=c.fields||{};return (em&&normEmail(x.Email)===em)||(u&&canonicalLinkedinUrl(x['LinkedIn URL'])===u)||(ph&&normPhone(x['Teléfono'])===ph)||(n&&co&&normText(x.Contacto)===n&&normText(x.Empresa)===co);});
}
async function linkedinConvertToClient(id){
 if(convertBusy.has(id))return;var p=(state.linkedinProspects||[]).find(function(x){return x.id===id;});if(!p)return;var f=p.fields||{};
 if(f.Convertido&&Array.isArray(f.Cliente)&&f.Cliente[0]){linkedinOpenClient(f.Cliente[0]);return;}
 if(CONVERTIBLE_STATES.indexOf(f.Estado||'Descubierto')<0){say('Primero califica el prospecto antes de pasarlo a Clientes','error');return;}
 convertBusy.add(id);try{
   try{var latest=await airtableFetch('Clientes',1000);if(latest&&Array.isArray(latest.records))state.clientes=latest.records;}catch(_){}
   var c=findClient(p),created=false;if(!c){var cf={Empresa:f.Empresa||f.Prospecto||'Lead LinkedIn',Contacto:f.Prospecto||'','Cargo contacto':f.Cargo||'','Teléfono':f['Teléfono']||'',Email:f.Email||'','Sitio web':f['Sitio web']||'','LinkedIn URL':f['LinkedIn URL']||'','Etapa venta':'Lead nuevo','Origen lead':'LinkedIn','Lead Score IA':Number(f['Score B2B']||0)||undefined,'Servicio interés':service(f['Servicio interés']||'')||undefined,'Próxima acción IA':f['Próxima acción']||undefined,'Resumen IA':f['Motivo IA']||undefined,'Último agente ejecutado':Number(f['Score B2B']||0)?'LINKEDIN_AGENT':undefined,'Fecha primer contacto':(typeof hoyCL==='function'?hoyCL():new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago'}).format(new Date())),'Notas internas':['Prospección LinkedIn',f.Identidad?'Identidad: '+f.Identidad:'',f.Campaña?'Campaña: '+f.Campaña:'',f['LinkedIn URL']||''].filter(Boolean).join(' · ')};if(f.Identidad==='Gustavo')cf.Vendedor='gustavo';if(f.Identidad==='Nicanor')cf.Vendedor='nicanor';Object.keys(cf).forEach(function(k){if(cf[k]===undefined)delete cf[k];});c=await wr('Clientes','POST',null,cf);created=true;if(c)(state.clientes||(state.clientes=[])).push(c);}else{var pp={};if(!c.fields['LinkedIn URL']&&f['LinkedIn URL'])pp['LinkedIn URL']=f['LinkedIn URL'];if(!c.fields['Lead Score IA']&&f['Score B2B'])pp['Lead Score IA']=Number(f['Score B2B']);if(Object.keys(pp).length){await wr('Clientes','PATCH',c.id,pp);Object.assign(c.fields,pp);}}if(!c||!c.id)throw new Error('Airtable no devolvió Cliente');var pf={Cliente:[c.id],Convertido:true,Estado:'Cliente'};await wr(TABLE,'PATCH',id,pf);Object.assign(f,pf);if(!Number(f['Score B2B']||0)&&typeof createAgentQueueItem==='function')await createAgentQueueItem({evento:'linkedin.prospect_converted',entidad:'Cliente',entidadId:c.id,agente:'LINKEDIN_AGENT',prioridad:'Media',source:'linkedin',campaign:f.Campaña||'',input:{name:f.Prospecto,company:f.Empresa,jobTitle:f.Cargo,email:f.Email,linkedinUrl:f['LinkedIn URL']}});linkedinRender();try{renderClientes();}catch(_){}say(created?'Lead creado en Clientes ✓':'Vinculado al Cliente existente ✓','success');}catch(err){say('No se pudo convertir: '+err.message,'error');}finally{convertBusy.delete(id);}
}
function linkedinOpenClient(id){try{switchTab('clientes');setTimeout(function(){if(typeof openClienteDetalle==='function')openClienteDetalle(id);},40);}catch(_){}}
async function initLinkedinLeads(){if(!mount())return;if(!loaded)await linkedinLoad(false);else linkedinRender();}
var baseInit=window.initRedes;if(typeof baseInit==='function')window.initRedes=function(){var r=baseInit.apply(this,arguments);Promise.resolve(r).finally(initLinkedinLeads);return r;};
var baseLoad=window.redesLoad;if(typeof baseLoad==='function')window.redesLoad=async function(){var r=await baseLoad.apply(this,arguments);await linkedinLoad(arguments[0]);return r;};
Object.assign(window,{initLinkedinLeads:initLinkedinLeads,linkedinLoad:linkedinLoad,linkedinRender:linkedinRender,linkedinOpenSearch:linkedinOpenSearch,linkedinNewProspect:linkedinNewProspect,linkedinEditProspect:linkedinEditProspect,linkedinCloseProspect:linkedinCloseProspect,linkedinSaveProspect:linkedinSaveProspect,linkedinAnalyze:linkedinAnalyze,linkedinCopyMessage:linkedinCopyMessage,linkedinCopyFollowup:linkedinCopyFollowup,linkedinOpenProfile:linkedinOpenProfile,linkedinQueueForContact:linkedinQueueForContact,linkedinMarkContacted:linkedinMarkContacted,linkedinMarkReplied:linkedinMarkReplied,linkedinMarkOpportunity:linkedinMarkOpportunity,linkedinDiscard:linkedinDiscard,linkedinConvertToClient:linkedinConvertToClient,linkedinOpenClient:linkedinOpenClient});
setTimeout(mount,0);
})();