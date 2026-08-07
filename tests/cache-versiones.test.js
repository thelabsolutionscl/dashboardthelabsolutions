#!/usr/bin/env node
/*
 * Que la versión desplegada llegue de verdad al navegador.
 *
 * De nada sirve arreglar algo si el dashboard sigue corriendo el código viejo.
 * Dos formas de que eso pase:
 *   · Al recargar, el shell venía de la caché HTTP del navegador (GitHub Pages
 *     sirve el HTML con max-age=600), y con él las referencias ?v= viejas, que
 *     el service worker sirve desde su propia caché. Diez minutos con la app
 *     entera desactualizada, y solo se salía con Ctrl+Shift+R.
 *   · Una pestaña abierta todo el día no recarga nunca: seguía con el código
 *     viejo indefinidamente, sin enterarse de que había una versión nueva.
 *
 * El flujo completo (instalar, no molestar en la primera visita, avisar cuando
 * llega una versión nueva con la pestaña abierta, no recargar solo) se verificó
 * en un navegador real contra un service worker real. Esto fija las piezas para
 * que no se deshagan.
 *
 * Correr:  node --test tests/cache-versiones.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const DEPLOY = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

// El bloque de registro del service worker, tal cual va en la página.
const REGISTRO = (() => {
  const i = HTML.indexOf("'serviceWorker' in navigator");
  assert.ok(i > 0, 'debe registrarse el service worker');
  return HTML.slice(Math.max(0, i - 600), HTML.indexOf('</scr' + 'ipt>', i));
})();

test('el deploy sella index.html y el service worker con la misma versión', () => {
  // Si sw.js no llevara sello, su contenido no cambiaría entre despliegues y el
  // navegador no tendría motivo para instalar el nuevo.
  assert.match(DEPLOY, /sed -i "s\|%%BUILD%%\|\$\{GITHUB_SHA::8\}\|g" index\.html sw\.js/,
    'el sellado debe cubrir index.html y sw.js');
  assert.match(SW, /%%BUILD%%/, 'sw.js debe llevar el marcador de versión');
  assert.match(HTML, /register\('sw\.js\?v=%%BUILD%%'\)/, 'el registro debe apuntar a la versión sellada');
});

test('todo lo propio que carga la página va versionado', () => {
  // Sin ?v=, un archivo cambiado se seguiría sirviendo desde la caché del
  // navegador. Los CDN externos no aplican: no los sirve el service worker.
  const refs = [...HTML.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g)].map((m) => m[1]);
  const propios = refs.filter((u) => !/^https?:\/\//.test(u) && /\.(js|css)$/.test(u.split('?')[0]));
  const sinVersion = propios.filter((u) => !u.includes('?v='));
  assert.deepEqual(sinVersion, [], `Cargas propias sin versión: ${sinVersion.join(', ')}`);
  assert.ok(propios.length >= 10, 'la comprobación debe estar mirando archivos de verdad');
});

test('el shell se revalida contra el servidor en vez de salir de la caché HTTP', () => {
  const nav = SW.slice(SW.indexOf("req.mode === 'navigate'"), SW.indexOf("url.searchParams.has('v')"));
  assert.match(nav, /fetch\(req,\s*\{\s*cache:\s*'no-cache'\s*\}\)/,
    'la navegación debe forzar revalidación');
  assert.match(nav, /catch\(\)\s*=>\s*caches\.match\(req\)|\.catch\(\(\) => caches\.match\(req\)\)/,
    'y conservar el respaldo sin conexión');
});

test('los archivos versionados se sirven de caché y los viejos se purgan', () => {
  assert.match(SW, /url\.searchParams\.has\('v'\)/, 'los ?v= son inmutables por URL: caché primero');
  assert.match(SW, /keys\.filter\(k => k\.startsWith\('thelab-'\) && k !== CACHE\)\.map\(k => caches\.delete\(k\)\)/,
    'al activar una versión nueva deben borrarse las cachés anteriores');
  assert.match(SW, /skipWaiting\(\)/);
  assert.match(SW, /clients\.claim\(\)/);
});

test('nada que no sea del propio sitio pasa por la caché', () => {
  // Airtable, el proxy y los workers nunca deben servirse de caché: son datos vivos.
  assert.match(SW, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(SW, /if \(req\.method !== 'GET'\) return;/);
});

test('avisa cuando hay versión nueva, pero no en la primera visita', () => {
  // Sin la guarda, el aviso saltaría en cada instalación inicial: ruido puro.
  assert.match(REGISTRO, /const _habiaSW\s*=\s*!!navigator\.serviceWorker\.controller/,
    'debe recordarse si ya había un service worker antes');
  assert.match(REGISTRO, /addEventListener\('controllerchange'[\s\S]{0,160}?if\(_habiaSW\)\s*_avisarVersionNueva\(\)/,
    'solo se avisa si la pestaña ya venía controlada');
});

test('una pestaña de todo el día llega a enterarse', () => {
  // El navegador solo busca versiones nuevas al cargar la página. Sin una
  // comprobación periódica, el aviso no se dispararía nunca donde más falta.
  assert.match(REGISTRO, /reg\.update\(\)/, 'debe buscarse activamente una versión nueva');
  assert.match(REGISTRO, /visibilitychange/, 'al volver a la pestaña');
  assert.match(REGISTRO, /setInterval\(buscar/, 'y cada cierto rato');
  assert.match(REGISTRO, /document\.visibilityState!=='visible'\|\|!navigator\.onLine/,
    'sin gastar red con la pestaña oculta o sin conexión');
});

test('el aviso no recarga solo', () => {
  const fn = HTML.slice(HTML.indexOf('function _avisarVersionNueva'), HTML.indexOf('function _avisarVersionNueva') + 1800);
  assert.ok(fn.length > 100, 'debe existir el aviso');
  assert.match(fn, /versionBannerGo'\)\.onclick=\(\)=>location\.reload\(\)/,
    'recargar debe ser una decisión del usuario');
  assert.match(fn, /versionBannerNo'\)\.onclick/, 'y debe poder descartarse');
  // Podrías estar a medio redactar un correo: nada de recargar por tu cuenta.
  const recargas = (fn.match(/location\.reload\(\)/g) || []).length;
  assert.equal(recargas, 1, 'la única recarga permitida es la del botón');
  assert.doesNotMatch(fn, /setTimeout\([^)]*reload/, 'ni recarga diferida');
  assert.match(fn, /if\(document\.getElementById\('versionBanner'\)\) return;/, 'y no debe duplicarse');
});

test('el service worker también funciona en localhost', () => {
  // localhost es contexto seguro por especificación. Exigir solo https dejaba
  // el service worker muerto en local, que es donde se puede probar todo esto.
  assert.match(REGISTRO, /location\.protocol==='https:'\|\|\['localhost','127\.0\.0\.1','\[::1\]'\]\.includes\(location\.hostname\)/);
});

test('una caché de datos con formato viejo se descarta en vez de pintarse', () => {
  const fn = HTML.slice(HTML.indexOf('function _hydrateFromCache'), HTML.indexOf('function _hydrateFromCache') + 1200);
  assert.match(HTML, /JSON\.stringify\(\{v:1,/, 'el snapshot se guarda con número de formato');
  assert.match(fn, /if\(o\.v!==1\)/, 'y ese número tiene que comprobarse al leerlo');
  assert.match(fn, /removeItem\(k\)/, 'descartando la caché incompatible');
});
