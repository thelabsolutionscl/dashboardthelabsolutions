#!/usr/bin/env node
/*
 * Qué alcanza a ver el rol comercial.
 *
 * El permiso estaba puesto sobre la SECCIÓN, nunca sobre el dato. Un comercial
 * tiene acceso a Clientes, Pedidos y Cotizaciones —de ahí que las listas de esas
 * secciones filtren por vendedor— pero la búsqueda global y tres de las cuatro
 * vistas de Pedidos leían el estado completo, así que le mostraban los registros
 * y montos de toda la empresa.
 *
 * Correr:  node --test tests/permisos-comercial.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FIN = fs.readFileSync(path.join(ROOT, 'js', 'finanzas.js'), 'utf8');

function extraer(src, nombre) {
  const cab = new RegExp(`(?:async\\s+)?function\\s+${nombre}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  assert.ok(cab, `debe existir ${nombre}`);
  const abre = src.indexOf('{', cab.index);
  let d = 0, q = '', esc = false, lc = false, bc = false;
  for (let i = abre; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lc) { if (c === '\n') lc = false; continue; }
    if (bc) { if (c === '*' && n === '/') { bc = false; i++; } continue; }
    if (q) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = ''; continue; }
    if (c === '/' && n === '/') { lc = true; i++; continue; }
    if (c === '/' && n === '*') { bc = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}') { d--; if (d === 0) return src.slice(cab.index, i + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

test('las cuatro vistas de Pedidos muestran lo mismo', () => {
  // Kanban, Planificación y Calendario leían state.pedidos directo: cambiar de
  // vista dentro de la misma pestaña destapaba los pedidos de los demás.
  for (const vista of ['renderPedidosKanban', 'renderPedidosPlanificacion', 'renderPedidosCalendario']) {
    const cuerpo = extraer(HTML, vista);
    assert.match(cuerpo, /_pedidosVisibles\(\)/, `${vista} debe partir de los pedidos visibles`);
    assert.doesNotMatch(cuerpo, /state\.pedidos\s*\.\s*filter|state\.pedidos\.filter/, `${vista} no puede leer state.pedidos directo`);
  }
  // Y la vista Tabla, que ya filtraba, tiene que seguir haciéndolo. (Se mira una
  // ventana desde su cabecera: es demasiado larga para acotarla por llaves.)
  const iTabla = /function\s+renderPedidos\s*\(/.exec(HTML).index;
  assert.match(HTML.slice(iTabla, iTabla + 1200), /isVendorMode\(\)|_pedidosVisibles\(\)/,
    'la vista Tabla debe seguir filtrando por vendedor');
});

test('el filtro de pedidos por vendedor vive en un solo sitio', () => {
  const helper = extraer(HTML, '_pedidosVisibles');
  assert.match(helper, /isVendorMode\(\)/);
  assert.match(helper, /vendorOwnsRecord/);
  assert.match(helper, /state\.pedidos/);
});

test('la búsqueda global no cruza el alcance del vendedor', () => {
  const fn = extraer(FIN, 'globalSearchOnInput');
  // Antes bastaba con tener la sección; ahora además tiene que ser suyo.
  assert.match(fn, /vendorOwnsRecord/, 'la búsqueda debe respetar la propiedad del registro');
  for (const coll of ['clientes', 'pedidos', 'cotizaciones']) {
    assert.match(
      fn,
      new RegExp(`_gsAllowed\\('${coll}'\\)\\)\\s*\\(st\\.${coll}\\|\\|\\[\\]\\)\\.filter\\(_mio\\)`),
      `la búsqueda de ${coll} debe filtrar por vendedor`
    );
  }
});

test('ninguna acción de la paleta queda sin dueño', () => {
  // Una acción sin sección declarada era visible para todos los roles: por ahí
  // un comercial llegaba al arqueo de caja, al IVA del mes o al respaldo del CRM.
  const i = FIN.indexOf('GS_ACTIONS');
  const bloque = FIN.slice(i, FIN.indexOf('\n];', i));
  const sinDueno = bloque.split('\n')
    .filter((l) => l.includes('title:') && !/\btab:\s*'/.test(l) && !/\bnuevo:\s*'/.test(l) && !/\bconfig:\s*true/.test(l))
    .map((l) => (l.match(/title:\s*'([^']+)'/) || [])[1]);
  // Solo pueden quedar libres las que cualquier rol puede usar sobre lo suyo.
  const libresOk = ['Actualizar datos', 'Mi cuenta / Configuración', 'Abrir KAI (asistente)', 'Agendar compromiso', 'Catálogo de productos'];
  const inesperadas = sinDueno.filter((t) => !libresOk.includes(t));
  assert.deepEqual(inesperadas, [], `Acciones sin restricción de rol: ${inesperadas.join(', ')}`);
});

test('las acciones de finanzas y el respaldo quedan fuera del alcance comercial', () => {
  const i = FIN.indexOf('GS_ACTIONS');
  const bloque = FIN.slice(i, FIN.indexOf('\n];', i));
  const linea = (titulo) => bloque.split('\n').find((l) => l.includes(`title:'${titulo}'`) || l.includes(`title: '${titulo}'`));
  for (const t of ['Arqueo de caja del día', 'Punto de equilibrio', 'IVA del mes (F29)']) {
    assert.match(linea(t) || '', /tab:\s*'finanzas'/, `"${t}" debe exigir acceso a Finanzas`);
  }
  assert.match(linea('Respaldar CRM ahora') || '', /config:\s*true/, 'el respaldo completo del CRM es de administración');
  assert.match(linea('Modo TV (taller)') || '', /tab:\s*'maquinas'/, 'la pantalla del taller pertenece al taller');

  // Y el filtro tiene que honrar de verdad la marca de configuración.
  const fn = extraer(FIN, 'globalSearchOnInput');
  assert.match(fn, /!a\.config\s*\|\|/, 'el filtro debe mirar la marca config');
  assert.match(fn, /canConfigRole/, 'y resolverla con el rol del usuario');
});

test('Remuneraciones es del comercial, no de los socios (decisión, no olvido)', () => {
  // Gustavo y Nicanor son socios: hacen retiros, no cobran comisión, así que la
  // sección no les corresponde. Parece un error de la tabla de permisos y no lo
  // es — esta prueba existe para que nadie la "complete".
  const i = HTML.indexOf('const RBAC={');
  const tabla = HTML.slice(i, HTML.indexOf('nuevos:{', i));
  const deRol = (rol) => (new RegExp(`${rol}:\\s*\\[([^\\]]*)\\]`).exec(tabla) || [])[1] || '';
  assert.match(deRol('comercial'), /'remuneraciones'/, 'el comercial sí cobra comisión');
  for (const rol of ['admin', 'gerencia']) {
    assert.doesNotMatch(deRol(rol), /'remuneraciones'/, `${rol} son socios: retiros, no comisión`);
  }
  assert.match(HTML.slice(i, i + 900), /retiros, no cobran comisi/, 'el motivo debe quedar escrito junto a la tabla');
});

test('Newsletter y Redes son de toda la empresa y no filtran plata', () => {
  // La audiencia es la cartera completa a propósito. Lo que no puede pasar es
  // que por ahí se cuelen montos o márgenes de pedidos de otros vendedores.
  const redes = fs.readFileSync(path.join(ROOT, 'js', 'redes.js'), 'utf8');
  for (const fn of ['redesGenerateFromPedido', 'nlPopulatePedidos', 'redesPopulatePedidos', '_nlBuildContext']) {
    const cuerpo = extraer(redes, fn);
    assert.doesNotMatch(cuerpo, /Monto total|Total final|Subtotal|costoUnit|ventaUnit|margen/i,
      `${fn} no puede exponer importes`);
  }
});

test('el rol comercial no gana secciones por la puerta de atrás', () => {
  // switchTab es la única entrada a una sección: si no valida, las secciones
  // ocultas se alcanzan igual desde cualquier enlace o atajo.
  const st = extraer(HTML, 'switchTab');
  assert.match(st, /RBAC\.tabs\[/, 'switchTab debe consultar los permisos del rol');
  assert.match(st, /No tienes acceso a esta sección/, 'y cortar si no corresponde');
  const guardia = st.indexOf('_allowed.includes(name)');
  const pinta = st.indexOf("document.getElementById('tab-'+name)");
  assert.ok(guardia > 0 && pinta > guardia, 'la comprobación debe ir antes de mostrar la sección');
});
