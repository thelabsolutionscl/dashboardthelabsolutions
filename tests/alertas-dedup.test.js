#!/usr/bin/env node
/*
 * Campana de alertas: la deduplicación no puede re-notificar en cada recarga.
 *
 * syncAlertas recuerda en localStorage (_alertKeysKey) qué alertas ya avisó, y
 * solo notifica las nuevas. Las críticas (sev 3) además disparan un WhatsApp al
 * equipo. El problema: al recargar la página, esa memoria persiste de la sesión
 * anterior, pero el estado arranca vacío; si renderAlertas corre antes de que
 * loadAllData termine, syncAlertas recibe [] y —tomándolo como "se resolvió
 * todo"— sobreescribía la memoria con el vacío. En la siguiente pasada, ya con
 * datos, TODAS las alertas se re-notificaban de nuevo, con un WhatsApp por cada
 * crítica. Una lista vacía con los datos aún sin cargar es transitoria, no un
 * cierre real.
 *
 * Se monta el syncAlertas REAL sobre un localStorage y un state simulados.
 *
 * Correr:  node --test tests/alertas-dedup.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const NOTIFY_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'notify.js'), 'utf8');

// Extrae el método syncAlertas del objeto NOTIFY (del '{' de la firma al '}').
function metodo(nombre) {
  const i = NOTIFY_SRC.indexOf(nombre);
  assert.ok(i > 0, `debe existir ${nombre}`);
  const ini = NOTIFY_SRC.indexOf('{', NOTIFY_SRC.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < NOTIFY_SRC.length; x++) {
    if (NOTIFY_SRC[x] === '{') d++;
    if (NOTIFY_SRC[x] === '}') { d--; if (!d) return NOTIFY_SRC.slice(ini, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

// Monta un NOTIFY mínimo con el syncAlertas real y el entorno simulado.
function montar({ loaded = true, known = [] } = {}) {
  const store = { thelab_alert_keys_v1: JSON.stringify(known) };
  const añadidas = [];   // alertas que pasaron a this.add
  const whatsapps = [];
  const toasts = [];
  const ctx = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    state: { loaded },
    toast: (m) => toasts.push(String(m)),
  };
  const cuerpo = metodo('syncAlertas(alertas)');
  const NOTIFY = {
    _alertKeysKey: 'thelab_alert_keys_v1',
    add(type, title, sub, tab, opts) { añadidas.push({ title, sub, key: opts && opts.key }); },
    _sendWhatsApp(msg) { whatsapps.push(String(msg)); },
  };
  // Inyecta el método real, con localStorage/state/toast como globals del closure.
  NOTIFY.syncAlertas = new Function('localStorage', 'state', 'toast',
    `return function syncAlertas(alertas)${cuerpo};`)(ctx.localStorage, ctx.state, ctx.toast);
  return { NOTIFY, store, añadidas, whatsapps, toasts, state: ctx.state };
}

const A = (type, id, sev) => ({ type, id, sev, msg: `${type} ${id}`, tab: 'overview' });
const keysGuardadas = (m) => JSON.parse(m.store.thelab_alert_keys_v1 || '[]');

// ── La memoria de dedup ─────────────────────────────────────────────────

test('la primera vez notifica cada alerta una sola vez', () => {
  const m = montar({ loaded: true });
  m.NOTIFY.syncAlertas([A('pedido-atrasado', 'p1', 2), A('factura-vencida', 'c1', 3)]);
  assert.equal(m.añadidas.length, 2);
  assert.equal(m.whatsapps.length, 1, 'solo la crítica manda WhatsApp');
  assert.deepEqual(keysGuardadas(m).sort(), ['factura-vencida:c1', 'pedido-atrasado:p1']);
});

test('las mismas alertas en la siguiente pasada no se re-notifican', () => {
  const m = montar({ loaded: true, known: ['pedido-atrasado:p1', 'factura-vencida:c1'] });
  m.NOTIFY.syncAlertas([A('pedido-atrasado', 'p1', 2), A('factura-vencida', 'c1', 3)]);
  assert.equal(m.añadidas.length, 0, 'ya se avisaron');
  assert.equal(m.whatsapps.length, 0, 'y no se repite el WhatsApp');
});

// ── El corazón del arreglo ──────────────────────────────────────────────

test('una lista vacía con los datos AÚN sin cargar no borra la memoria', () => {
  // Recarga de página: known persiste de antes, el estado arranca vacío.
  const m = montar({ loaded: false, known: ['pedido-atrasado:p1', 'factura-vencida:c1'] });
  m.NOTIFY.syncAlertas([]);
  assert.deepEqual(keysGuardadas(m).sort(), ['factura-vencida:c1', 'pedido-atrasado:p1'], 'la memoria queda intacta');
  assert.equal(m.añadidas.length, 0);
});

test('sin el arreglo habría tormenta: vacío-transitorio y luego re-notifica todo', () => {
  // Simula la secuencia real: (1) recarga → render con estado vacío → [];
  //                           (2) loadAllData termina → las alertas vuelven.
  const m = montar({ loaded: false, known: ['pedido-atrasado:p1', 'factura-vencida:c1', 'cot-vencida:q1'] });
  m.NOTIFY.syncAlertas([]);                              // (1) transitorio: NO debe borrar
  m.state.loaded = true;                          // (2) ya cargó
  m.NOTIFY.syncAlertas([A('pedido-atrasado', 'p1', 2), A('factura-vencida', 'c1', 3), A('cot-vencida', 'q1', 3)]);
  assert.equal(m.añadidas.length, 0, 'nada se re-notifica: ya estaban en memoria');
  assert.equal(m.whatsapps.length, 0, 'y CERO WhatsApp de repetición');
});

test('con los datos cargados, una lista vacía sí es cierre real y limpia la memoria', () => {
  const m = montar({ loaded: true, known: ['pedido-atrasado:p1'] });
  m.NOTIFY.syncAlertas([]);
  assert.deepEqual(keysGuardadas(m), [], 'se resolvieron de verdad → memoria limpia');
});

test('tras un cierre real, si la alerta vuelve, se re-notifica', () => {
  const m = montar({ loaded: true, known: ['pedido-atrasado:p1'] });
  m.NOTIFY.syncAlertas([]);                              // se resolvió
  m.NOTIFY.syncAlertas([A('pedido-atrasado', 'p1', 2)]); // reaparece
  assert.equal(m.añadidas.length, 1, 'vuelve a avisar');
});

// ── Un cierre PARCIAL sigue podando bien ────────────────────────────────

test('resolver una de varias poda solo esa y permite su re-aviso futuro', () => {
  const m = montar({ loaded: true, known: ['a:1', 'b:2', 'c:3'] });
  m.NOTIFY.syncAlertas([A('b', '2', 2)]);   // solo b sigue activa
  assert.deepEqual(keysGuardadas(m), ['b:2'], 'a y c se podan; b se conserva');
  assert.equal(m.añadidas.length, 0, 'b ya estaba avisada');
  // 'a' reaparece → debe re-notificar (fue podada)
  m.NOTIFY.syncAlertas([A('a', '1', 3), A('b', '2', 2)]);
  assert.equal(m.añadidas.length, 1);
  assert.equal(m.añadidas[0].key, 'a:1');
});

// ── El código lo dice ───────────────────────────────────────────────────

test('el guard contra el vacío-transitorio está en el código', () => {
  const fn = metodo('syncAlertas(alertas)');
  assert.match(fn, /if\(!alertas\.length && !\(typeof state!=='undefined'&&state\.loaded\)\) return;/);
});
