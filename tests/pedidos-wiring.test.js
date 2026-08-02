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
const JS = `${INLINE_JS}\n${EXTERNAL_JS}`;
const SOURCE = `${HTML}\n${JS}`;

function count(pattern, text = SOURCE) {
  return (text.match(pattern) || []).length;
}

function hasDefinition(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:function\\s+${escaped}\\s*\\(|(?:window\\.)?${escaped}\\s*=\\s*(?:async\\b|function\\b|\\()|(?:const|let|var)\\s+${escaped}\\s*=|${escaped}\\s*:\\s*(?:async\\b|function\\b|\\())`
  ).test(JS);
}

function pedidosSection() {
  const marker = /id=["']tab-pedidos["']/i.exec(HTML);
  assert.ok(marker, 'Debe existir #tab-pedidos');
  const start = HTML.lastIndexOf('<', marker.index);
  const restStart = marker.index + marker[0].length;
  const rest = HTML.slice(restStart);
  const next = /<[^>]+id=["']tab-(?!pedidos)[^"']+["']/i.exec(rest);
  return HTML.slice(start, next ? restStart + next.index : HTML.length);
}

function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`, 'g').exec(JS);
  assert.ok(head, `Debe existir la función ${name}`);
  const open = JS.indexOf('{', head.index);
  let depth = 0;
  let quote = '';
  let escapedChar = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < JS.length; i++) {
    const ch = JS[i];
    const next = JS[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escapedChar) { escapedChar = false; continue; }
      if (ch === '\\') { escapedChar = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return JS.slice(head.index, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar la función ${name}`);
}

test('Pedidos tiene una sola pestaña y navegación funcional', () => {
  assert.equal(count(/id=["']tab-pedidos["']/gi, HTML), 1, '#tab-pedidos debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]pedidos['"]\s*\)/, 'Debe existir navegación a Pedidos');
  assert.ok(hasDefinition('renderPedidos'), 'Debe existir renderPedidos');
});

test('los controles principales de Pedidos existen y no están duplicados', () => {
  assert.equal(count(/id=["']pedidosFilterBar["']/g, HTML), 1, 'pedidosFilterBar debe existir exactamente una vez');
  assert.match(SOURCE, /filterPedidos\(/, 'Debe existir el filtrado de pedidos');
  assert.match(SOURCE, /renderPedidosKanban\(/, 'Debe existir la vista Kanban');
});

test('todos los handlers inline de la sección Pedidos tienen una función enlazada', () => {
  const section = pedidosSection();
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

test('las funciones críticas de Pedidos existen una sola vez', () => {
  const names = [
    'renderPedidos', 'filterPedidos', 'renderPedidosKanban', 'advancePedido',
    'crearPedidoDesdeCotizacion', 'convertirCotAPedido', '_pedidoDeCot',
    'renderCargaMaquinas', 'asignarMaquina', 'sugerirMaquina',
    'prodStart', 'prodStop', '_prodState'
  ];
  for (const name of names) {
    assert.ok(hasDefinition(name), `Falta ${name}`);
    const matches = count(new RegExp(`function\\s+${name.replace('$', '\\$')}\\s*\\(`, 'g'), JS);
    assert.equal(matches, 1, `${name} debe estar definida exactamente una vez`);
  }
});

test('el ciclo operativo conserva un orden único y completo', () => {
  const expected = ['Confirmado', 'En producción', 'Listo para despacho', 'Despachado', 'Completado'];
  const lifecycle = /const\s+stages\s*=\s*\[\s*['"]Confirmado['"]\s*,\s*['"]En producción['"]\s*,\s*['"]Listo para despacho['"]\s*,\s*['"]Despachado['"]\s*,\s*['"]Completado['"]\s*\]/;
  assert.match(SOURCE, lifecycle, `El ciclo debe ser: ${expected.join(' → ')}`);
  for (const state of expected) assert.match(SOURCE, new RegExp(state), `Falta el estado ${state}`);
});

test('avanzar un pedido respeta la secuencia y persiste antes de refrescar', () => {
  const body = extractFunction('advancePedido');
  assert.match(body, /airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]/, 'advancePedido debe guardar en Pedidos');
  const write = body.search(/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]/);
  const render = body.search(/renderPedidos\s*\(/);
  assert.ok(write >= 0, 'advancePedido debe esperar la escritura en Airtable');
  if (render >= 0) assert.ok(render > write, 'La interfaz debe refrescarse después de guardar');
});

test('un pedido solo puede completarse después de estar Despachado', () => {
  const singular = count(/Solo se puede completar un pedido que ya esté despachado/g);
  const plural = count(/Solo se pueden completar pedidos que ya estén despachados/g);
  assert.ok(singular >= 3, 'La regla debe proteger acciones individuales, guiadas y equivalentes');
  assert.ok(plural >= 1, 'La regla también debe proteger la acción masiva');
});

test('Completado funciona como archivo y no se elimina del historial', () => {
  assert.match(SOURCE, /filterPedidos\(\s*['"]Completado['"]/, 'Debe existir acceso explícito al archivo de completados');
  assert.match(HTML, /<option>Completado<\/option>/, 'El selector debe incluir Completado');
  assert.match(
    SOURCE,
    /filter\s*===\s*['"]all['"][^:]*\?\s*basePedidos\.filter\(p\s*=>\s*\(p\.fields\[['"]Estado pedido['"]\]\s*\|\|\s*['"]['"]\)\s*!==\s*['"]Completado['"]\)/,
    'La vista principal debe ocultar completados sin borrarlos'
  );
});

test('los filtros de estado no rompen el selector Tabla, Kanban o Calendario', () => {
  assert.match(
    SOURCE,
    /querySelectorAll\(\s*['"]#pedidosFilterBar>button\.active-filter['"]\s*\)/,
    'Los filtros deben preservar el botón de vista activo'
  );
});

test('la creación desde Cotizaciones evita pedidos duplicados y conserva el origen', () => {
  const create = extractFunction('crearPedidoDesdeCotizacion');
  const convert = extractFunction('convertirCotAPedido');
  const combined = `${create}\n${convert}`;
  const guard = combined.indexOf('_pedidoDeCot(');
  const post = combined.search(/airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]\s*,\s*['"]POST['"]/);
  assert.ok(guard >= 0, 'Debe comprobarse si la cotización ya tiene pedido');
  assert.ok(post >= 0, 'Debe existir la creación del pedido en Airtable');
  assert.ok(guard < post, 'La comprobación anti-duplicado debe ocurrir antes del POST');
  assert.match(combined, /Cotización origen|Cotizacion origen|cotizacionId|cotId/, 'El pedido debe conservar referencia a la cotización');
});

test('Pedidos mantiene enlazados cliente, calendario y producción', () => {
  assert.match(SOURCE, /state\.pedidos/, 'Debe existir el estado central de pedidos');
  assert.match(SOURCE, /state\.clientesByIdRec/, 'Debe poder resolver el cliente asociado');
  assert.match(SOURCE, /state\.cotizaciones/, 'Debe conservar la relación con cotizaciones');
  assert.ok(hasDefinition('renderCalendario'), 'Debe existir la integración con Calendario');
  assert.ok(hasDefinition('renderCargaMaquinas'), 'Debe existir la integración con carga de máquinas');
  assert.ok(hasDefinition('prodStart') && hasDefinition('prodStop'), 'Debe existir control de inicio y término de producción');
});
