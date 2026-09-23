#!/usr/bin/env node
'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const MAQ=fs.readFileSync(path.join(ROOT,'js','maquinas.js'),'utf8');
const OPS=fs.readFileSync(path.join(ROOT,'js','maquinas-operaciones.js'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'js','operativo-visual.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'operativo-visual.css'),'utf8');

function functionSource(source,name){
  const marker=new RegExp(`(?:async\\s+)?function\\s+${name.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\s*\\(`);
  const found=marker.exec(source);assert.ok(found,`falta ${name}`);
  let paren=0,open=-1;
  for(let i=found.index+found[0].length-1;i<source.length;i++){
    if(source[i]==='(')paren++;
    else if(source[i]===')'&&--paren===0){open=source.indexOf('{',i);break;}
  }
  assert.ok(open>=0,`no se pudo ubicar ${name}`);
  let depth=0,quote='',escape=false,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch===quote)quote='';continue;}
    if(ch==='/'&&next==='/'){line=true;i++;continue;}
    if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return source.slice(found.index,i+1);
  }
  throw new Error(`no se pudo aislar ${name}`);
}

test('Máquinas queda en vista Simple única y mantiene la telemetría operativa',()=>{
  assert.match(UI,/views=\[[^\]]*'maquinas'/);
  assert.match(UI,/simpleOnlyViews=new Set\([^)]*'maquinas'/);
  const mode=functionSource(UI,'mode');
  assert.match(mode,/el\.dataset\.opView=value/);
  assert.match(mode,/details\.op-disclosure,details\.op-post-actions/);
  assert.match(mode,/details\.op-telemetry/);
  assert.match(mode,/n\.open=true/,'telemetría debe permanecer desplegada en la vista única');
  assert.match(CSS,/\[data-op-view=simple\] \.op-expert-only\{display:none!important\}/);
});

test('Simple conserva alertas, incidentes y controles de impresión necesarios',()=>{
  const intel=functionSource(OPS,'renderIntelligence');
  assert.match(intel,/mops-actionable-panel/,'las alertas accionables deben tener un bloque estable');
  assert.doesNotMatch(intel,/mops-actionable-panel[^"`]*op-expert-only/,'las alertas críticas no pueden desaparecer en Simple');
  assert.match(intel,/mops-pending-panel/,'los incidentes pendientes deben seguir visibles');
  assert.doesNotMatch(intel,/mops-pending-panel[^"`]*op-expert-only/,'los incidentes pendientes no son detalle técnico');
  assert.match(MAQ,/Pausar/);
  assert.match(MAQ,/Reanudar/);
  assert.match(MAQ,/Detener/);
  assert.match(MAQ,/🎛 CONTROL/,'cada impresora debe exponer el panel operativo');
  assert.match(MAQ,/peta_/,'el tiempo restante debe seguir en la tarjeta simple');
  assert.match(MAQ,/pbig_/,'el progreso debe seguir en la tarjeta simple');
});

test('Experto concentra infraestructura, evidencia y diagnóstico técnico',()=>{
  const intel=functionSource(OPS,'renderIntelligence');
  for(const token of [
    'mops-service-trust op-expert-only',
    'mops-diagnostic-kpis op-expert-only',
    'mops-trust-panel op-expert-only',
    'mops-physical-details op-expert-only',
  ])assert.match(intel,new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')),`${token} debe quedar en Experto`);
  assert.match(MAQ,/pcard-ip-address op-expert-only/);
  assert.match(MAQ,/class="printer-control-btn" onclick="openPrinterControl/,'CONTROL operativo debe existir también en Simple');
  assert.doesNotMatch(MAQ,/class="op-expert-only" onclick="openPrinterControl/,'CONTROL no es diagnóstico: no debe ocultarse en Simple');
  assert.match(MAQ,/class="op-expert-only" onclick="openGcodeUpload/);
  assert.match(MAQ,/class="op-expert-only" onclick="openPrinterConnModal/);
  assert.match(MAQ,/class="op-expert-only" onclick="openBedMesh/);
  assert.match(MAQ,/class="op-expert-only" onclick="openHistoryModal/);
});

test('Simple reduce detalle técnico sin ocultar herramientas de Taller',()=>{
  assert.match(INDEX,/class="btn btn-ghost btn-sm op-expert-only" onclick="openMaquinasManager\(\)"/);
  assert.match(INDEX,/class="card maq-ops-card op-expert-only"><div id="mopsGantt"/);
  assert.match(OPS,/mops-planning-guide op-expert-only/);
  assert.match(OPS,/mops-job-evidence op-expert-only/);
  assert.match(OPS,/mops-workshop-trust op-expert-only/);
  assert.match(OPS,/mops-workshop-nav-grid advanced/);
  assert.doesNotMatch(OPS,/mops-workshop-nav-grid advanced op-expert-only/,'Simple debe conservar los accesos a todas las herramientas');
  assert.match(OPS,/workshopNavCard\('materiales'/,'Materiales debe seguir disponible en Simple');
  assert.match(OPS,/workshopNavCard\('mantenimiento'/,'Mantención debe seguir disponible en Simple');
  assert.match(OPS,/workshopNavCard\('seguridad'/,'Seguridad debe seguir disponible en Simple');
  assert.match(OPS,/workshopNavCard\('capacidad'/,'Capacidad debe seguir disponible en Simple');
  assert.match(OPS,/workshopNavCard\('laminado'/,'Laminador debe estar disponible en Simple');
  assert.match(OPS,/workshopNavCard\('perfiles'/,'Perfiles debe estar disponible en Simple');
  assert.match(OPS,/workshopNavCard\('analitica'/,'Analítica debe estar disponible en Simple');
  assert.match(OPS,/workshopNavCard\('automatizacion'/,'Configuración debe estar disponible en Simple');
  assert.match(INDEX,/id="mopsJobs"/,'las tarjetas de trabajos deben seguir visibles');
  assert.match(INDEX,/data-maq-view="calidad"/,'QA debe seguir en la pantalla Trabajos');
  assert.match(INDEX,/data-maq-view="postproduccion"/,'Postproducción debe seguir en la pantalla Trabajos');
});

test('Simple mantiene cámara, cola y telemetría desplegada',()=>{
  assert.match(MAQ,/details class="op-telemetry" open/,'temperaturas y telemetría deben abrirse por defecto en todas las tarjetas con lectura');
  assert.match(MAQ,/onclick="openWebcamModal\('\$\{m\.id\}'\)"/);
  assert.match(MAQ,/onclick="openQueueModal\('\$\{m\.id\}'\)"/);
  assert.match(CSS,/#tab-maquinas\[data-op-view=simple\] \.pcard-actions/);
  assert.match(CSS,/#tab-maquinas\[data-op-view=simple\] #maquinaMonGrid/);
});
