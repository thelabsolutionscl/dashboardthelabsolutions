#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'styles.css'),'utf8');

function functionSource(src,name){
  const marker='function '+name;
  const start=src.indexOf(marker);assert.ok(start>=0,'falta '+name);
  let open=src.indexOf('{',start),depth=0,quote='',escape=false,line=false,block=false;
  for(let i=open;i<src.length;i++){
    const ch=src[i],next=src[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&next==='/'){line=true;i++;continue;}
    if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch===String.fromCharCode(96)){quote=ch;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&--depth===0)return src.slice(start,i+1);
  }
  throw new Error('sin cierre '+name);
}

test('mantención fusiona respaldo local y registros remotos en vez de ocultar el fallback',()=>{
  const src=functionSource(MAQ,'getMaintLog');
  assert.match(src,/getMaintLogLocal\(\)/);
  assert.match(src,/maquinaState\.maintLog/);
  assert.match(src,/Map\(\)/);
});

test('una alerta de mantención expone si existe un servicio base real',()=>{
  const src=functionSource(MAQ,'getMaintAlerts');
  assert.match(src,/verified:!!last/);
  assert.match(src,/last/);
});

test('tabla de mantención declara la fuente del odómetro y no llama subutilización a ausencia de datos',()=>{
  const src=functionSource(MAQ,'renderMaintenanceTable');
  assert.match(src,/PrinterHistory\?\.status/);
  assert.match(src,/Historial central reciente/);
  assert.match(src,/Caché local/);
  assert.match(src,/sin mantención base registrada/i);
  assert.doesNotMatch(src,/subutilizada/i);
  assert.doesNotMatch(src,/capacidad ociosa/i);
});

test('fallo al guardar mantención remota queda visible como pendiente, no como éxito silencioso',()=>{
  const src=functionSource(MAQ,'saveMaintRecord');
  assert.match(src,/printer_maint_sync_pending/);
  assert.match(src,/guardada localmente/i);
  assert.match(src,/Airtable no respondió/i);
});

test('materiales distinguen stock registrado reservado y libre',()=>{
  const src=functionSource(OPS,'renderMaterials');
  assert.match(src,/Stock registrado/);
  assert.match(src,/Reservado/);
  assert.match(src,/spoolAvailable/);
  assert.match(src,/balanza física/i);
});

test('seguridad global no usa la cámara de otra impresora como evidencia',()=>{
  const src=functionSource(OPS,'renderSafety');
  assert.match(src,/cameraConfigured:true/);
  assert.match(src,/cámara se comprueba por IMPRESORA/i);
  assert.match(src,/declaración del operador/i);
});

test('Taller tiene dashboard inicial y módulos bajo demanda',()=>{
  assert.match(OPS,/function ensureWorkshopShell\(/);
  assert.match(OPS,/function renderWorkshopHome\(/);
  assert.match(OPS,/Operación física/);
  assert.match(OPS,/Herramientas avanzadas/);
  assert.match(OPS,/WORKSHOP_CORE/);
  assert.match(CSS,/Máquinas · Taller confiable/);
  assert.match(CSS,/mops-workshop-nav-grid/);
});

test('Operación física y Herramientas avanzadas usan botones visuales TLS con iconos temáticos',()=>{
  assert.match(OPS,/WORKSHOP_CARD_META/);
  for(const icon of ['spool','wrench','shield','capacity','sliders','printer','chart','gear'])assert.match(OPS,new RegExp(icon));
  assert.match(OPS,/mops-workshop-tile/);
  assert.match(OPS,/_activeWorkshopView===view/);
  assert.doesNotMatch(functionSource(OPS,'workshopNavCard'),/mops-workshop-card/);
  assert.match(CSS,/Taller · accesos TLS en formato botón/);
  assert.match(CSS,/border-radius:18px/);
  assert.match(CSS,/mops-workshop-tile-icon svg/);
  assert.match(CSS,/mops-workshop-tile\.active/);
});

test('capacidad excluye QA y evita doble conteo de impresión activa',()=>{
  const src=functionSource(OPS,'capacityLoadMinutes');
  assert.match(src,/\['pendiente','planificado','en_cola'\]/);
  assert.match(src,/live\.state==='printing'/);
  assert.doesNotMatch(src,/qa/);
});
