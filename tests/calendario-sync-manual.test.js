#!/usr/bin/env node
/*
 * Google Calendar · eventos MANUALES no se duplican al sincronizar.
 *
 * _calSyncEvento le pone a un evento su vínculo `gcal` (el ID del evento creado
 * en Google), pero muta una COPIA (los candidatos vienen de _calDisplayEvents,
 * un parse distinto del `arr` que _calSave persiste). Para los CRM eso se
 * rescataba con _calPersistCrmSync; para los MANUALES no se persistía nada, así
 * que quedaban con gcal:{}, _calNeedsSync los creía pendientes SIEMPRE y se
 * re-creaban en Google en cada sync (duplicados, multiplicados entre máquinas).
 * _calWritebackSync copia el resultado del sync de vuelta al objeto persistido.
 *
 * Se montan los _calWritebackSync y _calNeedsSync REALES de calendario-base.js.
 *
 * Correr:  node --test tests/calendario-sync-manual.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'calendario-base.js'), 'utf8');
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
const writeback = new Function(extract('_calWritebackSync') + '\nreturn _calWritebackSync;')();
// _calNeedsSync usa _calGmap(); lo inyectamos con el mapa persona→correo.
function needsSyncCon(gmap) {
  return new Function('_calGmap', extract('_calNeedsSync') + '\nreturn _calNeedsSync;')(() => ({ map: gmap }));
}
const GMAP = { nicanor: 'nicanor@thelab.solutions' };

// Simula lo que _calSyncEvento le hace a la COPIA candidata: crea el evento en
// Google y le cuelga el gcal + gsyncMts.
function trasSincronizar(ev) {
  return { ...ev, gcal: { nicanor: { cal: 'primary', ev: 'G_ABC123', mode: 'direct', mts: 1000 } }, gcalRemoved: {}, gsyncMts: ev.mts || 1000 };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('un evento manual recién sincronizado deja de estar pendiente (no se re-crea)', () => {
  const needsSync = needsSyncCon(GMAP);
  const almacenado = { id: 'ev1', source: 'manual', personas: ['nicanor'], gcal: {}, mts: 1000 };
  const arr = [almacenado];
  // Antes del writeback: el objeto persistido tiene gcal:{} → pendiente (se re-crea).
  assert.equal(needsSync(almacenado), true, 'sin persistir, siempre pendiente');
  // La copia candidata se sincronizó; escribimos su resultado de vuelta al arr.
  writeback(arr, trasSincronizar(almacenado));
  assert.deepEqual(arr[0].gcal, { nicanor: { cal: 'primary', ev: 'G_ABC123', mode: 'direct', mts: 1000 } });
  assert.equal(needsSync(arr[0]), false, 'ya sincronizado: NO vuelve a crearse en Google');
});

test('el vínculo persiste gsyncMts y gcalRemoved, no solo gcal', () => {
  const arr = [{ id: 'ev2', source: 'manual', personas: ['nicanor'], gcal: {}, mts: 500 }];
  const copia = { ...arr[0], gcal: { nicanor: { ev: 'G9' } }, gcalRemoved: { alguien: 42 }, gsyncMts: 500 };
  writeback(arr, copia);
  assert.equal(arr[0].gsyncMts, 500);
  assert.deepEqual(arr[0].gcalRemoved, { alguien: 42 });
});

// ── No pisa la ruta CRM (que persiste aparte) ────────────────────────────

test('un evento CRM NO se toca aquí (lo persiste _calPersistCrmSync)', () => {
  const arr = [{ id: 'crm-1', source: 'crm', gcal: {} }];
  writeback(arr, { id: 'crm-1', source: 'crm', gcal: { nicanor: { ev: 'X' } }, gsyncMts: 1 });
  assert.deepEqual(arr[0].gcal, {}, 'la ruta CRM no se escribe por acá');
});

// ── Robustez ─────────────────────────────────────────────────────────────

test('si el evento ya no está en el arreglo, no rompe', () => {
  const arr = [{ id: 'otro', source: 'manual', gcal: {} }];
  assert.doesNotThrow(() => writeback(arr, { id: 'inexistente', source: 'manual', gcal: { a: 1 } }));
  assert.deepEqual(arr[0].gcal, {});
});

// ── El flujo de sync realmente llama al writeback ────────────────────────

test('calSyncAll y _calAutoSync escriben de vuelta el resultado del sync', () => {
  const manual = extract('calSyncAll') + extract('_calAutoSync');
  assert.equal((manual.match(/_calWritebackSync\(arr,ev\)/g) || []).length, 2,
    'ambas rutas de sync persisten el vínculo del evento manual');
  // Y va junto al persist de CRM (simétrico).
  assert.match(manual, /_calPersistCrmSync\(ev\);_calWritebackSync\(arr,ev\)/);
});
