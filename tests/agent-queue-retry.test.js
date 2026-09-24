#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const SRC=fs.readFileSync('index.html','utf8');

function block(name,next){
  const a=SRC.indexOf(name);
  assert.ok(a>=0,'falta '+name);
  const b=SRC.indexOf(next,a+name.length);
  assert.ok(b>a,'falta límite '+next);
  return SRC.slice(a,b);
}

test('cola permite reintentar Error y recuperar Procesando atascado',()=>{
  const render=block('function renderAgentQueue(){','async function refreshAgentQueue');
  assert.match(render,/_aqIsStaleProcessing/);
  assert.match(render,/↻ Reintentar/);
  assert.match(render,/↻ Recuperar/);
  assert.match(render,/Saldo Anthropic insuficiente/);
});

test('procesar pendientes incluye errores y atascados',()=>{
  const body=block('async function processAllPendingAgentQueue(){','// ── WATI WhatsApp API');
  assert.match(body,/filter\(_aqIsRetryable\)/);
  assert.match(body,/_aqStatus\(r\)==='Error'/);
  assert.match(body,/_aqIsStaleProcessing/);
  assert.match(body,/if\(res\?\.fatal\)/,'debe frenar el lote ante un error de billing/configuración');
});

test('cada reintento limpia el error previo antes de llamar a IA',()=>{
  const body=block('async function processAgentQueueItem(recordId){','async function processAllPendingAgentQueue');
  assert.match(body,/runningPatch=\{'Estado':'Procesando','Error':''\}/);
  assert.match(body,/patch=\{'Estado':'Completado','Output':[\s\S]*?'Error':''/);
  assert.match(body,/return\{ok:false,error:msg,fatal:_aqFatalError\(msg\)\}/);
});

test('errores de crédito Anthropic se explican y no disparan todo el lote',()=>{
  const helpers=block('function _aqErrorLabel','function renderAgentQueue');
  assert.match(helpers,/credit balance is too low/);
  assert.match(helpers,/Saldo Anthropic insuficiente/);
  assert.match(helpers,/function _aqFatalError/);
});
