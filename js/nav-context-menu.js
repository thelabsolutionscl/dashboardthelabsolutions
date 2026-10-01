/* js/nav-context-menu.js
 * Personalización contextual de la navegación.
 * Click derecho sobre un menú: abrir, nueva pestaña/ventana, mover u ocultar.
 * El layout se guarda solo en este navegador y no altera RBAC ni el contenido.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root&&root.document){root.TLSNavContext=api;api.install(root);}
})(typeof window!=='undefined'?window:null,function(){
'use strict';

const STATE_KEY='thelab_nav_layout_v1';
const TAB_PARAM='tlsTab';
const NAV_SELECTOR='.dock-btn[data-tab],.mbd-btn[data-tab],.mg-item[data-tab]';
const DOCK_SELECTOR='.icon-dock,.mobile-bottom-dock,.mobile-grid-sheet';

function uniq(values){
  const out=[],seen=new Set();
  for(const raw of values||[]){
    const v=String(raw||'').trim();
    if(v&&!seen.has(v)){seen.add(v);out.push(v);}
  }
  return out;
}
function normalizeState(raw){
  const src=raw&&typeof raw==='object'?raw:{};
  return{order:uniq(src.order),hidden:uniq(src.hidden)};
}
function mergeOrder(saved,available){
  const all=uniq(available),set=new Set(all);
  return uniq([...(saved||[]).filter(x=>set.has(x)),...all]);
}
function moveTab(order,tab,delta){
  const out=uniq(order),i=out.indexOf(tab);
  if(i<0||!delta)return out;
  const j=Math.max(0,Math.min(out.length-1,i+delta));
  if(j===i)return out;
  out.splice(i,1);out.splice(j,0,tab);return out;
}
function tabUrl(href,tab){
  const u=new URL(href);
  u.searchParams.set(TAB_PARAM,String(tab||''));
  return u.toString();
}
function isDesktopApp(win){
  try{
    const u=new URL(win.location.href);
    if(u.searchParams.get('desktop')==='macos')return true;
  }catch(_){}
  try{if(/tauri|the lab crm/i.test(String(win.navigator?.userAgent||'')))return true;}catch(_){}
  return false;
}
function labelFor(el){
  if(!el)return'';
  const label=el.querySelector?.('.dock-label,.mbd-label,.mg-label')?.textContent?.trim();
  return label||el.getAttribute?.('aria-label')||el.getAttribute?.('title')||el.dataset?.tab||'Menú';
}

function install(win){
  if(!win||!win.document||win.__TLS_NAV_CONTEXT_INSTALLED__)return false;
  win.__TLS_NAV_CONTEXT_INSTALLED__=true;
  const doc=win.document;
  let baseOrder=[],menu=null,applying=false,observerTimer=null;

  function read(){
    try{return normalizeState(JSON.parse(win.localStorage.getItem(STATE_KEY)||'{}'));}catch(_){return normalizeState({});}
  }
  function write(state){
    try{win.localStorage.setItem(STATE_KEY,JSON.stringify(normalizeState(state)));}catch(_){}
  }
  function availableTabs(){
    return uniq(Array.from(doc.querySelectorAll(NAV_SELECTOR)).map(el=>el.dataset.tab));
  }
  function ensureBase(){
    if(baseOrder.length)return baseOrder;
    const desktop=Array.from(doc.querySelectorAll('.icon-dock-inner .dock-btn[data-tab]')).map(el=>el.dataset.tab);
    baseOrder=uniq(desktop.length?desktop:availableTabs());
    return baseOrder;
  }
  function effectiveOrder(state=read()){
    return mergeOrder(state.order,uniq([...ensureBase(),...availableTabs()]));
  }
  function applyLayout(){
    if(applying)return;
    applying=true;
    try{
      const state=read(),hidden=new Set(state.hidden),order=effectiveOrder(state),rank=new Map(order.map((t,i)=>[t,i]));
      const groups=new Map();
      doc.querySelectorAll(NAV_SELECTOR).forEach(el=>{
        el.classList.toggle('tls-nav-hidden',hidden.has(el.dataset.tab));
        const p=el.parentElement;if(!p)return;
        if(!groups.has(p))groups.set(p,[]);
        groups.get(p).push(el);
      });
      groups.forEach((items,parent)=>{
        items.sort((a,b)=>(rank.get(a.dataset.tab)??9999)-(rank.get(b.dataset.tab)??9999));
        items.forEach(el=>parent.appendChild(el));
      });
    }finally{applying=false;}
  }
  function notice(msg){
    try{if(typeof win.toast==='function')win.toast(msg,'info');else console.info('[Menú]',msg);}catch(_){}
  }
  function hideMenu(){if(menu){menu.remove();menu=null;}}
  function addItem(box,label,run,opts={}){
    const b=doc.createElement('button');b.type='button';b.className='tls-nav-ctx-item'+(opts.danger?' is-danger':'');
    if(opts.disabled)b.disabled=true;
    const icon=doc.createElement('span');icon.className='tls-nav-ctx-icon';icon.textContent=opts.icon||'';
    const txt=doc.createElement('span');txt.textContent=label;
    b.append(icon,txt);
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();hideMenu();if(!opts.disabled)run?.();});
    box.appendChild(b);return b;
  }
  function sep(box){const d=doc.createElement('div');d.className='tls-nav-ctx-sep';box.appendChild(d);}
  function title(box,text){const d=doc.createElement('div');d.className='tls-nav-ctx-title';d.textContent=text;box.appendChild(d);}
  function positionMenu(box,x,y){
    doc.body.appendChild(box);
    const r=box.getBoundingClientRect(),pad=10;
    box.style.left=Math.max(pad,Math.min(x,win.innerWidth-r.width-pad))+'px';
    box.style.top=Math.max(pad,Math.min(y,win.innerHeight-r.height-pad))+'px';
  }
  function menuBase(){
    hideMenu();
    const box=doc.createElement('div');box.className='tls-nav-context';box.setAttribute('role','menu');menu=box;return box;
  }
  function openTab(tab){
    if(typeof win.switchTab==='function')win.switchTab(tab);
  }
  function newTab(tab){win.open(tabUrl(win.location.href,tab),'_blank');}
  function newWindow(tab){
    const sw=win.screen?.availWidth||1440,sh=win.screen?.availHeight||900;
    const w=Math.min(1500,Math.max(900,Math.round(sw*.86))),h=Math.min(1000,Math.max(700,Math.round(sh*.88)));
    const left=Math.max(0,Math.round((sw-w)/2)),top=Math.max(0,Math.round((sh-h)/2));
    const child=win.open(tabUrl(win.location.href,tab),'_blank',`popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    try{child?.focus?.();}catch(_){}
  }
  function move(tab,delta){
    const state=read(),order=effectiveOrder(state),next=moveTab(order,tab,delta);
    state.order=next;write(state);applyLayout();
  }
  function hideTab(tab){
    const state=read();state.hidden=uniq([...state.hidden,tab]);write(state);applyLayout();
    notice('Menú ocultado. Haz click derecho en el fondo del menú lateral para restaurarlo.');
  }
  function showTab(tab){
    const state=read();state.hidden=state.hidden.filter(x=>x!==tab);write(state);applyLayout();
  }
  function reset(){
    write({order:[],hidden:[]});baseOrder=[];ensureBase();applyLayout();notice('Menú restaurado.');
  }
  function hiddenEntries(){
    const state=read(),labels=new Map();
    doc.querySelectorAll(NAV_SELECTOR).forEach(el=>{if(!labels.has(el.dataset.tab))labels.set(el.dataset.tab,labelFor(el));});
    return state.hidden.map(tab=>({tab,label:labels.get(tab)||tab}));
  }
  function showItemMenu(el,x,y){
    const tab=el.dataset.tab,label=labelFor(el),state=read(),order=effectiveOrder(state),idx=order.indexOf(tab);
    const desktop=isDesktopApp(win);
    const box=menuBase();title(box,label+(desktop?' · App macOS':''));
    addItem(box,'Abrir',()=>openTab(tab),{icon:'↗'});
    addItem(box,desktop?'Abrir en otra ventana de la app':'Abrir en pestaña nueva',()=>newTab(tab),{icon:'＋'});
    addItem(box,desktop?'Abrir en ventana flotante':'Abrir en ventana nueva',()=>newWindow(tab),{icon:'▣'});
    sep(box);
    addItem(box,'Mover arriba',()=>move(tab,-1),{icon:'↑',disabled:idx<=0});
    addItem(box,'Mover abajo',()=>move(tab,1),{icon:'↓',disabled:idx<0||idx>=order.length-1});
    addItem(box,'Ocultar del menú',()=>hideTab(tab),{icon:'⊘',danger:true});
    const hidden=hiddenEntries();
    if(hidden.length){
      sep(box);title(box,'Menús ocultos');
      hidden.slice(0,8).forEach(it=>addItem(box,'Mostrar '+it.label,()=>showTab(it.tab),{icon:'○'}));
    }
    sep(box);
    addItem(box,'Restaurar orden original',reset,{icon:'↺'});
    positionMenu(box,x,y);
  }
  function showDockMenu(x,y){
    const box=menuBase(),hidden=hiddenEntries();title(box,'Personalizar menú');
    if(hidden.length){
      hidden.forEach(it=>addItem(box,'Mostrar '+it.label,()=>showTab(it.tab),{icon:'○'}));
      sep(box);
    }else{
      const empty=doc.createElement('div');empty.className='tls-nav-ctx-empty';empty.textContent='No hay menús ocultos';box.appendChild(empty);sep(box);
    }
    addItem(box,'Restaurar orden y visibilidad',reset,{icon:'↺'});
    positionMenu(box,x,y);
  }
  function contextAt(target,x,y){
    const nav=target?.closest?.(NAV_SELECTOR);
    if(nav){showItemMenu(nav,x,y);return true;}
    if(target?.closest?.(DOCK_SELECTOR)){showDockMenu(x,y);return true;}
    return false;
  }

  doc.addEventListener('contextmenu',e=>{
    if(contextAt(e.target,e.clientX,e.clientY)){e.preventDefault();e.stopPropagation();}
  },true);
  doc.addEventListener('click',e=>{if(menu&&!e.target.closest('.tls-nav-context'))hideMenu();},true);
  doc.addEventListener('keydown',e=>{
    if(e.key==='Escape'){hideMenu();return;}
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
      const nav=e.target?.closest?.(NAV_SELECTOR);if(!nav)return;
      e.preventDefault();const r=nav.getBoundingClientRect();showItemMenu(nav,r.right+6,r.top+8);
    }
  },true);
  win.addEventListener('blur',hideMenu);win.addEventListener('resize',hideMenu);
  doc.addEventListener('scroll',hideMenu,true);

  function injectStyle(){
    if(doc.getElementById('tlsNavContextStyle'))return;
    const s=doc.createElement('style');s.id='tlsNavContextStyle';s.textContent=`
      .tls-nav-hidden{display:none!important}
      .tls-nav-context{position:fixed;z-index:20000;min-width:238px;max-width:320px;padding:7px;background:rgba(17,17,17,.985);border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 18px 54px rgba(0,0,0,.62);backdrop-filter:blur(18px);font-family:'DM Sans',system-ui,sans-serif}
      .tls-nav-ctx-title{padding:7px 10px 6px;color:#8b8b8b;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tls-nav-ctx-item{width:100%;display:flex;align-items:center;gap:9px;border:0;background:transparent;color:#eee;padding:9px 10px;border-radius:8px;text-align:left;font:700 11px/1.25 'DM Sans',system-ui,sans-serif;cursor:pointer}
      .tls-nav-ctx-item:hover{background:rgba(0,243,255,.08);color:#fff}
      .tls-nav-ctx-item:focus-visible{outline:1px solid #00d4cc;outline-offset:-1px}
      .tls-nav-ctx-item:disabled{opacity:.32;cursor:default;background:transparent}
      .tls-nav-ctx-item.is-danger{color:#ff6b6b}
      .tls-nav-ctx-icon{width:18px;display:inline-flex;justify-content:center;color:#00e7df;font-size:13px;flex:0 0 18px}
      .tls-nav-ctx-item.is-danger .tls-nav-ctx-icon{color:#ff6b6b}
      .tls-nav-ctx-sep{height:1px;margin:6px 5px;background:rgba(255,255,255,.08)}
      .tls-nav-ctx-empty{padding:8px 10px;color:#777;font-size:10px}
    `;doc.head.appendChild(s);
  }
  function deepLink(){
    let tab='';try{tab=new URL(win.location.href).searchParams.get(TAB_PARAM)||'';}catch(_){}
    if(!tab)return;
    let tries=0;
    const go=()=>{tries++;if(typeof win.switchTab==='function'){win.switchTab(tab);return;}if(tries<40)win.setTimeout(go,150);};
    go();
  }
  function bootstrap(){
    injectStyle();ensureBase();applyLayout();deepLink();
    if(typeof win.MutationObserver==='function'){
      const obs=new win.MutationObserver(()=>{
        if(applying)return;
        clearTimeout(observerTimer);observerTimer=win.setTimeout(()=>{ensureBase();applyLayout();},60);
      });
      obs.observe(doc.body,{childList:true,subtree:true});
    }
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',bootstrap,{once:true});else win.setTimeout(bootstrap,0);
  return true;
}

return{install,_test:{uniq,normalizeState,mergeOrder,moveTab,tabUrl,labelFor,isDesktopApp,STATE_KEY,TAB_PARAM}};
});