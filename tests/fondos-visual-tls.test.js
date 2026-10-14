#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const script=fs.readFileSync(path.join(root,'js/calendario-fondos.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/fondos-concursables.json'),'utf8'));
const css=fs.readFileSync(path.join(root,'fondos-tls.css'),'utf8');
function view(){
  const hooks={}, cards=[], links=[];
  const list={innerHTML:'',addEventListener:(event,fn)=>{hooks['list:'+event]=fn;},
    querySelectorAll:()=>cards,
    querySelector:sel=>sel==='[data-fondos-count]'?counter:sel==='[data-fondos-no-match]'?empty:null
  };
  const counter={textContent:''},empty={hidden:false};
  const rootEl={addEventListener:(event,fn)=>{hooks['root:'+event]=fn;}};
  const filter={value:'',addEventListener:(event,fn)=>{hooks['filter:'+event]=fn;}};
  const modal={style:{display:'none'},addEventListener(){}},detail={innerHTML:''},prepare={dataset:{}};
  const nodes={'tab-calendario':rootEl,'fondosList':list,'fondosFiltro':filter,
    'fondosStatus':{textContent:''},'fondosShowOnCalendar':{checked:true,addEventListener(){}},
    'fondosDetalleModal':modal,'fondosDetalleBody':detail,'fondosDetallePreparar':prepare};
  const state=new Map();
  const doc={readyState:'complete',baseURI:'https://dashboard.thelab.solutions/',
    head:{appendChild:x=>links.push(x)},createElement:tag=>({tagName:tag}),
    getElementById:id=>nodes[id]||null,
    addEventListener:(event,fn)=>{hooks['doc:'+event]=fn;}
  };
  const ctx={window:{renderCalendario(){}},document:doc,URL,Date,Intl,Number,JSON,Promise,console,
    setInterval:()=>0,localStorage:{
      getItem:k=>state.get(k)||null,
      setItem:(k,v)=>state.set(k,v)
    },fetch:async()=>({ok:true,json:async()=>catalog})};
  vm.runInNewContext(script,ctx);
  return {api:ctx.window.TLSFondos,ctx,nodes,list,modal,detail,links,hooks,cards,counter,empty};
}
test('radar TLS carga un CSS externo con marca propia y sin romper Calendario',async()=>{
  const v=view();
  await v.api.load();
  assert.equal(v.links.length,1);
  assert.equal(v.links[0].rel,'stylesheet');
  assert.match(v.links[0].href,/\/fondos-tls\.css\?v=/);
  assert.match(v.list.innerHTML,/THE LAB SOLUTIONS · OPPORTUNITY RADAR/);
  assert.match(v.list.innerHTML,/fondos-kpis/);
  assert.match(v.list.innerHTML,/fondos-filter-pills/);
  assert.match(v.list.innerHTML,/fondosBuscar/);
  assert.match(v.list.innerHTML,/fondos-grid/);
  assert.match(v.list.innerHTML,/Preparar borrador/);
  assert.match(v.list.innerHTML,/Encaje estimado/);
  assert.match(css,/#tab-calendario/);
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/focus-visible/);
});
test('programas prioritarios de noviembre aparecen arriba sin inventar fechas',async()=>{
  const v=view();
  await v.api.load();
  const html=v.list.innerHTML;
  assert.ok(html.indexOf('Corfo — Semilla Inicia')>0);
  assert.ok(html.indexOf('Corfo — Semilla Inicia')<html.indexOf('Corfo — Crea y Valida 2026'));
  assert.match(html,/Fechas por confirmar en fuente oficial/);
  assert.match(html,/data-fondos-view="sin-fechas"/);
  const n=(html.match(/data-fondos-card=/g)||[]).length;
  assert.equal(n,catalog.funds.length);
  assert.doesNotMatch(html,/data-fondos-calendar="corfo-semilla-inicia-nueva-vigilar"/);
});
test('filtros visuales y búsqueda actualizan tarjetas sin alterar fechas ni catálogo',async()=>{
  const v=view();
  await v.api.load();
  v.hooks['root:click']({target:{closest:selector=>selector==='[data-fondos-view]'?
    {dataset:{fondosView:'sin-fechas'}}:null}});
  assert.match(v.list.innerHTML,/aria-pressed="true">En seguimiento/);
  assert.ok(v.list.innerHTML.includes('data-fondos-card="startupchile-big-proximo-vigilar"'));
  assert.ok(!v.list.innerHTML.includes('data-fondos-card="corfo-crea-y-valida-2026"'));
  const c={dataset:{fondosCard:'corfo-semilla-inicia-nueva-vigilar'},hidden:false};
  v.cards.push(c);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'TEXTO inexistente-XYZ'}});
  assert.equal(c.hidden,true);
  assert.equal(v.counter.textContent,'0 oportunidades visibles');
  assert.equal(v.empty.hidden,false);
  v.hooks['list:input']({target:{id:'fondosBuscar',value:'Semilla inicia'}});
  assert.equal(c.hidden,false);
});
test('detalle TLS muestra requisitos, fechas y vínculo oficial válido, sin alterar acciones',async()=>{
  const v=view();await v.api.load();
  v.api.open('corfo-semilla-inicia-nueva-vigilar');
  assert.equal(v.modal.style.display,'flex');
  assert.match(v.detail.innerHTML,/fondos-detail-grid/);
  assert.match(v.detail.innerHTML,/Lo que debes verificar antes de postular/);
  assert.match(v.detail.innerHTML,/Por confirmar/);
  assert.match(v.detail.innerHTML,/https:\/\/www\.corfo\.gob\.cl/);
  assert.equal(v.nodes.fondosDetallePreparar.dataset.fondosDraft,'corfo-semilla-inicia-nueva-vigilar');
  assert.equal(v.api.eventList().length,catalog.funds.filter(f=>f.open&&f.close).length*2);
});
