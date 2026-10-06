#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const wf=fs.readFileSync(path.join(root,'.github/workflows/update-farm-controller.yml'),'utf8');

test('workflow remoto actualiza el Controller sin exponer la credencial',()=>{
  assert.match(wf,/workflow_dispatch/);
  assert.match(wf,/printer-bridge\/\*\*/);
  assert.match(wf,/secrets\.PRINTER_ADMIN_TOKEN \|\| secrets\.PRINTER_TUNNEL_TOKEN/);
  assert.match(wf,/-X POST 'https:\/\/printers\.thelab\.solutions\/update'/);
  assert.match(wf,/-H "X-Bridge-Token: \$\{FARM_TOKEN\}"/);
  assert.doesNotMatch(wf,/echo[^\n]*FARM_TOKEN/);
});

test('workflow no declara éxito hasta ver commit nuevo y bridge interno autenticado',()=>{
  assert.match(wf,/healthz/);
  assert.match(wf,/legacyReady/);
  assert.match(wf,/EXPECTED: \$\{\{ github\.sha \}\}/);
  assert.match(wf,/revision/);
  assert.match(wf,/exit 1/);
});
