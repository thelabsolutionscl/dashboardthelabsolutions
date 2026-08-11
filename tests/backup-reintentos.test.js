#!/usr/bin/env node
/*
 * Backup semanal del CRM — un blip transitorio no puede botar una tabla entera.
 *
 * fetchTable hacía UN solo fetch, sin reintento. El bucle de arriba atrapa el
 * error, mete la tabla en `fallos` y IGUAL escribe el JSON y sale con éxito. O
 * sea: un 429 (Airtable limita a 5 req/s por base) o un corte de red momentáneo
 * en cualquier tabla la dejaba FUERA del respaldo "completo" en silencio — y no
 * te enteras hasta que necesitas restaurar. Ahora getPagina reintenta ante
 * fallos transitorios (429 / 5xx / red) con backoff acotado; los errores reales
 * (401/403/404) siguen fallando al toque.
 *
 * Se monta el getPagina + fetchTable REALES con fetch y setTimeout simulados.
 *
 * Correr:  node --test tests/backup-reintentos.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backup-airtable.mjs'), 'utf8');

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
const BODY = extract('getPagina') + '\n' + extract('fetchTable');

// Respuesta fetch simulada.
const ok = (records, offset) => ({ ok: true, status: 200, json: async () => ({ records, offset }) });
const httpErr = (status) => ({ ok: false, status, text: async () => 'boom' });

function montar(respuestas) {
  // respuestas: array de valores; string 'NET' = error de red; función = se llama.
  let i = 0;
  const esperas = [];
  const deps = {
    TOKEN: 'pat_test',
    API: 'https://api.test',
    BASE_ID: 'appX',
    MAX_REINTENTOS: 4,
    encodeURIComponent,
    dormir: async (ms) => { esperas.push(ms); },
    fetch: async () => {
      const v = respuestas[i++];
      if (v === 'NET') throw new Error('ECONNRESET');
      return typeof v === 'function' ? v() : v;
    },
  };
  const names = Object.keys(deps);
  const mk = new Function(...names, BODY + '\nreturn { getPagina, fetchTable };');
  const api = mk(...names.map((n) => deps[n]));
  return { ...api, esperas, llamadas: () => i };
}

// ── El corazón del arreglo: no se pierde la tabla por un fallo transitorio ──

test('429 y luego 200: reintenta y NO pierde los registros', async () => {
  const m = montar([httpErr(429), ok([{ id: 'r1' }, { id: 'r2' }])]);
  const recs = await m.fetchTable('Clientes');
  assert.equal(recs.length, 2, 'recupera todos los registros tras el reintento');
  assert.equal(m.esperas.length, 1, 'esperó una vez (backoff)');
});

test('corte de red y luego 200: reintenta y no pierde nada', async () => {
  const m = montar(['NET', 'NET', ok([{ id: 'r1' }])]);
  const recs = await m.fetchTable('Pedidos');
  assert.equal(recs.length, 1);
  assert.equal(m.esperas.length, 2);
});

test('503 (5xx) es transitorio: reintenta', async () => {
  const m = montar([httpErr(503), ok([{ id: 'r1' }])]);
  const recs = await m.fetchTable('Facturas');
  assert.equal(recs.length, 1);
});

// ── Errores reales NO se reintentan (fallan al toque) ──────────────────────

test('401 no autorizado: falla inmediato, sin reintentos', async () => {
  const m = montar([httpErr(401), ok([{ id: 'nope' }])]);
  await assert.rejects(() => m.fetchTable('Clientes'), /HTTP 401/);
  assert.equal(m.esperas.length, 0, 'no reintenta un error de auth');
  assert.equal(m.llamadas(), 1, 'un solo fetch');
});

test('404 tabla inexistente: falla inmediato', async () => {
  const m = montar([httpErr(404)]);
  await assert.rejects(() => m.fetchTable('NoExiste'), /HTTP 404/);
  assert.equal(m.esperas.length, 0);
});

// ── Reintentos acotados: no bucle infinito ─────────────────────────────────

test('429 persistente: reintenta MAX veces y luego se rinde', async () => {
  const m = montar(Array(20).fill(httpErr(429)));
  await assert.rejects(() => m.fetchTable('Clientes'), /reintentos/);
  assert.equal(m.esperas.length, 4, 'exactamente MAX_REINTENTOS esperas');
  assert.equal(m.llamadas(), 5, 'intento inicial + 4 reintentos');
});

test('backoff exponencial acotado: 1s, 2s, 4s, 8s', async () => {
  const m = montar(Array(20).fill(httpErr(500)));
  await assert.rejects(() => m.fetchTable('Clientes'));
  assert.deepEqual(m.esperas, [1000, 2000, 4000, 8000]);
});

// ── Paginación intacta ─────────────────────────────────────────────────────

test('varias páginas: sigue el offset y junta todo', async () => {
  const m = montar([ok([{ id: 'a' }], 'off1'), ok([{ id: 'b' }, { id: 'c' }])]);
  const recs = await m.fetchTable('Pedidos');
  assert.equal(recs.length, 3, 'junta las dos páginas');
});

test('fallo transitorio a mitad de paginación: reintenta esa página, no pierde lo anterior', async () => {
  const m = montar([ok([{ id: 'a' }], 'off1'), httpErr(429), ok([{ id: 'b' }])]);
  const recs = await m.fetchTable('Pedidos');
  assert.equal(recs.length, 2);
});

// ── El código lo dice ──────────────────────────────────────────────────────

test('fetchTable delega en getPagina (con reintentos), no hace fetch pelado', () => {
  assert.match(BODY, /await getPagina\(url, tabla\)/, 'usa getPagina');
  assert.match(BODY, /r\.status === 429 \|\| r\.status >= 500/, 'trata 429 y 5xx como transitorios');
});
