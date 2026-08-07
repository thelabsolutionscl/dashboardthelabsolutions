#!/usr/bin/env node
/*
 * Listas compartidas entre computadores (órdenes de compra, catálogo, reclamos,
 * contratos recurrentes, precios de proveedor).
 *
 * Viven en el navegador y se respaldan en Airtable como una sola lista. Antes el
 * respaldo se pisaba entero: si Nicanor creaba la OC-005 y Gustavo guardaba
 * después, la de Nicanor desaparecía. Ahora se fusiona por id.
 *
 * Estas pruebas montan DOS navegadores con su propio almacenamiento y simulan el
 * ida y vuelta real, incluido el reloj, para poder comprobar las lápidas.
 *
 * Correr:  node --test tests/listas-compartidas.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const cab = new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)\\s*\\{`).exec(HTML);
  assert.ok(cab, `debe existir ${nombre}`);
  const abre = HTML.indexOf('{', cab.index);
  let d = 0, q = '', esc = false, lc = false, bc = false;
  for (let i = abre; i < HTML.length; i++) {
    const c = HTML[i], n = HTML[i + 1];
    if (lc) { if (c === '\n') lc = false; continue; }
    if (bc) { if (c === '*' && n === '/') { bc = false; i++; } continue; }
    if (q) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = ''; continue; }
    if (c === '/' && n === '/') { lc = true; i++; continue; }
    if (c === '/' && n === '*') { bc = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++;
    if (c === '}') { d--; if (d === 0) return HTML.slice(cab.index, i + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

const NOMBRES = ['_listaCruda', '_listaVivos', '_listaHuella', '_listaPrune', '_listaMerge', '_listaGuardar', '_restoreLista'];
const FUENTE = NOMBRES.map(extraer).join('\n');
const CLAVE = 'thelab_oc_v1';
const DIA = 864e5;

// Dos navegadores con su propio almacenamiento y un reloj que podemos mover.
function mundo(inicio = 1750000000000) {
  let ahora = inicio;
  const FakeDate = { now: () => ahora };
  const abrir = () => {
    const mem = {};
    const ls = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
    };
    const api = new Function('localStorage', 'Date', `${FUENTE}\nreturn {${NOMBRES.join(',')}};`)(ls, FakeDate);
    // "Respaldar" es mandar el JSON crudo a Airtable; "restaurar" es fusionarlo.
    api.respaldar = () => JSON.parse(ls.getItem(CLAVE) || '[]');
    api.restaurar = (remoto) => api._restoreLista(CLAVE, remoto);
    api.guardar = (arr) => api._listaGuardar(CLAVE, arr);
    api.ver = () => api._listaVivos(CLAVE);
    return api;
  };
  return { abrir, avanzar: (ms) => { ahora += ms; } };
}

const oc = (id, numero, extra) => ({ id, numero, ts: 1, ...(extra || {}) });
const nums = (api) => api.ver().map((x) => x.numero).sort();

test('el caso que motivó todo: ninguna orden de compra se pierde', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();

  // Los dos parten con las mismas tres.
  const inicial = [oc('oc1', 'OC-001'), oc('oc2', 'OC-002'), oc('oc3', 'OC-003')];
  gustavo.guardar(inicial); nicanor.guardar(inicial);

  // Nicanor crea la 004 y respalda.
  m.avanzar(1000);
  nicanor.guardar([...nicanor.ver(), oc('oc4', 'OC-004')]);
  const remoto1 = nicanor.respaldar();

  // Gustavo, sin haber visto la 004, crea la 005 y guarda. Antes esto borraba la 004.
  m.avanzar(1000);
  gustavo.guardar([...gustavo.ver(), oc('oc5', 'OC-005')]);

  gustavo.restaurar(remoto1);
  assert.deepEqual(nums(gustavo), ['OC-001', 'OC-002', 'OC-003', 'OC-004', 'OC-005']);

  // Y al revés: Nicanor recibe la 005 de Gustavo.
  nicanor.restaurar(gustavo.respaldar());
  assert.deepEqual(nums(nicanor), ['OC-001', 'OC-002', 'OC-003', 'OC-004', 'OC-005']);
});

test('lo que se borra no revive desde el otro computador', () => {
  // Es el riesgo de fusionar sin más: la fusión ingenua resucita todo lo borrado.
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  const inicial = [oc('oc1', 'OC-001'), oc('oc2', 'OC-002')];
  gustavo.guardar(inicial); nicanor.guardar(inicial);

  m.avanzar(1000);
  gustavo.guardar(gustavo.ver().filter((x) => x.id !== 'oc2'));   // así borra el código real
  assert.deepEqual(nums(gustavo), ['OC-001']);

  // Nicanor todavía la tiene y respalda. Aun así no debe reaparecer en Gustavo.
  gustavo.restaurar(nicanor.respaldar());
  assert.deepEqual(nums(gustavo), ['OC-001'], 'la orden borrada volvió');

  // Y el borrado se propaga a Nicanor.
  nicanor.restaurar(gustavo.respaldar());
  assert.deepEqual(nums(nicanor), ['OC-001'], 'el borrado no llegó al otro equipo');
});

test('entre dos ediciones del mismo registro gana la más reciente', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar([oc('oc1', 'OC-001', { monto: 100 })]);
  nicanor.guardar([oc('oc1', 'OC-001', { monto: 100 })]);

  m.avanzar(1000);
  gustavo.guardar(gustavo.ver().map((x) => ({ ...x, monto: 200 })));
  m.avanzar(1000);
  nicanor.guardar(nicanor.ver().map((x) => ({ ...x, monto: 300 })));   // más nueva

  gustavo.restaurar(nicanor.respaldar());
  assert.equal(gustavo.ver()[0].monto, 300);

  // Y no al revés: la vieja no pisa a la nueva.
  nicanor.restaurar(gustavo.respaldar());
  assert.equal(nicanor.ver()[0].monto, 300);
});

test('guardar sin cambios no reescribe la fecha (no le gana a una edición ajena)', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar([oc('oc1', 'OC-001', { monto: 100 })]);
  nicanor.guardar([oc('oc1', 'OC-001', { monto: 100 })]);

  m.avanzar(1000);
  nicanor.guardar(nicanor.ver().map((x) => ({ ...x, monto: 999 })));   // edición real
  m.avanzar(1000);
  gustavo.guardar(gustavo.ver());                                      // guardado sin tocar nada

  gustavo.restaurar(nicanor.respaldar());
  assert.equal(gustavo.ver()[0].monto, 999, 'un guardado inocuo pisó la edición del otro');
});

test('las lápidas se limpian a los 60 días y no crecen para siempre', () => {
  const m = mundo();
  const g = m.abrir();
  g.guardar([oc('oc1', 'OC-001'), oc('oc2', 'OC-002')]);
  m.avanzar(1000);
  g.guardar(g.ver().filter((x) => x.id !== 'oc2'));
  assert.equal(g.respaldar().length, 2, 'la lápida viaja en el respaldo mientras esté vigente');

  m.avanzar(61 * DIA);
  g.guardar(g.ver());
  assert.equal(g.respaldar().length, 1, 'pasados los 60 días la lápida se descarta');
});

test('el resto del dashboard nunca ve una lápida', () => {
  const m = mundo();
  const g = m.abrir();
  g.guardar([oc('oc1', 'OC-001'), oc('oc2', 'OC-002')]);
  m.avanzar(1000);
  g.guardar(g.ver().filter((x) => x.id !== 'oc2'));
  assert.equal(g.ver().length, 1);
  assert.ok(g.ver().every((x) => !x.del), 'los borrados no pueden llegar a la interfaz');
});

test('un registro sin id no se pierde al fusionar', () => {
  const m = mundo();
  const g = m.abrir();
  g.guardar([{ numero: 'OC-VIEJA' }, oc('oc1', 'OC-001')]);
  g.restaurar([oc('oc2', 'OC-002')]);
  assert.deepEqual(nums(g), ['OC-001', 'OC-002', 'OC-VIEJA']);
});

test('los cinco módulos compartidos fusionan en vez de reemplazar', () => {
  for (const clave of ['thelab_oc_v1', 'thelab_retainers_v1', 'thelab_reclamos_v1', 'thelab_catalogo_v1', 'thelab_precios_prov_v1']) {
    assert.match(HTML, new RegExp(`_restoreLista\\('${clave}'`), `${clave} debe fusionarse`);
    assert.doesNotMatch(HTML, new RegExp(`_restoreShared\\('${clave}'`), `${clave} sigue reemplazando`);
  }
  // Y sus lectores/escritores deben pasar por los helpers, o las lápidas se escapan.
  for (const par of [['_catalogo', '_CATALOGO_KEY'], ['_reclamos', '_RECLAMOS_KEY'], ['_retainers', '_RETAINERS_KEY']]) {
    assert.match(HTML, new RegExp(`function ${par[0]}\\(\\)\\{return _listaVivos\\(${par[1]}\\);\\}`), `${par[0]} debe filtrar lápidas`);
  }
  const prov = fs.readFileSync(path.join(__dirname, '..', 'js', 'proveedores.js'), 'utf8');
  assert.match(prov, /function _ocAll\(\)\{return _listaVivos\(_OC_KEY\);\}/);
  assert.match(prov, /function _preciosProv\(\)\{return _listaVivos\(_PRECIOS_PROV_KEY\);\}/);
});

test('el id del catálogo no se puede repetir entre computadores', () => {
  // Era 'cat'+posición+'_'+largo del nombre+'_'+precio: dos equipos agregando su
  // tercer producto podían generar el mismo id y pisarse al fusionar.
  const i = HTML.indexOf("arr.push({id:'cat");
  assert.ok(i > 0, 'debe seguir existiendo el alta de catálogo');
  assert.match(HTML.slice(i, i + 120), /id:'cat'\+Date\.now\(\)/, 'el id debe llevar la hora');
});
