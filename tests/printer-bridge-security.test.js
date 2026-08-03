'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('printer-bridge/secure-launcher.js', 'utf8');
const installer = fs.readFileSync('printer-bridge/install-launchd.sh', 'utf8');

test('gateway de impresoras escucha solo en loopback por defecto', () => {
  assert.match(source, /BRIDGE_HOST \|\| '127\.0\.0\.1'/);
  assert.match(installer, /<string>127\.0\.0\.1<\/string>/);
});

test('exige allowlist exacta de impresoras y puertos', () => {
  assert.match(source, /loadPrinterAllowlist/);
  assert.match(source, /PRINTERS\.has\(target\.ip\)/);
  assert.match(source, /PORTS\.has\(target\.port\)/);
  assert.match(installer, /Falta la allowlist exacta de impresoras/);
});

test('separa lectura, escritura y administración', () => {
  assert.match(source, /role: 'admin'/);
  assert.match(source, /role: 'reader'/);
  assert.match(source, /WRITE_EMAILS/);
  assert.match(source, /printer\/gcode\/script/);
  assert.match(source, /identity\.role === 'admin'/);
});

test('token maestro es interno y no se acepta por query string', () => {
  assert.match(source, /INTERNAL_TOKEN = crypto\.randomBytes/);
  assert.match(source, /searchParams\.delete\('bt'\)/);
  assert.match(source, /BRIDGE_ALLOW_LEGACY_TOKEN/);
  assert.match(source, /ALLOW_LEGACY_TOKEN &&/);
});

test('Cloudflare Access aporta identidad y las acciones quedan auditadas', () => {
  assert.match(source, /cf-access-authenticated-user-email/);
  assert.match(source, /bridgeAudit/);
  assert.match(source, /requestId/);
});
