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

test('el corrector carga un diccionario completo es-CL local y no depende de una lista corta',()=>{
  assert.match(SRC,/vendor\/spellcheck\/typo\.js/);
  assert.match(SRC,/vendor\/spellcheck\/es_CL\.aff/);
  assert.match(SRC,/vendor\/spellcheck\/es_CL\.dic/);
  assert.match(SRC,/new target\.Typo\('es_CL',aff,dic\)/);
  assert.match(SRC,/dict\.check\(word\)/);
  assert.ok(fs.statSync('vendor/spellcheck/es_CL.dic').size>500000,'el diccionario debe ser el vocabulario completo, no una lista mínima');
  assert.ok(fs.statSync('vendor/spellcheck/es_CL.aff').size>100000,'deben cargarse reglas Hunspell de flexión');
  assert.ok(fs.statSync('vendor/spellcheck/typo.js').size>30000,'Typo.js debe estar vendorizado localmente');
  assert.ok(fs.existsSync('vendor/spellcheck/NOTICE.txt'),'debe conservarse la licencia/atribución de terceros');
});

test('cualquier palabra rechazada por el diccionario se marca como posible falta',()=>{
  const api=require('../js/correo-spellcheck.js');
  const dict={check:w=>['hola','estás','habiendo','sido','correctamente'].includes(String(w).toLowerCase())};
  assert.equal(api._test.wordIssue('hola','hola',0,dict).bad,false);
  assert.equal(api._test.wordIssue('correctamente','correctamente',0,dict).bad,false);
  assert.equal(api._test.wordIssue('inventadisima','inventadisima',0,dict).bad,true);
  assert.equal(api._test.wordIssue('zupercalifrajilistico','zupercalifrajilistico',0,dict).bad,true);
  assert.equal(api._test.wordIssue('hola@thelab.solutions','hola@thelab.solutions',0,dict).bad,false,'emails no deben marcarse como errores');
  assert.equal(api._test.wordIssue('TLS','TLS',0,dict).bad,false,'siglas de negocio deben ignorarse');
});


test('fallback local marca tildes y faltas visibles aunque el navegador no tenga español activo',()=>{
  const api=require('../js/correo-spellcheck.js');
  assert.equal(api._test.suggestionFor('ademas'),'además');
  assert.equal(api._test.suggestionFor('Tambien'),'También');
  assert.equal(api._test.suggestionFor('informacion'),'información');
  assert.equal(api._test.suggestionFor('estaz'),'estás');
  assert.equal(api._test.suggestionFor('gracais'),'gracias');
  assert.equal(api._test.suggestionFor('adjnto'),'adjunto');
  assert.equal(api._test.suggestionFor('abiendo'),'habiendo');
  assert.equal(api._test.suggestionFor('zido'),'sido');
  assert.equal(api._test.suggestionFor('aser'),'hacer');
  assert.equal(api._test.suggestionFor('correcto'),'');
  assert.equal(api._test.suggestionFor('como'),'','no debe inventar un error contextual donde la palabra puede ser válida');
  assert.match(SRC,/mail-local-spell-error/);
  assert.match(SRC,/Sugerencia: /);
  assert.match(SRC,/text-decoration-style:wavy/);
  assert.match(SRC,/COMMON_WORDS/);
  assert.match(SRC,/missingInitialH/);
  assert.match(SRC,/phoneticFirst/);
  assert.match(SRC,/oneEditAway/);
  assert.match(SRC,/scheduleLint\(\)/);
});

test('Enter y Shift+Enter conservan el salto de línea del editor',()=>{
  const api=require('../js/correo-spellcheck.js');
  assert.equal(api._test.isLineBreakInput({inputType:'insertParagraph'}),true);
  assert.equal(api._test.isLineBreakInput({inputType:'insertLineBreak'}),true);
  assert.equal(api._test.isLineBreakInput({inputType:'insertText'}),false);
  assert.match(SRC,/if\(isLineBreakInput\(e\)\)\{clearTimeout\(timer\);return;\}/,'el corrector debe cancelar cualquier lint pendiente al insertar un salto');
  assert.match(SRC,/if\(domChanged\)restoreSelection\(root,saved\)/,'un lint que no cambió el DOM no debe mover el caret');
});

test('las marcas del corrector no se envían dentro del correo',()=>{
  assert.match(SRC,/function cleanHtml\(root\)/);
  assert.match(SRC,/mail\.sendCompose=async function/);
  assert.match(SRC,/clone\.querySelectorAll/);
  const mail=fs.readFileSync('js/correo.js','utf8');
  assert.match(mail,/class="mail-signature-block" contenteditable="false"/,'la firma no debe ser revisada ni alterada por el corrector');
});
