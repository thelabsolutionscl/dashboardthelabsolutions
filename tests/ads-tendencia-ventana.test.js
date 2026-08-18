#!/usr/bin/env node
/*
 * Google Ads · las tendencias (↑/↓ %) comparan el MISMO largo de ventana.
 *
 * adsSaveSnapshot guarda cada foto con su `days` (7/30/90), pero
 * adsGetPrevSnapshot devolvía snaps[length-2] SIN mirar `days`. Como
 * impresiones/clics/conversiones son totales que escalan con la ventana, comparar
 * el total de 30 días de hoy contra el de 7 días de ayer pintaba subidas o caídas
 * FALSAS de ~±300% — invitando a subir o recortar presupuesto sobre un artefacto.
 * Ahora solo compara contra la foto anterior del mismo `days`.
 *
 * Se monta el adsGetPrevSnapshot REAL con localStorage y hoyCL simulados.
 *
 * Correr:  node --test tests/ads-tendencia-ventana.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'seo-ads.js'), 'utf8');
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
const HOY = '2026-08-02';
function montar(snaps) {
  const localStorage = { getItem: (k) => (k === 'ads_snapshots' ? JSON.stringify(snaps) : null) };
  return new Function('localStorage', 'hoyCL', extract('adsGetPrevSnapshot') + '\nreturn adsGetPrevSnapshot;')(localStorage, () => HOY);
}
const snap = (date, days, imp) => ({ date, days, imp });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('ayer 7 días, hoy 30 días: NO hay comparación (evita el +300% falso)', () => {
  const prev = montar([snap('2026-08-01', 7, 22000), snap(HOY, 30, 94000)])(30);
  assert.equal(prev, null, 'sin foto previa de 30 días, no se compara');
});

test('sí compara contra la foto anterior del MISMO largo de ventana', () => {
  const prev = montar([
    snap('2026-07-31', 30, 90000),  // 30 días, anteayer
    snap('2026-08-01', 7, 22000),   // 7 días, ayer (se ignora para 30)
    snap(HOY, 30, 94000),           // hoy 30 días
  ])(30);
  assert.ok(prev, 'hay foto previa de 30 días');
  assert.equal(prev.imp, 90000, 'toma la de 30 días, no la de 7');
});

test('para 7 días toma la foto de 7, no la de 30', () => {
  const prev = montar([
    snap('2026-07-31', 30, 90000),
    snap('2026-08-01', 7, 22000),
    snap(HOY, 7, 25000),
  ])(7);
  assert.equal(prev.imp, 22000);
});

test('toma la MÁS RECIENTE previa del mismo largo', () => {
  const prev = montar([
    snap('2026-07-29', 30, 80000),
    snap('2026-07-31', 30, 90000),
    snap(HOY, 30, 94000),
  ])(30);
  assert.equal(prev.imp, 90000, 'la del 31, no la del 29');
});

// ── Bordes ───────────────────────────────────────────────────────────────

test('solo la foto de hoy: no hay con qué comparar', () => {
  assert.equal(montar([snap(HOY, 30, 94000)])(30), null);
});

test('sin fotos: null', () => {
  assert.equal(montar([])(30), null);
});

test('la foto de HOY nunca es la "anterior" (aunque coincida el largo)', () => {
  // Solo existe hoy con days 30 → no debe devolverse a sí misma.
  assert.equal(montar([snap(HOY, 30, 94000)])(30), null);
});

// ── Los llamadores pasan la ventana ──────────────────────────────────────

test('los dos llamadores pasan el período a adsGetPrevSnapshot', () => {
  const wa = fs.readFileSync(path.join(__dirname, '..', 'js', 'web-analytics.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(wa, /adsGetPrevSnapshot\(days\)/, 'renderAdsKPIs pasa days');
  assert.match(html, /adsGetPrevSnapshot\(adsDays\)/, 'el detector de anomalías pasa adsDays');
  assert.match(SRC, /s\.date!==today&&\(days==null\|\|s\.days===days\)/, 'filtra por mismo largo de ventana');
});
