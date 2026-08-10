#!/usr/bin/env node
/*
 * Calendario: las alarmas no pueden repetir el mismo aviso en cada tick.
 *
 * _calAlarmTick corre cada 30s y, por cada evento, elegía el recordatorio más
 * cercano SIN disparar ("ready") y avisaba uno por tick. El problema: al reabrir
 * la app cerca de un evento (tras tener el navegador cerrado), varias tiers de
 * recordatorio quedan "abiertas" a la vez —la de 3 días, la de 1 día, la de 3h—
 * y se disparaban de a una por tick, cada 30 segundos. Como el texto del aviso se
 * arma con los DÍAS RESTANTES REALES (no con el tier), salían avisos idénticos
 * ("📅 vence hoy") repetidos. El arreglo marca como disparadas todas las tiers ya
 * abiertas y notifica una sola vez: la más cercana al evento.
 *
 * Se monta el _calAlarmTick REAL con un reloj fijo y dependencias simuladas.
 *
 * Correr:  node --test tests/calendario-alarmas.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'calendario-base.js'), 'utf8');

// Extrae "function nombre(...){...}" por conteo de llaves desde el '{' que sigue al ')'.
function fn(nombre) {
  const i = SRC.indexOf('function ' + nombre);
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = SRC.indexOf('{', SRC.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < SRC.length; x++) {
    if (SRC[x] === '{') d++;
    if (SRC[x] === '}') { d--; if (!d) return SRC.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

const TODAY = '2026-08-10';
const RealDate = Date;
const at = (fecha, hhmm) => new RealDate(fecha + 'T' + hhmm + ':00').getTime();

// Date falso: Date.now() fijo; new Date(args) se comporta normal (misma zona local).
function fakeDate(nowMs) {
  function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(nowMs); }
  FakeDate.now = () => nowMs;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  return FakeDate;
}

// Monta _calAlarmTick con el reloj y los eventos dados. Devuelve {tick, notifs, fired}.
function montar({ nowMs, events, fired = {} }) {
  const notifs = [];
  let store = fired;
  const deps = {
    Date: fakeDate(nowMs),
    _calFired: () => store,
    _calFiredSave: (m) => { store = m; },
    _calDisplayEvents: () => events,
    hoyCL: () => TODAY,
    _calDays: (f) => Math.round((RealDate.parse(f + 'T00:00:00') - RealDate.parse(TODAY + 'T00:00:00')) / 864e5),
    _calPersona: () => null,
    NOTIFY: { add: (...a) => notifs.push(a) },
    toast: () => {},
    Notification: undefined,
  };
  const names = Object.keys(deps);
  const tick = new Function(...names, fn('_calAlarmTick') + '\nreturn _calAlarmTick;')(...names.map((n) => deps[n]));
  return { tick, notifs, fired: () => store };
}

function cotDue(fecha, extra = {}) {
  return { id: 'crm-cot-due-x', source: 'crm', type: 'cot_due', fecha, allDay: true, avisoApp: true,
    personas: [], titulo: 'Cotización X', client: 'ACME', reminders: [4320, 1440, 180, 0], ...extra };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('reabrir 2h antes del evento NO dispara una ráfaga de avisos duplicados', () => {
  // 07:00 del día del evento (que "vence" 09:00): las tiers de 3d, 1d y 3h ya
  // están abiertas. Tres ticks seguidos deben producir UN solo aviso.
  const m = montar({ nowMs: at(TODAY, '07:00'), events: [cotDue(TODAY)], fired: {} });
  m.tick(); m.tick(); m.tick();
  assert.equal(m.notifs.length, 1, 'un solo aviso, no uno por tier en cada tick');
});

test('a la hora del evento, varios ticks siguen dando un solo aviso', () => {
  const m = montar({ nowMs: at(TODAY, '09:00'), events: [cotDue(TODAY)], fired: {} });
  m.tick(); m.tick(); m.tick(); m.tick();
  assert.equal(m.notifs.length, 1);
});

// ── Comportamiento legítimo intacto ─────────────────────────────────────

test('un evento aún lejano (dentro del rango, sin tier abierta) no avisa', () => {
  // 5 días antes: el recordatorio más lejano es 3 días → ninguna tier abierta.
  const m = montar({ nowMs: at(TODAY, '12:00'), events: [cotDue('2026-08-15')], fired: {} });
  m.tick(); m.tick();
  assert.equal(m.notifs.length, 0);
});

test('cada tier ya abierta queda marcada como disparada (no se re-dispara)', () => {
  const m = montar({ nowMs: at(TODAY, '07:00'), events: [cotDue(TODAY)], fired: {} });
  m.tick();
  const f = m.fired();
  // 180, 1440 y 4320 (todas abiertas a 2h del evento) deben quedar marcadas.
  assert.ok(f['crm-cot-due-x@' + TODAY + '@180'], 'la tier de 3h (ready) quedó marcada');
  assert.ok(f['crm-cot-due-x@' + TODAY + '@1440'], 'la de 1 día quedó suprimida');
  assert.ok(f['crm-cot-due-x@' + TODAY + '@4320'], 'la de 3 días quedó suprimida');
});

test('respeta un aviso ya disparado previamente (no repite)', () => {
  const prev = { ['crm-cot-due-x@' + TODAY + '@180']: at(TODAY, '06:00'),
                 ['crm-cot-due-x@' + TODAY + '@1440']: at(TODAY, '06:00'),
                 ['crm-cot-due-x@' + TODAY + '@4320']: at(TODAY, '06:00') };
  const m = montar({ nowMs: at(TODAY, '07:00'), events: [cotDue(TODAY)], fired: prev });
  m.tick(); m.tick();
  assert.equal(m.notifs.length, 0, 'todas las tiers abiertas ya estaban avisadas');
});

// ── El código lo dice ───────────────────────────────────────────────────

test('el tick marca todas las tiers abiertas, no solo la elegida', () => {
  const body = fn('_calAlarmTick');
  assert.match(body, /const open=mins\.slice\(\)\.sort\(.+\)\.filter\(min=>now>=ini-\(\+min\)\*60000\)/, 'calcula las tiers abiertas');
  assert.match(body, /open\.forEach\(min=>\{fired\[/, 'marca todas las abiertas');
});
