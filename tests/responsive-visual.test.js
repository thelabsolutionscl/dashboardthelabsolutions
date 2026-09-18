#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert');
const fs=require('node:fs');

const CSS=fs.readFileSync('styles.css','utf8');
const OP=fs.readFileSync('operativo-visual.css','utf8');
const PROV=fs.readFileSync('js/proveedores.js','utf8');
const FIN=fs.readFileSync('js/finanzas.js','utf8');

test('el shell tablet no mezcla rail de escritorio con navegación móvil',()=>{
  assert.match(CSS,/@media\(min-width:901px\)\{[\s\S]*?body\{padding-left:64px/);
  assert.match(CSS,/@media\(min-width:769px\) and \(max-width:900px\)\{[\s\S]*?\.icon-dock\{display:none\}/);
  assert.match(CSS,/@media\(min-width:769px\) and \(max-width:900px\)\{[\s\S]*?\.mobile-menu-btn:not\(#mobilePlusBtn\)\{[^}]*min-width:44px[^}]*min-height:44px/);
});

test('landscape compacto queda acotado a pantallas móviles/tablet',()=>{
  assert.match(CSS,/@media\(max-width:900px\) and \(max-height:500px\) and \(orientation:landscape\)/);
  assert.doesNotMatch(CSS,/@media\(max-height:500px\) and \(orientation:landscape\)/);
});

test('no quedan breakpoints duplicados de 760px',()=>{
  assert.doesNotMatch(CSS,/@media\(max-width:760px\)/);
  assert.doesNotMatch(OP,/@media\(max-width:760px\)/);
});

test('las tablas móviles reciben etiquetas incluso si se crean después',()=>{
  assert.match(PROV,/function bootMobileTableLabels\(\)/);
  assert.match(PROV,/initMobileTableLabels\(\);/);
  assert.match(PROV,/new MutationObserver\([\s\S]*?querySelectorAll\?\.\('\.table-wrap table'\)\.forEach\(applyTableLabels\)/);
  assert.match(PROV,/DOMContentLoaded['"],bootMobileTableLabels/);
});

test('la búsqueda global se inicializa y tiene lanzador móvil',()=>{
  assert.match(FIN,/function bootGlobalSearch\(\)[\s\S]*?initGlobalSearch\(\);/);
  assert.match(FIN,/mobileGlobalSearchBtn/);
  assert.match(FIN,/classList\.add\('mobile-open'\)/);
  assert.match(CSS,/#mobileGlobalSearchBtn\{display:none;?\}/);
  assert.match(CSS,/@media\(max-width:900px\)\{[\s\S]*?#mobileGlobalSearchBtn\{display:inline-flex[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(CSS,/@media\(max-width:900px\)\{[\s\S]*?\.global-search\.mobile-open\{[^}]*display:flex!important[^}]*position:fixed/);
  assert.match(FIN,/btn\.addEventListener\('click',e=>\{[\s\S]*?e\.stopPropagation\(\)/);
  assert.match(CSS,/\.global-search\.mobile-open\{[^}]*position:fixed/);
});

test('Máquinas no queda debajo del topbar al hacer scroll',()=>{
  assert.match(CSS,/\.maq-workspace-nav\{[^}]*position:sticky;top:var\(--topbar-h\)/);
  assert.match(CSS,/:root\{[^}]*--topbar-h:64px/);
});

test('Visual AI evita el min-height rígido en móvil',()=>{
  assert.match(CSS,/@media\(max-width:900px\)\{[\s\S]*?#tab-visual \.vai-frame-wrap\{height:calc\(100dvh - 150px\);min-height:260px\}/);
});

test('la semántica de estados tiene presentación visual compartida',()=>{
  for(const tone of ['success','production','warning','danger','info','analysis','neutral']){
    assert.ok(CSS.includes(`[data-semantic-kind="badge"][data-semantic-tone="${tone}"]`),tone);
  }
  assert.match(CSS,/\.badge-yellow\{[^}]*var\(--warn\)/);
});

test('móvil usa un único dueño de scroll para modales ordinarios',()=>{
  assert.match(OP,/@media\(max-width:768px\)\{[\s\S]*?\.modal-overlay:not\(#clienteDetalleModal\)\{overflow:hidden/);
  assert.match(OP,/\.modal-overlay:not\(#clienteDetalleModal\)>\.modal-card\{overflow-y:auto/);
});

test('la legibilidad y los targets móviles tienen un piso explícito',()=>{
  assert.match(CSS,/--text3:#8a8a8a/);
  assert.match(CSS,/\.notif-btn\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(CSS,/\.mobile-menu-btn:not\(#mobilePlusBtn\)\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(CSS,/#tab-maquinas small\{font-size:10\.5px\}/);
});
