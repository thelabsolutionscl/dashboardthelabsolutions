#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS_DIR = path.join(ROOT, 'js');
const EXTERNAL_JS = fs.existsSync(JS_DIR)
  ? fs.readdirSync(JS_DIR).filter(file => file.endsWith('.js')).sort()
      .map(file => fs.readFileSync(path.join(JS_DIR, file), 'utf8')).join('\n')
  : '';
const INLINE_JS = [...HTML.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1] || ''))
  .map(match => match[2]).join('\n');
const SOURCE = `${HTML}\n${INLINE_JS}\n${EXTERNAL_JS}`;

function count(pattern, text = SOURCE) {
  return (text.match(pattern) || []).length;
}

function hasDefinition(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:function\\s+${escaped}\\s*\\(|(?:window\\.)?${escaped}\\s*=\\s*(?:async\\b|function\\b|\\()|(?:const|let|var)\\s+${escaped}\\s*=|${escaped}\\s*:\\s*(?:async\\b|function\\b|\\())`
  ).test(`${INLINE_JS}\n${EXTERNAL_JS}`);
}

function clientesSection() {
  const marker = /id=["']tab-clientes["']/i.exec(HTML);
  assert.ok(marker, 'Debe existir #tab-clientes');
  const start = HTML.lastIndexOf('<', marker.index);
  const rest = HTML.slice(marker.index + marker[0].length);
  const next = /<[^>]+id=["']tab-(?!clientes)[^"']+["']/i.exec(rest);
  return HTML.slice(start, next ? marker.index + marker[0].length + next.index : HTML.length);
}

test('la navegación hacia Clientes existe una sola vez y apunta a la pestaña correcta', () => {
  assert.equal(count(/id=["']tab-clientes["']/gi, HTML), 1, '#tab-clientes debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]clientes['"]\s*\)/, 'Debe existir navegación a Clientes');
  assert.match(SOURCE, /function\s+renderClientes\s*\(/, 'Debe existir renderClientes');
});

test('los contenedores y controles principales de Clientes están presentes y no duplicados', () => {
  const ids = [
    'clientesTableBody', 'clientesCount', 'clienteSearch', 'cliCatBar', 'cliOrigenBar',
    'bulkEtapaSelect', 'bulkValidarBtn', 'editClienteModal'
  ];
  for (const id of ids) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), HTML), 1, `${id} debe existir exactamente una vez`);
  }
});

test('todos los handlers inline de la sección Clientes tienen una función enlazada', () => {
  const section = clientesSection();
  const handlers = [...section.matchAll(/\son(?:click|change|input|submit|keydown|keyup|dragstart|dragover|drop)\s*=\s*["']([^"']*)["']/gi)]
    .map(match => match[1]);
  const builtins = new Set([
    'event', 'this', 'window', 'document', 'confirm', 'prompt', 'alert', 'String', 'Number',
    'Boolean', 'parseInt', 'parseFloat', 'encodeURIComponent', 'JSON', 'Math', 'Date',
    'Array', 'Object', 'localStorage', 'navigator', 'setTimeout', 'clearTimeout', 'void'
  ]);
  const called = new Set();
  for (const handler of handlers) {
    const clean = handler.replace(/\$\{[^}]*\}/g, '').replace(/(['"])(?:\\.|(?!\1).)*\1/g, '');
    for (const match of clean.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1];
      const previous = clean[match.index - 1];
      if (previous === '.' || previous === ']' || builtins.has(name)) continue;
      called.add(name);
    }
  }
  const missing = [...called].filter(name => !hasDefinition(name));
  assert.deepEqual(missing, [], `Handlers sin definición: ${missing.join(', ')}`);
});

test('el flujo de Clientes conserva filtros, selección y acciones masivas', () => {
  const functions = [
    'filterClientes', 'setCliCat', 'setCliOrigen', 'toggleRowSelect', 'clearSelection',
    'bulkChangeEtapa', 'bulkValidarClientes', 'deleteSelectedClientes', 'validarCliente',
    'revertirALead', 'updateEtapaCliente'
  ];
  for (const name of functions) assert.ok(hasDefinition(name), `Falta ${name}`);
  assert.match(SOURCE, /selectedClientes/, 'Debe existir el conjunto de selección de clientes');
  assert.match(SOURCE, /_cliCat/, 'Debe persistir el filtro por categoría');
  assert.match(SOURCE, /_cliOrigen/, 'Debe persistir el filtro por origen');
  assert.match(SOURCE, /['"]Validado['"]/, 'Debe existir la categoría explícita Lead/Cliente');
});

test('las relaciones Cliente → detalle, cotizaciones, pedidos y Airtable siguen conectadas', () => {
  const functions = [
    'openClienteDetalle', 'startEditClientFlow', 'verCotizacionesCliente',
    'cotizarParaCliente', 'renderClienteTimeline', 'resolveClienteName'
  ];
  for (const name of functions) assert.ok(hasDefinition(name), `Falta integración ${name}`);
  assert.match(SOURCE, /state\.clientesByIdRec/, 'La ficha debe resolver el registro completo del cliente');
  assert.match(SOURCE, /state\.cotizaciones/, 'Clientes debe vincular cotizaciones');
  assert.match(SOURCE, /state\.pedidos/, 'Clientes debe vincular pedidos');
  assert.match(SOURCE, /airtableWrite\(\s*['"]Clientes['"]/, 'Las escrituras deben apuntar a la tabla Clientes');
});

test('las funciones críticas de Clientes no están redefinidas', () => {
  const names = [
    'renderClientes', 'filterClientes', 'setCliCat', 'setCliOrigen', 'buildClienteRow',
    'openClienteDetalle', 'validarCliente', 'revertirALead', 'updateEtapaCliente',
    'verCotizacionesCliente'
  ];
  const js = `${INLINE_JS}\n${EXTERNAL_JS}`;
  for (const name of names) {
    const matches = count(new RegExp(`function\\s+${name}\\s*\\(`, 'g'), js);
    assert.equal(matches, 1, `${name} debe estar definida exactamente una vez`);
  }
});

test('la promoción Lead → Cliente actualiza UI y resumen después de Airtable', () => {
  const match = /async\s+function\s+validarCliente\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(`${INLINE_JS}\n${EXTERNAL_JS}`);
  assert.ok(match, 'Debe existir validarCliente async');
  const body = match[1];
  const write = body.indexOf("await airtableWrite('Clientes'");
  const render = body.indexOf('renderClientes');
  const overview = body.indexOf('renderOverview');
  assert.ok(write >= 0, 'validarCliente debe esperar la escritura en Airtable');
  assert.ok(render > write, 'renderClientes debe ocurrir después de guardar');
  assert.ok(overview > write, 'renderOverview debe ocurrir después de guardar');
});
