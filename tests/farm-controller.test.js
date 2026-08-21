#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

process.env.BRIDGE_TOKEN='admin-test-token';
process.env.BRIDGE_OPERATOR_TOKEN='operator-test-token';
process.env.BRIDGE_VIEWER_TOKEN='viewer-test-token';
process.env.FARM_DISCOVERY_ENABLED='0';
const api=require(path.join(__dirname,'..','printer-bridge','farm-controller.js'));

test('solo acepta IPv4 privadas como destino de impresoras',()=>{
  for(const ip of ['192.168.100.51','10.0.0.2','172.16.1.1','127.0.0.1'])assert.equal(api.isPrivateIp(ip),true);
  for(const ip of ['8.8.8.8','1.1.1.1','192.168.999.1','localhost'])assert.equal(api.isPrivateIp(ip),false);
});

test('tokens se separan en viewer operator admin',()=>{
  assert.equal(api.roleForToken('viewer-test-token'),'viewer');
  assert.equal(api.roleForToken('operator-test-token'),'operator');
  assert.equal(api.roleForToken('admin-test-token'),'admin');
  assert.equal(api.roleForToken('incorrecto'),'');
});

test('rutas destructivas exigen admin y lectura solo viewer',()=>{
  assert.equal(api.routeMinimumRole({method:'GET'},'/192.168.100.51/printer/info'),'viewer');
  assert.equal(api.routeMinimumRole({method:'POST'},'/192.168.100.51/printer/print/start'),'operator');
  assert.equal(api.routeMinimumRole({method:'POST'},'/recover/192.168.100.51'),'admin');
  assert.equal(api.routeMinimumRole({method:'POST'},'/update'),'admin');
});

test('persistencia normaliza documentos dañados o incompletos',()=>{
  assert.deepEqual(api.normalizeQueue(null).jobs,[]);
  assert.deepEqual(api.normalizeRegistry({machines:'bad'}).machines,[]);
});
