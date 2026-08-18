#!/usr/bin/env node
/*
 * Contratos recurrentes (retainers): un doble clic NO genera dos pedidos del mes.
 *
 * generarRetainer chequeaba `ret.ultimoGenerado===mk` y recién marcaba el mes
 * DESPUÉS de crear el pedido (que es async). Entre el chequeo y la marca hay un
 * await: un doble clic en "▶ Generar" —o un clic durante el auto-chequeo— pasaba
 * el guard dos veces y creaba DOS pedidos del mismo mes (revenue recurrente
 * duplicado). Ahora la marca se persiste ANTES del await; como JS es de un solo
 * hilo, la segunda llamada ya la ve y aborta. Si la creación falla, se revierte
 * para poder reintentar.
 *
 * Se monta el generarRetainer REAL con una "localStorage" simulada (cada
 * _retainers() devuelve un parse fresco, como el real).
 *
 * Correr:  node --test tests/retainer-doble-generacion.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(nombre) {
  const i = HTML.indexOf('async function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = HTML.indexOf('{', HTML.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < HTML.length; x++) {
    if (HTML[x] === '{') d++;
    if (HTML[x] === '}') { d--; if (!d) return HTML.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const BODY = extract('generarRetainer');

// Monta generarRetainer con una tienda tipo localStorage (parse fresco por lectura)
// y un creador de pedidos controlable.
function montar({ crear }) {
  let store = [{ id: 'r1', clienteNombre: 'ACME', ultimoGenerado: '' }];
  const deps = {
    _retainers: () => JSON.parse(JSON.stringify(store)),          // parse fresco, como localStorage
    _retainersSaveArr: (arr) => { store = JSON.parse(JSON.stringify(arr)); },
    _mesActualKey: () => '2026-08',
    _retainerCrearPedido: crear,
    toast: () => {},
    renderRetainers: () => {},
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, BODY + '\nreturn generarRetainer;')(...names.map((n) => deps[n]));
  return { fn, store: () => store };
}

// Creador que cuenta llamadas y cede el hilo (simula el await de Airtable).
function creadorAsync() {
  let n = 0;
  const crear = async () => { n++; await Promise.resolve(); await Promise.resolve(); return 1000 + n; };
  return { crear, veces: () => n };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('doble clic simultáneo: se crea UN solo pedido, no dos', async () => {
  const c = creadorAsync();
  const m = montar({ crear: c.crear });
  await Promise.all([m.fn('r1', true), m.fn('r1', true)]);   // dos clics a la vez
  assert.equal(c.veces(), 1, 'la creación del pedido ocurre una sola vez');
  assert.equal(m.store()[0].ultimoGenerado, '2026-08', 'queda marcado el mes');
});

test('clic secuencial: el segundo ve la marca y no genera de nuevo', async () => {
  const c = creadorAsync();
  const m = montar({ crear: c.crear });
  assert.equal(await m.fn('r1', true), true, 'el primero genera');
  assert.equal(await m.fn('r1', true), false, 'el segundo aborta (ya está el mes)');
  assert.equal(c.veces(), 1);
});

// ── Si la creación falla, se revierte para reintentar ────────────────────

test('si crear el pedido falla, la marca se revierte y se puede reintentar', async () => {
  let n = 0;
  const crear = async () => { n++; await Promise.resolve(); return n === 1 ? false : 1000 + n; }; // 1º falla, 2º ok
  const m = montar({ crear });
  assert.equal(await m.fn('r1', true), false, 'primer intento falla');
  assert.equal(m.store()[0].ultimoGenerado, '', 'la marca quedó revertida');
  assert.equal(await m.fn('r1', true), true, 'reintento genera');
  assert.equal(m.store()[0].ultimoGenerado, '2026-08');
  assert.equal(n, 2);
});

// ── Un retainer inexistente no rompe ─────────────────────────────────────

test('id inexistente devuelve false sin crear nada', async () => {
  const c = creadorAsync();
  const m = montar({ crear: c.crear });
  assert.equal(await m.fn('no-existe', true), false);
  assert.equal(c.veces(), 0);
});

// ── El código lo dice ────────────────────────────────────────────────────

test('la marca del mes se persiste ANTES del await de creación', () => {
  const iMarca = BODY.indexOf('ret.ultimoGenerado=mk;_retainersSaveArr(arr)');
  const iCrear = BODY.indexOf('await _retainerCrearPedido(ret)');
  assert.ok(iMarca > 0 && iCrear > 0 && iMarca < iCrear, 'se marca y guarda antes de crear');
});
