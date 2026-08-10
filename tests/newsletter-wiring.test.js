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
const DOCS = fs.readFileSync(path.join(ROOT, 'docs', 'NEWSLETTER.md'), 'utf8');
const SOURCE = `${INDEX}\n${REDES}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function count(re, text = SOURCE) {
  return (text.match(re) || []).length;
}
function unique(name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${esc(name)}\\s*\\(`, 'g');
  assert.equal(count(re, REDES), 1, `${name} debe existir una sola vez`);
}
function block(startToken, endToken, text = REDES) {
  const start = text.indexOf(startToken);
  assert.notEqual(start, -1, `falta ${startToken}`);
  const end = endToken ? text.indexOf(endToken, start + startToken.length) : text.length;
  assert.notEqual(end, -1, `falta límite ${endToken}`);
  return text.slice(start, end);
}

test('NEWSLETTER conserva navegación y contenedores críticos únicos', () => {
  assert.equal(count(/id=["']tab-newsletter["']/g, INDEX), 1, '#tab-newsletter debe ser único');
  assert.match(SOURCE, /switchTab\(\s*['"]newsletter['"]\s*\)/, 'falta navegación a Newsletter');
  for (const id of [
    'nlCampaignsList', 'nlLeadsList', 'nlSubsList', 'nlAnalytics',
    'nlGenInput', 'nlGenBtn', 'nlDestModal', 'nlPreviewFrame'
  ]) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
});

test('las funciones principales no tienen redefiniciones silenciosas', () => {
  [
    'initNewsletter', 'nlLoad', 'renderNlKpis', 'renderNlCampaigns',
    'renderNlLeads', 'renderNlAudience', 'renderNlSubscribers', 'nlGenerate',
    'nlSaveDraft', 'nlSetEstado', 'nlSchedule', 'nlSendTest', 'nlDestSend',
    '_nlSubList', '_nlBaseDest', '_nlDestResolve', '_nlDestWorking',
    '_nlMdToHtml', '_nlEmailHtml', '_nlEngByEmail', '_nlRecentRecipients',
    'renderNlAnalytics', 'nlLeadToTask'
  ].forEach(unique);
});

test('la carga usa las tablas autoritativas de campañas y envíos', () => {
  const load = block('async function nlLoad(', '// Audiencia =');
  assert.match(load, /airtableFetch\(['"]Newsletter_Campañas['"],\s*200\)/);
  assert.match(load, /airtableFetch\(['"]Newsletter_Envios['"],\s*1000\)/);
  assert.match(load, /state\.nlCampaigns/);
  assert.match(load, /state\.nlEnvios/);
  assert.match(load, /finally|_nlLoaded\s*=\s*true/);
});

test('la audiencia elegible exige opt-in y excluye bajas', () => {
  const subs = block('function _nlSubList(', 'function renderNlSubscribers');
  assert.match(subs, /Suscrito newsletter['"]?\]\s*===\s*true/);
  assert.match(subs, /Baja newsletter['"]?\]\s*!==\s*true/);
  assert.match(subs, /Email/);
  const resolve = block('function _nlDestResolve(', 'function nlDestCount');
  assert.match(resolve, /_nlBaseDest\(seg\)/);
  assert.match(resolve, /new Set/);
  assert.match(resolve, /toLowerCase\(\)/, 'debe deduplicar email sin distinguir mayúsculas');
});

test('los segmentos inteligentes se derivan de engagement real', () => {
  const base = block('function _nlBaseDest(', 'function _nlSmartSegOptions');
  for (const seg of ['@openers', '@nonopeners', '@clickers', '@inactive']) {
    assert.match(base, new RegExp(esc(seg)), `falta segmento ${seg}`);
  }
  assert.match(base, /_nlEngByEmail\(\)/);
  assert.match(block('function _nlEngByEmail(', '// Emails que ya recibieron'), /Newsletter_Envios|state\.nlEnvios/);
});

test('el envío directo confirma, separa destinatarios y no reintenta en lote por BCC', () => {
  const send = block('async function nlDestSend(', 'function _nlEstBadge');
  assert.match(send, /confirm\s*\(/, 'un envío real debe pedir confirmación');
  assert.match(send, /for\s*\(let\s+i\s*=\s*0;\s*i\s*<\s*list\.length/);
  assert.match(send, /MAIL\.post\(\{action:['"]send['"],to:list\[i\]\.email/);
  assert.doesNotMatch(send, /bcc\s*:/i, 'la audiencia no debe exponerse por CCO compartido');
  // El éxito ahora además registra al destinatario para el anti-doble-envío
  // (ver tests/newsletter.test.js). Sigue contando ok/fail por separado.
  assert.match(send, /if\(r&&!r\.error\)\{ok\+\+;enviados\.push\(list\[i\]\.email\)\;\}else fail\+\+/);
  assert.match(send, /_nlRecordSent\(enviados\)/, 'registra a quién le llegó');
});

test('el ciclo editorial conserva borrador, revisión, programación y envío', () => {
  const render = block('function renderNlCampaigns(', 'async function nlSetEstado');
  for (const state of ['Borrador', 'En revisión', 'Programada', 'Enviada']) {
    assert.match(REDES, new RegExp(esc(state)), `falta estado ${state}`);
  }
  assert.match(render, /nlSchedule/);
  assert.match(render, /nlSendTest/);
  const schedule = block('async function nlSchedule(', '// Corrige dominios');
  assert.match(schedule, /Estado['"]?\s*:\s*['"]Programada['"]/);
  assert.match(schedule, /Fecha envío/);
  assert.match(schedule, /_redesWrite\(['"]Newsletter_Campañas['"],['"]PATCH['"]/);
});

test('la plantilla escapa contenido y contiene una vía visible de baja', () => {
  const markdown = block('function _nlMdToHtml(', '// Envuelve el cuerpo');
  const html = block('function _nlEmailHtml(', 'function _nlShowPreview');
  assert.match(markdown, /escapeHtml\(/);
  assert.match(markdown, /https\?:\\\/\\\//, 'los enlaces deben limitarse a http/https o mailto');
  assert.match(html, /Darme de baja/);
  assert.match(html, /hola@thelab\.solutions/);
  assert.match(html, /Cuerpo \(Markdown\)/);
});

test('el alta web incluye doble opt-in, anti-bot y confirmación firmada', () => {
  assert.match(WORKER, /POST[^\n]*\/newsletter|url\.pathname\s*===\s*["']\/newsletter["']/);
  assert.match(WORKER, /\/newsletter\/confirm/);
  assert.match(WORKER, /\/newsletter\/unsubscribe/);
  assert.match(WORKER, /NEWSLETTER_DOUBLE_OPTIN/);
  assert.match(WORKER, /RESEND_API_KEY/);
  assert.match(WORKER, /turnstile|Turnstile/i);
  assert.match(WORKER, /rateLimit|rate.?limit/i);
  assert.match(WORKER, /hmacB64u|HMAC/i);
});

test('leads calientes se enlazan a seguimiento con anti-duplicado', () => {
  const leads = block('async function nlLeadToTask(', 'function renderNlAudience');
  assert.match(leads, /createAgentQueueItem/);
  assert.match(leads, /FOLLOWUP_AGENT/);
  assert.match(leads, /newsletter\.hot_lead/);
  assert.match(leads, /Tarea creada/);
  assert.match(leads, /_nlHotTasked/);
});

test('la analítica deriva tasas y mejor horario desde envíos observados', () => {
  const rate = block('function _nlCampRate(', 'function _nlBestSendTime');
  const best = block('function _nlBestSendTime(', 'function renderNlAnalytics');
  assert.match(rate, /state\.nlEnvios/);
  assert.match(rate, /Fecha apertura/);
  assert.match(rate, /Fecha click/);
  assert.match(best, /Fecha apertura/);
  assert.match(best, /getDay\(\)/);
  assert.match(best, /getHours\(\)/);
});

test('RBAC declara acceso y escritura específica para Newsletter', () => {
  assert.match(SOURCE, /newsletterWriteTables/);
  assert.match(SOURCE, /RBAC[\s\S]{0,16000}newsletter/);
  assert.match(SOURCE, /marketing/);
});

test('diagnóstico: el envío directo debe crear Newsletter_Envios antes de enviar', (t) => {
  const send = block('async function nlDestSend(', 'function _nlEstBadge');
  if (!/_redesWrite\(['"]Newsletter_Envios['"]/.test(send)) {
    t.todo('CRÍTICO: crear/upsert una fila por campaña+destinatario antes del envío para tracking e idempotencia');
    return;
  }
});

test('diagnóstico: el secreto HMAC no debe caer a una clave pública o fija', (t) => {
  const secret = block('function nlSecret(', 'async function nlSign', WORKER);
  if (/PUBLIC_LEAD_KEY|thelab-newsletter|AIRTABLE_TOKEN/.test(secret)) {
    t.todo('CRÍTICO: NEWSLETTER_SECRET debe ser obligatorio y exclusivo, sin fallback público, fijo ni reutilizado');
    return;
  }
});

test('diagnóstico: la selección de destinatarios debe persistir junto a la campaña', (t) => {
  const save = block('function nlDestSave(', 'async function nlDestSend');
  if (/localStorage\.setItem/.test(save) && !/Newsletter_Campañas/.test(save)) {
    t.todo('guardar segmento, exclusiones, extras y noResend en backend/versionados por campaña');
    return;
  }
});

test('diagnóstico: el filtro anti-reenvío debe cubrir también envíos directos', (t) => {
  const recent = block('function _nlRecentRecipients(', '// ── (1) Analítica');
  const send = block('async function nlDestSend(', 'function _nlEstBadge');
  if (/state\.nlEnvios/.test(recent) && !/Newsletter_Envios/.test(send)) {
    t.todo('hoy noResend consulta Newsletter_Envios, pero nlDestSend no registra allí sus envíos');
    return;
  }
});

test('diagnóstico: una campaña parcial no debe cerrarse silenciosamente como enviada', (t) => {
  const send = block('async function nlDestSend(', 'function _nlEstBadge');
  if (/fail\+\+/.test(send) && /Estado['"]?:['"]Enviada['"]/.test(send) && /catch\(_\)\{\}/.test(send)) {
    t.todo('mantener estado Parcial/Error, detalle por destinatario y reanudación idempotente; no silenciar el PATCH final');
    return;
  }
});

test.todo('cada envío debe llevar enlace de baja firmado y personalizado, no solo un mailto genérico');
test.todo('agregar headers List-Unsubscribe y List-Unsubscribe-Post para clientes compatibles');
test.todo('los emails extra no deben saltarse el consentimiento: exigir opt-in registrado o flujo de confirmación');
test.todo('marcar Enviada manualmente debe requerir evidencia de envío o quedar como cierre administrativo diferenciado');
test.todo('el tracking debe correlacionar por id/tag de Newsletter_Envios, nunca solo por email');
test.todo('un clic de baja, privacidad o recursos técnicos no debe convertir al destinatario en lead caliente');
test.todo('rebotes y quejas deben suprimir automáticamente futuros envíos y actualizar Email válido/Baja');
test.todo('la programación debe incluir hora, zona America/Santiago, lease y lock para impedir dos workers enviando la misma campaña');
test.todo('el endpoint de baja no debe mutar por GET rastreable sin protección contra scanners; usar token opaco y one-click POST compatible');
test.todo('la vista previa HTML debe usar iframe sandbox sin scripts y bloquear recursos remotos por defecto');
test.todo('la gestión manual de suscriptores debe conservar fuente, fecha y evidencia del consentimiento');
test.todo('documentación y UI deben declarar una sola ruta autoritativa de envío: dashboard o Make, no ambas sin conciliación');
