#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {official,signal,audit} = require('../scripts/fondos-watch-corfo.js');
const root = path.join(__dirname,'..');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'data/fondos-concursables.json'),'utf8'));
const ids = [
  'corfo-semilla-inicia-nueva-vigilar',
  'corfo-semilla-expande-nueva-vigilar',
  'corfo-crea-y-valida-proxima-vigilar',
  'startupchile-big-proximo-vigilar'
];

test('los cuatro fondos de noviembre se vigilan sin inventar aperturas, cierres ni correos',async()=>{
  for(const id of ids){
    const fund = catalog.funds.find(x=>x.id===id);
    assert.ok(fund,id);
    assert.equal(fund.open,null,id);
    assert.equal(fund.close,null,id);
    assert.match(fund.verified,/no hay|no confirma|ninguna nueva|NO confirma/i,id);
  }
  const {dueNotifications} = await import('../lead-worker/src/fondos-notify.js');
  assert.equal(dueNotifications(catalog,new Date('2026-11-19T13:20:00.000Z')).length,0);
  assert.equal(new Set(catalog.funds.map(x=>x.id)).size,catalog.funds.length);
  const historical = catalog.funds.find(x=>x.id==='startupchile-big11-historico-2025');
  assert.equal(historical.open,'2025-11-05T13:00');
  assert.equal(historical.close,'2025-11-28T13:00');
  assert.equal(dueNotifications(catalog,new Date('2026-11-05T13:20:00.000Z')).length,0);
});

test('toda elegibilidad Semilla, Crea y Valida y BIG se explica por instrumento',()=>{
  assert.match(catalog.funds.find(x=>x.id===ids[0]).requirements,/sin ventas/);
  assert.match(catalog.funds.find(x=>x.id===ids[1]).requirements,/36 meses/);
  assert.match(catalog.funds.find(x=>x.id===ids[2]).requirements,/24 meses/);
  assert.match(catalog.funds.find(x=>x.id===ids[3]).requirements,/Build, Ignite y Growth/);
});

test('watcher amplía fuentes oficiales, detecta señales pero solo propone revisión humana',async()=>{
  assert.equal(official('https://startupchile.org/postula/build/'),true);
  assert.equal(official('https://www.prochile.gob.cl/herramientas/concursos/'),true);
  assert.equal(official('https://corfo.gob.cl.evil.test/'),false);
  assert.equal(official('https://startupchile.org.evil.test/'),false);
  assert.equal(official('http://startupchile.org/'),false);
  const html='<p>Convocatoria BIG 13</p><p>Postulaciones: 19 de noviembre de 2026</p>';
  assert.ok(signal(html).some(x=>/19 de noviembre de 2026/.test(x)));
  let calls=0;
  const records=[
    {name:'BIG',source:'https://startupchile.org/'},
    {name:'ProChile',source:'https://www.prochile.gob.cl/herramientas/concursos/'},
    {name:'Falso',source:'https://evil.test/fondo'}
  ];
  const result=await audit({records,fetcher:async()=>{calls++;return {ok:true,text:async()=>html};}});
  assert.equal(calls,2);
  assert.equal(result.out.length,2);
  assert.ok(result.out.every(x=>x.review.includes('NO copiar automáticamente')));
  const yml=fs.readFileSync(path.join(root,'.github/workflows/fondos-monitor.yml'),'utf8');
  assert.match(yml,/Corfo, ProChile y Start-Up Chile/);
  assert.doesNotMatch(yml.split('add-paths:')[1].split('title:')[0],/fondos-concursables\\.json/);
});

test('el dashboard y el Worker admiten Start-Up Chile oficial pero no imitaciones',async()=>{
  const js=fs.readFileSync(path.join(root,'js/calendario-fondos.js'),'utf8');
  const worker=fs.readFileSync(path.join(root,'lead-worker/src/fondos-notify.js'),'utf8');
  assert.ok(js.includes('startupchile\\.org'));
  assert.ok(worker.includes("'startupchile.org'"));
  const {dueNotifications}=await import('../lead-worker/src/fondos-notify.js');
  const item={...catalog.funds.find(x=>x.id===ids[3]),open:'2026-11-20T12:00',close:'2026-11-25T12:00'};
  assert.equal(dueNotifications({schema:1,funds:[item]},new Date('2026-11-20T13:15:00Z')).length,1);
  item.source='https://startupchile.org.evil.test/x';
  assert.equal(dueNotifications({schema:1,funds:[item]},new Date('2026-11-20T13:15:00Z')).length,0);
});
