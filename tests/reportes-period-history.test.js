#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function section(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing '+start);
 return src.slice(a,b);
}
const storage=()=>{const m=new Map();return{
 getItem:k=>m.has(k)?m.get(k):null,
 setItem:(k,v)=>m.set(k,String(v)),
 removeItem:k=>m.delete(k)
}};
const months=off=>{
 const d=new Date(2026,8+off,1);
 return {key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),label:'mes '+d.getMonth()};
};
test('legacy channel spend migrates ONLY into current period; historic period remains separate',()=>{
 const localStorage=storage();
 localStorage.setItem('thelab_gasto_canal_v1',JSON.stringify({'Google Ads':60000}));
 const fn=new Function('localStorage','_mesRango',section('const _GASTO_CANAL_KEY=', 'function _canalStats(off){')+'return {_gastoCanal,setGastoCanal};')(localStorage,months);
 assert.deepEqual(fn._gastoCanal(0),{'Google Ads':60000});
 assert.deepEqual(fn._gastoCanal(-1),{});
 const saved=JSON.parse(localStorage.getItem('thelab_gasto_canal_por_mes_v2'));
 assert.deepEqual(saved['2026-09'],{'Google Ads':60000});
});
test('editing a closed month never rewrites current-month marketing spend',()=>{
 const localStorage=storage();
 localStorage.setItem('thelab_gasto_canal_por_mes_v2',JSON.stringify({'2026-08':{'Google Ads':20000},'2026-09':{'Google Ads':60000}}));
 const prompts=['Google Ads','35000'];
 const document={getElementById:id=>id==='cacCanalCard'?{dataset:{off:'-1'}}:null};
 const fn=new Function('localStorage','_mesRango','document','prompt','toast','formatCLP','renderCacCanal',section('const _GASTO_CANAL_KEY=', 'function _canalStats(off){')+'return {_gastoCanal,setGastoCanal};')(localStorage,months,document,()=>prompts.shift(),()=>{},x=>String(x),()=>{});
 fn.setGastoCanal();
 assert.deepEqual(fn._gastoCanal(-1),{'Google Ads':35000});
 assert.deepEqual(fn._gastoCanal(0),{'Google Ads':60000});
});
test('visible executive report history is sorted newest first with createdTime tie-breaker',()=>{
 const tbody={innerHTML:''};
 const state={reportes:[
  {id:'old',createdTime:'2026-08-12T10:00:00Z',fields:{Semana:'OLDER','Fecha generación':'2026-08-12'}},
  {id:'first',createdTime:'2026-09-27T12:00:00Z',fields:{Semana:'NEW_FIRST','Fecha generación':'2026-09-27'}},
  {id:'latest',createdTime:'2026-09-27T18:00:00Z',fields:{Semana:'NEW_LATEST','Fecha generación':'2026-09-27'}}
 ]};
 const render=new Function('window','renderEstacionalidad','renderCacCanal','renderCrmAcquisitionAudit','_reporteSemanaDeRegistro','document','state','formatCLP','estadoBadge','escapeHtml','formatCeoReport',section('function renderReportes(){','function toggleReporteDetalle(')+'return renderReportes;')({},()=>{},()=>{},()=>{},()=>null,{getElementById:()=>tbody},state,String,String,String,String);
 render();
 assert.ok(tbody.innerHTML.indexOf('NEW_LATEST')<tbody.innerHTML.indexOf('NEW_FIRST'));
 assert.ok(tbody.innerHTML.indexOf('NEW_FIRST')<tbody.innerHTML.indexOf('OLDER'));
 assert.equal(state.reportes[0].id,'old','source array should not be mutated');
});
test('incomplete current calendar month never enters full-month seasonality baselines',()=>{
 const now=new Date(),past=new Date(now.getFullYear()-1,now.getMonth(),10);
 const source=section('function _estacionalidad(){','function renderEstacionalidad(){');
 const evaluate=new Function('state',source+'return _estacionalidad;');
 const current={fields:{'Estado pedido':'Confirmado','Monto total (CLP)':11900000},createdTime:new Date(now.getFullYear(),now.getMonth(),12).toISOString()};
 const historic={fields:{'Estado pedido':'Confirmado','Monto total (CLP)':119000},createdTime:past.toISOString()};
 const season=evaluate({pedidos:[current,historic]})();
 assert.equal(season.meses[now.getMonth()].n,1,'only the historic matching month counts');
 assert.equal(season.meses[now.getMonth()].years,1);
 assert.equal(Math.round(season.meses[now.getMonth()].avg),100000);
});
