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

test('aprobar desde Editar también crea el pedido con los datos recién guardados', () => {
  const body = extractFunction('saveEditCot');
  const save = body.indexOf("await _saveCotFields('PATCH',cotId,fields)");
  const local = body.indexOf('Object.assign(_cotRec.fields,fields)');
  const order = body.indexOf('await crearPedidoDesdeCotizacion(cotId)');

  assert.match(body, /fields\['Estado cotización'\]==='Aprobada'/, 'Editar debe detectar el estado Aprobada');
  assert.match(body, /!_pedidoDeCot\(_cotRec\)/, 'Debe evitar duplicar un pedido ya vinculado');
  assert.ok(save >= 0, 'Primero debe guardar la cotización');
  assert.ok(local > save, 'Después debe actualizar la copia local con los valores editados');
  assert.ok(order > local, 'El pedido debe crearse usando esos valores actualizados');
  assert.match(body, /renderCotToOrderTray\(\)/, 'Si la creación falla debe quedar disponible la recuperación visible');
  assert.match(body, /pedido quedó pendiente de creación/, 'El fallo parcial no debe presentarse como éxito completo');
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

test('la asociación cotización→pedido usa links explícitos y no confunde importes repetidos', () => {
  const body = extractFunction('_pedidoDeCot');
  assert.match(body, /\['Pedido'\]/, 'Debe respetar el link recíproco Pedido de la cotización');
  assert.match(body, /\['Cotizaciones'\]/, 'Debe reconocer el link de origen guardado en el pedido');
  assert.doesNotMatch(body, /Monto total \(CLP\)/, 'No debe inferir el pedido por monto');
  assert.doesNotMatch(body, /fields\['Cliente'\]/, 'No debe inferir el pedido por cliente');
});

test('crear pedido desde cotización guarda campos operativos válidos', () => {
  const body = extractFunction('crearPedidoDesdeCotizacion');
  for (const field of ['Fecha ingreso','Cantidad','Instrucciones fabricación','Notas pedido','Forma de pago','Vendedor','Cotizaciones']) {
    assert.ok(body.includes(field), `Debe conservar ${field}`);
  }
  assert.ok(body.includes('Tiempo de producción máx'), 'Debe conservar el rango de plazo dentro de las notas');
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


test('ventas históricas conciliadas no vuelven a crear pedidos',()=>{
  const create=extractFunction('crearPedidoDesdeCotizacion');
  const update=extractFunction('updateCotizacionEstado');
  const edit=extractFunction('saveEditCot');
  assert.match(create,/Venta histórica conciliada/);
  assert.match(create,/no se crea un pedido nuevo/);
  assert.match(update,/!_cot\?\.fields\?\.\['Venta histórica conciliada'\]/);
  assert.match(edit,/!_cotRec\.fields\['Venta histórica conciliada'\]/);
  const tray=extractFunction('_cotAprobadasSinPedido');
  assert.match(tray,/Venta histórica conciliada/);
});

// ── Motivo de rechazo y fecha de aprobación ─────────────────────────────
// Se ejecuta updateCotizacionEstado real con DOM y Airtable simulados para
// fijar el PATCH exacto que llega a Airtable.
const AIRTABLE_MOTIVOS_RECHAZO = [
  'Precio muy alto', 'Plazo muy largo', 'Eleigió competencia',
  'Proyecto cancelado', 'Sin respuesta', 'Otro'
];

function extractDeclaration(pattern, name) {
  const match = JS.match(pattern);
  assert.ok(match, `Debe existir ${name}`);
  return match[0];
}

function montarFlujoEstado({ fields = {}, notasRemotas = '', lecturaFalla = false } = {}) {
  const elementos = {};
  const el = (id) => elementos[id] || (elementos[id] = {
    id, value: '', textContent: '', style: { display: '' }, _html: '',
    set innerHTML(v) { this._html = v; this.value = ''; },
    get innerHTML() { return this._html; },
    focus() {}
  });
  el('motivoRechazoModal').style.display = 'none';
  const calls = { writes: [], reads: [], toasts: [], confirms: [], pedidos: [], etapas: [] };
  const state = { cotizacionesById: { recCot0000000001: { id: 'recCot0000000001', fields: {
    'N° Cotización': '261028', 'Cliente': ['recCli0000000001'], 'Estado cotización': 'Enviada', ...fields
  } } } };
  const mocks = {
    document: { getElementById: el },
    state,
    toast: (msg, type) => calls.toasts.push({ msg, type }),
    confirm: (msg) => { calls.confirms.push(msg); return true; },
    airtableWrite: async (table, method, id, payload) => { calls.writes.push({ table, method, id, fields: payload }); return { id, fields: payload }; },
    _airtableConfig: () => ({ base: 'https://proxy.test/v0', headers: {} }),
    airtableHttp: async (url) => {
      calls.reads.push({ url, afterWrites: calls.writes.length });
      if (lecturaFalla) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ id: 'recCot0000000001', fields: notasRemotas ? { 'Notas cotización': notasRemotas } : {} }) };
    },
    BASE_ID: 'appTest00000000000',
    hoyCL: () => '2026-10-28',
    resolveClienteName: () => 'Cliente de prueba',
    escapeHtml: (s) => String(s),
    setTimeout: (fn) => fn(),
    _advanceEtapaCliente: async (...args) => { calls.etapas.push(args); },
    crearPedidoDesdeCotizacion: async (id) => { calls.pedidos.push({ id, afterWrites: calls.writes.length }); return true; },
    _driveConnected: () => false,
    ensureCotFolder: async () => {},
    loadAllDataSilent: async () => {},
    renderCotizaciones: () => {},
    renderOverview: () => {}
  };
  const code = [
    extractDeclaration(/const MOTIVOS_RECHAZO_COT=\[[\s\S]*?\n\];/, 'MOTIVOS_RECHAZO_COT'),
    extractDeclaration(/let _motivoRechazoResolve=null;/, '_motivoRechazoResolve'),
    ...['pedirMotivoRechazo', 'onMotivoRechazoChange', 'closeMotivoRechazoModal', 'confirmarMotivoRechazo',
      '_notasConMotivoRechazo', '_notasCotizacionActuales', 'updateCotizacionEstado'].map(extractFunction),
    'return { MOTIVOS_RECHAZO_COT, updateCotizacionEstado, confirmarMotivoRechazo, closeMotivoRechazoModal };'
  ].join('\n');
  const api = new Function(...Object.keys(mocks), code)(...Object.values(mocks));
  return { api, calls, el, id: 'recCot0000000001' };
}

test('el selector usa exactamente las opciones del singleSelect Motivo rechazo', () => {
  const { api } = montarFlujoEstado();
  assert.deepEqual(api.MOTIVOS_RECHAZO_COT.map(o => o.value), AIRTABLE_MOTIVOS_RECHAZO,
    'Un valor distinto al de Airtable crearía una opción nueva por typecast');
  const competencia = api.MOTIVOS_RECHAZO_COT.find(o => o.value === 'Eleigió competencia');
  assert.equal(competencia.label, 'Eligió competencia', 'La etiqueta visible debe ir corregida');
});

test('el modal de motivo de rechazo existe una vez, con el estilo de los modales y handlers reales', () => {
  assert.equal(count(/id=["']motivoRechazoModal["']/g, HTML), 1);
  const start = HTML.indexOf('id="motivoRechazoModal"');
  const modal = HTML.slice(start, HTML.indexOf('<!-- MODALES CLIENTE -->', start));
  assert.match(HTML.slice(start - 60, start + 60), /class="modal-overlay"/);
  assert.match(modal, /class="modal-backdrop"/);
  assert.match(modal, /class="modal-card"/);
  assert.match(modal, /class="modal-title"/);
  assert.match(modal, /id="motivoRechazoSelect"/);
  assert.match(modal, /id="motivoRechazoOtro"/);
  const handlers = [...modal.matchAll(/\son(?:click|change)="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
  assert.ok(handlers.length >= 3, 'Debe tener handlers de cancelar, cambiar y confirmar');
  const missing = handlers.filter(name => !hasDefinition(name));
  assert.deepEqual(missing, [], `Handlers sin definición: ${missing.join(', ')}`);
});

test('rechazar exige elegir un motivo y cancelar no escribe nada', async () => {
  const { api, calls, el, id } = montarFlujoEstado();
  const flujo = api.updateCotizacionEstado(id, 'Rechazada');
  assert.equal(el('motivoRechazoModal').style.display, 'flex', 'Rechazar debe abrir el selector');
  assert.deepEqual(calls.confirms, [], 'El selector reemplaza al confirm()');
  api.confirmarMotivoRechazo();
  assert.equal(el('motivoRechazoModal').style.display, 'flex', 'Sin motivo el modal sigue abierto');
  assert.ok(calls.toasts.some(t => t.type === 'error' && /motivo/i.test(t.msg)));
  api.closeMotivoRechazoModal();
  await flujo;
  assert.equal(el('motivoRechazoModal').style.display, 'none');
  assert.deepEqual(calls.writes, [], 'Cancelar no debe cambiar el estado en Airtable');
});

test('rechazar envía estado y motivo en el mismo PATCH', async () => {
  const { api, calls, el, id } = montarFlujoEstado();
  const flujo = api.updateCotizacionEstado(id, 'Rechazada');
  el('motivoRechazoSelect').value = 'Eleigió competencia';
  api.confirmarMotivoRechazo();
  await flujo;
  assert.equal(calls.writes.length, 1, 'Debe ser un único PATCH');
  assert.deepEqual(calls.writes[0], {
    table: 'Cotizaciones', method: 'PATCH', id,
    fields: { 'Estado cotización': 'Rechazada', 'Motivo rechazo': 'Eleigió competencia' }
  });
  assert.deepEqual(calls.pedidos, [], 'Rechazar no crea pedidos');
  assert.deepEqual(calls.reads, [], 'Sin «Otro» no hace falta releer las notas');
});

test('con «Otro» el detalle es obligatorio y se agrega a Notas cotización sin pisar lo anterior', async () => {
  const { api, calls, el, id } = montarFlujoEstado({
    fields: { 'Notas cotización': 'copia local vieja' },
    notasRemotas: 'Cliente pidió factura exenta.'
  });
  const flujo = api.updateCotizacionEstado(id, 'Rechazada');
  el('motivoRechazoSelect').value = 'Otro';
  api.confirmarMotivoRechazo();
  assert.equal(el('motivoRechazoModal').style.display, 'flex', '«Otro» sin texto no debe cerrar el modal');
  el('motivoRechazoOtro').value = '  Lo van a imprimir ellos mismos  ';
  api.confirmarMotivoRechazo();
  await flujo;
  assert.equal(calls.reads.length, 1, 'Debe releer las notas en Airtable antes de anexar');
  assert.equal(calls.reads[0].afterWrites, 0, 'La relectura debe ocurrir antes del PATCH');
  assert.match(calls.reads[0].url, /\/Cotizaciones\/recCot0000000001$/);
  assert.deepEqual(calls.writes[0].fields, {
    'Estado cotización': 'Rechazada',
    'Motivo rechazo': 'Otro',
    'Notas cotización': 'Cliente pidió factura exenta.\n\n[28-10-2026] Motivo rechazo (Otro): Lo van a imprimir ellos mismos'
  });
});

test('si no se pueden releer las notas, no se rechaza a ciegas', async () => {
  const { api, calls, el, id } = montarFlujoEstado({ lecturaFalla: true });
  const flujo = api.updateCotizacionEstado(id, 'Rechazada');
  el('motivoRechazoSelect').value = 'Otro';
  el('motivoRechazoOtro').value = 'Detalle';
  api.confirmarMotivoRechazo();
  await flujo;
  assert.deepEqual(calls.writes, [], 'Sin las notas actuales el PATCH podría pisarlas');
  assert.ok(calls.toasts.some(t => t.type === 'error'));
});

test('aprobar guarda la fecha de aprobación de hoy en Chile y mantiene el flujo del pedido', async () => {
  const { api, calls, id } = montarFlujoEstado();
  await api.updateCotizacionEstado(id, 'Aprobada');
  assert.equal(calls.confirms.length, 1, 'Aprobar sigue pidiendo confirmación');
  assert.deepEqual(calls.writes[0].fields, { 'Estado cotización': 'Aprobada', 'Fecha aprobación': '2026-10-28' });
  assert.equal(calls.etapas.length, 1, 'Debe seguir avanzando la etapa del cliente');
  assert.equal(calls.pedidos.length, 1, 'Debe seguir creando el pedido');
  assert.equal(calls.pedidos[0].afterWrites, 1, 'El pedido se crea después de guardar la aprobación');
  assert.match(extractFunction('updateCotizacionEstado'), /\['Fecha aprobación'\]=hoyCL\(\)/,
    'La fecha debe salir de hoyCL() (America/Santiago, AAAA-MM-DD)');
});

test('aprobar una venta histórica conciliada guarda la fecha pero no crea pedido', async () => {
  const { api, calls, id } = montarFlujoEstado({ fields: { 'Venta histórica conciliada': true } });
  await api.updateCotizacionEstado(id, 'Aprobada');
  assert.equal(calls.writes[0].fields['Fecha aprobación'], '2026-10-28');
  assert.deepEqual(calls.pedidos, []);
});

test('otros estados no llevan motivo ni fecha de aprobación', async () => {
  const { api, calls, id } = montarFlujoEstado();
  await api.updateCotizacionEstado(id, 'Enviada');
  assert.deepEqual(calls.writes[0].fields, { 'Estado cotización': 'Enviada' });
});

test('el análisis de pérdidas clasifica cada motivo del selector', () => {
  const perdidaCat = new Function(
    `${extractDeclaration(/const _PERDIDA_CATS=\[[\s\S]*?\n\];/, '_PERDIDA_CATS')}\n${extractFunction('_perdidaCat')}\nreturn _perdidaCat;`
  )();
  for (const motivo of AIRTABLE_MOTIVOS_RECHAZO)
    assert.notEqual(perdidaCat(motivo), 'Sin motivo', `${motivo} debe contar como motivo registrado`);
  assert.equal(perdidaCat('Precio muy alto'), 'Precio');
  assert.equal(perdidaCat('Plazo muy largo'), 'Plazo / tiempo');
  assert.equal(perdidaCat('Eleigió competencia'), 'Se fue a la competencia');
  assert.equal(perdidaCat('Proyecto cancelado'), 'Ya no lo necesita');
});

test('rechazar desde Operativo cierra el drawer modal antes de abrir el selector', () => {
  const op = fs.readFileSync(path.join(JS_DIR, 'operativo-visual.js'), 'utf8');
  const branch = op.slice(op.indexOf("if(a==='quote-status')"), op.indexOf("if(a==='quote-linked-order')"));
  const close = branch.search(/estado===['"]Rechazada['"]\)\$\(['"]opDrawer['"]\)\?\.close\(\)/);
  const update = branch.indexOf('await updateCotizacionEstado(id,estado)');
  assert.ok(close >= 0, 'Un <dialog> abierto con showModal() deja inerte el selector');
  assert.ok(update > close, 'El drawer debe cerrarse antes de pedir el motivo');
});
