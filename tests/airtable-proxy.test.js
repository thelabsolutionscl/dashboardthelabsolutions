#!/usr/bin/env node
/*
 * airtable-proxy: el allowlist de origen no puede dejar pasar peticiones sin Origin.
 *
 * El proxy guarda los secretos (PAT de Airtable, keys de Claude/OpenAI) y solo
 * exige una APP_KEY que —según el propio diseño— va horneada en el HTML público.
 * Su única defensa contra una clave filtrada es el allowlist de Origin. Pero el
 * chequeo era `if (origin && !ALLOWED_ORIGINS.includes(origin))`: una petición
 * SIN header Origin (curl, un script, server-to-server) se lo saltaba entera y,
 * con la clave pública, podía leer/escribir Airtable o gastar créditos de IA.
 * Todo cliente legítimo es un navegador en el dashboard, que SIEMPRE manda Origin
 * (la petición lleva X-App-Key, header que fuerza CORS). Exigir un Origin válido
 * cierra el agujero sin romper a nadie.
 *
 * Se monta el fetch handler REAL de worker.js sobre un fetch de upstream simulado.
 *
 * Correr:  node --test tests/airtable-proxy.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Carga el export por defecto del worker (módulo ES) ejecutando su fuente
// completo: se reemplaza `export default` por una captura y se devuelve al final,
// de modo que TODO el módulo se inicializa igual que en Cloudflare.
function cargarWorker() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'airtable-proxy', 'src', 'worker.js'), 'utf8');
  const body = src.replace('export default', 'const __wk =') + '\nreturn __wk;';
  return new Function(body)();
}
const worker = cargarWorker();

const ENV = {
  APP_KEY: 'passphrase-larga-y-secreta-1234',
  AIRTABLE_TOKEN: 'patTEST123',
  ANTHROPIC_TOKEN: 'sk-ant-test',
  OPENAI_TOKEN: 'sk-openai-test',
};
const OK_ORIGIN = 'https://dashboard.thelab.solutions';

// Request mínimo: el worker solo usa method, url, headers.get() y body.
function req(pathname, { method = 'GET', origin, key, contentType, body } = {}) {
  const h = {};
  if (origin !== undefined) h['origin'] = origin;
  if (key !== undefined) h['x-app-key'] = key;
  if (contentType) h['content-type'] = contentType;
  return {
    method,
    url: 'https://airtable-proxy.example.workers.dev' + pathname,
    headers: { get: (k) => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) },
    body: body ?? null,
  };
}

// Reemplaza global.fetch por un espía; devuelve {calls, restore}.
function espiarFetch(status = 200, payload = '{"records":[]}') {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (u, opts = {}) => {
    calls.push({ url: String(u), opts });
    return new Response(payload, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { global.fetch = orig; } };
}

// ── El corazón del arreglo ──────────────────────────────────────────────

test('SIN Origin, aun con clave válida, se rechaza y NO llega al upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD/Clientes', { key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 403, 'una petición sin Origin no debe pasar');
    assert.equal(spy.calls.length, 0, 'no debe tocar Airtable');
    const j = await r.json();
    assert.match(j.error, /origin/i);
  } finally { spy.restore(); }
});

test('SIN Origin no puede llegar al proxy de Anthropic (gastar créditos)', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(
      req('/anthropic/v1/messages', { method: 'POST', key: ENV.APP_KEY, contentType: 'application/json', body: '{}' }),
      ENV, undefined
    );
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0, 'no debe llamar a api.anthropic.com');
  } finally { spy.restore(); }
});

// ── El camino legítimo sigue funcionando ────────────────────────────────

test('con Origin permitido y clave válida, la petición Airtable llega al upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD/Clientes', { origin: OK_ORIGIN, key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 1, 'reenvía al upstream');
    assert.match(spy.calls[0].url, /^https:\/\/api\.airtable\.com\/v0\/app1YtD\/Clientes/);
    assert.equal(spy.calls[0].opts.headers.get('Authorization'), 'Bearer patTEST123');
  } finally { spy.restore(); }
});

test('con Origin permitido, el proxy de Anthropic reenvía con la x-api-key del server', async () => {
  const spy = espiarFetch(200, '{"content":[]}');
  try {
    const r = await worker.fetch(
      req('/anthropic/v1/messages', { method: 'POST', origin: OK_ORIGIN, key: ENV.APP_KEY, contentType: 'application/json', body: '{}' }),
      ENV, undefined
    );
    assert.equal(r.status, 200);
    assert.equal(spy.calls.length, 1);
    assert.match(spy.calls[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    assert.equal(spy.calls[0].opts.headers.get('x-api-key'), 'sk-ant-test');
  } finally { spy.restore(); }
});

// ── Chequeos que ya existían y deben seguir en pie ──────────────────────

test('Origin de otro sitio se rechaza aunque la clave sea válida', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD/Clientes', { origin: 'https://evil.example', key: ENV.APP_KEY }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

test('clave incorrecta se rechaza aun con Origin válido', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD/Clientes', { origin: OK_ORIGIN, key: 'mala' }), ENV, undefined);
    assert.equal(r.status, 403);
    assert.equal(spy.calls.length, 0);
    const j = await r.json();
    assert.match(j.error, /Unauthorized/);
  } finally { spy.restore(); }
});

test('/health responde sin Origin ni clave (monitores de uptime)', async () => {
  const r = await worker.fetch(req('/health'), ENV, undefined);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  // Solo booleanos de configuración, sin exponer los secretos.
  assert.equal(j.airtable, true);
  assert.equal(j.anthropic, true);
});

test('OPTIONS (preflight) responde 204 sin tocar upstream', async () => {
  const spy = espiarFetch();
  try {
    const r = await worker.fetch(req('/app1YtD/Clientes', { method: 'OPTIONS', origin: OK_ORIGIN }), ENV, undefined);
    assert.equal(r.status, 204);
    assert.equal(spy.calls.length, 0);
  } finally { spy.restore(); }
});

// ── El código lo dice ───────────────────────────────────────────────────

test('el chequeo ya no depende de que el Origin exista', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'airtable-proxy', 'src', 'worker.js'), 'utf8');
  assert.match(src, /if \(!ALLOWED_ORIGINS\.includes\(origin\)\) \{/, 'exige Origin en la lista');
  assert.doesNotMatch(src, /if \(origin && !ALLOWED_ORIGINS\.includes\(origin\)\)/, 'ya no está el guard con agujero');
});
