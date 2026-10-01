#!/usr/bin/env node
/*
 * La fecha del día tiene que ser la de Chile, no la de UTC.
 *
 * new Date().toISOString() devuelve UTC y Chile va UTC-4 (UTC-3 en verano): todo
 * lo hecho después de las 20:00 quedaba estampado con la fecha del día
 * siguiente. Un pedido despachado el 31 a las 21:00 se guardaba con fecha del 1
 * del mes siguiente, y su comisión se contaba en el mes equivocado.
 *
 * El lead-worker ya usaba el criterio correcto; el dashboard se había quedado
 * con la hora UTC en 63 sitios.
 *
 * Correr:  node --test tests/fechas-chile.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');
const JS = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));

function extraer(src, nombre) {
  const cab = new RegExp(`function\\s+${nombre}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  assert.ok(cab, `debe existir ${nombre}`);
  const abre = src.indexOf('{', cab.index);
  let d = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === '{') d++;
    if (src[i] === '}') { d--; if (d === 0) return src.slice(cab.index, i + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

// Monta hoyCL() con un reloj detenido en el instante que se le diga.
function hoyCLen(iso) {
  const fijo = new Date(iso);
  const FakeDate = function () { return new Date(fijo); };
  FakeDate.now = () => fijo.getTime();
  return new Function('Date', 'Intl', `${extraer(HTML, 'hoyCL')}\nreturn hoyCL;`)(FakeDate, Intl)();
}
const utcDe = (iso) => new Date(iso).toISOString().slice(0, 10);

test('a las 21:00 del 31, la fecha sigue siendo el 31', () => {
  // 31-08-2026 21:00 en Chile (UTC-4) = 01-09-2026 01:00 UTC. Es el caso que
  // descuadraba el mes: el pedido se despacha en agosto y la comisión se
  // contaba en septiembre.
  const instante = '2026-09-01T01:00:00Z';
  assert.equal(utcDe(instante), '2026-09-01', 'así se guardaba antes');
  assert.equal(hoyCLen(instante), '2026-08-31', 'y así corresponde');
});

test('también en verano, con el otro huso', () => {
  // En enero Chile va UTC-3: 15-01 a las 22:30 = 16-01 01:30 UTC.
  const instante = '2026-01-16T01:30:00Z';
  assert.equal(utcDe(instante), '2026-01-16');
  assert.equal(hoyCLen(instante), '2026-01-15');
});

test('durante la jornada normal no cambia nada', () => {
  const instante = '2026-08-07T13:00:00Z';   // 09:00 en Chile
  assert.equal(hoyCLen(instante), '2026-08-07');
  assert.equal(utcDe(instante), '2026-08-07');
});

test('si el navegador no soporta husos, cae a la fecha local y no revienta', () => {
  const fijo = new Date('2026-09-01T01:00:00Z');
  const FakeDate = function () { return new Date(fijo); };
  FakeDate.now = () => fijo.getTime();
  const IntlRoto = { DateTimeFormat() { throw new Error('sin ICU'); } };
  const fn = new Function('Date', 'Intl', `${extraer(HTML, 'hoyCL')}\nreturn hoyCL;`)(FakeDate, IntlRoto);
  assert.match(fn(), /^\d{4}-\d{2}-\d{2}$/, 'debe devolver una fecha igual, no fallar');
});

test('ningún sitio del dashboard vuelve a usar la fecha UTC como "hoy"', () => {
  const fuentes = [['index.html', HTML], ...JS.map((f) => ['js/' + f, fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')])];
  const malos = [];
  for (const [rel, src] of fuentes) {
    const re = /new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*(?:slice\(0,\s*10\)|substring\(0,\s*10\)|split\('T'\)\[0\])/g;
    let m;
    while ((m = re.exec(src))) malos.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(malos, [], `Usan la fecha UTC como hoy:\n  ${malos.join('\n  ')}`);
});

test('fmtDate lee el calendario local, no el UTC', () => {
  // Es lo que marca "hoy" en las grillas de máquinas y de equipo: con UTC, a
  // partir de las 20:00 la columna resaltada era la de mañana.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'maquinas.js'), 'utf8');
  const fn = extraer(src, 'fmtDate');
  assert.doesNotMatch(fn, /toISOString/, 'fmtDate no puede formatear en UTC');
  const fmtDate = new Function(`${fn}\nreturn fmtDate;`)();
  // Fecha construida con componentes locales: debe volver igual en cualquier huso.
  assert.equal(fmtDate(new Date(2026, 7, 31, 23, 30)), '2026-08-31');
  assert.equal(fmtDate(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('el worker fecha con la hora de Chile en todo lo que es un día de trabajo', () => {
  assert.match(WORKER, /timeZone:\s*"America\/Santiago"/, 'debe existir el helper con huso de Chile');
  // El documento del portal y el tope diario usaban UTC pese a tener el helper.
  assert.match(WORKER, /f\["Fecha cotización"\]\s*\|\|\s*today\(\)/, 'la cotización del portal debe fecharse con today()');
  assert.match(WORKER, /`autoproc:\$\{today\(\)\}`/, 'el tope diario debe contar por el día de Chile');
  // Solo puede quedar UTC donde se formatea un instante ya conocido (vencimiento
  // del token) y dentro del propio fallback del helper.
  const sueltos = [...WORKER.matchAll(/new Date\(\)\.toISOString\(\)\.(?:slice\(0, ?10\)|split\("T"\)\[0\])/g)]
    .map((m) => WORKER.slice(0, m.index).split('\n').length)
    .filter((linea) => !/catch \(_\) \{ return new Date/.test(WORKER.split('\n')[linea - 1]));
  assert.deepEqual(sueltos, [], `El worker usa UTC como hoy en las líneas: ${sueltos.join(', ')}`);
});
