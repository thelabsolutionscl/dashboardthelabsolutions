#!/usr/bin/env node
/*
 * Paneles de CAPACIDAD/SOBRECARGA (calendario-operaciones + Modo TV): la carga
 * diaria debe mirar HACIA ADELANTE.
 *
 * Ambos paneles agrupaban las horas comprometidas por fecha de entrega y
 * mostraban las primeras N fechas ordenadas. Como los eventos incluyen entregas
 * ATRASADAS (fecha pasada, pedido aún abierto), esas fechas muertas copaban el
 * panel y tapaban los días futuros realmente sobrecargados — justo lo que el
 * panel existe para mostrar. Un día pasado al 150% no se puede rebalancear.
 * Ahora solo entran hoy y lo que viene.
 *
 * Se montan las funciones REALES (renderCapacity de calendario-operaciones y
 * capacidad del Modo TV) con dependencias simuladas y "hoy" fijo.
 *
 * Correr:  node --test tests/capacidad-futura.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function extractFrom(src, nombre) {
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

const HOY = '2026-08-11';
const AYER = '2026-08-05';
const HACE_MESES = '2026-06-01';
const MANANA = '2026-08-12';
const PROX = '2026-08-20';

// ── calendario-operaciones: renderCapacity ────────────────────────────────

const CO = fs.readFileSync(path.join(__dirname, '..', 'js', 'calendario-operaciones.js'), 'utf8');
const RC = extractFrom(CO, 'renderCapacity');

// days(fecha) = offset en días respecto de hoy (negativo = pasado).
const daysOffset = { [HACE_MESES]: -71, [AYER]: -6, [HOY]: 0, [MANANA]: 1, [PROX]: 9 };
function montarRC(map) {
  const deps = {
    totals: () => map,
    days: (d) => (d in daysOffset ? daysOffset[d] : null),
    load: () => ({ settings: { dailyHours: 24 } }),
    esc: (v) => String(v),
    Math, Object,
  };
  const names = Object.keys(deps);
  return new Function(...names, RC + '\nreturn renderCapacity();')(...names.map((n) => deps[n]));
}

test('renderCapacity oculta días pasados y muestra los futuros', () => {
  const html = montarRC({ [AYER]: 10, [HOY]: 12, [PROX]: 30 });
  assert.ok(!html.includes(AYER), 'no debe listar un día ya pasado');
  assert.ok(html.includes(HOY), 'sí incluye hoy');
  assert.ok(html.includes(PROX), 'sí incluye el futuro');
});

test('renderCapacity: un día futuro sobrecargado no queda tapado por atrasos', () => {
  // 3 fechas pasadas + 1 futura sobrecargada. Antes, con slice(0,10) sobre TODO
  // ordenado, las pasadas iban primero; aquí deben desaparecer y quedar la futura.
  const html = montarRC({ [HACE_MESES]: 8, [AYER]: 8, [HOY]: 8, [PROX]: 40 });
  assert.ok(!html.includes(HACE_MESES) && !html.includes(AYER), 'sin fechas muertas');
  assert.ok(html.includes(PROX), 'el día futuro sobrecargado sí aparece');
  assert.ok(/167%|1\d\d%/.test(html), 'muestra el % de sobrecarga (40h/24h)');
});

test('renderCapacity: si TODO está en el pasado, cae al mensaje vacío (no pinta fechas muertas)', () => {
  const html = montarRC({ [HACE_MESES]: 8, [AYER]: 8 });
  assert.ok(/Agrega horas estimadas/.test(html), 'mensaje de sin carga futura');
  assert.ok(!html.includes(AYER));
});

test('renderCapacity: código sí filtra por días>=0', () => {
  assert.match(RC, /filter\(d=>days\(d\)>=0\)/, 'filtra fechas futuras antes de recortar');
});

// ── Modo TV: capacidad ────────────────────────────────────────────────────

const TV = fs.readFileSync(path.join(__dirname, '..', 'js', 'tv-control-center.js'), 'utf8');
const CAP = extractFrom(TV, 'capacidad');

function montarCAP(deliveries, ms = [{}, {}]) {
  const deps = { esc: (v) => String(v), today: () => HOY, Math, Object, String, Number };
  const names = Object.keys(deps);
  const fn = new Function(...names, CAP + '\nreturn capacidad;')(...names.map((n) => deps[n]));
  return fn({ deliveries, ms });
}
const del = (fecha, horas) => ({ fields: { 'Fecha entrega': fecha, 'Horas estimadas': horas } });

test('Modo TV capacidad: ignora entregas atrasadas', () => {
  const html = montarCAP([del(AYER, 20), del(HOY, 10), del(PROX, 30)]);
  assert.ok(!html.includes(AYER), 'no muestra el día atrasado');
  assert.ok(html.includes(HOY) && html.includes(PROX), 'muestra hoy y futuro');
});

test('Modo TV capacidad: el atraso no tapa un futuro sobrecargado', () => {
  const html = montarCAP([del(HACE_MESES, 8), del(AYER, 8), del(PROX, 60)]);
  assert.ok(!html.includes(HACE_MESES) && !html.includes(AYER));
  assert.ok(html.includes(PROX));
});

test('Modo TV capacidad: hoy sí cuenta (no se recorta el mismo día)', () => {
  const html = montarCAP([del(HOY, 12)]);
  assert.ok(html.includes(HOY), 'la fecha de hoy es válida');
});

test('Modo TV capacidad: código descarta fechas anteriores a hoy', () => {
  assert.match(CAP, /String\(dt\)\.slice\(0,10\)<hoy/, 'salta entregas con fecha < hoy');
});
