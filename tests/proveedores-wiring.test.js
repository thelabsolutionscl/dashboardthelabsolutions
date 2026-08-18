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
function unique(name, text = PROV) {
  assert.equal(
    count(new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g'), text),
    1,
    `${name} debe existir exactamente una vez`
  );
}
function balancedEnd(source, openIndex) {
  let depth = 0, quote = null, lineComment = false, blockComment = false;
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

test('PROVEEDORES conserva navegación y contenedores esenciales', () => {
  assert.equal(count(/id=["']tab-proveedores["']/g, INDEX), 1);
  assert.match(INDEX, /switchTab\(\s*['"]proveedores['"]\s*\)/);
  assert.match(INDEX, /switchTabMobile\(\s*['"]proveedores['"]\s*\)/);
  assert.equal(count(/<script[^>]+src=["']js\/proveedores\.js\?v=/g, INDEX), 1);
  for (const id of ['proveedoresTableBody', 'proveedorSearch', 'proveedorCatFilter', 'mejorPrecioProv', 'ocList', 'ocModal']) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones principales no se redefinen silenciosamente', () => {
  [
    'pvCat', 'fillCatSelects', 'renderPvCatChips', 'renderCatManager',
    'renderProveedores', 'updateRepProveedor', 'setProvEstadoPost',
    'saveProvMotivo', 'createProveedor', 'saveEditProveedor',
    'bulkDeleteProveedores', 'bulkEditProveedorEstado', 'deleteProveedor',
    '_preciosProv', '_preciosProvSaveArr', '_preciosProvBackup',
    '_preciosDeProv', 'addPrecioProv', 'delPrecioProv',
    '_mejorPrecioPorItem', 'renderMejorPrecio', '_ocAll', '_ocSaveArr',
    '_ocBackup', '_ocNextNum', 'openOCModal', 'ocAddRow', 'ocCalc',
    'guardarOC', 'delOC', 'generarOCPDF', 'renderOCList', 'exportToCSV'
  ].forEach(name => unique(name));
});

test('crear y editar validan identidad antes de escribir en Airtable', () => {
  const create = fn('createProveedor');
  const edit = fn('saveEditProveedor');
  for (const block of [create, edit]) {
    assert.match(block, /Nombre requerido/);
    assert.match(block, /Selecciona al menos una categor/i);
    assert.match(block, /validEmail/);
    assert.match(block, /validPhone/);
    assert.match(block, /validRUT/);
  }
  assert.match(create, /airtableWrite\(['"]Proveedores['"]\s*,\s*['"]POST['"]/);
  assert.match(edit, /airtableWrite\(['"]Proveedores['"]\s*,\s*['"]PATCH['"]/);
});

test('reputación y postulación aplican actualización optimista con rollback', () => {
  const rep = fn('updateRepProveedor');
  const post = fn('setProvEstadoPost');
  assert.match(rep, /Reputación/);
  assert.match(rep, /airtableWrite\(['"]Proveedores['"]\s*,\s*['"]PATCH['"]/);
  assert.match(rep, /catch[\s\S]*old/);
  assert.match(post, /Estado postulación/);
  assert.match(post, /catch[\s\S]*old/);
  assert.match(PROV, /ENTREVISTAR/);
  assert.match(PROV, /APROBADO/);
  assert.match(PROV, /RECHAZADO/);
  assert.match(fn('saveProvMotivo'), /Motivo evaluación/);
});

test('la ficha conecta pedidos, evaluación e historial de precios', () => {
  // renderProveedores quedó como orquestador; la ficha se arma en
  // buildProveedorRow, que es donde deben vivir los vínculos.
  const render = fn('renderProveedores');
  assert.match(render, /state\.proveedores/);
  assert.match(render, /buildProveedorRow/, 'el listado debe delegar la ficha en buildProveedorRow');
  const ficha = fn('buildProveedorRow');
  assert.match(ficha, /state\.pedidos/);
  assert.match(ficha, /Pedidos activos vinculados/);
  assert.match(ficha, /Estado postulación/);
  assert.match(ficha, /_preciosProvFichaHtml/);
  assert.match(PROV, /Motivo evaluación/);
});

test('el formulario público aplica controles antiabuso y crea postulación', () => {
  assert.match(WORKER, /url\.pathname\s*===\s*["']\/proveedor["']/);
  const handler = fn('handleProveedor', WORKER);
  assert.match(handler, /X-Public-Lead-Key/);
  assert.match(handler, /company_website|_hp/);
  assert.match(handler, /verifyTurnstile/);
  assert.match(handler, /rateLimited\([^)]*["']proveedor["'][^)]*5[^)]*60/);
  assert.match(handler, /Falta el nombre del proveedor/);
  assert.match(handler, /Falta email o teléfono/);
  assert.match(handler, /airtableCreateTolerant\([^)]*["']Proveedores["']/);
  assert.match(handler, /ENTREVISTAR/);
  assert.match(handler, /sendProveedorNotification/);
});

test('precios se comparan por ítem y tienen respaldo best-effort', () => {
  // La lectura pasa por el helper de listas compartidas: guarda igual en el
  // navegador, pero filtra los borrados y permite fusionar con el otro equipo
  // en vez de pisarlo (ver tests/listas-compartidas.test.js).
  assert.match(fn('_preciosProv'), /_listaVivos\(_PRECIOS_PROV_KEY\)/);
  assert.match(fn('_preciosProvSaveArr'), /_listaGuardar\(_PRECIOS_PROV_KEY/);
  assert.match(fn('_preciosProvSaveArr'), /_preciosProvBackup/);
  assert.match(fn('_preciosProvBackup'), /_monitorUpsert\(['"]PRECIOS_PROV['"]/);
  assert.match(fn('_mejorPrecioPorItem'), /precio\s*<\s*best\[key\]\.precio/);
  // La clave incluye la UNIDAD: no se comparan precios de unidades distintas.
  assert.match(fn('_mejorPrecioPorItem'), /_precioKey\(p\.item,p\.unidad\)/);
  assert.match(fn('renderMejorPrecio'), /ultimoPorProv|último precio por proveedor/);
});

test('órdenes de compra calculan, respaldan y generan documento', () => {
  assert.match(fn('_ocSaveArr'), /_ocBackup/);
  assert.match(fn('_ocBackup'), /_monitorUpsert\(['"]ORDENES_COMPRA['"]/);
  assert.match(fn('_ocNextNum'), /OC-/);
  const save = fn('guardarOC');
  assert.match(save, /estado\s*:\s*['"]Emitida['"]/);
  assert.match(save, /_ocSaveArr/);
  const calc = fn('ocCalc');
  assert.match(calc, /0\.19/);
  assert.match(calc, /ocNeto/);
  assert.match(calc, /ocIva/);
  assert.match(calc, /ocTotal/);
  assert.match(fn('generarOCPDF'), /window\.print|print\(\)/);
});

test('la exportación CSV incluye proveedores, escape y BOM UTF-8', () => {
  const csv = fn('exportToCSV');
  assert.match(csv, /t===['"]proveedores['"]/);
  assert.match(csv, /replace\(\/"\/g\s*,\s*['"]""['"]\)/);
  assert.match(csv, /\\uFEFF/);
  assert.match(csv, /text\/csv/);
});

test('RBAC declara el módulo Proveedores', () => {
  assert.match(INDEX, /RBAC[\s\S]*proveedores/);
  assert.match(INDEX, /nuevo-proveedor/);
});

// Hallazgos confirmados: deben convertirse en pruebas obligatorias al corregirse.
test('diagnóstico: pedidos y OC deben enlazar proveedores por record ID', (t) => {
  const render = fn('renderProveedores');
  const oc = fn('openOCModal');
  if (/\['Proveedor'\][\s\S]{0,180}nombre\.toLowerCase\(\)/.test(render) || /option value=.*Nombre/.test(oc)) {
    t.todo('CRÍTICO: reemplazar nombres/comas por supplierId estable; renombrar o duplicar nombres rompe pedidos, gasto, precios y OC');
    return;
  }
});

test('diagnóstico: el reintento de creación no debe duplicar registros', (t) => {
  const create = fn('createProveedor');
  if (/airtableWrite\(['"]Proveedores['"]\s*,\s*['"]POST['"][\s\S]*catch[\s\S]*airtableWrite\(['"]Proveedores['"]\s*,\s*['"]POST['"]/.test(create)) {
    t.todo('CRÍTICO: un timeout puede crear dos proveedores; usar idempotency key/upsert por RUT/email y reintentar solo rechazos de esquema confirmados');
    return;
  }
});

test('diagnóstico: editar debe permitir limpiar campos', (t) => {
  const edit = fn('saveEditProveedor');
  if (/Object\.keys\(fields\)[\s\S]*delete fields\[k\]/.test(edit)) {
    t.todo('borrar teléfono, notas, web o condiciones no persiste porque los valores vacíos se eliminan del PATCH');
    return;
  }
});

test('diagnóstico: categorías no deben depender de localStorage', (t) => {
  if (/function getPvCats\(\)[\s\S]{0,220}localStorage/.test(PROV)) {
    t.todo('categorías, orden y colores deben ser configuración compartida y migrable, no variar por navegador');
    return;
  }
});

test('diagnóstico: precios y OC no deben sincronizarse como blobs completos', (t) => {
  if (/localStorage/.test(fn('_preciosProvSaveArr')) && /localStorage/.test(fn('_ocSaveArr'))) {
    t.todo('PRECIOS_PROV y ORDENES_COMPRA requieren registros individuales/versionados; el blob completo pierde cambios concurrentes y auditoría');
    return;
  }
});

test('diagnóstico: numeración de OC debe ser atómica', (t) => {
  const next = fn('_ocNextNum');
  if (/_ocAll\(\)/.test(next) && /mx\+1/.test(next)) {
    t.todo('CRÍTICO: dos equipos pueden emitir el mismo OC-AAAA-NNN; reservar correlativo único en backend');
    return;
  }
});

test('diagnóstico: valoración no debe usar revenue del cliente', (t) => {
  const render = fn('renderProveedores');
  if (/Monto total \(CLP\)/.test(render) && /Total pedidos/.test(render)) {
    t.todo('“Total pedidos” suma la venta al cliente, no el costo, OC, factura o pago del proveedor');
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
  if (/airtableCreateTolerant/.test(handler) && !/idempot|dedup|upsert/i.test(handler)) {
    t.todo('POST /proveedor crea una fila por reintento; reservar idempotency key y resolver duplicados por RUT/email normalizado');
    return;
  }
});

test('diagnóstico: eliminar debe proteger dependencias', (t) => {
  const del = fn('deleteProveedor');
  if (/airtableDelete/.test(del) && !/pedido|orden|factura|depend|bloque/i.test(del)) {
    t.todo('archivar/bloquear proveedores con pedidos, OC, facturas, precios o evaluaciones; restaurar hoy crea otro record ID');
    return;
  }
});

test('diagnóstico: la recarga debe paginar', (t) => {
  const create = fn('createProveedor');
  if (/airtableFetch\(['"]Proveedores['"]\s*,\s*500\)/.test(create)) {
    t.todo('no truncar el maestro en 500; paginar y calcular estadísticas sobre el universo completo');
    return;
  }
});

test.todo('OC debe recorrer Borrador/Aprobada/Enviada/Aceptada/Recibida parcial/Cerrada/Cancelada con historial');
test.todo('OC y precios deben guardar supplierId, moneda, unidad, IVA/exención, vigencia, condiciones y documento fuente');
test.todo('la reputación debe derivarse de entregas reales y conservar cada evaluación');
test.todo('URLs, mailto, tel y WhatsApp deben validarse también para registros importados');
test.todo('CSV debe neutralizar fórmulas, respetar filtros y auditar exportaciones sensibles');
test.todo('autorización de lectura/escritura debe imponerse en backend por tabla, fila y campo');
