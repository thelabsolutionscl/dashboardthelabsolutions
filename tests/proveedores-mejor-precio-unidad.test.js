#!/usr/bin/env node
/*
 * Proveedores · "mejor precio por ítem" no cruza unidades distintas.
 *
 * _mejorPrecioPorItem (y el panel comparativo) agrupaban por NOMBRE de ítem e
 * ignoraban la unidad, comparando `precio` crudo. Un mismo ítem cotizado en
 * $/unidad por A y en $/caja por B elegía como "más barato" al de menor número
 * absoluto (A) y anunciaba un ahorro inexistente, recomendando comprarle al
 * proveedor más caro por unidad. Ahora la unidad entra en la identidad del ítem
 * (_precioKey): solo se compara lo comparable.
 *
 * Se montan los _normItem + _precioKey + _mejorPrecioPorItem REALES.
 *
 * Correr:  node --test tests/proveedores-mejor-precio-unidad.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'proveedores.js'), 'utf8');
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
const BODY = extract('_normItem') + '\n' + extract('_precioKey') + '\n' + extract('_mejorPrecioPorItem');
function montar(precios) {
  return new Function('_preciosProv', BODY + '\nreturn {_precioKey,_mejorPrecioPorItem};')(() => precios);
}
const P = (item, prov, precio, unidad, fecha) => ({ item, prov, precio, unidad, fecha });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('mismo ítem en unidades distintas NO se compara: cada unidad tiene su mejor', () => {
  const { _mejorPrecioPorItem, _precioKey } = montar([
    P('Tornillo M3', 'A', 50, 'unidad', '2026-08-01'),   // $50/unidad
    P('Tornillo M3', 'B', 4500, 'caja', '2026-08-02'),   // $4500/caja (no comparable)
  ]);
  const best = _mejorPrecioPorItem();
  assert.equal(Object.keys(best).length, 2, 'dos grupos: uno por unidad');
  assert.equal(best[_precioKey('Tornillo M3', 'unidad')].prov, 'A');
  assert.equal(best[_precioKey('Tornillo M3', 'caja')].prov, 'B');
  // Antes: un solo grupo con A como "mejor" (50 < 4500) — recomendación errónea.
});

test('mismo ítem y MISMA unidad sí compite: gana el más barato', () => {
  const { _mejorPrecioPorItem, _precioKey } = montar([
    P('Filamento PLA', 'A', 9000, 'kg', '2026-08-01'),
    P('Filamento PLA', 'B', 8000, 'kg', '2026-08-02'),
    P('Filamento PLA', 'C', 12000, 'kg', '2026-08-03'),
  ]);
  const best = _mejorPrecioPorItem();
  assert.equal(Object.keys(best).length, 1);
  assert.equal(best[_precioKey('Filamento PLA', 'kg')].prov, 'B');
  assert.equal(best[_precioKey('Filamento PLA', 'kg')].precio, 8000);
});

test('la unidad se normaliza (KG == kg) para no partir un grupo real', () => {
  const { _mejorPrecioPorItem, _precioKey } = montar([
    P('Resina', 'A', 30000, 'KG', '2026-08-01'),
    P('Resina', 'B', 28000, 'kg', '2026-08-02'),
  ]);
  const best = _mejorPrecioPorItem();
  assert.equal(Object.keys(best).length, 1, 'KG y kg son la misma unidad');
  assert.equal(best[_precioKey('Resina', 'kg')].prov, 'B');
});

test('un ítem sin nombre se ignora', () => {
  const { _mejorPrecioPorItem } = montar([P('', 'A', 100, 'kg', '2026-08-01')]);
  assert.equal(Object.keys(_mejorPrecioPorItem()).length, 0);
});

// ── El resto de superficies usa la misma clave ───────────────────────────

test('la ficha, el panel y KAI comparten la clave con unidad', () => {
  assert.match(SRC, /const b=best\[_precioKey\(p\.item,p\.unidad\)\]/, 'la ficha usa _precioKey');
  assert.match(SRC, /byItem\[key\]=byItem\[key\]\|\|\{item:p\.item,unidad:p\.unidad/, 'el panel agrupa por ítem+unidad');
  const kai = fs.readFileSync(path.join(__dirname, '..', 'js', 'kai.js'), 'utf8');
  assert.match(kai, /_precioKey\(p\.item,p\.unidad\)/, 'KAI usa _precioKey');
});
