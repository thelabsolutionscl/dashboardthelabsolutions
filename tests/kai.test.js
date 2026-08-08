#!/usr/bin/env node
/*
 * KAI, el asistente con herramientas.
 *
 * Es una IA con acceso a actuar sobre el dashboard, así que lo primero fue ver
 * qué puede hacer: sus siete herramientas navegan, abren formularios, delegan a
 * un agente, sugieren botones y consultan el CRM. Ninguna escribe ni borra
 * datos — eso está bien pensado.
 *
 * Lo que sí estaba abierto era el alcance. El panorama que se le inyecta en CADA
 * mensaje no filtraba por vendedor: a un comercial le bastaba con abrir el chat
 * y saludar para recibir los ingresos acumulados de la empresa, la cobranza, las
 * facturas vencidas y los últimos pedidos con cliente y monto. Medido en
 * navegador: $8.403.361 antes, $840.336 (lo suyo) después.
 *
 * Correr:  node --test tests/kai.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KAI = fs.readFileSync(path.join(ROOT, 'js', 'kai.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function trozo(src, desde, hasta) {
  const i = src.indexOf(desde);
  assert.ok(i > 0, `debe existir ${desde}`);
  const j = src.indexOf(hasta, i + desde.length);
  return src.slice(i, j > 0 ? j : i + 4000);
}

test('KAI no puede escribir ni borrar datos', () => {
  // El límite más importante: sus herramientas mueven la interfaz y leen, pero
  // no tocan Airtable. Si algún día se le da una que escriba, esta prueba avisa.
  const tools = trozo(KAI, 'KAI_TOOLS', '\n  ];');
  const nombres = [...tools.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(nombres.sort(), ['abrir_formulario', 'asistente', 'consultar_crm', 'cotizar', 'delegar', 'navegar', 'sugerir_acciones']);
  const ejec = trozo(KAI, 'async function _kaiExecTool', '\n  // ─── Ask Claude');
  assert.doesNotMatch(ejec, /airtableWrite|airtableDelete|method:'POST'|method:'PATCH'|method:'DELETE'/,
    'ninguna herramienta puede escribir en Airtable');
});

test('el panorama de cada mensaje respeta el alcance del vendedor', () => {
  // Este texto viaja en TODOS los mensajes, se pregunte o no.
  const ctx = trozo(KAI, 'function buildContext()', 'const SYS_RULES');
  assert.match(ctx, /isVendorMode\(\)/, 'debe detectarse el modo vendedor');
  for (const coll of ['pedidos', 'cotizaciones', 'clientes']) {
    assert.match(ctx, new RegExp(`\\(s\\.${coll} \\|\\| \\[\\]\\)\\.filter\\(_mio\\)`), `${coll} debe filtrarse`);
  }
  // Cobranza, proveedores y máquinas son de secciones que un comercial no tiene.
  assert.match(ctx, /const lineasEmpresa = _av \? '' :/, 'esas líneas se omiten en modo vendedor');
  assert.match(ctx, /Cobranza:/, 'y siguen existiendo para quien sí tiene la sección');
});

test('la consulta al CRM tampoco cruza el alcance', () => {
  const fn = trozo(KAI, 'function _kaiConsultarCRM', 'async function _kaiExecTool');
  assert.match(fn, /const _av=\(typeof isVendorMode==='function'&&isVendorMode\(\)\)/);
  // Y que el filtrado se USE de verdad: tener las piezas sueltas no sirve si la
  // condición que las aplica queda desconectada.
  assert.match(fn, /const s=_av\?\{\.\.\._st,/, 'el alcance acotado debe aplicarse cuando hay modo vendedor');
  assert.match(fn, /pedidos:\(_st\.pedidos\|\|\[\]\)\.filter\(_mio\)/);
  assert.match(fn, /cotizaciones:\(_st\.cotizaciones\|\|\[\]\)\.filter\(_mio\)/);
  assert.match(fn, /clientes:\(_st\.clientes\|\|\[\]\)\.filter\(_mio\)/);
  // El total por cobrar de la empresa no se entrega a quien no tiene Finanzas.
  assert.match(fn, /let porCobrar=null;\s*\n\s*if\(!_av\)/, 'la cobranza queda fuera en modo vendedor');
});

test('el chat no es la puerta de atrás para correr un agente vetado', () => {
  // Se acababa de cerrar la parrilla de Agentes; delegar la saltaba entera.
  const del = trozo(KAI, "if(name==='delegar')", 'return \'Resultado de \'');
  assert.match(del, /agenteVisible\(cfg\)/, 'delegar debe comprobar el permiso del agente');
  const iVis = del.indexOf('agenteVisible');
  const iRun = del.indexOf('callClaude(');
  assert.ok(iVis > 0 && iRun > iVis, 'la comprobación va ANTES de llamar al modelo');
});

test('a KAI se le ofrecen solo los agentes que el rol puede correr', () => {
  // La lista estaba fija en el prompt: KAI proponía delegar al de finanzas a
  // quien no tiene esa sección, y después el intento se rechazaba. Ruido inútil.
  assert.match(KAI, /Agentes: \$\{_kaiAgentesPermitidos\(\)\}/, 'la lista debe construirse por rol');
  const fn = trozo(KAI, 'function _kaiAgentesPermitidos', 'const SYS_RULES');
  assert.match(fn, /agenteVisible\(a\)/);
  assert.doesNotMatch(KAI, /Agentes: SALES, QUOTE, PRODUCTION/, 'no puede quedar la lista fija vieja');
});

test('navegar y abrir_formulario se apoyan en el guardia que ya existe', () => {
  // switchTab valida el rol y corta; KAI no necesita repetir esa lógica, pero sí
  // tiene que pasar por ahí en vez de manipular la pantalla por su cuenta.
  const ejec = trozo(KAI, 'async function _kaiExecTool', "if(name==='delegar')");
  assert.match(ejec, /if\(name==='navegar'\)\{[\s\S]{0,200}?window\.switchTab\(mod\)/);
  for (const t of ['nuevo-lead', 'nueva-cot', 'nuevo-proveedor']) {
    assert.ok(ejec.includes(`switchTab('${t}')`), `${t} debe abrirse vía switchTab`);
  }
  const st = trozo(HTML, 'function switchTab(name)', '\nfunction ');
  assert.match(st, /No tienes acceso a esta sección/, 'y switchTab sigue siendo el que corta');
});
