'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const SOURCE = fs.readFileSync('js/runtime-bridges.js', 'utf8');

function runtime(initialStatus = {}) {
  const listeners = new Map();
  const context = {
    console,
    Date,
    Intl,
    JSON,
    Math,
    Object,
    Array,
    Set,
    structuredClone,
    _printerStatus: initialStatus,
    window: {},
    document: {
      addEventListener(name, handler) { listeners.set(name, handler); },
    },
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { context, listeners, telemetry: context.window.PrinterTelemetry, time: context.window.TheLabTime };
}

test('fecha local de Santiago no cambia anticipadamente por UTC', () => {
  const { time } = runtime();
  const instant = new Date('2026-08-03T02:30:00.000Z');
  assert.equal(time.localISODate(instant), '2026-08-02');
});

test('daysBetween opera con fechas calendario, no con hora UTC', () => {
  const { time } = runtime();
  assert.equal(time.daysBetween('2026-08-02', '2026-08-03'), 1);
  assert.equal(time.daysBetween('2026-08-03', '2026-08-02'), -1);
  assert.equal(time.daysBetween('invalida', '2026-08-02'), null);
});

test('PrinterTelemetry devuelve copias y no permite mutar el estado real', () => {
  const source = { k2: { state: 'printing', progress: 42, hotend: { actual: 220 } } };
  const { telemetry } = runtime(source);
  const value = telemetry.get('k2');
  value.progress = 99;
  value.hotend.actual = 10;
  assert.equal(source.k2.progress, 42);
  assert.equal(source.k2.hotend.actual, 220);
  assert.deepEqual({ ...telemetry.get('k2') }, source.k2);
});

test('suscriptores reciben eventos y pueden desuscribirse', () => {
  const { telemetry, listeners } = runtime();
  let count = 0;
  const unsubscribe = telemetry.subscribe(() => { count += 1; });
  listeners.get('printerstatus')({ detail: { id: 'k2' } });
  assert.equal(count, 1);
  unsubscribe();
  listeners.get('printerstatus')({ detail: { id: 'k2' } });
  assert.equal(count, 1);
});
