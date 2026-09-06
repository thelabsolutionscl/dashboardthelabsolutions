#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','js','remuneraciones-personas.js'),'utf8');
const loader=fs.readFileSync(path.join(__dirname,'..','js','farm-health-adapter.js'),'utf8');

test('PERSONAS expone acceso directo a remuneración',()=>{
  assert.match(src,/data-rem-person-btn/);
  assert.match(src,/💰 Remuneración/);
  assert.match(src,/openRemuneracionPersona/);
});

test('la ficha permite editar base, valor diario y días trabajados',()=>{
  assert.match(src,/Sueldo base mensual/);
  assert.match(src,/Valor por día/);
  assert.match(src,/Días trabajados/);
  assert.match(src,/max=\"31\"/);
  assert.match(src,/step=\"0\.5\"/);
});

test('la ficha reutiliza el almacenamiento de REMUNERACIONES',()=>{
  assert.match(src,/thelab_remuneraciones_dias_v1/);
  assert.match(src,/rem_sueldos_v1/);
  assert.match(src,/America\/Santiago/);
});

test('el bootstrap carga la extensión de PERSONAS después del módulo de días',()=>{
  const base=loader.indexOf("load('js/remuneraciones-dias.js'");
  const personas=loader.indexOf("load('js/remuneraciones-personas.js'");
  assert.ok(base>=0,'debe cargar remuneraciones-dias.js');
  assert.ok(personas>base,'debe cargar remuneraciones-personas.js después del módulo base');
});
