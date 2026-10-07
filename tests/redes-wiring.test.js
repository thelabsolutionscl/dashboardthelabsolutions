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
  assert.match(load, /airtableFetch\(['"]Social_Posts['"],\s*2000\)/);
  assert.match(load, /airtableFetch\(['"]Social_Interactions['"],\s*2000\)/);
  assert.match(load, /airtableFetch\(['"]Social_Metrics['"],\s*5000\)/);
  assert.match(load, /airtableFetch\(['"]Automations['"],\s*50\)/);
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

test('crear lead se delega al proxy transaccional e idempotente', () => {
  const lead = fn('redesInteractionToLead');
  assert.match(lead, /\/social\/lead/);
  assert.match(lead, /credentials:['"]include['"]/);
  assert.match(lead, /interactionId:id/);
  assert.doesNotMatch(lead, /_redesWrite\(['"]Clientes['"],\s*['"]POST['"]/);
  assert.doesNotMatch(lead, /_redesWrite\(['"]Agent_Queue['"],\s*['"]POST['"]/);
  assert.match(lead, /Cliente ID/);
  assert.match(lead, /Agent Queue ID/);
});

test('el piloto automático pide confirmación y usa el wrapper de escritura', () => {
  const autopilot = fn('redesAutopilot');
  assert.match(autopilot, /_redesBusyAuto/);
  assert.match(autopilot, /confirm\s*\(/);
  assert.match(autopilot, /_redesFillGapsCore/);
  assert.match(autopilot, /_redesWrite\(['"]Social_Posts['"],\s*['"]PATCH['"]/);
  const fill = fn('_redesFillGapsCore');
  assert.match(fill, /CAPTION_AGENT/);
  assert.match(fill, /Estado:['"]En revisión['"]/);
  assert.match(fill, /Aprobación editorial/);
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

test('el webhook social autentica, normaliza y registra vía guard idempotente', () => {
  const social=fn('handleSocial',WORKER);
  const guarded=fn('socialProcessGuarded',WORKER);
  assert.match(social,/SOCIAL_WEBHOOK_KEY/);
  assert.match(social,/SOCIAL_EVENT_GUARD/);
  assert.match(social,/normalizeSocial/);
  assert.match(social,/externalEventId/);
  assert.match(guarded,/Social_Interactions/);
  assert.match(guarded,/External event ID/);
  assert.match(guarded,/airtableCreateTolerant/);
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

test('el webhook social exige un secreto exclusivo', () => {
  const social = fn('handleSocial', WORKER);
  assert.match(social, /X-Social-Webhook-Key/);
  assert.match(social, /SOCIAL_WEBHOOK_KEY/);
  assert.doesNotMatch(social, /X-Public-Lead-Key|env\.PUBLIC_LEAD_KEY/);
  assert.match(social, /Webhook social no configurado/);
  assert.match(social, /503/);
});

test('el webhook exige identidad externa y usa un guard atómico', () => {
  const social=fn('handleSocial',WORKER),norm=fn('normalizeSocial',WORKER);
  assert.match(social,/SOCIAL_EVENT_GUARD/);
  assert.match(social,/externalEventId/);
  assert.match(social,/platformUserId/);
  assert.match(norm,/external_event_id|event_id/);
  assert.match(norm,/platform_user_id|user_id/);
  assert.match(norm,/fechaOriginal/);
  assert.match(WORKER,/export class SocialEventGuard/);
});

test('el Worker enlaza Cliente y Agent_Queue en la interacción', () => {
  assert.match(WORKER,/Lead creado/);
  assert.match(WORKER,/Cliente ID/);
  assert.match(WORKER,/Agent Queue ID/);
  assert.match(WORKER,/socialProcessGuarded/);
});

test('la conversión manual ya no crea Cliente o cola desde el navegador', () => {
  const lead=fn('redesInteractionToLead');
  assert.match(lead,/\/social\/lead/);
  assert.doesNotMatch(lead,/Clientes['"],['"]POST/);
  assert.doesNotMatch(lead,/Agent_Queue['"],['"]POST/);
});

test('Publicado exige evidencia externa de plataforma', () => {
  const setState=fn('redesSetEstado'),edit=fn('redesSaveEdit');
  for(const src of [setState,edit]){
    assert.match(src,/External Post ID/);
    assert.match(src,/Permalink/);
    assert.match(src,/Fecha publicación/);
  }
  assert.match(WORKER,/handleSocialPublish/);
  assert.match(WORKER,/external_post_id/);
});

test('el panel automático usa heartbeats de Automations', () => {
  const status=fn('_redesAutoStatus');
  assert.match(status,/state\.socialAutomations/);
  assert.match(status,/UltimaEjecucion/);
  assert.match(status,/social-listen/);
  assert.match(status,/social-metrics/);
  assert.match(status,/social-publish/);
  assert.doesNotMatch(status,/socialPosts|socialInteractions|socialMetrics/);
});

test('piloto y auto-programación pasan por revisión editorial', () => {
  const fill=fn('_redesFillGapsCore'),auto=fn('redesAutoSchedule');
  assert.match(fill,/En revisión/);
  assert.match(fill,/Aprobación editorial/);
  assert.doesNotMatch(fill,/Estado:['"]Programado['"]/);
  assert.match(auto,/En revisión/);
  assert.match(auto,/pending_review/);
});

test('el reporte semanal usa una ventana cerrada de siete días', () => {
  const ctx=fn('_redesBuildMetricsContext');
  assert.match(ctx,/inRange/);
  assert.match(ctx,/t>=since\.getTime\(\)&&t<=now\.getTime\(\)/);
  assert.match(ctx,/interWeek/);
  assert.match(ctx,/Estado===['"]Publicado['"]/);
});

test('el mejor día usa tasa por alcance o promedio por registro', () => {
  const best=fn('_redesBestByWeekday');
  assert.match(best,/reach/);
  assert.match(best,/count/);
  assert.match(best,/eng\/x\.reach|x\.eng\/x\.reach/);
});

test('las lecturas sociales usan ventanas amplias y telemetría explícita', () => {
  const load=fn('redesLoad');
  assert.match(load,/Social_Posts['"],2000/);
  assert.match(load,/Social_Interactions['"],2000/);
  assert.match(load,/Social_Metrics['"],5000/);
});

test('diagnóstico: eliminar en demo debe pasar por _redesWrite', (t) => {
  const del = fn('redesDeletePost');
  assert.match(del, /_redesWrite\(['"]Social_Posts['"],\s*['"]DELETE['"]/);
  assert.doesNotMatch(del, /airtableWrite\(['"]Social_Posts['"],\s*['"]DELETE['"]/);
});

test('Respondido exige evidencia de respuesta externa', () => {
  const mark=fn('redesMarkInteraction');
  assert.match(mark,/Fecha respuesta/);
  assert.match(mark,/Canal respuesta/);
  assert.match(mark,/External reply ID/);
  assert.match(mark,/requiere canal e ID externo confirmado/);
});

test('el editor bloquea Publicado sin evidencia', () => {
  const save=fn('redesSaveEdit');
  assert.match(save,/External Post ID/);
  assert.match(save,/Permalink/);
  assert.match(save,/Fecha publicación/);
  assert.match(save,/No puedes marcar Publicado/);
});

test('Social_Metrics usa upsert por red y fecha',()=>{
  assert.match(WORKER,/handleSocialMetrics/);
  assert.match(WORKER,/Período/);
  assert.match(WORKER,/socialFindOne\(env,"Social_Metrics"/);
  assert.match(WORKER,/airtableUpdateTolerant\(env,"Social_Metrics"/);
});
test('los leads sociales deduplican por red + platform_user_id',()=>{
  assert.match(WORKER,/Social identity key/);
  assert.match(WORKER,/platformUserId/);
  assert.match(WORKER,/airtableFindCliente\(env,\{socialIdentity\}/);
});
test('Media URL y Link requieren HTTPS antes de guardarse para integración',()=>{
  const save=fn('redesSaveEdit');
  assert.match(save,/\^https:/);
  assert.match(save,/Media URL y Link deben usar HTTPS/);
});
test('las quejas crean ticket con SLA y responsable',()=>{
  assert.match(WORKER,/Ticket estado/);
  assert.match(WORKER,/Ticket SLA/);
  assert.match(WORKER,/Ticket responsable/);
});
test('el contenido IA guarda procedencia y aprobación editorial',()=>{
  const base=fn('_redesBaseFields');
  assert.match(base,/IA auditoría/);
  assert.match(base,/promptVersion/);
  assert.match(base,/model/);
  assert.match(base,/approvedBy/);
  assert.match(REDES,/Aprobación editorial/);
});
