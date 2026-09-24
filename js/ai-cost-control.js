/* js/ai-cost-control.js
 * Panel de control de gasto Anthropic en AGENTES.
 * Lee el presupuesto diario del proxy (KV) y el usage local de la sesión.
 * No ejecuta modelos ni agrega consumo de tokens.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root){root.AICostControl=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

let target=null,installed=false,timer=null,busy=false;

function money(v){
  const n=Math.max(0,Number(v)||0);
  return 'US$'+n.toLocaleString('es-CL',{minimumFractionDigits:3,maximumFractionDigits:3});
}
function localRows(){
  try{
    const rows=JSON.parse(target?.sessionStorage?.getItem('claude_usage_v1')||'[]');
    return Array.isArray(rows)?rows:[];
  }catch(_){return[];}
}
function localSummary(){
  const rows=localRows();
  const out={requests:rows.length,tokens:0,cost:0,bySource:{}};
  for(const r of rows){
    const src=String(r.source||'agentes');
    const tok=Math.max(0,Number(r.total_tokens)||(
      (Number(r.input_tokens)||0)+(Number(r.output_tokens)||0)+
      (Number(r.cache_creation_input_tokens)||0)+(Number(r.cache_read_input_tokens)||0)
    ));
    const cost=Math.max(0,Number(r.cost_usd)||0);
    out.tokens+=tok;out.cost+=cost;
    const s=out.bySource[src]||(out.bySource[src]={requests:0,tokens:0,cost:0});
    s.requests++;s.tokens+=tok;s.cost+=cost;
  }
  return out;
}
function esc(s){
  return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function proxyCfg(){
  try{return typeof target?._proxyCfg==='function'?target._proxyCfg():null;}catch(_){return null;}
}
async function fetchDaily(){
  const px=proxyCfg();if(!px?.url||!px?.key)return null;
  const r=await target.fetch(px.url.replace(/\/$/,'')+'/anthropic/usage',{
    method:'GET',headers:{'X-App-Key':px.key,'Accept':'application/json'}
  });
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}
function ensureStyle(){
  const d=target?.document;if(!d||d.getElementById('aiCostControlStyle'))return;
  const s=d.createElement('style');s.id='aiCostControlStyle';
  s.textContent=`
  #aiCostControlCard{margin:0 0 16px;padding:16px 18px;border:1px solid rgba(0,212,204,.22);border-radius:14px;background:linear-gradient(135deg,rgba(0,212,204,.055),rgba(255,255,255,.012));box-shadow:0 12px 28px rgba(0,0,0,.12)}
  .ai-cost-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:13px}
  .ai-cost-eyebrow{font-size:9px;letter-spacing:.13em;font-weight:800;color:var(--accent);margin-bottom:4px}
  .ai-cost-title{font-size:17px;font-weight:800;color:var(--text)}
  .ai-cost-sub{font-size:10px;color:var(--text3);margin-top:3px}
  .ai-cost-refresh{border:1px solid var(--border);background:var(--surface2);color:var(--text2);border-radius:8px;padding:7px 10px;font-size:10px;font-weight:700;cursor:pointer}
  .ai-cost-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
  .ai-cost-kpi{padding:10px 11px;border:1px solid var(--border);border-radius:10px;background:rgba(0,0,0,.16);min-width:0}
  .ai-cost-kpi span{display:block;font-size:8px;font-weight:800;letter-spacing:.08em;color:var(--text3);text-transform:uppercase}
  .ai-cost-kpi strong{display:block;margin-top:4px;font-size:15px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ai-cost-kpi.good strong{color:var(--accent)} .ai-cost-kpi.warn strong{color:#ffb020}.ai-cost-kpi.bad strong{color:#ff5867}
  .ai-cost-bar{height:7px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden;margin:12px 0 9px}
  .ai-cost-bar>i{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width .2s}
  .ai-cost-sources{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .ai-cost-chip{font-size:9px;color:var(--text2);padding:5px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.02)}
  .ai-cost-policy{margin-top:10px;padding-top:9px;border-top:1px solid var(--border);font-size:9.5px;color:var(--text3);display:flex;gap:10px;flex-wrap:wrap}
  @media(max-width:900px){.ai-cost-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-cost-grid .ai-cost-kpi:last-child{grid-column:1/-1}}
  `;
  (d.head||d.documentElement).appendChild(s);
}
function mount(){
  const d=target?.document,tab=d?.getElementById('tab-agentes');if(!tab)return null;
  let card=d.getElementById('aiCostControlCard');
  if(!card){
    card=d.createElement('section');card.id='aiCostControlCard';
    const grid=d.getElementById('agentesGrid');
    if(grid&&grid.parentNode===tab)tab.insertBefore(card,grid);
    else tab.insertBefore(card,tab.firstChild);
  }
  return card;
}
function sourceHtml(server,local){
  const src={};
  if(server?.by_source)for(const [k,v] of Object.entries(server.by_source)){
    src[k]={requests:Number(v.requests)||0,cost:(Number(v.spent_usd)||0)+(Number(v.reserved_usd)||0)};
  }
  if(!Object.keys(src).length&&local?.bySource)for(const [k,v] of Object.entries(local.bySource)){
    src[k]={requests:v.requests||0,cost:v.cost||0};
  }
  return Object.entries(src).sort((a,b)=>b[1].cost-a[1].cost).slice(0,10)
    .map(([k,v])=>`<span class="ai-cost-chip">${esc(k)} · ${v.requests} · ${money(v.cost)}</span>`).join('');
}
function paint(server,error){
  const card=mount();if(!card)return;
  const local=localSummary();
  const budget=Number(server?.budget_usd)||0;
  const used=Number(server?.used_usd)||0;
  const remaining=server?Math.max(0,Number(server.remaining_usd)||0):0;
  const pct=budget?Math.min(100,Math.round(used/budget*100)):0;
  const cls=pct>=90?'bad':pct>=70?'warn':'good';
  card.innerHTML=`
    <div class="ai-cost-head">
      <div><div class="ai-cost-eyebrow">CONTROL DE CONSUMO IA</div>
      <div class="ai-cost-title">Presupuesto y tokens de agentes</div>
      <div class="ai-cost-sub">${server?.configured?'Control server-side activo · día Chile':error?'Proxy sin lectura de presupuesto: '+esc(error):'Sin proxy: mostrando sólo esta sesión'}</div></div>
      <button class="ai-cost-refresh" type="button" onclick="AICostControl.refresh(true)">↻ Actualizar</button>
    </div>
    <div class="ai-cost-grid">
      <div class="ai-cost-kpi ${cls}"><span>Hoy</span><strong>${server?money(used):money(local.cost)}</strong></div>
      <div class="ai-cost-kpi good"><span>Presupuesto diario</span><strong>${server?money(budget):'—'}</strong></div>
      <div class="ai-cost-kpi ${cls}"><span>Disponible</span><strong>${server?money(remaining):'—'}</strong></div>
      <div class="ai-cost-kpi"><span>Solicitudes hoy</span><strong>${server?Number(server.requests||0).toLocaleString('es-CL'):local.requests}</strong></div>
      <div class="ai-cost-kpi"><span>Tokens esta sesión</span><strong>${Math.round(local.tokens).toLocaleString('es-CL')}</strong></div>
    </div>
    ${server?`<div class="ai-cost-bar" title="${pct}% del presupuesto diario"><i style="width:${pct}%"></i></div>`:''}
    <div class="ai-cost-sources">${sourceHtml(server,local)||'<span class="ai-cost-chip">Sin consumo registrado todavía</span>'}</div>
    <div class="ai-cost-policy">
      <span>Haiku por defecto</span><span>Sonnet sólo para análisis complejo</span>
      <span>KAI: máx. 2 rondas</span><span>1 delegación por turno</span>
      <span>Prompts estáticos con caché</span><span>Contexto dinámico limitado</span>
    </div>`;
}
async function refresh(force){
  if(busy)return;busy=true;
  try{const server=await fetchDaily();paint(server,null);}
  catch(e){paint(null,e?.message||String(e));}
  finally{busy=false;}
}
function install(root){
  if(installed||!root?.document)return false;installed=true;target=root;
  const start=()=>{ensureStyle();mount();refresh(false);timer=root.setInterval(()=>refresh(false),120000);};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  return true;
}
function status(){return{installed,busy,local:localSummary()};}
return{install,refresh,status,_test:{localSummary,money,sourceHtml}};
});
