#!/usr/bin/env node
/*
 * Órdenes de compra a proveedores: el total tiene que cuadrar con las líneas.
 *
 * guardarOC() guarda los ítems filtrados (los que tienen nombre y cantidad),
 * pero el total lo tomaba de ocCalc(), que suma TODAS las filas del formulario
 * —incluida una con cantidad y precio pero sin nombre—. Resultado: el PDF que
 * ve el proveedor listaba líneas que sumaban menos que el total impreso.
 * Reproducido: dos filas ($60.000 con nombre + $24.000 sin nombre) → el detalle
 * mostraba $60.000 y el total decía $84.000.
 *
 * Se montan las funciones REALES del módulo sobre un DOM simulado.
 *
 * Correr:  node --test tests/orden-compra.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PROV = fs.readFileSync(path.join(RAIZ, 'js', 'proveedores.js'), 'utf8');

function bloque(marca) {
  const i = PROV.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = PROV.indexOf('{', i); x < PROV.length; x++) {
    if (PROV[x] === '{') d++;
    if (PROV[x] === '}') { d--; if (!d) return PROV.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// ── DOM simulado: solo lo que tocan estas funciones ─────────────────────
function montar(filas) {
  const avisos = [];
  const guardado = { arr: [] };
  // Cada fila del formulario, con los tres inputs y el <span> del subtotal.
  const rows = filas.map((f) => {
    const campos = {
      '.oc-item': { value: f.item || '' },
      '.oc-cant': { value: f.cantidad == null ? '' : String(f.cantidad) },
      '.oc-precio': { value: f.precio == null ? '' : String(f.precio) },
      '.oc-sub': { textContent: '' },
    };
    return { querySelector: (sel) => campos[sel] || null };
  });
  const simples = {
    ocProveedor: { value: 'Filamentos Chile SpA' },
    ocId: { value: '' },
    ocFecha: { value: '2026-08-10' },
    ocNotas: { value: '' },
    ocNeto: { textContent: '' }, ocIva: { textContent: '' }, ocTotal: { textContent: '' },
  };
  const ctx = {
    document: {
      getElementById: (id) => simples[id] || null,
      querySelectorAll: (sel) => (sel === '#ocRows .oc-row' ? rows : []),
    },
    toast: (m) => avisos.push(String(m)),
    formatCLP: (n) => '$' + Math.round(n || 0).toLocaleString('es-CL'),
    hoyCL: () => '2026-08-10',
    closeOCModal: () => {},
    renderOCList: () => {},
    generarOCPDF: () => {},
    _ocAll: () => guardado.arr,
    _ocSaveArr: (arr) => { guardado.arr = arr; },
    _ocNextNum: () => 'OC-2026-001',
  };
  const piezas = [bloque('function _ocRows('), bloque('function ocCalc('), bloque('function guardarOC(')].join('\n');
  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, `${piezas}\nreturn {guardarOC,ocCalc,_ocRows};`)(...nombres.map((n) => ctx[n]));
  return { api, avisos, guardado };
}

const sumaItems = (oc) => oc.items.reduce((s, i) => s + i.cantidad * i.precio, 0);

// ── El descuadre ────────────────────────────────────────────────────────

test('el total guardado cuadra con la suma de los ítems guardados', () => {
  // La fila fantasma: números sin nombre. Antes entraba al total pero no al detalle.
  const m = montar([
    { item: 'Filamento PLA', cantidad: 5, precio: 12000 },
    { item: '', cantidad: 3, precio: 8000 },
  ]);
  m.api.guardarOC(false);
  const oc = m.guardado.arr[0];
  assert.ok(oc, 'la OC se guardó');
  assert.equal(oc.items.length, 1, 'solo la línea con nombre');
  assert.equal(oc.neto, sumaItems(oc), 'el neto es exactamente la suma de las líneas del PDF');
  assert.equal(oc.neto, 60000, 'los $24.000 sin nombre no entran');
  assert.equal(oc.total, 60000 + Math.round(60000 * 0.19), 'y el total = neto + IVA de ese neto');
});

test('una fila con precio pero sin nombre se avisa, no se traga', () => {
  const m = montar([
    { item: 'Resina', cantidad: 2, precio: 20000 },
    { item: '', cantidad: 1, precio: 5000 },
  ]);
  m.api.guardarOC(false);
  assert.match(m.avisos.join(' '), /sin nombre no se incluyeron/, 'debe avisar de la fila descartada');
});

test('sin fila fantasma, nada que avisar', () => {
  const m = montar([
    { item: 'Filamento', cantidad: 10, precio: 12000 },
    { item: 'Boquillas', cantidad: 4, precio: 3500 },
  ]);
  m.api.guardarOC(false);
  const oc = m.guardado.arr[0];
  assert.equal(oc.items.length, 2);
  assert.equal(oc.neto, 120000 + 14000);
  assert.equal(oc.neto, sumaItems(oc));
  assert.doesNotMatch(m.avisos.join(' '), /sin nombre/);
});

test('el IVA es el 19% del neto de las líneas, no de otra cosa', () => {
  const m = montar([{ item: 'Cable LED', cantidad: 7, precio: 4300 }]);
  m.api.guardarOC(false);
  const oc = m.guardado.arr[0];
  const iva = oc.total - oc.neto;
  assert.equal(iva, Math.round(oc.neto * 0.19));
  assert.equal(oc.neto, 30100);
});

test('sin ítems válidos no se guarda nada', () => {
  const m = montar([{ item: '', cantidad: 3, precio: 8000 }]);   // solo fantasma
  m.api.guardarOC(false);
  assert.equal(m.guardado.arr.length, 0, 'una OC sin líneas con nombre no debe existir');
  assert.match(m.avisos.join(' '), /al menos un ítem/);
});

test('una cantidad cero no cuenta como ítem', () => {
  const m = montar([
    { item: 'Filamento', cantidad: 0, precio: 12000 },   // nombre pero cantidad 0
    { item: 'Tornillos', cantidad: 100, precio: 50 },
  ]);
  m.api.guardarOC(false);
  const oc = m.guardado.arr[0];
  assert.equal(oc.items.length, 1, 'la de cantidad 0 no entra');
  assert.equal(oc.items[0].item, 'Tornillos');
  assert.equal(oc.neto, 5000);
});

// ── El código, para que no reaparezca ───────────────────────────────────

test('el total NO vuelve a salir de ocCalc en guardarOC', () => {
  const fn = bloque('function guardarOC(');
  assert.match(fn, /const neto=items\.reduce\(/, 'el neto se calcula desde los ítems guardados');
  assert.match(fn, /const total=neto\+Math\.round\(neto\*0\.19\)/);
  assert.doesNotMatch(fn, /const t=ocCalc\(\);/, 'ya no se toma el total del formulario completo');
  assert.doesNotMatch(fn, /neto:t\.neto,total:t\.total/, 'ni se guardan esos valores');
});

test('ocCalc (el que pinta el formulario en vivo) sigue igual', () => {
  // ocCalc muestra el total mientras se escribe; ahí sí conviene sumar todo lo
  // tecleado. El arreglo es que ESE número no es el que se guarda.
  const m = montar([
    { item: 'A', cantidad: 5, precio: 12000 },
    { item: '', cantidad: 3, precio: 8000 },
  ]);
  const t = m.api.ocCalc();
  assert.equal(t.neto, 84000, 'en vivo suma todo lo tecleado, incluida la fila a medio llenar');
  // Pero lo guardado descarta la fila sin nombre:
  m.api.guardarOC(false);
  assert.equal(m.guardado.arr[0].neto, 60000);
});
