#!/usr/bin/env node
/*
 * Inventario y consumo de material.
 *
 * Hay DOS registros de material que no se hablan entre sí:
 *   · Inventario (Airtable): materiales con stock y unidad, que se descuentan a
 *     mano desde un pedido. La tabla se crea sola al agregar el primer material.
 *   · Bobinas (MachineOps, en el navegador): filamento en gramos, que se
 *     descuenta solo al cerrar el control de calidad de un trabajo.
 *
 * Esa separación es una decisión de diseño, no un fallo. Lo que sí era un fallo
 * es que el descuento de bobinas se comía en silencio dos descuadres, y que la
 * pantalla de inventario mostrara "vacío" cuando en realidad no pudo cargar.
 *
 * Correr:  node --test tests/inventario.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OPS = fs.readFileSync(path.join(ROOT, 'js', 'maquinas-operaciones.js'), 'utf8');

// Monta consumeJobMaterial con bobinas de mentira y un toast que se puede leer.
function montar(bobinas) {
  const i = OPS.indexOf('function consumeJobMaterial');
  const fuente = OPS.slice(i, OPS.indexOf('function requiredPostStages', i));
  const avisos = [];
  const fn = new Function('toast', 'num', 'nowIso', 'data',
    `${fuente}\nreturn consumeJobMaterial;`)(
    (m, t) => avisos.push({ t, m }),
    (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : Number(d) || 0); },
    () => '2026-08-07T00:00:00Z',
    () => ({ spools: bobinas })
  );
  return { fn, avisos, bobinas };
}

test('el consumo normal descuenta y no molesta', () => {
  const m = montar([{ id: 'sp1', name: 'PLA negro', remaining: 1000 }]);
  m.fn({ id: 'j1', name: 'Pieza', spoolId: 'sp1', grams: 250 }, 250);
  assert.equal(m.bobinas[0].remaining, 750);
  assert.equal(m.avisos.length, 0, 'un consumo que cuadra no necesita aviso');
});

test('si la bobina no alcanzaba, se dice cuántos gramos no cuadran', () => {
  // Antes el sobrante se recortaba a 0 en silencio: la bobina quedaba en cero y
  // los gramos de más desaparecían del registro sin que nadie se enterara.
  const m = montar([{ id: 'sp1', name: 'PLA negro', remaining: 100 }]);
  m.fn({ id: 'j2', name: 'Pieza', spoolId: 'sp1', grams: 300 }, 300);
  assert.equal(m.bobinas[0].remaining, 0, 'nunca queda negativa');
  assert.equal(m.bobinas[0].status, 'agotado');
  assert.equal(m.avisos.length, 1);
  assert.match(m.avisos[0].m, /faltan 200 g/, 'el aviso dice el hueco exacto');
  assert.equal(m.avisos[0].t, 'error');
});

test('imprimir sin bobina asignada se avisa, no se traga', () => {
  const m = montar([]);
  const j = { id: 'j3', name: 'Prototipo', spoolId: '', grams: 180 };
  m.fn(j, 180);
  assert.match(m.avisos[0].m, /sin bobina asignada/);
  // La impresión ya ocurrió: no se bloquea nada, solo se deja constancia.
  assert.equal(j.materialConsumed, 180, 'el trabajo igual queda registrado');
});

test('un trabajo no descuenta dos veces', () => {
  const m = montar([{ id: 'sp1', name: 'PLA', remaining: 500 }]);
  const j = { id: 'j4', spoolId: 'sp1', grams: 100 };
  m.fn(j, 100);
  m.fn(j, 100);
  assert.equal(m.bobinas[0].remaining, 400);
});

test('cero gramos sin bobina no genera un aviso inútil', () => {
  const m = montar([]);
  m.fn({ id: 'j5', spoolId: '', grams: 0 }, 0);
  assert.equal(m.avisos.length, 0);
});

test('el consumo desde Pedidos sigue bloqueando antes de dejar stock negativo', () => {
  // Aquí sí se puede frenar: el material todavía no se ha usado. Es la
  // diferencia con las bobinas, donde la impresión ya ocurrió.
  const i = HTML.indexOf('async function aplicarConsumo');
  const fn = HTML.slice(i, i + 2200);
  assert.match(fn, /const faltantes=/, 'debe comprobarse el stock antes de escribir');
  const validacion = fn.indexOf('faltantes.length');
  const escritura = fn.search(/airtableWrite\('Inventario','PATCH'/);
  assert.ok(validacion > 0 && escritura > validacion, 'la comprobación va antes de tocar Airtable');
  assert.match(fn, /Sin stock suficiente/, 'y se dice qué material y cuánto falta');
  // Y si el descuento falla a mitad, se revierte lo local.
  assert.match(fn, /m\.fields\['Stock actual'\]=s;throw new Error\('No se pudo descontar/);
});

test('el inventario distingue "vacío" de "no se pudo cargar"', () => {
  // Con Airtable caído o el token sin permiso, la pantalla decía «Sin
  // materiales aún — agrega el primero»: igual que un inventario vacío de
  // verdad. Se podría empezar a re-agregar material que ya existe.
  const load = HTML.slice(HTML.indexOf('async function loadInventario'), HTML.indexOf('function _invEstado'));
  assert.match(load, /state\._invError=/, 'el fallo debe quedar registrado');
  // Que la tabla no exista todavía es lo normal al empezar: no es un fallo.
  assert.match(load, /NOT_FOUND\|404\|Could not find/, 'la tabla inexistente no cuenta como error');
  const render = HTML.slice(HTML.indexOf('function renderInventario'), HTML.indexOf('function renderInventario') + 1800);
  assert.match(render, /state\._invError/, 'la pantalla debe mirar ese estado');
  assert.match(render, /esto no significa que esté vacío/i, 'y decirlo sin ambigüedad');
  assert.match(render, /loadInventario\(true\)/, 'con forma de reintentar');
});
