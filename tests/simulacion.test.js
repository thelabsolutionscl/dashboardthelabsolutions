#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'simulacion.js'), 'utf8');
const DOCS = fs.readFileSync(path.join(ROOT, 'docs', 'SIMULACION.md'), 'utf8');

// El módulo es un script plano que declara globales. Se evalúa en un sandbox con
// los stubs mínimos: todas las dependencias del dashboard (toast, escapeHtml,
// _proxyCfg…) se usan dentro de funciones, así que la evaluación de nivel
// superior no las necesita.
function cargar() {
  const sandbox = {
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    console,
    escapeHtml: (s) => String(s),
    toast: () => {},
  };
  vm.createContext(sandbox);
  // Las `function` de nivel superior sí quedan en el objeto global del sandbox,
  // pero los `const` viven en el scope léxico del script: hay que exponerlos.
  const epilogo = ';Object.assign(globalThis,{SIM_PERFILES,SIM_LINEAS,SIM_SYSTEM,SIM_MAX_CONCEPTOS,SIM_PANEL_VERSION,SIM_MODEL});';
  vm.runInContext(SRC + epilogo, sandbox);
  return sandbox;
}

const S = cargar();

// Los objetos que devuelve el sandbox pertenecen a otro realm, así que
// deepStrictEqual falla por prototipo aunque el valor sea idéntico. Se comparan
// planos.
const plano = (x) => JSON.parse(JSON.stringify(x));

test('el panel tiene 44 perfiles con ids únicos y tope numérico', () => {
  assert.equal(S.SIM_PERFILES.length, 44);
  const ids = new Set(S.SIM_PERFILES.map((p) => p.id));
  assert.equal(ids.size, 44, 'no puede haber ids repetidos');
  for (const p of S.SIM_PERFILES) {
    assert.match(p.id, /^[CN]\d{2}$/, `id con formato inesperado: ${p.id}`);
    assert.ok(['consumidor', 'negocio'].includes(p.tipo), `tipo inválido en ${p.id}`);
    assert.ok(Number.isFinite(p.tope) && p.tope > 0, `tope inválido en ${p.id}`);
    assert.ok(p.desc.length > 40, `descripción muy corta en ${p.id}`);
  }
});

test('la mezcla es 28 consumidor / 16 negocio', () => {
  const c = S.SIM_PERFILES.filter((p) => p.tipo === 'consumidor').length;
  const n = S.SIM_PERFILES.filter((p) => p.tipo === 'negocio').length;
  assert.equal(c, 28);
  assert.equal(n, 16);
});

test('cada línea de producto declara un público válido', () => {
  for (const [k, v] of Object.entries(S.SIM_LINEAS)) {
    assert.ok(['ambos', 'consumidor', 'negocio'].includes(v.publico), `público inválido en ${k}`);
    assert.ok(v.nombre, `falta nombre en ${k}`);
  }
});

test('_simPerfiles filtra por público', () => {
  assert.equal(S._simPerfiles('ambos').length, 44);
  assert.equal(S._simPerfiles('consumidor').length, 28);
  assert.equal(S._simPerfiles('negocio').length, 16);
});

test('_simParseConceptos separa nombre y precio', () => {
  const r = S._simParseConceptos('Lámpara tubo neón | 49900\nAplique 3D|34.900\nSin precio');
  assert.equal(r.length, 3);
  assert.deepEqual(plano(r[0]), { nombre: 'Lámpara tubo neón', precio: 49900 });
  assert.deepEqual(plano(r[1]), { nombre: 'Aplique 3D', precio: 34900 }, 'debe aceptar $ y puntos de miles');
  assert.deepEqual(plano(r[2]), { nombre: 'Sin precio', precio: 0 });
});

test('_simParseConceptos ignora vacías y respeta el tope', () => {
  assert.equal(S._simParseConceptos('\n\n  \n').length, 0);
  const muchos = Array.from({ length: 40 }, (_, i) => `Concepto ${i}`).join('\n');
  assert.equal(S._simParseConceptos(muchos).length, S.SIM_MAX_CONCEPTOS);
});

test('_simParseConceptos deja el nombre intacto si lo que sigue al | no es precio', () => {
  const r = S._simParseConceptos('Lámpara | edición limitada');
  assert.equal(r[0].precio, 0);
  assert.equal(r[0].nombre, 'Lámpara | edición limitada');
});

// ── Parseo de la respuesta de la IA ────────────────────────────
const PERFILES_TEST = [
  { id: 'C01', tipo: 'consumidor', tope: 30000, desc: 'x' },
  { id: 'C02', tipo: 'consumidor', tope: 20000, desc: 'y' },
  { id: 'C03', tipo: 'consumidor', tope: 80000, desc: 'z' },
];

