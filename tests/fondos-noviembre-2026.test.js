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
  // Corfo no ha publicado Semilla Inicia, Semilla Expande ni el nuevo Crea y Valida:
  // la prensa puede anunciar fechas, pero quedan en `expected` y nunca en open/close.
  for(const id of ids.slice(0,3)){
    const fund = catalog.funds.find(x=>x.id===id);
    assert.ok(fund,id);
    assert.equal(fund.open,null,id);
    assert.equal(fund.close,null,id);
    assert.match(fund.verified,/no hay|no confirma|ninguna nueva|NO confirma/i,id);
  }
  // BIG 13 sí tiene ventana en la ficha oficial de Corfo Start-Up Chile.
  const big = catalog.funds.find(x=>x.id===ids[3]);
  assert.equal(big.open,'2026-11-03T00:00','hora de apertura desconocida se registra como 00:00');
  assert.equal(big.close,'2026-11-24T13:00');
  assert.match(big.source,/^https:\/\/www\.corfo\.gob\.cl\//);
  assert.match(big.verified,/03\/11\/2026 al 24\/11\/2026/);
  const {dueNotifications} = await import('../lead-worker/src/fondos-notify.js');
  assert.equal(dueNotifications(catalog,new Date('2026-11-19T13:20:00.000Z')).length,0);
  assert.equal(new Set(catalog.funds.map(x=>x.id)).size,catalog.funds.length);
  const historical = catalog.funds.find(x=>x.id==='startupchile-big11-historico-2025');
  assert.equal(historical.open,'2025-11-05T13:00');
  assert.equal(historical.close,'2025-11-28T13:00');
  assert.equal(dueNotifications(catalog,new Date('2026-11-05T13:20:00.000Z')).length,0);
  const closing=dueNotifications(catalog,new Date('2026-11-24T13:20:00.000Z'));
  assert.deepEqual(closing.map(x=>[x.id,x.phase,x.time]),[[ids[3],'cierre','13:00']]);
  assert.equal(dueNotifications(catalog,new Date('2026-11-17T13:20:00.000Z'),7).length,1,'recordatorio 7 días antes del cierre BIG 13');
});

test('fechas anunciadas por terceros no crean avisos ni se tratan como oficiales',async()=>{
  const {dueNotifications} = await import('../lead-worker/src/fondos-notify.js');
  const announced = catalog.funds.filter(x=>x.expected);
  assert.deepEqual(announced.map(x=>x.id).sort(),[ids[1],ids[2]].sort());
  for(const f of announced){
    assert.equal(f.open,null,f.id);
    assert.equal(f.close,null,f.id);
    assert.match(f.expected.note,/Corfo aún no publica/,f.id);
    assert.match(f.expected.checkedAt,/^\d{4}-\d{2}-\d{2}$/,f.id);
  }
  // Ni el día anunciado ni con recordatorio anticipado se envía correo.
  for(const at of ['2026-11-10T13:20:00.000Z','2026-11-17T13:20:00.000Z','2027-01-28T13:20:00.000Z']){
    for(const ahead of [0,1,3,7]){
      assert.equal(dueNotifications(catalog,new Date(at),ahead).filter(x=>x.id!==ids[3]).length,0,at+' +'+ahead);
    }
  }
});

test('TLS (constituida dic. 2021) queda fuera de Semilla Expande y de Build/Ignite',()=>{
  const expande = catalog.funds.find(x=>x.id===ids[1]);
  assert.match(expande.fit,/no elegible/i);
  assert.match(expande.fitReason,/36 meses/);
  const big = catalog.funds.find(x=>x.id===ids[3]);
  assert.match(big.fit,/baja/i);
  assert.match(big.fitReason,/Build[\s\S]*Ignite[\s\S]*Growth/);
  const creaValida = catalog.funds.find(x=>x.id===ids[2]);
  assert.match(creaValida.fitReason,/más de 24 meses/);
  for(const f of [expande,big,creaValida])
    assert.doesNotMatch(JSON.stringify(f),/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/,'sin RUT en el catálogo público');
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
