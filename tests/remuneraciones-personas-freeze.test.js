#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','js','remuneraciones-personas.js'),'utf8');

test('PERSONAS no observa mutaciones de todo el subárbol',()=>{
  assert.doesNotMatch(src,/observe\([^)]*,\s*\{childList:true,subtree:true\}\)/);
});

test('solo actualiza el texto del botón cuando realmente cambia',()=>{
  assert.match(src,/if\(b\.textContent!==label\)b\.textContent=label/);
});
