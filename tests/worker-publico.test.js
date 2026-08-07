#!/usr/bin/env node
/*
 * Superficie pública de los workers — lo que cualquiera puede llamar sin clave.
 *
 * Tres enlaces del lead-worker viajan en los correos al cliente (/nps, /pod y
 * /pedido) y su token es base64 del recId, sin firma. Mientras sigan así, lo
 * que impide probarlos en masa —y que cada intento gaste cuota de Airtable— es
 * el límite por IP. Esto verifica que el límite existe de verdad, que no
 * estorba el uso normal y que no se comparte entre clientes distintos.
 *
 * Correr:  node --test tests/worker-publico.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WORKER = pathToFileURL(path.join(__dirname, '..', 'lead-worker', 'src', 'index.js')).href;
const PEDIDO = 'recPE0000000000A1';
const TOKEN = Buffer.from(PEDIDO).toString('base64');

// KV de mentira (binding RL). El TTL no se simula: cada test estrena bucket.
function nuevoEnv() {
  const kv = new Map();
  return {
    RL: {
      async get(k) { return kv.has(k) ? kv.get(k) : null; },
      async put(k, v) { kv.set(k, String(v)); },
    },
    AIRTABLE_TOKEN: 'patSECRETO',
    AIRTABLE_BASE_ID: 'appTEST',
    ALLOWED_ORIGINS: 'https://dashboard.thelab.solutions',
  };
}
const ctx = { waitUntil() {} };

let escrituras = [];
function stubFetch() {
  escrituras = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const [, , , tabla, recId] = u.pathname.split('/');
    const metodo = opts.method || 'GET';
    if (metodo === 'PATCH') {
      escrituras.push({ tabla: decodeURIComponent(tabla || ''), recId, fields: JSON.parse(opts.body).fields });
      return new Response(JSON.stringify({ id: recId, fields: {} }), { status: 200 });
    }
    if (recId === PEDIDO) {
      return new Response(JSON.stringify({
        id: PEDIDO,
        fields: { 'N° Pedido': 'PED-0042', 'Estado pedido': 'En producción' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const desde = (ip, url, init = {}) =>
  new Request(url, { ...init, headers: { 'CF-Connecting-IP': ip, ...(init.headers || {}) } });

test('enlaces públicos del lead-worker', async (t) => {
  stubFetch();
  const worker = (await import(WORKER)).default;

  await t.test('/pedido corta al cliente que insiste, pero deja pasar el uso normal', async () => {
    const env = nuevoEnv();
    const url = `https://worker.example.com/pedido?p=${encodeURIComponent(TOKEN)}`;
    // Recargar el seguimiento varias veces mientras se espera el pedido es
    // normal: eso no puede bloquearse.
    for (let i = 0; i < 20; i++) {
      const r = await worker.fetch(desde('1.2.3.4', url), env, ctx);
      assert.equal(r.status, 200, `la recarga ${i + 1} debe funcionar`);
    }
    let bloqueado = 0;
    for (let i = 0; i < 200; i++) {
      const r = await worker.fetch(desde('1.2.3.4', url), env, ctx);
      if (r.status === 429) bloqueado++;
    }
    assert.ok(bloqueado > 0, 'insistir sin freno debe terminar en 429');
  });

  await t.test('el límite es por IP: un cliente no bloquea a otro', async () => {
    const env = nuevoEnv();
    const url = `https://worker.example.com/pedido?p=${encodeURIComponent(TOKEN)}`;
    for (let i = 0; i < 200; i++) await worker.fetch(desde('9.9.9.9', url), env, ctx);
    const otro = await worker.fetch(desde('5.5.5.5', url), env, ctx);
    assert.equal(otro.status, 200, 'el segundo cliente entra sin problemas');
  });

  await t.test('/pod confirma la recepción y luego deja de aceptar intentos en masa', async () => {
    const env = nuevoEnv();
    const url = `https://worker.example.com/pod?p=${encodeURIComponent(TOKEN)}&c=1`;
    escrituras = [];
    const primera = await worker.fetch(desde('2.2.2.2', url), env, ctx);
    assert.equal(primera.status, 200, 'el cliente real confirma sin fricción');
    const marca = escrituras.find((e) => e.fields && e.fields['Recepción confirmada'] === true);
    assert.ok(marca, 'la confirmación debe quedar registrada en Pedidos');

    let bloqueado = 0;
    for (let i = 0; i < 200; i++) {
      const r = await worker.fetch(desde('2.2.2.2', url), env, ctx);
      if (r.status === 429) bloqueado++;
    }
    assert.ok(bloqueado > 0, 'probar tokens en masa contra /pod debe cortarse');
  });

  await t.test('/nps corta tanto la página como el POST del comentario', async () => {
    const env = nuevoEnv();
    const get = `https://worker.example.com/nps?p=${encodeURIComponent(TOKEN)}`;
    const primera = await worker.fetch(desde('3.3.3.3', get), env, ctx);
    assert.equal(primera.status, 200, 'el cliente real abre la encuesta');

    let bloqueado = 0;
    for (let i = 0; i < 200; i++) {
      const r = await worker.fetch(desde('3.3.3.3', get), env, ctx);
      if (r.status === 429) bloqueado++;
    }
    assert.ok(bloqueado > 0, 'la página de la encuesta debe cortarse al insistir');

    // Ya agotado el cupo de esa IP, el POST del comentario responde JSON (no HTML).
    const post = await worker.fetch(desde('3.3.3.3', 'https://worker.example.com/nps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, comentario: 'spam' }),
    }), env, ctx);
    assert.equal(post.status, 429);
    assert.match(post.headers.get('Content-Type') || '', /application\/json/, 'el POST responde JSON, no una página');
  });

  await t.test('sin KV el worker sigue sirviendo (el límite es defensa, no requisito)', async () => {
    const { RL: _sinKv, ...env } = nuevoEnv();
    const r = await worker.fetch(desde('4.4.4.4', `https://worker.example.com/pedido?p=${encodeURIComponent(TOKEN)}`), env, ctx);
    assert.equal(r.status, 200, 'si falta el binding RL no se cae el seguimiento');
  });
});

test('worker tributario cerrado con clave', () => {
  // El sii-worker no se puede importar acá (usa node-forge), así que se
  // verifica sobre el código: emite documentos tributarios y administra
  // folios, no puede quedar abierto.
  const src = fs.readFileSync(path.join(__dirname, '..', 'sii-worker', 'src', 'index.js'), 'utf8');
  assert.match(src, /function timingSafeEqual/, 'la clave debe compararse en tiempo constante');
  assert.match(src, /X-Worker-Key/, 'debe leerse la clave de la cabecera');
  assert.match(src, /status:\s*401/, 'sin clave válida debe responder 401');
  assert.match(src, /url\.pathname\s*!==\s*'\/health'/, 'solo /health queda libre para los monitores');
  assert.doesNotMatch(src, /rut_emisor:\s*env\.RUT_EMISOR/, '/health no debe exponer el RUT del emisor');
});
