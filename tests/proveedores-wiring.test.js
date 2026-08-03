#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PROV = fs.readFileSync(path.join(ROOT, 'js', 'proveedores.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');
const SOURCE = `${INDEX}\n${PROV}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function count(re, text = SOURCE) {
  return (text.match(re) || []).length;
}
function uniqueFunction(name, text = PROV) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g');
  assert.equal(count(re, text), 1, `${name} debe existir exactamente una vez`);
}
function balancedEnd(source, openIndex) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i], n = source[i + 1], p = source[i - 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (c === quote && p !== '\\') quote = null; continue; }
    if (c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return i;
  }
  return -1;
}
function fn(name, text = PROV) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const found = re.exec(text);
  assert.ok(found, `falta ${name}()`);
  const open = text.indexOf('{', found.index);
  const end = balancedEnd(text, open);
  assert.notEqual(end, -1, `llaves desbalanceadas en ${name}()`);
  return text.slice(found.index, end + 1);
}

test('PROVEEDORES conserva navegación, sección y módulo únicos', () => {
  assert.equal(count(/id=["']tab-proveedores["']/g, INDEX), 1, '#tab-proveedores debe ser único');
  assert.match(INDEX, /switchTab\(\s*['"]proveedores['"]\s*\)/, 'falta navegación desktop');
  assert.match(INDEX, /switchTabMobile\(\s*['"]proveedores['"]\s*\)/, 'falta navegación móvil');
  assert.equal(count(/<script[^>]+src=["']js\/proveedores\.js\?v=/g, INDEX), 1, 'proveedores.js debe cargarse una vez');
});

test('la interfaz conserva tabla, filtros, ficha, precios y órdenes de compra', () => {
  for (const id of [
    'proveedoresTableBody', 'proveedorSearch', 'proveedorCatFilter', 'proveedoresBulkBar',
    'catManagerModal', 'editProveedorModal', 'mejorPrecioProv', 'ocList', 'ocModal',
    'ocProveedor', 'ocRows', 'ocNeto', 'ocIva', 'ocTotal'
  ]) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones principales no se redefinen silenciosamente', () => {
  [
    'pvCat', 'fillCatSelects', 'renderPvCatChips', 'openCatManager', 'renderCatManager',
    'addPvCat', 'deletePvCat', 'renderProveedores', 'toggleProveedorFicha',
    'updateRepProveedor', 'setProvEstadoPost', 'saveProvMotivo', 'createProveedor',
    'openEditProveedor', 'saveEditProveedor', 'bulkDeleteProveedores',
    'bulkEditProveedorEstado', 'deleteProveedor', '_preciosProv', '_preciosProvSaveArr',
    '_preciosDeProv', 'addPrecioProv', 'delPrecioProv', '_mejorPrecioPorItem',
    'renderMejorPrecio', '_ocAll', '_ocSaveArr', '_ocNextNum', 'openOCModal',
    'ocAddRow', 'ocCalc', 'guardarOC', 'delOC', 'generarOCPDF', 'renderOCList'
  ].forEach(name => uniqueFunction(name));
});

test('crear y editar validan identidad y escriben en Airtable', () => {
  const create = fn('createProveedor');
  const edit = fn('saveEditProveedor');
  for (const block of [create, edit]) {
    assert.match(block, /Nombre requerido/);
    assert.match(block, /Selecciona al menos una categor/i);
    assert.match(block, /validEmail/);
    assert.match(block, /validPhone/);
    assert.match(block, /validRUT/);
    assert.match(block, /airtableWrite\(['"]Proveedores['"]\s*,\s*['"](?:POST|PATCH)['"]/);
  }
  assert.match(create, /airtableFetch\(['"]Proveedores['"]\s*,\s*500\)/);
});

test('reputación y evaluación aplican actualización optimista con rollback', () => {
  const rep = fn('updateRepProveedor');
  assert.match(rep, /Reputación/);
  assert.match(rep, /airtableWrite\(['"]Proveedores['"]\s*,\s*['"]PATCH['"]/);
  assert.match(rep, /catch[\s\S]*old/);
  const post = fn('setProvEstadoPost');
  assert.match(post, /Estado postulación/);
  assert.match(post, /ENTREVISTAR|APROBADO|RECHAZADO/);
  assert.match(post, /catch[\s\S]*old/);
  assert.match(fn('saveProvMotivo'), /Motivo evaluación/);
});

test('la ficha conecta contacto, pedidos, postulación e historial de precios', () => {
  const render = fn('renderProveedores');
  assert.match(render, /state\.proveedores/);
  assert.match(render, /state\.pedidos/);
  assert.match(render, /WhatsApp/);
  assert.match(render, /Estado postulación/);
  assert.match(render, /Motivo evaluación/);
  assert.match(render, /_preciosProvFichaHtml/);
  assert.match(render, /Pedidos activos vinculados/);
});

test('el formulario público aplica controles antiabuso antes de crear', () => {
  assert.match(WORKER, /url\.pathname\s*===\s*["']\/proveedor["']/);
  const handler = fn('handleProveedor', WORKER);
  assert.match(handler, /X-Public-Lead-Key/);
  assert.match(handler, /company_website|_hp/);
  assert.match(handler, /verifyTurnstile/);
  assert.match(handler, /rateLimited\([^)]*["']proveedor["'][^)]*5[^)]*60/);
  assert.match(handler, /Falta el nombre del proveedor/);
  assert.match(handler, /Falta email o teléfono/);
  assert.match(handler, /airtableCreateTolerant\([^)]*["']Proveedores["']/);
  assert.match(handler, /Estado postulación[^\n]*ENTREVISTAR/);
  assert.match(handler, /sendProveedorNotification/);
});

test('precios se comparan por ítem y tienen respaldo remoto best-effort', () => {
  assert.match(fn('_preciosProv'), /localStorage/);
  assert.match(fn('_preciosProvSaveArr'), /_preciosProvBackup/);
  assert.match(fn('_preciosProvBackup'), /_monitorUpsert\(['"]PRECIOS_PROV['"]/);
  assert.match(fn('_normItem'), /normalize\(['"]NFD['"]\)/);
  assert.match(fn('_mejorPrecioPorItem'), /precio\s*<\s*best\[k\]\.precio/);
  assert.match(fn('renderMejorPrecio'), /último precio por proveedor|ultimoPorProv/);
});

test('órdenes de compra calculan totales, se respaldan y generan documento', () => {
  assert.match(fn('_ocSaveArr'), /_ocBackup/);
  assert.match(fn('_ocBackup'), /_monitorUpsert\(['"]ORDENES_COMPRA['"]/);
  assert.match(fn('_ocNextNum'), /OC-/);
  const save = fn('guardarOC');
  assert.match(save, /proveedor/);
  assert.match(save, /items/);
  assert.match(save, /estado\s*:\s*['"]Emitida['"]/);
  assert.match(save, /_ocSaveArr/);
  const calc = fn('ocCalc');
  assert.match(calc, /neto/);
  assert.match(calc, /0\.19/);
  assert.match(calc, /ocTotal/);
  assert.match(fn('generarOCPDF'), /window\.print|print\(\)/);
});

test('la exportación CSV escapa delimitadores y añade BOM UTF-8', () => {
  const csv = fn('exportToCSV');
  assert.match(csv, /t===['"]proveedores['"]/);
  assert.match(csv, /replace\(\/"\/g\s*,\s*['"]""['"]\)/);
  assert.match(csv, /\\uFEFF/);
  assert.match(csv, /text\/csv/);
});

test('RBAC declara acceso y escritura de Proveedores', () => {
  assert.match(INDEX, /RBAC[\s\S]*tabs[\s\S]*proveedores/);
  assert.match(INDEX, /canWrite[\s\S]*Proveedores|Proveedores[\s\S]*canWrite/);
  assert.match(INDEX, /canDelete[\s\S]*Proveedores|Proveedores[\s\S]*canDelete/);
});

// Hallazgos confirmados: se vuelven pruebas obligatorias al implementar cada corrección.
test('diagnóstico: pedidos y OC deben enlazar proveedores por record ID', (t) => {
  const render = fn('renderProveedores');
  const oc = fn('openOCModal');
  if (/\['Proveedor'\][\s\S]{0,120}toLowerCase\(\)[\s\S]{0,120}nombre\.toLowerCase\(\)/.test(render)
      || /option value=.*Nombre/.test(oc)) {
    t.todo('CRÍTICO: reemplazar nombres/comas por relaciones Airtable o supplierId estable; renombrar o duplicar nombres rompe pedidos, gasto y OC');
    return;
  }
});

test('diagnóstico: el reintento de creación no debe duplicar registros', (t) => {
  const create = fn('createProveedor');
  if (/airtableWrite\(['"]Proveedores['"]\s*,\s*['"]POST['"][\s\S]*catch[\s\S]*airtableWrite\(['"]Proveedores['"]\s*,\s*['"]POST['"]/.test(create)) {
    t.todo('CRÍTICO: un timeout o error incierto puede crear dos proveedores; usar idempotency key/upsert por RUT/email y reintentar solo errores de esquema comprobados');
    return;
  }
});

test('diagnóstico: editar debe permitir limpiar campos', (t) => {
  const edit = fn('saveEditProveedor');
  if (/Object\.keys\(fields\)[\s\S]*delete fields\[k\]/.test(edit)) {
    t.todo('en PATCH se eliminan valores vacíos del payload; borrar teléfono, notas, web o condiciones no persiste y deja datos obsoletos');
    return;
  }
});

test('diagnóstico: catálogos no deben depender de localStorage', (t) => {
  if (/function getPvCats\(\)[\s\S]{0,220}localStorage/.test(PROV)) {
    t.todo('categorías, orden y colores deben ser configuración autoritativa compartida; hoy difieren por navegador y no migran datos al renombrar/eliminar');
    return;
  }
});

test('diagnóstico: precios y OC no deben sincronizarse como un blob completo', (t) => {
  const prices = fn('_preciosProvSaveArr');
  const orders = fn('_ocSaveArr');
  if (/localStorage/.test(prices) && /localStorage/.test(orders)) {
    t.todo('PRECIOS_PROV y ORDENES_COMPRA requieren registros individuales/versionados; el JSON completo tiene last-write-wins, pérdida por concurrencia y sin auditoría');
    return;
  }
});

test('diagnóstico: numeración de OC debe ser atómica', (t) => {
  const next = fn('_ocNextNum');
  if (/_ocAll\(\)/.test(next) && /mx\+1/.test(next)) {
    t.todo('CRÍTICO: dos equipos pueden emitir el mismo OC-AAAA-NNN; reservar correlativo en backend mediante transacción/lock');
    return;
  }
});

test('diagnóstico: valoración de proveedor no debe usar venta del cliente', (t) => {
  const render = fn('renderProveedores');
  if (/Monto total \(CLP\)/.test(render) && /Total pedidos/.test(render)) {
    t.todo('“Total pedidos” suma el valor de venta al cliente, no el costo/OC/factura del proveedor; separar gasto real, comprometido, pagado y ahorro');
    return;
  }
});

test('diagnóstico: evaluación debe guardar evidencia y responsable', (t) => {
  const post = fn('setProvEstadoPost');
  if (/Estado postulación/.test(post) && !/Fecha|Responsable|Aprobado por|historial|evento/i.test(post)) {
    t.todo('APROBADO/RECHAZADO puede cambiarse sin motivo obligatorio, actor, fecha, checklist, documentos ni historial');
    return;
  }
});

test('diagnóstico: el endpoint público debe deduplicar postulaciones', (t) => {
  const handler = fn('handleProveedor', WORKER);
  if (/airtableCreateTolerant/.test(handler) && !/idempot|dedup|upsert|RUT.*filter|email.*filter/i.test(handler)) {
    t.todo('POST /proveedor crea una fila por cada reintento/envío; reservar por idempotency key y resolver duplicados por RUT/email normalizado');
    return;
  }
});

test('diagnóstico: eliminar proveedor debe proteger dependencias', (t) => {
  const del = fn('deleteProveedor');
  const bulk = fn('bulkDeleteProveedores');
  if (/airtableDelete/.test(del) && /airtableDelete/.test(bulk) && !/pedido|orden|factura|depend|bloque/i.test(del)) {
    t.todo('bloquear o archivar proveedores con pedidos, OC, facturas, precios o postulaciones; restaurar hoy crea otro record ID y bulk delete no tiene undo');
    return;
  }
});

test('diagnóstico: las lecturas deben paginar', (t) => {
  const create = fn('createProveedor');
  if (/airtableFetch\(['"]Proveedores['"]\s*,\s*500\)/.test(create)) {
    t.todo('no truncar maestro en 500; paginar y hacer búsquedas/estadísticas sobre el universo completo');
    return;
  }
});

test.todo('órdenes de compra deben tener estados Borrador/Aprobada/Enviada/Aceptada/Recibida parcial/Cerrada/Cancelada y trazabilidad de cambios');
test.todo('OC y precios deben guardar supplierId, moneda, unidad, IVA/exención, vigencia, condición de pago, documento fuente y archivos adjuntos');
test.todo('la reputación debe derivarse de entregas reales: calidad, puntualidad, precio, incidentes y muestra, conservando cada evaluación');
test.todo('URLs, mailto, tel y WhatsApp deben normalizarse y validarse también para registros importados, no solo formularios del dashboard');
test.todo('CSV debe neutralizar fórmulas, respetar filtros visibles y registrar exportaciones de datos sensibles');
test.todo('la autorización de lectura/escritura debe vivir en backend con políticas por campo; RBAC del navegador no basta');
