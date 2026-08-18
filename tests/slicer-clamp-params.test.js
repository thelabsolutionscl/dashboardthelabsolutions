#!/usr/bin/env node
/*
 * Slicer · clampParams: no descartar parámetros válidos ni dejar escapar el tope.
 *
 * Dos defectos en el acotado de parámetros de laminación:
 *  1) El modo de costura 'aleatorio' —que la UI ofrece, el prompt pide y
 *     _seamStart implementa— NO estaba en el whitelist de clampParams, así que se
 *     coaccionaba en silencio a 'cercano' (cicatriz vertical en cilindros).
 *  2) `cl` devolvía el DEFAULT sin acotar cuando el valor venía no-finito (IA
 *     omite/malforma el campo). El default de velocidad (60) superaba el tope del
 *     material (TPU 35 mm/s) → riesgo de patinado/atasco en flexibles.
 *
 * Se monta el clampParams REAL con el DOM/SPECS/MATS simulados.
 *
 * Correr:  node --test tests/slicer-clamp-params.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'slicer3d.js'), 'utf8');
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

// DOM/tablas simuladas. Material por defecto TPU (tope 35 mm/s).
function montar(material = 'TPU', nozzle = 0.4) {
  const vals = { slNozzle: String(nozzle), slPrinter: 'K1', slMaterial: material };
  const el = (id) => ({ value: vals[id] });
  const SPECS = { K1: { vmax: 500, y: 300 } };
  const MATS = {
    PLA: { noz: 210, bed: 60, fan: 100, dens: 1.24 },
    TPU: { noz: 225, bed: 50, fan: 60, dens: 1.21, vcap: 35 },
    PVA: { noz: 200, bed: 60, fan: 100, dens: 1.23, vcap: 25 },
  };
  return new Function('el', 'SPECS', 'MATS', extract('clampParams') + '\nreturn clampParams;')(el, SPECS, MATS);
}

// ── Defecto 1: 'aleatorio' sobrevive el acotado ──────────────────────────

test("seamMode 'aleatorio' ya NO se descarta", () => {
  assert.equal(montar()({ seamMode: 'aleatorio' }).seamMode, 'aleatorio');
});

test('los otros modos de costura siguen válidos', () => {
  const cp = montar();
  ['cercano', 'alineado', 'agudo'].forEach((m) => assert.equal(cp({ seamMode: m }).seamMode, m));
});

test('un modo de costura inválido sí cae a cercano', () => {
  assert.equal(montar()({ seamMode: 'basura' }).seamMode, 'cercano');
  assert.equal(montar()({}).seamMode, 'cercano');
});

// ── Defecto 2: el default no escapa el tope del material ──────────────────

test('sin speed, el default (60) se acota al tope del TPU (35)', () => {
  assert.equal(montar('TPU')({}).speed, 35, 'no imprime flexible a 60 mm/s');
});

test('sin firstLayerSpeed, el default (30) se acota al tope del PVA (25)', () => {
  assert.equal(montar('PVA')({}).firstLayerSpeed, 25);
});

test('con un material sin tope propio, el default de velocidad se respeta', () => {
  // PLA sin vcap → vmax=spec.vmax(500) → default 60 cabe.
  assert.equal(montar('PLA')({}).speed, 60);
});

// ── El acotado normal sigue intacto ──────────────────────────────────────

test('un speed válido dentro del tope pasa sin cambios', () => {
  assert.equal(montar('TPU')({ speed: 20 }).speed, 20);
});

test('un speed por encima del tope se recorta al tope', () => {
  assert.equal(montar('TPU')({ speed: 120 }).speed, 35);
});

test('las temperaturas se mantienen acotadas (defensa intacta)', () => {
  const p = montar('TPU')({ nozzleTemp: 999, bedTemp: 999 });
  assert.equal(p.nozzleTemp, 300);
  assert.equal(p.bedTemp, 110);
});

// ── El código lo dice ────────────────────────────────────────────────────

test('el whitelist de seamMode incluye aleatorio y cl acota el default', () => {
  assert.match(SRC, /seamMode:\['cercano','alineado','agudo','aleatorio'\]\.includes/);
  assert.match(SRC, /return Math\.min\(b,Math\.max\(a,isFinite\(v\)\?v:d\)\);/);
});
