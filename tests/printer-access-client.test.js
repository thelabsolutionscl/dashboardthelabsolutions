'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/printer-access-client.js', 'utf8');
const loader = fs.readFileSync('js/calendario.js', 'utf8');

test('adaptador elimina tokens de headers y query strings', () => {
  assert.match(source, /searchParams\.delete\('bt'\)/);
  assert.match(source, /headers\.delete\('X-Bridge-Token'\)/);
  assert.match(source, /headers\.delete\('X-Bridge-Read-Token'\)/);
  assert.match(source, /headers\.delete\('X-Bridge-Admin-Token'\)/);
});

test('peticiones remotas usan cookie HttpOnly de Cloudflare Access', () => {
  assert.match(source, /credentials: 'include'/);
  assert.match(source, /thelab:printer-auth-required/);
  assert.match(source, /openLogin/);
});

test('WebSocket y medios también se sanitizan', () => {
  assert.match(source, /AccessWebSocket/);
  assert.match(source, /window\._appendBridgeToken/);
  assert.match(source, /window\.printerMediaUrl/);
  assert.match(source, /window\.printerCamUrl/);
});

test('cargador instala seguridad de impresoras antes de módulos operacionales', () => {
  assert.match(loader, /printerAccess/);
  const securityLoad = loader.indexOf("loadModule('printerAccess')");
  const operationsLoad = loader.indexOf("loadModule('operations')");
  assert.ok(securityLoad >= 0 && operationsLoad > securityLoad);
});
