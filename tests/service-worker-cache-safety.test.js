'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

test('service worker no reescribe ni inyecta scripts en index.html',()=>{
  assert.doesNotMatch(sw,/function\s+injectFarmController/);
  assert.doesNotMatch(sw,/const\s+FARM_SCRIPT\s*=/);
  assert.doesNotMatch(sw,/html\.replace\(/);
});

test('navegación usa red y no persiste el HTML en Cache Storage',()=>{
  assert.match(sw,/req\.mode === 'navigate'/);
  assert.match(sw,/fetch\(req, \{cache:'reload'\}\)/);
  const navigationBlock=sw.slice(sw.indexOf("if (req.mode === 'navigate'"),sw.indexOf('// Sólo assets con versión explícita'));
  assert.doesNotMatch(navigationBlock,/cache\.put|c\.put|caches\.open/);
});

test('assets persistentes exigen versión explícita',()=>{
  assert.match(sw,/url\.searchParams\.has\('v'\)/);
  assert.match(sw,/const CACHE = 'thelab-' \+ VERSION/);
});

test('activación elimina caches de builds anteriores',()=>{
  assert.match(sw,/key\.startsWith\('thelab-'\) && key !== CACHE/);
  assert.match(sw,/caches\.delete\(key\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
});

test('sin red muestra error explícito en vez de shell negro cacheado',()=>{
  assert.match(sw,/offlineNavigationResponse/);
  assert.match(sw,/Sin conexión/);
  assert.match(sw,/status: 503/);
});
