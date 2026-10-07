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
const PROXY = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'worker.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'airtable-proxy', 'src', 'access-auth.js'), 'utf8');
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

test('el envío real usa exclusivamente el transporte seguro del proxy', () => {
  const send = block('async function nlDestSend(', 'function _nlEstBadge');
  assert.match(send, /confirm\s*\(/);
  assert.match(send, /\/newsletter\/send/);
  assert.match(send, /credentials:['"]include['"]/);
  assert.match(send, /X-App-Key/);
  assert.doesNotMatch(send, /MAIL\.post\(/);
  assert.match(send, /campaignId:c\.id/);
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

test('el servidor reserva Newsletter_Envios antes de llamar a Resend', () => {
  const worker=PROXY;
  assert.match(worker,/Newsletter_Envios/);
  const reserveAt=worker.indexOf("encodeURIComponent('Newsletter_Envios')");
  const resendAt=worker.indexOf("https://api.resend.com/emails");
  assert.ok(reserveAt>=0&&resendAt>reserveAt);
  assert.match(worker,/Idempotency-Key/);
  assert.match(worker,/newsletter\/['"]?\+envio\.id/);
  assert.match(worker,/terminal=new Set\(\['Enviado','Entregado','Abierto','Click'\]\)/);
});

test('el secreto HMAC del newsletter es obligatorio y exclusivo', () => {
  const secret = block('function nlSecret(', 'async function nlSign', WORKER);
  const sign = block('async function nlSign(', '// HMAC-SHA256', WORKER);
  assert.match(secret, /NEWSLETTER_SECRET/);
  assert.doesNotMatch(secret, /PUBLIC_LEAD_KEY|thelab-newsletter|AIRTABLE_TOKEN/);
  assert.match(sign, /if \(!secret\) throw new Error\(["']NEWSLETTER_SECRET no configurado["']\)/);
});

test('la selección de destinatarios se versiona en Newsletter_Campañas', () => {
  const save=block('async function nlDestSave(', 'async function nlDestSend');
  assert.doesNotMatch(save,/localStorage\.setItem/);
  assert.match(save,/Newsletter_Campañas['"],['"]PATCH/);
  assert.match(save,/AUDIENCIA NEWSLETTER/);
  assert.match(save,/savedAt/);
  assert.match(save,/savedBy/);
  assert.match(save,/exclude/);
  assert.match(save,/extra/);
  assert.match(save,/noResend/);
});

test('noResend queda congelado en la audiencia aprobada y el servidor respeta ledger', () => {
  const save=block('async function nlDestSave(', 'async function nlDestSend');
  assert.match(save,/approved/);
  assert.match(save,/noResend/);
  assert.match(PROXY,/terminal=new Set/);
  assert.match(PROXY,/suppressedStates=new Set/);
});

test('una campaña parcial queda Pausada y el servidor conserva resultado por destinatario', () => {
  assert.match(PROXY,/finalState=\(failed\|\|suppressed\)\?['"]Pausada['"]:['"]Enviada['"]/);
  assert.match(PROXY,/PENDING_RECONCILIATION/);
  assert.match(PROXY,/ERROR Resend/);
  assert.match(PROXY,/NEWSLETTER_CLOSE_UNCERTAIN/);
});

test('cada envío real genera baja firmada y personalizada',()=>{
  assert.match(PROXY,/unsubscribe:\+email|['"]unsubscribe:['"]\+email/);
  assert.match(PROXY,/NEWSLETTER_SECRET/);
  assert.match(PROXY,/NEWSLETTER_UNSUBSCRIBE_BASE/);
  assert.match(PROXY,/newsletter\/unsubscribe\?e=/);
});
test('Resend recibe List-Unsubscribe y one-click POST',()=>{
  assert.match(PROXY,/['"]List-Unsubscribe['"]/);
  assert.match(PROXY,/['"]List-Unsubscribe-Post['"]/);
  assert.match(PROXY,/List-Unsubscribe=One-Click/);
});
test('los emails extra exigen opt-in vigente en Clientes',()=>{
  const add=block('function nlDestAddExtra(', 'function nlDestRemoveExtra');
  assert.match(add,/Suscrito newsletter/);
  assert.match(add,/Baja newsletter/);
  assert.match(add,/Email válido/);
  assert.match(add,/state\.clientes/);
});
test('Enviada no puede marcarse manualmente sin evidencia de transporte',()=>{
  const set=block('async function nlSetEstado(', '// Modal date-picker');
  assert.match(set,/estado===['"]Enviada['"]/);
  assert.match(set,/solo lo establece un transporte con evidencia/);
  assert.match(REDES,/Cerrar administrativamente/);
});
test('cada envío Resend lleva tag del Newsletter_Envios exacto',()=>{
  assert.match(PROXY,/tags:\[\{name:['"]envio_id['"],value:String\(envio\.id\)\}/);
  assert.match(PROXY,/resend_id=/);
});
test('clicks técnicos o sin URL no convierten al destinatario en lead caliente',()=>{
  const classify=block('function newsletterCommercialClick(', 'async function handleNewsletterResendWebhook', WORKER);
  const webhook=block('async function handleNewsletterResendWebhook(', '/* ── Newsletter: helpers', WORKER);
  assert.match(classify,/newsletter\\\/unsubscribe|unsubscribe|privacidad|privacy|preferencias|preferences/);
  assert.match(classify,/^https/);
  assert.match(webhook,/if\(commercial\)\{patch\.Estado=['"]Click['"];patch\[['"]Fecha click['"]\]=when;patch\[['"]Lead caliente['"]\]=true;\}/);
  assert.doesNotMatch(webhook,/patch\[['"]Lead caliente['"]\]=true[^}]*else/s);
});
test('rebote, baja y spam suprimen futuros envíos antes de Resend',()=>{
  assert.match(PROXY,/suppressedStates=new Set\(\['Rebote','Baja','Spam'\]\)/);
  assert.match(PROXY,/suppressedEmails\.has\(email\)/);
});
test('programación guarda hora/zona y el servidor aplica lease, lock y due check',()=>{
  const schedule=block('async function nlSchedule(', '// Corrige dominios');
  assert.match(schedule,/HH:MM/);
  assert.match(schedule,/America\/Santiago/);
  assert.match(schedule,/PROGRAMACION NEWSLETTER/);
  assert.match(PROXY,/newsletter-lock:/);
  assert.match(PROXY,/10\*60\*1000/);
  assert.match(PROXY,/NEWSLETTER_LOCKED/);
  assert.match(PROXY,/NEWSLETTER_NOT_DUE/);
  assert.match(PROXY,/schedule\.zone!==['"]America\/Santiago['"]/);
});
test('la baja GET no muta y POST exige token firmado',()=>{
  const unsub=block('async function handleNewsletterUnsubscribe(', '/* ── Newsletter: helpers', WORKER);
  assert.match(unsub,/request\.method===["']GET["']/);
  assert.match(unsub,/request\.method===["']POST["']/);
  assert.match(unsub,/nlVerify\(env, ["']unsubscribe["']/);
  const getAt=unsub.indexOf('request.method==="GET"');
  const updateAt=unsub.indexOf('airtableUpdateTolerant');
  assert.ok(getAt>=0&&updateAt>getAt);
  assert.match(unsub,/<form method="post"/);
});
test('la vista previa usa iframe sandbox y no envía referrer',()=>{
  const preview=block('function _nlShowPreview(', 'function nlPreview');
  assert.match(preview,/setAttribute\(['"]sandbox['"],['"]['"]\)/);
  assert.match(preview,/referrerpolicy/);
  assert.match(preview,/Content-Security-Policy/);
  assert.match(preview,/default-src \\'none\\'/);
});
test('el alta manual conserva fuente, fecha, usuario y evidencia',()=>{
  const save=block('async function nlSubSave(', 'async function nlSubRemove');
  assert.match(save,/NEWSLETTER CONSENT/);
  assert.match(save,/source:['"]Alta manual dashboard['"]/);
  assert.match(save,/date:new Date\(\)\.toISOString\(\)/);
  assert.match(save,/user:actor/);
  assert.match(save,/evidence/);
});
test('la UI declara y usa una sola ruta autoritativa de envío',()=>{
  const send=block('async function nlDestSend(', 'function _nlEstBadge');
  assert.match(send,/\/newsletter\/send/);
  assert.doesNotMatch(send,/MAIL\.post/);
  assert.match(PROXY,/tls-newsletter-send/);
  assert.match(ACCESS,/path===['"]\/newsletter\/send['"][\s\S]*method===['"]POST['"][\s\S]*admin/);
});
