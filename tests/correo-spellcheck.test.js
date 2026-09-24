#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const SRC=fs.readFileSync('js/correo-spellcheck.js','utf8');
const LOADER=fs.readFileSync('js/farm-health-adapter.js','utf8');

test('el redactor fuerza corrección ortográfica en español de Chile',()=>{
  assert.match(SRC,/mailCmpSubject/);
  assert.match(SRC,/mailCmpBody/);
  assert.match(SRC,/mailSigEditor/);
  assert.match(SRC,/setAttribute\('lang','es-CL'\)/);
  assert.match(SRC,/setAttribute\('spellcheck','true'\)/);
  assert.match(SRC,/setAttribute\('autocorrect','on'\)/);
  assert.match(SRC,/setAttribute\('autocapitalize','sentences'\)/);
  assert.match(SRC,/setAttribute\('writingsuggestions','true'\)/);
  assert.doesNotMatch(SRC,/el\.spellcheck=false/,'WKWebView no debe desactivar temporalmente spellcheck');
});

test('las faltas se fuerzan visualmente con subrayado rojo ondulado cuando el motor las detecta',()=>{
  assert.match(SRC,/::spelling-error/);
  assert.match(SRC,/::-webkit-spelling-error/);
  assert.match(SRC,/text-decoration-style:wavy/);
  assert.match(SRC,/#ff4d5e/);
});

test('el helper se carga desde el bootstrap visual global',()=>{
  assert.match(LOADER,/load\('js\/correo-spellcheck\.js','corrección ortográfica visible en correo'\)/);
});


test('fallback local marca tildes que WebKit puede aceptar como palabras válidas',()=>{
  const api=require('../js/correo-spellcheck.js');
  assert.equal(api._test.suggestionFor('ademas'),'además');
  assert.equal(api._test.suggestionFor('Tambien'),'También');
  assert.equal(api._test.suggestionFor('informacion'),'información');
  assert.equal(api._test.suggestionFor('correcto'),'');
  assert.match(SRC,/mail-local-spell-error/);
  assert.match(SRC,/Sugerencia: /);
  assert.match(SRC,/text-decoration-style:wavy/);
  assert.match(SRC,/scheduleLint\(\)/);
});

test('las marcas del corrector no se envían dentro del correo',()=>{
  assert.match(SRC,/function cleanHtml\(root\)/);
  assert.match(SRC,/mail\.sendCompose=async function/);
  assert.match(SRC,/clone\.querySelectorAll/);
  const mail=fs.readFileSync('js/correo.js','utf8');
  assert.match(mail,/class="mail-signature-block" contenteditable="false"/,'la firma no debe ser revisada ni alterada por el corrector');
});
