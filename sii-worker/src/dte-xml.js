import { createRequire } from 'module';
import { rsaSha1b64Pem, certDerb64, rsaModulusb64, rsaExponentb64, privateKeyPem } from './sii-crypto.js';

const require = createRequire(import.meta.url);
const { SignedXml } = require('xml-crypto');

function x(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ts() {
  return new Date().toISOString().slice(0, 19);  // "2026-05-29T10:00:00"
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanRut(rut) {
  return (rut || '').replace(/\./g, '');  // elimina puntos, conserva guión
}

// Extrae el bloque <CAF>...</CAF> del XML de autorización completo (verbatim).
// Debe ir byte-a-byte como lo entregó SII, porque trae su propia firma <FRMA>.
function extractCafElement(cafXml) {
  const m = cafXml.match(/<CAF[\s\S]*?<\/CAF>/);
  return m ? m[0] : cafXml;
}

// Extrae la llave privada del CAF (<RSASK>) en formato PEM. El timbre (FRMT)
// se firma con ESTA llave, no con la del certificado de la empresa.
function extractCafPrivateKey(cafXml) {
  const m = cafXml.match(/<RSASK>([\s\S]*?)<\/RSASK>/);
  if (!m) throw new Error('CAF no contiene <RSASK> (llave privada del timbre)');
  return m[1].trim();
}

// Genera el TED (Timbre Electrónico) firmado con la llave privada del CAF.
function generateTED(params, cafXml, stamp) {
  const { tipoDTE, folio, rutEmisor, receptor, totales, detalle } = params;
  const cafElement = extractCafElement(cafXml);
  const cafKeyPem = extractCafPrivateKey(cafXml);

  const dd =
    `<DD>` +
    `<RE>${cleanRut(rutEmisor)}</RE>` +
    `<TD>${tipoDTE}</TD>` +
    `<F>${folio}</F>` +
    `<FE>${today()}</FE>` +
    `<RR>${cleanRut(receptor.rut)}</RR>` +
    `<RSR>${x(receptor.razon_social.substring(0, 40))}</RSR>` +
    `<MNT>${totales.total}</MNT>` +
    `<IT1>${x((detalle[0].nombre || '').substring(0, 40))}</IT1>` +
    cafElement +
    `<TSTED>${stamp}</TSTED>` +
    `</DD>`;

  const frmt = rsaSha1b64Pem(dd, cafKeyPem);
  return `<TED version="1.0">${dd}<FRMT algoritmo="SHA1withRSA">${frmt}</FRMT></TED>`;
}

// Firma enveloped con xml-crypto sobre el elemento que matchea `xpath`
// (referenciado por `refUri`), insertando el <Signature> como hermano posterior.
function signEnveloped(fullXml, xpath, refUri, privateKey, certificate) {
  const certB64 = certDerb64(certificate);
  const mod = rsaModulusb64(certificate);
  const exp = rsaExponentb64(certificate);

  const sig = new SignedXml({
    privateKey: privateKeyPem(privateKey),
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    uri: refUri,
  });

  sig.getKeyInfoContent = () =>
    `<KeyValue><RSAKeyValue><Modulus>${mod}</Modulus><Exponent>${exp}</Exponent></RSAKeyValue></KeyValue>` +
    `<X509Data><X509Certificate>${certB64}</X509Certificate></X509Data>`;

  sig.computeSignature(fullXml, { location: { reference: xpath, action: 'after' } });
  return sig.getSignedXml();
}

// Construye las líneas de <Detalle>. Soporta: unidad de medida, descuento por
// porcentaje o monto, ítems exentos (IndExe=1) y líneas solo-texto (sin monto,
// para notas que corrigen texto).
function buildDetalles(detalle) {
  const round = Math.round;
  return detalle
    .map((item, i) => {
      const prc = item.precio ?? item.precio_unitario;
      let d = `<Detalle>` + `<NroLinDet>${i + 1}</NroLinDet>`;
      if (item.exento) d += `<IndExe>1</IndExe>`;
      d += `<NmbItem>${x(item.nombre)}</NmbItem>`;
      if (item.descripcion) d += `<DscItem>${x(item.descripcion)}</DscItem>`;

      // Línea solo-texto: sin cantidad/precio (ej: NC que corrige giro)
      if (prc == null) return d + `</Detalle>`;

      const gross = round(item.cantidad * prc);
      d += `<QtyItem>${item.cantidad}</QtyItem>`;
      if (item.unidad) d += `<UnmdItem>${x(item.unidad)}</UnmdItem>`;
      d += `<PrcItem>${round(prc)}</PrcItem>`;
      if (item.descuento_pct) {
        d += `<DescuentoPct>${item.descuento_pct}</DescuentoPct>`;
        d += `<DescuentoMonto>${round(gross * item.descuento_pct / 100)}</DescuentoMonto>`;
      } else if (item.descuento_monto) {
        d += `<DescuentoMonto>${round(item.descuento_monto)}</DescuentoMonto>`;
      }
      // MontoItem es el monto BRUTO de la línea (cantidad × precio); el descuento
      // va aparte. MntNeto = Σ MontoItem − Σ DescuentoMonto − descuento global.
      d += `<MontoItem>${gross}</MontoItem>`;
      d += `</Detalle>`;
      return d;
    })
    .join('');
}

// Descuento/Recargo global (DscRcgGlobal). Solo descuento por % a ítems afectos.
function buildDscRcgGlobal(pct) {
  if (!pct) return '';
  return (
    `<DscRcgGlobal>` +
    `<NroLinDR>1</NroLinDR>` +
    `<TpoMov>D</TpoMov>` +
    `<TpoValor>%</TpoValor>` +
    `<ValorDR>${pct}</ValorDR>` +
    `</DscRcgGlobal>`
  );
}

// Construye las <Referencia> (necesarias para Notas de Crédito/Débito).
// data.referencias = [{ tipo_doc, folio, fecha, cod_ref, razon }]
function buildReferencias(referencias) {
  if (!referencias?.length) return '';
  return referencias
    .map((r, i) => {
      let ref = `<Referencia>` + `<NroLinRef>${i + 1}</NroLinRef>`;
      ref += `<TpoDocRef>${r.tipo_doc}</TpoDocRef>`;
      ref += `<FolioRef>${r.folio}</FolioRef>`;
      ref += `<FchRef>${r.fecha || today()}</FchRef>`;
      if (r.cod_ref) ref += `<CodRef>${r.cod_ref}</CodRef>`;
      if (r.razon) ref += `<RazonRef>${x(r.razon)}</RazonRef>`;
      ref += `</Referencia>`;
      return ref;
    })
    .join('');
}

// Construye el <Documento> sin firmar (con el TED ya firmado dentro).
// Hereda el namespace SiiDte del EnvioDTE (sin xmlns propio).
function buildDocumento(data, folio, cafXml, env) {
  const { tipo_documento, receptor, detalle, totales, referencias } = data;
  const rutEmisor = env.RUT_EMISOR;
  const docId = `F${tipo_documento}T${folio}`;
  const stamp = ts();

  const ted = generateTED(
    { tipoDTE: tipo_documento, folio, rutEmisor, receptor, totales, detalle },
    cafXml,
    stamp
  );

  // Totales: soporta neto + exento. Si no hay neto (factura exenta total), omite IVA.
  let totalesXml = `<Totales>`;
  if (totales.neto) totalesXml += `<MntNeto>${totales.neto}</MntNeto>`;
  if (totales.exento) totalesXml += `<MntExe>${totales.exento}</MntExe>`;
  if (totales.neto) {
    totalesXml += `<TasaIVA>19</TasaIVA>`;
    totalesXml += `<IVA>${totales.iva}</IVA>`;
  }
  totalesXml += `<MntTotal>${totales.total}</MntTotal>`;
  totalesXml += `</Totales>`;

  return (
    `<Documento ID="${docId}">` +
    `<Encabezado>` +
    `<IdDoc>` +
    `<TipoDTE>${tipo_documento}</TipoDTE>` +
    `<Folio>${folio}</Folio>` +
    `<FchEmis>${today()}</FchEmis>` +
    // FmaPago aplica a facturas; las notas de crédito/débito no lo llevan
    (['33', '34'].includes(String(tipo_documento)) ? `<FmaPago>${data.forma_pago || 1}</FmaPago>` : '') +
    `</IdDoc>` +
    `<Emisor>` +
    `<RUTEmisor>${cleanRut(rutEmisor)}</RUTEmisor>` +
    `<RznSoc>${x(env.RAZON_SOCIAL)}</RznSoc>` +
    `<GiroEmis>${x(env.GIRO_EMISOR)}</GiroEmis>` +
    `<Acteco>${env.ACTECO}</Acteco>` +
    `<DirOrigen>${x(env.DIR_EMISOR)}</DirOrigen>` +
    `<CmnaOrigen>${x(env.CMNA_EMISOR)}</CmnaOrigen>` +
    `<CiudadOrigen>${x(env.CIUDAD_EMISOR)}</CiudadOrigen>` +
    `</Emisor>` +
    `<Receptor>` +
    `<RUTRecep>${cleanRut(receptor.rut)}</RUTRecep>` +
    `<RznSocRecep>${x(receptor.razon_social)}</RznSocRecep>` +
    `<GiroRecep>${x(receptor.giro || 'Sin giro')}</GiroRecep>` +
    (receptor.direccion ? `<DirRecep>${x(receptor.direccion)}</DirRecep>` : '') +
    (receptor.comuna ? `<CmnaRecep>${x(receptor.comuna)}</CmnaRecep>` : '') +
    (receptor.ciudad ? `<CiudadRecep>${x(receptor.ciudad)}</CiudadRecep>` : '') +
    `</Receptor>` +
    totalesXml +
    `</Encabezado>` +
    buildDetalles(detalle) +
    buildDscRcgGlobal(data.descuento_global_pct) +
    buildReferencias(referencias) +
    ted +
    `<TmstFirma>${stamp}</TmstFirma>` +
    `</Documento>`
  );
}

// Construye el EnvioDTE completo y firmado con UNO o VARIOS DTE.
// documentos: array de { data, folio, cafXml }.
// Firma cada <Documento> por su ID y luego el <SetDTE>.
export function buildSignedEnvioDTESet(documentos, env, privateKey, certificate) {
  const rutEmisor = cleanRut(env.RUT_EMISOR);
  const stamp = ts();

  // Construye todos los DTE (sin firmar) y recolecta IDs + conteo por tipo
  const docIds = [];
  const countByTipo = {};
  const dtes = documentos
    .map(({ data, folio, cafXml }) => {
      const docId = `F${data.tipo_documento}T${folio}`;
      docIds.push(docId);
      countByTipo[data.tipo_documento] = (countByTipo[data.tipo_documento] || 0) + 1;
      const documento = buildDocumento(data, folio, cafXml, env);
      return `<DTE version="1.0">${documento}</DTE>`;
    })
    .join('');

  // SubTotDTE: un bloque por cada tipo de documento del set
  const subTotDte = Object.entries(countByTipo)
    .map(([tipo, n]) => `<SubTotDTE><TpoDTE>${tipo}</TpoDTE><NroDTE>${n}</NroDTE></SubTotDTE>`)
    .join('');

  // En certificación SII exige NroResol=0; el número real de resolución solo
  // aplica en producción. Así no depende de configurar bien el .env.
  const nroResol = String(env.SII_ENV) === 'produccion' ? env.RESOLUCION_NUMERO : 0;

  const caratula =
    `<Caratula version="1.0">` +
    `<RutEmisor>${rutEmisor}</RutEmisor>` +
    `<RutEnvia>${rutEmisor}</RutEnvia>` +
    `<RutReceptor>60803000-K</RutReceptor>` +
    `<FchResol>${env.RESOLUCION_FECHA}</FchResol>` +
    `<NroResol>${nroResol}</NroResol>` +
    `<TmstFirmaEnv>${stamp}</TmstFirmaEnv>` +
    subTotDte +
    `</Caratula>`;

  const setDte = `<SetDTE ID="SetDoc">${caratula}${dtes}</SetDTE>`;

  const envioUnsigned =
    `<EnvioDTE version="1.0" ` +
    `xmlns="http://www.sii.cl/SiiDte" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd">` +
    setDte +
    `</EnvioDTE>`;

  // 1. Firma cada Documento por su ID (Signature queda dentro de su <DTE>)
  let signed = envioUnsigned;
  for (const docId of docIds) {
    signed = signEnveloped(signed, `//*[@ID='${docId}']`, `#${docId}`, privateKey, certificate);
  }
  // 2. Firma el SetDTE (cubre carátula + todos los DTE ya firmados)
  signed = signEnveloped(signed, `//*[@ID='SetDoc']`, '#SetDoc', privateKey, certificate);

  return `<?xml version="1.0" encoding="ISO-8859-1"?>\n${signed}`;
}

// Helper para un solo DTE (compatibilidad con POST / y /test-emit).
export function buildSignedEnvioDTE(data, folio, cafXml, privateKey, certificate, env) {
  return buildSignedEnvioDTESet([{ data, folio, cafXml }], env, privateKey, certificate);
}
