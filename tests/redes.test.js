#!/usr/bin/env node
/*
 * Pruebas de la lógica pura de la sección Redes Sociales.
 *
 * No reimplementa la lógica: EXTRAE las funciones reales desde index.html
 * (por nombre, con balanceo de llaves que ignora strings/comentarios) y las
 * ejecuta en un sandbox (vm) con dependencias simuladas. Si alguien cambia el
 * parser de redes, la heurística de sentimiento o el cálculo de mejor día,
 * estas pruebas lo detectan.
 *
 * Correr:  node tests/redes.test.js
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
// Ejecuta el código extraído en un sandbox con dependencias inyectadas; devuelve globalThis.__r
function run(code, deps) {
  const ctx = Object.assign({ String, Object, Math, JSON, Date, RegExp, Number, isNaN, parseInt }, deps || {}, { globalThis: {} });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.__r;
}

// ── Mini-arnés de aserciones ──
let passed = 0, failed = 0;
const fails = [];
function assert(name, cond, detail) {
  if (cond) { passed++; } else { failed++; fails.push(name + (detail ? '  → ' + detail : '')); }
}
function eq(name, got, want) { assert(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }

// ════════════════════════════════════════════════════════════════════
// 1) PARSER POR RED — _redesSplitByNetwork()
// ════════════════════════════════════════════════════════════════════
(function testSplit() {
  const fn = extractFn('_redesSplitByNetwork');
  // Salida típica de CAPTION_AGENT: encabezados de red + cuerpos.
  const sample = [
    '**Instagram:**', 'Neón listo ✨. Síguenos en Instagram para más.', 'HASHTAGS: #neon #santiago', '',
    'LinkedIn:', 'Caso de éxito B2B con un cliente real.', '',
    'TikTok/Reels:', 'Gancho: mira cómo nace un neón.', '',
    'Facebook:', 'Otro local iluminado en Vitacura.',
  ].join('\n');
  const reds = run(fn + '\n; globalThis.__r = _redesSplitByNetwork(__S) ? _redesSplitByNetwork(__S).map(x=>x.red) : null;', { __S: sample });
  eq('split detecta las 4 redes en orden', reds, ['Instagram', 'LinkedIn', 'TikTok', 'Facebook']);

  // La línea "Síguenos en Instagram" NO debe crear una sección extra (anclado al inicio).
  const r2 = run(fn + '\n; globalThis.__r = _redesSplitByNetwork(__S);', { __S: sample });
  eq('split → 4 secciones (sin falsos positivos)', r2.length, 4);
  // El cuerpo de Instagram conserva su texto y separa los hashtags.
  eq('split extrae hashtags de IG', r2[0].hashtags, '#neon #santiago');
  assert('split body IG sin línea HASHTAGS', !/HASHTAGS/i.test(r2[0].copy), r2[0].copy);

  // Texto sin encabezados de red → null (no es multi-red).
  const r3 = run(fn + '\n; globalThis.__r = _redesSplitByNetwork(__S);', { __S: 'Un solo párrafo mencionando Instagram y Facebook, sin encabezados.' });
  eq('split sin encabezados → null', r3, null);
})();

// ════════════════════════════════════════════════════════════════════
// 2) SENTIMIENTO — _redesSentiment()
// ════════════════════════════════════════════════════════════════════
(function testSentiment() {
  const fn = extractFn('_redesSentiment');
  const mk = (msg, intent) => ({ fields: { 'Mensaje': msg, 'Intención': intent || '' } });
  const res = run(fn + '\n; globalThis.__r = {' +
    'queja: _redesSentiment(__Q), pos: _redesSentiment(__P), neu: _redesSentiment(__N), soporte: _redesSentiment(__S)' +
    '};', {
      __Q: mk('Mi pedido llegó roto y muy tarde, pésimo servicio'),
      __P: mk('Quedó increíble el trabajo 🔥, gracias equipo!'),
      __N: mk('Hola, ¿hacen envíos a regiones?'),
      __S: mk('Consulta', 'soporte'),
    });
  eq('sentimiento queja → neg', res.queja, 'neg');
  eq('sentimiento elogio → pos', res.pos, 'pos');
  eq('sentimiento neutro → neu', res.neu, 'neu');
  eq('sentimiento intención=soporte → neg', res.soporte, 'neg');
})();

// ════════════════════════════════════════════════════════════════════
// 3) MEJOR DÍA POR RED — _redesBestByWeekday() (desde Social_Metrics)
// ════════════════════════════════════════════════════════════════════
(function testBestDay() {
  const fn = extractFn('_redesBestByWeekday');
  // Instagram concentra engagement el día A; LinkedIn el día B.
  const dayA = '2026-06-15T12:00:00', dayB = '2026-06-17T12:00:00';
  const wdA = new Date(dayA).getDay(), wdB = new Date(dayB).getDay();
  const metrics = [
    { fields: { 'Red': 'Instagram', 'Fecha': dayA, 'Engagement': 500 } },
    { fields: { 'Red': 'Instagram', 'Fecha': dayB, 'Engagement': 50 } },
    { fields: { 'Red': 'LinkedIn', 'Fecha': dayB, 'Engagement': 300 } },
    { fields: { 'Red': 'LinkedIn', 'Fecha': dayA, 'Engagement': 20 } },
  ];
  const best = run(fn + '\n; globalThis.__r = _redesBestByWeekday();', { state: { socialMetrics: metrics } });
  eq('mejor día Instagram = día A', best.Instagram, wdA);
  eq('mejor día LinkedIn = día B', best.LinkedIn, wdB);
  // Sin métricas → objeto vacío.
  const empty = run(fn + '\n; globalThis.__r = _redesBestByWeekday();', { state: { socialMetrics: [] } });
  eq('sin métricas → {}', empty, {});
})();

// ── Resultado ──
if (failed) {
  console.error('\n❌ Redes: ' + passed + ' OK, ' + failed + ' fallaron:');
  fails.forEach(f => console.error('   · ' + f));
  process.exit(1);
}
console.log('✓ Redes: ' + passed + ' pruebas OK');
