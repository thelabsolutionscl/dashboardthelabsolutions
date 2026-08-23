'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const api=require('../js/machineops-farm-queue-adapter.js');
test('prioridad se traduce de forma estable',()=>{assert.equal(api._test.priorityValue('urgente'),90);assert.equal(api._test.priorityValue('normal'),50);assert.equal(api._test.priorityValue('x'),50);});
test('ruta G-code codifica segmentos sin perder carpetas',()=>{assert.equal(api._test.encodeFilePath('/jobs/mi pieza.gcode'),'jobs/mi%20pieza.gcode');});
