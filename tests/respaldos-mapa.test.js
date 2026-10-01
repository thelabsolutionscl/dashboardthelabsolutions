#!/usr/bin/env node
/*
 * Respaldos con forma de mapa {clave: valor} entre computadores.
 *
 * Son los cuatro que quedaban: descuentos por cliente, fechas clave (cumpleaños),
 * onboarding y cronómetros de producción. Se respaldaban en 'Monitor Sistema' y
 * se restauraban REEMPLAZANDO, así que el último en guardar pisaba lo del otro
 * equipo. A diferencia de las listas, aquí no se pierde un registro entero sino
 * el valor de un cliente — un descuento que pusiste, y sin rastro.
 *
 * Lo delicado es el borrado: quitar un descuento o un cumpleaños tiene que
 * propagarse al otro computador, no revivir en la siguiente sincronización. Un
 * descuento resucitado se aplica solo a la próxima cotización.
 *
 * Correr:  node --test tests/respaldos-mapa.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const CLAVE = 'thelab_desc_cliente_v1';
const DIA = 864e5;

const FUENTE = (() => {
  const i = HTML.indexOf('function _mapaCrudo');
  const j = HTML.indexOf('\n}', HTML.indexOf('function _restoreMapa')) + 2;
  assert.ok(i > 0 && j > i, 'deben existir los helpers de mapa');
  return HTML.slice(i, j);
})();

// Dos computadores con su propio almacenamiento y un reloj que podemos mover.
function mundo(inicio = 1750000000000) {
  let ahora = inicio;
  const FakeDate = function () { return new Date(ahora); };
  FakeDate.now = () => ahora;
  const abrir = () => {
    const mem = {};
    const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
    const api = new Function('localStorage', 'Date',
      `${FUENTE}\nreturn {_mapaCrudo,_mapaSellos,_mapaGuardar,_mapaPayload,_restoreMapa};`)(ls, FakeDate);
    api.guardar = (o) => api._mapaGuardar(CLAVE, o);
    api.ver = () => api._mapaCrudo(CLAVE);
    api.respaldar = () => JSON.parse(api._mapaPayload(CLAVE));
    api.restaurar = (r) => api._restoreMapa(CLAVE, r);
    return api;
  };
  return { abrir, avanzar: (ms) => { ahora += ms; } };
}

test('cada uno pone un descuento distinto y sobreviven los dos', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar({ recA: 10 });
  m.avanzar(1000);
  nicanor.guardar({ recB: 15 });

  gustavo.restaurar(nicanor.respaldar());
  assert.deepEqual(gustavo.ver(), { recA: 10, recB: 15 }, 'antes el último en guardar borraba al otro');
  nicanor.restaurar(gustavo.respaldar());
  assert.deepEqual(nicanor.ver(), { recA: 10, recB: 15 });
});

test('un descuento quitado no revive desde el otro computador', () => {
  // Es lo que hace peligrosa la fusión ingenua: el descuento vuelve solo y se
  // aplica a la siguiente cotización de ese cliente.
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar({ recA: 10, recB: 15 });
  nicanor.guardar({ recA: 10, recB: 15 });

  m.avanzar(1000);
  gustavo.guardar({ recB: 15 });                      // así lo quita el código real
  assert.deepEqual(gustavo.ver(), { recB: 15 });

  gustavo.restaurar(nicanor.respaldar());
  assert.deepEqual(gustavo.ver(), { recB: 15 }, 'el descuento borrado volvió');

  nicanor.restaurar(gustavo.respaldar());
  assert.deepEqual(nicanor.ver(), { recB: 15 }, 'el borrado no llegó al otro equipo');
});

test('entre dos cambios del mismo cliente gana el más reciente', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar({ recA: 10 }); nicanor.guardar({ recA: 10 });
  m.avanzar(1000); gustavo.guardar({ recA: 20 });
  m.avanzar(1000); nicanor.guardar({ recA: 30 });      // más nuevo

  gustavo.restaurar(nicanor.respaldar());
  assert.equal(gustavo.ver().recA, 30);
  nicanor.restaurar(gustavo.respaldar());
  assert.equal(nicanor.ver().recA, 30, 'lo viejo no puede pisar lo nuevo');
});

test('guardar sin cambiar nada no le gana a la edición del otro', () => {
  const m = mundo();
  const gustavo = m.abrir(), nicanor = m.abrir();
  gustavo.guardar({ recA: 10 }); nicanor.guardar({ recA: 10 });
  m.avanzar(1000); nicanor.guardar({ recA: 99 });       // edición real
  m.avanzar(1000); gustavo.guardar(gustavo.ver());       // abrir y cerrar sin tocar

  gustavo.restaurar(nicanor.respaldar());
  assert.equal(gustavo.ver().recA, 99, 'un guardado inocuo pisó la edición del otro');
});

test('los datos de antes de este cambio no se pierden al migrar', () => {
  // La primera sincronización tras el despliegue: ninguno de los dos lados tiene
  // sellos todavía.
  const m = mundo();
  const g = m.abrir();
  assert.equal(Object.keys(g._mapaSellos(CLAVE)).length, 0);
  g.restaurar({ recViejo: 12, recOtro: 8 });
  assert.deepEqual(g.ver(), { recViejo: 12, recOtro: 8 }, 'lo remoto se conserva');
});

test('las lápidas se limpian a los 60 días', () => {
  const m = mundo();
  const g = m.abrir();
  g.guardar({ recA: 10 });
  m.avanzar(1000);
  g.guardar({});                                        // borra recA
  assert.ok(g.respaldar().__mts.recA < 0, 'queda la lápida mientras esté vigente');
  m.avanzar(61 * DIA);
  g.guardar(g.ver());
  assert.ok(!('recA' in (g.respaldar().__mts || {})), 'pasados los 60 días se descarta');
});

test('los sellos viajan en el respaldo sin ensuciar el mapa', () => {
  const m = mundo();
  const g = m.abrir();
  g.guardar({ recA: 10 });
  assert.ok(!('__mts' in g.ver()), 'el mapa que lee el dashboard queda limpio');
  const r = g.respaldar();
  assert.equal(r.recA, 10);
  assert.ok(r.__mts && r.__mts.recA > 0, 'y el respaldo sí los lleva');
  // «__mts» no puede chocar con una clave real: todas son ids de Airtable.
  assert.ok(Object.keys(g.ver()).every((k) => /^rec/.test(k)));
});

test('los cuatro módulos fusionan en vez de reemplazar', () => {
  for (const clave of ['thelab_desc_cliente_v1', 'thelab_fechas_cliente_v1', 'thelab_onboarding_v1', 'thelab_prod_timer_v1']) {
    assert.match(HTML, new RegExp(`_restoreMapa\\('${clave}'`), `${clave} debe fusionarse`);
    assert.doesNotMatch(HTML, new RegExp(`_restoreShared\\('${clave}'`), `${clave} sigue reemplazando`);
  }
  // Y sus escrituras tienen que sellar, o la fusión no sabría qué es más nuevo.
  for (const K of ['_DESC_CLIENTE_KEY', '_FECHAS_CLI_KEY', '_ONBOARDING_KEY', '_PROD_TIMER_KEY']) {
    assert.match(HTML, new RegExp(`_mapaGuardar\\(${K},`), `${K} debe guardarse sellado`);
    assert.doesNotMatch(HTML, new RegExp(`localStorage\\.setItem\\(${K},`), `${K} no puede escribirse a pelo`);
    assert.match(HTML, new RegExp(`_mapaPayload\\(${K}\\)`), `${K} debe respaldar también sus sellos`);
  }
});
