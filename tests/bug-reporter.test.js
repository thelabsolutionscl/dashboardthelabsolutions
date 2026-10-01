#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const INDEX=fs.readFileSync('index.html','utf8');
const SRC=fs.readFileSync('js/bug-reporter.js','utf8');

test('Mi cuenta expone Reportar problema y carga su módulo',()=>{
  assert.match(INDEX,/onclick="openBugReporter\(\)"[^>]*>[\s\S]*?Reportar problema/);
  assert.match(INDEX,/js\/bug-reporter\.js\?v=%%BUILD%%/);
  assert.match(SRC,/root\.openBugReporter=open/);
});
test('el formulario acepta descripción, screenshot y muestra historial',()=>{
  assert.match(SRC,/tlsBugMessage/);
  assert.match(SRC,/type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(SRC,/shared\/bug-reports/);
  assert.match(SRC,/Historial/);
  assert.match(SRC,/Enviar a reparación IA/);
  assert.match(SRC,/MAX_DATA_URL=42000/,'la imagen debe quedar acotada para el presupuesto de visión');
});
test('el reporte adjunta contexto operativo sin secretos',()=>{
  assert.match(SRC,/section:/);
  assert.match(SRC,/path:/);
  assert.match(SRC,/build:/);
  assert.match(SRC,/viewport:/);
  assert.match(SRC,/userAgent:/);
  assert.doesNotMatch(SRC,/AIRTABLE_TOKEN|ANTHROPIC_TOKEN|OPENAI_TOKEN/);
});
test('los estados de reparación son visibles en el historial',()=>{
  for(const s of ['nuevo','analizando','reparando','pr_creado','needs_review','resuelto','error','cerrado'])
    assert.match(SRC,new RegExp(s));
});
