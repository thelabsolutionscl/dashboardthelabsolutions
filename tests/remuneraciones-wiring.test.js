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
const ENGINE = fs.readFileSync(path.join(ROOT, 'js', 'remuneraciones-engine.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'worker.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'access-auth.js'), 'utf8');

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
  ['setRemPeriodo', '_remFiltrarPorPeriodo', '_remOwnsRecord', '_remSueldoStorage', '_remPersonas', '_remLoadSueldos', 'remRenderLiquidacion', 'remRenderSueldoGrid', 'remToggleSueldos', 'remSaveSueldos', 'renderRemuneraciones', 'exportRemCSV'].forEach(unique);
});

test('la vista se actualiza al cargar pedidos y al abrir la pestaña', () => {
  assert.match(SOURCE, /tab-remuneraciones[^\n]*classList\.contains\('active'\)[^\n]*renderRemuneraciones/);
  assert.match(SOURCE, /if\(name==='remuneraciones'\)\s*renderRemuneraciones\(\)/);
});

test('el rol comercial tiene acceso explícito y los registros se filtran por vendedor', () => {
  assert.match(SOURCE, /comercial\s*:\s*\[[^\]]*['"]remuneraciones['"]/s);
  assert.match(SOURCE, /state\.pedidos[\s\S]*?filter\(_remOwnsRecord\)/);
  assert.match(SOURCE, /state\.cotizaciones[\s\S]*?filter\(_remOwnsRecord\)/);
});

test('la vista distingue ventas finalizadas, pipeline y pedidos en proceso', () => {
  assert.match(SOURCE, /['"]Despachado['"],['"]Completado['"]/);
  assert.match(SOURCE, /['"]Solicitada['"],['"]Enviada['"]/);
  assert.match(SOURCE, /Comisión en Proceso \(3\.5%\)/);
  assert.match(SOURCE, /procComision=Math\.round\(procNeto\*TASA\)/);
  assert.match(SOURCE, /Comisión Ganada \(3\.5%\)/);
});

test('un pedido sin vendedor hereda el propietario desde su cotización vinculada', () => {
  const start=INDEX.indexOf('function vendorOwnsRecord(r){');
  const end=INDEX.indexOf('\n// ─',start);
  assert.ok(start>=0&&end>start,'vendorOwnsRecord debe existir');
  const body=INDEX.slice(start,end);
  assert.match(body,/f\['Cotizaciones'\]/,'debe revisar el vínculo del pedido con Cotizaciones');
  assert.match(body,/state\.cotizacionesById/,'debe resolver la cotización vinculada');
  assert.match(body,/cot\?\.fields\?\.\['Vendedor'\]/,'debe heredar el vendedor de la cotización');
});

test('pedidos en proceso muestran comisión estimada separada de la ganada', () => {
  assert.match(INDEX,/const procNeto=enProceso\.reduce/);
  assert.match(INDEX,/const procComision=Math\.round\(procNeto\*TASA\)/);
  assert.match(INDEX,/Comisión en Proceso \(3\.5%\)/);
  assert.match(INDEX,/\$\{enProceso\.length\} pedido/);
  assert.match(INDEX,/neto \$\{formatCLP\(procNeto\)\}/);
});

test('la liquidación y configuración de sueldo están implementadas', () => {
  assert.match(SOURCE, /function remRenderLiquidacion\([^)]*totalNeto[^)]*totalComision/);
  assert.match(SOURCE, /function remToggleSueldos\(/);
  assert.match(SOURCE, /function remSaveSueldos\(/);
  assert.match(SOURCE, /REM_SUELDO_KEY=['"]rem_sueldos_v1['"]/);
});
test('centraliza y versiona la tasa por vendedor, contrato y vigencia', () => {
  assert.match(ENGINE, /DEFAULT_RULE[\s\S]*version:1[\s\S]*rate:0\.035[\s\S]*validFrom/);
  assert.match(ENGINE, /function resolveRule\(/);
  assert.match(WORKER, /function sharedRemRule\(/);
});
test('usa estados explícitos de estimación, devengo, aprobación, pago y reversa', () => {
  for (const status of ['estimated','accrued','approved','paid','reversed']) assert.match(ENGINE, new RegExp(status));
  assert.match(ENGINE, /function paidRatio\(/);
  assert.match(ENGINE, /function isReversed\(/);
});
test('el motor autoritativo exige base tributaria real', () => {
  assert.match(ENGINE, /function taxNet\(/);
  assert.match(ENGINE, /Monto neto \(CLP\)/);
  assert.doesNotMatch(ENGINE, /\/\s*1\.19/);
});
test('el pipeline autoritativo excluye potencial pleno vencido', () => {
  assert.match(ENGINE, /if\(due&&due<now\)return 0/);
  assert.match(ENGINE, /vencidas sin potencial pleno/);
});
test('el pipeline aplica probabilidad por etapa y vigencia', () => {
  assert.match(ENGINE, /solicitada[^\n]*\.35/);
  assert.match(ENGINE, /enviada[^\n]*\.65/);
  assert.match(ENGINE, /aprobad[^\n]*\.9/);
});
test('remuneraciones tienen autorización y scope por vendedor en backend', () => {
  assert.match(ACCESS, /path==='\/shared\/remunerations'/);
  assert.match(WORKER, /function sharedRemScope\(/);
  assert.match(WORKER, /identity\.role!=='sales'/);
  assert.match(WORKER, /sellerEmail/);
});
test('demo limita remuneraciones al vendedor ficticio y usa almacenamiento de sesión', () => {
  assert.match(SOURCE, /window\._DEMO_MODE\?personas\.filter\(p=>p\.id===['"]florencia['"]\)/);
  assert.match(SOURCE, /u\.role!==['"]demo['"]\)return vendorOwnsRecord/);
  assert.match(SOURCE, /window\._DEMO_MODE\?sessionStorage:localStorage/);
  assert.match(SOURCE, /window\._DEMO_MODE&&!sueldos\[['"]Florencia Cancino['"]\]/);
});
test('períodos cerrados quedan protegidos y auditados', () => {
  assert.match(WORKER, /REM_PERIOD_STATES/);
  assert.match(WORKER, /function sharedRemProtected\(/);
  assert.match(WORKER, /Closed remuneration period is immutable/);
  assert.match(WORKER, /next\.audit=/);
  assert.match(WORKER, /action:'reopen'/);
});
test('CSV autoritativo aplica RFC4180, BOM, metadatos y auditoría de exportación', () => {
  assert.match(ENGINE, /\\uFEFF/);
  assert.match(ENGINE, /replace\(\/"\/g,'""'\)/);
  assert.match(ENGINE, /\['Período','Vendedor','Pedido'/);
  assert.match(ENGINE, /shared\/remunerations\/audit/);
});
test('períodos usan America/Santiago y semana desde lunes', () => {
  assert.match(ENGINE, /TZ='America\/Santiago'/);
  assert.match(ENGINE, /function mondayKey\(/);
  assert.match(ENGINE, /\(dow\+6\)%7/);
});
test('UI separa sueldo base de los estados de comisión', () => {
  assert.match(ENGINE, /Resumen comercial auditable/);
  assert.match(ENGINE, /no constituye una liquidación legal/);
  assert.match(ENGINE, /baseSalaries/);
  for (const label of ['Estimada','Devengada','Aprobada','Pagada','Revertida']) assert.match(ENGINE, new RegExp(label));
});

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
  // La tasa autoritativa ya no se repite en KPI/tabla/CSV: vive en una regla versionada.
  assert.match(ENGINE, /DEFAULT_RULE[\s\S]*rate:0\.035/);
  assert.match(SOURCE, /remuneraciones-engine\.js/);
});
