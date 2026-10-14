#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const MODULE=fs.readFileSync(path.join(ROOT,'js/calendario-fondos.js'),'utf8');
const CAL=fs.readFileSync(path.join(ROOT,'js/calendario-base.js'),'utf8');
const LOADER=fs.readFileSync(path.join(ROOT,'js/calendario.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const CATALOG=JSON.parse(fs.readFileSync(path.join(ROOT,'data/fondos-concursables.json'),'utf8'));

function instance(docNodes={}){
  let calendarRenders=0;
  const calls=[];
  const store=new Map();
  const doc={
    baseURI:'https://dashboard.thelab.solutions/',
    readyState:'loading',
    addEventListener(){},
    getElementById(id){return docNodes[id]||null;}
  };
  const ctx={
    window:{
      renderCalendario(){calendarRenders++;},
      callAgentClaude:async (...args)=>{calls.push(args);return 'Respuestas seguras con datos por validar';}
    },document:doc,URL,Date,Number,JSON,Promise,console,localStorage:{
      getItem(k){return store.get(k)||null;},
      setItem(k,v){store.set(k,v);}
    },
    fetch:async url=>{
      assert.match(String(url),/data\/fondos-concursables\.json$/);
      return {ok:true,json:async()=>CATALOG};
    }
  };
  vm.runInNewContext(MODULE,ctx);
  return {api:ctx.window.TLSFondos,calls,store,getRenders:()=>calendarRenders};
}

test('el calendario incorpora nuevas fechas solo si hay respaldo y no en Google Calendar',async()=>{
  assert.match(LOADER,/calendario-fondos\.js/);
  assert.match(CAL,/window\.TLSFondos\?\.eventList/);
  assert.match(CAL,/ev\?\.source==='fondos'\)return false/);
  assert.match(CAL,/filter\(ev=>ev\.source!=='fondos'\)/);
  assert.match(CAL,/calOpenEvent\(id\)[\s\S]*?TLSFondos\?\.open/);
  assert.match(CAL,/fondos','🟢 Fondos concursables/);
  for(const id of ['fondosList','fondosGenerar','fondosConvocatoria','fondosPreguntas','fondosAntecedentes','fondosDetalleModal','fondosShowOnCalendar']){
    assert.match(INDEX,new RegExp('id="'+id+'"'));
  }
  const {api,store}=instance();
  await api.load();
  const events=api.eventList();
  assert.equal(events.length,4,'dos aperturas y dos cierres confirmados');
  assert.equal(events.filter(e=>e.type==='fondo_inicio').length,2);
  assert.equal(events.filter(e=>e.type==='fondo_cierre').length,2);
  assert.ok(events.every(e=>e.source==='fondos'&&e.allDay&&!e.gcal?.length));
  assert.ok(events.some(e=>e.fecha==='2026-05-28'&&e.titulo.includes('Crece Urbano')));
  store.set('thelab_fondos_mostrar_v1','false');
  assert.equal(api.eventList().length,0);
});

test('no se inventan fechas y solo se admiten URLs oficiales https',async()=>{
  const {api}=instance();await api.load();
  const unsupported=CATALOG.funds.find(f=>f.id==='corfo-sumate-innovar');
  assert.equal(unsupported.open,null);
  assert.equal(api.status(api.clean(unsupported)),'Sin fechas publicadas');
  assert.equal(api.iso('2026-10-14T15:00'),'2026-10-14');
  assert.equal(api.iso('prox'),'');
  assert.equal(api.clean({...unsupported,source:'https://atacante.example/phishing'}),null);
  assert.equal(api.clean({...unsupported,id:'<script>'}),null);
  assert.equal(api.clean({...unsupported,open:'2026-12-30',close:'2026-10-30'}),null);
});

test('copiloto genera borrador usando solo datos provistos, sin postulaciones automáticas',async()=>{
  const docNodes={
    fondosConvocatoria:{value:'sercotec-crece-urbano-rm-2026'},
    fondosPreguntas:{value:'Describe el proyecto y explica la inversión solicitada en equipos y mejora operativa.'},
    fondosAntecedentes:{value:'Se propone ampliar capacidad de prototipado en impresión 3D.'},
    fondosRespuesta:{textContent:''},fondosGenerar:{disabled:false}
  };
  const {api,calls}=instance(docNodes);await api.load();
  await api.draft();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'CEO');
  assert.match(calls[0][1],/SIN inventar hechos/);
  assert.match(calls[0][1],/ni completes formularios externos/i);
  assert.match(calls[0][2],/Describ(e|e el proyecto)/i);
  assert.match(docNodes.fondosRespuesta.textContent,/Respuestas seguras/);
  assert.equal(docNodes.fondosGenerar.disabled,false);
  docNodes.fondosPreguntas.value='Mi clave es sk-1234567890123456789012345 y necesito subirla.';
  await api.draft();
  assert.equal(calls.length,1,'no se deben enviar credenciales al proveedor de IA');
  assert.match(docNodes.fondosRespuesta.textContent,/clave API/);
});

test('el catálogo contiene fuentes primarias auditables e identifica elegibilidad condicionada',()=>{
  assert.ok(CATALOG.funds.length>=5);
  for(const f of CATALOG.funds){
    assert.ok(f.source.startsWith('https://'));
    assert.match(f.verified,/bases|oficial|programa|sin fecha|no se incorpora|ficha/i);
    assert.match(f.fit,/sujet|potencial|media/i);
    if(f.open)assert.match(f.open,/^2026-\d{2}-\d{2}T\d{2}:\d{2}$/);
    if(f.close)assert.match(f.close,/^2026-\d{2}-\d{2}T\d{2}:\d{2}$/);
  }
});
