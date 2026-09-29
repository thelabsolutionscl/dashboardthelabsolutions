#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const machines=fs.readFileSync(path.join(root,'js/maquinas.js'),'utf8');
const createLead=html.split('function createLead(){')[1]?.split('\nfunction ')[0]||'';
const clearForm=machines.split('function clearForm(type){')[1]?.split('\n}')[0]||'';

test('formulario de lead permite origen explícitamente desconocido',()=>{
  assert.match(html, /id="nl-origen"><option value="">— Sin atribución · por verificar —<\/option><option>Referido<\/option>/);
});
test('limpiar lead no selecciona Referido por defecto',()=>{
  assert.match(clearForm, /getElementById\('nl-origen'\)\.value='';/);
  assert.doesNotMatch(clearForm, /getElementById\('nl-origen'\)\.value='Referido'/);
});
test('crear lead omite origen si nadie seleccionó fuente',()=>{
  assert.match(createLead, /if\(!fields\['Origen lead'\]\) delete fields\['Origen lead'\];/);
});
