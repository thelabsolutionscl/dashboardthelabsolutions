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
    'finSwitchTab','finGetAllFacturas','finFacturasFromAirtable','finVentasMerged','finInitKPIs','finRenderFacturas','finRenderCobrar','finVenc','finRenderAging',
    'finRenderFlujoCaja','finPlanCobranzaIA','ldGuardar','ldGetAll','renderPresupuesto','_presEjecutadoReal','renderBreakEven','_puntoEquilibrio',
    'emitirDTE','uploadCAF','checkFolios','nvGuardar','nvEliminar','c3dCalcPieza','c3dAplicarACot','qcalcCompute','qcalcApply',
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
  assert.match(cobrar,/finGetAllFacturas\s*\(\)/);
  assert.match(cobrar,/porCobrar\s*>\s*0/);
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
  assert.match(body,/finGetAllFacturas\s*\(\)/);
  assert.match(body,/porCobrar\s*>\s*0/);
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
  assert.match(body,/airtableWrite\(\s*['"]Facturas['"]\s*,\s*['"]POST['"]/);
  assert.match(body,/Estado Pago/);
  assert.match(body,/Fecha Vencimiento/);
  assert.match(body,/loadAllDataSilent\s*\(/);
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

test.todo('finVentasMerged debe incorporar Facturas de Airtable y usar el año/mes actual sin rótulos congelados en mayo de 2026');
test.todo('finGetAllFacturas debe deduplicar histórico, ventas locales y Airtable por folio/tipo/emisor o identificador estable');
test.todo('finFacturasFromAirtable debe conservar Fecha Vencimiento, pagos parciales, anuladas y notas de crédito');
test.todo('aging debe separar corriente no vencida de 1–30 días vencidos y usar la fecha real de emisión');
test.todo('nvGuardar, nvEliminar y nvLimpiarTodas deben persistir de forma await/rollback y no llamar una función saveFinVentasAirtable ausente');
test.todo('Libro Diario, presupuesto, caja, pagos programados y préstamos deben persistirse en una fuente compartida y no solo localStorage');
test.todo('_ivaMes debe ser una proyección no tributaria basada en DTE emitidos/compras documentadas, no en pedidos creados y gastos genéricos');
test.todo('emitirDTE debe validar el cuerpo de respuesta, ser idempotente y reconciliar DTE externos que no lograron guardarse en Airtable');
test.todo('uploadCAF y emisión SII deben usar autenticación servidor a servidor; el CAF no debe quedar protegido solo por una URL pública');
test.todo('c3dCalcPieza debe distribuir extras flat una sola vez y no multiplicar extras unitarios dos veces por la cantidad');
test.todo('nvRecalcular debe calcular utilidad sobre venta neta y documentar si el costo está neto o bruto');
test.todo('finDrawCanalDonut y finRenderTopClientes deben usar una base monetaria consistente, sin mezclar pagos brutos con ventas netas');
test.todo('presExportCSV debe exportar el ejecutado real usado en pantalla cuando no hay ajuste manual');
test.todo('FIN_PRESTAMOS debe ordenarse por fecha real y corregir/validar la entrada 13/03/25 dentro de la secuencia 2026');
test.todo('cobWhatsApp debe registrar el toque solo después de confirmación del usuario y la secuencia debe sincronizarse entre dispositivos');
test.todo('punto de equilibrio debe distinguir pedidos creados, facturación y revenue reconocido para no presentar ventas no emitidas como ingreso del mes');
