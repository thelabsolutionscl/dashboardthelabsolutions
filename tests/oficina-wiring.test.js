#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const OFFICE = fs.readFileSync(path.join(ROOT, 'js', 'oficina.js'), 'utf8');
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

test('el modelo integra las cinco fuentes operativas', () => {
  const render = fn('_renderOficina');
  assert.match(render, /AGENT_LOG\._runs/);
  assert.match(render, /airtableFetch\(['"]Agent_Log['"],\s*100\)/);
  assert.match(render, /Agent_Queue/);
  assert.match(render, /airtableFetch\([^\n]*200/);
  assert.match(render, /airtableFetch\(['"]Automations['"],\s*50\)/);
  assert.match(render, /airtableFetch\(['"]Maquinas['"],\s*200\)/);
  assert.match(render, /airtableFetch\(['"]Inventario['"],\s*200\)/);
});

test('las cachés tienen ventana acotada e invalidación manual', () => {
  assert.match(OFFICE, /const\s+_OF_CACHE_MS\s*=\s*25000/);
  for (const cache of ['_ofRunsCache', '_ofQueueCache', '_ofAutoCache', '_ofMaqCache', '_ofInvCache']) {
    assert.match(OFFICE, new RegExp(esc(cache)), `falta ${cache}`);
  }
  const refresh = fn('refreshOficina');
  assert.match(refresh, /_ofRunsCache\s*=\s*\{t:0/);
  assert.match(refresh, /_ofQueueCache\s*=\s*\{t:0/);
  assert.match(refresh, /_ofAutoCache\s*=\s*\{t:0/);
  assert.match(refresh, /_ofMaqCache\s*=\s*\{t:0/);
  assert.match(refresh, /_ofInvCache\s*=\s*\{t:0/);
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

test('el modo de impresoras prioriza telemetría en vivo cuando existe', () => {
  const render = fn('_renderOficina');
  assert.match(render, /_printerStatus/);
  assert.match(render, /lv\s*&&\s*lv\.state/);
  assert.match(render, /printing/);
  assert.match(render, /progress/);
  assert.match(render, /eta/);
  if (MACHINES) assert.match(MACHINES, /_printerStatus/);
});

test('feed y detalle escapan la consulta antes de mostrarla', () => {
  const feed = fn('_ofRenderFeed');
  assert.match(feed, /escapeHtml/);
  assert.match(feed, /substring\(0,120\)/);
  assert.match(feed, /ofFeedView/);
  const open = fn('_ofOpenRun');
  assert.match(open, /escapeHtml\(String\(r\.input\)\)/);
  assert.match(open, /formatAgentReport\(r\.output\)/);
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

test('diagnóstico: Agent_Log debe paginar o agregarse en backend', (t) => {
  const render = fn('_renderOficina');
  if (/airtableFetch\(['"]Agent_Log['"],\s*100\)/.test(render) && !/offset|paginate|cursor|aggregate/i.test(render)) {
    t.todo('CRÍTICO: 7/14/30 días, ranking y empleado del mes no pueden depender de solo 100 filas');
    return;
  }
});

test('diagnóstico: la cola debe contar solo pendientes y paginar', (t) => {
  const render = fn('_renderOficina');
  if (/queueLen\s*=\s*\(q\.records\|\|\[\]\)\.length/.test(render) && !/Estado[^\n]*(Pendiente|Procesando)/i.test(render)) {
    t.todo('CRÍTICO: consultar/contar estados pendientes procesables; no todos los registros históricos de Agent_Queue');
    return;
  }
});

test('diagnóstico: dedupe de ejecuciones necesita ID durable', (t) => {
  const render = fn('_renderOficina');
  if (/slice\(0,30\)/.test(render) && !/external.?id|run.?id|execution.?id|record.?id/i.test(render)) {
    t.todo('usar ID de ejecución/recordId; agent+timestamp+prefijo puede colapsar runs legítimos o duplicar local/remoto');
    return;
  }
});

test('diagnóstico: Trabajando requiere ciclo de ejecución o heartbeat', (t) => {
  const status = fn('_ofStatus');
  if (/d\s*<\s*90000/.test(status) && !/heartbeat|started|finished|running/i.test(status)) {
    t.todo('CRÍTICO: no inferir presencia actual desde una ejecución terminada hace <90s');
    return;
  }
});

test('diagnóstico: errores de agentes deben ser compartidos y durables', (t) => {
  if (/const\s+_ofAgentErrors\s*=\s*\{\}/.test(OFFICE)) {
    t.todo('persistir error, ejecución, timestamp y recuperación en telemetría compartida; hoy vive solo en el navegador');
    return;
  }
});

test('diagnóstico: todas las automatizaciones necesitan heartbeat y cadencia', (t) => {
  if (/expectMins:90/.test(OFFICE) && count(/expectMins\s*:/g, OFFICE) < 5) {
    t.todo('definir expected cadence/heartbeat por automatización y alertar “Sin telemetría” o atraso');
    return;
  }
});

test('diagnóstico: la salud no debe quedar verde con telemetría ausente', (t) => {
  const alerts = fn('_ofRenderAlerts');
  const health = fn('_ofRenderHealth');
  if (!/Sin telemetría/.test(alerts) && /Todo en orden/.test(health)) {
    t.todo('CRÍTICO: automatizaciones sin telemetría deben degradar salud o aparecer como estado desconocido');
    return;
  }
});

test('diagnóstico: la cola no demuestra que Lead Worker esté sano', (t) => {
  const render = fn('_renderOficina');
  if (/lead-worker/.test(render) && /queueLen/.test(render) && /En cola/.test(render)) {
    t.todo('separar backlog de disponibilidad del worker; un worker caído también puede acumular cola');
    return;
  }
});

test('diagnóstico: EjecucionesHoy debe tener período verificable', (t) => {
  const render = fn('_renderOficina');
  if (/EjecucionesHoy/.test(render) && !/Fecha.*Ejecuciones|Periodo|D[ií]a de conteo|countDate/i.test(render)) {
    t.todo('no sumar un contador stale sin fecha/zona; almacenar período y reset confirmado');
    return;
  }
});

test('diagnóstico: inventario debe afectar frescura y salud', (t) => {
  const render = fn('_renderOficina');
  if (/el estante es decorativo: un fallo aquí no marca _ofErr/.test(render)) {
    t.todo('mostrar origen/frescura/error del inventario; el resumen operativo no debe ocultar una lectura fallida');
    return;
  }
});

test('diagnóstico: telemetría de impresoras no debe depender de otra pestaña', (t) => {
  const render = fn('_renderOficina');
  if (/si la pestaña Impresoras la ha poblado/.test(render)) {
    t.todo('Oficina debe consultar heartbeat/estado del bridge directamente o compartir un store central inicializado');
    return;
  }
});

test('diagnóstico: el snapshot necesita timestamp por fuente', (t) => {
  const render = fn('_renderOficina');
  if (/_ofRunsCache/.test(render) && /_ofAutoCache/.test(render) && !/sourceTimestamp|snapshotAt|asOf|frescura por fuente/i.test(render)) {
    t.todo('mostrar “as of” de logs, cola, automatizaciones, máquinas e inventario; hoy se mezclan momentos distintos');
    return;
  }
});

test('diagnóstico: feed y detalle requieren redacción por rol', (t) => {
  const feed = fn('_ofRenderFeed');
  const open = fn('_ofOpenRun');
  if (/r\.input/.test(feed) && /r\.output/.test(open) && !/redact|mask|sensitive|fieldPermission|canView/i.test(feed + open)) {
    t.todo('CRÍTICO: ocultar prompts/resultados sensibles según rol y tipo de agente; búsqueda/copia no deben saltarse permisos');
    return;
  }
});

test('diagnóstico: fechas deben ser calendar-safe para America/Santiago', (t) => {
  const dateLogic = [fn('_ofSpark'), fn('_ofDayInsight'), fn('_ofBarsDays'), fn('_ofHeatmap')].join('\n');
  if (/864e5|86400000/.test(dateLogic) && !/America\/Santiago|Temporal|setDate\(/.test(dateLogic)) {
    t.todo('evitar aritmética fija de 24h en comparaciones por día; Chile cambia DST');
    return;
  }
});

test('diagnóstico: rankings deben declararse como volumen, no desempeño', (t) => {
  const render = fn('_renderOficina');
  if (/Empleado del mes/.test(render) && /MÁS ejecuciones/.test(render)) {
    t.todo('renombrar a “mayor volumen” o incorporar calidad, SLA, costo, error y resultado de negocio');
    return;
  }
});

test('diagnóstico: empleado del mes no debe usar una muestra incompleta', (t) => {
  const render = fn('_renderOficina');
  if (/count30/.test(render) && /Agent_Log['"],100/.test(render)) {
    t.todo('ocultar/advertir el premio hasta disponer de los 30 días completos y consistentes entre navegadores');
    return;
  }
});

test('diagnóstico: exportar/copiar datos requiere política de sensibilidad', (t) => {
  const text = fn('_ofOpenRun') + fn('ofFeedCopy') + fn('ofDigest') + fn('ofExport');
  if (/clipboard\.writeText/.test(text) && !/confirm|redact|sensitive|permission/i.test(text)) {
    t.todo('aplicar permisos/redacción y confirmación al copiar resultados, digest y exportaciones sensibles');
    return;
  }
});

test('diagnóstico: el SVG exportado debería ser autocontenido', (t) => {
  if (/https:\/\/dashboard\.thelab\.solutions\/logo-thelab\.png/.test(OFFICE)) {
    t.todo('embebir el logo o advertir dependencia externa; el SVG exportado puede quedar roto/offline');
    return;
  }
});

test.todo('agregar healthcheck independiente del Worker/Make para distinguir activo, degradado, desconocido y caído');
test.todo('convertir alertas de automatización/impresora en incidencias trazables con responsable, SLA y cierre');
test.todo('limitar retención y contenido indexable del feed de actividad según política de privacidad');
