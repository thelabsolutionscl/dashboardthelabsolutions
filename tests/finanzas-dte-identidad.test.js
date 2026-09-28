#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const FIN=fs.readFileSync(path.join(__dirname,'..','js','finanzas.js'),'utf8');
const start=FIN.indexOf('function finFacturasFromAirtable(){');
const end=FIN.indexOf('function finVentasMerged(){',start);
assert.ok(start>0&&end>start,'encontrar los helpers reales de Facturas');
const SOURCE=FIN.slice(start,end);
function boot({airtable=[],historic=[],local=[]}={}){
  const state={facturas:airtable};
  const storage={getItem:k=>k==='fin_ventas'?JSON.stringify(local):null};
  return new Function('state','FIN_FACTURAS_BASE','localStorage',
    SOURCE+'\nreturn {finFacturasFromAirtable,finClaveDocumento,finGetAllFacturas};'
  )(state,historic,storage);
}
const dte=(folio,fecha,tipo='33',name='Cliente X')=>({
  id:'rec-'+folio+'-'+fecha+'-'+tipo,
  fields:{'Folio':Number(folio),'Fecha':fecha,'Tipo DTE':tipo,'Neto':100000,
    'IVA':19000,'Total':119000,'Cliente':name,'Estado Pago':'Pendiente'}
});
const old=(folio,year,item='Producto',more={})=>({
  fact:folio,year,mes:'04',empresa:'Cliente X',item,cant:1,valor:100000,
  porCobrar:0,...more
});

test('Airtable sustituye todas las líneas del mismo documento histórico',()=>{
  const b=boot({
    airtable:[dte('356','2026-01-07')],
    historic:[old('356','2026','Producto A'),old('356','2026','Despacho'),old('356','2026','Descuento')]
  });
  const rows=b.finGetAllFacturas();
  assert.equal(rows.length,1);
  assert.equal(rows[0]._source,'airtable');
});

test('un folio reutilizado otro año NO borra la factura histórica',()=>{
  const b=boot({airtable:[dte('356','2026-01-07')],historic:[old('356','2025')]});
  const rows=b.finGetAllFacturas();
  assert.equal(rows.length,2);
  assert.ok(rows.some(r=>r.year==='2025'&&!r._source));
  assert.ok(rows.some(r=>r.year==='2026'&&r._source==='airtable'));
});

test('un folio tipo 61 no reemplaza una factura 33',()=>{
  const b=boot({airtable:[dte('356','2026-01-07','61')],historic:[old('356','2026')]});
  const rows=b.finGetAllFacturas();
  assert.equal(rows.length,2);
});

test('dos tipos de DTE distintos con igual folio y año sobreviven',()=>{
  const b=boot({airtable:[dte('356','2026-01-07','33'),dte('356','2026-01-07','61')]});
  assert.equal(b.finGetAllFacturas().length,2);
  assert.notEqual(b.finClaveDocumento(b.finGetAllFacturas()[0]),b.finClaveDocumento(b.finGetAllFacturas()[1]));
});

test('factura Airtable sin fecha no se inventa enero del año en curso',()=>{
  const b=boot({airtable:[dte('356',null)],historic:[old('356','2026')]});
  const rows=b.finGetAllFacturas();
  assert.equal(rows.length,2);
  const at=rows.find(r=>r._source==='airtable');
  assert.equal(at.year,'');
  assert.equal(at.mes,'');
  assert.equal(b.finClaveDocumento(at),null);
});

test('folio vacío no borra transacciones históricas no facturadas',()=>{
  const b=boot({airtable:[dte('400','2026-04-07')],historic:[old('','2026')]});
  assert.equal(b.finGetAllFacturas().length,2);
});

test('factura local de otro año se conserva aunque coincida folio',()=>{
  const b=boot({airtable:[dte('356','2026-04-07')],local:[old('356','2025')]});
  assert.equal(b.finGetAllFacturas().length,2);
});

test('si localStorage tiene un valor malformado, no se rompen los KPIs',()=>{
  const state={facturas:[dte('400','2026-04-07')]};
  const m=new Function('state','FIN_FACTURAS_BASE','localStorage',
    SOURCE+'\nreturn finGetAllFacturas;')(state,[],{getItem:()=>JSON.stringify({not:'an array'})});
  assert.equal(m().length,1);
});

test('folio 000356 y 356 del mismo tipo/año se concilian como uno',()=>{
  const b=boot({airtable:[dte('356','2026-04-07')],historic:[old('000356','2026')]});
  assert.equal(b.finGetAllFacturas().length,1);
});
