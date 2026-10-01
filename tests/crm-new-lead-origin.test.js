#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const machines=fs.readFileSync(path.join(root,'js/maquinas.js'),'utf8');
const createLead=html.split('function createLead(){')[1]?.split('\nfunction ')[0]||'';
const clearForm=machines.split('function clearForm(type){')[1]?.split('\n}')[0]||'';

test('formulario de lead permite origen explícitamente desconocido',()=>{
  assert.match(html, /id="nl-origen"><option value="">— Sin atribución · por verificar —<\/option><option>Referido<\/option>/);
});
test('limpiar lead no selecciona Referido por defecto',()=>{
  assert.match(clearForm, /getElementById\('nl-origen'\)\.value='';/);
  assert.doesNotMatch(clearForm, /getElementById\('nl-origen'\)\.value='Referido'/);
});
test('crear lead omite origen si nadie seleccionó fuente',()=>{
  assert.match(createLead, /if\(!fields\['Origen lead'\]\) delete fields\['Origen lead'\];/);
});

test('las tres altas omiten fecha no confirmada, sin asignar hoy por defecto',()=>{
  const guided=html.split('function startNewClientFlow(){')[1]?.split('// ── Editar cliente (guiado)')[0]||'';
  const quick=html.split('async function gfClientCreate(){')[1]?.split('// ── Paso ')[0]||'';
  assert.doesNotMatch(createLead,/['"]Fecha primer contacto['"]\s*:\s*hoyCL\(\)/);
  assert.doesNotMatch(guided,/['"]Fecha primer contacto['"]\s*:\s*hoyCL\(\)/);
  assert.doesNotMatch(quick,/['"]Fecha primer contacto['"]\s*:\s*hoyCL\(\)/);
  assert.match(createLead,/if\(provenance.date\)fields\['Fecha primer contacto'\]=provenance.date/);
  assert.match(guided,/if\(provenance.date\)f\['Fecha primer contacto'\]=provenance.date/);
});
test('la fecha explícita antigua exige respaldo, la desconocida sigue vacía',()=>{
  const source=html.split('function _crmNewClientProvenance(')[1]?.split('async function createLead(){')[0]||'';
  assert.ok(source);
  const date=v=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)?v:null;
  const fn=new Function('_crmAuditDate','hoyCL','return function _crmNewClientProvenance('+source+';')(date,()=> '2026-09-29');
  assert.deepEqual(fn('',''),{date:'',note:''});
  assert.deepEqual(fn('2026-09-29',''),{date:'2026-09-29',note:''});
  assert.throws(()=>fn('2026-06-10','sin prueba'),/referencia verificable/);
  assert.throws(()=>fn('2026-10-10','email original 10-10-2026'),/no futura/);
  assert.throws(()=>fn('','email original 10-06-2026'),/Indica la fecha/);
  const documented=fn('2026-06-10','Primer correo recibido el 10 de junio');
  assert.equal(documented.date,'2026-06-10');
  assert.match(documented.note,/Evidencia: Primer correo/);
});
test('el formulario guiado y normal solicitan fecha, y limpiar borra su evidencia',()=>{
  assert.match(html,/id="nl-primer-contacto" type="date"/);
  assert.match(html,/id="nl-evidencia-contacto"/);
  const guided=html.split('function startNewClientFlow(){')[1]?.split('// ── Editar cliente (guiado)')[0]||'';
  assert.match(guided,/key:'fechaPrimerContacto',type:'date'/);
  assert.match(guided,/key:'evidenciaPrimerContacto'/);
  assert.match(clearForm,/nl-primer-contacto/);
  assert.match(clearForm,/nl-evidencia-contacto/);
});
