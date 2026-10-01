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
const FIN=fs.readFileSync(path.join(ROOT,'js','finanzas.js'),'utf8');

function count(pattern,text=SOURCE){return(text.match(pattern)||[]).length;}
function esc(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function functionBlock(source,name){
  const re=new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const start=re.exec(source);
  assert.ok(start,`falta ${name}`);
  const tail=source.slice(start.index+start[0].length);
  const next=/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return source.slice(start.index,next?start.index+start[0].length+next.index:source.length);
}
function assertUniqueFunction(name){
  assert.equal(count(new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`,'g')),1,`${name} debe existir exactamente una vez`);
}

test('FINANZAS tiene una sola sección, navegación y módulo cargado',()=>{
  assert.equal(count(/id=["']tab-finanzas["']/g,INDEX),1,'#tab-finanzas debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]finanzas['"]\s*\)/,'debe existir navegación a Finanzas');
  assert.match(SOURCE,/switchTabMobile\(\s*['"]finanzas['"]\s*\)/,'debe existir navegación móvil');
  assert.equal(count(/js\/finanzas\.js(?:\?[^"']*)?/g,INDEX),1,'finanzas.js debe cargarse una sola vez');
  for(const id of ['fin-panel-resumen','fin-panel-facturas','fin-panel-cobrar','fin-panel-prestamos','fin-panel-nueva','fin-panel-diario','fin-panel-aging','fin-panel-presupuesto','finVentasChart','fin-facturas-body','fin-cobrar-body','ivaMensualCard']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir una vez`);
  }
});

test('las funciones críticas de Finanzas existen sin redefiniciones',()=>{
  [
    'finSwitchTab','finGetAllFacturas','finFacturasFromAirtable','finNormalizarFacturaHistorica','finCobranzaConfiable','finFacturasPorCobrar','finVentasMerged','finInitKPIs','finRenderFacturas','finRenderCobrar','finVenc','finRenderAging',
    'finRenderFlujoCaja','finPlanCobranzaIA','ldGuardar','ldGetAll','renderPresupuesto','_presEjecutadoReal','renderBreakEven','_puntoEquilibrio',
    'emitirDTE','uploadCAF','checkFolios','nvGuardar','nvEliminar','_finSetLocalVentas','c3dCalcPieza','c3dAplicarACot','qcalcCompute','qcalcApply',
    '_ventasVendedor','renderComisiones','_ivaMes','renderIvaMensual','renderArqueo','guardarArqueo'
  ].forEach(assertUniqueFunction);
});

