#!/usr/bin/env node
/*
 * Documentos que salen hacia el cliente: cotización PDF y ficha técnica.
 *
 * Un documento no puede afirmar cosas que el sistema no hace. Contrastado
 * contra las 53 cotizaciones reales de la base (agosto 2026):
 *
 *   - Las 53 CUADRAN: la suma de los ítems es exactamente el neto del total
 *     (Total/1,19), y la única con descuento (260725, 5 %) también. El bloque
 *     de totales está sano y estas pruebas lo dejan clavado.
 *   - Pero la franja de urgencia decía "se aplica recargo del 25 %" y el
 *     recargo NO existe: "Urgencia (+25%)" es solo una marca — se guarda, se
 *     ordena por ella y se pinta, pero no multiplica nada en ninguna parte del
 *     código. Las dos cotizaciones marcadas urgentes (260802 y 260615) tienen
 *     recargo real 0,00 %. Al cliente se le decía que pagaba un 25 % extra que
 *     no estaba en los números.
 *   - Una cotización en estado "Solicitada" no tiene vencimiento guardado, y
 *     el documento salía con "Válida hasta: —" justo al lado de "válida por 10
 *     días hábiles".
 *
 * Correr:  node --test tests/documentos.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PDF = fs.readFileSync(path.join(RAIZ, 'js', 'pdf-fichas.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

function bloque(marca, src) {
  const s = src || PDF;
  const i = s.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = s.indexOf('{', i); x < s.length; x++) {
    if (s[x] === '{') d++;
    if (s[x] === '}') { d--; if (!d) return s.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// El parser de líneas del documento, tal cual está en el módulo.
const LINEA_PARSER = PDF.split('\n').find((l) => l.includes('const lineas=detalle.split'));
const parseaLineas = new Function('detalle', `${LINEA_PARSER.trim()} return lineas;`);

// Cotizaciones reales de la base. total = "Total final (CLP)" (con IVA).
const REALES = [
  ['260516', 159800, 'A | 1 und. | Costo: $47.000 | Venta: $134.286', 0, false],
  ['260712', 7345037, 'A | 14 und. | Costo: $3.024.000 | Venta: $5.497.800\nB | 5 und. | Costo: $360.000 | Venta: $659.500\nC | 1 und. | Costo: $15.000 | Venta: $15.000', 0, false],
  ['260722', 469255, 'A | 1 und. | Costo: $40.210 | Venta: $89.350\nB | 1 und. | Costo: $34.434 | Venta: $76.333\nC | 1 und. | Costo: $60.220 | Venta: $130.889\nD | 1 und. | Costo: $43.992 | Venta: $97.760', 0, false],
  ['260718', 369209, 'A | 10 und. | Costo: $3.220 | Venta: $11.930\nB | 10 und. | Costo: $2.980 | Venta: $11.040\nC | 10 und. | Costo: $3.460 | Venta: $12.810\nD | 10 und. | Costo: $6.680 | Venta: $24.740\nE | 10 und. | Costo: $6.920 | Venta: $25.630\nF | 10 und. | Costo: $6.920 | Venta: $25.630\nG | 10 und. | Costo: $14.800 | Venta: $54.810\nH | 10 und. | Costo: $30.800 | Venta: $114.070\nI | 10 und. | Costo: $9.100 | Venta: $29.600', 0, false],
  ['260804', 1462367, 'A | 40 und. | Costo: $135.200 | Venta: $614.440\nB | 40 und. | Costo: $135.200 | Venta: $614.440', 0, false],
  ['260708', 431313, 'A | 72 und. | Costo: $198.000 | Venta: $362.448', 0, false],
  ['260510', 832990, 'A | 2 und. | Costo: $52.000 | Venta: $107.692\nB | 20 und. | Costo: $60.000 | Venta: $92.300\nC | 20 und. | Costo: $240.000 | Venta: $500.000', 0, false],
  // La única con descuento: los ítems suman 594.000 y el neto es 564.300 (−5 %).
  ['260725', 671517, 'A | 1 und. | Costo: $250.000 | Venta: $569.000\nB | 1 und. | Costo: $15.000 | Venta: $25.000', 5, false],
  // Marcadas urgentes: el recargo real es 0 %.
  ['260802', 241570, 'A | 1 und. | Costo: $70.000 | Venta: $188.000\nB | 1 und. | Costo: $10.000 | Venta: $15.000', 0, true],
  ['260615', 7140000, 'A | 100 und. | Costo: $300.000 | Venta: $1.000.000\nB | 100 und. | Costo: $300.000 | Venta: $1.000.000\nC | 100 und. | Costo: $300.000 | Venta: $1.000.000\nD | 100 und. | Costo: $300.000 | Venta: $1.000.000\nE | 100 und. | Costo: $300.000 | Venta: $1.000.000\nF | 100 und. | Costo: $300.000 | Venta: $1.000.000', 0, true],
];

const suma = (detalle) => parseaLineas(detalle).reduce((s, l) => s + (l.ventaTotal || 0), 0);
const netoDe = (total) => Math.round(total / 1.19);

// ── El parser de líneas ─────────────────────────────────────────────────

test('lee cantidad y venta del formato real del detalle', () => {
  const [l] = parseaLineas('MEDALLA COPITO | 260 und. | Costo: $715.000 | Venta: $1.097.200');
  assert.equal(l.desc, 'MEDALLA COPITO');
  assert.equal(l.und, 260);
  assert.equal(l.ventaTotal, 1097200, 'los puntos de miles no pueden comerse el número');
  assert.equal(l.ventaUnit, Math.round(1097200 / 260));
});

test('una línea sin columna de costo sigue leyendo la venta', () => {
  const [l] = parseaLineas('ENVÍO | 1 und. | Venta: $15.000');
  assert.equal(l.ventaTotal, 15000);
});

// ── Los totales cuadran con los ítems ───────────────────────────────────

test('en las cotizaciones reales, los ítems suman el neto del total', () => {
  for (const [num, total, detalle, desc] of REALES) {
    const s = suma(detalle), neto = netoDe(total);
    if (desc > 0) {
      // Con descuento los ítems suman el subtotal SIN descontar.
      assert.ok(s > neto, `${num}: con descuento el subtotal debe ser mayor que el neto`);
      assert.equal(Math.round(s * (1 - desc / 100)), neto, `${num}: el descuento de ${desc}% debe explicar la diferencia`);
    } else {
      assert.equal(s, neto, `${num}: los ítems suman ${s} y el neto del total es ${neto}`);
    }
  }
});

test('el documento muestra el descuento cuando lo hay, y no lo inventa cuando no', () => {
  const fn = bloque('function buildCotizacionDoc(');
  assert.match(fn, /const sumaNeto=lineas\.reduce/, 'el subtotal sale de los ítems, no de otro campo');
  assert.match(fn, /const descMonto=sumaNeto-neto;/, 'y el descuento concilia ítems con neto');
  assert.match(fn, /hayDesc=descPct>0&&descMonto>0&&sumaNeto>0/, 'sin porcentaje declarado no se inventa una línea de descuento');
  assert.match(fn, /Subtotal neto/);
  assert.match(fn, /IVA \(19%\)/);
});

// ── La franja de urgencia ───────────────────────────────────────────────

test('la marca de urgencia no afirma un recargo que nadie aplica', () => {
  // Comprobado en las dos urgentes reales: recargo 0,00 %.
  for (const [num, total, detalle, , urgente] of REALES.filter((r) => r[4])) {
    assert.equal(suma(detalle), netoDe(total), `${num}: no hay ningún 25% en los números`);
    assert.ok(urgente);
  }
  assert.doesNotMatch(PDF, /se aplica recargo del 25%/, 'el documento no puede prometerle al cliente un recargo inexistente');
  assert.match(PDF, /urgente\?'<div class="urgente-strip">⚡ Cotización con urgencia/, 'la marca sí se sigue mostrando');
});

test('"Urgencia (+25%)" sigue siendo solo una marca en todo el código', () => {
  // Si algún día se convierte en aritmética, esta prueba avisa para que el
  // documento vuelva a decirlo.
  const fuente = HTML + PDF;
  assert.doesNotMatch(fuente, /Urgencia \(\+25%\)'\]\s*\?\s*1\.25/, 'nadie multiplica por 1,25');
  assert.doesNotMatch(fuente, /\*\s*1\.25/, 'ni aparece un factor 1,25 suelto');
});

// ── Vigencia ────────────────────────────────────────────────────────────

test('nunca se imprime "Válida hasta: —" junto a "válida por 10 días hábiles"', () => {
  // Una cotización en estado "Solicitada" no trae vencimiento guardado.
  const fn = bloque('function buildCotizacionDoc(');
  assert.match(fn, /vto=f\['Fecha vencimiento'\]\|\|\(typeof calBusinessDate==='function'\?calBusinessDate\(fecha,10\):'—'\)/);
  assert.match(fn, /Cotización válida por 10 días hábiles/, 'y la regla escrita sigue siendo 10');
  // La misma regla que usa el resto de la app al crear la cotización.
  assert.match(HTML, /calBusinessDate\(fechaCot,10\)/);
});

test('la fecha del documento se toma en hora de Chile', () => {
  assert.match(PDF, /fecha=f\['Fecha cotización'\]\|\|hoyCL\(\)/);
});

// ── Llaves y trabajo que cuesta plata ───────────────────────────────────

test('la API key de OpenAI se puede borrar de verdad', () => {
  const fn = bloque('function saveIAConfig(');
  assert.match(fn, /else localStorage\.removeItem\('fp_openai_key'\)/, 'vaciar el campo debe borrarla');
  assert.doesNotMatch(fn, /toast\([^)]*Sin API key configurada/, 'no puede decir que no hay key mientras la guarda');
  assert.match(fn, /borrada de este navegador/, 'y debe decir exactamente qué pasó');
});

test('si las imágenes de la propuesta no caben, se avisa', () => {
  // Cada imagen se generó con IA y se cobra: perderlas en silencio significa
  // pagarlas otra vez sin enterarse.
  const fn = bloque('async function saveFPImgCache(');
  assert.match(fn, /catch\(e\)\{[\s\S]*toast\(/, 'el fallo de guardado tiene que verse en pantalla');
  assert.match(fn, /se cobra/, 'y decir por qué importa');
});

// ── La ficha técnica ────────────────────────────────────────────────────

test('guardar la ficha técnica no canta victoria si Airtable falla', () => {
  const fn = bloque('async function saveFichaModal(');
  assert.match(fn, /await airtableWrite\('Pedidos','PATCH'/);
  const iEscribe = fn.indexOf("await airtableWrite('Pedidos','PATCH'");
  const iOk = fn.indexOf("toast('Ficha técnica guardada ✓'");
  const iCatch = fn.indexOf('catch(e)');
  assert.ok(iEscribe > 0 && iOk > iEscribe, 'el ✓ tiene que ir DESPUÉS de que Airtable confirme, no antes');
  assert.ok(iCatch > iOk, 'y dentro del try, para que un error se lleve el aviso');
  assert.match(fn, /catch\(e\)\{toast\('Error: '\+e\.message,'error'\)/);
});