test('_simParse lee votos y bloque de resumen', () => {
  const txt = [
    'C01|4|La pondría en el velador del dormitorio|Una planta grande',
    'C02|1|No le ve uso con niños chicos|Zapatillas del colegio',
    'C03|3|Le gusta pero ya tiene lámpara|Un cuadro',
    '---',
    'FRENOS: precio alto (2) ;; ya tiene una (1)',
    'COMPRADOR: mujer 25-35 arrendando depto en Ñuñoa',
    'PRECIO: $29.900, ahí deja de compararla con Sodimac',
  ].join('\n');
  const { votos, resumen } = S._simParse(txt, PERFILES_TEST);
  assert.equal(votos.length, 3);
  assert.deepEqual(plano(votos[0]), {
    id: 'C01', compra: 4,
    freno: 'La pondría en el velador del dormitorio',
    alternativa: 'Una planta grande',
  });
  assert.equal(resumen.comprador, 'mujer 25-35 arrendando depto en Ñuñoa');
  assert.match(resumen.frenos, /precio alto/);
  assert.match(resumen.precio, /29\.900/);
});

test('_simParse descarta ids desconocidos, duplicados y notas fuera de rango', () => {
  const txt = [
    'C01|4|ok|x',
    'C01|2|duplicado, se ignora|y',
    'Z99|5|id que no existe|z',
    'C02|9|nota fuera de rango|w',
    'C03|2|válido|v',
    'basura sin formato',
  ].join('\n');
  const { votos } = S._simParse(txt, PERFILES_TEST);
  assert.deepEqual(plano(votos.map((v) => v.id)), ['C01', 'C03']);
});

test('_simParse tolera respuesta vacía sin lanzar', () => {
  const { votos, resumen } = S._simParse('', PERFILES_TEST);
  assert.equal(votos.length, 0);
  assert.equal(resumen.frenos, '');
});

// ── Veredicto: la razón de ser de la herramienta es descartar ──
test('_simVeredicto es duro con la intención baja', () => {
  assert.equal(S._simVeredicto(0, 0.5), 'descartar');
  assert.equal(S._simVeredicto(9, 2.5), 'descartar', 'bajo 10% se descarta aunque la nota sea decente');
  assert.equal(S._simVeredicto(30, 1.5), 'descartar', 'promedio bajo 1.8 se descarta aunque el % sea alto');
});

test('_simVeredicto reserva prototipar para intención real', () => {
  assert.equal(S._simVeredicto(25, 2.8), 'prototipar');
  assert.equal(S._simVeredicto(60, 4.0), 'prototipar');
  assert.equal(S._simVeredicto(24, 3.5), 'dudoso', 'bajo 25% no llega a prototipar');
  assert.equal(S._simVeredicto(40, 2.7), 'dudoso', 'promedio bajo 2.8 no llega a prototipar');
});

test('_simAgrega calcula porcentaje de compra sobre notas 4 y 5', () => {
  const votos = [
    { id: 'C01', compra: 5, freno: 'a', alternativa: 'x' },
    { id: 'C02', compra: 4, freno: 'b', alternativa: 'y' },
    { id: 'C03', compra: 1, freno: 'c', alternativa: 'z' },
    { id: 'C04', compra: 0, freno: 'd', alternativa: 'w' },
  ];
  const r = S._simAgrega('Lámpara X', 49900, votos, { frenos: 'f', comprador: 'c', precio: 'p' });
  assert.equal(r.n, 4);
  assert.equal(r.pctCompra, 50);
  assert.equal(r.promedio, 2.5);
  assert.equal(r.precio, 49900);
  assert.equal(r.veredicto, 'dudoso');
});

test('_simAgrega no divide por cero con panel vacío', () => {
  const r = S._simAgrega('X', 0, [], { frenos: '', comprador: '', precio: '' });
  assert.equal(r.n, 0);
  assert.equal(r.promedio, 0);
  assert.equal(r.pctCompra, 0);
});

test('_simCosto crece con conceptos y perfiles, y nunca es cero', () => {
  const a = S._simCosto(1, 44);
  const b = S._simCosto(10, 44);
  assert.ok(a >= 1);
  assert.ok(b > a);
  assert.ok(S._simCosto(10, 16) < b, 'medio panel debe costar menos');
});

test('_simFechaCL entrega DD-MM-AAAA (convención del proyecto)', () => {
  assert.equal(S._simFechaCL('2026-08-11'), '11-08-2026');
  assert.equal(S._simFechaCL(''), '');
});

// ── Prompt: las reglas anti-complacencia son el corazón del asunto ──
test('el system prompt trae las reglas de calibración', () => {
  assert.match(S.SIM_SYSTEM, /MENOS DEL 20%/, 'debe acotar cuántos pueden llegar a 4-5');
  assert.match(S.SIM_SYSTEM, /complacient/i, 'debe nombrar la complacencia explícitamente');
  assert.match(S.SIM_SYSTEM, /ALTERNATIVA es obligatorio/i);
  assert.match(S.SIM_SYSTEM, /ID\|COMPRA\|FRENO\|ALTERNATIVA/);
  assert.match(S.SIM_SYSTEM, /nombrar en el campo FRENO el lugar exacto/i, 'condición dura para poder poner 4 o 5');
});

