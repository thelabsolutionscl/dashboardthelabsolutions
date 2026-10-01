#!/usr/bin/env node
/*
 * El formulario público (cotiza.html) y lo que lo defiende.
 *
 * Es la única página del proyecto que toca un desconocido, así que todo lo que
 * llega por ahí es hostil hasta que se demuestre lo contrario. No calcula
 * precios —es captación— pero sí acepta texto libre, un archivo adjunto y
 * parámetros de la URL, y pinta la respuesta del servidor en pantalla.
 *
 * Correr:  node --test tests/cotizador-publico.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COTIZA = fs.readFileSync(path.join(ROOT, 'cotiza.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'lead-worker', 'src', 'index.js'), 'utf8');

// El escapador tal cual va en la página.
const _esc = (() => {
  const i = COTIZA.indexOf('function _esc(');
  const fuente = COTIZA.slice(i, COTIZA.indexOf('\n', i));
  return new Function(`${fuente}\nreturn _esc;`)();
})();

test('lo que responde el servidor se escapa antes de pintarse', () => {
  // _show usa innerHTML. Hoy los errores de /lead son mensajes fijos, pero basta
  // que alguien agregue uno que repita lo que escribió el visitante para
  // volverlo ejecutable, en una página pública y sin que nadie se entere.
  assert.match(COTIZA, /res\.error\?_esc\(res\.error\)/, 'el error del servidor debe ir escapado');
  for (const ataque of ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "'; alert(1); //"]) {
    const salida = _esc(ataque);
    assert.doesNotMatch(salida, /[<>]/, `no puede sobrevivir HTML: ${ataque}`);
    assert.doesNotMatch(salida, /"/, `ni comillas que rompan un atributo: ${ataque}`);
  }
  assert.equal(_esc('Demasiadas solicitudes'), 'Demasiadas solicitudes', 'un mensaje normal se ve igual');
  assert.equal(_esc(null), '', 'y un nulo no revienta');
});

test('nada de la URL se pinta en la página', () => {
  // Los utm_* y el gclid se mandan al worker, no se muestran: es el vector
  // clásico de una landing (llegar con ?utm_source=<script>).
  const utm = COTIZA.slice(COTIZA.indexOf('function _utm'), COTIZA.indexOf('function _show'));
  assert.match(utm, /URLSearchParams\(location\.search\)/);
  assert.doesNotMatch(utm, /innerHTML|document\.write|insertAdjacent/, 'los parámetros no se pintan');
  // Y en todo el código de la página solo puede haber un punto de inserción de
  // HTML: el de _show. (Se ignoran los comentarios, que sí lo nombran.)
  const codigo = COTIZA.replace(/^\s*\/\/[^\n]*$/gm, '');
  const puntos = (codigo.match(/\.innerHTML\s*=|document\.write|insertAdjacentHTML/g) || []);
  assert.equal(puntos.length, 1, `puntos de inserción de HTML: ${puntos.join(', ')}`);
});

test('el enlace de respaldo por correo no se puede romper', () => {
  // El mailto se arma con lo que escribió el visitante y se mete en un href.
  const fn = COTIZA.slice(COTIZA.indexOf('function _mailtoFallback'), COTIZA.indexOf('document.getElementById(\'cotForm\')'));
  assert.match(fn, /const body=encodeURIComponent\(`Nombre/, 'el cuerpo va codificado entero');
  assert.match(fn, /subject=\$\{encodeURIComponent\(/, 'y el asunto también');
  // Lo que importa es la línea que se devuelve: ahí no puede entrar un campo sin
  // codificar. Sin eso, unas comillas en el nombre salen del href y ya está.
  const retorno = /return `mailto:[^`]*`/.exec(fn);
  assert.ok(retorno, 'debe existir el mailto');
  const crudos = (retorno[0].match(/\$\{(?!body\b|encodeURIComponent)[^}]*\}/g) || []);
  assert.deepEqual(crudos, [], `Campos sin codificar en el mailto: ${crudos.join(', ')}`);
});

test('el adjunto lo valida el servidor, no solo el navegador', () => {
  // El límite del navegador es una cortesía: cualquiera puede llamar al endpoint
  // directo. La validación que cuenta es la del worker.
  assert.match(COTIZA, /_MAX_FILE=4\*1024\*1024/, 'el navegador avisa temprano');
  const val = WORKER.slice(WORKER.indexOf('if (body.attachment && body.attachment.data)'), WORKER.indexOf('return await createLeadAndQueue'));
  // Los tipos viven dentro de una regex, así que las barras van escapadas.
  const tipos = val.replace(/\\/g, '');
  assert.ok(tipos.includes('application/pdf') && tipos.includes('image/(png') && tipos.includes('webp'),
    'debe haber una lista de tipos permitidos (imágenes y PDF)');
  assert.doesNotMatch(tipos, /application\/(x-|octet|javascript)|text\/html|\*\/\*/, 'sin tipos ejecutables ni comodines');
  assert.ok(val.includes('okType'), 'y aplicarse');
  assert.match(val, /b64\.length <= 5_600_000/, 'con tope de tamaño');
  assert.ok(val.includes('[A-Za-z0-9+/=]'), 'y comprobando que sea base64 de verdad');
  // El adjunto solo se acepta si pasa las tres cosas a la vez.
  assert.match(val, /if \(okType && b64\.length <= 5_600_000 && /, 'las tres condiciones juntas');
});

