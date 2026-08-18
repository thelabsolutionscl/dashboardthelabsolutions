#!/usr/bin/env node
/*
 * Reporte semanal · "Revenue semana" solo cuenta lo DESPACHADO, no el backlog.
 *
 * prefillReporte calculaba el revenue de la semana sumando TODO pedido cuya
 * `Fecha despacho || Fecha entrega` fuera >= inicio de semana, sin filtro de
 * estado y sin cota superior. Como `Fecha entrega` es la fecha PLANIFICADA
 * (futura), casi todo el backlog activo entraba: el "Revenue semana (CLP)" que se
 * guarda en la tabla Reportes salía inflado — y contradecía al conteo de "pedidos
 * despachados" de la línea de al lado, que SÍ exige estado Despachado/Completado.
 * Ahora ambas métricas comparten un solo criterio: _pedDespachadoEnSemana.
 *
 * Se monta el _pedDespachadoEnSemana REAL de index.html.
 *
 * Correr:  node --test tests/reporte-revenue-semana.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(nombre) {
  const i = HTML.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = HTML.indexOf('{', HTML.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < HTML.length; x++) {
    if (HTML[x] === '{') d++;
    if (HTML[x] === '}') { d--; if (!d) return HTML.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const despachado = new Function(extract('_pedDespachadoEnSemana') + '\nreturn _pedDespachadoEnSemana;')();

const WS = new Date('2026-08-16T00:00:00'); // inicio de semana (domingo), hora local
const f = (o) => o; // fields tal cual

// ── El corazón del arreglo ──────────────────────────────────────────────

test('un pedido EN PRODUCCIÓN con entrega futura NO cuenta (era el inflador)', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'En producción', 'Fecha entrega': '2026-09-05', 'Monto total (CLP)': 3570000 }), WS), false);
});

test('un pedido DESPACHADO esta semana SÍ cuenta', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Despachado', 'Fecha despacho': '2026-08-18' }), WS), true);
});

test('Completado esta semana también cuenta', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Completado', 'Fecha despacho': '2026-08-17' }), WS), true);
});

test('un pedido cancelado nunca cuenta, aunque tenga fecha', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Cancelado', 'Fecha despacho': '2026-08-18' }), WS), false);
});

test('un despacho de una semana ANTERIOR no cuenta', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Despachado', 'Fecha despacho': '2026-08-10' }), WS), false);
});

test('despachado sin fecha de despacho cae a la de entrega (si es de esta semana)', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Despachado', 'Fecha entrega': '2026-08-19' }), WS), true);
});

test('sin ninguna fecha no cuenta', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Despachado' }), WS), false);
});

test('el mismo inicio de semana (borde) cuenta', () => {
  assert.equal(despachado(f({ 'Estado pedido': 'Despachado', 'Fecha despacho': '2026-08-16' }), WS), true);
});

// ── Revenue y conteo comparten criterio (no pueden divergir) ─────────────

test('prefillReporte usa el helper tanto para el revenue como para el conteo', () => {
  const pf = extract('prefillReporte');
  assert.match(pf, /_pedDespachadoEnSemana\(p\.fields,weekStart\)\?s\+Math\.round/, 'revenue por el helper');
  assert.match(pf, /filter\(p=>_pedDespachadoEnSemana\(p\.fields,weekStart\)\)\.length/, 'conteo por el helper');
  assert.doesNotMatch(pf, /const revSemana=state\.pedidos\.reduce\(\(s,p\)=>\{/, 'ya no hay suma sin filtro de estado');
});
