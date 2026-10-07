/* js/remuneraciones-engine.js
 * Motor autoritativo de proyección/comisiones. Separa estimaciones comerciales
 * de comisiones devengadas/aprobadas/pagadas y usa períodos compartidos.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.RemuneracionesEngine=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const TZ='America/Santiago';
const DEFAULT_RULE=Object.freeze({
  id:'commission-standard',version:1,sellerEmail:'*',seller:'*',
  rate:0.035,basis:'net_tax_document',validFrom:'2026-01-01',validTo:null,
  contract:'standard',product:'*'
});
const STATUS=Object.freeze(['estimated','accrued','approved','paid','reversed']);
let target=null,installed=false,shared=null,hydrating=null,period='mes';

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){try{return '$'+Math.round(num(v)).toLocaleString('es-CL');}catch(_){return '$'+Math.round(num(v));}}
function tzParts(input=new Date()){
  const d=input instanceof Date?input:new Date(input);
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const get=t=>p.find(x=>x.type===t)?.value||'';
  return {year:Number(get('year')),month:Number(get('month')),day:Number(get('day')),key:get('year')+'-'+get('month')+'-'+get('day')};
}
function todayKey(){return tzParts().key;}
function monthKey(input=new Date()){const p=tzParts(input);return String(p.year).padStart(4,'0')+'-'+String(p.month).padStart(2,'0');}
function dateShift(key,days){
  const m=String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return key;
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+days,12));
  return d.toISOString().slice(0,10);
}
function mondayKey(input=new Date()){
  const p=tzParts(input);
  const midday=new Date(Date.UTC(p.year,p.month-1,p.day,12));
  const dow=midday.getUTCDay();
  return dateShift(p.key,-((dow+6)%7));
}
function bounds(which=period,now=new Date()){
  const p=tzParts(now),ym=String(p.year)+'-'+String(p.month).padStart(2,'0');
  if(which==='todo')return {start:'0000-01-01',end:'9999-12-31',label:'histórico'};
  if(which==='anio')return {start:p.year+'-01-01',end:(p.year+1)+'-01-01',label:String(p.year)};
  if(which==='semana'){const s=mondayKey(now);return {start:s,end:dateShift(s,7),label:'semana'};}
  if(which==='anterior'){
    const d=new Date(Date.UTC(p.year,p.month-2,15,12)),q=tzParts(d);
    const start=q.year+'-'+String(q.month).padStart(2,'0')+'-01';
    return {start,end:ym+'-01',label:start.slice(0,7)};
  }
  const start=ym+'-01';
  const d=new Date(Date.UTC(p.year,p.month,15,12)),q=tzParts(d);
  return {start,end:q.year+'-'+String(q.month).padStart(2,'0')+'-01',label:ym};
}
function inBounds(key,b=bounds()){return /^\d{4}-\d{2}-\d{2}$/.test(String(key||''))&&key>=b.start&&key<b.end;}

function taxNet(fields,grossField='Monto total (CLP)'){
  const f=fields||{};
  for(const k of ['Monto neto (CLP)','Neto (CLP)','Subtotal neto (CLP)','Subtotal (CLP)']){
    const x=num(f[k]);if(x>0)return {amount:Math.round(x),source:k,verified:true};
  }
  const gross=num(f[grossField]||f['Total final (CLP)']);
  for(const k of ['IVA (CLP)','Monto IVA (CLP)','IVA']){
    const iva=num(f[k]);if(gross>0&&iva>=0&&iva<=gross)return {amount:Math.round(gross-iva),source:grossField+' - '+k,verified:true};
  }
  return {amount:0,source:'sin base tributaria',verified:false};
}
function sellerOf(fields){const v=fields?.['Vendedor'];return Array.isArray(v)?String(v[0]||''):String(v||'');}
function sellerEmailFrom(fields){
  for(const k of ['Vendedor email','Email vendedor','Seller email']){
    const v=String(fields?.[k]||'').trim().toLowerCase();if(v.includes('@'))return v;
  }
  return '';
}
function rules(doc=shared){return Array.isArray(doc?.rules)&&doc.rules.length?doc.rules:[DEFAULT_RULE];}
function resolveRule({seller='',sellerEmail='',date=todayKey(),product=''}={},doc=shared){
  const sm=norm(seller),em=String(sellerEmail||'').toLowerCase(),pm=norm(product);
  const matches=rules(doc).filter(r=>{
    const re=String(r.sellerEmail||'*').toLowerCase(),rs=norm(r.seller||'*'),rp=norm(r.product||'*');
    return (!r.validFrom||date>=r.validFrom)&&(!r.validTo||date<=r.validTo)&&
      (re==='*'||(em&&re===em))&&(rs==='*'||rs===sm)&&(rp==='*'||!pm||rp===pm);
  });
  return matches.sort((a,b)=>num(b.version)-num(a.version))[0]||DEFAULT_RULE;
}
function paidRatio(fields){
  const f=fields||{},total=Math.max(0,num(f['Monto total (CLP)']||f['Total final (CLP)']));
  const paid=num(f['Monto pagado (CLP)']||f['Pago recibido (CLP)'])+
    (f['Anticipo pagado (50%)']===true?total*.5:0)+(f['Saldo pagado (50%)']===true?total*.5:0);
  const state=norm(f['Estado pago']||f['Estado de pago']||'');
  if(/pagad|total|complet/.test(state))return 1;
  return total>0?Math.max(0,Math.min(1,paid/total)):0;
}
function isReversed(fields){
  const x=norm([fields?.['Estado pedido'],fields?.['Estado DTE'],fields?.['Tipo DTE'],fields?.['Estado pago']].join(' '));
  return /cancel|anulad|revers|devol|nota de credito|nota crédito/.test(x);
}
function hasInvoice(fields){
  const f=fields||{};
  return !!(f['DTE N°']||f['N° Factura']||f['Factura N°']||/emitid|aceptad/.test(norm(f['Estado DTE']||'')));
}
function authoritativeEvent(orderId,doc=shared){
  const list=Array.isArray(doc?.events)?doc.events:[];
  const candidates=list.filter(e=>String(e.sourceId||'')===String(orderId||''));
  return candidates.sort((a,b)=>String(b.updatedAt||b.eventAt||'').localeCompare(String(a.updatedAt||a.eventAt||'')))[0]||null;
}
function deriveOrder(order,doc=shared){
  const f=order?.fields||{},date=String(f['Fecha entrega']||f['Fecha despacho']||'').slice(0,10);
  const seller=sellerOf(f),sellerEmail=sellerEmailFrom(f);
  const auth=authoritativeEvent(order?.id,doc);
  if(auth&&STATUS.includes(auth.status))return {...auth,authoritative:true,record:order};
  const rule=resolveRule({seller,sellerEmail,date:date||todayKey(),product:String(f['Detalle productos']||'')},doc);
  const base=taxNet(f);
  const ratio=paidRatio(f),invoiced=hasInvoice(f),reversed=isReversed(f);
  let eligibleBase=base.amount;
  if(rule.basis==='net_paid')eligibleBase=Math.round(base.amount*ratio);
  if(rule.basis==='net_invoiced'&&!invoiced)eligibleBase=0;
  let status='estimated';
  if(reversed)status='reversed';
  else if(base.verified&&invoiced&&(rule.basis!=='net_paid'||ratio>0))status='accrued';
  const explicitReverse=num(f['Monto nota crédito neto (CLP)']||f['Monto nota credito neto (CLP)']||
    f['Monto devolución neto (CLP)']||f['Monto devolucion neto (CLP)']||f['Monto reversado neto (CLP)']);
  const eligible=status==='reversed'?-Math.min(base.amount,explicitReverse>0?explicitReverse:base.amount):eligibleBase;
  return {
    id:'live:'+String(order?.id||''),sourceId:String(order?.id||''),order:String(f['N° Pedido']||''),
    seller,sellerEmail,period:(date||todayKey()).slice(0,7),date,eligibleNet:eligible,
    commission:Math.round(eligible*num(rule.rate)),status,ruleId:rule.id,ruleVersion:rule.version,
    ruleRate:num(rule.rate),basis:base.source,verifiedBase:base.verified,paymentRatio:ratio,
    authoritative:false,record:order
  };
}
function summary(events){
  const out={estimated:0,accrued:0,approved:0,paid:0,reversed:0,net:0};
  for(const e of events||[]){if(STATUS.includes(e.status))out[e.status]+=num(e.commission);}
  out.net=out.estimated+out.accrued+out.approved+out.paid+out.reversed;return out;
}
function quoteWeight(fields,now=todayKey()){
  const f=fields||{},due=String(f['Fecha vencimiento']||'').slice(0,10);
  if(due&&due<now)return 0;
  const st=norm(f['Estado cotización']||'');
  if(st==='solicitada')return .35;
  if(st==='enviada')return .65;
  if(/aprobad/.test(st))return .9;
  return 0;
}
function projectQuote(q,doc=shared,now=todayKey()){
  const f=q?.fields||{},weight=quoteWeight(f,now),rule=resolveRule({seller:sellerOf(f),sellerEmail:sellerEmailFrom(f),date:now,product:String(f['Detalle productos']||'')},doc);
  const base=taxNet(f,'Total final (CLP)');
  const gross=num(f['Total final (CLP)']);
  const estimatedBase=base.verified?base.amount:gross;
  return {id:q?.id,weight,expired:weight===0&&!!f['Fecha vencimiento']&&String(f['Fecha vencimiento']).slice(0,10)<now,
    base:estimatedBase,commission:Math.round(estimatedBase*num(rule.rate)*weight),rule};
}
function csvCell(v){
  let s=String(v??'');
  if(/^[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function csvExport(rows,meta={}){
  const head=['Período','Vendedor','Pedido','Fecha','Estado','Base elegible','Comisión','Regla','Versión','Tasa','Base tributaria','Generado'];
  const generated=meta.generatedAt||new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,dateStyle:'short',timeStyle:'medium'}).format(new Date());
  const body=(rows||[]).map(r=>[
    r.period||meta.period||'',r.seller||meta.seller||'',r.order||'',r.date||'',r.status||'',
    Math.round(num(r.eligibleNet)),Math.round(num(r.commission)),r.ruleId||'',r.ruleVersion||'',num(r.ruleRate),
    r.basis||'',generated
  ]);
  return '\uFEFF'+[head,...body].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
function currentUser(){try{return target?.AUTH?.getUser?.()||null;}catch(_){return null;}}
function own(record){
  try{return typeof target?._remOwnsRecord==='function'?target._remOwnsRecord(record):typeof target?.vendorOwnsRecord==='function'?target.vendorOwnsRecord(record):true;}
  catch(_){return false;}
}
function proxyConfig(){
  try{
    const c=target?._proxyCfg?.();if(!c?.url||!c?.key)return null;
    const u=new URL(c.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
    if(u.protocol==='http:'&&!['127.0.0.1','localhost'].includes(u.hostname))return null;
    return {base:u.origin+u.pathname.replace(/\/$/,''),key:c.key};
  }catch(_){return null;}
}
async function request(path,method='GET',body){
  const c=proxyConfig();if(!c)throw new Error('proxy unavailable');
  return fetch(c.base+path,{method,credentials:'include',redirect:'error',
    headers:{'X-App-Key':c.key,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
}
async function hydrate(){
  if(hydrating)return hydrating;
  const u=currentUser();if(target?._DEMO_MODE||!u||!['comercial','finanzas','admin','gerencia'].includes(u.role)||!proxyConfig())return false;
  hydrating=(async()=>{
    const r=await request('/shared/remunerations');if(!r.ok)return false;
    const d=await r.json().catch(()=>null);if(!d?.ok||d.data?.version!==2)return false;
    shared=d.data;return true;
  })().catch(()=>false).finally(()=>{hydrating=null;});
  return hydrating;
}
function selectedOrders(){
  const b=bounds(),all=Array.isArray(target?.state?.pedidos)?target.state.pedidos:[];
  return all.filter(own).filter(r=>['Despachado','Completado'].includes(r?.fields?.['Estado pedido']||''))
    .filter(r=>inBounds(String(r?.fields?.['Fecha entrega']||'').slice(0,10),b));
}
function activeQuotes(){
  const all=Array.isArray(target?.state?.cotizaciones)?target.state.cotizaciones:[];
  return all.filter(own).filter(q=>['Solicitada','Enviada','Aprobada'].includes(q?.fields?.['Estado cotización']||''));
}
function statusLabel(s){return ({estimated:'Estimada',accrued:'Devengada',approved:'Aprobada',paid:'Pagada',reversed:'Revertida'})[s]||s;}
function renderLiquidacion(events){
  const box=target?.document?.getElementById('remLiqBody');if(!box)return;
  const sum=summary(events),u=currentUser(),seller=u?.name||u?.email||'equipo';
  const bases=(shared?.baseSalaries||[]).filter(x=>u?.role!=='sales'||String(x.sellerEmail||'').toLowerCase()===String(u.email||'').toLowerCase());
  box.innerHTML=`<div style="font-size:10.5px;color:var(--text3);margin-bottom:8px">Resumen comercial auditable · no constituye una liquidación legal de remuneraciones.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:7px">
    ${[['Estimada',sum.estimated],['Devengada',sum.accrued],['Aprobada',sum.approved],['Pagada',sum.paid],['Revertida',sum.reversed]].map(([k,v])=>`<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:9px"><div style="font-size:9px;color:var(--text3)">${k}</div><b>${money(v)}</b></div>`).join('')}
  </div>${bases.length?`<div style="margin-top:8px;font-size:10px;color:var(--text3)">Sueldos base vigentes registrados: ${bases.map(x=>esc(x.seller||seller)+' '+money(x.amount)).join(' · ')}</div>`:''}`;
}
function render(){
  if(!target)return;
  const tbody=target.document.getElementById('remTableBody'),kpis=target.document.getElementById('remKpis');
  if(!tbody||!kpis)return;
  const orders=selectedOrders(),events=orders.map(o=>deriveOrder(o,shared)),sum=summary(events);
  const quotes=activeQuotes(),proj=quotes.map(q=>projectQuote(q,shared)),eligible=proj.filter(x=>x.weight>0);
  const pipeline=eligible.reduce((s,x)=>s+x.commission,0),verifiedNet=events.reduce((s,e)=>s+(e.verifiedBase?Math.max(0,num(e.eligibleNet)):0),0);
  const frozen=events.some(e=>e.authoritative);
  kpis.innerHTML=`
    <div class="kpi-card green"><div class="kpi-label">Pedidos del período</div><div class="kpi-value">${orders.length}</div><div class="kpi-sub">${bounds().label}</div></div>
    <div class="kpi-card yellow"><div class="kpi-label">Base tributaria verificada</div><div class="kpi-value" style="font-size:18px">${money(verifiedNet)}</div><div class="kpi-sub">sin dividir bruto por IVA fijo</div></div>
    <div class="kpi-card"><div class="kpi-label" style="color:var(--accent)">Devengada + aprobada</div><div class="kpi-value" style="color:var(--accent);font-size:18px">${money(sum.accrued+sum.approved)}</div><div class="kpi-sub">${frozen?'incluye eventos congelados':'borrador desde CRM'}</div></div>
    <div class="kpi-card"><div class="kpi-label" style="color:#a78bfa">Pipeline ponderado</div><div class="kpi-value" style="color:#a78bfa;font-size:18px">${money(pipeline)}</div><div class="kpi-sub">${eligible.length} vigentes · vencidas sin potencial pleno</div></div>
    <div class="kpi-card"><div class="kpi-label" style="color:#fb923c">Pagada</div><div class="kpi-value" style="color:#fb923c;font-size:18px">${money(sum.paid)}</div><div class="kpi-sub">reversas: ${money(sum.reversed)}</div></div>`;
  const badge=target.document.getElementById('remBadge');if(badge)badge.textContent=orders.length+' pedido'+(orders.length===1?'':'s');
  const pipeBadge=target.document.getElementById('remPipeBadge');if(pipeBadge)pipeBadge.textContent=eligible.length+' vigente'+(eligible.length===1?'':'s');
  renderLiquidacion(events);
  tbody.innerHTML=events.length?events.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(e=>`<tr>
    <td class="mono">${esc(e.order||'—')}</td><td class="text-small">${esc(target.resolveClienteName?.(e.record?.fields?.Cliente)||'—')}</td>
    <td style="font-family:'JetBrains Mono',monospace;font-size:11px">${esc(e.date||'—')}</td>
    <td class="clp">${money(e.record?.fields?.['Monto total (CLP)']||0)}</td><td class="clp">${e.verifiedBase?money(e.eligibleNet):'Sin base tributaria'}</td>
    <td class="clp" style="font-weight:700">${money(e.commission)} <span style="font-size:9px;color:var(--text3)">${statusLabel(e.status)}</span></td></tr>`).join(''):
    '<tr><td colspan="6"><div class="empty-state">Sin comisiones en este período</div></td></tr>';
  const pb=target.document.getElementById('remPipeBody');
  if(pb)pb.innerHTML=eligible.length?eligible.map(x=>{const q=quotes.find(q=>q.id===x.id),f=q?.fields||{};return `<tr>
    <td class="mono">${esc(f['N° Cotización']||'—')}</td><td class="text-small">${esc(target.resolveClienteName?.(f.Cliente)||'—')}</td>
    <td class="clp">${money(x.base)}</td><td class="clp" style="color:#a78bfa;font-weight:700">${money(x.commission)}</td>
    <td>${esc(f['Estado cotización']||'—')} · ${Math.round(x.weight*100)}%</td><td>${esc(f['Fecha vencimiento']||'—')}</td></tr>`;}).join(''):
    '<tr><td colspan="6"><div class="empty-state" style="padding:20px">Sin pipeline vigente</div></td></tr>';
}
function setPeriod(p,btn){
  if(!['todo','anio','semana','mes','anterior'].includes(p))return;
  period=p;
  target?.document?.querySelectorAll('#remPeriodoBar .btn').forEach(b=>b.classList.remove('active-filter'));
  btn?.classList?.add('active-filter');render();
}
async function exportCsv(){
  const events=selectedOrders().map(o=>deriveOrder(o,shared)),u=currentUser(),b=bounds();
  const csv=csvExport(events,{period:b.label,seller:u?.username||u?.email||u?.name||''});
  try{request('/shared/remunerations/audit','POST',{action:'export',period:b.label,count:events.length}).catch(()=>{});}catch(_){}
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=target.document.createElement('a');
  a.href=url;a.download='remuneraciones-'+String(b.label).replace(/[^0-9A-Za-z_-]+/g,'-')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function install(root){
  if(!root||installed)return;target=root;installed=true;
  root.setRemPeriodo=setPeriod;root.renderRemuneraciones=render;root.exportRemCSV=exportCsv;root.remRenderLiquidacion=()=>renderLiquidacion(selectedOrders().map(o=>deriveOrder(o,shared)));
  Promise.resolve().then(async()=>{await hydrate();render();});
}
return {TZ,DEFAULT_RULE,STATUS,tzParts,todayKey,monthKey,mondayKey,bounds,inBounds,taxNet,resolveRule,paidRatio,isReversed,
  hasInvoice,deriveOrder,summary,quoteWeight,projectQuote,csvCell,csvExport,install,hydrate,render,get shared(){return shared;}};
});