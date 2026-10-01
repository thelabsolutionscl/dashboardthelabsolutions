#!/usr/bin/env node
/*
 * Máquinas — cola de impresión: un fallo de subida no puede perder el trabajo.
 *
 * _queueStartNext (auto-inicia el siguiente encolado cuando una impresora queda
 * libre) hacía `q.shift()` ANTES de subir el archivo. Si la subida fallaba —la
 * impresora recién terminó y está ocupada un instante— el trabajo salía de la
 * cola y se PERDÍA, y como el disparo es por-transición no se reintentaba. Ahora
 * el trabajo solo se saca de la cola tras una subida exitosa; ante fallo queda en
 * la cola y se reintenta unas veces.
 *
 * Se monta el _queueStartNext REAL con un XMLHttpRequest simulado.
 *
 * Correr:  node --test tests/maquinas-cola.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'maquinas.js'), 'utf8');

function extract(nombre) {
  let i = SRC.indexOf('async function ' + nombre + '(');
  if (i < 0) i = SRC.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = SRC.indexOf('{', SRC.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < SRC.length; x++) {
    if (SRC[x] === '{') d++;
    if (SRC[x] === '}') { d--; if (!d) return SRC.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const BODY = extract('_queueStartNext');

// XHR simulado: llama onload/onerror SINCRÓNICO dentro de send().
const xhrOK  = function () { this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => { this.status = 200; this.onload && this.onload(); }; };
const xhrFail = function () { this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => { this.status = 500; this.onload && this.onload(); }; };
const xhrErr = function () { this.open = () => {}; this.setRequestHeader = () => {}; this.send = () => { this.onerror && this.onerror(); }; };

function montar({ queue, ip = '10.0.0.5', xhr, startOk=true }) {
  const toasts = [], scheduled = [], fetches = [];
  const deps = {
    _printQueue: queue,
    MAQUINAS: [{ id: 'p1', nombre: 'K1', numG: 1 }],
    getPrinterIp: () => ip,
    printerUrl: (i, p) => 'http://' + i + p,
    getPrinterAuthHeaders: () => ({}),
    toast: (msg, kind) => toasts.push({ msg: String(msg), kind }),
    setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); return 0; },
    FormData: class { append() {} },
    Blob: class { constructor() {} },
    XMLHttpRequest: xhr,
    fetch: async (u, o) => { fetches.push({ u: String(u), o }); return { ok: startOk, status: startOk?200:500 }; },
    renderMonitorGrid: () => {},
    pollPrinters: () => {},
    AbortSignal: { timeout: () => null },
  };
  const names = Object.keys(deps);
  const start = new Function(...names, BODY + '\nreturn _queueStartNext;')(...names.map((n) => deps[n]));
  return { start, toasts, scheduled, fetches, queue };
}

const job = (extra = {}) => ({ gcode: 'G1 X0', filename: 'pieza.gcode', ...extra });

// ── El corazón del arreglo ──────────────────────────────────────────────

test('subida fallida (500): el trabajo NO se pierde y se reintenta', async () => {
  const m = montar({ queue: { p1: [job()] }, xhr: xhrFail });
  await m.start('p1');
  assert.equal(m.queue.p1.length, 1, 'el trabajo sigue en la cola');
  assert.ok(m.scheduled.length >= 1, 'se programó un reintento');
});

test('impresora inaccesible (onerror): el trabajo tampoco se pierde', async () => {
  const m = montar({ queue: { p1: [job()] }, xhr: xhrErr });
  await m.start('p1');
  assert.equal(m.queue.p1.length, 1);
});

test('sin IP: el trabajo queda en cola (no se pierde)', async () => {
  const m = montar({ queue: { p1: [job()] }, ip: null, xhr: xhrOK });
  await m.start('p1');
  assert.equal(m.queue.p1.length, 1);
});

// ── Camino feliz intacto ────────────────────────────────────────────────

test('subida y START exitosos: el trabajo sale de la cola', async () => {
  const m = montar({ queue: { p1: [job()] }, xhr: xhrOK });
  await m.start('p1');await Promise.resolve();await Promise.resolve();
  assert.equal(m.queue.p1.length, 0, 'se consume solo tras START confirmado');
  assert.ok(m.fetches.some((f) => /print\/start/.test(f.u)), 'inicia la impresión');
});

test('upload exitoso pero START 500: el trabajo NO se consume',async()=>{
  const m=montar({queue:{p1:[job()]},xhr:xhrOK,startOk:false});
  await m.start('p1');await Promise.resolve();await Promise.resolve();
  assert.equal(m.queue.p1.length,1);
  assert.ok(m.toasts.some(t=>/no se pudo iniciar|START no fue confirmado/i.test(t.msg)));
});

// ── Reintentos acotados ─────────────────────────────────────────────────

test('tras 3 intentos fallidos deja de reintentar y avisa iniciar a mano', async () => {
  const m = montar({ queue: { p1: [job({ _tries: 2 })] }, xhr: xhrFail });
  await m.start('p1');
  assert.equal(m.queue.p1.length, 1, 'sigue en la cola, no se pierde');
  assert.equal(m.scheduled.length, 0, 'ya no reintenta');
  assert.ok(m.toasts.some((t) => /a mano/.test(t.msg)), 'avisa iniciarlo a mano');
});

// ── El código lo dice ───────────────────────────────────────────────────

test('el trabajo se consume solo tras START confirmado, no tras upload', () => {
  assert.doesNotMatch(BODY, /const job=q\.shift\(\)/, 'ya no hace shift antes de subir');
  assert.match(BODY, /if\(!started\.ok\)/);
  const startPos=BODY.indexOf('if(!started.ok)'),shiftPos=BODY.indexOf('_printQueue[id].shift()');
  assert.ok(startPos>=0&&shiftPos>startPos,'consume solo después de confirmar START');
});
