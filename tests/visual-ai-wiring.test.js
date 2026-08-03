#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const JS_DIR=path.join(ROOT,'js');
const MODULES=fs.existsSync(JS_DIR)
  ?fs.readdirSync(JS_DIR).filter(n=>n.endsWith('.js')).map(n=>fs.readFileSync(path.join(JS_DIR,n),'utf8')).join('\n')
  :'';
const SOURCE=`${INDEX}\n${MODULES}`;
const OPENGEN='https://thelabsolutionscl.github.io/Open-Generative-AI/';

function count(re,text=SOURCE){return(text.match(re)||[]).length;}
function iframeTag(){
  const m=INDEX.match(/<iframe\b[^>]*\bid=["']vaiFrame["'][^>]*>/i);
  assert.ok(m,'falta iframe #vaiFrame');
  return m[0];
}

test('VISUAL AI tiene una sola sección y navegación escritorio/móvil',()=>{
  assert.equal(count(/id=["']tab-visual["']/g,INDEX),1,'#tab-visual debe ser único');
  assert.match(SOURCE,/switchTab\(\s*['"]visual['"]\s*\)/,'falta navegación escritorio');
  assert.match(SOURCE,/switchTabMobile\(\s*['"]visual['"]\s*\)/,'falta navegación móvil');
  for(const id of ['vaiFrame','vaiFallback','vaiStatus','vaiDot','vaiStatusTxt']){
    assert.equal(count(new RegExp(`id=["']${id}["']`,'g'),INDEX),1,`${id} debe existir una vez`);
  }
});

test('el iframe usa un origen HTTPS fijo y carga diferida al activar Visual AI',()=>{
  const tag=iframeTag();
  assert.match(tag,/src=["']about:blank["']/i,'debe partir sin cargar el servicio externo');
  assert.ok(tag.includes(`data-src="${OPENGEN}"`)||tag.includes(`data-src='${OPENGEN}'`),'data-src debe apuntar al OpenGen oficial');
  assert.match(SOURCE,/name\s*===\s*['"]visual['"][\s\S]{0,500}getElementById\(\s*['"]vaiFrame['"]\s*\)[\s\S]{0,500}dataset\.src[\s\S]{0,500}\.src\s*=/,'la carga debe ocurrir al activar la sección');
  assert.equal(count(/data-src=["']https:\/\/thelabsolutionscl\.github\.io\/Open-Generative-AI\/["']/g,INDEX),1,'el origen embebido debe ser único');
});

test('el panel tiene estado visible, fallback y salida directa',()=>{
  assert.match(INDEX,/id=["']vaiFallback["']/);
  assert.match(INDEX,/Cargando OpenGen Studio/i);
  assert.ok(count(/href=["']https:\/\/thelabsolutionscl\.github\.io\/Open-Generative-AI\/["']/g,INDEX)>=1,'debe existir enlace directo');
  assert.match(INDEX,/target=["']_blank["']/);
  assert.match(INDEX,/id=["']vaiStatusTxt["']/);
  assert.match(INDEX,/OpenGen Studio\s*[—-]\s*Live/,'debe indicar carga completada');
});

test('el iframe declara título y permisos de medios de forma explícita',()=>{
  const tag=iframeTag();
  assert.match(tag,/title=["']OpenGen Studio["']/i);
  assert.match(tag,/allow=["'][^"']*camera[^"']*["']/i);
  assert.match(tag,/allow=["'][^"']*microphone[^"']*["']/i);
  assert.match(tag,/allow=["'][^"']*clipboard-write[^"']*["']/i);
  assert.match(tag,/allow=["'][^"']*fullscreen[^"']*["']/i);
});

test('el dashboard no contiene credenciales ni llamadas directas del proveedor visual',()=>{
  assert.doesNotMatch(SOURCE,/api\.muapi\.ai|x-api-key|corsproxy\.io/i,'las llamadas del proveedor deben permanecer fuera del dashboard');
  assert.doesNotMatch(SOURCE,/\bmu_[A-Za-z0-9_-]{12,}\b|\bhf_[A-Za-z0-9_-]{12,}\b/,'no debe existir una key literal');
});

test('la carga visual no se dispara desde secciones ajenas',()=>{
  const matches=[...SOURCE.matchAll(/name\s*===\s*['"]([^'"]+)['"][\s\S]{0,350}?vaiFrame/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(matches)],['visual']);
});

test.todo('el iframe debe usar sandbox mínimo, referrerpolicy y permisos concedidos solo cuando la función los necesite');
test.todo('los enlaces target=_blank deben incluir rel=noopener noreferrer');
test.todo('el dashboard debe validar readiness con postMessage y allowlist de origin, no solo con iframe.onload');
test.todo('la carga debe manejar timeout, error tardío y un botón de reintento sin recargar todo el dashboard');
test.todo('al salir de VISUAL AI debe poder pausar o descargar el iframe para evitar consumo innecesario');
test.todo('OpenGen debe enviar eventos de generación/costo/error al dashboard mediante un contrato versionado');
test.todo('un resultado debe poder vincularse con Cliente, Cotización, Pedido o producto sin descarga y carga manual');
