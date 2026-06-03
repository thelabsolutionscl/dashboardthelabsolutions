// Genera los casos del SET BÁSICO de certificación SII (atención 4871837):
// 4 Facturas (33), 3 Notas de Crédito (61), 1 Nota de Débito (56).
// Los montos se calculan aquí para que coincidan exactamente con lo que SII valida.

const round = Math.round;

// Receptor de prueba (RUT válido). SII no exige un receptor específico en el set.
const RECEPTOR = {
  rut: '66666666-6',
  razon_social: 'Cliente Certificacion SII',
  giro: 'Servicios Generales',
  direccion: 'Avenida Siempre Viva 742',
  comuna: 'Santiago',
  ciudad: 'Santiago',
};

const ATENCION = '4871837';

// Referencia que identifica el caso del set (SII las usa para emparejar documentos).
function setRef(casoNum) {
  return { tipo_doc: 'SET', folio: String(casoNum), razon: `CASO ${ATENCION}-${casoNum}` };
}

// Calcula totales afecto/exento/IVA aplicando descuentos de línea y descuento global.
function calcTotales(items, descGlobalPct = 0) {
  let afecto = 0, exento = 0;
  for (const it of items) {
    const gross = round(it.cantidad * it.precio);
    const desc = it.descuento_pct ? round(gross * it.descuento_pct / 100) : 0;
    const net = gross - desc;
    if (it.exento) exento += net; else afecto += net;
  }
  if (descGlobalPct) afecto -= round(afecto * descGlobalPct / 100);
  const iva = afecto ? round(afecto * 0.19) : 0;
  const total = afecto + iva + exento;
  return {
    neto: afecto || undefined,
    iva: iva || undefined,
    exento: exento || undefined,
    total,
  };
}

// folioMap: { '33':[f1,f2,f3,f4], '61':[n1,n2,n3], '56':[d1] }
// Devuelve un array de objetos `data` (tipo_documento, receptor, detalle, ...)
// con su folio asignado, listos para buildSignedEnvioDTESet.
export function buildSetCases(folioMap) {
  const f33 = folioMap['33'] || [];
  const f61 = folioMap['61'] || [];
  const f56 = folioMap['56'] || [];
  const cases = [];

  // ── CASO 1: Factura afecta simple ──
  {
    const detalle = [
      { nombre: 'Cajon AFECTO', cantidad: 158, precio: 2937 },
      { nombre: 'Relleno AFECTO', cantidad: 67, precio: 4878 },
    ];
    cases.push({
      tipo_documento: '33', folio: f33[0], receptor: RECEPTOR, detalle,
      totales: calcTotales(detalle),
      referencias: [setRef(1)],
    });
  }

  // ── CASO 2: Factura con descuentos por línea ──
  {
    const detalle = [
      { nombre: 'Panuelo AFECTO', cantidad: 646, precio: 5023, descuento_pct: 8 },
      { nombre: 'ITEM 2 AFECTO', cantidad: 586, precio: 4077, descuento_pct: 19 },
    ];
    cases.push({
      tipo_documento: '33', folio: f33[1], receptor: RECEPTOR, detalle,
      totales: calcTotales(detalle),
      referencias: [setRef(2)],
    });
  }

  // ── CASO 3: Factura con ítem exento ──
  {
    const detalle = [
      { nombre: 'Pintura B&W AFECTO', cantidad: 51, precio: 5892 },
      { nombre: 'ITEM 2 AFECTO', cantidad: 217, precio: 3741 },
      { nombre: 'ITEM 3 SERVICIO EXENTO', cantidad: 1, precio: 35165, exento: true },
    ];
    cases.push({
      tipo_documento: '33', folio: f33[2], receptor: RECEPTOR, detalle,
      totales: calcTotales(detalle),
      referencias: [setRef(3)],
    });
  }

  // ── CASO 4: Factura con ítem exento y descuento global a los afectos ──
  {
    const detalle = [
      { nombre: 'ITEM 1 AFECTO', cantidad: 342, precio: 5003 },
      { nombre: 'ITEM 2 AFECTO', cantidad: 145, precio: 5954 },
      { nombre: 'ITEM 3 SERVICIO EXENTO', cantidad: 2, precio: 6819, exento: true },
    ];
    cases.push({
      tipo_documento: '33', folio: f33[3], receptor: RECEPTOR, detalle,
      descuento_global_pct: 19,
      totales: calcTotales(detalle, 19),
      referencias: [setRef(4)],
    });
  }

  // ── CASO 5: Nota de Crédito que corrige giro del receptor de caso 1 (CodRef 2) ──
  {
    cases.push({
      tipo_documento: '61', folio: f61[0], receptor: RECEPTOR,
      detalle: [{ nombre: 'CORRIGE GIRO DEL RECEPTOR' }],
      totales: { total: 0 },
      referencias: [
        setRef(5),
        { tipo_doc: '33', folio: f33[0], cod_ref: 2, razon: 'CORRIGE GIRO DEL RECEPTOR' },
      ],
    });
  }

  // ── CASO 6: Nota de Crédito por devolución parcial de caso 2 (CodRef 3) ──
  {
    const detalle = [
      { nombre: 'Panuelo AFECTO', cantidad: 237, precio: 5023, descuento_pct: 8 },
      { nombre: 'ITEM 2 AFECTO', cantidad: 398, precio: 4077, descuento_pct: 19 },
    ];
    cases.push({
      tipo_documento: '61', folio: f61[1], receptor: RECEPTOR, detalle,
      totales: calcTotales(detalle),
      referencias: [
        setRef(6),
        { tipo_doc: '33', folio: f33[1], cod_ref: 3, razon: 'DEVOLUCION DE MERCADERIAS' },
      ],
    });
  }

  // ── CASO 7: Nota de Crédito que anula la Factura de caso 3 (CodRef 1) ──
  {
    const detalle = [
      { nombre: 'Pintura B&W AFECTO', cantidad: 51, precio: 5892 },
      { nombre: 'ITEM 2 AFECTO', cantidad: 217, precio: 3741 },
      { nombre: 'ITEM 3 SERVICIO EXENTO', cantidad: 1, precio: 35165, exento: true },
    ];
    cases.push({
      tipo_documento: '61', folio: f61[2], receptor: RECEPTOR, detalle,
      totales: calcTotales(detalle),
      referencias: [
        setRef(7),
        { tipo_doc: '33', folio: f33[2], cod_ref: 1, razon: 'ANULA FACTURA' },
      ],
    });
  }

  // ── CASO 8: Nota de Débito que anula la Nota de Crédito de caso 5 (CodRef 1) ──
  {
    cases.push({
      tipo_documento: '56', folio: f56[0], receptor: RECEPTOR,
      detalle: [{ nombre: 'ANULA NOTA DE CREDITO ELECTRONICA' }],
      totales: { total: 0 },
      referencias: [
        setRef(8),
        { tipo_doc: '61', folio: f61[0], cod_ref: 1, razon: 'ANULA NOTA DE CREDITO ELECTRONICA' },
      ],
    });
  }

  return cases;
}

// Cantidad de folios que requiere el set por tipo de documento.
export const SET_FOLIOS_NEEDED = { '33': 4, '61': 3, '56': 1 };