test('los submódulos financieros siguen un orden único de navegación',()=>{
  const body=functionBlock(FIN,'finSwitchTab');
  for(const tab of ['resumen','facturas','cobrar','prestamos','deudas','nueva','diario','aging','presupuesto'])assert.match(body,new RegExp(`['"]${tab}['"]`),`falta subtab ${tab}`);
  assert.match(body,/finRenderFacturas\s*\(/);
  assert.match(body,/finRenderCobrar\s*\(/);
  assert.match(body,/finRenderPrestamos\s*\(/);
  assert.match(body,/ldInit\s*\(/);
  assert.match(body,/finRenderAging\s*\(/);
  assert.match(body,/renderPresupuesto\s*\(/);
});

test('la vista de facturas reúne histórico, registros locales y Airtable',()=>{
  const all=functionBlock(FIN,'finGetAllFacturas');
  const at=functionBlock(FIN,'finFacturasFromAirtable');
  assert.match(all,/FIN_FACTURAS_BASE/);
  assert.match(all,/fin_ventas/);
  assert.match(all,/finFacturasFromAirtable\s*\(/);
  assert.match(at,/state\.facturas/);
  for(const field of ['Fecha','Neto','IVA','Exento','Total','Estado Pago','Cliente','Tipo DTE','Folio'])assert.match(at,new RegExp(esc(field)),`falta campo DTE ${field}`);
});

test('facturación, KPIs y gráficos reutilizan la misma agregación mensual interna',()=>{
  for(const name of ['finRenderMensual','finDrawChart','finInitKPIs','finDrawSparklines','finRenderResumenAnual','drawOvFinChart']){
    assert.match(functionBlock(FIN,name),/finVentasMerged\s*\(/,`${name} debe usar finVentasMerged`);
  }
  assert.match(FIN,/function\s+renderOverviewFinanzas\s*\(\)[\s\S]*?const\s+VM\s*=\s*finVentasMerged\s*\(\)/,'renderOverviewFinanzas debe usar finVentasMerged');
});

test('cobranza y aging usan un vencimiento común y priorizan por mora',()=>{
  const cobrar=functionBlock(FIN,'finRenderCobrar');
  const aging=functionBlock(FIN,'finRenderAging');
  assert.match(cobrar,/finFacturasPorCobrar\s*\(\)/);
  assert.match(cobrar,/finVenc\s*\(/);
  assert.match(cobrar,/\.sort\s*\(/,'debe ordenar la cartera');
  assert.match(aging,/finVenc\s*\(/);
  assert.match(aging,/b0/);
  assert.match(aging,/b30/);
  assert.match(aging,/b60/);
  assert.match(aging,/b90/);
});

test('la proyección de caja encadena ocho semanas, facturas y pagos programados',()=>{
  const body=functionBlock(FIN,'finRenderFlujoCaja');
  assert.match(body,/SEMANAS\s*=\s*8/);
  assert.match(body,/finFacturasPorCobrar\s*\(\)/);
  assert.match(body,/_pagosProg\s*\(/);
  assert.match(body,/_pagoOcurrencias\s*\(/);
  assert.match(body,/finSaldoInicial\s*\(/);
  assert.match(body,/saldo\s*\+=\s*w\.ingreso\s*-\s*w\.egreso/);
  assert.match(body,/minSaldo\s*<\s*0/);
});

test('el Libro Diario valida movimientos y alimenta presupuesto, IVA y arqueo',()=>{
  const save=functionBlock(FIN,'ldGuardar');
  const budget=functionBlock(FIN,'_presEjecutadoReal');
  const iva=functionBlock(FIN,'_ivaMes');
  const arqueo=functionBlock(FIN,'_arqueoDia');
  assert.match(save,/monto\s*<=\s*0/);
  assert.match(save,/fecha/);
  assert.match(save,/descripcion/);
  assert.match(save,/ldSaveAll\s*\(/);
  assert.match(budget,/ldGetAll\s*\(/);
  assert.match(budget,/e\.tipo\s*!==\s*['"]gasto['"]/);
  assert.match(iva,/ldGetAll\s*\(/);
  assert.match(iva,/_IVA_EXENTAS/);
  assert.match(arqueo,/ldGetAll\s*\(/);
  assert.match(arqueo,/efectivoEsperado/);
});

test('el flujo DTE valida receptor y monto antes de emitir y materializa una Factura',()=>{
  const body=functionBlock(FIN,'emitirDTE');
  assert.match(body,/validRUT\s*\(/);
  assert.match(body,/razonSocial/);
  assert.match(body,/neto/);
  assert.match(body,/tipo_documento/);
  assert.match(body,/receptor/);
  assert.match(body,/totales/);
  assert.match(body,/await\s+fetch\s*\(/);
  assert.match(body,/airtableWrite\(\s*['"]Pedidos['"]\s*,\s*['"]PATCH['"]/);
  assert.match(body,/facturaExistente/,'debe detectar tipo DTE + folio ya materializado');
  assert.match(body,/airtableWrite\(\s*['"]Facturas['"]\s*,\s*['"]PATCH['"]/);
  assert.match(body,/airtableWrite\(\s*['"]Facturas['"]\s*,\s*['"]POST['"]/);
  assert.match(body,/Estado Pago/);
  assert.match(body,/Fecha Vencimiento/);
  assert.match(body,/loadAllDataSilent\s*\(/);
});

test('SII reutiliza un único helper global de autenticación y el health refleja auth',()=>{
  const caf=functionBlock(FIN,'uploadCAF');
  const folios=functionBlock(FIN,'checkFolios');
  const dte=functionBlock(FIN,'emitirDTE');
  const health=functionBlock(FIN,'testSIIWorker');
  assert.equal(count(/function\s+siiHeaders\s*\(/g,SOURCE),1,'siiHeaders debe tener una sola definición global');
  assert.match(SOURCE,/function\s+siiHeaders\s*\([\s\S]*X-Worker-Key/);
  assert.match(caf,/siiHeaders\s*\(/);
  assert.match(folios,/siiHeaders\s*\(/);
  assert.match(dte,/siiHeaders\s*\(/);
  assert.match(health,/rut_emisor_configurado/);
  assert.match(health,/d\.auth\s*===\s*['"]on['"]/);
  assert.doesNotMatch(health,/d\.rut_emisor\b/,'health público no debe esperar el RUT real');
});

test('las calculadoras trasladan costo y venta neta a la cotización',()=>{
  const c3d=functionBlock(FIN,'c3dCalcPieza');
  const apply3d=functionBlock(FIN,'c3dAplicarACot');
  const generic=functionBlock(FIN,'qcalcCompute');
  const apply=functionBlock(FIN,'qcalcApply');
  assert.match(c3d,/costoMat/);
  assert.match(c3d,/costoMaq/);
  assert.match(c3d,/costoExtras/);
  assert.match(c3d,/1\s*-\s*margen/);
  assert.match(apply3d,/qcalcInsertRow\s*\(/);
  assert.match(generic,/netoUnit/);
  assert.match(generic,/costoUnit/);
  assert.match(apply,/qcalcInsertRow\s*\(/);
});

test('comisiones usan pedidos no cancelados, venta neta y costo real cuando existe',()=>{
  const body=functionBlock(FIN,'_ventasVendedor');
  assert.match(body,/state\.pedidos/);
  assert.match(body,/Cancelado/);
  assert.match(body,/Monto total \(CLP\)/);
  assert.match(body,/\/\s*1\.19/);
  assert.match(body,/_costoRealPedido/);
  assert.match(body,/getMargenCot/);
  assert.match(body,/cfg\.base\s*===\s*['"]utilidad['"]/);
  assert.match(body,/cfg\.rate\s*\/\s*100/);
});

test('cobranza por correo registra la gestión solo después de una respuesta exitosa',()=>{
  const email=functionBlock(FIN,'cobEmail');
  const register=functionBlock(FIN,'cobRegistrar');
  const send=email.search(/await\s+MAIL\.postAs/);
  const log=email.search(/cobRegistrar\s*\(/);
  assert.ok(send>=0&&log>send,'el correo debe enviarse antes de registrar el toque');
  assert.match(email,/validEmail\s*\(/);
  assert.match(register,/Notas internas/);
  assert.match(register,/airtableWriteTolerant\(\s*['"]Clientes['"]\s*,\s*['"]PATCH['"]/);
});

test('finVentasMerged usa facturas normalizadas para el año en curso y Overview no congela mayo',()=>{
  const merged=functionBlock(FIN,'finVentasMerged');
  const overview=functionBlock(FIN,'renderOverviewFinanzas');
  const chart=functionBlock(FIN,'drawOvFinChart');
  assert.match(merged,/finGetAllFacturas\s*\(\)/);
  assert.match(merged,/currentYear/);
  assert.match(merged,/_neto/);
  assert.match(overview,/currentYear/);
  assert.match(overview,/FIN_MESES/);
  assert.doesNotMatch(overview,/Ene–May 2026/);
  assert.match(chart,/now\.getMonth\(\)-off/);
});
test('finGetAllFacturas concilia por identidad DTE (año, tipo, folio)',()=>{
  const all=functionBlock(FIN,'finGetAllFacturas');
  assert.match(all,/clavesAT/);
  assert.match(all,/finClaveDocumento/);
  assert.match(all,/legacy/);
});
test('facturas Airtable conservan vencimiento y calculan saldo real/estados cerrados',()=>{
  const at=functionBlock(FIN,'finFacturasFromAirtable');
  assert.match(at,/Fecha Vencimiento/);
  assert.match(at,/Monto Pagado/);
  assert.match(at,/Saldo Pendiente/);
  assert.match(at,/anulada/);
  assert.match(at,/nota de cr/);
  assert.match(at,/porCobrar/);
});
test('aging separa por vencer de mora y vencimiento usa fecha real de emisión',()=>{
  const aging=functionBlock(FIN,'finRenderAging');
  const venc=functionBlock(FIN,'finVenc');
  assert.match(aging,/rawDias/);
  assert.match(aging,/Por vencer/);
  assert.match(aging,/1–30 días/);
  assert.match(venc,/r&&r\.fecha/);
  assert.match(venc,/emision/);
});
test('ventas manuales no llaman persistencia inexistente y fallan sin corromper la UI',()=>{
  const setLocal=functionBlock(FIN,'_finSetLocalVentas');
  const save=functionBlock(FIN,'nvGuardar');
  const del=functionBlock(FIN,'nvEliminar');
  const clear=functionBlock(FIN,'nvLimpiarTodas');
  assert.doesNotMatch(FIN,/saveFinVentasAirtable\s*\(/,'no debe quedar una llamada a una función inexistente');
  assert.match(setLocal,/try\s*\{/);
  assert.match(setLocal,/localStorage\.setItem\(['"]fin_ventas['"]/);
  assert.match(setLocal,/return false/);
  assert.match(save,/if\(!_finSetLocalVentas\(existing\)\) return/);
  assert.match(del,/if\(!_finSetLocalVentas\(data\)\) return/);
  assert.match(clear,/if\(!_finSetLocalVentas\(\[\]\)\) return/);
});
test.todo('ventas manuales deben migrar desde almacenamiento local a una fuente compartida, auditable y con rollback remoto');
test.todo('Libro Diario, presupuesto, caja, pagos programados y préstamos deben persistirse en una fuente compartida y no solo localStorage');
test.todo('_ivaMes debe ser una proyección no tributaria basada en DTE emitidos/compras documentadas, no en pedidos creados y gastos genéricos');
test.todo('emitirDTE necesita idempotencia server-side por referencia y cola de reconciliación para DTE externos que no lograron guardarse en Airtable');
test.todo('uploadCAF y emisión SII deben usar autenticación servidor a servidor; el CAF no debe quedar protegido solo por una URL pública');
test('c3dCalcPieza distribuye extras del trabajo una sola vez',()=>{
  const c3d=functionBlock(FIN,'c3dCalcPieza');
  assert.match(c3d,/costoExtrasTrabajo/);
  assert.match(c3d,/e\.costo\*extQty/);
  assert.match(c3d,/\(costoMatUnit\+costoMaqUnit\)\*qty\+costoExtrasTrabajo/);
  assert.doesNotMatch(c3d,/costoExtrasTrabajo\s*\)\s*\*\s*qty/);
  assert.match(c3d,/costoUnit=Math\.round\(costoTotal\/qty\)/);
});
test('nvRecalcular calcula utilidad sobre venta neta, sin tratar IVA como margen',()=>{
  const calc=functionBlock(FIN,'nvRecalcular');
  assert.match(calc,/clp\(neto-costo\)/);
  assert.doesNotMatch(calc,/clp\(tot-costo\)/);
});
test('exportarFinanzasCSV usa los mismos montos normalizados que Facturas y neutraliza fórmulas',()=>{
  const csv=functionBlock(FIN,'exportarFinanzasCSV');
  const cell=functionBlock(FIN,'_finCsvCell');
  assert.match(csv,/r\._neto!=null/);
  assert.match(csv,/r\._iva!=null/);
  assert.match(csv,/r\._total!=null/);
  assert.match(csv,/r\._exento/);
  assert.match(cell,/\[=\+\\-@\]/);
  assert.match(cell,/replace\(\/"\/g,['"]""['"]\)/);
});

test('tablas financieras escapan texto procedente de Airtable y ventas manuales',()=>{
  const fact=functionBlock(FIN,'finRenderFacturasPage');
  const manual=functionBlock(FIN,'finRenderNuevaLista');
  for(const field of ['safeNombre','safeEmpresa','safeItem','safeCanal']) {
    assert.match(fact,new RegExp(field),`facturas debe escapar ${field}`);
    assert.match(manual,new RegExp(field),`ventas manuales debe escapar ${field}`);
  }
  assert.match(fact,/escapeHtml\(String\(r\.fact/);
  assert.match(fact,/escapeHtml\(String\(r\.cat/);
});

test.todo('finDrawCanalDonut y finRenderTopClientes deben usar una base monetaria consistente, sin mezclar pagos brutos con ventas netas');
test.todo('presExportCSV debe exportar el ejecutado real usado en pantalla cuando no hay ajuste manual');
test.todo('FIN_PRESTAMOS debe ordenarse por fecha real y corregir/validar la entrada 13/03/25 dentro de la secuencia 2026');
test('cobWhatsApp no registra el toque sin confirmación explícita',()=>{
  const wa=functionBlock(FIN,'cobWhatsApp');
  const ask=wa.search(/confirm\s*\(/);
  const log=wa.search(/cobRegistrar\s*\(/);
  assert.ok(ask>=0&&log>ask,'debe confirmar el envío antes de registrar cobranza');
});
test.todo('punto de equilibrio debe distinguir pedidos creados, facturación y revenue reconocido para no presentar ventas no emitidas como ingreso del mes');


test('cobranza activa no confía en saldos embebidos históricos sin conciliación',()=>{
  const helper=functionBlock(FIN,'finCobranzaConfiable');
  const pending=functionBlock(FIN,'finFacturasPorCobrar');
  assert.match(helper,/_source===['"]airtable['"]/);
  assert.match(helper,/_source===['"]local['"]/);
  assert.match(helper,/cobranzaConfirmada===true/);
  assert.match(pending,/finCobranzaConfiable/);
});

test('históricos pagados e inconsistencias imposibles se cierran antes de cobranza',()=>{
  const norm=functionBlock(FIN,'finNormalizarFacturaHistorica');
  assert.match(norm,/pagoConciliado===true/);
  assert.match(norm,/pago>=total/);
  assert.match(norm,/out\.porCobrar=0/);
  assert.match(FIN,/empresa:'LifeFitness'[\s\S]{0,260}fact:'357'[\s\S]{0,140}porCobrar:0[\s\S]{0,140}pagoConciliado:true/);
  assert.match(FIN,/empresa:'Graficas City Spa'[\s\S]{0,260}fact:'367'[\s\S]{0,140}porCobrar:0[\s\S]{0,140}pagoConciliado:true/);
});

test('aging detallado y CSV separan por vencer de facturas vencidas',()=>{
  const cobrar=functionBlock(FIN,'finRenderCobrar');
  const csv=functionBlock(FIN,'finExportAgingCSV');
  assert.match(cobrar,/Por vencer \/ hoy/);
  assert.match(cobrar,/Vencidas 1–30 días/);
  assert.match(cobrar,/Más de 60 días/);
  assert.match(csv,/rawDias<=0\?'Por vencer \/ hoy'/);
  assert.doesNotMatch(csv,/dias<=30\?'Corriente'/);
});
