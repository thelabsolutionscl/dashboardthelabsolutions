#!/usr/bin/env node
/*
 * A qué agentes de IA llega cada rol.
 *
 * La parrilla mostraba los 21 a cualquiera con acceso a la pestaña Agentes. Un
 * comercial no tiene la sección Finanzas, pero podía correr igual el agente de
 * finanzas desde ahí — el mismo patrón que ya se había cerrado en la paleta de
 * comandos: el permiso estaba sobre la sección, no sobre la herramienta.
 *
 * Cada agente pertenece ahora a la sección de su oficio y se permite solo si el
 * rol tiene esa sección. Los datos ya iban acotados al vendedor de antes; esto
 * acota las herramientas.
 *
 * Correr:  node --test tests/agentes-por-rol.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AGENTES = fs.readFileSync(path.join(ROOT, 'js', 'agentes.js'), 'utf8');

// {id: seccion} tal como quedó declarado en la configuración.
const AGENTS = (() => {
  const i = HTML.indexOf('const AGENTES_CFG=');
  const seg = HTML.slice(i, HTML.indexOf('\n];', i));
  const out = {};
  for (const l of seg.split('\n')) {
    const id = (l.match(/\{id:'([^']+)'/) || [])[1];
    if (id) out[id] = (l.match(/\btab:'([^']+)'/) || [])[1] || null;
  }
  return out;
})();

// La tabla de secciones por rol, leída del propio RBAC.
const TABS = (() => {
  const i = HTML.indexOf('const RBAC={');
  const tabla = HTML.slice(i, HTML.indexOf('nuevos:{', i));
  const out = {};
  for (const m of tabla.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return out;
})();

const visiblesPara = (rol) => Object.entries(AGENTS)
  .filter(([, tab]) => !tab || (TABS[rol] || []).includes(tab))
  .map(([id]) => id);

test('los 21 agentes declaran a qué sección pertenecen', () => {
  const sinSeccion = Object.entries(AGENTS).filter(([, t]) => !t).map(([id]) => id);
  assert.deepEqual(sinSeccion, [], `Agentes sin sección (visibles para todos): ${sinSeccion.join(', ')}`);
  assert.equal(Object.keys(AGENTS).length, 21);
});

test('los socios no pierden ningún agente', () => {
  // El corte es para acotar roles, no para estorbarle a quien manda.
  for (const rol of ['admin', 'gerencia']) {
    assert.equal(visiblesPara(rol).length, 21, `${rol} debe conservar los 21`);
  }
});

test('el comercial conserva los de su oficio y pierde los ajenos', () => {
  const v = visiblesPara('comercial');
  // Lo suyo: vender, cotizar, seguir, captar, dar la bienvenida, informar al
  // cliente, y todo lo de redes y newsletter, que son secciones que sí tiene.
  for (const id of ['SALES', 'QUOTE', 'FOLLOWUP', 'LEADGEN', 'ONBOARDING', 'REPCLIENTE',
                    'CONTENT', 'LINKEDIN', 'SOCIAL_STRATEGIST', 'CAPTION_AGENT',
                    'COMMUNITY_AGENT', 'TREND_AGENT', 'REPORT_SOCIAL_AGENT', 'NEWSLETTER_AGENT']) {
    assert.ok(v.includes(id), `el comercial necesita ${id} para trabajar`);
  }
  // Lo ajeno: son secciones que su rol no tiene.
  for (const id of ['FINANCE', 'CEO', 'PRODUCTION', 'MANTENCION3D', 'QA', 'ADS', 'SOCIAL_ADS_AGENT']) {
    assert.ok(!v.includes(id), `${id} pertenece a una sección que el comercial no tiene`);
  }
  assert.equal(v.length, 14);
});

test('cada agente apunta a una sección que existe de verdad', () => {
  // Una sección mal escrita dejaría al agente invisible para todos, en silencio.
  const reales = new Set(Object.values(TABS).flat());
  for (const [id, tab] of Object.entries(AGENTS)) {
    assert.ok(reales.has(tab), `${id} apunta a '${tab}', que no es una sección de ningún rol`);
  }
});

test('ningún agente queda fuera del alcance de los socios', () => {
  // Si un agente apuntara a una sección que admin no tiene, nadie podría usarlo.
  for (const [id, tab] of Object.entries(AGENTS)) {
    assert.ok(TABS.admin.includes(tab), `${id} apunta a '${tab}', que admin no tiene: quedaría inservible`);
  }
});

test('esconder el botón no basta: la ejecución también se comprueba', () => {
  // Es la lección de la paleta de comandos. Los agentes se lanzan desde la
  // parrilla Y desde botones repartidos por el dashboard.
  const fn = HTML.slice(HTML.indexOf('function agenteVisible'), HTML.indexOf('function agenteVisible') + 500);
  assert.match(fn, /RBAC\.tabs\[u\.role\]/, 'debe resolverse con las secciones del rol');
  assert.match(fn, /if\(!cfg\.tab\) return true/, 'un agente sin sección no se restringe');

  const runAgent = HTML.slice(HTML.indexOf('async function runAgent(id)'), HTML.indexOf('async function runAgent(id)') + 500);
  assert.match(runAgent, /if\(!agenteVisible\(cfg\)\)\{toast\(/, 'la parrilla debe comprobar antes de correr');

  const inline = AGENTES.slice(AGENTES.indexOf('async function runAgentInline'), AGENTES.indexOf('async function runAgentInline') + 600);
  assert.match(inline, /!agenteVisible\(cfg\)/, 'los botones sueltos del dashboard también');

  // Y la parrilla tiene que filtrar al pintar.
  assert.match(HTML, /AGENTES_CFG\.filter\(agenteVisible\)\.map/, 'la parrilla solo pinta los permitidos');
});
