#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const JS_DIR=path.join(ROOT,'js');
const MODULES=fs.existsSync(JS_DIR)
  ?fs.readdirSync(JS_DIR).filter(name=>name.endsWith('.js')).sort().map(name=>fs.readFileSync(path.join(JS_DIR,name),'utf8')).join('\n')
  :'';
const SOURCE=`${INDEX}\n${MODULES}`;

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function functionBlock(source,name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`);
  const start=re.exec(source);
  assert.ok(start,`falta ${name}`);
  const tail=source.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(start.index,next?start.index+start[0].length+next.index:source.length);
}
function assertUniqueFunction(name){
  const n=count(new RegExp(`(?:async\\s+)?function\\s+${escapeRegExp(name)}\\s*\\(`,'g'));
  assert.equal(n,1,`${name} debe existir exactamente una vez`);
}

test('Reportes tiene una sola sección y navegación en escritorio y móvil',()=>{
  assert.equal(count(/id=["']tab-reporte["']/g,INDEX),1,'#tab-reporte debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]reporte['"]\s*\)/,'debe existir navegación a Reportes');
  assert.match(SOURCE,/switchTabMobile\(\s*['"]reporte['"]\s*\)/,'debe existir navegación móvil a Reportes');
  const ids=[
    'estacionalidadCard','cacCanalCard','reportesTableBody','reporteOutput',
    'rep-semana','rep-revenue','rep-cot-env','rep-cot-apr','rep-ped-act',
    'rep-ped-des','rep-notas','createReporteBtn'
  ];
  for(const id of ids)assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir una vez`);
});

test('las funciones críticas de Reportes existen sin redefiniciones',()=>{
  const names=[
    'renderReportes','prefillReporte','crearReporte','crearReporteAuto','toggleReporteDetalle',
    'renderEstacionalidad','_estacionalidad','renderCacCanal','_canalStats','setGastoCanal','_cacSetOff',
    '_histSemanas','_tendenciaTexto','ceoAutoWeeklyCheck','formatAgentReport',
    'ovRenderUltimoReporteCEO','ovGenerarReporteCEO'
  ];
  names.forEach(assertUniqueFunction);
});

