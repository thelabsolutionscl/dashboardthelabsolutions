#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const INDEX=fs.readFileSync('index.html','utf8');
const CAL=fs.readFileSync('js/calendario-operaciones.js','utf8');
const FIN=fs.readFileSync('js/finanzas.js','utf8');

test('Calendario expone Pantalla completa TV propia',()=>{
  assert.ok(INDEX.includes('onclick="tvStartCalendario()"'));
  assert.ok(INDEX.includes('📺 Pantalla completa (TV)'));
  assert.ok(INDEX.includes("function tvStartCalendario()"));
  assert.ok(INDEX.includes("tvStart('calendario')"));
});

test('TV Calendario reutiliza la sección real y la restaura',()=>{
  assert.ok(INDEX.includes("document.getElementById('tab-calendario')"));
  assert.ok(INDEX.includes("host.appendChild(tab)"));
  assert.ok(INDEX.includes("function _tvUnmountCalendario()"));
  assert.ok(INDEX.includes("wasCalendario=_tvMode==='calendario'"));
});

test('Calendario no crea una segunda capa TV',()=>{
  assert.ok(CAL.includes('window.tvStartCalendario'));
  assert.equal(CAL.includes("d.className='cal-tv'"),false);
  assert.ok(FIN.includes("title:'Pantalla completa (TV) · Calendario'"));
});
