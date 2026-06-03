import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const TIPO_NOMBRE = {
  '33': 'FACTURA ELECTRONICA',
  '34': 'FACTURA NO AFECTA O EXENTA ELECTRONICA',
  '39': 'BOLETA ELECTRONICA',
  '56': 'NOTA DE DEBITO ELECTRONICA',
  '61': 'NOTA DE CREDITO ELECTRONICA',
};

const CLP = n => '$ ' + Number(n || 0).toLocaleString('es-CL');
const rx = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
const unescapeXml = s => (s || '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');

// Extrae los datos necesarios para la representación impresa desde el <DTE> guardado.
export function parseDte(dteXml) {
  const enc = rx(dteXml, 'Encabezado');
  const idDoc = rx(enc, 'IdDoc');
  const emisor = rx(enc, 'Emisor');
  const receptor = rx(enc, 'Receptor');
  const totales = rx(enc, 'Totales');

  const tipo = rx(idDoc, 'TipoDTE');
  const folio = rx(idDoc, 'Folio');
  const fecha = rx(idDoc, 'FchEmis');

  const detalle = [];
  const body = dteXml.slice(dteXml.indexOf('</Encabezado>'));
  const re = /<Detalle>([\s\S]*?)<\/Detalle>/g;
  let m;
  while ((m = re.exec(body))) {
    const d = m[1];
    detalle.push({
      nombre: unescapeXml(rx(d, 'NmbItem')),
      qty: rx(d, 'QtyItem'),
      precio: rx(d, 'PrcItem'),
      descuento: rx(d, 'DescuentoMonto'),
      monto: rx(d, 'MontoItem'),
      exento: /<IndExe>1<\/IndExe>/.test(d),
    });
  }

  const refs = [];
  const rre = /<Referencia>([\s\S]*?)<\/Referencia>/g;
  while ((m = rre.exec(body))) {
    const r = m[1];
    refs.push({
      tipo: unescapeXml(rx(r, 'TpoDocRef')),
      folio: rx(r, 'FolioRef'),
      cod: rx(r, 'CodRef'),
      razon: unescapeXml(rx(r, 'RazonRef')),
    });
  }

  const ted = (dteXml.match(/<TED[\s\S]*?<\/TED>/) || [])[0] || '';

  return {
    tipo, folio, fecha,
    emisor: {
      rut: rx(emisor, 'RUTEmisor'),
      razon: unescapeXml(rx(emisor, 'RznSoc')),
      giro: unescapeXml(rx(emisor, 'GiroEmis')),
      dir: unescapeXml(rx(emisor, 'DirOrigen')),
      comuna: unescapeXml(rx(emisor, 'CmnaOrigen')),
      ciudad: unescapeXml(rx(emisor, 'CiudadOrigen')),
    },
    receptor: {
      rut: rx(receptor, 'RUTRecep'),
      razon: unescapeXml(rx(receptor, 'RznSocRecep')),
      giro: unescapeXml(rx(receptor, 'GiroRecep')),
      dir: unescapeXml(rx(receptor, 'DirRecep')),
      comuna: unescapeXml(rx(receptor, 'CmnaRecep')),
    },
    totales: {
      neto: rx(totales, 'MntNeto'),
      exento: rx(totales, 'MntExe'),
      iva: rx(totales, 'IVA'),
      total: rx(totales, 'MntTotal'),
    },
    detalle, refs, ted,
  };
}

