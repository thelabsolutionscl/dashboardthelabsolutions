'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/web-analytics.js'),'utf8');
const analyticsOnly=source.split('function renderAdsKPIs(data,days){')[0];
function setup(){
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{id,style:{display:'none'},dataset:{},innerHTML:'',textContent:'',value:'30'});
    return nodes.get(id);
  }
  const context={
    window:{_DEMO_MODE:false},
    document:{getElementById:node},
    getAdsConfig:()=>({endpoint:'https://script.google.com/macros/s/test/exec'}),
    fmtNum:n=>String(n),
    escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    fetch:async()=>{throw new Error('No mock fetch configured');},
    AbortController,URL,setTimeout,clearTimeout,Date,Number,Math,console
  };
  vm.createContext(context);
  vm.runInContext(analyticsOnly,context);
  return {context,node};
}
test('GA4 consulta el endpoint propio antes de esperar Google Ads y muestra carga',async()=>{
  const {context,node}=setup();
  let resolveRequest,requested='',calls=0;
  context.fetch=url=>{calls++;requested=url;return new Promise(resolve=>{resolveRequest=resolve;});};
  const first=context.loadWebStats(),second=context.loadWebStats();
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'loading');
  assert.match(node('webTrafficHint').innerHTML,/Consultando Google Analytics/);
  assert.equal(calls,1,'deduplicar llamadas mientras hay una solicitud activa');
  resolveRequest({ok:true,json:async()=>({ok:true,web:true,usuarios:17,nuevos:12,sesiones:22,vistas:31,dias:[]})});
  await Promise.all([first,second]);
  assert.match(requested,/action=web/);
  assert.match(requested,/days=30/);
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'ok');
  assert.equal(node('web-kpi-usuarios').textContent,'17');
});
test('un error no-config del backend nunca se trata como Script antiguo',async()=>{
  const {context,node}=setup();
  context.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'no-config'})});
  await context.loadWebStats();
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'property');
  assert.match(node('webTrafficHint').innerHTML,/GA4_PROPERTY/);
  assert.match(node('webTrafficHint').innerHTML,/Reintentar conexión GA4/);
});
test('sin endpoint real no presenta visitantes de demostración',async()=>{
  const {context,node}=setup();
  context.getAdsConfig=()=>({endpoint:''});
  await context.loadWebStats();
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'script');
  assert.equal(node('webTrafficBody').style.display,'none');
  assert.notEqual(node('web-kpi-usuarios').textContent,'0');
});
test('un error HTTP muestra diagnóstico y mantiene ocultos los KPIs sin validar',async()=>{
  const {context,node}=setup();
  context.fetch=async()=>({ok:false,status:403});
  await context.loadWebStats();
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'error');
  assert.match(node('webTrafficHint').innerHTML,/HTTP 403/);
  assert.equal(node('webTrafficBody').style.display,'none');
});
test('solo en modo DEMO permite estadísticas de muestra y las identifica',async()=>{
  const {context,node}=setup();
  context.window._DEMO_MODE=true;
  context.fetch=async()=>{throw new Error('DEMO must not fetch');};
  await context.loadWebStats();
  assert.equal(node('webTrafficPanel').dataset.gaStatus,'demo');
  assert.equal(node('webTrafficDemo').style.display,'block');
});
test('la navegación WEB dispara GA4 antes de leer snapshots de Ads',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const match=html.match(/if\(name==='web'\)\{([^}]+)\}/);
  assert.ok(match,'No se encontró el flujo WEB');
  assert.ok(match[1].indexOf('loadWebStats()')>=0);
  assert.ok(match[1].indexOf('loadWebStats()')<match[1].indexOf('loadAdsSnapshotsFromAirtable()'));
  const ads=fs.readFileSync(path.join(root,'js/seo-ads.js'),'utf8');
  assert.doesNotMatch(ads,/renderWebStats\(getWebDemoData\(days\),days\)/,
    'un fallo de Ads no puede inventar métricas de tráfico GA4');
});
