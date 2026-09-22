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

function sectionByTab(tab) {
  const marker = new RegExp(`id=["']tab-${tab}["']`, 'i').exec(HTML);
  assert.ok(marker, `Debe existir #tab-${tab}`);
  const start = HTML.lastIndexOf('<', marker.index);
  const restStart = marker.index + marker[0].length;
  const rest = HTML.slice(restStart);
  const next = new RegExp(`<[^>]+id=["']tab-(?!${tab})[^"']+["']`, 'i').exec(rest);
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

test('Cotizaciones tiene una sola pestaña y navegación funcional', () => {
  assert.equal(count(/id=["']tab-cotizaciones["']/gi, HTML), 1, '#tab-cotizaciones debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]cotizaciones['"]\s*\)/, 'Debe existir navegación a Cotizaciones');
  assert.ok(hasDefinition('renderCotizaciones'), 'Debe existir renderCotizaciones');
});

test('los contenedores principales de Cotizaciones existen y no están duplicados', () => {
  for (const id of ['cotTableTitle', 'cotsTableBodyFull']) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), HTML), 1, `${id} debe existir exactamente una vez`);
  }
});

test('todos los handlers inline de la sección Cotizaciones apuntan a funciones reales', () => {
  const section = sectionByTab('cotizaciones');
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

test('las funciones críticas de Cotizaciones existen una sola vez', () => {
  const names = [
    'renderCotizaciones', 'buildCotRow', 'updateCotizacionEstado',
    'crearPedidoDesdeCotizacion', 'convertirCotAPedido', '_pedidoDeCot',
    'renderCotToOrderTray', 'verCotizacionesCliente', 'cotizarParaCliente',
    '_advanceEtapaCliente', 'resolveClienteName'
  ];
  for (const name of names) {
    assert.ok(hasDefinition(name), `Falta ${name}`);
    const matches = count(new RegExp(`function\\s+${name.replace('$', '\\$')}\\s*\\(`, 'g'), JS);
    assert.equal(matches, 1, `${name} debe estar definida exactamente una vez`);
  }
});

test('Cotizaciones mantiene enlazados cliente, pedidos, Airtable y fechas operativas', () => {
  assert.match(SOURCE, /state\.cotizacionesById/, 'Debe existir índice de cotizaciones por ID');
  assert.match(SOURCE, /state\.clientesByIdRec/, 'Debe resolver el registro del cliente asociado');
  assert.match(SOURCE, /state\.pedidos/, 'Debe consultar pedidos vinculados');
  assert.match(SOURCE, /airtableWrite(?:Tolerant)?\(\s*['"]Cotizaciones['"]/, 'Debe escribir en la tabla Cotizaciones');
  assert.match(SOURCE, /airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]/, 'La conversión debe escribir en Pedidos');
  assert.match(SOURCE, /['"]Cliente['"]/, 'La relación con Cliente debe conservarse');
  assert.match(SOURCE, /Fecha cotización/, 'Debe conservar la fecha de cotización');
  assert.match(SOURCE, /Fecha vencimiento/, 'Debe conservar el vencimiento de la cotización');
});

test('aprobar sigue el orden lógico: guardar estado y luego crear o recuperar el pedido', () => {
  const body = extractFunction('updateCotizacionEstado');
  assert.match(body, /estado\s*===\s*['"]Aprobada['"]/, 'La aprobación debe tener una rama explícita');
  const save = body.search(/await\s+airtableWrite(?:Tolerant)?\(\s*['"]Cotizaciones['"]/);
  const order = body.indexOf('await crearPedidoDesdeCotizacion(id)');
  assert.ok(save >= 0, 'Primero debe persistirse el nuevo estado de la cotización');
  assert.ok(order > save, 'El pedido debe crearse después de guardar la aprobación');
});

test('la conversión a pedido es idempotente y evita pedidos duplicados', () => {
  const create = extractFunction('crearPedidoDesdeCotizacion');
  const convert = extractFunction('convertirCotAPedido');
  const combined = `${create}\n${convert}`;
  assert.match(combined, /_pedidoDeCot\s*\(/, 'Debe comprobar si la cotización ya tiene pedido');
  const guard = combined.indexOf('_pedidoDeCot(');
  const post = combined.search(/airtableWrite(?:Tolerant)?\(\s*['"]Pedidos['"]\s*,\s*['"]POST['"]/);
  assert.ok(post >= 0, 'Debe existir la creación del pedido en Airtable');
  assert.ok(guard >= 0 && guard < post, 'La comprobación anti-duplicado debe ejecutarse antes del POST');
  assert.match(combined, /['"]Cotización origen['"]|['"]Cotizacion origen['"]|Cotización/, 'El pedido debe conservar referencia a su cotización de origen');
});

test('existe recuperación visible para aprobadas que todavía no tienen pedido', () => {
  const tray = extractFunction('renderCotToOrderTray');
  // El filtro vive en _cotAprobadasSinPedido (la bandeja lo consume): se verifica
  // la cadena completa, no la implementación inline que existía antes.
  assert.match(tray, /_cotAprobadasSinPedido\s*\(/, 'La bandeja debe usar el filtro de aprobadas sin pedido');
  const filtro = extractFunction('_cotAprobadasSinPedido');
  assert.match(filtro, /Aprobada/, 'El filtro debe considerar cotizaciones aprobadas');
  assert.match(filtro, /_pedidoDeCot\s*\(/, 'El filtro debe excluir las que ya tienen pedido');
  assert.match(tray, /convertirCotAPedido|crearPedidoDesdeCotizacion/, 'Debe ofrecer una acción real de conversión');
});

test('las acciones auxiliares no reemplazan el flujo principal', () => {
  const body = extractFunction('updateCotizacionEstado');
  const order = body.indexOf('await crearPedidoDesdeCotizacion(id)');
  const drive = body.search(/syncCotizacionADrive|Drive/);
  assert.ok(order >= 0, 'La creación del pedido debe formar parte del flujo principal');
  if (drive >= 0) assert.ok(drive > order, 'La sincronización auxiliar debe ocurrir después de crear el pedido');
});

test('Nueva cotización permite reordenar productos y conserva el orden visual al guardar', () => {
  const add = extractFunction('addItemRow');
  const move = extractFunction('moveItemRow');
  const drag = extractFunction('dragItemRowOver');
  const detail = extractFunction('updateItemsDetalle');

  assert.match(add, /draggable="true"/, 'Cada producto debe tener un tirador para arrastrar');
  assert.match(add, /item-move-up/, 'Debe existir un control accesible para subir');
  assert.match(add, /item-move-down/, 'Debe existir un control accesible para bajar');
  assert.match(move, /insertBefore/, 'Las flechas deben cambiar realmente el orden del DOM');
  assert.match(move, /updateItemTotal\(\)/, 'Reordenar debe sincronizar el detalle guardado');
  assert.match(drag, /clientY/, 'El arrastre debe decidir la posición antes o después de la fila');
  assert.match(detail, /querySelectorAll\('#itemsContainer \.item-row'\)/, 'El detalle debe serializar el orden visible de las filas');
});

test('las observaciones agregadas se editan en línea con teclado y clic', () => {
  const content = extractFunction('_solicitudItemContent');
  const edit = extractFunction('editSolicitudItem');

  assert.match(content, /onclick="editSolicitudItem\(this\)"/, 'El texto de cada observación debe activar la edición');
  assert.match(edit, /dataset\.value=next/, 'La edición debe actualizar el valor persistido');
  assert.match(edit, /event\.key==='Enter'/, 'Enter debe guardar la edición');
  assert.match(edit, /event\.key==='Escape'/, 'Escape debe cancelar la edición');
  assert.match(edit, /addEventListener\('blur'/, 'Salir del campo debe guardar la edición');
  assert.match(edit, /syncSolicitudToTextarea\(\)/, 'El textarea enviado a Airtable debe quedar sincronizado');
});

test('COT. ANTERIOR despliega el detalle de productos antes de importar', () => {
  const picker = extractFunction('openCopyCotPicker');
  const toggle = extractFunction('toggleCopyCotDetail');
  const parse = extractFunction('_copyCotItems');
  const apply = extractFunction('applyCopyCot');

  assert.match(picker, /copy-cot-summary/, 'Cada cotización debe tener una cabecera desplegable');
  assert.match(picker, /copy-cot-detail/, 'Cada cotización debe contener un panel de detalle');
  assert.match(picker, />Descripción</, 'El detalle debe identificar la descripción del producto');
  assert.match(picker, />Costo</, 'El detalle debe mostrar el costo');
  assert.match(picker, />Venta</, 'El detalle debe mostrar el valor de venta');
  assert.match(picker, /c\/u/, 'Debe distinguir valores unitarios de los totales por línea');
  assert.match(picker, /Importar esta cotización/, 'Importar debe ser una acción separada de desplegar');
  assert.match(toggle, /aria-expanded/, 'El acordeón debe comunicar su estado a tecnologías asistivas');
  assert.match(parse, /Detalle JSON/, 'Las cotizaciones nuevas deben usar el detalle estructurado exacto');
  assert.match(parse, /Detalle productos/, 'Las cotizaciones antiguas deben conservar un respaldo de texto');
  assert.match(apply, /_copyCotItems\(f\)/, 'La vista y la importación deben compartir el mismo detalle normalizado');
});
