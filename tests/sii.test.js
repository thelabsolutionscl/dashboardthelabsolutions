#!/usr/bin/env node
/*
 * Facturación electrónica: folios del CAF y emisión de DTE al SII.
 *
 * Acá no hay "se arregla después". Un folio es un número que el SII autorizó una
 * sola vez: emitir dos documentos con el mismo folio es un problema tributario,
 * no un bug de pantalla. Cuatro cosas encontradas:
 *
 *   1. Sin TrackID no hay constancia de que el SII haya recibido nada, y el
 *      worker devolvía exactamente lo mismo que en un envío exitoso. El
 *      dashboard entonces decía "✅ DTE emitido", lo anotaba en el pedido y
 *      creaba la Factura con Estado SII "Enviado".
 *   2. La condición que decidía si el folio se marcaba consumido
 *      (estado !== '-11' && estado !== '-1') era código muerto: uploadDTE LANZA
 *      en esos dos casos y nunca llegaba ahí.
 *   3. Volver a subir el MISMO CAF rebobinaba el contador al inicio del rango:
 *      las siguientes facturas reusaban folios ya emitidos.
 *   4. Un CAF que no calzara con el patrón se convertía en el rango 1–100 sin
 *      decir una palabra.
 *
 * Correr:  node --test tests/sii.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(RAIZ, 'sii-worker', 'src', 'index.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(RAIZ, 'sii-worker', 'src', 'sii-auth.js'), 'utf8');
const FIN = fs.readFileSync(path.join(RAIZ, 'js', 'finanzas.js'), 'utf8');

function bloque(marca, src) {
  const s = src || IDX;
  const i = s.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = s.indexOf('{', i); x < s.length; x++) {
    if (s[x] === '{') d++;
    if (s[x] === '}') { d--; if (!d) return s.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// Funciones reales del worker, montadas sin red ni KV de verdad.
const { parseCafRange, validatePayload } = new Function(
  `${bloque('function parseCafRange(')}\n${bloque('function validatePayload(')}\nreturn {parseCafRange,validatePayload};`
)();

// Un KV de mentira, con la misma interfaz que usa el worker.
function kvFalso(inicial = {}) {
  const m = { ...inicial };
  return { get: async (k) => (k in m ? m[k] : null), put: async (k, v) => { m[k] = String(v); }, _datos: m };
}

const CAF = (d, h) => `<?xml version="1.0"?><AUTORIZACION><CAF version="1.0"><DA><RE>77499554-4</RE><TD>33</TD><RNG><D>${d}</D><H>${h}</H></RNG></DA></CAF></AUTORIZACION>`;

// handleCafUpload real, con el KV falso.
async function subirCaf(kv, tipo, cafXml) {
  const fn = bloque('async function handleCafUpload(');
  const mod = new Function('env', 'request', 'err', 'ok', 'parseCafRange', `${fn}\nreturn handleCafUpload(request, env);`);
  let salida = null;
  return await mod(
    { FOLIOS_KV: kv },
    { json: async () => ({ tipo_documento: tipo, caf_xml: cafXml }) },
    (msg, status) => (salida = { error: msg, status }),
    (data) => (salida = data),
    parseCafRange
  ).then(() => salida);
}

// ── El rango del CAF ────────────────────────────────────────────────────

test('lee el rango real de un CAF', () => {
  assert.deepEqual(parseCafRange(CAF(101, 200)), { desde: 101, hasta: 200 });
});

test('un CAF ilegible se rechaza, no se convierte en 1–100', () => {
  // Ese default silencioso habría emitido documentos con folios que el SII
  // nunca autorizó.
  for (const malo of ['', '<xml/>', '<CAF><DA><RNG></RNG></DA></CAF>', CAF(500, 100), CAF(0, 10)]) {
    assert.throws(() => parseCafRange(malo), /CAF inválido/, `debió rechazar: ${String(malo).slice(0, 40)}`);
  }
  assert.doesNotMatch(IDX, /\|\| '100'\)/, 'no puede quedar el 1–100 por defecto');
});

// ── Subir un CAF no puede rebobinar folios ──────────────────────────────

test('re-subir el MISMO CAF conserva el contador de folios', async () => {
  // Ya se emitieron los folios 101..150 de este CAF.
  const kv = kvFalso({ caf_33: CAF(101, 200), folio_33: '150' });
  const r = await subirCaf(kv, '33', CAF(101, 200));
  assert.equal(kv._datos.folio_33, '150', 'el contador NO puede volver a 100');
  assert.equal(r.siguiente_folio, 151, 'la siguiente factura sigue donde iba');
  assert.equal(r.contador_conservado, true);
});

test('un CAF nuevo de verdad sí parte desde su inicio', async () => {
  const kv = kvFalso({ caf_33: CAF(101, 200), folio_33: '200' });   // rango anterior agotado
  const r = await subirCaf(kv, '33', CAF(201, 300));
  assert.equal(kv._datos.folio_33, '200', 'queda justo antes del primer folio nuevo');
  assert.equal(r.siguiente_folio, 201);
  assert.equal(r.contador_conservado, false);
});

test('el primer CAF de un tipo parte desde el inicio del rango', async () => {
  const kv = kvFalso();
  const r = await subirCaf(kv, '33', CAF(1, 50));
  assert.equal(r.siguiente_folio, 1);
  assert.equal(kv._datos.caf_33.includes('<D>1</D>'), true);
});

test('un CAF ilegible no se guarda ni toca el contador', async () => {
  const kv = kvFalso({ caf_33: CAF(101, 200), folio_33: '150' });
  const r = await subirCaf(kv, '33', '<basura/>');
  assert.equal(r.status, 400, 'se rechaza con 400, no con un 500 genérico');
  assert.match(r.error, /CAF inválido/);
  assert.equal(kv._datos.folio_33, '150', 'el contador queda intacto');
  assert.ok(kv._datos.caf_33.includes('<D>101</D>'), 'y el CAF bueno sigue ahí');
});

// ── Consumir el folio ───────────────────────────────────────────────────

test('la condición muerta se fue y el folio se consume siempre que se llegó a enviar', () => {
  // uploadDTE LANZA en -11 y -1, así que esa condición nunca podía ser falsa.
  assert.match(AUTH, /if \(estado === '-11'\) throw new Error/);
  assert.match(AUTH, /if \(estado === '-1'\)\s+throw new Error/);
  const fn = bloque('async function handleEmitDTE(');
  assert.doesNotMatch(fn, /siiResult\.estado !== '-11'/, 'era código muerto');
  assert.match(fn, /await env\.FOLIOS_KV\.put\(`folio_\$\{data\.tipo_documento\}`, String\(folio\)\);/);
  // Y el motivo tiene que estar escrito: es una decisión, no un descuido.
  assert.match(fn, /dos documentos tributarios con el mismo número/);
});

test('sin TrackID el worker no lo hace pasar por envío exitoso', () => {
  const fn = bloque('async function handleEmitDTE(');
  assert.match(fn, /const recibido = !!siiResult\.trackid;/);
  assert.match(fn, /recibido,/, 'debe viajar en la respuesta');
  assert.match(fn, /aviso: recibido \? null/, 'y un aviso accionable cuando no');
  assert.match(fn, /portal del SII antes de volver a emitir/);
});

// ── Totales del documento ───────────────────────────────────────────────

test('un DTE con totales que no cuadran se rechaza antes de gastar un folio', () => {
  const base = {
    tipo_documento: '33',
    receptor: { rut: '11111111-1', razon_social: 'Cliente SpA' },
    detalle: [{ nombre: 'x', cantidad: 1, precio_unitario: 100000 }],
  };
  // 100.000 + 19.000 = 119.000 ✓
  assert.doesNotThrow(() => validatePayload({ ...base, totales: { neto: 100000, iva: 19000, total: 119000 } }));
  // Un peso de holgura por el redondeo del IVA.
  assert.doesNotThrow(() => validatePayload({ ...base, totales: { neto: 100000, iva: 19000, total: 119001 } }));
  // Exenta total: sin IVA, total = neto.
  assert.doesNotThrow(() => validatePayload({ ...base, totales: { neto: 50000, iva: 0, total: 50000 } }));
  // Con parte exenta.
  assert.doesNotThrow(() => validatePayload({ ...base, totales: { neto: 100000, exento: 5000, iva: 19000, total: 124000 } }));
  // Y lo que no cuadra, no pasa.
  assert.throws(() => validatePayload({ ...base, totales: { neto: 100000, iva: 19000, total: 200000 } }), /totales inconsistentes/);
  assert.throws(() => validatePayload({ ...base, totales: { neto: 100000, iva: 0, total: 119000 } }), /totales inconsistentes/);
});

test('las validaciones de siempre siguen en pie', () => {
  const t = { neto: 100000, iva: 19000, total: 119000 };
  assert.throws(() => validatePayload({ tipo_documento: '99', receptor: { rut: '1', razon_social: 'x' }, detalle: [1], totales: t }), /tipo_documento/);
  assert.throws(() => validatePayload({ tipo_documento: '33', receptor: { razon_social: 'x' }, detalle: [1], totales: t }), /receptor\.rut/);
  assert.throws(() => validatePayload({ tipo_documento: '33', receptor: { rut: '1', razon_social: 'x' }, detalle: [], totales: t }), /detalle/);
  assert.throws(() => validatePayload({ tipo_documento: '33', receptor: { rut: '1', razon_social: 'x' }, detalle: [1], totales: { neto: 0, total: 1 } }), /neto/);
});

// ── El dashboard ────────────────────────────────────────────────────────

test('el dashboard no canta "DTE emitido" sin confirmación del SII', () => {
  const fn = bloque('async function emitirDTE(', FIN);
  assert.match(fn, /const _recibido=\(resp\.recibido!==false\)&&!!_trackId;/);
  assert.match(fn, /if\(_recibido\)\{/, 'el ✅ va dentro del caso confirmado');
  // El aviso del worker se muestra tal cual, y si no viene hay uno propio.
  assert.match(fn, /resp\.aviso\|\|/);
  assert.match(fn, /El folio queda consumido/, 'hay que decir que el folio se gastó');
  assert.match(fn, /portal del SII/, 'y dónde verificar');
});

test('una factura sin confirmar no se guarda como "Enviado"', () => {
  const fn = bloque('async function emitirDTE(', FIN);
  assert.match(fn, /'Estado SII':_recibido\?\(resp\.estado_sii\|\|resp\.estado\|\|'Enviado'\):'Sin confirmar'/);
  assert.match(fn, /'Track ID':_trackId/);
});

test('el número de DTE se sigue guardando aunque Airtable falle', () => {
  // Ya estaba bien: el folio se consumió en el SII pase lo que pase acá.
  const fn = bloque('async function emitirDTE(', FIN);
  assert.match(fn, /avisoNoGuardado\(`el DTE N° \$\{dteNum\}/);
  assert.match(fn, /ya fue emitido en el SII/);
});

// ── La puerta del worker ────────────────────────────────────────────────

test('el worker que emite documentos tributarios pide clave', () => {
  assert.match(IDX, /if \(env\.WORKER_KEY && url\.pathname !== '\/health'\)/);
  assert.match(IDX, /timingSafeEqual\(key, env\.WORKER_KEY\)/, 'comparación en tiempo constante');
  const fn = bloque('function timingSafeEqual(');
  assert.match(fn, /diff \|= x\.charCodeAt\(i\) \^ y\.charCodeAt\(i\)/);
  // /health no puede filtrar el RUT del emisor.
  const h = IDX.slice(IDX.indexOf("url.pathname === '/health'"), IDX.indexOf("url.pathname === '/health'") + 500);
  assert.match(h, /rut_emisor_configurado: !!env\.RUT_EMISOR/, 'solo si está configurado, no cuál es');
  assert.doesNotMatch(h, /rut_emisor: env\.RUT_EMISOR/);
});
