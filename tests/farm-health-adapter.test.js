#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/farm-health-adapter.js');

test('API de observabilidad expone operaciones de lectura, probe y ack',()=>{
  assert.equal(typeof api.install,'function');
  assert.equal(typeof api.refresh,'function');
  assert.equal(typeof api.probe,'function');
  assert.equal(typeof api.ack,'function');
  assert.equal(typeof api.status,'function');
  const s=api.status();
  assert.equal(s.mode,'checking');
  assert.equal(Array.isArray(s.alerts),true);
  assert.equal(Array.isArray(s.machines),true);
});

test('reconoce sesión corta HMAC y no confunde token legacy',()=>{
  assert.equal(api._test.isShortSession('v1.eyJyb2xlIjoidmlld2VyIn0.abc_DEF-123'),true);
  assert.equal(api._test.isShortSession('bridge-token-largo'),false);
});

test('sanitizador quita bt corto sólo del host del túnel',()=>{
  const short='v1.eyJyb2xlIjoidmlld2VyIn0.abc_DEF-123';
  const hit=api._test.rewriteShortSessionUrl('https://printers.thelab.solutions/farm/health?x=1&bt='+short,'https://printers.thelab.solutions');
  assert.equal(hit.token,short);assert.equal(hit.url.includes('bt='),false);assert.equal(hit.url.includes('x=1'),true);
  assert.equal(api._test.rewriteShortSessionUrl('https://otro.example/farm/health?bt='+short,'https://printers.thelab.solutions'),null);
  assert.equal(api._test.rewriteShortSessionUrl('https://printers.thelab.solutions/farm/health?bt=legacy','https://printers.thelab.solutions'),null);
});
