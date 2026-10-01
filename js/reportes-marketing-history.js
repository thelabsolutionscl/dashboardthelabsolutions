/* Read-only, role-gated, paginated marketing expense audit. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&root.document){root.ReportesSpendHistory=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';
const error=(code,message)=>Object.assign(new Error(message),{code});
function validatePage(body,month,before){
  if(!body||body.month!==month||!Array.isArray(body.events)||
     !Number.isSafeInteger(body.latest_revision)||body.latest_revision<0||
     typeof body.has_more!=='boolean')
    throw error('integrity','Respuesta de auditoría inválida.');
  let prior=before===null?Infinity:before;
  for(const e of body.events){
    if(!e||e.month!==month||!Number.isSafeInteger(e.revision)||
      e.revision<1||e.revision>=prior||e.revision>body.latest_revision)
      throw error('integrity','Revisiones duplicadas o fuera de orden.');
    prior=e.revision;
  }
  if(body.has_more){
    if(!body.events.length||!Number.isSafeInteger(body.next_before_revision)||
      body.next_before_revision!==prior)
      throw error('integrity','El cursor de auditoría es inconsistente.');
  }else if(body.next_before_revision!==null){
    throw error('integrity','Se recibió un cursor inesperado.');
  }
  return body;
}
function createPager(fetchPage,onChange=()=>{}){
  let generation=0;
  let state={month:null,events:[],loaded:false,loading:false,hasMore:true,
    cursor:null,latestRevision:null,newerAvailable:false,error:'',errorCode:''};
  const snapshot=()=>({...state,events:state.events.slice()});
  const emit=()=>onChange(snapshot());
  function reset(month){
    generation++;
    state={month,events:[],loaded:false,loading:false,hasMore:true,
      cursor:null,latestRevision:null,newerAvailable:false,error:'',errorCode:''};
    emit();
  }
  async function loadMore(){
    if(!state.month||state.loading||(state.loaded&&!state.hasMore))return false;
    const gen=generation,month=state.month,before=state.loaded?state.cursor:null;
    state.loading=true;state.error='';state.errorCode='';emit();
    try{
      const body=validatePage(await fetchPage(month,before),month,before);
      if(gen!==generation)return false;
      const seen=new Set(state.events.map(e=>e.revision));
      if(body.events.some(e=>seen.has(e.revision)))
        throw error('integrity','La siguiente página contiene revisiones duplicadas.');
      if(state.latestRevision!==null&&body.latest_revision<state.latestRevision)
        throw error('integrity','La revisión del historial retrocedió inesperadamente.');
      state.newerAvailable=state.newerAvailable||
        (state.latestRevision!==null&&body.latest_revision>state.latestRevision);
      if(state.latestRevision===null)state.latestRevision=body.latest_revision;
      state.events=[...state.events,...body.events];
      state.cursor=body.next_before_revision;state.hasMore=body.has_more;
      state.loaded=true;
      return true;
    }catch(e){
      if(gen!==generation)return false;
      state.error=e?.message||'No fue posible consultar el historial.';
      state.errorCode=e?.code||'network';return false;
    }finally{if(gen===generation){state.loading=false;emit();}}
  }
  async function refresh(){const month=state.month;reset(month);return loadMore();}
  return{reset,loadMore,refresh,snapshot};
}
function realFetch(root){
  return async(month,before)=>{
    const cfg=typeof root._proxyCfg==='function'?root._proxyCfg():null;
    if(!cfg?.key||!cfg?.url||
       String(cfg.url).replace(/\/+$/,'')!=='https://proxy.thelab.solutions')
      throw error('setup','Pendiente: dominio seguro del proxy y Cloudflare Access.');
    const url=new URL(cfg.url.replace(/\/+$/,'')+'/marketing/spend/history');
    url.searchParams.set('month',month);
    if(before!==null)url.searchParams.set('before_revision',String(before));
    const res=await root.fetch(url.href,{method:'GET',credentials:'include',redirect:'manual',
      headers:{'X-App-Key':cfg.key,Accept:'application/json'}});
    if([301,302,303,307,308].includes(res.status))
      throw error('login','Inicia sesión mediante Cloudflare Access.');
    if(res.status===401||res.status===403)
      throw error('denied','Sin sesión de finanzas autorizada para consultar el historial.');
    let body;try{body=await res.json();}
    catch(_){throw error('network','El proxy no entregó un historial válido.');}
    if(!res.ok){
      if(res.status===503&&/integrity/i.test(String(body?.error||'')))
        throw error('integrity','Faltan registros de auditoría: no se puede declarar completo el historial.');
      if(res.status===503)
        throw error('setup','Gasto compartido pendiente de Cloudflare Access o de la configuración del proxy.');
      throw error('network','No se pudo leer el historial (HTTP '+res.status+').');
    }
    return body;
  };
}
function install(root){
  if(!root?.document||root.__reportesSpendHistoryInstalled)return false;
  root.__reportesSpendHistoryInstalled=true;
  const document=root.document,pager=createPager(realFetch(root),draw);
  let anchor=null,observer=null,expanded=false,month=null,pending=false;
  function allowed(){
    const auth=root.AUTH||(typeof AUTH!=='undefined'?AUTH:null);
    const role=auth?.getUser?.()?.role;
    return role==='finance'||role==='admin';
  }
  function selectedMonth(card){
    const off=Number.parseInt(card.dataset.off||'0',10)||0;
    if(typeof root._mesRango==='function')return root._mesRango(off).key;
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+off);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }
  function node(tag,value,cls){
    const n=document.createElement(tag);
    if(value!==undefined)n.textContent=String(value);
    if(cls)n.className=cls;return n;
  }
  function button(label,fn,disabled){
    const n=node('button',label,'rh-button');
    n.type='button';n.disabled=!!disabled;n.addEventListener('click',fn);return n;
  }
  function style(){
    if(document.getElementById('reportesSpendHistoryStyle'))return;
    const n=node('style');n.id='reportesSpendHistoryStyle';
    n.textContent=[
      '#reportesSpendHistoryPanel{margin:12px 0 0;padding:14px 16px;background:var(--surface2,#181818);border:1px solid var(--border,#333);border-radius:12px;color:var(--text,#eee)}',
      '#reportesSpendHistoryPanel .rh-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '#reportesSpendHistoryPanel h3{font-size:13px;font-weight:800}',
      '#reportesSpendHistoryPanel .rh-sub{color:var(--text3,#aaa);font-size:11px;margin-top:6px;line-height:1.5}',
      '#reportesSpendHistoryPanel .rh-actions,#reportesSpendHistoryPanel .rh-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '#reportesSpendHistoryPanel .rh-button{padding:8px 12px;border:1px solid var(--accent,#00d4cc);background:transparent;color:var(--text,#eee);border-radius:8px;cursor:pointer;font-size:11px}',
      '#reportesSpendHistoryPanel .rh-button:disabled{opacity:.5;cursor:wait}',
      '#reportesSpendHistoryPanel .rh-error{color:var(--danger,#f77);font-size:11px;margin-top:10px}',
      '#reportesSpendHistoryPanel .rh-warning{color:var(--warn,#fbbf24);font-size:11px;margin-top:10px}',
      '#reportesSpendHistoryPanel .rh-scroll{max-height:390px;overflow:auto;margin:10px 0}',
      '#reportesSpendHistoryPanel table{width:100%;border-collapse:collapse;font-size:11px;min-width:600px}',
      '#reportesSpendHistoryPanel th,#reportesSpendHistoryPanel td{padding:8px 9px;border-bottom:1px solid var(--border,#333);text-align:left}',
      '#reportesSpendHistoryPanel th{position:sticky;top:0;background:var(--surface2,#181818);z-index:1}'
    ].join('');document.head.appendChild(n);
  }
  function draw(){
    if(!anchor||!anchor.isConnected)return;
    const panel=anchor.querySelector('#reportesSpendHistoryPanel');if(!panel)return;
    panel.replaceChildren();const s=pager.snapshot();
    const head=node('div',undefined,'rh-head'),title=node('div'),actions=node('div',undefined,'rh-actions');
    title.append(node('h3','Historial de cambios · gasto compartido'),node('p',s.month||'Selecciona el mes','rh-sub'));
    if(!expanded)actions.appendChild(button('Ver historial',()=>{
      expanded=true;draw();void pager.loadMore();
    },!allowed()));
    else{
      actions.append(button('Actualizar',()=>{void pager.refresh();},s.loading||!allowed()),
        button('Ocultar',()=>{expanded=false;draw();}));
    }
    head.append(title,actions);panel.appendChild(head);
    if(!allowed()){
      panel.appendChild(node('p','Solo finanzas y administración con sesión individual.','rh-sub'));return;
    }
    if(!expanded)return;
    panel.appendChild(node('p','Consulta sin escrituras; los cambios se realizan en el editor de gastos.','rh-sub'));
    if(s.newerAvailable)panel.appendChild(node('p','Hay movimientos posteriores a esta consulta. Pulsa Actualizar.','rh-warning'));
    if(s.error)panel.appendChild(node('p',s.error,'rh-error'));
    if(s.loaded&&!s.events.length)panel.appendChild(node('p','Sin movimientos registrados este mes.','rh-sub'));
    if(s.events.length){
      const wrap=node('div',undefined,'rh-scroll'),table=node('table'),thead=node('thead'),tr=node('tr'),tbody=node('tbody');
      for(const text of ['Fecha','Canal','Antes','Después','Usuario','Revisión'])tr.appendChild(node('th',text));
      thead.appendChild(tr);table.appendChild(thead);
      const money=v=>Number(v).toLocaleString('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0});
      for(const item of s.events){
        const row=node('tr');
        let date='Sin fecha';
        if(item.at&&!Number.isNaN(Date.parse(item.at)))date=new Date(item.at).toLocaleString('es-CL');
        for(const value of [date,item.channel||'—',money(item.before_clp),money(item.after_clp),
          item.actor_email||'Sin usuario',item.revision])row.appendChild(node('td',value));
        tbody.appendChild(row);
      }
      table.appendChild(tbody);wrap.appendChild(table);panel.appendChild(wrap);
    }
    const foot=node('div',undefined,'rh-foot');
    if(s.loaded)foot.appendChild(node('span',s.events.length+' movimientos consultados'+
      (s.hasMore?' · hay más':' · fin del historial'),'rh-sub'));
    if(s.hasMore)foot.appendChild(button(s.loaded?'Cargar anteriores':'Consultar movimientos',
      ()=>{void pager.loadMore();},s.loading));
    if(s.loading)foot.appendChild(node('span','Consultando…','rh-sub'));
    panel.appendChild(foot);
  }
  function mount(){
    const card=document.getElementById('cacCanalCard');if(!card)return;
    if(card!==anchor){
      observer?.disconnect();anchor=card;
      observer=new root.MutationObserver(changes=>{
        if(changes.some(c=>c.target===anchor))scheduleMount();
      });
      observer.observe(anchor,{childList:true,attributes:true,attributeFilter:['data-off']});
    }
    const next=selectedMonth(card);
    if(month!==next){month=next;pager.reset(month);if(expanded&&allowed())void pager.loadMore();}
    if(!card.querySelector('#reportesSpendHistoryPanel')){
      const panel=node('section');panel.id='reportesSpendHistoryPanel';
      panel.setAttribute('aria-label','Historial de gastos compartidos');card.appendChild(panel);
    }
    draw();
  }
  function scheduleMount(){
    if(pending)return;pending=true;
    root.queueMicrotask(()=>{pending=false;mount();});
  }
  function start(){
    style();mount();
    if(!anchor){
      const watch=new root.MutationObserver(()=>{
        if(document.getElementById('cacCanalCard')){watch.disconnect();mount();}
      });
      watch.observe(document.body,{childList:true,subtree:true});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
  return true;
}
return{install,createPager,validatePage,_test:{realFetch}};
});
