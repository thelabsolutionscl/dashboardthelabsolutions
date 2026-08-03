#!/usr/bin/env node
/*
 * Portal del cliente (lead-worker) — el link firmado y lo que expone.
 *
 * El portal dejó de vivir dentro del dashboard: ahora lo sirve el Worker con el
 * token de Airtable del lado servidor. Esto verifica lo que sostiene esa
 * decisión: token firmado con vencimiento, un cliente no ve ni decide sobre
 * otro, y en el HTML del cliente no viajan credenciales ni datos internos.
 *
 * Correr:  node --test tests/portal-cliente.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const WORKER = pathToFileURL(path.join(__dirname, '..', 'lead-worker', 'src', 'index.js')).href;

const CLIENTE = 'recCL0000000000A1';
const OTRO_CLIENTE = 'recCL0000000000B2';
const PEDIDO = 'recPE0000000000A1';
const COT = 'recCO0000000000A1';
const COT_AJENA = 'recCO0000000000B2';
const COT_CERRADA = 'recCO0000000000C3';

// KV de mentira (el binding RL del Worker): guarda la versión de token de cada
// cliente, que es lo que hace efectiva la revocación.
const kv = new Map();
const RL = {
  async get(k) { return kv.has(k) ? kv.get(k) : null; },
  async put(k, v) { kv.set(k, String(v)); },
};

const env = {
  RL,
  AIRTABLE_TOKEN: 'patSECRETO_NO_DEBE_SALIR',
  AIRTABLE_BASE_ID: 'appTEST',
  PORTAL_SECRET: 'secreto-de-prueba',
  PORTAL_ADMIN_KEY: 'clave-del-dashboard',
  WORKER_PUBLIC_URL: 'https://worker.example.com',
  ALLOWED_ORIGINS: 'https://dashboard.thelab.solutions',
};
const ctx = { waitUntil() {} };

const REGISTROS = {
  Clientes: {
    [CLIENTE]: { id: CLIENTE, fields: { Empresa: 'Ferretería Los Andes', Pedidos: [PEDIDO], Cotizaciones: [COT, COT_CERRADA], 'Notas internas': 'CLIENTE MOROSO — no fiar' } },
  },
  Pedidos: {
    [PEDIDO]: { id: PEDIDO, fields: { 'N° Pedido': 'PED-0042', 'Estado pedido': 'En producción', 'Fecha entrega': '2026-09-15', 'Notas internas': 'Margen 62%, proveedor barato' } },
  },
  Cotizaciones: {
    [COT]: { id: COT, fields: {
      'N° Cotización': 'COT-0100', Cliente: [CLIENTE], 'Estado cotización': 'Enviada',
      'Total final (CLP)': 1234567, 'Fecha vencimiento': '2026-09-30',
      'Subtotal (CLP)': 480000, // ojo: este campo guarda COSTOS, no venta
      'Detalle productos': 'Tótem acrílico | 3 und. | Costo: $480.000 | Venta: $1.037.451',
      'Detalle JSON': JSON.stringify([{ desc: 'Tótem acrílico', und: 3, costoUnit: 160000, ventaUnit: 345817, detalle: [{ c: 'Acrílico', m: 160000 }] }]),
    } },
    [COT_CERRADA]: { id: COT_CERRADA, fields: { 'N° Cotización': 'COT-0099', Cliente: [CLIENTE], 'Estado cotización': 'Aprobada' } },
    [COT_AJENA]: { id: COT_AJENA, fields: { 'N° Cotización': 'COT-0200', Cliente: [OTRO_CLIENTE], 'Estado cotización': 'Enviada' } },
  },
};

// Airtable de mentira: sirve los registros de arriba y anota los PATCH.
let escrituras = [];
function stubFetch() {
  escrituras = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const [, , , tabla, recId] = u.pathname.split('/'); // /v0/appTEST/<tabla>/<recId>
    const nombre = decodeURIComponent(tabla || '');
    const metodo = opts.method || 'GET';
    const ok = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (metodo === 'PATCH') {
      escrituras.push({ tabla: nombre, recId, fields: JSON.parse(opts.body).fields });
      return ok({ id: recId, fields: {} });
    }
    if (recId) {
      const rec = (REGISTROS[nombre] || {})[recId];
      return rec ? ok(rec) : new Response('{}', { status: 404 });
    }
    // Listado por fórmula OR(RECORD_ID()='…')
    const formula = u.searchParams.get('filterByFormula') || '';
    const ids = [...formula.matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map((m) => m[1]);
    return ok({ records: ids.map((id) => (REGISTROS[nombre] || {})[id]).filter(Boolean) });
  };
}

const req = (url, init) => new Request(url, init);
const pedirLink = async (worker, headers, body) =>
  await worker.fetch(req('https://worker.example.com/portal/link', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), env, ctx);

async function tokenDe(worker, clienteId = CLIENTE, dias = 30) {
  const r = await pedirLink(worker, { 'X-Portal-Admin-Key': env.PORTAL_ADMIN_KEY }, { clienteId, dias });
  const { url } = await r.json();
  return new URL(url).searchParams.get('t');
}

test('portal del cliente', async (t) => {
  stubFetch();
  const worker = (await import(WORKER)).default;

  await t.test('el link solo lo emite quien tiene la clave del dashboard', async () => {
    assert.equal((await pedirLink(worker, {}, { clienteId: CLIENTE })).status, 401);
    assert.equal((await pedirLink(worker, { 'X-Portal-Admin-Key': 'otra' }, { clienteId: CLIENTE })).status, 401);
    const r = await pedirLink(worker, { 'X-Portal-Admin-Key': env.PORTAL_ADMIN_KEY }, { clienteId: CLIENTE });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(body.url.startsWith('https://worker.example.com/portal?t='), 'la URL apunta al worker');
    assert.match(body.expira, /^\d{2}-\d{2}-\d{4}$/, 'vencimiento en DD-MM-AAAA');
  });

  await t.test('el token lleva vencimiento y no se puede reapuntar a otro cliente', async () => {
    const token = await tokenDe(worker);
    const [, exp, firma] = token.split('.');
    const forjado = [OTRO_CLIENTE, exp, firma].join('.');
    const r = await worker.fetch(req(`https://worker.example.com/portal?t=${forjado}`), env, ctx);
    const html = await r.text();
    assert.match(html, /Enlace inválido/);
    assert.doesNotMatch(html, /Ferretería|PED-0042/, 'no muestra datos de nadie');
  });

  await t.test('un enlace vencido lo dice, no muestra datos', async () => {
    // Firma legítima con vencimiento en el pasado (mismo algoritmo del worker).
    const exp = Math.floor(Date.now() / 1000) - 60;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PORTAL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`portal:${CLIENTE}:${exp}`)));
    let s = ''; for (const b of sig) s += String.fromCharCode(b);
    const firma = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${CLIENTE}.${exp.toString(36)}.${firma}`;
    const html = await (await worker.fetch(req(`https://worker.example.com/portal?t=${token}`), env, ctx)).text();
    assert.match(html, /Enlace vencido/);
    assert.doesNotMatch(html, /PED-0042/);
  });

  await t.test('la página muestra lo del cliente y nada interno', async () => {
    const token = await tokenDe(worker);
    const r = await worker.fetch(req(`https://worker.example.com/portal?t=${token}`), env, ctx);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    const html = await r.text();
    assert.match(html, /Ferretería Los Andes/);
    assert.match(html, /PED-0042/, 'muestra el pedido');
    assert.match(html, /COT-0100/, 'muestra la cotización abierta');
    assert.match(html, /\$1\.234\.567/, 'CLP sin decimales con puntos');
    assert.match(html, /15-09-2026/, 'fechas en DD-MM-AAAA');
    assert.doesNotMatch(html, /COT-0099/, 'las cotizaciones ya decididas no se muestran');
    assert.doesNotMatch(html, /patSECRETO_NO_DEBE_SALIR/, 'el token de Airtable no viaja al cliente');
    assert.doesNotMatch(html, /Margen 62%|MOROSO/, 'las notas internas no se filtran');
  });

  await t.test('la cotización se puede ver, y NO lleva costos ni márgenes', async () => {
    const token = await tokenDe(worker);
    const r = await worker.fetch(req(`https://worker.example.com/portal/cotizacion?t=${encodeURIComponent(token)}&cot=${COT}`), env, ctx);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /COT-0100/);
    assert.match(html, /Tótem acrílico/);
    assert.match(html, /\$345\.817/, 'precio unitario de venta');
    assert.match(html, /\$1\.234\.567/, 'total con IVA');
    assert.match(html, /window\.print\(\)/, 'botón de descarga en PDF');
    // Lo que jamás puede aparecer: costo unitario, la suma de costos que guarda
    // "Subtotal (CLP)", y el texto de "Detalle productos" que trae "Costo: $…".
    assert.doesNotMatch(html, /160\.?000/, 'costo unitario filtrado');
    assert.doesNotMatch(html, /480\.?000/, 'suma de costos filtrada');
    assert.doesNotMatch(html, /Costo:/, 'texto con costos filtrado');
  });

  // El documento del portal tiene que ser EL MISMO que genera el botón de PDF de
  // la sección Cotizaciones (js/pdf-fichas.js). Si alguien cambia uno y no el
  // otro, el cliente recibiría dos versiones distintas del mismo papel.
  await t.test('el documento es idéntico al PDF de la sección Cotizaciones', async () => {
    const _NF = new Intl.NumberFormat('es-CL');
    const previos = ['formatCLP', 'escHtml', 'resolveClienteName', 'state'].map((k) => [k, globalThis[k]]);
    globalThis.formatCLP = (v) => (!v ? '$0' : '$' + _NF.format(Math.round(v)));
    globalThis.escHtml = (s) => (!s && s !== 0 ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
    globalThis.resolveClienteName = () => REGISTROS.Clientes[CLIENTE].fields.Empresa;
    globalThis.state = { cotizacionesById: { [COT]: REGISTROS.Cotizaciones[COT] }, clientes: [REGISTROS.Clientes[CLIENTE]] };

    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf-fichas.js'), 'utf8');
    const trozo = src.slice(src.indexOf('function cotFechaLarga'), src.indexOf('function generarPDFCotizacion'));
    const oficial = new Function(trozo + '\nreturn buildCotizacionDoc;')()(COT).html;

    const token = await tokenDe(worker);
    const delPortal = await (await worker.fetch(req(`https://worker.example.com/portal/cotizacion?t=${encodeURIComponent(token)}&cot=${COT}`), env, ctx)).text();
    previos.forEach(([k, v]) => { globalThis[k] = v; });

    // Se comparan sin la barra de acciones ni el script, que son solo del portal.
    const norm = (h) => h
      .replace(/<div class="acciones">[\s\S]*?<\/div>\s*(?=<div class="header">)/, '')
      .replace(/<script>[\s\S]*?<\/script>/g, '')
      .replace(/<meta name="viewport"[^>]*>|<meta name="robots"[^>]*>/g, '')
      .replace(/\.acciones\{[^}]*\}|\.acciones \.btn\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ').trim();
    assert.equal(norm(delPortal), norm(oficial), 'el documento del portal se desfasó del PDF del dashboard');
  });

  await t.test('no se puede ver la cotización de otro cliente', async () => {
    const token = await tokenDe(worker);
    const r = await worker.fetch(req(`https://worker.example.com/portal/cotizacion?t=${encodeURIComponent(token)}&cot=${COT_AJENA}`), env, ctx);
    const html = await r.text();
    assert.match(html, /no corresponde a tu cuenta/);
    assert.doesNotMatch(html, /COT-0200/);
  });

  await t.test('el cliente aprueba su cotización', async () => {
    const token = await tokenDe(worker);
    const r = await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, cot: COT, decision: 'Aprobada' }),
    }), env, ctx);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    const patch = escrituras.find((e) => e.tabla === 'Cotizaciones' && e.recId === COT);
    assert.equal(patch.fields['Estado cotización'], 'Aprobada');
    assert.match(patch.fields['Fecha aprobación'], /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('el motivo de rechazo va a notas, no ensucia el single select', async () => {
    const token = await tokenDe(worker);
    escrituras = [];
    await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, cot: COT, decision: 'Rechazada', comentario: 'Muy caro comparado con la competencia' }),
    }), env, ctx);
    const patch = escrituras.find((e) => e.recId === COT);
    assert.equal(patch.fields['Estado cotización'], 'Rechazada');
    assert.equal(patch.fields['Motivo rechazo'], undefined, 'no se inventan opciones en el single select');
    assert.match(patch.fields['Notas cotización'], /Muy caro comparado con la competencia/);
  });

  await t.test('con su token no puede decidir la cotización de otro cliente', async () => {
    const token = await tokenDe(worker);
    const r = await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, cot: COT_AJENA, decision: 'Aprobada' }),
    }), env, ctx);
    assert.equal(r.status, 403);
    assert.equal(escrituras.some((e) => e.recId === COT_AJENA), false, 'no se escribió nada');
  });

  await t.test('sin token válido no se decide nada', async () => {
    const r = await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: `${CLIENTE}.zzz.firmaFalsa`, cot: COT, decision: 'Aprobada' }),
    }), env, ctx);
    assert.equal(r.status, 401);
  });

  await t.test('una cotización ya decidida no se vuelve a escribir', async () => {
    const token = await tokenDe(worker);
    escrituras = [];
    const r = await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, cot: COT_CERRADA, decision: 'Rechazada' }),
    }), env, ctx);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).alreadyDecided, true);
    assert.equal(escrituras.length, 0);
  });

  await t.test('revocar corta los links de ese cliente y de nadie más', async () => {
    const suyo = await tokenDe(worker);
    const ajeno = await tokenDe(worker, OTRO_CLIENTE);
    const abre = async (tk) => (await (await worker.fetch(req(`https://worker.example.com/portal?t=${encodeURIComponent(tk)}`), env, ctx)).text()).includes('Ferretería Los Andes');
    assert.equal(await abre(suyo), true, 'antes de revocar, el link abre');

    const sinClave = await worker.fetch(req('https://worker.example.com/portal/revocar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId: CLIENTE }),
    }), env, ctx);
    assert.equal(sinClave.status, 401, 'revocar exige la clave del dashboard');

    const r = await worker.fetch(req('https://worker.example.com/portal/revocar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal-Admin-Key': env.PORTAL_ADMIN_KEY },
      body: JSON.stringify({ clienteId: CLIENTE }),
    }), env, ctx);
    assert.equal(r.status, 200);

    assert.equal(await abre(suyo), false, 'el link revocado ya no abre');
    assert.match(await (await worker.fetch(req(`https://worker.example.com/portal?t=${encodeURIComponent(suyo)}`), env, ctx)).text(), /Enlace inválido/);
    // Tampoco sirve para decidir cotizaciones.
    const dec = await worker.fetch(req('https://worker.example.com/portal/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: suyo, cot: COT, decision: 'Aprobada' }),
    }), env, ctx);
    assert.equal(dec.status, 401);

    // El de otro cliente sigue intacto, y uno nuevo vuelve a funcionar.
    const htmlAjeno = await (await worker.fetch(req(`https://worker.example.com/portal?t=${encodeURIComponent(ajeno)}`), env, ctx)).text();
    assert.doesNotMatch(htmlAjeno, /Enlace inválido/, 'revocar a uno no afecta a los demás');
    assert.equal(await abre(await tokenDe(worker)), true, 'el link nuevo sí abre');
  });

  await t.test('sin KV, revocar avisa en vez de fingir que funcionó', async () => {
    const { RL: _omitido, ...sinKv } = env;
    const r = await worker.fetch(req('https://worker.example.com/portal/revocar', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal-Admin-Key': env.PORTAL_ADMIN_KEY },
      body: JSON.stringify({ clienteId: CLIENTE }),
    }), sinKv, ctx);
    assert.equal(r.status, 501);
    assert.match((await r.json()).error, /KV/);
  });

  await t.test('la ruta pública vieja ya no existe', async () => {
    const r = await worker.fetch(req('https://worker.example.com/cotizacion/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: btoa(COT), decision: 'Aprobada' }),
    }), env, ctx);
    assert.equal(r.status, 404);
  });
});
