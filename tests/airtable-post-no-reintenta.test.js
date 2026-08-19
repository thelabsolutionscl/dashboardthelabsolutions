#!/usr/bin/env node
/*
 * Capa Airtable · un POST de creación NO se reintenta ante fallo ambiguo.
 *
 * airtableHttp reintentaba TODA petición ante corte de red / timeout / 5xx,
 * incluidas las creaciones (POST). Pero un POST no es idempotente: si Airtable
 * creó el registro y solo se perdió/tardó la respuesta, el reintento crea un
 * SEGUNDO registro — con el mismo N° de pedido/cotización, en silencio. Las
 * guardas de doble-clic y de correlativo actúan en la UI, no en el transporte.
 * Ahora los POST no se reintentan ante red/5xx (el 429, que rechaza antes de
 * procesar, sí sigue siendo seguro); GET/PATCH/DELETE (idempotentes) sí.
 *
 * Se monta el airtableHttp REAL con fetch/timers simulados.
 *
 * Correr:  node --test tests/airtable-post-no-reintenta.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(nombre) {
  const i = HTML.indexOf('async function ' + nombre + '(');
  assert.ok(i >= 0, `debe existir ${nombre}`);
  const ini = HTML.indexOf('{', HTML.indexOf(')', i));
  let d = 0;
  for (let x = ini; x < HTML.length; x++) {
    if (HTML[x] === '{') d++;
    if (HTML[x] === '}') { d--; if (!d) return HTML.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}
const BODY = extract('airtableHttp');

// Monta airtableHttp con timers inmediatos y AbortController inofensivo.
// `seq` es la secuencia de resultados por intento: 'NET' = throw de red, o un
// número = status HTTP a devolver.
function montar(seq) {
  let llamadas = 0;
  const fetch = async () => {
    const v = seq[Math.min(llamadas, seq.length - 1)];
    llamadas++;
    if (v === 'NET') throw new Error('ECONNRESET');
    return { ok: v < 400, status: v, headers: { get: () => null } };
  };
  const deps = {
    fetch,
    setTimeout: (fn) => { if (fn) Promise.resolve().then(fn); return 0; },
    clearTimeout: () => {},
    AbortController: class { constructor() { this.signal = null; } abort() {} },
  };
  const names = Object.keys(deps);
  const http = new Function(...names, BODY + '\nreturn airtableHttp;')(...names.map((n) => deps[n]));
  return { http, veces: () => llamadas };
}

// ── El corazón del arreglo: POST no se reintenta ante fallo ambiguo ──────

test('POST + corte de red: NO reintenta (un solo fetch), lanza error', async () => {
  const m = montar(['NET', 200]);
  await assert.rejects(() => m.http('u', { method: 'POST' }, { idempotent: false }));
  assert.equal(m.veces(), 1, 'no re-POSTea: evita duplicar el registro');
});

test('POST + 500: devuelve el 500 sin reintentar (un fetch)', async () => {
  const m = montar([500, 200]);
  const r = await m.http('u', { method: 'POST' }, { idempotent: false });
  assert.equal(r.status, 500);
  assert.equal(m.veces(), 1);
});

test('POST + 429: SÍ reintenta (el 429 rechaza antes de crear nada)', async () => {
  const m = montar([429, 200]);
  const r = await m.http('u', { method: 'POST' }, { idempotent: false });
  assert.equal(r.status, 200);
  assert.equal(m.veces(), 2, 'el 429 es seguro de reintentar');
});

// ── Idempotentes (GET/PATCH/DELETE) conservan el reintento ───────────────

test('GET + corte de red transitorio: reintenta y termina bien', async () => {
  const m = montar(['NET', 'NET', 200]);
  const r = await m.http('u', { method: 'GET' }, { idempotent: true });
  assert.equal(r.status, 200);
  assert.equal(m.veces(), 3);
});

test('PATCH + 503 transitorio: reintenta (idempotente)', async () => {
  const m = montar([503, 200]);
  const r = await m.http('u', { method: 'PATCH' }, { idempotent: true });
  assert.equal(r.status, 200);
  assert.equal(m.veces(), 2);
});

test('por defecto (sin opts) es idempotente: reintenta un GET', async () => {
  const m = montar(['NET', 200]);
  const r = await m.http('u', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(m.veces(), 2);
});

// ── airtableWrite marca el POST como no idempotente ──────────────────────

test('airtableWrite pasa idempotent=false solo para POST', () => {
  const w = extract('airtableWrite');
  assert.match(w, /\{idempotent:method!=='POST'\}/, 'el POST no se reintenta; PATCH/DELETE sí');
});
