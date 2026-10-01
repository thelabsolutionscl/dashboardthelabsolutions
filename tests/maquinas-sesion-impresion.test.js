#!/usr/bin/env node
/*
 * Máquinas — sesión de impresión: PAUSAR no puede registrar un "Cancelado".
 *
 * checkTransitions cerraba la sesión ante CUALQUIER salida de 'printing' salvo
 * 'offline'. Pausar (printing→paused) es normal (cambio de filamento, revisión),
 * pero caía en ese cierre: se registraba un "Cancelado" fantasma, se perdía el
 * inicio real y, al reanudar, arrancaba una sesión nueva. Al completar, la
 * duración salía SOLO desde la reanudación → horas de odómetro/mantención mal
 * contadas y, peor, la autocalibración de tiempo (sl_time_cal_<modelo>, que usa
 * el cotizador para estimar tiempo y precio) quedaba corrompida.
 *
 * Se monta el _printSessionAction REAL, que decide open/close/result.
 *
 * Correr:  node --test tests/maquinas-sesion-impresion.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'maquinas.js'), 'utf8');
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
const action = new Function(extract('_printSessionAction') + '\nreturn _printSessionAction;')();

// Simula el hilo de sesión recorriendo una secuencia de estados, como lo haría
// checkTransitions: open crea sesión, close la cierra y registra un resultado.
function correr(estados) {
  let hasSession = false;
  const registros = [];
  for (const st of estados) {
    const a = action(st, hasSession);
    if (a.open) hasSession = true;
    if (a.close) { registros.push(a.result); hasSession = false; }
  }
  return { registros, hasSession };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('pausar y reanudar NO registra nada; al completar registra UN Completado', () => {
  const { registros } = correr(['standby', 'printing', 'paused', 'printing', 'complete']);
  assert.deepEqual(registros, ['Completado'], 'un solo Completado, sin Cancelado fantasma');
});

test('pausar no abre una sesión nueva al reanudar (conserva el inicio)', () => {
  // Tras printing se abre 1 sola sesión; paused/printing no la reabren.
  let opens = 0, hasSession = false;
  for (const st of ['printing', 'paused', 'printing', 'paused', 'printing', 'complete']) {
    const a = action(st, hasSession);
    if (a.open) { opens++; hasSession = true; }
    if (a.close) hasSession = false;
  }
  assert.equal(opens, 1, 'una única apertura de sesión en toda la impresión');
});

test('una pausa por sí sola no cierra la sesión', () => {
  const a = action('paused', true);
  assert.equal(a.close, false);
  assert.equal(a.open, false);
});

// ── Estados terminales sí cierran ────────────────────────────────────────

test('completar cierra con Completado', () => {
  assert.deepEqual(action('complete', true), { open: false, close: true, result: 'Completado' });
});

test('parar a reposo cierra con Cancelado', () => {
  assert.deepEqual(correr(['printing', 'standby']).registros, ['Cancelado']);
});

test('shutdown de Klipper cierra con Cancelado', () => {
  assert.deepEqual(correr(['printing', 'shutdown']).registros, ['Cancelado']);
});

test('completar DESPUÉS de una pausa igual registra Completado (no se pierde)', () => {
  // paused→complete directo: prev no es "printing", pero la sesión sigue viva.
  assert.deepEqual(correr(['printing', 'paused', 'complete']).registros, ['Completado']);
});

// ── Pérdida de telemetría no cierra (evita falsos Cancelado) ──────────────

test('offline en medio de la impresión no cierra la sesión', () => {
  const { registros, hasSession } = correr(['printing', 'offline', 'printing', 'complete']);
  assert.deepEqual(registros, ['Completado']);
  assert.equal(hasSession, false);
});

test('volver de offline directo a complete SÍ registra (antes se perdía)', () => {
  assert.deepEqual(correr(['printing', 'offline', 'complete']).registros, ['Completado']);
});

test('unknown/connecting/startup no cierran la sesión', () => {
  ['unknown', 'connecting', 'startup', 'noip'].forEach((t) => {
    assert.equal(action(t, true).close, false, `${t} no debe cerrar`);
  });
});

// ── Sin sesión no se inventa nada ────────────────────────────────────────

test('llegar a complete sin sesión abierta no registra (no hay inicio)', () => {
  assert.deepEqual(correr(['standby', 'complete']).registros, []);
});

// ── El código lo usa ─────────────────────────────────────────────────────

test('checkTransitions delega en _printSessionAction (una sola fuente)', () => {
  const ct = extract('checkTransitions');
  assert.match(ct, /_printSessionAction\(st,!!_sessions\[m\.id\]\)/, 'usa el helper');
  assert.doesNotMatch(ct, /prev==='printing'&&st!=='printing'&&st!=='offline'/, 'ya no usa la condición vieja');
});
