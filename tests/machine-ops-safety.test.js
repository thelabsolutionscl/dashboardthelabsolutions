#!/usr/bin/env node
/*
 * Compuerta de seguridad de las impresoras (safetyDecision).
 *
 * safetyDecision decide si una impresora puede arrancar (crítico para trabajos
 * largos/nocturnos sin nadie mirando). Calculaba `fresh` mirando SOLO la marca
 * de tiempo, ignorando `online`. Un sensor caído (online:false) con timestamp
 * reciente se trataba como "fresco":
 *   · los chequeos de humo/temp/VOC se saltaban (por el guard online!==false), y
 *   · la red "lectura ambiental ausente o vencida" TAMPOCO saltaba (depende de
 *     !fresh, y fresh era true).
 * Resultado: una lectura {online:false, smoke:true} no levantaba ni el bloqueo
 * de humo ni ningún aviso claro — el peligro se perdía. El arreglo trata al
 * sensor caído como NO fresco, así cae en la red de "ausente o vencida".
 *
 * safetyDecision es pura y recibe nowMs por parámetro → se monta la REAL.
 *
 * Correr:  node --test tests/machine-ops-safety.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'maquinas-operaciones.js'), 'utf8');

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
const BODY = extract('safetyDecision');

// Dependencias reales/equivalentes que usa safetyDecision.
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const DEFAULT_SAFETY = { enforce: false, cameraRequired: true, ventilationRequired: true, smokeRequired: true, maxTemperature: 38, maxHumidity: 75, maxVoc: 600, staleMinutes: 10, sensorUrl: '', updatedAt: 0 };

const decide = new Function('num', 'DEFAULT_SAFETY', BODY + '\nreturn safetyDecision;')(num, DEFAULT_SAFETY);

const AT = '2026-08-11T12:00:00Z';
const NOW = Date.parse('2026-08-11T12:05:00Z');   // 5 min después → dentro de los 10
const STALE = Date.parse('2026-08-11T12:40:00Z'); // 40 min después → vencida
const has = (arr, re) => arr.some((m) => re.test(m));

// ── El corazón del arreglo ──────────────────────────────────────────────

test('sensor caído (online:false) con humo NO se traga el peligro', () => {
  const r = decide({ enforce: true }, { online: false, smoke: true, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.equal(r.ok, false, 'debe bloquear: no hay dato confiable');
  assert.ok(has(r.blockers, /ausente o vencida/i),
    'el sensor caído cae en la red "ausente o vencida": ' + JSON.stringify(r.blockers));
});

test('sensor caído se considera NO fresco', () => {
  const r = decide({}, { online: false, temperature: 25, at: AT }, { unattended: true }, NOW);
  assert.equal(r.fresh, false, 'online:false ⇒ no fresco aunque el timestamp sea reciente');
});

test('sin enforce, el sensor caído en trabajo desatendido AVISA (warning), no pasa mudo', () => {
  const r = decide({ enforce: false }, { online: false, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.ok(has(r.warnings, /ausente o vencida/i), 'debe advertir: ' + JSON.stringify(r.warnings));
});

test('no se confía en valores de peligro de un sensor caído (no bloquea por su temp)', () => {
  // temp 99 pero online:false → NO debe salir "temperatura sobre el máximo"
  // (dato no confiable); en su lugar sale "ausente o vencida".
  const r = decide({ enforce: true }, { online: false, temperature: 99, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.ok(!has(r.blockers, /Temperatura/i), 'no bloquea por un valor no confiable');
  assert.ok(has(r.blockers, /ausente o vencida/i));
});

// ── El sensor EN LÍNEA sigue funcionando igual (no rompimos nada) ─────────

test('sensor en línea con humo SÍ bloquea (peligro real)', () => {
  const r = decide({ enforce: true }, { online: true, smoke: true, ventilation: true, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.equal(r.ok, false);
  assert.ok(has(r.blockers, /humo/i), JSON.stringify(r.blockers));
});

test('sensor en línea con temperatura alta bloquea', () => {
  const r = decide({ enforce: true }, { online: true, temperature: 50, smoke: false, ventilation: true, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.ok(has(r.blockers, /Temperatura/i), JSON.stringify(r.blockers));
});

test('lectura sana en línea deja arrancar', () => {
  const r = decide({ enforce: true },
    { online: true, temperature: 25, humidity: 40, voc: 100, smoke: false, ventilation: true, at: AT },
    { unattended: true, cameraConfigured: true }, NOW);
  assert.equal(r.ok, true, 'sin bloqueos: ' + JSON.stringify(r.blockers));
  assert.equal(r.blockers.length, 0);
});

// ── Vencida (comportamiento previo intacto) ──────────────────────────────

test('lectura vencida en trabajo desatendido cae en "ausente o vencida"', () => {
  const r = decide({ enforce: true }, { online: true, smoke: false, ventilation: true, at: AT },
    { unattended: true, cameraConfigured: true }, STALE);
  assert.equal(r.fresh, false);
  assert.ok(has(r.blockers, /ausente o vencida/i));
});

// ── El código lo dice ────────────────────────────────────────────────────

test('fresh exige que el sensor esté en línea', () => {
  assert.match(BODY, /reading\.online!==false&&/, 'la frescura incluye online');
});
