'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const INDEX=fs.readFileSync('index.html','utf8');
const PAGE=fs.readFileSync('manual.html','utf8');
const MANUAL=fs.readFileSync('docs/manual/MANUAL_USUARIO.md','utf8');
const SCREENSHOT_WORKFLOW=fs.readFileSync('.github/workflows/manual-screenshots.yml','utf8');

test('el manual vive en el menú de usuario y abre en una pestaña aparte',()=>{
  assert.match(INDEX,/openUserManual\(\)[\s\S]{0,240}Manual de usuario/);
  assert.match(INDEX,/function openUserManual\(\)/);
  assert.match(INDEX,/window\.open\('manual\.html','_blank','noopener,noreferrer'\)/);
  assert.doesNotMatch(INDEX,/location\.href\s*=\s*['"]manual\.html['"]/);
});

test('el manual usa el logo horizontal oficial de TLS',()=>{
  assert.match(PAGE,/class="brand-logo" src="logo-thelab\.png" alt="The Lab Solutions"/);
  assert.match(PAGE,/class="hero-logo" src="logo-thelab\.png" alt="The Lab Solutions"/);
  assert.doesNotMatch(PAGE,/<div class="brand">THE LAB/);
  assert.match(PAGE,/id="manualVersion"/);
  assert.match(PAGE,/\\*\\*Versión:\\*\\*/);
});

test('la página del manual carga la fuente markdown y permite imprimir',()=>{
  assert.match(PAGE,/docs\/manual\/MANUAL_USUARIO\.md/);
  assert.match(PAGE,/window\.print\(\)/);
  assert.match(PAGE,/id="search"/);
  assert.match(PAGE,/id="toc"/);
});

test('búsqueda e índice funcionan también en móvil y sin tildes',()=>{
  assert.match(PAGE,/id="mobileToc"/);
  assert.match(PAGE,/id="searchStatus"/);
  assert.match(PAGE,/id="searchEmpty"/);
  assert.match(PAGE,/function normalizeText|const normalizeText=/);
  assert.match(PAGE,/normalize\('NFD'\)/);
  assert.match(PAGE,/IntersectionObserver/);
  assert.match(PAGE,/ids=new Map\(\)/);
});

test('parser conserva saltos de línea explícitos y alt seguro',()=>{
  assert.match(PAGE,/hardBreak=\/ \{2\}\$\//);
  assert.match(PAGE,/alt=esc\(altText\)/);
  assert.match(PAGE,/<br>/);
});

test('screenshots del manual se regeneran desde el PR actual',()=>{
  assert.match(SCREENSHOT_WORKFLOW,/pull_request:/);
  assert.match(SCREENSHOT_WORKFLOW,/docs\/manual\/MANUAL_USUARIO\.md/);
  assert.match(SCREENSHOT_WORKFLOW,/manual\.html/);
  assert.match(SCREENSHOT_WORKFLOW,/github\.event\.pull_request\.head\.ref/);
  assert.doesNotMatch(SCREENSHOT_WORKFLOW,/manual-screenshots-v2/);
});

test('el manual documenta Reportar problema y su reparación IA segura',()=>{
  assert.match(MANUAL,/Mi cuenta → Reportar problema/);
  assert.match(MANUAL,/Enviar a reparación IA/);
  assert.match(MANUAL,/assets\/reportar-problema\.png/);
  assert.match(MANUAL,/Pull Request/);
  assert.match(MANUAL,/autenticación, seguridad, SII, infraestructura y permisos/);
});

test('el manual cubre las secciones operativas principales',()=>{
  for(const title of [
    'OVERVIEW','CLIENTES','COTIZACIONES','PEDIDOS','INVENTARIO','PROVEEDORES',
    'AGENTES IA','OFICINA','REDES SOCIALES','NEWSLETTER','MÁQUINAS','EQUIPO',
    'CALENDARIO','REPORTES','WEB','FINANZAS','REMUNERACIONES','CORREO',
    'CENTRO DE CONEXIONES','APARIENCIA'
  ]) assert.ok(MANUAL.includes(title),title);
});

test('redacción del manual evita jerga retirada y mantiene versión actual',()=>{
  assert.match(MANUAL,/\*\*Versión:\*\* 1\.5/);
  assert.doesNotMatch(MANUAL,/Control de versión del manual/);
  assert.doesNotMatch(MANUAL,/\bmutaciones\b/i);
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
  assert.ok(unique.size>=42,'se esperan al menos 42 screenshots únicos');
  for(const shot of [
    'nueva-cotizacion','pedidos-tabla','pedidos-planificacion','maquinas-planificacion',
    'finanzas-facturas','finanzas-por-cobrar','correo-redactar','centro-conexiones-detalle','reportar-problema'
  ]) assert.ok(unique.has(shot),'falta screenshot '+shot);
});

test('manual web convierte imágenes markdown en figuras responsivas',()=>{
  assert.match(PAGE,/function manualImageSrc\(/);
  assert.match(PAGE,/manual-shot/);
  assert.match(PAGE,/loading="lazy"/);
  assert.match(PAGE,/docs\/manual\//);
});
