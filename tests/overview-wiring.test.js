#!/usr/bin/env node
'use strict';

/*
 * Cableado del OVERVIEW (pantalla de inicio). Es lo primero que se mira cada
 * mañana, así que un KPI mal calculado se convierte en una decisión mal tomada.
 * Cubre el cableado y, sobre todo, las invariantes de los importes: qué entra
 * en cada total y qué queda fuera.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ALL_JS = fs.readdirSync(path.join(ROOT, 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'))
  .join('\n');
const UNIVERSE = `${INDEX}\n${ALL_JS}`;

const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (re, text = INDEX) => (text.match(re) || []).length;
const hasFunction = (name, text = INDEX) =>
  new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`).test(text);

function functionSource(name, source = INDEX) {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const found = marker.exec(source);
  assert.ok(found, `falta ${name}()`);
  let paren = 0;
  let open = -1;
  for (let i = found.index + found[0].length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') paren += 1;
    else if (ch === ')') {
      paren -= 1;
      if (paren === 0) { open = source.indexOf('{', i); break; }
    }
  }
  assert.ok(open >= 0, `no se pudo ubicar el cuerpo de ${name}`);
  let depth = 0;
  let quote = '';
  let escape = false;
  let line = false;
  let block = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(found.index, i + 1); }
  }
  throw new Error(`no se pudo aislar ${name}`);
}

test('el overview tiene una sola entrada y sus contenedores', () => {
  assert.equal(count(/id=["']tab-overview["']/g), 1, '#tab-overview debe ser único');
  for (const id of ['kpiGrid', 'alertasArea']) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g')), 1, `#${id} debe existir una vez`);
  }
  for (const fn of ['renderOverview', '_renderOverviewNow', 'renderKPIs']) {
    assert.ok(hasFunction(fn), `falta ${fn}`);
    assert.equal(count(new RegExp(`function\\s+${esc(fn)}\\s*\\(`, 'g')), 1, `${fn} debe definirse una vez`);
  }
  // renderOverview agrupa las ráfagas y delega el trabajo real
  assert.match(functionSource('renderOverview'), /_renderOverviewNow\(\)/, 'renderOverview debe delegar en _renderOverviewNow');
  assert.match(functionSource('_renderOverviewNow'), /renderKPIs\(\)/, 'el pase real debe pintar los KPIs');
});

test('todo handler on*= del panel apunta a una función real', () => {
  const lines = INDEX.split('\n');
  const start = lines.findIndex((l) => l.includes('id="tab-overview"'));
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*<div class="tab-panel/.test(lines[i])) { end = i; break; }
  }
  const panel = lines.slice(start, end).join('\n');

  const defined = new Set();
  const add = (re) => { let m; while ((m = re.exec(UNIVERSE))) defined.add(m[1]); };
  add(/function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  add(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g);
  add(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g);
  add(/window\.([A-Za-z_$][\w$]*)\s*=/g);
  ['setTimeout', 'parseInt', 'confirm', 'Math', 'JSON', 'Date', 'event'].forEach((b) => defined.add(b));
  const keywords = new Set(['if', 'for', 'while', 'return', 'typeof', 'new', 'else', 'function', 'this', 'true', 'false', 'null', 'undefined', 'var']);

  const handler = /\son(?:click|change|input|submit)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const missing = new Set();
  let h;
  while ((h = handler.exec(panel))) {
    const code = (h[1] || h[2] || '').replace(/\.\s*[A-Za-z_$][\w$]*\s*\(/g, '.X(');
    const call = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let c;
    while ((c = call.exec(code))) {
      if (keywords.has(c[1])) continue;
      if (!defined.has(c[1])) missing.add(c[1]);
    }
  }
  assert.deepEqual([...missing], [], 'hay handlers del overview llamando funciones inexistentes');
});

test('los importes excluyen los pedidos cancelados', () => {
  // Un pedido cancelado no es ingreso. revTotal lo sumaba e inflaba el
  // histórico; semana, anterior y mes ya lo excluían.
  const body = functionSource('renderKPIs');
  assert.match(body, /if\(!cancel\)revTotal\+=neto/, 'el histórico debe excluir cancelados');
  assert.match(body, /if\(!cancel\)revSemana\+=neto/, 'la semana debe excluir cancelados');
  assert.match(body, /Cancelado['"]\)\s*return s/, 'el mes debe excluir cancelados');
});

test('el histórico no se presenta como acumulado del mes', () => {
  // Decía "total acum" junto a una tarjeta semanal con barra mensual y se leía
  // como acumulado del mes, cuando son TODOS los meses.
  const body = functionSource('renderKPIs');
  assert.doesNotMatch(body, /total acum/, 'la etiqueta ambigua no debe volver');
  assert.match(body, /histórico:/, 'debe identificarse como histórico');
});

test('el revenue se informa neto de IVA', () => {
  const body = functionSource('renderKPIs');
  assert.match(body, /\/\s*1\.19/, 'los montos deben convertirse a neto');
  assert.match(INDEX, /Revenue Semana \(neto\)/, 'la tarjeta debe declarar que es neto');
});

test('los atajos de teclado no se disparan mientras se escribe', () => {
  // Escribir un número en el editor de correo (contenteditable) cambiaba de
  // sección: el guard solo cubría INPUT/TEXTAREA/SELECT.
  assert.ok(hasFunction('_escribiendoEnCampo'), 'falta el guard de escritura');
  const guard = functionSource('_escribiendoEnCampo');
  assert.match(guard, /INPUT['"],\s*['"]TEXTAREA['"],\s*['"]SELECT/, 'debe cubrir los campos de formulario');
  assert.match(guard, /isContentEditable/, 'debe cubrir los editores enriquecidos');
  assert.match(guard, /closest\(/, 'debe cubrir los nodos anidados dentro del editor');
  const usos = count(/if\(_escribiendoEnCampo\(e\)\) return;/g);
  assert.ok(usos >= 2, 'todos los handlers de atajos deben usar el guard');
  assert.doesNotMatch(
    INDEX,
    /if\(\['INPUT','TEXTAREA','SELECT'\]\.includes\(e\.target\.tagName\)\) return;[\s\S]{0,400}?switchTab\(tabs\[n-1\]\)/,
    'ningún atajo debe volver al guard incompleto',
  );
});
