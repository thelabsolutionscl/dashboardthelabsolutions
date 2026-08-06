#!/usr/bin/env node
'use strict';

/*
 * Cableado de AGENTES. La sección no tenía red: un rename o un borrado dejaba
 * botones muertos sin error de sintaxis. Cubre lo que rompe en silencio:
 * handlers → función real, bandejas con su contenedor, y las invariantes de
 * negocio que ya costaron un bug (envíos que no se pueden previsualizar,
 * marcado de gestionado, y el filtro de aprobadas sin pedido).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AGENTS = fs.readFileSync(path.join(ROOT, 'js', 'agentes.js'), 'utf8');
const MAIL = fs.readFileSync(path.join(ROOT, 'js', 'correo.js'), 'utf8');
// Todos los módulos js/ comparten el scope global del navegador: un handler de
// Agentes puede llamar legítimamente a una función de otro módulo (p.ej.
// openFichaModal vive en pdf-fichas.js), así que el universo de definiciones
// tiene que incluirlos a todos.
const ALL_JS = fs.readdirSync(path.join(ROOT, 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'))
  .join('\n');
const SOURCE = `${INDEX}\n${AGENTS}`;
const UNIVERSE = `${INDEX}\n${ALL_JS}`;

const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (re, text = SOURCE) => (text.match(re) || []).length;
const hasFunction = (name, text = SOURCE) =>
  new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`).test(text);

// Cuerpo de una función. El cuerpo empieza tras la lista de parámetros: con un
// valor por defecto (opts={}) el primer `{` es del parámetro, no del cuerpo.
function functionSource(name, source = SOURCE) {
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

test('la sección tiene una sola entrada y navegación', () => {
  assert.equal(count(/id=["']tab-agentes["']/g, INDEX), 1, '#tab-agentes debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]agentes['"]\s*\)/, 'debe existir navegación a Agentes');
  assert.equal(count(/id=["']agentesGrid["']/g, INDEX), 1, 'el grid de agentes debe existir una vez');
});

test('todo handler on*= de la sección apunta a una función real', () => {
  const defined = new Set();
  const add = (re) => { let m; while ((m = re.exec(UNIVERSE))) defined.add(m[1]); };
  add(/function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  add(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g);
  add(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g);
  add(/window\.([A-Za-z_$][\w$]*)\s*=/g);
  add(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[{[]/g);
  const builtins = ['setTimeout', 'setInterval', 'parseInt', 'parseFloat', 'confirm', 'prompt', 'alert', 'fetch', 'Number', 'String', 'Math', 'JSON', 'Date', 'event'];
  builtins.forEach((b) => defined.add(b));
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete', 'void', 'do', 'else', 'function', 'in', 'of', 'this', 'true', 'false', 'null', 'undefined', 'await', 'async']);

  const handler = /\son(?:click|change|input|submit|keydown|keyup|focus|blur)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const missing = new Set();
  let h;
  while ((h = handler.exec(AGENTS))) {
    const code = (h[1] || h[2] || '').replace(/\.\s*[A-Za-z_$][\w$]*\s*\(/g, '.X(');
    const call = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
    let c;
    while ((c = call.exec(code))) {
      if (keywords.has(c[1])) continue;
      if (!defined.has(c[1])) missing.add(c[1]);
    }
  }
  assert.deepEqual([...missing], [], 'hay handlers llamando funciones inexistentes');
});

test('las funciones críticas existen y no están duplicadas', () => {
  const names = ['buildFollowupTray', 'buildWinbackTray', 'buildRecompraTray', 'buildPostEntregaTray',
    'renderChurn', 'renderCsatSummary', 'runAgentInline', 'draftAgentEmail', 'agentSendWA',
    'fuMarkDone', 'pdMarkDone', 'pdEmail', 'pdWhatsApp', 'marcarReactivado'];
  for (const name of names) {
    assert.ok(hasFunction(name, AGENTS), `falta ${name}`);
    assert.equal(count(new RegExp(`function\\s+${esc(name)}\\s*\\(`, 'g'), AGENTS), 1, `${name} debe definirse una vez`);
  }
});

test('cada bandeja escribe en un contenedor que existe en el HTML', () => {
  const pares = [
    ['buildFollowupTray', 'fuTrayList'],
    ['buildPostEntregaTray', 'pdTrayList'],
    ['buildRecompraTray', 'recompraTrayCard'],
    ['renderCsatSummary', 'pdCsatBar'],
  ];
  for (const [fn, id] of pares) {
    const body = functionSource(fn, AGENTS);
    assert.match(body, new RegExp(`getElementById\\(['"]${esc(id)}['"]\\)`), `${fn} debe usar #${id}`);
    assert.ok(INDEX.includes(`id="${id}"`), `#${id} debe existir en el HTML`);
  }
});

test('los envíos de correo se previsualizan antes de salir', () => {
  // pdEmail abría el envío directo; ahora debe dejar un borrador editable en
  // Correos. Enviar sin poder revisar fue un problema real reportado.
  const body = functionSource('pdEmail', AGENTS);
  assert.match(body, /MAIL\.openCompose\(/, 'debe abrir un borrador, no enviar directo');
  assert.doesNotMatch(body, /action:\s*['"]send['"]/, 'no debe enviar sin previsualización');
  assert.match(body, /_pdPedidoId/, 'el borrador debe conservar el vínculo al pedido');
  assert.match(MAIL, /_cmpPdPedido/, 'Correos debe recibir el vínculo del pedido');
  assert.match(MAIL, /pdMarkDone\(this\._cmpPdPedido/, 'el pedido se marca gestionado recién al enviar');
});

test('el remitente comercial no depende de la casilla activa', () => {
  const body = functionSource('pdEmail', AGENTS);
  assert.match(body, /_fromName:\s*AGENT_CTA_FROM\.name/, 'debe fijar el nombre del remitente');
  assert.match(body, /_fromEmail:\s*AGENT_CTA_FROM\.email/, 'debe fijar la casilla de salida');
  assert.match(MAIL, /this\._cmpFromEmail\?await this\.postAs\(/, 'Correos debe autenticar con esa casilla');
});

test('marcar gestionado no depende de que el envío haya ocurrido', () => {
  // pdMarkDone es la salida manual de la bandeja: debe existir y registrar el
  // canal, para que un pedido atendido por fuera no quede reapareciendo.
  const body = functionSource('pdMarkDone', AGENTS);
  assert.match(body, /_pdLog\(\)/, 'debe leer el registro de gestionados');
  assert.match(body, /localStorage\.setItem/, 'debe persistir el marcado');
});

test('los agentes usan el modelo configurado, no uno hardcodeado por llamada', () => {
  assert.match(SOURCE, /const\s+AGENT_MODEL\s*=/, 'debe existir una constante de modelo');
  const usos = count(/model:\s*['"]claude-[a-z0-9.-]+['"]/g, AGENTS);
  assert.equal(usos, 0, 'ningún agente debe fijar el modelo por su cuenta');
});
