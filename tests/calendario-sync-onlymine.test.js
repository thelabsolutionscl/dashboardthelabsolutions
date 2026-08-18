#!/usr/bin/env node
/*
 * Google Calendar · "Solo los míos" sin identidad NO borra los calendarios.
 *
 * _calAllowedSync filtra los eventos CRM por identidad cuando onlyMine está
 * activo: `!!mine && personas.includes(mine)`. Si el login no está mapeado a una
 * persona (_calUserId()==='' — p.ej. hola@thelab.solutions), `mine` es '' y la
 * condición daba false para TODOS los eventos → no permitidos. Y en
 * _calSyncCandidates, un evento no permitido que YA tiene gcal se convierte en
 * lápida (del:true) → _calSyncEvento lo BORRA de Google. Es decir: activar "Solo
 * los míos" con un login sin identidad borraba los calendarios sincronizados del
 * equipo (y se propagaba a la otra máquina). Ahora, sin identidad, onlyMine se
 * trata como inactivo.
 *
 * Se monta el _calAllowedSync REAL con prefs e identidad inyectadas.
 *
 * Correr:  node --test tests/calendario-sync-onlymine.test.js
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
// Monta _calAllowedSync con _calSyncPrefs y _calUserId inyectados.
function permitido(prefs, mine) {
  return new Function('_calSyncPrefs', '_calUserId',
    extract('_calAllowedSync') + '\nreturn _calAllowedSync;')(() => prefs, () => mine);
}
const crm = (personas, syncKey = 'ped_delivery') => ({ source: 'crm', syncKey, personas });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('login SIN identidad + "Solo los míos": los eventos NO se excluyen (no se borran)', () => {
  const ok = permitido({ onlyMine: true, ped_delivery: true }, '');
  assert.equal(ok(crm(['nicanor'])), true, 'sin identidad, onlyMine no filtra → se conserva');
  assert.equal(ok(crm([])), true);
});

// ── El filtrado real (con identidad) queda intacto ───────────────────────

test('con identidad, "Solo los míos" sí deja pasar solo los propios', () => {
  const ok = permitido({ onlyMine: true, ped_delivery: true }, 'nicanor');
  assert.equal(ok(crm(['nicanor'])), true, 'el suyo pasa');
  assert.equal(ok(crm(['gustavo'])), false, 'el ajeno se excluye');
  assert.equal(ok(crm(['gustavo', 'nicanor'])), true, 'compartido con él pasa');
});

test('sin "Solo los míos", pasa todo (con o sin identidad)', () => {
  assert.equal(permitido({ onlyMine: false, ped_delivery: true }, '')(crm(['x'])), true);
  assert.equal(permitido({ onlyMine: false, ped_delivery: true }, 'nicanor')(crm(['x'])), true);
});

// ── El toggle por categoría se sigue respetando ──────────────────────────

test('una categoría desactivada (syncKey=false) no se sincroniza, aun sin identidad', () => {
  const ok = permitido({ onlyMine: true, ped_delivery: false }, '');
  assert.equal(ok(crm(['nicanor'], 'ped_delivery')), false, 'la categoría apagada manda');
});

test('los eventos manuales dependen solo de prefs.manual', () => {
  const man = { source: 'manual' };
  assert.equal(permitido({ manual: true }, '')(man), true);
  assert.equal(permitido({ manual: false }, '')(man), false);
});

// ── El código lo dice ────────────────────────────────────────────────────

test('el guardado onlyMine trata la falta de identidad como inactivo', () => {
  const f = extract('_calAllowedSync');
  assert.match(f, /!p\.onlyMine\|\|!mine\|\|\(ev\.personas\|\|\[\]\)\.includes\(mine\)/,
    'onlyMine es no-op cuando mine está vacío');
});
