#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const dateStart=html.indexOf('function _cotizacionFechaComercial(');
const dateEnd=html.indexOf('function prefillReporte(){',dateStart);
const start=html.indexOf('function _origenAdquisicion(');
const end=html.indexOf('function renderCacCanal(){',start);
assert.ok(dateStart>=0&&dateEnd>dateStart&&start>=0&&end>start,
  'Source attribution/date functions must exist');
const source=html.slice(dateStart,dateEnd)+'\n'+html.slice(start,end);
const first='2026-09-02T12:00:00Z',later='2026-09-21T12:00:00Z',old='2026-08-05T12:00:00Z';
function quote(id,cid,channel,date,status='Enviada',amount=119000){
  return {id,createdTime:date,fields:{Cliente:cid?[cid]:[],
    'Canal solicitud':channel,'Estado cotización':status,'Total final (CLP)':amount}};
}
function client(id,date,origin,contact=null,other={}){
  return {id,createdTime:date,fields:{
    ...(origin?{'Origen lead':origin}:{}),
    ...(contact?{'Fecha primer contacto':contact}:{}),...other
  }};
}
function evaluate(state,off=0){
  const _mesRango=offset=>{const d=new Date(2026,8+offset,1);
    return {key:offset===0?'2026-09':'2026-08',ini:d,
      fin:new Date(d.getFullYear(),d.getMonth()+1,1)};};
  const _gastoCanal=offset=>offset===0
    ?{'Google Ads':50000,Instagram:12000}
    :{'Google Ads':6000};
  const api=new Function('state','_mesRango','_gastoCanal',source+
    'return {_canalStats,_canalesSolicitud,_origenAdquisicion};'
  )(state,_mesRango,_gastoCanal);
  return {rows:api._canalStats(off),channels:api._canalesSolicitud(off)};
}
test('an old first-contact date prevents a newly imported CRM record from looking new',()=>{
  const result=evaluate({clientes:[client('c1',first,'google_ads','2026-08-01')],
    cotizaciones:[quote('q1','c1','WhatsApp',first,'Aprobada')]});
  const ads=result.rows.find(r=>r.canal==='Google Ads');
  assert.equal(ads.nuevos,0);
  assert.equal(ads.nCot,1);
  assert.equal(ads.revenue,100000);
  assert.equal(ads.quality.datePct,100);
  assert.deepEqual(result.channels,[['WhatsApp',1]]);
});
test('first Google Ads lead is attributed once even when both quotes arrive by other channels',()=>{
  const result=evaluate({clientes:[client('c1',first,'Google','2026-09-02',
    {GCLID:'gclid-for-test'})],cotizaciones:[
    quote('q1','c1','WhatsApp',first),
    quote('q2','c1','Email',later,'Aprobada')
  ]});
  const ads=result.rows.find(r=>r.canal==='Google Ads');
  assert.equal(ads.nuevos,1);
  assert.equal(ads.nCot,2);
  assert.equal(ads.revenue,100000);
  assert.equal(ads.cac,50000);
  assert.equal(ads.roi,2);
  assert.equal(ads.quality.sourcePct,100);
  assert.equal(ads.quality.datePct,100);
  assert.deepEqual(result.channels,[['WhatsApp',1],['Email',1]]);
});
test('Google origin without a GCLID or explicit campaign is not invented as Google Ads',()=>{
  const result=evaluate({clientes:[client('c1',first,'Google','2026-09-02')],
    cotizaciones:[quote('q1','c1','WhatsApp',first,'Aprobada')]});
  assert.equal(result.rows.find(r=>r.canal==='Google (pago no verificado)').revenue,100000);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').roi,null);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').nuevos,0);
});
test('unknown CRM acquisition source is never inferred from the WhatsApp request channel',()=>{
  const result=evaluate({clientes:[client('c1',first,null,'2026-09-02')],
    cotizaciones:[quote('q1','c1','WhatsApp',first,'Aprobada')]});
  const unknown=result.rows.find(r=>r.canal==='Sin atribución');
  assert.equal(unknown.nuevos,1);
  assert.equal(unknown.revenue,100000);
  assert.equal(unknown.quality.sourcePct,0);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').cac,null);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').roi,null);
});
test('a later erroneous first-contact date does not improve reliability or hide the first quote',()=>{
  const result=evaluate({clientes:[client('c1',first,'google_ads','2026-10-01')],
    cotizaciones:[quote('q1','c1','WhatsApp',first,'Aprobada')]});
  const ads=result.rows.find(r=>r.canal==='Google Ads');
  assert.equal(ads.quality.datePct,0);
  assert.equal(ads.cac,null);assert.equal(ads.roi,null);
  assert.equal(ads.revenue,100000);
});
test('an old customer who returns in a new period does not count as newly acquired',()=>{
  const result=evaluate({clientes:[client('c1',old,'google_ads','2026-08-05')],
    cotizaciones:[quote('oldQ','c1','WhatsApp',old),
      quote('newQ','c1','WhatsApp',first,'Aprobada')]});
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').nuevos,0);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').revenue,100000);
});
test('a quote without a linked client contributes sales only to the unattributed pool',()=>{
  const result=evaluate({clientes:[],cotizaciones:[
    quote('q1',null,'WhatsApp',first,'Aprobada')
  ]});
  const unknown=result.rows.find(r=>r.canal==='Sin atribución');
  assert.equal(unknown.nuevos,0);assert.equal(unknown.revenue,100000);
  assert.equal(unknown.quality.reliable,false);
  assert.equal(result.rows.find(r=>r.canal==='Google Ads').roi,null);
});
test('historical channel spend remains bound to its own calendar month',()=>{
  const state={clientes:[client('c1',old,'google_ads','2026-08-05')],
    cotizaciones:[quote('q1','c1','WhatsApp',old),
      quote('q2','c1','WhatsApp',first)]};
  const aug=evaluate(state,-1).rows.find(r=>r.canal==='Google Ads');
  const sep=evaluate(state,0).rows.find(r=>r.canal==='Google Ads');
  assert.equal(aug.gasto,6000);assert.equal(sep.gasto,50000);
  assert.equal(aug.nuevos,1);assert.equal(sep.nuevos,0);
});
