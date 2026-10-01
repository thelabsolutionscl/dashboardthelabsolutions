#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../js/maquinas-eta-clarity.js');

const ROOT=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(ROOT,'js/maquinas-eta-clarity.js'),'utf8');
const loader=fs.readFileSync(path.join(ROOT,'js/farm-health-adapter.js'),'utf8');

test('formatea tiempo restante para lectura operacional',()=>{
  assert.equal(api.remainingLabel(29*60),'29 min');
  assert.equal(api.remainingLabel(65*60),'1 h 5 min');
  assert.equal(api.remainingLabel(3600),'1 h');
});

test('la hora libre usa formato 24 horas sin AM/PM',()=>{
  const s=api.freeAt(0,new Date(2026,7,21,0,46,0).getTime());
  assert.match(s,/^\d{2}:\d{2}$/);
  assert.doesNotMatch(s,/a\.?\s*m\.?|p\.?\s*m\.?/i);
});

test('el gráfico explica ETA y no vuelve a mostrar porcentaje de progreso',()=>{
  assert.match(source,/Disponibilidad de máquinas/);
  assert.match(source,/Imprimiendo — \$\{rem\} restantes/);
  assert.match(source,/Libre \$\{free\}/);
  assert.match(source,/barra = tiempo restante/);
  assert.doesNotMatch(source,/pct\s*=/);
  assert.doesNotMatch(source,/% · libre/);
});

test('la extensión se carga desde el bootstrap del dashboard',()=>{
  assert.match(loader,/js\/maquinas-eta-clarity\.js/);
  assert.match(loader,/claridad de disponibilidad de máquinas/);
});
