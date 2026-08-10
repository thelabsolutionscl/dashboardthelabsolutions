#!/usr/bin/env node
/*
 * Newsletter: el "no reenviar" tiene que impedir de verdad el doble envío.
 *
 * El newsletter se manda directo por MAIL.post (no pasa por Make). El dedup
 * anti-doble-envío (_nlRecentRecipients) leía SOLO de la tabla Newsletter_Envios,
 * que puebla Make — pero como el envío del dashboard no pasa por Make, esa tabla
 * no se entera de los correos salidos. Resultado: marcar "no reenviar" filtraba
 * contra un conjunto vacío y los clientes recibían la campaña otra vez, con la
 * interfaz asegurando que no.
 *
 * El arreglo: el dashboard registra localmente a quién le envió, y el dedup une
 * ese registro con lo de Make. Cualquiera de las dos fuentes cuenta.
 *
 * Correr:  node --test tests/newsletter.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REDES = fs.readFileSync(path.join(__dirname, '..', 'js', 'redes.js'), 'utf8');

function bloque(marca) {
  const i = REDES.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = REDES.indexOf('{', i); x < REDES.length; x++) {
    if (REDES[x] === '{') d++;
    if (REDES[x] === '}') { d--; if (!d) return REDES.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// Monta el dedup real sobre un localStorage y un state simulados.
function montar({ nlEnvios = [], reloj = Date.now() } = {}) {
  const store = {};
  const ctx = {
    state: { nlEnvios },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [reloj])); } static now() { return reloj; } static parse(s) { return Date.parse(s); } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  };
  const piezas = [
    "const _NL_SENT_LOG_KEY='thelab_nl_sent_log_v1';",
    bloque('function _nlSentLog('),
    bloque('function _nlRecordSent('),
    bloque('function _nlRecentRecipients('),
  ].join('\n');
  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, `${piezas}\nreturn {_nlSentLog,_nlRecordSent,_nlRecentRecipients};`)(...nombres.map((n) => ctx[n]));
  return { api, store };
}

const envio = (email, fecha) => ({ fields: { Email: email, 'Fecha envío': fecha } });

// ── El dedup ya no depende solo de Make ─────────────────────────────────

test('un envío del dashboard queda registrado para el próximo dedup', () => {
  const m = montar();
  m.api._nlRecordSent(['Ana@Cliente.cl', 'beto@cliente.cl']);
  const recientes = m.api._nlRecentRecipients(14);
  assert.ok(recientes.has('ana@cliente.cl'), 'normaliza a minúsculas');
  assert.ok(recientes.has('beto@cliente.cl'));
  // Se guarda ya en minúsculas (no solo al comparar): el registro es la fuente
  // de verdad y cualquier otro lector lo encuentra normalizado.
  assert.ok(m.api._nlSentLog().some((x) => x.email === 'ana@cliente.cl'), 'el log guarda minúsculas');
  assert.ok(!m.api._nlSentLog().some((x) => x.email === 'Ana@Cliente.cl'), 'nunca la forma con mayúsculas');
});

test('lo enviado hace poco se excluye; lo viejo ya no', () => {
  const ahora = Date.parse('2026-08-10T12:00:00Z');
  const m = montar({ reloj: ahora });
  // Se registra "hace 20 días" manipulando el log directamente.
  m.store['thelab_nl_sent_log_v1'] = JSON.stringify([
    { email: 'viejo@cliente.cl', ts: ahora - 20 * 864e5 },
    { email: 'nuevo@cliente.cl', ts: ahora - 3 * 864e5 },
  ]);
  const v14 = m.api._nlRecentRecipients(14);
  assert.ok(v14.has('nuevo@cliente.cl'), 'el de hace 3 días sí');
  assert.ok(!v14.has('viejo@cliente.cl'), 'el de hace 20 días no entra en la ventana de 14');
  const v30 = m.api._nlRecentRecipients(30);
  assert.ok(v30.has('viejo@cliente.cl'), 'con ventana de 30 sí');
});

test('une el registro local con lo que puso Make', () => {
  const ahora = Date.parse('2026-08-10T12:00:00Z');
  const m = montar({ reloj: ahora, nlEnvios: [envio('make@cliente.cl', '2026-08-09')] });
  m.api._nlRecordSent(['local@cliente.cl']);
  const r = m.api._nlRecentRecipients(14);
  assert.ok(r.has('make@cliente.cl'), 'lo de Make cuenta');
  assert.ok(r.has('local@cliente.cl'), 'y lo local también');
});

test('sin registro local, seguir leyendo Make no rompe nada', () => {
  const ahora = Date.parse('2026-08-10T12:00:00Z');
  const m = montar({ reloj: ahora, nlEnvios: [envio('solo-make@cliente.cl', '2026-08-08')] });
  const r = m.api._nlRecentRecipients(14);
  assert.ok(r.has('solo-make@cliente.cl'));
  assert.equal(r.size, 1);
});

test('el registro no crece sin control ni guarda basura', () => {
  const m = montar();
  m.api._nlRecordSent([]);            // nada que registrar
  assert.equal(m.api._nlSentLog().length, 0);
  m.api._nlRecordSent(['', null, undefined, 'ok@cliente.cl']);
  assert.equal(m.api._nlSentLog().length, 1, 'los vacíos no se guardan');
  assert.equal(m.api._nlSentLog()[0].email, 'ok@cliente.cl');
});

test('las entradas de más de 60 días se podan al registrar', () => {
  const ahora = Date.parse('2026-08-10T12:00:00Z');
  const m = montar({ reloj: ahora });
  m.store['thelab_nl_sent_log_v1'] = JSON.stringify([{ email: 'antiguo@cliente.cl', ts: ahora - 70 * 864e5 }]);
  m.api._nlRecordSent(['fresco@cliente.cl']);
  const log = m.api._nlSentLog();
  assert.ok(log.some((x) => x.email === 'fresco@cliente.cl'));
  assert.ok(!log.some((x) => x.email === 'antiguo@cliente.cl'), 'el de 70 días se podó');
});

// ── El envío registra, la prueba no ─────────────────────────────────────

test('nlDestSend registra a quién le llegó', () => {
  const fn = bloque('async function nlDestSend(');
  assert.match(fn, /const enviados=\[\]/);
  assert.match(fn, /enviados\.push\(list\[i\]\.email\)/, 'solo los que salieron OK');
  assert.match(fn, /_nlRecordSent\(enviados\)/);
  // El push va dentro de la rama de éxito, no en el fallo.
  assert.match(fn, /if\(r&&!r\.error\)\{ok\+\+;enviados\.push/);
});

test('el envío de PRUEBA no ensucia el registro', () => {
  // Un test no puede excluir a ese correo del envío real.
  const fn = bloque('async function nlSendTest(');
  assert.doesNotMatch(fn, /_nlRecordSent/, 'la prueba no registra');
});

test('el dedup se aplica en la lista de trabajo cuando "no reenviar" está activo', () => {
  const fn = bloque('function _nlDestWorking(');
  assert.match(fn, /if\(_nlDest\.noResend\)\{/, 'solo si el usuario lo pidió');
  assert.match(fn, /_nlRecentRecipients\(14\)/, 'ventana de 14 días');
  assert.match(fn, /list=list\.filter\(x=>!recent\.has\(String\(x\.email\|\|''\)\.toLowerCase\(\)\)\)/);
});

test('el registro une ambas fuentes en el código, no solo en Make', () => {
  const fn = bloque('function _nlRecentRecipients(');
  assert.match(fn, /state\.nlEnvios/, 'sigue leyendo lo de Make');
  assert.match(fn, /_nlSentLog\(\)\.forEach/, 'y además el registro local');
});
