#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const BRIDGE=fs.readFileSync(path.join(ROOT,'printer-bridge','server.js'),'utf8');

test('un bridge nuevo detecta un Farm Controller padre obsoleto y solicita reinicio completo',()=>{
  assert.match(BRIDGE,/async function maybeRestartStaleFarmParent/);
  assert.match(BRIDGE,/farm-controller\.js/);
  assert.match(BRIDGE,/fs\.statSync\(controllerFile\)\.mtimeMs/);
  assert.match(BRIDGE,/process\.kill\(ppid,'SIGTERM'\)/);
  assert.match(BRIDGE,/maybeRestartStaleFarmParent\(\)/);
});

test('AUDITAR puede actualizar un backend antiguo sólo con rol admin y esperar API V3',()=>{
  assert.match(OPS,/async function updatePrinterAuditBackend/);
  assert.match(OPS,/_printerAuditRole\(\)!=='admin'/);
  assert.match(OPS,/\/update/);
  assert.match(OPS,/async function _waitPrinterAuditBackendV3/);
  assert.match(OPS,/capabilities\?\.auditRun/);
  assert.match(OPS,/auditApiVersion/);
  assert.match(OPS,/PRINTER_AUDIT_API_VERSION=3/);
  assert.match(OPS,/async function fetchPrinterAuditScan/);
  assert.match(OPS,/requiere Auditoría V3/);
});

test('el primer uso comprueba API V3 antes de ejecutar audit-scan',()=>{
  const start=OPS.indexOf('async function fetchPrinterAuditScan');
  const end=OPS.indexOf('async function updatePrinterAuditPermission',start);
  const block=OPS.slice(start,end);
  assert.match(block,/await ensurePrinterAuditBackendV3\(machineId\)/);
  const matches=block.match(/\/farm\/audit-scan\//g)||[];
  assert.equal(matches.length,1);
});
