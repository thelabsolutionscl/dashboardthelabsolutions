#!/usr/bin/env node
/*
 * Satisfacción (CSAT/NPS): Promotores y Detractores en la MISMA unidad (%).
 *
 * El panel mostraba "Promotores 60%" y "Detractores 2" lado a lado — uno en
 * porcentaje, el otro en conteo absoluto. Con [5,5,5,1,1] los detractores son el
 * 40% (2 de 5), pero "2" junto a "60%" se lee como ~2%, sugiriendo que la
 * insatisfacción es marginal cuando es casi la mitad. _npsStats no calculaba
 * pctDetr. Ahora sí, y el KPI lo muestra en % (con el conteo en el tooltip).
 *
 * Se monta el _npsStats REAL con _agMine/_npsScore/state inyectados.
 *
 * Correr:  node --test tests/nps-detractores-pct.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'agentes.js'), 'utf8');
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
function stats(scores) {
  const state = { pedidos: scores.map((s) => ({ s })) };
  const deps = { _agMine: (x) => x, _npsScore: (p) => p.s, state };
  const names = Object.keys(deps);
  return new Function(...names, extract('_npsStats') + '\nreturn _npsStats;')(...names.map((n) => deps[n]))();
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('[5,5,5,1,1]: promotores 60% y detractores 40% (misma unidad)', () => {
  const s = stats([5, 5, 5, 1, 1]);
  assert.equal(s.pctProm, 60);
  assert.equal(s.pctDetr, 40, 'los detractores son el 40%, no "2"');
  assert.equal(s.detractores, 2, 'el conteo sigue disponible (para el tooltip)');
  assert.equal(s.nps, 20);
});

test('sin detractores: 0%', () => {
  assert.equal(stats([5, 5, 4]).pctDetr, 0);
});

test('todos detractores: 100%', () => {
  assert.equal(stats([1, 2, 1]).pctDetr, 100);
});

test('los porcentajes son consistentes con el conteo y n', () => {
  const s = stats([5, 4, 3, 2, 1, 1]); // prom=2, detr=3, pasivos=1, n=6
  assert.equal(s.pctProm, Math.round(2 / 6 * 100));
  assert.equal(s.pctDetr, Math.round(3 / 6 * 100));
});

test('sin calificaciones no rompe (null)', () => {
  assert.equal(stats([]), null);
});

// ── El panel muestra el % ────────────────────────────────────────────────

test('renderCsatSummary pinta el % de detractores, no el conteo crudo', () => {
  const r = extract('renderCsatSummary');
  assert.match(r, /Detractores<\/span><span class="fac-kpi-val">\$\{s\.pctDetr\}%/, 'detractores en %');
  assert.doesNotMatch(r, /Detractores<\/span><span class="fac-kpi-val">\$\{s\.detractores\}</, 'ya no muestra el conteo como valor principal');
});
