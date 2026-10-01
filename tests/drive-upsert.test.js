#!/usr/bin/env node
/*
 * Guardar en Drive: reguardar una propuesta no puede duplicar archivos.
 *
 * guardarFichaEnDrive subía las fotos, las vistas y el PDF con funciones de
 * CREACIÓN pura. Drive permite dos archivos con el mismo nombre en una carpeta,
 * así que cada "Guardar en Drive" de la misma cotización dejaba otra copia:
 * dos guardados → dos ficha_propuesta_COT-xxx.pdf, tres → tres, y el cliente
 * abría la carpeta sin saber cuál es la vigente. El módulo ya tenía
 * _driveUpsertFile ("crea o reemplaza, evita duplicados"), pero ese camino no
 * lo usaba.
 *
 * Se montan las funciones REALES sobre un Drive simulado en memoria.
 *
 * Correr:  node --test tests/drive-upsert.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DRIVE = fs.readFileSync(path.join(__dirname, '..', 'js', 'drive.js'), 'utf8');

function bloque(marca) {
  const i = DRIVE.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  // El cuerpo empieza en el '{' que sigue al ')' de los parámetros — así un
  // default como opts={} en la firma no confunde el conteo de llaves.
  const cierraParams = DRIVE.indexOf(')', i);
  let d = 0;
  for (let x = DRIVE.indexOf('{', cierraParams); x < DRIVE.length; x++) {
    if (DRIVE[x] === '{') d++;
    if (DRIVE[x] === '}') { d--; if (!d) return DRIVE.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// Un Google Drive de mentira: una carpeta con archivos {id,name}. Registra cada
// operación para poder afirmar que hubo PATCH y no un segundo create.
function montar() {
  const files = [];         // {id, name}
  const ops = [];           // 'create' | 'patch' | 'search'
  let seq = 0;
  const _res = (obj, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => obj, blob: async () => obj });

  async function fakeFetch(url, opts = {}) {
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    // Búsqueda por nombre en carpeta
    if (u.includes('/drive/v3/files?') && u.includes('q=')) {
      ops.push('search');
      const q = decodeURIComponent(u.split('q=')[1].split('&')[0]);
      const m = q.match(/name='([^']*)'/);
      const nombre = m ? m[1].replace(/\\'/g, "'") : '';
      const hit = files.filter((f) => f.name === nombre);
      return _res({ files: hit.map((f) => ({ id: f.id })) });
    }
    // PATCH (reemplazo de contenido) sobre un id existente
    if (u.includes('/upload/drive/v3/files/') && method === 'PATCH') {
      ops.push('patch');
      const id = u.split('/upload/drive/v3/files/')[1].split('?')[0];
      return _res({ id });
    }
    // Create multipart
    if (u.includes('/upload/drive/v3/files?') && method === 'POST') {
      ops.push('create');
      // El nombre va dentro del metadata del FormData; el fake lo recibe por canal aparte.
      const nombre = opts.__nombre || ('archivo_' + (++seq));
      const id = 'file_' + (++seq);
      files.push({ id, name: nombre });
      return _res({ id, webViewLink: 'https://drive/' + id });
    }
    return _res({}, false);
  }

  // FormData de mentira: solo necesita capturar el nombre del metadata para el fake.
  class FakeForm {
    constructor() { this._nombre = null; }
    append(k, v) { if (k === 'metadata' && v && v._json) { try { this._nombre = JSON.parse(v._json).name; } catch (_) {} } }
  }
  class FakeBlob {
    constructor(parts, opts) { this.type = (opts && opts.type) || ''; this._json = (parts && parts[0] && typeof parts[0] === 'string') ? parts[0] : null; }
  }
  // fetch necesita ver el nombre del create: se lee del FakeForm.
  const fetchWrap = (url, opts = {}) => {
    if (opts.body instanceof FakeForm) opts = { ...opts, __nombre: opts.body._nombre };
    return fakeFetch(url, opts);
  };

  const ctx = {
    fetch: fetchWrap,
    FormData: FakeForm,
    Blob: FakeBlob,
    _driveGetToken: async () => 'tok',
  };
  const piezas = [
    bloque('async function _driveApiFetch('),
    bloque('async function _driveUploadFile('),
    bloque('async function _driveUpsertFile('),
    bloque('async function _driveUpsertDataUrl('),
  ].join('\n');
  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, `${piezas}\nreturn {_driveUpsertFile,_driveUpsertDataUrl};`)(...nombres.map((n) => ctx[n]));
  return { api, files, ops };
}

// ── Upsert real ─────────────────────────────────────────────────────────

test('subir un archivo nuevo lo crea', async () => {
  const m = montar();
  await m.api._driveUpsertFile('folder1', 'ficha.pdf', new (class { })(), 'application/pdf');
  assert.equal(m.files.filter((f) => f.name === 'ficha.pdf').length, 1);
  assert.ok(m.ops.includes('create'));
});

test('subir el MISMO nombre otra vez reemplaza, no duplica', async () => {
  const m = montar();
  await m.api._driveUpsertFile('folder1', 'ficha.pdf', {}, 'application/pdf');
  await m.api._driveUpsertFile('folder1', 'ficha.pdf', {}, 'application/pdf');
  await m.api._driveUpsertFile('folder1', 'ficha.pdf', {}, 'application/pdf');
  assert.equal(m.files.filter((f) => f.name === 'ficha.pdf').length, 1, 'un solo archivo tras tres guardados');
  assert.equal(m.ops.filter((o) => o === 'create').length, 1, 'un solo create');
  assert.equal(m.ops.filter((o) => o === 'patch').length, 2, 'dos reemplazos');
});

test('nombres distintos conviven', async () => {
  const m = montar();
  await m.api._driveUpsertFile('f', 'foto_1.jpg', {}, 'image/jpeg');
  await m.api._driveUpsertFile('f', 'foto_2.jpg', {}, 'image/jpeg');
  assert.equal(m.files.length, 2);
});

// ── El camino de guardar la propuesta usa upsert, no create ─────────────

test('guardarFichaEnDrive ya no usa las funciones de creación pura', () => {
  const fn = bloque('async function guardarFichaEnDrive(');
  assert.doesNotMatch(fn, /_driveUploadDataUrl\(/, 'las fotos y vistas ya no se crean a ciegas');
  assert.doesNotMatch(fn, /_driveUploadText\(/, 'ni el fallback HTML');
  assert.doesNotMatch(fn, /uploadType=multipart&fields=id',\{\s*\n?\s*method:'POST'/, 'ni el POST directo del PDF');
  assert.match(fn, /_driveUpsertDataUrl\(cotFolderId,'foto_producto_/, 'la foto va por upsert');
  assert.match(fn, /_driveUpsertDataUrl\(cotFolderId,'muestra_/, 'la vista va por upsert');
  assert.match(fn, /_driveUpsertFile\(cotFolderId,'ficha_propuesta_'\+numCot\+'\.pdf'/, 'el PDF va por upsert');
  assert.match(fn, /_driveUpsertFile\(cotFolderId,'ficha_propuesta_'\+numCot\+'\.html'/, 'y el fallback HTML también');
});

test('el helper de data URL delega en el upsert por nombre', () => {
  const fn = bloque('async function _driveUpsertDataUrl(');
  assert.match(fn, /_driveUpsertFile\(folderId,filename,blob/, 'reusa el upsert, no crea uno nuevo');
  assert.match(fn, /await fetch\(dataUrl\)/, 'convierte el data URL a blob');
});

test('subirFactura sigue avisando si el enlace no se guarda', () => {
  // No es upsert (el cliente elige el archivo), pero su guardado del enlace en
  // el pedido debe seguir avisando en vez de perderse en silencio.
  const fn = bloque('async function subirFactura(');
  assert.match(fn, /avisoNoGuardado\(/);
});
