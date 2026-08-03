'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/production-state.js', 'utf8');

test('estado de producción sincroniza cola y odómetro con el gateway', () => {
  assert.match(source, /REMOTE_KEY = 'print-queue'/);
  assert.match(source, /ODO_REMOTE_KEY = 'printer-odometer'/);
  assert.match(source, /DashboardGateway/);
  assert.match(source, /If-Match|state\.put/);
});

test('cola persistente tiene identificadores, estado y reconciliación', () => {
  assert.match(source, /id: jobId/);
  assert.match(source, /status: job\?\.status \|\| 'pending'/);
  assert.match(source, /function mergeQueues/);
  assert.match(source, /updatedAt >= previous\.updatedAt/);
  assert.match(source, /BroadcastChannel/);
});

test('odómetro evita duplicar contadores entre navegadores', () => {
  assert.match(source, /Math\.max\(Number\(a\.hours/);
  assert.match(source, /Math\.max\(Number\(a\.filamentMm/);
  assert.match(source, /Math\.max\(Number\(a\.prints/);
});

test('mantiene fallback local cuando el gateway no está disponible', () => {
  assert.match(source, /localStorage\.setItem\(QUEUE_LOCAL_KEY/);
  assert.match(source, /localStorage\.setItem\(ODO_LOCAL_KEY/);
  assert.match(source, /if \(!gateway\?\.state \|\| !gateway\.getBase\?\.\(\)\) return/);
});
