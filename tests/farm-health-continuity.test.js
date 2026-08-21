#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.FARM_HEALTH_PRELOAD_DISABLE='1';
const health=require('../printer-bridge/farm-health-preload.js');

test('reconstruye alertas que seguían abiertas antes de reiniciar el controller',()=>{
  const active=health.activeAlertIdsFromEvents([
    {alertId:'machine:k1:offline',state:'opened',at:100},
    {alertId:'machine:k2:offline',state:'opened',at:110},
    {alertId:'machine:k1:offline',state:'resolved',at:120},
  ]);
  assert.equal(active.has('machine:k1:offline'),false);
  assert.equal(active.has('machine:k2:offline'),true);
});

test('eventos fuera de orden se reconstruyen cronológicamente',()=>{
  const active=health.activeAlertIdsFromEvents([
    {alertId:'machine:k1:offline',state:'resolved',at:300},
    {alertId:'machine:k1:offline',state:'opened',at:100},
    {alertId:'machine:k1:offline',state:'opened',at:200},
  ]);
  assert.equal(active.size,0);
});

test('health normalizado conserva inicio de cobertura',()=>{
  const n=health.normalizeStoredHealth({startedAt:123,updatedAt:456,events:[]});
  assert.equal(n.startedAt,123);
  assert.equal(n.updatedAt,456);
  assert.equal(n.version,2);
});
