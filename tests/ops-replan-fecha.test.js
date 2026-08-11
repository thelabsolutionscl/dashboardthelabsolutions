#!/usr/bin/env node
/*
 * Planificación operacional — replanificar un atraso NO puede sugerir otra
 * fecha en el pasado.
 *
 * replan() lista los compromisos "rojos" (que incluyen los ATRASADOS, días<0) y
 * proponía `dateAdd(e.fecha, add)`: sumarle días a una fecha ya vencida da otra
 * fecha vencida. Peor: applyReplan() escribe esa sugerencia en el campo del CRM
 * ('Fecha entrega') vía calUpdateCrmDate — o sea, "replanificar" un pedido
 * atrasado le ponía una fecha de entrega igual de pasada. Ahora, si el
 * compromiso está atrasado, la sugerencia parte desde HOY.
 *
 * Se monta el _opsSugFecha + dateAdd REALES del módulo, con rec/load/days/hoyCL
 * simulados. hoyCL fijo para determinismo.
 *
 * Correr:  node --test tests/ops-replan-fecha.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'calendario-operaciones.js'), 'utf8');

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
const BODY = extract('dateAdd') + '\n' + extract('_opsSugFecha');

const HOY = '2026-08-11';

// Monta _opsSugFecha(ev) con dependencias simuladas.
//   diasHasta: qué devuelve days(ev.fecha) (negativo = atrasado)
//   horas:     estimatedHours del registro
//   dailyHours: capacidad diaria configurada
function montar({ diasHasta, horas = 24, dailyHours = 24 }) {
  const deps = {
    rec: () => ({ estimatedHours: horas }),
    load: () => ({ settings: { dailyHours } }),
    days: () => diasHasta,
    hoyCL: () => HOY,
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, BODY + '\nreturn _opsSugFecha;')(...names.map((n) => deps[n]));
  return fn;
}
const iso = (s) => s; // ya viene YYYY-MM-DD

// ── El corazón del arreglo ──────────────────────────────────────────────

test('un pedido ATRASADO se replanifica desde HOY, nunca al pasado', () => {
  // Vencido hace 10 días; su e.fecha caería 10 días atrás.
  const sug = montar({ diasHasta: -10, horas: 24, dailyHours: 24 })({ fecha: '2026-08-01' });
  assert.ok(sug > HOY, `la sugerencia (${sug}) debe ser futura, no ${'2026-08-01'}`);
  assert.equal(sug, '2026-08-12', 'hoy + 1 día de capacidad (24h/24h)');
});

test('atraso grande con trabajo largo: parte de hoy y suma los días de capacidad', () => {
  // 100h / 24h por día = ceil(4.16) = 5 días desde hoy.
  const sug = montar({ diasHasta: -30, horas: 100, dailyHours: 24 })({ fecha: '2026-07-12' });
  assert.equal(sug, '2026-08-16', 'hoy + 5 días');
  assert.ok(sug > HOY);
});

test('sin horas estimadas: usa 24h por defecto (1 día) desde hoy si está atrasado', () => {
  const sug = montar({ diasHasta: -3, horas: 0, dailyHours: 24 })({ fecha: '2026-08-08' });
  assert.equal(sug, '2026-08-12');
});

// ── Camino normal: en riesgo pero NO atrasado, parte de su propia fecha ──

test('un compromiso futuro en riesgo se corre desde su fecha, no desde hoy', () => {
  // días>=0 → base = e.fecha
  const sug = montar({ diasHasta: 5, horas: 24, dailyHours: 24 })({ fecha: '2026-08-20' });
  assert.equal(sug, '2026-08-21', 'su fecha + 1 día');
});

test('para HOY mismo (días=0) parte de su fecha', () => {
  const sug = montar({ diasHasta: 0, horas: 48, dailyHours: 24 })({ fecha: HOY });
  assert.equal(sug, '2026-08-13', 'hoy + ceil(48/24)=2 días');
});

// ── Siempre avanza al menos un día ───────────────────────────────────────

test('la sugerencia siempre mueve la fecha al menos un día', () => {
  const futuro = montar({ diasHasta: 3, horas: 1, dailyHours: 24 })({ fecha: '2026-08-14' });
  assert.equal(futuro, '2026-08-15', 'add=max(1,...) nunca 0');
});

test('horas negativas (dato corrupto) igual avanzan un día, no se quedan en la misma fecha', () => {
  // Sin Math.max(1,...), ceil(-5/24) = 0 → dateAdd(hoy,0) = hoy: no avanza.
  const sug = montar({ diasHasta: -2, horas: -5, dailyHours: 24 })({ fecha: '2026-08-09' });
  assert.ok(sug > HOY, `debe avanzar aunque las horas vengan negativas (${sug})`);
  assert.equal(sug, '2026-08-12');
});

// ── El código lo dice ────────────────────────────────────────────────────

test('replan usa la fecha corregida y ya no dateAdd sobre la fecha vencida', () => {
  const replan = extract('replan');
  assert.match(replan, /_opsSugFecha\(e\)/, 'replan delega en el helper corregido');
  assert.doesNotMatch(replan, /dateAdd\(e\.fecha,\s*add\)/, 'ya no suma sobre la fecha (posiblemente vencida)');
  assert.match(BODY, /days\(ev\.fecha\)<0\)\?hoyCL\(\)/, 'si está atrasado parte de hoy');
});
