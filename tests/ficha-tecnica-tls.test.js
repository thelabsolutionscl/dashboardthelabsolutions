#!/usr/bin/env node
/*
 * Ficha técnica para clientes con la plantilla oficial TLS (02-11-2026).
 *
 * El usuario rechazó la ficha horizontal del dashboard ("MUESTRA 1") y fijó
 * como plantilla la del trofeo Hospital Militar del Norte: A4 vertical, 2
 * páginas, Lato, negro #0D0D0E + cian #02B2C1. La versión de referencia vive en
 * la skill ~/.claude/skills/ficha-tecnica-tls (render.mjs); fichaTLSHtml la
 * replica y, con el mismo contenido, imprime píxel a píxel lo mismo.
 *
 * Estas pruebas clavan lo que no puede volver atrás:
 *   - el documento es A4 vertical y no queda rastro de la ficha horizontal;
 *   - el pie y la tipografía son los de la plantilla;
 *   - las fichas guardadas con el formato antiguo siguen abriendo;
 *   - el dibujo de medidas usa la MISMA escala en las dos vistas;
 *   - lo que se guarda en Airtable no lleva imágenes (la celda tiene 100.000
 *     caracteres) y la ficha de referencia cabe con holgura;
 *   - el PDF de Drive (html2pdf) no suma hojas en blanco ni pierde el dibujo.
 *
 * Correr:  node --test tests/ficha-tecnica-tls.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const PDF = fs.readFileSync(path.join(RAIZ, 'js', 'pdf-fichas.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const DRIVE = fs.readFileSync(path.join(RAIZ, 'js', 'drive.js'), 'utf8');

function cargar(storage = {}) {
  const ctx = {
    console,
    location: { origin: 'https://dashboard.thelab.solutions' },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
  };
  vm.createContext(ctx);
  vm.runInContext(PDF, ctx);
  return ctx;
}
function bloque(marca, src) {
  const i = src.indexOf(marca);
  assert.ok(i >= 0, `debe existir ${marca}`);
  let d = 0;
  for (let x = src.indexOf('{', i); x < src.length; x++) {
    if (src[x] === '{') d++;
    if (src[x] === '}') { d--; if (!d) return src.slice(i, x + 1); }
  }
  throw new Error('bloque sin cerrar: ' + marca);
}
const paginas = html => (html.match(/<section class="pagina">/g) || []).length;

// Contenido real de la ficha de referencia (Hospital Militar del Norte).
function fichaHMN(ft) {
  const f = ft.ftNuevaFicha({ cliente: 'Hospital Militar del Norte', producto: 'Trofeo 15 cm', cantidad: '6 unidades', fecha: '02-11-2026' });
  f.encabezado.tipo = 'Trofeo institucional';
  f.encabezado.tipo_corto = 'Trofeo';
  f.encabezado.meta[2] = ['Línea', 'Impresión 3D · Trofeos'];
  f.pagina1.en_simple = ['Trofeo institucional de 15 cm de alto impreso en 3D en PLA mate.', 'La base es un cilindro negro con una placa de Gravoply grabada con láser.'];
  f.pagina1.chips = ['PLA MATE 3D', 'PLACA GRAVOPLY', 'ENCASTRES'];
  f.pagina1.especificaciones = Array.from({ length: 13 }, (_, i) => ['Dato ' + (i + 1), 'Valor de la especificación ' + (i + 1)]);
  f.pagina1.medidas = { alto: '15', ancho: '12,8', fondo: '10,6', nota: 'Medidas en cm. Ambas vistas a la misma escala.' };
  f.pagina2.componentes = { titulo: 'Componentes del trofeo', nota: 'El texto final se confirma con el cliente.', items: Array.from({ length: 6 }, (_, i) => ({ nombre: 'Pieza ' + (i + 1), desc: 'Descripción corta de la pieza.', chip: 'PLA · 3D' })) };
  f.pagina2.detalle = { titulo: 'Placa Gravoply', nota: 'Grabado láser.' };
  f.pagina2.pasos = { titulo: 'Cómo se arma', nota: 'Se entrega armado y pegado.', items: ['Paso uno.', 'Paso dos.', 'Paso tres.', 'Paso cuatro.', 'Paso cinco.'] };
  f.pagina2.glosario = [{ termino: 'PLA mate', def: 'Plástico sin brillo.' }, { termino: 'Gravoply', def: 'Lámina metalizada.' }, { termino: 'Encastre', def: 'Unión por calce.' }];
  f.pagina2.cuidados = ['Calor: no dejar al sol.', 'Traslado: por la base.', 'Limpieza: paño seco.', 'Placa: no rayar.'];
  return f;
}

// ── El documento ────────────────────────────────────────────────────────

test('la ficha es A4 vertical, con el pie y la tipografía de la plantilla', () => {
  const ft = cargar();
  const html = ft.fichaTLSHtml([fichaHMN(ft)], { imgs: [{ detalle: 'data:image/png;base64,AAAA' }] });
  assert.match(html, /@page\{size:A4 portrait;margin:0\}/);
  assert.doesNotMatch(html, /landscape/i, 'nada de A4 horizontal');
  assert.doesNotMatch(html, /MUESTRA/, 'nada de las páginas "MUESTRA N" de la ficha antigua');
  assert.match(html, /\.pagina\{width:210mm;height:297mm;/);
  for (const w of [400, 700, 900]) assert.match(html, new RegExp(`font-weight:${w};src:url\\(https://dashboard\\.thelab\\.solutions/assets/fonts/Lato-${w}\\.woff2\\)`));
  assert.match(html, /--ink:#0d0d0e;--cian:#02b2c1/);
  assert.ok(html.includes('The Lab Solutions · Fabricación personalizada para marcas'));
  assert.ok(html.includes('thelab.solutions · hola@thelab.solutions · +56 9 2878 5039'));
  assert.equal(paginas(html), 2);
  assert.match(html, /Ficha técnica · Trofeo <span>Hospital Militar del Norte<\/span> · 2\/2/);
  for (const sec of ['En simple', 'Especificaciones', 'Medidas', 'Componentes del trofeo', 'Placa Gravoply', 'Cómo se arma', 'Glosario para entender la ficha', 'Cuidados'])
    assert.ok(html.includes(`<i></i>${sec}</div>`), 'falta la sección ' + sec);
});

test('los tamaños son los calibrados contra el PDF de referencia, no los de la primera versión', () => {
  // Medidos línea a línea con pdftotext -bbox sobre el PDF del Hospital Militar
  // (WeasyPrint). Con los valores anteriores, esa misma ficha se montaba sobre
  // el pie en las dos páginas.
  const ft = cargar();
  const css = ft.fichaTLSHtml([fichaHMN(ft)], {}).match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const regla of [
    'h1{font-weight:900;font-size:19.5pt;line-height:1.16;',
    '.simple p{font-size:9.8pt;line-height:1.56;margin-top:2.6mm}',
    '.specs td{font-size:8.3pt;padding:1.9mm 0;',
    '.comp p{font-size:7.6pt;color:#55595d;line-height:1.42;',
    'font-size:8.7pt;line-height:1.42;margin-bottom:2.2mm}',
    '.cuid li{position:relative;padding-left:5.6mm;font-size:8.6pt;line-height:1.5}',
    '.h2 span{color:var(--cian);text-transform:uppercase}',
  ]) assert.ok(css.includes(regla), 'falta ' + regla);
});

test('las fuentes Lato viajan con el dashboard', () => {
  for (const w of [400, 700, 900]) assert.ok(fs.statSync(path.join(RAIZ, 'assets', 'fonts', `Lato-${w}.woff2`)).size > 10000);
});

test('lo vacío no sale: sin página 2 si no hay contenido para ella', () => {
  const ft = cargar();
  const f = ft.ftNuevaFicha({ cliente: 'Cliente', producto: 'Letrero', fecha: '02-11-2026' });
  const html = ft.fichaTLSHtml([f], {});
  assert.equal(paginas(html), 1);
  assert.doesNotMatch(html, /2\/2/);
  assert.doesNotMatch(html, /<figure class="foto">/, 'sin foto no hay tarjeta de foto vacía');
  assert.doesNotMatch(html, /<i><\/i>Especificaciones/);
  assert.doesNotMatch(html, /<b>Línea<\/b>/, 'los datos sin valor no se imprimen');
});

test('una ficha por producto: dos productos son cuatro páginas', () => {
  const ft = cargar();
  assert.equal(paginas(ft.fichaTLSHtml([fichaHMN(ft), fichaHMN(ft)], {})), 4);
});

test('el texto del usuario se escapa', () => {
  const ft = cargar();
  const f = fichaHMN(ft);
  f.encabezado.tipo = '<script>alert(1)</script>';
  f.pagina1.especificaciones = [['<b>x</b>', '"y"']];
  const html = ft.fichaTLSHtml([f], {});
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<td>&lt;b&gt;x&lt;/b&gt;</td><td>&quot;y&quot;</td>'));
});

test('si el contenido no cabe en la hoja, se avisa en pantalla y no se imprime solo', () => {
  const ft = cargar();
  const html = ft.fichaTLSHtml([fichaHMN(ft)], {});
  assert.match(html, /window\.ftRevisar=function\(\)/);
  assert.match(html, /El contenido se monta sobre el pie/);
  const fn = bloque('async function descargarFichaPropuesta(', HTML);
  assert.match(fn, /var malas=window\.ftRevisar\?window\.ftRevisar\(\):\[\];/);
  assert.match(fn, /if\(malas\.length\)\{[^}]*Imprimir igual[\s\S]*?return;\}/, 'con desborde no llama a print');
  assert.match(fn, /document\.fonts\?document\.fonts\.ready/, 'espera a Lato antes de imprimir');
});

// ── Medidas ─────────────────────────────────────────────────────────────

test('el dibujo de medidas usa la misma escala en la vista frontal y la lateral', () => {
  const ft = cargar();
  for (const m of [{ alto: 15, ancho: 12.8, fondo: 10.6 }, { alto: 120, ancho: 250, fondo: 8 }, { alto: 200, ancho: 20, fondo: 2 }, { alto: 10, ancho: 300, fondo: 1 }]) {
    const svg = ft.ftMedidasSvg(m);
    const r = [...svg.matchAll(/<rect x="([\d.]+)" y="48" width="([\d.]+)" height="([\d.]+)"/g)].map(x => x.slice(1).map(Number));
    assert.equal(r.length, 2);
    assert.equal(r[0][2], r[1][2], 'misma altura dibujada');
    assert.ok(Math.abs(r[0][2] / r[0][1] - m.alto / m.ancho) < 0.01, 'la frontal respeta alto/ancho');
    if (m.fondo * (r[0][2] / m.alto) >= 4) assert.ok(Math.abs(r[1][1] / r[0][1] - m.fondo / m.ancho) < 0.01, 'la lateral respeta fondo/ancho');
    const t = [...svg.matchAll(/<text x="([\d.]+)" y="26">/g)].map(x => +x[1]);
    assert.ok(t.every(x => x - 95 >= 0 && x + 95 <= 720), 'los títulos no se cortan: ' + t);
    assert.ok(t[1] - t[0] >= 190, 'los títulos no se pisan');
  }
});

test('las cotas salen en cm con coma decimal y sin alto o ancho no hay dibujo', () => {
  const ft = cargar();
  const svg = ft.ftMedidasSvg({ alto: '15 cm', ancho: '12.8', fondo: '10,6' });
  for (const c of ['>15 cm<', '>12,8 cm<', '>10,6 cm<']) assert.ok(svg.includes(c), c);
  assert.equal(ft.ftMedidasSvg({ alto: '15' }), '');
  assert.equal(ft.ftMedidasSvg({}), '');
});

// ── Lo que se guarda ────────────────────────────────────────────────────

test('se guarda el JSON de la skill, sin imágenes, y la ficha de referencia cabe holgada', () => {
  const ft = cargar();
  const it = { ...fichaHMN(ft), img: { foto: 'data:image/jpeg;base64,' + 'A'.repeat(50000) }, prompts: { foto: 'x' }, _descripcion: 'y' };
  const g = ft.ftParaGuardar(it);
  assert.deepStrictEqual(Object.keys(g), ['encabezado', 'pagina1', 'pagina2']);
  const json = JSON.stringify({ v: 2, fichas: [g], logoCliente: '', updatedAt: '2026-11-02' });
  assert.ok(!json.includes('data:image'));
  assert.ok(json.length < 10000, 'la ficha completa ocupa ' + json.length + ' de 100.000 caracteres');
  const fn = bloque('async function saveFichaPropModal(', HTML);
  assert.match(fn, /\{v:2,fichas:_fpItems\.map\(ftParaGuardar\)/);
  assert.match(fn, /95000-JSON\.stringify\(base\)\.length/, 'el logo usa solo el espacio que deja el contenido');
  assert.ok(fn.indexOf("window.open('','_blank')") < fn.indexOf('await airtableWrite'), 'la ventana del PDF se abre antes de esperar a Airtable (si no, el navegador la bloquea)');
});

test('una ficha guardada vuelve igual al abrirla', () => {
  const ft = cargar();
  const f = fichaHMN(ft);
  const vuelta = ft.ftNormalizar(JSON.parse(JSON.stringify({ v: 2, fichas: [ft.ftParaGuardar(f)], logoCliente: 'data:image/png;base64,QQ==' })), {});
  assert.equal(vuelta.v1, false);
  assert.equal(vuelta.logoCliente, 'data:image/png;base64,QQ==');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vuelta.fichas[0])), JSON.parse(JSON.stringify(ft.ftParaGuardar(f))));
});

// ── Fichas antiguas ─────────────────────────────────────────────────────

test('la ficha antigua (horizontal, por muestras) sigue abriendo en la plantilla nueva', () => {
  const ft = cargar();
  const v1 = { numFicha: '03', nombreProyecto: 'PROPUESTA CARTELES', logoCliente: 'data:image/png;base64,QQ==', updatedAt: '2026-10-15', items: [
    { nombre: 'CARTEL ILUMINADO NEGRO', tipo: '3D Y ACRÍLICO', material: '3D: PLA Terminación blanca\nACRÍLICO: Transparente 2mm', optLabel: '3D Y LAMINADO MIC', optMaterial: 'GRÁFICA: Laminado MIC 240.', dims: '40 × 35 × 8 cm' },
    { nombre: 'LOGO CORPÓREO', tipo: '', material: 'PLA negro mate', optLabel: '', optMaterial: '', dims: '' }] };
  const d = ft.ftNormalizar(v1, { cliente: 'Retail Sur SpA' });
  assert.equal(d.v1, true);
  assert.equal(d.fichas.length, 2);
  assert.equal(d.logoCliente, v1.logoCliente);
  const [a, b] = d.fichas;
  assert.equal(a.encabezado.tipo, 'CARTEL ILUMINADO NEGRO');
  assert.equal(a.encabezado.destacado, 'Retail Sur SpA');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.encabezado.meta)), [['Cliente', 'Retail Sur SpA'], ['Producto', 'CARTEL ILUMINADO NEGRO'], ['Proyecto', 'PROPUESTA CARTELES'], ['Cantidad', ''], ['Fecha', '15-10-2026']]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.pagina1.especificaciones)), [['Técnica', '3D Y ACRÍLICO'], ['3D', 'PLA Terminación blanca'], ['ACRÍLICO', 'Transparente 2mm'], ['Opción 2', '3D Y LAMINADO MIC · GRÁFICA: Laminado MIC 240.'], ['Medida total', '40 × 35 × 8 cm']]);
  assert.equal(a.pagina1.resumen_medidas, 'Medidas: 40 × 35 × 8 cm');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.pagina1.especificaciones)), [['Material', 'PLA negro mate']]);
  const html = ft.fichaTLSHtml(d.fichas, { logoCliente: d.logoCliente });
  assert.equal(paginas(html), 2, 'una hoja por producto: no tienen contenido de página 2');
  assert.doesNotMatch(html, /landscape|MUESTRA/);
});

test('datos rotos o vacíos no revientan la ficha', () => {
  const ft = cargar();
  for (const d of [null, undefined, {}, { items: [] }, { fichas: [] }, { v: 2, fichas: [null, 'x', { pagina1: { especificaciones: 'no-array' } }] }]) {
    const n = ft.ftNormalizar(d, { cliente: 'C' });
    assert.ok(n.fichas.length >= 1);
    assert.ok(paginas(ft.fichaTLSHtml(n.fichas, {})) >= 1);
  }
});

test('las imágenes que ya estaban en el navegador con la ficha antigua no se pierden', () => {
  const ft = cargar({ fp_imgs_recX: JSON.stringify({ '0_imgFrontal': 'data:F', '0_imgAerea': 'data:L', '1_imgIsometrica': 'data:I', '1_imgFrontal': 'data:F2', '0_raw': 'data:R', '0_detalle': 'data:D' }) });
  const { imgs, raw } = ft._fpLeerImgCache('recX');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(imgs[0])), { frontal: 'data:F', foto: 'data:F', lateral: 'data:L', detalle: 'data:D' });
  assert.equal(imgs[1].foto, 'data:I', 'la isométrica manda como foto principal');
  assert.equal(imgs[1].frontal, 'data:F2');
  assert.equal(raw[0].dataUrl, 'data:R');
});

test('el botón de la cotización arma la ficha con la plantilla nueva', () => {
  const fn = bloque('function buildFichaPropuestaDoc(', HTML);
  assert.match(fn, /ftNormalizar\(parseFichaPropData\(f\['Ficha Propuesta'\]\),ctx\)/);
  assert.match(fn, /fichaTLSHtml\(data\.fichas,\{imgs,logoCliente:logo,titulo\}\)/);
  assert.match(fn, /'Ficha-Tecnica'/, 'nombre de archivo de la skill');
  assert.doesNotMatch(HTML, /id="fpNumFicha"|id="fpNombreProyecto"/, 'el modal ya no pide N° de ficha ni proyecto');
  assert.match(HTML, /id="fpV1Aviso"/);
});

// ── PDF para Drive (html2pdf) ──────────────────────────────────────────

test('el PDF de Drive no suma hojas en blanco ni pierde el dibujo de medidas', () => {
  const ft = cargar();
  const html = ft.fichaTLSHtml([fichaHMN(ft)], {});
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  // html2pdf convierte un page-break-after en una hoja en blanco: solo en @media print.
  const fueraDePrint = css.replace(/@media print\{[\s\S]*?\}\}/g, '');
  assert.doesNotMatch(fueraDePrint, /break-after/);
  assert.match(css, /@media print\{[\s\S]*\.pagina\{page-break-after:always;break-after:page\}/);
  // El escudo all:revert del PDF de Drive anula [hidden]: el aviso se oculta por CSS.
  assert.match(css, /\.ft-aviso\{display:none;/);
  assert.doesNotMatch(html, /id="ftAviso" hidden/);
  const fn = bloque('async function _fichaHTMLtoPdfBlob(', DRIVE);
  assert.match(fn, /querySelectorAll\('svg\[viewBox\]'\)/, 'los SVG en línea se pasan a imagen');
  assert.match(fn, /if\(svg\.querySelector\('use'\)\) return;/, 'sin tocar los íconos del sprite');
  assert.match(fn, /pdf\.deletePage\(n\)/, 'se quita la hoja final que sobra por redondeo');
  assert.match(fn, /altoDoc-\(n-1\)\*altoHoja<4/, 'solo si lo que pasa a esa hoja mide menos de 4 px');
});