test('las defensas anti-bot siguen en pie y fallan cerradas', () => {
  const lead = WORKER.slice(WORKER.indexOf('async function handleLead'), WORKER.indexOf('return await createLeadAndQueue'));
  // Trampa: el campo oculto que un humano nunca llena.
  assert.match(lead, /body\.company_website \|\| body\._hp/, 'debe comprobarse el campo trampa');
  assert.match(COTIZA, /class="hp"/, 'y existir en el formulario, fuera de la vista');
  // Turnstile: si está configurado, sin token no se pasa.
  assert.match(lead, /if \(env\.TURNSTILE_SECRET\)[\s\S]{0,220}?error: "Verificación anti-bot falló" \}, 403/,
    'con Turnstile configurado, sin token válido se rechaza');
  const ts = WORKER.slice(WORKER.indexOf('async function verifyTurnstile'), WORKER.indexOf('async function verifyTurnstile') + 700);
  assert.match(ts, /if \(!token\) return false;/, 'sin token, la verificación es negativa (no permisiva)');
  assert.match(ts, /return !!data\.success;/, 'y solo pasa si Cloudflare lo confirma');
  // Límite por IP.
  assert.match(lead, /rateLimited\(env, request, "lead", 8, 60\)/, 'y hay límite por IP');
});

test('los enlaces de confirmación y baja del newsletter exigen su token', () => {
  // Salió a la luz probando otra cosa: nada cubría nlVerify. Si se volviera
  // permisivo, cualquiera podría confirmar o dar de baja el correo de otro
  // llamando al endpoint sin token.
  const i = WORKER.indexOf('async function nlVerify');
  assert.ok(i > 0, 'debe existir la verificación');
  const fn = WORKER.slice(i, i + 700);
  assert.match(fn, /if \(!token\) return false;/, 'sin token no se pasa');
  assert.match(fn, /timingSafeEqual|hmac|Hmac|sign/i, 'y el token va firmado, no adivinado');
});

test('la clave pública del formulario no se confunde con seguridad', () => {
  // Va horneada en una página pública: cualquiera la lee. Está bien que exista
  // como filtro de ruido, pero el comentario tiene que dejar claro qué NO es.
  assert.match(WORKER, /anti-bot básico — NO es seguridad fuerte/, 'debe quedar dicho en el código');
  assert.match(WORKER, /timingSafeEqual\(key, env\.PUBLIC_LEAD_KEY\)/, 'y compararse en tiempo constante');
});

test('sin worker configurado el formulario no se traga la solicitud', () => {
  // Si faltan los secrets del deploy, los %%…%% quedan sin reemplazar. En vez de
  // fallar en silencio, se abre el correo con todo pre-rellenado.
  assert.match(COTIZA, /if\(!_cfgOk\(CFG\.url\)\)/, 'debe detectarse la falta de configuración');
  assert.match(COTIZA, /_navigate\(_mailtoFallback\(d\)\)/, 'y caer al respaldo por correo');
  const cfgOk = COTIZA.slice(COTIZA.indexOf('_cfgOk'), COTIZA.indexOf('_cfgOk') + 200);
  assert.match(cfgOk, /%%|startsWith/, 'reconociendo el marcador sin reemplazar');
});
