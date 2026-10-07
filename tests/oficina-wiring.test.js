#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OFFICE = fs.readFileSync(path.join(ROOT, 'js', 'oficina.js'), 'utf8');
const AGENTS = fs.readFileSync(path.join(ROOT, 'js', 'agentes.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'worker.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'access-auth.js'), 'utf8');
const MACHINES = fs.existsSync(path.join(ROOT, 'js', 'maquinas.js'))
  ? fs.readFileSync(path.join(ROOT, 'js', 'maquinas.js'), 'utf8')
  : '';
const SOURCE = `${INDEX}\n${OFFICE}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function count(re, text = SOURCE) {
  return (text.match(re) || []).length;
}

function balancedEnd(source, openIndex) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i];
    const n = source[i + 1];
    const p = source[i - 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (c === quote && p !== '\\') quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function fn(name, text = OFFICE) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const found = re.exec(text);
  assert.ok(found, `falta ${name}()`);
  const open = text.indexOf('{', found.index);
  const end = balancedEnd(text, open);
  assert.notEqual(end, -1, `llaves desbalanceadas en ${name}()`);
  return text.slice(found.index, end + 1);
}

function uniqueFunction(name, text = OFFICE) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g');
  assert.equal(count(re, text), 1, `${name} debe existir exactamente una vez`);
}

test('OFICINA conserva navegación y superficies principales', () => {
  assert.equal(count(/id=["']tab-oficina["']/g, INDEX), 1, '#tab-oficina debe ser único');
  assert.match(SOURCE, /(?:switchTab|switchTabMobile)\(\s*['"]oficina['"]\s*\)/, 'falta navegación a Oficina');
  for (const id of [
    'oficinaKpis', 'oficinaCards', 'oficinaFloor', 'oficinaIso',
    'oficinaFeed', 'oficinaCharts', 'ofHealth', 'oficinaAlerts'
  ]) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones operativas críticas no se redefinen', () => {
  [
    'renderOficina', '_renderOficina', 'startOficinaPolling', 'stopOficinaPolling',
    '_ofHasData', '_ofStatus', '_ofSafeUrl', '_ofRenderHealth', '_ofRenderAlerts',
    '_ofRenderCards', '_ofRenderFloor', '_ofRenderIso', '_ofRenderFeed',
    '_ofRenderCharts', '_ofOpenRun', 'ofExport', 'ofDigest', '_ofCanTab'
  ].forEach(name => uniqueFunction(name));
});

test('el render evita solapamientos y conserva un render pendiente', () => {
  const render = fn('renderOficina');
  assert.match(render, /_oficinaBusy/);
  assert.match(render, /_ofPendingRender\s*=\s*true/);
  assert.match(render, /await\s+_renderOficina\s*\(/);
  assert.match(render, /finally/);
  assert.match(render, /setTimeout\s*\(/);
});

test('el polling respeta visibilidad y se limpia al salir', () => {
  const start = fn('startOficinaPolling');
  assert.match(start, /45000/);
  assert.match(start, /20000/);
  assert.match(start, /document\.hidden/);
  const stop = fn('stopOficinaPolling');
  assert.match(stop, /clearInterval\s*\(_oficinaInterval\)/);
  assert.match(stop, /clearInterval\s*\(_ofClockTimer\)/);
  assert.match(stop, /clearTimeout\s*\(_ofCommTimer\)/);
  assert.match(stop, /clearTimeout\s*\(_ofCelebTimer\)/);
});

test('la oficina admite token o proxy y avisa cuando está ciega', () => {
  const hasData = fn('_ofHasData');
  assert.match(hasData, /hasAirtableAccess/);
  assert.match(hasData, /getToken/);
  const health = fn('_ofRenderHealth');
  assert.match(health, /Sin conexión/);
  assert.match(health, /Datos en caché/);
  assert.match(OFFICE, /oficinaErr/);
});

test('el modelo consume un snapshot autoritativo con cinco fuentes y timestamps', () => {
  const render=fn('_renderOficina');
  assert.match(render, /_ofFetchSnapshot/);
  assert.match(render, /snap\?\.runs/);
  assert.match(render, /pending_count/);
  assert.match(render, /snap\?\.automations/);
  assert.match(render, /snap\?\.printers/);
  assert.match(render, /snap\?\.inventory/);
  assert.match(WORKER, /source\[name\]=\{ok:true,at:/);
  assert.match(WORKER, /agent_log/);
  assert.match(WORKER, /agent_queue/);
  assert.match(WORKER, /automations/);
  assert.match(WORKER, /machines/);
  assert.match(WORKER, /inventory/);
});

test('el snapshot tiene cache corta e invalidación manual', () => {
  assert.match(OFFICE,/const\s+_OF_CACHE_MS\s*=\s*25000/);
  assert.match(fn('_ofFetchSnapshot'),/_ofRunsCache/);
  const refresh=fn('refreshOficina');
  assert.match(refresh,/_ofRunsCache\s*=\s*\{t:0/);
});

test('las tres vistas comparten el mismo modelo de trabajadores', () => {
  const render = fn('_renderOficina');
  assert.match(render, /iaModel/);
  assert.match(render, /autoModel/);
  assert.match(render, /printerModel/);
  assert.match(render, /_ofRenderIso/);
  assert.match(render, /_ofRenderFloor/);
  assert.match(render, /_ofRenderCards/);
  assert.match(fn('_ofRenderIso'), /role=["']img["']/);
  assert.match(fn('_ofRenderIso'), /aria-label/);
});

test('Oficina recibe telemetría de impresoras desde el snapshot compartido', () => {
  const render=fn('_renderOficina');
  assert.match(render, /snap\?\.printers/);
  assert.match(render, /lastTelemetry/);
  assert.match(render, /telemetry/);
  assert.doesNotMatch(render, /si la pestaña Impresoras la ha poblado/);
});

test('feed y detalle escapan la consulta antes de mostrarla', () => {
  const feed = fn('_ofRenderFeed');
  assert.match(feed, /escapeHtml/);
  assert.match(feed, /substring\(0,120\)/);
  assert.match(feed, /ofFeedView/);
  const open = fn('_ofOpenRun');
  assert.match(open, /_ofRunVisibleText\(r,false\)/);
  assert.match(open, /escapeHtml\(input\)/);
  assert.match(open, /formatAgentReport\(output\)/);
});

test('URLs de imágenes se restringen antes de entrar a la escena', () => {
  const safe = fn('_ofSafeUrl');
  assert.match(safe, /https?/i);
  assert.match(safe, /data:image/);
  assert.doesNotMatch(safe, /javascript:/i);
  assert.match(OFFICE, /img:_ofSafeUrl/);
});

test('las alertas, salud y acciones consideran RBAC', () => {
  const alerts = fn('_ofRenderAlerts');
  assert.match(alerts, /_ofRenderHealth/);
  assert.match(alerts, /_ofCanTab/);
  assert.match(alerts, /of-error/);
  assert.match(alerts, /atras/i);
  const canTab = fn('_ofCanTab');
  assert.match(canTab, /RBAC\.tabs/);
  assert.match(canTab, /AUTH\.getUser/);
});

test('resumen y exportación usan el snapshot actual sin romper la escena', () => {
  const digest = fn('ofDigest');
  assert.match(digest, /_ofModel/);
  assert.match(digest, /_ofKpiSnap/);
  assert.match(digest, /clipboard\.writeText/);
  const exp = fn('ofExport');
  assert.match(exp, /cloneNode\(true\)/);
  assert.match(exp, /XMLSerializer/);
  assert.match(exp, /URL\.revokeObjectURL/);
});

test('la suite smoke continúa cubriendo el cableado general', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tests', 'smoke.test.js')), 'falta tests/smoke.test.js');
  const smoke = fs.readFileSync(path.join(ROOT, 'tests', 'smoke.test.js'), 'utf8');
  assert.match(smoke, /oficina/i);
});


test('Agent_Log se pagina completamente en backend y declara cobertura 30 días',()=>{
  assert.match(WORKER,/async function officeList/);
  assert.match(WORKER,/do\{/);
  assert.match(WORKER,/offset/);
  assert.match(WORKER,/coverage=\{complete30d:/);
  assert.match(WORKER,/31\*24\*3600000/);
  assert.doesNotMatch(fn('_renderOficina'),/airtableFetch\(['"]Agent_Log['"],\s*100/);
});

test('la cola cuenta exclusivamente Pendiente',()=>{
  assert.match(WORKER,/formula:"\{Estado\}='Pendiente'"/);
  assert.match(WORKER,/pending_count:/);
  assert.doesNotMatch(fn('_renderOficina'),/Agent_Queue[^\n]*\.length/);
});

test('las ejecuciones tienen ID durable y dedupe por executionId',()=>{
  assert.match(AGENTS,/_officeExecId/);
  assert.match(AGENTS,/executionId/);
  assert.match(AGENTS,/_dedupKey\(r\)\{return r\.executionId/);
  assert.match(WORKER,/\{Execution ID\}/);
});

test('Trabajando requiere estado running y heartbeat fresco',()=>{
  const state=fn('_ofRunState');
  assert.match(state,/state===['"]running['"]/);
  assert.match(state,/heartbeatAt/);
  assert.match(state,/60000/);
  assert.match(state,/Ejecución sin heartbeat/);
  assert.doesNotMatch(fn('_renderOficina'),/_ofActive\.has/);
});

test('errores de agentes quedan durables en el ciclo compartido',()=>{
  assert.match(AGENTS,/_officeExecutionFail/);
  assert.match(AGENTS,/action:['"]error['"]/);
  assert.match(WORKER,/Error ejecución/);
  assert.match(WORKER,/Estado ejecución.*error/);
});

test('automatizaciones tienen cadencia y estados de health explícitos',()=>{
  assert.match(WORKER,/OFFICE_AUTOMATION_EXPECT/);
  for(const id of ['lead-worker','airtable-proxy','printer-bridge','mail-api','sii-worker'])
    assert.match(WORKER,new RegExp(id));
  assert.match(WORKER,/state:'unknown'/);
  assert.match(WORKER,/state:'degraded'/);
  assert.match(WORKER,/state:'down'/);
  assert.match(WORKER,/state:'paused'/);
  assert.match(WORKER,/state:'healthy'/);
});

test('telemetría ausente degrada salud y backlog no cambia health del worker',()=>{
  assert.match(WORKER,/autoBad/);
  assert.match(WORKER,/health=sourceBad\.length\|\|autoBad\.length\|\|printerBad\.length\?'degraded':'healthy'/);
  const render=fn('_renderOficina');
  assert.doesNotMatch(render,/lead-worker[^\n]*queueLen[^\n]*En cola/);
});

test('EjecucionesHoy sólo cuenta con período y zona verificados',()=>{
  assert.match(WORKER,/Periodo ejecuciones/);
  assert.match(WORKER,/Zona horaria/);
  assert.match(WORKER,/today_verified/);
  assert.match(fn('_renderOficina'),/x\.today_verified/);
});

test('inventario y máquinas forman parte de salud/frescura del snapshot',()=>{
  assert.match(WORKER,/healthRequired=\['agent_log','agent_queue','automations','machines','inventory'\]/);
  assert.match(WORKER,/lastTelemetry/);
  assert.match(WORKER,/telemetry=last/);
  assert.match(fn('_renderOficina'),/snap\?\.inventory/);
});

test('feed y detalle consumen texto redaccionado por rol',()=>{
  assert.match(WORKER,/officeRunForRole/);
  assert.match(WORKER,/contentRestricted/);
  assert.match(WORKER,/officeMaskText/);
  assert.match(fn('_ofRenderFeed'),/_ofRunVisibleText/);
  assert.match(fn('_ofOpenRun'),/contentRestricted/);
});

test('fechas analíticas usan America Santiago y setDate calendar-safe',()=>{
  const dateLogic=[fn('_ofSpark'),fn('_ofDayInsight'),fn('_ofBarsDays'),fn('_ofHeatmap')].join('\n');
  assert.match(dateLogic,/America\/Santiago/);
  assert.match(dateLogic,/setDate/);
  assert.doesNotMatch(dateLogic,/Math\.round\([^\n]*\/864e5/);
});

test('ranking declara volumen y sólo aparece con cobertura completa',()=>{
  const render=fn('_renderOficina');
  assert.match(render,/Mayor volumen/);
  assert.match(render,/if\(coverage\)/);
  assert.doesNotMatch(render,/Empleado del mes/);
});

test('copias, digest, detalle y exportación tienen confirmación o auditoría',()=>{
  assert.match(fn('_ofOpenRun'),/_ofAudit\('view'/);
  assert.match(fn('ofFeedCopy'),/confirm\(/);
  assert.match(fn('ofFeedCopy'),/_ofAudit\('copy'/);
  assert.match(fn('ofDigest'),/confirm\(/);
  assert.match(fn('ofDigest'),/_ofAudit\('digest'/);
  assert.match(fn('ofExport'),/confirm\(/);
  assert.match(fn('ofExport'),/_ofAudit\('export'/);
  assert.match(WORKER,/Oficina_Auditoria/);
});

test('SVG exportado no conserva imágenes remotas',()=>{
  const exp=fn('ofExport');
  assert.match(exp,/querySelectorAll\('image'\).*remove/);
  assert.doesNotMatch(OFFICE,/https:\/\/dashboard\.thelab\.solutions\/logo-thelab\.png/);
});

test('incidencias son trazables con responsable SLA y cierre',()=>{
  assert.match(WORKER,/Incidencias_Operativas/);
  assert.match(WORKER,/Responsable/);
  assert.match(WORKER,/SLA/);
  assert.match(WORKER,/Estado:'Resuelta'/);
  assert.match(WORKER,/\/office\/incidents/);
});

test('retención y contenido indexable quedan acotados',()=>{
  assert.match(WORKER,/Retener hasta/);
  assert.match(WORKER,/31\*24\*3600000/);
  assert.match(AGENTS,/this\._runs\.length>50/);
  assert.match(AGENTS,/output:String\(output\|\|''\)\.substring\(0,1200\)/);
});

test('RBAC expone Oficina mediante rutas dedicadas y mantiene Agent_Log admin-only',()=>{
  assert.match(ACCESS,/path===['"]\/office\/snapshot['"]/);
  assert.match(ACCESS,/path===['"]\/office\/execution['"]/);
  assert.match(ACCESS,/path===['"]\/office\/audit['"]/);
  assert.match(ACCESS,/path===['"]\/office\/incidents['"]/);
  assert.match(ACCESS,/ACCESS_ADMIN_ONLY_TABLES/);
  assert.match(ACCESS,/Agent_Log/);
});

test('suite no deja TODO diagnósticos de Oficina',()=>{
  assert.doesNotMatch(fs.readFileSync(__filename,'utf8'),/test\.todo|t\.todo/);
});
