'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const api=require('../js/machineops-farm-queue-adapter.js');
test('prioridad se traduce de forma estable',()=>{assert.equal(api._test.priorityValue('urgente'),90);assert.equal(api._test.priorityValue('normal'),50);assert.equal(api._test.priorityValue('x'),50);});
test('farmJobId se deriva de MachineOps y no depende de localStorage',()=>{assert.equal(api._test.farmJobIdForMachineOps('job-123'),'mops-job-123');assert.equal(api._test.farmJobIdForMachineOps('pedido / pieza #2'),'mops-pedido___pieza__2');assert.equal(api._test.farmJobIdForMachineOps(''),'');});
