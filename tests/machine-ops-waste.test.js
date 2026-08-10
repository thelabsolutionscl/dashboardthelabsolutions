#!/usr/bin/env node
/*
 * Producción 3D: el desperdicio de un fallido debe respetar un 0 explícito.
 *
 * En el QA de un trabajo fallido, el consumo de bobina se calculaba con
 * `waste || job.grams`: como 0 es falsy, un desperdicio de 0 g escrito a mano
 * (la impresión falló ANTES de extruir) descontaba igual los gramos completos
 * planificados, sobre-consumiendo el inventario y distorsionando el costo. El
 * arreglo (_qaFailWaste) respeta un 0 explícito y solo asume el total cuando el
 * campo viene EN BLANCO.
 *
 * Se montan las funciones REALES de maquinas-operaciones.js.
 *
 * Correr:  node --test tests/machine-ops-waste.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'maquinas-operaciones.js'), 'utf8');

function fn(nombre) {
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

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// Monta _qaFailWaste con `num` inyectado.
const qaFailWaste = new Function('num', fn('_qaFailWaste') + '\nreturn _qaFailWaste;')(num);

// Monta consumeJobMaterial con un data()/toast/nowIso simulados.
function montarConsumo(spools) {
  const store = { spools };
  const toasts = [];
  const deps = { num, data: () => store, toast: (m) => toasts.push(String(m)), nowIso: () => '2026-08-10T00:00:00.000Z' };
  const names = Object.keys(deps);
  const consume = new Function(...names, fn('consumeJobMaterial') + '\nreturn consumeJobMaterial;')(...names.map((n) => deps[n]));
  return { consume, spools: store.spools, toasts };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('un 0 explícito de desperdicio significa 0 (no descuenta el total)', () => {
  assert.equal(qaFailWaste('0', 500), 0);
});

test('el campo en blanco sí asume el total planificado del trabajo', () => {
  assert.equal(qaFailWaste('', 500), 500);
  assert.equal(qaFailWaste('   ', 500), 500, 'solo espacios cuenta como blanco');
});

test('un desperdicio parcial escrito se respeta tal cual', () => {
  assert.equal(qaFailWaste('120', 500), 120);
});

test('valores negativos se recortan a 0', () => {
  assert.equal(qaFailWaste('-5', 500), 0);
});

// ── El consumo real de la bobina ────────────────────────────────────────

test('consumir 0 g no toca la bobina', () => {
  const m = montarConsumo([{ id: 's1', name: 'Rollo', remaining: 800, status: 'ok' }]);
  m.consume({ id: 'j1', spoolId: 's1', grams: 500 }, 0);
  assert.equal(m.spools[0].remaining, 800, 'la bobina queda intacta');
});

test('consumir el desperdicio real descuenta solo eso', () => {
  const m = montarConsumo([{ id: 's1', name: 'Rollo', remaining: 800, status: 'ok' }]);
  m.consume({ id: 'j1', spoolId: 's1', grams: 500 }, 120);
  assert.equal(m.spools[0].remaining, 680, 'descuenta 120, no 500');
});

// ── El código lo dice ───────────────────────────────────────────────────

test('saveQA usa el helper y ya no el patrón waste||job.grams', () => {
  const body = fn('saveQA');
  assert.match(body, /_qaFailWaste\(inputVal\('mopsQAWaste'\),job\.grams\)/, 'usa el helper');
  assert.doesNotMatch(body, /waste\|\|job\.grams/, 'ya no está el patrón con agujero');
});
