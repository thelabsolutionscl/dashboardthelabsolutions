#!/usr/bin/env node
/*
 * Los 21 agentes de IA: qué se les manda, qué se hace con lo que devuelven, y
 * qué pasa cuando la IA no responde.
 *
 * El fallo que motivó esto: callClaude es la puerta única de todos los agentes y
 * usaba un fetch pelado. Si Anthropic o el proxy se colgaban, el modal se
 * quedaba en "está pensando…" para siempre; y un 429 o un 503 pasajero —que la
 * API devuelve cuando está cargada— mataba la consulta en vez de reintentarla.
 * KAI ya tenía ese cinturón, los agentes no.
 *
 * Correr:  node --test tests/agentes-ia.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');

function bloque(src, desde, hasta) {
  const i = src.indexOf(desde);
  assert.ok(i > 0, `debe existir ${desde}`);
  const j = src.indexOf(hasta, i);
  return src.slice(i, j > 0 ? j : i + 4000);
}

// El helper de red, montado con un fetch de mentira para poder observarlo.
function montarClaudeHttp() {
  const fuente = bloque(HTML, 'async function _claudeHttp', 'async function _callClaudeViaProxy');
  return new Function(`${fuente}\nreturn _claudeHttp;`)();
}

test('una IA que no responde corta sola en vez de dejar el modal colgado', async () => {
  const _claudeHttp = montarClaudeHttp();
  let intentos = 0;
  global.fetch = (u, o) => new Promise((_, rej) => {
    intentos++;
    o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  });
  const t0 = Date.now();
  // Con un reloj propio: si el helper perdiera su tiempo límite, esta prueba se
  // quedaría colgada para siempre en vez de fallar, y un fallo que no se ve no
  // sirve de nada.
  const COLGADO = Symbol('colgado');
  const err = await Promise.race([
    _claudeHttp('x', {}, { limite: 300, reintentos: 1 }).then(() => null, (e) => e),
    new Promise((res) => setTimeout(() => res(COLGADO), 4000)),
  ]);
  assert.notEqual(err, COLGADO, 'la llamada quedó colgada: no hay tiempo límite');
  assert.ok(err, 'debe rendirse, no esperar para siempre');
  assert.match(err.message, /no respondió en \d+ segundos/, 'y explicarlo en castellano');
  assert.equal(intentos, 2, 'reintenta antes de rendirse');
  assert.ok(Date.now() - t0 < 4000, 'sin quedarse pegado');
});

test('un 429 o una caída pasajera se reintentan', async () => {
  const _claudeHttp = montarClaudeHttp();
  let intentos = 0;
  global.fetch = async () => { intentos++; return intentos < 3 ? { status: 429, headers: { get: () => '0' } } : { status: 200, ok: true, headers: { get: () => null } }; };
  const r = await _claudeHttp('x', {}, { limite: 5000, reintentos: 2 });
  assert.equal(r.status, 200);
  assert.equal(intentos, 3, 'insiste hasta que la API responde');

  intentos = 0;
  global.fetch = async () => { intentos++; return { status: 503, ok: false, headers: { get: () => null } }; };
  const r2 = await _claudeHttp('x', {}, { limite: 5000, reintentos: 2 });
  assert.equal(r2.status, 503, 'si no se recupera, se devuelve el error real');
  assert.equal(intentos, 3);
});

test('un error de credenciales no se reintenta', async () => {
  // Insistir con una clave mala solo gasta tiempo y cuota.
  const _claudeHttp = montarClaudeHttp();
  let intentos = 0;
  global.fetch = async () => { intentos++; return { status: 401, ok: false, headers: { get: () => null } }; };
  const r = await _claudeHttp('x', {}, { limite: 5000, reintentos: 2 });
  assert.equal(r.status, 401);
  assert.equal(intentos, 1);
});

test('los dos caminos hacia Claude pasan por el helper', () => {
  // Con proxy la clave vive en el Worker; sin él va directo. Ninguno puede
  // quedarse con el fetch pelado.
  const proxy = bloque(HTML, 'async function _callClaudeViaProxy', 'async function _callClaudeRaw');
  const directo = bloque(HTML, 'async function _callClaudeRaw', '// ── HELPERS');
  assert.match(proxy, /_claudeHttp\(px\.url/, 'la ruta por proxy debe usarlo');
  assert.match(directo, /_claudeHttp\('https:\/\/api\.anthropic\.com/, 'la ruta directa también');
  assert.doesNotMatch(proxy, /await fetch\(px\.url/, 'sin fetch pelado');
  assert.doesNotMatch(directo, /await fetch\('https:\/\/api\.anthropic/, 'sin fetch pelado');
});

test('el correo automático al lead no lleva texto generado por IA', () => {
  // El LEAD_AGENT puntúa el lead para uso interno. Lo que le llega al cliente es
  // una plantilla fija: si algún día se mezclara, saldría a un desconocido sin
  // que nadie lo revise.
  const fn = bloque(WORKER, 'async function sendLeadAutoReply', 'async function sendLeadSaveFailedAlert');
  assert.doesNotMatch(fn, /agentText|claude|anthropic|respuesta_ia|_leadAgentResponse/i,
    'la auto-respuesta debe ser plantilla, no salida de IA');
  assert.match(fn, /escapeHtmlW\(norm\.name/, 'y lo que sí viene del formulario público va escapado');
});

test('el contexto que reciben los agentes respeta el alcance del vendedor', () => {
  const ctx = bloque(HTML, 'function buildAgentContext', 'function proyeccionMes');
  assert.match(ctx, /isVendorMode==='function'&&isVendorMode\(\)/, 'debe detectarse el modo vendedor');
  assert.match(ctx, /state\.pedidos\.filter\(vendorOwnsRecord\)/);
  assert.match(ctx, /state\.cotizaciones\.filter\(vendorOwnsRecord\)/);
  assert.match(ctx, /state\.clientes\.filter\(vendorOwnsRecord\)/);
  // Las notas internas no tienen por qué salir del dashboard.
  assert.doesNotMatch(ctx, /Notas internas/, 'las notas internas no viajan a la IA');
});

test('lo que devuelve la IA se escapa antes de pintarse', () => {
  // La respuesta se inserta con innerHTML: sin escapar, cualquier cosa que
  // devolviera el modelo se ejecutaría dentro del dashboard.
  const fn = bloque(HTML, 'function formatAgentReport', '\nfunction ');
  assert.match(fn, /const inl=s=>\{let h=escapeHtml\(s\)/, 'debe existir el escapado');

  // Lo que puede ir sin escapar, y por qué. Cualquier otra cosa que se cuele
  // aquí es texto del modelo entrando crudo al innerHTML.
  const permitido = [
    /\?\s*'/,                       // ternarios de estilo: literales del propio código
    /^\$\{headHtml\}$/,             // HTML ya compuesto arriba con inl()
    /^\$\{renderBody\(/,            // compone su HTML escapando cada línea con inl()
    /^\$\{ess\}$/,                  // 0 o 1
    /^\$\{urg\.(level|icon|label)\}$/, // objeto definido en el código, no del modelo
    /^\$\{mt\.(color|ico)\}$/,      // idem: tabla SECMETA del propio código
  ];
  const sinEscapar = (fn.match(/\$\{[^}]*\}/g) || [])
    .filter((s) => !/inl\(|escapeHtml\(/.test(s))
    .filter((s) => !permitido.some((re) => re.test(s)))
    .filter((s) => s !== '${m[1]}');   // se comprueba aparte, abajo
  assert.deepEqual(sinEscapar, [], `Texto de la IA sin escapar: ${sinEscapar.join(', ')}`);

  // Un ${m[1]} sin escapar solo se tolera si la regex de SU rama lo acota a algo
  // que no puede ser HTML (la marca ✅/❌, el número de una lista). Permitirlo en
  // general dejaría pasar cualquier trozo de la respuesta, que es texto libre.
  const ACOTADOS = ['[✅❌]', '\\d+'];
  const ramas = [];
  const re = /\$\{m\[1\]\}/g;
  let m;
  while ((m = re.exec(fn))) {
    // La regex de la rama es el último match(/^…(grupo)…/) antes de este uso.
    const previo = fn.slice(0, m.index);
    const capturas = [...previo.matchAll(/match\(\/\^[^(]*\(([^)]*)\)/g)];
    ramas.push(capturas.length ? capturas[capturas.length - 1][1] : '(sin rama)');
  }
  assert.ok(ramas.length > 0, 'la comprobación debe estar mirando código real');
  const libres = ramas.filter((g) => !ACOTADOS.includes(g));
  assert.deepEqual(libres, [], `Respuesta de la IA sin escapar en ramas de texto libre: ${libres.join(', ')}`);

  // Las viñetas y los títulos, que sí llevan texto libre, van escapados.
  assert.match(fn, /<span>\$\{inl\(m\[1\]\)\}<\/span>/, 'la viñeta debe escapar su contenido');

  // Y que el escapado siga siendo real, no un pasamanos.
  const inlFn = /const inl=s=>\{[\s\S]{0,400}?\n/.exec(fn)[0];
  assert.match(inlFn, /escapeHtml\(s\)/);
});

test('el modelo y el tope de tokens siguen siendo los baratos', () => {
  // Los agentes corren en Haiku a propósito (≈3× más barato que Sonnet). Un
  // cambio de modelo aquí multiplica la cuenta sin que se note en pantalla.
  assert.match(HTML, /const AGENT_MODEL='claude-haiku-4-5'/, 'los agentes van en Haiku');
  assert.match(HTML, /max_tokens:1500/, 'con tope de tokens por consulta');
  assert.match(WORKER, /AUTO_PROCESS_DAILY_CAP \|\| "200"/, 'y el procesamiento automático tiene tope diario');
});
