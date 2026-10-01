'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const INDEX=fs.readFileSync('index.html','utf8');
const PAGE=fs.readFileSync('manual.html','utf8');
const MANUAL=fs.readFileSync('docs/manual/MANUAL_USUARIO.md','utf8');

test('el manual vive en el menú de usuario',()=>{
  assert.match(INDEX,/openUserManual\(\)[\s\S]{0,240}Manual de usuario/);
  assert.match(INDEX,/function openUserManual\(\)/);
  assert.match(INDEX,/manual\.html/);
});

test('la página del manual carga la fuente markdown y permite imprimir',()=>{
  assert.match(PAGE,/docs\/manual\/MANUAL_USUARIO\.md/);
  assert.match(PAGE,/window\.print\(\)/);
  assert.match(PAGE,/id="search"/);
  assert.match(PAGE,/id="toc"/);
});

test('el manual cubre las secciones operativas principales',()=>{
  for(const title of [
    'OVERVIEW','CLIENTES','COTIZACIONES','PEDIDOS','INVENTARIO','PROVEEDORES',
    'AGENTES IA','OFICINA','REDES SOCIALES','NEWSLETTER','MÁQUINAS','EQUIPO',
    'CALENDARIO','REPORTES','WEB','FINANZAS','REMUNERACIONES','CORREO',
    'CENTRO DE CONEXIONES','APARIENCIA'
  ]) assert.ok(MANUAL.includes(title),title);
});

test('documenta las vistas canónicas actuales',()=>{
  assert.match(MANUAL,/Solo Simple:[\s\S]*Overview[\s\S]*Calendario[\s\S]*Clientes[\s\S]*Cotizaciones[\s\S]*Pedidos[\s\S]*Máquinas[\s\S]*Equipo[\s\S]*Web/);
  assert.match(MANUAL,/Solo Experto:[\s\S]*Newsletter/);
});
