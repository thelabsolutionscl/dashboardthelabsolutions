#!/usr/bin/env node
'use strict';
// La sonda que distingue "impresora apagada" de "impresora viva sin telemetría".
// Son dos situaciones opuestas y el dashboard las muestra distinto, así que
// confundirlas es peor que no saber: el 2026-08-19 marcó cinco máquinas
// apagadas como "la máquina está viva · puede estar imprimiendo".

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const MAQ=fs.readFileSync(path.join(__dirname,'..','js','maquinas.js'),'utf8');
const BRIDGE=fs.readFileSync(path.join(__dirname,'..','printer-bridge','server.js'),'utf8');

function functionSource(source,name){
  const marker=`function ${name}(`;
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,`falta ${name}`);
  const body=source.indexOf('{',start);
  let depth=0;
  for(let i=body;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'&&--depth===0){
      // Sin el `async` de delante, el `await` de dentro no compila.
      const pre=source.slice(Math.max(0,start-6),start);
      return (pre.endsWith('async ')?'async ':'')+source.slice(start,i+1);
    }
  }
  throw new Error(`no se pudo aislar ${name}`);
}

// Respuesta de fetch mínima: lo único que mira la sonda es el status y las
// cabeceras.
function respuesta(status,cabeceras={}){
  const mapa={};
  for(const k of Object.keys(cabeceras))mapa[k.toLowerCase()]=cabeceras[k];
  return {status,headers:{get:n=>mapa[String(n).toLowerCase()]??null}};
}

function sondaApi(respuestas){
  const pedidas=[];
  const context={
    Date,Object,
    _ALIVE_PROBE_PORTS:[4408,80],
    _ALIVE_PROBE_TTL_MS:45000,
    _ALIVE_PROBE_TIMEOUT_MS:4000,
    _aliveProbe:{},
    AbortSignal:{timeout:()=>null},
    _printerPortUrl:(ip,port)=>`https://bridge/${ip}:${port}/`,
    fetch:async url=>{
      pedidas.push(url);
      const port=Number(String(url).split(':').pop().replace(/\D/g,''));
      const r=respuestas[port];
      if(r instanceof Error)throw r;
      if(!r)throw new Error('sin respuesta');
      return r;
    },
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(MAQ,'_esErrorDelBridge'),
    functionSource(MAQ,'_probePrinterAlive'),
    'this.api={probe:_probePrinterAlive,bridgeErr:_esErrorDelBridge,cache:_aliveProbe};',
  ].join('\n'),context);
  return {api:context.api,pedidas};
}

test('un 424 del bridge NO cuenta como señal de vida',async()=>{
  const {api}=sondaApi({4408:respuesta(424,{'X-Bridge-Error':'1'}),80:respuesta(424,{'X-Bridge-Error':'1'})});
  assert.equal(await api.probe('e5-4','192.168.100.90'),0,
    'el bridge no pudo conectar: la máquina está apagada, no viva');
});

test('la cabecera manda aunque el código sea de los que antes pasaban',async()=>{
  // El bridge contesta 403/404/409 por su cuenta sin haber hablado con la
  // impresora. Ninguno de esos prueba que haya una máquina encendida.
  for(const code of [403,404,405,409]){
    const {api}=sondaApi({4408:respuesta(code,{'X-Bridge-Error':'1'}),80:respuesta(code,{'X-Bridge-Error':'1'})});
    assert.equal(await api.probe('k1-1','192.168.100.51'),0,`el ${code} del bridge no es señal de vida`);
  }
});

test('un 404 de la propia impresora sí prueba que está viva',async()=>{
  // Las K2 no sirven nada en la raíz de 4408 pero contestan igual: hay un
  // servidor escuchando, o sea que la máquina está encendida.
  const {api}=sondaApi({4408:respuesta(404),80:respuesta(404)});
  assert.equal(await api.probe('k2-1','192.168.100.70'),4408);
});

test('se queda con el primer puerto que contesta de verdad',async()=>{
  const {api,pedidas}=sondaApi({4408:respuesta(424,{'X-Bridge-Error':'1'}),80:respuesta(200)});
  assert.equal(await api.probe('k1-4','192.168.100.68'),80,
    'la K1 #4 sirve su web de fábrica en el 80 y no tiene Fluidd en el 4408');
  assert.equal(pedidas.length,2,'no debe dejar de probar el 80 tras el error del 4408');
});

test('los 5xx siguen sin contar (bridge viejo, antes de que fueran 424)',async()=>{
  const {api}=sondaApi({4408:respuesta(502),80:respuesta(502)});
  assert.equal(await api.probe('k1-2','192.168.100.126'),0);
});

test('sin bridge de por medio, una respuesta directa de la impresora vale',async()=>{
  // En modo local el fetch va a la impresora sin pasar por el bridge: no hay
  // cabecera que mirar y el status es el de la máquina.
  const {api}=sondaApi({4408:respuesta(200)});
  assert.equal(await api.probe('e5-1','192.168.100.67'),4408);
});

test('el resultado se cachea por IP y se invalida al cambiarla',async()=>{
  const {api,pedidas}=sondaApi({4408:respuesta(200)});
  assert.equal(await api.probe('e5-1','192.168.100.67'),4408);
  assert.equal(await api.probe('e5-1','192.168.100.67'),4408);
  assert.equal(pedidas.length,1,'la segunda consulta sale del caché');
  await api.probe('e5-1','192.168.100.90');
  assert.ok(pedidas.length>1,'otra IP obliga a sondear de nuevo');
});

test('el bridge marca sus propios errores y expone la cabecera al navegador',()=>{
  const jsonError=functionSource(BRIDGE,'jsonError');
  assert.match(jsonError,/'X-Bridge-Error':\s*'1'/,
    'sin la marca, el dashboard no puede distinguir un error del bridge de una respuesta de la impresora');
  const setCors=functionSource(BRIDGE,'setCors');
  assert.match(setCors,/Access-Control-Expose-Headers[^\n]*X-Bridge-Error/,
    'entre orígenes el navegador no lee la cabecera si no se expone');
});
