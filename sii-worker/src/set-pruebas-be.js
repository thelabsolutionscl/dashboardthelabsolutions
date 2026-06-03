// Set de Prueba Boleta Electrónica (tipo 39): 5 casos.
// Precios del set SII vienen "con IVA incluido"; se convierten a neto para el DTE.

const round = Math.round;

const RECEPTOR_BE = {
  rut: '66666666-6',
  razon_social: 'Consumidor Final',
  giro: 'Sin giro',
};

// Convierte precio unitario con IVA al precio neto para el XML del DTE.
const n = prcConIva => round(prcConIva / 1.19);

function beRef(caso) {
  return { tipo_doc: 'SET', folio: String(caso), razon: `CASO-${caso}` };
}

function calcTotalesBe(items) {
  let afecto = 0, exento = 0;
  for (const it of items) {
    const monto = it.cantidad * it.precio;
    if (it.exento) exento += monto; else afecto += monto;
  }
  const iva = afecto ? round(afecto * 0.19) : 0;
  return {
    neto: afecto || undefined,
    iva: iva || undefined,
    exento: exento || undefined,
    total: afecto + iva + exento,
  };
}

// folioMap: { '39': [f1,f2,f3,f4,f5] }
export function buildSetCasesBe(folioMap) {
  const f = folioMap['39'] || [];
  const cases = [];

  // CASO 1: Cambio de aceite + Alineacion y balanceo (precio con IVA: 19900 + 9900)
  {
    const detalle = [
      { nombre: 'Cambio de aceite',        cantidad: 1, precio: n(19900) },
      { nombre: 'Alineacion y balanceo',   cantidad: 1, precio: n(9900)  },
    ];
    cases.push({ tipo_documento: '39', folio: f[0], receptor: RECEPTOR_BE,
      detalle, totales: calcTotalesBe(detalle), referencias: [beRef(1)] });
  }

  // CASO 2: Papel de regalo 17u × $120 (con IVA)
  {
    const detalle = [{ nombre: 'Papel de regalo', cantidad: 17, precio: n(120) }];
    cases.push({ tipo_documento: '39', folio: f[1], receptor: RECEPTOR_BE,
      detalle, totales: calcTotalesBe(detalle), referencias: [beRef(2)] });
  }

  // CASO 3: Sandwic 2u + Bebida 2u (precios con IVA: 1500, 550)
  {
    const detalle = [
      { nombre: 'Sandwic', cantidad: 2, precio: n(1500) },
      { nombre: 'Bebida',  cantidad: 2, precio: n(550)  },
    ];
    cases.push({ tipo_documento: '39', folio: f[2], receptor: RECEPTOR_BE,
      detalle, totales: calcTotalesBe(detalle), referencias: [beRef(3)] });
  }

  // CASO 4: servicio afecto + servicio exento (precios con IVA: 1590 afecto, 1000 exento)
  {
    const detalle = [
      { nombre: 'item afecto 1',  cantidad: 8, precio: n(1590)          },
      { nombre: 'item exento 2',  cantidad: 2, precio: 1000, exento: true },
    ];
    cases.push({ tipo_documento: '39', folio: f[3], receptor: RECEPTOR_BE,
      detalle, totales: calcTotalesBe(detalle), referencias: [beRef(4)] });
  }

  // CASO 5: Arroz 5 Kg × $700 (con IVA), unidad Kg
  {
    const detalle = [{ nombre: 'Arroz', cantidad: 5, precio: n(700), unidad: 'Kg' }];
    cases.push({ tipo_documento: '39', folio: f[4], receptor: RECEPTOR_BE,
      detalle, totales: calcTotalesBe(detalle), referencias: [beRef(5)] });
  }

  return cases;
}

export const SET_FOLIOS_NEEDED_BE = { '39': 5 };
