#!/usr/bin/env node
/*
 * Lo que el dashboard pide a Airtable al arrancar.
 *
 * Medido en navegador real interceptando fetch: eran 18 peticiones, y solo 9
 * traían datos. Las otras 9 eran metadatos, con dos problemas:
 *
 *   · ensureCotizacionFields disparaba 7 POST de creación de campos SIN mirar si
 *     ya existían. Los 7 fallaban con "ya existe" y el error se tragaba en
 *     silencio, en cada carga del dashboard, desde siempre.
 *   · Cada ensure*() pedía el esquema completo de la base por su cuenta, y como
 *     se lanzan a la vez, ninguna alcanzaba a aprovechar la lectura de la otra.
 *
 * Airtable admite 5 peticiones por segundo por base: esas 8 de más competían
 * con la carga de datos que el usuario está esperando. Ahora son 10 en total,
 * con una sola lectura de esquema y cero POST cuando ya está todo creado.
 *
 * Correr:  node --test tests/arranque.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AGENTES = fs.readFileSync(path.join(ROOT, 'js', 'agentes.js'), 'utf8');

function trozo(src, desde, hasta) {
  const i = src.indexOf(desde);
  assert.ok(i > 0, `debe existir ${desde}`);
  const j = src.indexOf(hasta, i + desde.length);
  return src.slice(i, j > 0 ? j : i + 3000);
}

// Monta el lector de esquema con un Airtable de mentira que cuenta peticiones.
function montar(tablas) {
  const fuente = trozo(HTML, 'let _esquemaCache=null', 'async function ensureCotizacionFields');
  const llamadas = [];
  const _atFetch = async (url, opts) => {
    llamadas.push({ url, m: (opts && opts.method) || 'GET' });
    if (/\/tables$/.test(url)) {
      return { ok: true, json: async () => ({ tables: tablas }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  const api = new Function('_atFetch', 'BASE_ID', 'console',
    `${fuente}\nreturn {_esquemaBase,_crearCamposFaltantes};`)(_atFetch, 'appTEST', { warn() {} });
  return { ...api, llamadas };
}

const CON = [{ id: 'tblCot', name: 'Cotizaciones', fields: [{ name: 'Detalle JSON' }, { name: 'Fecha de entrega' }] }];

test('tres arranques simultáneos leen el esquema UNA vez', () => {
  // Es el caso real: los ensure*() se lanzan juntos al cargar la página. Si solo
  // se cacheara el resultado y no la petición en vuelo, las tres saldrían a la
  // red antes de que ninguna alcanzara a guardar nada.
  const m = montar(CON);
  return Promise.all([m._esquemaBase(), m._esquemaBase(), m._esquemaBase()]).then((r) => {
    assert.equal(m.llamadas.length, 1, `salieron ${m.llamadas.length} lecturas de esquema, debía ser 1`);
    assert.ok(r.every((x) => x && x.tables), 'las tres reciben el esquema igual');
  });
});

test('si los campos ya existen no se pide crear nada', async () => {
  // Antes salían 7 POST condenados al fracaso en cada carga.
  const m = montar(CON);
  const creados = await m._crearCamposFaltantes('Cotizaciones', [{ name: 'Detalle JSON' }, { name: 'Fecha de entrega' }]);
  assert.equal(creados, 0);
  assert.equal(m.llamadas.filter((c) => c.m === 'POST').length, 0, 'ni un POST');
  assert.equal(m.llamadas.length, 1, 'solo la lectura del esquema');
});

test('se crea únicamente lo que falta', async () => {
  const m = montar(CON);
  const creados = await m._crearCamposFaltantes('Cotizaciones',
    [{ name: 'Detalle JSON' }, { name: 'Campo nuevo' }, { name: 'Otro nuevo' }]);
  assert.equal(creados, 2);
  const posts = m.llamadas.filter((c) => c.m === 'POST');
  assert.equal(posts.length, 2, 'un POST por campo que falta, ni uno más');
  assert.ok(posts.every((p) => p.url.includes('/tables/tblCot/fields')), 'sobre la tabla correcta');
});

test('tras crear un campo, la caché se descarta', async () => {
  // Si no, el resto de la sesión seguiría creyendo que el campo no existe.
  const m = montar(CON);
  await m._crearCamposFaltantes('Cotizaciones', [{ name: 'Campo nuevo' }]);
  await m._esquemaBase();
  assert.equal(m.llamadas.filter((c) => c.m === 'GET').length, 2, 'debe releerse el esquema');
});

test('una tabla que no existe no revienta ni inventa peticiones', async () => {
  const m = montar(CON);
  assert.equal(await m._crearCamposFaltantes('NoExiste', [{ name: 'x' }]), 0);
  assert.equal(m.llamadas.filter((c) => c.m === 'POST').length, 0);
});

test('si el esquema no se puede leer, no se crea nada a ciegas', async () => {
  const fuente = trozo(HTML, 'let _esquemaCache=null', 'async function ensureCotizacionFields');
  const llamadas = [];
  const _atFetch = async (url, opts) => { llamadas.push((opts && opts.method) || 'GET'); return { ok: false }; };
  const api = new Function('_atFetch', 'BASE_ID', 'console',
    `${fuente}\nreturn {_crearCamposFaltantes};`)(_atFetch, 'appTEST', { warn() {} });
  assert.equal(await api._crearCamposFaltantes('Cotizaciones', [{ name: 'x' }]), 0);
  assert.ok(!llamadas.includes('POST'), 'sin esquema no se dispara ningún POST');
});

test('ninguna de las funciones del arranque crea campos a ciegas', () => {
  // Las tres que corren al cargar la página, más la de los agentes.
  for (const [src, nombre] of [[HTML, 'ensureCotizacionFields'], [HTML, 'ensureFichaTecnicaField'],
                               [HTML, 'ensureFichaPropuestaField'], [AGENTES, 'ensureClienteReactivadoFields']]) {
    const fn = trozo(src, `async function ${nombre}(`, '\nasync function ');
    assert.match(fn, /_crearCamposFaltantes\(/, `${nombre} debe pasar por la comprobación`);
    assert.doesNotMatch(fn, /method:'POST'/, `${nombre} no puede crear campos por su cuenta`);
    assert.doesNotMatch(fn, /\/meta\/bases\/\$\{BASE_ID\}\/tables`/, `${nombre} no debe releer el esquema aparte`);
  }
});
