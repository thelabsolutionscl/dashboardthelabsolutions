#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const CSS=fs.readFileSync('styles.css','utf8');

test('móvil no oculta con display:none el padre del menú de usuario',()=>{
  assert.doesNotMatch(CSS,/\.topbar-right[^\n]*\.user-chip\{display:none!important\}/,
    'display:none en .user-chip hace imposible mostrar #userMenu hijo');
  assert.match(CSS,/#userChip\{[^}]*visibility:hidden!important[^}]*pointer-events:none!important/,
    'el chip puede ocultarse sin sacar su menú del árbol de render');
});

test('menú de usuario abierto se muestra como sheet móvil',()=>{
  assert.match(CSS,/\.user-menu\.open\{[^}]*position:fixed!important[^}]*visibility:visible!important[^}]*pointer-events:auto!important/,
    'el menú abierto debe recuperar visibilidad e interacción');
});
