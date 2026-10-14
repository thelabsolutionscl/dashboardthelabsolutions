#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {official,signal,audit,sanitize}=require('../scripts/fondos-watch-corfo.js');
const base=path.join(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(base,'data/fondos-concursables.json'),'utf8'));
test('nuevo catastro oficial ampliado con condiciones y sin fechas fabricadas',()=>{
 assert.ok(catalog.funds.length>=24);
 assert.ok(catalog.funds.filter(x=>x.open&&x.close).length>=10);
 assert.equal(new Set(catalog.funds.map(x=>x.id)).size,catalog.funds.length);
 for(const id of ['corfo-pati-nacional-2025-2026','corfo-capital-humano-innovacion-2025-2026',
 'corfo-pati-futuras','corfo-capital-humano-futuras','corfo-innova-alta-tecnologia-eureka-vigilar']){
  const f=catalog.funds.find(x=>x.id===id);
  assert.ok(f,'fondo ausente: '+id);
  assert.match(f.fit,/potencial|condicionado/i);
  assert.match(f.source,/^https:\/\/(?:www\.)?corfo\.gob\.cl\//);
 }
 for(const id of ['corfo-pati-futuras','corfo-capital-humano-futuras','corfo-innova-alta-tecnologia-eureka-vigilar']){
  const f=catalog.funds.find(x=>x.id===id);
  assert.equal(f.open,null);
  assert.equal(f.close,null);
 }
});
test('detecta cambios en Corfo únicamente en fichas oficiales y no publica fechas',async()=>{
 assert.equal(official('https://www.corfo.gob.cl/sites/cpp/convocatoria/x'),true);
 assert.equal(official('http://www.corfo.gob.cl/sites/cpp/convocatoria/x'),false);
 assert.equal(official('https://corfo.gob.cl.evil.test/'),false);
 assert.equal(official('https://www.sercotec.cl/'),false);
 const html='<body><h1>Prueba 2026</h1><p>Apertura: 18/11/2026 17:00 hrs</p><p>Cierre: 12/12/2026 15:00 hrs</p><script>Acceso secreto</script></body>';
 assert.ok(!sanitize(html).includes('Acceso secreto'));
 const marks=signal(html);
 assert.ok(marks.some(x=>x.includes('Apertura')));
 assert.ok(marks.some(x=>x.includes('Cierre')));
 const mock=[{name:'Corfo prueba',info:'https://corfo.gob.cl/sites/cpp/test',source:'https://corfo.gob.cl/sites/cpp/test'},
 {name:'Falso',info:'https://evil.test',source:'https://evil.test'}];
 let calls=0;
 const r=await audit({records:mock,fetcher:async()=>{calls++;return {ok:true,text:async()=>html}}});
 assert.equal(calls,1);
 assert.equal(r.out.length,1);
 assert.match(r.out[0].review,/NO copiar automáticamente/);
});
test('workflow propone PR solamente con detecciones, nunca modifica agenda validada',()=>{
 const text=fs.readFileSync(path.join(base,'.github/workflows/fondos-monitor.yml'),'utf8');
 assert.match(text,/node scripts\/fondos-watch-corfo\.js/);
 assert.match(text,/data\/fondos-corfo-por-revisar\.json/);
 const section=text.split('add-paths:')[1].split('title:')[0];
 assert.doesNotMatch(section,/fondos-concursables\.json/);
});
test('avisos no inventan hora oficial si catálogo incluye fecha de día sin hora',async()=>{
 const {emailFor}=await import('../lead-worker/src/fondos-notify.js');
 const msg=emailFor({name:'PATI',phase:'apertura',time:'00:00',date:'2025-11-18',
 organizer:'Corfo',url:'https://www.corfo.gob.cl/',requirements:'Verificar'},'gustavo','gustavo@thelab.solutions');
 assert.match(msg.html,/No consta hora oficial/);
 assert.doesNotMatch(msg.html,/Hora anunciada.*00:00/);
});
