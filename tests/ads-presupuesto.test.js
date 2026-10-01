#!/usr/bin/env node
/*
 * Google Ads: el presupuesto diario que sale hacia la cuenta real.
 *
 * La cadena es corta y no tiene frenos intermedios: el agente de IA propone un
 * número → se pinta como botón → un clic lo encola → sendAdsMutation lo POSTea
 * al Apps Script → el Script 2 lo aplica en la cuenta. No hay revisión humana
 * en el medio.
 *
 * Y el único filtro era Math.max(1000, Math.round(+a.nuevo||0)), que falla en
 * las dos direcciones:
 *   - Sin techo: un cero de más en la respuesta del modelo pasaba entero.
 *     Medido: 500000 → $500.000/día; 1e9 → $1.000.000.000/día.
 *   - Con el campo ausente o ilegible (undefined, null, '', 'mucho') el
 *     resultado era $1.000/día: bajar una campaña de $8.000 a $1.000 sin decir
 *     una palabra.
 * Los presupuestos reales de las líneas del taller van entre $2.000 y $8.000.
 *
 * Correr:  node --test tests/ads-presupuesto.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ADS = fs.readFileSync(path.join(RAIZ, 'js', 'seo-ads.js'), 'utf8');
const AG = fs.readFileSync(path.join(RAIZ, 'js', 'agentes.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

function bloque(marca, src) {
  const s = src || ADS;
  const i = s.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = s.indexOf('{', i); x < s.length; x++) {
    if (s[x] === '{') d++;
    if (s[x] === '}') { d--; if (!d) return s.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// El freno real del módulo, con el entorno simulado.
function montar({ tope = null, respuestaConfirm = true } = {}) {
  const avisos = [], preguntas = [];
  const almacen = {};
  if (tope !== null) almacen.ads_tope_diario = String(tope);
  const ctx = {
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
    },
    toast: (m) => avisos.push(String(m)),
    confirm: (m) => { preguntas.push(String(m)); return respuestaConfirm; },
    prompt: () => null,
  };
  // El fmtMoney REAL del módulo: abrevia ($500K, $1.2M). Con uno propio, las
  // pruebas del texto del aviso estarían midiendo el stub, no lo que ve nadie.
  const piezas = [
    ADS.slice(ADS.indexOf("const _ADS_TOPE_KEY="), ADS.indexOf('\n', ADS.indexOf("const _ADS_TOPE_KEY="))),
    bloque('function fmtMoney('),
    bloque('function adsTopeDiario('),
    bloque('function adsPresupuestoValido('),
  ].join('\n');
  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, `${piezas}\nreturn {adsTopeDiario,adsPresupuestoValido};`)(...nombres.map((n) => ctx[n]));
  return { api, avisos, preguntas, almacen };
}

// ── Lo que el agente puede proponer ─────────────────────────────────────

test('un presupuesto ilegible no se convierte en $1.000 a la callada', () => {
  // Antes: Math.max(1000, +undefined||0) = 1000. Una campaña de $8.000 caía a
  // $1.000/día porque al modelo se le olvidó un campo.
  for (const malo of [undefined, null, '', 'mucho', NaN, {}]) {
    const m = montar();
    assert.equal(m.api.adsPresupuestoValido(malo, 8000, 'Impresión 3D'), null, `debió rechazar: ${String(malo)}`);
    assert.match(m.avisos.join(' '), /No se entendió el presupuesto/);
  }
});

test('un cero de más no llega a la cuenta', () => {
  const m = montar();                       // tope por defecto: 20.000
  assert.equal(m.api.adsPresupuestoValido(500000, 8000, 'Impresión 3D'), null);
  assert.match(m.avisos.join(' '), /supera el tope/);
  assert.match(m.avisos.join(' '), /\$500K/, 'debe decir el monto que se frenó');
  assert.match(m.avisos.join(' '), /\$20K/, 'y cuál es el tope');
});

test('lo que está dentro de lo normal pasa sin molestar', () => {
  const m = montar();
  assert.equal(m.api.adsPresupuestoValido(9000, 8000, 'Impresión 3D'), 9000);
  assert.equal(m.preguntas.length, 0, 'un ajuste normal no pregunta nada');
  assert.equal(m.avisos.length, 0);
});

test('por debajo del piso tampoco pasa', () => {
  const m = montar();
  assert.equal(m.api.adsPresupuestoValido(500, 6000, 'Neón'), null);
  assert.match(m.avisos.join(' '), /al menos \$1\.000/);
});

test('un salto fuerte dentro del tope se pregunta, no se asume', () => {
  const m = montar();
  assert.equal(m.api.adsPresupuestoValido(18000, 3000, 'Papelería'), 18000, 'con el sí, se aplica');
  assert.match(m.preguntas.join(' '), /\$3K → \$18K/, 'la pregunta muestra el antes y el después');
  const n = montar({ respuestaConfirm: false });
  assert.equal(n.api.adsPresupuestoValido(18000, 3000, 'Papelería'), null, 'con el no, no se aplica');
});

test('una bajada fuerte también se pregunta', () => {
  // Bajar de $8.000 a $1.000 es exactamente el fallo silencioso de antes.
  const m = montar({ respuestaConfirm: false });
  assert.equal(m.api.adsPresupuestoValido(1000, 8000, 'Impresión 3D'), null);
  assert.match(m.preguntas.join(' '), /\$8K → \$1K/);
});

test('el tope se puede subir a propósito, y entonces manda el nuevo', () => {
  const m = montar({ tope: 60000 });
  assert.equal(m.api.adsTopeDiario(), 60000);
  assert.equal(m.api.adsPresupuestoValido(50000, 40000, 'Campaña grande'), 50000);
});

test('el tope por defecto es coherente con lo que gasta el taller', () => {
  const m = montar();
  const tope = m.api.adsTopeDiario();
  const reales = [...ADS.matchAll(/presupuesto:(\d+)/g)].map((x) => +x[1]).filter(Boolean);
  assert.ok(reales.length >= 8, 'deben existir los presupuestos de las líneas');
  assert.ok(tope > Math.max(...reales), `el tope (${tope}) debe dejar margen sobre el mayor real (${Math.max(...reales)})`);
  assert.ok(tope <= Math.max(...reales) * 5, 'pero no ser un techo decorativo');
});

// ── Las dos rutas usan el MISMO freno ───────────────────────────────────

test('el botón del agente pasa por el freno', () => {
  const fn = bloque('function applyAdsAction(', AG);
  assert.match(fn, /adsPresupuestoValido\(a\.nuevo,camp\.presupuesto,camp\.nombre\)/);
  assert.doesNotMatch(fn, /Math\.max\(1000,Math\.round\(\+a\.nuevo\|\|0\)\)/, 'el filtro viejo no puede volver');
  assert.match(fn, /if\(nb===null\)\{[^}]*return;\}/, 'si el freno dice que no, no se encola nada');
});

test('el modal a mano pasa por el mismo freno', () => {
  const fn = bloque('function saveCampaignMutation(');
  assert.match(fn, /adsPresupuestoValido\(document\.getElementById\('adsCampaignModalPresupuesto'\)\.value/);
  assert.match(fn, /if\(_ppto===null\) return;/);
  assert.match(fn, /presupuesto:_ppto/, 'se envía el monto validado, no el crudo del campo');
  assert.doesNotMatch(fn, /presupuesto<1000\)\{alert/, 'la validación suelta se reemplazó por la compartida');
});

test('el freno es uno solo: si se separan, uno queda sin techo', () => {
  assert.equal((ADS.match(/function adsPresupuestoValido\(/g) || []).length, 1);
  assert.equal((AG.match(/function adsPresupuestoValido\(/g) || []).length, 0, 'no puede haber una copia en agentes');
});

// ── El tope es ajustable y está a la vista ──────────────────────────────

test('el tope se puede cambiar desde la pantalla de Ads', () => {
  assert.match(HTML, /onclick="setAdsTopeDiario\(\)"/, 'debe haber botón');
  const fn = bloque('function setAdsTopeDiario(');
  assert.match(fn, /if\(!\(n>=1000\)\)/, 'no se puede poner un tope absurdo');
  assert.match(fn, /localStorage\.setItem\(_ADS_TOPE_KEY/);
});

// ── Lo que ya estaba bien no se pierde ──────────────────────────────────

test('la mutación viaja firmada y su fallo se ve', () => {
  const fn = bloque('function sendAdsMutation(');
  assert.match(fn, /if\(!cfg\.secret\)/, 'sin secreto no se envía');
  assert.match(fn, /mutation\.status='error'/, 'un rechazo del servidor queda marcado');
  assert.match(fn, /catch\(\(\)=>\{[\s\S]*status='error'/, 'y un corte de red también');
});

test('pausar y activar no necesitan freno de monto', () => {
  // Pausar nunca sube el gasto; activar lo restablece al presupuesto que ya tenía.
  const fn = bloque('function applyAdsAction(', AG);
  assert.match(fn, /a\.tipo==='pausar'\)\{data=\{\.\.\.base,estado:'PAUSED'\}/);
  assert.match(fn, /a\.tipo==='activar'\)\{data=\{\.\.\.base,estado:'ENABLED'\}/);
});
