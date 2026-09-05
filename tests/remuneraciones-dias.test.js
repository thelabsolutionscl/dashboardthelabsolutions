#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=require('../js/remuneraciones-dias.js');
const {monthKey,calcRow,totalSummary,isSellerRole}=mod._test;

test('calcula pago diario y conserva sueldo base separado',()=>{
  const r=calcRow({base:300000,rate:25000,days:12.5});
  assert.equal(r.pagoDias,312500);
  assert.equal(r.subtotal,612500);
  assert.equal(r.dias,12.5);
});

test('limita días a un rango mensual razonable',()=>{
  assert.equal(calcRow({rate:10000,days:99}).dias,31);
  assert.equal(calcRow({rate:10000,days:-4}).dias,0);
});

test('comisiones permanecen separadas del pago fijo',()=>{
  const rows=[calcRow({base:100000,rate:20000,days:5}),calcRow({rate:30000,days:2})];
  const s=totalSummary(rows,45500);
  assert.equal(s.sueldoBase,100000);
  assert.equal(s.pagoDias,160000);
  assert.equal(s.comision,45500);
  assert.equal(s.total,305500);
});

test('reconoce cargos comerciales explícitos',()=>{
  assert.equal(isSellerRole({cargo:'Vendedor B2B'}),true);
  assert.equal(isSellerRole({rol:'comercial'}),true);
  assert.equal(isSellerRole({cargo:'Diseñador'}),false);
});

test('monthKey usa un año-mes estable para Chile',()=>{
  assert.match(monthKey(new Date('2026-09-15T12:00:00Z')),/^2026-09$/);
});

test('el bootstrap del dashboard carga remuneraciones-dias.js',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','js','farm-health-adapter.js'),'utf8');
  assert.match(src,/load\('js\/remuneraciones-dias\.js','remuneraciones por días trabajados'\)/);
});
