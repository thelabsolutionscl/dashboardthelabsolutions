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
const PROXY = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'worker.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'access-auth.js'), 'utf8');
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
  assert.match(ficha, /_supplierPedidos\(supplierId\)/);
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
  assert.match(handler, /SUPPLIER_APPLICATION_GUARD/);
  assert.match(WORKER, /supplierApplicationProcess[\s\S]*airtableCreateTolerant\(env,[\s\S]*["']Proveedores["']/);
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
  assert.match(save, /estado:id\?\(arr\.find[\s\S]*'Borrador'\):'Borrador'/);
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
test('pedidos, precios y OC usan supplierId estable y toleran nombres legacy solo como migración', () => {
  assert.match(PROV,/function _supplierId\(rec\)/);
  assert.match(PROV,/function _supplierPedidoIds\(pedido\)/);
  assert.match(PROV,/function _supplierPedidos\(supplierId\)/);
  const card=fn('buildProveedorCard'),row=fn('buildProveedorRow'),oc=fn('openOCModal');
  assert.match(card,/_supplierPedidos\(supplierId\)/);
  assert.match(row,/_supplierPedidos\(supplierId\)/);
  assert.match(oc,/<option value="\$\{p\.id\}"/);
  assert.match(fn('guardarOC'),/supplierId/);
  assert.match(fn('addPrecioProv'),/supplierId/);
  assert.match(fn('_preciosDeProv'),/p\.supplierId\|\|_supplierResolveId\(p\.prov\)/);
});

test('crear proveedor solo reintenta tras rechazo de esquema confirmado', () => {
  const create = fn('createProveedor');
  const guard = fn('_pvCanRetryCreateAfterError');
  assert.match(guard, /422|UNKNOWN_FIELD_NAME/, 'el fallback exige una respuesta de esquema confirmada');
  assert.match(guard, /timeout|network|failed to fetch|5\\d\\d/i, 'timeout/red/5xx deben quedar fuera del retry');
  assert.match(create, /if\(!_pvCanRetryCreateAfterError\(e\)\) throw e;/);
  assert.match(create, /try\{await refresh\(\);\}[\s\S]*catch\(refreshErr\)/, 'un fallo de refresh no puede volver a ejecutar POST');
  assert.match(create, /finally\{[\s\S]*btn\.disabled=false/, 'el botón siempre se restaura');
});

test('editar permite limpiar campos vacíos en Airtable', () => {
  const edit = fn('saveEditProveedor');
  assert.doesNotMatch(edit, /Object\.keys\(fields\)[\s\S]*delete fields\[k\]/, 'no debe quitar vacíos del PATCH');
  assert.match(edit, /'Teléfono':document\.getElementById\('epTelefono'\)\.value\|\|''/);
  assert.match(edit, /'Notas':document\.getElementById\('epNotas'\)\.value\|\|''/);
  assert.match(edit, /await airtableWrite\('Proveedores','PATCH',id,fields\)/);
});

test('categorías compartidas son autoritativas y localStorage queda solo como fallback', () => {
  assert.match(PROV,/let _supplierCategoryRows=\[\]/);
  assert.match(PROV,/airtableFetch\('SupplierCategories',1000\)/);
  assert.match(PROV,/_syncSupplierCategories\(arr\)/);
  assert.match(PROV,/airtableWrite\('SupplierCategories','POST'/);
  assert.match(PROV,/airtableWrite\('SupplierCategories','PATCH'/);
  assert.match(PROV,/async function renamePvCat/);
  assert.match(fn('deletePvCat'),/No se puede eliminar una categoría en uso/);
  assert.match(ACCESS,/SupplierCategories/);
  assert.match(PROXY,/SupplierCategories:Object\.freeze/);
});

test('precios y OC nuevas se guardan como registros individuales, no blobs compartidos', () => {
  assert.match(PROV,/airtableFetch\('SupplierPrices',1000\)/);
  assert.match(PROV,/airtableFetch\('PurchaseOrders',1000\)/);
  assert.match(PROV,/airtableFetch\('PurchaseOrderItems',2000\)/);
  assert.match(fn('addPrecioProv'),/airtableWrite\('SupplierPrices','POST'/);
  assert.match(fn('guardarOC'),/airtableWrite\('PurchaseOrders','POST'/);
  assert.match(fn('guardarOC'),/airtableWrite\('PurchaseOrderItems','POST'/);
  assert.match(fn('guardarOC'),/airtableWrite\('PurchaseOrderEvents','POST'/);
  assert.doesNotMatch(fn('addPrecioProv'),/_preciosProvSaveArr/);
  assert.doesNotMatch(fn('guardarOC'),/_ocSaveArr/);
});

test('numeración nueva de OC se reserva atómicamente en backend', () => {
  assert.match(PROV,/async function _ocReserveNum\(\)/);
  assert.match(fn('guardarOC'),/await _ocReserveNum\(\)/);
  assert.match(PROXY,/supplier\/purchase-order\/reserve/);
  assert.match(PROXY,/_handleSupplierPoReserve/);
  assert.match(PROXY,/supplier-po-seq:/);
  assert.match(PROXY,/state\.storage\.put\(key,next\)/);
  assert.match(ACCESS,/path==='\/supplier\/purchase-order\/reserve'/);
});

test('ficha de proveedor no presenta revenue del cliente como gasto del proveedor', () => {
  const card=fn('buildProveedorCard'),row=fn('buildProveedorRow');
  assert.doesNotMatch(card,/Monto total \(CLP\)|formatCLP\(total\)/);
  assert.doesNotMatch(row,/pvTotalValor|Total pedidos:/);
  assert.match(row,/costos del proveedor se muestran desde OC\/precios/);
});

test('aprobar o rechazar exige motivo/evidencia y conserva actor, fecha e historial', () => {
  const post=fn('setProvEstadoPost');
  assert.match(post,/reason\.length<8/);
  assert.match(post,/Evidencia \/ referencia/);
  assert.match(post,/AUTH\.getUser/);
  assert.match(post,/new Date\(\)\.toISOString\(\)/);
  assert.match(post,/Responsable:/);
  assert.match(post,/'Notas':prevNotes/);
});

test('endpoint público serializa idempotencia y deduplica por RUT/email/nombre antes de crear', () => {
  const handler=fn('handleProveedor',WORKER);
  assert.match(handler,/supplierIdentityKey/);
  assert.match(handler,/SUPPLIER_APPLICATION_GUARD/);
  assert.match(WORKER,/export class SupplierApplicationGuard/);
  assert.match(WORKER,/airtableFindProveedor/);
  assert.match(WORKER,/supplierNormRut/);
  assert.match(WORKER,/supplierNormEmail/);
  assert.match(WORKER,/supplierApplicationProcess/);
});

test('eliminar protege dependencias y conserva supplierId archivando', () => {
  assert.match(PROV,/function _supplierDependencies\(id\)/);
  const del=fn('deleteProveedor');
  assert.match(del,/_supplierDependencies\(id\)/);
  assert.match(del,/_archiveSupplier\(id,nombre\)/);
  assert.match(fn('bulkDeleteProveedores'),/deps\.total/);
  assert.match(fn('bulkDeleteProveedores'),/'Estado':'Inactivo'/);
});

test('la recarga del maestro supera el antiguo corte de 500 y usa helper paginado', () => {
  const create=fn('createProveedor');
  assert.match(create,/airtableFetch\('Proveedores',2000\)/);
  assert.doesNotMatch(create,/airtableFetch\('Proveedores',500\)/);
});

test('duplicados del dashboard se detectan por RUT, email o razón social normalizados', () => {
  assert.match(PROV,/function _supplierFindDuplicate/);
  assert.match(fn('createProveedor'),/_supplierFindDuplicate/);
  assert.match(fn('saveEditProveedor'),/_supplierFindDuplicate/);
  assert.match(PROV,/_normSupplierRut/);
  assert.match(PROV,/_normSupplierEmail/);
});

test('datos importados se validan antes de construir mailto, tel, WhatsApp o enlaces web', () => {
  assert.match(PROV,/function _safeSupplierEmail/);
  assert.match(PROV,/function _safeSupplierPhone/);
  assert.match(PROV,/function _safeSupplierUrl/);
  assert.match(PROV,/u\.protocol==='https:'/);
  assert.doesNotMatch(fn('buildProveedorCard'),/web\.startsWith\('http'\)/);
});

test('CSV de proveedores respeta búsqueda/categoría y neutraliza fórmulas', () => {
  const csv=fn('exportToCSV');
  assert.match(csv,/proveedorSearch/);
  assert.match(csv,/proveedorCatFilter/);
  assert.match(csv,/\^\[=\+\\-@\]/);
  assert.match(csv,/supplierId/);
});

test('OC recorre ciclo auditable y registra recepción por ítem', () => {
  assert.match(PROV,/function _ocAllowedNext\(estado\)/);
  assert.match(PROV,/'Borrador':\['Aprobación','Cancelada'\]/);
  assert.match(PROV,/'Aprobada':\['Enviada','Cancelada'\]/);
  assert.match(PROV,/'Enviada':\['Aceptada','Cancelada'\]/);
  assert.match(PROV,/'Aceptada':\['Recibida parcial','Recibida total','Cancelada'\]/);
  assert.match(PROV,/'Facturada':\['Pagada','Cerrada'\]/);
  assert.match(fn('cambiarEstadoOC'),/PurchaseOrderEvents/);
  assert.match(fn('registrarRecepcionOC'),/'Cantidad recibida'/);
  assert.match(fn('registrarRecepcionOC'),/'Estado recepción'/);
});

test('OC y precios conservan supplierId y metadatos estructurados', () => {
  const price=fn('addPrecioProv'),po=fn('guardarOC');
  assert.match(price,/'Supplier ID':supplierId/);
  assert.match(price,/'Moneda':'CLP'/);
  assert.match(price,/'Unidad':unidad/);
  assert.match(price,/'Impuesto \(%\)':19/);
  assert.match(price,/'Vigente desde':fecha/);
  assert.match(price,/'Documento fuente':nota/);
  assert.match(po,/'Condiciones de pago'/);
  assert.match(po,/'Impuesto':impuesto/);
  assert.match(po,/'Idempotency key':crypto\.randomUUID\(\)/);
  assert.match(po,/'Exento':false/);
});

test('reputación se deriva del historial y el agregado ya no se edita directamente', () => {
  assert.match(PROV,/function _supplierDerivedReputation/);
  assert.match(PROV,/SupplierEvaluations/);
  assert.match(fn('updateRepProveedor'),/'Calidad':calidad/);
  assert.match(fn('updateRepProveedor'),/'Puntualidad':puntualidad/);
  assert.match(fn('updateRepProveedor'),/'Precio':precio/);
  assert.match(fn('updateRepProveedor'),/'Incidentes':incidentes/);
  assert.doesNotMatch(fn('createProveedor'),/'Reputación':parseInt/);
  assert.doesNotMatch(fn('saveEditProveedor'),/'Reputación':parseInt/);
  assert.match(PROV,/_lockSupplierRepInputs/);
});

test('URLs, mailto, tel y WhatsApp se validan también para registros importados', () => {
  assert.match(PROV,/function _safeSupplierEmail/);
  assert.match(PROV,/function _safeSupplierPhone/);
  assert.match(PROV,/function _safeSupplierUrl/);
  assert.match(PROV,/u\.protocol==='https:'/);
});

test('CSV neutraliza fórmulas, respeta filtros y registra auditoría', () => {
  const csv=fn('exportToCSV');
  assert.match(csv,/proveedorSearch/);
  assert.match(csv,/proveedorCatFilter/);
  assert.match(csv,/\^\[=\+\\-@\]/);
  assert.match(csv,/officeAuditAction\('export','proveedores-csv'/);
});

test('backend impone catálogo de tablas, campos y métodos para proveedores auditables', () => {
  for(const table of ['SupplierPrices','PurchaseOrders','PurchaseOrderItems','PurchaseOrderEvents','SupplierEvaluations','SupplierCategories']){
    assert.match(ACCESS,new RegExp(table));
    assert.match(PROXY,new RegExp(table+':Object\\.freeze'));
  }
  assert.match(PROXY,/operatorWritePayloadAllowed/);
  assert.match(PROXY,/operatorFieldValueAllowed/);
  assert.match(ACCESS,/supplier\/purchase-order\/reserve/);
});