test('_simUserPrompt incluye perfiles, precio en CLP y contexto', () => {
  const p = S._simUserPrompt('Lámparas', 'marca nueva', 'Lámpara tubo', 49900, PERFILES_TEST);
  assert.match(p, /\$49\.900 CLP/);
  assert.match(p, /C01 \| tope \$30\.000/);
  assert.match(p, /PERFILES \(3\)/);
  assert.match(p, /marca nueva/);
});

test('_simUserPrompt avisa cuando no hay precio', () => {
  const p = S._simUserPrompt('Lámparas', 'ctx', 'Lámpara', 0, PERFILES_TEST);
  assert.match(p, /sin precio definido/);
});

// ── Cableado en el dashboard ───────────────────────────────────
test('la sección está cableada en index.html', () => {
  assert.ok(INDEX.includes('<script src="js/simulacion.js?v=%%BUILD%%"></script>'), 'falta el script tag');
  assert.ok(INDEX.includes('id="tab-simulacion"'), 'falta el panel');
  assert.ok(INDEX.includes("if(name==='simulacion') initSimulacion();"), 'falta el dispatch en switchTab');
  assert.ok(INDEX.includes('<symbol id="icon-simulacion"'), 'falta el ícono en el sprite');
  assert.ok(INDEX.includes(`data-tab="simulacion" onclick="switchTab('simulacion')"`), 'falta el botón del dock');
  assert.ok(INDEX.includes(`data-tab="simulacion" onclick="switchTabMobile('simulacion')"`), 'falta el botón móvil');
  assert.ok(INDEX.includes("{tab:'simulacion',label:'Simulación'}"), 'falta en la grilla móvil');
});

test('RBAC deja entrar a admin, gerencia, marketing y demo — y a nadie más', () => {
  const bloque = INDEX.slice(INDEX.indexOf('tabs:{'), INDEX.indexOf('nuevos:{'));
  const permiso = (rol) => new RegExp(`${rol}:\\s*\\[[^\\]]*'simulacion'`).test(bloque);
  for (const rol of ['admin', 'gerencia', 'marketing', 'demo']) {
    assert.ok(permiso(rol), `${rol} debería tener acceso a simulacion`);
  }
  for (const rol of ['comercial', 'produccion', 'finanzas']) {
    assert.ok(!permiso(rol), `${rol} no debería tener acceso a simulacion`);
  }
});

test('cada control del panel apunta a una función que existe', () => {
  const panel = INDEX.slice(INDEX.indexOf('id="tab-simulacion"'), INDEX.indexOf('<!-- MÁQUINAS -->'));
  const usadas = new Set([...panel.matchAll(/on(?:click|change|input)="(\w+)\(/g)].map((m) => m[1]));
  assert.ok(usadas.size >= 5, 'el panel debería cablear varias funciones');
  for (const fn of usadas) {
    assert.equal(typeof S[fn], 'function', `${fn}() se usa en el panel pero no existe en simulacion.js`);
  }
});

test('los ids que lee el módulo existen en el panel', () => {
  const panel = INDEX.slice(INDEX.indexOf('id="tab-simulacion"'), INDEX.indexOf('<!-- MÁQUINAS -->'));
  const leidos = new Set([...SRC.matchAll(/getElementById\('(sim[\w]+)'\)/g)].map((m) => m[1]));
  assert.ok(leidos.size >= 8, 'el módulo debería leer varios ids');
  for (const id of leidos) {
    assert.ok(panel.includes(`id="${id}"`), `el módulo lee #${id} pero el panel no lo declara`);
  }
});

test('la advertencia sobre estética está en pantalla, no solo en los docs', () => {
  const panel = INDEX.slice(INDEX.indexOf('id="tab-simulacion"'), INDEX.indexOf('<!-- MÁQUINAS -->'));
  assert.match(panel, /no mide estética/i);
});

test('el módulo no hornea claves ni llama a Anthropic sin pasar por el proxy', () => {
  assert.ok(!/sk-ant-/.test(SRC), 'no puede haber API keys en el código');
  const directas = [...SRC.matchAll(/api\.anthropic\.com/g)].length;
  assert.equal(directas, 1, 'solo el fallback sin proxy puede llamar directo a Anthropic');
  assert.match(SRC, /_proxyCfg/, 'debe intentar el proxy primero');
});

test('la documentación existe y advierte los límites', () => {
  assert.match(DOCS, /no mide estética/i);
  assert.match(DOCS, /SIM_PANEL_VERSION/);
});