test('la carga del dashboard solicita un historial amplio de Reportes',()=>{
  assert.match(SOURCE,/airtableFetch\(\s*['"]Reportes['"]\s*,\s*500\s*\)/,'Reportes debe cargar hasta 500 registros y no truncarse a 20');
});

test('renderReportes conecta estacionalidad, CAC e historial ejecutivo',()=>{
  const body=functionBlock(SOURCE,'renderReportes');
  assert.match(body,/renderEstacionalidad\s*\(/,'debe pintar pronóstico estacional');
  assert.match(body,/renderCacCanal\s*\(/,'debe pintar CAC y ROI por canal');
  assert.match(body,/state\.reportes/,'debe leer el historial cargado desde Airtable');
  assert.match(body,/reportesTableBody/,'debe poblar la tabla de historial');
  assert.match(body,/Resumen ejecutivo/,'debe mostrar el análisis guardado');
  assert.match(body,/format(?:Agent|Ceo)Report\s*\(/,'el resumen debe renderizarse de forma estructurada');
  for(const field of ['Revenue semana (CLP)','Pedidos activos','Pedidos despachados','Margen promedio semana (%)','Tasa conversión (%)','Estado reporte']){
    assert.match(body,new RegExp(escapeRegExp(field)),`falta la columna ${field}`);
  }
});

test('crearReporte usa datos vivos, CEO_AGENT y persiste el registro completo',()=>{
  const body=functionBlock(SOURCE,'crearReporte');
  assert.match(body,/createReporteBtn/);
  assert.match(body,/btn\.disabled\s*=\s*true/,'debe bloquear dobles clics durante la generación');
  assert.match(body,/AGENTES_CFG[\s\S]*CEO/,'debe usar la configuración oficial del CEO_AGENT');
  assert.match(body,/buildAgentContext\(\s*['"]CEO['"]\s*\)/,'debe incorporar el contexto vivo del CRM');
  assert.match(body,/callClaude\s*\(/,'debe generar el análisis ejecutivo');
  assert.match(body,/formatAgentReport\s*\(/,'la respuesta visible debe formatearse');
  assert.match(body,/airtableWrite\(\s*['"]Reportes['"]\s*,\s*['"]POST['"]/,'debe guardar en Airtable');
  for(const field of ['Semana','Revenue semana (CLP)','Cotizaciones enviadas','Cotizaciones aprobadas','Pedidos activos','Pedidos despachados','Resumen ejecutivo','Fecha generación','Tasa conversión (%)','Estado reporte']){
    assert.match(body,new RegExp(escapeRegExp(field)),`el registro debe incluir ${field}`);
  }
  assert.match(body,/loadAllDataSilent\s*\(/,'debe recargar la fuente de verdad después de guardar');
  assert.match(body,/renderReportes\s*\(/,'debe refrescar el historial');
  assert.match(body,/btn\.disabled\s*=\s*false/,'el botón debe recuperarse al terminar');
});

test('el reporte 1-clic rellena primero las métricas y luego genera',()=>{
  const body=functionBlock(SOURCE,'crearReporteAuto');
  const prefill=body.search(/prefillReporte\s*\(/);
  const create=body.search(/await\s+crearReporte\s*\(/);
  assert.ok(prefill>=0,'debe precargar los datos actuales');
  assert.ok(create>prefill,'debe generar solo después de precargar');
});

test('el histórico normaliza porcentajes y se ordena por fecha',()=>{
  const body=functionBlock(SOURCE,'_histSemanas');
  assert.match(body,/state\.reportes/);
  assert.match(body,/\.sort\s*\(/,'el histórico usado por tendencias debe ordenarse');
  assert.match(body,/Fecha generación/);
  assert.match(body,/cv\s*<=\s*1\s*\?\s*cv\s*\*\s*100\s*:\s*cv/,'debe aceptar conversión como fracción o porcentaje');
  assert.match(body,/\.slice\(\s*0\s*,\s*n\s*\|\|\s*8\s*\)/,'debe limitar el contexto histórico');
});

test('la tendencia semanal compara revenue, conversión, cotizaciones y despachos',()=>{
  const body=functionBlock(SOURCE,'_tendenciaTexto');
  assert.match(body,/_histSemanas\(\s*2\s*\)/);
  assert.match(body,/Revenue/);
  assert.match(body,/Conversión/);
  assert.match(body,/Cotizaciones enviadas/);
  assert.match(body,/Pedidos despachados/);
});

test('el automático semanal es idempotente por semana y usa el historial',()=>{
  const body=functionBlock(SOURCE,'ceoAutoWeeklyCheck');
  assert.match(body,/_isoWeekKey\s*\(/,'debe identificar la semana ISO');
  assert.match(body,/localStorage/,'debe registrar la ejecución semanal');
  assert.match(body,/crearReporteAuto\s*\(/,'debe reutilizar el mismo flujo de creación');
  assert.match(body,/_tendenciaTexto\s*\(/,'el correo debe incluir tendencia histórica');
});

test('estacionalidad usa pedidos reales, venta neta e índice por mes calendario',()=>{
  const calc=functionBlock(SOURCE,'_estacionalidad');
  const render=functionBlock(SOURCE,'renderEstacionalidad');
  assert.match(calc,/state\.pedidos/);
  assert.match(calc,/Estado pedido/);
  assert.match(calc,/Cancelado/,'los pedidos cancelados deben excluirse');
  assert.match(calc,/Monto total \(CLP\)/);
  assert.match(calc,/\/\s*1\.19/,'la demanda debe expresarse neta de IVA');
  assert.match(calc,/years:new Set\(\)/,'debe distinguir años observados');
  assert.match(calc,/idx\s*=\s*media\s*>\s*0/,'debe calcular índice estacional');
  assert.match(calc,/\[1,2,3\]\.map/,'debe proyectar los próximos tres meses');
  assert.match(render,/estacionalidadCard/);
  assert.match(render,/formatCLP/);
});

test('CAC y ROI usa cotizaciones del período, canal, aprobaciones y venta neta',()=>{
  const calc=functionBlock(SOURCE,'_canalStats');
  const render=functionBlock(SOURCE,'renderCacCanal');
  assert.match(calc,/_mesRango\s*\(/,'debe respetar el mes seleccionado');
  assert.match(calc,/state\.cotizaciones/);
  assert.match(calc,/Canal solicitud/);
  assert.match(calc,/Estado cotización/);
  assert.match(calc,/Aprobada/,'solo las aprobadas deben generar revenue');
  assert.match(calc,/Total final \(CLP\)/);
  assert.match(calc,/\/\s*1\.19/,'el revenue debe ser neto de IVA');
  assert.match(calc,/clientes:new Set\(\)/,'debe deduplicar clientes por canal');
  assert.match(calc,/cac:/);
  assert.match(calc,/roi:/);
  assert.match(render,/cacCanalCard/);
  assert.match(render,/Mes cerrado/);
  assert.match(render,/Mes en curso/);
});

test.todo('CAC debe contar adquisiciones reales, no todos los clientes que cotizaron en el mes');
test.todo('el gasto de cada canal debe guardarse por período para no reutilizar el gasto actual en meses históricos');
test.todo('renderReportes debe ordenar el historial más reciente primero y desempatar por createdTime');
test.todo('crearReporte debe evitar dos registros para la misma semana o actualizar el existente');
test.todo('estacionalidad debe excluir o prorratear el mes calendario que todavía está incompleto');
