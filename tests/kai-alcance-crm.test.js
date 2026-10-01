#!/usr/bin/env node
/*
 * KAI · alcance por rol en consultar_crm: el comercial no recibe cifras de
 * secciones que no tiene (Finanzas, Proveedores, Inventario).
 *
 * El handler acota `s` (pedidos/cotizaciones/clientes) por vendedor y en
 * `resumen` OCULTA a propósito el total por cobrar de la empresa. Pero cinco
 * consultas leían helpers globales (empresa completa) saltándose ese
 * acotamiento: por_cobrar, finanzas_mes, top_clientes (Finanzas), proveedor
 * (Proveedores) e inventario_bajo (Inventario). El comercial (RBAC sin esas
 * secciones) las obtenía por el chat. Ahora se niegan explícitamente.
 *
 * Se monta el _kaiConsultaVedada REAL (puro) de js/kai.js.
 *
 * Correr:  node --test tests/kai-alcance-crm.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'kai.js'), 'utf8');
function extract(nombre) {
  const i = SRC.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = SRC.indexOf('{', SRC.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < SRC.length; x++) {
    if (SRC[x] === '{') d++;
    if (SRC[x] === '}') { d--; if (!d) return SRC.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const vedada = new Function(extract('_kaiConsultaVedada') + '\nreturn _kaiConsultaVedada;')();

// ── El comercial NO recibe datos de secciones ajenas ─────────────────────

test('por_cobrar / finanzas_mes / top_clientes → vedadas para el comercial (Finanzas)', () => {
  assert.equal(vedada('por_cobrar', true), 'Finanzas');
  assert.equal(vedada('finanzas_mes', true), 'Finanzas');
  assert.equal(vedada('top_clientes', true), 'Finanzas');
});

test('proveedor → vedada (Proveedores) e inventario_bajo → vedada (Inventario)', () => {
  assert.equal(vedada('proveedor', true), 'Proveedores');
  assert.equal(vedada('inventario_bajo', true), 'Inventario');
});

// ── Lo que el comercial SÍ puede consultar (sus propios datos) ───────────

test('las consultas de su propio alcance NO se vedan al comercial', () => {
  ['cliente', 'pedidos_atrasados', 'cotizaciones_pendientes', 'resumen'].forEach((c) => {
    assert.equal(vedada(c, true), '', c + ' debe estar permitida');
  });
});

// ── Un socio (no vendedor) ve todo ───────────────────────────────────────

test('para un rol NO comercial nada se veda', () => {
  ['por_cobrar', 'finanzas_mes', 'top_clientes', 'proveedor', 'inventario_bajo', 'cliente', 'resumen']
    .forEach((c) => assert.equal(vedada(c, false), '', c + ' no se veda a un socio'));
});

// ── Robustez ─────────────────────────────────────────────────────────────

test('una consulta desconocida no se veda (no rompe) ', () => {
  assert.equal(vedada('cualquier_cosa', true), '');
});

// ── El handler aplica la guarda y corta antes de calcular ────────────────

test('_kaiConsultarCRM corta con la sección vedada antes de tocar los datos', () => {
  const h = extract('_kaiConsultarCRM');
  assert.match(h, /const _vedada=_kaiConsultaVedada\(consulta,_av\)/, 'usa el helper');
  assert.match(h, /if\(_vedada\) return 'Esa información pertenece a '\+_vedada/, 'niega la consulta vedada');
  // La guarda va ANTES de las ramas de consulta (después del chequeo de carga).
  const gPos = h.indexOf('_kaiConsultaVedada(consulta,_av)');
  const primeraRama = h.indexOf("if(consulta==='");
  assert.ok(gPos > 0 && gPos < primeraRama, 'la guarda precede a las ramas de consulta');
});

// ── Las tres consultas financieras ya no leen los helpers globales sin guarda ──

test('las consultas financieras quedan detrás de la guarda de rol', () => {
  const h = extract('_kaiConsultarCRM');
  // Sigue existiendo el cálculo real (para los socios), pero la guarda lo antecede.
  assert.match(h, /_cobGrupos\(\)/, 'por_cobrar sigue calculándose para roles con acceso');
  assert.match(h, /_mesAgregado\(off\)/, 'finanzas_mes/top_clientes siguen para roles con acceso');
});
