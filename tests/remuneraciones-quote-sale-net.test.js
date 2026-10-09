#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Engine=require('../js/remuneraciones-engine.js');

const icbFields={
  'N° Cotización':'261003',
  'Subtotal (CLP)':1202000, // costo de fabricación; NO base de comisión
  'Total final (CLP)':3022600,
  'Detalle productos':'BOLSA POLIESTER PLEGABLE AZUL C/ SERIGRAFIA | 1000 und. | Costo: $1.202.000 | Venta: $2.540.000',
  'Detalle JSON':JSON.stringify([{desc:'BOLSA POLIESTER',und:1000,costoUnit:1202,ventaUnit:2540}]),
  'Estado cotización':'Enviada',
  'Fecha vencimiento':'2026-10-26'
};

test('ICB 261003: comisión proyectada usa venta neta 2.540.000, jamás costo 1.202.000',()=>{
  const net=Engine.quoteNet(icbFields);
  assert.equal(net.verified,true);
  assert.equal(net.amount,2540000);
  const result=Engine.projectQuote({id:'recICB',fields:icbFields},null,'2026-10-09');
  assert.equal(result.weight,.65);
  assert.equal(result.base,2540000);
  assert.equal(result.verifiedBase,true);
  assert.equal(result.commission,57785); // KPI de pipeline ponderado
  assert.equal(result.potentialCommission,88900); // visible en la fila
  assert.equal(Math.round(result.base*.035),88900); // comisión si se concreta
  assert.notEqual(result.commission,27346); // valor errado anterior (costo × tasa × .65)
});

test('cotización 261001: otra fila con el mismo problema también queda corregida',()=>{
  const fields={
    'N° Cotización':'261001','Subtotal (CLP)':125000,
    'Total final (CLP)':280138,
    'Detalle JSON':JSON.stringify([{desc:'ESCULTURA',und:1,costoUnit:125000,ventaUnit:235410}]),
    'Estado cotización':'Enviada','Fecha vencimiento':'2026-10-21'
  };
  assert.equal(Engine.quoteNet(fields).amount,235410);
  const quote=Engine.projectQuote({id:'recArt',fields},null,'2026-10-09');
  assert.equal(quote.commission,5356);
  assert.equal(quote.potentialCommission,8239);
});

test('cotización legacy sin JSON: reconstruir venta únicamente de líneas Venta verificadas con bruto',()=>{
  const fields={
    'Subtotal (CLP)':610000,'Total final (CLP)':1820700,
    'Detalle productos':'MEDALLA | 300 und. | Costo: $450.000 | Venta: $1.065.000\nCHIP | 300 und. | Costo: $150.000 | Venta: $450.000\nENVIO | 1 und. | Costo: $10.000 | Venta: $15.000',
    'Estado cotización':'Aprobada','Fecha vencimiento':'2026-10-20'
  };
  assert.deepEqual(Engine.quoteNet(fields),{
    amount:1530000,source:'Detalle productos (precio de venta)',verified:true
  });
});

test('descuento comercial: conciliación con Total final e IVA sin confundir costo',()=>{
  const fields={
    'Subtotal (CLP)':265000,'Total final (CLP)':671517,
    'Descuento (%)':5,
    'Detalle JSON':JSON.stringify([{und:1,ventaUnit:594000}]),
    'Estado cotización':'Enviada','Fecha vencimiento':'2026-10-20'
  };
  const net=Engine.quoteNet(fields);
  assert.equal(net.amount,564300);
  assert.equal(net.verified,true);
  const quote=Engine.projectQuote({fields},null,'2026-10-09');
  assert.equal(quote.commission,Math.round(564300*.035*.65));
  assert.equal(quote.potentialCommission,Math.round(564300*.035));
});

test('no usar costo ni venta bruta cuando faltan evidencias o los totales no cuadran',()=>{
  const onlyCost={'Subtotal (CLP)':1202000,'Total final (CLP)':3022600};
  assert.deepEqual(Engine.quoteNet(onlyCost),{
    amount:0,source:'sin venta neta verificable',verified:false
  });
  const projection=Engine.projectQuote({fields:{...onlyCost,'Estado cotización':'Enviada'}},null,'2026-10-09');
  assert.equal(projection.base,0);
  assert.equal(projection.commission,0);
  assert.equal(projection.verifiedBase,false);

  const mismatched={...icbFields,'Total final (CLP)':10000};
  assert.equal(Engine.quoteNet(mismatched).verified,false);
  const fakeDetail={...icbFields,'Detalle JSON':'[{"und":1000,"ventaUnit":10}]','Detalle productos':'texto corrupto'};
  assert.equal(Engine.quoteNet(fakeDetail).verified,false);
});

test('neto/IVA explícito prevalece; remuneraciones de pedidos conserva reglas tributarias existentes',()=>{
  assert.equal(Engine.quoteNet({'Monto neto (CLP)':2540000,'Subtotal (CLP)':1202000,
    'Total final (CLP)':3022600}).amount,2540000);
  assert.equal(Engine.quoteNet({'IVA (CLP)':482600,'Subtotal (CLP)':1202000,
    'Total final (CLP)':3022600}).amount,2540000);
  assert.equal(Engine.taxNet({'Monto total (CLP)':119000}).verified,false);
});

test('cotización vencida conserva peso cero, aun cuando el monto neto sea correcto',()=>{
  const projection=Engine.projectQuote({
    id:'reczUPBeeHgcp30s5',fields:{...icbFields,'Fecha vencimiento':'2026-10-08'}
  },null,'2026-10-09');
  assert.equal(projection.base,2540000);
  assert.equal(projection.weight,0);
  assert.equal(projection.potentialCommission,88900);
  assert.equal(projection.commission,0);
});
