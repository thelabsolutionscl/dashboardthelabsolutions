#!/usr/bin/env node
/*
 * Correlativo de COTIZACIÓN: no se duplica ni se salta.
 *
 * generarNumeroCotizacion solo miraba state.cotizaciones (copia local que puede
 * estar vieja) y Airtable no impone unicidad, así que dos cotizaciones —de dos
 * pestañas/equipos, o del flujo guiado + el manual— salían con el MISMO N°. Ahora
 * _nextNumCotizacion RELEE Airtable y toma el máximo entre local y remoto antes de
 * asignar, igual que _nextNumPedido. Además, _maxSeqCot ya no filtra por
 * num.length===6, así que a partir de la cotización 100 del mes no se regenera el
 * mismo número.
 *
 * Se montan los _prefijoMesCot + _maxSeqCot + _nextNumCotizacion REALES. El prefijo
 * del mes se toma del reloj real, así que el test arma sus datos con ese mismo
 * prefijo (independiente de la fecha).
 *
 * Correr:  node --test tests/correlativo-cotizacion.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(nombre) {
  let i = HTML.indexOf('async function ' + nombre + '(');
  if (i < 0) i = HTML.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = HTML.indexOf('{', HTML.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < HTML.length; x++) {
    if (HTML[x] === '{') d++;
    if (HTML[x] === '}') { d--; if (!d) return HTML.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const BODY = extract('_prefijoMesCot') + '\n' + extract('_maxSeqCot') + '\n' + extract('_nextNumCotizacion');

// Prefijo del mes actual, calculado igual que el código (para datos deterministas).
const now = new Date();
const PREF = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
const cot = (n) => ({ fields: { 'N° Cotización': n } });

function montar({ locales = [], remotos = null } = {}) {
  const state = { cotizaciones: locales };
  const airtableFetch = async () => { if (remotos === 'ERR') throw new Error('red'); return { records: remotos || [] }; };
  return new Function('state', 'airtableFetch', 'console', BODY + '\nreturn {_maxSeqCot,_nextNumCotizacion};')(state, airtableFetch, { warn() {} });
}

// ── El corazón del arreglo: releer antes de asignar ──────────────────────

test('toma el máximo entre local y remoto (evita el duplicado por copia vieja)', async () => {
  // Local cree que el máximo del mes es 05, pero Airtable ya tiene 08 (otro equipo).
  const { _nextNumCotizacion } = montar({ locales: [cot(PREF + '05')], remotos: [cot(PREF + '08')] });
  assert.equal(await _nextNumCotizacion(), PREF + '09', 'sigue del 08 remoto, no del 05 local');
});

test('sin nada remoto nuevo, sigue del máximo local', async () => {
  const { _nextNumCotizacion } = montar({ locales: [cot(PREF + '05'), cot(PREF + '06')], remotos: [] });
  assert.equal(await _nextNumCotizacion(), PREF + '07');
});

test('si Airtable falla al releer, cae al local (best-effort, no rompe)', async () => {
  const { _nextNumCotizacion } = montar({ locales: [cot(PREF + '11')], remotos: 'ERR' });
  assert.equal(await _nextNumCotizacion(), PREF + '12');
});

test('mes vacío arranca en 01', async () => {
  const { _nextNumCotizacion } = montar({ locales: [], remotos: [] });
  assert.equal(await _nextNumCotizacion(), PREF + '01');
});

// ── Rollover >99/mes (ya no se regenera el mismo número) ─────────────────

test('la cotización 100 del mes SÍ cuenta para el máximo (no se filtra por largo)', () => {
  const { _maxSeqCot } = montar({});
  assert.equal(_maxSeqCot([cot(PREF + '99'), cot(PREF + '100')]), 100, 'el de 3 dígitos no se excluye');
});

test('tras la 99, el siguiente es 100 (no otra vez 100 en bucle)', async () => {
  const { _nextNumCotizacion } = montar({ locales: [cot(PREF + '99')], remotos: [] });
  assert.equal(await _nextNumCotizacion(), PREF + '100');
});

// ── Números de otros meses no contaminan ─────────────────────────────────

test('un número de otro mes no afecta el máximo', () => {
  const { _maxSeqCot } = montar({});
  const otroMes = (PREF === '2601' ? '2512' : '2601'); // prefijo distinto al actual
  assert.equal(_maxSeqCot([cot(otroMes + '77'), cot(PREF + '03')]), 3);
});

// ── Los dos flujos de creación releen ────────────────────────────────────

test('el flujo guiado y el manual aseguran el correlativo contra Airtable', () => {
  assert.match(extract('crearCotizacionGuiada'), /const num=await _nextNumCotizacion\(\)/, 'el guiado usa el async');
  assert.match(extract('createCotizacion'), /_todos\.some\(c=>String\(\(c\.fields\|\|\{\}\)\['N° Cotización'\]\|\|''\)===num\)/, 'el manual re-chequea colisión contra Airtable');
});
