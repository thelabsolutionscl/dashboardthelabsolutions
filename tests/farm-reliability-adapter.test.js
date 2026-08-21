#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../js/farm-reliability-adapter.js');

test('cliente expone refresh, rango, estado y render',()=>{
  assert.equal(typeof api.install,'function');
  assert.equal(typeof api.refresh,'function');
  assert.equal(typeof api.setDays,'function');
  assert.equal(typeof api.status,'function');
  assert.equal(typeof api.render,'function');
});

test('formatos no inventan valores cuando no existe dato',()=>{
  assert.equal(api._test.fmtPct(null),'0.0%');
  assert.equal(api._test.fmtHours(undefined),'—');
});

test('clasificación visual usa umbrales explícitos',()=>{
  assert.equal(api._test.metricClass(99,98,95),'good');
  assert.equal(api._test.metricClass(96,98,95),'warn');
  assert.equal(api._test.metricClass(90,98,95),'bad');
});