// Genera el PDF de la representación impresa y lo escribe en el stream `out`.
export async function generateDtePdf(dteXml, env, out) {
  const dte = parseDte(dteXml);

  // Timbre PDF417 a partir del TED (formato que SII espera en el barcode)
  const pdf417 = await bwipjs.toBuffer({
    bcid: 'pdf417',
    text: dte.ted,
    columns: 18,
    eclevel: 5,
    scale: 2,
    padding: 2,
    backgroundcolor: 'FFFFFF',
  });

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(out);

  const pageW = doc.page.width, M = 40, contentW = pageW - M * 2;

  // ── Recuadro rojo SII (arriba a la derecha) ──
  const boxW = 230, boxX = pageW - M - boxW, boxY = M, boxH = 92;
  doc.lineWidth(1.5).strokeColor('#d11').rect(boxX, boxY, boxW, boxH).stroke();
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(11);
  doc.text(`R.U.T.: ${dte.emisor.rut}`, boxX, boxY + 10, { width: boxW, align: 'center' });
  doc.fontSize(12).text(TIPO_NOMBRE[dte.tipo] || `DTE TIPO ${dte.tipo}`, boxX, boxY + 30, { width: boxW, align: 'center' });
  doc.fontSize(12).text(`N° ${dte.folio}`, boxX, boxY + 58, { width: boxW, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#d11')
     .text('S.I.I. - SANTIAGO', boxX, boxY + 76, { width: boxW, align: 'center' });

  // ── Datos del emisor (arriba a la izquierda) ──
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(15).text(dte.emisor.razon, M, M + 4, { width: contentW - boxW - 20 });
  doc.font('Helvetica').fontSize(9).fillColor('#333');
  doc.text(`Giro: ${dte.emisor.giro}`, M, doc.y + 4, { width: contentW - boxW - 20 });
  doc.text(`${dte.emisor.dir}, ${dte.emisor.comuna} ${dte.emisor.ciudad}`.trim(), { width: contentW - boxW - 20 });

  // ── Fecha emisión ──
  let y = Math.max(doc.y, boxY + boxH) + 16;
  doc.fillColor('#000').font('Helvetica').fontSize(9);
  doc.text(`Fecha Emisión: ${dte.fecha}`, M, y);
  y = doc.y + 8;

  // ── Receptor ──
  doc.rect(M, y, contentW, 56).strokeColor('#999').lineWidth(0.7).stroke();
  doc.font('Helvetica-Bold').fontSize(9).text('SEÑOR(ES):', M + 8, y + 7);
  doc.font('Helvetica').fontSize(9);
  doc.text(`${dte.receptor.razon}   R.U.T.: ${dte.receptor.rut}`, M + 75, y + 7, { width: contentW - 85 });
  doc.text(`Giro: ${dte.receptor.giro}`, M + 8, y + 22, { width: contentW - 16 });
  doc.text(`Dirección: ${dte.receptor.dir || '—'} ${dte.receptor.comuna || ''}`.trim(), M + 8, y + 37, { width: contentW - 16 });
  y += 56 + 14;

  // ── Tabla de detalle ──
  const cols = [
    { t: 'Item', x: M + 4, w: 230, a: 'left' },
    { t: 'Cant.', x: M + 240, w: 50, a: 'right' },
    { t: 'P. Unit.', x: M + 295, w: 70, a: 'right' },
    { t: 'Desc.', x: M + 370, w: 60, a: 'right' },
    { t: 'Monto', x: M + 435, w: contentW - 435 - 4, a: 'right' },
  ];
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000');
  doc.rect(M, y, contentW, 18).fillAndStroke('#eee', '#999');
  doc.fillColor('#000');
  cols.forEach(c => doc.text(c.t, c.x, y + 5, { width: c.w, align: c.a }));
  y += 18;
  doc.font('Helvetica').fontSize(8.5);
  for (const it of dte.detalle) {
    const h = 16;
    if (y > doc.page.height - 220) { doc.addPage(); y = M; }
    doc.text(it.nombre + (it.exento ? '  (EXENTO)' : ''), cols[0].x, y + 4, { width: cols[0].w });
    if (it.qty) doc.text(it.qty, cols[1].x, y + 4, { width: cols[1].w, align: 'right' });
    if (it.precio) doc.text(CLP(it.precio), cols[2].x, y + 4, { width: cols[2].w, align: 'right' });
    doc.text(it.descuento ? CLP(it.descuento) : '', cols[3].x, y + 4, { width: cols[3].w, align: 'right' });
    if (it.monto) doc.text(CLP(it.monto), cols[4].x, y + 4, { width: cols[4].w, align: 'right' });
    doc.strokeColor('#ddd').lineWidth(0.5).moveTo(M, y + h).lineTo(M + contentW, y + h).stroke();
    y += h;
  }
  y += 10;

  // ── Referencias ──
  if (dte.refs.length) {
    doc.font('Helvetica-Bold').fontSize(8.5).text('Referencias:', M, y); y = doc.y + 2;
    doc.font('Helvetica').fontSize(8);
    for (const r of dte.refs) {
      const codTxt = r.cod ? ` (Cod ${r.cod})` : '';
      const folTxt = r.folio ? ` ${r.folio}` : '';
      doc.text(`• ${r.tipo}${folTxt}${codTxt}: ${r.razon}`, M + 6, y, { width: contentW - 12 });
      y = doc.y + 1;
    }
    y += 8;
  }

  // ── Totales (derecha) ──
  const tX = M + contentW - 230, tW = 230;
  const totLine = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.text(label, tX, y, { width: 130, align: 'right' });
    doc.text(CLP(val), tX + 130, y, { width: tW - 130, align: 'right' });
    y = doc.y + 3;
  };
  if (dte.totales.neto) totLine('Neto:', dte.totales.neto);
  if (dte.totales.exento) totLine('Exento:', dte.totales.exento);
  if (dte.totales.iva) totLine('IVA 19%:', dte.totales.iva);
  totLine('TOTAL:', dte.totales.total, true);
  y += 10;

  // ── Timbre PDF417 ──
  const imgW = 230;
  if (y > doc.page.height - 130) { doc.addPage(); y = M; }
  doc.image(pdf417, M, y, { width: imgW });
  const resol = String(env.SII_ENV) === 'produccion' ? (env.RESOLUCION_NUMERO || 0) : 0;
  doc.font('Helvetica').fontSize(7.5).fillColor('#333')
     .text(`Timbre Electrónico SII - Res. ${resol} de ${env.RESOLUCION_FECHA || ''}`, M, y + imgW * 0.32, { width: imgW + 60 })
     .text('Verifique documento: www.sii.cl', M, doc.y, { width: imgW + 60 });

  doc.end();
}
