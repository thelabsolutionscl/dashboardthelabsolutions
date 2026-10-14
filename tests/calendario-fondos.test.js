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
  return {api:ctx.window.TLSFondos,calls,store,getRenders:()=>calendarRenders,setJump:fn=>{ctx.window.calIrAFondoFecha=fn;}};
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
  assert.equal(events.length,CATALOG.funds.filter(f=>f.open&&f.close).length*2,'apertura y cierre por cada llamado con ambas fechas confirmadas');
  assert.equal(events.filter(e=>e.type==='fondo_inicio').length,CATALOG.funds.filter(f=>!!f.open).length);
  assert.equal(events.filter(e=>e.type==='fondo_cierre').length,CATALOG.funds.filter(f=>!!f.close).length);
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

test('agente ayuda también a convocatorias nuevas sin inventar elegibilidad',async()=>{
 const nodes={
   fondosConvocatoria:{value:'otro'},
   fondosOtroFondo:{value:'Fondo Regional Nueva Tecnología'},
   fondosPreguntas:{value:'Indique el monto solicitado, la innovación del proyecto y adjunte documentos tributarios.'},
   fondosAntecedentes:{value:''},
   fondosRespuesta:{textContent:''},fondosGenerar:{disabled:false}
 };
 const {api,calls}=instance(nodes);await api.load();
 // The select is not part of the synthetic DOM and retains its manual choice.
 await api.draft();
 assert.equal(calls.length,1);
 assert.match(calls[0][2],/Fondo Regional Nueva Tecnología/);
 assert.match(calls[0][2],/Convocatoria ingresada manualmente/);
 assert.match(calls[0][1],/SIN inventar hechos/);
});


test('cada inicio y cierre tiene un acceso al mes del calendario y activa los hitos',async()=>{
  const nodes={
    fondosShowOnCalendar:{checked:false},
    fondosCalendarioResumen:{innerHTML:''},
    fondosCalendarioSinFecha:{innerHTML:''}
  };
  const {api,store,setJump}=instance(nodes);
  const jumped=[];
  setJump(date=>{jumped.push(date);return true;});
  await api.load();
  store.set('thelab_fondos_mostrar_v1','false');
  assert.equal(api.eventList().length,0);
  assert.equal(api.goTo('sercotec-crece-sostenible-rm-2026','close'),true);
  assert.equal(jumped[0],'2026-07-08');
  assert.equal(nodes.fondosShowOnCalendar.checked,true);
  assert.equal(store.get('thelab_fondos_mostrar_v1'),'true');
  assert.equal(api.eventList().length,CATALOG.funds.filter(f=>f.open&&f.close).length*2);
  assert.equal(api.goTo('corfo-sumate-innovar','open'),false);
  assert.equal(jumped.length,1,'sin fecha confirmada no se puede navegar a un día ficticio');
  api.renderCalendarSummary();
  assert.match(nodes.fondosCalendarioResumen.innerHTML,new RegExp(CATALOG.funds.filter(f=>f.open&&f.close).length*2+' fechas confirmadas'));
  assert.match(nodes.fondosCalendarioSinFecha.innerHTML,/Corfo — Súmate a Innovar/);
  assert.match(nodes.fondosCalendarioSinFecha.innerHTML,/Fecha por confirmar/);
  assert.doesNotMatch(nodes.fondosCalendarioSinFecha.innerHTML,/data-fondos-calendar=/);
});

test('salto de calendario restablece filtros y navega al mes exacto',()=>{
  const match=CAL.match(/function calIrAFondoFecha\(fecha\)\{[\s\S]*?\n\}/);
  assert.ok(match,'el calendario debe exponer función para navegar a un hito oficial');
  const state={
    Date,
    _calMes:new Date(2026,9,1),
    _calVista:'agenda',
    _calFiltro:'gustavo',
    _calTipoFiltro:'equipo',
    _calDate:fecha=>fecha?new Date(fecha+'T00:00:00'):null,
    localStorage:{setItem(k,v){state.persisted=[k,v];}},
    document:{getElementById(){return {scrollIntoView(){state.scrolled=true;}};}},
    renderCalendario(){state.renders=(state.renders||0)+1;}
  };
  vm.runInNewContext(match[0]+';calIrAFondoFecha("2026-06-22")',state);
  assert.equal(state._calMes.getFullYear(),2026);
  assert.equal(state._calMes.getMonth(),5);
  assert.equal(state._calFiltro,'todos');
  assert.equal(state._calTipoFiltro,'fondos');
  assert.equal(state._calVista,'mes');
  assert.equal(state.persisted[0],'thelab_cal_vista');
  assert.equal(state.persisted[1],'mes');
  assert.equal(state.renders,1);
  assert.equal(state.scrolled,true);
});

test('Calendario muestra y distingue fechas oficiales y por confirmar sin inventar eventos',()=>{
  assert.match(INDEX,/id="fondosCalendarioResumen"/);
  assert.match(INDEX,/id="fondosCalendarioSinFecha"/);
  assert.match(INDEX,/🏛 Ver fondos en calendario/);
  assert.match(MODULE,/data-fondos-calendar/);
  assert.match(CAL,/window\.TLSFondos\?\.renderCalendarSummary/);
  assert.match(CAL,/ev\.source==='fondos'\)return/);
});

test('el catálogo contiene fuentes primarias auditables e identifica elegibilidad condicionada',()=>{
  assert.ok(CATALOG.funds.length>=5);
  for(const f of CATALOG.funds){
    assert.ok(f.source.startsWith('https://'));
    assert.ok(typeof f.verified==='string'&&f.verified.length>=20,'cada fuente describe su evidencia y límites');
    assert.ok(typeof f.fit==='string'&&f.fit.length>=5&&typeof f.requirements==='string'&&f.requirements.length>=15,'cada llamada documenta condiciones y requisitos por verificar');
    if(f.open)assert.match(f.open,/^20(?:25|26|27)-\d{2}-\d{2}T\d{2}:\d{2}$/);
    if(f.close)assert.match(f.close,/^20(?:25|26|27)-\d{2}-\d{2}T\d{2}:\d{2}$/);
  }
});
