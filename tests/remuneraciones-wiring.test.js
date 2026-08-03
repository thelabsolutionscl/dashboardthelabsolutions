#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS_DIR = path.join(ROOT, 'js');
const MODULES = fs.existsSync(JS_DIR)
  ? fs.readdirSync(JS_DIR).filter(name => name.endsWith('.js')).sort()
      .map(name => fs.readFileSync(path.join(JS_DIR, name), 'utf8')).join('\n')
  : '';
const SOURCE = `${INDEX}\n${MODULES}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function count(re, text = SOURCE) {
  return (text.match(re) || []).length;
}
function hasFunction(name) {
  return new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`).test(SOURCE);
}
function functionBlock(name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const start = re.exec(SOURCE);
  assert.ok(start, `falta ${name}`);
  const tail = SOURCE.slice(start.index + start[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(tail);
  return SOURCE.slice(start.index, next ? start.index + start[0].length + next.index : SOURCE.length);
}
function unique(name) {
  assert.equal(
    count(new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g')),
    1,
    `${name} debe existir una sola vez`
  );
}

test('REMUNERACIONES tiene sección y navegación únicas', () => {
  assert.equal(count(/id=["']tab-remuneraciones["']/g, INDEX), 1, '#tab-remuneraciones debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]remuneraciones['"]\s*\)/, 'falta navegación de escritorio');
  assert.match(SOURCE, /switchTabMobile\(\s*['"]remuneraciones['"]\s*\)/, 'falta navegación móvil');
  for (const id of ['remPeriodoBar', 'remKpis', 'remTableBody', 'remBadge', 'remLiqBody']) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones principales de comisiones y liquidación no están duplicadas', () => {
  [
    'setRemPeriodo', '_remFiltrarPorPeriodo', 'renderRemuneraciones', 'exportRemCSV',
    'remRenderLiquidacion'
  ].forEach(unique);
  if (hasFunction('remPrintLiquidacion')) unique('remPrintLiquidacion');
  if (hasFunction('remSaveSueldos')) unique('remSaveSueldos');
});

test('el período de comisiones contempla histórico, mes, mes anterior y semana', () => {
  const filter = functionBlock('_remFiltrarPorPeriodo');
  for (const period of ['todo', 'mes', 'anterior', 'semana']) {
    assert.match(SOURCE, new RegExp(`setRemPeriodo\\(\\s*['"]${period}['"]`), `falta selector ${period}`);
  }
  assert.match(filter, /Fecha entrega|Fecha despacho|createdTime/, 'el filtro debe usar una fecha operativa');
  assert.match(filter, /new\s+Date\s*\(/, 'el filtro debe comparar fechas reales');
});

test('la comisión visible se calcula desde pedidos elegibles y sobre monto sin IVA', () => {
  const render = functionBlock('renderRemuneraciones');
  assert.match(render, /state\.pedidos/, 'debe partir del libro de pedidos');
  assert.match(render, /Despachado|Completado/, 'debe exigir un estado de venta completada');
  assert.match(render, /1\.19/, 'debe separar IVA del monto bruto');
  assert.match(render, /comisi[oó]n|Comisi[oó]n/i, 'debe calcular y mostrar comisión');
  assert.match(render, /totalBruto|Monto total \(CLP\)/, 'debe conservar monto bruto trazable');
});

test('el ranking moderno permite porcentaje y base venta/utilidad configurables', () => {
  for (const name of ['_comisionCfg', '_ventasVendedor', 'renderComisiones']) unique(name);
  const cfg = functionBlock('_comisionCfg');
  const sales = functionBlock('_ventasVendedor');
  assert.match(cfg, /rate/);
  assert.match(cfg, /utilidad/);
  assert.match(cfg, /venta/);
  assert.match(cfg, /localStorage/, 'la configuración actual debe quedar explícitamente identificada como local');
  assert.match(sales, /state\.pedidos/);
  assert.match(sales, /Cancelado/, 'debe excluir ventas canceladas');
  assert.match(sales, /vendedor|Vendedor/i, 'debe atribuir la venta a una persona');
});

test('la liquidación simple usa sueldo base, comisión y descuentos visibles', () => {
  const liq = functionBlock('remRenderLiquidacion');
  assert.match(SOURCE, /REM_SUELDO_KEY|thelab_rem_sueldos/i, 'falta clave para sueldo base');
  assert.match(liq, /localStorage/, 'el origen local de sueldos debe ser visible');
  assert.match(liq, /sueldo/i);
  assert.match(liq, /comisi[oó]n/i);
  assert.match(SOURCE, /AFP/i);
  assert.match(SOURCE, /Isapre|Salud/i);
  assert.match(SOURCE, /l[ií]quido|neto/i);
});

test('la salida permite exportar comisiones e imprimir una liquidación', () => {
  const csv = functionBlock('exportRemCSV');
  assert.match(csv, /CSV|text\/csv|\.csv/i);
  assert.match(csv, /Pedido|Cliente/);
  const printable = hasFunction('remPrintLiquidacion')
    ? functionBlock('remPrintLiquidacion')
    : SOURCE;
  assert.match(printable, /print\s*\(|window\.print|Imprimir/i, 'falta salida imprimible');
});

test('el acceso a remuneraciones está declarado en el modelo RBAC', () => {
  assert.match(SOURCE, /RBAC[\s\S]{0,12000}remuneraciones/, 'REMUNERACIONES debe estar declarado en RBAC');
  assert.match(SOURCE, /applyRBAC|canAccessTab|tabs\s*:/, 'debe existir enforcement de navegación por rol');
});

test.todo('sueldos, descuentos, metas y estados pagados deben persistir en un backend autoritativo, no en localStorage');
test.todo('la nómina debe versionar parámetros previsionales chilenos por vigencia: AFP, salud, AFC, topes e impuesto único');
test.todo('deben modelarse horas extra, ausencias, licencias, vacaciones, bonos, haberes no imponibles, anticipos y descuentos judiciales');
test.todo('cada mes debe cerrarse de forma inmutable con aprobación, reapertura controlada y auditoría de cambios');
test.todo('las comisiones deben nacer de ventas cobradas/elegibles y soportar notas de crédito, devoluciones y reversas');
test.todo('el pago debe generar archivo bancario, conciliación y evidencia de fecha/monto/cuenta sin exponer datos sensibles');
test.todo('las liquidaciones deben persistirse, firmarse o acusarse como recibidas y tener acceso privado por colaborador');
test.todo('Finanzas debe recibir asiento contable y flujo de caja de remuneraciones sin doble contabilización');
test.todo('RBAC debe controlar por acción y persona quién ve, edita, aprueba, paga y exporta remuneraciones');
test.todo('los cálculos legales deben tener pruebas numéricas independientes y casos límite antes de llamarse liquidación oficial');
