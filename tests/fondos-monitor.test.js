#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {candidates,dt,plain}=require('../scripts/fondos-monitor.js');

const page=[
'<html><body>',
'<section><a>Crece Sostenible 2027 Región Metropolitana</a>',
'<p>Inicio: 02-11-2026 12:00</p><p>Cierre: 21-11-2026 15:00</p>',
'<div>Región Metropolitana</div></section>',
'<section><a>Crece Urbano Los Lagos</a>',
'<p>Inicio: 01-11-2026 12:00</p><p>Cierre: 10-12-2026 15:00</p>',
'<p>Región de Los Lagos</p></section>',
'<section><a>Kit Digital Nacional</a>',
'<p>Inicio: 14-11-2026 12:00</p><p>Cierre: 22-11-2026 15:00</p>',
'<p>Nacional</p></section>',
'<section><a>Crece Nacional erróneo</a>',
'<p>Inicio: 31-11-2026 12:00</p><p>Cierre: 29-12-2026 15:00</p>',
'<p>Nacional</p></section>',
'<section><a>Fondo de Cultura fuera de TLS</a>',
'<p>Inicio: 02-11-2026 12:00</p><p>Cierre: 29-12-2026 15:00</p>',
'<p>Región Metropolitana</p></section>',
'<script>document.write("Crece Inicio: 10-01-2030 Cierre: 11-01-2030 Nacional")</script>',
'</body></html>'].join('\n');

test('crawler conservador: solo llamadas pertinentes y con inicio cierre y región',()=>{
 const rows=candidates(page);
 assert.equal(rows.length,2,JSON.stringify(rows));
 assert.deepEqual(rows.map(x=>x.region).sort(),['Nacional','Región Metropolitana'].sort());
 assert.equal(rows.find(x=>x.title.includes('Sostenible')).open,'2026-11-02T12:00');
 assert.equal(rows.find(x=>x.title.includes('Kit')).close,'2026-11-22T15:00');
 assert.ok(rows.every(x=>x.review.includes('NO publicar')));
 assert.ok(rows.every(x=>x.source==='https://widgetsercotec.sercotec.cl/Calendario'));
});
test('fecha imposible y etiquetas de scripts no se convierten en convocatoria',()=>{
 assert.equal(dt('Cierre 31-02-2026 15:00'),'');
 assert.equal(dt('Cierre 23-13-2026 15:00'),'');
 assert.equal(dt('Apertura por confirmar'),'');
 assert.equal(dt('01-11-2026 26:30'),'');
 assert.equal(dt('01-11-2026 13:90'),'');
 assert.ok(!plain(page).join(' ').includes('document.write'));
});
test('descubrimientos deben verificarse antes de catálogo productivo',()=>{
 const wf=fs.readFileSync(path.join(__dirname,'../.github/workflows/fondos-monitor.yml'),'utf8');
 const script=fs.readFileSync(path.join(__dirname,'../scripts/fondos-monitor.js'),'utf8');
 const curated=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/fondos-concursables.json'),'utf8'));
 assert.match(wf,/add-paths:\s*\|[\s\S]*?data\/fondos-detectados\.json/);
 assert.doesNotMatch(wf,/add-paths: data\/fondos-concursables\.json/);
 assert.match(script,/No calendar dates were auto-published/);
 assert.ok(curated.funds.every(x=>x.source.startsWith('https://')));
});
