#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const JS=fs.readFileSync('js/finanzas.js','utf8');
const HTML=fs.readFileSync('index.html','utf8');
test('ruedita móvil abre el menú de usuario dedicado',()=>{
 assert.match(HTML,/id="mobileUserMenuBtn" onclick="openMobileUserMenu\(event\)"/);
 assert.doesNotMatch(HTML,/closeMobileMenu\(\);setTimeout\(openUserMenu,350\)/);
});
test('menú móvil escapa del userChip oculto',()=>{
 const i=JS.indexOf('function openMobileUserMenu(');assert.ok(i>=0);
 const b=JS.slice(i,i+900);
 assert.match(b,/menu\.parentElement!==document\.body/);
 assert.match(b,/document\.body\.appendChild\(menu\)/);
 assert.match(b,/menu\.classList\.add\('open'\)/);
});
