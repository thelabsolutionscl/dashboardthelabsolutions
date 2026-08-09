#!/usr/bin/env node
/*
 * Slicer 3D: de la pieza al G-code, al costo y a la impresora.
 *
 * Dos salidas que duelen si fallan calladas: el precio que va a la cotización
 * y el archivo que se sube a una máquina real. Verificado en navegador con el
 * módulo REAL laminando un cubo de 20 mm en una K1:
 *
 *   - "Enviar a todas" subía el MISMO archivo N veces a la MISMA impresora:
 *     llamaba enviar(m.id), pero enviar() no recibía ningún argumento y leía
 *     siempre el selector. Medido: 3 impresoras libres → 3 subidas, 1 destino.
 *     Y sincronizaba un elemento (slSendTo) que no existe en ninguna parte.
 *   - Nada impedía mandar un G-code laminado para una K2 Plus (cama 500) a una
 *     K1 (cama 220): el cabezal se va contra el marco.
 *   - "Cotizar desde slicer" escribía en un id inexistente (cotObs) y caía a un
 *     selector por placeholder que enganchaba las Notas de producción de la
 *     ficha, en la pestaña Pedidos — las pisaba y decía "copiado a cotización".
 *   - El margen no se acotaba al pasar a la cotización: 0 % se convertía en
 *     25 % y 150 % dejaba el precio igual al costo (cotizar sin margen).
 *
 * Aquí se monta el código REAL del módulo con el entorno simulado; el laminado
 * completo se verificó aparte en Chromium (cubo de 20 mm → 4 g, $421 de costo:
 * filamento y máquina cuadran al peso).
 *
 * Correr:  node --test tests/slicer.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SL = fs.readFileSync(path.join(RAIZ, 'js', 'slicer3d.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

function bloque(marca) {
  const i = SL.indexOf(marca);
  assert.ok(i > 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = SL.indexOf('{', i); x < SL.length; x++) {
    if (SL[x] === '{') d++;
    if (SL[x] === '}') { d--; if (!d) return SL.slice(i, x + 1); }
  }
  assert.fail(`no se pudo cerrar ${marca}`);
}

// ── El módulo real, con el entorno simulado alrededor ────────────────────
function montar({ maquinas = [], estados = {}, stats = null, laminadoPara = 'K1', margen = '' } = {}) {
  const subidas = [], avisos = [], preguntas = [];
  const campos = {
    slPrinter: { value: laminadoPara }, slMaterial: { value: 'PLA' }, slTarget: { value: '' },
    slAutoStart: { checked: false }, slBtnSend: { disabled: false, textContent: '' },
    slMargen: { value: margen }, slPriceKg: { value: '15000' }, slRateH: { value: '1500' },
    slCostOut: { innerHTML: '' }, slPriceSuggest: { innerHTML: '' }, 'cot-notas': { value: '' },
  };
  const almacen = {};
  const ctx = {
    S: { gcode: 'G1 X0 Y0', stats, est: { grams: 100, secs: 3600, filM: 30 }, params: { layerHeight: 0.2 }, name: 'pieza' },
    MAQUINAS: maquinas,
    _printerStatus: estados,
    el: (id) => campos[id] || null,
    toast: (m) => avisos.push(String(m)),
    confirm: (m) => { preguntas.push(String(m)); return true; },
    getPrinterIp: (m) => (m && m.ip) || null,
    printerUrl: (ip, ruta) => `http://${ip}${ruta}`,
    getPrinterAuthHeaders: () => ({}),
    switchTab: () => {},
    fmtTime: (s) => Math.round(s / 60) + 'min',
    document: { getElementById: (id) => campos[id] || null },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
    },
    XMLHttpRequest: function () {
      this.upload = {}; this.status = 200;
      this.open = (m, u) => { this._u = u; };
      this.setRequestHeader = () => {};
      this.send = () => { subidas.push(this._u); setTimeout(() => this.onload && this.onload(), 0); };
    },
    fetch: async () => ({ ok: true }),
    FormData: class { append() {} },
    Blob: class { constructor() {} },
  };

  const piezas = [
    SL.slice(SL.indexOf('const SPECS='), SL.indexOf('};', SL.indexOf('const SPECS=')) + 2),
    bloque('function fitsIn('), bloque('function _cabeEn('), bloque('function _destinoOk('),
    bloque('function gcodeFileName('), bloque('function enviar('), bloque('function enviarATodas('),
    bloque('function _money('), bloque('function _margenObj('), bloque('function _precioSug('),
    bloque('function costRecalc('), bloque('function slicerToCot('),
  ].join('\n');

  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, `${piezas}
    return {_cabeEn,_destinoOk,enviar,enviarATodas,_margenObj,_precioSug,costRecalc,slicerToCot};`
  )(...nombres.map((n) => ctx[n]));

  return { api, ctx, campos, subidas, avisos, preguntas, almacen };
}

const K1 = (i) => ({ id: 'p' + i, nombre: 'Impresora', numG: i, modelo: 'K1', ip: '10.0.0.' + i });
const LIBRE = { state: 'idle' };
const CUBO20 = { dx: 20, dy: 20, dz: 20 };
const CUBO300 = { dx: 300, dy: 300, dz: 300 };

// ── Enviar a varias impresoras ──────────────────────────────────────────

test('"enviar a todas" manda UN archivo a CADA impresora, no N a la misma', async () => {
  // Medido en navegador antes del arreglo: 3 subidas, 1 destino.
  const m = montar({ maquinas: [1, 2, 3].map(K1), estados: { p1: LIBRE, p2: LIBRE, p3: LIBRE }, stats: CUBO20 });
  m.campos.slTarget.value = 'p1';   // el selector apunta a una sola
  m.api.enviarATodas();
  await new Promise((r) => setTimeout(r, 30));
  const destinos = [...new Set(m.subidas.map((u) => new URL(u).hostname))];
  assert.equal(m.subidas.length, 3, 'una subida por impresora');
  assert.deepEqual(destinos.sort(), ['10.0.0.1', '10.0.0.2', '10.0.0.3'], 'y cada una a la suya');
});

test('el id explícito manda sobre el selector', () => {
  const m = montar({ maquinas: [1, 2].map(K1), stats: CUBO20 });
  m.campos.slTarget.value = 'p1';
  m.api.enviar('p2');
  assert.match(m.subidas[0], /10\.0\.0\.2/, 'debe ir a la que se le pasó, no a la del selector');
});

test('no queda ninguna referencia al elemento fantasma', () => {
  // slSendTo no existe en el HTML ni se crea en ningún lado: sincronizarlo era
  // el disfraz que hacía parecer que el envío en lote elegía impresora.
  assert.doesNotMatch(SL, /slSendTo/, 'slSendTo no debe usarse');
  assert.equal((HTML.match(/id="slSendTo"/g) || []).length, 0, 'y sigue sin existir');
  assert.match(SL, /id="slTarget"/, 'el selector real es slTarget');
});

// ── No mandar una pieza a una cama donde no cabe ────────────────────────

test('se niega a mandar una pieza que no cabe en la impresora destino', () => {
  // G-code laminado para K2 Plus (cama 500) enviado a una K1 (cama 220).
  const m = montar({ maquinas: [K1(9)], estados: { p9: LIBRE }, stats: CUBO300, laminadoPara: 'K2 Plus' });
  m.campos.slTarget.value = 'p9';
  m.api.enviar();
  assert.equal(m.subidas.length, 0, 'no puede subir nada');
  assert.equal(m.preguntas.length, 0, 'y ni siquiera pregunta: no es cosa de opinión');
  assert.match(m.avisos.join(' '), /300×300×300mm.*no cabe.*K1/, 'debe decir la medida y el modelo');
});

test('si cabe pero es otro modelo, avisa y deja decidir', () => {
  const m = montar({ maquinas: [K1(1)], stats: CUBO20, laminadoPara: 'K2 Plus' });
  m.campos.slTarget.value = 'p1';
  m.api.enviar();
  assert.equal(m.subidas.length, 1, 'con el sí, se envía');
  assert.match(m.preguntas.join(' '), /K2 Plus.*K1/s, 'la pregunta nombra los dos modelos');
});

test('mismo modelo: no molesta con preguntas', () => {
  const m = montar({ maquinas: [K1(1)], stats: CUBO20, laminadoPara: 'K1' });
  m.campos.slTarget.value = 'p1';
  m.api.enviar();
  assert.equal(m.preguntas.length, 0);
  assert.equal(m.subidas.length, 1);
});

test('el envío en lote deja fuera las que no dan y lo dice', () => {
  const grande = { id: 'g1', nombre: 'Grande', numG: 1, modelo: 'K2 Plus', ip: '10.0.0.50' };
  const m = montar({
    maquinas: [grande, K1(2)], estados: { g1: LIBRE, p2: LIBRE },
    stats: CUBO300, laminadoPara: 'K2 Plus',
  });
  m.api.enviarATodas();
  assert.equal(m.subidas.length, 1, 'solo la que puede');
  assert.match(m.subidas[0], /10\.0\.0\.50/);
  assert.match(m.preguntas.join(' '), /no cabe.*Impresora #2/s, 'y se nombra la que quedó fuera');
});

// ── Margen y precio ─────────────────────────────────────────────────────

test('el margen se acota igual en el panel y en la cotización', () => {
  for (const [entrada, esperado] of [['0', 0], ['25', 25], ['150', 95], ['-40', 0], ['', 25]]) {
    const m = montar({ margen: entrada, stats: CUBO20 });
    assert.equal(m.api._margenObj(), esperado, `margen "${entrada}"`);
  }
});

test('un margen de 0 % no se convierte en 25 % por el camino', () => {
  // Con `||`, el 0 caía al respaldo: el panel mostraba el costo y la cotización
  // decía "precio sugerido" con 25 % encima.
  const m = montar({ margen: '0', stats: CUBO20 });
  assert.equal(m.api._margenObj(), 0);
  assert.equal(Math.round(m.api._precioSug(1000, 0)), 1000, 'sin margen, precio = costo');
});

test('el tope de margen no deja el precio en cero ni en el costo pelado', () => {
  const m = montar({ stats: CUBO20 });
  assert.equal(Math.round(m.api._precioSug(1000, 95)), 20000, '95 % → 20× el costo');
  assert.ok(m.api._precioSug(1000, 94) < m.api._precioSug(1000, 95), 'y la curva no da saltos hacia atrás');
});

test('el panel de costo suma filamento y máquina', () => {
  const m = montar({ margen: '25', stats: CUBO20 });
  m.ctx.S.est = { grams: 100, secs: 3600, filM: 30 };   // 100 g a 15.000/kg + 1 h a 1.500
  m.api.costRecalc();
  assert.match(m.campos.slCostOut.innerHTML, /\$3\.000/, 'total = 1.500 + 1.500');
  assert.match(m.campos.slPriceSuggest.innerHTML, /\$4\.000/, 'con 25 % → 3.000/0,75');
  assert.equal(m.almacen.sl_margen_obj, '25', 'y el margen queda guardado');
});

// ── Traspaso a la cotización ────────────────────────────────────────────

test('los datos del slicer van a las notas de la cotización', async () => {
  const m = montar({ margen: '25', stats: CUBO20 });
  m.campos['cot-notas'].value = 'algo que ya estaba';
  m.api.slicerToCot();
  await new Promise((r) => setTimeout(r, 350));
  const v = m.campos['cot-notas'].value;
  assert.match(v, /^algo que ya estaba\n/, 'se agrega, no se pisa');
  assert.match(v, /Impresión 3D: pieza — Material: PLA/);
  assert.match(v, /margen 25%/);
});

test('si no está el campo de la cotización, se dice en vez de fingir', async () => {
  const m = montar({ margen: '25', stats: CUBO20 });
  delete m.campos['cot-notas'];
  m.api.slicerToCot();
  await new Promise((r) => setTimeout(r, 350));
  assert.match(m.avisos.join(' '), /Copia a mano/, 'debe entregar el texto igual');
  assert.doesNotMatch(m.avisos.join(' '), /copiados a las notas/, 'y no puede cantar victoria');
});

test('ya no se busca el campo a tientas por el placeholder', () => {
  // El id cotObs nunca existió; el respaldo por placeholder enganchaba
  // fichaNotas ("Notas de producción"), que vive en la pestaña Pedidos.
  const fn = bloque('function slicerToCot(').replace(/\/\/[^\n]*/g, '');   // sin los comentarios, que sí lo nombran
  assert.doesNotMatch(fn, /cotObs/, 'ese id no existe');
  assert.doesNotMatch(fn, /placeholder\*=/, 'ni se adivina por placeholder');
  assert.match(fn, /getElementById\('cot-notas'\)/);
  assert.equal((HTML.match(/id="cotObs"/g) || []).length, 0, 'confirmado: cotObs no existe');
  assert.equal((HTML.match(/id="cot-notas"/g) || []).length, 1, 'cot-notas sí');
  assert.match(HTML, /id="fichaNotas"/, 'y fichaNotas sigue siendo otra cosa');
});
