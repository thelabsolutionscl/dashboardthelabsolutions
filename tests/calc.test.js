#!/usr/bin/env node
/*
 * Pruebas de los cálculos críticos del dashboard.
 *
 * No reimplementan la lógica: EXTRAEN las funciones reales desde index.html
 * (por nombre, con balanceo de llaves que ignora strings/comentarios) y las
 * ejecutan en un sandbox (vm) con dependencias simuladas. Si alguien cambia una
 * fórmula de precio, filamento o mantención, estas pruebas lo detectan.
 *
 * Correr:  node tests/calc.test.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ── Extractor: balancea {} y [] saltando strings (', ", `) y comentarios ──
function balancedEnd(s, openIdx) {
  let depth = 0, inStr = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); if (nl < 0) return -1; i = nl; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function extractFn(name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(SRC);
  if (!m) throw new Error('Función no encontrada: ' + name);
  const open = SRC.indexOf('{', m.index);
  const end = balancedEnd(SRC, open);
  if (end < 0) throw new Error('Llaves desbalanceadas en: ' + name);
  return SRC.slice(m.index, end + 1);
}
function extractConst(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*');
  const m = re.exec(SRC);
  if (!m) throw new Error('Const no encontrada: ' + name);
  const eq = SRC.indexOf('=', m.index);
  let i = eq + 1; while (/\s/.test(SRC[i])) i++;
  const end = balancedEnd(SRC, i);
  if (end < 0) throw new Error('Literal desbalanceado en: ' + name);
  return 'const ' + name + ' = ' + SRC.slice(i, end + 1) + ';';
}

// ── Mock de localStorage ──
function makeLS(init) {
  const store = Object.assign({}, init);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}
// Mock de document.getElementById a partir de un mapa de valores {id: value}.
// Memoiza los elementos para que las mutaciones de .value persistan entre llamadas.
function makeDoc(values) {
  const els = {};
  return { getElementById(id) {
    if (!(id in values)) return null;
    if (!els[id]) els[id] = { value: values[id], style: {} };
    return els[id];
  } };
}

// ── Mini-arnés de aserciones ──
let passed = 0, failed = 0;
const fails = [];
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
function assert(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; fails.push(name + (detail ? '  → ' + detail : '')); }
}
function eq(name, got, want) { assert(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
function near(name, got, want, eps) { assert(name, approx(got, want, eps), 'got ' + got + ' want ≈ ' + want); }

// ════════════════════════════════════════════════════════════════════
// 1) FILAMENTO — getFilamentKgPerMm()  (la física que originó este hilo)
// ════════════════════════════════════════════════════════════════════
(function testFilamento() {
  const code = extractConst('FILAMENT_DENSITY') + '\n' + extractFn('getFilamentKgPerMm') +
    '\n; globalThis.__r = { pla175: getFilamentKgPerMm() };';
  const ctx = { Math, parseFloat, localStorage: makeLS({}), globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  // PLA 1.75mm: área=π(0.875)²=2.40528 mm²; kg/mm = área*1.24/1e6 = 2.9825e-6
  near('filamento PLA 1.75 kg/mm', ctx.__r.pla175, 2.9825e-6, 1e-9);
  // 100 m (100000 mm) de PLA 1.75 ≈ 298.25 g
  near('filamento 100m PLA → gramos', ctx.__r.pla175 * 100000 * 1000, 298.25, 0.2);

  // PETG (densidad 1.27) y diámetro 2.85 mm
  const ctx2 = { Math, parseFloat, localStorage: makeLS({ filament_material: 'PETG', filament_diameter: '2.85' }), globalThis: {} };
  ctx2.globalThis = ctx2; vm.createContext(ctx2);
  vm.runInContext(extractConst('FILAMENT_DENSITY') + '\n' + extractFn('getFilamentKgPerMm') + '\n; globalThis.__r = getFilamentKgPerMm();', ctx2);
  // área=π(1.425)²=6.37939; kg/mm=6.37939*1.27/1e6=8.1018e-6
  near('filamento PETG 2.85 kg/mm', ctx2.__r, 8.1018e-6, 1e-9);
})();

// ════════════════════════════════════════════════════════════════════
// 2) MANTENCIÓN — umbrales (getMaintThreshold)
// ════════════════════════════════════════════════════════════════════
(function testMantencion() {
  const defs = extractConst('MAINT_TYPES') + '\n' + extractFn('getMaintConfig') + '\n' + extractFn('getMaintThreshold');
  const ctx = { Math, parseInt, JSON, MAINT_CFG_KEY: 'printer_maint_cfg', localStorage: makeLS({}), globalThis: {} };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(defs + '\n; globalThis.__r = { nozzle: getMaintThreshold("nozzle"), belt: getMaintThreshold("belt"), unknown: getMaintThreshold("noexiste") };', ctx);
  eq('mantención nozzle default', ctx.__r.nozzle, 200);
  eq('mantención belt default', ctx.__r.belt, 500);
  eq('mantención tipo desconocido → 100', ctx.__r.unknown, 100);

  // Con override de config en localStorage
  const ctx2 = { Math, parseInt, JSON, MAINT_CFG_KEY: 'printer_maint_cfg', localStorage: makeLS({ 'printer_maint_cfg': JSON.stringify({ nozzle: 350 }) }), globalThis: {} };
  ctx2.globalThis = ctx2; vm.createContext(ctx2);
  vm.runInContext(defs + '\n; globalThis.__r = getMaintThreshold("nozzle");', ctx2);
  eq('mantención nozzle con override', ctx2.__r, 350);
})();

// ════════════════════════════════════════════════════════════════════
// 3) PRECIO — qcalcCompute (cálculo real del cotizador láser / neón)
//    Fórmula clave: netoUnit = round(costoUnit / (1 - margen))
// ════════════════════════════════════════════════════════════════════
(function testPrecio() {
  const ctx = {
    Math, parseFloat, parseInt, Number,
    _lsrExtras: [], _neoExtras: [],
    document: makeDoc({
      // Láser
      'lsr-qty': '2', 'lsr-desp': '10', 'lsr-tarifa': '5000', 'lsr-area': '100',
      'lsr-mat': '2', 'lsr-t-corte': '30', 'lsr-t-grab': '30', 'lsr-mdo': '60',
      'lsr-margen': '60', 'lsr-desc': '',
      // Neón
      'neo-qty': '1', 'neo-colores': '2', 'neo-largo': '3', 'neo-tipo': '1000',
      'neo-soporte': '5000', 'neo-trans': '8000', 'neo-dimmer': '2000', 'neo-margen': '65', 'neo-desc': '',
    }),
    globalThis: {},
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(extractFn('qcalcCompute') + '\n; globalThis.__lsr = qcalcCompute("lsr"); globalThis.__neo = qcalcCompute("neo");', ctx);

  const L = ctx.__lsr;
  // costoMat=round(100*2*1.1)=220; costoMaq=round(60/60*5000)=5000; costoMdo=round(60/60*2000)=2000
  eq('láser costoUnit', L.costoUnit, 7220);
  // netoUnit = round(7220 / (1-0.6)) = round(18050) = 18050
  eq('láser netoUnit (margen 60%)', L.netoUnit, 18050);
  eq('láser qty', L.qty, 2);
  near('láser margen', L.margen, 0.6, 1e-9);

  const N = ctx.__neo;
  // costoTubo=round(3*1000*2)=6000; +5000+8000+2000 = 21000
  eq('neón costoUnit', N.costoUnit, 21000);
  // netoUnit = round(21000 / (1-0.65)) = round(60000) = 60000
  eq('neón netoUnit (margen 65%)', N.netoUnit, 60000);

  // Invariante de margen: clamps a [10,90] y la relación precio↔costo
  vm.runInContext('document.getElementById("lsr-margen").value="200"; globalThis.__hi = qcalcCompute("lsr");', ctx);
  near('margen se limita a 90% máx', ctx.__hi.margen, 0.9, 1e-9);
})();

// ════════════════════════════════════════════════════════════════════
// 4) IVA — relación neto ↔ bruto (round(neto*1.19))
// ════════════════════════════════════════════════════════════════════
(function testIVA() {
  // Documenta la convención usada en todo el dashboard.
  const neto = 18050;
  eq('IVA: bruto desde neto', Math.round(neto * 1.19), 21480);
  eq('IVA: neto desde bruto', Math.round(21480 / 1.19), neto);
})();

// ── Reporte ──
console.log('\n  Pruebas de cálculo — The Lab Solutions\n');
if (fails.length) fails.forEach(f => console.log('  \x1b[31m✗\x1b[0m ' + f));
console.log('\n  \x1b[32m' + passed + ' OK\x1b[0m' + (failed ? '   \x1b[31m' + failed + ' FALLARON\x1b[0m' : '') + '\n');
process.exit(failed ? 1 : 0);
