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
function unique(name) {
  assert.equal(
    count(new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g')),
    1,
    `${name} debe existir una sola vez`
  );
}

test('REMUNERACIONES tiene sección y navegación únicas', () => {
  assert.equal(count(/id=["']tab-remuneraciones["']/g, INDEX), 1);
  assert.match(INDEX, /data-tab=["']remuneraciones["'][^>]*switchTab\('remuneraciones'\)/);
  assert.match(INDEX, /data-tab=["']remuneraciones["'][^>]*switchTabMobile\('remuneraciones'\)/);
});

test('la vista conserva sus contenedores operativos', () => {
  for (const id of ['remPeriodoBar', 'remKpis', 'remSueldoPanel', 'remSueldoGrid', 'remLiqBody', 'remPipeBody', 'remTableBody']) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones implementadas de comisiones existen una sola vez', () => {
  ['setRemPeriodo', '_remFiltrarPorPeriodo', 'renderRemuneraciones', 'exportRemCSV'].forEach(unique);
});

test('la vista se actualiza al cargar pedidos y al abrir la pestaña', () => {
  assert.match(SOURCE, /tab-remuneraciones[^\n]*classList\.contains\('active'\)[^\n]*renderRemuneraciones/);
  assert.match(SOURCE, /if\(name==='remuneraciones'\)\s*renderRemuneraciones\(\)/);
});

test('el rol comercial tiene acceso explícito y los registros se filtran por vendedor', () => {
  assert.match(SOURCE, /comercial\s*:\s*\[[^\]]*['"]remuneraciones['"]/s);
  assert.match(SOURCE, /state\.pedidos[\s\S]*?filter\(vendorOwnsRecord\)/);
  assert.match(SOURCE, /state\.cotizaciones[\s\S]*?filter\(vendorOwnsRecord\)/);
});

test('la vista distingue ventas finalizadas, pipeline y pedidos en proceso', () => {
  assert.match(SOURCE, /['"]Despachado['"],['"]Completado['"]/);
  assert.match(SOURCE, /['"]Solicitada['"],['"]Enviada['"]/);
  assert.match(SOURCE, /Pedidos en Proceso/);
  assert.match(SOURCE, /Comisión Ganada \(3\.5%\)/);
});

// Hallazgos confirmados. Deben convertirse en pruebas obligatorias al corregirse.
test.todo('definir remRenderLiquidacion antes de invocarla');
test.todo('definir remToggleSueldos para que Configurar sueldos funcione');
test.todo('definir remSaveSueldos y persistir cambios con manejo de errores');
test.todo('centralizar y versionar la tasa de comisión por vendedor, contrato y vigencia');
test.todo('reconocer comisión ganada con una política explícita de cobro, pago y reversas');
test.todo('calcular neto desde datos tributarios reales y no dividiendo siempre por 1.19');
test.todo('excluir o separar cotizaciones vencidas del pipeline potencial');
test.todo('aplicar probabilidad, vigencia y etapa al pipeline potencial');
test.todo('proteger remuneraciones con autorización de datos en backend, no solo filtro del navegador');
test.todo('evitar que demo acceda a remuneraciones reales o a todos los vendedores');
test.todo('cerrar períodos y registrar aprobaciones, ajustes, reversas y auditoría');
test.todo('exportar CSV con escape RFC 4180, BOM UTF-8 y nombre de período/vendedor');
test.todo('usar zona America/Santiago y una definición empresarial de inicio de semana');
test.todo('distinguir sueldo base, comisión estimada, devengada, aprobada y pagada');

test('la comisión del KPI y la de Remuneraciones miden el mismo período', () => {
  // La comisión se gana al ENTREGAR. Remuneraciones (el módulo que paga) filtra
  // por 'Fecha entrega'; el KPI del vendedor usaba la fecha de creación del
  // pedido, así que mostraba una comisión distinta para el mismo mes.
  assert.match(
    INDEX,
    /const revDespMes=despachados\.filter\(p=>\{const d=p\.fields\['Fecha entrega'\]/,
    'el KPI de comisión debe filtrar por Fecha entrega, igual que Remuneraciones',
  );
  assert.doesNotMatch(
    INDEX,
    /const revDespMes=despachados\.filter\(p=>p\.createdTime/,
    'el KPI de comisión no debe volver a filtrar por fecha de creación',
  );
  // Remuneraciones sigue siendo la fuente autoritativa del criterio.
  assert.match(
    INDEX,
    /_remPeriodo==='mes'[\s\S]{0,200}?p\.fields\['Fecha entrega'\]/,
    'Remuneraciones debe seguir filtrando el mes por Fecha entrega',
  );
  // Misma tasa en los tres cálculos (KPI, panel y CSV).
  assert.equal(count(/const TASA=0\.035;/g, INDEX), 3, 'la tasa de comisión debe ser única en los tres puntos');
});
