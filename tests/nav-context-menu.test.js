'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const nav=require('../js/nav-context-menu.js');

test('layout del menú normaliza, reordena y conserva pestañas nuevas',()=>{
  const {normalizeState,mergeOrder,moveTab}=nav._test;
  assert.deepEqual(normalizeState({order:['cotizaciones','pedidos','cotizaciones'],hidden:['web','web']}),{
    order:['cotizaciones','pedidos'],hidden:['web']
  });
  assert.deepEqual(mergeOrder(['pedidos','cotizaciones'],['overview','cotizaciones','pedidos','clientes']),[
    'pedidos','cotizaciones','overview','clientes'
  ]);
  assert.deepEqual(moveTab(['overview','cotizaciones','pedidos'],'pedidos',-1),['overview','pedidos','cotizaciones']);
  assert.deepEqual(moveTab(['overview','cotizaciones','pedidos'],'overview',-1),['overview','cotizaciones','pedidos']);
});

test('abrir en pestaña o ventana nueva genera un deep-link seguro al módulo',()=>{
  const {tabUrl,TAB_PARAM}=nav._test;
  const out=new URL(tabUrl('https://dashboard.example.com/index.html?foo=1#x','cotizaciones'));
  assert.equal(out.searchParams.get('foo'),'1');
  assert.equal(out.searchParams.get(TAB_PARAM),'cotizaciones');
  assert.equal(out.hash,'#x');
});

test('click derecho ofrece ocultar, mover y abrir el módulo fuera de la pantalla actual',()=>{
  const src=fs.readFileSync('js/nav-context-menu.js','utf8');
  for(const token of [
    "contextmenu","Abrir en pestaña nueva","Abrir en ventana nueva",
    "Mover arriba","Mover abajo","Ocultar del menú","Menús ocultos",
    "Restaurar orden original","tls-nav-hidden","MutationObserver"
  ]) assert.ok(src.includes(token),`falta ${token}`);
  assert.match(src,/\.dock-btn\[data-tab\],\.mbd-btn\[data-tab\],\.mg-item\[data-tab\]/);
  assert.match(src,/searchParams\.set\(TAB_PARAM/);
  assert.match(src,/typeof win\.switchTab==='function'/);
});

test('la extensión contextual se carga desde el bootstrap visual global',()=>{
  const loader=fs.readFileSync('js/farm-health-adapter.js','utf8');
  assert.match(loader,/load\('js\/nav-context-menu\.js','personalización contextual del menú'\)/);
});
