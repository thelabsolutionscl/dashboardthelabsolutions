#!/usr/bin/env node
/*
 * Oficina Virtual: la racha de días y el insight semanal deben avanzar por día
 * calendario, no restando 24 h fijas.
 *
 * _ofStreakRecord contaba los días consecutivos con actividad restando 24 h a la
 * fecha de hoy (t0 - i*864e5). En los dos cambios de horario de Chile al año un
 * día dura 23 o 25 h, así que esa resta fija desalineaba la llave del día y la
 * racha se cortaba antes de tiempo. Igual la ventana "mismo día de la semana
 * pasada" en _ofDayInsight. Ahora se avanza con aritmética de calendario.
 *
 * Se montan las funciones REALES con un reloj fijo (independiente de cuándo corra
 * la prueba). Las de comportamiento cubren la LÓGICA de la racha; la de forma
 * fija el arreglo puntual (la diferencia de DST solo se ve cruzando un cambio de
 * hora real, que no se puede reproducir de forma estable en una prueba unitaria).
 *
 * Correr:  node --test tests/oficina-racha.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'oficina.js'), 'utf8');
const RealDate = Date;

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

// Date falso: new Date() → instante fijo; new Date(ts) normal.
const FIXED = RealDate.UTC(2026, 5, 15, 15, 0, 0);   // 15-jun-2026, lejos de bordes de mes
function fakeDate(nowMs) {
  function F(...a) { return a.length ? new RealDate(...a) : new RealDate(nowMs); }
  F.now = () => nowMs; F.parse = RealDate.parse; F.UTC = RealDate.UTC; F.prototype = RealDate.prototype;
  return F;
}

// Monta _ofSameDay + _ofDayInsight + _ofStreakRecord en un mismo scope (se llaman entre sí).
const body = [fn('_ofSameDay'), fn('_ofDayInsight'), fn('_ofStreakRecord')].join('\n');
const m = new Function('Date', body + '\nreturn {_ofSameDay,_ofDayInsight,_ofStreakRecord};')(fakeDate(FIXED));

// Timestamp del mediodía de hace `n` días calendario (en la zona local del runner).
const dayAgo = (n) => { const d = new RealDate(FIXED); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.getTime(); };

// ── Racha ────────────────────────────────────────────────────────────────

test('tres días consecutivos con actividad cuentan racha 3', () => {
  assert.equal(m._ofStreakRecord([{ t: dayAgo(0) }, { t: dayAgo(1) }, { t: dayAgo(2) }]).streak, 3);
});

test('un hueco corta la racha', () => {
  assert.equal(m._ofStreakRecord([{ t: dayAgo(0) }, { t: dayAgo(1) }, { t: dayAgo(3) }]).streak, 2);
});

test('hoy sin actividad no corta la racha de ayer', () => {
  assert.equal(m._ofStreakRecord([{ t: dayAgo(1) }, { t: dayAgo(2) }, { t: dayAgo(3) }]).streak, 3);
});

test('el récord es el máximo de ejecuciones en un día', () => {
  const r = m._ofStreakRecord([{ t: dayAgo(0) }, { t: dayAgo(0) }, { t: dayAgo(0) }, { t: dayAgo(1) }]);
  assert.equal(r.recordN, 3);
});

// ── Insight semanal ──────────────────────────────────────────────────────

test('el delta compara hoy con el mismo día de la semana pasada', () => {
  const runs = [{ t: dayAgo(0), agent: 'a' }, { t: dayAgo(0), agent: 'a' },
    { t: dayAgo(7), agent: 'a' }, { t: dayAgo(7), agent: 'a' }, { t: dayAgo(7), agent: 'a' }, { t: dayAgo(7), agent: 'a' }];
  const ins = m._ofDayInsight(runs);
  assert.equal(ins.today, 2);
  assert.equal(ins.lastWeek, 4);
  assert.equal(ins.delta, -50);
});

// ── El código lo dice (fija el arreglo puntual) ──────────────────────────

test('la racha avanza por día calendario, no restando 24h', () => {
  const b = fn('_ofStreakRecord');
  assert.match(b, /dk\.setDate\(dk\.getDate\(\)-i\)/, 'usa aritmética de calendario');
  assert.doesNotMatch(b, /t0\.getTime\(\)-i\*864e5/, 'ya no resta 24h fijas');
});
