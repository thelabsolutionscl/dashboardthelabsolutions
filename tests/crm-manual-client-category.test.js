#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const cards=fs.readFileSync(path.join(root,'js/operativo-secciones.js'),'utf8');
const worker=fs.readFileSync(path.join(root,'lead-worker/src/index.js'),'utf8');
const slice=(start,end)=>{
  const a=html.indexOf(start);assert.ok(a>=0,'falta '+start);
  const b=html.indexOf(end,a+start.length);assert.ok(b>a,'falta delimitador '+end);
  return html.slice(a,b);
};
const normal=slice('async function createLead(){','// ── NUEVA COT');
const quick=slice('async function gfClientCreate(){','// ── Paso review');
const guided=slice('function startNewClientFlow(){','// ── Editar cliente (guiado)');
test('alta manual del formulario normal entra directamente en Clientes',()=>{
  assert.match(normal,/['"]Validado['"]:\s*true/);
  assert.doesNotMatch(normal,/['"]Validado['"]:\s*false/);
  assert.match(normal,/setCliCat\('cliente'\)/);
  assert.match(normal,/switchTab\('clientes'\)/);
  assert.match(normal,/_mergeRecords\(state\.clientes,\[rec\]\)/,'la creación debe verse sin esperar el refresco remoto');
});
test('alta rápida desde cotizador no crea un lead por accidente',()=>{
  assert.match(quick,/['"]Validado['"]:\s*true/);
  assert.doesNotMatch(quick,/['"]Validado['"]:\s*false/);
  assert.match(quick,/GF\.answers\.clienteId=rec\.id/);
});
test('flujo guiado crea cliente aunque origen real sea Instagram o LinkedIn',()=>{
  assert.match(guided,/['"]Validado['"]:\s*true/);
  assert.doesNotMatch(guided,/['"]Validado['"]:\s*false/);
  assert.match(guided,/if\(a\.origen\)f\['Origen lead'\]=a\.origen/);
  assert.match(guided,/setCliCat\('cliente'\)/);
});
test('la interfaz presenta la creación manual como Nuevo cliente, no como Nuevo lead',()=>{
  assert.match(html,/id="tab-nuevo-lead"[\s\S]*?<div class="section-title">Nuevo cliente<\/div>/);
  assert.match(html,/id="createLeadBtn"[^>]*>✚ Crear cliente<\/button>/);
  assert.match(cards,/data-ops="client-new"[^>]*>[\s\S]*?<b>Nuevo cliente<\/b>/);
  assert.doesNotMatch(cards,/data-ops="client-new"[^>]*>[\s\S]*?<b>Nuevo lead<\/b>/);
});
test('las integraciones digitales conservan la condición LEAD sin validar',()=>{
  assert.match(worker,/Validado:\s*false/);
  assert.match(worker,/source:\s*"linkedin"/);
  assert.match(worker,/source:\s*"google_ads"/);
});
