'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const INDEX=fs.readFileSync('index.html','utf8');
const PAGE=fs.readFileSync('manual.html','utf8');
const MANUAL=fs.readFileSync('docs/manual/MANUAL_USUARIO.md','utf8');

test('el manual vive en el menú de usuario y abre en una pestaña aparte',()=>{
  assert.match(INDEX,/openUserManual\(\)[\s\S]{0,240}Manual de usuario/);
  assert.match(INDEX,/function openUserManual\(\)/);
  assert.match(INDEX,/window\.open\('manual\.html','_blank','noopener,noreferrer'\)/);
  assert.doesNotMatch(INDEX,/location\.href\s*=\s*['"]manual\.html['"]/);
});

test('la página del manual carga la fuente markdown y permite imprimir',()=>{
  assert.match(PAGE,/docs\/manual\/MANUAL_USUARIO\.md/);
  assert.match(PAGE,/window\.print\(\)/);
  assert.match(PAGE,/id="search"/);
  assert.match(PAGE,/id="toc"/);
});

test('el manual cubre las secciones operativas principales',()=>{
  for(const title of [
    'OVERVIEW','CLIENTES','COTIZACIONES','PEDIDOS','INVENTARIO','PROVEEDORES',
    'AGENTES IA','OFICINA','REDES SOCIALES','NEWSLETTER','MÁQUINAS','EQUIPO',
    'CALENDARIO','REPORTES','WEB','FINANZAS','REMUNERACIONES','CORREO',
    'CENTRO DE CONEXIONES','APARIENCIA'
  ]) assert.ok(MANUAL.includes(title),title);
});

test('no documenta los modos Simple/Experto retirados',()=>{
  assert.doesNotMatch(MANUAL,/Modo Simple|Modo Experto|Solo Simple|Solo Experto|Simple y Experto/i);
});


test('cada capítulo numerado tiene una captura',()=>{
  const chapters=[...MANUAL.matchAll(/^##\s+(\d+)\.\s+/gm)].map(m=>Number(m[1]));
  assert.deepEqual(chapters,[...Array(27)].map((_,i)=>i+1));
  for(let n=1;n<=27;n++){
    const start=MANUAL.search(new RegExp('^##\\s+'+n+'\\.\\s+','m'));
    const next=n<27?MANUAL.search(new RegExp('^##\\s+'+(n+1)+'\\.\\s+','m')):MANUAL.length;
    assert.match(MANUAL.slice(start,next),/!\[[^\]]+\]\(assets\/[a-z0-9-]+\.png\)/i,'capítulo '+n);
  }
});

test('el manual mantiene cobertura visual detallada',()=>{
  const refs=[...MANUAL.matchAll(/assets\/([a-z0-9-]+)\.png/gi)].map(m=>m[1]);
  const unique=new Set(refs);
  assert.ok(unique.size>=41,'se esperan al menos 41 screenshots únicos');
  for(const shot of [
    'nueva-cotizacion','pedidos-tabla','pedidos-planificacion','maquinas-planificacion',
    'finanzas-facturas','finanzas-por-cobrar','correo-redactar','centro-conexiones-detalle'
  ]) assert.ok(unique.has(shot),'falta screenshot '+shot);
});

test('manual web convierte imágenes markdown en figuras responsivas',()=>{
  assert.match(PAGE,/function manualImageSrc\(/);
  assert.match(PAGE,/manual-shot/);
  assert.match(PAGE,/loading="lazy"/);
  assert.match(PAGE,/docs\/manual\//);
});
