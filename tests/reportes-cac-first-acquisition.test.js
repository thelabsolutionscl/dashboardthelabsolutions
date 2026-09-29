#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('function _canalStats(off){');
const end=html.indexOf('function renderCacCanal(){',start);
assert.ok(start>=0&&end>start,'CAC calculator must exist');
const source=html.slice(start,end);
const first='2026-09-02T12:00:00Z';
const later='2026-09-21T12:00:00Z';
const old='2026-08-05T12:00:00Z';
function quote(id,cid,channel,date,status='Enviada',amount=119000){
 return {id,createdTime:date,fields:{Cliente:cid?[cid]:[], 'Canal solicitud':channel,
  'Estado cotización':status,'Total final (CLP)':amount}};
}
function evaluate(state,off=0){
 const _mesRango=offset=>{const d=new Date(2026,8+offset,1);return {
  ini:d,fin:new Date(d.getFullYear(),d.getMonth()+1,1)
 }};
 const _gastoCanal=offset=>offset===0?{'Google Ads':50000,'Instagram':12000}:{'Google Ads':6000};
 const calc=new Function('state','_mesRango','_gastoCanal',source+'return _canalStats;')(state,_mesRango,_gastoCanal);
 return calc(off);
}
test('returning customer first contacted in previous period is not a new acquisition',()=>{
 const state={clientes:[{id:'c1',createdTime:old}],cotizaciones:[
  quote('q1','c1','Google Ads',old),
  quote('q2','c1','Google Ads',first,'Aprobada')
 ]};
 const row=evaluate(state).find(r=>r.canal==='Google Ads');
 assert.equal(row.nuevos,0);
 assert.equal(row.nCot,1);
 assert.equal(row.revenue,100000,'approved revenue still belongs to selected month');
 assert.equal(row.gasto,50000);
});
test('first quote attributes a customer only once even if they quote other channels the same month',()=>{
 const rows=evaluate({clientes:[{id:'c1',createdTime:first}],cotizaciones:[
  quote('q1','c1','Google Ads',first),
  quote('q2','c1','Instagram',later,'Aprobada')
 ]});
 assert.equal(rows.find(r=>r.canal==='Google Ads').nuevos,1);
 assert.equal(rows.find(r=>r.canal==='Google Ads').cac,50000);
 assert.equal(rows.find(r=>r.canal==='Instagram').nuevos,0);
 assert.equal(rows.find(r=>r.canal==='Instagram').revenue,100000);
});
test('a historical CRM client with their first known quote now is not newly acquired',()=>{
 const rows=evaluate({clientes:[{id:'oldCustomer',createdTime:old}],cotizaciones:[
  quote('q1','oldCustomer','Instagram',first,'Aprobada')
 ]});
 assert.equal(rows[0].nuevos,0);
 assert.equal(rows[0].revenue,100000);
});
test('orphan quote without a linked client is not invented as a new customer',()=>{
 const rows=evaluate({clientes:[],cotizaciones:[quote('q1',null,'Google Ads',first,'Aprobada')]});
 assert.equal(rows[0].nuevos,0);
 assert.equal(rows[0].revenue,100000);
});
test('historical channel cost stays bound to the selected reporting month',()=>{
 const state={clientes:[{id:'c1',createdTime:old}],cotizaciones:[
  quote('oldQuote','c1','Google Ads',old),
  quote('newQuote','c1','Google Ads',first)
 ]};
 const oldMonth=evaluate(state,-1).find(r=>r.canal==='Google Ads');
 const current=evaluate(state,0).find(r=>r.canal==='Google Ads');
 assert.equal(oldMonth.gasto,6000);
 assert.equal(current.gasto,50000);
 assert.equal(oldMonth.nuevos,1);
 assert.equal(current.nuevos,0);
});
