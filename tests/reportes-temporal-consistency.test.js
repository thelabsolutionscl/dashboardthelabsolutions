#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const INDEX=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function esc(value){return String(value).replace(/[.*+?^$()|[\]\\]/g,'\\$&');}
function functionBlock(name){
  const re=new RegExp('(?:async\\s+)?function\\s+'+esc(name)+'\\s*\\(');
  const start=re.exec(INDEX);
  assert.ok(start,'falta '+name);
  const tail=INDEX.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return INDEX.slice(start.index,next?start.index+start[0].length+next.index:INDEX.length);
}
function compile(names,deps={}){
  const src=names.map(functionBlock).join('\n');
  const keys=Object.keys(deps);
  return new Function(...keys,src+'\nreturn {'+names.join(',')+'};')(...keys.map(k=>deps[k]));
}

test('semana operativa de Reportes es ISO lunes-domingo incluso en domingo',()=>{
  const {_reportWeekStart,_reportWeekEnd}=compile(['_reportWeekStart','_reportWeekEnd']);
  const sunday=new Date('2026-10-11T12:00:00');
  const start=_reportWeekStart(sunday),end=_reportWeekEnd(sunday);
  assert.equal(start.getDay(),1);
  assert.equal(start.getFullYear(),2026);
  assert.equal(start.getMonth(),9);
  assert.equal(start.getDate(),5);
  assert.equal(end.getDay(),1);
  assert.equal(end.getDate(),12);

  const monday=new Date('2026-10-05T08:00:00');
  assert.equal(_reportWeekStart(monday).getDate(),5);
});

test('fecha comercial de cotización prioriza Fecha cotización y usa createdTime solo como fallback',()=>{
  const {_cotizacionFechaComercial}=compile(['_cotizacionFechaComercial']);
  const migrated={createdTime:'2026-08-04T15:30:00Z',fields:{'Fecha cotización':'2026-07-31'}};
  const d=_cotizacionFechaComercial(migrated);
  assert.equal(d.getFullYear(),2026);
  assert.equal(d.getMonth(),6);
  assert.equal(d.getDate(),31);

  const fallback=_cotizacionFechaComercial({createdTime:'2026-08-04T15:30:00Z',fields:{}});
  assert.equal(fallback.toISOString(),'2026-08-04T15:30:00.000Z');

  const invalid=_cotizacionFechaComercial({
    createdTime:'2026-08-04T15:30:00Z',fields:{'Fecha cotización':'2026-02-30'}
  });
  assert.equal(invalid.toISOString(),'2026-08-04T15:30:00.000Z');
});

test('CAC y canal operativo atribuyen una cotización al mes comercial, no al mes de importación',()=>{
  const state={
    clientes:[{id:'cli1',createdTime:'2026-07-01T12:00:00Z',fields:{
      'Origen lead':'google_ads','Fecha primer contacto':'2026-07-01'
    }}],
    cotizaciones:[{id:'q1',createdTime:'2026-08-04T15:00:00Z',fields:{
      Cliente:['cli1'],'Fecha cotización':'2026-07-31','Canal solicitud':'WhatsApp',
      'Estado cotización':'Aprobada','Total final (CLP)':119000
    }}]
  };
  const ranges={
    july:{ini:new Date('2026-07-01T00:00:00'),fin:new Date('2026-08-01T00:00:00')},
    august:{ini:new Date('2026-08-01T00:00:00'),fin:new Date('2026-09-01T00:00:00')}
  };
  const deps={
    state,
    _mesRango:off=>off===0?ranges.july:ranges.august,
    _gastoCanalVisible:()=>({}),
    _gastoCanal:()=>({})
  };
  const api=compile([
    '_cotizacionFechaComercial','_origenAdquisicion','_canalStats','_canalesSolicitud'
  ],deps);
  const july=api._canalStats(0);
  assert.equal(july.length,1);
  assert.equal(july[0].canal,'Google Ads');
  assert.equal(july[0].nCot,1);
  assert.equal(july[0].nuevos,1);
  assert.equal(july[0].revenue,100000);
  assert.deepEqual(api._canalesSolicitud(0),[['WhatsApp',1]]);
  assert.deepEqual(api._canalStats(1),[]);
  assert.deepEqual(api._canalesSolicitud(1),[]);
});

test('prefill, contexto CEO y Overview comparten límites ISO y fecha comercial de cotización',()=>{
  const prefill=functionBlock('prefillReporte');
  const ctx=functionBlock('buildAgentContext');
  const overview=functionBlock('ovRenderUltimoReporteCEO');
  for(const [name,body] of [['prefill',prefill],['contexto',ctx],['overview',overview]]){
    assert.match(body,/_reportWeekStart\(/,name+' debe iniciar lunes');
    assert.match(body,/weekEnd/,name+' debe cerrar el rango semanal');
  }
  assert.match(prefill,/_cotizacionFechaComercial\(c\)/);
  assert.match(ctx,/const\s+cotSemana=.*_cotizacionFechaComercial\(c\)/s);
  assert.match(overview,/_cotizacionFechaComercial\(c\)/);
  assert.match(ctx,/const\s+aprobadas=cotSemana\.filter/);
  assert.match(ctx,/const\s+enviadas=cotSemana\.length/);
});

test('Overview marca análisis viejo por semana o cualquier KPI guardado, no solo revenue',()=>{
  const body=functionBlock('ovRenderUltimoReporteCEO');
  assert.match(body,/const\s+staleRevenue=/);
  assert.match(body,/const\s+staleMetrics=/);
  assert.match(body,/Cotizaciones enviadas/);
  assert.match(body,/Cotizaciones aprobadas/);
  assert.match(body,/Pedidos activos/);
  assert.match(body,/Pedidos despachados/);
  assert.match(body,/const\s+staleWeek=.*_isoWeekKey\(today\)/);
  assert.match(body,/const\s+staleReport=staleWeek\|\|staleRevenue\|\|staleMetrics/);
  assert.match(body,/const\s+summary=staleReport/);
  assert.match(body,/Análisis desactualizado/);
});

test('historial visible advierte duplicados heredados sin borrarlos',()=>{
  const body=functionBlock('renderReportes');
  assert.match(body,/weekCounts=new Map\(\)/);
  assert.match(body,/duplicateWeeks/);
  assert.match(body,/Historial heredado con semanas duplicadas/);
  assert.match(body,/no se borran filas automáticamente/i);
});

test('gasto compartido conserva última versión ante error pero la marca obsoleta y bloquea edición',()=>{
  const visible=functionBlock('_gastoCanalVisible');
  const label=functionBlock('_marketingSpendLabel');
  const load=functionBlock('_marketingSpendLoad');
  const set=functionBlock('setGastoCanal');
  assert.match(visible,/stale_shared/);
  assert.match(label,/stale_shared/);
  assert.match(label,/Últimos datos compartidos/);
  assert.match(load,/const\s+hadShared=/);
  assert.match(load,/status:'stale_shared'/);
  assert.match(set,/row\?\.status==='stale_shared'/);
  assert.match(set,/Pulsa Sincronizar antes de editar/);
});
