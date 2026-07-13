#!/usr/bin/env node
/*
 * Pruebas del slicer 3D nativo (SL3D) y del estado de impresoras.
 *
 * No reimplementan la lógica: EXTRAEN las funciones reales desde index.html
 * (por nombre, balanceando llaves e ignorando strings/comentarios) y las
 * ejecutan en un sandbox (vm) con dependencias simuladas. Cubren la matemática
 * de laminado y las correcciones de la auditoría de la sección Máquinas:
 *   · estimate (tiempo/filamento, marca de agua de retracción, calibración)
 *   · clampParams (límites + piso de cama por material  → S6)
 *   · analyze (volumen/área + detección no-manifold     → S9)
 *   · fitsIn / _bedMarginXY (margen de adhesión          → S14)
 *   · parseOBJ / _repairMesh (validación de índices      → S15)
 *   · _deriveStatus (progreso display_status + runout    → Bug6 + runout)
 *   · _klipperDiagnosis (mapeo de causa/acción)
 *
 * Correr:  node tests/slicer.test.js
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
// Mock de document.getElementById a partir de {id: value}
function makeDoc(values) {
  const els = {};
  return { getElementById(id) {
    if (!(id in values)) return null;
    if (!els[id]) els[id] = { value: values[id], style: {} };
    return els[id];
  } };
}
// `el(id)` del slicer es getElementById; lo emulamos
function makeEl(values) { const d = makeDoc(values); return id => d.getElementById(id); }

function baseCtx(extra) {
  const ctx = Object.assign({
    Math, JSON, parseInt, parseFloat, Number, String, isFinite, isNaN,
    Float32Array, Uint8Array, console: { log() {}, warn() {} },
    globalThis: {},
  }, extra || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

// ── Mini-arnés de aserciones ──
let passed = 0, failed = 0;
const fails = [];
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
function assert(name, cond, detail) {
  if (cond) { passed++; } else { failed++; fails.push(name + (detail ? '  → ' + detail : '')); }
}
function eq(name, got, want) { assert(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
function near(name, got, want, eps) { assert(name, approx(got, want, eps), 'got ' + got + ' want ≈ ' + want); }
function truthy(name, v) { assert(name, !!v, 'got ' + JSON.stringify(v)); }
function falsy(name, v) { assert(name, !v, 'got ' + JSON.stringify(v)); }

// ════════════════════════════════════════════════════════════════════
// 1) _klipperDiagnosis — mapeo de causa/acción desde klMsg
// ════════════════════════════════════════════════════════════════════
(function testDiagnosis() {
  const ctx = baseCtx({});
  vm.runInContext(extractFn('_klipperDiagnosis') + '\n; globalThis.D = _klipperDiagnosis;', ctx);
  const D = ctx.D;
  truthy('diag: termistor', /termistor/i.test((D('Thermistor too hot, shutdown') || {}).causa || ''));
  truthy('diag: MCU', /mcu/i.test((D('Lost communication with MCU usb') || {}).causa || ''));
  truthy('diag: timer too close', /timer/i.test((D('Timer too close') || {}).causa || ''));
  truthy('diag: homing/probe', /sonda|endstop|homing/i.test((D('Probe failed, BLTouch error') || {}).causa || ''));
  eq('diag: vacío → null', D(''), null);
  eq('diag: irrelevante → null', D('todo en orden, imprimiendo'), null);
})();

// ════════════════════════════════════════════════════════════════════
// 2) clampParams — límites y piso de cama por material (S6)
// ════════════════════════════════════════════════════════════════════
(function testClampParams() {
  const defs = extractConst('SPECS') + '\n' + extractConst('MATS') + '\n' + extractFn('clampParams');
  function run(material, p) {
    const ctx = baseCtx({ el: makeEl({ slNozzle: '0.4', slPrinter: 'K1', slMaterial: material }), localStorage: makeLS({}) });
    vm.runInContext(defs + '\n; globalThis.R = clampParams(' + JSON.stringify(p) + ');', ctx);
    return ctx.R;
  }
  // Nozzle/cama clamps generales
  const a = run('PLA', { nozzleTemp: 999, bedTemp: 999, infillPct: 250, layerHeight: 5, seamMode: 'inexistente' });
  eq('clamp: nozzle máx 300', a.nozzleTemp, 300);
  eq('clamp: cama máx 110', a.bedTemp, 110);
  eq('clamp: relleno máx 100', a.infillPct, 100);
  eq('clamp: seamMode inválido → cercano', a.seamMode, 'cercano');
  const b = run('PLA', { nozzleTemp: 50 });
  eq('clamp: nozzle mín 170', b.nozzleTemp, 170);
  // S6: ABS (cama 100) NO puede quedar en 0 → piso = round(100*0.85)=85
  const abs = run('ABS', { bedTemp: 0 });
  eq('S6: ABS cama 0 → piso 85', abs.bedTemp, 85);
  // PLA (cama 60 < 90) sí puede ir a 0 (cama opcional)
  const pla = run('PLA', { bedTemp: 0 });
  eq('S6: PLA cama 0 permitido', pla.bedTemp, 0);
})();

// ════════════════════════════════════════════════════════════════════
// 3) fitsIn / _bedMarginXY — margen de adhesión (S14)
// ════════════════════════════════════════════════════════════════════
(function testFitsIn() {
  const defs = extractFn('_bedMarginXY') + '\n' + extractFn('fitsIn');
  function run(stats, params) {
    const ctx = baseCtx({ S: { stats, params } });
    vm.runInContext(defs + '\n; globalThis.fitsIn = fitsIn; globalThis.margin = _bedMarginXY();', ctx);
    return ctx;
  }
  const spec = { x: 220, y: 220, z: 250 };
  // Sin params: margen base 1 → cabe una pieza de 205mm (205 <= 218)
  let c = run({ dx: 205, dy: 205, dz: 200 }, null);
  near('S14: margen base sin params', c.margin, 1, 1e-9);
  truthy('S14: 205mm cabe sin adhesión', c.fitsIn(spec));
  // Con brim 20 líneas: margen 1 + 20*0.45 = 10 → 205 NO cabe (205 <= 200 falso)
  c = run({ dx: 205, dy: 205, dz: 200 }, { brim: 20, skirt: 0, skirtGap: 0, draftShield: false });
  near('S14: margen con brim 20', c.margin, 10, 1e-9);
  falsy('S14: 205mm NO cabe con brim 20', c.fitsIn(spec));
})();

// ════════════════════════════════════════════════════════════════════
// 4) estimate — tiempo/filamento, marca de agua y calibración
// ════════════════════════════════════════════════════════════════════
(function testEstimate() {
  const defs = extractConst('_ACCELS') + '\n' + extractFn('_moveTime') + '\n' + extractFn('estimate');
  const gcode = ['M82', 'G92 E0',
    'G1 X0 Y0 Z0.2 F3000',
    'G1 X10 Y0 E0.5 F1800',
    'G1 X10 Y10 E1.0 F1800'].join('\n');
  function run(ls) {
    const ctx = baseCtx({ localStorage: makeLS(ls || {}) });
    vm.runInContext(defs + '\n; globalThis.R = estimate(' + JSON.stringify(gcode) + ', {dens:1.24}, "K1");', ctx);
    return ctx.R;
  }
  const r = run();
  truthy('estimate: secs > 0', r.secs > 0);
  near('estimate: filamento (filM) = 1mm → 0.001', r.filM, 0.001, 1e-9);
  truthy('estimate: gramos plausibles', r.grams > 0 && r.grams < 0.01);
  // Calibración: sl_time_cal_K1 = 2 → el tiempo se duplica
  const r2 = run({ sl_time_cal_K1: '2' });
  near('estimate: calibración x2 duplica secs', r2.secs, r.secs * 2, 1e-6);
  // Marca de agua: una retracción (E baja) no reduce el filamento contado
  const gRetract = ['M82', 'G92 E0', 'G1 X0 Y0 E2 F1800', 'G1 X1 Y0 E1.5 F1800'].join('\n');
  const ctx = baseCtx({ localStorage: makeLS({}) });
  vm.runInContext(defs + '\n; globalThis.R = estimate(' + JSON.stringify(gRetract) + ', {dens:1.24}, "K1");', ctx);
  near('estimate: retracción no baja el filamento (watermark=2)', ctx.R.filM, 0.002, 1e-9);
})();

// ════════════════════════════════════════════════════════════════════
// 5) analyze — volumen/área de un cubo + detección no-manifold (S9)
// ════════════════════════════════════════════════════════════════════
(function testAnalyze() {
  // Cubo 10mm: 8 vértices, 12 triángulos (malla cerrada/manifold)
  const V = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const F = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  const cube = []; F.forEach(f => f.forEach(i => cube.push(V[i][0], V[i][1], V[i][2])));

  function run(arr) {
    const ctx = baseCtx({ S: {} });
    vm.runInContext(extractFn('analyze') + '\n; analyze(new Float32Array(' + JSON.stringify(arr) + ')); globalThis.S = S.stats;', ctx);
    return ctx.S;
  }
  const s = run(cube);
  near('analyze: volumen cubo 10mm = 1 cm³', s.vol, 1.0, 1e-6);
  near('analyze: área cubo 10mm = 6 cm²', s.area, 6.0, 1e-6);
  near('analyze: dimensiones', s.dx, 10, 1e-9);
  falsy('S9: cubo cerrado NO es aproximado', s.volApprox);
  // Malla abierta: un solo triángulo → bordes sin pareja → volApprox true
  const open = run([0,0,0, 10,0,0, 0,10,0]);
  truthy('S9: triángulo suelto marcado aproximado', open.volApprox);
})();

// ════════════════════════════════════════════════════════════════════
// 6) parseOBJ / _repairMesh — validación de índices (S15)
// ════════════════════════════════════════════════════════════════════
(function testParsers() {
  function runOBJ(txt) {
    const ctx = baseCtx({});
    vm.runInContext(extractFn('parseOBJ') + '\n; globalThis.R = parseOBJ(' + JSON.stringify(txt) + ');', ctx);
    return ctx.R;
  }
  // Cara válida + cara con índice fuera de rango (99) → la mala se descarta, sin NaN
  const out = runOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 99');
  eq('S15: parseOBJ descarta cara fuera de rango', out.length, 9);
  truthy('S15: parseOBJ sin NaN', Array.from(out).every(Number.isFinite));
  // Índices negativos (relativos) resuelven a los últimos vértices
  const neg = runOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -1 -2 -3');
  eq('S15: parseOBJ índices negativos válidos', neg.length, 9);

  // _repairMesh: descarta triángulo con NaN y el degenerado (área 0)
  const good = [0,0,0, 10,0,0, 0,10,0];
  const nan = [0,0,0, NaN,0,0, 0,10,0];
  const degen = [5,5,5, 5,5,5, 5,5,5];
  const mesh = good.concat(nan, degen);
  const ctx = baseCtx({});
  vm.runInContext(extractFn('_repairMesh') + '\n; var r = _repairMesh(new Float32Array(' + JSON.stringify(mesh) + ')); globalThis.R = { len: r.tris.length, removed: r.removed };', ctx);
  eq('S15: _repairMesh deja solo el triángulo bueno', ctx.R.len, 9);
  eq('S15: _repairMesh removed = 2', ctx.R.removed, 2);
})();

// ════════════════════════════════════════════════════════════════════
// 7) _deriveStatus — progreso display_status (Bug6) + runout
// ════════════════════════════════════════════════════════════════════
(function testDeriveStatus() {
  function run(m, s, sensors) {
    const ctx = baseCtx({ _sensorObjs: sensors || {} });
    vm.runInContext(extractFn('_deriveStatus') + '\n; globalThis.R = _deriveStatus(' + JSON.stringify(m) + ', ' + JSON.stringify(s) + ', "1.2.3.4");', ctx);
    return ctx.R;
  }
  // Bug6: virtual_sdcard.progress=0 pero display_status.progress=0.5 → 50%
  const a = run({ id: 'm1' }, {
    print_stats: { state: 'printing', filename: 'a.gcode', filament_used: 123 },
    virtual_sdcard: { progress: 0 }, display_status: { progress: 0.5 },
    extruder: { temperature: 200, target: 210 }, heater_bed: { temperature: 60, target: 60 },
    webhooks: { state: 'ready' },
  });
  eq('Bug6: progreso desde display_status', a.progress, 50);
  eq('estado printing', a.state, 'printing');
  eq('filamentMm redondeado', a.filamentMm, 123);
  falsy('sin runout por defecto', a.runout);
  // Klipper shutdown manda sobre el estado del print
  const b = run({ id: 'm2' }, { print_stats: { state: 'printing' }, webhooks: { state: 'shutdown' } });
  eq('shutdown manda sobre print', b.state, 'shutdown');
  // Runout: sensor sin filamento mientras imprime
  const c = run({ id: 'm3' }, {
    print_stats: { state: 'printing', filename: 'x.gcode' },
    'filament_switch_sensor fs': { enabled: true, filament_detected: false },
    webhooks: { state: 'ready' },
  }, { m3: ['filament_switch_sensor fs'] });
  truthy('runout: sensor sin filamento → runout', c.runout);
  // Con filamento presente NO hay runout
  const d = run({ id: 'm3' }, {
    print_stats: { state: 'printing', filename: 'x.gcode' },
    'filament_switch_sensor fs': { enabled: true, filament_detected: true },
    webhooks: { state: 'ready' },
  }, { m3: ['filament_switch_sensor fs'] });
  falsy('runout: con filamento NO hay runout', d.runout);
})();

// ── Reporte ──
console.log('\n  Pruebas del slicer SL3D — The Lab Solutions\n');
if (fails.length) fails.forEach(f => console.log('  \x1b[31m✗\x1b[0m ' + f));
console.log('\n  \x1b[32m' + passed + ' OK\x1b[0m' + (failed ? '   \x1b[31m' + failed + ' FALLARON\x1b[0m' : '') + '\n');
process.exit(failed ? 1 : 0);
