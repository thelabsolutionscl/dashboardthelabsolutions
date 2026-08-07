#!/usr/bin/env node
/*
 * Numeración de pedidos con dos personas trabajando a la vez.
 *
 * El correlativo se calculaba sobre state.pedidos, la copia local. Una pestaña
 * abierta desde la mañana no sabe que el otro computador ya creó el
 * PED-2026-025, así que asigna ese mismo número — y Airtable no impide
 * repetirlo, con lo que quedan dos pedidos distintos con el mismo N°.
 *
 * Aparte, tras crear un pedido se releía la tabla con tope 50 y se REEMPLAZABA
 * la lista local: pasados los 50 pedidos eso borraba el resto de la pantalla y
 * dejaba ciego al correlativo siguiente.
 *
 * Correr:  node --test tests/correlativo-pedidos.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const cab = new RegExp(`(?:async\\s+)?function\\s+${nombre}\\s*\\([^)]*\\)\\s*\\{`).exec(HTML);
  assert.ok(cab, `debe existir ${nombre}`);
  const abre = HTML.indexOf('{', cab.index);
  let d = 0, q = '', esc = false, lc = false, bc = false;
  for (let i = abre; i < HTML.length; i++) {
    const c = HTML[i], n = HTML[i + 1];
    if (lc) { if (c === '\n') lc = false; continue; }
    if (bc) { if (c === '*' && n === '/') { bc = false; i++; } continue; }
    if (q) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = ''; continue; }
    if (c === '/' && n === '/') { lc = true; i++; continue; }
    if (c === '/' && n === '*') { bc = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}') { d--; if (d === 0) return HTML.slice(cab.index, i + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

const ped = (n) => ({ id: 'rec' + n, fields: { 'N° Pedido': n } });
const anio = new Date().getFullYear();

// Monta _nextNumPedido con un state y un Airtable de mentira.
function montar({ local, remoto, falla }) {
  const llamadas = [];
  const airtableFetch = async (tabla, max) => {
    llamadas.push({ tabla, max });
    if (falla) throw new Error('Airtable 503');
    return { records: remoto };
  };
  const fn = new Function('state', 'airtableFetch', 'console',
    extraer('_nextNumPedido') + '\nreturn _nextNumPedido;')({ pedidos: local }, airtableFetch, { warn() {} });
  return { fn, llamadas };
}

test('el número sale de Airtable, no de la copia local envejecida', async () => {
  // La pestaña cree que va en el 024; el otro computador ya creó hasta el 026.
  const { fn, llamadas } = montar({
    local: [ped(`PED-${anio}-023`), ped(`PED-${anio}-024`)],
    remoto: [ped(`PED-${anio}-024`), ped(`PED-${anio}-025`), ped(`PED-${anio}-026`)],
  });
  assert.equal(await fn(), `PED-${anio}-027`);
  assert.equal(llamadas.length, 1, 'debe releerse Airtable antes de asignar');
  assert.ok(llamadas[0].max >= 1000, `el tope no puede recortar la tabla (fue ${llamadas[0].max})`);
});

test('nunca retrocede: si lo local va más adelante, manda lo local', async () => {
  // Puede pasar con la vista de Airtable recortada o un pedido recién creado
  // que aún no aparece en la lectura.
  const { fn } = montar({
    local: [ped(`PED-${anio}-030`)],
    remoto: [ped(`PED-${anio}-025`)],
  });
  assert.equal(await fn(), `PED-${anio}-031`);
});

test('si Airtable no responde, se sigue con lo local en vez de no crear el pedido', async () => {
  const { fn } = montar({ local: [ped(`PED-${anio}-024`)], remoto: [], falla: true });
  assert.equal(await fn(), `PED-${anio}-025`);
});

test('sin pedidos previos empieza en 001', async () => {
  const { fn } = montar({ local: [], remoto: [] });
  assert.equal(await fn(), `PED-${anio}-001`);
});

test('ignora números de otros años y basura', async () => {
  const { fn } = montar({
    local: [ped('PED-2019-099'), ped(''), ped('sin formato'), { id: 'x' }],
    remoto: [ped(`PED-${anio}-002`)],
  });
  assert.equal(await fn(), `PED-${anio}-003`);
});

test('ningún sitio vuelve a calcular el correlativo por su cuenta', () => {
  const sueltos = (HTML.match(/maxNum\s*=\s*Math\.max\(maxNum/g) || []).length;
  assert.equal(sueltos, 0, 'el cálculo debe estar solo en _nextNumPedido');
  assert.equal((HTML.match(/await\s+_nextNumPedido\s*\(\)/g) || []).length, 2,
    'los dos sitios que crean pedidos deben usar el helper (y esperarlo)');
});

test('recargar la lista de pedidos no la recorta', () => {
  // state.pedidos se REEMPLAZA con lo que devuelva esta lectura: un tope bajo
  // hace desaparecer pedidos de la pantalla hasta recargar la página.
  const recortes = [...HTML.matchAll(/state\.pedidos\s*=\s*pRes\.records/g)].map((m) => {
    const ctx = HTML.slice(Math.max(0, m.index - 200), m.index);
    const t = /airtableFetch\(\s*['"]Pedidos['"]\s*,\s*(\d+)\s*\)/g;
    let ult = null, x;
    while ((x = t.exec(ctx))) ult = parseInt(x[1], 10);
    return ult;
  });
  assert.ok(recortes.length >= 2, 'deben seguir existiendo las recargas tras crear un pedido');
  for (const tope of recortes) {
    assert.ok(tope !== null && tope >= 1000, `la recarga usa tope ${tope}: recorta la lista`);
  }
});
