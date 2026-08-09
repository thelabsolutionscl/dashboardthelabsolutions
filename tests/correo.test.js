#!/usr/bin/env node
/*
 * Módulo de Correo: lo que entra por el buzón y lo que sale hacia el cliente.
 *
 * Todo lo que llega en un correo lo escribe QUIEN LO ENVÍA: el asunto, el
 * remitente, la fecha, el nombre de cada adjunto y el cuerpo. La dirección
 * hola@thelab.solutions está publicada en la web, así que ese "quien" es
 * cualquiera. Tres agujeros verificados en navegador antes del arreglo:
 *
 *   1. Al Responder/Reenviar, el HTML del correo se metía con innerHTML en el
 *      editor sin ninguna contención — <img src=x onerror> EJECUTABA.
 *   2. La fecha (cabecera Date:, que el servidor entrega cruda) se pintaba sin
 *      escapar al ABRIR el mensaje.
 *   3. El nombre del adjunto viajaba dentro de un onclick como código: un
 *      nombre como \');algo();// cerraba la llamada y ejecutaba lo de atrás.
 *
 * Las pruebas de comportamiento corren el código REAL del módulo contra un DOM
 * REAL (Chromium headless) y miden si algo llega a ejecutarse, no si un regex
 * lo encuentra. Llevan control positivo: la forma antigua SÍ ejecuta, así que
 * si un arreglo se cae, esto se pone rojo.
 *
 * Correr:  node --test tests/correo.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CORREO = fs.readFileSync(path.join(RAIZ, 'js', 'correo.js'), 'utf8');
const NOTIFY = fs.readFileSync(path.join(RAIZ, 'js', 'notify.js'), 'utf8');
const PHP = fs.readFileSync(path.join(RAIZ, 'mail-api.php'), 'utf8');

function cuerpo(nombre, src) {
  const s = src || CORREO;
  const i = s.indexOf(nombre);
  assert.ok(i > 0, `debe existir ${nombre}`);
  let d = 0;
  for (let x = s.indexOf('{', i); x < s.length; x++) {
    if (s[x] === '{') d++;
    if (s[x] === '}') { d--; if (!d) return s.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${nombre}`);
}

const ESC = CORREO.match(/esc\(s\)\{[^}]*\}/)[0];
// El saneador real del módulo, sin copiar ni una línea.
const FUENTE_CITA = `return {${ESC},${cuerpo('_sanitizarCita(html){')}};`;
// La línea real que pinta el chip de un adjunto.
const LINEA_CHIP = CORREO.split('\n').find((l) => l.includes('mail-att-chip') && l.includes('downloadAtt')).trim();

// El tercer campo dice si el payload ejecuta SOLO por meterlo con innerHTML,
// que es lo que hacía el editor. Medido en Chromium, no supuesto: un <svg
// onload> pelado no dispara por esa vía, pero un <img> dentro de él sí, y un
// <details open ontoggle> también. Los que no ejecutan igual son un problema:
// sobreviven dentro del editor y salen en el correo hacia el cliente.
const ATAQUES = [
  ['imagen con onerror', '<img src=x onerror="robar(1)">', true],
  ['svg con imagen dentro', '<svg><img src=x onerror="robar(2)"></svg>', true],
  ['campo con autofocus', '<input autofocus onfocus="robar(3)">', true],
  ['details que se abre solo', '<details open ontoggle="robar(4)">x</details>', true],
  ['svg con onload', '<svg onload="robar(5)"></svg>', false],
  ['etiqueta script', '<script>robar(6)</script>', false],
  ['iframe', '<iframe src="javascript:robar(7)"></iframe>', false],
  ['enlace javascript:', '<a href="javascript:robar(8)">clic</a>', false],
  ['objeto embebido', '<object data="evil.swf"></object>', false],
  ['formulario que roba', '<form action="https://evil.cl"><input name="x"></form>', false],
  ['base que reescribe enlaces', '<base href="https://evil.cl/">', false],
  ['data:text/html en src', '<img src="data:text/html,&lt;script&gt;robar(9)&lt;/script&gt;">', false],
];

const LEGITIMO = '<p style="color:#333">Hola, la <b>referencia</b>.</p><ul><li>Ítem</li></ul>'
  + '<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo"><a href="https://thelab.solutions">web</a>';

// Nombre de adjunto hostil: cierra la llamada y ejecuta lo que venga detrás.
const ADJUNTO_HOSTIL = '\\\');MAIL.robar();//';

// Chromium headless: el DOM de verdad. Si no está (por ejemplo en el Mac sin
// playwright), las pruebas de comportamiento se saltan y quedan las de forma.
let navegador = null, pagina = null;
test.before(async () => {
  try {
    const { chromium } = require('playwright');
    navegador = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server', '--proxy-bypass-list=*'] });
    pagina = await navegador.newPage();
    await pagina.goto('about:blank');
  } catch (e) { navegador = null; pagina = null; }
});
test.after(async () => { if (navegador) await navegador.close(); });

// ── 1. Citar al responder ───────────────────────────────────────────────

test('el saneador existe y se usa en Responder y Reenviar', () => {
  // Las dos rutas: una sola sin sanear ya deja el agujero abierto.
  const usos = (CORREO.match(/m\.body_html\?this\._sanitizarCita\(m\.body_html\)/g) || []).length;
  assert.equal(usos, 2, 'Responder y Reenviar deben sanear la cita');
  assert.doesNotMatch(CORREO, /\$\{m\.body_html\|\|/, 'no puede quedar el HTML crudo interpolado');
});

test('la cabecera de la cita también va escapada', () => {
  // El From y la Fecha vienen de cabeceras que escribe quien envía.
  assert.match(CORREO, /&lt;\$\{this\.esc\(m\.from_email\)\}&gt;/);
  assert.match(CORREO, /Fecha: \$\{this\.esc\(m\.date\)\}/);
  assert.doesNotMatch(CORREO, /\$\{m\.from_email\}/, 'el remitente no puede ir crudo');
  assert.doesNotMatch(CORREO, /\$\{m\.date\}/, 'la fecha tampoco');
});

test('sin sanear, la cita SÍ ejecuta código (control positivo)', async (t) => {
  if (!pagina) return t.skip('sin Chromium');
  // Sin esto, la prueba de abajo podría estar en verde por no medir nada.
  const r = await pagina.evaluate(async (ataques) => {
    const out = [];
    for (const [nombre, payload, esperado] of ataques) {
      window.__robos = 0; window.robar = () => { window.__robos++; };
      const caja = document.createElement('div');
      caja.contentEditable = 'true';
      document.body.appendChild(caja);
      caja.innerHTML = payload;                       // así estaba antes
      await new Promise((x) => setTimeout(x, 60));
      out.push([nombre, window.__robos > 0, esperado]);
      caja.remove();
    }
    return out;
  }, ATAQUES);
  for (const [nombre, ejecutó, esperado] of r) {
    if (esperado) assert.ok(ejecutó, `${nombre}: debería ejecutar sin sanear y no lo hizo — la prueba no está midiendo`);
  }
  assert.ok(r.some((x) => x[1]), 'al menos un payload debe ejecutar sin sanear');
});

test('saneada, la cita no ejecuta nada y conserva el formato', async (t) => {
  if (!pagina) return t.skip('sin Chromium');
  const r = await pagina.evaluate(async ({ fuente, ataques, legitimo }) => {
    const mod = new Function(fuente)();
    const res = { ataques: [], legitimo: mod._sanitizarCita(legitimo) };
    for (const [nombre, payload] of ataques) {
      window.__robos = 0; window.robar = () => { window.__robos++; };
      const limpio = mod._sanitizarCita(payload);
      const caja = document.createElement('div');
      caja.contentEditable = 'true';
      document.body.appendChild(caja);
      caja.innerHTML = limpio;
      await new Promise((x) => setTimeout(x, 60));
      res.ataques.push([nombre, window.__robos, limpio]);
      caja.remove();
    }
    return res;
  }, { fuente: FUENTE_CITA, ataques: ATAQUES, legitimo: LEGITIMO });

  for (const [nombre, robos, limpio] of r.ataques) {
    assert.equal(robos, 0, `${nombre}: ejecutó código dentro del dashboard`);
    // Y tampoco puede sobrevivir para viajar dentro del correo al cliente.
    assert.doesNotMatch(limpio, /<(script|iframe|object|embed|form|base|style|svg|input)\b/i, `${nombre}: sobrevivió un elemento peligroso → ${limpio}`);
    assert.doesNotMatch(limpio, /\son\w+\s*=/i, `${nombre}: sobrevivió un manejador de eventos → ${limpio}`);
    assert.doesNotMatch(limpio, /javascript:/i, `${nombre}: sobrevivió un javascript: → ${limpio}`);
    assert.doesNotMatch(limpio, /data:text\/html/i, `${nombre}: sobrevivió un data:text/html → ${limpio}`);
  }
  // Un correo real trae negritas, listas, colores, el logo incrustado y enlaces.
  for (const trozo of ['<b>referencia</b>', '<li>Ítem</li>', 'style="color', 'data:image/png', 'thelab.solutions']) {
    assert.ok(r.legitimo.includes(trozo), `se perdió formato legítimo: ${trozo} → ${r.legitimo}`);
  }
});

test('la lista de elementos prohibidos cubre lo que ejecuta o navega', () => {
  const fn = cuerpo('_sanitizarCita(html){');
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form', 'base', 'style', 'svg']) {
    assert.ok(fn.includes(tag), `falta ${tag} en la lista de elementos removidos`);
  }
  assert.match(fn, /n\.startsWith\('on'\)/, 'deben caer los manejadores on*');
  assert.match(fn, /srcdoc/, 'y el srcdoc de un iframe superviviente');
  assert.match(fn, /javascript\|vbscript\|data/, 'y los esquemas de URL peligrosos');
  // Las imágenes incrustadas son normales en un correo y deben pasar.
  assert.match(fn, /data:image\\\//, 'data:image debe seguir permitido en src');
  // DOMParser no ejecuta ni descarga nada al analizar: es la pieza que hace
  // seguro sanear sin usar innerHTML.
  assert.match(fn, /new DOMParser\(\)\.parseFromString/);
  assert.match(fn, /catch\(e\)\{ return this\.esc\(s\); \}/, 'ante la duda, texto plano');
});

// ── 2. Leer un mensaje ──────────────────────────────────────────────────

test('leer un correo sigue estando contenido en un iframe sin scripts', () => {
  // Es la mitad que YA estaba bien: no se puede perder al tocar el módulo.
  const i = CORREO.indexOf("ifr.setAttribute('sandbox'");
  assert.ok(i > 0, 'el visor debe usar sandbox');
  const attr = CORREO.slice(i, i + 120);
  assert.doesNotMatch(attr, /allow-scripts/, 'el visor NO debe permitir scripts');
  assert.match(attr, /allow-same-origin/);
});

test('la ficha del mensaje escapa TODAS las cabeceras, incluida la fecha', () => {
  // El servidor entrega la cabecera Date: tal como la escribió quien envía
  // (mail-api.php: 'date' => $header->date), así que es texto ajeno como el
  // resto. Iba sin escapar: bastaba abrir el correo.
  assert.match(PHP, /'date'\s*=>\s*\$header->date/, 'la fecha viaja cruda desde el servidor');
  const meta = CORREO.slice(CORREO.indexOf("document.getElementById('mailRdrMeta').innerHTML="), CORREO.indexOf('_crmLine;') + 9);
  assert.match(meta, /\$\{this\.esc\(data\.date\)\}/, 'la fecha debe ir escapada');
  assert.doesNotMatch(meta, /\$\{data\.date\}/, 'y nunca cruda');
  assert.match(meta, /this\.esc\(data\.from_email\)/);
  assert.match(meta, /map\(t=>this\.esc\(t\)\)/, 'y cada destinatario');
});

test('el nombre de una carpeta ajena no se pinta como HTML', () => {
  // El nombre de una carpeta desconocida se usa tal cual como etiqueta.
  assert.match(CORREO, /\$\{svgIcon\(meta\.icon\)\} \$\{this\.esc\(meta\.label\)\}/);
});

// ── 3. El chip del adjunto ──────────────────────────────────────────────

test('el nombre de un adjunto NO viaja como código', async (t) => {
  if (!pagina) return t.skip('sin Chromium');
  const r = await pagina.evaluate(({ esc, lineaActual, hostil }) => {
    // La forma ANTIGUA, como control positivo: demuestra que esto mide de verdad.
    const lineaVieja = '`<span class="mail-att-chip" onclick="MAIL.downloadAtt(\'${this.esc(a.part)}\',\'${this.esc(a.name).replace(/\'/g,"\\\\\'")}\')">📎</span>`';
    const medir = (linea) => {
      const obj = new Function('return {' + esc + ', chip(a){ return ' + linea + '; }};')();
      window.__robos = 0;
      window.MAIL = { downloadAtt: () => {}, robar: () => { window.__robos++; } };
      const d = document.createElement('div');
      d.innerHTML = obj.chip.call(obj, { part: '1', name: hostil });
      document.body.appendChild(d);
      d.querySelector('.mail-att-chip').click();
      const n = window.__robos;
      d.remove();
      return n;
    };
    return { antes: medir(lineaVieja), ahora: medir(lineaActual) };
  }, { esc: ESC, lineaActual: LINEA_CHIP, hostil: ADJUNTO_HOSTIL });

  assert.equal(r.antes, 1, 'el control positivo debe ejecutar — si no, la prueba no mide nada');
  assert.equal(r.ahora, 0, 'un adjunto con nombre hostil ejecutó código al pulsarlo');
});

test('el adjunto se pasa como dato, no como trozo de código', () => {
  // La forma segura: el nombre vive en un atributo y se lee, nunca se compila.
  assert.match(LINEA_CHIP, /data-name="\$\{this\.esc\(a\.name\)\}"/);
  assert.match(LINEA_CHIP, /data-part="\$\{this\.esc\(a\.part\)\}"/);
  assert.match(LINEA_CHIP, /onclick="MAIL\.downloadAtt\(this\.dataset\.part,this\.dataset\.name\)"/);
  assert.doesNotMatch(LINEA_CHIP, /downloadAtt\('/, 'nada de interpolar dentro de comillas de JS');
});

// ── 4. Adjuntar archivos ────────────────────────────────────────────────

test('el tope de 15 MB también se aplica al elegir varios archivos a la vez', async () => {
  // El tope se contaba sobre _cmpAtts, que solo se llena cuando el FileReader
  // TERMINA. Al elegir cuatro archivos de 6 MB de golpe, ninguno se había
  // añadido aún: pasaban los cuatro (24 MB) y el envío reventaba después.
  const avisos = [];
  class FakeReader {
    readAsDataURL() { setTimeout(() => { this.result = 'data:x;base64,QUJD'; this.onload(); }, 0); }
  }
  const obj = new Function('toast', 'FileReader',
    `return {_cmpAtts:[],_cmpPend:0,renderCmpAtts(){}, ${cuerpo('addFiles(files){')} };`
  )((m) => avisos.push(m), FakeReader);

  const seis = 6 * 1024 * 1024;
  obj.addFiles([1, 2, 3, 4].map((i) => ({ name: `f${i}.pdf`, size: seis, type: 'application/pdf' })));
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(obj._cmpAtts.length, 2, 'solo caben dos de 6 MB en 15 MB');
  assert.ok(avisos.some((m) => /15 MB/.test(m)), 'y hay que avisar del tope');
  assert.equal(obj._cmpPend, 0, 'el contador provisional debe quedar en cero');
});

test('un archivo ilegible se avisa en vez de desaparecer', async () => {
  const avisos = [];
  class FakeReader {
    readAsDataURL() { setTimeout(() => this.onerror(), 0); }
  }
  const obj = new Function('toast', 'FileReader',
    `return {_cmpAtts:[],_cmpPend:0,renderCmpAtts(){}, ${cuerpo('addFiles(files){')} };`
  )((m) => avisos.push(m), FakeReader);

  obj.addFiles([{ name: 'roto.pdf', size: 100, type: '' }]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(obj._cmpAtts.length, 0);
  assert.ok(avisos.some((m) => /roto\.pdf/.test(m)), 'debe decir qué archivo falló');
  assert.equal(obj._cmpPend, 0, 'y liberar lo que tenía reservado');
});

// ── 5. Enviar ───────────────────────────────────────────────────────────

test('el correo de la cotización no promete un PDF que no existe', () => {
  const fn = cuerpo('async sendCotizacion(cotId){');
  assert.match(fn, /pdfOk=true;/, 'debe constar si el PDF se generó');
  assert.match(fn, /\$\{pdfOk\?'Adjuntamos la':'Le escribimos por la'\}/, 'el texto cambia según eso');
  assert.match(fn, /if\(!pdfOk\) toast\(/, 'y hay que avisarlo en pantalla');
});

test('el envío sigue teniendo freno y no se puede disparar dos veces', () => {
  const fn = cuerpo('async sendCompose(){');
  assert.match(fn, /if\(this\._sending\) return;/, 'sin doble clic');
  assert.match(fn, /finally\{\s*this\._sending=false;/, 'y el cerrojo se suelta siempre');
  // El freno horario debe cubrir las DOS rutas de salida.
  assert.equal((CORREO.match(/action==='send'\)\{const g=this\._sendGate\(\);if\(g\) return g;\}/g) || []).length, 2,
    'post() y postAs() deben pasar por el freno');
  // Enviar no se reintenta solo: un reintento es un correo duplicado al cliente.
  assert.match(cuerpo('async post(params){'), /const canRetry=!\(params&&params\.action==='send'\)/);
});

test('el servidor limpia las cabeceras antes de armar el mensaje SMTP', () => {
  // Un salto de línea en el destinatario o en el nombre del remitente inyecta
  // cabeceras nuevas (un Bcc: oculto, un Reply-To falso). Los nombres de
  // adjunto ya se limpiaban; estos cuatro no.
  const fn = PHP.slice(PHP.indexOf('function smtp_send('), PHP.indexOf('function smtp_send(') + 1400);
  assert.match(fn, /\$limpia_cab\s*=\s*function/, 'debe existir el limpiador');
  assert.match(fn, /preg_replace\('\/\[\\r\\n"\]\+\/'/, 'quita saltos de línea y comillas');
  for (const v of ['from_name', 'to', 'cc', 'bcc']) {
    assert.match(fn, new RegExp(`\\$${v}\\s*=\\s*\\$limpia_cab\\(\\$${v}\\)`), `falta limpiar $${v}`);
  }
  // Y lo que ya estaba bien no se pierde.
  assert.match(PHP, /\$fname = preg_replace\('\/\[\\r\\n"\]\/', '', \$att\['name'\]/, 'el nombre del adjunto sigue limpio');
});

// ── 6. Bandeja y avisos ─────────────────────────────────────────────────

test('un mensaje abierto queda leído también en la copia local', () => {
  // El servidor lo marca \Seen al abrirlo; si la lista local no se entera,
  // cualquier re-pintado (destacar, borrar en lote) lo devuelve a negrita.
  const fn = cuerpo('async readMsg(uid){');
  assert.match(fn, /if\(listItem\) listItem\.seen=1;/);
});

test('el aviso de correo nuevo no se muere para siempre tras una racha de errores', () => {
  // Antes: 10 errores seguidos (10 min de caída, o una racha del WAF que
  // bloquea de forma intermitente) detenían el polling hasta recargar la
  // página, y el único rastro era un console.warn.
  const chk = cuerpo('async function _mailCheck(', NOTIFY);
  assert.doesNotMatch(chk, /_mailPollTimer=null/, 'no puede quedarse sin temporizador');
  assert.match(chk, /_mailPollCadencia\(true, data\.error\)/, 'baja la cadencia');
  assert.match(chk, /_mailPollCadencia\(false\)/, 'y la recupera al primer acierto');
  const cad = cuerpo('function _mailPollCadencia(', NOTIFY);
  assert.match(cad, /if\(_mailPollLento===lento\) return;/, 'sin rearmar el intervalo en cada vuelta');
  assert.match(cad, /setInterval\(_mailCheck, lento\?_POLL_LENTO:_POLL_INTERVAL\)/);
  assert.match(cad, /NOTIFY\.add\(/, 'y se dice, no se calla');
  assert.match(NOTIFY, /_POLL_LENTO = 600000/, '10 min en cadencia lenta');
});

test('no se pueden armar dos temporizadores de correo a la vez', () => {
  // El guard miraba _mailPollTimer, que no existe hasta 4 s después: dos
  // llamadas dentro de esos 4 s (arranque + abrir Correo) dejaban DOS
  // intervalos consultando, justo lo que el hosting pidió evitar.
  const fn = cuerpo('function startMailPolling(', NOTIFY);
  assert.match(fn, /if\(_mailPollTimer \|\| _mailPollArmando\) return;/);
  assert.match(fn, /_mailPollArmando=true;/);
  assert.match(fn, /finally\{ _mailPollArmando=false; \}/, 'y se libera aunque falle');
  assert.match(fn, /if\(!MAIL\.getMailPass \|\| !MAIL\.getMailPass\(\)\) return;/, 'sin clave no consulta');
});

test('con la clave rechazada no se sigue pidiendo la bandeja', () => {
  const lf = cuerpo('async loadFolders(){');
  assert.match(lf, /this\.showPassModal\('Contraseña incorrecta[^']*'\);\s*\n\s*return false;/, 'debe avisar que cortó');
  assert.match(lf, /return true;/, 'y confirmar cuando sí cargó');
  const init = cuerpo('async init(){');
  assert.match(init, /if\(await this\.loadFolders\(\)===false\)\{/, 'init() tiene que hacerle caso');
});
