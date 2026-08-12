#!/usr/bin/env node
/*
 * "Atrasado" de un pedido: una entrega de HOY no está atrasada.
 *
 * En seis lugares (filtro de la bandeja de Pedidos, el KPI "⚠ N atrasados" del
 * overview, la lista de etapas, KAI ×2 y el correo diario) se comparaba
 * `new Date(f['Fecha entrega']) < today`. Pero `new Date('2026-08-11')` se
 * parsea como medianoche UTC, y en Chile (UTC-4/-3) eso cae ANTES de la
 * medianoche local: una entrega de HOY quedaba "antes de hoy" → contada como
 * atrasada TODOS los días. Ahora todo pasa por pedidoAtrasado(), que compara la
 * fecha como texto contra el hoy de Chile (hoyCL).
 *
 * Se monta el pedidoAtrasado REAL de index.html, con "hoy" fijo.
 *
 * Correr:  node --test tests/pedido-atrasado.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(src, nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = src.indexOf('{', src.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < src.length; x++) {
    if (src[x] === '{') d++;
    if (src[x] === '}') { d--; if (!d) return src.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const atrasado = new Function(extract(HTML, 'pedidoAtrasado') + '\nreturn pedidoAtrasado;')();

const HOY = '2026-08-11';
const AYER = '2026-08-10';
const MANANA = '2026-08-12';
const ped = (fecha, estado) => ({ 'Fecha entrega': fecha, 'Estado pedido': estado || 'En producción' });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('una entrega de HOY NO está atrasada', () => {
  assert.equal(atrasado(ped(HOY), HOY), false);
});

test('una entrega de HOY con hora (ISO datetime) tampoco', () => {
  assert.equal(atrasado(ped(HOY + 'T15:30:00.000Z'), HOY), false);
});

test('una entrega de ayer SÍ está atrasada', () => {
  assert.equal(atrasado(ped(AYER), HOY), true);
});

test('una entrega de ayer CON hora (datetime) también cuenta como atrasada', () => {
  // Fuerza que el helper recorte a la fecha: sin slice, una fecha con hora no
  // llegaría a los 10 caracteres y se escaparía del conteo.
  assert.equal(atrasado(ped(AYER + 'T09:00:00.000Z'), HOY), true);
});

test('una entrega de mañana no está atrasada', () => {
  assert.equal(atrasado(ped(MANANA), HOY), false);
});

// ── Estados terminales nunca cuentan ─────────────────────────────────────

test('un pedido despachado/completado/cancelado nunca está atrasado, aunque la fecha pasó', () => {
  ['Despachado', 'Completado', 'Cancelado'].forEach((e) => {
    assert.equal(atrasado(ped(AYER, e), HOY), false, e + ' no debe contar');
  });
});

// ── Sin fecha, sin drama ─────────────────────────────────────────────────

test('sin fecha de entrega no está atrasado', () => {
  assert.equal(atrasado(ped('', 'En producción'), HOY), false);
  assert.equal(atrasado({ 'Estado pedido': 'En producción' }, HOY), false);
});

test('una fecha basura no explota ni cuenta como atrasada', () => {
  assert.equal(atrasado(ped('no-es-fecha', 'En producción'), HOY), false);
});

// ── El código: todos los conteos pasan por el helper ─────────────────────

test('el filtro de la bandeja de Pedidos usa pedidoAtrasado', () => {
  assert.match(HTML, /filter==='atrasados'\?basePedidos\.filter\(p=>pedidoAtrasado\(p\.fields\)\)/);
});

test('el KPI del overview usa pedidoAtrasado', () => {
  assert.match(HTML, /if\(pedidoAtrasado\(f\)\)atrasados\+\+/);
});

test('KAI y el correo diario usan pedidoAtrasado, no new Date pelado', () => {
  const kai = fs.readFileSync(path.join(__dirname, '..', 'js', 'kai.js'), 'utf8');
  const notify = fs.readFileSync(path.join(__dirname, '..', 'js', 'notify.js'), 'utf8');
  assert.equal((kai.match(/pedidoAtrasado\(p\.fields\)/g) || []).length, 2, 'KAI usa el helper en sus dos conteos');
  assert.match(notify, /pedidoAtrasado\(p\.fields\)/, 'el correo diario usa el helper');
  // Ya no debe quedar el patrón buggy new Date(...Fecha entrega...)<today/_t sin anclar
  assert.doesNotMatch(kai, /new Date\(f\['Fecha entrega'\]\)<today/, 'KAI sin comparación UTC pelada');
  assert.doesNotMatch(notify, /new Date\(f\['Fecha entrega'\]\)<_t/, 'correo sin comparación UTC pelada');
});
