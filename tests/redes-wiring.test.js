#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const REDES = fs.readFileSync(path.join(ROOT, 'js', 'redes.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');
const DOCS = fs.readFileSync(path.join(ROOT, 'docs', 'REDES_SOCIALES.md'), 'utf8');
const SOURCE = `${INDEX}\n${REDES}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function count(re, text = SOURCE) {
  return (text.match(re) || []).length;
}

function uniqueFunction(name, text = REDES) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g');
  assert.equal(count(re, text), 1, `${name} debe existir exactamente una vez`);
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

function fn(name, text = REDES) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`);
  const found = re.exec(text);
  assert.ok(found, `falta ${name}()`);
  const open = text.indexOf('{', found.index);
  const end = balancedEnd(text, open);
  assert.notEqual(end, -1, `llaves desbalanceadas en ${name}()`);
  return text.slice(found.index, end + 1);
}

test('REDES conserva navegación y contenedores críticos', () => {
  assert.equal(count(/id=["']tab-redes["']/g, INDEX), 1, '#tab-redes debe ser único');
  assert.match(SOURCE, /(?:switchTab|switchTabMobile)\(\s*['"]redes['"]\s*\)/, 'falta navegación a Redes');
  for (const id of [
    'redesPostsList', 'redesInboxList', 'redesMetrics', 'redesGenInput',
    'redesGenBtn', 'redesAutoPanel', 'redesBestTimes', 'redesRecycle'
  ]) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones principales no se redefinen silenciosamente', () => {
  [
    'initRedes', 'redesLoad', 'renderRedesKpis', 'renderRedesPosts',
    'renderRedesInbox', 'renderRedesMetrics', 'renderRedesBestTimes',
    'renderRedesRecycle', 'redesGenerate', '_redesRunGenerate',
    'redesSaveDraft', 'redesSaveSplit', 'redesSchedule', 'redesSetEstado',
    'redesReply', 'redesReplyAllPending', '_redesSuggestReply',
    'redesInteractionToLead', 'redesAutopilot', 'redesAutoSchedule',
    '_redesFillGapsCore', '_redesAutoStatus', 'renderRedesAutoPanel',
    'redesWeeklyReport', 'redesEmailReport'
  ].forEach(name => uniqueFunction(name));
});

test('la carga usa las tres tablas sociales y evita recargas solapadas', () => {
  const load = fn('redesLoad');
  assert.match(load, /_redesLoadBusy/);
  assert.match(load, /airtableFetch\(['"]Social_Posts['"],\s*200\)/);
  assert.match(load, /airtableFetch\(['"]Social_Interactions['"],\s*200\)/);
  assert.match(load, /airtableFetch\(['"]Social_Metrics['"],\s*365\)/);
  assert.match(load, /finally\s*\{\s*_redesLoadBusy\s*=\s*false/);
});

test('el modo demo intercepta escrituras productivas', () => {
  const write = fn('_redesWrite');
  assert.match(write, /if\s*\(_redesDemo\)/);
  assert.match(write, /demo_/);
  assert.match(write, /airtableWriteTolerant/);
  const seed = fn('redesDemoSeed');
  assert.match(seed, /state\.socialPosts/);
  assert.match(seed, /state\.socialInteractions/);
  assert.match(seed, /state\.socialMetrics/);
  assert.match(seed, /Nada se guarda|no se guardan/i);
});

test('el ciclo editorial exige fecha al programar y conserva revisión', () => {
  const render = fn('renderRedesPosts');
  for (const state of ['Borrador', 'En revisión', 'Programado', 'Publicado']) {
    assert.match(REDES, new RegExp(esc(state)), `falta estado ${state}`);
  }
  assert.match(render, /redesSchedule/);
  assert.match(render, /A revisión/);
  assert.match(render, /Aprobar y programar/);
  const schedule = fn('redesSchedule');
  assert.match(schedule, /redesDatePicker/);
  assert.match(schedule, /Estado['"]?\s*:\s*['"]Programado['"]/);
  assert.match(schedule, /Fecha programada/);
  assert.match(schedule, /_redesWrite\(['"]Social_Posts['"],\s*['"]PATCH['"]/);
});

test('la generación puede usar producción real y guarda posts trazables', () => {
  const fromOrder = fn('redesGenerateFromPedido');
  assert.match(fromOrder, /Despachado|pedido entregado/i);
  assert.match(fromOrder, /Foto QA URL/);
  assert.match(fromOrder, /CAPTION_AGENT/);
  const save = fn('redesSaveDraft');
  assert.match(save, /Social_Posts/);
  assert.match(save, /Estado['"]?\s*:\s*['"]Borrador['"]|_redesBaseFields/);
  assert.match(save, /Copy/);
  assert.match(save, /Hashtags/);
  assert.match(fn('redesSaveSplit'), /_redesSplitByNetwork/);
});

test('la bandeja persiste sugerencias y detecta leads sin saturar Claude', () => {
  const suggest = fn('_redesSuggestReply');
  assert.match(suggest, /COMMUNITY_AGENT/);
  assert.match(suggest, /RESPUESTA_PUBLICA/);
  assert.match(suggest, /ES_LEAD/);
  assert.match(suggest, /Respuesta sugerida/);
  assert.match(suggest, /Social_Interactions/);
  const bulk = fn('redesReplyAllPending');
  assert.match(bulk, /_redesReplyBusy/);
  assert.match(bulk, /for\s*\(/);
  assert.match(bulk, /await\s+_redesSuggestReply/);
});

test('crear lead enlaza Clientes, Agent_Queue e interacción', () => {
  const lead = fn('redesInteractionToLead');
  assert.match(lead, /_redesLeadCreated/);
  assert.match(lead, /_redesWrite\(['"]Clientes['"],\s*['"]POST['"]/);
  assert.match(lead, /_redesWrite\(['"]Agent_Queue['"],\s*['"]POST['"]/);
  assert.match(lead, /social\.lead_received/);
  assert.match(lead, /LEAD_AGENT/);
  assert.match(lead, /Lead creado['"]?\s*:\s*true/);
});

test('el piloto automático pide confirmación y usa el wrapper de escritura', () => {
  const autopilot = fn('redesAutopilot');
  assert.match(autopilot, /_redesBusyAuto/);
  assert.match(autopilot, /confirm\s*\(/);
  assert.match(autopilot, /_redesFillGapsCore/);
  assert.match(autopilot, /_redesWrite\(['"]Social_Posts['"],\s*['"]PATCH['"]/);
  const fill = fn('_redesFillGapsCore');
  assert.match(fill, /CAPTION_AGENT/);
  assert.match(fill, /_redesWrite\(['"]Social_Posts['"],\s*['"]POST['"]/);
});

test('métricas y reporte semanal usan datos observados y transporte de Correo', () => {
  const metrics = fn('renderRedesMetrics');
  assert.match(metrics, /state\.socialMetrics/);
  assert.match(metrics, /Alcance/);
  assert.match(metrics, /Engagement/);
  assert.match(metrics, /Clics/);
  assert.match(metrics, /Leads/);
  const report = fn('redesWeeklyReport');
  assert.match(report, /REPORT_SOCIAL_AGENT/);
  assert.match(report, /_redesBuildMetricsContext/);
  assert.match(fn('redesEmailReport'), /MAIL\.post/);
});

test('el webhook social autentica, normaliza y registra interacciones', () => {
  assert.match(WORKER, /url\.pathname\s*===\s*["']\/webhooks\/social["']/);
  const social = fn('handleSocial', WORKER);
  assert.match(social, /X-Social-Webhook-Key/);
  assert.match(social, /SOCIAL_WEBHOOK_KEY/);
  assert.match(social, /Social_Interactions/);
  assert.match(social, /normalizeSocial/);
  assert.match(social, /createLeadAndQueue/);
  assert.match(fn('normalizeSocial', WORKER), /Instagram/);
  assert.match(fn('socialIsComplaint', WORKER), /reclamo|problema/);
});

test('RBAC acota las escrituras sociales del rol marketing', () => {
  assert.match(SOURCE, /socialWriteTables/);
  assert.match(SOURCE, /Social_Posts/);
  assert.match(SOURCE, /Social_Interactions/);
  assert.match(SOURCE, /Social_Metrics/);
  assert.match(SOURCE, /Agent_Queue/);
  assert.match(SOURCE, /marketing/);
});

test('la suite lógica existente sigue siendo parte del contrato', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tests', 'redes.test.js')), 'falta tests/redes.test.js');
  assert.match(DOCS, /Social_Posts/);
  assert.match(DOCS, /Social_Interactions/);
  assert.match(DOCS, /Social_Metrics/);
});

test('diagnóstico: el webhook debe usar un secreto exclusivo', (t) => {
  const social = fn('handleSocial', WORKER);
  if (/PUBLIC_LEAD_KEY/.test(social)) {
    t.todo('CRÍTICO: eliminar fallback a PUBLIC_LEAD_KEY; SOCIAL_WEBHOOK_KEY debe ser obligatorio y rotatable');
    return;
  }
});

test('diagnóstico: el webhook debe deduplicar eventos externos', (t) => {
  const social = fn('handleSocial', WORKER);
  if (!/idempot|event.?id|external.?id|dedup|upsert/i.test(social)) {
    t.todo('CRÍTICO: reservar/upsert por red + id externo antes de crear interacción o lead');
    return;
  }
});

test('diagnóstico: el lead creado por Worker debe cerrar la interacción', (t) => {
  const social = fn('handleSocial', WORKER);
  if (/createLeadAndQueue/.test(social) && !/Lead creado/.test(social)) {
    t.todo('CRÍTICO: al crear Cliente/Agent_Queue desde el Worker, marcar Lead creado y guardar IDs en Social_Interactions');
    return;
  }
});

test('diagnóstico: crear lead desde dashboard debe ser transaccional e idempotente', (t) => {
  const lead = fn('redesInteractionToLead');
  const createAt = lead.indexOf("_redesWrite('Clientes','POST'");
  const markAt = lead.indexOf("_redesWrite('Social_Interactions','PATCH'");
  if (createAt >= 0 && markAt > createAt) {
    t.todo('reservar la interacción antes de crear Cliente; compensar/recuperar si falla cola o PATCH final');
    return;
  }
});

test('diagnóstico: Publicado debe venir de evidencia externa', (t) => {
  const setState = fn('redesSetEstado');
  if (/Fecha publicación/.test(setState) && !/external|platform|post.?id|permalink|publicaci[oó]n URL/i.test(setState)) {
    t.todo('no tratar un clic local como publicación real; exigir ID/URL/estado devuelto por la plataforma o marcarlo como manual');
    return;
  }
});

test('diagnóstico: el panel automático necesita healthchecks reales', (t) => {
  const status = fn('_redesAutoStatus');
  if (/Estado['"]?\]\s*\|\|['"]['"]\)\s*===\s*['"]Publicado['"]/.test(status) && !/heartbeat|health|integration|connector/i.test(status)) {
    t.todo('no inferir Make activo por registros recientes; usar heartbeat por escenario/conector y fecha de última ejecución');
    return;
  }
});

test('diagnóstico: el piloto no debe saltarse la aprobación editorial', (t) => {
  const fill = fn('_redesFillGapsCore');
  const auto = fn('redesAutoSchedule');
  if (/Estado['"]?\s*:\s*['"]Programado['"]/.test(fill) && /Borrador/.test(auto) && /Programado/.test(auto)) {
    t.todo('generar como En revisión o guardar una aprobación explícita/versionada antes de que Make pueda publicar');
    return;
  }
});

test('diagnóstico: el reporte semanal debe excluir futuro y datos fuera de rango', (t) => {
  const ctx = fn('_redesBuildMetricsContext');
  if (/new Date\(d\)\s*>=\s*since/.test(ctx) && !/<=\s*now|Date\.now\(\)/.test(ctx.replace(/const since[^;]+;/, ''))) {
    t.todo('acotar publicaciones e interacciones a [hoy-7d, hoy]; hoy incluye programaciones futuras y cuenta todas las interacciones cargadas');
    return;
  }
});

test('diagnóstico: mejor día debe normalizar por volumen', (t) => {
  const best = fn('_redesBestByWeekday');
  if (/\[wd\]\s*\+=\s*m\.fields\['Engagement'\]/.test(best) && !/count|promedio|average|reach|rate/i.test(best)) {
    t.todo('usar engagement promedio/tasa por publicación o alcance; sumar bruto favorece días con más registros');
    return;
  }
});

test('diagnóstico: las lecturas sociales deben paginar', (t) => {
  const load = fn('redesLoad');
  if (/Social_Posts['"],\s*200/.test(load) && !/offset|paginate|while\s*\(/i.test(load)) {
    t.todo('paginar o usar vistas/rangos explícitos; los topes 200/200/365 truncarán calendario, inbox y analítica');
    return;
  }
});

test('diagnóstico: eliminar en demo debe pasar por _redesWrite', (t) => {
  const del = fn('redesDeletePost');
  if (/airtableWrite\(['"]Social_Posts['"],\s*['"]DELETE['"]/.test(del) && !/_redesWrite/.test(del)) {
    t.todo('usar _redesWrite también para DELETE para que el modo demo no llame al backend productivo');
    return;
  }
});

test('diagnóstico: Respondido debe guardar evidencia', (t) => {
  const mark = fn('redesMarkInteraction');
  if (/Estado/.test(mark) && !/reply.?id|respuesta enviada|fecha respuesta|canal respuesta|evidencia/i.test(mark)) {
    t.todo('diferenciar “marcado manualmente” de respuesta confirmada por la plataforma y guardar fecha/ID externo');
    return;
  }
});

test('diagnóstico: edición a Publicado debe completar datos de publicación', (t) => {
  const save = fn('redesSaveEdit');
  if (/Estado/.test(save) && /Fecha programada/.test(save) && !/Fecha publicación/.test(save)) {
    t.todo('si el editor permite Estado=Publicado, exigir Fecha publicación y evidencia o impedir ese cambio');
    return;
  }
});

test.todo('Social_Metrics debe usar upsert por red+fecha para evitar duplicar días y distorsionar tendencias');
test.todo('los leads sociales deben deduplicarse por red+usuario/ID de plataforma, no solo por interacción');
test.todo('Media URL y Link deben validarse con allowlist/protocolo antes de que Make o una plataforma remota los consuma');
test.todo('quejas deben crear ticket/escalamiento con SLA, responsable y cierre, no solo una etiqueta heurística');
test.todo('las decisiones y contenido generados por IA deben registrar prompt/modelo/versión/aprobador para auditoría de marca');
