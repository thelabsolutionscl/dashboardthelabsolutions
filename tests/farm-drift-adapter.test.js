'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/farm-drift-adapter.js');

test('API de config drift expone operaciones esperadas',()=>{
  assert.equal(typeof api.install,'function');
  assert.equal(typeof api.refresh,'function');
  assert.equal(typeof api.probe,'function');
  assert.equal(typeof api.approve,'function');
  assert.equal(typeof api.clear,'function');
  assert.equal(typeof api.status,'function');
});

test('formato de cambios distingue archivos modificados/agregados/removidos',()=>{
  const txt=api._test.changeText({changes:{changed:['printer.cfg'],added:['nuevo.cfg'],removed:['viejo.cfg']}});
  assert.match(txt,/Δ printer\.cfg/);
  assert.match(txt,/\+ nuevo\.cfg/);
  assert.match(txt,/− viejo\.cfg/);
});

test('estado inicial no inventa alertas',()=>{
  const s=api.status();
  assert.deepEqual(s.alerts,[]);
});
