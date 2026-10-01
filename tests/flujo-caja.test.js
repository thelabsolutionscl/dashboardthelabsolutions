#!/usr/bin/env node
/*
 * Flujo de caja: la expansión de un pago recurrente mes a mes.
 *
 * El flujo de caja proyecta 8 semanas: ingresos = facturas por cobrar, egresos =
 * pagos programados. Un pago marcado "mensual recurrente" (arriendo, sueldos) se
 * expande con _pagoOcurrencias.
 *
 * Esa expansión avanzaba el mes con setMonth() sobre una fecha que ya tenía el
 * día del pago. Cuando el pago es "el 31" y el mes siguiente no tiene 31 días,
 * JS desborda al mes que sigue (feb 31 → mar 3) y SE SALTA ese mes. Medido para
 * un pago el día 31 en un horizonte de 6 meses: daba 4 ocurrencias en vez de 6,
 * y una en el día equivocado (1 de mayo). Egresos subestimados → la caja
 * proyectada se ve más sana de lo que es, justo el número que se mira para no
 * quedar en rojo.
 *
 * Correr:  node --test tests/flujo-caja.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FIN = fs.readFileSync(path.join(__dirname, '..', 'js', 'finanzas.js'), 'utf8');

function bloque(marca) {
  const i = FIN.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = FIN.indexOf('{', i); x < FIN.length; x++) {
    if (FIN[x] === '{') d++;
    if (FIN[x] === '}') { d--; if (!d) return FIN.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// La función real del módulo (es pura: solo Date).
const _pagoOcurrencias = new Function(`${bloque('function _pagoOcurrencias(')}\nreturn _pagoOcurrencias;`)();

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const H = (desde, hasta) => [new Date(desde + 'T00:00:00').getTime(), new Date(hasta + 'T00:00:00').getTime()];

// ── Recurrentes: una por mes, sin saltos ────────────────────────────────

test('un pago el día 31 cae cada mes, no se salta los meses cortos', () => {
  const [ini, fin] = H('2026-01-01', '2026-07-01');   // ene..jun
  const occ = _pagoOcurrencias({ fecha: '2026-01-31', recurrente: true }, ini, fin).map(iso);
  assert.equal(occ.length, 6, 'seis meses, seis pagos');
  // En los meses cortos cae el último día (arriendo/sueldos: se paga igual).
  assert.deepEqual(occ, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
});

test('el día 30 tampoco desaparece en febrero', () => {
  const [ini, fin] = H('2026-01-01', '2026-04-01');
  const occ = _pagoOcurrencias({ fecha: '2026-01-30', recurrente: true }, ini, fin).map(iso);
  assert.deepEqual(occ, ['2026-01-30', '2026-02-28', '2026-03-30']);
});

test('un día normal se repite intacto (control)', () => {
  const [ini, fin] = H('2026-01-01', '2026-07-01');
  const occ = _pagoOcurrencias({ fecha: '2026-01-15', recurrente: true }, ini, fin).map(iso);
  assert.equal(occ.length, 6);
  assert.ok(occ.every((d) => d.endsWith('-15')), 'todas caen el 15');
});

test('no aparecen fechas fantasma fuera de patrón', () => {
  // El bug producía un "2026-05-01" que no correspondía a ningún día-de-pago.
  const [ini, fin] = H('2026-01-01', '2026-07-01');
  const occ = _pagoOcurrencias({ fecha: '2026-01-31', recurrente: true }, ini, fin).map(iso);
  assert.ok(!occ.includes('2026-05-01'), 'nada de días arrastrados por el desborde');
  // Cada ocurrencia es día 31 o el último día de su mes.
  for (const d of occ) {
    const [y, m] = d.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    const dd = Number(d.slice(8));
    assert.ok(dd === 31 || dd === ultimo, `${d} no es 31 ni fin de mes`);
  }
});

// ── Bordes del horizonte ────────────────────────────────────────────────

test('solo devuelve ocurrencias dentro de [ini, fin)', () => {
  const [ini, fin] = H('2026-03-01', '2026-05-01');   // mar y abr
  const occ = _pagoOcurrencias({ fecha: '2026-01-10', recurrente: true }, ini, fin).map(iso);
  assert.deepEqual(occ, ['2026-03-10', '2026-04-10'], 'ene y feb quedan antes; may queda fuera');
});

test('el fin del horizonte es exclusivo', () => {
  const [ini, fin] = H('2026-03-01', '2026-05-01');
  const occ = _pagoOcurrencias({ fecha: '2026-05-01', recurrente: true }, ini, fin).map(iso);
  assert.ok(!occ.includes('2026-05-01'), 'justo en el borde superior no entra');
});

// ── No recurrentes ──────────────────────────────────────────────────────

test('un pago único aparece solo si cae dentro del horizonte', () => {
  const [ini, fin] = H('2026-01-01', '2026-03-01');
  assert.deepEqual(_pagoOcurrencias({ fecha: '2026-02-10', recurrente: false }, ini, fin).map(iso), ['2026-02-10']);
  assert.deepEqual(_pagoOcurrencias({ fecha: '2026-09-10', recurrente: false }, ini, fin), [], 'fuera del horizonte, nada');
});

test('una fecha inválida no rompe la proyección', () => {
  const [ini, fin] = H('2026-01-01', '2026-07-01');
  assert.deepEqual(_pagoOcurrencias({ fecha: 'no-es-fecha', recurrente: true }, ini, fin), []);
});

// ── El código no vuelve al setMonth que arrastra ────────────────────────

test('la expansión ya no avanza el mes sobre una fecha con día 31', () => {
  const fn = bloque('function _pagoOcurrencias(');
  assert.doesNotMatch(fn, /d\.setMonth\(d\.getMonth\(\)\+1\)/, 'ese avance era el que desbordaba');
  assert.doesNotMatch(fn, /d\.setMonth\(d\.getMonth\(\)-1\)/);
  assert.match(fn, /new Date\(y,m\+1,0\)\.getDate\(\)/, 'debe calcular el último día del mes');
  assert.match(fn, /Math\.min\(dia,ultimo\)/, 'y acotar el día del pago a ese último');
});

test('el horizonte del flujo es de 8 semanas y arranca el lunes', () => {
  // Contexto: _pagoOcurrencias alimenta finRenderFlujoCaja.
  const flujo = bloque('function finRenderFlujoCaja(');
  assert.match(flujo, /const SEMANAS=8;/);
  assert.match(flujo, /_pagoOcurrencias\(p,horizIni,horizFin\)/, 'usa la expansión corregida');
  const semana = bloque('function _semanaInicio(');
  assert.match(semana, /\(d\.getDay\(\)\+6\)%7/, 'la semana empieza el lunes');
});
