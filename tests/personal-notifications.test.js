#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const NOTIFY=fs.readFileSync(path.join(root,'js','notify.js'),'utf8');
const BADGES=fs.readFileSync(path.join(root,'js','dashboard-notification-badges.js'),'utf8');
const MACH=fs.readFileSync(path.join(root,'js','maquinas-operaciones.js'),'utf8');
const CSS=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const WA=fs.readFileSync(path.join(root,'lead-worker','src','wa-notify.js'),'utf8');

test('la matriz de destinatarios coincide con Nicanor y Gustavo',()=>{
  assert.match(WA,/lead:\s*\["nicanor",\s*"gustavo"\]/);
  assert.match(WA,/cotizacion_envio:\s*\["nicanor"\]/);
  assert.match(WA,/pedido_vencimiento:\s*\["gustavo"\]/);
  assert.match(WA,/impresora:\s*\["gustavo"\]/);
});

test('las tarjetas globales son personales, persistentes y accionables',()=>{
  assert.match(NOTIFY,/persona\(\)[\s\S]*?includes\('nicanor'\)[\s\S]*?includes\('gustavo'\)/);
  assert.match(NOTIFY,/priority\(kind,title,sub,action,opts=\{\}\)/);
  assert.match(NOTIFY,/id='tlsPersonalNotifications'|id="tlsPersonalNotifications"|host\.id='tlsPersonalNotifications'/);
  assert.match(NOTIFY,/Abrir<\/button>/);
  assert.match(NOTIFY,/Descartar<\/button>/);
  assert.match(CSS,/\.tls-personal-alerts\{/);
  assert.match(CSS,/\.tls-personal-alert\.tone-danger/);
  assert.match(CSS,/\.tls-personal-alert\.tone-warning/);
  assert.match(CSS,/\.tls-personal-alert\.tone-success/);
});

test('cotizaciones van a Nicanor y vencimientos de pedido a Gustavo',()=>{
  assert.match(NOTIFY,/a\.type==='cot-sin-enviar'[\s\S]*?personas:\['nicanor'\]/);
  assert.match(NOTIFY,/a\.type==='pedido-atrasado'\|\|a\.type==='pedido-urgente'[\s\S]*?personas:\['gustavo'\]/);
});

test('correo monitorea la cuenta personal y hola sin exigir que estén activas',()=>{
  assert.match(NOTIFY,/function _mailRelevantAccounts\(\)/);
  assert.match(NOTIFY,/return\[own,'hola@thelab\.solutions'\]/);
  assert.match(NOTIFY,/MAIL\.postAs\(email,\{action:'check'\}\)/);
  assert.match(NOTIFY,/NOTIFY\.priority\('mail','Nuevo correo electrónico'/);
  assert.match(NOTIFY,/personas:\[_mailPersona\(\)\]/);
});

test('los leads nuevos generan tarjeta para ambos sin depender solo del contador',()=>{
  assert.match(BADGES,/function syncLeadPriority\(rows\)/);
  assert.match(BADGES,/thelab_lead_seen_v2_/);
  assert.match(BADGES,/target\.NOTIFY\.priority\('lead','Nuevo lead'/);
  assert.match(BADGES,/personas:\['nicanor','gustavo'\]/);
});

test('final de impresión y error generan aviso solo para Gustavo',()=>{
  assert.match(MACH,/NOTIFY\.priority\('printer','Impresión finalizada · '/);
  assert.match(MACH,/NOTIFY\.priority\('printer','Impresión con error · '/);
  const printerCalls=MACH.match(/NOTIFY\.priority\('printer'[\s\S]{0,500}?personas:\['gustavo'\]/g)||[];
  assert.ok(printerCalls.length>=2,'finalizada y error deben ir a Gustavo');
});
