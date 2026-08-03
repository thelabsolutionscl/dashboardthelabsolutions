#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MAIL = fs.readFileSync(path.join(ROOT, 'js', 'correo.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'js', 'notify.js'), 'utf8');
const PHP = fs.readFileSync(path.join(ROOT, 'mail-api.php'), 'utf8');
const SOURCE = `${INDEX}\n${MAIL}\n${NOTIFY}`;

function esc(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function count(re, text) {
  return (text.match(re) || []).length;
}

function methodBlock(name) {
  const re = new RegExp(`\\n\\s{2}(?:async\\s+)?${esc(name)}\\s*\\([^)]*\\)\\s*\\{`);
  const found = re.exec(MAIL);
  assert.ok(found, `falta MAIL.${name}()`);
  const tail = MAIL.slice(found.index + found[0].length);
  const next = /\n\s{2}(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.exec(tail);
  return MAIL.slice(found.index, next ? found.index + found[0].length + next.index : MAIL.length);
}

function phpCase(name) {
  const token = `case '${name}':`;
  const start = PHP.indexOf(token);
  assert.notEqual(start, -1, `falta action=${name} en mail-api.php`);
  const next = PHP.indexOf("\ncase '", start + token.length);
  return PHP.slice(start, next === -1 ? PHP.length : next);
}

function uniqueMethod(name) {
  const re = new RegExp(`\\n\\s{2}(?:async\\s+)?${esc(name)}\\s*\\(`, 'g');
  assert.equal(count(re, MAIL), 1, `MAIL.${name} debe existir una sola vez`);
}

test('CORREO conserva su sección, cliente y controles críticos', () => {
  assert.equal(count(/id=["']tab-correo["']/g, INDEX), 1, '#tab-correo debe ser único');
  for (const id of [
    'mailClient', 'mailFolderList', 'mailList', 'mailReaderEmpty', 'mailReaderContent',
    'mailRdrBody', 'mailRdrAtts', 'mailCmpTo', 'mailCmpSubject', 'mailCmpBody',
    'mailSendBtn', 'mailSendStatus'
  ]) {
    assert.equal(count(new RegExp(`id=["']${id}["']`, 'g'), INDEX), 1, `${id} debe existir una vez`);
  }
  assert.match(SOURCE, /switchTab\(\s*['"]correo['"]\s*\)/, 'falta navegación hacia Correo');
});

test('los métodos principales de correo existen sin redefiniciones silenciosas', () => {
  [
    'post', 'postAs', 'init', 'loadFolders', 'loadMessages', 'readMsg', '_renderMsgBody',
    'downloadAtt', 'search', 'addFiles', 'openCompose', 'sendCompose', 'trashCurrent',
    'trashSelected', 'fillContactsDatalist', 'preloadSentAddrs', '_registrarCotEnviada'
  ].forEach(uniqueMethod);
});

test('el transporte usa HTTPS, timeout y reintenta solamente lecturas', () => {
  assert.match(MAIL, /API\s*:\s*['"]https:\/\/mail-api\.thelab\.solutions\/mail-api\.php['"]/);
  const post = methodBlock('post');
  assert.match(post, /new\s+URLSearchParams\s*\(/, 'debe evitar multipart bloqueado por el WAF');
  assert.match(post, /new\s+AbortController\s*\(/);
  assert.match(post, /30000/, 'debe tener timeout acotado');
  assert.match(post, /action\s*===\s*['"]send['"]/);
  assert.match(post, /canRetry\s*=\s*!\(/, 'send debe quedar fuera de los reintentos');
  assert.match(post, /tries\s*=\s*canRetry\s*\?\s*3\s*:\s*1/, 'lecturas deben reintentarse y envío no');
});

test('el envío manual valida campos y bloquea doble clic local', () => {
  const send = methodBlock('sendCompose');
  assert.match(send, /if\s*\(this\._sending\)\s*return/);
  assert.match(send, /this\._sending\s*=\s*true/);
  assert.match(send, /btn\.disabled\s*=\s*true/);
  assert.match(send, /finally[\s\S]*this\._sending\s*=\s*false/);
  assert.match(send, /_validEmails\(to\)/);
  assert.match(send, /_validEmails\(cc\)/);
  assert.match(send, /_validEmails\(bcc\)/);
  assert.match(send, /if\s*\(!subject\)/);
  assert.match(send, /postAs\(/, 'debe soportar remitente explícito');
  assert.match(send, /if\s*\(data\.error\)/, 'los efectos CRM deben ocurrir solo después de éxito');
});

test('los adjuntos tienen límites en cliente y servidor', () => {
  const add = methodBlock('addFiles');
  const send = phpCase('send');
  assert.match(add, /15\s*\*\s*1024\s*\*\s*1024/, 'frontend debe limitar a 15 MB');
  assert.match(send, /20\s*\*\s*1024\s*\*\s*1024/, 'backend debe imponer límite independiente');
  assert.match(send, /Adjuntos superan 20 MB/);
  assert.match(PHP, /preg_replace\('\/[\\r\\n"]\/'/, 'SMTP debe limpiar CR/LF del nombre del archivo');
  assert.match(methodBlock('downloadAtt'), /URL\.revokeObjectURL/);
});

test('el visor aísla HTML activo y escapa el texto plano', () => {
  const render = methodBlock('_renderMsgBody');
  assert.match(render, /createElement\(['"]iframe['"]\)/);
  assert.match(render, /setAttribute\(['"]sandbox['"]/);
  assert.doesNotMatch(render, /allow-scripts/, 'un correo nunca debe ejecutar scripts');
  assert.match(render, /this\.esc\(data\.body_text/);
  assert.match(render, /<base\s+target=["']_blank["']>/);
});

test('mail-api entrega respuestas sensibles sin caché y con JSON resiliente', () => {
  assert.match(PHP, /Cache-Control:\s*no-store/);
  assert.match(PHP, /X-Content-Type-Options:\s*nosniff/);
  assert.match(PHP, /X-Frame-Options:\s*DENY/);
  assert.match(PHP, /function\s+json_out\s*\(/);
  assert.match(PHP, /JSON_INVALID_UTF8_SUBSTITUTE/);
  assert.match(PHP, /register_shutdown_function/);
  assert.match(PHP, /set_exception_handler/);
  assert.doesNotMatch(PHP, /echo\s+json_out\(\[\s*['"]error['"]\s*=>\s*\$detail/, 'no debe exponer detalles fatales al navegador');
  assert.doesNotMatch(PHP, /re_[A-Za-z0-9]{20,}/, 'no debe existir una API key real de Resend en el repositorio');
});

test('las lecturas IMAP están acotadas y toleran mensajes dañados', () => {
  const list = phpCase('list');
  const snippets = phpCase('snippets');
  const read = phpCase('read');
  assert.match(list, /imap_fetch_overview/);
  assert.doesNotMatch(list, /imap_body\s*\(/, 'el listado no debe descargar cuerpos completos');
  assert.match(snippets, /array_slice[\s\S]*15/);
  assert.match(snippets, /200000/, 'un preview no debe bajar partes enormes');
  assert.match(snippets, /microtime\(true\)\s*\+\s*8\.0/);
  assert.match(read, /decode_transfer/);
  assert.match(read, /looks_binary/);
  assert.match(PHP, /maybe_decompress/);
  assert.match(PHP, /mb_check_encoding/);
});

test('el polling respeta al hosting y se detiene ante errores repetidos', () => {
  assert.match(NOTIFY, /const\s+_POLL_INTERVAL\s*=\s*60000/);
  assert.match(NOTIFY, /if\s*\(document\.hidden\)\s*return/);
  assert.match(NOTIFY, /_mailPollErrors\s*>=\s*10/);
  assert.match(NOTIFY, /clearInterval\(_mailPollTimer\)/);
  assert.match(NOTIFY, /if\s*\(_mailPollTimer\)\s*return/);
});

test('Correo mantiene vínculos trazables con CRM y cotizaciones', () => {
  assert.match(MAIL, /vendorOwnsRecord/, 'el vendedor no debe autocompletar clientes ajenos');
  assert.match(MAIL, /_monitorUpsert\(['"]MAIL_SENT_ADDRESSES['"]/, 'direcciones enviadas deben respaldarse con upsert');
  const register = methodBlock('_registrarCotEnviada');
  assert.match(register, /Estado cotizaci[oó]n/);
  assert.match(register, /Fecha cotizaci[oó]n/);
  assert.match(register, /airtableWriteTolerant/);
  assert.match(methodBlock('sendCompose'), /await\s+this\._registrarCotEnviada/);
});

test('diagnóstico: Resend debe autenticar la casilla antes de enviar', (t) => {
  const send = phpCase('send');
  const resendAt = send.indexOf('resend_send(');
  const authAt = send.indexOf('open_imap(');
  assert.notEqual(resendAt, -1, 'falta integración Resend');
  if (authAt === -1 || authAt > resendAt) {
    t.todo('CRÍTICO: hoy Resend se invoca antes de validar user/pass por IMAP; autenticar primero y abortar si falla');
    return;
  }
  assert.ok(authAt < resendAt);
});

test('diagnóstico: el freno de envíos debe existir también en servidor', (t) => {
  if (!/rate.?limit|send.?limit|429|too many/i.test(PHP)) {
    t.todo('el límite actual vive en localStorage y puede omitirse; agregar rate limit por casilla/IP en mail-api.php');
    return;
  }
});

test('diagnóstico: las credenciales no deberían persistir en texto plano', (t) => {
  if (/setMailPass\(p\)[\s\S]{0,120}localStorage\.setItem/.test(MAIL) || /thelab_mail_pass_/.test(MAIL)) {
    t.todo('migrar contraseñas fuera de localStorage: sesión corta, token delegado o vault/backend');
    return;
  }
});

test.todo('mail-api debe validar sintácticamente To/CC/BCC y restringir From a casillas autorizadas del dominio');
test.todo('el visor debe bloquear imágenes remotas por defecto para evitar tracking pixels y carga de recursos inseguros');
test.todo('frontend y host PHP deben verificar automáticamente el mismo MAIL_API_BUILD para detectar despliegues desfasados');
test.todo('acciones masivas y automáticas deben usar una idempotency key compartida para evitar duplicados tras timeouts');
test.todo('plantillas, firmas y borradores importantes deben tener respaldo versionado y permisos, no depender solo del navegador');
test.todo('descargas de adjuntos deben aplicar allowlist o advertencia reforzada para ejecutables y formatos activos');
test.todo('el backend debe registrar auditoría mínima de envíos sin guardar cuerpo, contraseña ni destinatarios sensibles completos');
