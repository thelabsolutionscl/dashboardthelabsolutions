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
