#!/usr/bin/env node
/*
 * Finanzas · finVenc ancla el vencimiento a medianoche LOCAL, no UTC.
 *
 * finVenc parseaba `${year}-${mes}-01` (y r.venc) con new Date('YYYY-MM-DD'), que
 * por spec es UTC. En Chile (UTC-4/-3) esa medianoche UTC cae ~20:00 del día
 * ANTERIOR, así que floor((Date.now()-venc)/86400000) contaba un día de mora de
 * más durante la tarde/noche: aging inflado (facturas saltando de bucket),
 * cobranza semi-automática gatillada un día antes (WhatsApp "lleva 3 días
 * vencida" cuando lleva 2) y CSV descuadrado. Ahora se ancla con 'T00:00:00'.
 *
 * La parte de comportamiento es sensible a la zona horaria: para exponer el bug
 * hay que correr en una zona con offset (p.ej. America/Santiago). Se compara
 * contra la medianoche LOCAL construida con el constructor numérico de Date
 * (siempre local), que bajo el arreglo coincide en CUALQUIER zona.
 *
 * Correr:  TZ=America/Santiago node --test tests/finanzas-vencimiento-local.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'finanzas.js'), 'utf8');
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
// finVenc usa finPlazoDefault(); lo inyectamos en 30.
const finVenc = new Function('finPlazoDefault', extract('finVenc') + '\nreturn finVenc;')(() => 30);

// ── Comportamiento: el vencimiento es medianoche LOCAL ────────────────────

test('mes+plazo por defecto: vence a medianoche LOCAL del día correcto', () => {
  // agosto + 30 días = 31-ago. Sin DST en agosto en ninguna zona común.
  const v = finVenc({ year: 2026, mes: '08' });
  const esperado = new Date(2026, 7, 31, 0, 0, 0, 0); // constructor numérico = local
  assert.equal(v.getTime(), esperado.getTime(), 'medianoche local de 31-ago');
  assert.equal(v.getFullYear(), 2026);
  assert.equal(v.getMonth(), 7);
  assert.equal(v.getDate(), 31);
});

test('plazo propio del registro se respeta (medianoche local)', () => {
  const v = finVenc({ year: 2026, mes: '08', plazoDias: 15 });
  assert.equal(v.getTime(), new Date(2026, 7, 16, 0, 0, 0, 0).getTime());
});

test('fecha de vencimiento explícita: medianoche local, no UTC', () => {
  const v = finVenc({ venc: '2026-08-15' });
  assert.equal(v.getDate(), 15, 'no se corre al 14 por el parseo UTC');
  assert.equal(v.getTime(), new Date(2026, 7, 15, 0, 0, 0, 0).getTime());
});

test('vencimiento explícito con hora (ISO) se recorta a la fecha local', () => {
  const v = finVenc({ venc: '2026-08-15T23:30:00.000Z' });
  assert.equal(v.getDate(), 15);
  assert.equal(v.getTime(), new Date(2026, 7, 15, 0, 0, 0, 0).getTime());
});

test('la mora del propio día de vencimiento es 0 a cualquier hora simulada', () => {
  // Con venc en medianoche local, a las 21:00 del mismo día la mora es 0.
  const venc = finVenc({ venc: '2026-08-31' }).getTime();
  const hoy21 = new Date(2026, 7, 31, 21, 0, 0, 0).getTime(); // 21:00 local del día de venc
  assert.equal(Math.max(0, Math.floor((hoy21 - venc) / 86400000)), 0, 'aún no hay mora');
});

// ── El código lo dice (independiente de la zona horaria) ─────────────────

test('finVenc ancla ambas ramas a hora local con T00:00:00', () => {
  const f = extract('finVenc');
  assert.match(f, /`\$\{r\.year\}-\$\{r\.mes\}-01T00:00:00`/, 'base a medianoche local');
  assert.match(f, /new Date\(String\(r\.venc\)\.slice\(0,10\)\+'T00:00:00'\)/, 'venc explícito a medianoche local');
  assert.doesNotMatch(f, /new Date\(`\$\{r\.year\}-\$\{r\.mes\}-01`\)/, 'ya no parsea la base como UTC');
});
