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

test('la ficha permite editar base, valor diario y conservar días antiguos',()=>{
  assert.match(src,/Sueldo base mensual/);
  assert.match(src,/Valor por día/);
  assert.match(src,/Días anteriores sin fecha/);
  assert.match(src,/step=\"0\.5\"/);
});

test('permite registrar cada jornada con fecha fracción y detalle',()=>{
  assert.match(src,/Registrar día trabajado/);
  assert.match(src,/type=\"date\"/);
  assert.match(src,/Día completo/);
  assert.match(src,/Medio día/);
  assert.match(src,/Detalle de lo realizado/);
  assert.match(src,/jornadas/);
  assert.match(src,/fecha/);
  assert.match(src,/detalle/);
  assert.match(src,/fraccion/);
});

test('evita registrar más de un día en la misma fecha',()=>{
  assert.match(src,/same\+fraccion>1/);
  assert.match(src,/misma fecha no puedes registrar más de 1 día/);
});

test('el guardado es defensivo y no fuerza render de REMUNERACIONES',()=>{
  assert.match(src,/try\{[\s\S]*remPersonaSaveModal/);
  assert.match(src,/localStorage\.setItem\(REM_PERSONA_STORAGE_KEY/);
  assert.match(src,/remuneraciones-dias-updated/);
  assert.doesNotMatch(src,/root\.renderRemuneraciones\(\)/);
});

test('la ficha reutiliza el almacenamiento de REMUNERACIONES',()=>{
  assert.match(src,/thelab_remuneraciones_dias_v1/);
  assert.match(src,/rem_sueldos_v1/);
  assert.match(src,/America\/Santiago/);
});

test('el observer no vuelve a observar todo el subárbol',()=>{
  assert.match(src,/observe\(body,\{childList:true\}\)/);
  assert.doesNotMatch(src,/subtree:true/);
});

test('el bootstrap carga la extensión de PERSONAS después del módulo de días',()=>{
  const base=loader.indexOf("load('js/remuneraciones-dias.js'");
  const personas=loader.indexOf("load('js/remuneraciones-personas.js'");
  assert.ok(base>=0,'debe cargar remuneraciones-dias.js');
  assert.ok(personas>base,'debe cargar remuneraciones-personas.js después del módulo base');
});
