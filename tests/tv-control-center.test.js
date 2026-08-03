'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const tv = fs.readFileSync('js/tv-control-center.js', 'utf8');
const loader = fs.readFileSync('js/calendario.js', 'utf8');
const branding = fs.readFileSync('js/tv-logo-fix.js', 'utf8');

test('Modo TV usa la API de telemetría y no exige window._printerStatus', () => {
  assert.match(tv, /window\.PrinterTelemetry\?\.get/);
  assert.doesNotMatch(tv, /window\._printerStatus/);
  assert.match(tv, /STale_AFTER_MS|STALE_AFTER_MS/);
});

test('Modo TV calcula fecha y reloj en America/Santiago', () => {
  assert.match(tv, /America\/Santiago/);
  assert.match(tv, /localToday/);
  assert.doesNotMatch(tv, /toISOString\(\)\.slice\(0,\s*10\)/);
});

test('refresco de datos no reinicia la rotación automática', () => {
  assert.match(tv, /refreshTimer\s*=\s*setInterval\(\(\)\s*=>\s*render\(\),\s*30000\)/);
  assert.match(tv, /function scheduleRotation\(\)/);
  const renderBody = tv.slice(tv.indexOf('function render('), tv.indexOf('function clearTimers('));
  assert.ok(!renderBody.includes('scheduleRotation()'), 'render no debe reiniciar el timeout de rotación');
});

test('Modo TV expone cierre por Escape y evita MutationObserver global', () => {
  assert.match(tv, /event\.key === 'Escape'/);
  assert.doesNotMatch(tv, /new MutationObserver/);
  assert.match(tv, /prefers-reduced-motion/);
});

test('branding no modifica headers ni observa todo el DOM', () => {
  assert.match(branding, /window\.TVLogoFix/);
  assert.doesNotMatch(branding, /MutationObserver/);
  assert.doesNotMatch(branding, /prepend\(/);
});

test('cargador propaga versión y mantiene módulos desacoplados', () => {
  assert.match(loader, /buildQuery/);
  assert.match(loader, /Promise\.allSettled/);
  assert.match(loader, /runtime-bridges\.js/);
  assert.match(loader, /thelab:calendar-ready/);
});
