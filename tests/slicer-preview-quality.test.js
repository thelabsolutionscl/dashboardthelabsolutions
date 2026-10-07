#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');

const SRC=fs.readFileSync(path.join(__dirname,'..','js','slicer3d.js'),'utf8');

test('preview usa alto CSS real y DPR acotado',()=>{
  assert.match(SRC,/clientHeight\|\|300/);
  assert.match(SRC,/Math\.min\(window\.devicePixelRatio\|\|1,2\)/);
  assert.doesNotMatch(SRC,/const dpr=window\.devicePixelRatio\|\|1,w=cv\.clientWidth\|\|420,h=300/);
});

test('preview conserva una muestra mas densa para normales y curvas',()=>{
  assert.match(SRC,/cap=30000/);
  assert.doesNotMatch(SRC,/cap=12000/);
});

test('sombreado no aplana cada triangulo a un unico promedio',()=>{
  assert.match(SRC,/const lights=\[\],specs=\[\]/);
  assert.match(SRC,/createLinearGradient/);
  assert.match(SRC,/range>0\.025/);
  assert.doesNotMatch(SRC,/diff=Math\.min\(1,diff\/3\);spec=spec\/3\*0\.5/);
});

test('costura de triangulos tapa grietas de antialias sin usar un color de arista',()=>{
  assert.match(SRC,/lineWidth=1\.25/);
  assert.match(SRC,/ctx\.strokeStyle=paint/);
  assert.match(SRC,/ctx\.lineCap='round'/);
});

test('al soltar la rotacion se fuerza un repintado final',()=>{
  const i=SRC.indexOf("cv.addEventListener('pointerup'");
  assert.ok(i>=0);
  const block=SRC.slice(i,i+500);
  assert.match(block,/else render\(\)/);
});


test('rotacion del preview queda limitada a un frame y recupera pointercancel',()=>{
  assert.match(SRC,/requestAnimationFrame\(\(\)=>\{_rotRaf=0;render\(\);\}\)/);
  assert.match(SRC,/cancelAnimationFrame\(_rotRaf\)/);
  assert.match(SRC,/addEventListener\('pointercancel'/);
});
