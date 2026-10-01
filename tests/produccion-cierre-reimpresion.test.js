#!/usr/bin/env node
/*
 * Producción · un fallo de QA + reimpresión no deja el pedido trabado para siempre.
 *
 * Al fallar QA, saveQA deja el trabajo original en 'fallido' (sin archivar) y crea
 * una reimpresión con el mismo pedidoId (reprintOf = id del original).
 * maybeCompleteOrder exigía que TODOS los trabajos no archivados estuvieran
 * 'terminado'; el 'fallido' original hacía `some(!=='terminado')` verdadero, así
 * que aunque la reimpresión pasara QA el pedido NUNCA llegaba a "Listo para
 * despacho" — y nada lo reevaluaba después (quedaba atascado permanentemente).
 * Ahora se ignoran los originales ya reemplazados por su reimpresión.
 *
 * Se monta el _pedidoTrabajosListos REAL.
 *
 * Correr:  node --test tests/produccion-cierre-reimpresion.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'maquinas-operaciones.js'), 'utf8');
function extract(nombre) {
  const i = SRC.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = SRC.indexOf('{', SRC.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < SRC.length; x++) {
    if (SRC[x] === '{') d++;
    if (SRC[x] === '}') { d--; if (!d) return SRC.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const listos = new Function(extract('_pedidoTrabajosListos') + '\nreturn _pedidoTrabajosListos;')();
const J = (id, status, extra = {}) => ({ id, status, ...extra });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('original FALLIDO + reimpresión TERMINADA → el pedido puede cerrar', () => {
  const jobs = [J('A', 'fallido'), J('A2', 'terminado', { reprintOf: 'A' })];
  assert.equal(listos(jobs), true, 'el original reemplazado no bloquea');
});

test('original FALLIDO + reimpresión aún PENDIENTE → NO cierra todavía', () => {
  const jobs = [J('A', 'fallido'), J('A2', 'pendiente', { reprintOf: 'A' })];
  assert.equal(listos(jobs), false);
});

test('cadena de dos fallos: A→A2→A3 terminada → cierra', () => {
  const jobs = [J('A', 'fallido'), J('A2', 'fallido', { reprintOf: 'A' }), J('A3', 'terminado', { reprintOf: 'A2' })];
  assert.equal(listos(jobs), true, 'A y A2 quedan reemplazados; solo cuenta A3');
});

// ── Casos normales (sin regresiones) ─────────────────────────────────────

test('todos terminados sin reimpresiones → cierra', () => {
  assert.equal(listos([J('A', 'terminado'), J('B', 'terminado')]), true);
});

test('uno terminado y otro en curso → no cierra', () => {
  assert.equal(listos([J('A', 'terminado'), J('B', 'imprimiendo')]), false);
});

test('un fallo SIN reimpresión sigue bloqueando (hay que rehacerlo)', () => {
  assert.equal(listos([J('A', 'fallido')]), false);
});

test('pedido sin trabajos no se marca listo', () => {
  assert.equal(listos([]), false);
  assert.equal(listos(null), false);
});

test('todo el pedido reemplazado sin una reimpresión terminada → no cierra', () => {
  // A reemplazado por A2, pero A2 sigue pendiente → efectivos=[A2 pendiente] → false.
  assert.equal(listos([J('A', 'fallido'), J('A2', 'pendiente', { reprintOf: 'A' })]), false);
});

// ── El código lo usa ─────────────────────────────────────────────────────

test('maybeCompleteOrder decide el cierre con _pedidoTrabajosListos', () => {
  const m = extract('maybeCompleteOrder');
  assert.match(m, /if\(!_pedidoTrabajosListos\(jobs\)\)return/, 'usa el helper');
  assert.doesNotMatch(m, /jobs\.some\(j=>j\.status!=='terminado'\)/, 'ya no bloquea por el fallido reemplazado');
});
